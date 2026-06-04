import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {BADGE_DEFINITION, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_REPO_CURATOR,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  COMMUNITY_SUBTYPE_THREADS,
  MAX_TARGET_COMMUNITIES,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  canWriteFromProfileList,
  findCommunitySection,
  getCommunityMainRelay,
  getDefaultCommunitySectionKinds,
  makeCommunityBadgeDefinition,
  makeCommunityNcommunity,
  makeCommunitySetupSection,
  makeCommunitySetupRefs,
  getProfileListPubkeys,
  normalizeGeohash,
  normalizeCommunitySectionName,
  normalizePubkey,
  parseAddressRef,
  parseCommunityDefinition,
  parseCommunityInput,
  parseTargetedPublication,
  sectionSupportsKind,
  userCanManageProfileList,
} from "./community"

const pubkeyA = "a".repeat(64)
const pubkeyB = "b".repeat(64)
const pubkeyC = "c".repeat(64)

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

describe("community protocol helpers", () => {
  it("parses raw hex community input", () => {
    expect(parseCommunityInput(pubkeyA)).toEqual({pubkey: pubkeyA, relays: [], source: "hex"})
  })

  it("parses npub community input", () => {
    const npub = nip19.npubEncode(pubkeyA)

    expect(parseCommunityInput(npub)).toEqual({pubkey: pubkeyA, relays: [], source: "npub"})
  })

  it("parses ncommunity community input with relay hints", () => {
    const ncommunity = `ncommunity://${pubkeyA}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}&relay=${encodeURIComponent("wss://backup.example.com/")}`

    expect(parseCommunityInput(ncommunity)).toEqual({
      pubkey: pubkeyA,
      relays: ["wss://relay.example.com/", "wss://backup.example.com/"],
      source: "ncommunity",
    })
  })

  it("builds ncommunity values with normalized relay hints", () => {
    expect(
      makeCommunityNcommunity({
        pubkey: pubkeyA,
        relayHints: ["wss://relay.example.com", "not-a-relay"],
      }),
    ).toBe(`ncommunity://${pubkeyA}?relay=wss%3A%2F%2Frelay.example.com%2F`)
  })

  it("normalizes npub and address refs", () => {
    const npub = nip19.npubEncode(pubkeyB)

    expect(normalizePubkey(npub)).toBe(pubkeyB)
    expect(parseAddressRef(`${PROFILE_LIST_KIND}:${npub}:General`)).toEqual({
      kind: PROFILE_LIST_KIND,
      pubkey: pubkeyB,
      identifier: "General",
      address: `${PROFILE_LIST_KIND}:${pubkeyB}:General`,
    })
  })

  it("normalizes geohashes with optional geo prefix", () => {
    expect(normalizeGeohash("geo:EZs42E44yx96")).toBe("ezs42e44yx96")
    expect(normalizeGeohash("EZs42E44yx96")).toBe("ezs42e44yx96")
    expect(normalizeGeohash("geo:not-valid")).toBe("")
  })

  it("parses community definitions into sections", () => {
    const event = makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: pubkeyA,
      tags: [
        ["r", "wss://relay.example.com"],
        ["r", "not-a-relay"],
        ["blossom", "https://blossom.example.com"],
        ["mint", "https://mint.example.com", "cashu"],
        ["content", COMMUNITY_SECTION_GENERAL],
        ["k", "1111"],
        ["k", "9", COMMUNITY_SUBTYPE_ROOM_MESSAGE],
        ["a", `${PROFILE_LIST_KIND}:${pubkeyB}:General`, "wss://relay.example.com"],
        ["badge", `${BADGE_DEFINITION}:${pubkeyC}:member`],
        ["retention", "9", "100", "count"],
        ["content", COMMUNITY_SECTION_ROOMS],
        ["k", "11", COMMUNITY_SUBTYPE_ROOM],
        ["a", `${PROFILE_LIST_KIND}:${pubkeyC}:${COMMUNITY_SECTION_ROOMS}`],
        ["badge", `${BADGE_DEFINITION}:${pubkeyC}:room-admin`],
        ["tos", "policy-id", "wss://relay.example.com"],
        ["location", "Internet"],
        ["g", "geo:U4PRUY"],
        ["description", "Override description"],
      ],
    })

    const definition = parseCommunityDefinition(event)!
    const general = findCommunitySection(definition, COMMUNITY_SECTION_GENERAL)!
    const rooms = findCommunitySection(definition, COMMUNITY_SECTION_ROOMS)!

    expect(definition.pubkey).toBe(pubkeyA)
    expect(definition.relays).toEqual(["wss://relay.example.com/"])
    expect(getCommunityMainRelay(definition)).toBe("wss://relay.example.com/")
    expect(definition.blossomServers).toEqual(["https://blossom.example.com"])
    expect(definition.mints).toEqual([{url: "https://mint.example.com", type: "cashu"}])
    expect(definition.tos).toEqual({ref: "policy-id", relay: "wss://relay.example.com/"})
    expect(definition.location).toBe("Internet")
    expect(definition.geohash).toBe("u4pruy")
    expect(definition.description).toBe("Override description")
    expect(sectionSupportsKind(general, 9, COMMUNITY_SUBTYPE_ROOM_MESSAGE)).toBe(true)
    expect(sectionSupportsKind(general, 9, COMMUNITY_SUBTYPE_ROOM)).toBe(false)
    expect(sectionSupportsKind(rooms, 11, COMMUNITY_SUBTYPE_ROOM)).toBe(true)
    expect(general.profileLists[0]).toMatchObject({
      kind: PROFILE_LIST_KIND,
      pubkey: pubkeyB,
      identifier: "General",
      relay: "wss://relay.example.com/",
    })
    expect(general.badges).toEqual([])
    expect(general.retention).toEqual([{kind: 9, value: 100, type: "count"}])
  })

  it("checks profile-list based write access and delegated admin authority", () => {
    const profileList = makeEvent({
      kind: PROFILE_LIST_KIND,
      pubkey: pubkeyB,
      tags: [
        ["d", "General"],
        ["p", pubkeyA],
        ["p", nip19.npubEncode(pubkeyC)],
        ["p", "invalid"],
      ],
    })

    expect(getProfileListPubkeys(profileList)).toEqual([pubkeyA, pubkeyC])
    expect(canWriteFromProfileList(profileList, pubkeyA)).toBe(true)
    expect(canWriteFromProfileList(profileList, pubkeyB)).toBe(false)
    expect(
      userCanManageProfileList(
        {
          kind: PROFILE_LIST_KIND,
          pubkey: pubkeyB,
          identifier: "General",
          address: `${PROFILE_LIST_KIND}:${pubkeyB}:General`,
        },
        pubkeyB,
      ),
    ).toBe(true)
  })

  it("builds default community setup refs and definition events", () => {
    const setup = makeCommunitySetupRefs({
      communityPubkey: pubkeyA,
      profileListPubkey: pubkeyB,
      relays: ["wss://relay.example.com"],
    })

    const template = buildCommunityDefinition({
      relays: setup.relays,
      sections: setup.sections,
      description: "A builder community",
      blossomServers: ["https://blossom.example.com"],
      mints: [{url: "https://mint.example.com", type: "cashu"}],
      geohash: "geo:U4PRUY",
    })
    const definition = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, pubkey: pubkeyA, tags: template.tags}),
    )!
    const general = findCommunitySection(definition, COMMUNITY_SECTION_GENERAL)!
    const threads = findCommunitySection(definition, COMMUNITY_SECTION_THREADS)!
    const repoCurator = findCommunitySection(definition, COMMUNITY_SECTION_REPO_CURATOR)!

    expect(template.kind).toBe(COMMUNITY_DEFINITION_KIND)
    expect(definition.description).toBe("A builder community")
    expect(definition.relays).toEqual(["wss://relay.example.com/"])
    expect(definition.blossomServers).toEqual(["https://blossom.example.com"])
    expect(definition.mints).toEqual([{url: "https://mint.example.com", type: "cashu"}])
    expect(definition.geohash).toBe("u4pruy")
    expect(template.tags).toContainEqual(["g", "u4pruy"])
    expect(template.tags).toContainEqual(["content", COMMUNITY_SECTION_THREADS])
    expect(template.tags).toContainEqual(["k", "11", COMMUNITY_SUBTYPE_THREADS])
    expect(template.tags).toContainEqual(["content", COMMUNITY_SECTION_REPO_CURATOR])
    expect(template.tags).toContainEqual(["k", "30617"])
    expect(template.tags).toContainEqual(["k", "1623"])
    expect(general.profileLists[0]).toMatchObject({
      pubkey: pubkeyB,
      relay: "wss://relay.example.com/",
    })
    expect(general.badges).toEqual([])
    expect(sectionSupportsKind(general, 9, COMMUNITY_SUBTYPE_ROOM_MESSAGE)).toBe(true)
    expect(sectionSupportsKind(general, 1984)).toBe(true)
    expect(sectionSupportsKind(general, 1985)).toBe(true)
    expect(sectionSupportsKind(threads, 11, COMMUNITY_SUBTYPE_THREADS)).toBe(true)
    expect(sectionSupportsKind(repoCurator, 30617)).toBe(true)
    expect(sectionSupportsKind(repoCurator, 1623)).toBe(true)
    expect(getDefaultCommunitySectionKinds(COMMUNITY_SECTION_GENERAL)).toContainEqual({kind: 1984})
  })

  it("builds custom content sections with multiple authority refs", () => {
    const communitySection = makeCommunitySetupSection({
      communityPubkey: pubkeyA,
      profileListPubkey: pubkeyA,
      relays: ["wss://relay.example.com"],
      name: "Apps",
      kinds: [{kind: 32267}, {kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}],
    })
    const moderatorSection = makeCommunitySetupSection({
      communityPubkey: pubkeyA,
      profileListPubkey: pubkeyB,
      relays: ["wss://relay.example.com"],
      name: "Apps",
      kinds: communitySection.kinds,
    })
    const template = buildCommunityDefinition({
      relays: ["wss://relay.example.com"],
      sections: [
        {
          name: "Apps",
          kinds: communitySection.kinds,
          profileLists: [communitySection.profileList, moderatorSection.profileList],
        },
      ],
    })
    const definition = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, pubkey: pubkeyA, tags: template.tags}),
    )!
    const apps = findCommunitySection(definition, "Apps")!

    expect(template.tags).toContainEqual(["k", "11", COMMUNITY_SUBTYPE_THREADS])
    expect(apps.profileLists.map(ref => ref.pubkey)).toEqual([pubkeyA, pubkeyB])
    expect(apps.badges).toEqual([])
    expect(sectionSupportsKind(apps, 32267)).toBe(true)
    expect(sectionSupportsKind(apps, 11, COMMUNITY_SUBTYPE_THREADS)).toBe(true)
    expect(sectionSupportsKind(apps, 11, "forum")).toBe(true)
    expect(sectionSupportsKind(apps, 11)).toBe(false)
  })

  it("rejects duplicate section kind/subtype pairs when building definitions", () => {
    expect(() =>
      buildCommunityDefinition({
        relays: ["wss://relay.example.com"],
        sections: [
          {name: "Widgets", kinds: [{kind: 30033}]},
          {name: "Apps", kinds: [{kind: 30033}]},
        ],
      }),
    ).toThrow(/30033/)
    expect(() =>
      buildCommunityDefinition({
        relays: ["wss://relay.example.com"],
        sections: [
          {name: "Widgets", kinds: [{kind: 1234}]},
          {name: "Code", kinds: [{kind: 1234, subtype: "code"}]},
        ],
      }),
    ).not.toThrow()
  })

  it("normalizes legacy forum sections to threads", () => {
    const definition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: pubkeyA,
        tags: [
          ["content", "Forum"],
          ["k", "11", "forum"],
          ["a", `${PROFILE_LIST_KIND}:${pubkeyB}:Forum`],
          ["badge", `${BADGE_DEFINITION}:${pubkeyC}:Forum`],
        ],
      }),
    )!
    const threads = findCommunitySection(definition, COMMUNITY_SECTION_THREADS)!

    expect(threads.name).toBe(COMMUNITY_SECTION_THREADS)
    expect(findCommunitySection(definition, "Forum")).toBe(threads)
    expect(sectionSupportsKind(threads, 11, COMMUNITY_SUBTYPE_THREADS)).toBe(true)
    expect(sectionSupportsKind(threads, 11, "forum")).toBe(true)
    expect(threads.profileLists[0].address).toBe(`${PROFILE_LIST_KIND}:${pubkeyB}:Forum`)
  })

  it("normalizes legacy room and thread section names", () => {
    expect(normalizeCommunitySectionName("Rooms")).toBe(COMMUNITY_SECTION_ROOMS)
    expect(normalizeCommunitySectionName("Threads")).toBe(COMMUNITY_SECTION_THREADS)
  })

  it("builds community badge definition events", () => {
    const badge = {
      kind: BADGE_DEFINITION,
      pubkey: pubkeyC,
      identifier: "community-helper",
      address: `${BADGE_DEFINITION}:${pubkeyC}:community-helper`,
    }

    expect(makeCommunityBadgeDefinition({badge, name: "Community helper"})).toEqual({
      kind: BADGE_DEFINITION,
      content: "",
      tags: [
        ["d", badge.identifier],
        ["name", "Community helper"],
      ],
    })
  })

  it("builds and parses targeted publication events", () => {
    const template = buildTargetedPublication({
      id: "target-1",
      kind: 31922,
      ref: {type: "a", value: `31922:${pubkeyA}:calendar-1`, relay: "wss://author.example.com"},
      communities: [
        {pubkey: pubkeyB, relay: "wss://relay.example.com"},
        {pubkey: nip19.npubEncode(pubkeyC), relay: "wss://relay2.example.com"},
      ],
    })

    expect(template).toEqual({
      content: "",
      tags: [
        ["d", "target-1"],
        ["a", `31922:${pubkeyA}:calendar-1`, "wss://author.example.com/"],
        ["k", "31922"],
        ["p", pubkeyB],
        ["r", "wss://relay.example.com/"],
        ["p", pubkeyC],
        ["r", "wss://relay2.example.com/"],
      ],
    })

    const parsed = parseTargetedPublication(
      makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: template.tags}),
    )

    expect(parsed).toEqual({
      id: "target-1",
      kind: 31922,
      ref: {type: "a", value: `31922:${pubkeyA}:calendar-1`, relay: "wss://author.example.com/"},
      communities: [
        {pubkey: pubkeyB, relay: "wss://relay.example.com/"},
        {pubkey: pubkeyC, relay: "wss://relay2.example.com/"},
      ],
    })
  })

  it("limits targeted publication communities", () => {
    const communities = Array.from({length: MAX_TARGET_COMMUNITIES + 2}, (_, i) => ({
      pubkey: `${i}`
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, "a"),
    }))
    const template = buildTargetedPublication({id: "target-many", kind: 9041, communities})
    const pTags = template.tags.filter(tag => tag[0] === "p")

    expect(pTags.length).toBe(MAX_TARGET_COMMUNITIES)
  })
})
