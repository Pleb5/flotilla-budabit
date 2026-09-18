import {derived, get, readable, writable, type Readable} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {
  displayProfileByPubkey,
  getMutes,
  getPlaintext,
  getValidZap,
  pubkey,
  repository,
  tracker,
} from "@welshman/app"
import {request, type RequestOptions} from "@welshman/net"
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
  isRelayUrl,
  isReplaceable,
  matchFilters,
  normalizeRelayUrl,
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
  communityOutcomeContexts,
  mergeCommunityOutcomeContexts,
  rememberCommunityOutcomeContexts,
  makeCommunityOutcomeSources,
} from "@app/core/community-outcome-context"
import {
  activeExactCommunityPointer,
  activeExactCommunityDefinition,
  activeUserCommunityRefs,
  communityMemberDefinitionEvents,
  communityMemberReportDeleteEvents,
  communityMemberReportEvents,
  communityMemberProfileListEvents,
  communityModeratorProfileListEvents,
  makeCommunityAdmissionFormFilters,
  makeExactCommunityDefinitionFilter,
  makeCommunityProfileListFilters,
  makeCommunityReportDeleteFilters,
  makeCommunityReportFilters,
  makeCommunityReportReviewFilters,
} from "@app/core/community-state"
import {
  selectUserCommunityRefs,
  type ActiveUserCommunityRef,
  type UserCommunityReportStates,
} from "@app/core/community-membership"
import {
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  TARGETED_PUBLICATION_KIND,
  TARGETED_PUBLICATION_KINDS,
  normalizeCommunitySectionName,
  normalizePubkey,
  parseCommunityDefinition,
  parseCommunityDefinitionAddress,
  parseTargetedPublication,
  makeTargetedPublicationLifecycleFilters,
  selectTargetedPublicationLifecycleCandidates,
  selectCurrentTargetedPublicationEvents,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import {
  COMMUNITY_FORM_REVIEW_KIND,
  getAdmissionSubmissionState,
  isAdmissionResponseDeleted,
  parseAdmissionForm,
  parseAdmissionResponse,
  parseAdmissionReview,
  type CommunityAdmissionForm,
} from "@app/core/community-forms"
import {
  getPendingCommunityBadgeAwards,
  makeCommunityBadgeAwardDeleteFilters,
  makeCommunityBadgeAwardFilters,
  makeCommunityBadgeDefinitionFilters,
  selectCommunityBadgeDefinitions,
} from "@app/core/community-badges"
import {
  communityMembershipNotificationState,
  updateCommunityMembershipNotifications,
} from "@app/util/community-membership-notifications"
import {
  COMMUNITY_TARGETABLE_KINDS,
  eventTargetsCommunity,
  isRoomRoot,
  makeCommunityContentFilterPlan,
  makeCommunityExclusiveFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilterPlan,
} from "@app/core/community-feeds"
import {readCommunityCalendarEventReply} from "@app/core/community-calendar"
import {readCommunityRoomMessage} from "@app/core/community-messages"
import {readCommunityThread, readCommunityThreadReply} from "@app/core/community-threads"
import {
  COMMUNITY_CALENDAR_WRITE_TARGETS,
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getCommunityCalendarTargetWriterPubkeys,
  getCommunityCalendarWriteTargetSections,
  getGrantCapability,
  getGrantCapableSectionModeratorPubkeys,
  getCommunityWriteTarget,
  getCommunityWriteTargetSectionName,
  getCommunityWriteTargetSections,
  getCommunityTargetWriterPubkeys,
  type CommunityWriteTarget,
} from "@app/core/community-permissions"
import {
  canReviewCommunityContentReport,
  getEffectiveCommunityReportState,
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
import {
  repoWatchNotificationCandidates,
  repoWatchNotificationHistoryStatus,
} from "@app/util/repo-watch-notifications"
import {
  getInstalledWidgetUpdateNotificationId,
  installedWidgetUpdates,
  type InstalledWidgetUpdate,
} from "@app/extensions/widget-update-notifications"
import {hasUnreadNotificationRowsState, notificationReadState} from "@app/util/notification-center"
import {
  notificationHistoryFilterLimit,
  notificationHistorySince,
} from "@app/util/notification-history"
import {
  makeChatPath,
  getCommunityEventPath,
  getExactCommunityEventPath,
  getExactCommunityReportTargetPath,
  makeExactCommunityCalendarPath,
  makeExactCommunityGoalPath,
  makeExactCommunityPath,
  makeExactCommunityRoomPath,
  makeExactCommunityThreadPath,
  makeGitPath,
} from "@app/util/routes"
import {
  getAuthorRelayHints,
  getEventRelayHints,
  getEventTagRelayHints,
  getUserRelayHints,
  makeEventShareEntity,
  normalizeRelayHints,
} from "@app/util/event-links"
import {getTrimmedReplyPreview} from "@app/util/git-quote"
import {
  buildNotificationSearchText,
  dedupeNotificationRowsById,
  getNotificationSourceLabel,
  sortNotificationRows,
  type NotificationRow,
  type NotificationRowSource,
  type NotificationRowTarget,
  type NotificationRowType,
} from "@app/util/notification-display"
import {ROLE_NS} from "@app/util/labels"
import {createBackgroundLiveCoordinator} from "@app/core/background-live"
import {
  communityLiveOwnership,
  isCommunityLiveOwned,
  type CommunityLiveOwnership,
} from "@app/core/community-live"
import {notificationBackgroundEnabled} from "@app/util/notification-background"
import {userRenouncedCommunityAddresses} from "@app/core/community-renunciations"
import {
  getNotificationEventRelays,
  notificationEventRepository,
  queueNotificationEvent,
} from "@app/util/notification-events"
import {
  createBoundedCommunityHistoryLoader,
  makeSameAuthorDeleteFilters,
  type BoundedCommunityHistoryResult,
} from "@app/core/requests"

export type BuildChatNotificationRowsOptions = {
  chats: Iterable<Chat>
  getPlaintext?: (event: TrustedEvent) => string | undefined
}

export type BuildRouteNotificationRowsOptions = {
  paths: Iterable<string>
  excludedPaths?: Set<string>
  coveredAtByPath?: ReadonlyMap<string, number>
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
  outcomeDefinitionEvents?: TrustedEvent[]
  currentPubkey?: string
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  outcomeReportStates?: UserCommunityReportStates
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

export type BuildCommunityBadgeNotificationRowsOptions = {
  refs: ActiveUserCommunityRef[]
  currentPubkey?: string
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  badgeDefinitionEvents: TrustedEvent[]
  badgeAwardEvents: TrustedEvent[]
  badgeAwardDeleteEvents?: TrustedEvent[]
  mutedPubkeys?: string[]
}

export type BuildRepoWatchNotificationRowsOptions = {
  candidates: NotificationCandidate[]
}

export type BuildWidgetUpdateNotificationRowsOptions = {
  updates: InstalledWidgetUpdate[]
}

export type BuildEngagementNotificationRowsOptions = {
  events: TrustedEvent[]
  targetEvents?: TrustedEvent[]
  refs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
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

export type CommunityNotificationFilterSource = {
  communityAddress: string
  relays: string[]
  filters: Filter[]
  localFilters?: Filter[]
}

export type NotificationRelayFilterGroup = {
  relay: string
  scope?: string
  filters: Filter[]
  localFilters: Filter[]
  liveFilters: Filter[]
}

export type CommunityNotificationFilterPlan = {
  relayFilters: Filter[]
  localFilters: Filter[]
}

export type NotificationHistoryStatusController = {
  incomplete: Readable<boolean>
  start: (source: object, requestCount: number) => void
  resolve: (source: object, result: Pick<BoundedCommunityHistoryResult, "complete">) => void
  clear: (source: object) => void
}

const COMMUNITY_NOTIFICATION_LOAD_LIMIT = 200
const ENGAGEMENT_NOTIFICATION_LOAD_LIMIT = 200
const MAX_NOTIFICATION_OUTCOME_BOOTSTRAP_RELAYS = 12
const MAX_NOTIFICATION_OUTCOME_CONTEXT_RELAYS = 24
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
const COMMUNITY_TARGETABLE_KIND_SET = new Set<number>(COMMUNITY_TARGETABLE_KINDS)
const NOSTR_EVENT_ENTITY_RE = /\b(?:nostr:)?(?:nevent1|naddr1)[0-9a-z]+\b/gi
const NOSTR_PROFILE_ENTITY_RE = /\b(?:nostr:)?(?:nprofile1|npub1)[0-9a-z]+\b/gi

const normalizeNotificationRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const getNotificationFilterKey = (filter: Filter) =>
  JSON.stringify(Object.fromEntries(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))))

const dedupeNotificationFilters = (filters: Filter[]) =>
  Array.from(new Map(filters.map(filter => [getNotificationFilterKey(filter), filter])).values())

const getCommunityNotificationRelays = (ref: ActiveUserCommunityRef) =>
  Array.from(
    new Set(
      [...ref.definition.relays, ...ref.relayHints].map(normalizeNotificationRelay).filter(Boolean),
    ),
  )

const getCommunityProfileListRelays = (ref: ActiveUserCommunityRef) =>
  normalizeRelayHints(
    getCommunityNotificationRelays(ref),
    ref.definition.sections.flatMap(section =>
      section.profileLists.flatMap(profileList => (profileList.relay ? [profileList.relay] : [])),
    ),
  )

const getCommunityModerationRelays = (ref: ActiveUserCommunityRef) =>
  normalizeRelayHints(ref.definition.relays)

export const groupCommunityNotificationFiltersByRelay = (
  sources: CommunityNotificationFilterSource[],
  foregroundOwnership: CommunityLiveOwnership = new Set(),
  preserveCommunityScope = false,
): NotificationRelayFilterGroup[] => {
  const groupsByRelay = new Map<
    string,
    {
      relay: string
      scope?: string
      filters: Filter[]
      localFilters: Filter[]
      liveFilters: Filter[]
    }
  >()

  for (const source of sources) {
    const relays = source.relays.map(normalizeNotificationRelay).filter(Boolean)
    if (relays.length === 0 && source.filters.length > 0) {
      const scope = preserveCommunityScope ? source.communityAddress : undefined
      const key = JSON.stringify([scope, ""])
      const group = groupsByRelay.get(key) || {
        relay: "",
        scope,
        filters: [],
        localFilters: [],
        liveFilters: [],
      }
      group.filters.push(...source.filters)
      group.localFilters.push(...(source.localFilters || source.filters))
      groupsByRelay.set(key, group)
    }

    for (const relay of relays) {
      const scope = preserveCommunityScope ? source.communityAddress : undefined
      const key = JSON.stringify([scope, relay])
      const group = groupsByRelay.get(key) || {
        relay,
        scope,
        filters: [],
        localFilters: [],
        liveFilters: [],
      }
      group.filters.push(...source.filters)
      group.localFilters.push(...(source.localFilters || source.filters))
      if (!isCommunityLiveOwned(foregroundOwnership, source.communityAddress, relay)) {
        group.liveFilters.push(...source.filters)
      }
      groupsByRelay.set(key, group)
    }
  }

  return Array.from(groupsByRelay.values(), group => ({
    relay: group.relay,
    ...(group.scope ? {scope: group.scope} : {}),
    filters: dedupeNotificationFilters(group.filters),
    localFilters: dedupeNotificationFilters(group.localFilters),
    liveFilters: dedupeNotificationFilters(group.liveFilters),
  })).sort((a, b) => a.relay.localeCompare(b.relay) || (a.scope || "").localeCompare(b.scope || ""))
}

const getEventPreview = (event: TrustedEvent, plaintext: string | undefined) => {
  if (plaintext?.trim()) return plaintext.trim()
  if (event.content) return "Encrypted direct message"

  return "Direct message"
}

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

const hasReportStateEvidence = (
  states: UserCommunityReportStates | undefined,
  communityAddress: string,
) => Boolean(getReportState(states, communityAddress))

const getCommunityRef = (refs: ActiveUserCommunityRef[], communityId: string) =>
  refs.find(ref => ref.community.communityId === communityId)

const getCommunityDefinitionAddress = (ref: ActiveUserCommunityRef) => ref.community.address

const getCommunityDefinitionId = (ref: ActiveUserCommunityRef) => ref.community.communityId

const targetsCommunityDefinition = (event: TrustedEvent, ref: ActiveUserCommunityRef) =>
  Boolean(
    parseTargetedPublication(event)?.communities.some(
      community => community.address === getCommunityDefinitionAddress(ref),
    ),
  )

const hasCommunityDefinitionEvidence = (ref: ActiveUserCommunityRef) =>
  Boolean(ref.definition?.event?.id && ref.definition.pointer.address === ref.community.address)

const hasCommunitySectionEvidence = ({
  ref,
  sectionName,
  reportStates,
}: {
  ref: ActiveUserCommunityRef
  sectionName: string
  reportStates?: UserCommunityReportStates
}) => {
  if (!hasCommunityDefinitionEvidence(ref)) return false
  if (!hasReportStateEvidence(reportStates, ref.community.address)) return false

  const normalizedSectionName = normalizeCommunitySectionName(sectionName)
  const section = ref.definition.sections.find(
    candidate => normalizeCommunitySectionName(candidate.name) === normalizedSectionName,
  )

  return Boolean(section)
}

const getCommunityEventWriteTarget = (
  event: TrustedEvent,
  communityPubkey: string,
): CommunityWriteTarget | undefined => {
  if (!eventTargetsCommunity(event, communityPubkey)) return undefined
  if (event.kind === MESSAGE && readCommunityRoomMessage(event, communityPubkey)) {
    return COMMUNITY_WRITE_TARGETS.roomMessage
  }
  if (
    event.kind === COMMENT &&
    (readCommunityThreadReply(event, communityPubkey) ||
      readCommunityCalendarEventReply(event, communityPubkey) ||
      readCommunityGoalReply(event, communityPubkey))
  ) {
    return COMMUNITY_WRITE_TARGETS.comment
  }
  if (event.kind === REACTION) return COMMUNITY_WRITE_TARGETS.reaction
  if (event.kind === THREAD) {
    return isRoomRoot(event, communityPubkey)
      ? COMMUNITY_WRITE_TARGETS.roomRoot
      : readCommunityThread(event, communityPubkey)
        ? COMMUNITY_WRITE_TARGETS.thread
        : undefined
  }
}

const hasCommunityGrantEvidence = ({
  ref,
  target,
  profileListEvents,
  reportStates,
}: {
  ref: ActiveUserCommunityRef
  target: CommunityWriteTarget
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}) => {
  const sections = getCommunityWriteTargetSections(ref.definition, target)
  return (
    sections.length > 0 &&
    sections.every(section =>
      hasCommunitySectionEvidence({
        ref,
        sectionName: section.name,
        reportStates,
      }),
    )
  )
}

const hasCommunityCalendarGrantEvidence = ({
  ref,
  profileListEvents,
  reportStates,
}: {
  ref: ActiveUserCommunityRef
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}) => {
  const sections = getCommunityCalendarWriteTargetSections(ref.definition)

  return (
    sections.length > 0 &&
    sections.every(section =>
      hasCommunitySectionEvidence({
        ref,
        sectionName: section.name,
        reportStates,
      }),
    )
  )
}

const isCommunityEventAdmitted = ({
  event,
  ref,
  profileListEvents,
  reportStates,
  requireCompleteEvidence = false,
}: {
  event: TrustedEvent
  ref: ActiveUserCommunityRef
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  requireCompleteEvidence?: boolean
}) => {
  const target = getCommunityEventWriteTarget(event, ref.community.communityId)
  if (!target) return false
  if (
    requireCompleteEvidence &&
    !hasCommunityGrantEvidence({ref, target, profileListEvents, reportStates})
  ) {
    return false
  }

  return canWriteCommunityTarget({
    definition: ref.definition,
    profileListEvents,
    userPubkey: event.pubkey,
    target,
    reportState: getReportState(reportStates, ref.community.address),
  })
}

const isTargetableCommunityOriginalAdmitted = ({
  event,
  ref,
  targetingEvents,
  profileListEvents,
  reportStates,
  requireCompleteEvidence = false,
}: {
  event: TrustedEvent
  ref: ActiveUserCommunityRef
  targetingEvents: TrustedEvent[]
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  requireCompleteEvidence?: boolean
}) => {
  if (!COMMUNITY_TARGETABLE_KIND_SET.has(event.kind)) return false
  const target = getCommunityWriteTarget(event.kind)
  const hasGrantEvidence =
    event.kind === EVENT_DATE || event.kind === EVENT_TIME
      ? hasCommunityCalendarGrantEvidence({ref, profileListEvents, reportStates})
      : Boolean(target && hasCommunityGrantEvidence({ref, target, profileListEvents, reportStates}))
  if (requireCompleteEvidence && !hasGrantEvidence) {
    return false
  }

  const targets =
    event.kind === EVENT_DATE || event.kind === EVENT_TIME
      ? COMMUNITY_CALENDAR_WRITE_TARGETS
      : target
        ? [target]
        : []
  const authorizedTargetingEvents = targetingEvents.filter(targetingEvent => {
    const targeting = parseTargetedPublication(targetingEvent)
    return (
      targeting?.kind === event.kind &&
      targetsCommunityDefinition(targetingEvent, ref) &&
      targets.some(target =>
        canWriteCommunityTarget({
          definition: ref.definition,
          profileListEvents,
          userPubkey: targetingEvent.pubkey,
          target,
          reportState: getReportState(reportStates, ref.community.address),
        }),
      )
    )
  })
  const filters = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents).localFilters

  return filters.length > 0 && matchFilters(filters, event)
}

const isCommunityContextTargetAdmitted = ({
  event,
  ref,
  targetingEvents,
  profileListEvents,
  reportStates,
  requireCompleteEvidence = false,
}: {
  event: TrustedEvent
  ref: ActiveUserCommunityRef
  targetingEvents: TrustedEvent[]
  profileListEvents: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  requireCompleteEvidence?: boolean
}) =>
  COMMUNITY_TARGETABLE_KIND_SET.has(event.kind)
    ? isTargetableCommunityOriginalAdmitted({
        event,
        ref,
        targetingEvents,
        profileListEvents,
        reportStates,
        requireCompleteEvidence,
      })
    : isCommunityEventAdmitted({
        event,
        ref,
        profileListEvents,
        reportStates,
        requireCompleteEvidence,
      })

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
  focusEvent = true,
}: {
  label: string
  event?: TrustedEvent
  path?: string
  actionLabel?: string
  fallback?: string
  focusEvent?: boolean
}): NotificationRowTarget => ({
  label,
  preview: event ? getTextPreview(event, fallback || label) : fallback || label,
  path,
  eventId: focusEvent ? event?.id : undefined,
  event,
  actionLabel,
})

