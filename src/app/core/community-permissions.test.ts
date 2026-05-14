import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
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
  canWriteCommunityTarget,
  findBadgeDefinitionEvent,
  findProfileListEvent,
  getCommunityCapabilityKey,
  getCommunityPublishGateState,
  getCommunityPublishCapabilityMap,
  getCommunitySectionWriterPubkeys,
  getCommunityWriteTarget,
  getGrantCapableSectionModeratorPubkeys,
  getGrantCapability,
} from "./community-permissions"

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
      ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:General`],
      ["badge", `${BADGE_DEFINITION_KIND}:${managerPubkey}:member`],
      ["content", "Repositories"],
      ["k", "30617"],
      ["a", `${PROFILE_LIST_KIND}:${repoManagerPubkey}:Repositories`],
      ["badge", `${BADGE_DEFINITION_KIND}:${managerPubkey}:repo-curator`],
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
    ["d", "Repositories"],
    ["p", repoManagerPubkey],
  ],
})

const memberBadgeDefinition = makeEvent({
  kind: BADGE_DEFINITION_KIND,
  pubkey: managerPubkey,
  tags: [["d", "member"]],
})

describe("community permissions", () => {
  it("maps write targets by kind and subtype", () => {
    expect(getCommunityWriteTarget(9, "room-message")).toEqual(COMMUNITY_WRITE_TARGETS.roomMessage)
    expect(getCommunityWriteTarget(30617)).toEqual(COMMUNITY_WRITE_TARGETS.repository)
  })

  it("finds authoritative profile list and badge events by address", () => {
    expect(findProfileListEvent(definition.sections[0].profileLists[0], [generalProfileList])).toBe(
      generalProfileList,
    )
    expect(
      findBadgeDefinitionEvent(definition.sections[0].badges[0], [memberBadgeDefinition]),
    ).toBe(memberBadgeDefinition)
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
  })

  it("allows section authorities to bootstrap content before list events load", () => {
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
        userPubkey: managerPubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
      }),
    ).toBe(true)
  })

  it("requires both list-manager and badge-issuer authority for grants", () => {
    expect(
      getGrantCapability({definition, userPubkey: managerPubkey, sectionName: "General"}),
    ).toMatchObject({canManageList: true, canIssueBadge: true, canGrant: true})
    expect(
      getGrantCapability({definition, userPubkey: repoManagerPubkey, sectionName: "Repositories"}),
    ).toMatchObject({canManageList: true, canIssueBadge: false, canGrant: false})
    expect(getGrantCapableSectionModeratorPubkeys({definition, sectionName: "General"})).toEqual([
      managerPubkey,
    ])
    expect(
      getGrantCapableSectionModeratorPubkeys({definition, sectionName: "Repositories"}),
    ).toEqual([])
  })

  it("derives publish capabilities by kind and subtype", () => {
    const capabilities = getCommunityPublishCapabilityMap({
      definition,
      profileListEvents: [generalProfileList, repoProfileList],
      userPubkey: memberPubkey,
    })

    expect(getCommunityCapabilityKey(9, "room-message")).toBe("9:room-message")
    expect(capabilities["9:room-message"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["1111"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["7"]).toMatchObject({sectionName: "General", canWrite: true})
    expect(capabilities["30617"]).toMatchObject({sectionName: "Repositories", canWrite: false})
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
  })

  it("derives section writer pubkeys from authorities and profile lists", () => {
    expect(
      getCommunitySectionWriterPubkeys({
        definition,
        profileListEvents: [generalProfileList, repoProfileList],
        sectionName: "General",
      }),
    ).toEqual([communityPubkey, managerPubkey, memberPubkey])
    expect(
      getCommunitySectionWriterPubkeys({definition, profileListEvents: [], sectionName: "General"}),
    ).toEqual([communityPubkey, managerPubkey])
  })
})
