import {derived, get, readable, writable, type Readable} from "svelte/store"
import {deriveEventsAsc, deriveEventsById, synced, throttled} from "@welshman/store"
import {pubkey, repository} from "@welshman/app"
import {identity, now, prop} from "@welshman/lib"
import {Address, MESSAGE, THREAD, getTagValue, type Filter, type TrustedEvent} from "@welshman/util"
import {chatsById, userSettingsValues} from "@app/core/state"
import {
  activeExactCommunityDefinition,
  activeCommunityModeratorRequestStates,
  activeCommunityPermissionStatus,
  activeCommunityProfileListEvents,
  activeExactCommunityRelays,
  activeCommunityReportState,
  activeCommunityUserModeratorRequestStates,
  type CommunityPermissionStatus,
} from "@app/core/community-state"
import {
  normalizePubkey,
  parseCommunityDefinitionAddress,
  parseTargetedPublication,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import {
  makeCommunityContentFilterPlan,
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilterPlan,
  makeTargetedPublicationOriginalRelayHintPlans,
} from "@app/core/community-feeds"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThread} from "@app/core/community-threads"
import {
  COMMUNITY_CALENDAR_WRITE_TARGETS,
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityCalendarTargetWriterPubkeys,
  getCommunityTargetWriterPubkeys,
  type CommunityWriteTarget,
} from "@app/core/community-permissions"
import {isCommunityPersonBanned} from "@app/core/community-reports"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {loadBoundedCommunityHistory} from "@app/core/requests"
import {kv} from "@app/core/storage"
import {
  makeChatPath,
  makeExactCommunityCalendarPath,
  makeExactCommunityGoalPath,
  makeExactCommunityPath,
  makeExactCommunityRoomPath,
  makeExactCommunityThreadPath,
} from "@app/util/routes"

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

export const setChecked = (key: string) => checked.update(state => ({...state, [key]: now()}))

export const setCheckedAt = (key: string, timestamp: number) =>
  checked.update(state => ({...state, [key]: timestamp}))

export const setCheckedAtMany = (entries: Iterable<readonly [string, number]>) =>
  checked.update(state => {
    let next = state

    for (const [key, timestamp] of entries) {
      const normalizedTimestamp = normalizeChecked(timestamp)
      if (!key || normalizedTimestamp <= normalizeChecked(Number(next[key] || 0))) continue

      if (next === state) next = {...state}
      next[key] = normalizedTimestamp
    }

    return next
  })