const getCommunityEventLabel = (event: TrustedEvent | undefined) => {
  if (!event) return "Context"
  if (event.kind === THREAD) return "Thread"

  return "Context"
}

const getRepoContextLabel = (path: string, event: TrustedEvent) => {
  if (path.includes("/prs"))
    return event.kind === GIT_COMMENT ? "Pull request comment" : "Pull request"
  if (path.includes("/issues")) return event.kind === GIT_COMMENT ? "Issue comment" : "Issue"

  return "Repository"
}

const getRepoAction = (event: TrustedEvent) => {
  if (event.kind === GIT_ISSUE) return "opened an issue"
  if (event.kind === GIT_PULL_REQUEST) return "opened a pull request"
  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "updated a pull request"
  if (event.kind === GIT_COMMENT) return "commented"
  if (event.kind === GIT_LABEL)
    return getRepoEventTitle(event) === "Git review request" ? "requested review" : "assigned you"
  if (GIT_STATUS_KINDS.includes(event.kind)) return "updated status"

  return "updated"
}

const uniqueStrings = (values: Iterable<string | undefined>) =>
  Array.from(
    new Set(
      Array.from(values)
        .map(value => String(value || "").trim())
        .filter(Boolean),
    ),
  )

const mapEventsById = (events: TrustedEvent[]) => new Map(events.map(event => [event.id, event]))

const getEventAddressRef = (event: TrustedEvent) => {
  if (!isReplaceable(event)) return ""

  try {
    return getAddress(event)
  } catch {
    return ""
  }
}

const getEventRefKeys = (event: TrustedEvent) =>
  uniqueStrings([event.id, getEventAddressRef(event)])

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

const selectCurrentCommunityDefinitions = (
  refs: ActiveUserCommunityRef[],
  definitionEvents: TrustedEvent[],
) => {
  const definitions = new Map<string, CommunityDefinition>()

  for (const ref of refs) definitions.set(getCommunityDefinitionAddress(ref), ref.definition)
  for (const event of definitionEvents) {
    const definition = parseCommunityDefinition(event)
    if (!definition) continue

    const address = definition.pointer.address
    const current = definitions.get(address)
    if (isPreferredEvent(definition.event, current?.event)) {
      definitions.set(address, definition)
    }
  }

  return definitions
}

const getCommunityEvidenceRef = (
  refs: ActiveUserCommunityRef[],
  definitions: Map<string, CommunityDefinition>,
  communityAddress: string,
) => {
  const definition = definitions.get(communityAddress)
  if (!definition) return undefined

  const activeRef = refs.find(ref => ref.community.address === communityAddress)
  if (activeRef?.definition.event.id === definition.event.id) return activeRef

  return {
    community: definition.pointer,
    definition,
    relayHints: definition.relays,
    roles: [],
    writableSections: [],
  } satisfies ActiveUserCommunityRef
}

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
    if (!form || form.community.address !== ref.community.address || !sectionName) continue

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

export const makeTargetingWrapperReplacementFilters = (events: TrustedEvent[]): Filter[] =>
  makeTargetedPublicationLifecycleFilters(events).filter(
    filter => filter.kinds?.[0] === TARGETED_PUBLICATION_KIND,
  )

export const selectCurrentTargetingWrapperEvents = (
  events: TrustedEvent[],
  deleteEvents: TrustedEvent[] = [],
) => selectCurrentTargetedPublicationEvents([...events, ...deleteEvents])

const getEventRefTags = (event: TrustedEvent, names: string[]) =>
  event.tags
    .filter(tag => names.includes(tag[0]))
    .map(tag => tag[1])
    .filter(Boolean)

const hasSingleTagValue = (
  event: TrustedEvent,
  name: string,
  value: string,
  normalize: (input: string) => string = input => input,
) => {
  const tags = event.tags.filter(tag => tag[0] === name)
  return tags.length === 1 && normalize(tags[0][1] || "") === normalize(value)
}

const hasSingleMarkedTagValue = (
  event: TrustedEvent,
  name: string,
  value: string,
  markerIndex: number,
  marker: string,
) => {
  const tags = event.tags.filter(tag => tag[0] === name && tag[markerIndex] === marker)
  return tags.length === 1 && tags[0][1] === value
}

const getReplyTargetRefs = (event: TrustedEvent) => {
  const {roots, replies} =
    event.kind === COMMENT ? getCommentTags(event.tags) : getReplyTags(event.tags)

  return uniqueStrings(
    [...replies, ...roots]
      .filter(tag => ["a", "e"].includes(tag[0].toLowerCase()))
      .map(tag => tag[1]),
  )
}

const getReactionTargetRefs = (event: TrustedEvent) =>
  uniqueStrings(getEventRefTags(event, ["e", "a"]))

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
        ? parsed.tags.filter(
            tag => Array.isArray(tag) && tag.every(value => typeof value === "string"),
          )
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
    parentReplyId:
      parentId && parentId !== goalId && parentKind !== String(ZAP_GOAL) ? parentId : "",
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

