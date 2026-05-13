import {writable, derived, get} from "svelte/store"
import {load} from "@welshman/net"
import {
  groupByEuc,
  deriveMaintainers,
  assembleIssueThread,
  resolveIssueStatus,
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  DEFAULT_GRASP_SET_ID,
  GIT_REPO_ANNOUNCEMENT,
  GIT_ISSUE,
  GRASP_SET_KIND,
  parseGraspServersEvent,
  parseRepoAnnouncementEvent,
  type RepoGroup,
  type RepoAnnouncementEvent,
  type IssueEvent,
  type LabelEvent,
  type CoverLetterEvent,
} from "@nostr-git/core/events"
import {RepoCore} from "@nostr-git/core/git"
import {deriveEventsAsc, deriveEventsById, withGetter} from "@welshman/store"
import {repository, pubkey, userRelayList} from "@welshman/app"
import {deriveEvent, fromCsv} from "@app/core/state"
import {Router} from "@welshman/router"
import {
  isRelayUrl,
  normalizeRelayUrl,
  type TrustedEvent,
  getTagValue,
  getAddress,
} from "@welshman/util"
import {nip19, type NostrEvent} from "nostr-tools"
import {pushToMapKey, sortBy} from "@welshman/lib"
import {extractRoleAssignments} from "@app/util/labels"
import {resolveIssueEdits, type EffectiveIssueEdits} from "@app/util/issue-edits"
import {graspServersStore, type Repo} from "@nostr-git/ui"

export const shouldReloadRepos = writable(false)

export const activeRepoClass = writable<Repo | undefined>(undefined)

export const REPO_KEY = Symbol("repo")

export const REPO_RELAYS_KEY = Symbol("repo-relays")

export const REPO_CLONE_URLS_KEY = Symbol("repo-clone-urls")

export const STATUS_EVENTS_BY_ROOT_KEY = Symbol("status-events-by-root")

export const PULL_REQUESTS_KEY = Symbol("pull-requests")

export const REPO_FEED_ACTIVITY_KEY = Symbol("repo-feed-activity")

export const REPO_ACTIONS_KEY = Symbol("repo-actions")

export type RepoActions = {
  refreshRepo: () => void | Promise<void>
  forkRepo: () => void | Promise<void>
  bookmarkRepo: () => void | Promise<void>
  openWatchModal: () => void
  openRemoteFixModal: () => void
  readonly isRefreshing: boolean
  readonly isBookmarked: boolean
  readonly isTogglingBookmark: boolean
  readonly isWatching: boolean
}

export const REPO_SETTINGS_ACTIONS_KEY = Symbol("repo-settings-actions")

type RepoProfileSummary = {
  name?: string
  picture?: string
  nip05?: string
  display_name?: string
}

export type RepoSettingsActions = {
  publishRepoEvent: (event: NostrEvent) => Promise<void>
  onSaveComplete: (result: {
    renamed: boolean
    previousName: string
    nextName: string
    relays: string[]
  }) => Promise<void>
  openDeleteRepoModal: () => void
  getProfile: (pubkey: string) => Promise<RepoProfileSummary | null>
  searchProfiles: (query: string) => Promise<Array<RepoProfileSummary & {pubkey: string}>>
  searchRelays: (query: string) => Promise<string[]>
  readonly canEditAnnouncement: boolean
  readonly canDelete: boolean
}

export const GIT_RELAYS = fromCsv(import.meta.env.VITE_GIT_RELAYS)

const safeNormalizeRelayUrl = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}

const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)

const normalizePubkey = (value: string) => {
  if (!value) return ""
  if (isHexPubkey(value)) return value
  if (value.startsWith("npub")) {
    try {
      const decoded = nip19.decode(value)
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data
      }
    } catch {
      return ""
    }
  }
  return ""
}

const getRepoEuc = (event: RepoAnnouncementEvent) => {
  const tag = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
  return tag?.[1] || ""
}

export type MaintainerSetRepoValueSource = {
  value: string
  repoAddress: string
  maintainer: string
  root: boolean
}

