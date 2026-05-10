import * as nip19 from "nostr-tools/nip19"
import {describe, expect, it} from "vitest"
import {
  NIP85_USER_ASSERTION_KIND,
  aggregateNip85RecommendedProviders,
  aggregateNip85UserAssertions,
  displayNip85ProviderWebsite,
  extractNip85AssertionTagNames,
  getNip85CapabilityDescription,
  getNip85CapabilityLabel,
  getNip85RecommendationAuthors,
  getNip85VerificationSamplePubkeys,
  makeNip85KindTag,
  normalizeNip85ProviderWebsite,
  parseNip85ProviderTag,
  parseNip85UserAssertion,
  rankNip85Relays,
  splitNip85ConfiguredProviders,
  type Nip85ConfiguredProvider,
  type Nip85FetchedUserAssertion,
} from "./nip85-core"

const targetPubkey = "f".repeat(64)

const makeProvider = (
  tag: string,
  serviceKey: string,
  visibility: "public" | "private" = "public",
  relayHint = "wss://relay.example.com",
): Nip85ConfiguredProvider => ({
  kindTag: makeNip85KindTag(NIP85_USER_ASSERTION_KIND, tag),
  kind: NIP85_USER_ASSERTION_KIND,
  tag,
  serviceKey,
  relayHint,
  visibility,
})

describe("nip85 provider parsing", () => {
  it("parses valid provider tags and normalizes npubs", () => {
    const serviceKey = "a".repeat(64)
    const npub = nip19.npubEncode(serviceKey)
    const provider = parseNip85ProviderTag(
      [makeNip85KindTag(NIP85_USER_ASSERTION_KIND, "rank"), npub, "wss://relay.example.com/"],
      "private",
    )

    expect(provider).toEqual({
      kindTag: "30382:rank",
      kind: 30382,
      tag: "rank",
      serviceKey,
      relayHint: "wss://relay.example.com/",
      visibility: "private",
    })
  })

  it("splits config tags by visibility and dedupes conflicting entries", () => {
    const providers = [
      makeProvider("rank", "a".repeat(64), "public", "wss://public.example.com"),
      makeProvider("rank", "a".repeat(64), "private", "wss://private.example.com"),
      makeProvider("followers", "b".repeat(64), "public", "wss://followers.example.com"),
    ]

    const {publicTags, privateTags} = splitNip85ConfiguredProviders(providers)

    expect(publicTags).toEqual([["30382:followers", "b".repeat(64), "wss://followers.example.com"]])
    expect(privateTags).toEqual([["30382:rank", "a".repeat(64), "wss://private.example.com"]])
  })
})

describe("nip85 assertion parsing", () => {
  it("parses user assertion events", () => {
    const assertion = parseNip85UserAssertion({
      kind: NIP85_USER_ASSERTION_KIND,
      pubkey: "c".repeat(64),
      id: "d".repeat(64),
      created_at: 1,
      content: "",
      tags: [
        ["d", targetPubkey],
        ["rank", "89"],
        ["followers", "120"],
        ["t", "nostr"],
        ["t", "git"],
      ],
    } as any)

    expect(assertion).toEqual({
      pubkey: targetPubkey,
      rank: 89,
      followers: 120,
      commonTopics: ["nostr", "git"],
    })
  })

  it("extracts assertion tag names while ignoring the subject tag", () => {
    const tags = extractNip85AssertionTagNames({
      tags: [
        ["d", targetPubkey],
        ["rank", "89"],
        ["followers", "120"],
        ["rank", "90"],
        ["t", "nostr"],
        ["empty", ""],
      ],
    } as any)

    expect(tags).toEqual(["rank", "followers", "t"])
  })

  it("only summarizes metrics with exactly one selected provider", () => {
    const providerA = makeProvider("rank", "a".repeat(64))
    const providerB = makeProvider("rank", "b".repeat(64))
    const providerFollowers = makeProvider("followers", "a".repeat(64))
    const results = new Map<string, Nip85FetchedUserAssertion>([
      [
        providerA.serviceKey,
        {
          serviceKey: providerA.serviceKey,
          relayHints: [providerA.relayHint],
          status: "data",
          availableTags: ["rank", "followers"],
          assertion: {
            pubkey: targetPubkey,
            rank: 80,
            followers: 250,
          },
        },
      ],
      [
        providerB.serviceKey,
        {
          serviceKey: providerB.serviceKey,
          relayHints: [providerB.relayHint],
          status: "data",
          availableTags: ["rank"],
          assertion: {
            pubkey: targetPubkey,
            rank: 72,
          },
        },
      ],
    ])

    const summary = aggregateNip85UserAssertions(results, [providerA, providerB, providerFollowers])

    expect(summary.providerCount).toBe(2)
    expect(summary.rank).toBeUndefined()
    expect(summary.followers).toBe(250)
  })
})

