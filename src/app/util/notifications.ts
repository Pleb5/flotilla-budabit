import {derived, get, readable, writable, type Readable} from "svelte/store"
import {request} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById, synced, throttled} from "@welshman/store"
import {pubkey, repository} from "@welshman/app"
import {identity, now, prop} from "@welshman/lib"
import {
  Address,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  getTagValue,
  type TrustedEvent,
} from "@welshman/util"
import {chatsById, userSettingsValues} from "@app/core/state"
import {
  activeCommunityDefinition,
  activeCommunityModeratorRequestStates,
  activeCommunityProfileListEvents,
  activeCommunityRelays,
  activeCommunityReportState,
  activeCommunityUserModeratorRequestStates,
} from "@app/core/community-state"
import {
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_GOALS,
  COMMUNITY_SECTION_THREADS,
  normalizePubkey,
  parseTargetedPublication,
} from "@app/core/community"
import {
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "@app/core/community-feeds"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThread} from "@app/core/community-threads"
import {getCommunitySectionWriterPubkeys} from "@app/core/community-permissions"
import {isCommunityPersonBanned} from "@app/core/community-reports"
import {kv} from "@app/core/storage"
import {
  makeChatPath,
  makeCommunityCalendarPath,
  makeCommunityGoalPath,
  makeCommunityPath,
  makeCommunityRoomPath,
  makeCommunityThreadPath,
} from "@app/util/routes"

export const checked = synced<Record<string, number>>({
  key: "checked",
  defaultValue: {},
  storage: kv,
})

export const deriveChecked = (key: string) => derived(checked, prop(key))

export const setChecked = (key: string) => checked.update(state => ({...state, [key]: now()}))

export const setCheckedAt = (key: string, timestamp: number) =>
  checked.update(state => ({...state, [key]: timestamp}))

export type NotificationCandidate = {
  path: string
  latestEvent?: TrustedEvent
}

export type RoomMessageNotificationCandidateOptions = {
  events: TrustedEvent[]
  communityPubkey: string
  currentPubkey?: string
  allowPubkey?: (pubkey: string) => boolean
}

export type SectionRootNotificationCandidateOptions = {
  events: TrustedEvent[]
  path: string
  currentPubkey?: string
  allowEvent?: (event: TrustedEvent) => boolean
}

export type TargetedPublicationRootNotificationCandidateOptions = {
  targetingEvents: TrustedEvent[]
  rootEvents: TrustedEvent[]
  communityPubkey: string
  path: string
  kind: number
  currentPubkey?: string
  allowPubkey?: (pubkey: string) => boolean
}

export type NotificationsConfig = {
  augmentPaths?: (paths: Set<string>) => Set<string> | void
}

const notificationCandidatesStore = writable<Readable<NotificationCandidate[]>>(
  readable<NotificationCandidate[]>([]),
)

export const notificationsConfig = writable<NotificationsConfig>({})

export const setNotificationCandidates = (store: Readable<NotificationCandidate[]>) =>
  notificationCandidatesStore.set(store)

export const setNotificationsConfig = (config: NotificationsConfig) =>
  notificationsConfig.set(config)

const extraCandidates = derived(notificationCandidatesStore, ($store, set) => {
  const unsubscribe = $store.subscribe(set)
  return () => unsubscribe()
}) as Readable<NotificationCandidate[]>

export const normalizeChecked = (value: number) =>
  value > 10_000_000_000 ? Math.round(value / 1000) : value

const isNewerEvent = (event: TrustedEvent, current: TrustedEvent) =>
  event.created_at > current.created_at ||
  (event.created_at === current.created_at && event.id > current.id)

export const getRoomMessageNotificationCandidates = ({
  events,
  communityPubkey,
  currentPubkey,
  allowPubkey = () => true,
}: RoomMessageNotificationCandidateOptions): NotificationCandidate[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const latestEventsByPath = new Map<string, TrustedEvent>()

  if (!communityPubkey) return []

  for (const event of events) {
    if (normalizedCurrentPubkey && normalizePubkey(event.pubkey) === normalizedCurrentPubkey) {
      continue
    }
    if (!allowPubkey(event.pubkey)) continue

    const message = readCommunityRoomMessage(event, communityPubkey)
    if (!message) continue

    const path = makeCommunityRoomPath(communityPubkey, message.roomRootId)
    const current = latestEventsByPath.get(path)

    if (!current || isNewerEvent(event, current)) {
      latestEventsByPath.set(path, event)
    }
  }

  return Array.from(latestEventsByPath.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, latestEvent]) => ({path, latestEvent}))
}

