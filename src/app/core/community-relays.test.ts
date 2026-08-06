import {beforeEach, describe, expect, it, vi} from "vitest"

const routerMocks = vi.hoisted(() => ({
  fromPubkeys: vi.fn(),
}))

vi.mock("@welshman/router", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/router")>()

  return {
    ...actual,
    Router: {
      get: () => ({
        FromPubkeys: routerMocks.fromPubkeys,
      }),
    },
  }
})

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example"],
}))

import {
  getActiveUserCommunityRelaysFromRefs,
  getCommunityRootPublishRelays,
  getCommunityScopedPublishRelays,
  getProfileCommunityRelaysFromRefs,
  getScopedCommunityPublishRelays,
  getUserDataPublishRelays,
} from "./community-relays"

const communityPubkey = "a".repeat(64)
const otherCommunityPubkey = "b".repeat(64)

describe("community relay policies", () => {
  beforeEach(() => {
    routerMocks.fromPubkeys.mockReset()
    routerMocks.fromPubkeys.mockReturnValue({getUrls: () => ["wss://outbox.example"]})
  })

  it("uses only declared community relays for scoped moderation data", () => {
    expect(
      getCommunityScopedPublishRelays({
        relays: ["wss://community.example", "wss://community.example/"],
      }),
    ).toEqual(["wss://community.example/"])
  })

  it("does not invent scoped publish relays when the definition has none", () => {
    expect(getCommunityScopedPublishRelays({relays: []})).toEqual([])
    expect(getCommunityScopedPublishRelays(undefined)).toEqual([])
  })

  it("publishes root community definition events to community, indexer, and outbox relays", () => {
    expect(
      getCommunityRootPublishRelays(["wss://community.example"], communityPubkey, {
        indexerRelays: ["wss://indexer.example"],
        outboxRelays: ["wss://outbox.example", "wss://community.example/"],
      }),
    ).toEqual(["wss://community.example/", "wss://indexer.example/", "wss://outbox.example/"])
  })

  it("normalizes and deduplicates root community relay merges", () => {
    expect(
      getCommunityRootPublishRelays(["wss://community.example", "bad-relay"], communityPubkey, {
        indexerRelays: ["wss://indexer.example", "wss://community.example/"],
        outboxRelays: ["wss://outbox.example", "wss://outbox.example/"],
      }),
    ).toEqual(["wss://community.example/", "wss://indexer.example/", "wss://outbox.example/"])
  })

  it("uses the community pubkey outbox for root community definition publishes", () => {
    expect(getCommunityRootPublishRelays(["wss://community.example"], communityPubkey)).toEqual([
      "wss://community.example/",
      "wss://indexer.example/",
      "wss://outbox.example/",
    ])
    expect(routerMocks.fromPubkeys).toHaveBeenCalledWith([communityPubkey])
  })

  it("does not invent root outbox relays for invalid community pubkeys", () => {
    expect(
      getCommunityRootPublishRelays(["wss://community.example"], "not-a-pubkey", {
        indexerRelays: [],
      }),
    ).toEqual(["wss://community.example/"])
    expect(routerMocks.fromPubkeys).not.toHaveBeenCalled()
  })

  it("derives active user community relays from eligible refs", () => {
    expect(
      getActiveUserCommunityRelaysFromRefs([
        {communityPubkey, relayHints: ["wss://community.example", "bad-relay"]},
        {communityPubkey: otherCommunityPubkey, relayHints: ["wss://other.example"]},
        {communityPubkey: "not-a-pubkey", relayHints: ["wss://fallback.example"]},
      ]),
    ).toEqual(["wss://community.example/", "wss://other.example/", "wss://fallback.example/"])
  })

  it("merges personal user-data relays with active community relays", () => {
    expect(
      getUserDataPublishRelays(
        ["wss://outbox.example", "wss://community.example/", "not-a-relay"],
        ["wss://community.example", "wss://other.example"],
      ),
    ).toEqual(["wss://outbox.example/", "wss://community.example/", "wss://other.example/"])
  })

  it("selects profile community relays deterministically and fairly", () => {
    const communityC = "c".repeat(64)
    const makeRef = (pubkey: string, relays: string[]) =>
      ({
        communityPubkey: pubkey,
        definition: {relays},
      }) as Parameters<typeof getProfileCommunityRelaysFromRefs>[0][number]
    const refs = [
      makeRef(otherCommunityPubkey, ["wss://b-2.example", "wss://b-1.example"]),
      makeRef(communityC, ["wss://c-1.example", "wss://c-2.example"]),
      makeRef(communityPubkey, ["wss://a-3.example", "wss://a-1.example", "wss://a-2.example"]),
    ]

    expect(getProfileCommunityRelaysFromRefs(refs)).toEqual([
      "wss://a-1.example/",
      "wss://b-1.example/",
      "wss://c-1.example/",
      "wss://a-2.example/",
    ])
    expect(getProfileCommunityRelaysFromRefs([...refs].reverse())).toEqual(
      getProfileCommunityRelaysFromRefs(refs),
    )
  })

  it("uses only definition relays for profile community fanout", () => {
    expect(
      getProfileCommunityRelaysFromRefs([
        {
          communityPubkey,
          definition: {relays: ["wss://definition.example"]},
          relayHints: ["wss://route-hint.example"],
        } as unknown as Parameters<typeof getProfileCommunityRelaysFromRefs>[0][number],
      ]),
    ).toEqual(["wss://definition.example/"])
  })

  it("never selects more than two profile relays for duplicate community refs", () => {
    const makeRef = (relays: string[]) =>
      ({
        communityPubkey,
        definition: {relays},
      }) as Parameters<typeof getProfileCommunityRelaysFromRefs>[0][number]

    expect(
      getProfileCommunityRelaysFromRefs([
        makeRef(["wss://c.example", "wss://a.example"]),
        makeRef(["wss://d.example", "wss://b.example"]),
      ]),
    ).toEqual(["wss://a.example/", "wss://b.example/"])
  })

  it("resolves scoped community publish relays without adding unrelated communities", () => {
    expect(
      getScopedCommunityPublishRelays(
        [communityPubkey],
        [
          {communityPubkey, relayHints: ["wss://community.example", "wss://shared.example"]},
          {
            communityPubkey: otherCommunityPubkey,
            relayHints: ["wss://other.example", "wss://shared.example"],
          },
        ],
      ),
    ).toEqual(["wss://community.example/", "wss://shared.example/"])
  })
})
