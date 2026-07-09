import {derived, readable, type Readable} from "svelte/store"
import {getMutes, getPlaintext, getValidZap, pubkey, repository} from "@welshman/app"
import {load, request} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {
  COMMENT,
  MESSAGE,
  NOTE,
  REACTION,
  THREAD,
  ZAP_RESPONSE,
  fromMsats,
  getAddress,
  getCommentTags,
  getIdFilters,
  getPubkeyTagValues,
  getReplyTags,
  getTagValue,
  isReplaceable,
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
import {APP_RELAYS, chatsById, type Chat} from "@app/core/state"
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
import {normalizePubkey} from "@app/core/community"
import {makeCommunityExclusiveFilter} from "@app/core/community-feeds"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThreadReply} from "@app/core/community-threads"
import {
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
import {
  notifications,
  type NotificationCandidate,
} from "@app/util/notifications"
import {repoWatchNotificationCandidates} from "@app/util/repo-watch-notifications"
import {
  hasUnreadNotificationsState,
  notificationReadState,
} from "@app/util/notification-center"
import {
  notificationHistoryFilterLimit,
  notificationHistorySince,
} from "@app/util/notification-history"
import {
  makeChatPath,
  getCommunityEventPath,
  makeCommunityPath,
  makeCommunityRoomPath,
  makeCommunityThreadPath,
} from "@app/util/routes"
import {
  getAuthorRelayHints,
  getEventRelayHints,
  getUserRelayHints,
  makeEventShareEntity,
  normalizeRelayHints,
} from "@app/util/event-links"
import {
  buildNotificationSearchText,
  getNotificationSourceLabel,
  sortNotificationRows,
  type NotificationRow,
  type NotificationRowSource,
  type NotificationRowTarget,
  type NotificationRowType,
} from "@app/util/notification-display"
import {ROLE_NS} from "@app/util/labels"

export type BuildChatNotificationRowsOptions = {
  chats: Iterable<Chat>
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
  currentPubkey?: string
  reportStates?: UserCommunityReportStates
  mutedPubkeys?: string[]
  targetEvents?: TrustedEvent[]
}

export type BuildRepoWatchNotificationRowsOptions = {
  candidates: NotificationCandidate[]
}

export type BuildEngagementNotificationRowsOptions = {
  events: TrustedEvent[]
  targetEvents?: TrustedEvent[]
  currentPubkey?: string
  mutedPubkeys?: string[]
  validZapResponseIds?: Set<string>
}

const COMMUNITY_NOTIFICATION_LOAD_LIMIT = 200
const ENGAGEMENT_NOTIFICATION_LOAD_LIMIT = 200
const ENGAGEMENT_NOTIFICATION_KINDS = [NOTE, COMMENT, REACTION, ZAP_RESPONSE]
const GIT_STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED]

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

const makeEventDisplayTarget = ({
  label,
  event,
  path,
  actionLabel,
  fallback,
}: {
  label: string
  event?: TrustedEvent
  path?: string
  actionLabel?: string
  fallback?: string
}): NotificationRowTarget => ({
  label,
  preview: event ? getTextPreview(event, fallback || label) : fallback || label,
  path,
  eventId: event?.id,
  actionLabel,
})

const getCommunityEventLabel = (event: TrustedEvent | undefined) => {
  if (!event) return "Community context"
  if (event.kind === MESSAGE) return "Your room message"
  if (event.kind === COMMENT) return "Your comment"
  if (event.kind === THREAD) return "Your thread"

  return "Community context"
}

const getRepoContextLabel = (path: string, event: TrustedEvent) => {
  if (path.includes("/prs")) return event.kind === GIT_COMMENT ? "Pull request comment" : "Pull request"
  if (path.includes("/issues")) return event.kind === GIT_COMMENT ? "Issue comment" : "Issue"

  return "Repository"
}

const getRepoAction = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE) return "opened an issue"
  if (event.kind === GIT_PULL_REQUEST) return "opened a pull request"
  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "updated a pull request"
  if (event.kind === GIT_COMMENT) return "commented"
  if (event.kind === GIT_LABEL) return getRepoEventTitle(event) === "Git review request" ? "requested review" : "assigned you"
  if (GIT_STATUS_KINDS.includes(event.kind)) return "updated status"

  return "updated"
}

