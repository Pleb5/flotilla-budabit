import {derived, readable, type Readable} from "svelte/store"
import {request, load} from "@welshman/net"
import {pubkey, repository} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {
  Address,
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {Router} from "@welshman/router"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  parseRepoAnnouncementEvent,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
} from "@app/core/community"
import {
  makeCommunityProfileListFilters,
  selectLatestCommunityDefinition,
} from "@app/core/community-state"
import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
import {GIT_RELAYS, getRepoMaintainers, getStatusRootId} from "@app/core/git-state"
import {userRepoWatchValues, type RepoWatchOptions} from "@app/core/repo-watch"
import {
  checked,
  communityNotificationBaselines,
  hasNotificationForPath,
  setNotificationsConfig,
  type NotificationCandidate,
} from "@app/util/notifications"
import {makeGitPath} from "@app/util/routes"
import {ROLE_NS} from "@app/util/labels"

type RepoWatchAddressRef = {
  address: string
  pubkey: string
  identifier: string
  naddr: string
}

type WatchedRepoRef = RepoWatchAddressRef & {
  options: RepoWatchOptions
}

export type RepoWatchNotificationRepo = WatchedRepoRef & {
  repoEvent?: TrustedEvent
  communityDefinition?: CommunityDefinition
  communityProfileListEvents?: TrustedEvent[]
}

export type RepoWatchNotificationInput = {
  repos: RepoWatchNotificationRepo[]
  issues?: TrustedEvent[]
  pullRequests?: TrustedEvent[]
  pullRequestUpdates?: TrustedEvent[]
  statuses?: TrustedEvent[]
  comments?: TrustedEvent[]
  labels?: TrustedEvent[]
  currentPubkey?: string
}

type RepoWatchCandidateSection = "issues" | "prs"

const statusKinds = [
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
]

const repoActivityKinds = [
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  ...statusKinds,
  GIT_LABEL,
]

const REPO_ACTIVITY_FILTER_CHUNK_SIZE = 100

export const hasGitNotification = (paths: Set<string>) => {
  for (const path of paths) {
    if (path.startsWith("/git/")) return true
  }

  return false
}

const normalizeRelay = (relay: string | undefined) => {
  if (!relay) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: Iterable<string | undefined>) =>
  Array.from(
    new Set(
      Array.from(relays)
        .map(normalizeRelay)
        .filter(Boolean),
    ),
  )

const chunkBySize = <T>(items: T[], size: number) => {
  const chunks: T[][] = []

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }

  return chunks
}

const getBaseRelays = () => {
  let userRelays: string[] = []

  try {
    const urls = Router.get().FromUser().getUrls()
    userRelays = Array.isArray(urls) ? urls : []
  } catch {
    userRelays = []
  }

  return normalizeRelays([...GIT_RELAYS, ...userRelays])
}

const parseWatchedRepoAddress = (address: string): RepoWatchAddressRef | undefined => {
  try {
    const ref = Address.from(address)
    if (ref.kind !== GIT_REPO_ANNOUNCEMENT || !ref.pubkey || !ref.identifier) return undefined

    return {
      address: ref.toString(),
      pubkey: ref.pubkey,
      identifier: ref.identifier,
      naddr: ref.toNaddr(),
    }
  } catch {
    return undefined
  }
}

const getRepoAddress = (event: TrustedEvent) => getTagValue("a", event.tags) || ""

const getCommentRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""

const getLabelRootId = (event: TrustedEvent) => getTagValue("e", event.tags) || ""

const getStatusOption = (kind: number): keyof RepoWatchOptions["status"] | undefined => {
  if (kind === GIT_STATUS_OPEN) return "open"
  if (kind === GIT_STATUS_DRAFT) return "draft"
  if (kind === GIT_STATUS_APPLIED) return "applied"
  if (kind === GIT_STATUS_CLOSED) return "closed"
}

const getRepoMaintainerSet = (repo: RepoWatchNotificationRepo) => {
  const repoEvent = repo.repoEvent as RepoAnnouncementEvent | undefined
  const maintainers = repoEvent ? getRepoMaintainers(repoEvent) : [repo.pubkey]

  return new Set(maintainers)
}

