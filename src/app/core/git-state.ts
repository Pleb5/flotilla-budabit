import {writable, derived, get, type Readable} from "svelte/store"
import {load} from "@welshman/net"
import {
  assembleIssueThread,
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  GIT_STATUS_APPLIED,
  GIT_REPO_ANNOUNCEMENT,
  GIT_ISSUE,
  parseRepoAnnouncementEvent,
  type RepoAnnouncementEvent,
  type IssueEvent,
  type PullRequestEvent,
  type StatusEvent,
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
import {extractRoleAssignments} from "@app/util/labels"
import {resolveIssueEdits, type EffectiveIssueEdits} from "@app/util/issue-edits"
import {graspServersStore, type Repo} from "@nostr-git/ui"
import {getScopedCommunityPublishRelays, type CommunityRelayRef} from "@app/core/community-relays"
import {logPublishRelaySummary} from "@app/core/diagnostics"
import {
  getPreferredGraspServerUrls,
  makeGraspServerListFilters,
} from "@app/core/grasp-server-events"

export const shouldReloadRepos = writable(false)

export const activeRepoClass = writable<Repo | undefined>(undefined)

export const REPO_KEY = Symbol("repo")

export const REPO_RELAYS_KEY = Symbol("repo-relays")

export const REPO_PROFILE_RELAYS_KEY = Symbol("repo-profile-relays")

export const REPO_CLONE_URLS_KEY = Symbol("repo-clone-urls")

export const STATUS_EVENTS_BY_ROOT_KEY = Symbol("status-events-by-root")

export const RESOLVED_STATUS_BY_ROOT_KEY = Symbol("resolved-status-by-root")

export const HIDDEN_ROOT_IDS_KEY = Symbol("hidden-root-ids")

export const PULL_REQUESTS_KEY = Symbol("pull-requests")

export const REPO_VERIFIED_MAINTAINERS_KEY = Symbol("repo-verified-maintainers")

export type VerifiedMaintainerForRepo = {
  repoName?: string
}

export type RepoVerifiedMaintainersContext = {
  maintainers: Readable<Set<string>>
  getProfileContext: () => VerifiedMaintainerForRepo
}

export const COMMENT_EVENTS_KEY = Symbol("comment-events")

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

const parseRepoAnnouncementSafe = (event: RepoAnnouncementEvent) => {
  try {
    return parseRepoAnnouncementEvent(event)
  } catch {
    return null
  }
}

export const getRepoMaintainers = (event?: RepoAnnouncementEvent | null) => {
  if (!event) return []

  const owner = normalizePubkey(event.pubkey || "")
  const declaredMaintainers = (parseRepoAnnouncementSafe(event)?.maintainers || [])
    .map(normalizePubkey)
    .filter(Boolean)

  return Array.from(new Set([owner, ...declaredMaintainers].filter(Boolean)))
}

export const getRepoDeclaredMaintainers = (event?: RepoAnnouncementEvent | null) => {
  if (!event) return []

  const owner = normalizePubkey(event.pubkey || "")
  const declaredMaintainers = (parseRepoAnnouncementSafe(event)?.maintainers || [])
    .map(normalizePubkey)
    .filter(pubkey => pubkey && pubkey !== owner)

  return Array.from(new Set(declaredMaintainers))
}

export const getStatusRootId = (status: Pick<StatusEvent, "tags">) =>
  status.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", status.tags) ||
  ""

export const groupStatusEventsByRoot = (events: StatusEvent[] | undefined | null) => {
  const byId = new Map<string, StatusEvent>()

  for (const event of events || []) {
    byId.set(event.id, event)
  }

  const byRoot = new Map<string, StatusEvent[]>()
  for (const event of byId.values()) {
    const rootId = getStatusRootId(event)
    if (!rootId) continue

    const statuses = byRoot.get(rootId) || []
    statuses.push(event)
    byRoot.set(rootId, statuses)
  }

  return byRoot
}

export const getVerifiedRepoMaintainers = ({
  repoEvent,
  pullRequests = [],
  statusEventsByRoot = new Map<string, StatusEvent[]>(),
}: {
  repoEvent?: RepoAnnouncementEvent | null
  pullRequests?: PullRequestEvent[]
  statusEventsByRoot?: ReadonlyMap<string, StatusEvent[]>
}) => {
  const owner = normalizePubkey(repoEvent?.pubkey || "")
  const declaredMaintainers = new Set(getRepoDeclaredMaintainers(repoEvent))
  const verified = new Set<string>()

  if (!owner || declaredMaintainers.size === 0) return verified

  for (const pullRequest of pullRequests || []) {
    const author = normalizePubkey(pullRequest.pubkey || "")
    if (!declaredMaintainers.has(author)) continue

    const ownerMerged = (statusEventsByRoot.get(pullRequest.id) || []).some(status => {
      return (
        status.kind === GIT_STATUS_APPLIED &&
        normalizePubkey(status.pubkey || "") === owner &&
        getStatusRootId(status) === pullRequest.id
      )
    })

    if (ownerMerged) verified.add(author)
  }

  return verified
}

const GIT_COVER_LETTER_KIND = 1624

const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls()
  } catch {
    return []
  }
}

