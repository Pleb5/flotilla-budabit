import {derived, readable, type Readable} from "svelte/store"
import {getMutes, getPlaintext, pubkey, repository} from "@welshman/app"
import {load, request} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  getTagValue,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@nostr-git/core/events"
import {chatsById, type Chat} from "@app/core/state"
import {
  activeUserCommunityRefs,
  communityMemberProfileListEvents,
  communityMemberReportStates,
  communityModeratorProfileListEvents,
} from "@app/core/community-state"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import {
  TARGETED_PUBLICATION_KIND,
  normalizePubkey,
  parseTargetedPublication,
} from "@app/core/community"
import {
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
} from "@app/core/community-feeds"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThread} from "@app/core/community-threads"
import {
  COMMUNITY_CALENDAR_WRITE_TARGETS,
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityWriteTargetSectionName,
  getCommunityTargetWriterPubkeys,
  type CommunityWriteTarget,
} from "@app/core/community-permissions"
import {
  getCommunityCensorReason,
  isCommunityPersonBanned,
} from "@app/core/community-reports"
import {repoWatchNotificationSeen} from "@app/core/repo-watch"
import {
  checked,
  effectiveCommunityNotificationBaselines,
  getNotificationCheckedAt,
  hasNotificationForPath,
  normalizeChecked,
  notifications,
  type NotificationCandidate,
} from "@app/util/notifications"
import {repoWatchNotificationCandidates} from "@app/util/repo-watch-notifications"
import {
  notificationHistory,
  normalizeNotificationHistoryState,
  type NotificationHistoryState,
} from "@app/util/notification-center"
import {
  makeChatPath,
  makeCommunityCalendarPath,
  makeCommunityGoalPath,
  makeCommunityPath,
  makeCommunityRoomPath,
  makeCommunityThreadPath,
} from "@app/util/routes"
import {
  buildNotificationSearchText,
  getNotificationSourceLabel,
  sortNotificationRows,
  type NotificationRow,
  type NotificationRowSource,
} from "@app/util/notification-display"

export type BuildChatNotificationRowsOptions = {
  chats: Iterable<Chat>
  checked?: Record<string, number>
  currentPubkey?: string
  communityBaselines?: Record<string, number>
  history?: Partial<NotificationHistoryState>
  getPlaintext?: (event: TrustedEvent) => string | undefined
}

export type BuildRouteNotificationRowsOptions = {
  paths: Iterable<string>
  excludedPaths?: Set<string>
}

export type BuildCommunityNotificationRowsOptions = {
  refs: ActiveUserCommunityRef[]
  events: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  checked?: Record<string, number>
  currentPubkey?: string
  communityBaselines?: Record<string, number>
  reportStates?: UserCommunityReportStates
  history?: Partial<NotificationHistoryState>
  mutedPubkeys?: string[]
}

export type BuildRepoWatchNotificationRowsOptions = {
  candidates: NotificationCandidate[]
  checked?: Record<string, number>
  notificationSeen?: Record<string, number>
  currentPubkey?: string
  communityBaselines?: Record<string, number>
  history?: Partial<NotificationHistoryState>
}

const COMMUNITY_NOTIFICATION_LOAD_LIMIT = 200

const getEventPreview = (
  event: TrustedEvent,
  plaintext: string | undefined,
) => {
  if (plaintext?.trim()) return plaintext.trim()
  if (event.content) return "Encrypted direct message"

  return "Direct message"
}

const getReportState = (
  states: UserCommunityReportStates | undefined,
  communityPubkey: string,
) => (states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey])

const getEventTitle = (event: TrustedEvent) =>
  getTagValue("title", event.tags) || getTagValue("name", event.tags) || ""

const getTextPreview = (event: TrustedEvent, fallback: string) => {
  const title = getEventTitle(event).trim()
  if (title) return title

  const content = event.content.trim()
  if (!content) return fallback

  return content.length > 180 ? `${content.slice(0, 180).trim()}...` : content
}

