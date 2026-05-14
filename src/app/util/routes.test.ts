import {describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

vi.mock("$app/navigation", () => ({goto: vi.fn()}))
vi.mock("@lib/html", () => ({scrollToEvent: vi.fn()}))
vi.mock("@app/core/state", () => ({
  makeChatId: (recipient: string) => recipient,
  entityLink: (entity: string) => `https://coracle.social/${entity}`,
  DM_KIND: 4,
}))
vi.mock("@welshman/app", () => ({
  pubkey: {get: vi.fn()},
  tracker: {getRelays: vi.fn(() => [])},
}))
vi.mock("@welshman/lib", () => ({
  identity: (value: unknown) => Boolean(value),
  sleep: vi.fn(),
}))
vi.mock("@welshman/util", () => ({
  getPubkeyTagValues: vi.fn(() => []),
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => url.startsWith("wss://"),
}))

describe("routes", () => {
  it("builds and parses community paths", async () => {
    const {
      makeCommunityPath,
      makeCommunityPermalinkPath,
      makeCommunityRoomPath,
      makeCommunityThreadPath,
      makeCommunityWidgetPath,
      parseCommunityRouteParam,
    } = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(makeCommunityPath(communityPubkey)).toBe(`/c/${communityNpub}`)
    expect(makeCommunityRoomPath(communityPubkey, "room-id")).toBe(`/c/${communityNpub}/rooms/room-id`)
    expect(makeCommunityThreadPath(communityPubkey, "thread-id")).toBe(
      `/c/${communityNpub}/threads/thread-id`,
    )
    expect(makeCommunityPermalinkPath(communityPubkey)).toBe(`/c/${communityNpub}/permalinks`)
    expect(makeCommunityWidgetPath(communityPubkey)).toBe(`/c/${communityNpub}/widgets`)
    expect(parseCommunityRouteParam(communityNpub)).toEqual({
      pubkey: communityPubkey,
      relays: [],
      source: "npub",
    })
  })

  it("parses encoded ncommunity route params", async () => {
    const {makeCommunityPath, parseCommunityRouteParam} = await import("./routes")
    const communityPubkey = "b".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const value = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}`

    expect(makeCommunityPath(value)).toBe(`/c/${communityNpub}`)
    expect(parseCommunityRouteParam(encodeURIComponent(value))).toEqual({
      pubkey: communityPubkey,
      relays: ["wss://relay.example.com/"],
      source: "ncommunity",
    })
  })
})
