import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  parseCommunityInput,
  parseCommunityDefinition,
} from "./community"
import {
  getBadgeDefinitionRefs,
  getCommunityBootstrapRelays,
  getProfileListRefs,
  makeCommunityBadgeDefinitionFilters,
  makeCommunityDefinitionFilter,
  makeCommunityProfileFilter,
  makeCommunityProfileListFilters,
  makeCommunitySession,
  selectLatestCommunityDefinition,
} from "./community-state"

const communityPubkey = "a".repeat(64)
const listPubkey = "b".repeat(64)
const badgePubkey = "c".repeat(64)

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

const makeCommunityDefinitionEvent = (created_at: number, id = `definition-${created_at}`) =>
  makeEvent({
    id,
    kind: COMMUNITY_DEFINITION_KIND,
    created_at,
    pubkey: communityPubkey,
    tags: [
      ["r", "wss://relay.example.com"],
      ["content", "General"],
      ["k", "1111"],
      ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`, "wss://relay.example.com"],
      ["badge", `${BADGE_DEFINITION_KIND}:${badgePubkey}:member`],
    ],
  })

describe("community state helpers", () => {
  it("creates community sessions from parsed input", () => {
    const parsed = parseCommunityInput(
      `ncommunity://${communityPubkey}?relay=${encodeURIComponent("wss://relay.example.com")}`,
    )!
    const session = makeCommunitySession(parsed)

    expect(session).toEqual({
      communityPubkey,
      communityRelayHints: ["wss://relay.example.com/"],
      communityDefinitionId: undefined,
    })
  })

  it("builds bootstrap relay lists from hints", () => {
    expect(getCommunityBootstrapRelays(["wss://relay.example.com", "bad-relay"])).toEqual([
      "wss://relay.example.com/",
    ])
  })

  it("builds community definition and profile filters", () => {
    expect(makeCommunityDefinitionFilter(communityPubkey)).toEqual({
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [communityPubkey],
      limit: 1,
    })
    expect(makeCommunityProfileFilter(communityPubkey)).toEqual({
      kinds: [0],
      authors: [communityPubkey],
      limit: 1,
    })
  })

  it("selects the latest valid community definition for the pubkey", () => {
    const older = makeCommunityDefinitionEvent(1, "older")
    const newer = makeCommunityDefinitionEvent(2, "newer")
    const wrongAuthor = makeEvent({
      ...makeCommunityDefinitionEvent(3, "wrong"),
      pubkey: "d".repeat(64),
    })

    expect(selectLatestCommunityDefinition([older, wrongAuthor, newer], communityPubkey)?.event.id).toBe(
      "newer",
    )
  })

  it("extracts profile-list and badge refs from definitions", () => {
    const definition = parseCommunityDefinition(makeCommunityDefinitionEvent(1))!

    expect(getProfileListRefs(definition)).toMatchObject([
      {kind: PROFILE_LIST_KIND, pubkey: listPubkey, identifier: "General"},
    ])
    expect(getBadgeDefinitionRefs(definition)).toMatchObject([
      {kind: BADGE_DEFINITION_KIND, pubkey: badgePubkey, identifier: "member"},
    ])
    expect(makeCommunityProfileListFilters(definition)).toEqual([
      {kinds: [PROFILE_LIST_KIND], authors: [listPubkey], "#d": ["General"], limit: 1},
    ])
    expect(makeCommunityBadgeDefinitionFilters(definition)).toEqual([
      {kinds: [BADGE_DEFINITION_KIND], authors: [badgePubkey], "#d": ["member"], limit: 1},
    ])
  })
})
