import {normalizePubkey} from "@app/core/community"
import {isCommunityPersonBanned} from "@app/core/community-reports"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import type {TrustAssessment, TrustEvidence, TrustEvidenceType} from "@app/core/trust-assessment"

export type ProfileTrustBadgeTone = "error" | "warning" | "info" | "success" | "neutral"

export type ProfileTrustBadge = {
  key: string
  label: string
  tone: ProfileTrustBadgeTone
  title?: string
}

export type ProfileTrustBadgeInput = {
  assessment?: TrustAssessment
  viewerCommunityRefs?: ActiveUserCommunityRef[]
  reportStates?: UserCommunityReportStates
  targetPubkey?: string
  activeCommunityPubkey?: string
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

const labelToneByEvidenceType: Partial<Record<TrustEvidenceType, ProfileTrustBadgeTone>> = {
  self: "success",
  community_admin: "success",
  community_moderator: "info",
  community_member: "neutral",
  shared_communities: "neutral",
  shared_section: "neutral",
  community_report: "warning",
  community_ban: "error",
}

const getToneForEvidence = (evidence: TrustEvidence): ProfileTrustBadgeTone =>
  labelToneByEvidenceType[evidence.type] || "neutral"

const makeEvidenceBadge = (evidence: TrustEvidence): ProfileTrustBadge | undefined => {
  const label = evidence.label.trim()
  if (!label) return undefined

  return {
    key: `evidence:${evidence.type}:${evidence.communityPubkey || ""}:${label}`,
    label,
    tone: getToneForEvidence(evidence),
  }
}

const addBadge = (badges: Map<string, ProfileTrustBadge>, badge: ProfileTrustBadge | undefined) => {
  if (!badge) return
  if ([...badges.values()].some(item => item.label === badge.label)) return

  badges.set(badge.key, badge)
}

const getBannedCommunityPubkeys = ({
  viewerCommunityRefs = [],
  reportStates,
  targetPubkey,
}: Pick<ProfileTrustBadgeInput, "viewerCommunityRefs" | "reportStates" | "targetPubkey">) => {
  const normalizedTarget = normalizePubkey(targetPubkey || "")
  if (!normalizedTarget) return []

  return viewerCommunityRefs
    .map(ref => ref.communityPubkey)
    .filter(Boolean)
    .filter(communityPubkey =>
      isCommunityPersonBanned(getReportState(reportStates, communityPubkey), normalizedTarget),
    )
}

const makeBannedCommunityBadge = ({
  count,
  activeExcluded,
}: {
  count: number
  activeExcluded: boolean
}): ProfileTrustBadge | undefined => {
  if (count <= 0) return undefined

  const label = activeExcluded
    ? count === 1
      ? "Banned in 1 other community"
      : `Banned in ${count} other communities`
    : count === 1
      ? "Banned in 1 of your communities"
      : `Banned in ${count} of your communities`

  return {
    key: `community-bans:${activeExcluded ? "other" : "all"}:${count}`,
    label,
    tone: "error",
    title: activeExcluded
      ? "This profile is also banned in other communities you belong to."
      : "This profile is banned in communities you belong to.",
  }
}

export const getProfileTrustBadges = ({
  assessment,
  viewerCommunityRefs = [],
  reportStates,
  targetPubkey,
  activeCommunityPubkey = "",
}: ProfileTrustBadgeInput): ProfileTrustBadge[] => {
  const badges = new Map<string, ProfileTrustBadge>()

  for (const evidence of assessment?.evidence || []) {
    addBadge(badges, makeEvidenceBadge(evidence))
  }

  for (const label of assessment?.displayLabels || []) {
    addBadge(badges, {key: `label:${label}`, label, tone: "neutral"})
  }

  const activeCommunity = normalizePubkey(activeCommunityPubkey)
  const bannedCommunityPubkeys = getBannedCommunityPubkeys({
    viewerCommunityRefs,
    reportStates,
    targetPubkey,
  })
  const hasActiveBanBadge = Boolean(
    activeCommunity &&
    bannedCommunityPubkeys.includes(activeCommunity) &&
    [...badges.values()].some(badge => badge.label === "Banned here"),
  )
  const aggregateBanCount = hasActiveBanBadge
    ? bannedCommunityPubkeys.filter(pubkey => pubkey !== activeCommunity).length
    : bannedCommunityPubkeys.length

  addBadge(
    badges,
    makeBannedCommunityBadge({count: aggregateBanCount, activeExcluded: hasActiveBanBadge}),
  )

  return [...badges.values()]
}