export type RepoMaintainerSetProfile = {
  rootAddress: string
  rootMaintainer: string
  identifier: string
  maintainerSet: string[]
  pendingMaintainers: string[]
  repoAddresses: string[]
  cloneUrls: string[]
  relays: string[]
  cloneUrlSources: MaintainerSetRepoValueSource[]
  relaySources: MaintainerSetRepoValueSource[]
}

const parseRepoAnnouncementSafe = (event: RepoAnnouncementEvent) => {
  try {
    return parseRepoAnnouncementEvent(event)
  } catch {
    return null
  }
}

const getRepoMaintainers = (event: RepoAnnouncementEvent) =>
  (parseRepoAnnouncementSafe(event)?.maintainers || []).map(normalizePubkey).filter(Boolean)

const addUnique = <T>(values: T[], value: T) => {
  if (!values.includes(value)) values.push(value)
}

const addUniqueSource = (
  sources: MaintainerSetRepoValueSource[],
  seen: Set<string>,
  value: string,
  repoAddress: string,
  maintainer: string,
  root: boolean,
) => {
  const trimmed = String(value || "").trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  sources.push({value: trimmed, repoAddress, maintainer, root})
}

const GIT_COVER_LETTER_KIND = 1624

const getExplicitGraspServerRelays = (viewerPubkey = get(pubkey)) => {
  const author = normalizePubkey(String(viewerPubkey || ""))
  if (!author) return [] as string[]

  const filters = [{kinds: [GRASP_SET_KIND], authors: [author], "#d": [DEFAULT_GRASP_SET_ID]}]
  const events = repository.query(filters, {shouldSort: false}) as TrustedEvent[]
  const latest = sortBy(event => -event.created_at, events)[0]

  if (!latest) return [] as string[]

  try {
    return parseGraspServersEvent(latest as any)
      .map(safeNormalizeRelayUrl)
      .filter(isRelayUrl) as string[]
  } catch {
    return [] as string[]
  }
}

export const getRepoAnnouncementRelays = (extra: string[] = [], viewerPubkey = get(pubkey)) => {
  let userRelays: string[] = []
  try {
    userRelays = Router.get().FromUser().getUrls()
  } catch {
    userRelays = []
  }

  const explicitGraspRelays = getExplicitGraspServerRelays(viewerPubkey)
  const merged = [...userRelays, ...GIT_RELAYS, ...explicitGraspRelays, ...extra]
  return Array.from(
    new Set(merged.map(u => safeNormalizeRelayUrl(u)).filter(isRelayUrl)),
  ) as string[]
}

export const repoAnnouncementRelaysStore = derived(
  [pubkey, userRelayList, graspServersStore],
  ([viewerPubkey]) => getRepoAnnouncementRelays([], viewerPubkey),
)

export const getRepoScopedRelays = (
  repoEvent?: RepoAnnouncementEvent | null,
  relayHints: string[] = [],
) => {
  const hints = relayHints.map(u => safeNormalizeRelayUrl(u)).filter(isRelayUrl)

  if (!repoEvent) {
    return Array.from(new Set(hints)) as string[]
  }

  try {
    const parsed = parseRepoAnnouncementEvent(repoEvent)
    const relays = [...(parsed.relays || []), ...hints]
    return Array.from(
      new Set(relays.map(u => safeNormalizeRelayUrl(u)).filter(isRelayUrl)),
    ) as string[]
  } catch {
    return Array.from(new Set(hints)) as string[]
  }
}

// Repositories adapter (NIP-34 repo announcements)
// - derive announcements (30617)
// - group by r:euc using core's groupByEuc
// - expose lookups and maintainer derivation helpers

const repoAnnouncementsRaw = deriveEventsAsc(
  deriveEventsById({repository, filters: [{kinds: [30617]}]}),
)

export const repoAnnouncements = derived(repoAnnouncementsRaw, $events => {
  const isDeletedRepoAnnouncement = (event: {tags?: string[][]}) =>
    (event.tags || []).some(tag => tag[0] === "deleted")
  const latestByAddress = new Map<string, RepoAnnouncementEvent>()
  for (const event of ($events as RepoAnnouncementEvent[]) || []) {
    const address = getAddress(event)
    latestByAddress.set(address, event)
  }
  return Array.from(latestByAddress.values()).filter(event => !isDeletedRepoAnnouncement(event))
})