const authorCanWriteRepoCommunity = (repo: RepoWatchNotificationRepo, authorPubkey: string) => {
  const definition = repo.communityDefinition
  if (!definition) return false

  return canWriteCommunityTarget({
    definition,
    profileListEvents: repo.communityProfileListEvents || [],
    userPubkey: authorPubkey,
    target: COMMUNITY_WRITE_TARGETS.repository,
  })
}

const repoAllowsAuthor = ({
  repo,
  authorPubkey,
  currentPubkey,
}: {
  repo: RepoWatchNotificationRepo
  authorPubkey: string
  currentPubkey?: string
}) => {
  if (!authorPubkey) return false
  if (currentPubkey && authorPubkey === currentPubkey) return false

  const maintainers = getRepoMaintainerSet(repo)
  const isMaintainer = maintainers.has(authorPubkey)
  const isCommunityWriter = authorCanWriteRepoCommunity(repo, authorPubkey)

  if (repo.options.activityFilter === "maintainers") return isMaintainer
  if (repo.options.activityFilter === "community") return isCommunityWriter
  if (repo.options.activityFilter === "maintainers-community") {
    return isMaintainer || isCommunityWriter
  }

  return true
}

const isAssigneeLabelForCurrentUser = (event: TrustedEvent, currentPubkey?: string) => {
  if (!currentPubkey || event.kind !== GIT_LABEL) return false

  const hasRoleNamespace = event.tags.some(tag => tag[0] === "L" && tag[1] === ROLE_NS)
  if (!hasRoleNamespace) return false

  const assignsCurrentUser = event.tags.some(tag => tag[0] === "p" && tag[1] === currentPubkey)
  if (!assignsCurrentUser) return false

  return event.tags.some(
    tag => tag[0] === "l" && tag[1] === "assignee" && tag[2] === ROLE_NS && tag[3] !== "del",
  )
}

const isNewerEvent = (event: TrustedEvent, current: TrustedEvent) =>
  event.created_at > current.created_at ||
  (event.created_at === current.created_at && event.id > current.id)

const addCandidate = ({
  candidates,
  repo,
  section,
  event,
  enabled,
  currentPubkey,
}: {
  candidates: Map<string, TrustedEvent>
  repo: RepoWatchNotificationRepo
  section: RepoWatchCandidateSection
  event: TrustedEvent
  enabled: boolean
  currentPubkey?: string
}) => {
  if (!enabled) return
  if (!repoAllowsAuthor({repo, authorPubkey: event.pubkey, currentPubkey})) return

  const path = `${makeGitPath(undefined, repo.naddr)}/${section}`
  const current = candidates.get(path)

  if (!current || isNewerEvent(event, current)) {
    candidates.set(path, event)
  }
}

const dedupeEvents = (events: TrustedEvent[]) => {
  const byId = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event?.id) byId.set(event.id, event)
  }

  return Array.from(byId.values())
}

