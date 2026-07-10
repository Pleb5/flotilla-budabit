import {derived, readable, type Readable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {displayProfileByPubkey, getMutes, getPlaintext, getValidZap, pubkey, repository} from "@welshman/app"
import {load, request} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {
  Address,
  COMMENT,
  DELETE,
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  REACTION,
  THREAD,
  ZAP_GOAL,
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
  GIT_REPO_ANNOUNCEMENT,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@nostr-git/core/events"
import {APP_RELAYS, DM_KIND, chatsById, type Chat} from "@app/core/state"
import {
  activeUserCommunityRefs,
  communityMemberReportDeleteEvents,
  communityMemberReportEvents,
  communityMemberProfileListEvents,
  communityMemberReportStates,
  communityModeratorProfileListEvents,
  makeCommunityAdmissionFormFilters,
  makeCommunityReportReviewFilters,
} from "@app/core/community-state"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import {FORM_RESPONSE_KIND, normalizePubkey} from "@app/core/community"
import {
  COMMUNITY_FORM_REVIEW_KIND,
  getAdmissionSubmissionState,
  parseAdmissionForm,
  parseAdmissionResponse,
  parseAdmissionReview,
  type CommunityAdmissionForm,
} from "@app/core/community-forms"
import {eventTargetsCommunity, makeCommunityExclusiveFilter} from "@app/core/community-feeds"
import {readCommunityCalendarEventReply} from "@app/core/community-calendar"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThread, readCommunityThreadReply} from "@app/core/community-threads"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getGrantCapability,
  getGrantCapableSectionModeratorPubkeys,
  getCommunityWriteTargetSectionName,
  getCommunityTargetWriterPubkeys,
  type CommunityWriteTarget,
} from "@app/core/community-permissions"
import {
  canReviewCommunityContentReport,
  getCommunityContentReports,
  getCommunityCensorReason,
  isCommunityPersonBanned,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  notificationCandidates,
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
  makeCommunityCalendarPath,
  makeCommunityGoalPath,
  getCommunityReportTargetPath,
  getCommunityEventPath,
  makeCommunityPath,
  makeCommunityRoomPath,
  makeCommunityThreadPath,
  makeGitPath,
} from "@app/util/routes"
import {
  getAuthorRelayHints,
  getEventRelayHints,
  getUserRelayHints,
  makeEventShareEntity,
  normalizeRelayHints,
} from "@app/util/event-links"
import {getTrimmedReplyPreview} from "@app/util/git-quote"
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
  candidates?: NotificationCandidate[]
  currentPubkey?: string
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

export type BuildCommunityApplicationNotificationRowsOptions = {
  refs: ActiveUserCommunityRef[]
  currentPubkey?: string
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  admissionFormEvents?: TrustedEvent[]
  admissionResponseEvents?: TrustedEvent[]
  admissionDeleteEvents?: TrustedEvent[]
  admissionReviewEvents?: TrustedEvent[]
  mutedPubkeys?: string[]
}

export type BuildCommunityModerationNotificationRowsOptions = {
  refs: ActiveUserCommunityRef[]
  currentPubkey?: string
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  reportEvents?: TrustedEvent[]
  reportDeleteEvents?: TrustedEvent[]
  reportReviewEvents?: TrustedEvent[]
  mutedPubkeys?: string[]
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

export type BuildGlobalCommunityNotificationFiltersOptions = {
  refs: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  currentPubkey?: string
  reportStates?: UserCommunityReportStates
  since: number
  limit: number
}

const COMMUNITY_NOTIFICATION_LOAD_LIMIT = 200
const ENGAGEMENT_NOTIFICATION_LOAD_LIMIT = 200
const GIT_STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED]
const ENGAGEMENT_NOTIFICATION_KINDS = [
  COMMENT,
  REACTION,
  ZAP_RESPONSE,
  GIT_PULL_REQUEST_UPDATE,
  ...GIT_STATUS_KINDS,
]
const GIT_ENGAGEMENT_TARGET_KINDS = new Set([
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  ...GIT_STATUS_KINDS,
])
const ENGAGEMENT_TARGET_KINDS = new Set([
  COMMENT,
  EVENT_DATE,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  DM_KIND,
  ...GIT_ENGAGEMENT_TARGET_KINDS,
])
const NOSTR_EVENT_ENTITY_RE = /\b(?:nostr:)?(?:nevent1|naddr1)[0-9a-z]+\b/gi
const NOSTR_PROFILE_ENTITY_RE = /\b(?:nostr:)?(?:nprofile1|npub1)[0-9a-z]+\b/gi

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

const getProfileEntityPubkey = (raw: string) => {
  try {
    const decoded = nip19.decode(raw.replace(/^nostr:/i, ""))

    if (decoded.type === "npub" && typeof decoded.data === "string") return decoded.data
    if (decoded.type === "nprofile" && typeof decoded.data?.pubkey === "string") {
      return decoded.data.pubkey
    }
  } catch {
    return ""
  }

  return ""
}

const getProfilePreviewText = (pubkey: string) => {
  const normalizedPubkey = normalizePubkey(pubkey)

  return normalizedPubkey ? `@${displayProfileByPubkey(normalizedPubkey)}` : ""
}

const sanitizePreviewText = (content: string, event: TrustedEvent) =>
  content
    .replace(NOSTR_EVENT_ENTITY_RE, "")
    .replace(NOSTR_PROFILE_ENTITY_RE, raw => getProfilePreviewText(getProfileEntityPubkey(raw)))
    .replace(/#\[(\d+)\]/g, (raw, indexText) => {
      const tag = event.tags[Number.parseInt(indexText, 10)]
      if (tag?.[0] !== "p") return raw

      return getProfilePreviewText(tag[1] || "") || raw
    })
    .replace(/\s+/g, " ")
    .trim()

const getTextPreview = (event: TrustedEvent, fallback: string) => {
  const title = getEventTitle(event).trim()
  if (title) return title

  const content = sanitizePreviewText(getTrimmedReplyPreview(event, 180) || event.content, event)
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
  event,
  actionLabel,
})