const uniqueStrings = (values: Iterable<string | undefined>) =>
  Array.from(new Set(Array.from(values).map(value => String(value || "").trim()).filter(Boolean)))

const mapEventsById = (events: TrustedEvent[]) =>
  new Map(events.map(event => [event.id, event]))

const getEventAddressRef = (event: TrustedEvent) => {
  if (!isReplaceable(event)) return ""

  try {
    return getAddress(event)
  } catch {
    return ""
  }
}

const getEventRefKeys = (event: TrustedEvent) => uniqueStrings([event.id, getEventAddressRef(event)])

const mapEventsByRef = (events: TrustedEvent[]) => {
  const eventsByRef = new Map<string, TrustedEvent>()

  for (const event of events) {
    for (const ref of getEventRefKeys(event)) eventsByRef.set(ref, event)
  }

  return eventsByRef
}

const getEventRefTags = (event: TrustedEvent, names: string[]) =>
  event.tags
    .filter(tag => names.includes(tag[0]))
    .map(tag => tag[1])
    .filter(Boolean)

const getReplyTargetRefs = (event: TrustedEvent) => {
  const {roots, replies} = event.kind === COMMENT ? getCommentTags(event.tags) : getReplyTags(event.tags)

  return uniqueStrings(
    [...replies, ...roots]
      .filter(tag => ["a", "e"].includes(tag[0].toLowerCase()))
      .map(tag => tag[1]),
  )
}

const getReactionTargetRefs = (event: TrustedEvent) => uniqueStrings(getEventRefTags(event, ["e", "a"]))

type ZapRequestLike = {
  pubkey?: string
  content?: string
  tags?: string[][]
}

const getZapRequest = (event: TrustedEvent): ZapRequestLike | undefined => {
  const description = getTagValue("description", event.tags)
  if (!description) return undefined

  try {
    const parsed = JSON.parse(description) as ZapRequestLike
    if (!parsed || typeof parsed !== "object") return undefined

    return {
      ...parsed,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter(tag => Array.isArray(tag) && tag.every(value => typeof value === "string"))
        : [],
    }
  } catch {
    return undefined
  }
}

const getZapRequestTags = (event: TrustedEvent) => getZapRequest(event)?.tags || []

const getZapTargetRefs = (event: TrustedEvent) =>
  uniqueStrings([
    ...getEventRefTags(event, ["e", "a"]),
    ...getZapRequestTags(event)
      .filter(tag => ["e", "a"].includes(tag[0]))
      .map(tag => tag[1]),
  ])

const getEngagementTargetRefs = (event: TrustedEvent) => {
  if (event.kind === REACTION) return getReactionTargetRefs(event)
  if (event.kind === ZAP_RESPONSE) return getZapTargetRefs(event)
  if (event.kind === NOTE || event.kind === COMMENT) return getReplyTargetRefs(event)

  return []
}

const getZapActorPubkey = (event: TrustedEvent) =>
  normalizePubkey(getZapRequest(event)?.pubkey || "") || event.pubkey

const getEngagementActorPubkey = (event: TrustedEvent) =>
  event.kind === ZAP_RESPONSE ? getZapActorPubkey(event) : event.pubkey

