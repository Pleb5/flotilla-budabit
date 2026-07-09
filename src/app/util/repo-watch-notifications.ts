import {derived, readable, type Readable} from "svelte/store"
import {request, load} from "@welshman/net"
import {pubkey, repository} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {now} from "@welshman/lib"
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
import {GIT_RELAYS, getRepoMaintainers, getStatusRootId, repoAnnouncements} from "@app/core/git-state"
import {
  defaultRepoWatchOptions,
  repoWatchNotificationSeen,
  updateRepoWatchNotificationSeen,
  userRepoWatchValues,
  type RepoWatchOptions,
} from "@app/core/repo-watch"
import {
  checked,
  effectiveCommunityNotificationBaselines,
  hasNotificationForPath,
  normalizeChecked,
  setNotificationsConfig,
  type NotificationCandidate,
} from "@app/util/notifications"
import {
  notificationHistoryFilterLimit,
  notificationHistorySince,
} from "@app/util/notification-history"
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

export type RepoWatchNotificationRepo = RepoWatchAddressRef & {
  options: RepoWatchOptions
  repoEvent?: TrustedEvent
  communityDefinition?: CommunityDefinition
  communityProfileListEvents?: TrustedEvent[]
}

export type GetRepoNotificationReposOptions = {
  watchedRepos: WatchedRepoRef[]
  repoEvents: TrustedEvent[]
  currentPubkey?: string
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

const statusKinds = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED]

const repoActivityKinds = [
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  ...statusKinds,
  GIT_COMMENT,
  GIT_LABEL,
]

const REPO_ACTIVITY_FILTER_CHUNK_SIZE = 100
const REPO_WATCH_SEEN_BUFFER_SECONDS = 60
const REPO_WATCH_HARD_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
const REPO_WATCH_LOAD_LIMIT = 200

export const defaultOwnedRepoNotificationOptions: RepoWatchOptions = {
  ...defaultRepoWatchOptions,
  issues: {...defaultRepoWatchOptions.issues, comments: true},
  prs: {...defaultRepoWatchOptions.prs, comments: true},
  reviews: true,
}

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
  Array.from(new Set(Array.from(relays).map(normalizeRelay).filter(Boolean)))

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

const getRepoWatchPath = (repo: RepoWatchAddressRef, section: RepoWatchCandidateSection) =>
  `${makeGitPath(undefined, repo.naddr)}/${section}`

const getRepoWatchPaths = (repo: RepoWatchAddressRef) => [
  getRepoWatchPath(repo, "issues"),
  getRepoWatchPath(repo, "prs"),
]

const mergeCheckedState = (
  checkedState: Record<string, number> = {},
  notificationSeen: Record<string, number> = {},
) => {
  const merged: Record<string, number> = {}

  for (const [path, timestamp] of Object.entries(notificationSeen)) {
    const normalized = normalizeChecked(Number(timestamp || 0))
    if (path && normalized > 0) merged[path] = normalized
  }

  for (const [path, timestamp] of Object.entries(checkedState)) {
    const normalized = normalizeChecked(Number(timestamp || 0))
    if (!path || normalized <= 0) continue
    merged[path] = Math.max(merged[path] || 0, normalized)
  }

  return merged
}

const getRepoWatchSeenAt = (
  repo: RepoWatchAddressRef,
  checkedState: Record<string, number> = {},
  notificationSeen: Record<string, number> = {},
) => {
  const merged = mergeCheckedState(checkedState, notificationSeen)
  const seenValues = getRepoWatchPaths(repo)
    .map(path => Math.max(merged[path] || 0, merged[`${path}:seen`] || 0))
    .filter(timestamp => timestamp > 0)

  return seenValues.length > 0 ? Math.min(...seenValues) : 0
}

const getBoundedSince = (seenAt: number) => {
  const current = now()
  const baseline = seenAt > 0 ? seenAt : current
  return Math.max(
    0,
    baseline - REPO_WATCH_SEEN_BUFFER_SECONDS,
    current - REPO_WATCH_HARD_LOOKBACK_SECONDS,
  )
}