export const getRepoWatchNotificationCandidates = ({
  repos,
  issues = [],
  pullRequests = [],
  pullRequestUpdates = [],
  statuses = [],
  comments = [],
  labels = [],
  currentPubkey,
}: RepoWatchNotificationInput): NotificationCandidate[] => {
  const reposByAddress = new Map(repos.map(repo => [repo.address, repo]))
  const issueReposByRootId = new Map<string, RepoWatchNotificationRepo>()
  const prReposByRootId = new Map<string, RepoWatchNotificationRepo>()
  const candidates = new Map<string, TrustedEvent>()

  for (const issue of issues) {
    if (issue.kind !== GIT_ISSUE) continue
    const repo = reposByAddress.get(getRepoAddress(issue))
    if (!repo) continue

    issueReposByRootId.set(issue.id, repo)
    addCandidate({
      candidates,
      repo,
      section: "issues",
      event: issue,
      enabled: repo.options.issues.new,
      currentPubkey,
    })
  }

  for (const pullRequest of pullRequests) {
    if (pullRequest.kind !== GIT_PULL_REQUEST) continue
    const repo = reposByAddress.get(getRepoAddress(pullRequest))
    if (!repo) continue

    prReposByRootId.set(pullRequest.id, repo)
    addCandidate({
      candidates,
      repo,
      section: "prs",
      event: pullRequest,
      enabled: repo.options.prs.new,
      currentPubkey,
    })
  }

  for (const update of pullRequestUpdates) {
    if (update.kind !== GIT_PULL_REQUEST_UPDATE) continue
    const repo = reposByAddress.get(getRepoAddress(update))
    if (!repo) continue

    addCandidate({
      candidates,
      repo,
      section: "prs",
      event: update,
      enabled: repo.options.prs.updates,
      currentPubkey,
    })
  }

  for (const status of statuses) {
    const statusOption = getStatusOption(status.kind)
    if (!statusOption) continue

    const rootId = getStatusRootId(status as any)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)

    if (issueRepo) {
      addCandidate({
        candidates,
        repo: issueRepo,
        section: "issues",
        event: status,
        enabled: issueRepo.options.status[statusOption],
        currentPubkey,
      })
    }

    if (prRepo) {
      addCandidate({
        candidates,
        repo: prRepo,
        section: "prs",
        event: status,
        enabled: prRepo.options.status[statusOption],
        currentPubkey,
      })
    }
  }

  for (const comment of comments) {
    if (comment.kind !== GIT_COMMENT) continue

    const rootId = getCommentRootId(comment)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)

    if (issueRepo) {
      addCandidate({
        candidates,
        repo: issueRepo,
        section: "issues",
        event: comment,
        enabled: issueRepo.options.issues.comments,
        currentPubkey,
      })
    }

    if (prRepo) {
      addCandidate({
        candidates,
        repo: prRepo,
        section: "prs",
        event: comment,
        enabled: prRepo.options.prs.comments,
        currentPubkey,
      })
    }
  }

  for (const label of labels) {
    if (!isAssigneeLabelForCurrentUser(label, currentPubkey)) continue

    const rootId = getLabelRootId(label)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)

    if (issueRepo) {
      addCandidate({
        candidates,
        repo: issueRepo,
        section: "issues",
        event: label,
        enabled: issueRepo.options.assignments,
        currentPubkey,
      })
    }

    if (prRepo) {
      addCandidate({
        candidates,
        repo: prRepo,
        section: "prs",
        event: label,
        enabled: prRepo.options.assignments,
        currentPubkey,
      })
    }
  }

  return Array.from(candidates.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, latestEvent]) => ({path, latestEvent}))
}

const watchedRepoRefs: Readable<WatchedRepoRef[]> = derived(userRepoWatchValues, $values =>
  Object.entries($values.repos)
    .map(([address, options]) => {
      const ref = parseWatchedRepoAddress(address)
      return ref ? {...ref, options} : undefined
    })
    .filter((repo): repo is WatchedRepoRef => Boolean(repo)),
)

const baseRelays = derived(pubkey, getBaseRelays)

const deriveLoadedEvents = <T extends TrustedEvent>({
  filters,
  relays,
  label,
}: {
  filters: Readable<Filter[]>
  relays: Readable<string[]>
  label: string
}): Readable<T[]> =>
  readable<T[]>([], set => {
    let previousKey = ""
    let controller: AbortController | undefined
    let unsubscribeEvents: (() => void) | undefined

    const unsubscribe = derived([filters, relays], ([$filters, $relays]) => ({
      filters: $filters,
      relays: $relays,
    })).subscribe(({filters, relays}) => {
      const normalizedRelays = normalizeRelays(relays)
      const key = `${JSON.stringify(filters)}::${normalizedRelays.join("|")}`
      if (key === previousKey) return
      previousKey = key

      controller?.abort()
      unsubscribeEvents?.()
      controller = undefined
      unsubscribeEvents = undefined

      if (filters.length === 0) {
        set([])
        return
      }

      unsubscribeEvents = deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(
        events => set(events as T[]),
      )

      if (normalizedRelays.length === 0) return

      controller = new AbortController()
      load({relays: normalizedRelays, filters}).catch(error => {
        if (!controller?.signal.aborted) {
          console.warn(`[repo-watch-notifications] Failed to load ${label}`, error)
        }
      })
      request({
        relays: normalizedRelays,
        signal: controller.signal,
        filters: filters.map(filter => ({...filter, limit: 0})),
      }).catch(error => {
        if (!controller?.signal.aborted) {
          console.warn(`[repo-watch-notifications] Failed to subscribe to ${label}`, error)
        }
      })
    })

    return () => {
      controller?.abort()
      unsubscribeEvents?.()
      unsubscribe()
    }
  })

