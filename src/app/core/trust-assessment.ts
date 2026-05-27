export type TrustCategory =
  | "self"
  | "owned"
  | "starred"
  | "community_admin"
  | "community_moderator"
  | "community_member"
  | "community_associated"
  | "direct_follow"
  | "known"
  | "suppressed"
  | "unknown"

export type TrustEvidenceType =
  | "self"
  | "owned"
  | "starred"
  | "community_admin"
  | "community_moderator"
  | "community_member"
  | "shared_section"
  | "shared_communities"
  | "community_associated"
  | "association_authority"
  | "you_follow"
  | "muted_by_you"
  | "community_report"
  | "community_ban"
  | "known_repo_owner"

export type TrustEvidence = {
  type: TrustEvidenceType
  communityPubkey?: string
  sectionName?: string
  repoAddress?: string
  count?: number
  label: string
}

export type TrustContextScope = "global_discovery" | "active_community" | "community" | "repo"

export type TrustContext = {
  scope: TrustContextScope
  viewerPubkey?: string
  communityPubkey?: string
  repoAddress?: string
}

export type TrustSuppressionReason = "community_ban" | "event_report"

export type TrustAssessment = {
  category: TrustCategory
  score: number
  evidence: TrustEvidence[]
  displayLabels: string[]
  suppressed: boolean
  suppressionReason?: TrustSuppressionReason
}

export type RepoAssociationValidation = "strong" | "valid" | "weak" | "invalid" | "unknown"

export type RepoCommunityContext = {
  repoAddress: string
  communityPubkey?: string
  associationEventId?: string
  associationAuthorPubkey?: string
  relayHints: string[]
  validation: RepoAssociationValidation
  evidence: TrustEvidence[]
  suppressed: boolean
  suppressionReason?: TrustSuppressionReason
}

const unique = <T>(values: T[]) => Array.from(new Set(values))

export const getTrustEvidenceLabels = (evidence: TrustEvidence[]) =>
  unique(evidence.map(item => item.label).filter(Boolean))

export const makeTrustAssessment = ({
  category = "unknown",
  score = 0,
  evidence = [],
  suppressed = false,
  suppressionReason,
}: Partial<TrustAssessment> = {}): TrustAssessment => ({
  category,
  score,
  evidence,
  displayLabels: getTrustEvidenceLabels(evidence),
  suppressed,
  suppressionReason,
})

export const suppressTrustAssessment = (
  assessment: TrustAssessment,
  suppressionReason: TrustSuppressionReason,
  evidence: TrustEvidence[] = [],
): TrustAssessment => {
  const nextEvidence = [...assessment.evidence, ...evidence]

  return {
    ...assessment,
    category: "suppressed",
    evidence: nextEvidence,
    displayLabels: getTrustEvidenceLabels(nextEvidence),
    suppressed: true,
    suppressionReason,
  }
}

export const makeRepoCommunityContext = ({
  repoAddress,
  communityPubkey,
  associationEventId,
  associationAuthorPubkey,
  relayHints = [],
  validation = "unknown",
  evidence = [],
  suppressed = false,
  suppressionReason,
}: Partial<RepoCommunityContext> & {repoAddress: string}): RepoCommunityContext => ({
  repoAddress,
  communityPubkey,
  associationEventId,
  associationAuthorPubkey,
  relayHints: unique(relayHints.filter(Boolean)),
  validation,
  evidence,
  suppressed,
  suppressionReason,
})