const getExplicitGraspServerRelays = (viewerPubkey = get(pubkey)) => {
  const author = normalizePubkey(String(viewerPubkey || ""))
  if (!author) return [] as string[]

  const filters = makeGraspServerListFilters(author)
  const events = repository.query(filters, {shouldSort: false}) as TrustedEvent[]
  return getPreferredGraspServerUrls(events).map(safeNormalizeRelayUrl).filter(isRelayUrl) as string[]
}

export type RepoAnnouncementPublishRelaysParams = {
  repoRelays?: string[]
  repoEvent?: Pick<NostrEvent, "tags"> | null
  communityPubkeys?: string[]
  communityRefs?: CommunityRelayRef[]
  viewerPubkey?: string
  gitIndexerRelays?: string[]
  userOutboxRelays?: string[]
  userGraspRelays?: string[]
}

export const getRepoAnnouncementCommunityPubkeys = (event?: Pick<NostrEvent, "tags"> | null) =>
  Array.from(
    new Set(
      (event?.tags || [])
        .filter(tag => tag[0] === "h")
        .map(tag => normalizePubkey(tag[1] || ""))
        .filter(Boolean),
    ),
  )

export const getRepoAnnouncementPublishRelays = ({
  repoRelays = [],
  repoEvent,
  communityPubkeys = [],
  communityRefs,
  viewerPubkey = get(pubkey),
  gitIndexerRelays = GIT_RELAYS,
  userOutboxRelays,
  userGraspRelays,
}: RepoAnnouncementPublishRelaysParams = {}) => {
  const scopedCommunityRelays = getScopedCommunityPublishRelays(
    [...communityPubkeys, ...getRepoAnnouncementCommunityPubkeys(repoEvent)],
    communityRefs,
  )
  const outboxRelays = userOutboxRelays ?? getUserOutboxRelays()
  const graspRelays = userGraspRelays ?? getExplicitGraspServerRelays(viewerPubkey)
  const merged = [
    ...outboxRelays,
    ...gitIndexerRelays,
    ...graspRelays,
    ...repoRelays,
    ...scopedCommunityRelays,
  ]
  const relays = Array.from(
    new Set(merged.map(u => safeNormalizeRelayUrl(u)).filter(isRelayUrl)),
  ) as string[]

  logPublishRelaySummary({
    category: "repo-announcement",
    relays,
    baseRelays: [...outboxRelays, ...graspRelays],
    repoRelays,
    scopedCommunityRelays,
    indexerRelays: gitIndexerRelays,
  })

  return relays
}

export const getRepoAnnouncementRelays = (extra: string[] = [], viewerPubkey = get(pubkey)) =>
  getRepoAnnouncementPublishRelays({repoRelays: extra, viewerPubkey})

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
// - expose address lookups and repo maintainer helpers

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
  const [, pubkey, ...repoIdParts] = parts
  const repoId = repoIdParts.join(":")
  return loadRepoAnnouncementsForPubkeys([pubkey], repoId)
}

// ---------------------------------------------------------------------------
// NIP-34 / 22 / 32 convergence helpers

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
 * Author + repo maintainers are authoritative.
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
        repoAnnouncementsByAddress,
      ],
      ([$issueEvent, $labelEvents, $coverLetters, $repoEventsByAddress]) => {
        if (!$issueEvent || $issueEvent.kind !== GIT_ISSUE) return undefined

        const issueEvent = $issueEvent as unknown as IssueEvent
        const repoAddress = getTagValue("a", issueEvent.tags || [])
        const repoEvent = repoAddress ? $repoEventsByAddress.get(repoAddress) : undefined
        const maintainers = new Set(repoEvent ? getRepoMaintainers(repoEvent) : [])

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
