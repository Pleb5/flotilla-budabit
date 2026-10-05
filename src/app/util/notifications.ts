import {derived, get, readable, writable, type Readable} from "svelte/store"
import {deriveEventsAsc, deriveEventsById, synced} from "@welshman/store"
import {pubkey, repository} from "@welshman/app"
import {now, prop} from "@welshman/lib"
import {Address, MESSAGE, type TrustedEvent} from "@welshman/util"
import {chatsById, userSettingsValues} from "@app/core/state"
import {
  activeExactCommunityDefinition,
  activeCommunityModeratorRequestStates,
  activeCommunityPermissionStatus,
  activeCommunityProfileListEvents,
  activeCommunityReportState,
  activeCommunityUserModeratorRequestStates,
  type CommunityPermissionStatus,
} from "@app/core/community-state"
import {
  normalizePubkey,
  parseCommunityDefinitionAddress,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import {makeCommunityExclusiveFilter} from "@app/core/community-feeds"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {
  COMMUNITY_WRITE_TARGETS,
  getCommunityTargetWriterPubkeys,
} from "@app/core/community-permissions"
import {isCommunityPersonBanned} from "@app/core/community-reports"
import {kv} from "@app/core/storage"
import {makeChatPath, makeExactCommunityPath, makeExactCommunityRoomPath} from "@app/util/routes"

export const checked = synced<Record<string, number>>({
  key: "checked",
  defaultValue: {},
  storage: kv,
})

export type CommunityNotificationBaselineState = {
  version: 2
  byCommunityAddress: Record<string, number>
}

export const communityNotificationBaselines = synced<CommunityNotificationBaselineState>({
  key: "communityNotificationBaselines",
  defaultValue: {version: 2, byCommunityAddress: {}},
  storage: kv,
})

export const deriveChecked = (key: string) => derived(checked, prop(key))

export const setChecked = (key: string, itemPaths: string[] = []) => {
  const timestamp = now()
  setCheckedAtMany([key, ...itemPaths].map(path => [path, timestamp] as const))
}

export const setCheckedAt = (key: string, timestamp: number) =>
  checked.update(state => ({...state, [key]: timestamp}))

export const setCheckedAtMany = (entries: Iterable<readonly [string, number]>) => {
  const state = get(checked)
  let next = state

  for (const [key, timestamp] of entries) {
    const normalizedTimestamp = normalizeChecked(timestamp)
    if (!key || normalizedTimestamp <= normalizeChecked(Number(next[key] || 0))) continue

    if (next === state) next = {...state}
    next[key] = normalizedTimestamp
  }

  // Object stores notify even when update returns the same reference. A no-op
  // acknowledgement must not feed back into the center's read projection.
  if (next !== state) checked.set(next)
}

export type NotificationCandidate = {
  path: string
  /** Root items share a section badge but are acknowledged individually. */
  readPath?: string
  latestEvent?: TrustedEvent
  repoRelayHints?: string[]
  retainInCenter?: boolean
}

export type RoomMessageNotificationCandidateOptions = {
  events: TrustedEvent[]
  community: CommunityPointer
  currentPubkey?: string
  allowPubkey?: (pubkey: string) => boolean
}

export type NotificationsConfig = {
  augmentPaths?: (paths: Set<string>) => Set<string> | void
}

const notificationCandidatesStore = writable<Readable<NotificationCandidate[]>>(
  readable<NotificationCandidate[]>([]),
)
const emptyNotificationCandidates = readable<NotificationCandidate[]>([])
let notificationCandidateGeneration = 0
const communityRootCandidates = writable<NotificationCandidate[]>([])
let communityRootCandidateGeneration = 0

export const notificationsConfig = writable<NotificationsConfig>({})

export const setNotificationCandidates = (store: Readable<NotificationCandidate[]>) =>
  notificationCandidatesStore.set(store)

export const setNotificationsConfig = (config: NotificationsConfig) =>
  notificationsConfig.set(config)

const extraCandidates = derived(notificationCandidatesStore, ($store, set) => {
  const unsubscribe = $store.subscribe(set)
  return () => unsubscribe()
}) as Readable<NotificationCandidate[]>

export const notificationCandidates = extraCandidates

export const normalizeChecked = (value: number) =>
  value > 10_000_000_000 ? Math.round(value / 1000) : value

export const mergeCommunityNotificationBaselines = (
  ...states: Record<string, number>[]
): Record<string, number> => {
  const merged: Record<string, number> = {}

  for (const state of states) {
    for (const [key, timestamp] of Object.entries(state)) {
      const normalized = normalizeChecked(Number(timestamp || 0))
      if (!key || normalized <= 0) continue

      merged[key] = Math.max(merged[key] || 0, normalized)
    }
  }

  return merged
}

export const effectiveCommunityNotificationBaselines = derived(
  communityNotificationBaselines,
  $communityNotificationBaselines =>
    $communityNotificationBaselines?.version === 2
      ? mergeCommunityNotificationBaselines($communityNotificationBaselines.byCommunityAddress)
      : {},
)

export const persistedNotificationStateReady = readable(false, set => {
  let active = true
  const markReady = () => {
    if (active) set(true)
  }

  Promise.all([checked.ready, communityNotificationBaselines.ready]).then(markReady, error => {
    console.warn("[notifications] Failed to hydrate notification state", error)
    markReady()
  })

  return () => {
    active = false
  }
})

type CommunityNotificationBaselineOptions = {
  viewerPubkey?: string
  community?: CommunityPointer
  timestamp?: number
}

type CommunityNotificationBaselineForPathOptions = {
  path: string
  currentPubkey?: string
  communityBaselines?: Record<string, number>
}

type NotificationCheckedAtOptions = CommunityNotificationBaselineForPathOptions & {
  checked?: Record<string, number>
  readPath?: string
}

type HasNotificationForPathOptions = NotificationCheckedAtOptions & {
  latestEvent?: TrustedEvent
}

export const getCommunityNotificationBaselineKey = (
  viewerPubkey: string | undefined,
  community: CommunityPointer | undefined,
) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const pointer = community ? parseCommunityDefinitionAddress(community.address) : undefined

  return viewer && pointer ? `${viewer}:${pointer.address}` : ""
}

