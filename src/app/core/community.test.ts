import {describe, expect, it} from "vitest"
import {BADGE_DEFINITION, EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {getPublicKey} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_FREELANCE,
  DEFAULT_COMMUNITY_SECTION_NAMES,
  COMMUNITY_SECTION_REPO_CURATOR,
  COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  PROFILE_LIST_KIND,
  canWriteFromProfileList,
  buildCommunityDefinition,
  parseCommunityDefinition,
  getDefaultCommunitySectionKinds,
  getProfileListPubkeys,
  makeCommunityBadgeDefinition,
  normalizeGeohash,
  parseAddressRef,
  sectionSupportsKind,
} from "./community"

const pubkeyA = getPublicKey(new Uint8Array(32).fill(1))
const pubkeyB = getPublicKey(new Uint8Array(32).fill(2))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: pubkeyA,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community shared helpers", () => {
  it("exports only the definition kind", () => {
    expect(COMMUNITY_DEFINITION_KIND).toBe(32222)
  })

  it("parses address refs and geohashes", () => {
    expect(parseAddressRef(`${PROFILE_LIST_KIND}:${pubkeyB}:General`)).toEqual({
      kind: PROFILE_LIST_KIND,
      pubkey: pubkeyB,
      identifier: "General",
      address: `${PROFILE_LIST_KIND}:${pubkeyB}:General`,
    })
    expect(normalizeGeohash("geo:EZs42E44yx96")).toBe("ezs42e44yx96")
    expect(normalizeGeohash("geo:not-valid")).toBe("")
  })

  it("keeps section defaults and subtype matching", () => {
    const general = {
      name: COMMUNITY_SECTION_GENERAL,
      kinds: getDefaultCommunitySectionKinds(COMMUNITY_SECTION_GENERAL),
      profileLists: [],
      badges: [],
      retention: [],
    }

    expect(sectionSupportsKind(general, 9, COMMUNITY_SUBTYPE_ROOM_MESSAGE)).toBe(true)
    expect(getDefaultCommunitySectionKinds(COMMUNITY_SECTION_CALENDAR)).toEqual([
      {kind: EVENT_DATE},
      {kind: EVENT_TIME},
    ])
    expect(getDefaultCommunitySectionKinds(COMMUNITY_SECTION_REPO_CURATOR)).toEqual([
      {kind: 30617},
      {kind: 1623},
    ])
  })

  it("reads active profile-list grants", () => {
    const profileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", "General"],
        ["p", pubkeyA],
        ["p", pubkeyB],
        ["p", pubkeyA.toUpperCase()],
        ["p", "npub1invalid"],
        ["p", "f".repeat(64)],
        ["p", "invalid"],
      ],
    })

    expect(getProfileListPubkeys(profileList)).toEqual([pubkeyA, pubkeyB, "f".repeat(64)])
    expect(canWriteFromProfileList(profileList, pubkeyA)).toBe(true)
  })

  it("round-trips the optional Freelance section with all workflow kinds and its grants", () => {
    expect([...DEFAULT_COMMUNITY_SECTION_NAMES]).not.toContain(COMMUNITY_SECTION_FREELANCE)
    const grant = `30000:${pubkeyA}:${"a".repeat(64)}-freelance`
    const template = buildCommunityDefinition({
      communityId: "a".repeat(64),
      name: "Freelance test",
      relays: ["wss://relay.example"],
      sections: [
        {
          name: COMMUNITY_SECTION_FREELANCE,
          kinds: getDefaultCommunitySectionKinds(COMMUNITY_SECTION_FREELANCE),
          profileLists: [{address: grant}],
        },
      ],
    })
    const definition = parseCommunityDefinition(makeEvent(template))!
    expect(definition.sections[0].kinds.map(item => item.kind)).toEqual([
      32765, 32766, 32767, 32768, 1986,
    ])
    expect(definition.sections[0].profileLists[0].address).toBe(grant)
  })

  it("builds badge definitions independently of community definitions", () => {
    const badge = {
      kind: BADGE_DEFINITION,
      pubkey: pubkeyB,
      identifier: "helper",
      address: `${BADGE_DEFINITION}:${pubkeyB}:helper`,
    }

    expect(makeCommunityBadgeDefinition({badge, name: "Helper"})).toEqual({
      kind: BADGE_DEFINITION,
      content: "",
      tags: [
        ["d", "helper"],
        ["name", "Helper"],
      ],
    })
  })
})
