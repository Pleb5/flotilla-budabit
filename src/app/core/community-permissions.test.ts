import {describe, expect, it} from "vitest"
import {BADGE_DEFINITION, EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  parseCommunityDefinition,
} from "./community"
import {
  makeAdmissionFormAddress,
  makeAdmissionFormTemplate,
  makeAdmissionResponse,
  makeAdmissionReview,
  parseAdmissionForm,
} from "./community-forms"
import {
  COMMUNITY_WRITE_TARGETS,
  COMMUNITY_CALENDAR_WRITE_TARGETS,
  canWriteCommunitySection,
  canWriteCommunityTarget,
  findProfileListEvent,
  getCommunityCalendarWriteTarget,
  getCommunityCapabilityKey,
  getCommunityPublishGateState,
  getCommunityPublishCapabilityMap,
  getCommunitySectionWriterPubkeys,
  getCommunityTargetAuthorityPubkeys,
  getCommunityWritableTargetSections,
  getCommunityTargetWriterPubkeys,
  getCommunityWriteTargetSectionName,
  getCommunityWriteTargetSections,
  getCommunityWriteTarget,
  communityWritableSectionsSupportTarget,
  getGrantCapableSectionModeratorPubkeys,
  getGrantCapability,
} from "./community-permissions"
import type {EffectiveCommunityReportState} from "./community-reports"

const communityPubkey = "a".repeat(64)
const memberPubkey = "b".repeat(64)
const managerPubkey = "c".repeat(64)
const outsiderPubkey = "d".repeat(64)
const repoManagerPubkey = "e".repeat(64)

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

