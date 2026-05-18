import {describe, expect, it} from "vitest"
import {BADGE_DEFINITION, DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SUBTYPE_THREADS,
  PROFILE_LIST_KIND,
  parseCommunityDefinition,
} from "./community"
import {
  COMMUNITY_REPORT_KIND,
  COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH,
  canPublishCommunityEventReport,
  canPublishCommunityPersonReport,
  getAllSectionModeratorPubkeys,
  getCommunityCensorReason,
  getEffectiveCommunityModerationActionsByReporter,
  getEffectiveCommunityReportState,
  isCommunityPersonBanned,
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
        ["content", COMMUNITY_SECTION_THREADS],
        ["k", "11", COMMUNITY_SUBTYPE_THREADS],
        ["a", `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:Threads`],
        ["badge", `${BADGE_DEFINITION}:${allSectionModeratorPubkey}:Threads`],
        ["a", `${PROFILE_LIST_KIND}:${otherSectionModeratorPubkey}:Threads`],
        ["badge", `${BADGE_DEFINITION}:${otherSectionModeratorPubkey}:Threads`],
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
        eventKind: 9,
        eventSubtype: "room-message",
        eventTitle: "Reported title",
        eventContent: "Reported content",
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
      targetEventKind: 9,
      targetEventSubtype: "room-message",
      targetEventTitle: "Reported title",
      targetEventContent: "Reported content",
    })
    expect(eventReport.tags).toContainEqual(["target-kind", "9"])
    expect(eventReport.tags).toContainEqual(["target-subtype", "room-message"])
    expect(eventReport.tags).toContainEqual(["target-title", "Reported title"])
    expect(eventReport.tags).toContainEqual(["target-content", "Reported content"])
    expect(eventReport.tags).toContainEqual(["h", communityPubkey])
    expect(parseCommunityReport(personReport, communityPubkey)).toMatchObject({
      target: "person",
      targetPubkey,
    })
    expect(personReport.tags).toContainEqual(["h", communityPubkey])
  })

  it("caps moderated event content snapshots", () => {
    const longContent = "x".repeat(COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH + 100)
    const report = makeCommunityEventReport({
      communityPubkey,
      sectionName: "General",
      eventId: "reported-event",
      eventPubkey: targetPubkey,
      eventContent: longContent,
    })
    const contentTag = report.tags.find(tag => tag[0] === "target-content")

    expect(contentTag?.[1]).toHaveLength(COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH)
  })

  it("parses NIP-56 report reason tags with relay hints", () => {
    const report = makeEvent({
      id: "nip56-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: [
        ["e", "reported-event", "wss://relay.example.com/", "spam"],
        ["p", targetPubkey],
        ["a", `${COMMUNITY_DEFINITION_KIND}:${communityPubkey}:`],
        ["content", "General"],
      ],
    })

    expect(parseCommunityReport(report, communityPubkey)).toMatchObject({
      target: "event",
      sectionName: "General",
      targetEventId: "reported-event",
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
        sectionName: COMMUNITY_SECTION_THREADS,
        eventId: "thread-event",
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
      getCommunityCensorReason({
        reportState: state,
        eventId: "thread-event",
        sectionName: COMMUNITY_SECTION_THREADS,
      }),
    ).toBe("event")
    expect(
      getCommunityCensorReason({reportState: state, eventId: "thread-event", sectionName: "Forum"}),
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

  it("protects the community admin from moderator reports", () => {
    const definition = makeDefinition()
    const moderatorEventReport = makeEvent({
      id: "moderator-admin-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "admin-authored-event",
        eventPubkey: communityPubkey,
      }).tags,
    })
    const moderatorPersonReport = makeEvent({
      id: "moderator-admin-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: communityPubkey}).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [moderatorEventReport, moderatorPersonReport],
    })

    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "admin-authored-event",
        sectionName: "General",
      }),
    ).toBeUndefined()
    expect(getCommunityCensorReason({reportState: state, pubkey: communityPubkey})).toBeUndefined()
  })

  it("ignores active reports from banned moderators", () => {
    const definition = makeDefinition()
    const adminBan = makeEvent({
      id: "admin-ban",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: communityPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: allSectionModeratorPubkey}).tags,
    })
    const bannedModeratorPersonReport = makeEvent({
      id: "banned-moderator-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const bannedModeratorEventReport = makeEvent({
      id: "banned-moderator-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "target-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      reportEvents: [bannedModeratorPersonReport, bannedModeratorEventReport, adminBan],
    })

    expect(isCommunityPersonBanned(state, allSectionModeratorPubkey)).toBe(true)
    expect(isCommunityPersonBanned(state, targetPubkey)).toBe(false)
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "target-event",
        sectionName: "General",
      }),
    ).toBeUndefined()
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey,
        reportState: state,
      }),
    ).toBe(false)
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
        sectionName: COMMUNITY_SECTION_THREADS,
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
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey: communityPubkey,
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