export const getSectionRootNotificationCandidates = ({
  events,
  path,
  currentPubkey,
  allowEvent = () => true,
}: SectionRootNotificationCandidateOptions): NotificationCandidate[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  let latestEvent: TrustedEvent | undefined

  if (!path) return []

  for (const event of events) {
    if (normalizedCurrentPubkey && normalizePubkey(event.pubkey) === normalizedCurrentPubkey) {
      continue
    }
    if (!allowEvent(event)) continue

    if (!latestEvent || isNewerEvent(event, latestEvent)) {
      latestEvent = event
    }
  }

  return latestEvent ? [{path, latestEvent}] : []
}

const targetedPublicationMatchesCommunity = (
  event: TrustedEvent,
  communityPubkey: string,
  kind: number,
) => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const targeting = parseTargetedPublication(event)

  return Boolean(
    targeting?.kind === kind &&
    targeting.communities.some(
      community => normalizePubkey(community.pubkey) === normalizedCommunityPubkey,
    ),
  )
}

const rootMatchesTargetingEvent = (
  root: TrustedEvent,
  targetingEvent: TrustedEvent,
  kind: number,
) => {
  const targeting = parseTargetedPublication(targetingEvent)
  if (!targeting || targeting.kind !== kind || root.kind !== kind) return false

  const ref = targeting.ref
  if (!ref) return getTagValue("h", root.tags) === targeting.id
  if (ref.type === "e") return root.id === ref.value

  const [refKind, refPubkey, ...identifierParts] = ref.value.split(":")
  const identifier = identifierParts.join(":")

  return (
    Number.parseInt(refKind || "", 10) === root.kind &&
    normalizePubkey(refPubkey || "") === normalizePubkey(root.pubkey) &&
    getTagValue("d", root.tags) === identifier
  )
}

export const getTargetedPublicationRootNotificationCandidates = ({
  targetingEvents,
  rootEvents,
  communityPubkey,
  path,
  kind,
  currentPubkey,
  allowPubkey = () => true,
}: TargetedPublicationRootNotificationCandidateOptions): NotificationCandidate[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  let latestEvent: TrustedEvent | undefined

  if (!communityPubkey || !path) return []

  for (const targetingEvent of targetingEvents) {
    if (!targetedPublicationMatchesCommunity(targetingEvent, communityPubkey, kind)) continue
    if (
      normalizedCurrentPubkey &&
      normalizePubkey(targetingEvent.pubkey) === normalizedCurrentPubkey
    ) {
      continue
    }

    const root = rootEvents.find(event => rootMatchesTargetingEvent(event, targetingEvent, kind))
    if (!root) continue
    if (normalizedCurrentPubkey && normalizePubkey(root.pubkey) === normalizedCurrentPubkey)
      continue
    if (!allowPubkey(root.pubkey)) continue

    if (!latestEvent || isNewerEvent(targetingEvent, latestEvent)) {
      latestEvent = targetingEvent
    }
  }

  return latestEvent ? [{path, latestEvent}] : []
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
        path: makeCommunityPath(request.communityPubkey, "access"),
        latestEvent: request.statusEvent,
      }))
  },
)

const moderatorRequestAdminCandidates: Readable<NotificationCandidate[]> = derived(
  [pubkey, activeCommunityDefinition, activeCommunityModeratorRequestStates],
  ([$pubkey, $activeCommunityDefinition, $activeCommunityModeratorRequestStates]) => {
    if (
      !$pubkey ||
      !$activeCommunityDefinition ||
      normalizePubkey($pubkey) !== normalizePubkey($activeCommunityDefinition.pubkey)
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
            path: makeCommunityPath($activeCommunityDefinition.pubkey, "admin"),
            latestEvent,
          },
        ]
      : []
  },
)