const definition = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "General"],
      ["k", "9", "room-message"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:General`],
      ["badge", `${BADGE_DEFINITION}:${managerPubkey}:member`],
      ["content", "Code-curator"],
      ["k", "30617"],
      ["k", "1623"],
      ["a", `${PROFILE_LIST_KIND}:${repoManagerPubkey}:Code-curator`],
      ["badge", `${BADGE_DEFINITION}:${managerPubkey}:repo-curator`],
    ],
  }),
)!

const generalProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  tags: [
    ["d", "General"],
    ["p", memberPubkey],
  ],
})

const repoProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: repoManagerPubkey,
  tags: [
    ["d", "Code-curator"],
    ["p", repoManagerPubkey],
  ],
})

const makePersonBanState = (pubkey: string): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: [{targetPubkey: pubkey}],
  }) as unknown as EffectiveCommunityReportState

describe("community permissions", () => {
  it("maps write targets by kind and subtype", () => {
    expect(getCommunityWriteTarget(9, "room-message")).toEqual(COMMUNITY_WRITE_TARGETS.roomMessage)
    expect(getCommunityWriteTarget(11, "threads")).toEqual(COMMUNITY_WRITE_TARGETS.thread)
    expect(getCommunityWriteTarget(11, "forum")).toBeUndefined()
    expect(getCommunityWriteTarget(11)).toBeUndefined()
    expect(getCommunityWriteTarget(1984)).toEqual(COMMUNITY_WRITE_TARGETS.report)
    expect(getCommunityWriteTarget(EVENT_DATE)).toEqual(COMMUNITY_WRITE_TARGETS.calendarDate)
    expect(getCommunityWriteTarget(EVENT_TIME)).toEqual(COMMUNITY_WRITE_TARGETS.calendar)
    expect(getCommunityCalendarWriteTarget(EVENT_DATE)).toEqual(COMMUNITY_WRITE_TARGETS.calendarDate)
    expect(getCommunityCalendarWriteTarget(EVENT_TIME)).toEqual(COMMUNITY_WRITE_TARGETS.calendar)
    expect(COMMUNITY_CALENDAR_WRITE_TARGETS).toEqual([
      COMMUNITY_WRITE_TARGETS.calendarDate,
      COMMUNITY_WRITE_TARGETS.calendar,
    ])
    expect(getCommunityWriteTarget(30617)).toEqual(COMMUNITY_WRITE_TARGETS.repository)
    expect(getCommunityWriteTarget(1623)).toEqual(COMMUNITY_WRITE_TARGETS.permalink)
  })

  it("finds authoritative profile list events by address", () => {
    expect(findProfileListEvent(definition.sections[0].profileLists[0], [generalProfileList])).toBe(
      generalProfileList,
    )
  })

  it("uses the latest replaceable profile list event by address", () => {
    const olderList = makeEvent({
      id: "older-list",
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      created_at: 1,
      tags: [
        ["d", "General"],
        ["p", outsiderPubkey],
      ],
    })
    const newerList = makeEvent({
      id: "newer-list",
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      created_at: 2,
      tags: [
        ["d", "General"],
        ["p", memberPubkey],
      ],
    })

    expect(
      findProfileListEvent(definition.sections[0].profileLists[0], [olderList, newerList]),
    ).toBe(newerList)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [olderList, newerList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [olderList, newerList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(false)
  })

  it("checks write access from profile lists", () => {
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.permalink,
      }),
    ).toBe(false)
    expect(
      communityWritableSectionsSupportTarget({
        definition,
        writableSections: ["General"],
        target: COMMUNITY_WRITE_TARGETS.reaction,
      }),
    ).toBe(true)
    expect(
      communityWritableSectionsSupportTarget({
        definition,
        writableSections: ["General"],
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: repoManagerPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: repoManagerPubkey,
        target: COMMUNITY_WRITE_TARGETS.permalink,
      }),
    ).toBe(true)
  })

  it("lets person bans override existing write and grant permissions", () => {
    const bannedMemberState = makePersonBanState(memberPubkey)
    const bannedManagerState = makePersonBanState(managerPubkey)

    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        reportState: bannedMemberState,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: managerPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        reportState: bannedManagerState,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: communityPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        reportState: makePersonBanState(communityPubkey),
      }),
    ).toBe(true)
    expect(
      getGrantCapability({
        definition,
        userPubkey: managerPubkey,
        sectionName: "General",
        reportState: bannedManagerState,
      }),
    ).toMatchObject({canManageList: false, canGrant: false})
    expect(
      getGrantCapableSectionModeratorPubkeys({
        definition,
        sectionName: "General",
        reportState: bannedManagerState,
      }),
    ).toEqual([communityPubkey])
  })

  it("lets delegated moderator refs write as all-section members before accepting", () => {
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: managerPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: communityPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: repoManagerPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [],
        userPubkey: managerPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(true)
    expect(
      getGrantCapability({
        definition,
        userPubkey: managerPubkey,
        sectionName: "General",
        profileListEvents: [],
      }),
    ).toMatchObject({canManageList: false, canGrant: false})
  })

  it("uses profile-list manager authority for grants", () => {
    expect(
      getGrantCapability({
        definition,
        userPubkey: communityPubkey,
        sectionName: "General",
        profileListEvents: [],
      }),
    ).toMatchObject({canManageList: false, canGrant: true})
    expect(
      getGrantCapability({
        definition,
        userPubkey: managerPubkey,
        sectionName: "General",
        profileListEvents: [generalProfileList, repoProfileList],
      }),
    ).toMatchObject({canManageList: true, canGrant: true})
    expect(
      getGrantCapability({
        definition,
        userPubkey: repoManagerPubkey,
        sectionName: "Code-curator",
        profileListEvents: [generalProfileList, repoProfileList],
      }),
    ).toMatchObject({canManageList: true, canGrant: true})
    expect(
      getGrantCapability({definition, userPubkey: managerPubkey, sectionName: "Code-curator"}),
    ).toMatchObject({canManageList: false, canGrant: false})
    expect(
      getGrantCapableSectionModeratorPubkeys({
        definition,
        sectionName: "General",
        profileListEvents: [generalProfileList, repoProfileList],
      }),
    ).toEqual([communityPubkey, managerPubkey])
    expect(
      getGrantCapableSectionModeratorPubkeys({definition, sectionName: "Code-curator"}),
    ).toEqual([communityPubkey, repoManagerPubkey])
  })

  it("gives declined moderator refs member access without moderator authority", () => {
    const declinedProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      tags: [
        ["d", "General"],
        ["status", "declined"],
        ["p", memberPubkey],
      ],
    })

    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [declinedProfileList],
        userPubkey: managerPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(true)
    expect(
      getGrantCapability({
        definition,
        userPubkey: managerPubkey,
        sectionName: "General",
        profileListEvents: [declinedProfileList],
      }),
    ).toMatchObject({canManageList: false, canGrant: false})
    expect(
      canWriteCommunityTarget({
        definition,
        profileListEvents: [declinedProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }),
    ).toBe(false)
  })

  it("derives publish capabilities by kind and subtype", () => {
    const capabilities = getCommunityPublishCapabilityMap({
      definition,
      profileListEvents: [generalProfileList, repoProfileList],
      userPubkey: memberPubkey,
    })

    expect(getCommunityCapabilityKey(9, "room-message")).toBe("9:room-message")
    expect(getCommunityCapabilityKey(11, "forum")).toBe("11:forum")
    expect(capabilities["9:room-message"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["1111"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["7"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["1984"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["30617"]).toMatchObject({sectionName: "Code-curator", canWrite: false})
    expect(capabilities["1623"]).toMatchObject({sectionName: "Code-curator", canWrite: false})
  })

  it("classifies publish gate state by login, write access, and admission status", () => {
    const formTemplate = makeAdmissionFormTemplate({
      identifier: "general-application",
      communityPubkey,
      sectionName: "General",
      name: "General application",
      fields: [{id: "q1", label: "Why should we grant access?"}],
    })
    const form = parseAdmissionForm(
      makeEvent({
        id: "general-form",
        kind: FORM_TEMPLATE_KIND,
        pubkey: managerPubkey,
        tags: formTemplate.tags,
      }),
    )!
    const response = makeEvent({
      id: "response",
      kind: FORM_RESPONSE_KIND,
      pubkey: outsiderPubkey,
      tags: makeAdmissionResponse({
        formAddress: makeAdmissionFormAddress(managerPubkey, "general-application"),
        values: {q1: "I build community tooling."},
      }).tags,
    })
    const rejection = makeEvent({
      id: "rejection",
      kind: 7,
      pubkey: managerPubkey,
      created_at: 2,
      content: "-",
      tags: makeAdmissionReview({
        responseId: "response",
        applicantPubkey: outsiderPubkey,
        status: "rejected",
      }).tags,
    })

    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        form,
      }).status,
    ).toBe("login-required")
    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        form,
      }).status,
    ).toBe("allowed")
    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        form,
        responseEvents: [response],
      }).status,
    ).toBe("pending")
    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        form,
        responseEvents: [response],
        reviewEvents: [rejection],
      }).status,
    ).toBe("rejected")
    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
      }).status,
    ).toBe("missing")
    expect(
      getCommunityPublishGateState({
        definition,
        profileListEvents: [generalProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.roomMessage,
        form,
        reportState: makePersonBanState(memberPubkey),
      }).status,
    ).toBe("banned")
  })

  it("derives section writer pubkeys from authorities and profile lists", () => {
    expect(
      getCommunitySectionWriterPubkeys({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        sectionName: "General",
      }),
    ).toEqual([communityPubkey, managerPubkey, memberPubkey, repoManagerPubkey])
    expect(
      getCommunitySectionWriterPubkeys({definition, profileListEvents: [], sectionName: "General"}),
    ).toEqual([communityPubkey, managerPubkey, repoManagerPubkey])
    expect(
      getCommunitySectionWriterPubkeys({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        sectionName: "General",
        reportState: makePersonBanState(memberPubkey),
      }),
    ).toEqual([communityPubkey, managerPubkey, repoManagerPubkey])
  })

  it("merges multiple section profile lists for write access", () => {
    const secondMemberPubkey = "f".repeat(64)
    const multiAuthorityDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Apps"],
          ["k", "32267"],
          ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Apps`],
          ["badge", `${BADGE_DEFINITION}:${managerPubkey}:member`],
          ["a", `${PROFILE_LIST_KIND}:${repoManagerPubkey}:AppsPro`],
          ["badge", `${BADGE_DEFINITION}:${repoManagerPubkey}:pro`],
        ],
      }),
    )!
    const appsProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      tags: [
        ["d", "Apps"],
        ["p", memberPubkey],
      ],
    })
    const appsProProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: repoManagerPubkey,
      tags: [
        ["d", "AppsPro"],
        ["p", secondMemberPubkey],
      ],
    })

    expect(
      canWriteCommunitySection({
        definition: multiAuthorityDefinition,
        profileListEvents: [appsProfileList, appsProProfileList],
        userPubkey: secondMemberPubkey,
        sectionName: "Apps",
        kind: 32267,
      }),
    ).toBe(true)
    expect(
      getGrantCapableSectionModeratorPubkeys({
        definition: multiAuthorityDefinition,
        sectionName: "Apps",
        profileListEvents: [appsProfileList, appsProProfileList],
      }),
    ).toEqual([communityPubkey, managerPubkey, repoManagerPubkey])
  })

  it("matches known write targets by kind when a section has a custom name", () => {
    const customDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Code"],
          ["k", "30617"],
          ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Code`],
          ["badge", `${BADGE_DEFINITION}:${managerPubkey}:code`],
        ],
      }),
    )!
    const codeProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      tags: [
        ["d", "Code"],
        ["p", memberPubkey],
      ],
    })

    expect(
      canWriteCommunityTarget({
        definition: customDefinition,
        profileListEvents: [codeProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(true)
    expect(
      getCommunityPublishCapabilityMap({
        definition: customDefinition,
        profileListEvents: [codeProfileList],
        userPubkey: memberPubkey,
      })["30617"],
    ).toMatchObject({sectionName: "Code", canWrite: true})
    expect(
      getCommunityTargetAuthorityPubkeys({
        definition: customDefinition,
        profileListEvents: [codeProfileList],
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toEqual([communityPubkey, managerPubkey])
  })

  it("resolves target section names from assigned kind and subtype", () => {
    const customDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Room chat"],
          ["k", "9", "room-message"],
          ["content", "Plain kind 9"],
          ["k", "9"],
          ["content", "Events"],
          ["k", String(EVENT_DATE)],
          ["k", String(EVENT_TIME)],
        ],
      }),
    )!

    expect(
      getCommunityWriteTargetSectionName(customDefinition, COMMUNITY_WRITE_TARGETS.roomMessage),
    ).toBe("Room chat")
    expect(
      getCommunityWriteTargetSections(customDefinition, {sectionName: "", kind: 9}).map(
        section => section.name,
      ),
    ).toEqual(["Plain kind 9"])
    expect(
      getCommunityWriteTargetSectionName(customDefinition, COMMUNITY_WRITE_TARGETS.calendarDate),
    ).toBe("Events")
    expect(
      getCommunityWriteTargetSectionName(customDefinition, COMMUNITY_WRITE_TARGETS.calendar),
    ).toBe("Events")
  })

  it("keeps date-based and time-based calendar permissions distinct", () => {
    const dateOnlyDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "All-day events"],
          ["k", String(EVENT_DATE)],
          ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:All-day-events`],
        ],
      }),
    )!
    const timeOnlyDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Timed events"],
          ["k", String(EVENT_TIME)],
          ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Timed-events`],
        ],
      }),
    )!
    const dateProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      tags: [
        ["d", "All-day-events"],
        ["p", memberPubkey],
      ],
    })
    const timeProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: managerPubkey,
      tags: [
        ["d", "Timed-events"],
        ["p", memberPubkey],
      ],
    })

    expect(
      getCommunityWriteTargetSections(dateOnlyDefinition, COMMUNITY_WRITE_TARGETS.calendarDate).map(
        section => section.name,
      ),
    ).toEqual(["All-day events"])
    expect(
      getCommunityWriteTargetSections(dateOnlyDefinition, COMMUNITY_WRITE_TARGETS.calendar),
    ).toEqual([])
    expect(
      canWriteCommunityTarget({
        definition: dateOnlyDefinition,
        profileListEvents: [dateProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.calendarDate,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition: dateOnlyDefinition,
        profileListEvents: [dateProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.calendar,
      }),
    ).toBe(false)
    expect(
      canWriteCommunityTarget({
        definition: timeOnlyDefinition,
        profileListEvents: [timeProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.calendar,
      }),
    ).toBe(true)
    expect(
      canWriteCommunityTarget({
        definition: timeOnlyDefinition,
        profileListEvents: [timeProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.calendarDate,
      }),
    ).toBe(false)
  })

  it("matches widget grants in the custom section assigned to kind 30033", () => {
    const widgetDefinition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["content", "Apps"],
          ["k", "30033"],
          ["a", `${PROFILE_LIST_KIND}:${repoManagerPubkey}:Apps`],
        ],
      }),
    )!
    const appsProfileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: repoManagerPubkey,
      tags: [
        ["d", "Apps"],
        ["p", memberPubkey],
      ],
    })

    expect(
      getCommunityWriteTargetSections(widgetDefinition, COMMUNITY_WRITE_TARGETS.widget).map(
        section => section.name,
      ),
    ).toEqual(["Apps"])
    expect(
      canWriteCommunityTarget({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
    ).toBe(true)
    expect(
      getCommunityWritableTargetSections({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
      }).map(section => section.name),
    ).toEqual(["Apps"])
    expect(
      getCommunityPublishCapabilityMap({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        userPubkey: memberPubkey,
      })["30033"],
    ).toMatchObject({sectionName: "Apps", canWrite: true})
    expect(
      getCommunityPublishGateState({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        userPubkey: memberPubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
    ).toMatchObject({sectionName: "Apps", status: "allowed"})
    expect(
      getCommunityPublishGateState({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        userPubkey: outsiderPubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
        formSectionName: "Apps",
      }),
    ).toMatchObject({sectionName: "Apps", status: "missing"})
    expect(
      communityWritableSectionsSupportTarget({
        definition: widgetDefinition,
        writableSections: ["Apps"],
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
    ).toBe(true)
    expect(
      getCommunityTargetWriterPubkeys({
        definition: widgetDefinition,
        profileListEvents: [appsProfileList],
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
    ).toEqual([communityPubkey, repoManagerPubkey, memberPubkey])
  })
})