const getHistoryBoundedSince = (seenAt: number, historySince: number) =>
  Math.min(getBoundedSince(seenAt), normalizeChecked(historySince))

const getFilterKey = (filters: Filter[]) =>
  filters
    .map(filter => JSON.stringify(filter))
    .sort()
    .join("|")

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

const parseRepoAnnouncementRef = (event: TrustedEvent): RepoWatchAddressRef | undefined => {
  if (event.kind !== GIT_REPO_ANNOUNCEMENT) return undefined

  try {
    const ref = Address.fromEvent(event)
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

const mapRepoEventsByAddress = (events: TrustedEvent[]) => {
  const byAddress = new Map<string, TrustedEvent>()

  for (const event of events) {
    const ref = parseRepoAnnouncementRef(event)
    if (ref) byAddress.set(ref.address, event)
  }

  return byAddress
}

export const getRepoNotificationRepos = ({
  watchedRepos,
  repoEvents,
  currentPubkey,
}: GetRepoNotificationReposOptions): RepoWatchNotificationRepo[] => {
  const reposByAddress = new Map<string, RepoWatchNotificationRepo>()
  const repoEventsByAddress = mapRepoEventsByAddress(repoEvents)

  for (const repo of watchedRepos) {
    reposByAddress.set(repo.address, {
      ...repo,
      repoEvent: repoEventsByAddress.get(repo.address),
    })
  }

  if (currentPubkey) {
    for (const event of repoEventsByAddress.values()) {
      const ref = parseRepoAnnouncementRef(event)
      if (!ref) continue
      if (!getRepoMaintainers(event as RepoAnnouncementEvent).includes(currentPubkey)) continue

      const existing = reposByAddress.get(ref.address)
      if (existing) {
        if (!existing.repoEvent) reposByAddress.set(ref.address, {...existing, repoEvent: event})
        continue
      }

      reposByAddress.set(ref.address, {
        ...ref,
        options: defaultOwnedRepoNotificationOptions,
        repoEvent: event,
      })
    }
  }

  return Array.from(reposByAddress.values()).sort((a, b) => a.address.localeCompare(b.address))
}

const getRepoAddress = (event: TrustedEvent) => getTagValue("a", event.tags) || ""

const getCommentRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""

const getLabelRootId = (event: TrustedEvent) => getTagValue("e", event.tags) || ""

const getRootKind = (event: TrustedEvent) =>
  Number(getTagValue("K", event.tags) || getTagValue("k", event.tags) || 0)

const getRootSection = (event: TrustedEvent): RepoWatchCandidateSection | undefined => {
  const rootKind = getRootKind(event)

  if (rootKind === GIT_ISSUE) return "issues"
  if (rootKind === GIT_PULL_REQUEST) return "prs"
}

const getRepoWatchRootIdsForEvent = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) return [event.id]
  if (statusKinds.includes(event.kind)) return [getStatusRootId(event as any)]
  if (event.kind === GIT_COMMENT) return [getCommentRootId(event)]
  if (event.kind === GIT_LABEL) return [getLabelRootId(event)]

  return []
}

export const getRepoWatchRootIdsForEvents = (events: TrustedEvent[]) =>
  Array.from(new Set(events.flatMap(getRepoWatchRootIdsForEvent).filter(Boolean)))

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

const isRoleLabelForCurrentUser = (event: TrustedEvent, currentPubkey: string | undefined, role: string) => {
  if (!currentPubkey || event.kind !== GIT_LABEL) return false

  const hasRoleNamespace = event.tags.some(tag => tag[0] === "L" && tag[1] === ROLE_NS)
  if (!hasRoleNamespace) return false

  const assignsCurrentUser = event.tags.some(tag => tag[0] === "p" && tag[1] === currentPubkey)
  if (!assignsCurrentUser) return false

  return event.tags.some(
    tag => tag[0] === "l" && tag[1] === role && tag[2] === ROLE_NS && tag[3] !== "del",
  )
}