export const repoAnnouncementsByAddress = derived(repoAnnouncements, $events => {
  const map = new Map<string, RepoAnnouncementEvent>()
  for (const event of ($events as RepoAnnouncementEvent[]) || []) {
    try {
      const address = getAddress(event)
      map.set(address, event)
    } catch {
      continue
    }
  }
  return map
})

export const repoMaintainerSetProfilesByRepoAddress = derived(
  [repoAnnouncements, repoAnnouncementsByAddress],
  ([$events, $byAddress]) => {
    const profiles = new Map<string, RepoMaintainerSetProfile>()
    const eventsByRepoId = new Map<string, RepoAnnouncementEvent[]>()

    for (const event of $events as RepoAnnouncementEvent[]) {
      const repoId = getTagValue("d", event.tags) || ""
      if (!repoId) continue
      pushToMapKey(eventsByRepoId, repoId, event)
    }

    for (const rootEvent of $events as RepoAnnouncementEvent[]) {
      const identifier = getTagValue("d", rootEvent.tags) || ""
      if (!identifier) continue

      const rootMaintainer = normalizePubkey(rootEvent.pubkey)
      if (!rootMaintainer) continue

      const rootAddress = `${GIT_REPO_ANNOUNCEMENT}:${rootMaintainer}:${identifier}`
      const rootListedMaintainers = getRepoMaintainers(rootEvent)
      const rootListedSet = new Set(rootListedMaintainers)

      const maintainerSet: string[] = [rootMaintainer]
      const pendingMaintainers: string[] = []
      const rootListedEvents = new Map<string, RepoAnnouncementEvent>()

      for (const candidate of rootListedSet) {
        if (candidate === rootMaintainer) continue

        const candidateAddress = `${GIT_REPO_ANNOUNCEMENT}:${candidate}:${identifier}`
        const candidateEvent = $byAddress.get(candidateAddress)
        if (!candidateEvent) {
          addUnique(pendingMaintainers, candidate)
          continue
        }

        rootListedEvents.set(candidate, candidateEvent)

        if (getRepoMaintainers(candidateEvent).includes(rootMaintainer)) {
          addUnique(maintainerSet, candidate)
        } else {
          addUnique(pendingMaintainers, candidate)
        }
      }

      for (const event of rootListedEvents.values()) {
        for (const candidate of getRepoMaintainers(event)) {
          if (candidate === rootMaintainer) continue
          if (rootListedSet.has(candidate)) continue
          if (maintainerSet.includes(candidate)) continue
          addUnique(pendingMaintainers, candidate)
        }
      }

      const repoAddresses = maintainerSet.map(
        maintainer => `${GIT_REPO_ANNOUNCEMENT}:${maintainer}:${identifier}`,
      )
      const cloneUrlSources: MaintainerSetRepoValueSource[] = []
      const relaySources: MaintainerSetRepoValueSource[] = []
      const seenCloneUrls = new Set<string>()
      const seenRelays = new Set<string>()

      for (const maintainer of maintainerSet) {
        const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${maintainer}:${identifier}`
        const event = $byAddress.get(repoAddress)
        if (!event) continue

        const parsed = parseRepoAnnouncementSafe(event)
        if (!parsed) continue
        for (const cloneUrl of parsed.clone || []) {
          addUniqueSource(
            cloneUrlSources,
            seenCloneUrls,
            cloneUrl,
            repoAddress,
            maintainer,
            maintainer === rootMaintainer,
          )
        }
        for (const relay of parsed.relays || []) {
          const normalized = safeNormalizeRelayUrl(relay)
          if (isRelayUrl(normalized)) {
            addUniqueSource(
              relaySources,
              seenRelays,
              normalized,
              repoAddress,
              maintainer,
              maintainer === rootMaintainer,
            )
          }
        }
      }

      profiles.set(rootAddress, {
        rootAddress,
        rootMaintainer,
        identifier,
        maintainerSet,
        pendingMaintainers,
        repoAddresses,
        cloneUrls: cloneUrlSources.map(source => source.value),
        relays: relaySources.map(source => source.value),
        cloneUrlSources,
        relaySources,
      })
    }

    return profiles
  },
)

export const maintainerSetByRepoAddress = derived(
  repoMaintainerSetProfilesByRepoAddress,
  $profiles => {
    const map = new Map<string, Set<string>>()
    for (const [repoAddress, profile] of $profiles.entries()) {
      map.set(repoAddress, new Set(profile.maintainerSet))
    }
    return map
  },
)

export const pendingMaintainersByRepoAddress = derived(
  repoMaintainerSetProfilesByRepoAddress,
  $profiles => {
    const map = new Map<string, Set<string>>()
    for (const [repoAddress, profile] of $profiles.entries()) {
      map.set(repoAddress, new Set(profile.pendingMaintainers))
    }
    return map
  },
)

export const maintainerSetRepoAddressesByRepoAddress = derived(
  repoMaintainerSetProfilesByRepoAddress,
  $profiles => {
    const map = new Map<string, Set<string>>()
    for (const [repoAddress, profile] of $profiles.entries()) {
      map.set(repoAddress, new Set(profile.repoAddresses))
    }
    return map
  },
)

export const maintainerSetCloneUrlsByRepoAddress = derived(
  repoMaintainerSetProfilesByRepoAddress,
  $profiles => {
    const map = new Map<string, string[]>()
    for (const [repoAddress, profile] of $profiles.entries()) {
      map.set(repoAddress, profile.cloneUrls)
    }
    return map
  },
)

export const maintainerSetRelaysByRepoAddress = derived(
  repoMaintainerSetProfilesByRepoAddress,
  $profiles => {
    const map = new Map<string, string[]>()
    for (const [repoAddress, profile] of $profiles.entries()) {
      map.set(repoAddress, profile.relays)
    }
    return map
  },
)

export const getMaintainerSetRepoAddresses = (
  map: Map<string, Set<string>>,
  repoAddress: string,
) => {
  const addresses = new Set<string>()
  if (!repoAddress) return addresses

  addresses.add(repoAddress)

  const direct = map.get(repoAddress)
  if (direct) {
    direct.forEach(address => addresses.add(address))
  }

  for (const [ownerAddress, effectiveAddresses] of map.entries()) {
    if (ownerAddress === repoAddress || effectiveAddresses.has(repoAddress)) {
      addresses.add(ownerAddress)
      effectiveAddresses.forEach(address => addresses.add(address))
    }
  }

  return addresses
}

export const repoGroups = derived(repoAnnouncements, ($events): RepoGroup[] => {
  return groupByEuc($events as any)
})

// Map of euc -> count of repo announcement events (30617) in that group
export const repoCountsByEuc = derived(repoAnnouncements, $events => {
  const counts = new Map<string, number>()
  for (const ev of $events) {
    const t = (ev.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
    const euc = t ? t[1] : ""
    if (!euc) continue
    counts.set(euc, (counts.get(euc) || 0) + 1)
  }
  return counts
})

// Map groups by EUC for backward compatibility
// Note: With composite keys, multiple groups may share the same EUC (forks)
// This map returns the first group found for each EUC
export const repoGroupsByEuc = derived(repoGroups, $groups => {
  const map = new Map<string, RepoGroup>()
  for (const g of $groups) {
    // Only set if not already present (first wins)
    if (!map.has(g.euc)) map.set(g.euc, g)
  }
  return map
})

export const deriveRepoGroup = (euc: string) =>
  withGetter(derived(repoGroupsByEuc, $by => $by.get(euc)))

export const deriveMaintainersForEuc = (euc: string) =>
  withGetter(derived(deriveRepoGroup(euc), g => (g ? deriveMaintainers(g) : new Set<string>())))

export const loadRepoAnnouncements = (relays?: string[]) => {
  const targetRelays = (relays && relays.length > 0 ? relays : getRepoAnnouncementRelays())
    .map(u => safeNormalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  return load({
    relays: targetRelays,
    filters: [{kinds: [30617]}],
  })
}

export const loadRepoAnnouncementsForPubkeys = (
  pubkeys: string[],
  repoId: string,
  euc?: string,
) => {
  const normalized = Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))
  if (normalized.length === 0 || !repoId) return
  let outboxRelays: string[] = []
  try {
    outboxRelays = Router.get().FromPubkeys(normalized).getUrls()
  } catch {
    outboxRelays = []
  }
  const relays = Array.from(new Set([...GIT_RELAYS, ...outboxRelays]))
  const filters = [
    {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      authors: normalized,
      ...(euc ? {"#r": [euc]} : {"#d": [repoId]}),
    },
  ]
  return load({relays, filters})
}

export const loadRepoAnnouncementByAddress = (repoAddr: string) => {
  const parts = repoAddr.split(":")
  if (parts.length < 3) return
  const [, pubkey, repoId] = parts
  return loadRepoAnnouncementsForPubkeys([pubkey], repoId)
}

export const loadRepoMaintainerAnnouncements = (repoEvent: RepoAnnouncementEvent) => {
  const repoId = getTagValue("d", repoEvent.tags) || ""
  if (!repoId) return
  const owner = normalizePubkey(repoEvent.pubkey)
  let maintainers: string[] = []
  try {
    const parsed = parseRepoAnnouncementEvent(repoEvent)
    maintainers = (parsed.maintainers || []).map(normalizePubkey).filter(Boolean)
  } catch {
    maintainers = []
  }
  const pubkeys = Array.from(new Set([owner, ...maintainers].filter(Boolean)))
  const euc = getRepoEuc(repoEvent)
  loadRepoAnnouncementsForPubkeys(pubkeys, repoId, euc || undefined)

  if (!owner) return
  let relays: string[] = []
  try {
    relays = Router.get().FromPubkeys([owner]).getUrls()
  } catch {
    relays = []
  }
  return load({
    relays: Array.from(new Set([...GIT_RELAYS, ...relays])),
    filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], "#d": [repoId], "#maintainers": [owner]}] as any,
  })
}

// ---------------------------------------------------------------------------
// NIP-34 / 22 / 32 convergence helpers

/**
 * Derive merged ref heads for a repo group by euc, bounded by recognized maintainers.
 */
export const deriveRepoRefState = (euc: string) =>
  withGetter(
    derived(
      [
        deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [30618]}]})),
        deriveRepoGroup(euc),
      ],
      ([$states, $group]) => {
        const maintainers = $group ? deriveMaintainers($group) : new Set<string>()
        const ctx = {maintainers: Array.from(maintainers)}
        return RepoCore.mergeRepoStateByMaintainers(ctx as any, $states as unknown as any[])
      },
    ),
  )

/**
 * Derive role assignments for a given root id.
 */
export const deriveRoleAssignments = (rootId: string) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": [rootId]}]})),
      $events => extractRoleAssignments($events as any[], rootId),
    ),
  )

/**
 * Derive combined role assignments for a list of root ids.
 */
export const deriveAssignmentsFor = (rootIds: string[]) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": rootIds}]})),
      $events => {
        const assignmentsByRoot = new Map<
          string,
          {assignees: Set<string>; reviewers: Set<string>}
        >()

        // Initialize empty sets for each root ID
        for (const rootId of rootIds) {
          assignmentsByRoot.set(rootId, {
            assignees: new Set<string>(),
            reviewers: new Set<string>(),
          })
        }

        // Parse events and assign to appropriate root IDs
        for (const ev of $events) {
          if (!ev || ev.kind !== 1985 || !Array.isArray(ev.tags)) continue

          const hasRoleNs = ev.tags.some(
            (t: string[]) => t[0] === "L" && t[1] === "org.nostr.git.role",
          )
          if (!hasRoleNs) continue

          const rootTags = ev.tags.filter((t: string[]) => t[0] === "e")
          const roleTags = ev.tags.filter(
            (t: string[]) => t[0] === "l" && t[2] === "org.nostr.git.role",
          )
          const people = ev.tags.filter((t: string[]) => t[0] === "p").map((t: string[]) => t[1])

          for (const rootTag of rootTags) {
            const rootId = rootTag[1]
            if (!rootId || !assignmentsByRoot.has(rootId)) continue

            const assignment = assignmentsByRoot.get(rootId)!
            const hasAssignee = roleTags.some((t: string[]) => t[1] === "assignee")
            const hasReviewer = roleTags.some((t: string[]) => t[1] === "reviewer")

            if (hasAssignee) for (const p of people) assignment.assignees.add(p)
            if (hasReviewer) for (const p of people) assignment.reviewers.add(p)
          }
        }

        return assignmentsByRoot
      },
    ),
  )

/**
 * Assemble an issue thread (root + NIP-22 comments + statuses) for a given root id.
 */
export const deriveIssueThread = (rootId: string) =>
  withGetter(
    derived(
      [
        deriveEvent(rootId),
        deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1111], "#e": [rootId]}]})),
        deriveEventsAsc(
          deriveEventsById({
            repository,
            filters: [{kinds: [1630, 1631, 1632, 1633], "#e": [rootId]}],
          }),
        ),
      ],
      ([$root, $comments, $statuses]) =>
        $root
          ? assembleIssueThread({
              root: $root as unknown as any,
              comments: $comments as unknown as any[],
              statuses: $statuses as unknown as any[],
            })
          : undefined,
    ),
  )

/**
 * Resolve final status for an issue or PR root using precedence rules.
 */
export const deriveStatus = (rootId: string, rootAuthor: string, euc: string) =>
  withGetter(
    derived([deriveIssueThread(rootId), deriveRepoGroup(euc)], ([$thread, $group]) => {
      if (!$thread) return undefined
      const maintainers = $group ? deriveMaintainers($group) : new Set<string>()
      return resolveIssueStatus($thread as unknown as any, rootAuthor, maintainers)
    }),
  )

/**
 * Effective labels for an event id by combining self labels, external 1985 labels, and legacy #t.
 */
export const deriveEffectiveLabels = (eventId: string) =>
  withGetter(
    derived(
      [
        deriveEvent(eventId),
        deriveEventsAsc(
          deriveEventsById({repository, filters: [{kinds: [1985], "#e": [eventId]}]}),
        ),
      ],
      ([$evt, $external]) => {
        if (!$evt) return undefined
        const self = extractSelfLabels($evt as unknown as any)
        const external = extractLabelEvents($external as unknown as any[])
        const t = (($evt as any).tags || [])
          .filter((t: string[]) => t[0] === "t")
          .map((t: string[]) => t[1])
        return mergeEffectiveLabels({self, external, t})
      },
    ),
  )

/**
 * Resolve effective issue title/description/labels from root issue + 1985 labels + 1624 cover letters.
 * Author + maintainer-set members are authoritative.
 */
export const deriveEffectiveIssueEdits = (issueId: string) =>
  withGetter(
    derived(
      [
        deriveEvent(issueId),
        deriveEventsAsc(
          deriveEventsById({repository, filters: [{kinds: [1985], "#e": [issueId]}]}),
        ),
        deriveEventsAsc(
          deriveEventsById({
            repository,
            filters: [{kinds: [GIT_COVER_LETTER_KIND], "#e": [issueId]}],
          }),
        ),
        maintainerSetByRepoAddress,
      ],
      ([$issueEvent, $labelEvents, $coverLetters, $maintainersByRepoAddress]) => {
        if (!$issueEvent || $issueEvent.kind !== GIT_ISSUE) return undefined

        const issueEvent = $issueEvent as unknown as IssueEvent
        const repoAddress = getTagValue("a", issueEvent.tags || [])
        const maintainers =
          (repoAddress && $maintainersByRepoAddress.get(repoAddress)) || new Set<string>()

        return resolveIssueEdits({
          issueEvent,
          labelEvents: ($labelEvents || []) as unknown as LabelEvent[],
          coverLetters: ($coverLetters || []) as unknown as CoverLetterEvent[],
          maintainers,
        }) as EffectiveIssueEdits
      },
    ),
  )

/**
 * Load repo context using redundant subscriptions with client-side dedupe.
 */
export const loadRepoContext = (args: {
  addressA?: string
  rootId?: string
  euc?: string
  relays?: string[]
}) => {
  const {filters} = RepoCore.buildRepoSubscriptions({
    addressA: args.addressA,
    rootEventId: args.rootId,
    euc: args.euc,
  })
  const defaults = GIT_RELAYS
  const relays = (args.relays || defaults)
    .map((u: string) => normalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  return load({relays, filters})
}