export type NotificationCandidate = {
  path: string
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

export type SectionRootNotificationCandidateOptions = {
  events: TrustedEvent[]
  path: string
  currentPubkey?: string
  allowEvent?: (event: TrustedEvent) => boolean
}

export type TargetedPublicationRootNotificationCandidateOptions = {
  targetingEvents: TrustedEvent[]
  rootEvents: TrustedEvent[]
  communityAddress: string
  path: string
  kind?: number
  kinds?: readonly number[]
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

const persistedNotificationStateReady = readable(false, set => {
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
  currentPubkey,
  communityBaselines = {},
}: NotificationCheckedAtOptions) => {
  let checkedAt = 0

  for (const [entryPath, timestamp] of Object.entries(checkedState)) {
    if (entryPath.endsWith(":seen")) continue

    const isMatch =
      entryPath === "*" ||
      entryPath.startsWith(path) ||
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
  latestEvent,
  currentPubkey,
  checked: checkedState,
  communityBaselines,
}: HasNotificationForPathOptions) => {
  const viewer = normalizePubkey(currentPubkey || "")

  if (!latestEvent) return false
  if (viewer && normalizePubkey(latestEvent.pubkey) === viewer) return false

  return (
    getNotificationCheckedAt({
      checked: checkedState,
      path,
      currentPubkey,
      communityBaselines,
    }) < latestEvent.created_at
  )
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
  communityAddress: string,
  kinds: readonly number[],
) => {
  const targeting = parseTargetedPublication(event)

  return Boolean(
    targeting &&
    kinds.includes(targeting.kind) &&
    targeting.communities.some(community => community.address === communityAddress),
  )
}

const rootMatchesTargetingEvent = (
  root: TrustedEvent,
  targetingEvent: TrustedEvent,
  kinds: readonly number[],
) => {
  const targeting = parseTargetedPublication(targetingEvent)
  if (!targeting || !kinds.includes(targeting.kind) || root.kind !== targeting.kind) return false

  const source = targeting.source
  if (!source) {
    return (
      getTagValue("h", root.tags) === targeting.id &&
      normalizePubkey(root.pubkey) === normalizePubkey(targetingEvent.pubkey)
    )
  }
  if (source.type === "e") return root.id === source.value

  const [refKind, refPubkey, ...identifierParts] = source.value.split(":")
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
  communityAddress,
  path,
  kind,
  kinds,
  currentPubkey,
  allowPubkey = () => true,
}: TargetedPublicationRootNotificationCandidateOptions): NotificationCandidate[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const targetKinds = kinds || (kind === undefined ? [] : [kind])
  let latestEvent: TrustedEvent | undefined

  if (!communityAddress || !path || targetKinds.length === 0) return []

  for (const targetingEvent of targetingEvents) {
    if (!targetedPublicationMatchesCommunity(targetingEvent, communityAddress, targetKinds))
      continue
    if (
      normalizedCurrentPubkey &&
      normalizePubkey(targetingEvent.pubkey) === normalizedCurrentPubkey
    ) {
      continue
    }

    const root = rootEvents.find(event =>
      rootMatchesTargetingEvent(event, targetingEvent, targetKinds),
    )
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

const threadRootNotificationCandidates: Readable<NotificationCandidate[]> = derived(
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
      target: COMMUNITY_WRITE_TARGETS.thread,
      reportState: $activeCommunityReportState,
    })

    if (authorPubkeys.length === 0) {
      set([])
      return
    }

    const filters = [
      makeCommunityExclusiveFilter($activeCommunityDefinition.communityId, [THREAD], {
        authors: authorPubkeys,
      }),
    ]
    const events = deriveEventsAsc(deriveEventsById({repository, filters}))

    return events.subscribe($events => {
      set(
        getSectionRootNotificationCandidates({
          events: $events,
          path: makeExactCommunityThreadPath($activeCommunityDefinition.pointer),
          currentPubkey: $pubkey,
          allowEvent: event =>
            Boolean(readCommunityThread(event, $activeCommunityDefinition.communityId)) &&
            !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
        }),
      )
    })
  },
  [] as NotificationCandidate[],
)