const getRepoNaddr = (event: TrustedEvent, relayHints: string[] = []) => {
  const address = getRepoAddress(event)
  if (!address) return ""

  try {
    const ref = Address.from(address)
    if (ref.kind !== GIT_REPO_ANNOUNCEMENT || !ref.pubkey || !ref.identifier) return ""
    return nip19.naddrEncode({
      kind: ref.kind,
      pubkey: ref.pubkey,
      identifier: ref.identifier,
      relays: normalizeRelayHints(relayHints),
    })
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
  if (!isGitEngagementEvent(event)) return undefined
  const section = getRepoNotificationSection(event)
  const repoNaddr = getRepoNaddr(event, getNotificationEventRelays(event.id))
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

  if (isGitEngagementEvent(event)) {
    return {
      source: "git",
      path: `/${makeEventShareEntity(event, {relays: getNotificationEventRelays(event.id)})}`,
    }
  }
}

const getTargetedOriginalCommunityPath = (
  event: TrustedEvent,
  community: CommunityPointer,
): string | undefined => {
  if (event.kind === EVENT_DATE || event.kind === EVENT_TIME) {
    return makeExactCommunityCalendarPath(community, event.id || getTagValue("d", event.tags))
  }
  if (event.kind === ZAP_GOAL) return makeExactCommunityGoalPath(community, event.id)
}

const getEngagementRowContext = ({
  event,
  target,
  currentPubkey,
  path,
  getContext = candidate => getEngagementEventContext(candidate, currentPubkey),
}: {
  event: TrustedEvent
  target?: TrustedEvent
  currentPubkey: string
  path?: string
  getContext?: (event: TrustedEvent) => EngagementNotificationContext | undefined
}): EngagementNotificationContext | undefined => {
  const eventContext = getContext(event)
  const targetContext = target ? getContext(target) : undefined
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
  if (target.kind === COMMENT)
    return isGitEngagementEvent(target) ? "your git comment" : "your comment"
  if (target.kind === THREAD) return "your thread"
  if (target.kind === MESSAGE) return "your message"

  return "your event"
}

const getReactionPreview = (events: TrustedEvent[], target: TrustedEvent) => {
  const reactions = uniqueStrings(
    events.map(event => event.content).filter(content => content && content !== "+"),
  )
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

const getImportantCommunityRootRow = ({
  event,
  ref,
  targetEventsById,
  targetEventsByRef,
  currentPubkey,
  admitTarget,
}: {
  event: TrustedEvent
  ref: ActiveUserCommunityRef
  targetEventsById: Map<string, TrustedEvent>
  targetEventsByRef: Map<string, TrustedEvent>
  currentPubkey: string
  admitTarget: (event: TrustedEvent) => boolean
}) => {
  const threadReply = readCommunityThreadReply(event, ref.community.communityId)
  if (threadReply) {
    const root = targetEventsById.get(threadReply.threadId)
    const rootThread = root ? readCommunityThread(root, ref.community.communityId) : undefined
    if (!root || !rootThread || !admitTarget(root)) return undefined
    const ownerPubkey = getCommunityRootOwnerPubkey({event, root})
    if (ownerPubkey !== currentPubkey) return undefined

    return {
      path: makeExactCommunityThreadPath(ref.community, threadReply.threadId),
      readPath: makeExactCommunityThreadPath(ref.community),
      title: "New thread comment",
      preview: getTextPreview(event, "Thread comment"),
      target: COMMUNITY_WRITE_TARGETS.comment,
      displayType: "reply" as NotificationRowType,
      action: "commented",
      contextLabel: "on your thread",
      targetEvent: root,
      targetLabel: "Your thread",
      detailLabel: "New thread comment",
      actionLabel: "Open thread comment",
    }
  }

  const calendarReply = readCommunityCalendarEventReply(event, ref.community.communityId)
  if (calendarReply) {
    const root =
      targetEventsByRef.get(calendarReply.calendarEventId) ||
      targetEventsByRef.get(calendarReply.calendarAddress)
    if (!root || !admitTarget(root)) return undefined
    const ownerPubkey = getCommunityRootOwnerPubkey({event, root})
    if (ownerPubkey !== currentPubkey) return undefined

    return {
      path: makeExactCommunityCalendarPath(ref.community, root.id || calendarReply.calendarEventId),
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

  const goalReply = readCommunityGoalReply(event, ref.community.communityId)
  if (goalReply) {
    const root =
      targetEventsByRef.get(goalReply.goalId) || targetEventsByRef.get(goalReply.goalAddress)
    if (!root || !admitTarget(root)) return undefined
    const ownerPubkey = getCommunityRootOwnerPubkey({event, root})
    if (ownerPubkey !== currentPubkey) return undefined

    const goalId = getAddressIdentifier(goalReply.goalAddress) || goalReply.goalId

    return {
      path: makeExactCommunityGoalPath(ref.community, goalId),
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

export const createNotificationHistoryStatusController =
  (): NotificationHistoryStatusController => {
    const statuses = writable(new Map<object, {pending: number; incomplete: boolean}>())
    const incomplete = derived(statuses, $statuses =>
      Array.from($statuses.values()).some(status => status.pending > 0 || status.incomplete),
    )

    return {
      incomplete,
      start: (source, requestCount) => {
        statuses.update(current => {
          const next = new Map(current)
          if (requestCount > 0) next.set(source, {pending: requestCount, incomplete: false})
          else next.delete(source)
          return next
        })
      },
      resolve: (source, result) => {
        statuses.update(current => {
          const status = current.get(source)
          if (!status) return current

          const next = new Map(current)
          next.set(source, {
            pending: Math.max(0, status.pending - 1),
            incomplete: status.incomplete || !result.complete,
          })
          return next
        })
      },
      clear: source => {
        statuses.update(current => {
          if (!current.has(source)) return current
          const next = new Map(current)
          next.delete(source)
          return next
        })
      },
    }
  }

const notificationHistoryStatusController = createNotificationHistoryStatusController()

export const isNotificationHistoryIncomplete = (
  notificationSourcesIncomplete: boolean,
  repoWatchStatus: {loading: boolean; complete: boolean; saturated: boolean},
) =>
  notificationSourcesIncomplete ||
  repoWatchStatus.loading ||
  !repoWatchStatus.complete ||
  repoWatchStatus.saturated

export const notificationHistoryIncomplete = derived(
  [notificationHistoryStatusController.incomplete, repoWatchNotificationHistoryStatus],
  ([$notificationSourcesIncomplete, $repoWatchStatus]) =>
    isNotificationHistoryIncomplete($notificationSourcesIncomplete, $repoWatchStatus),
)

export const createBoundedNotificationHistoryLoader = ({
  request: requestHistory,
  onEvent,
}: {
  request: (options: RequestOptions) => Promise<unknown>
  onEvent: (event: TrustedEvent, relay: string) => void
}) => {
  const relayByEventId = new Map<string, string>()

  return createBoundedCommunityHistoryLoader({
    request: requestHistory,
    track: (eventId, relay) => relayByEventId.set(eventId, relay),
    publish: event => {
      onEvent(event, relayByEventId.get(event.id) || "")
      relayByEventId.delete(event.id)
    },
  })
}

const notificationLiveCoordinator = createBackgroundLiveCoordinator({
  request,
  owner: "notification-background",
  onEvent: queueNotificationEvent,
  onError: (relay, error) => {
    console.warn(`[notification-sources] Failed to subscribe on ${relay}`, error)
  },
})

const loadBoundedNotificationHistory = createBoundedNotificationHistoryLoader({
  request,
  onEvent: queueNotificationEvent,
})

type LoadedNotificationEvents = {
  events: TrustedEvent[]
  loading: boolean
  complete: boolean
  completeRelays: Set<string>
  completeScopes: Set<string>
}

export const areNotificationAuthorityLoadsComplete = (
  loads: Array<Pick<LoadedNotificationEvents, "complete">>,
) => loads.every(load => load.complete)

const isNotificationCommunitySourceComplete = (
  communityAddress: string,
  sources: CommunityNotificationFilterSource[],
  load: LoadedNotificationEvents,
) => {
  const communitySources = sources.filter(source => source.communityAddress === communityAddress)
  if (communitySources.length === 0) return false

  return communitySources.every(source => {
    if (source.filters.length === 0) return true
    const relays = source.relays.map(normalizeNotificationRelay).filter(Boolean)
    return (
      relays.length > 0 &&
      relays.every(relay => load.completeScopes.has(`${communityAddress}:${relay}`))
    )
  })
}

const deriveLoadedNotificationEventGroupsWithStatus = ({
  groups,
  label,
}: {
  groups: Readable<NotificationRelayFilterGroup[]>
  label: string
}) =>
  readable<LoadedNotificationEvents>(
    {
      events: [],
      loading: false,
      complete: false,
      completeRelays: new Set(),
      completeScopes: new Set(),
    },
    set => {
      let filtersKey = ""
      let networkKey = ""
      let generation = 0
      let cachedEvents: TrustedEvent[] = []
      const loadedEventsById = new Map<string, TrustedEvent>()
      let loading = false
      let complete = false
      let completeRelays = new Set<string>()
      let completeScopes = new Set<string>()
      let completeGroupKeys = new Set<string>()
      const controllersByRelay = new Map<string, AbortController>()
      let unsubscribeEvents: (() => void) | undefined
      const liveSource = {}
      let catchUpSource: object | undefined
      const emit = () =>
        set({
          events: dedupeTrustedEvents([...cachedEvents, ...loadedEventsById.values()]),
          loading,
          complete,
          completeRelays,
          completeScopes,
        })

      const stopRelaySubscriptions = () => {
        generation += 1
        for (const controller of controllersByRelay.values()) {
          controller.abort()
        }
        controllersByRelay.clear()
        notificationLiveCoordinator.clear(liveSource)
        if (catchUpSource) notificationHistoryStatusController.clear(catchUpSource)
        catchUpSource = undefined
      }

      const getGroupKey = (group: NotificationRelayFilterGroup) =>
        JSON.stringify({...group, relay: normalizeNotificationRelay(group.relay)})

      const updateCompletion = (currentGroups: NotificationRelayFilterGroup[]) => {
        const completedGroups = currentGroups.filter(group =>
          completeGroupKeys.has(getGroupKey(group)),
        )
        complete = currentGroups.length > 0 && completedGroups.length === currentGroups.length
        completeRelays = new Set(
          completedGroups.map(group => normalizeNotificationRelay(group.relay)),
        )
        completeScopes = new Set(
          completedGroups.map(
            group => `${group.scope || ""}:${normalizeNotificationRelay(group.relay)}`,
          ),
        )
      }

      const unsubscribe = derived(
        [groups, notificationBackgroundEnabled],
        ([$groups, $enabled]) => ({
          groups: $groups,
          enabled: $enabled,
        }),
      ).subscribe(({groups, enabled}) => {
        const filters = dedupeNotificationFilters(groups.flatMap(group => group.localFilters))
        const nextFiltersKey = filters.map(getNotificationFilterKey).sort().join("|")
        const nextNetworkKey = JSON.stringify({enabled, groups})
        if (nextNetworkKey === networkKey) return
        networkKey = nextNetworkKey
        const completionGroups = groups.filter(
          group => group.filters.length > 0 && group.localFilters.length > 0,
        )
        const validGroups = completionGroups.filter(group => {
          const url = normalizeNotificationRelay(group.relay)
          return Boolean(url)
        })
        const relaylessGroupCount = completionGroups.length - validGroups.length
        const nextGroupKeys = new Set(completionGroups.map(getGroupKey))
        completeGroupKeys = new Set(
          Array.from(completeGroupKeys).filter(key => nextGroupKeys.has(key)),
        )
        stopRelaySubscriptions()
        for (const [eventId, event] of loadedEventsById) {
          if (!matchFilters(filters, event)) loadedEventsById.delete(eventId)
        }
        loading = false
        updateCompletion(completionGroups)
        emit()

        if (nextFiltersKey !== filtersKey) {
          unsubscribeEvents?.()
          unsubscribeEvents = undefined
          filtersKey = nextFiltersKey

          if (filters.length > 0) {
            // Foreground community subscriptions own live coverage on active routes.
            // Read their matching events too; background history stays in its isolated store.
            unsubscribeEvents = derived(
              [
                deriveEventsAsc(
                  deriveEventsById({repository: notificationEventRepository, filters}),
                ),
                deriveEventsAsc(deriveEventsById({repository, filters})),
              ],
              ([$backgroundEvents, $foregroundEvents]) =>
                dedupeTrustedEvents([...$backgroundEvents, ...$foregroundEvents]),
            ).subscribe(loadedEvents => {
              cachedEvents = loadedEvents
              emit()
            })
          } else {
            cachedEvents = []
          }
        }

        if (filters.length === 0) {
          completeGroupKeys = new Set()
          loading = false
          complete = true
          completeRelays = new Set()
          completeScopes = new Set()
          emit()
          return
        }

        if (!enabled) {
          completeGroupKeys = new Set()
          loading = false
          complete = false
          emit()
          return
        }

        if (validGroups.length === 0) {
          catchUpSource = {}
          notificationHistoryStatusController.start(catchUpSource, relaylessGroupCount)
          for (let index = 0; index < relaylessGroupCount; index += 1) {
            notificationHistoryStatusController.resolve(catchUpSource, {complete: false})
          }
          loading = false
          complete = false
          emit()
          return
        }

        const liveByRelay = new Map<string, Filter[]>()
        for (const group of validGroups) {
          const url = normalizeNotificationRelay(group.relay)
          liveByRelay.set(url, [...(liveByRelay.get(url) || []), ...group.liveFilters])
        }
        for (const [relay, liveFilters] of liveByRelay) {
          notificationLiveCoordinator.set(liveSource, relay, dedupeNotificationFilters(liveFilters))
        }

        const loadGroups = validGroups.filter(group => !completeGroupKeys.has(getGroupKey(group)))
        if (loadGroups.length === 0) {
          if (relaylessGroupCount > 0) {
            catchUpSource = {}
            notificationHistoryStatusController.start(catchUpSource, relaylessGroupCount)
            for (let index = 0; index < relaylessGroupCount; index += 1) {
              notificationHistoryStatusController.resolve(catchUpSource, {complete: false})
            }
          }
          loading = false
          updateCompletion(completionGroups)
          emit()
          return
        }

        catchUpSource = {}
        const currentCatchUpSource = catchUpSource
        const currentGeneration = generation
        notificationHistoryStatusController.start(
          currentCatchUpSource,
          loadGroups.length + relaylessGroupCount,
        )
        for (let index = 0; index < relaylessGroupCount; index += 1) {
          notificationHistoryStatusController.resolve(currentCatchUpSource, {complete: false})
        }
        loading = true
        updateCompletion(completionGroups)
        emit()

        const loads = loadGroups.map(async (group, index) => {
          const url = normalizeNotificationRelay(group.relay)
          const controller = new AbortController()
          controllersByRelay.set(`${group.scope || index}:${url}`, controller)
          try {
            const result = await loadBoundedNotificationHistory({
              relays: [url],
              relayFilters: group.filters,
              localFilters: group.localFilters,
              signal: controller.signal,
              owner: notificationLiveCoordinator.owner,
              timeoutMs: 5_000,
            })
            if (currentGeneration === generation) {
              for (const event of result.events) loadedEventsById.set(event.id, event)
              if (result.complete) completeGroupKeys.add(getGroupKey(group))
              else completeGroupKeys.delete(getGroupKey(group))
              updateCompletion(completionGroups)
              emit()
            }
            notificationHistoryStatusController.resolve(currentCatchUpSource, result)
            return {
              relay: url,
              scopeKey: `${group.scope || ""}:${url}`,
              groupKey: getGroupKey(group),
              complete: result.complete,
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              notificationHistoryStatusController.resolve(currentCatchUpSource, {complete: false})
              console.warn(`[notification-sources] Failed to load ${label}`, error)
            }
            return {
              relay: url,
              scopeKey: `${group.scope || ""}:${url}`,
              groupKey: getGroupKey(group),
              complete: false,
            }
          }
        })

        void Promise.all(loads).then(results => {
          if (currentGeneration !== generation) return
          loading = false
          for (const result of results) {
            if (result.complete) completeGroupKeys.add(result.groupKey)
            else completeGroupKeys.delete(result.groupKey)
          }
          updateCompletion(completionGroups)
          emit()
        })
      })

      return () => {
        stopRelaySubscriptions()
        unsubscribeEvents?.()
        unsubscribe()
      }
    },
  )

const deriveLoadedNotificationEventGroups = (options: {
  groups: Readable<NotificationRelayFilterGroup[]>
  label: string
}) => derived(deriveLoadedNotificationEventGroupsWithStatus(options), $load => $load.events)

const makeNotificationRelayGroups = (filters: Filter[], relays: string[]) => {
  const normalizedRelays = Array.from(
    new Set(relays.map(normalizeNotificationRelay).filter(Boolean)),
  )
  const groupRelays =
    normalizedRelays.length > 0 ? normalizedRelays : filters.length > 0 ? [""] : []

  return groupRelays.map(relay => ({
    relay,
    filters,
    localFilters: filters,
    liveFilters: relay ? filters : [],
  }))
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
  deriveLoadedNotificationEventGroups({
    groups: derived([filters, relays], ([$filters, $relays]) =>
      makeNotificationRelayGroups($filters, $relays),
    ),
    label,
  })

const deriveLoadedNotificationEventsWithStatus = ({
  filters,
  relays,
  label,
}: {
  filters: Readable<Filter[]>
  relays: Readable<string[]>
  label: string
}) =>
  deriveLoadedNotificationEventGroupsWithStatus({
    groups: derived([filters, relays], ([$filters, $relays]) =>
      makeNotificationRelayGroups($filters, $relays),
    ),
    label,
  })

const makeExactAddressFilters = (addresses: Iterable<string>, expectedKind: number) =>
  uniqueStrings(addresses).flatMap(address => {
    try {
      const ref = Address.from(address)
      const pubkey = normalizePubkey(ref.pubkey || "")
      if (ref.kind !== expectedKind || !pubkey || !ref.identifier) return []

      return [
        {
          kinds: [ref.kind],
          authors: [pubkey],
          "#d": [ref.identifier],
          limit: 1,
        } satisfies Filter,
      ]
    } catch {
      return []
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
  const targetingEvents = selectCurrentTargetingWrapperEvents(
    [...events, ...targetEvents].filter(event => event.kind === TARGETED_PUBLICATION_KIND),
    [...events, ...targetEvents].filter(event => event.kind === DELETE),
  )

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
    focusEvent = true,
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
    focusEvent?: boolean
  }) => {
    if (!path) return
    if (normalizedCurrentPubkey && normalizePubkey(event.pubkey) === normalizedCurrentPubkey) return
    if (muted.has(normalizePubkey(event.pubkey))) return
    if (target && !hasCommunityGrantEvidence({ref, target, profileListEvents, reportStates})) {
      return
    }

    const reportState = getReportState(reportStates, ref.community.address)
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
      navigationEventId: focusEvent ? event.id : undefined,
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
        focusEvent,
      }),
      createdAt: event.created_at,
      searchText: buildNotificationSearchText(
        "community",
        title,
        preview,
        event.pubkey,
        ref.community.address,
        path,
      ),
    })
  }

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.community.address)
    const admitTarget = (targetEvent: TrustedEvent) =>
      isCommunityContextTargetAdmitted({
        event: targetEvent,
        ref,
        targetingEvents,
        profileListEvents,
        reportStates,
        requireCompleteEvidence: true,
      })

    for (const event of events) {
      const message = readCommunityRoomMessage(event, ref.community.communityId)
      if (message) {
        const parentMessage = message.parentMessageId
          ? targetEventsById.get(message.parentMessageId)
          : undefined
        const parentRoomMessage = parentMessage
          ? readCommunityRoomMessage(parentMessage, ref.community.communityId, message.roomRootId)
          : undefined
        const isReplyToViewer =
          normalizedCurrentPubkey &&
          message.parentMessageId &&
          parentMessage &&
          parentRoomMessage &&
          admitTarget(parentMessage) &&
          normalizePubkey(parentMessage.pubkey) === normalizedCurrentPubkey

        if (isReplyToViewer) {
          addRow({
            ref,
            event,
            path: makeExactCommunityRoomPath(ref.community, message.roomRootId),
            title: "New room reply",
            preview: getTextPreview(event, "Room message"),
            target: COMMUNITY_WRITE_TARGETS.roomMessage,
            displayType: "reply",
            action: "replied",
            contextLabel: "in a room",
            targetEvent: parentMessage,
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
            path: makeExactCommunityRoomPath(ref.community, message.roomRootId),
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

      const threadReply = readCommunityThreadReply(event, ref.community.communityId)
      if (threadReply) {
        const parentReply = threadReply.parentReplyId
          ? targetEventsById.get(threadReply.parentReplyId)
          : undefined
        const parentThreadReply = parentReply
          ? readCommunityThreadReply(parentReply, ref.community.communityId, threadReply.threadId)
          : undefined
        const isReplyToViewer =
          normalizedCurrentPubkey &&
          threadReply.parentReplyId &&
          parentReply &&
          parentThreadReply &&
          admitTarget(parentReply) &&
          normalizePubkey(parentReply.pubkey) === normalizedCurrentPubkey

        if (isReplyToViewer) {
          addRow({
            ref,
            event,
            path: makeExactCommunityThreadPath(ref.community, threadReply.threadId),
            readPath: makeExactCommunityThreadPath(ref.community),
            title: "New thread comment reply",
            preview: getTextPreview(event, "Thread comment reply"),
            target: COMMUNITY_WRITE_TARGETS.comment,
            displayType: "reply",
            action: "replied",
            contextLabel: "to your comment",
            targetEvent: parentReply,
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
          admitTarget,
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
            path: makeExactCommunityThreadPath(ref.community, threadReply.threadId),
            readPath: makeExactCommunityThreadPath(ref.community),
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
          admitTarget,
        })
        if (importantRootRow) {
          addRow({ref, event, ...importantRootRow})
          continue
        }
      }
    }

    if (normalizedCurrentPubkey && reportState) {
      for (const report of reportState.personReports) {
        if (normalizePubkey(report.targetPubkey || "") !== normalizedCurrentPubkey) continue
        if (!report.event) continue

        addRow({
          ref,
          event: report.event,
          path: makeExactCommunityPath(ref.community, "access"),
          title: "Community ban",
          preview: report.event.content || "You were banned from this community.",
          sectionName: "moderation",
          displayType: "community",
          action: "moderated you",
          contextLabel: "Community moderation",
          detailLabel: "Ban notice",
          actionLabel: "Open access settings",
          focusEvent: false,
        })
      }

      for (const report of reportState.eventReports) {
        if (normalizePubkey(report.targetPubkey || "") !== normalizedCurrentPubkey) continue
        if (!report.event) continue

        addRow({
          ref,
          event: report.event,
          path:
            getExactCommunityReportTargetPath(ref.community, report) ||
            makeExactCommunityPath(ref.community, "moderation"),
          title: "Content moderated",
          preview:
            report.targetEventTitle ||
            report.targetEventContent ||
            report.event.content ||
            "Your content was moderated.",
          sectionName: report.sectionName || "moderation",
          displayType: "community",
          action: "moderated your content",
          contextLabel: "Community moderation",
          detailLabel: "Moderation notice",
          actionLabel: "Open moderated content",
          focusEvent: false,
        })
      }
    }
  }

  return sortNotificationRows(Array.from(rowsById.values()))
}

export const buildCommunityApplicationNotificationRows = ({
  refs,
  outcomeDefinitionEvents = [],
  currentPubkey,
  profileListEvents = [],
  reportStates,
  outcomeReportStates = reportStates,
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
  const currentDefinitions = selectCurrentCommunityDefinitions(refs, outcomeDefinitionEvents)

  for (const event of dedupedFormEvents) {
    const form = parseAdmissionForm(event)
    const current = form ? formsByAddress.get(form.address) : undefined
    if (form && isPreferredEvent(form.event, current?.event)) formsByAddress.set(form.address, form)
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
    const reportState = getReportState(reportStates, ref.community.address)
    if (!reportState) continue
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
      const path = makeExactCommunityPath(ref.community, "moderation")

      for (const event of dedupedResponseEvents) {
        const response = parseAdmissionResponse(event)
        if (!response || response.formAddress !== form.address) continue
        if (isCommunityPersonBanned(reportState, response.event.pubkey)) continue

        const submission = getAdmissionSubmissionState({
          community: form.community,
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

  const responsesById = new Map(
    dedupedResponseEvents.flatMap(event => {
      const response = parseAdmissionResponse(event)
      return response ? [[event.id, response] as const] : []
    }),
  )
  const admittedOutcomes = dedupedReviewEvents.flatMap(event => {
    const review = parseAdmissionReview(event)
    const applicantPubkey = normalizePubkey(review?.applicantPubkey || "")
    if (!review || applicantPubkey !== normalizedCurrentPubkey) return []
    if (!review.formAddress || !review.sectionName) return []

    const form = formsByAddress.get(review.formAddress)
    const ref = getCommunityEvidenceRef(refs, currentDefinitions, review.community.address)
    const response = responsesById.get(review.responseId)
    if (!form || !ref || !response) return []
    if (isAdmissionResponseDeleted(response, dedupedDeleteEvents)) return []
    if (form.address !== review.formAddress || response.formAddress !== form.address) return []
    if (normalizePubkey(response.event.pubkey) !== normalizedCurrentPubkey) return []
    if (form.community.address !== review.community.address) return []

    const sectionName = normalizeCommunitySectionName(review.sectionName)
    if (!sectionName || normalizeCommunitySectionName(form.sectionName || "") !== sectionName) {
      return []
    }
    const communityAddress = review.community.address
    if (
      !hasSingleMarkedTagValue(event, "e", response.event.id, 4, "response") ||
      !hasSingleTagValue(event, "p", normalizedCurrentPubkey, normalizePubkey) ||
      !hasSingleMarkedTagValue(event, "a", form.address, 3, "form") ||
      !hasSingleTagValue(event, "h", review.community.communityId) ||
      !hasSingleTagValue(event, "k", String(FORM_RESPONSE_KIND)) ||
      !hasSingleTagValue(event, "content", sectionName, normalizeCommunitySectionName) ||
      !hasSingleMarkedTagValue(form.event, "a", communityAddress, 3, "community") ||
      !hasSingleTagValue(form.event, "content", sectionName, normalizeCommunitySectionName) ||
      !hasSingleMarkedTagValue(response.event, "a", form.address, 3, "form")
    ) {
      return []
    }
    if (
      !hasCommunitySectionEvidence({
        ref,
        sectionName,
        reportStates: outcomeReportStates,
      })
    ) {
      return []
    }

    const moderatorPubkeys = getGrantCapableSectionModeratorPubkeys({
      definition: ref.definition,
      sectionName,
      profileListEvents,
      reportState: getReportState(outcomeReportStates, ref.community.address),
    })
    if (!moderatorPubkeys.includes(normalizePubkey(form.pubkey))) return []
    if (!moderatorPubkeys.includes(normalizePubkey(event.pubkey))) return []

    return [{event, review, form, community: ref.community}]
  })

  for (const {event, review, form, community} of admittedOutcomes) {
    const accepted = review.status === "granted"
    const revoked =
      !accepted &&
      admittedOutcomes.some(
        candidate =>
          candidate.review.responseId === review.responseId &&
          candidate.review.status === "granted" &&
          candidate.event.created_at < event.created_at,
      )

    addRow({
      id: `community-application-review:${event.id}`,
      event,
      path: makeExactCommunityPath(community, "access"),
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
      targetEvent: form.event,
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

export const buildCommunityBadgeNotificationRows = ({
  refs,
  currentPubkey,
  profileListEvents = [],
  reportStates,
  badgeDefinitionEvents,
  badgeAwardEvents,
  badgeAwardDeleteEvents = [],
  mutedPubkeys = [],
}: BuildCommunityBadgeNotificationRowsOptions): NotificationRow[] => {
  const viewer = normalizePubkey(currentPubkey || "")
  if (!viewer) return []
  const muted = new Set(mutedPubkeys.map(normalizePubkey))

  return sortNotificationRows(
    refs.flatMap(ref => {
      const reportState = getReportState(reportStates, ref.community.address)
      if (!reportState) return []
      const path = makeExactCommunityPath(ref.community, "badges")
      // Acceptance doesn't erase award history or make an already-read award new.
      return getPendingCommunityBadgeAwards({
        definition: ref.definition,
        profileListEvents,
        reportState,
        badgeDefinitionEvents,
        badgeAwardEvents,
        badgeAwardDeleteEvents,
        profileBadgeEvents: [],
        profilePubkey: viewer,
      })
        .filter(({award}) => !muted.has(award.event.pubkey))
        .map(({definition, award}) => ({
          id: `community-badge:${award.event.id}`,
          eventId: award.event.id,
          actorPubkey: award.event.pubkey,
          source: "community" as const,
          sourceLabel: "Communities",
          type: "community" as const,
          title: "Community badge awarded",
          preview: `You were awarded ${definition.name}.`,
          action: "awarded you a badge",
          contextLabel: definition.name,
          actionLabel: "View community badges",
          path,
          readPath: path,
          expandable: false,
          createdAt: award.event.created_at,
          searchText: buildNotificationSearchText(
            "badge",
            definition.name,
            definition.description,
            ref.definition.metadata.name,
            award.event.pubkey,
          ),
        }))
    }),
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
    const reportState = getReportState(reportStates, ref.community.address)
    if (!reportState) continue
    const moderationPath = makeExactCommunityPath(ref.community, "moderation")
    const contentReports = getCommunityContentReports({
      definition: ref.definition,
      reportEvents: dedupedReportEvents,
      reviewEvents: dedupedReportReviewEvents,
      deleteEvents: dedupedReportDeleteEvents,
      profileListEvents,
      reportState,
    })

    for (const report of contentReports) {
      const targetPath = getExactCommunityReportTargetPath(ref.community, report) || moderationPath
      const preview =
        report.targetEventTitle || report.targetEventContent || "Community content was reported."

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
        const targetPath =
          getExactCommunityReportTargetPath(ref.community, report) || moderationPath
        const preview =
          report.targetEventTitle || report.targetEventContent || "Community content was moderated."
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
          if (normalizePubkey(contentReport.reporterPubkey || "") !== normalizedCurrentPubkey)
            continue

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
        const targetsCurrentUser =
          normalizePubkey(report.targetPubkey || "") === normalizedCurrentPubkey
        if (!targetsCurrentUser && ref.roles.length === 0) continue

        addRow({
          id: `${targetsCurrentUser ? "community-ban-user" : "community-ban-member"}:${report.event.id}`,
          event: report.event,
          path: makeExactCommunityPath(ref.community, "access"),
          title: targetsCurrentUser ? "Community ban" : "Member banned",
          preview:
            report.event.content ||
            (targetsCurrentUser
              ? "You were banned from this community."
              : "A member was banned from this community."),
          action: targetsCurrentUser ? "banned you" : "banned a member",
          contextLabel: "Community moderation",
          detailLabel: "Ban notice",
          actionLabel: targetsCurrentUser ? "Open community access" : "Open access settings",
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

const isRepoNotificationRelayHintEvent = (event: TrustedEvent) => {
  if (
    event.kind === GIT_ISSUE ||
    event.kind === GIT_PULL_REQUEST ||
    event.kind === GIT_PULL_REQUEST_UPDATE ||
    event.kind === GIT_COMMENT ||
    GIT_STATUS_KINDS.includes(event.kind)
  ) {
    return true
  }

  if (event.kind !== GIT_LABEL) return false
  return event.tags.some(
    tag =>
      tag[0] === "l" &&
      (tag[1] === "assignee" || tag[1] === "reviewer") &&
      tag[2] === ROLE_NS &&
      tag[3] !== "del",
  )
}

export const addRepoNotificationRelayHints = (
  path: string,
  event: TrustedEvent,
  relayHints: string[] = [],
) => {
  if (!isRepoNotificationRelayHintEvent(event)) return path

  const relays = normalizeRelayHints(relayHints)
  if (relays.length === 0) return path

  const match = path.match(/^\/git\/([^/]+)\/(issues|prs)(.*)$/)
  if (!match) return path

  try {
    const decoded = nip19.decode(match[1])
    if (decoded.type !== "naddr" || decoded.data.kind !== GIT_REPO_ANNOUNCEMENT) return path

    const naddr = nip19.naddrEncode({...decoded.data, relays})
    return `/git/${naddr}/${match[2]}${match[3]}`
  } catch {
    return path
  }
}

export const buildRepoWatchNotificationRows = ({
  candidates,
}: BuildRepoWatchNotificationRowsOptions): NotificationRow[] => {
  // Multiple watch candidates (e.g. the same repo watched under different paths)
  // can share a latestEvent — dedupe so row ids stay unique.
  return sortNotificationRows(
    dedupeNotificationRowsById(
      candidates.flatMap(candidate => {
        const event = candidate.latestEvent
        if (!event) return []

        const title = getRepoEventTitle(event)
        const preview = getTextPreview(event, title)
        const navigationBasePath = addRepoNotificationRelayHints(candidate.path, event, [
          ...(candidate.repoRelayHints || []),
          ...Array.from(tracker.getRelays(event.id) || []),
          ...getNotificationEventRelays(event.id),
        ])
        const path = getRepoRowPath(navigationBasePath, event)
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
            createdAt: event.created_at,
            searchText: buildNotificationSearchText(
              "git",
              title,
              preview,
              event.pubkey,
              candidate.path,
            ),
          } satisfies NotificationRow,
        ]
      }),
    ),
  )
}

const getWidgetUpdateName = (update: InstalledWidgetUpdate) =>
  update.latest.content || update.installed.content || update.latest.identifier || "Smart Widget"

const getWidgetUpdateSummary = (update: InstalledWidgetUpdate) => {
  const diff = update.diff
  const summary: string[] = []

  if (diff.version?.from || diff.version?.to) {
    summary.push(`Version ${diff.version.from || "current"} -> ${diff.version.to || "latest"}`)
  }
  if (diff.appUrlChanged) summary.push("App URL changed")
  if (diff.widgetTypeChanged) summary.push("Widget type changed")
  if (diff.slotChanged) summary.push("Slot changed")
  if (diff.permissionsAdded.length) summary.push(`Adds ${diff.permissionsAdded.join(", ")}`)
  if (diff.permissionsRemoved.length) summary.push(`Removes ${diff.permissionsRemoved.join(", ")}`)
  if (summary.length === 0) summary.push("New widget publication")

  return summary
}

export const buildWidgetUpdateNotificationRows = ({
  updates,
}: BuildWidgetUpdateNotificationRowsOptions): NotificationRow[] =>
  sortNotificationRows(
    updates.map(update => {
      const title = "Widget update available"
      const name = getWidgetUpdateName(update)
      const version = update.diff.version?.to
      const summary = getWidgetUpdateSummary(update)
      const preview = [
        `${name}${version ? ` v${version}` : ""} is available.`,
        update.diff.changelog || summary.join(". "),
      ]
        .filter(Boolean)
        .join(" ")

      return {
        id: getInstalledWidgetUpdateNotificationId(update),
        actorPubkey: update.latest.pubkey,
        source: "widget",
        sourceLabel: getNotificationSourceLabel("widget"),
        type: "widget",
        title,
        preview,
        action: "published an update for",
        actionLabel: "Review widget update",
        contextLabel: name,
        path: "/settings/extensions",
        readPath: "/settings/extensions",
        detail: {
          label: "Update details",
          preview: [summary.join("\n"), update.diff.changelog].filter(Boolean).join("\n\n"),
          path: "/settings/extensions",
          actionLabel: "Review widget update",
        },
        createdAt: update.latest.created_at || update.installed.created_at || 0,
        searchText: buildNotificationSearchText(
          "widget",
          title,
          name,
          preview,
          update.latest.pubkey,
          update.latest.identifier,
          update.id,
        ),
      } satisfies NotificationRow
    }),
  )

export const buildEngagementNotificationRows = ({
  events,
  targetEvents = [],
  refs = [],
  profileListEvents = [],
  reportStates,
  currentPubkey,
  mutedPubkeys = [],
  validZapResponseIds,
}: BuildEngagementNotificationRowsOptions): NotificationRow[] => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!normalizedCurrentPubkey) return []

  const muted = new Set(mutedPubkeys.map(normalizePubkey).filter(Boolean))
  const targetingEvents = selectCurrentTargetingWrapperEvents(
    targetEvents.filter(event => event.kind === TARGETED_PUBLICATION_KIND),
    targetEvents.filter(event => event.kind === DELETE),
  )
  const targetEventsByRef = mapEventsByRef(targetEvents)
  const rows: NotificationRow[] = []
  const reactionGroups = new Map<string, {target: TrustedEvent; events: TrustedEvent[]}>()
  const zapGroups = new Map<string, {target: TrustedEvent; events: TrustedEvent[]}>()

  const getDirectCommunityId = (event: TrustedEvent) => {
    if (COMMUNITY_TARGETABLE_KIND_SET.has(event.kind)) return ""
    if (![THREAD, MESSAGE, COMMENT, REACTION].includes(event.kind)) return ""

    return getTagValue("h", event.tags) || ""
  }
  const getDirectCommunityEventRef = (event: TrustedEvent) => {
    const communityId = getDirectCommunityId(event)
    return communityId ? getCommunityRef(refs, communityId) : undefined
  }
  const getTargetedOriginalRef = (event: TrustedEvent) => {
    if (!COMMUNITY_TARGETABLE_KIND_SET.has(event.kind)) return undefined

    return refs.find(ref =>
      isTargetableCommunityOriginalAdmitted({
        event,
        ref,
        targetingEvents,
        profileListEvents,
        reportStates,
        requireCompleteEvidence: true,
      }),
    )
  }
  const getCommunityContextRef = (event: TrustedEvent) =>
    getDirectCommunityEventRef(event) || getTargetedOriginalRef(event)
  const admitTarget = (target: TrustedEvent) => {
    const directCommunityId = getDirectCommunityId(target)
    if (directCommunityId) {
      const ref = getDirectCommunityEventRef(target)
      return Boolean(
        ref &&
        isCommunityEventAdmitted({
          event: target,
          ref,
          profileListEvents,
          reportStates,
          requireCompleteEvidence: true,
        }),
      )
    }
    if (COMMUNITY_TARGETABLE_KIND_SET.has(target.kind)) {
      return Boolean(getTargetedOriginalRef(target))
    }

    return true
  }
  const admitEngagementEvent = (event: TrustedEvent, target?: TrustedEvent) => {
    const directCommunityId = getDirectCommunityId(event)
    const eventRef = getDirectCommunityEventRef(event)
    const targetRef = target ? getCommunityContextRef(target) : undefined
    if (directCommunityId && !eventRef) return false
    if (eventRef && targetRef && eventRef.community.address !== targetRef.community.address)
      return false

    const ref = eventRef || targetRef
    if (!ref) return true
    if (event.kind === ZAP_RESPONSE) return true

    const writeTarget =
      event.kind === COMMENT
        ? COMMUNITY_WRITE_TARGETS.comment
        : event.kind === REACTION
          ? COMMUNITY_WRITE_TARGETS.reaction
          : undefined
    if (!writeTarget) return true
    if (!hasCommunityGrantEvidence({ref, target: writeTarget, profileListEvents, reportStates})) {
      return false
    }

    return canWriteCommunityTarget({
      definition: ref.definition,
      profileListEvents,
      userPubkey: event.pubkey,
      target: writeTarget,
      reportState: getReportState(reportStates, ref.community.address),
    })
  }
  const getAdmittedContext = (event: TrustedEvent): EngagementNotificationContext | undefined => {
    const directCommunityId = getDirectCommunityId(event)
    if (directCommunityId) {
      const ref = getDirectCommunityEventRef(event)
      if (!ref || !admitTarget(event)) return undefined
      const path = getExactCommunityEventPath(event, ref.community)
      return path ? {source: "community", path} : undefined
    }
    if (COMMUNITY_TARGETABLE_KIND_SET.has(event.kind)) {
      const ref = getTargetedOriginalRef(event)
      const path = ref ? getTargetedOriginalCommunityPath(event, ref.community) : undefined
      return path ? {source: "community", path} : undefined
    }

    return getEngagementEventContext(event, normalizedCurrentPubkey)
  }

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
      getContext: getAdmittedContext,
    })
    if (!rowContext) return

    const targetPath = target ? getAdmittedContext(target)?.path : undefined

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
      const target = getOwnedTarget(
        getReplyTargetRefs(event),
        targetEventsByRef,
        normalizedCurrentPubkey,
      )

      if (target) {
        if (!admitTarget(target) || !admitEngagementEvent(event, target)) continue
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
        (getReplyTargetRefs(event).length === 0 ||
          contentMentionsPubkey(event, normalizedCurrentPubkey)) &&
        admitEngagementEvent(event)
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
        if (!admitTarget(target) || !admitEngagementEvent(event, target)) continue
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
      const target = getOwnedTarget(
        getReactionTargetRefs(event),
        targetEventsByRef,
        normalizedCurrentPubkey,
      )
      if (target && admitTarget(target) && admitEngagementEvent(event, target)) {
        addGroupedEvent(reactionGroups, "reaction", event, target)
      }
      continue
    }

    if (event.kind === ZAP_RESPONSE) {
      if (validZapResponseIds && !validZapResponseIds.has(event.id)) continue

      const target = getOwnedTarget(
        getZapTargetRefs(event),
        targetEventsByRef,
        normalizedCurrentPubkey,
      )
      if (target && admitTarget(target) && admitEngagementEvent(event, target)) {
        addGroupedEvent(zapGroups, "zap", event, target)
      }
    }
  }

  for (const [key, group] of reactionGroups) {
    const groupEvents = [...group.events].sort((a, b) => b.created_at - a.created_at)
    const [latestEvent] = groupEvents
    const rowContext = getEngagementRowContext({
      event: latestEvent,
      target: group.target,
      currentPubkey: normalizedCurrentPubkey,
      getContext: getAdmittedContext,
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
      getContext: getAdmittedContext,
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
        ...groupEvents.flatMap(event => [
          event.pubkey,
          getEngagementActorPubkey(event),
          getZapComment(event),
        ]),
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
):
  | Pick<NotificationRow, "type" | "title" | "preview" | "action" | "contextLabel" | "actionLabel">
  | undefined => {
  if (!event || !path.includes("/access") || event.kind !== REACTION) return undefined
  if (event.content !== "+" && event.content !== "-") return undefined

  const isAccepted = event.content === "+"
  const isPublishingReview = event.tags.some(
    tag => tag[0] === "k" && tag[1] === String(FORM_RESPONSE_KIND),
  )

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
):
  | Pick<NotificationRow, "type" | "title" | "preview" | "action" | "contextLabel" | "actionLabel">
  | undefined => {
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  if (!event || !normalizedCurrentPubkey) return undefined

  const accessDisplay = getCommunityAccessRouteCandidateDisplay(event, path)
  if (accessDisplay) return accessDisplay

  if (
    path.endsWith("/admin") &&
    event.tags.some(tag => tag[0] === "role" && tag[1] === "moderator-request")
  ) {
    return {
      type: "community",
      title: "New moderator request",
      preview: "Someone requested a moderator role in your community.",
      action: "requested a moderator role in",
      contextLabel: "your community",
      actionLabel: "Review moderator request",
    }
  }

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

    return {
      type: "community",
      title: "New room message",
      preview: getTextPreview(event, "Room message"),
      action: "posted",
      contextLabel: "in a room",
      actionLabel: "Open room message",
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
  coveredAtByPath,
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

    if (
      !current ||
      (candidateEvent && (!currentEvent || isPreferredEvent(candidateEvent, currentEvent)))
    ) {
      candidatesByPath.set(candidate.path, candidate)
    }
  }

  // Reading a workflow notice must not remove the row while the center is open.
  const centerPaths = new Set(paths)
  for (const candidate of candidates) {
    if (
      candidate.retainInCenter &&
      candidate.latestEvent &&
      candidate.latestEvent.pubkey !== currentPubkey
    ) {
      centerPaths.add(candidate.path)
    }
  }
  for (const path of Array.from(centerPaths).sort()) {
    if (!path) continue

    const candidateEvent = candidatesByPath.get(path)?.latestEvent
    const coveredAt = coveredAtByPath?.get(path)
    if (
      excludedPaths.has(path) &&
      (coveredAt === undefined || coveredAt >= (candidateEvent?.created_at || 0))
    ) {
      continue
    }

    const source = getRouteNotificationSource(path)
    if (!source) continue

    const communityDisplay =
      source === "community"
        ? getCommunityRouteCandidateDisplay(candidateEvent, currentPubkey, path)
        : undefined
    const title = communityDisplay?.title || getRouteNotificationTitle(source)
    const preview = communityDisplay?.preview || getRouteNotificationPreview(source)
    const actionLabel = communityDisplay?.actionLabel || "Open activity"

    rows.push({
      id: candidateEvent ? `route:${path}:${candidateEvent.id}` : `route:${path}`,
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
      detail: {
        label: title,
        preview,
        path,
        event: candidateEvent,
        actionLabel,
      },
      createdAt: candidateEvent?.created_at || 0,
      searchText: buildNotificationSearchText(source, title, preview, path),
    })
  }

  return sortNotificationRows(rows)
}

export const buildGlobalCommunityNotificationFilterPlan = ({
  refs,
  profileListEvents = [],
  currentPubkey,
  reportStates,
  since,
  limit,
}: BuildGlobalCommunityNotificationFiltersOptions): CommunityNotificationFilterPlan => {
  const relayFilters: Filter[] = []
  const localFilters: Filter[] = []
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey || "")
  const boundedLimit = Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, limit)

  for (const ref of refs) {
    const reportState = getReportState(reportStates, ref.community.address)
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

    const messageFilters = [
      makeCommunityExclusiveFilter(ref.community.communityId, [MESSAGE], {
        since,
        limit: boundedLimit,
      }),
    ]
    const commentFilters = [
      makeCommunityExclusiveFilter(ref.community.communityId, [COMMENT], {
        since,
        limit: boundedLimit,
      }),
    ]

    if (normalizedCurrentPubkey) {
      messageFilters.push(
        makeCommunityExclusiveFilter(ref.community.communityId, [MESSAGE], {
          "#p": [normalizedCurrentPubkey],
          since,
          limit: boundedLimit,
        }),
      )
      commentFilters.push(
        makeCommunityExclusiveFilter(ref.community.communityId, [COMMENT], {
          "#p": [normalizedCurrentPubkey],
          since,
          limit: boundedLimit,
        }),
      )
    }

    relayFilters.push(...messageFilters, ...commentFilters)
    if (
      hasCommunityGrantEvidence({
        ref,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        profileListEvents,
        reportStates,
      })
    ) {
      localFilters.push(...makeCommunityContentFilterPlan(messageFilters, roomAuthors).localFilters)
    }
    if (
      hasCommunityGrantEvidence({
        ref,
        target: COMMUNITY_WRITE_TARGETS.comment,
        profileListEvents,
        reportStates,
      })
    ) {
      localFilters.push(
        ...makeCommunityContentFilterPlan(commentFilters, commentAuthors).localFilters,
      )
    }
  }

  return {relayFilters, localFilters}
}

export const buildGlobalCommunityNotificationFilters = (
  options: BuildGlobalCommunityNotificationFiltersOptions,
) => buildGlobalCommunityNotificationFilterPlan(options).relayFilters

const makeCommunityNotificationGroups = (
  sources: Readable<CommunityNotificationFilterSource[]>,
  preserveCommunityScope = false,
) =>
  derived([sources, communityLiveOwnership], ([$sources, $ownership]) =>
    groupCommunityNotificationFiltersByRelay($sources, $ownership, preserveCommunityScope),
  )

export const buildNotificationCommunitySeedRefs = ({
  refs,
  definitionEvents,
  renouncedCommunityAddresses,
}: {
  refs: ActiveUserCommunityRef[]
  definitionEvents: TrustedEvent[]
  renouncedCommunityAddresses: string[]
}) => {
  const renounced = new Set(renouncedCommunityAddresses)
  const refsByAddress = new Map(
    refs
      .filter(ref => !renounced.has(ref.community.address))
      .map(ref => [ref.community.address, ref]),
  )
  const definitions = selectCurrentCommunityDefinitions(refs, definitionEvents)

  for (const definition of definitions.values()) {
    if (renounced.has(definition.pointer.address)) continue
    const address = definition.pointer.address
    if (refsByAddress.has(address)) continue
    refsByAddress.set(address, {
      community: definition.pointer,
      definition,
      relayHints: definition.relays,
      roles: [],
      writableSections: [],
    })
  }

  return Array.from(refsByAddress.values())
}

export const selectActiveNotificationCommunityRefs = (
  refs: ActiveUserCommunityRef[],
  activeCommunity: CommunityPointer | undefined,
) => (activeCommunity ? refs.filter(ref => ref.community.address === activeCommunity.address) : [])

const globalCommunitySeedRefs: Readable<ActiveUserCommunityRef[]> = derived(
  [
    pubkey,
    activeUserCommunityRefs,
    activeExactCommunityPointer,
    activeExactCommunityDefinition,
    communityMemberDefinitionEvents,
    userRenouncedCommunityAddresses,
  ],
  ([
    $pubkey,
    $refs,
    $activeCommunity,
    $activeDefinition,
    $definitionEvents,
    $renouncedCommunityAddresses,
  ]) =>
    $pubkey
      ? selectActiveNotificationCommunityRefs(
          buildNotificationCommunitySeedRefs({
            refs: $refs,
            definitionEvents: [
              ...$definitionEvents,
              ...($activeDefinition &&
              $activeDefinition.pointer.address === $activeCommunity?.address
                ? [$activeDefinition.event]
                : []),
            ],
            renouncedCommunityAddresses: $renouncedCommunityAddresses,
          }),
          $activeCommunity,
        )
      : [],
)

const globalCommunityDefinitionSources = derived(globalCommunitySeedRefs, $refs =>
  $refs.map(ref => ({
    communityAddress: ref.community.address,
    relays: getCommunityNotificationRelays(ref),
    filters: [makeExactCommunityDefinitionFilter(ref.community)],
  })),
)

const globalCommunityDefinitionLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityDefinitionSources, true),
  label: "global community definitions",
})

const globalCommunityEvidenceRefs: Readable<ActiveUserCommunityRef[]> = derived(
  [globalCommunitySeedRefs, globalCommunityDefinitionLoad],
  ([$refs, $load]) => {
    const definitions = selectCurrentCommunityDefinitions($refs, $load.events)

    return $refs.flatMap(ref => {
      const definition = definitions.get(getCommunityDefinitionAddress(ref))
      return definition
        ? [
            {
              ...ref,
              definition,
              relayHints: normalizeRelayHints(ref.relayHints, definition.relays),
            },
          ]
        : []
    })
  },
)

const globalCommunityProfileListSources = derived(globalCommunityEvidenceRefs, $refs =>
  $refs.map(ref => ({
    communityAddress: ref.community.address,
    relays: getCommunityProfileListRelays(ref),
    filters: makeCommunityProfileListFilters(ref.definition),
  })),
)

const globalCommunityProfileListLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityProfileListSources, true),
  label: "global community profile lists",
})

const globalCommunityLoadedProfileListEvents = derived(
  globalCommunityProfileListLoad,
  $load => $load.events,
)

const globalCommunityProfileListEvents = derived(
  [
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    globalCommunityLoadedProfileListEvents,
  ],
  ([$memberProfileListEvents, $moderatorProfileListEvents, $loadedProfileListEvents]) =>
    dedupeTrustedEvents([
      ...$memberProfileListEvents,
      ...$moderatorProfileListEvents,
      ...$loadedProfileListEvents,
    ]),
)

const globalCommunityReportSources = derived(globalCommunityEvidenceRefs, $refs =>
  $refs.map(ref => ({
    communityAddress: ref.community.address,
    relays: getCommunityModerationRelays(ref),
    filters: makeCommunityReportFilters(ref.community),
  })),
)

const globalCommunityReportLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityReportSources, true),
  label: "global community reports",
})

const globalCommunityReportEvents = derived(
  [communityMemberReportEvents, globalCommunityReportLoad],
  ([$cachedEvents, $load]) => dedupeTrustedEvents([...$cachedEvents, ...$load.events]),
)

const globalCommunityReportDeleteSources = derived(
  [globalCommunityEvidenceRefs, globalCommunityReportEvents],
  ([$refs, $events]) =>
    $refs.map(ref => ({
      communityAddress: ref.community.address,
      relays: getCommunityModerationRelays(ref),
      filters: makeCommunityReportDeleteFilters(
        $events.filter(event => eventTargetsCommunity(event, ref.community.communityId)),
      ),
    })),
)

const globalCommunityReportDeleteLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityReportDeleteSources, true),
  label: "global community report deletes",
})

const globalCommunityReportDeleteEvents = derived(
  [communityMemberReportDeleteEvents, globalCommunityReportDeleteLoad],
  ([$cachedEvents, $load]) => dedupeTrustedEvents([...$cachedEvents, ...$load.events]),
)

const globalCommunityReportStates: Readable<Map<string, EffectiveCommunityReportState>> = derived(
  [
    globalCommunityEvidenceRefs,
    globalCommunityDefinitionSources,
    globalCommunityDefinitionLoad,
    globalCommunityProfileListSources,
    globalCommunityProfileListLoad,
    globalCommunityReportSources,
    globalCommunityReportLoad,
    globalCommunityReportDeleteSources,
    globalCommunityReportDeleteLoad,
    globalCommunityProfileListEvents,
    globalCommunityReportEvents,
    globalCommunityReportDeleteEvents,
  ],
  ([
    $refs,
    $definitionSources,
    $definitions,
    $profileListSources,
    $profileLists,
    $reportSources,
    $reports,
    $reportDeleteSources,
    $reportDeletes,
    $profileListEvents,
    $reportEvents,
    $deleteEvents,
  ]) => {
    const states = new Map<string, EffectiveCommunityReportState>()

    for (const ref of $refs) {
      const communityAddress = ref.community.address
      const complete = [
        [$definitionSources, $definitions],
        [$profileListSources, $profileLists],
        [$reportSources, $reports],
        [$reportDeleteSources, $reportDeletes],
      ].every(([sources, load]) =>
        isNotificationCommunitySourceComplete(
          communityAddress,
          sources as CommunityNotificationFilterSource[],
          load as LoadedNotificationEvents,
        ),
      )
      if (!complete) continue

      states.set(
        communityAddress,
        getEffectiveCommunityReportState({
          community: ref.community,
          definition: ref.definition,
          profileListEvents: $profileListEvents,
          reportEvents: $reportEvents,
          deleteEvents: $deleteEvents,
        }),
      )
    }

    return states
  },
)

const membershipNotificationsReady = readable(false, set => {
  let active = true
  void communityMembershipNotificationState.ready.then(() => {
    if (active) set(true)
  })
  return () => {
    active = false
  }
})

const globalCommunityMembershipRows = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    membershipNotificationsReady,
  ],
  ([$pubkey, $refs, $profileListEvents, $reportStates, $ready]) => {
    if (!$pubkey || !$ready) return []
    const completeRefs = $refs.filter(ref => $reportStates.has(ref.community.address))
    const previous = get(communityMembershipNotificationState)
    const state = completeRefs.reduce(
      (state, ref) =>
        updateCommunityMembershipNotifications(
          state,
          $pubkey,
          [ref],
          $profileListEvents.filter(
            event =>
              !isCommunityPersonBanned($reportStates.get(ref.community.address), event.pubkey),
          ),
        ),
      previous,
    )
    if (state !== previous) communityMembershipNotificationState.set(state)
    const addresses = new Set(completeRefs.map(ref => ref.community.address))
    const muted = new Set(getMutes($pubkey))
    return (state[$pubkey]?.rows || []).filter(
      row =>
        addresses.has(row.communityAddress) &&
        !muted.has(row.actorPubkey || "") &&
        !isCommunityPersonBanned($reportStates.get(row.communityAddress), row.actorPubkey || ""),
    )
  },
)

const globalCommunityBadgeDefinitionSources = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
  ],
  ([$pubkey, $refs, $profileListEvents, $reportStates]) =>
    $pubkey
      ? $refs
          .filter(ref => $reportStates.has(ref.community.address))
          .map(ref => ({
            communityAddress: ref.community.address,
            relays: getCommunityNotificationRelays(ref),
            filters: makeCommunityBadgeDefinitionFilters({
              definition: ref.definition,
              profileListEvents: $profileListEvents,
              reportState: $reportStates.get(ref.community.address),
            }),
          }))
      : [],
)
const globalCommunityBadgeDefinitionLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityBadgeDefinitionSources, true),
  label: "community badge definitions",
})
const globalCommunityBadgeAwardSources = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    globalCommunityBadgeDefinitionLoad,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([$pubkey, $refs, $profileListEvents, $reportStates, $definitions, $since, $limit]) =>
    $pubkey
      ? $refs
          .filter(ref => $reportStates.has(ref.community.address))
          .map(ref => ({
            communityAddress: ref.community.address,
            relays: getCommunityNotificationRelays(ref),
            filters: makeCommunityBadgeAwardFilters({
              definitions: selectCommunityBadgeDefinitions({
                definition: ref.definition,
                badgeDefinitionEvents: $definitions.events,
                profileListEvents: $profileListEvents,
                reportState: $reportStates.get(ref.community.address),
              }),
              recipientPubkey: $pubkey,
              limit: $limit,
            }).map(filter => ({...filter, since: $since})),
          }))
      : [],
)
const globalCommunityBadgeAwardLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityBadgeAwardSources, true),
  label: "community badge awards",
})
const globalCommunityBadgeDeleteSources = derived(
  [globalCommunityBadgeAwardSources, globalCommunityBadgeAwardLoad],
  ([$sources, $awards]) =>
    $sources.map(source => ({
      ...source,
      filters: makeCommunityBadgeAwardDeleteFilters(
        $awards.events.filter(event =>
          event.tags.some(
            tag => tag[0] === "a" && tag[1] === source.communityAddress && tag[3] === "community",
          ),
        ),
      ),
    })),
)
const globalCommunityBadgeDeleteLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityBadgeDeleteSources, true),
  label: "community badge award deletions",
})
const globalCommunityBadgeRows = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    globalCommunityBadgeDefinitionSources,
    globalCommunityBadgeDefinitionLoad,
    globalCommunityBadgeAwardSources,
    globalCommunityBadgeAwardLoad,
    globalCommunityBadgeDeleteSources,
    globalCommunityBadgeDeleteLoad,
  ],
  ([
    $pubkey,
    $refs,
    $profileListEvents,
    $reportStates,
    $definitionSources,
    $definitions,
    $awardSources,
    $awards,
    $deleteSources,
    $deletes,
  ]) =>
    buildCommunityBadgeNotificationRows({
      refs: $refs.filter(
        ref =>
          isNotificationCommunitySourceComplete(
            ref.community.address,
            $definitionSources,
            $definitions,
          ) &&
          isNotificationCommunitySourceComplete(ref.community.address, $awardSources, $awards) &&
          isNotificationCommunitySourceComplete(ref.community.address, $deleteSources, $deletes),
      ),
      currentPubkey: $pubkey,
      profileListEvents: $profileListEvents,
      reportStates: $reportStates,
      badgeDefinitionEvents: $definitions.events,
      badgeAwardEvents: $awards.events,
      badgeAwardDeleteEvents: $deletes.events,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    }),
)

