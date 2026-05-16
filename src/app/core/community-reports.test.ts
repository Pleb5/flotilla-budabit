import {describe, expect, it} from "vitest"
import {BADGE_DEFINITION, DELETE, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import {
  COMMUNITY_REPORT_KIND,
  canPublishCommunityEventReport,
  canPublishCommunityPersonReport,
  getAllSectionModeratorPubkeys,
  getCommunityCensorReason,
  getEffectiveCommunityModerationActionsByReporter,
  getEffectiveCommunityReportState,
  makeCommunityEventReport,
  makeCommunityPersonReport,
  makeCommunityReportDelete,
  parseCommunityReport,
} from "./community-reports"

const communityPubkey = "a".repeat(64)
const sectionModeratorPubkey = "b".repeat(64)
const allSectionModeratorPubkey = "c".repeat(64)
const targetPubkey = "d".repeat(64)
const outsiderPubkey = "e".repeat(64)
const otherSectionModeratorPubkey = "f".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = ({includeSectionModerator = true} = {}) =>
  parseCommunityDefinition(
    makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: communityPubkey,
      tags: [
        ["content", "General"],
        ["k", "9", "room-message"],
        ["k", "1111"],
        ...(includeSectionModerator
          ? [
              ["a", `${PROFILE_LIST_KIND}:${sectionModeratorPubkey}:General`],
              ["badge", `${BADGE_DEFINITION}:${sectionModeratorPubkey}:General`],
            ]
          : []),
        ["a", `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:General`],
        ["badge", `${BADGE_DEFINITION}:${allSectionModeratorPubkey}:General`],
        ["content", "Forum"],
        ["k", "11", "forum"],
        ["a", `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:Forum`],
        ["badge", `${BADGE_DEFINITION}:${allSectionModeratorPubkey}:Forum`],
        ["a", `${PROFILE_LIST_KIND}:${otherSectionModeratorPubkey}:Forum`],
        ["badge", `${BADGE_DEFINITION}:${otherSectionModeratorPubkey}:Forum`],
      ],
    }),
  )!

describe("community reports", () => {
  it("builds and parses community event and person spam reports", () => {
    const eventReport = makeEvent({
      id: "event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const personReport = makeEvent({
      id: "person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })

    expect(parseCommunityReport(eventReport, communityPubkey)).toMatchObject({
      target: "event",
      sectionName: "General",
      targetEventId: "reported-event",
      targetPubkey,
    })
    expect(parseCommunityReport(personReport, communityPubkey)).toMatchObject({
      target: "person",
      targetPubkey,
    })
  })

  it("applies admin, section moderator, and all-section moderator reports", () => {
    const definition = makeDefinition()
    const adminEventReport = makeEvent({
      id: "admin-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "Forum",
        eventId: "forum-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const sectionModeratorEventReport = makeEvent({
      id: "section-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "general-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const allSectionPersonReport = makeEvent({
      id: "person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [adminEventReport, sectionModeratorEventReport, allSectionPersonReport],
    })

    expect(getAllSectionModeratorPubkeys(definition)).toEqual([allSectionModeratorPubkey])
    expect(
      getCommunityCensorReason({reportState: state, eventId: "forum-event", sectionName: "Forum"}),
    ).toBe("event")
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "general-event",
        sectionName: "General",
      }),
    ).toBe("event")
    expect(getCommunityCensorReason({reportState: state, pubkey: targetPubkey})).toBe("person")
  })

  it("ignores unauthorized person reports, deleted reports, and reports from removed moderators", () => {
    const definition = makeDefinition()
    const removedDefinition = makeDefinition({includeSectionModerator: false})
    const unauthorizedPersonReport = makeEvent({
      id: "unauthorized-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const deletedEventReport = makeEvent({
      id: "deleted-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "deleted-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const deleteEvent = makeEvent({
      id: "delete-event-report",
      kind: DELETE,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityReportDelete({reportId: deletedEventReport.id}).tags,
    })
    const removedModeratorReport = makeEvent({
      id: "removed-moderator-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "removed-moderator-event",
        eventPubkey: targetPubkey,
      }).tags,
    })

    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [unauthorizedPersonReport, deletedEventReport],
      deleteEvents: [deleteEvent],
    })
    const removedState = getEffectiveCommunityReportState({
      definition: removedDefinition,
      reportEvents: [removedModeratorReport],
    })

    expect(getCommunityCensorReason({reportState: state, pubkey: targetPubkey})).toBeUndefined()
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "deleted-event",
        sectionName: "General",
      }),
    ).toBeUndefined()
    expect(
      getCommunityCensorReason({
        reportState: removedState,
        eventId: "removed-moderator-event",
        sectionName: "General",
      }),
    ).toBeUndefined()
  })

  it("protects current moderators from moderator reports but not admin reports", () => {
    const definition = makeDefinition()
    const moderatorReport = makeEvent({
      id: "moderator-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "moderator-authored-event",
        eventPubkey: sectionModeratorPubkey,
      }).tags,
    })
    const adminReport = makeEvent({
      id: "admin-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: sectionModeratorPubkey}).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [moderatorReport, adminReport],
    })

    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "moderator-authored-event",
        sectionName: "General",
      }),
    ).toBeUndefined()
    expect(getCommunityCensorReason({reportState: state, pubkey: sectionModeratorPubkey})).toBe(
      "person",
    )
  })

  it("ignores self moderation reports", () => {
    const definition = makeDefinition()
    const ownEventReport = makeEvent({
      id: "own-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "own-event",
        eventPubkey: communityPubkey,
      }).tags,
    })
    const ownPersonReport = makeEvent({
      id: "own-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({
        communityPubkey,
        pubkey: allSectionModeratorPubkey,
      }).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [ownEventReport, ownPersonReport],
    })

    expect(
      getCommunityCensorReason({reportState: state, eventId: "own-event", sectionName: "General"}),
    ).toBeUndefined()
    expect(
      getCommunityCensorReason({reportState: state, pubkey: allSectionModeratorPubkey}),
    ).toBeUndefined()
  })

  it("authorizes UI moderation actions with render-time report rules", () => {
    const definition = makeDefinition()

    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
        sectionName: "General",
      }),
    ).toBe(true)
    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
        sectionName: "Forum",
      }),
    ).toBe(false)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
      }),
    ).toBe(false)
    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey: sectionModeratorPubkey,
        sectionName: "General",
      }),
    ).toBe(false)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: communityPubkey,
        targetPubkey: sectionModeratorPubkey,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: communityPubkey,
        targetPubkey: communityPubkey,
        sectionName: "General",
      }),
    ).toBe(false)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey: allSectionModeratorPubkey,
      }),
    ).toBe(false)
  })

  it("sorts active moderation actions by reporter", () => {
    const definition = makeDefinition()
    const olderReport = makeEvent({
      id: "older-report",
      created_at: 10,
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "older-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const newerReport = makeEvent({
      id: "newer-report",
      created_at: 20,
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "newer-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const otherReporterReport = makeEvent({
      id: "other-reporter-report",
      created_at: 30,
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [olderReport, newerReport, otherReporterReport],
    })

    expect(
      getEffectiveCommunityModerationActionsByReporter(state, sectionModeratorPubkey).map(
        report => report.event.id,
      ),
    ).toEqual(["newer-report", "older-report"])
  })
})
