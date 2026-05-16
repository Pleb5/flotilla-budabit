import type {EventContent, TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  findCommunitySection,
  normalizePubkey,
  type CommunityDefinition,
} from "@app/core/community"
import {getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"

export const COMMUNITY_REPORT_KIND = 1984
export const COMMUNITY_REPORT_DELETE_KIND = 5
export const COMMUNITY_REPORT_REASON = "spam"

export type CommunityReportTarget = "event" | "person"

export type ParsedCommunityReport = {
  event: TrustedEvent
  target: CommunityReportTarget
  communityAddress: string
  communityPubkey: string
  targetPubkey: string
  targetEventId?: string
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

const getReasonTag = (event: TrustedEvent, tagName: "e" | "p") =>
  event.tags.find(tag => tag[0] === tagName && tag[2] === COMMUNITY_REPORT_REASON)

const makeCommunityDefinitionAddress = (communityPubkey: string) => {
  const pubkey = normalizePubkey(communityPubkey)

  return pubkey ? `${COMMUNITY_DEFINITION_KIND}:${pubkey}:` : ""
}

const parseCommunityDefinitionAddress = (address: string) => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (kind !== COMMUNITY_DEFINITION_KIND || !pubkey || identifier) return undefined

  return {pubkey, address: `${COMMUNITY_DEFINITION_KIND}:${pubkey}:`}
}

const getCommunityAddress = (event: TrustedEvent) =>
  event.tags
    .filter(tag => tag[0] === "a")
    .map(tag => parseCommunityDefinitionAddress(tag[1] || ""))
    .find(Boolean)

const getSectionName = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "content")?.[1]?.trim() || ""

