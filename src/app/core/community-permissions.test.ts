import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {BADGE_DEFINITION_KIND, COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import {
  COMMUNITY_WRITE_TARGETS,
  canWriteCommunityTarget,
  findBadgeDefinitionEvent,
  findProfileListEvent,
  getCommunityWriteTarget,
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
    expect(findBadgeDefinitionEvent(definition.sections[0].badges[0], [memberBadgeDefinition])).toBe(
      memberBadgeDefinition,
    )
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

  it("requires both list-manager and badge-issuer authority for grants", () => {
    expect(
      getGrantCapability({definition, userPubkey: managerPubkey, sectionName: "General"}),
    ).toMatchObject({canManageList: true, canIssueBadge: true, canGrant: true})
    expect(
      getGrantCapability({definition, userPubkey: repoManagerPubkey, sectionName: "Repositories"}),
    ).toMatchObject({canManageList: true, canIssueBadge: false, canGrant: false})
  })
})