export const ensureCommunityNotificationBaseline = ({
  viewerPubkey,
  community,
  timestamp = now(),
}: CommunityNotificationBaselineOptions) => {
  const key = getCommunityNotificationBaselineKey(viewerPubkey, community)
  const normalizedTimestamp = normalizeChecked(timestamp)
  if (!key || normalizedTimestamp <= 0) return false

  let added = false

  const addBaselineIfMissing = () => {
    communityNotificationBaselines.update(state => {
      const current = state?.version === 2 ? state.byCommunityAddress : {}
      if (normalizeChecked(Number(current[key] || 0)) > 0) return state

      added = true
      return {version: 2, byCommunityAddress: {...current, [key]: normalizedTimestamp}}
    })
  }

  addBaselineIfMissing()
  void communityNotificationBaselines.ready.then(addBaselineIfMissing, addBaselineIfMissing)

  return added
}

export const getCommunityNotificationBaselineForPath = ({
  path,
  currentPubkey,
  communityBaselines = {},
}: CommunityNotificationBaselineForPathOptions) => {
  const viewer = normalizePubkey(currentPubkey || "")
  if (!path || !viewer) return 0

  let checkedAt = 0

  for (const [key, timestamp] of Object.entries(communityBaselines)) {
    const baselineViewer = key.slice(0, 64)
    const communityAddress = key.slice(65)
    const community = parseCommunityDefinitionAddress(communityAddress)
    if (baselineViewer !== viewer || !community) continue

    const communityPath = makeExactCommunityPath(community)
    if (path === communityPath || path.startsWith(`${communityPath}/`)) {
      checkedAt = Math.max(checkedAt, normalizeChecked(timestamp))
    }
  }

  return checkedAt
}