const getCommunityEventLabel = (event: TrustedEvent | undefined) => {
  if (!event) return "Context"
  if (event.kind === THREAD) return "Thread"

  return "Context"
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

const isPreferredEvent = (event: TrustedEvent, current: TrustedEvent | undefined) =>
  !current ||
  event.created_at > current.created_at ||
  (event.created_at === current.created_at && event.id < current.id)

const mapAdmissionFormsBySection = ({
  ref,
  admissionFormEvents,
  profileListEvents,
  reportState,
}: {
  ref: ActiveUserCommunityRef
  admissionFormEvents: TrustedEvent[]
  profileListEvents: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const formsBySection = new Map<string, CommunityAdmissionForm>()

  for (const event of admissionFormEvents) {
    const form = parseAdmissionForm(event)
    const sectionName = form?.sectionName || ""
    if (!form || form.communityPubkey !== ref.communityPubkey || !sectionName) continue

    const moderators = getGrantCapableSectionModeratorPubkeys({
      definition: ref.definition,
      sectionName,
      profileListEvents,
      reportState,
    })
    if (!moderators.includes(normalizePubkey(form.pubkey))) continue

    const current = formsBySection.get(sectionName)
    if (isPreferredEvent(form.event, current?.event)) formsBySection.set(sectionName, form)
  }

  return formsBySection
}

const dedupeTrustedEvents = (events: TrustedEvent[]) =>
  Array.from(new Map(events.filter(event => event.id).map(event => [event.id, event])).values())

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
  if (event.kind === COMMENT) return getReplyTargetRefs(event)
  if (event.kind === GIT_PULL_REQUEST_UPDATE || GIT_STATUS_KINDS.includes(event.kind)) {
    return getGitActivityTargetRefs(event)
  }

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

  if (mentionTagIndexes.some(index => event.content.includes(`#[${index}]`))) return true

  return Array.from(event.content.matchAll(NOSTR_PROFILE_ENTITY_RE)).some(
    ([raw]) => normalizePubkey(getProfileEntityPubkey(raw)) === currentPubkey,
  )
}

const hasPubkeyMentionTag = (event: TrustedEvent, currentPubkey: string) =>
  getPubkeyTagValues(event.tags).some(pubkey => normalizePubkey(pubkey) === currentPubkey)

const getReferencedEventPubkey = (event: TrustedEvent, tagName: string, eventId?: string) =>
  normalizePubkey(
    event.tags.find(tag => tag[0] === tagName && (!eventId || tag[1] === eventId))?.[3] || "",
  )

const getAddressIdentifier = (address: string) => {
  try {
    return Address.from(address).identifier || ""
  } catch {
    return ""
  }
}

const getTagValueForKind = (event: TrustedEvent, name: string, kind: number) =>
  event.tags.find(tag => tag[0] === name && Number.parseInt(tag[2] || "", 10) === kind)?.[1] || ""

const readCommunityGoalReply = (event: TrustedEvent, communityPubkey?: string) => {
  if (event.kind !== COMMENT) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined
  if (getTagValue("K", event.tags) !== String(ZAP_GOAL)) return undefined

  const goalId = getTagValue("E", event.tags) || ""
  const goalAddress = getTagValue("A", event.tags) || getTagValueForKind(event, "a", ZAP_GOAL)
  if (!goalId && !goalAddress) return undefined

  const parentId = getTagValue("e", event.tags) || ""
  const parentKind = getTagValue("k", event.tags) || ""

  return {
    id: event.id,
    event,
    communityPubkey: getTagValue("h", event.tags) || "",
    goalId,
    goalAddress,
    parentReplyId: parentId && parentId !== goalId && parentKind !== String(ZAP_GOAL) ? parentId : "",
  }
}

const getCommunityRootOwnerPubkey = ({
  event,
  root,
  rootId,
  rootAddress,
}: {
  event: TrustedEvent
  root?: TrustedEvent
  rootId?: string
  rootAddress?: string
}) =>
  normalizePubkey(
    root?.pubkey ||
      (rootId ? getReferencedEventPubkey(event, "E", rootId) : "") ||
      (rootAddress ? getReferencedEventPubkey(event, "A", rootAddress) : "") ||
      (rootAddress ? getReferencedEventPubkey(event, "a", rootAddress) : "") ||
      "",
  )

type RepoNotificationSection = "issues" | "prs"

const getRepoAddress = (event: TrustedEvent) =>
  getTagValue("a", event.tags) ||
  event.tags.find(tag => {
    if (tag[0] !== "q" || !Address.isAddress(tag[1] || "")) return false

    try {
      return Address.from(tag[1] || "").kind === GIT_REPO_ANNOUNCEMENT
    } catch {
      return false
    }
  })?.[1] ||
  ""

const getRepoNaddr = (event: TrustedEvent) => {
  const address = getRepoAddress(event)
  if (!address) return ""

  try {
    return Address.from(address).toNaddr()
  } catch {
    return ""
  }
}

const getRepoRootKind = (event: TrustedEvent) =>
  Number.parseInt(getTagValue("K", event.tags) || getTagValue("k", event.tags) || "", 10)

const getRepoStatusRootId = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  getTagValue("e", event.tags) ||
  ""

const getRepoRootId = (event: TrustedEvent) => {
  if (GIT_STATUS_KINDS.includes(event.kind)) return getRepoStatusRootId(event)

  return getTagValue("E", event.tags) || getTagValue("e", event.tags) || ""
}

const getGitActivityTargetRefs = (event: TrustedEvent) =>
  uniqueStrings([getRepoRootId(event), getTagValue("E", event.tags), getRepoAddress(event)])

const getRepoNotificationSection = (event: TrustedEvent): RepoNotificationSection | undefined => {
  if (event.kind === GIT_ISSUE) return "issues"
  if (event.kind === GIT_PULL_REQUEST || event.kind === GIT_PULL_REQUEST_UPDATE) return "prs"

  const rootKind = getRepoRootKind(event)
  if (rootKind === GIT_ISSUE) return "issues"
  if (rootKind === GIT_PULL_REQUEST) return "prs"
}

const getRepoRowPath = (sectionPath: string, event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) {
    return `${sectionPath}/${event.id}`
  }

  const rootId = getRepoRootId(event)
  if (!rootId) return sectionPath
  if (event.kind === GIT_COMMENT || event.kind === COMMENT) {
    return `${sectionPath}/${rootId}#comment-${event.id}`
  }

  return `${sectionPath}/${rootId}`
}

const getGitEngagementEventPath = (event: TrustedEvent) => {
  const section = getRepoNotificationSection(event)
  const repoNaddr = getRepoNaddr(event)
  if (!section || !repoNaddr) return undefined

  return getRepoRowPath(`${makeGitPath(undefined, repoNaddr)}/${section}`, event)
}

const isGitEngagementEvent = (event: TrustedEvent) =>
  GIT_ENGAGEMENT_TARGET_KINDS.has(event.kind) ||
  (event.kind === COMMENT && Boolean(getRepoNotificationSection(event)))

const getDirectMessageEngagementPath = (event: TrustedEvent, currentPubkey: string) => {
  if (event.kind !== DM_KIND) return undefined

  const recipient = uniqueStrings([event.pubkey, ...getPubkeyTagValues(event.tags)])
    .map(normalizePubkey)
    .find(participant => participant && participant !== currentPubkey)

  return recipient ? makeChatPath(recipient) : "/chat"
}

type EngagementNotificationContext = {
  source: NotificationRowSource
  path: string
}

const getEngagementEventContext = (
  event: TrustedEvent,
  currentPubkey: string,
): EngagementNotificationContext | undefined => {
  const communityPath = getCommunityEventPath(event)
  if (communityPath) return {source: "community", path: communityPath}

  const gitPath = getGitEngagementEventPath(event)
  if (gitPath) return {source: "git", path: gitPath}

  const chatPath = getDirectMessageEngagementPath(event, currentPubkey)
  if (chatPath) return {source: "chat", path: chatPath}

  if (isGitEngagementEvent(event)) return {source: "git", path: `/${makeEventShareEntity(event)}`}
}

const getEngagementRowContext = ({
  event,
  target,
  currentPubkey,
  path,
}: {
  event: TrustedEvent
  target?: TrustedEvent
  currentPubkey: string
  path?: string
}): EngagementNotificationContext | undefined => {
  const eventContext = getEngagementEventContext(event, currentPubkey)
  const targetContext = target ? getEngagementEventContext(target, currentPubkey) : undefined
  const source = eventContext?.source || targetContext?.source
  const eventPath = eventContext?.path?.match(/^\/(?:nevent|naddr)1/i)
    ? undefined
    : eventContext?.path
  const resolvedPath = path || eventPath || targetContext?.path || eventContext?.path

  return source && resolvedPath ? {source, path: resolvedPath} : undefined
}