const notificationCommunityRefs: Readable<ActiveUserCommunityRef[]> = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
  ],
  ([$pubkey, $refs, $profileListEvents, $reportStates]) =>
    $pubkey
      ? selectUserCommunityRefs({
          author: $pubkey,
          definitionEvents: $refs.map(ref => ref.definition.event),
          profileListEvents: $profileListEvents,
          reportStates: $reportStates,
        })
      : [],
)

const globalCommunityNotificationSources = derived(
  [
    pubkey,
    notificationCommunityRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([
    $pubkey,
    $refs,
    $profileListEvents,
    $reportStates,
    $notificationHistorySince,
    $notificationHistoryFilterLimit,
  ]) => {
    return $refs.map(ref => {
      const plan = buildGlobalCommunityNotificationFilterPlan({
        refs: [ref],
        profileListEvents: $profileListEvents,
        currentPubkey: $pubkey || undefined,
        reportStates: $reportStates,
        since: $notificationHistorySince,
        limit: $notificationHistoryFilterLimit,
      })

      return {
        communityAddress: ref.community.address,
        relays: getCommunityNotificationRelays(ref),
        filters: plan.relayFilters,
        localFilters: plan.localFilters,
      }
    })
  },
)

const globalCommunityNotificationGroups = makeCommunityNotificationGroups(
  globalCommunityNotificationSources,
)

const globalCommunityNotificationEvents = deriveLoadedNotificationEventGroups({
  groups: globalCommunityNotificationGroups,
  label: "global community notifications",
})

const globalCommunityAdmissionFormSources = derived(notificationCommunityRefs, $refs =>
  $refs.map(ref => {
    return {
      communityAddress: ref.community.address,
      relays: getCommunityNotificationRelays(ref),
      filters: makeCommunityAdmissionFormFilters(ref.definition),
    }
  }),
)

const globalCommunityAdmissionFormLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityAdmissionFormSources, true),
  label: "global community admission forms",
})

