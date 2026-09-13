import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools"
import {BADGE_DEFINITION, DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SUBTYPE_THREADS,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  COMMUNITY_REPORT_KIND,
  COMMUNITY_REPORT_TARGET_CONTENT_MAX_LENGTH,
  canPublishCommunityContentReport,
  canPublishCommunityEventReport,
  canPublishCommunityPersonReport,
  canReviewCommunityContentReport,
  getAllSectionModeratorPubkeys,
  getCommunityCensorReason,
  getCommunityContentReportGroups,
  getCommunityContentReports as getCommunityContentReportsWithPointer,
  getCommunityReportEventAddress,
  getEffectiveCommunityModerationActionsByReporter,
  getEffectiveCommunityReportState as getEffectiveCommunityReportStateWithPointer,
  isCommunityReportDeleted,
  isCommunityPersonBanned,
  makeCommunityEventReport as makeCommunityEventReportWithPointer,
  makeCommunityPersonReport as makeCommunityPersonReportWithPointer,
  makeCommunityReportDelete as makeCommunityReportDeleteWithPointer,
  makeCommunityReportReviewLabel as makeCommunityReportReviewLabelWithPointer,
  parseCommunityReport as parseCommunityReportWithPointer,
  parseCommunityReportReviewLabel as parseCommunityReportReviewLabelWithPointer,
} from "./community-reports"

const communityPubkey = getPublicKey(new Uint8Array(32).fill(1))
const communityId = getPublicKey(new Uint8Array(32).fill(7))
const communityPointer = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId,
})!
const siblingCommunityPointer = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: getPublicKey(new Uint8Array(32).fill(8)),
})!
const wrongBranchPointer = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(9)),
  communityId,
})!
const sectionModeratorPubkey = getPublicKey(new Uint8Array(32).fill(2))
const allSectionModeratorPubkey = getPublicKey(new Uint8Array(32).fill(3))
const targetPubkey = getPublicKey(new Uint8Array(32).fill(4))
const outsiderPubkey = getPublicKey(new Uint8Array(32).fill(5))
const otherSectionModeratorPubkey = getPublicKey(new Uint8Array(32).fill(6))

// Keep the existing authorization matrix concise while exercising only current report wire shapes.
const makeCommunityEventReport = (
  params: Omit<Parameters<typeof makeCommunityEventReportWithPointer>[0], "community"> & {
    communityPubkey: string
  },
) => makeCommunityEventReportWithPointer({...params, community: communityPointer})
const makeCommunityPersonReport = (
  params: Omit<Parameters<typeof makeCommunityPersonReportWithPointer>[0], "community"> & {
    communityPubkey: string
  },
) => makeCommunityPersonReportWithPointer({...params, community: communityPointer})
const makeCommunityReportReviewLabel = (
  params: Omit<Parameters<typeof makeCommunityReportReviewLabelWithPointer>[0], "community"> & {
    communityPubkey: string
  },
) => makeCommunityReportReviewLabelWithPointer({...params, community: communityPointer})
const makeCommunityReportDelete = (
  params: Omit<
    Parameters<typeof makeCommunityReportDeleteWithPointer>[0],
    "community" | "reporterPubkey"
  > & {
    reporterPubkey?: string
  },
) =>
  makeCommunityReportDeleteWithPointer({
    ...params,
    community: communityPointer,
    reporterPubkey: params.reporterPubkey || sectionModeratorPubkey,
  })
const parseCommunityReport = (
  event: TrustedEvent,
  _communityPubkey?: string,
  targets: TrustedEvent[] = [],
) => parseCommunityReportWithPointer(event, communityPointer, targets)
const parseCommunityReportReviewLabel = (event: TrustedEvent, _communityPubkey?: string) =>
  parseCommunityReportReviewLabelWithPointer(event, communityPointer)