const getOwnedTarget = (
  refs: string[],
  eventsByRef: Map<string, TrustedEvent>,
  currentPubkey: string,
) =>
  refs
    .map(ref => eventsByRef.get(ref))
    .find(
      event =>
        Boolean(event && ENGAGEMENT_TARGET_KINDS.has(event.kind)) &&
        normalizePubkey(event?.pubkey || "") === currentPubkey,
    )

const getEngagementTargetLabel = (target: TrustedEvent | undefined) => {
  if (!target) return "your event"
  if (target.kind === GIT_ISSUE) return "your issue"
  if (target.kind === GIT_PULL_REQUEST || target.kind === GIT_PULL_REQUEST_UPDATE) {
    return "your pull request"
  }
  if (GIT_STATUS_KINDS.includes(target.kind)) return "your git status"
  if (target.kind === COMMENT) return isGitEngagementEvent(target) ? "your git comment" : "your comment"
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

const getImportantCommunityRootRow = ({
  event,
  ref,
  targetEventsById,
  targetEventsByRef,
  currentPubkey,
}: {
  event: TrustedEvent
  ref: ActiveUserCommunityRef
  targetEventsById: Map<string, TrustedEvent>
  targetEventsByRef: Map<string, TrustedEvent>
  currentPubkey: string
}) => {
  const threadReply = readCommunityThreadReply(event, ref.communityPubkey)
  if (threadReply) {
    const root = targetEventsById.get(threadReply.threadId)
    const rootThread = root ? readCommunityThread(root, ref.communityPubkey) : undefined
    const ownerPubkey = getCommunityRootOwnerPubkey({
      event,
      root: rootThread ? root : undefined,
      rootId: threadReply.threadId,
    })
    if (ownerPubkey !== currentPubkey) return undefined

    return {
      path: makeCommunityThreadPath(ref.communityPubkey, threadReply.threadId),
      readPath: makeCommunityThreadPath(ref.communityPubkey),
      title: "New thread comment",
      preview: getTextPreview(event, "Thread comment"),
      target: COMMUNITY_WRITE_TARGETS.comment,
      displayType: "reply" as NotificationRowType,
      action: "commented",
      contextLabel: "on your thread",
      targetEvent: rootThread ? root : undefined,
      targetLabel: "Your thread",
      detailLabel: "New thread comment",
      actionLabel: "Open thread comment",
    }
  }

  const calendarReply = readCommunityCalendarEventReply(event, ref.communityPubkey)
  if (calendarReply) {
    const root =
      targetEventsByRef.get(calendarReply.calendarEventId) ||
      targetEventsByRef.get(calendarReply.calendarAddress)
    const ownerPubkey = getCommunityRootOwnerPubkey({
      event,
      root,
      rootId: calendarReply.calendarEventId,
      rootAddress: calendarReply.calendarAddress,
    })
    if (ownerPubkey !== currentPubkey) return undefined

    const calendarId = getAddressIdentifier(calendarReply.calendarAddress) || calendarReply.calendarEventId

    return {
      path: makeCommunityCalendarPath(ref.communityPubkey, calendarId),
      title: "New calendar comment",
      preview: getTextPreview(event, "Calendar comment"),
      target: COMMUNITY_WRITE_TARGETS.comment,
      displayType: "reply" as NotificationRowType,
      action: "commented",
      contextLabel: "on your calendar event",
      targetEvent: root,
      targetLabel: "Your calendar event",
      detailLabel: "New calendar comment",
      actionLabel: "Open calendar comment",
    }
  }

  const goalReply = readCommunityGoalReply(event, ref.communityPubkey)
  if (goalReply) {
    const root = targetEventsByRef.get(goalReply.goalId) || targetEventsByRef.get(goalReply.goalAddress)
    const ownerPubkey = getCommunityRootOwnerPubkey({
      event,
      root,
      rootId: goalReply.goalId,
      rootAddress: goalReply.goalAddress,
    })
    if (ownerPubkey !== currentPubkey) return undefined

    const goalId = getAddressIdentifier(goalReply.goalAddress) || goalReply.goalId

    return {
      path: makeCommunityGoalPath(ref.communityPubkey, goalId),
      title: "New goal comment",
      preview: getTextPreview(event, "Goal comment"),
      target: COMMUNITY_WRITE_TARGETS.comment,
      displayType: "reply" as NotificationRowType,
      action: "commented",
      contextLabel: "on your goal",
      targetEvent: root,
      targetLabel: "Your goal",
      detailLabel: "New goal comment",
      actionLabel: "Open goal comment",
    }
  }
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
      load({relays, filters, signal: currentController.signal})
        .catch(error => {
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
  const targetEventsByRef = mapEventsByRef([...events, ...targetEvents])

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
        const parentMessage = message.parentMessageId
          ? targetEventsById.get(message.parentMessageId)
          : undefined
        const parentRoomMessage = parentMessage
          ? readCommunityRoomMessage(parentMessage, ref.communityPubkey, message.roomRootId)
          : undefined
        const parentLoadedOutsideRoom = Boolean(parentMessage && !parentRoomMessage)
        const parentPubkey = normalizePubkey(
          parentMessage?.pubkey || getReferencedEventPubkey(event, "q", message.parentMessageId),
        )
        const isReplyToViewer =
          normalizedCurrentPubkey &&
          message.parentMessageId &&
          !parentLoadedOutsideRoom &&
          parentPubkey === normalizedCurrentPubkey

        if (isReplyToViewer) {
          addRow({
            ref,
            event,
            path: makeCommunityRoomPath(ref.communityPubkey, message.roomRootId),
            title: "New room reply",
            preview: getTextPreview(event, "Room message"),
            target: COMMUNITY_WRITE_TARGETS.roomMessage,
            displayType: "reply",
            action: "replied",
            contextLabel: "in a room",
            targetEvent: parentRoomMessage ? parentMessage : undefined,
            detailLabel: "New room reply",
            actionLabel: "Open room reply",
          })
          continue
        }

        if (
          normalizedCurrentPubkey &&
          hasPubkeyMentionTag(event, normalizedCurrentPubkey) &&
          contentMentionsPubkey(event, normalizedCurrentPubkey)
        ) {
          addRow({
            ref,
            event,
            path: makeCommunityRoomPath(ref.communityPubkey, message.roomRootId),
            title: "New room mention",
            preview: getTextPreview(event, "Room mention"),
            target: COMMUNITY_WRITE_TARGETS.roomMessage,
            displayType: "mention",
            action: "mentioned you",
            contextLabel: "in a room",
            detailLabel: "New room mention",
            actionLabel: "Open mention",
          })
        }

        continue
      }

      const threadReply = readCommunityThreadReply(event, ref.communityPubkey)
      if (threadReply) {
        const parentReply = threadReply.parentReplyId
          ? targetEventsById.get(threadReply.parentReplyId)
          : undefined
        const parentThreadReply = parentReply
          ? readCommunityThreadReply(parentReply, ref.communityPubkey, threadReply.threadId)
          : undefined
        const parentLoadedOutsideThread = Boolean(parentReply && !parentThreadReply)
        const parentPubkey = normalizePubkey(
          parentReply?.pubkey || getReferencedEventPubkey(event, "e", threadReply.parentReplyId),
        )
        const isReplyToViewer =
          normalizedCurrentPubkey &&
          threadReply.parentReplyId &&
          !parentLoadedOutsideThread &&
          parentPubkey === normalizedCurrentPubkey

        if (isReplyToViewer) {
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
            targetEvent: parentThreadReply ? parentReply : undefined,
            detailLabel: "New thread comment reply",
            actionLabel: "Open thread reply",
          })
          continue
        }

        const importantRootRow = getImportantCommunityRootRow({
          event,
          ref,
          targetEventsById,
          targetEventsByRef,
          currentPubkey: normalizedCurrentPubkey,
        })
        if (importantRootRow) {
          addRow({ref, event, ...importantRootRow})
          continue
        }

        if (
          normalizedCurrentPubkey &&
          hasPubkeyMentionTag(event, normalizedCurrentPubkey) &&
          contentMentionsPubkey(event, normalizedCurrentPubkey)
        ) {
          addRow({
            ref,
            event,
            path: makeCommunityThreadPath(ref.communityPubkey, threadReply.threadId),
            readPath: makeCommunityThreadPath(ref.communityPubkey),
            title: "New thread mention",
            preview: getTextPreview(event, "Thread mention"),
            target: COMMUNITY_WRITE_TARGETS.comment,
            displayType: "mention",
            action: "mentioned you",
            contextLabel: "in a thread",
            detailLabel: "New thread mention",
            actionLabel: "Open mention",
          })
        }
      }

      if (event.kind === COMMENT) {
        const importantRootRow = getImportantCommunityRootRow({
          event,
          ref,
          targetEventsById,
          targetEventsByRef,
          currentPubkey: normalizedCurrentPubkey,
        })
        if (importantRootRow) {
          addRow({ref, event, ...importantRootRow})
          continue
        }
      }
    }

    for (const event of profileListEvents) {
      if (getMembershipCommunityRef(event, [ref], normalizedCurrentPubkey) !== ref) continue
      if (reportState && isCommunityPersonBanned(reportState, event.pubkey)) continue

      addRow({
        ref,
        event,
        path: makeCommunityPath(ref.communityPubkey, "access"),
        title: "Community membership updated",
        preview: "Your community membership changed.",
        sectionName: "access",
        displayType: "community",
        action: "updated",
        contextLabel: "your community membership",
        detailLabel: "Access update",
        actionLabel: "Open access settings",
      })
    }

    if (normalizedCurrentPubkey && reportState) {
      for (const report of reportState.personReports) {
        if (normalizePubkey(report.targetPubkey || "") !== normalizedCurrentPubkey) continue
        if (!report.event) continue

        addRow({
          ref,
          event: report.event,
          path: makeCommunityPath(ref.communityPubkey, "access"),
          title: "Community ban",
          preview: report.event.content || "You were banned from this community.",
          sectionName: "moderation",
          displayType: "community",
          action: "moderated you",
          contextLabel: "Community moderation",
          detailLabel: "Ban notice",
          actionLabel: "Open access settings",
        })
      }

      for (const report of reportState.eventReports) {
        if (normalizePubkey(report.targetPubkey || "") !== normalizedCurrentPubkey) continue
        if (!report.event) continue

        addRow({
          ref,
          event: report.event,
          path: getCommunityReportTargetPath(ref.communityPubkey, report) || makeCommunityPath(ref.communityPubkey, "moderation"),
          title: "Content moderated",
          preview: report.targetEventTitle || report.targetEventContent || report.event.content || "Your content was moderated.",
          sectionName: report.sectionName || "moderation",
          displayType: "community",
          action: "moderated your content",
          contextLabel: "Community moderation",
          detailLabel: "Moderation notice",
          actionLabel: "Open moderated content",
        })
      }
    }
  }

  return sortNotificationRows(Array.from(rowsById.values()))
}