const getZapAmountMsats = (event: TrustedEvent) => {
  const amount = Number.parseInt(getTagValue("amount", getZapRequestTags(event)) || "", 10)

  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

const getZapComment = (event: TrustedEvent) => getZapRequest(event)?.content?.trim() || ""

const contentMentionsPubkey = (event: TrustedEvent, currentPubkey: string) => {
  const mentionTagIndexes = event.tags.flatMap((tag, index) =>
    tag[0] === "p" && normalizePubkey(tag[1] || "") === currentPubkey ? [index] : [],
  )

  return mentionTagIndexes.some(index => event.content.includes(`#[${index}]`))
}

const hasPubkeyMentionTag = (event: TrustedEvent, currentPubkey: string) =>
  getPubkeyTagValues(event.tags).some(pubkey => normalizePubkey(pubkey) === currentPubkey)

const getOwnedTarget = (
  refs: string[],
  eventsByRef: Map<string, TrustedEvent>,
  currentPubkey: string,
) =>
  refs
    .map(ref => eventsByRef.get(ref))
    .find(event => normalizePubkey(event?.pubkey || "") === currentPubkey)

const getEngagementEventPath = (event: TrustedEvent) =>
  getCommunityEventPath(event) || `/${makeEventShareEntity(event)}`

const getEngagementTargetLabel = (target: TrustedEvent | undefined) => {
  if (!target) return "your event"
  if (target.kind === NOTE) return "your note"
  if (target.kind === COMMENT) return "your comment"
  if (target.kind === THREAD) return "your thread"
  if (target.kind === MESSAGE) return "your message"

  return "your event"
}

const getReactionPreview = (events: TrustedEvent[], target: TrustedEvent) => {
  const reactions = uniqueStrings(events.map(event => event.content).filter(content => content && content !== "+"))
  const reactionLabel = reactions.length > 0 ? ` with ${reactions.slice(0, 3).join(" ")}` : ""
  const countLabel = events.length > 1 ? `${events.length} people reacted` : "Reacted"

  return `${countLabel}${reactionLabel} to ${getEngagementTargetLabel(target)}.`
}

const getZapPreview = (events: TrustedEvent[], target: TrustedEvent) => {
  const totalMsats = events.reduce((sum, event) => sum + getZapAmountMsats(event), 0)
  const amountLabel = totalMsats > 0 ? ` ${fromMsats(totalMsats)} sats` : ""
  const countLabel = events.length > 1 ? `${events.length} zaps sent` : "Zapped"
  const comment = events.map(getZapComment).find(Boolean)

  return `${countLabel}${amountLabel} to ${getEngagementTargetLabel(target)}${comment ? `: ${comment}` : "."}`
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
  getPlaintext: getPlaintextForEvent = () => undefined,
}: BuildChatNotificationRowsOptions): NotificationRow[] => {
  const rows: NotificationRow[] = []

  for (const chat of chats) {
    const event = chat.latestIncomingMessage
    if (!event) continue

    const path = makeChatPath(chat.id)
    const preview = getEventPreview(event, getPlaintextForEvent(event))

    rows.push({
      id: `event:${event.id}`,
      eventId: event.id,
      actorPubkey: event.pubkey,
      source: "chat",
      sourceLabel: getNotificationSourceLabel("chat"),
      type: "chat",
      title: "Direct message",
      preview,
      action: "messaged you",
      actionLabel: "Open chat",
      contextLabel: "Direct message",
      path,
      readPath: path,
      navigationEventId: event.id,
      detail: makeEventDisplayTarget({
        label: "Message",
        event,
        path,
        actionLabel: "Open chat",
        fallback: preview,
      }),
      createdAt: event.created_at,
      searchText: buildNotificationSearchText(
        "chat",
        "direct message",
        event.pubkey,
        chat.id,
        path,
        preview,
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const buildCommunityNotificationRows = ({
  refs,
  events,
  profileListEvents = [],
  currentPubkey,
  reportStates,
  mutedPubkeys = [],
  targetEvents = [],
}: BuildCommunityNotificationRowsOptions): NotificationRow[] => {
  const rowsById = new Map<string, NotificationRow>()
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const targetEventsById = mapEventsById([...events, ...targetEvents])

  const addRow = ({
    ref,
    event,
    path,
    readPath = path,
    title,
    preview,
    target,
    sectionName,
    displayType = "community",
    action = "updated",
    contextLabel,
    targetEvent,
    targetLabel,
    detailLabel,
    actionLabel,
  }: {
    ref: ActiveUserCommunityRef
    event: TrustedEvent
    path: string
    readPath?: string
    title: string
    preview: string
    target?: CommunityWriteTarget
    sectionName?: string
    displayType?: NotificationRowType
    action?: string
    contextLabel?: string
    targetEvent?: TrustedEvent
    targetLabel?: string
    detailLabel?: string
    actionLabel?: string
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
      type: displayType,
      title,
      preview,
      action,
      actionLabel: actionLabel || "Open community",
      contextLabel: contextLabel || resolvedSectionName || "Community activity",
      path,
      readPath,
      navigationEventId: event.id,
      target: targetEvent
        ? makeEventDisplayTarget({
            label: targetLabel || getCommunityEventLabel(targetEvent),
            event: targetEvent,
            path,
            actionLabel: "Open context",
          })
        : undefined,
      detail: makeEventDisplayTarget({
        label: detailLabel || title,
        event,
        path,
        actionLabel: actionLabel || "Open community",
        fallback: preview,
      }),
      createdAt: event.created_at,
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
        const parentMessage = targetEventsById.get(message.parentMessageId)
        const parentRoomMessage = parentMessage
          ? readCommunityRoomMessage(parentMessage, ref.communityPubkey, message.roomRootId)
          : undefined
        const isReplyToViewer =
          normalizedCurrentPubkey &&
          parentRoomMessage &&
          normalizePubkey(parentMessage?.pubkey || "") === normalizedCurrentPubkey
        if (!isReplyToViewer) continue

        addRow({
          ref,
          event,
          path: makeCommunityRoomPath(ref.communityPubkey, message.roomRootId),
          title: "New room reply",
          preview: getTextPreview(event, "Room message"),
          target: COMMUNITY_WRITE_TARGETS.roomMessage,
          displayType: "reply",
          action: "replied",
          contextLabel: "to your room message",
          targetEvent: parentMessage,
          detailLabel: "Reply",
          actionLabel: "Open room reply",
        })
        continue
      }

      const threadReply = readCommunityThreadReply(event, ref.communityPubkey)
      if (threadReply) {
        const parentReply = targetEventsById.get(threadReply.parentReplyId)
        const parentThreadReply = parentReply
          ? readCommunityThreadReply(parentReply, ref.communityPubkey, threadReply.threadId)
          : undefined
        if (
          !threadReply.parentReplyId ||
          !parentThreadReply ||
          !normalizedCurrentPubkey ||
          normalizePubkey(parentReply?.pubkey || "") !== normalizedCurrentPubkey
        ) {
          continue
        }

        addRow({
          ref,
          event,
          path: makeCommunityThreadPath(ref.communityPubkey, threadReply.threadId),
          readPath: makeCommunityThreadPath(ref.communityPubkey),
          title: "New thread comment reply",
          preview: getTextPreview(event, "Thread comment reply"),
          target: COMMUNITY_WRITE_TARGETS.comment,
          displayType: "reply",
          action: "replied",
          contextLabel: "to your comment",
          targetEvent: parentReply,
          detailLabel: "Reply",
          actionLabel: "Open thread reply",
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
        displayType: "community",
        action: "updated access for you",
        contextLabel: "Community access",
        detailLabel: "Access update",
        actionLabel: "Open access settings",
      })
    }
  }

  return sortNotificationRows(Array.from(rowsById.values()))
}

const getRepoEventTitle = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE) return "New issue"
  if (event.kind === GIT_PULL_REQUEST) return "New pull request"
  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "Pull request update"
  if (event.kind === GIT_COMMENT) return "New git comment"
  if (event.kind === GIT_LABEL) {
    const hasReviewLabel = event.tags.some(
      tag => tag[0] === "l" && tag[1] === "reviewer" && tag[2] === ROLE_NS && tag[3] !== "del",
    )

    return hasReviewLabel ? "Git review request" : "Git assignment"
  }
  if (GIT_STATUS_KINDS.includes(event.kind)) {
    return "Git status update"
  }

  return "Git activity"
}

const getRepoStatusRootId = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", event.tags) ||
  ""

const getRepoRootId = (event: TrustedEvent) => {
  if (GIT_STATUS_KINDS.includes(event.kind)) return getRepoStatusRootId(event)

  return getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""
}

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
}: BuildRepoWatchNotificationRowsOptions): NotificationRow[] => {
  return sortNotificationRows(
    candidates.flatMap(candidate => {
      const event = candidate.latestEvent
      if (!event) return []

      const title = getRepoEventTitle(event)
      const preview = getTextPreview(event, title)
      const path = getRepoRowPath(candidate.path, event)
      const contextLabel = getRepoContextLabel(candidate.path, event)

      return [
        {
          id: `event:${event.id}`,
          eventId: event.id,
          actorPubkey: event.pubkey,
          source: "git",
          sourceLabel: getNotificationSourceLabel("git"),
          type: "repo",
          title,
          preview,
          action: getRepoAction(event),
          actionLabel: "Open git item",
          contextLabel,
          path,
          readPath: candidate.path,
          repoWatchSeenPath: candidate.path,
          navigationEventId: event.id,
          target: makeEventDisplayTarget({
            label: contextLabel,
            event,
            path,
            actionLabel: "Open git item",
            fallback: preview,
          }),
          detail: makeEventDisplayTarget({
            label: title,
            event,
            path,
            actionLabel: "Open git item",
            fallback: preview,
          }),
          createdAt: event.created_at,
          searchText: buildNotificationSearchText("git", title, preview, event.pubkey, candidate.path),
        } satisfies NotificationRow,
      ]
    }),
  )
}

export const buildEngagementNotificationRows = ({
  events,
  targetEvents = [],
  currentPubkey,
  mutedPubkeys = [],
  validZapResponseIds,
}: BuildEngagementNotificationRowsOptions): NotificationRow[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!normalizedCurrentPubkey) return []

  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const targetEventsByRef = mapEventsByRef(targetEvents)
  const rows: NotificationRow[] = []
  const reactionGroups = new Map<string, {target: TrustedEvent; events: TrustedEvent[]}>()
  const zapGroups = new Map<string, {target: TrustedEvent; events: TrustedEvent[]}>()

  const addEventRow = ({
    event,
    title,
    preview,
    path = getEngagementEventPath(event),
    displayType,
    action,
    contextLabel,
    target,
    detailLabel,
    actionLabel,
  }: {
    event: TrustedEvent
    title: string
    preview: string
    path?: string
    displayType: NotificationRowType
    action: string
    contextLabel: string
    target?: TrustedEvent
    detailLabel?: string
    actionLabel?: string
  }) => {
    const targetPath = target ? getEngagementEventPath(target) : undefined

    rows.push({
      id: `event:${event.id}`,
      eventId: event.id,
      actorPubkey: getEngagementActorPubkey(event),
      source: "other",
      sourceLabel: "Engagement",
      type: displayType,
      title,
      preview,
      action,
      actionLabel: actionLabel || "Open event",
      contextLabel,
      path,
      readPath: path,
      navigationEventId: event.id,
      target: target
        ? makeEventDisplayTarget({
            label: getEngagementTargetLabel(target),
            event: target,
            path: targetPath,
            actionLabel: "Open context",
          })
        : undefined,
      detail: makeEventDisplayTarget({
        label: detailLabel || title,
        event,
        path,
        actionLabel: actionLabel || "Open event",
        fallback: preview,
      }),
      createdAt: event.created_at,
      searchText: buildNotificationSearchText(
        "engagement",
        title,
        preview,
        event.pubkey,
        getEngagementActorPubkey(event),
        path,
      ),
    })
  }

  const addGroupedEvent = (
    groups: Map<string, {target: TrustedEvent; events: TrustedEvent[]}>,
    keyPrefix: string,
    event: TrustedEvent,
    target: TrustedEvent,
  ) => {
    const key = `${keyPrefix}:${target.id}`
    const group = groups.get(key)

    if (group) group.events.push(event)
    else groups.set(key, {target, events: [event]})
  }

  for (const event of events) {
    if (!ENGAGEMENT_NOTIFICATION_KINDS.includes(event.kind)) continue

    const actorPubkey = normalizePubkey(getEngagementActorPubkey(event) || "")
    if (!actorPubkey || actorPubkey === normalizedCurrentPubkey || muted.has(actorPubkey)) continue

    if (event.kind === NOTE || event.kind === COMMENT) {
      const target = getOwnedTarget(getReplyTargetRefs(event), targetEventsByRef, normalizedCurrentPubkey)

      if (target) {
        addEventRow({
          event,
          title: "New reply",
          preview: getTextPreview(event, `Reply to ${getEngagementTargetLabel(target)}`),
          displayType: "reply",
          action: "replied",
          contextLabel: `to ${getEngagementTargetLabel(target)}`,
          target,
          detailLabel: "Reply",
          actionLabel: "Open reply",
        })
        continue
      }

      if (
        hasPubkeyMentionTag(event, normalizedCurrentPubkey) &&
        (getReplyTargetRefs(event).length === 0 || contentMentionsPubkey(event, normalizedCurrentPubkey))
      ) {
        addEventRow({
          event,
          title: "New mention",
          preview: getTextPreview(event, "Mentioned you"),
          displayType: "mention",
          action: "mentioned you",
          contextLabel: "in a note",
          detailLabel: "Mention",
          actionLabel: "Open mention",
        })
      }

      continue
    }

    if (event.kind === REACTION) {
      const target = getOwnedTarget(getReactionTargetRefs(event), targetEventsByRef, normalizedCurrentPubkey)
      if (target) addGroupedEvent(reactionGroups, "reaction", event, target)
      continue
    }

    if (event.kind === ZAP_RESPONSE) {
      if (validZapResponseIds && !validZapResponseIds.has(event.id)) continue

      const target = getOwnedTarget(getZapTargetRefs(event), targetEventsByRef, normalizedCurrentPubkey)
      if (target) addGroupedEvent(zapGroups, "zap", event, target)
    }
  }

  for (const [key, group] of reactionGroups) {
    const groupEvents = [...group.events].sort((a, b) => b.created_at - a.created_at)
    const [latestEvent] = groupEvents
    const path = getEngagementEventPath(group.target)
    const preview = getReactionPreview(groupEvents, group.target)

    rows.push({
      id: `engagement:${key}`,
      eventId: latestEvent.id,
      eventIds: groupEvents.map(event => event.id),
      actorPubkey: getEngagementActorPubkey(latestEvent),
      source: "other",
      sourceLabel: "Engagement",
      type: "reaction",
      title: groupEvents.length > 1 ? "New reactions" : "New reaction",
      preview,
      action: "reacted",
      actionLabel: "Open context",
      contextLabel: `to ${getEngagementTargetLabel(group.target)}`,
      path,
      readPath: path,
      navigationEventId: group.target.id,
      target: makeEventDisplayTarget({
        label: getEngagementTargetLabel(group.target),
        event: group.target,
        path,
        actionLabel: "Open context",
      }),
      detail: {
        label: groupEvents.length > 1 ? "Reactions" : "Reaction",
        preview,
        path,
        eventId: latestEvent.id,
        actionLabel: "Open context",
      },
      createdAt: latestEvent.created_at,
      searchText: buildNotificationSearchText(
        "engagement",
        "reaction",
        preview,
        path,
        group.target.id,
        ...groupEvents.flatMap(event => [event.pubkey, event.content]),
      ),
    })
  }

  for (const [key, group] of zapGroups) {
    const groupEvents = [...group.events].sort((a, b) => b.created_at - a.created_at)
    const [latestEvent] = groupEvents
    const path = getEngagementEventPath(group.target)
    const preview = getZapPreview(groupEvents, group.target)

    rows.push({
      id: `engagement:${key}`,
      eventId: latestEvent.id,
      eventIds: groupEvents.map(event => event.id),
      actorPubkey: getEngagementActorPubkey(latestEvent),
      source: "other",
      sourceLabel: "Engagement",
      type: "zap",
      title: groupEvents.length > 1 ? "New zaps" : "New zap",
      preview,
      action: "zapped",
      actionLabel: "Open context",
      contextLabel: `to ${getEngagementTargetLabel(group.target)}`,
      path,
      readPath: path,
      navigationEventId: group.target.id,
      target: makeEventDisplayTarget({
        label: getEngagementTargetLabel(group.target),
        event: group.target,
        path,
        actionLabel: "Open context",
      }),
      detail: {
        label: groupEvents.length > 1 ? "Zaps" : "Zap",
        preview,
        path,
        eventId: latestEvent.id,
        actionLabel: "Open context",
      },
      createdAt: latestEvent.created_at,
      searchText: buildNotificationSearchText(
        "engagement",
        "zap",
        preview,
        path,
        group.target.id,
        ...groupEvents.flatMap(event => [event.pubkey, getEngagementActorPubkey(event), getZapComment(event)]),
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const getRouteNotificationSource = (path: string): NotificationRowSource => {
  if (path === "/chat" || path.startsWith("/chat/")) return "chat"
  if (path === "/git" || path.startsWith("/git/")) return "git"
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
  `Open ${getNotificationSourceLabel(getRouteNotificationSource(path)).toLowerCase()} activity`

export const buildRouteNotificationRows = ({
  paths,
  excludedPaths = new Set<string>(),
}: BuildRouteNotificationRowsOptions): NotificationRow[] => {
  const rows: NotificationRow[] = []

  for (const path of Array.from(paths).sort()) {
    if (!path || excludedPaths.has(path)) continue

    const source = getRouteNotificationSource(path)
    if (source === "community") continue

    const title = getRouteNotificationTitle(source)
    const preview = getRouteNotificationPreview(path)

    rows.push({
      id: `route:${path}`,
      source,
      sourceLabel: getNotificationSourceLabel(source),
      type: "route",
      title,
      preview,
      action: "needs attention",
      actionLabel: "Open activity",
      contextLabel: getNotificationSourceLabel(source),
      path,
      readPath: path === "/chat" ? "/chat/*" : path,
      detail: {
        label: title,
        preview,
        path,
        actionLabel: "Open activity",
      },
      createdAt: 0,
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
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $refs,
    $memberProfileListEvents,
    $moderatorProfileListEvents,
    $reportStates,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
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
      const commentAuthors = getCommunityTargetWriterPubkeys({
        definition: ref.definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.comment,
        reportState,
      })

      if (roomAuthors.length > 0) {
        filters.push(
          makeCommunityExclusiveFilter(ref.communityPubkey, [MESSAGE], {
            authors: roomAuthors,
            since: $notificationHistorySince,
            limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
          }),
        )
      }
      if (commentAuthors.length > 0) {
        filters.push(
          makeCommunityExclusiveFilter(ref.communityPubkey, [COMMENT], {
            authors: commentAuthors,
            since: $notificationHistorySince,
            limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
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

const getCommunityNotificationTargetRefs = (event: TrustedEvent) => {
  const roomMessage = readCommunityRoomMessage(event)
  if (roomMessage?.parentMessageId) return [roomMessage.parentMessageId]

  const threadReply = readCommunityThreadReply(event)
  if (threadReply?.parentReplyId) return [threadReply.parentReplyId]

  return []
}

const globalCommunityNotificationTargetFilters = derived(
  [globalCommunityNotificationEvents, notificationHistoryFilterLimit],
  ([$events, $notificationHistoryFilterLimit]) =>
    getIdFilters(uniqueStrings($events.flatMap(getCommunityNotificationTargetRefs))).map(filter => ({
      ...filter,
      limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
    })),
)

const globalCommunityNotificationTargetEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityNotificationTargetFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community notification targets",
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
    globalCommunityNotificationTargetEvents,
    globalCommunityProfileListEvents,
    communityMemberReportStates,
  ],
  ([
    $pubkey,
    $activeUserCommunityRefs,
    $globalCommunityNotificationEvents,
    $globalCommunityNotificationTargetEvents,
    $globalCommunityProfileListEvents,
    $communityMemberReportStates,
  ]) =>
    buildCommunityNotificationRows({
      refs: $activeUserCommunityRefs,
      events: $globalCommunityNotificationEvents,
      targetEvents: $globalCommunityNotificationTargetEvents,
      profileListEvents: $globalCommunityProfileListEvents,
      currentPubkey: $pubkey || undefined,
      reportStates: $communityMemberReportStates,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    }),
)

const repoWatchNotificationRows = derived(
  [
    repoWatchNotificationCandidates,
  ],
  ([$repoWatchNotificationCandidates]) =>
    buildRepoWatchNotificationRows({
      candidates: $repoWatchNotificationCandidates,
    }),
)

const engagementNotificationFilters = derived(
  [pubkey, notificationHistorySince, notificationHistoryFilterLimit],
  ([$pubkey, $notificationHistorySince, $notificationHistoryFilterLimit]) =>
    $pubkey
      ? [
          {
            kinds: ENGAGEMENT_NOTIFICATION_KINDS,
            "#p": [$pubkey],
            since: $notificationHistorySince,
            limit: Math.max(ENGAGEMENT_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
          },
        ]
      : [],
)

const engagementNotificationRelays = derived(pubkey, $pubkey =>
  $pubkey ? normalizeRelayHints(getUserRelayHints(), getAuthorRelayHints($pubkey), APP_RELAYS) : [],
)

const engagementNotificationEvents = deriveLoadedNotificationEvents({
  filters: engagementNotificationFilters,
  relays: engagementNotificationRelays,
  label: "engagement notifications",
})

const engagementNotificationTargetFilters = derived(
  [engagementNotificationEvents, notificationHistoryFilterLimit],
  ([$events, $notificationHistoryFilterLimit]) =>
    getIdFilters(uniqueStrings($events.flatMap(getEngagementTargetRefs))).map(filter => ({
      ...filter,
      limit: Math.max(ENGAGEMENT_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
    })),
)

const engagementNotificationTargetRelays = derived(
  [pubkey, engagementNotificationEvents],
  ([$pubkey, $events]) =>
    normalizeRelayHints(
      $pubkey ? getAuthorRelayHints($pubkey) : [],
      getUserRelayHints(),
      APP_RELAYS,
      $events.flatMap(event => getEventRelayHints(event)),
    ),
)

const engagementNotificationTargetEvents = deriveLoadedNotificationEvents({
  filters: engagementNotificationTargetFilters,
  relays: engagementNotificationTargetRelays,
  label: "engagement notification targets",
})

const validEngagementZapResponseIds = derived(
  [engagementNotificationEvents, engagementNotificationTargetEvents],
  ([$events, $targetEvents], set) => {
    let cancelled = false
    const targetEventsByRef = mapEventsByRef($targetEvents)
    const zapPairs = $events
      .filter(event => event.kind === ZAP_RESPONSE)
      .flatMap(event => {
        const target = getZapTargetRefs(event)
          .map(ref => targetEventsByRef.get(ref))
          .find(Boolean)

        return target ? [{event, target}] : []
      })

    if (zapPairs.length === 0) {
      set(new Set<string>())
      return () => {
        cancelled = true
      }
    }

    Promise.all(
      zapPairs.map(async ({event, target}) => {
        try {
          return (await getValidZap(event, target)) ? event.id : ""
        } catch {
          return ""
        }
      }),
    ).then(ids => {
      if (!cancelled) set(new Set(ids.filter(Boolean)))
    })

    return () => {
      cancelled = true
    }
  },
  new Set<string>(),
)

const engagementNotificationRows = derived(
  [pubkey, engagementNotificationEvents, engagementNotificationTargetEvents, validEngagementZapResponseIds],
  ([$pubkey, $events, $targetEvents, $validZapResponseIds]) =>
    buildEngagementNotificationRows({
      events: $events,
      targetEvents: $targetEvents,
      currentPubkey: $pubkey || undefined,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
      validZapResponseIds: $validZapResponseIds,
    }),
)

export const notificationCenterRows = derived(
  [
    chatsById,
    notifications,
    globalCommunityNotificationRows,
    repoWatchNotificationRows,
    engagementNotificationRows,
  ],
  ([
    $chatsById,
    $notifications,
    $globalCommunityNotificationRows,
    $repoWatchNotificationRows,
    $engagementNotificationRows,
  ]) => {
    const chatRows = buildChatNotificationRows({
      chats: $chatsById.values(),
      getPlaintext: getPlaintext,
    })
    const sourceRows = [
      ...chatRows,
      ...$globalCommunityNotificationRows,
      ...$repoWatchNotificationRows,
      ...$engagementNotificationRows,
    ]
    const excludedPaths = new Set(sourceRows.flatMap(row => [row.path, row.readPath]))

    if (chatRows.length > 0) excludedPaths.add("/chat")

    return sortNotificationRows([
      ...sourceRows,
      ...buildRouteNotificationRows({paths: $notifications, excludedPaths}),
    ])
  },
)

export const latestNotificationCenterTimestamp = derived(notificationCenterRows, rows =>
  rows.reduce((latest, row) => Math.max(latest, row.source === "chat" ? 0 : row.createdAt), 0),
)

export const hasNotificationCenterUnread = derived(
  [latestNotificationCenterTimestamp, notificationReadState],
  ([$latestNotificationCenterTimestamp, $notificationReadState]) =>
    hasUnreadNotificationsState({
      latestNotificationTimestamp: $latestNotificationCenterTimestamp,
      lastReadTimestamp: $notificationReadState.lastReadTimestamp,
    }),
)