export const makeCommunityEventReport = ({
  communityPubkey,
  sectionName,
  eventId,
  eventPubkey,
  content = "",
}: {
  communityPubkey: string
  sectionName: string
  eventId: string
  eventPubkey: string
  content?: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_KIND} => ({
  kind: COMMUNITY_REPORT_KIND,
  content,
  tags: [
    ["e", eventId, COMMUNITY_REPORT_REASON],
    ["p", normalizePubkey(eventPubkey)],
    ["a", makeCommunityDefinitionAddress(communityPubkey)],
    ["content", sectionName],
  ],
})

export const makeCommunityPersonReport = ({
  communityPubkey,
  pubkey,
  content = "",
}: {
  communityPubkey: string
  pubkey: string
  content?: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_KIND} => ({
  kind: COMMUNITY_REPORT_KIND,
  content,
  tags: [
    ["p", normalizePubkey(pubkey), COMMUNITY_REPORT_REASON],
    ["a", makeCommunityDefinitionAddress(communityPubkey)],
  ],
})

export const makeCommunityReportDelete = ({
  reportId,
}: {
  reportId: string
}): EventContent & {kind: typeof COMMUNITY_REPORT_DELETE_KIND} => ({
  kind: COMMUNITY_REPORT_DELETE_KIND,
  content: "Deleted community report",
  tags: [
    ["e", reportId],
    ["k", String(COMMUNITY_REPORT_KIND)],
  ],
})

export const parseCommunityReport = (
  event: TrustedEvent,
  communityPubkey?: string,
): ParsedCommunityReport | undefined => {
  if (event.kind !== COMMUNITY_REPORT_KIND) return undefined

  const community = getCommunityAddress(event)
  if (!community) return undefined
  if (communityPubkey && community.pubkey !== normalizePubkey(communityPubkey)) return undefined

  const eventTag = getReasonTag(event, "e")
  const personReportTag = getReasonTag(event, "p")
  const targetPubkey = normalizePubkey(
    (eventTag ? event.tags.find(tag => tag[0] === "p")?.[1] : personReportTag?.[1]) || "",
  )

  if (!targetPubkey) return undefined

  if (eventTag?.[1]) {
    const sectionName = getSectionName(event)
    if (!sectionName) return undefined

    return {
      event,
      target: "event",
      communityAddress: community.address,
      communityPubkey: community.pubkey,
      targetPubkey,
      targetEventId: eventTag[1],
      sectionName,
    }
  }

  if (!personReportTag?.[1]) return undefined

  return {
    event,
    target: "person",
    communityAddress: community.address,
    communityPubkey: community.pubkey,
    targetPubkey,
  }
}

export const isCommunityReportDeleted = (report: TrustedEvent, deleteEvents: TrustedEvent[]) =>
  deleteEvents.some(event => {
    if (event.kind !== COMMUNITY_REPORT_DELETE_KIND) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(report.pubkey || "")) return false
    if (!event.tags.some(tag => tag[0] === "e" && tag[1] === report.id)) return false

    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return kindTags.length === 0 || kindTags.some(tag => tag[1] === String(COMMUNITY_REPORT_KIND))
  })

export const getAllSectionModeratorPubkeys = (definition: CommunityDefinition) => {
  if (definition.sections.length === 0) return []

  const moderatorSets = definition.sections.map(
    section =>
      new Set(
        getGrantCapableSectionModeratorPubkeys({definition, sectionName: section.name}),
      ),
  )
  const [firstSet, ...restSets] = moderatorSets

  return Array.from(firstSet || []).filter(pubkey => restSets.every(set => set.has(pubkey)))
}

export const getCurrentModeratorPubkeys = (definition: CommunityDefinition) =>
  Array.from(
    new Set(
      definition.sections.flatMap(section =>
        getGrantCapableSectionModeratorPubkeys({definition, sectionName: section.name}),
      ),
    ),
  )

const isAdmin = (definition: CommunityDefinition, pubkey: string) =>
  normalizePubkey(definition.pubkey) === normalizePubkey(pubkey)

const isProtectedModeratorTarget = ({
  definition,
  report,
  reporterIsAdmin,
}: {
  definition: CommunityDefinition
  report: ParsedCommunityReport
  reporterIsAdmin: boolean
}) =>
  !reporterIsAdmin && getCurrentModeratorPubkeys(definition).includes(report.targetPubkey)

const isAuthorizedEventReport = (definition: CommunityDefinition, report: ParsedCommunityReport) => {
  if (report.target !== "event" || !report.sectionName) return false
  if (!findCommunitySection(definition, report.sectionName)) return false

  const reporter = normalizePubkey(report.event.pubkey || "")
  if (isAdmin(definition, reporter)) return true

  return getGrantCapableSectionModeratorPubkeys({
    definition,
    sectionName: report.sectionName,
  }).includes(reporter)
}

const isAuthorizedPersonReport = (definition: CommunityDefinition, report: ParsedCommunityReport) => {
  if (report.target !== "person") return false

  const reporter = normalizePubkey(report.event.pubkey || "")
  if (isAdmin(definition, reporter)) return true

  return getAllSectionModeratorPubkeys(definition).includes(reporter)
}

export const getEffectiveCommunityReportState = ({
  definition,
  reportEvents,
  deleteEvents = [],
}: {
  definition: CommunityDefinition
  reportEvents: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
}): EffectiveCommunityReportState => {
  const state: EffectiveCommunityReportState = {eventReports: [], personReports: []}

  for (const event of reportEvents) {
    if (isCommunityReportDeleted(event, deleteEvents)) continue

    const report = parseCommunityReport(event, definition.pubkey)
    if (!report) continue

    const reporterPubkey = normalizePubkey(event.pubkey || "")
    const adminAuthored = isAdmin(definition, reporterPubkey)
    if (isProtectedModeratorTarget({definition, report, reporterIsAdmin: adminAuthored})) continue

    const effectiveReport = {...report, reporterPubkey, adminAuthored}

    if (report.target === "event" && isAuthorizedEventReport(definition, report)) {
      state.eventReports.push(effectiveReport)
    }

    if (report.target === "person" && isAuthorizedPersonReport(definition, report)) {
      state.personReports.push(effectiveReport)
    }
  }

  return state
}

export const getCommunityCensorReason = ({
  reportState,
  eventId,
  pubkey,
  sectionName,
}: {
  reportState: EffectiveCommunityReportState
  eventId?: string
  pubkey?: string
  sectionName?: string
}): "event" | "person" | undefined => {
  const normalizedPubkey = normalizePubkey(pubkey || "")

  if (
    eventId &&
    sectionName &&
    reportState.eventReports.some(
      report => report.targetEventId === eventId && report.sectionName === sectionName,
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
