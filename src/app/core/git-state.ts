import {writable, derived, get, type Readable} from "svelte/store"
import {load} from "@welshman/net"
import {
  assembleIssueThread,
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  GIT_REPO_ANNOUNCEMENT,
  GIT_ISSUE,
  parseRepoCommunityBinding,
  type RepoAnnouncementEvent,
  type IssueEvent,
  type LabelEvent,
  type CoverLetterEvent,
} from "@nostr-git/core/events"
import {RepoCore} from "@nostr-git/core/git"
import {deriveEventsAsc, deriveEventsById, withGetter} from "@welshman/store"
import {repository, pubkey, userRelayList} from "@welshman/app"
import {deriveEvent} from "@app/core/state"
import {GIT_RELAYS} from "@app/core/git-config"
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
import {
  graspServersStore,
  type ProfileSearchContext,
  type ProfileSearchUpdateSignal,
  type PublishRepoEvent,
  type Repo,
} from "@nostr-git/ui"
import {
  getScopedCommunityPublishRelays,
  type CommunityRelayRef,
  type CommunityRelayScope,
} from "@app/core/community-relays"
import {logPublishRelaySummary} from "@app/core/diagnostics"
import {
  getPreferredGraspServerUrls,
  makeGraspServerListFilters,
} from "@app/core/grasp-server-events"
import {getRepoMaintainers} from "@app/core/repo-authority"
import {getRepoActivityRelays} from "@nostr-git/core/utils"
import {normalizeRepoRelays} from "@app/core/repo-relays"
export {getRepoDeclaredMaintainers, getRepoMaintainers} from "@app/core/repo-authority"
export {
  getStatusRootId,
  getVerifiedRepoMaintainers,
  groupStatusEventsByRoot,
} from "@app/core/repo-maintainer-verification"

export const shouldReloadRepos = writable(false)

export const activeRepoClass = writable<Repo | undefined>(undefined)

export const disposeActiveRepo = (expected?: Repo) => {
  const repo = get(activeRepoClass)
  if (!repo || (expected && repo !== expected)) return false

  try {
    repo.dispose()
  } finally {
    activeRepoClass.set(undefined)
  }

  return true
}

export const REPO_KEY = Symbol("repo")

export const REPO_LIST_HYDRATION_READY_KEY = Symbol("repo-list-hydration-ready")

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

export const REPO_ROOT_HISTORY_KEY = Symbol("repo-root-history")

export type RepoAnnouncementStatus = "loading" | "complete" | "partial" | "failed" | "aborted"

export type RepoFailedRelayRequest = {
  key: string
  relay: string
  lane: string
  outcome: Exclude<import("@app/core/finite-relay-request").FiniteRelayOutcome, "eose" | "aborted">
  reason?: string
  queuedAt?: number
  startedAt?: number
  finishedAt?: number
  eventCount?: number
}

export type RepoRootHistoryContext = {
  subscribe: Readable<import("@app/core/repo-root-history").RepoRootHistorySnapshot>["subscribe"]
  announcementStatus: Readable<RepoAnnouncementStatus>
  cacheHydrationPending: Readable<boolean>
  cacheHydrationFailed: Readable<boolean>
  failedRelayRequests: Readable<RepoFailedRelayRequest[]>
  loadOlderRoots: () => Promise<void>
  retryAnnouncement: () => Promise<void>
  retryCacheHydration: () => Promise<void>
  retryRootHistory: () => Promise<void>
  retryFailedRelays: () => Promise<void>
  ensureRoot: (
    id: string,
    signal?: AbortSignal,
    retry?: boolean,
  ) => Promise<import("@app/core/repo-root-history").EnsureRepoRootResult>
}

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
  publishRepoEvent: PublishRepoEvent
  onSaveComplete: (result: {
    displayNameChanged: boolean
    identifier: string
    previousName: string
    nextName: string
    relays: string[]
  }) => Promise<void>
  disposePublishTransport: () => void
  openDeleteRepoModal: () => void
  getProfile: (pubkey: string) => Promise<RepoProfileSummary | null>
  searchProfiles: (
    query: string,
    context?: ProfileSearchContext,
  ) => Promise<Array<RepoProfileSummary & {pubkey: string}>>
  searchProfilesUpdateSignal: ProfileSearchUpdateSignal
  searchRelays: (query: string) => Promise<string[]>
  readonly canEditAnnouncement: boolean
  readonly canDelete: boolean
}

export {GIT_RELAYS}

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
  return getPreferredGraspServerUrls(events)
    .map(safeNormalizeRelayUrl)
    .filter(isRelayUrl) as string[]
}

export type RepoAnnouncementPublishRelaysParams = {
  repoRelays?: string[]
  repoEvent?: Pick<NostrEvent, "tags"> | null
  communityIds?: string[]
  communityRefs?: CommunityRelayRef[]
  viewerPubkey?: string
  gitIndexerRelays?: string[]
  userOutboxRelays?: string[]
  userGraspRelays?: string[]
}

export const getRepoAnnouncementCommunityIds = (event?: Pick<NostrEvent, "tags"> | null) =>
  Array.from(
    new Set(
      (event?.tags || [])
        .filter(tag => tag[0] === "h")
        .map(tag => normalizePubkey(tag[1] || ""))
        .filter(Boolean),
    ),
  )