const roomMessageNotificationCandidates: Readable<NotificationCandidate[]> = derived(
  [pubkey, activeCommunityDefinition, activeCommunityProfileListEvents, activeCommunityReportState],
  (
    [
      $pubkey,
      $activeCommunityDefinition,
      $activeCommunityProfileListEvents,
      $activeCommunityReportState,
    ],
    set,
  ) => {
    if (!$pubkey || !$activeCommunityDefinition) {
      set([])
      return
    }

    const authorPubkeys = getCommunitySectionWriterPubkeys({
      definition: $activeCommunityDefinition,
      profileListEvents: $activeCommunityProfileListEvents,
      sectionName: COMMUNITY_SECTION_GENERAL,
      reportState: $activeCommunityReportState,
    })

    if (authorPubkeys.length === 0) {
      set([])
      return
    }

    const filters = [
      makeCommunityExclusiveFilter($activeCommunityDefinition.pubkey, [MESSAGE], {
        authors: authorPubkeys,
      }),
    ]
    const events = deriveEventsAsc(deriveEventsById({repository, filters}))

    return events.subscribe($events => {
      set(
        getRoomMessageNotificationCandidates({
          events: $events,
          communityPubkey: $activeCommunityDefinition.pubkey,
          currentPubkey: $pubkey,
          allowPubkey: candidatePubkey =>
            !isCommunityPersonBanned($activeCommunityReportState, candidatePubkey),
        }),
      )
    })
  },
  [] as NotificationCandidate[],
)

const threadRootNotificationCandidates: Readable<NotificationCandidate[]> = derived(
  [pubkey, activeCommunityDefinition, activeCommunityProfileListEvents, activeCommunityReportState],
  (
    [
      $pubkey,
      $activeCommunityDefinition,
      $activeCommunityProfileListEvents,
      $activeCommunityReportState,
    ],
    set,
  ) => {
    if (!$pubkey || !$activeCommunityDefinition) {
      set([])
      return
    }

    const authorPubkeys = getCommunitySectionWriterPubkeys({
      definition: $activeCommunityDefinition,
      profileListEvents: $activeCommunityProfileListEvents,
      sectionName: COMMUNITY_SECTION_THREADS,
      reportState: $activeCommunityReportState,
    })

    if (authorPubkeys.length === 0) {
      set([])
      return
    }

    const filters = [
      makeCommunityExclusiveFilter($activeCommunityDefinition.pubkey, [THREAD], {
        authors: authorPubkeys,
      }),
    ]
    const events = deriveEventsAsc(deriveEventsById({repository, filters}))

    return events.subscribe($events => {
      set(
        getSectionRootNotificationCandidates({
          events: $events,
          path: makeCommunityThreadPath($activeCommunityDefinition.pubkey),
          currentPubkey: $pubkey,
          allowEvent: event =>
            Boolean(readCommunityThread(event, $activeCommunityDefinition.pubkey)) &&
            !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
        }),
      )
    })
  },
  [] as NotificationCandidate[],
)