const watchedRepoAnnouncementFilters = derived(watchedRepoRefs, $repos =>
  $repos.map(repo => ({
    authors: [repo.pubkey],
    kinds: [GIT_REPO_ANNOUNCEMENT],
    "#d": [repo.identifier],
    limit: 1,
  })),
)

const watchedRepoAnnouncementEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoAnnouncementFilters,
  relays: baseRelays,
  label: "repo announcements",
})

const repoAnnouncementEventsByAddress = derived(watchedRepoAnnouncementEvents, $events => {
  const eventsByAddress = new Map<string, TrustedEvent>()

  for (const event of $events) {
    try {
      const announcement = parseRepoAnnouncementEvent(event as RepoAnnouncementEvent)
      if (announcement.address) eventsByAddress.set(announcement.address, event)
    } catch {
      continue
    }
  }

  return eventsByAddress
})

const watchedRepoActivityRelays = derived(
  [baseRelays, watchedRepoAnnouncementEvents],
  ([$baseRelays, $events]) => {
    const repoRelays = $events.flatMap(event => {
      try {
        return parseRepoAnnouncementEvent(event as RepoAnnouncementEvent).relays || []
      } catch {
        return []
      }
    })

    return normalizeRelays([...$baseRelays, ...repoRelays])
  },
)

const watchedRepoActivityFilters = derived(watchedRepoRefs, $repos => {
  const addresses = $repos.map(repo => repo.address)
  const filters: Filter[] = []

  for (const addressChunk of chunkBySize(addresses, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
    filters.push({kinds: repoActivityKinds, "#a": addressChunk})
  }

  return filters
})

const watchedRepoActivityEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoActivityFilters,
  relays: watchedRepoActivityRelays,
  label: "repo activity",
})

const watchedRepoRootIds = derived(watchedRepoActivityEvents, $events =>
  Array.from(
    new Set(
      $events
        .filter(event => event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST)
        .map(event => event.id)
        .filter(Boolean),
    ),
  ),
)

const watchedRepoRootScopedFilters = derived(watchedRepoRootIds, $rootIds => {
  const filters: Filter[] = []

  for (const rootChunk of chunkBySize($rootIds, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
    filters.push(
      {kinds: [GIT_COMMENT], "#E": rootChunk},
      {kinds: [GIT_COMMENT], "#e": rootChunk},
      {kinds: [GIT_LABEL], "#e": rootChunk},
      {kinds: statusKinds, "#e": rootChunk},
    )
  }

  return filters
})

const watchedRepoRootScopedEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoRootScopedFilters,
  relays: watchedRepoActivityRelays,
  label: "repo root activity",
})

const watchedRepoCommunityRefs = derived(watchedRepoAnnouncementEvents, $events => {
  const refs = new Map<string, string[]>()

  for (const event of $events) {
    try {
      const community = parseRepoAnnouncementEvent(event as RepoAnnouncementEvent).community
      if (!community?.pubkey) continue

      const relays = refs.get(community.pubkey) || []
      if (community.relay) relays.push(community.relay)
      refs.set(community.pubkey, relays)
    } catch {
      continue
    }
  }

  return refs
})

const watchedRepoCommunityDefinitionFilters = derived(watchedRepoCommunityRefs, $refs =>
  Array.from($refs.keys()).map(communityPubkey => ({
    kinds: [COMMUNITY_DEFINITION_KIND],
    authors: [communityPubkey],
    limit: 1,
  })),
)

const watchedRepoCommunityRelays = derived(
  [baseRelays, watchedRepoCommunityRefs],
  ([$baseRelays, $refs]) => normalizeRelays([...$baseRelays, ...Array.from($refs.values()).flat()]),
)

const watchedRepoCommunityDefinitionEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoCommunityDefinitionFilters,
  relays: watchedRepoCommunityRelays,
  label: "repo community definitions",
})

