import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

const relayMocks = vi.hoisted(() => ({
  trackerRelays: new Set<string>(),
  authorRelays: [] as string[],
  userRelays: [] as string[],
  repositoryQuery: vi.fn((): unknown[] => []),
}))

vi.mock("@welshman/app", () => ({
  tracker: {getRelays: vi.fn(() => relayMocks.trackerRelays)},
  repository: {query: relayMocks.repositoryQuery},
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromPubkey: () => ({getUrls: () => relayMocks.authorRelays}),
      FromUser: () => ({getUrls: () => relayMocks.userRelays}),
    }),
  },
}))

vi.mock("@welshman/util", () => ({
  BADGE_DEFINITION: 30009,
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => /^wss?:\/\//.test(url),
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  isReplaceable: () => false,
  Address: class {
    static fromEvent() {
      return {toNaddr: () => "naddr1test"}
    }
  },
}))

vi.mock("@nostr-git/core/events", () => ({
  GIT_REPO_ANNOUNCEMENT: 30617,
  GIT_REPO_STATE: 30618,
}))

vi.mock("@nostr-git/core/utils", () => ({
  buildRepoNaddrFromEvent: vi.fn(),
}))

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  kind: 1,
  created_at: 1,
  content: "",
  tags: [],
  sig: "3".repeat(128),
  ...overrides,
})

describe("event link utilities", () => {
  beforeEach(() => {
    relayMocks.trackerRelays = new Set<string>()
    relayMocks.authorRelays = []
    relayMocks.userRelays = []
    relayMocks.repositoryQuery.mockReset()
    relayMocks.repositoryQuery.mockReturnValue([])
  })

  it("normalizes, filters, and deduplicates relay hints", async () => {
    const {normalizeRelayHints} = await import("./event-links")

    expect(
      normalizeRelayHints(["wss://relay.example.com", "not-a-relay"], ["wss://relay.example.com/"]),
    ).toEqual(["wss://relay.example.com/"])
  })

  it("treats a bare string as one relay hint instead of character relays", async () => {
    const {normalizeRelayHints} = await import("./event-links")

    expect(normalizeRelayHints("wss://relay.example.com")).toEqual(["wss://relay.example.com/"])
  })

  it("drops platform clone URLs from relay hints", async () => {
    const {normalizeRelayHints} = await import("./event-links")

    expect(
      normalizeRelayHints([
        "wss://github.com/Pleb5/flotilla-budabit.git",
        "https://github.com",
        "https://github.com/Pleb5/flotilla-budabit",
        "wss://relay.example.com",
      ]),
    ).toEqual(["wss://relay.example.com/"])
  })

  it("uses explicit and seen relays before tag fallback relays", async () => {
    relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({tags: [["q", "target", "wss://tag.example.com"]]})

    expect(getEventRelayHints(event as any, {relays: ["wss://explicit.example.com"]})).toEqual([
      "wss://explicit.example.com/",
      "wss://seen.example.com/",
    ])
  })

  it("falls back to tag and author relays when primary relays are absent", async () => {
    relayMocks.authorRelays = ["wss://author.example.com"]
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({tags: [["E", "root", "wss://tag.example.com", "pubkey"]]})

    expect(getEventRelayHints(event as any)).toEqual([
      "wss://tag.example.com/",
      "wss://author.example.com/",
    ])
  })

  it("adds community relays from matching targeted publication events", async () => {
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({kind: 31922, tags: [["h", "target-1"]]})
    relayMocks.repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "target-1"],
          ["a", `31922:${event.pubkey}:calendar-1`, "wss://author-relay.example.com"],
          ["k", "31922"],
          ["p", communityPubkey],
          ["r", "wss://community-relay.example.com"],
        ],
      }),
    ])

    const {getEventRelayHints} = await import("./event-links")

    expect(getEventRelayHints(event as any)).toEqual([
      "wss://author-relay.example.com/",
      "wss://community-relay.example.com/",
    ])
    expect(relayMocks.repositoryQuery).toHaveBeenCalledWith(
      [{kinds: [30222], "#d": ["target-1"], "#k": ["31922"]}],
      {shouldSort: false},
    )
  })

  it("keeps targeted publication relays alongside seen relays", async () => {
    relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
    relayMocks.repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "target-2"],
          ["k", "9041"],
          ["p", "b".repeat(64)],
          ["r", "wss://community.example.com"],
        ],
      }),
    ])

    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({kind: 9041, tags: [["h", "target-2"]]})

    expect(getEventRelayHints(event as any)).toEqual([
      "wss://seen.example.com/",
      "wss://community.example.com/",
    ])
  })

  it("encodes nevent links with relay, kind, and author hints", async () => {
    const {makeEventNevent} = await import("./event-links")
    const event = makeEvent()
    const encoded = makeEventNevent(event as any, {relays: ["wss://relay.example.com"]})
    const decoded = nip19.decode(encoded)

    expect(decoded.type).toBe("nevent")
    expect(decoded.data).toMatchObject({
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
      relays: ["wss://relay.example.com/"],
    })
  })
})