const makeTargetedPublicationRootNotificationCandidates = ({
  target,
  targets = [target],
  aggregateCalendarWriters = false,
  makePath,
}: {
  target: CommunityWriteTarget
  targets?: readonly CommunityWriteTarget[]
  aggregateCalendarWriters?: boolean
  makePath: (community: CommunityPointer) => string
}): Readable<NotificationCandidate[]> =>
  derived(
    [
      pubkey,
      activeExactCommunityDefinition,
      activeCommunityPermissionStatus,
      activeCommunityProfileListEvents,
      activeExactCommunityRelays,
      activeCommunityReportState,
    ],
    (
      [
        $pubkey,
        $activeCommunityDefinition,
        $activeCommunityPermissionStatus,
        $activeCommunityProfileListEvents,
        $activeExactCommunityRelays,
        $activeCommunityReportState,
      ],
      set,
    ) => {
      if (!$pubkey || !$activeCommunityDefinition || $activeExactCommunityRelays.length === 0) {
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

      const targetKinds = Array.from(new Set(targets.map(target => target.kind)))
      const community = $activeCommunityDefinition.pointer
      const calendarWriterPubkeys = aggregateCalendarWriters
        ? getCommunityCalendarTargetWriterPubkeys({
            definition: $activeCommunityDefinition,
            profileListEvents: $activeCommunityProfileListEvents,
            reportState: $activeCommunityReportState,
          })
        : []
      const targetingFilterPlan = targets.reduce(
        (combined, currentTarget) => {
          const plan = makeCommunityContentFilterPlan(
            [makeCommunityTargetingFilter(community.communityId, [currentTarget.kind])],
            aggregateCalendarWriters
              ? calendarWriterPubkeys
              : getCommunityTargetWriterPubkeys({
                  definition: $activeCommunityDefinition,
                  profileListEvents: $activeCommunityProfileListEvents,
                  target: currentTarget,
                  reportState: $activeCommunityReportState,
                }),
          )
          combined.relayFilters.push(...plan.relayFilters)
          combined.localFilters.push(...plan.localFilters)
          return combined
        },
        {relayFilters: [], localFilters: []} as {
          relayFilters: Filter[]
          localFilters: Filter[]
        },
      )
      if (
        targetingFilterPlan.relayFilters.length === 0 ||
        targetingFilterPlan.localFilters.length === 0
      ) {
        set([])
        return
      }
      const targetingController = new AbortController()

      void loadBoundedCommunityHistory({
        relays: $activeExactCommunityRelays,
        relayFilters: targetingFilterPlan.relayFilters,
        localFilters: targetingFilterPlan.localFilters,
        priority: RELAY_REQUEST_PRIORITY.background,
        owner: `notifications-community-targets:${permissionKey}`,
        signal: targetingController.signal,
      }).catch(error => {
        if (!targetingController.signal.aborted) {
          console.warn("[notifications] Failed to load targeted publication notifications", error)
        }
      })

      const targetingEvents = deriveEventsAsc(
        deriveEventsById({
          repository,
          filters: targetingFilterPlan.localFilters,
        }),
      )
      let rootController: AbortController | undefined
      let unsubscribeRootEvents: (() => void) | undefined

      const unsubscribeTargetingEvents = targetingEvents.subscribe($targetingEvents => {
        rootController?.abort()
        rootController = undefined
        unsubscribeRootEvents?.()
        unsubscribeRootEvents = undefined

        const authorizedTargetingEvents = $targetingEvents.filter(event => {
          const targeting = parseTargetedPublication(event)
          return (
            targeting?.communities.some(target => target.address === community.address) &&
            targets.some(
              currentTarget =>
                currentTarget.kind === targeting.kind &&
                canWriteCommunityTarget({
                  definition: $activeCommunityDefinition,
                  profileListEvents: $activeCommunityProfileListEvents,
                  userPubkey: event.pubkey,
                  target: currentTarget,
                  reportState: $activeCommunityReportState,
                }),
            )
          )
        })
        const rootPlan = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents)
        if (rootPlan.localFilters.length === 0 || rootPlan.relayFilters.length === 0) {
          set([])
          return
        }

        const controller = new AbortController()
        rootController = controller
        const rootRelayPlans = [
          {
            relays: $activeExactCommunityRelays,
            relayFilters: rootPlan.relayFilters,
            localFilters: rootPlan.localFilters,
          },
          ...makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
        ].filter(plan => plan.relays.length > 0)
        void Promise.all(
          rootRelayPlans.map(plan =>
            loadBoundedCommunityHistory({
              ...plan,
              priority: RELAY_REQUEST_PRIORITY.background,
              owner: `notifications-community-originals:${permissionKey}`,
              signal: controller.signal,
            }),
          ),
        ).catch(error => {
          if (!controller.signal.aborted) {
            console.warn("[notifications] Failed to load targeted publication roots", error)
          }
        })

        const rootEvents = deriveEventsAsc(
          deriveEventsById({repository, filters: rootPlan.localFilters}),
        )
        unsubscribeRootEvents = rootEvents.subscribe($rootEvents => {
          set(
            getTargetedPublicationRootNotificationCandidates({
              targetingEvents: authorizedTargetingEvents,
              rootEvents: $rootEvents,
              communityAddress: community.address,
              path: makePath(community),
              kinds: targetKinds,
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
  target: COMMUNITY_WRITE_TARGETS.calendar,
  targets: COMMUNITY_CALENDAR_WRITE_TARGETS,
  aggregateCalendarWriters: true,
  makePath: makeExactCommunityCalendarPath,
})

const goalRootNotificationCandidates = makeTargetedPublicationRootNotificationCandidates({
  target: COMMUNITY_WRITE_TARGETS.goal,
  makePath: makeExactCommunityGoalPath,
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
    derived(
      [
        pubkey,
        checked,
        persistedNotificationStateReady,
        effectiveCommunityNotificationBaselines,
        chatsById,
        notificationsConfig,
        extraCandidates,
      ],
      identity,
    ),
  ),
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

    const hasNotification = (path: string, latestEvent: TrustedEvent | undefined) => {
      return hasNotificationForPath({
        path,
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