const globalCommunityAdmissionFormEvents = derived(
  globalCommunityAdmissionFormLoad,
  $load => $load.events,
)

const globalCommunityAdmissionResponseSources = derived(
  [
    notificationCommunityRefs,
    globalCommunityAdmissionFormEvents,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([$refs, $events, $notificationHistorySince, $notificationHistoryFilterLimit]) =>
    $refs.map(ref => {
      const addresses = uniqueStrings(
        $events
          .map(event => parseAdmissionForm(event))
          .filter(form => form?.community.address === ref.community.address)
          .map(form => form?.address || ""),
      )

      return {
        communityAddress: ref.community.address,
        relays: getCommunityNotificationRelays(ref),
        filters: addresses.length
          ? [
              {
                kinds: [FORM_RESPONSE_KIND],
                "#a": addresses,
                since: $notificationHistorySince,
                limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
              },
            ]
          : [],
      }
    }),
)

const globalCommunityAdmissionResponseLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityAdmissionResponseSources, true),
  label: "global community admission responses",
})

const globalCommunityAdmissionResponseEvents = derived(
  globalCommunityAdmissionResponseLoad,
  $load => $load.events,
)

const globalCommunityAdmissionDecisionSources = derived(
  [
    notificationCommunityRefs,
    globalCommunityAdmissionFormEvents,
    globalCommunityAdmissionResponseEvents,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([$refs, $forms, $events, $notificationHistorySince, $notificationHistoryFilterLimit]) => {
    const communityByFormAddress = new Map(
      $forms.flatMap(event => {
        const form = parseAdmissionForm(event)
        return form ? [[form.address, form.community.address] as const] : []
      }),
    )

    return $refs.map(ref => {
      const responseIds = uniqueStrings(
        $events
          .filter(
            event =>
              communityByFormAddress.get(parseAdmissionResponse(event)?.formAddress || "") ===
              ref.community.address,
          )
          .map(event => event.id),
      )

      return {
        communityAddress: ref.community.address,
        relays: getCommunityNotificationRelays(ref),
        filters: responseIds.length
          ? [
              {
                kinds: [DELETE, COMMUNITY_FORM_REVIEW_KIND],
                "#e": responseIds,
                since: $notificationHistorySince,
                limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
              },
            ]
          : [],
      }
    })
  },
)

const globalCommunityAdmissionDecisionLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityAdmissionDecisionSources, true),
  label: "global community admission decisions",
})