export const buildCommunityApplicationNotificationRows = ({
  refs,
  currentPubkey,
  profileListEvents = [],
  reportStates,
  admissionFormEvents = [],
  admissionResponseEvents = [],
  admissionDeleteEvents = [],
  admissionReviewEvents = [],
  mutedPubkeys = [],
}: BuildCommunityApplicationNotificationRowsOptions): NotificationRow[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!normalizedCurrentPubkey) return []

  const rowsById = new Map<string, NotificationRow>()
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const formsByAddress = new Map<string, CommunityAdmissionForm>()
  const dedupedFormEvents = dedupeTrustedEvents(admissionFormEvents)
  const dedupedResponseEvents = dedupeTrustedEvents(admissionResponseEvents)
  const dedupedDeleteEvents = dedupeTrustedEvents(admissionDeleteEvents)
  const dedupedReviewEvents = dedupeTrustedEvents(admissionReviewEvents)

  for (const event of dedupedFormEvents) {
    const form = parseAdmissionForm(event)
    if (form) formsByAddress.set(form.address, form)
  }

  const addRow = ({
    id,
    event,
    path,
    readPath = path,
    title,
    preview,
    action,
    contextLabel,
    detailLabel,
    actionLabel,
    targetEvent,
    targetLabel,
  }: {
    id: string
    event: TrustedEvent
    path: string
    readPath?: string
    title: string
    preview: string
    action: string
    contextLabel: string
    detailLabel: string
    actionLabel: string
    targetEvent?: TrustedEvent
    targetLabel?: string
  }) => {
    if (!path) return

    const actorPubkey = normalizePubkey(event.pubkey || "")
    if (!actorPubkey || actorPubkey === normalizedCurrentPubkey || muted.has(actorPubkey)) return

    const current = rowsById.get(id)
    if (current && current.createdAt >= event.created_at) return

    rowsById.set(id, {
      id,
      eventId: event.id,
      actorPubkey,
      source: "community",
      sourceLabel: getNotificationSourceLabel("community"),
      type: "community",
      expandable: false,
      title,
      preview,
      action,
      actionLabel,
      contextLabel,
      path,
      readPath,
      navigationEventId: event.id,
      target: targetEvent
        ? makeEventDisplayTarget({
            label: targetLabel || "Application form",
            event: targetEvent,
            path,
            actionLabel: "Open context",
          })
        : undefined,
      detail: makeEventDisplayTarget({
        label: detailLabel,
        event,
        path,
        actionLabel,
        fallback: preview,
      }),
      createdAt: event.created_at,
      searchText: buildNotificationSearchText(
        "community",
        title,
        preview,
        event.pubkey,
        path,
        contextLabel,
      ),
    })
  }

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.communityPubkey)
    const formsBySection = mapAdmissionFormsBySection({
      ref,
      admissionFormEvents: dedupedFormEvents,
      profileListEvents,
      reportState,
    })

    for (const [sectionName, form] of formsBySection) {
      const capability = getGrantCapability({
        definition: ref.definition,
        userPubkey: normalizedCurrentPubkey,
        sectionName,
        profileListEvents,
        reportState,
      })
      if (!capability.canGrant) continue

      const moderatorPubkeys = getGrantCapableSectionModeratorPubkeys({
        definition: ref.definition,
        sectionName,
        profileListEvents,
        reportState,
      })
      const path = makeCommunityPath(ref.communityPubkey, "moderation")

      for (const event of dedupedResponseEvents) {
        const response = parseAdmissionResponse(event)
        if (!response || response.formAddress !== form.address) continue
        if (isCommunityPersonBanned(reportState, response.event.pubkey)) continue

        const submission = getAdmissionSubmissionState({
          responseEvents: dedupedResponseEvents,
          deleteEvents: dedupedDeleteEvents,
          reviewEvents: dedupedReviewEvents,
          formAddress: form.address,
          applicantPubkey: response.event.pubkey,
          moderatorPubkeys,
        })
        if (submission.status !== "pending" || submission.response?.event.id !== event.id) continue

        addRow({
          id: `community-application:${event.id}`,
          event,
          path,
          title: "New publishing request",
          preview: `New request to publish in ${sectionName}.`,
          action: "requested to publish in",
          contextLabel: sectionName,
          detailLabel: "Access application",
          actionLabel: "Open application",
          targetEvent: form.event,
          targetLabel: "Application form",
        })
      }
    }
  }

  for (const event of dedupedReviewEvents) {
    const review = parseAdmissionReview(event)
    const applicantPubkey = normalizePubkey(review?.applicantPubkey || "")
    if (!review || applicantPubkey !== normalizedCurrentPubkey) continue

    const communityPubkey = review.communityPubkey || formsByAddress.get(review.formAddress || "")?.communityPubkey || ""
    if (!communityPubkey) continue

    const accepted = review.status === "granted"
    const revoked =
      !accepted &&
      dedupedReviewEvents.some(candidateEvent => {
        const candidate = parseAdmissionReview(candidateEvent)

        return Boolean(
          candidate &&
            candidate.responseId === review.responseId &&
            normalizePubkey(candidate.applicantPubkey || "") === normalizedCurrentPubkey &&
            candidate.status === "granted" &&
            candidate.event.created_at < event.created_at,
        )
      })
    const form = review.formAddress ? formsByAddress.get(review.formAddress) : undefined

    addRow({
      id: `community-application-review:${event.id}`,
      event,
      path: makeCommunityPath(communityPubkey, "access"),
      title: accepted
        ? "Publishing request approved"
        : revoked
          ? "Publishing access revoked"
          : "Publishing request denied",
      preview: accepted
        ? `Your request to publish in ${review.sectionName || "this community"} was accepted.`
        : revoked
          ? `Your access to publish in ${review.sectionName || "this community"} was revoked.`
        : `Your request to publish in ${review.sectionName || "this community"} was denied.`,
      action: accepted
        ? "approved your request to publish in"
        : revoked
          ? "revoked your access to publish in"
          : "denied your request to publish in",
      contextLabel: review.sectionName || "this community",
      detailLabel: "Access decision",
      actionLabel: "Open access settings",
      targetEvent: form?.event,
      targetLabel: "Application form",
    })
  }

  return sortNotificationRows(Array.from(rowsById.values()))
}

