import {
  Address,
  DELETE,
  getAddress,
  getTagValue,
  isParameterizedReplaceable,
  isParameterizedReplaceableKind,
  type EventContent,
  type TrustedEvent,
} from "@welshman/util"
import {
  deleteMatchesCommunity,
  makeCommunityAuthorityTags,
  makeCommunityDeleteTags,
  normalizeCommunityRelay,
  normalizeCommunitySectionName,
  normalizeCommunitySectionSubtype,
  normalizePubkey,
  parseCommunityAuthority,
  type CommunityDefinition,
  type CommunityPointer,
} from "@app/core/community"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  getGrantCapableSectionModeratorPubkeys,
} from "@app/core/community-permissions"

export const COMMUNITY_REPORT_KIND = 1984
export const COMMUNITY_REPORT_REASON = "spam"
export const COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH = 4096
export const COMMUNITY_REPORT_REVIEW_LABEL_KIND = 1985
export const COMMUNITY_REPORT_REVIEW_NAMESPACE = "budabit:community-report"
export const COMMUNITY_REPORT_REVIEWED_LABEL = "reviewed"

export type CommunityReportTarget = "event" | "person"

export type ParsedCommunityReport = {
  event: TrustedEvent
  target: CommunityReportTarget
  community: CommunityPointer
  communityAddress: string
  communityId: string
  ownerPubkey: string
  targetPubkey: string
  targetAddress?: string
  targetEventId?: string
  targetEventKind?: number
  targetEventSubtype?: string
  targetEventTitle?: string
  targetEventContent?: string
  targetRootId?: string
  targetRootKind?: number
  targetIdentifier?: string
  targetScope?: string
  sectionName?: string
}

export type EffectiveCommunityReport = ParsedCommunityReport & {
  reporterPubkey: string
  adminAuthored: boolean
}

export type EffectiveCommunityReportState = {
  eventReports: EffectiveCommunityReport[]
  personReports: EffectiveCommunityReport[]
}

export type CommunityModerationAction = EffectiveCommunityReport

export type CommunityReportReview = {
  event: TrustedEvent
  reportId: string
  reportAuthorPubkey: string
  community: CommunityPointer
  communityId: string
  ownerPubkey: string
  reviewerPubkey: string
  targetEventId?: string
  targetEventKind?: number
  sectionName?: string
}

export type CommunityContentReport = ParsedCommunityReport & {
  reporterPubkey: string
  reviews: CommunityReportReview[]
  reviewed: boolean
}

export type CommunityContentReportGroup = {
  key: string
  sectionName: string
  targetAddress?: string
  targetEventId?: string
  targetEventKind?: number
  targetEventSubtype?: string
  targetPubkey: string
  reports: CommunityContentReport[]
  reviews: CommunityReportReview[]
  reviewed: boolean
  latestCreatedAt: number
}

const sortReportsByRecent = <T extends {event: TrustedEvent}>(reports: T[]) =>
  reports.toSorted(
    (a, b) => b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id),
  )

const findCommunitySection = (definition: CommunityDefinition, name: string) => {
  const normalizedName = normalizeCommunitySectionName(name)

  return definition.sections.find(
    section => normalizeCommunitySectionName(section.name) === normalizedName,
  )
}

export const getEffectiveCommunityModerationActions = (
  state: EffectiveCommunityReportState,
): CommunityModerationAction[] =>
  sortReportsByRecent([...state.eventReports, ...state.personReports])

export const getEffectiveCommunityModerationActionsByReporter = (
  state: EffectiveCommunityReportState,
  reporterPubkey: string,
): CommunityModerationAction[] => {
  const reporter = normalizePubkey(reporterPubkey)

  return reporter
    ? getEffectiveCommunityModerationActions(state).filter(
        report => report.reporterPubkey === reporter,
      )
    : []
}

export const isCommunityPersonBanned = (
  reportState: EffectiveCommunityReportState | undefined,
  pubkey: string | undefined,
) => {
  const normalizedPubkey = normalizePubkey(pubkey || "")

  return Boolean(
    normalizedPubkey &&
    reportState?.personReports.some(report => report.targetPubkey === normalizedPubkey),
  )
}