const getTargetingEventTarget = (event: TrustedEvent): CommunityWriteTarget | undefined => {
  const targeting = parseTargetedPublication(event)
  if (!targeting) return undefined

  if (targeting.kind === EVENT_DATE) return COMMUNITY_WRITE_TARGETS.calendarDate
  if (targeting.kind === EVENT_TIME) return COMMUNITY_WRITE_TARGETS.calendar
  if (targeting.kind === ZAP_GOAL) return COMMUNITY_WRITE_TARGETS.goal
}

const getTargetingEventPath = (communityPubkey: string, event: TrustedEvent) => {
  const targeting = parseTargetedPublication(event)
  if (!targeting) return ""

  if (targeting.kind === EVENT_DATE || targeting.kind === EVENT_TIME) {
    return makeCommunityCalendarPath(communityPubkey)
  }

  if (targeting.kind === ZAP_GOAL) return makeCommunityGoalPath(communityPubkey)

  return ""
}

const getTargetingEventTitle = (event: TrustedEvent) => {
  const targeting = parseTargetedPublication(event)
  if (!targeting) return "Community update"

  if (targeting.kind === EVENT_DATE || targeting.kind === EVENT_TIME) return "New calendar event"
  if (targeting.kind === ZAP_GOAL) return "New goal"

  return "Community update"
}

const getMembershipProfileListAddress = (event: TrustedEvent) => {
  const d = getTagValue("d", event.tags)
  return d ? `${event.kind}:${event.pubkey}:${d}` : ""
}

const getMembershipCommunityRef = (
  event: TrustedEvent,
  refs: ActiveUserCommunityRef[],
  currentPubkey?: string,
) => {
  const address = getMembershipProfileListAddress(event)
  if (!address || !currentPubkey) return undefined
  if (!event.tags.some(tag => tag[0] === "p" && normalizePubkey(tag[1] || "") === currentPubkey)) {
    return undefined
  }

  return refs.find(ref =>
    ref.definition.sections.some(section =>
      section.profileLists.some(profileList => profileList.address === address),
    ),
  )
}

const getRowReadState = ({
  event,
  path,
  checked: checkedState = {},
  currentPubkey,
  communityBaselines = {},
  history,
}: {
  event: TrustedEvent
  path: string
  checked?: Record<string, number>
  currentPubkey?: string
  communityBaselines?: Record<string, number>
  history?: Partial<NotificationHistoryState>
}) => {
  const normalizedHistory = normalizeNotificationHistoryState(history)
  const pathUnread = hasNotificationForPath({
    checked: checkedState,
    path,
    latestEvent: event,
    currentPubkey,
    communityBaselines,
  })

  return Boolean(normalizedHistory.readAt[event.id]) || !pathUnread
}

const deriveLoadedNotificationEvents = ({
  filters,
  relays,
  label,
}: {
  filters: Readable<Filter[]>
  relays: Readable<string[]>
  label: string
}) =>
  readable<TrustedEvent[]>([], set => {
    let previousKey = ""
    let controller: AbortController | undefined
    let unsubscribeEvents: (() => void) | undefined

    const unsubscribe = derived([filters, relays], ([$filters, $relays]) => ({
      filters: $filters,
      relays: Array.from(new Set($relays.filter(Boolean))),
    })).subscribe(({filters, relays}) => {
      const key = `${JSON.stringify(filters)}::${relays.join("|")}`
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

      unsubscribeEvents = deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
      if (relays.length === 0) return

      const currentController = new AbortController()
      controller = currentController
      load({relays, filters, signal: currentController.signal}).catch(error => {
        if (!currentController.signal.aborted) {
          console.warn(`[notification-sources] Failed to load ${label}`, error)
        }
      })
      request({
        relays,
        signal: currentController.signal,
        filters: filters.map(filter => ({...filter, limit: 0})),
      }).catch(error => {
        if (!currentController.signal.aborted) {
          console.warn(`[notification-sources] Failed to subscribe to ${label}`, error)
        }
      })
    })

    return () => {
      controller?.abort()
      unsubscribeEvents?.()
      unsubscribe()
    }
  })