const communityReportTargetsMatch = (
  left: {targetEventId?: string; targetAddress?: string; sectionName?: string},
  right: {targetEventId?: string; targetAddress?: string; sectionName?: string},
) => {
  if ((left.sectionName || "") !== (right.sectionName || "")) return false

  return Boolean(
    (left.targetEventId && left.targetEventId === right.targetEventId) ||
      (left.targetAddress && left.targetAddress === right.targetAddress),
  )
}

export const buildCommunityModerationNotificationRows = ({
  refs,
  currentPubkey,
  profileListEvents = [],
  reportStates,
  reportEvents = [],
  reportDeleteEvents = [],
  reportReviewEvents = [],
  mutedPubkeys = [],
}: BuildCommunityModerationNotificationRowsOptions): NotificationRow[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!normalizedCurrentPubkey) return []

  const rowsById = new Map<string, NotificationRow>()
  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const dedupedReportEvents = dedupeTrustedEvents(reportEvents)
  const dedupedReportDeleteEvents = dedupeTrustedEvents(reportDeleteEvents)
  const dedupedReportReviewEvents = dedupeTrustedEvents(reportReviewEvents)

  const addRow = ({
    id,
    event,
    path,
    title,
    preview,
    action,
    contextLabel,
    detailLabel,
    actionLabel,
  }: {
    id: string
    event: TrustedEvent
    path: string
    title: string
    preview: string
    action: string
    contextLabel: string
    detailLabel: string
    actionLabel: string
  }) => {
    if (!path) return

    const actorPubkey = normalizePubkey(event.pubkey || "")
    if (!actorPubkey || actorPubkey === normalizedCurrentPubkey || muted.has(actorPubkey)) return

    const current = rowsById.get(id)
    if (current && current.createdAt >= event.created_at) return

    rowsById.set(id, {
      id,
      eventId: event.id,
      actorPubkey,
      source: "community",
      sourceLabel: getNotificationSourceLabel("community"),
      type: "community",
      expandable: false,
      title,
      preview,
      action,
      actionLabel,
      contextLabel,
      path,
      readPath: path,
      navigationEventId: event.id,
      detail: makeEventDisplayTarget({
        label: detailLabel,
        event,
        path,
        actionLabel,
        fallback: preview,
      }),
      createdAt: event.created_at,
      searchText: buildNotificationSearchText(
        "community",
        title,
        preview,
        event.pubkey,
        path,
        contextLabel,
      ),
    })
  }

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.communityPubkey)
    const moderationPath = makeCommunityPath(ref.communityPubkey, "moderation")
    const contentReports = getCommunityContentReports({
      definition: ref.definition,
      reportEvents: dedupedReportEvents,
      reviewEvents: dedupedReportReviewEvents,
      deleteEvents: dedupedReportDeleteEvents,
      profileListEvents,
      reportState,
    })

    for (const report of contentReports) {
      const targetPath = getCommunityReportTargetPath(ref.communityPubkey, report) || moderationPath
      const preview = report.targetEventTitle || report.targetEventContent || "Community content was reported."

      if (normalizePubkey(report.targetPubkey || "") === normalizedCurrentPubkey) {
        addRow({
          id: `community-report-target:${report.event.id}`,
          event: report.event,
          path: targetPath,
          title: "Content reported",
          preview,
          action: "reported your content",
          contextLabel: report.sectionName || "Community moderation",
          detailLabel: "Content report",
          actionLabel: "Open reported content",
        })
      }

      if (
        !report.reviewed &&
        canReviewCommunityContentReport({
          definition: ref.definition,
          reviewerPubkey: normalizedCurrentPubkey,
          report,
          profileListEvents,
          reportState,
        })
      ) {
        addRow({
          id: `community-report-review:${report.event.id}`,
          event: report.event,
          path: moderationPath,
          title: "New content report",
          preview,
          action: "reported content",
          contextLabel: report.sectionName || "Community moderation",
          detailLabel: "Content report",
          actionLabel: "Open moderation queue",
        })
      }

      if (normalizePubkey(report.reporterPubkey || "") === normalizedCurrentPubkey) {
        for (const review of report.reviews) {
          addRow({
            id: `community-report-reviewed:${review.event.id}`,
            event: review.event,
            path: targetPath,
            title: "Report reviewed",
            preview: "A moderator reviewed your content report.",
            action: "reviewed your report",
            contextLabel: report.sectionName || "Community moderation",
            detailLabel: "Report review",
            actionLabel: "Open reported content",
          })
        }
      }
    }

    if (reportState) {
      for (const report of reportState.eventReports) {
        const targetPath = getCommunityReportTargetPath(ref.communityPubkey, report) || moderationPath
        const preview = report.targetEventTitle || report.targetEventContent || "Community content was moderated."
        const sectionModerators = report.sectionName
          ? getGrantCapableSectionModeratorPubkeys({
              definition: ref.definition,
              sectionName: report.sectionName,
              profileListEvents,
              reportState,
            })
          : []

        for (const contentReport of contentReports) {
          if (!communityReportTargetsMatch(report, contentReport)) continue
          if (normalizePubkey(contentReport.reporterPubkey || "") !== normalizedCurrentPubkey) continue

          addRow({
            id: `community-censor-reporter:${report.event.id}:${contentReport.event.id}`,
            event: report.event,
            path: targetPath,
            title: "Reported content moderated",
            preview,
            action: "acted on your report",
            contextLabel: report.sectionName || "Community moderation",
            detailLabel: "Moderation action",
            actionLabel: "Open moderated content",
          })
        }

        if (sectionModerators.includes(normalizedCurrentPubkey)) {
          addRow({
            id: `community-censor-moderator:${report.event.id}`,
            event: report.event,
            path: moderationPath,
            title: "Content moderated",
            preview,
            action: "moderated content",
            contextLabel: report.sectionName || "Community moderation",
            detailLabel: "Moderation action",
            actionLabel: "Open moderation",
          })
        }
      }

      for (const report of reportState.personReports) {
        if (normalizePubkey(report.targetPubkey || "") === normalizedCurrentPubkey) continue

        addRow({
          id: `community-ban-member:${report.event.id}`,
          event: report.event,
          path: makeCommunityPath(ref.communityPubkey, "access"),
          title: "Member banned",
          preview: report.event.content || "A member was banned from this community.",
          action: "banned a member",
          contextLabel: "Community moderation",
          detailLabel: "Ban notice",
          actionLabel: "Open access settings",
        })
      }
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
    path,
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
    const rowContext = getEngagementRowContext({
      event,
      target,
      currentPubkey: normalizedCurrentPubkey,
      path,
    })
    if (!rowContext) return

    const targetPath = target
      ? getEngagementEventContext(target, normalizedCurrentPubkey)?.path
      : undefined

    rows.push({
      id: `event:${event.id}`,
      eventId: event.id,
      actorPubkey: getEngagementActorPubkey(event),
      source: rowContext.source,
      sourceLabel: getNotificationSourceLabel(rowContext.source),
      type: displayType,
      title,
      preview,
      action,
      actionLabel: actionLabel || "Open event",
      contextLabel,
      path: rowContext.path,
      readPath: rowContext.path,
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
        path: rowContext.path,
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
        rowContext.source,
        rowContext.path,
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

    if (event.kind === COMMENT) {
      const target = getOwnedTarget(getReplyTargetRefs(event), targetEventsByRef, normalizedCurrentPubkey)

      if (target) {
        addEventRow({
          event,
          title: "New reply",
          preview: getTextPreview(event, `Response to ${getEngagementTargetLabel(target)}`),
          displayType: "reply",
          action: "replied",
          contextLabel: `to ${getEngagementTargetLabel(target)}`,
          target,
          detailLabel: "New reply",
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
          contextLabel: "in a comment",
          detailLabel: "New mention",
          actionLabel: "Open mention",
        })
      }

      continue
    }

    if (event.kind === GIT_PULL_REQUEST_UPDATE || GIT_STATUS_KINDS.includes(event.kind)) {
      const target = getOwnedTarget(
        getGitActivityTargetRefs(event),
        targetEventsByRef,
        normalizedCurrentPubkey,
      )

      if (target) {
        const title = getRepoEventTitle(event)

        addEventRow({
          event,
          title,
          preview: getTextPreview(event, title),
          displayType: "repo",
          action: getRepoAction(event),
          contextLabel: `on ${getEngagementTargetLabel(target)}`,
          target,
          detailLabel: title,
          actionLabel: "Open git item",
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
    const rowContext = getEngagementRowContext({
      event: latestEvent,
      target: group.target,
      currentPubkey: normalizedCurrentPubkey,
    })
    if (!rowContext) continue

    const path = rowContext.path
    const preview = getReactionPreview(groupEvents, group.target)

    rows.push({
      id: `engagement:${key}`,
      eventId: latestEvent.id,
      eventIds: groupEvents.map(event => event.id),
      actorPubkey: getEngagementActorPubkey(latestEvent),
      source: rowContext.source,
      sourceLabel: getNotificationSourceLabel(rowContext.source),
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
      createdAt: latestEvent.created_at,
      searchText: buildNotificationSearchText(
        "engagement",
        "reaction",
        preview,
        rowContext.source,
        path,
        group.target.id,
        ...groupEvents.flatMap(event => [event.pubkey, event.content]),
      ),
    })
  }

  for (const [key, group] of zapGroups) {
    const groupEvents = [...group.events].sort((a, b) => b.created_at - a.created_at)
    const [latestEvent] = groupEvents
    const rowContext = getEngagementRowContext({
      event: latestEvent,
      target: group.target,
      currentPubkey: normalizedCurrentPubkey,
    })
    if (!rowContext) continue

    const path = rowContext.path
    const preview = getZapPreview(groupEvents, group.target)

    rows.push({
      id: `engagement:${key}`,
      eventId: latestEvent.id,
      eventIds: groupEvents.map(event => event.id),
      actorPubkey: getEngagementActorPubkey(latestEvent),
      source: rowContext.source,
      sourceLabel: getNotificationSourceLabel(rowContext.source),
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
      createdAt: latestEvent.created_at,
      searchText: buildNotificationSearchText(
        "engagement",
        "zap",
        preview,
        rowContext.source,
        path,
        group.target.id,
        ...groupEvents.flatMap(event => [event.pubkey, getEngagementActorPubkey(event), getZapComment(event)]),
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const getRouteNotificationSource = (path: string): NotificationRowSource | undefined => {
  if (path === "/chat" || path.startsWith("/chat/")) return "chat"
  if (path === "/git" || path.startsWith("/git/")) return "git"
  if (path === "/c" || path.startsWith("/c/")) return "community"
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

const getRouteNotificationPreview = (source: NotificationRowSource) =>
  `Open ${getNotificationSourceLabel(source).toLowerCase()} activity`

const getCommunityAccessRouteCandidateDisplay = (
  event: TrustedEvent | undefined,
  path: string,
): Pick<NotificationRow, "type" | "title" | "preview" | "action" | "contextLabel" | "actionLabel"> | undefined => {
  if (!event || !path.includes("/access") || event.kind !== REACTION) return undefined
  if (event.content !== "+" && event.content !== "-") return undefined

  const isAccepted = event.content === "+"
  const isPublishingReview = event.tags.some(tag => tag[0] === "k" && tag[1] === String(FORM_RESPONSE_KIND))

  if (isPublishingReview) {
    return {
      type: "community",
      title: isAccepted ? "Publishing request approved" : "Publishing request denied",
      preview: isAccepted
        ? "Your publishing request was accepted."
        : "Your publishing request was denied.",
      action: isAccepted ? "approved your request for" : "denied your request for",
      contextLabel: "publishing access",
      actionLabel: "Open access settings",
    }
  }

  return {
    type: "community",
    title: isAccepted ? "Moderator request accepted" : "Moderator request denied",
    preview: isAccepted
      ? "Your moderator role request was accepted."
      : "Your moderator role request was denied.",
    action: isAccepted ? "approved your request for" : "denied your request for",
    contextLabel: "moderator role",
    actionLabel: "Open access settings",
  }
}

const getCommunityRouteCandidateDisplay = (
  event: TrustedEvent | undefined,
  currentPubkey: string | undefined,
  path: string,
): Pick<NotificationRow, "type" | "title" | "preview" | "action" | "contextLabel" | "actionLabel"> | undefined => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!event || !normalizedCurrentPubkey) return undefined

  const accessDisplay = getCommunityAccessRouteCandidateDisplay(event, path)
  if (accessDisplay) return accessDisplay

  const roomMessage = readCommunityRoomMessage(event)
  if (roomMessage) {
    if (roomMessage.parentMessageId) {
      return {
        type: "reply",
        title: "New room reply",
        preview: getTextPreview(event, "Room reply"),
        action: "replied",
        contextLabel: "in a room",
        actionLabel: "Open room reply",
      }
    }

    if (hasPubkeyMentionTag(event, normalizedCurrentPubkey)) {
      return {
        type: "mention",
        title: "New room mention",
        preview: getTextPreview(event, "Room mention"),
        action: "mentioned you",
        contextLabel: "in a room",
        actionLabel: "Open mention",
      }
    }
  }

  const threadReply = readCommunityThreadReply(event)
  if (threadReply) {
    if (threadReply.parentReplyId) {
      return {
        type: "reply",
        title: "New thread comment reply",
        preview: getTextPreview(event, "Thread comment reply"),
        action: "replied",
        contextLabel: "in a thread",
        actionLabel: "Open thread reply",
      }
    }

    if (hasPubkeyMentionTag(event, normalizedCurrentPubkey)) {
      return {
        type: "mention",
        title: "New thread mention",
        preview: getTextPreview(event, "Thread mention"),
        action: "mentioned you",
        contextLabel: "in a thread",
        actionLabel: "Open mention",
      }
    }
  }

  return undefined
}

export const buildRouteNotificationRows = ({
  paths,
  excludedPaths = new Set<string>(),
  candidates = [],
  currentPubkey,
}: BuildRouteNotificationRowsOptions): NotificationRow[] => {
  const rows: NotificationRow[] = []
  const candidatesByPath = new Map<string, NotificationCandidate>()

  for (const candidate of candidates) {
    if (!candidate.path) continue

    const current = candidatesByPath.get(candidate.path)
    const candidateEvent = candidate.latestEvent
    const currentEvent = current?.latestEvent

    if (!current || (candidateEvent && (!currentEvent || isPreferredEvent(candidateEvent, currentEvent)))) {
      candidatesByPath.set(candidate.path, candidate)
    }
  }

  for (const path of Array.from(paths).sort()) {
    if (!path || excludedPaths.has(path)) continue

    const source = getRouteNotificationSource(path)
    if (!source) continue

    const candidateEvent = candidatesByPath.get(path)?.latestEvent
    const communityDisplay =
      source === "community" ? getCommunityRouteCandidateDisplay(candidateEvent, currentPubkey, path) : undefined
    const title = communityDisplay?.title || getRouteNotificationTitle(source)
    const preview = communityDisplay?.preview || getRouteNotificationPreview(source)
    const actionLabel = communityDisplay?.actionLabel || "Open activity"

    rows.push({
      id: `route:${path}`,
      eventId: candidateEvent?.id,
      source,
      sourceLabel: getNotificationSourceLabel(source),
      type: communityDisplay?.type || "route",
      title,
      preview,
      action: communityDisplay?.action || "needs attention",
      actionLabel,
      contextLabel: communityDisplay?.contextLabel || getNotificationSourceLabel(source),
      path,
      readPath: path === "/chat" ? "/chat/*" : path,
      actorPubkey: candidateEvent?.pubkey,
      navigationEventId: candidateEvent?.id,
      detail: {
        label: title,
        preview,
        path,
        eventId: candidateEvent?.id,
        event: candidateEvent,
        actionLabel,
      },
      createdAt: candidateEvent?.created_at || 0,
      searchText: buildNotificationSearchText(source, title, preview, path),
    })
  }

  return sortNotificationRows(rows)
}

export const buildGlobalCommunityNotificationFilters = ({
  refs,
  profileListEvents = [],
  currentPubkey,
  reportStates,
  since,
  limit,
}: BuildGlobalCommunityNotificationFiltersOptions): Filter[] => {
  const filters: Filter[] = []
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const boundedLimit = Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, limit)

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.communityPubkey)
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

    filters.push(
      makeCommunityExclusiveFilter(ref.communityPubkey, [MESSAGE], {
        since,
        limit: boundedLimit,
      }),
      makeCommunityExclusiveFilter(ref.communityPubkey, [COMMENT], {
        since,
        limit: boundedLimit,
      }),
    )

    if (normalizedCurrentPubkey) {
      filters.push(
        makeCommunityExclusiveFilter(ref.communityPubkey, [MESSAGE], {
          "#p": [normalizedCurrentPubkey],
          since,
          limit: boundedLimit,
        }),
        makeCommunityExclusiveFilter(ref.communityPubkey, [COMMENT], {
          "#p": [normalizedCurrentPubkey],
          since,
          limit: boundedLimit,
        }),
      )
    }

    if (roomAuthors.length > 0) {
      filters.push(
        makeCommunityExclusiveFilter(ref.communityPubkey, [MESSAGE], {
          authors: roomAuthors,
          since,
          limit: boundedLimit,
        }),
      )
    }
    if (commentAuthors.length > 0) {
      filters.push(
        makeCommunityExclusiveFilter(ref.communityPubkey, [COMMENT], {
          authors: commentAuthors,
          since,
          limit: boundedLimit,
        }),
      )
    }
  }

  return filters
}

const globalCommunityNotificationFilters = derived(
  [
    pubkey,
    activeUserCommunityRefs,
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    communityMemberReportStates,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $pubkey,
    $refs,
    $memberProfileListEvents,
    $moderatorProfileListEvents,
    $reportStates,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    const profileListEvents = [...$memberProfileListEvents, ...$moderatorProfileListEvents]

    return buildGlobalCommunityNotificationFilters({
      refs: $refs,
      profileListEvents,
      currentPubkey: $pubkey || undefined,
      reportStates: $reportStates,
      since: $notificationHistorySince,
      limit: $notificationHistoryFilterLimit,
    })
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

const globalCommunityAdmissionFormFilters = derived(activeUserCommunityRefs, $refs =>
  $refs.flatMap(ref => makeCommunityAdmissionFormFilters(ref.definition)),
)

const globalCommunityAdmissionFormEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityAdmissionFormFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community admission forms",
})

const globalCommunityAdmissionResponseFilters = derived(
  [globalCommunityAdmissionFormEvents, notificationHistorySince, notificationHistoryFilterLimit],
  ([$events, $notificationHistorySince, $notificationHistoryFilterLimit]) => {
    const addresses = uniqueStrings(
      $events.map(event => parseAdmissionForm(event)?.address || ""),
    )
    if (addresses.length === 0) return []

    return [
      {
        kinds: [FORM_RESPONSE_KIND],
        "#a": addresses,
        since: $notificationHistorySince,
        limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
      },
    ]
  },
)

const globalCommunityAdmissionResponseEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityAdmissionResponseFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community admission responses",
})

const globalCommunityAdmissionDecisionFilters = derived(
  [globalCommunityAdmissionResponseEvents, notificationHistorySince, notificationHistoryFilterLimit],
  ([$events, $notificationHistorySince, $notificationHistoryFilterLimit]) => {
    const responseIds = uniqueStrings($events.map(event => event.id))
    if (responseIds.length === 0) return []

    return [
      {
        kinds: [DELETE, COMMUNITY_FORM_REVIEW_KIND],
        "#e": responseIds,
        since: $notificationHistorySince,
        limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
      },
    ]
  },
)

const globalCommunityAdmissionDecisionEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityAdmissionDecisionFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community admission decisions",
})

const communityApplicationOutcomeFilters = derived(
  [pubkey, notificationHistorySince, notificationHistoryFilterLimit],
  ([$pubkey, $notificationHistorySince, $notificationHistoryFilterLimit]) =>
    $pubkey
      ? [
          {
            kinds: [COMMUNITY_FORM_REVIEW_KIND],
            "#p": [$pubkey],
            "#k": [String(FORM_RESPONSE_KIND)],
            since: $notificationHistorySince,
            limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
          },
        ]
      : [],
)

const communityApplicationOutcomeRelays = derived(pubkey, $pubkey =>
  $pubkey ? normalizeRelayHints(getUserRelayHints(), getAuthorRelayHints($pubkey), APP_RELAYS) : [],
)

const communityApplicationOutcomeEvents = deriveLoadedNotificationEvents({
  filters: communityApplicationOutcomeFilters,
  relays: communityApplicationOutcomeRelays,
  label: "community application outcomes",
})

const globalCommunityReportReviewFilters = derived(
  [activeUserCommunityRefs, communityMemberReportEvents],
  ([$refs, $reportEvents]) =>
    $refs.flatMap(ref => makeCommunityReportReviewFilters(ref.definition, $reportEvents)),
)

const globalCommunityReportReviewEvents = deriveLoadedNotificationEvents({
  filters: globalCommunityReportReviewFilters,
  relays: globalCommunityNotificationRelays,
  label: "global community report reviews",
})

const getCommunityNotificationTargetRefs = (event: TrustedEvent) => {
  const roomMessage = readCommunityRoomMessage(event)
  if (roomMessage?.parentMessageId) return [roomMessage.parentMessageId]

  const threadReply = readCommunityThreadReply(event)
  if (threadReply) return uniqueStrings([threadReply.parentReplyId, threadReply.threadId])

  const calendarReply = readCommunityCalendarEventReply(event)
  if (calendarReply) {
    return uniqueStrings([
      calendarReply.parentReplyId,
      calendarReply.calendarEventId,
      calendarReply.calendarAddress,
    ])
  }

  const goalReply = readCommunityGoalReply(event)
  if (goalReply) return uniqueStrings([goalReply.parentReplyId, goalReply.goalId, goalReply.goalAddress])

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

const globalCommunityApplicationRows = derived(
  [
    pubkey,
    activeUserCommunityRefs,
    globalCommunityProfileListEvents,
    communityMemberReportStates,
    globalCommunityAdmissionFormEvents,
    globalCommunityAdmissionResponseEvents,
    globalCommunityAdmissionDecisionEvents,
    communityApplicationOutcomeEvents,
  ],
  ([
    $pubkey,
    $activeUserCommunityRefs,
    $globalCommunityProfileListEvents,
    $communityMemberReportStates,
    $globalCommunityAdmissionFormEvents,
    $globalCommunityAdmissionResponseEvents,
    $globalCommunityAdmissionDecisionEvents,
    $communityApplicationOutcomeEvents,
  ]) =>
    buildCommunityApplicationNotificationRows({
      refs: $activeUserCommunityRefs,
      currentPubkey: $pubkey || undefined,
      profileListEvents: $globalCommunityProfileListEvents,
      reportStates: $communityMemberReportStates,
      admissionFormEvents: $globalCommunityAdmissionFormEvents,
      admissionResponseEvents: $globalCommunityAdmissionResponseEvents,
      admissionDeleteEvents: $globalCommunityAdmissionDecisionEvents,
      admissionReviewEvents: [
        ...$globalCommunityAdmissionDecisionEvents,
        ...$communityApplicationOutcomeEvents,
      ],
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    }),
)

const globalCommunityModerationRows = derived(
  [
    pubkey,
    activeUserCommunityRefs,
    globalCommunityProfileListEvents,
    communityMemberReportStates,
    communityMemberReportEvents,
    communityMemberReportDeleteEvents,
    globalCommunityReportReviewEvents,
  ],
  ([
    $pubkey,
    $activeUserCommunityRefs,
    $globalCommunityProfileListEvents,
    $communityMemberReportStates,
    $communityMemberReportEvents,
    $communityMemberReportDeleteEvents,
    $globalCommunityReportReviewEvents,
  ]) =>
    buildCommunityModerationNotificationRows({
      refs: $activeUserCommunityRefs,
      currentPubkey: $pubkey || undefined,
      profileListEvents: $globalCommunityProfileListEvents,
      reportStates: $communityMemberReportStates,
      reportEvents: $communityMemberReportEvents,
      reportDeleteEvents: $communityMemberReportDeleteEvents,
      reportReviewEvents: $globalCommunityReportReviewEvents,
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
  ([$pubkey, $notificationHistorySince, $notificationHistoryFilterLimit]) => {
    if (!$pubkey) return []

    const limit = Math.max(ENGAGEMENT_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit)

    const filters: Filter[] = [
      {
        kinds: [COMMENT, REACTION, ZAP_RESPONSE],
        "#p": [$pubkey],
        since: $notificationHistorySince,
        limit,
      },
      {
        kinds: [COMMENT],
        "#P": [$pubkey],
        "#K": [String(GIT_ISSUE), String(GIT_PULL_REQUEST)],
        since: $notificationHistorySince,
        limit,
      },
      {
        kinds: [GIT_PULL_REQUEST_UPDATE],
        "#P": [$pubkey],
        since: $notificationHistorySince,
        limit,
      },
      {
        kinds: GIT_STATUS_KINDS,
        "#p": [$pubkey],
        since: $notificationHistorySince,
        limit,
      },
    ]

    return filters
  },
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
    pubkey,
    chatsById,
    notifications,
    notificationCandidates,
    globalCommunityNotificationRows,
    globalCommunityApplicationRows,
    globalCommunityModerationRows,
    repoWatchNotificationRows,
    engagementNotificationRows,
  ],
  ([
    $pubkey,
    $chatsById,
    $notifications,
    $notificationCandidates,
    $globalCommunityNotificationRows,
    $globalCommunityApplicationRows,
    $globalCommunityModerationRows,
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
      ...$globalCommunityApplicationRows,
      ...$globalCommunityModerationRows,
      ...$repoWatchNotificationRows,
      ...$engagementNotificationRows,
    ]
    const excludedPaths = new Set(sourceRows.flatMap(row => [row.path, row.readPath]))

    if (chatRows.length > 0) excludedPaths.add("/chat")

    return sortNotificationRows([
      ...sourceRows,
      ...buildRouteNotificationRows({
        paths: $notifications,
        excludedPaths,
        candidates: $notificationCandidates,
        currentPubkey: $pubkey || undefined,
      }),
    ])
  },
)

export const getLatestNotificationCenterTimestamp = (rows: NotificationRow[]) =>
  rows.reduce((latest, row) => Math.max(latest, row.createdAt), 0)

export const latestNotificationCenterTimestamp = derived(
  notificationCenterRows,
  getLatestNotificationCenterTimestamp,
)

export const hasNotificationCenterUnread = derived(
  [latestNotificationCenterTimestamp, notificationReadState],
  ([$latestNotificationCenterTimestamp, $notificationReadState]) =>
    hasUnreadNotificationsState({
      latestNotificationTimestamp: $latestNotificationCenterTimestamp,
      lastReadTimestamp: $notificationReadState.lastReadTimestamp,
    }),
)
