import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import {
  COMMUNITY_MEMBER_FLOOR,
  DIRECT_FOLLOW_WEIGHT,
  OVERLAY_CAP,
  REPORT_WEIGHT,
} from "./trust-assessment"
import {
  COMMUNITY_REPORT_KIND,
  getEffectiveCommunityReportState,
  makeCommunityEventReport,
  makeCommunityPersonReport,
} from "./community-reports"
import {
  MAX_SHARED_COMMUNITY_BONUS,
  buildCommunityTrustAssessment,
  buildCommunityTrustAssessments,
} from "./community-trust"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = ({
  id,
  pubkey,
  sectionName = "Repositories",
  profileListAddress,
  profileListAddresses,
}: {
  id: string
  pubkey: string
  sectionName?: string
  profileListAddress?: string
  profileListAddresses?: string[]
}) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://relay.example.com"],
        ["content", sectionName],
        ["k", "30617"],
        ...[
          ...(profileListAddresses || []),
          ...(profileListAddress ? [profileListAddress] : []),
        ].map(address => ["a", address]),
      ],
    }),
  )!

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
}) =>
  makeEvent({
    id,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

describe("community trust", () => {
  it("scores active-community members above direct follows", () => {
    const viewerPubkey = "1".repeat(64)
    const memberPubkey = "2".repeat(64)
    const communityPubkey = "3".repeat(64)
    const listOwner = "4".repeat(64)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definitions = [
      makeDefinition({id: "community", pubkey: communityPubkey, profileListAddress: listAddress}),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {scope: "active_community", communityPubkey},
      definitions,
      profileListEvents,
    })

    expect(assessment.category).toBe("community_member")
    expect(assessment.score).toBeGreaterThan(DIRECT_FOLLOW_WEIGHT)
    expect(assessment.displayLabels).toContain("Community member")
  })

  it("scores active-community moderators above members", () => {
    const viewerPubkey = "1".repeat(64)
    const moderatorPubkey = "2".repeat(64)
    const memberPubkey = "3".repeat(64)
    const communityPubkey = "4".repeat(64)
    const memberListOwner = "5".repeat(64)
    const moderatorListAddress = `${PROFILE_LIST_KIND}:${moderatorPubkey}:Repositories`
    const memberListAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:Repositories`
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddresses: [moderatorListAddress, memberListAddress],
      }),
    ]
    const profileListEvents = [
      makeProfileList({id: "moderators", pubkey: moderatorPubkey, identifier: "Repositories"}),
      makeProfileList({
        id: "members",
        pubkey: memberListOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const context = {scope: "active_community" as const, communityPubkey}

    const moderator = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: moderatorPubkey,
      context,
      definitions,
      profileListEvents,
    })
    const member = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context,
      definitions,
      profileListEvents,
    })

    expect(moderator.category).toBe("community_moderator")
    expect(moderator.score).toBeGreaterThan(member.score)
    expect(moderator.displayLabels).toContain("Moderator")
  })

  it("emits capped shared-community and shared-section evidence", () => {
    const viewerPubkey = "1".repeat(64)
    const targetPubkey = "2".repeat(64)
    const communities = ["3".repeat(64), "4".repeat(64), "5".repeat(64)]
    const listOwners = ["6".repeat(64), "7".repeat(64), "8".repeat(64)]
    const definitions = communities.map((communityPubkey, index) =>
      makeDefinition({
        id: `community-${index}`,
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwners[index]}:Repositories`,
      }),
    )
    const profileListEvents = listOwners.map((listOwner, index) =>
      makeProfileList({
        id: `members-${index}`,
        pubkey: listOwner,
        identifier: "Repositories",
        members: [viewerPubkey, targetPubkey],
      }),
    )

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey,
      context: {scope: "global_discovery"},
      definitions,
      profileListEvents,
    })

    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR + MAX_SHARED_COMMUNITY_BONUS + 1)
    expect(assessment.displayLabels).toContain("3 shared communities")
    expect(assessment.displayLabels).toContain("Shared Repositories section")
  })

  it("does not count a social-only target as community-aligned", () => {
    const assessment = buildCommunityTrustAssessment({
      viewerPubkey: "1".repeat(64),
      targetPubkey: "2".repeat(64),
      context: {scope: "global_discovery"},
    })

    expect(assessment.category).toBe("unknown")
    expect(assessment.score).toBe(0)
    expect(assessment.evidence).toEqual([])
  })

  it("applies contextual event report penalties to target authors", () => {
    const viewerPubkey = "1".repeat(64)
    const memberPubkey = "2".repeat(64)
    const communityPubkey = "3".repeat(64)
    const listOwner = "4".repeat(64)
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const reportEvent = makeEvent({
      id: "event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "Repositories",
        eventId: "reported-event",
        eventPubkey: memberPubkey,
      }).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents: [reportEvent],
    })

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {scope: "active_community", communityPubkey},
      definitions,
      profileListEvents,
      reportStates: new Map([[communityPubkey, reportState]]),
    })

    expect(assessment.category).toBe("community_member")
    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR + REPORT_WEIGHT)
    expect(assessment.suppressed).toBe(false)
    expect(assessment.displayLabels).toEqual(["Community member", "Reported here"])
  })

  it("caps repeated report penalties so reports do not erase membership evidence", () => {
    const viewerPubkey = "1".repeat(64)
    const memberPubkey = "2".repeat(64)
    const communityPubkey = "3".repeat(64)
    const listOwner = "4".repeat(64)
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const reportEvents = ["reported-event-1", "reported-event-2", "reported-event-3"].map(
      (eventId, index) =>
        makeEvent({
          id: `event-report-${index}`,
          kind: COMMUNITY_REPORT_KIND,
          pubkey: communityPubkey,
          tags: makeCommunityEventReport({
            communityPubkey,
            sectionName: "Repositories",
            eventId,
            eventPubkey: memberPubkey,
          }).tags,
        }),
    )
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents,
    })

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {scope: "active_community", communityPubkey},
      definitions,
      profileListEvents,
      reportStates: new Map([[communityPubkey, reportState]]),
    })

    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR - OVERLAY_CAP)
    expect(assessment.displayLabels).toEqual(["Community member", "3 reports here"])
    expect(assessment.suppressed).toBe(false)
  })

  it("suppresses person bans only in the reported community context", () => {
    const viewerPubkey = "1".repeat(64)
    const memberPubkey = "2".repeat(64)
    const communityPubkey = "3".repeat(64)
    const otherCommunityPubkey = "4".repeat(64)
    const listOwner = "5".repeat(64)
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [memberPubkey],
      }),
    ]
    const banEvent = makeEvent({
      id: "person-ban",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: memberPubkey}).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition: definitions[0],
      reportEvents: [banEvent],
    })
    const reportStates = new Map([[communityPubkey, reportState]])

    const assessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {scope: "active_community", communityPubkey},
      definitions,
      profileListEvents,
      reportStates,
    })
    const unrelatedAssessment = buildCommunityTrustAssessment({
      viewerPubkey,
      targetPubkey: memberPubkey,
      context: {scope: "active_community", communityPubkey: otherCommunityPubkey},
      definitions,
      profileListEvents,
      reportStates,
    })

    expect(assessment.category).toBe("suppressed")
    expect(assessment.score).toBe(COMMUNITY_MEMBER_FLOOR)
    expect(assessment.suppressionReason).toBe("community_ban")
    expect(assessment.displayLabels).toEqual(["Community member", "Banned here"])
    expect(unrelatedAssessment.suppressed).toBe(false)
    expect(unrelatedAssessment.displayLabels).not.toContain("Banned here")
  })

  it("builds candidate assessments while reusing collected refs", () => {
    const viewerPubkey = "1".repeat(64)
    const memberPubkey = "2".repeat(64)
    const unknownPubkey = "3".repeat(64)
    const communityPubkey = "4".repeat(64)
    const listOwner = "5".repeat(64)
    const definitions = [
      makeDefinition({
        id: "community",
        pubkey: communityPubkey,
        profileListAddress: `${PROFILE_LIST_KIND}:${listOwner}:Repositories`,
      }),
    ]
    const profileListEvents = [
      makeProfileList({
        id: "members",
        pubkey: listOwner,
        identifier: "Repositories",
        members: [viewerPubkey, memberPubkey],
      }),
    ]
    const assessments = buildCommunityTrustAssessments({
      viewerPubkey,
      candidatePubkeys: [memberPubkey, unknownPubkey],
      context: {scope: "global_discovery"},
      definitions,
      profileListEvents,
    })

    expect(assessments.get(memberPubkey)?.category).toBe("community_member")
    expect(assessments.get(unknownPubkey)?.category).toBe("unknown")
  })
})