const globalCommunityAdmissionDecisionEvents = derived(
  globalCommunityAdmissionDecisionLoad,
  $load => $load.events,
)

const globalCommunityAdmissionCompletePubkeys = derived(
  [
    notificationCommunityRefs,
    globalCommunityDefinitionSources,
    globalCommunityDefinitionLoad,
    globalCommunityProfileListSources,
    globalCommunityProfileListLoad,
    globalCommunityReportSources,
    globalCommunityReportLoad,
    globalCommunityReportDeleteSources,
    globalCommunityReportDeleteLoad,
    globalCommunityAdmissionFormSources,
    globalCommunityAdmissionFormLoad,
    globalCommunityAdmissionResponseSources,
    globalCommunityAdmissionResponseLoad,
    globalCommunityAdmissionDecisionSources,
    globalCommunityAdmissionDecisionLoad,
  ],
  ([$refs, ...$sourceLoads]) => {
    const pairs = Array.from(
      {length: $sourceLoads.length / 2},
      (_, index) =>
        [
          $sourceLoads[index * 2] as CommunityNotificationFilterSource[],
          $sourceLoads[index * 2 + 1] as LoadedNotificationEvents,
        ] as const,
    )

    return new Set(
      $refs
        .filter(ref =>
          pairs.every(([sources, load]) =>
            isNotificationCommunitySourceComplete(ref.community.address, sources, load),
          ),
        )
        .map(ref => ref.community.address),
    )
  },
)

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

const legacyCommunityApplicationOutcomeLoad = deriveLoadedNotificationEventsWithStatus({
  filters: communityApplicationOutcomeFilters,
  relays: communityApplicationOutcomeRelays,
  label: "community application outcomes",
})

const legacyCommunityApplicationOutcomeEvents = derived(
  legacyCommunityApplicationOutcomeLoad,
  $load => $load.events,
)

const localApplicantResponses = derived(
  pubkey,
  ($pubkey, set) => {
    if (!$pubkey) return set([])
    return deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey]}]}),
    ).subscribe(set)
  },
  [] as TrustedEvent[],
)

const applicantCommunityContexts = derived(
  [pubkey, activeUserCommunityRefs, localApplicantResponses, communityOutcomeContexts],
  ([$pubkey, $refs, $responses, $retained]) => {
    if (!$pubkey) return []
    const additions = [
      ...$refs.map(ref => ({address: ref.community.address, relays: ref.definition.relays})),
      ...$responses.flatMap(event => {
        const response = parseAdmissionResponse(event)
        return response
          ? [{address: response.community.address, relays: response.community.relayHints}]
          : []
      }),
    ]
    void rememberCommunityOutcomeContexts($pubkey, additions).catch(error => {
      console.warn("[notifications] Failed to retain application context", error)
    })
    return mergeCommunityOutcomeContexts($retained[$pubkey] || [], additions)
  },
)

const getOutcomeWorkflowRelays = (definition: CommunityDefinition) =>
  normalizeRelayHints(definition.relays).slice(0, MAX_NOTIFICATION_OUTCOME_CONTEXT_RELAYS)

const getOutcomeAuthorityRelays = (definition: CommunityDefinition) =>
  normalizeRelayHints(
    definition.sections.flatMap(section =>
      section.profileLists.flatMap(profileList => (profileList.relay ? [profileList.relay] : [])),
    ),
    definition.relays,
  ).slice(0, MAX_NOTIFICATION_OUTCOME_CONTEXT_RELAYS)

const getOutcomeReviews = (events: TrustedEvent[], communityAddress: string) =>
  events.filter(event => parseAdmissionReview(event)?.community.address === communityAddress)