export const getNotificationCheckedAt = ({
  checked: checkedState = {},
  path,
  readPath,
  currentPubkey,
  communityBaselines = {},
}: NotificationCheckedAtOptions) => {
  let checkedAt = 0

  for (const [entryPath, timestamp] of Object.entries(checkedState)) {
    if (entryPath.endsWith(":seen")) continue

    const isMatch =
      entryPath === "*" ||
      entryPath === path ||
      (readPath ? entryPath === readPath : entryPath.startsWith(`${path}/`)) ||
      (entryPath === "/chat/*" && path.startsWith("/chat/"))

    if (isMatch) checkedAt = Math.max(checkedAt, normalizeChecked(timestamp))
  }

  return (
    checkedAt ||
    getCommunityNotificationBaselineForPath({
      path,
      currentPubkey,
      communityBaselines,
    })
  )
}

export const hasNotificationForPath = ({
  path,
  readPath,
  latestEvent,
  currentPubkey,
  checked: checkedState,
  communityBaselines,
}: HasNotificationForPathOptions) => {
  const viewer = normalizePubkey(currentPubkey || "")

  if (!latestEvent) return false
  if (viewer && normalizePubkey(latestEvent.pubkey) === viewer) return false

  const options = {checked: checkedState, currentPubkey, communityBaselines}
  const checkedAt = getNotificationCheckedAt({...options, path, readPath})
  if (!readPath || checkedAt !== latestEvent.created_at) return checkedAt < latestEvent.created_at

  // Relay timestamps have only second precision. A section visit cannot prove
  // that an item arriving later in that same second was seen. Item-level reads
  // (including the items actually shown in a list) still acknowledge equality.
  return getNotificationCheckedAt({...options, path: readPath, readPath}) < latestEvent.created_at
}

const isNewerEvent = (event: TrustedEvent, current: TrustedEvent) =>
  event.created_at > current.created_at ||
  (event.created_at === current.created_at && event.id > current.id)

export const getRoomMessageNotificationCandidates = ({
  events,
  community,
  currentPubkey,
  allowPubkey = () => true,
}: RoomMessageNotificationCandidateOptions): NotificationCandidate[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const latestEventsByPath = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (normalizedCurrentPubkey && normalizePubkey(event.pubkey) === normalizedCurrentPubkey) {
      continue
    }
    if (!allowPubkey(event.pubkey)) continue

    const message = readCommunityRoomMessage(event, community.communityId)
    if (!message) continue

    const path = makeExactCommunityRoomPath(community, message.roomRootId)
    const current = latestEventsByPath.get(path)

    if (!current || isNewerEvent(event, current)) {
      latestEventsByPath.set(path, event)
    }
  }

  return Array.from(latestEventsByPath.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, latestEvent]) => ({path, latestEvent}))
}

export const getActiveCommunityNotificationPermissionKey = (
  definition: CommunityDefinition,
  currentPubkey: string,
  permissionStatus: CommunityPermissionStatus,
) => {
  const expectedKeyPrefix = `${normalizePubkey(currentPubkey)}:${definition.event.id}:`

  return permissionStatus.communityAddress === definition.pointer.address &&
    permissionStatus.key.startsWith(expectedKeyPrefix) &&
    !permissionStatus.loading &&
    permissionStatus.loaded &&
    permissionStatus.complete
    ? permissionStatus.key
    : ""
}

const moderatorRequestStatusCandidates: Readable<NotificationCandidate[]> = derived(
  [pubkey, activeCommunityUserModeratorRequestStates],
  ([$pubkey, $activeCommunityUserModeratorRequestStates]) => {
    if (!$pubkey) return []

    return $activeCommunityUserModeratorRequestStates
      .filter(request => request.requesterPubkey === $pubkey)
      .filter(request => request.status !== "pending")
      .filter(request => Boolean(request.statusEvent))
      .map(request => ({
        path: makeExactCommunityPath(request.community, "access"),
        latestEvent: request.statusEvent,
        retainInCenter: true,
      }))
  },
)

