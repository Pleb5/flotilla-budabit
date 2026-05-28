import {describe, expect, it} from "vitest"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import type {TrustAssessment} from "@app/core/trust-assessment"
import {getProfileTrustBadges} from "./profile-trust-badges"

const targetPubkey = "a".repeat(64)
const activeCommunityPubkey = "b".repeat(64)
const otherCommunityPubkey = "c".repeat(64)

const makeCommunityRef = (communityPubkey: string) =>
  ({
    communityPubkey,
    relayHints: [],
    roles: ["member"],
    writableSections: [],
  }) as unknown as ActiveUserCommunityRef

const makeReportState = (targetPubkeys: string[]): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: targetPubkeys.map((targetPubkey, index) => ({
      target: "person",
      targetPubkey,
      reporterPubkey: `reporter-${index}`,
      adminAuthored: true,
      event: {id: `report-${index}`, created_at: index, tags: []},
    })),
  }) as unknown as EffectiveCommunityReportState

const makeAssessment = (overrides: Partial<TrustAssessment>): TrustAssessment => ({
  category: "unknown",
  score: 0,
  evidence: [],
  displayLabels: [],
  suppressed: false,
  ...overrides,
})

describe("profile trust badges", () => {
  it("turns active community trust evidence into semantic badges", () => {
    const badges = getProfileTrustBadges({
      assessment: makeAssessment({
        evidence: [
          {
            type: "community_member",
            label: "Community member",
            communityPubkey: activeCommunityPubkey,
          },
          {
            type: "community_report",
            label: "Reported here",
            communityPubkey: activeCommunityPubkey,
          },
        ],
        displayLabels: ["Community member", "Reported here"],
      }),
    })

    expect(badges).toMatchObject([
      {label: "Community member", tone: "neutral"},
      {label: "Reported here", tone: "warning"},
    ])
  })

  it("shows aggregate bans from the viewer's communities", () => {
    const badges = getProfileTrustBadges({
      targetPubkey,
      viewerCommunityRefs: [
        makeCommunityRef(activeCommunityPubkey),
        makeCommunityRef(otherCommunityPubkey),
      ],
      reportStates: new Map([
        [activeCommunityPubkey, makeReportState([targetPubkey])],
        [otherCommunityPubkey, makeReportState([targetPubkey])],
      ]),
    })

    expect(badges).toMatchObject([{label: "Banned in 2 of your communities", tone: "error"}])
  })

  it("keeps the active ban badge and aggregates only other community bans", () => {
    const badges = getProfileTrustBadges({
      targetPubkey,
      activeCommunityPubkey,
      assessment: makeAssessment({
        evidence: [
          {type: "community_ban", label: "Banned here", communityPubkey: activeCommunityPubkey},
        ],
        displayLabels: ["Banned here"],
        suppressed: true,
        suppressionReason: "community_ban",
      }),
      viewerCommunityRefs: [
        makeCommunityRef(activeCommunityPubkey),
        makeCommunityRef(otherCommunityPubkey),
      ],
      reportStates: new Map([
        [activeCommunityPubkey, makeReportState([targetPubkey])],
        [otherCommunityPubkey, makeReportState([targetPubkey])],
      ]),
    })

    expect(badges.map(badge => badge.label)).toEqual(["Banned here", "Banned in 1 other community"])
  })
})