const communityApplicationOutcomeDefinitionBootstrapSources = derived(
  [legacyCommunityApplicationOutcomeEvents, applicantCommunityContexts],
  ([$events, $contexts]) => {
    const acceptedRelays = new Set<string>()
    const sources: CommunityNotificationFilterSource[] = $contexts.map(context => ({
      communityAddress: context.address,
      relays: context.relays,
      filters: [
        makeExactCommunityDefinitionFilter(parseCommunityDefinitionAddress(context.address)!),
      ],
    }))

    for (const event of $events) {
      const community = parseAdmissionReview(event)?.community
      if (!community) continue
      const relays = normalizeRelayHints(getEventTagRelayHints(event)).filter(relay => {
        if (acceptedRelays.has(relay)) return true
        if (acceptedRelays.size >= MAX_NOTIFICATION_OUTCOME_BOOTSTRAP_RELAYS) return false
        acceptedRelays.add(relay)
        return true
      })
      if (relays.length === 0) continue
      sources.push({
        communityAddress: community.address,
        relays,
        filters: [makeExactCommunityDefinitionFilter(community)],
      })
    }

    return sources
  },
)

const communityApplicationOutcomeDefinitionBootstrapLoad =
  deriveLoadedNotificationEventGroupsWithStatus({
    groups: makeCommunityNotificationGroups(
      communityApplicationOutcomeDefinitionBootstrapSources,
      true,
    ),
    label: "community application outcome definition bootstrap",
  })

const communityApplicationOutcomeBootstrapDefinitions = derived(
  communityApplicationOutcomeDefinitionBootstrapLoad,
  $load => Array.from(selectCurrentCommunityDefinitions([], $load.events).values()),
)

const communityApplicationOutcomeDefinitionRefreshSources = derived(
  communityApplicationOutcomeBootstrapDefinitions,
  $definitions =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: [makeExactCommunityDefinitionFilter(definition.pointer)],
    })),
)

const communityApplicationOutcomeDefinitionRefreshLoad =
  deriveLoadedNotificationEventGroupsWithStatus({
    groups: makeCommunityNotificationGroups(
      communityApplicationOutcomeDefinitionRefreshSources,
      true,
    ),
    label: "community application outcome definition refresh",
  })

const communityApplicationOutcomeDefinitions = derived(
  [
    communityApplicationOutcomeBootstrapDefinitions,
    communityApplicationOutcomeDefinitionRefreshSources,
    communityApplicationOutcomeDefinitionRefreshLoad,
  ],
  ([$bootstrapDefinitions, $sources, $load]) => {
    const definitions = selectCurrentCommunityDefinitions(
      [],
      dedupeTrustedEvents([
        ...$bootstrapDefinitions.map(definition => definition.event),
        ...$load.events,
      ]),
    )

    return Array.from(definitions.values()).filter(definition =>
      isNotificationCommunitySourceComplete(definition.pointer.address, $sources, $load),
    )
  },
)

const communityApplicationOutcomeDefinitionEvents = derived(
  communityApplicationOutcomeDefinitions,
  $definitions => $definitions.map(definition => definition.event),
)

const communityApplicationOutcomeSources = derived(
  [
    pubkey,
    communityApplicationOutcomeDefinitions,
    notificationHistorySince,
    notificationHistoryFilterLimit,
  ],
  ([$pubkey, $definitions, since, limit]) =>
    makeCommunityOutcomeSources({
      account: $pubkey,
      definitions: $definitions,
      since,
      limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, limit),
    }),
)

const communityApplicationOutcomeLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeSources, true),
  label: "community-scoped application outcomes",
})

const communityApplicationOutcomeEvents = derived(
  [legacyCommunityApplicationOutcomeEvents, communityApplicationOutcomeLoad],
  ([$legacy, $load]) => dedupeTrustedEvents([...$legacy, ...$load.events]),
)

const communityApplicationOutcomeFormSources = derived(
  [communityApplicationOutcomeEvents, communityApplicationOutcomeDefinitions],
  ([$events, $definitions]) =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: makeExactAddressFilters(
        getOutcomeReviews($events, definition.pointer.address).map(
          event => parseAdmissionReview(event)?.formAddress || "",
        ),
        FORM_TEMPLATE_KIND,
      ),
    })),
)

const communityApplicationOutcomeFormLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeFormSources, true),
  label: "community application outcome forms",
})

const communityApplicationOutcomeFormEvents = derived(
  communityApplicationOutcomeFormLoad,
  $load => $load.events,
)

const communityApplicationOutcomeReviewHistorySources = derived(
  [
    pubkey,
    communityApplicationOutcomeEvents,
    communityApplicationOutcomeDefinitions,
    notificationHistoryFilterLimit,
  ],
  ([$pubkey, $events, $definitions, $notificationHistoryFilterLimit]) =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: getIdFilters(
        uniqueStrings(
          getOutcomeReviews($events, definition.pointer.address).map(
            event => parseAdmissionReview(event)?.responseId,
          ),
        ),
      ).map(filter => ({
        ...filter,
        kinds: [COMMUNITY_FORM_REVIEW_KIND],
        "#p": $pubkey ? [$pubkey] : [],
        "#k": [String(FORM_RESPONSE_KIND)],
        limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
      })),
    })),
)

const communityApplicationOutcomeReviewHistoryLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeReviewHistorySources, true),
  label: "community application outcome review history",
})

const communityApplicationOutcomeReviewHistoryEvents = derived(
  communityApplicationOutcomeReviewHistoryLoad,
  $load => $load.events,
)

const communityApplicationOutcomeResponseSources = derived(
  [communityApplicationOutcomeEvents, communityApplicationOutcomeDefinitions],
  ([$events, $definitions]) =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: getIdFilters(
        uniqueStrings(
          getOutcomeReviews($events, definition.pointer.address).map(
            event => parseAdmissionReview(event)?.responseId,
          ),
        ),
      ).map(filter => ({...filter, kinds: [FORM_RESPONSE_KIND], limit: 1})),
    })),
)

const communityApplicationOutcomeResponseLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeResponseSources, true),
  label: "community application outcome responses",
})

const communityApplicationOutcomeResponseEvents = derived(
  communityApplicationOutcomeResponseLoad,
  $load => $load.events,
)

const communityApplicationOutcomeResponseDeleteSources = derived(
  [
    communityApplicationOutcomeEvents,
    communityApplicationOutcomeDefinitions,
    communityApplicationOutcomeResponseEvents,
  ],
  ([$reviews, $definitions, $responses]) =>
    $definitions.map(definition => {
      const responseIds = new Set(
        getOutcomeReviews($reviews, definition.pointer.address).map(
          event => parseAdmissionReview(event)?.responseId,
        ),
      )
      return {
        communityAddress: definition.pointer.address,
        relays: getOutcomeWorkflowRelays(definition),
        filters: makeSameAuthorDeleteFilters($responses.filter(event => responseIds.has(event.id))),
      }
    }),
)

const communityApplicationOutcomeResponseDeleteLoad = deriveLoadedNotificationEventGroupsWithStatus(
  {
    groups: makeCommunityNotificationGroups(communityApplicationOutcomeResponseDeleteSources, true),
    label: "community application outcome response deletes",
  },
)

const communityApplicationOutcomeResponseDeleteEvents = derived(
  communityApplicationOutcomeResponseDeleteLoad,
  $load => $load.events,
)

const communityApplicationOutcomeProfileListSources = derived(
  communityApplicationOutcomeDefinitions,
  $definitions =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeAuthorityRelays(definition),
      filters: makeCommunityProfileListFilters(definition),
    })),
)

const communityApplicationOutcomeProfileListLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeProfileListSources, true),
  label: "community application outcome profile lists",
})

const communityApplicationOutcomeProfileListEvents = derived(
  communityApplicationOutcomeProfileListLoad,
  $load => $load.events,
)

const communityApplicationOutcomeReportSources = derived(
  communityApplicationOutcomeDefinitions,
  $definitions =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: makeCommunityReportFilters(definition.pointer),
    })),
)

const communityApplicationOutcomeReportLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeReportSources, true),
  label: "community application outcome reports",
})

const communityApplicationOutcomeReportEvents = derived(
  communityApplicationOutcomeReportLoad,
  $load => $load.events,
)

const communityApplicationOutcomeReportDeleteSources = derived(
  [communityApplicationOutcomeDefinitions, communityApplicationOutcomeReportEvents],
  ([$definitions, $events]) =>
    $definitions.map(definition => ({
      communityAddress: definition.pointer.address,
      relays: getOutcomeWorkflowRelays(definition),
      filters: makeCommunityReportDeleteFilters(
        $events.filter(event => eventTargetsCommunity(event, definition.communityId)),
      ),
    })),
)

const communityApplicationOutcomeReportDeleteLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(communityApplicationOutcomeReportDeleteSources, true),
  label: "community application outcome report deletes",
})

const communityApplicationOutcomeReportDeleteEvents = derived(
  communityApplicationOutcomeReportDeleteLoad,
  $load => $load.events,
)

const communityApplicationOutcomeReportStates = derived(
  [
    communityApplicationOutcomeDefinitions,
    communityApplicationOutcomeReportEvents,
    communityApplicationOutcomeReportDeleteEvents,
    communityApplicationOutcomeFormSources,
    communityApplicationOutcomeFormLoad,
    communityApplicationOutcomeReviewHistorySources,
    communityApplicationOutcomeReviewHistoryLoad,
    communityApplicationOutcomeResponseSources,
    communityApplicationOutcomeResponseLoad,
    communityApplicationOutcomeResponseDeleteSources,
    communityApplicationOutcomeResponseDeleteLoad,
    communityApplicationOutcomeProfileListSources,
    communityApplicationOutcomeProfileListLoad,
    communityApplicationOutcomeReportSources,
    communityApplicationOutcomeReportLoad,
    communityApplicationOutcomeReportDeleteSources,
    communityApplicationOutcomeReportDeleteLoad,
    communityApplicationOutcomeProfileListEvents,
  ],
  ([
    $definitions,
    $reportEvents,
    $deleteEvents,
    $formSources,
    $formLoad,
    $reviewSources,
    $reviewLoad,
    $responseSources,
    $responseLoad,
    $responseDeleteSources,
    $responseDeleteLoad,
    $profileListSources,
    $profileListLoad,
    $reportSources,
    $reportLoad,
    $reportDeleteSources,
    $reportDeleteLoad,
    $profileListEvents,
  ]) => {
    const states = new Map<string, EffectiveCommunityReportState>()

    for (const definition of $definitions) {
      const communityAddress = definition.pointer.address
      const complete = [
        [$formSources, $formLoad],
        [$reviewSources, $reviewLoad],
        [$responseSources, $responseLoad],
        [$responseDeleteSources, $responseDeleteLoad],
        [$profileListSources, $profileListLoad],
        [$reportSources, $reportLoad],
        [$reportDeleteSources, $reportDeleteLoad],
      ].every(([sources, load]) =>
        isNotificationCommunitySourceComplete(
          communityAddress,
          sources as CommunityNotificationFilterSource[],
          load as LoadedNotificationEvents,
        ),
      )
      if (!complete) continue

      states.set(
        communityAddress,
        getEffectiveCommunityReportState({
          community: definition.pointer,
          definition,
          profileListEvents: $profileListEvents,
          reportEvents: $reportEvents,
          deleteEvents: $deleteEvents,
        }),
      )
    }

    return states
  },
)

const globalCommunityReportReviewSources = derived(
  [globalCommunityEvidenceRefs, globalCommunityReportEvents],
  ([$refs, $reportEvents]) =>
    $refs.map(ref => ({
      communityAddress: ref.community.address,
      relays: getCommunityModerationRelays(ref),
      filters: makeCommunityReportReviewFilters(
        ref.community,
        $reportEvents.filter(event => eventTargetsCommunity(event, ref.community.communityId)),
      ),
    })),
)

const globalCommunityReportReviewLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityReportReviewSources, true),
  label: "global community report reviews",
})

const globalCommunityReportReviewEvents = derived(
  globalCommunityReportReviewLoad,
  $load => $load.events,
)

const globalCommunityModerationCompletePubkeys = derived(
  [
    globalCommunityEvidenceRefs,
    globalCommunityDefinitionSources,
    globalCommunityDefinitionLoad,
    globalCommunityProfileListSources,
    globalCommunityProfileListLoad,
    globalCommunityReportSources,
    globalCommunityReportLoad,
    globalCommunityReportDeleteSources,
    globalCommunityReportDeleteLoad,
    globalCommunityReportReviewSources,
    globalCommunityReportReviewLoad,
  ],
  ([$refs, ...$sourceLoads]) => {
    const pairs = Array.from(
      {length: $sourceLoads.length / 2},
      (_, index) =>
        [
          $sourceLoads[index * 2] as CommunityNotificationFilterSource[],
          $sourceLoads[index * 2 + 1] as LoadedNotificationEvents,
        ] as const,
    )

    return new Set(
      $refs
        .filter(ref =>
          pairs.every(([sources, load]) =>
            isNotificationCommunitySourceComplete(ref.community.address, sources, load),
          ),
        )
        .map(ref => ref.community.address),
    )
  },
)

const globalCommunityTargetingSources = derived(
  [notificationCommunityRefs, globalCommunityProfileListEvents, globalCommunityReportStates],
  ([$refs, $profileListEvents, $reportStates]) =>
    $refs.map(ref => {
      const reportState = getReportState($reportStates, ref.community.address)
      const relayFilters: Filter[] = []
      const localFilters: Filter[] = []
      const calendarGrantEvidenceComplete = hasCommunityCalendarGrantEvidence({
        ref,
        profileListEvents: $profileListEvents,
        reportStates: $reportStates,
      })
      const calendarWriterPubkeys = calendarGrantEvidenceComplete
        ? getCommunityCalendarTargetWriterPubkeys({
            definition: ref.definition,
            profileListEvents: $profileListEvents,
            reportState,
          })
        : []

      for (const kind of TARGETED_PUBLICATION_KINDS) {
        const target = getCommunityWriteTarget(kind)
        if (!target) continue
        const calendarKind = COMMUNITY_CALENDAR_WRITE_TARGETS.some(target => target.kind === kind)

        const structuralFilters = [
          makeCommunityTargetingFilter(getCommunityDefinitionId(ref), [kind]),
        ]
        relayFilters.push(...structuralFilters)
        if (
          calendarKind
            ? !calendarGrantEvidenceComplete
            : !hasCommunityGrantEvidence({
                ref,
                target,
                profileListEvents: $profileListEvents,
                reportStates: $reportStates,
              })
        ) {
          continue
        }
        const authors = calendarKind
          ? calendarWriterPubkeys
          : getCommunityTargetWriterPubkeys({
              definition: ref.definition,
              profileListEvents: $profileListEvents,
              target,
              reportState,
            })
        localFilters.push(
          ...makeCommunityContentFilterPlan(structuralFilters, authors).localFilters,
        )
      }

      return {
        communityAddress: ref.community.address,
        relays: getCommunityNotificationRelays(ref),
        filters: relayFilters,
        localFilters,
      }
    }),
)

const globalCommunityTargetingCandidateLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityTargetingSources, true),
  label: "global community targeting wrappers",
})

const globalCommunityTargetingCandidateEvents = derived(
  globalCommunityTargetingCandidateLoad,
  $load => $load.events,
)