const getEffectiveCommunityReportState = (
  params: Omit<Parameters<typeof getEffectiveCommunityReportStateWithPointer>[0], "community">,
) => getEffectiveCommunityReportStateWithPointer({...params, community: communityPointer})
const getCommunityContentReports = (
  params: Omit<Parameters<typeof getCommunityContentReportsWithPointer>[0], "community">,
) => getCommunityContentReportsWithPointer({...params, community: communityPointer})

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
      tags: buildCommunityDefinition({
        communityId,
        name: "Test community",
        relays: ["wss://relay.example"],
        sections: [
          {
            name: "General",
            kinds: [{kind: 9, subtype: "room-message"}, {kind: 1111}, {kind: 1984}],
            profileLists: [
              ...(includeSectionModerator
                ? [
                    {
                      address: `${PROFILE_LIST_KIND}:${sectionModeratorPubkey}:${communityId}-general`,
                    },
                  ]
                : []),
              {address: `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:${communityId}-general`},
            ],
            badges: [
              ...(includeSectionModerator
                ? [{address: `${BADGE_DEFINITION}:${sectionModeratorPubkey}:General`}]
                : []),
              {address: `${BADGE_DEFINITION}:${allSectionModeratorPubkey}:General`},
            ],
          },
          {
            name: COMMUNITY_SECTION_THREADS,
            kinds: [{kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}],
            profileLists: [
              {
                address: `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:${communityId}-threads`,
              },
              {
                address: `${PROFILE_LIST_KIND}:${otherSectionModeratorPubkey}:${communityId}-threads`,
              },
            ],
            badges: [
              {
                address: `${BADGE_DEFINITION}:${allSectionModeratorPubkey}:${COMMUNITY_SECTION_THREADS}`,
              },
              {
                address: `${BADGE_DEFINITION}:${otherSectionModeratorPubkey}:${COMMUNITY_SECTION_THREADS}`,
              },
            ],
          },
        ],
      }).tags,
    }),
  )!

const generalProfileList = makeEvent({
  id: "general-profile-list",
  kind: PROFILE_LIST_KIND,
  pubkey: sectionModeratorPubkey,
  tags: [
    ["d", `${communityId}-general`],
    ["a", `${PROFILE_LIST_KIND}:${sectionModeratorPubkey}:${communityId}-general`],
    ["p", outsiderPubkey],
  ],
})
const moderatorProfileListEvents = [
  generalProfileList,
  makeEvent({
    id: "all-section-general-profile-list",
    kind: PROFILE_LIST_KIND,
    pubkey: allSectionModeratorPubkey,
    tags: [
      ["d", `${communityId}-general`],
      ["a", `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:${communityId}-general`],
    ],
  }),
  makeEvent({
    id: "all-section-threads-profile-list",
    kind: PROFILE_LIST_KIND,
    pubkey: allSectionModeratorPubkey,
    tags: [
      ["d", `${communityId}-threads`],
      ["a", `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:${communityId}-threads`],
    ],
  }),
  makeEvent({
    id: "other-section-threads-profile-list",
    kind: PROFILE_LIST_KIND,
    pubkey: otherSectionModeratorPubkey,
    tags: [
      ["d", `${communityId}-threads`],
      ["a", `${PROFILE_LIST_KIND}:${otherSectionModeratorPubkey}:${communityId}-threads`],
    ],
  }),
]