export const buildChatNotificationRows = ({
  chats,
  checked: checkedState = {},
  currentPubkey,
  communityBaselines = {},
  history,
  getPlaintext: getPlaintextForEvent = () => undefined,
}: BuildChatNotificationRowsOptions): NotificationRow[] => {
  const normalizedHistory = normalizeNotificationHistoryState(history)
  const rows: NotificationRow[] = []

  for (const chat of chats) {
    const event = chat.latestIncomingMessage
    if (!event) continue

    const path = makeChatPath(chat.id)
    const checkedAt = getNotificationCheckedAt({
      checked: checkedState,
      path,
      currentPubkey,
      communityBaselines,
    })
    const pathUnread = hasNotificationForPath({
      checked: checkedState,
      path,
      latestEvent: event,
      currentPubkey,
      communityBaselines,
    })
    const historyRead = Boolean(normalizedHistory.readAt[event.id])
    const read = historyRead || !pathUnread
    const preview = getEventPreview(event, getPlaintextForEvent(event))

    rows.push({
      id: `event:${event.id}`,
      eventId: event.id,
      actorPubkey: event.pubkey,
      source: "chat",
      sourceLabel: getNotificationSourceLabel("chat"),
      title: "Direct message",
      preview,
      path,
      readPath: path,
      createdAt: event.created_at,
      read,
      searchText: buildNotificationSearchText(
        "chat",
        "direct message",
        event.pubkey,
        chat.id,
        path,
        preview,
        checkedAt,
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const buildCommunityNotificationRows = ({
  refs,
  events,
  profileListEvents = [],
  checked: checkedState = {},
  currentPubkey,
  communityBaselines = {},
  reportStates,
  history,
  mutedPubkeys = [],
}: BuildCommunityNotificationRowsOptions): NotificationRow[] => {
  const rowsById = new Map<string, NotificationRow>()
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))

  const addRow = ({
    ref,
    event,
    path,
    readPath = path,
    title,
    preview,
    target,
    sectionName,
  }: {
    ref: ActiveUserCommunityRef
    event: TrustedEvent
    path: string
    readPath?: string
    title: string
    preview: string
    target?: CommunityWriteTarget
    sectionName?: string
  }) => {
    if (!path) return
    if (normalizedCurrentPubkey && normalizePubkey(event.pubkey) === normalizedCurrentPubkey) return
    if (muted.has(normalizePubkey(event.pubkey))) return

    const reportState = getReportState(reportStates, ref.communityPubkey)
    if (isCommunityPersonBanned(reportState, event.pubkey)) return

    const resolvedSectionName =
      sectionName || (target ? getCommunityWriteTargetSectionName(ref.definition, target) : "")
    if (
      reportState &&
      getCommunityCensorReason({
        reportState,
        eventId: event.id,
        pubkey: event.pubkey,
        sectionName: resolvedSectionName,
      })
    ) {
      return
    }
    if (
      target &&
      !canWriteCommunityTarget({
        definition: ref.definition,
        profileListEvents,
        userPubkey: event.pubkey,
        target,
        reportState,
      })
    ) {
      return
    }

    const id = `event:${event.id}`
    const current = rowsById.get(id)
    if (current && current.createdAt >= event.created_at) return

    rowsById.set(id, {
      id,
      eventId: event.id,
      actorPubkey: event.pubkey,
      source: "community",
      sourceLabel: getNotificationSourceLabel("community"),
      title,
      preview,
      path,
      readPath,
      createdAt: event.created_at,
      read: getRowReadState({
        event,
        path: readPath,
        checked: checkedState,
        currentPubkey,
        communityBaselines,
        history,
      }),
      searchText: buildNotificationSearchText(
        "community",
        title,
        preview,
        event.pubkey,
        ref.communityPubkey,
        path,
      ),
    })
  }

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.communityPubkey)

    for (const event of events) {
      const message = readCommunityRoomMessage(event, ref.communityPubkey)
      if (message) {
        addRow({
          ref,
          event,
          path: makeCommunityRoomPath(ref.communityPubkey, message.roomRootId),
          title: "New room message",
          preview: getTextPreview(event, "Room message"),
          target: COMMUNITY_WRITE_TARGETS.roomMessage,
        })
        continue
      }

      const thread = readCommunityThread(event, ref.communityPubkey)
      if (thread) {
        addRow({
          ref,
          event,
          path: makeCommunityThreadPath(ref.communityPubkey, thread.id),
          readPath: makeCommunityThreadPath(ref.communityPubkey),
          title: "New thread",
          preview: thread.title || getTextPreview(event, "Thread"),
          target: COMMUNITY_WRITE_TARGETS.thread,
        })
        continue
      }

      if (event.kind === TARGETED_PUBLICATION_KIND) {
        const target = getTargetingEventTarget(event)
        const path = getTargetingEventPath(ref.communityPubkey, event)
        if (!target || !path) continue
        if (
          !parseTargetedPublication(event)?.communities.some(
            community => normalizePubkey(community.pubkey) === ref.communityPubkey,
          )
        ) {
          continue
        }

        addRow({
          ref,
          event,
          path,
          title: getTargetingEventTitle(event),
          preview: getTextPreview(event, getTargetingEventTitle(event)),
          target,
        })
      }
    }

    for (const event of profileListEvents) {
      if (getMembershipCommunityRef(event, [ref], normalizedCurrentPubkey) !== ref) continue
      if (reportState && isCommunityPersonBanned(reportState, event.pubkey)) continue

      addRow({
        ref,
        event,
        path: makeCommunityPath(ref.communityPubkey, "access"),
        title: "Community access update",
        preview: "Your community membership changed.",
        sectionName: "access",
      })
    }
  }

  return sortNotificationRows(Array.from(rowsById.values()))
}

const mergeRepoCheckedState = (
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

const getRepoEventTitle = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE) return "New issue"
  if (event.kind === GIT_PULL_REQUEST) return "New pull request"
  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "Pull request update"
  if (event.kind === GIT_COMMENT) return "New git comment"
  if (event.kind === GIT_LABEL) return "Git assignment"
  if (
    [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED].includes(event.kind)
  ) {
    return "Git status update"
  }

  return "Git activity"
}

const getRepoRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""

const getRepoRowPath = (sectionPath: string, event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) {
    return `${sectionPath}/${event.id}`
  }

  const rootId = getRepoRootId(event)
  if (!rootId) return sectionPath
  if (event.kind === GIT_COMMENT) return `${sectionPath}/${rootId}#comment-${event.id}`

  return `${sectionPath}/${rootId}`
}

export const buildRepoWatchNotificationRows = ({
  candidates,
  checked: checkedState = {},
  notificationSeen = {},
  currentPubkey,
  communityBaselines = {},
  history,
}: BuildRepoWatchNotificationRowsOptions): NotificationRow[] => {
  const mergedChecked = mergeRepoCheckedState(checkedState, notificationSeen)

  return sortNotificationRows(
    candidates.flatMap(candidate => {
      const event = candidate.latestEvent
      if (!event) return []

      const read = getRowReadState({
        event,
        path: candidate.path,
        checked: mergedChecked,
        currentPubkey,
        communityBaselines,
        history,
      })
      const title = getRepoEventTitle(event)
      const preview = getTextPreview(event, title)

      return [
        {
          id: `event:${event.id}`,
          eventId: event.id,
          actorPubkey: event.pubkey,
          source: "git",
          sourceLabel: getNotificationSourceLabel("git"),
          title,
          preview,
          path: getRepoRowPath(candidate.path, event),
          readPath: candidate.path,
          repoWatchSeenPath: candidate.path,
          createdAt: event.created_at,
          read,
          searchText: buildNotificationSearchText("git", title, preview, event.pubkey, candidate.path),
        } satisfies NotificationRow,
      ]
    }),
  )
}

