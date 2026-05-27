import {describe, expect, it} from "vitest"
import {
  COMMUNITY_MEMBER_FLOOR,
  DIRECT_FOLLOW_WEIGHT,
  DIRECT_MUTE_WEIGHT,
  OVERLAY_CAP,
  REPORT_WEIGHT,
  clampOverlayScore,
  getTrustEvidenceLabels,
  makeRepoCommunityContext,
  makeTrustAssessment,
  suppressTrustAssessment,
  type TrustEvidence,
} from "./trust-assessment"

describe("trust assessment vocabulary", () => {
  const memberEvidence: TrustEvidence = {
    type: "community_member",
    communityPubkey: "c".repeat(64),
    sectionName: "Repositories",
    label: "Community member",
  }

  it("derives unique display labels from semantic evidence", () => {
    expect(getTrustEvidenceLabels([memberEvidence, {...memberEvidence}])).toEqual([
      "Community member",
    ])
  })

  it("keeps direct social and report overlays below community membership", () => {
    expect(DIRECT_FOLLOW_WEIGHT).toBe(1)
    expect(DIRECT_MUTE_WEIGHT).toBe(-1)
    expect(REPORT_WEIGHT).toBe(-2)
    expect(OVERLAY_CAP).toBeLessThan(COMMUNITY_MEMBER_FLOOR)
    expect(clampOverlayScore(99)).toBe(OVERLAY_CAP)
    expect(clampOverlayScore(-99)).toBe(-OVERLAY_CAP)
  })

  it("keeps internal score separate from evidence labels", () => {
    const assessment = makeTrustAssessment({
      category: "community_member",
      score: 4,
      evidence: [memberEvidence],
    })

    expect(assessment.score).toBe(4)
    expect(assessment.displayLabels).toEqual(["Community member"])
    expect(assessment.suppressed).toBe(false)
  })

  it("marks suppression separately from score", () => {
    const assessment = makeTrustAssessment({
      category: "community_member",
      score: 4,
      evidence: [memberEvidence],
    })
    const suppressed = suppressTrustAssessment(assessment, "community_ban", [
      {
        type: "community_ban",
        communityPubkey: "c".repeat(64),
        label: "Banned here",
      },
    ])

    expect(suppressed.category).toBe("suppressed")
    expect(suppressed.score).toBe(4)
    expect(suppressed.suppressed).toBe(true)
    expect(suppressed.suppressionReason).toBe("community_ban")
    expect(suppressed.displayLabels).toEqual(["Community member", "Banned here"])
  })

  it("builds repo community context with stable defaults", () => {
    expect(
      makeRepoCommunityContext({
        repoAddress: "30617:owner:repo",
        relayHints: ["wss://relay.example.com", "", "wss://relay.example.com"],
      }),
    ).toEqual({
      repoAddress: "30617:owner:repo",
      communityPubkey: undefined,
      associationEventId: undefined,
      associationAuthorPubkey: undefined,
      relayHints: ["wss://relay.example.com"],
      validation: "unknown",
      evidence: [],
      suppressed: false,
      suppressionReason: undefined,
    })
  })
})