describe("community reports", () => {
  it("builds and parses community event and person spam reports", () => {
    const targetAddress = `31922:${targetPubkey}:calendar-1`
    const eventReport = makeEvent({
      id: "event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
        targetAddress,
        eventKind: 31922,
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
      community: {address: communityPointer.address},
      communityId,
      ownerPubkey: communityPubkey,
      sectionName: "General",
      targetEventId: "reported-event",
      targetAddress,
      targetPubkey,
      targetEventKind: 31922,
      targetEventTitle: "Reported title",
      targetEventContent: "Reported content",
      targetIdentifier: "calendar-1",
    })
    expect(eventReport.tags).toContainEqual(["e", "reported-event", "spam"])
    expect(eventReport.tags).toContainEqual(["a", targetAddress, "spam"])
    expect(eventReport.tags).toContainEqual(["target-kind", "31922"])
    expect(eventReport.tags).toContainEqual(["target-title", "Reported title"])
    expect(eventReport.tags).toContainEqual(["target-content", "Reported content"])
    expect(eventReport.tags).toContainEqual(["h", communityId])
    expect(eventReport.tags).toContainEqual(["a", communityPointer.address, "", "community"])
    expect(parseCommunityReport(personReport, communityPubkey)).toMatchObject({
      target: "person",
      targetPubkey,
    })
    expect(personReport.tags).toEqual([
      ["h", communityId],
      ["a", communityPointer.address, "", "community"],
      ["p", targetPubkey, "spam"],
    ])
  })

  it("derives addressable report targets with Welshman address semantics", () => {
    const addressableEvent = makeEvent({
      id: "calendar-event-v1",
      kind: 31922,
      pubkey: targetPubkey,
      tags: [["d", "calendar-1"]],
    })

    expect(getCommunityReportEventAddress(addressableEvent)).toBe(
      `31922:${targetPubkey}:calendar-1`,
    )
    expect(getCommunityReportEventAddress(makeEvent({kind: 1, pubkey: targetPubkey}))).toBe("")
  })

  it("requires one coherent exact community authority pair", () => {
    const report = makeEvent({
      id: "community-a-reason-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: [
        ["a", communityPointer.address, "", "community"],
        ["p", targetPubkey],
        ["content", "General"],
      ],
    })

    expect(parseCommunityReport(report, communityPubkey)).toBeUndefined()
    expect(
      parseCommunityReport(
        makeEvent({
          ...report,
          tags: [
            ["h", communityId],
            ["a", communityPointer.address, "", "community"],
            ["h", communityId],
            ["p", targetPubkey, "spam"],
          ],
        }),
        communityPubkey,
      ),
    ).toBeUndefined()

    const valid = makeEvent({
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityPersonReportWithPointer({
        community: communityPointer,
        pubkey: targetPubkey,
      }).tags,
    })
    const mismatched = makeEvent({
      ...valid,
      tags: valid.tags.map(tag =>
        tag[0] === "a" && tag[3] === "community"
          ? ["a", siblingCommunityPointer.address, "", "community"]
          : tag,
      ),
    })

    expect(parseCommunityReportWithPointer(mismatched, communityPointer)).toBeUndefined()
    expect(parseCommunityReportWithPointer(valid, siblingCommunityPointer)).toBeUndefined()
    expect(parseCommunityReportWithPointer(valid, wrongBranchPointer)).toBeUndefined()
  })

  it("applies addressable event reports across replacements", () => {
    const definition = makeDefinition()
    const targetAddress = `31922:${targetPubkey}:calendar-1`
    const report = makeEvent({
      id: "addressable-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "calendar-event-v1",
        eventPubkey: targetPubkey,
        targetAddress,
        eventKind: 31922,
      }).tags,
    })
    const state = getEffectiveCommunityReportState({
      definition,
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [report],
    })

    expect(state.eventReports[0]).toMatchObject({
      targetEventId: "calendar-event-v1",
      targetAddress,
      targetPubkey,
    })
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "calendar-event-current",
        eventAddress: targetAddress,
        sectionName: "General",
      }),
    ).toBe("event")
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "calendar-event-current",
        sectionName: "General",
      }),
    ).toBeUndefined()
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

  it("parses NIP-56 report reason tags with relay hints and any reason", () => {
    const eventReport = makeEvent({
      id: "nip56-event-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: [
        ["e", "reported-event", "wss://relay.example.com/", "impersonation"],
        ["p", targetPubkey],
        ["h", communityId],
        ["a", communityPointer.address, "", "community"],
        ["content", "General"],
      ],
    })
    const personReport = makeEvent({
      id: "nip56-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: [
        ["p", targetPubkey, "illegal"],
        ["h", communityId],
        ["a", communityPointer.address, "", "community"],
      ],
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

  it("resolves event report authors from loaded target events", () => {
    const definition = makeDefinition()
    const targetEvent = makeEvent({
      id: "reported-event",
      kind: 9,
      pubkey: targetPubkey,
    })
    const report = makeEvent({
      id: "event-report-without-p-tag",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: [
        ["e", targetEvent.id, "wss://relay.example.com/", "malware"],
        ["h", communityId],
        ["a", communityPointer.address, "", "community"],
        ["content", "General"],
      ],
    })
    const state = getEffectiveCommunityReportState({
      definition,
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [report],
      targetEvents: [targetEvent],
    })

    expect(parseCommunityReport(report, communityPubkey, [targetEvent])).toMatchObject({
      target: "event",
      targetEventId: targetEvent.id,
      targetPubkey,
    })
    expect(state.eventReports.map(report => report.targetPubkey)).toEqual([targetPubkey])
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
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [adminEventReport, sectionModeratorEventReport, allSectionPersonReport],
    })

    expect(getAllSectionModeratorPubkeys(definition, moderatorProfileListEvents)).toEqual([
      communityPubkey,
      allSectionModeratorPubkey,
    ])
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "thread-event",
        sectionName: COMMUNITY_SECTION_THREADS,
      }),
    ).toBe("event")
    expect(
      getCommunityCensorReason({reportState: state, eventId: "thread-event", sectionName: "Forum"}),
    ).toBeUndefined()
    expect(
      getCommunityCensorReason({
        reportState: state,
        eventId: "general-event",
        sectionName: "General",
      }),
    ).toBe("event")
    expect(getCommunityCensorReason({reportState: state, pubkey: targetPubkey})).toBe("person")
  })

  it("keeps pending invitees as member reporters without moderator authority", () => {
    const definition = makeDefinition()
    const report = makeEvent({
      id: "pending-invitee-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
      }).tags,
    })

    expect(
      canPublishCommunityContentReport({
        definition,
        profileListEvents: [],
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityEventReport({
        definition,
        profileListEvents: [],
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
        sectionName: "General",
      }),
    ).toBe(false)
    expect(
      getEffectiveCommunityReportState({
        definition,
        profileListEvents: [],
        reportEvents: [report],
      }).eventReports,
    ).toEqual([])
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
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [unauthorizedPersonReport, deletedEventReport],
      deleteEvents: [deleteEvent],
    })
    const removedState = getEffectiveCommunityReportState({
      definition: removedDefinition,
      profileListEvents: moderatorProfileListEvents,
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

  it("removes active person bans when the report is deleted", () => {
    const definition = makeDefinition()
    const personReport = makeEvent({
      id: "deleted-person-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const deleteEvent = makeEvent({
      id: "delete-person-report",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityReportDelete({
        reportId: personReport.id,
        reporterPubkey: allSectionModeratorPubkey,
      }).tags,
    })
    // Same community ID under another owner: the report id already pins the
    // exact branch, so a same-author retraction counts wherever it was made.
    const sameIdBranchDelete = makeEvent({
      id: "same-id-branch-delete",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityReportDeleteWithPointer({
        community: wrongBranchPointer,
        reportId: personReport.id,
        reporterPubkey: allSectionModeratorPubkey,
      }).tags,
    })
    const wrongCommunityDelete = makeEvent({
      id: "wrong-community-delete",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityReportDeleteWithPointer({
        community: makeCommunityPointer({
          ownerPubkey: communityPubkey,
          communityId: getPublicKey(new Uint8Array(32).fill(11)),
        })!,
        reportId: personReport.id,
        reporterPubkey: allSectionModeratorPubkey,
      }).tags,
    })
    const legacyWrongBranchDelete = makeEvent({
      id: "legacy-wrong-branch-delete",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      tags: [
        ["h", communityId],
        ["a", wrongBranchPointer.address, "", "community"],
        ["e", personReport.id, "", allSectionModeratorPubkey, "report"],
        ["k", String(COMMUNITY_REPORT_KIND)],
      ],
    })
    const legacyDelete = makeEvent({
      id: "legacy-delete",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      tags: [
        ["h", communityId],
        ["a", `${COMMUNITY_DEFINITION_KIND}:${communityPubkey}:${communityId}`, "", "community"],
        ["e", personReport.id, "", allSectionModeratorPubkey, "report"],
        ["k", String(COMMUNITY_REPORT_KIND)],
      ],
    })
    const activeState = getEffectiveCommunityReportState({
      definition,
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [personReport],
    })
    const revokedState = getEffectiveCommunityReportState({
      definition,
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [personReport],
      deleteEvents: [deleteEvent],
    })

    expect(isCommunityPersonBanned(activeState, targetPubkey)).toBe(true)
    expect(deleteEvent.tags.some(tag => tag[0] === "a")).toBe(false)
    expect(isCommunityReportDeleted(personReport, [sameIdBranchDelete])).toBe(true)
    expect(isCommunityReportDeleted(personReport, [wrongCommunityDelete])).toBe(false)
    expect(isCommunityReportDeleted(personReport, [legacyWrongBranchDelete])).toBe(false)
    expect(isCommunityReportDeleted(personReport, [legacyDelete])).toBe(true)
    expect(isCommunityPersonBanned(revokedState, targetPubkey)).toBe(false)
    expect(
      getCommunityCensorReason({reportState: revokedState, pubkey: targetPubkey}),
    ).toBeUndefined()
  })

  it("does not derive report authority from a tombstoned profile list", () => {
    const definition = makeDefinition()
    const personReport = makeEvent({
      id: "authority-report",
      kind: COMMUNITY_REPORT_KIND,
      pubkey: allSectionModeratorPubkey,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: targetPubkey}).tags,
    })
    const generalAddress = `${PROFILE_LIST_KIND}:${allSectionModeratorPubkey}:${communityId}-general`
    const deletion = makeEvent({
      id: "delete-general-authority",
      kind: DELETE,
      pubkey: allSectionModeratorPubkey,
      created_at: 1,
      tags: [["a", generalAddress]],
    })
    const recreated = {
      ...moderatorProfileListEvents[1],
      id: "recreated-general-authority",
      created_at: 2,
    }
    const derive = (profileListEvents: TrustedEvent[]) =>
      getEffectiveCommunityReportState({
        definition,
        profileListEvents,
        reportEvents: [personReport],
      })

    expect(
      isCommunityPersonBanned(derive([...moderatorProfileListEvents, deletion]), targetPubkey),
    ).toBe(false)
    expect(
      isCommunityPersonBanned(
        derive([...moderatorProfileListEvents, deletion, recreated]),
        targetPubkey,
      ),
    ).toBe(true)
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
      profileListEvents: moderatorProfileListEvents,
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
      profileListEvents: moderatorProfileListEvents,
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
      profileListEvents: moderatorProfileListEvents,
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
        profileListEvents: moderatorProfileListEvents,
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
      profileListEvents: moderatorProfileListEvents,
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
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
        sectionName: COMMUNITY_SECTION_THREADS,
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(false)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey,
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityPersonReport({
        definition,
        reporterPubkey: sectionModeratorPubkey,
        targetPubkey,
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(false)
    expect(
      canPublishCommunityEventReport({
        definition,
        reporterPubkey: allSectionModeratorPubkey,
        targetPubkey: sectionModeratorPubkey,
        sectionName: "General",
        profileListEvents: moderatorProfileListEvents,
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
    expect(
      canPublishCommunityContentReport({
        definition,
        profileListEvents: [generalProfileList],
        reporterPubkey: outsiderPubkey,
        targetPubkey,
      }),
    ).toBe(true)
    expect(
      canPublishCommunityContentReport({
        definition,
        profileListEvents: [generalProfileList],
        reporterPubkey: outsiderPubkey,
        targetPubkey: outsiderPubkey,
      }),
    ).toBe(false)
  })

  it("separates user content reports from active moderation and review labels", () => {
    const definition = makeDefinition()
    const userReport = makeEvent({
      id: "user-report",
      created_at: 10,
      kind: COMMUNITY_REPORT_KIND,
      pubkey: outsiderPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "reported-event",
        eventPubkey: targetPubkey,
        eventKind: 9,
        eventSubtype: "room-message",
        targetRootId: "room-root",
        targetRootKind: 11,
      }).tags,
    })
    const moderatorReport = makeEvent({
      id: "moderator-report",
      created_at: 20,
      kind: COMMUNITY_REPORT_KIND,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityEventReport({
        communityPubkey,
        sectionName: "General",
        eventId: "moderated-event",
        eventPubkey: targetPubkey,
      }).tags,
    })
    const unauthorizedReview = makeEvent({
      id: "unauthorized-review",
      kind: 1985,
      pubkey: otherSectionModeratorPubkey,
      tags: makeCommunityReportReviewLabel({
        communityPubkey,
        reportId: userReport.id,
        targetEventId: "reported-event",
        targetEventKind: 9,
        sectionName: "General",
        reporterPubkey: outsiderPubkey,
      }).tags,
    })
    const authorizedReview = makeEvent({
      id: "authorized-review",
      created_at: 30,
      kind: 1985,
      pubkey: sectionModeratorPubkey,
      tags: makeCommunityReportReviewLabel({
        communityPubkey,
        reportId: userReport.id,
        targetEventId: "reported-event",
        targetEventKind: 9,
        sectionName: "General",
        reporterPubkey: outsiderPubkey,
      }).tags,
    })

    const pendingReports = getCommunityContentReports({
      definition,
      reportEvents: [userReport, moderatorReport],
      reviewEvents: [unauthorizedReview],
      profileListEvents: [generalProfileList],
    })
    const reviewedReports = getCommunityContentReports({
      definition,
      reportEvents: [userReport, moderatorReport],
      reviewEvents: [authorizedReview],
      profileListEvents: [generalProfileList],
    })

    expect(parseCommunityReportReviewLabel(authorizedReview, communityPubkey)).toMatchObject({
      reportId: userReport.id,
      reportAuthorPubkey: outsiderPubkey,
      reviewerPubkey: sectionModeratorPubkey,
      sectionName: "General",
    })
    expect(authorizedReview.tags).toContainEqual(["e", userReport.id, "", outsiderPubkey, "report"])
    expect(
      parseCommunityReportReviewLabelWithPointer(
        makeEvent({
          ...authorizedReview,
          tags: [["e", "reason-target", "spam"], ...authorizedReview.tags],
        }),
        communityPointer,
      )?.reportId,
    ).toBe(userReport.id)
    expect(
      canReviewCommunityContentReport({
        definition,
        reviewerPubkey: sectionModeratorPubkey,
        report: parseCommunityReport(userReport, communityPubkey)!,
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(true)
    expect(
      canReviewCommunityContentReport({
        definition,
        reviewerPubkey: otherSectionModeratorPubkey,
        report: parseCommunityReport(userReport, communityPubkey)!,
        profileListEvents: moderatorProfileListEvents,
      }),
    ).toBe(false)
    expect(pendingReports.map(report => report.event.id)).toEqual(["user-report"])
    expect(pendingReports[0]).toMatchObject({reviewed: false, targetRootId: "room-root"})
    expect(reviewedReports[0]).toMatchObject({reviewed: true})
    expect(getCommunityContentReportGroups(reviewedReports)).toMatchObject([
      {
        key: "General:reported-event",
        reviewed: true,
        reports: [{event: {id: "user-report"}}],
      },
    ])
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
      profileListEvents: moderatorProfileListEvents,
      reportEvents: [olderReport, newerReport, otherReporterReport],
    })

    expect(
      getEffectiveCommunityModerationActionsByReporter(state, sectionModeratorPubkey).map(
        report => report.event.id,
      ),
    ).toEqual(["newer-report", "older-report"])
  })
})