const globalCommunityTargetingReplacementSources = derived(
  [notificationCommunityRefs, globalCommunityTargetingCandidateEvents],
  ([$refs, $events]) =>
    $refs.map(ref => {
      const communityEvents = $events.filter(event => targetsCommunityDefinition(event, ref))
      const filters = makeTargetingWrapperReplacementFilters(communityEvents)

      return {
        communityAddress: ref.community.address,
        relays: normalizeRelayHints(
          getCommunityNotificationRelays(ref),
          communityEvents.flatMap(event =>
            getEventRelayHints(event, {relays: getNotificationEventRelays(event.id)}),
          ),
        ),
        filters,
        localFilters: filters,
      }
    }),
)

const globalCommunityTargetingReplacementLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityTargetingReplacementSources, true),
  label: "global community targeting wrapper replacements",
})

const globalCommunityTargetingReplacementEvents = derived(
  globalCommunityTargetingReplacementLoad,
  $load => $load.events,
)

const globalCommunityTargetingLifecycleEvents = derived(
  [globalCommunityTargetingCandidateEvents, globalCommunityTargetingReplacementEvents],
  ([$events, $replacementEvents]) => dedupeTrustedEvents([...$events, ...$replacementEvents]),
)

const globalCommunityTargetingDeleteSources = derived(
  [
    notificationCommunityRefs,
    globalCommunityTargetingCandidateEvents,
    globalCommunityTargetingLifecycleEvents,
  ],
  ([$refs, $candidateEvents, $events]) =>
    $refs.map(ref => {
      const candidateEvents = selectTargetedPublicationLifecycleCandidates(
        $candidateEvents.filter(event => targetsCommunityDefinition(event, ref)),
      )
      const addresses = new Set(candidateEvents.map(getAddress))
      const communityEvents = $events.filter(event => addresses.has(getAddress(event)))
      const filters = makeTargetedPublicationLifecycleFilters(communityEvents).filter(
        filter => filter.kinds?.[0] === DELETE,
      )

      return {
        communityAddress: ref.community.address,
        relays: normalizeRelayHints(
          getCommunityNotificationRelays(ref),
          communityEvents.flatMap(event =>
            getEventRelayHints(event, {relays: getNotificationEventRelays(event.id)}),
          ),
        ),
        filters,
        localFilters: filters,
      }
    }),
)

const globalCommunityTargetingDeleteLoad = deriveLoadedNotificationEventGroupsWithStatus({
  groups: makeCommunityNotificationGroups(globalCommunityTargetingDeleteSources, true),
  label: "global community targeting wrapper deletes",
})

const globalCommunityTargetingDeleteEvents = derived(
  globalCommunityTargetingDeleteLoad,
  $load => $load.events,
)

const globalCommunityTargetingEvents = derived(
  [
    notificationCommunityRefs,
    globalCommunityTargetingSources,
    globalCommunityTargetingCandidateLoad,
    globalCommunityTargetingReplacementSources,
    globalCommunityTargetingReplacementLoad,
    globalCommunityTargetingDeleteSources,
    globalCommunityTargetingDeleteLoad,
    globalCommunityTargetingCandidateEvents,
    globalCommunityTargetingLifecycleEvents,
    globalCommunityTargetingDeleteEvents,
  ],
  ([
    $refs,
    $candidateSources,
    $candidates,
    $replacementSources,
    $replacements,
    $deleteSources,
    $deletes,
    $candidateEvents,
    $events,
    $deleteEvents,
  ]) => {
    const activeAddresses = new Set($refs.map(getCommunityDefinitionAddress).filter(Boolean))
    const completeAddresses = new Set(
      $refs
        .filter(ref => {
          const communityAddress = ref.community.address
          return (
            isNotificationCommunitySourceComplete(
              communityAddress,
              $candidateSources,
              $candidates,
            ) &&
            isNotificationCommunitySourceComplete(
              communityAddress,
              $replacementSources,
              $replacements,
            ) &&
            isNotificationCommunitySourceComplete(communityAddress, $deleteSources, $deletes)
          )
        })
        .map(getCommunityDefinitionAddress)
        .filter(Boolean),
    )
    const targetCommunityAddressesByWrapper = new Map<string, Set<string>>()

    for (const event of $candidateEvents) {
      const wrapperAddress = getAddress(event)
      const targets = targetCommunityAddressesByWrapper.get(wrapperAddress) || new Set<string>()
      for (const community of parseTargetedPublication(event)?.communities || []) {
        if (activeAddresses.has(community.address)) targets.add(community.address)
      }
      targetCommunityAddressesByWrapper.set(wrapperAddress, targets)
    }

    return dedupeTrustedEvents(
      Array.from(completeAddresses).flatMap(communityAddress => {
        const addresses = new Set(
          Array.from(targetCommunityAddressesByWrapper)
            .filter(([, targets]) => targets.has(communityAddress))
            .map(([address]) => address),
        )
        return selectCurrentTargetingWrapperEvents(
          $events.filter(event => addresses.has(getAddress(event))),
          $deleteEvents,
        )
      }),
    ).filter(event =>
      Array.from(targetCommunityAddressesByWrapper.get(getAddress(event)) || []).every(
        communityAddress => completeAddresses.has(communityAddress),
      ),
    )
  },
)

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
  if (goalReply)
    return uniqueStrings([goalReply.parentReplyId, goalReply.goalId, goalReply.goalAddress])

  return []
}

const globalCommunityNotificationTargetSources = derived(
  [notificationCommunityRefs, globalCommunityNotificationEvents, notificationHistoryFilterLimit],
  ([$refs, $events, $notificationHistoryFilterLimit]) =>
    $refs.map(ref => ({
      communityAddress: ref.community.address,
      relays: getCommunityNotificationRelays(ref),
      filters: getIdFilters(
        uniqueStrings(
          $events
            .filter(event => eventTargetsCommunity(event, ref.community.communityId))
            .flatMap(getCommunityNotificationTargetRefs),
        ),
      ).map(filter => ({
        ...filter,
        limit: Math.max(COMMUNITY_NOTIFICATION_LOAD_LIMIT, $notificationHistoryFilterLimit),
      })),
    })),
)

const globalCommunityNotificationTargetEvents = deriveLoadedNotificationEventGroups({
  groups: makeCommunityNotificationGroups(globalCommunityNotificationTargetSources),
  label: "global community notification targets",
})

const globalCommunityNotificationRows = derived(
  [
    pubkey,
    notificationCommunityRefs,
    globalCommunityNotificationEvents,
    globalCommunityNotificationTargetEvents,
    globalCommunityTargetingEvents,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
  ],
  ([
    $pubkey,
    $notificationCommunityRefs,
    $globalCommunityNotificationEvents,
    $globalCommunityNotificationTargetEvents,
    $globalCommunityTargetingEvents,
    $globalCommunityProfileListEvents,
    $globalCommunityReportStates,
  ]) =>
    buildCommunityNotificationRows({
      refs: $notificationCommunityRefs,
      events: $globalCommunityNotificationEvents,
      targetEvents: [
        ...$globalCommunityNotificationTargetEvents,
        ...$globalCommunityTargetingEvents,
      ],
      profileListEvents: $globalCommunityProfileListEvents,
      currentPubkey: $pubkey || undefined,
      reportStates: $globalCommunityReportStates,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    }),
)

const globalCommunityApplicationRows = derived(
  [
    pubkey,
    notificationCommunityRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    globalCommunityAdmissionFormEvents,
    globalCommunityAdmissionResponseEvents,
    globalCommunityAdmissionDecisionEvents,
    communityApplicationOutcomeEvents,
    communityApplicationOutcomeReviewHistoryEvents,
    communityApplicationOutcomeDefinitionEvents,
    communityApplicationOutcomeFormEvents,
    communityApplicationOutcomeResponseEvents,
    communityApplicationOutcomeResponseDeleteEvents,
    communityApplicationOutcomeProfileListEvents,
    communityApplicationOutcomeReportStates,
    globalCommunityAdmissionCompletePubkeys,
  ],
  ([
    $pubkey,
    $notificationCommunityRefs,
    $globalCommunityProfileListEvents,
    $globalCommunityReportStates,
    $globalCommunityAdmissionFormEvents,
    $globalCommunityAdmissionResponseEvents,
    $globalCommunityAdmissionDecisionEvents,
    $communityApplicationOutcomeEvents,
    $communityApplicationOutcomeReviewHistoryEvents,
    $communityApplicationOutcomeDefinitionEvents,
    $communityApplicationOutcomeFormEvents,
    $communityApplicationOutcomeResponseEvents,
    $communityApplicationOutcomeResponseDeleteEvents,
    $communityApplicationOutcomeProfileListEvents,
    $communityApplicationOutcomeReportStates,
    $globalCommunityAdmissionCompletePubkeys,
  ]) => {
    const mutedPubkeys = $pubkey ? getMutes($pubkey) : []
    const activeRows = buildCommunityApplicationNotificationRows({
      refs: $notificationCommunityRefs.filter(ref =>
        $globalCommunityAdmissionCompletePubkeys.has(ref.community.address),
      ),
      currentPubkey: $pubkey || undefined,
      profileListEvents: $globalCommunityProfileListEvents,
      reportStates: $globalCommunityReportStates,
      admissionFormEvents: $globalCommunityAdmissionFormEvents,
      admissionResponseEvents: $globalCommunityAdmissionResponseEvents,
      admissionDeleteEvents: $globalCommunityAdmissionDecisionEvents,
      admissionReviewEvents: $globalCommunityAdmissionDecisionEvents,
      mutedPubkeys,
    })
    const outcomeRows = buildCommunityApplicationNotificationRows({
      refs: [],
      outcomeDefinitionEvents: $communityApplicationOutcomeDefinitionEvents,
      currentPubkey: $pubkey || undefined,
      profileListEvents: $communityApplicationOutcomeProfileListEvents,
      reportStates: $communityApplicationOutcomeReportStates,
      outcomeReportStates: $communityApplicationOutcomeReportStates,
      admissionFormEvents: $communityApplicationOutcomeFormEvents,
      admissionResponseEvents: $communityApplicationOutcomeResponseEvents,
      admissionDeleteEvents: $communityApplicationOutcomeResponseDeleteEvents,
      admissionReviewEvents: [
        ...$communityApplicationOutcomeEvents,
        ...$communityApplicationOutcomeReviewHistoryEvents,
      ],
      mutedPubkeys,
    })

    return sortNotificationRows(
      Array.from(new Map([...activeRows, ...outcomeRows].map(row => [row.id, row])).values()),
    )
  },
)

const globalCommunityModerationRows = derived(
  [
    pubkey,
    globalCommunityEvidenceRefs,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    globalCommunityReportEvents,
    globalCommunityReportDeleteEvents,
    globalCommunityReportReviewEvents,
    globalCommunityModerationCompletePubkeys,
  ],
  ([
    $pubkey,
    $globalCommunityEvidenceRefs,
    $globalCommunityProfileListEvents,
    $globalCommunityReportStates,
    $globalCommunityReportEvents,
    $globalCommunityReportDeleteEvents,
    $globalCommunityReportReviewEvents,
    $globalCommunityModerationCompletePubkeys,
  ]) => {
    return buildCommunityModerationNotificationRows({
      refs: $globalCommunityEvidenceRefs.filter(ref =>
        $globalCommunityModerationCompletePubkeys.has(ref.community.address),
      ),
      currentPubkey: $pubkey || undefined,
      profileListEvents: $globalCommunityProfileListEvents,
      reportStates: $globalCommunityReportStates,
      reportEvents: $globalCommunityReportEvents,
      reportDeleteEvents: $globalCommunityReportDeleteEvents,
      reportReviewEvents: $globalCommunityReportReviewEvents,
      mutedPubkeys: $pubkey ? getMutes($pubkey) : [],
    })
  },
)

const repoWatchNotificationRows = derived(
  [repoWatchNotificationCandidates],
  ([$repoWatchNotificationCandidates]) =>
    buildRepoWatchNotificationRows({
      candidates: $repoWatchNotificationCandidates,
    }),
)

const widgetUpdateNotificationRows = derived(installedWidgetUpdates, $installedWidgetUpdates =>
  buildWidgetUpdateNotificationRows({updates: $installedWidgetUpdates}),
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
      $events.flatMap(event =>
        getEventRelayHints(event, {relays: getNotificationEventRelays(event.id)}),
      ),
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
  [
    pubkey,
    notificationCommunityRefs,
    engagementNotificationEvents,
    engagementNotificationTargetEvents,
    globalCommunityTargetingEvents,
    globalCommunityProfileListEvents,
    globalCommunityReportStates,
    validEngagementZapResponseIds,
  ],
  ([
    $pubkey,
    $refs,
    $events,
    $targetEvents,
    $targetingEvents,
    $profileListEvents,
    $reportStates,
    $validZapResponseIds,
  ]) =>
    buildEngagementNotificationRows({
      events: $events,
      targetEvents: [...$targetEvents, ...$targetingEvents],
      refs: $refs,
      profileListEvents: $profileListEvents,
      reportStates: $reportStates,
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
    globalCommunityMembershipRows,
    globalCommunityBadgeRows,
    globalCommunityModerationRows,
    repoWatchNotificationRows,
    widgetUpdateNotificationRows,
    engagementNotificationRows,
  ],
  ([
    $pubkey,
    $chatsById,
    $notifications,
    $notificationCandidates,
    $globalCommunityNotificationRows,
    $globalCommunityApplicationRows,
    $globalCommunityMembershipRows,
    $globalCommunityBadgeRows,
    $globalCommunityModerationRows,
    $repoWatchNotificationRows,
    $widgetUpdateNotificationRows,
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
      ...$globalCommunityMembershipRows,
      ...$globalCommunityBadgeRows,
      ...$globalCommunityModerationRows,
      ...$repoWatchNotificationRows,
      ...$widgetUpdateNotificationRows,
      ...$engagementNotificationRows,
    ]
    const excludedPaths = new Set(sourceRows.flatMap(row => [row.path, row.readPath]))
    const coveredAtByPath = new Map<string, number>()

    for (const row of sourceRows) {
      for (const path of [row.path, row.readPath]) {
        coveredAtByPath.set(path, Math.max(coveredAtByPath.get(path) || 0, row.createdAt))
      }
    }

    if (chatRows.length > 0) {
      excludedPaths.add("/chat")
      coveredAtByPath.set(
        "/chat",
        chatRows.reduce((latest, row) => Math.max(latest, row.createdAt), 0),
      )
    }

    return sortNotificationRows(
      dedupeNotificationRowsById([
        ...sourceRows,
        ...buildRouteNotificationRows({
          paths: $notifications,
          excludedPaths,
          coveredAtByPath,
          candidates: $notificationCandidates,
          currentPubkey: $pubkey || undefined,
        }),
      ]),
    )
  },
)

export const getLatestNotificationCenterTimestamp = (rows: NotificationRow[]) =>
  rows.reduce((latest, row) => Math.max(latest, row.createdAt), 0)

export const latestNotificationCenterTimestamp = derived(
  notificationCenterRows,
  getLatestNotificationCenterTimestamp,
)

export const hasNotificationCenterUnread = derived(
  [pubkey, notificationCenterRows, notificationReadState],
  ([$pubkey, $rows, $notificationReadState]) =>
    hasUnreadNotificationRowsState(
      $notificationReadState,
      $pubkey || undefined,
      $rows.map(row => row.id),
    ),
)