const makeTargetedPublicationRootNotificationCandidates = ({
  kind,
  sectionName,
  makePath,
}: {
  kind: number
  sectionName: string
  makePath: (communityPubkey: string) => string
}): Readable<NotificationCandidate[]> =>
  derived(
    [
      pubkey,
      activeCommunityDefinition,
      activeCommunityProfileListEvents,
      activeCommunityRelays,
      activeCommunityReportState,
    ],
    (
      [
        $pubkey,
        $activeCommunityDefinition,
        $activeCommunityProfileListEvents,
        $activeCommunityRelays,
        $activeCommunityReportState,
      ],
      set,
    ) => {
      if (!$pubkey || !$activeCommunityDefinition || $activeCommunityRelays.length === 0) {
        set([])
        return
      }

      const authorPubkeys = getCommunitySectionWriterPubkeys({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        sectionName,
        reportState: $activeCommunityReportState,
      })

      if (authorPubkeys.length === 0) {
        set([])
        return
      }

      const targetingFilters = [
        makeCommunityTargetingFilter($activeCommunityDefinition.pubkey, [kind]),
      ]
      const targetingController = new AbortController()

      request({
        relays: $activeCommunityRelays,
        filters: targetingFilters,
        autoClose: true,
        signal: targetingController.signal,
      }).catch(error => {
        if (!targetingController.signal.aborted) {
          console.warn("[notifications] Failed to load targeted publication notifications", error)
        }
      })

      const targetingEvents = deriveEventsAsc(
        deriveEventsById({
          repository,
          filters: targetingFilters,
        }),
      )
      let rootController: AbortController | undefined
      let unsubscribeRootEvents: (() => void) | undefined

      const unsubscribeTargetingEvents = targetingEvents.subscribe($targetingEvents => {
        rootController?.abort()
        rootController = undefined
        unsubscribeRootEvents?.()
        unsubscribeRootEvents = undefined

        const rootFilters = makeTargetedPublicationOriginalFilters($targetingEvents, authorPubkeys)
        if (rootFilters.length === 0) {
          set([])
          return
        }

        const controller = new AbortController()
        rootController = controller
        request({
          relays: $activeCommunityRelays,
          filters: rootFilters,
          autoClose: true,
          signal: controller.signal,
        }).catch(error => {
          if (!controller.signal.aborted) {
            console.warn("[notifications] Failed to load targeted publication roots", error)
          }
        })

        const rootEvents = deriveEventsAsc(deriveEventsById({repository, filters: rootFilters}))
        unsubscribeRootEvents = rootEvents.subscribe($rootEvents => {
          set(
            getTargetedPublicationRootNotificationCandidates({
              targetingEvents: $targetingEvents,
              rootEvents: $rootEvents,
              communityPubkey: $activeCommunityDefinition.pubkey,
              path: makePath($activeCommunityDefinition.pubkey),
              kind,
              currentPubkey: $pubkey,
              allowPubkey: candidatePubkey =>
                !isCommunityPersonBanned($activeCommunityReportState, candidatePubkey),
            }),
          )
        })
      })

      return () => {
        targetingController.abort()
        rootController?.abort()
        unsubscribeTargetingEvents()
        unsubscribeRootEvents?.()
      }
    },
    [] as NotificationCandidate[],
  )

const calendarRootNotificationCandidates = makeTargetedPublicationRootNotificationCandidates({
  kind: EVENT_TIME,
  sectionName: COMMUNITY_SECTION_CALENDAR,
  makePath: makeCommunityCalendarPath,
})

const goalRootNotificationCandidates = makeTargetedPublicationRootNotificationCandidates({
  kind: ZAP_GOAL,
  sectionName: COMMUNITY_SECTION_GOALS,
  makePath: makeCommunityGoalPath,
})

const budabitNotificationCandidates: Readable<NotificationCandidate[]> = derived(
  [
    moderatorRequestStatusCandidates,
    moderatorRequestAdminCandidates,
    roomMessageNotificationCandidates,
    threadRootNotificationCandidates,
    calendarRootNotificationCandidates,
    goalRootNotificationCandidates,
  ],
  ([
    $moderatorRequestStatusCandidates,
    $moderatorRequestAdminCandidates,
    $roomMessageNotificationCandidates,
    $threadRootNotificationCandidates,
    $calendarRootNotificationCandidates,
    $goalRootNotificationCandidates,
  ]) => [
    ...$moderatorRequestStatusCandidates,
    ...$moderatorRequestAdminCandidates,
    ...$roomMessageNotificationCandidates,
    ...$threadRootNotificationCandidates,
    ...$calendarRootNotificationCandidates,
    ...$goalRootNotificationCandidates,
  ],
)

export const notifications = derived(
  throttled(
    1000,
    derived([pubkey, checked, chatsById, notificationsConfig, extraCandidates], identity),
  ),
  ([$pubkey, $checked, $chatsById, $notificationsConfig, $extraCandidates]) => {
    const hasNotification = (path: string, latestEvent: TrustedEvent | undefined) => {
      if (!latestEvent || latestEvent.pubkey === $pubkey) return false

      for (const [entryPath, ts] of Object.entries($checked)) {
        if (entryPath.endsWith(":seen")) continue
        const isMatch =
          entryPath === "*" ||
          entryPath.startsWith(path) ||
          (entryPath === "/chat/*" && path.startsWith("/chat/"))
        if (isMatch && normalizeChecked(ts) >= latestEvent.created_at) return false
      }

      return true
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
      if (hasNotification(candidate.path, candidate.latestEvent)) paths.add(candidate.path)
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

export const setupBudabitNotifications = () => {
  setNotificationsConfig({})
  setNotificationCandidates(budabitNotificationCandidates)

  return () => undefined
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