const watchedRepoCommunityDefinitions = derived(watchedRepoCommunityDefinitionEvents, $events => {
  const communityPubkeys = Array.from(new Set($events.map(event => event.pubkey).filter(Boolean)))
  const definitions = new Map<string, CommunityDefinition>()

  for (const communityPubkey of communityPubkeys) {
    const definition = selectLatestCommunityDefinition($events, communityPubkey)
    if (definition) definitions.set(communityPubkey, definition)
  }

  return definitions
})

const watchedRepoCommunityProfileListFilters = derived(
  watchedRepoCommunityDefinitions,
  $definitions => Array.from($definitions.values()).flatMap(makeCommunityProfileListFilters),
)

const watchedRepoCommunityProfileListRelays = derived(
  [watchedRepoCommunityRelays, watchedRepoCommunityDefinitions],
  ([$relays, $definitions]) =>
    normalizeRelays([
      ...$relays,
      ...Array.from($definitions.values()).flatMap(definition => definition.relays),
    ]),
)

const watchedRepoCommunityProfileListEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoCommunityProfileListFilters,
  relays: watchedRepoCommunityProfileListRelays,
  label: "repo community profile lists",
})

const repoWatchNotificationCandidates = derived(
  [
    pubkey,
    watchedRepoRefs,
    repoAnnouncementEventsByAddress,
    watchedRepoActivityEvents,
    watchedRepoRootScopedEvents,
    watchedRepoCommunityDefinitions,
    watchedRepoCommunityProfileListEvents,
  ],
  ([
    $pubkey,
    $repos,
    $repoEventsByAddress,
    $activityEvents,
    $rootScopedEvents,
    $communityDefinitions,
    $communityProfileListEvents,
  ]) => {
    const repos = $repos.map(repo => {
      const repoEvent = $repoEventsByAddress.get(repo.address)
      let communityDefinition: CommunityDefinition | undefined

      if (repoEvent) {
        try {
          const community = parseRepoAnnouncementEvent(repoEvent as RepoAnnouncementEvent).community
          if (community?.pubkey) communityDefinition = $communityDefinitions.get(community.pubkey)
        } catch {
          communityDefinition = undefined
        }
      }

      return {
        ...repo,
        repoEvent,
        communityDefinition,
        communityProfileListEvents: $communityProfileListEvents.filter(
          event => event.kind === PROFILE_LIST_KIND,
        ),
      }
    })

    const events = dedupeEvents([...$activityEvents, ...$rootScopedEvents])

    return getRepoWatchNotificationCandidates({
      repos,
      currentPubkey: $pubkey || undefined,
      issues: events.filter(event => event.kind === GIT_ISSUE),
      pullRequests: events.filter(event => event.kind === GIT_PULL_REQUEST),
      pullRequestUpdates: events.filter(event => event.kind === GIT_PULL_REQUEST_UPDATE),
      statuses: events.filter(event => statusKinds.includes(event.kind)),
      comments: events.filter(event => event.kind === GIT_COMMENT),
      labels: events.filter(event => event.kind === GIT_LABEL),
    })
  },
)

const repoWatchNotificationPaths = derived(
  [pubkey, checked, communityNotificationBaselines, repoWatchNotificationCandidates],
  ([$pubkey, $checked, $communityNotificationBaselines, $candidates]) => {
    const paths = new Set<string>()

    for (const candidate of $candidates) {
      if (
        hasNotificationForPath({
          path: candidate.path,
          latestEvent: candidate.latestEvent,
          currentPubkey: $pubkey || undefined,
          checked: $checked,
          communityBaselines: $communityNotificationBaselines,
        })
      ) {
        paths.add(candidate.path)
      }
    }

    return paths
  },
)

export const setupRepoWatchNotifications = () => {
  const unsubscribe = repoWatchNotificationPaths.subscribe(repoPaths => {
    setNotificationsConfig({
      augmentPaths: paths => {
        if (repoPaths.size === 0) return paths

        const next = new Set(paths)
        for (const path of repoPaths) next.add(path)

        return next
      },
    })
  })

  return () => {
    unsubscribe()
    setNotificationsConfig({})
  }
}