const moderatorRequestAdminCandidates: Readable<NotificationCandidate[]> = derived(
  [pubkey, activeExactCommunityDefinition, activeCommunityModeratorRequestStates],
  ([$pubkey, $activeCommunityDefinition, $activeCommunityModeratorRequestStates]) => {
    if (
      !$pubkey ||
      !$activeCommunityDefinition ||
      normalizePubkey($pubkey) !== $activeCommunityDefinition.ownerPubkey
    ) {
      return []
    }

    let latestEvent: TrustedEvent | undefined

    for (const request of $activeCommunityModeratorRequestStates) {
      if (request.status !== "pending") continue

      const event = request.profileList.event
      if (!latestEvent || isNewerEvent(event, latestEvent)) latestEvent = event
    }

    return latestEvent
      ? [
          {
            path: makeExactCommunityPath($activeCommunityDefinition.pointer, "admin"),
            latestEvent,
            retainInCenter: true,
          },
        ]
      : []
  },
)

const roomMessageNotificationCandidates: Readable<NotificationCandidate[]> = derived(
  [
    pubkey,
    activeExactCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
  ],
  (
    [
      $pubkey,
      $activeCommunityDefinition,
      $activeCommunityPermissionStatus,
      $activeCommunityProfileListEvents,
      $activeCommunityReportState,
    ],
    set,
  ) => {
    if (!$pubkey || !$activeCommunityDefinition) {
      set([])
      return
    }

    const permissionKey = getActiveCommunityNotificationPermissionKey(
      $activeCommunityDefinition,
      $pubkey,
      $activeCommunityPermissionStatus,
    )
    if (!permissionKey) {
      set([])
      return
    }

    const authorPubkeys = getCommunityTargetWriterPubkeys({
      definition: $activeCommunityDefinition,
      profileListEvents: $activeCommunityProfileListEvents,
      target: COMMUNITY_WRITE_TARGETS.roomMessage,
      reportState: $activeCommunityReportState,
    })

    if (authorPubkeys.length === 0) {
      set([])
      return
    }

    const filters = [
      makeCommunityExclusiveFilter($activeCommunityDefinition.communityId, [MESSAGE], {
        authors: authorPubkeys,
      }),
    ]
    const events = deriveEventsAsc(deriveEventsById({repository, filters}))

    return events.subscribe($events => {
      set(
        getRoomMessageNotificationCandidates({
          events: $events,
          community: $activeCommunityDefinition.pointer,
          currentPubkey: $pubkey,
          allowPubkey: candidatePubkey =>
            !isCommunityPersonBanned($activeCommunityReportState, candidatePubkey),
        }),
      )
    })
  },
  [] as NotificationCandidate[],
)

const budabitNotificationCandidates: Readable<NotificationCandidate[]> = derived(
  [
    moderatorRequestStatusCandidates,
    moderatorRequestAdminCandidates,
    roomMessageNotificationCandidates,
    communityRootCandidates,
  ],
  ([
    $moderatorRequestStatusCandidates,
    $moderatorRequestAdminCandidates,
    $roomMessageNotificationCandidates,
    $communityRootCandidates,
  ]) => [
    ...$moderatorRequestStatusCandidates,
    ...$moderatorRequestAdminCandidates,
    ...$roomMessageNotificationCandidates,
    ...$communityRootCandidates,
  ],
)

export const notifications = derived(
  // Keep acknowledgement/account changes synchronous with the center. Throttling
  // this projection leaves stale paths that can briefly relight an already-read bell.
  [
    pubkey,
    checked,
    persistedNotificationStateReady,
    effectiveCommunityNotificationBaselines,
    chatsById,
    notificationsConfig,
    extraCandidates,
  ],
  ([
    $pubkey,
    $checked,
    $persistedNotificationStateReady,
    $effectiveCommunityNotificationBaselines,
    $chatsById,
    $notificationsConfig,
    $extraCandidates,
  ]) => {
    if (!$persistedNotificationStateReady) return new Set<string>()

    const hasNotification = (
      path: string,
      latestEvent: TrustedEvent | undefined,
      readPath?: string,
    ) => {
      return hasNotificationForPath({
        path,
        readPath,
        latestEvent,
        currentPubkey: $pubkey,
        checked: $checked,
        communityBaselines: $effectiveCommunityNotificationBaselines,
      })
    }

    const paths = new Set<string>()

    for (const {id, latestIncomingMessage} of $chatsById.values()) {
      const chatPath = makeChatPath(id)

      if (hasNotification(chatPath, latestIncomingMessage)) {
        paths.add("/chat")
        paths.add(chatPath)
      }
    }

    for (const candidate of $extraCandidates || []) {
      if (hasNotification(candidate.path, candidate.latestEvent, candidate.readPath))
        paths.add(candidate.path)
    }

    if ($notificationsConfig.augmentPaths) {
      const augmented = $notificationsConfig.augmentPaths(paths)
      return augmented || paths
    }

    return paths
  },
)