describe("nip85 recommendation aggregation", () => {
  it("builds recommendation authors from follows and positive wot edges", () => {
    const currentPubkey = "1".repeat(64)
    const follows = ["2".repeat(64)]
    const authors = getNip85RecommendationAuthors(
      currentPubkey,
      follows,
      new Map([
        ["2".repeat(64), 5],
        ["3".repeat(64), 4],
        ["4".repeat(64), -2],
      ]),
      {followLimit: 10, wotLimit: 10},
    )

    expect(authors).toEqual([currentPubkey, "2".repeat(64), "3".repeat(64)])
  })

  it("does not cap follow or wot authors by default", () => {
    const currentPubkey = "1".repeat(64)
    const authors = getNip85RecommendationAuthors(
      currentPubkey,
      ["2".repeat(64), "3".repeat(64)],
      new Map([
        ["4".repeat(64), 5],
        ["5".repeat(64), 4],
      ]),
    )

    expect(authors).toEqual([
      currentPubkey,
      "2".repeat(64),
      "3".repeat(64),
      "4".repeat(64),
      "5".repeat(64),
    ])
  })

  it("builds a 3-profile verification sample from self plus top WoT pubkeys", () => {
    const currentPubkey = "1".repeat(64)
    const sample = getNip85VerificationSamplePubkeys(
      currentPubkey,
      new Map([
        [currentPubkey, 12],
        ["2".repeat(64), 5],
        ["3".repeat(64), 8],
        ["4".repeat(64), -1],
      ]),
    )

    expect(sample).toEqual([currentPubkey, "3".repeat(64), "2".repeat(64)])
  })

  it("aggregates providers by capability and sorts by endorsement count", () => {
    const providerA = makeProvider("rank", "a".repeat(64))
    const providerB = makeProvider("rank", "b".repeat(64))
    const aggregated = aggregateNip85RecommendedProviders({
      configsByAuthor: new Map([
        ["1".repeat(64), [providerA]],
        ["2".repeat(64), [providerA]],
        ["3".repeat(64), [providerB]],
      ]),
    })

    expect(aggregated.get("30382:rank")).toEqual([
      expect.objectContaining({
        serviceKey: providerA.serviceKey,
        usageCount: 2,
        recommenders: ["1".repeat(64), "2".repeat(64)],
        serviceIdentity: providerA.serviceKey,
      }),
      expect.objectContaining({
        serviceKey: providerB.serviceKey,
        usageCount: 1,
        recommenders: ["3".repeat(64)],
        serviceIdentity: providerB.serviceKey,
      }),
    ])
  })

  it("groups provider endorsements by shared website when profile metadata matches", () => {
    const providerA = makeProvider("rank", "a".repeat(64), "public", "wss://a.example.com")
    const providerB = makeProvider("rank", "b".repeat(64), "public", "wss://b.example.com")
    const aggregated = aggregateNip85RecommendedProviders({
      configsByAuthor: new Map([
        ["1".repeat(64), [providerA]],
        ["2".repeat(64), [providerB]],
      ]),
      profilesByPubkey: new Map([
        [providerA.serviceKey, {website: "https://nip85.example.com/"}],
        [providerB.serviceKey, {website: "https://www.nip85.example.com"}],
      ]),
    })

    expect(aggregated.get("30382:rank")).toEqual([
      expect.objectContaining({
        usageCount: 2,
        serviceIdentity: "https://nip85.example.com",
        website: "https://nip85.example.com",
        providerKeys: [providerA.serviceKey, providerB.serviceKey],
        recommenders: ["1".repeat(64), "2".repeat(64)],
      }),
    ])
  })

  it("exposes readable labels and descriptions for known and extra capabilities", () => {
    expect(getNip85CapabilityLabel("30382:followers")).toBe("User - Followers")
    expect(getNip85CapabilityDescription("30382:followers")).toBe(
      "Follower count as estimated by the provider.",
    )
    expect(getNip85CapabilityLabel("30382:hops")).toBe("User - hops")
    expect(getNip85CapabilityDescription("30382:hops")).toContain("Provider-defined user metric")
  })

  it("ranks relays by how often they appear in WoT relay lists", () => {
    const relays = rankNip85Relays(
      new Map([
        ["wss://relay-three.example.com", 1],
        ["wss://relay-one.example.com", 5],
        ["wss://relay-two.example.com", 5],
      ]),
      2,
    )

    expect(relays).toEqual(["wss://relay-one.example.com", "wss://relay-two.example.com"])
  })

  it("normalizes and displays provider websites consistently", () => {
    const normalized = normalizeNip85ProviderWebsite("https://www.nip85.example.com/")

    expect(normalized).toBe("https://nip85.example.com")
    expect(displayNip85ProviderWebsite(normalized)).toBe("nip85.example.com")
  })
})