export const getRepoAnnouncementCommunityScopes = (
  event?: Pick<NostrEvent, "tags"> | null,
): CommunityRelayScope[] => {
  if (!event) return []
  const binding = parseRepoCommunityBinding(event)

  return binding
    ? [{communityId: binding.communityId, communityAddress: binding.address}]
    : getRepoAnnouncementCommunityIds(event).map(communityId => ({communityId}))
}

export const getRepoAnnouncementPublishRelays = ({
  repoRelays = [],
  repoEvent,
  communityIds = [],
  communityRefs,
  viewerPubkey = get(pubkey),
  gitIndexerRelays = GIT_RELAYS,
  userOutboxRelays,
  userGraspRelays,
}: RepoAnnouncementPublishRelaysParams = {}) => {
  const eventScopes = getRepoAnnouncementCommunityScopes(repoEvent)
  const exactEventIds = new Set(
    eventScopes.filter(scope => scope.communityAddress).map(scope => scope.communityId),
  )
  const scopedCommunityRelays = getScopedCommunityPublishRelays(
    [
      ...eventScopes,
      ...communityIds
        .filter(communityId => !exactEventIds.has(normalizePubkey(communityId)))
        .map(communityId => ({communityId})),
    ],
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
  const relays = normalizeRepoRelays(merged)

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

export type RepoRelayCoordinate = {
  pubkey?: string
  identifier?: string
}

export const getRepoScopedRelays = (
  repoEvent?: RepoAnnouncementEvent | null,
  expected: RepoRelayCoordinate = {},
) => normalizeRepoRelays(getRepoActivityRelays(repoEvent, expected))

export type OwnedRepoStateLoadScope = {
  repoId: string
  relays: string[]
}

export type OwnedRepoStateLoadPlan = {
  relay: string
  repoIds: string[]
}

export const getOwnedRepoStateLoadScopes = (
  repoEvents: RepoAnnouncementEvent[],
  ownerPubkey: string,
): OwnedRepoStateLoadScope[] => {
  const owner = normalizePubkey(ownerPubkey)
  if (!owner) return []

  const scopes = new Map<string, OwnedRepoStateLoadScope>()
  for (const event of repoEvents || []) {
    const repoId = getTagValue("d", event.tags || []) || ""
    if (!repoId) continue

    const relays = getRepoActivityRelays(event, {pubkey: owner, identifier: repoId})
    if (relays.length === 0) continue
    scopes.set(repoId, {repoId, relays})
  }

  return Array.from(scopes.values()).sort((a, b) => a.repoId.localeCompare(b.repoId))
}

export const getOwnedRepoStateLoadPlans = (
  repoEvents: RepoAnnouncementEvent[],
  ownerPubkey: string,
): OwnedRepoStateLoadPlan[] => {
  const repoIdsByRelay = new Map<string, Set<string>>()

  for (const scope of getOwnedRepoStateLoadScopes(repoEvents, ownerPubkey)) {
    for (const relay of scope.relays) {
      const repoIds = repoIdsByRelay.get(relay) || new Set<string>()
      repoIds.add(scope.repoId)
      repoIdsByRelay.set(relay, repoIds)
    }
  }

  return Array.from(repoIdsByRelay, ([relay, repoIds]) => ({
    relay,
    repoIds: Array.from(repoIds).sort(),
  })).sort((a, b) => a.relay.localeCompare(b.relay))
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

export const loadRepoAnnouncements = (relays?: string[], signal?: AbortSignal) => {
  const targetRelays = (relays && relays.length > 0 ? relays : getRepoAnnouncementRelays())
    .map(u => safeNormalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  return load({
    relays: targetRelays,
    filters: [{kinds: [30617]}],
    signal,
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
export const deriveRoleAssignments = (rootId: string, authorizedPublishers?: Iterable<string>) => {
  const authority =
    authorizedPublishers === undefined ? undefined : new Set(Array.from(authorizedPublishers))

  return withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": [rootId]}]})),
      $events => extractRoleAssignments($events as any[], rootId, authority),
    ),
  )
}

/**
 * Derive combined role assignments for a list of root ids.
 */
export const getRoleAssignmentsByRoot = (
  events: any[],
  rootIds: string[],
  authorizedPublishersByRoot?: Map<string, Iterable<string>>,
) => {
  const assignmentsByRoot = new Map<string, {assignees: Set<string>; reviewers: Set<string>}>()

  for (const rootId of rootIds) {
    const authority = authorizedPublishersByRoot
      ? authorizedPublishersByRoot.get(rootId) || new Set<string>()
      : undefined
    assignmentsByRoot.set(rootId, extractRoleAssignments(events, rootId, authority))
  }

  return assignmentsByRoot
}

export const deriveAssignmentsFor = (
  rootIds: string[],
  authorizedPublishersByRoot?: Map<string, Iterable<string>>,
) => {
  const authority = authorizedPublishersByRoot
    ? new Map(
        Array.from(authorizedPublishersByRoot, ([rootId, publishers]) => [
          rootId,
          new Set(publishers),
        ]),
      )
    : undefined

  return withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({repository, filters: [{kinds: [1985], "#e": rootIds}]})),
      $events => getRoleAssignmentsByRoot($events as any[], rootIds, authority),
    ),
  )
}

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
  const relays = (args.relays || [])
    .map((u: string) => safeNormalizeRelayUrl(u))
    .filter(isRelayUrl) as string[]
  if (relays.length === 0) return Promise.resolve([] as TrustedEvent[])
  return load({relays, filters})
}