export const getRouteNotificationSource = (path: string): NotificationRowSource => {
  if (path === "/chat" || path.startsWith("/chat/")) return "chat"
  if (path === "/git" || path.startsWith("/git/") || path.includes("/git")) return "git"
  if (path === "/c" || path.startsWith("/c/")) return "community"

  return "other"
}

export const getRouteNotificationTitle = (source: NotificationRowSource) => {
  switch (source) {
    case "chat":
      return "Unread chat activity"
    case "git":
      return "Unread git activity"
    case "community":
      return "Unread community activity"
    default:
      return "Unread activity"
  }
}

const getRouteNotificationPreview = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .join(" / ") || path

export const buildRouteNotificationRows = ({
  paths,
  excludedPaths = new Set<string>(),
}: BuildRouteNotificationRowsOptions): NotificationRow[] => {
  const rows: NotificationRow[] = []

  for (const path of Array.from(paths).sort()) {
    if (!path || excludedPaths.has(path)) continue

    const source = getRouteNotificationSource(path)
    const title = getRouteNotificationTitle(source)
    const preview = getRouteNotificationPreview(path)

    rows.push({
      id: `route:${path}`,
      source,
      sourceLabel: getNotificationSourceLabel(source),
      title,
      preview,
      path,
      readPath: path === "/chat" ? "/chat/*" : path,
      createdAt: 0,
      read: false,
      searchText: buildNotificationSearchText(source, title, preview, path),
    })
  }

  return sortNotificationRows(rows)
}

const globalCommunityNotificationFilters = derived(
  [
    activeUserCommunityRefs,
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    communityMemberReportStates,
  ],
  ([$refs, $memberProfileListEvents, $moderatorProfileListEvents, $reportStates]) => {
    const profileListEvents = [...$memberProfileListEvents, ...$moderatorProfileListEvents]
    const filters: Filter[] = []

    for (const ref of $refs) {
      const reportState = getReportState($reportStates, ref.communityPubkey)
      const roomAuthors = getCommunityTargetWriterPubkeys({
        definition: ref.definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        reportState,
      })
      const threadAuthors = getCommunityTargetWriterPubkeys({
        definition: ref.definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.thread,
        reportState,
      })
      const calendarAuthors = COMMUNITY_CALENDAR_WRITE_TARGETS.flatMap(target =>
        getCommunityTargetWriterPubkeys({
          definition: ref.definition,
          profileListEvents,
          target,
          reportState,
        }),
      )
      const goalAuthors = getCommunityTargetWriterPubkeys({
        definition: ref.definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.goal,
        reportState,
      })
      const targetAuthors = Array.from(new Set([...calendarAuthors, ...goalAuthors]))

      if (roomAuthors.length > 0) {
        filters.push(
          makeCommunityExclusiveFilter(ref.communityPubkey, [MESSAGE], {
            authors: roomAuthors,
            limit: COMMUNITY_NOTIFICATION_LOAD_LIMIT,
          }),
        )
      }
      if (threadAuthors.length > 0) {
        filters.push(
          makeCommunityExclusiveFilter(ref.communityPubkey, [THREAD], {
            authors: threadAuthors,
            limit: COMMUNITY_NOTIFICATION_LOAD_LIMIT,
          }),
        )
      }
      if (targetAuthors.length > 0) {
        filters.push(
          makeCommunityTargetingFilter(ref.communityPubkey, [EVENT_DATE, EVENT_TIME, ZAP_GOAL], {
            authors: targetAuthors,
            limit: COMMUNITY_NOTIFICATION_LOAD_LIMIT,
          }),
        )
      }
    }

    return filters
  },
)

const globalCommunityNotificationRelays = derived(activeUserCommunityRefs, $refs =>
  Array.from(
    new Set($refs.flatMap(ref => [...ref.relayHints, ...ref.definition.relays]).filter(Boolean)),
  ),
)

const globalCommunityNotificationEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityNotificationFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community notifications",
})

const globalCommunityProfileListEvents = derived(
  [communityMemberProfileListEvents, communityModeratorProfileListEvents],
  ([$memberProfileListEvents, $moderatorProfileListEvents]) =>
    Array.from(
      new Map(
        [...$memberProfileListEvents, ...$moderatorProfileListEvents].map(event => [event.id, event]),
      ).values(),
    ),
)

const globalCommunityNotificationRows = derived(
  [
    pubkey,
    activeUserCommunityRefs,
    globalCommunityNotificationEvents,
    globalCommunityProfileListEvents,
    checked,
    effectiveCommunityNotificationBaselines,
    communityMemberReportStates,
    notificationHistory,
  ],
  ([
    $pubkey,
    $activeUserCommunityRefs,
    $globalCommunityNotificationEvents,
    $globalCommunityProfileListEvents,
    $checked,
    $effectiveCommunityNotificationBaselines,
    $communityMemberReportStates,
    $notificationHistory,
  ]) =>
    buildCommunityNotificationRows({
      refs: $activeUserCommunityRefs,
      events: $globalCommunityNotificationEvents,
      profileListEvents: $globalCommunityProfileListEvents,
      checked: $checked,
      currentPubkey: $pubkey || undefined,
      communityBaselines: $effectiveCommunityNotificationBaselines,
      reportStates: $communityMemberReportStates,
      history: $notificationHistory,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    }),
)

const repoWatchNotificationRows = derived(
  [
    pubkey,
    repoWatchNotificationCandidates,
    checked,
    repoWatchNotificationSeen,
    effectiveCommunityNotificationBaselines,
    notificationHistory,
  ],
  ([
    $pubkey,
    $repoWatchNotificationCandidates,
    $checked,
    $repoWatchNotificationSeen,
    $effectiveCommunityNotificationBaselines,
    $notificationHistory,
  ]) =>
    buildRepoWatchNotificationRows({
      candidates: $repoWatchNotificationCandidates,
      checked: $checked,
      notificationSeen: $repoWatchNotificationSeen,
      currentPubkey: $pubkey || undefined,
      communityBaselines: $effectiveCommunityNotificationBaselines,
      history: $notificationHistory,
    }),
)

export const notificationCenterRows = derived(
  [
    pubkey,
    chatsById,
    checked,
    effectiveCommunityNotificationBaselines,
    notificationHistory,
    notifications,
    globalCommunityNotificationRows,
    repoWatchNotificationRows,
  ],
  ([
    $pubkey,
    $chatsById,
    $checked,
    $effectiveCommunityNotificationBaselines,
    $notificationHistory,
    $notifications,
    $globalCommunityNotificationRows,
    $repoWatchNotificationRows,
  ]) => {
    const chatRows = buildChatNotificationRows({
      chats: $chatsById.values(),
      checked: $checked,
      currentPubkey: $pubkey || undefined,
      communityBaselines: $effectiveCommunityNotificationBaselines,
      history: $notificationHistory,
      getPlaintext: getPlaintext,
    })
    const sourceRows = [
      ...chatRows,
      ...$globalCommunityNotificationRows,
      ...$repoWatchNotificationRows,
    ]
    const excludedPaths = new Set(sourceRows.flatMap(row => [row.path, row.readPath]))

    if (chatRows.length > 0) excludedPaths.add("/chat")

    return sortNotificationRows([
      ...sourceRows,
      ...buildRouteNotificationRows({paths: $notifications, excludedPaths}),
    ])
  },
)

export const unreadNotificationCenterRows = derived(notificationCenterRows, rows =>
  rows.filter(row => !row.read),
)

export const unreadNotificationCenterCount = derived(
  unreadNotificationCenterRows,
  rows => rows.length,
)

export const hasNotificationCenterUnread = derived(
  unreadNotificationCenterCount,
  count => count > 0,
)