export const badgeCount = derived(notifications, notifications => notifications.size)

export const handleBadgeCountChanges = async (count: number) => {
  if (get(userSettingsValues).show_notifications_badge) {
    try {
      if ("setAppBadge" in navigator) {
        await (
          navigator as Navigator & {setAppBadge: (count?: number) => Promise<void>}
        ).setAppBadge(count)
      }
    } catch {
      // failed to set badge
    }
  } else {
    await clearBadges()
  }
}

export const clearBadges = async () => {
  try {
    if ("clearAppBadge" in navigator) {
      await (navigator as Navigator & {clearAppBadge: () => Promise<void>}).clearAppBadge()
    }
  } catch {
    // pass
  }
}

export const setupBudabitNotifications = (
  candidates: Readable<NotificationCandidate[]> = budabitNotificationCandidates,
) => {
  const generation = ++notificationCandidateGeneration
  setNotificationsConfig({})
  setNotificationCandidates(candidates)

  return () => {
    if (generation !== notificationCandidateGeneration) return

    setNotificationCandidates(emptyNotificationCandidates)
    setNotificationsConfig({})
  }
}

// Root discovery is owned by the lazily started notification feed. Project the
// same admitted items into section badges without a second set of relay loads.
export const setupCommunityRootNotifications = (candidates: Readable<NotificationCandidate[]>) => {
  const generation = ++communityRootCandidateGeneration
  const unsubscribe = candidates.subscribe(value => {
    if (generation === communityRootCandidateGeneration) communityRootCandidates.set(value)
  })
  return () => {
    unsubscribe()
    if (generation === communityRootCandidateGeneration) communityRootCandidates.set([])
  }
}

type RepoNotificationKind = "issues" | "prs"

const repoNotificationKinds = new Set<RepoNotificationKind>(["issues", "prs"])

type RepoNotificationOptions = {
  relay?: string
  repoAddress?: string
  repoAddresses?: Iterable<string>
  kind?: RepoNotificationKind
}

const getRepoAddressSet = (options: RepoNotificationOptions) => {
  const repoAddresses = new Set<string>()

  if (options.repoAddress) {
    repoAddresses.add(options.repoAddress)
  }

  for (const repoAddress of options.repoAddresses || []) {
    if (repoAddress) repoAddresses.add(repoAddress)
  }

  return repoAddresses
}

export const getRepoNotificationPaths = (paths: Set<string>, options: RepoNotificationOptions) => {
  const {kind} = options
  const repoAddresses = getRepoAddressSet(options)
  if (repoAddresses.size === 0) return []

  const prefix = "/git/"
  const matches: string[] = []

  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const [naddr, section] = rest.split("/")
    if (!naddr || !section) continue
    if (!repoNotificationKinds.has(section as RepoNotificationKind)) continue
    if (kind && section !== kind) continue

    try {
      const address = Address.fromNaddr(decodeURIComponent(naddr)).toString()
      if (repoAddresses.has(address)) {
        matches.push(path)
      }
    } catch {
      continue
    }
  }

  return matches
}

export const hasRepoNotification = (paths: Set<string>, options: RepoNotificationOptions) =>
  getRepoNotificationPaths(paths, options).length > 0

export const setCheckedForRepoNotifications = (
  paths: Set<string>,
  options: RepoNotificationOptions,
  timestamp?: number,
) => {
  const matches = getRepoNotificationPaths(paths, options)
  for (const path of matches) {
    if (timestamp != null) {
      setCheckedAt(path, timestamp)
    } else {
      setChecked(path)
    }
  }
}
