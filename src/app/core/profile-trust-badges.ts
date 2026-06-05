import type {TrustedEvent} from "@welshman/util"
import {
  getCommunitySectionDisplayName,
  normalizePubkey,
  normalizeRelays,
  type CommunityDefinition,
} from "@app/core/community"
import {
  selectCommunityMemberList,
  type ActiveUserCommunityRef,
  type CommunityMemberSectionRef,
  type UserCommunityReportStates,
} from "@app/core/community-membership"
import {
  isCommunityReportDeleted,
  parseCommunityReport,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"

export type ProfileTrustBadgeTone = "error" | "warning" | "info" | "success" | "neutral"

export type SharedProfileCommunityRole = "banned" | "admin" | "moderator" | "member"

export type SharedProfileCommunityEvidenceItem = {
  key: string
  role: SharedProfileCommunityRole
  communityPubkey: string
  definition: CommunityDefinition
  relayHints: string[]
  adminSectionNames: string[]
  moderatorSections: CommunityMemberSectionRef[]
  memberSections: CommunityMemberSectionRef[]
  sectionCount: number
  grantCount: number
  banCount: number
}

export type SharedProfileCommunityEvidenceGroup = {
  key: string
  role: SharedProfileCommunityRole
  tone: ProfileTrustBadgeTone
  items: SharedProfileCommunityEvidenceItem[]
}

export type SharedProfileCommunityEvidenceInput = {
  targetPubkey?: string
  viewerCommunityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}

export type ProfileFlagReportEvidenceItem = {
  key: string
  communityPubkey: string
  definition: CommunityDefinition
  relayHints: string[]
  event: TrustedEvent
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
  reason: string
  reportContent: string
}

export type ProfileFlagReportEvidenceInput = {
  targetPubkey?: string
  viewerPubkey?: string
  viewerCommunityRefs?: ActiveUserCommunityRef[]
  reportEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
}

const groupOrder: SharedProfileCommunityRole[] = ["banned", "admin", "moderator", "member"]

const toneByRole: Record<SharedProfileCommunityRole, ProfileTrustBadgeTone> = {
  banned: "error",
  admin: "success",
  moderator: "info",
  member: "neutral",
}

const isRelayHint = (value: string | undefined) => /^wss?:\/\//i.test(value?.trim() || "")

const getReasonValue = (tag: string[]) => {
  const explicitReason = tag[3]?.trim()
  if (explicitReason) return explicitReason

  const thirdValue = tag[2]?.trim()

  return thirdValue && !isRelayHint(thirdValue) ? thirdValue : ""
}

const getReportReason = (
  event: TrustedEvent,
  target: {targetEventId?: string; targetAddress?: string},
) => {
  const reasonTags = event.tags.filter(tag => {
    if (tag[0] === "e" && target.targetEventId && tag[1] === target.targetEventId) return true
    if (tag[0] === "a" && target.targetAddress && tag[1] === target.targetAddress) return true

    return false
  })

  return reasonTags.map(getReasonValue).find(Boolean) || event.content?.trim() || ""
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

const countBanReports = (
  reportState: EffectiveCommunityReportState | undefined,
  targetPubkey: string,
) =>
  reportState?.personReports.filter(report => normalizePubkey(report.targetPubkey) === targetPubkey)
    .length || 0

const getAdminSectionNames = (definition: CommunityDefinition) =>
  definition.sections.map(getCommunitySectionDisplayName)

const getRoleSortValue = (item: SharedProfileCommunityEvidenceItem) => {
  if (item.role === "banned") return item.banCount
  if (item.role === "member") return item.grantCount

  return item.sectionCount
}

const sortEvidenceItems = (items: SharedProfileCommunityEvidenceItem[]) =>
  [...items].sort(
    (a, b) =>
      getRoleSortValue(b) - getRoleSortValue(a) ||
      a.communityPubkey.localeCompare(b.communityPubkey),
  )

const makeEvidenceItem = ({
  role,
  ref,
  adminSectionNames = [],
  moderatorSections = [],
  memberSections = [],
  banCount = 0,
}: {
  role: SharedProfileCommunityRole
  ref: ActiveUserCommunityRef
  adminSectionNames?: string[]
  moderatorSections?: CommunityMemberSectionRef[]
  memberSections?: CommunityMemberSectionRef[]
  banCount?: number
}): SharedProfileCommunityEvidenceItem => {
  const sectionCount =
    role === "admin"
      ? adminSectionNames.length
      : role === "moderator"
        ? moderatorSections.length
        : 0
  const grantCount = role === "member" ? memberSections.length : 0

  return {
    key: `${role}:${ref.communityPubkey}`,
    role,
    communityPubkey: ref.communityPubkey,
    definition: ref.definition,
    relayHints: normalizeRelays([...(ref.relayHints || []), ...(ref.definition.relays || [])]),
    adminSectionNames,
    moderatorSections,
    memberSections,
    sectionCount,
    grantCount,
    banCount,
  }
}

export const getSharedProfileCommunityEvidenceGroups = ({
  targetPubkey,
  viewerCommunityRefs = [],
  profileListEvents = [],
  reportStates,
}: SharedProfileCommunityEvidenceInput): SharedProfileCommunityEvidenceGroup[] => {
  const target = normalizePubkey(targetPubkey || "")
  if (!target || viewerCommunityRefs.length === 0) return []

  const items: SharedProfileCommunityEvidenceItem[] = []
  const seenCommunities = new Set<string>()

  for (const ref of viewerCommunityRefs) {
    const communityPubkey = normalizePubkey(ref.communityPubkey)
    if (!communityPubkey || seenCommunities.has(communityPubkey)) continue

    seenCommunities.add(communityPubkey)

    const reportState = getReportState(reportStates, communityPubkey)
    const banCount = countBanReports(reportState, target)

    if (banCount > 0) {
      items.push(makeEvidenceItem({role: "banned", ref, banCount}))
      continue
    }

    const member = selectCommunityMemberList({
      definition: ref.definition,
      profileListEvents,
      reportState,
    }).find(person => person.pubkey === target)

    if (normalizePubkey(ref.definition.pubkey) === target || member?.isAdmin) {
      items.push(
        makeEvidenceItem({
          role: "admin",
          ref,
          adminSectionNames: getAdminSectionNames(ref.definition),
        }),
      )
      continue
    }

    if (member?.isModerator) {
      items.push(
        makeEvidenceItem({
          role: "moderator",
          ref,
          moderatorSections: member.moderatorSections,
        }),
      )
      continue
    }

    if (member && member.grantCount > 0) {
      items.push(makeEvidenceItem({role: "member", ref, memberSections: member.sectionGrants}))
    }
  }

  return groupOrder.flatMap(role => {
    const roleItems = sortEvidenceItems(items.filter(item => item.role === role))

    return roleItems.length > 0
      ? [
          {
            key: role,
            role,
            tone: toneByRole[role],
            items: roleItems,
          },
        ]
      : []
  })
}

export const getProfileFlagReportEvidence = ({
  targetPubkey,
  viewerPubkey,
  viewerCommunityRefs = [],
  reportEvents = [],
  deleteEvents = [],
}: ProfileFlagReportEvidenceInput): ProfileFlagReportEvidenceItem[] => {
  const target = normalizePubkey(targetPubkey || "")
  const viewer = normalizePubkey(viewerPubkey || "")
  if (!target || !viewer || viewerCommunityRefs.length === 0) return []

  const refsByCommunity = new Map(
    viewerCommunityRefs.flatMap(ref => {
      const communityPubkey = normalizePubkey(ref.communityPubkey)

      return communityPubkey ? [[communityPubkey, ref] as const] : []
    }),
  )
  const items: ProfileFlagReportEvidenceItem[] = []
  const seenReports = new Set<string>()

  for (const event of reportEvents) {
    if (!event.id || seenReports.has(event.id)) continue
    if (normalizePubkey(event.pubkey || "") !== viewer) continue
    if (isCommunityReportDeleted(event, deleteEvents)) continue

    const report = parseCommunityReport(event)
    if (!report || report.target !== "event" || report.targetPubkey !== target) continue

    const ref = refsByCommunity.get(report.communityPubkey)
    if (!ref) continue

    seenReports.add(event.id)
    items.push({
      key: `${report.communityPubkey}:${event.id}`,
      communityPubkey: report.communityPubkey,
      definition: ref.definition,
      relayHints: normalizeRelays([...(ref.relayHints || []), ...(ref.definition.relays || [])]),
      event,
      targetPubkey: report.targetPubkey,
      targetAddress: report.targetAddress,
      targetEventId: report.targetEventId,
      targetEventKind: report.targetEventKind,
      targetEventSubtype: report.targetEventSubtype,
      targetEventTitle: report.targetEventTitle || undefined,
      targetEventContent: report.targetEventContent || undefined,
      targetRootId: report.targetRootId,
      targetRootKind: report.targetRootKind,
      targetIdentifier: report.targetIdentifier,
      targetScope: report.targetScope,
      reason: getReportReason(event, report),
      reportContent: event.content?.trim() || "",
    })
  }

  return items.sort(
    (a, b) => b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id),
  )
}
