import {beforeEach, describe, expect, it, vi} from "vitest"

const routerMocks = vi.hoisted(() => ({
  fromPubkeys: vi.fn(),
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromPubkeys: routerMocks.fromPubkeys,
    }),
  },
}))

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example"],
}))

import {getCommunityRootPublishRelays, getCommunityScopedPublishRelays} from "./community-relays"

const communityPubkey = "a".repeat(64)

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
})