const isPersonBannedByReports = (personReports: EffectiveCommunityReport[], pubkey: string) => {
  const normalizedPubkey = normalizePubkey(pubkey)

  return Boolean(
    normalizedPubkey && personReports.some(report => report.targetPubkey === normalizedPubkey),
  )
}

const isRelayHint = (value: string | undefined) => /^wss?:\/\//i.test(value?.trim() || "")

const hasReportReason = (tag: string[]) =>
  Boolean(tag[3]?.trim() || (tag[2]?.trim() && !isRelayHint(tag[2])))

const getReasonTag = (event: TrustedEvent, tagName: "e" | "p") =>
  event.tags.find(tag => tag[0] === tagName && tag[4] !== "report" && hasReportReason(tag))

const parseReportTargetAddress = (address: string) => {
  if (!Address.isAddress(address)) return undefined

  const ref = Address.from(address)
  const pubkey = normalizePubkey(ref.pubkey || "")
  if (!isParameterizedReplaceableKind(ref.kind) || !pubkey || !ref.identifier) return undefined

  return {
    kind: ref.kind,
    pubkey,
    identifier: ref.identifier,
    address: `${ref.kind}:${pubkey}:${ref.identifier}`,
  }
}

const getReasonAddressTag = (event: TrustedEvent) =>
  event.tags.find(
    tag =>
      tag[0] === "a" &&
      tag[3] !== "community" &&
      hasReportReason(tag) &&
      parseReportTargetAddress(tag[1] || ""),
  )

const getLoadedEventAuthor = (eventId: string, targetEvents: TrustedEvent[]) =>
  normalizePubkey(targetEvents.find(event => event.id === eventId)?.pubkey || "")

const getMarkedReportReference = (event: TrustedEvent) => {
  const tags = event.tags.filter(tag => tag[0] === "e" && tag[4] === "report")
  if (tags.length !== 1 || tags[0].length !== 5) return undefined

  const reportId = tags[0][1]?.trim()
  const relay = tags[0][2]
  const author = normalizePubkey(tags[0][3] || "")
  if (!reportId || (relay && normalizeCommunityRelay(relay) !== relay) || !author) {
    return undefined
  }

  return {reportId, author}
}

const communitiesMatch = (first: CommunityPointer, second: CommunityPointer) =>
  first.address === second.address

const getSectionName = (event: TrustedEvent) =>
  normalizeCommunitySectionName(event.tags.find(tag => tag[0] === "content")?.[1] || "")

const getStringTagValue = (event: TrustedEvent, tagName: string) =>
  event.tags.find(tag => tag[0] === tagName)?.[1]?.trim() || ""

const getNumberTagValue = (event: TrustedEvent, tagName: string) => {
  const value = getStringTagValue(event, tagName)
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) ? parsed : undefined
}

const getTargetEventKind = (event: TrustedEvent) => {
  const value = getStringTagValue(event, "target-kind")
  const kind = Number.parseInt(value, 10)

  return Number.isFinite(kind) ? kind : undefined
}

const makeOptionalTag = (name: string, value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value).trim()

  return text ? [[name, text]] : []
}

export const getCommunityReportEventAddress = (
  event: Pick<TrustedEvent, "kind" | "pubkey" | "tags" | "content">,
) => {
  if (!isParameterizedReplaceable(event)) return ""

  return parseReportTargetAddress(getAddress(event))?.address || ""
}

export const getCommunityReportTargetContext = (event: TrustedEvent) => ({
  targetAddress: getCommunityReportEventAddress(event),
  targetRootId: getTagValue("E", event.tags) || getTagValue("e", event.tags) || "",
  targetRootKind: getNumberTagValue(event, "K"),
  targetIdentifier: getTagValue("d", event.tags) || "",
  targetScope: getTagValue("h", event.tags) || "",
})

const truncateTargetContent = (content: string) => {
  const trimmed = content.trim()

  return trimmed.length > COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH
    ? trimmed.slice(0, COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH)
    : trimmed
}