const isAssigneeLabelForCurrentUser = (event: TrustedEvent, currentPubkey?: string) =>
  isRoleLabelForCurrentUser(event, currentPubkey, "assignee")

const isReviewerLabelForCurrentUser = (event: TrustedEvent, currentPubkey?: string) =>
  isRoleLabelForCurrentUser(event, currentPubkey, "reviewer")

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

  const path = getRepoWatchPath(repo, section)
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
    const fallbackRepo = reposByAddress.get(getRepoAddress(status))
    const fallbackSection = getRootSection(status)
    const issueCandidateRepo = issueRepo || (fallbackSection === "issues" ? fallbackRepo : undefined)
    const prCandidateRepo = prRepo || (fallbackSection === "prs" ? fallbackRepo : undefined)

    if (issueCandidateRepo) {
      addCandidate({
        candidates,
        repo: issueCandidateRepo,
        section: "issues",
        event: status,
        enabled: issueCandidateRepo.options.status[statusOption],
        currentPubkey,
      })
    }

    if (prCandidateRepo) {
      addCandidate({
        candidates,
        repo: prCandidateRepo,
        section: "prs",
        event: status,
        enabled: prCandidateRepo.options.status[statusOption],
        currentPubkey,
      })
    }
  }

  for (const comment of comments) {
    if (comment.kind !== GIT_COMMENT) continue

    const rootId = getCommentRootId(comment)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)
    const fallbackRepo = reposByAddress.get(getRepoAddress(comment))
    const fallbackSection = getRootSection(comment)
    const issueCandidateRepo = issueRepo || (fallbackSection === "issues" ? fallbackRepo : undefined)
    const prCandidateRepo = prRepo || (fallbackSection === "prs" ? fallbackRepo : undefined)

    if (issueCandidateRepo) {
      addCandidate({
        candidates,
        repo: issueCandidateRepo,
        section: "issues",
        event: comment,
        enabled: issueCandidateRepo.options.issues.comments,
        currentPubkey,
      })
    }

    if (prCandidateRepo) {
      addCandidate({
        candidates,
        repo: prCandidateRepo,
        section: "prs",
        event: comment,
        enabled: prCandidateRepo.options.prs.comments,
        currentPubkey,
      })
    }
  }

  for (const label of labels) {
    const isAssignment = isAssigneeLabelForCurrentUser(label, currentPubkey)
    const isReviewRequest = isReviewerLabelForCurrentUser(label, currentPubkey)
    if (!isAssignment && !isReviewRequest) continue

    const rootId = getLabelRootId(label)
    const issueRepo = issueReposByRootId.get(rootId)
    const prRepo = prReposByRootId.get(rootId)
    const fallbackRepo = reposByAddress.get(getRepoAddress(label))
    const fallbackSection = getRootSection(label)
    const issueCandidateRepo = issueRepo || (fallbackSection === "issues" ? fallbackRepo : undefined)
    const prCandidateRepo = prRepo || (fallbackSection === "prs" ? fallbackRepo : undefined)

    if (issueCandidateRepo) {
      addCandidate({
        candidates,
        repo: issueCandidateRepo,
        section: "issues",
        event: label,
        enabled: isAssignment ? issueCandidateRepo.options.assignments : issueCandidateRepo.options.reviews,
        currentPubkey,
      })
    }

    if (prCandidateRepo) {
      addCandidate({
        candidates,
        repo: prCandidateRepo,
        section: "prs",
        event: label,
        enabled: isAssignment ? prCandidateRepo.options.assignments : prCandidateRepo.options.reviews,
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

const repoWatchSeenBaselineUpdates = derived(
  [pubkey, watchedRepoRefs, checked, repoWatchNotificationSeen],
  ([$pubkey, $repos, $checked, $notificationSeen]) => {
    const updates: Record<string, number> = {}
    if (!$pubkey) return updates

    const current = now()

    for (const repo of $repos) {
      for (const path of getRepoWatchPaths(repo)) {
        if (normalizeChecked(Number($notificationSeen[path] || 0)) > 0) continue

        const localSeen = Math.max(
          normalizeChecked(Number($checked[path] || 0)),
          normalizeChecked(Number($checked[`${path}:seen`] || 0)),
        )
        updates[path] = localSeen > 0 ? localSeen : current
      }
    }

    return updates
  },
)

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
      const key = `${getFilterKey(filters)}::${normalizedRelays.join("|")}`
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

      const currentController = new AbortController()
      controller = currentController
      load({relays: normalizedRelays, filters, signal: currentController.signal}).catch(error => {
        if (!currentController.signal.aborted) {
          console.warn(`[repo-watch-notifications] Failed to load ${label}`, error)
        }
      })
      request({
        relays: normalizedRelays,
        signal: currentController.signal,
        filters: filters.map(filter => ({...filter, limit: 0})),
      }).catch(error => {
        if (!currentController.signal.aborted) {
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

const ownedRepoAnnouncementFilters = derived(pubkey, $pubkey =>
  $pubkey
    ? [
        {
          authors: [$pubkey],
          kinds: [GIT_REPO_ANNOUNCEMENT],
          limit: 100,
        },
      ]
    : [],
)

const ownedRepoAnnouncementEvents = deriveLoadedEvents<TrustedEvent>({
  filters: ownedRepoAnnouncementFilters,
  relays: baseRelays,
  label: "owned repo announcements",
})

const knownRepoAnnouncementEvents = derived(
  [repoAnnouncements, watchedRepoAnnouncementEvents, ownedRepoAnnouncementEvents],
  ([$repoAnnouncements, $watchedRepoAnnouncementEvents, $ownedRepoAnnouncementEvents]) =>
    Array.from(
      mapRepoEventsByAddress([
        ...($repoAnnouncements as TrustedEvent[]),
        ...$watchedRepoAnnouncementEvents,
        ...$ownedRepoAnnouncementEvents,
      ]).values(),
    ),
)

const notificationReposWithAnnouncements = derived(
  [pubkey, watchedRepoRefs, knownRepoAnnouncementEvents],
  ([$pubkey, $watchedRepos, $repoEvents]) =>
    getRepoNotificationRepos({
      watchedRepos: $watchedRepos,
      repoEvents: $repoEvents,
      currentPubkey: $pubkey || undefined,
    }).filter((repo): repo is RepoWatchNotificationRepo & {repoEvent: TrustedEvent} =>
      Boolean(repo.repoEvent),
    ),
)

const watchedRepoActivityRelays = derived(knownRepoAnnouncementEvents, $events => {
  const repoRelays = $events.flatMap(event => {
    try {
      return parseRepoAnnouncementEvent(event as RepoAnnouncementEvent).relays || []
    } catch {
      return []
    }
  })

  return normalizeRelays(repoRelays)
})

const watchedRepoActivityFilters = derived(
  [
    notificationReposWithAnnouncements,
    checked,
    repoWatchNotificationSeen,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $repos,
    $checked,
    $notificationSeen,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    const filters: Filter[] = []
    const addressesBySince = new Map<number, string[]>()

    for (const repo of $repos) {
      const since = getHistoryBoundedSince(
        getRepoWatchSeenAt(repo, $checked, $notificationSeen),
        $notificationHistorySince,
      )
      const addresses = addressesBySince.get(since) || []
      addresses.push(repo.address)
      addressesBySince.set(since, addresses)
    }

    for (const [since, addresses] of addressesBySince.entries()) {
      for (const addressChunk of chunkBySize(addresses, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
        filters.push({
          kinds: repoActivityKinds,
          "#a": addressChunk,
          since,
          limit: Math.max(REPO_WATCH_LOAD_LIMIT, $notificationHistoryFilterLimit),
        })
      }
    }

    return filters
  },
)

const watchedRepoActivityEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoActivityFilters,
  relays: watchedRepoActivityRelays,
  label: "repo activity",
})

const watchedRepoRootIds = derived(watchedRepoActivityEvents, getRepoWatchRootIdsForEvents)

const watchedRepoRootScopedFilters = derived(
  [
    watchedRepoRootIds,
    notificationReposWithAnnouncements,
    checked,
    repoWatchNotificationSeen,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $rootIds,
    $repos,
    $checked,
    $notificationSeen,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    const filters: Filter[] = []
    const sinceValues = $repos.map(repo =>
      getHistoryBoundedSince(getRepoWatchSeenAt(repo, $checked, $notificationSeen), $notificationHistorySince),
    )
    const since = sinceValues.length > 0 ? Math.min(...sinceValues) : $notificationHistorySince
    const limit = Math.max(REPO_WATCH_LOAD_LIMIT, $notificationHistoryFilterLimit)

    for (const rootChunk of chunkBySize($rootIds, REPO_ACTIVITY_FILTER_CHUNK_SIZE)) {
      filters.push(
        {kinds: [GIT_COMMENT], "#E": rootChunk, since, limit},
        {kinds: [GIT_COMMENT], "#e": rootChunk, since, limit},
        {kinds: [GIT_LABEL], "#e": rootChunk, since, limit},
        {kinds: statusKinds, "#e": rootChunk, since, limit},
        {kinds: [GIT_ISSUE, GIT_PULL_REQUEST], ids: rootChunk, limit},
      )
    }

    return filters
  },
)

const watchedRepoRootScopedEvents = deriveLoadedEvents<TrustedEvent>({
  filters: watchedRepoRootScopedFilters,
  relays: watchedRepoActivityRelays,
  label: "repo root activity",
})

const watchedRepoCommunityRefs = derived(knownRepoAnnouncementEvents, $events => {
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
  [watchedRepoActivityRelays, watchedRepoCommunityRefs],
  ([$repoRelays, $refs]) => normalizeRelays([...$repoRelays, ...Array.from($refs.values()).flat()]),
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

export const repoWatchNotificationCandidates = derived(
  [
    pubkey,
    notificationReposWithAnnouncements,
    watchedRepoActivityEvents,
    watchedRepoRootScopedEvents,
    watchedRepoCommunityDefinitions,
    watchedRepoCommunityProfileListEvents,
  ],
  ([
    $pubkey,
    $repos,
    $activityEvents,
    $rootScopedEvents,
    $communityDefinitions,
    $communityProfileListEvents,
  ]) => {
    const repos = $repos.map(repo => {
      const repoEvent = repo.repoEvent
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
  [
    pubkey,
    checked,
    repoWatchNotificationSeen,
    effectiveCommunityNotificationBaselines,
    repoWatchNotificationCandidates,
  ],
  ([
    $pubkey,
    $checked,
    $notificationSeen,
    $effectiveCommunityNotificationBaselines,
    $candidates,
  ]) => {
    const paths = new Set<string>()
    const mergedChecked = mergeCheckedState($checked, $notificationSeen)

    for (const candidate of $candidates) {
      if (
        hasNotificationForPath({
          path: candidate.path,
          latestEvent: candidate.latestEvent,
          currentPubkey: $pubkey || undefined,
          checked: mergedChecked,
          communityBaselines: $effectiveCommunityNotificationBaselines,
        })
      ) {
        paths.add(candidate.path)
      }
    }

    return paths
  },
)

export const setupRepoWatchNotifications = () => {
  let baselineKey = ""
  const unsubscribeBaseline = repoWatchSeenBaselineUpdates.subscribe(updates => {
    const key = JSON.stringify(updates)
    if (key === baselineKey) return
    baselineKey = key

    if (Object.keys(updates).length === 0) return

    updateRepoWatchNotificationSeen(updates).catch(error => {
      console.warn("[repo-watch-notifications] Failed to record notification baselines", error)
    })
  })

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
    unsubscribeBaseline()
    unsubscribe()
    setNotificationsConfig({})
  }
}