export const makeCommunityEventReport = ({
  community,
  sectionName,
  eventId,
  eventPubkey,
  targetAddress = "",
  eventKind,
  eventSubtype = "",
  eventTitle = "",
  eventContent = "",
  targetRootId = "",
  targetRootKind,
  targetIdentifier = "",
  targetScope = "",
  content = "",
}: {
  community: CommunityPointer
  sectionName: string
  eventId: string
  eventPubkey: string
  targetAddress?: string
  eventKind?: number
  eventSubtype?: string
  eventTitle?: string
  eventContent?: string
  targetRootId?: string
  targetRootKind?: number
  targetIdentifier?: string
  targetScope?: string
  content?: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_KIND} => ({
  kind: COMMUNITY_REPORT_KIND,
  content,
  tags: makeCommunityAuthorityTags(community, undefined, [
    ["e", eventId, COMMUNITY_REPORT_REASON],
    ...makeOptionalTag("a", parseReportTargetAddress(targetAddress)?.address).map(tag => [
      ...tag,
      COMMUNITY_REPORT_REASON,
    ]),
    ["p", normalizePubkey(eventPubkey)],
    ["content", normalizeCommunitySectionName(sectionName)],
    ...makeOptionalTag("target-kind", eventKind),
    ...makeOptionalTag("target-subtype", normalizeCommunitySectionSubtype(eventSubtype)),
    ...makeOptionalTag("target-title", eventTitle),
    ...makeOptionalTag("target-content", truncateTargetContent(eventContent)),
    ...makeOptionalTag("target-root-id", targetRootId),
    ...makeOptionalTag("target-root-kind", targetRootKind),
    ...makeOptionalTag("target-d", targetIdentifier),
    ...makeOptionalTag("target-h", targetScope),
  ]),
})

export const makeCommunityPersonReport = ({
  community,
  pubkey,
  content = "",
}: {
  community: CommunityPointer
  pubkey: string
  content?: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_KIND} => ({
  kind: COMMUNITY_REPORT_KIND,
  content,
  tags: makeCommunityAuthorityTags(community, undefined, [
    ["p", normalizePubkey(pubkey), COMMUNITY_REPORT_REASON],
  ]),
})

export const makeCommunityReportDelete = ({
  community,
  reportId,
  reporterPubkey,
}: {
  community: CommunityPointer
  reportId: string
  reporterPubkey: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: "Deleted community report",
  tags: makeCommunityDeleteTags(community, [
    ["e", reportId, "", normalizePubkey(reporterPubkey), "report"],
    ["k", String(COMMUNITY_REPORT_KIND)],
  ]),
})

export const makeCommunityReportReviewLabel = ({
  community,
  reportId,
  targetEventId = "",
  targetEventKind,
  sectionName = "",
  reporterPubkey = "",
  content = "",
}: {
  community: CommunityPointer
  reportId: string
  targetEventId?: string
  targetEventKind?: number
  sectionName?: string
  reporterPubkey: string
  content?: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_REVIEW_LABEL_KIND} => ({
  kind: COMMUNITY_REPORT_REVIEW_LABEL_KIND,
  content,
  tags: makeCommunityAuthorityTags(community, undefined, [
    ["L", COMMUNITY_REPORT_REVIEW_NAMESPACE],
    ["l", COMMUNITY_REPORT_REVIEWED_LABEL, COMMUNITY_REPORT_REVIEW_NAMESPACE],
    ["e", reportId, "", normalizePubkey(reporterPubkey), "report"],
    ...makeOptionalTag("E", targetEventId),
    ...makeOptionalTag("K", targetEventKind),
    ...makeOptionalTag("content", normalizeCommunitySectionName(sectionName)),
    ...makeOptionalTag("p", normalizePubkey(reporterPubkey)),
  ]),
})

export const parseCommunityReportReviewLabel = (
  event: TrustedEvent,
  expectedCommunity?: CommunityPointer,
): CommunityReportReview | undefined => {
  if (event.kind !== COMMUNITY_REPORT_REVIEW_LABEL_KIND) return undefined
  if (!event.tags.some(tag => tag[0] === "L" && tag[1] === COMMUNITY_REPORT_REVIEW_NAMESPACE)) {
    return undefined
  }
  if (
    !event.tags.some(
      tag =>
        tag[0] === "l" &&
        tag[1] === COMMUNITY_REPORT_REVIEWED_LABEL &&
        tag[2] === COMMUNITY_REPORT_REVIEW_NAMESPACE,
    )
  ) {
    return undefined
  }

  const community = parseCommunityAuthority(event)
  if (!community) return undefined
  if (expectedCommunity && !communitiesMatch(community, expectedCommunity)) return undefined

  const reportReference = getMarkedReportReference(event)
  const reviewerPubkey = normalizePubkey(event.pubkey || "")
  if (!reportReference || !reviewerPubkey) return undefined

  return {
    event,
    reportId: reportReference.reportId,
    reportAuthorPubkey: reportReference.author,
    community,
    communityId: community.communityId,
    ownerPubkey: community.ownerPubkey,
    reviewerPubkey,
    targetEventId: getStringTagValue(event, "E") || undefined,
    targetEventKind: getNumberTagValue(event, "K"),
    sectionName: getSectionName(event) || undefined,
  }
}

export const parseCommunityReport = (
  event: TrustedEvent,
  expectedCommunity?: CommunityPointer,
  targetEvents: TrustedEvent[] = [],
): ParsedCommunityReport | undefined => {
  if (event.kind !== COMMUNITY_REPORT_KIND) return undefined

  const community = parseCommunityAuthority(event)
  if (!community) return undefined
  if (expectedCommunity && !communitiesMatch(community, expectedCommunity)) return undefined

  const eventTag = getReasonTag(event, "e")
  const targetAddressTag = getReasonAddressTag(event)
  const targetAddressRef = targetAddressTag
    ? parseReportTargetAddress(targetAddressTag[1] || "")
    : undefined
  const personReportTag = getReasonTag(event, "p")
  const hasEventTarget = Boolean(eventTag?.[1] || targetAddressRef)
  const targetPubkey = normalizePubkey(
    hasEventTarget
      ? event.tags.find(tag => tag[0] === "p")?.[1] ||
          targetAddressRef?.pubkey ||
          getLoadedEventAuthor(eventTag?.[1] || "", targetEvents)
      : personReportTag?.[1] || "",
  )

  if (!targetPubkey) return undefined

  if (hasEventTarget) {
    const sectionName = getSectionName(event)
    if (!sectionName) return undefined

    return {
      event,
      target: "event",
      community,
      communityAddress: community.address,
      communityId: community.communityId,
      ownerPubkey: community.ownerPubkey,
      targetPubkey,
      targetEventId: eventTag?.[1],
      targetAddress: targetAddressRef?.address,
      targetEventKind: getTargetEventKind(event) ?? targetAddressRef?.kind,
      targetEventSubtype: normalizeCommunitySectionSubtype(
        getStringTagValue(event, "target-subtype"),
      ),
      targetEventTitle: getStringTagValue(event, "target-title"),
      targetEventContent: getStringTagValue(event, "target-content"),
      targetRootId: getStringTagValue(event, "target-root-id") || undefined,
      targetRootKind: getNumberTagValue(event, "target-root-kind"),
      targetIdentifier: getStringTagValue(event, "target-d") || targetAddressRef?.identifier,
      targetScope: getStringTagValue(event, "target-h") || undefined,
      sectionName,
    }
  }

  if (!personReportTag?.[1]) return undefined

  return {
    event,
    target: "person",
    community,
    communityAddress: community.address,
    communityId: community.communityId,
    ownerPubkey: community.ownerPubkey,
    targetPubkey,
  }
}

export const isCommunityReportDeleted = (report: TrustedEvent, deleteEvents: TrustedEvent[]) =>
  deleteEvents.some(event => {
    if (event.kind !== DELETE) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(report.pubkey || "")) return false
    const reportCommunity = parseCommunityAuthority(report)
    if (!reportCommunity || !deleteMatchesCommunity(event, reportCommunity)) return false
    const reportReference = getMarkedReportReference(event)
    if (
      reportReference?.reportId !== report.id ||
      reportReference.author !== normalizePubkey(report.pubkey || "")
    ) {
      return false
    }

    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return kindTags.length === 0 || kindTags.some(tag => tag[1] === String(COMMUNITY_REPORT_KIND))
  })

export const getAllSectionModeratorPubkeys = (
  definition: CommunityDefinition,
  profileListEvents?: TrustedEvent[],
) => {
  if (definition.sections.length === 0) return []

  const moderatorSets = definition.sections.map(
    section =>
      new Set(
        getGrantCapableSectionModeratorPubkeys({
          definition,
          sectionName: section.name,
          profileListEvents,
        }),
      ),
  )
  const [firstSet, ...restSets] = moderatorSets

  return Array.from(firstSet || []).filter(pubkey => restSets.every(set => set.has(pubkey)))
}

export const getCurrentModeratorPubkeys = (
  definition: CommunityDefinition,
  profileListEvents?: TrustedEvent[],
) =>
  Array.from(
    new Set(
      definition.sections.flatMap(section =>
        getGrantCapableSectionModeratorPubkeys({
          definition,
          sectionName: section.name,
          profileListEvents,
        }),
      ),
    ),
  )

export const isCommunityAdmin = (definition: CommunityDefinition, pubkey: string) =>
  definition.ownerPubkey === normalizePubkey(pubkey)

export const isProtectedCommunityModeratorTarget = ({
  definition,
  reporterPubkey,
  targetPubkey,
  profileListEvents,
}: {
  definition: CommunityDefinition
  reporterPubkey: string
  targetPubkey: string
  profileListEvents?: TrustedEvent[]
}) =>
  !isCommunityAdmin(definition, reporterPubkey) &&
  (isCommunityAdmin(definition, targetPubkey) ||
    getCurrentModeratorPubkeys(definition, profileListEvents).includes(
      normalizePubkey(targetPubkey),
    ))

export const canPublishCommunityEventReport = ({
  definition,
  reporterPubkey,
  targetPubkey,
  sectionName,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  reporterPubkey: string
  targetPubkey: string
  sectionName: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const reporter = normalizePubkey(reporterPubkey)
  const target = normalizePubkey(targetPubkey)

  if (
    !reporter ||
    !target ||
    reporter === target ||
    !findCommunitySection(definition, sectionName)
  ) {
    return false
  }
  if (
    isProtectedCommunityModeratorTarget({
      definition,
      reporterPubkey: reporter,
      targetPubkey: target,
      profileListEvents,
    })
  ) {
    return false
  }
  if (isCommunityAdmin(definition, reporter)) return true
  if (isCommunityPersonBanned(reportState, reporter)) return false

  return getGrantCapableSectionModeratorPubkeys({
    definition,
    sectionName,
    profileListEvents,
    reportState,
  }).includes(reporter)
}

export const canPublishCommunityPersonReport = ({
  definition,
  reporterPubkey,
  targetPubkey,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  reporterPubkey: string
  targetPubkey: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const reporter = normalizePubkey(reporterPubkey)
  const target = normalizePubkey(targetPubkey)

  if (!reporter || !target || reporter === target) return false
  if (
    isProtectedCommunityModeratorTarget({
      definition,
      reporterPubkey: reporter,
      targetPubkey: target,
      profileListEvents,
    })
  ) {
    return false
  }
  if (isCommunityAdmin(definition, reporter)) return true
  if (isCommunityPersonBanned(reportState, reporter)) return false

  return getAllSectionModeratorPubkeys(definition, profileListEvents).includes(reporter)
}

export const canReviewCommunityContentReport = ({
  definition,
  reviewerPubkey,
  report,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  reviewerPubkey: string
  report: ParsedCommunityReport
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const reviewer = normalizePubkey(reviewerPubkey)

  if (report.target !== "event" || !report.sectionName || !reviewer) return false
  if (isCommunityAdmin(definition, reviewer)) return true
  if (isCommunityPersonBanned(reportState, reviewer)) return false

  return getGrantCapableSectionModeratorPubkeys({
    definition,
    sectionName: report.sectionName,
    profileListEvents,
    reportState,
  }).includes(reviewer)
}

export const canPublishCommunityContentReport = ({
  definition,
  profileListEvents,
  reporterPubkey,
  targetPubkey,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reporterPubkey: string
  targetPubkey?: string
  reportState?: EffectiveCommunityReportState
}) => {
  const reporter = normalizePubkey(reporterPubkey)
  const target = normalizePubkey(targetPubkey || "")

  if (!reporter || (target && reporter === target)) return false

  return canWriteCommunityTarget({
    definition,
    profileListEvents,
    userPubkey: reporter,
    target: COMMUNITY_WRITE_TARGETS.report,
    reportState,
  })
}

const isProtectedModeratorTarget = ({
  definition,
  report,
  reporterIsAdmin,
  profileListEvents,
}: {
  definition: CommunityDefinition
  report: ParsedCommunityReport
  reporterIsAdmin: boolean
  profileListEvents?: TrustedEvent[]
}) =>
  !reporterIsAdmin &&
  (isCommunityAdmin(definition, report.targetPubkey) ||
    getCurrentModeratorPubkeys(definition, profileListEvents).includes(report.targetPubkey))

const isAuthorizedEventReport = (
  definition: CommunityDefinition,
  report: ParsedCommunityReport,
  profileListEvents: TrustedEvent[],
) => {
  if (report.target !== "event" || !report.sectionName) return false
  if (!findCommunitySection(definition, report.sectionName)) return false

  return canPublishCommunityEventReport({
    definition,
    reporterPubkey: report.event.pubkey || "",
    targetPubkey: report.targetPubkey,
    sectionName: report.sectionName,
    profileListEvents,
  })
}

const isAuthorizedPersonReport = (
  definition: CommunityDefinition,
  report: ParsedCommunityReport,
  profileListEvents: TrustedEvent[],
) => {
  if (report.target !== "person") return false

  return canPublishCommunityPersonReport({
    definition,
    reporterPubkey: report.event.pubkey || "",
    targetPubkey: report.targetPubkey,
    profileListEvents,
  })
}

export const getEffectiveCommunityReportState = ({
  community,
  definition,
  profileListEvents = [],
  reportEvents,
  deleteEvents = [],
  targetEvents = [],
}: {
  community?: CommunityPointer
  definition: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  reportEvents: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  targetEvents?: TrustedEvent[]
}): EffectiveCommunityReportState => {
  const parsedReports: EffectiveCommunityReport[] = []

  for (const event of reportEvents) {
    if (isCommunityReportDeleted(event, deleteEvents)) continue

    const report = parseCommunityReport(event, community, targetEvents)
    if (!report) continue
    if (report.communityAddress !== definition.pointer.address) continue

    const reporterPubkey = normalizePubkey(event.pubkey || "")
    const adminAuthored = isCommunityAdmin(definition, reporterPubkey)
    if (
      isProtectedModeratorTarget({
        definition,
        report,
        reporterIsAdmin: adminAuthored,
        profileListEvents,
      })
    )
      continue

    const effectiveReport = {...report, reporterPubkey, adminAuthored}

    parsedReports.push(effectiveReport)
  }

  let personReports: EffectiveCommunityReport[] = []

  for (let index = 0; index < parsedReports.length; index += 1) {
    const nextPersonReports = parsedReports.filter(
      report =>
        report.target === "person" &&
        !isPersonBannedByReports(personReports, report.reporterPubkey) &&
        isAuthorizedPersonReport(definition, report, profileListEvents),
    )
    const currentIds = personReports
      .map(report => report.event.id)
      .sort()
      .join(",")
    const nextIds = nextPersonReports
      .map(report => report.event.id)
      .sort()
      .join(",")

    personReports = nextPersonReports
    if (currentIds === nextIds) break
  }

  const eventReports = parsedReports.filter(
    report =>
      report.target === "event" &&
      !isPersonBannedByReports(personReports, report.reporterPubkey) &&
      isAuthorizedEventReport(definition, report, profileListEvents),
  )

  return {eventReports, personReports}
}

export const getCommunityContentReports = ({
  community,
  definition,
  reportEvents,
  reviewEvents = [],
  deleteEvents = [],
  profileListEvents = [],
  reportState,
}: {
  community?: CommunityPointer
  definition: CommunityDefinition
  reportEvents: TrustedEvent[]
  reviewEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityContentReport[] => {
  const parsedReviews = reviewEvents
    .map(event => parseCommunityReportReviewLabel(event, community))
    .filter((review): review is CommunityReportReview => Boolean(review))
  const reviewsByReportId = new Map<string, CommunityReportReview[]>()

  for (const review of parsedReviews) {
    const reviews = reviewsByReportId.get(review.reportId) || []
    reviews.push(review)
    reviewsByReportId.set(review.reportId, reviews)
  }

  return reportEvents
    .filter(event => !isCommunityReportDeleted(event, deleteEvents))
    .map(event => parseCommunityReport(event, community))
    .filter((report): report is ParsedCommunityReport => Boolean(report))
    .filter(report => report.communityAddress === definition.pointer.address)
    .filter(report => report.target === "event")
    .filter(report => {
      const reporterPubkey = normalizePubkey(report.event.pubkey || "")
      if (!reporterPubkey || reporterPubkey === report.targetPubkey) return false
      if (
        canPublishCommunityEventReport({
          definition,
          reporterPubkey,
          targetPubkey: report.targetPubkey,
          sectionName: report.sectionName || "",
          profileListEvents,
          reportState,
        })
      ) {
        return false
      }

      return canPublishCommunityContentReport({
        definition,
        profileListEvents,
        reporterPubkey,
        targetPubkey: report.targetPubkey,
        reportState,
      })
    })
    .map(report => {
      const reviews = (reviewsByReportId.get(report.event.id) || []).filter(
        review =>
          review.reportAuthorPubkey === normalizePubkey(report.event.pubkey || "") &&
          canReviewCommunityContentReport({
            definition,
            reviewerPubkey: review.reviewerPubkey,
            report,
            profileListEvents,
            reportState,
          }),
      )

      return {
        ...report,
        reporterPubkey: normalizePubkey(report.event.pubkey || ""),
        reviews: sortReportsByRecent(reviews),
        reviewed: reviews.length > 0,
      }
    })
}

export const getCommunityContentReportGroups = (
  reports: CommunityContentReport[],
): CommunityContentReportGroup[] => {
  const groups = new Map<string, CommunityContentReportGroup>()

  for (const report of reports) {
    const key = `${report.sectionName || ""}:${report.targetAddress || report.targetEventId || report.event.id}`
    const current = groups.get(key)

    if (!current) {
      groups.set(key, {
        key,
        sectionName: report.sectionName || "",
        targetAddress: report.targetAddress,
        targetEventId: report.targetEventId,
        targetEventKind: report.targetEventKind,
        targetEventSubtype: report.targetEventSubtype,
        targetPubkey: report.targetPubkey,
        reports: [report],
        reviews: report.reviews,
        reviewed: report.reviewed,
        latestCreatedAt: report.event.created_at,
      })
      continue
    }

    current.reports.push(report)
    current.reviews.push(...report.reviews)
    current.reviewed = current.reports.every(item => item.reviewed)
    current.latestCreatedAt = Math.max(current.latestCreatedAt, report.event.created_at)
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.latestCreatedAt - a.latestCreatedAt || a.key.localeCompare(b.key),
  )
}

export const getCommunityCensorReason = ({
  reportState,
  eventId,
  eventAddress,
  pubkey,
  sectionName,
}: {
  reportState: EffectiveCommunityReportState
  eventId?: string
  eventAddress?: string
  pubkey?: string
  sectionName?: string
}): "event" | "person" | undefined => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  const normalizedEventAddress = parseReportTargetAddress(eventAddress || "")?.address || ""

  if (
    (eventId || normalizedEventAddress) &&
    sectionName &&
    reportState.eventReports.some(
      report =>
        ((eventId && report.targetEventId === eventId) ||
          (normalizedEventAddress && report.targetAddress === normalizedEventAddress)) &&
        normalizeCommunitySectionName(report.sectionName || "") ===
          normalizeCommunitySectionName(sectionName),
    )
  ) {
    return "event"
  }

  if (
    normalizedPubkey &&
    reportState.personReports.some(report => report.targetPubkey === normalizedPubkey)
  ) {
    return "person"
  }
}
