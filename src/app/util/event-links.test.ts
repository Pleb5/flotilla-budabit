import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

const relayMocks = vi.hoisted(() => ({
  trackerRelays: new Set<string>(),
  authorRelays: [] as string[],
  userRelays: [] as string[],
  repositoryQuery: vi.fn((..._args: unknown[]): unknown[] => []),
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
  EVENT_DATE: 31922,
  EVENT_TIME: 31923,
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

const EVENT_TIME = 31923

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

  it("uses explicit relays exclusively without mixing in seen relays", async () => {
    relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({tags: [["q", "target", "wss://tag.example.com"]]})

    expect(getEventRelayHints(event as any, {relays: ["wss://explicit.example.com"]})).toEqual([
      "wss://explicit.example.com/",
    ])
  })

  it("falls back to seen relays when no explicit relays are provided", async () => {
    relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
    relayMocks.authorRelays = ["wss://author.example.com"]
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent()

    expect(getEventRelayHints(event as any)).toEqual(["wss://seen.example.com/"])
  })

  it("drops local relays from hints", async () => {
    const {normalizeRelayHints} = await import("./event-links")

    expect(
      normalizeRelayHints([
        "ws://localhost:3334",
        "ws://127.0.0.1:8080",
        "wss://relay.example.com",
      ]),
    ).toEqual(["wss://relay.example.com/"])
  })

  it("returns only observed relays for tracker-only sharing", async () => {
    relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
    const {getSeenEventRelayHints} = await import("./event-links")

    expect(getSeenEventRelayHints("1".repeat(64))).toEqual(["wss://seen.example.com/"])
  })

  it("falls back to author relays without treating reference relays as event relays", async () => {
    relayMocks.authorRelays = ["wss://author.example.com"]
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({tags: [["E", "root", "wss://tag.example.com", "pubkey"]]})

    expect(getEventRelayHints(event as any)).toEqual(["wss://author.example.com/"])
  })

  it("can include relay-bearing tags when explicitly requested", async () => {
    const {getEventRelayHints} = await import("./event-links")
    const event = makeEvent({tags: [["E", "root", "wss://tag.example.com", "pubkey"]]})

    expect(getEventRelayHints(event as any, {includeTagRelays: true})).toEqual([
      "wss://tag.example.com/",
    ])
  })

  it("adds community relays from matching targeted publication events", async () => {
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({kind: EVENT_TIME, tags: [["h", "target-1"]]})
    relayMocks.repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "target-1"],
          ["a", `${EVENT_TIME}:${event.pubkey}:calendar-1`, "wss://author-relay.example.com"],
          ["k", String(EVENT_TIME)],
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
      [{kinds: [30222], "#d": ["target-1"], "#k": [String(EVENT_TIME)]}],
      {shouldSort: false},
    )
  })

  it("prefers targeted publication relays over seen relays", async () => {
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

    expect(getEventRelayHints(event as any)).toEqual(["wss://community.example.com/"])
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

  it("encodes targeted community relays in permalink share links", async () => {
    relayMocks.repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "permalink-target"],
          ["k", "1623"],
          ["p", "a".repeat(64)],
          ["r", "wss://community.example.com"],
        ],
      }),
    ])
    const event = makeEvent({kind: 1623, tags: [["h", "permalink-target"]]})
    const {makeEventShareEntity} = await import("./event-links")

    const decoded = nip19.decode(makeEventShareEntity(event as any))

    expect(decoded.type).toBe("nevent")
    expect(decoded.data).toMatchObject({
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
      relays: ["wss://community.example.com/"],
    })
  })

  describe("repo-related events", () => {
    const repoPubkey = "c".repeat(64)
    const repoAddress = `30617:${repoPubkey}:my-repo`
    const repoAnnouncement = makeEvent({
      kind: 30617,
      pubkey: repoPubkey,
      tags: [
        ["d", "my-repo"],
        ["relays", "wss://repo-relay.example.com", "wss://repo-relay2.example.com"],
      ],
    })

    const mockRepoLookup = (announcement: unknown = repoAnnouncement) => {
      relayMocks.repositoryQuery.mockImplementation((filters: unknown) => {
        const filter = (Array.isArray(filters) ? filters[0] : filters) as any
        if (filter?.kinds?.includes(30617) && announcement) return [announcement]
        return []
      })
    }

    it("uses only repo announcement relays for issue events", async () => {
      mockRepoLookup()
      relayMocks.trackerRelays = new Set(["wss://seen.example.com"])
      relayMocks.authorRelays = ["wss://author.example.com"]

      const {getEventRelayHints} = await import("./event-links")
      const issue = makeEvent({
        kind: 1621,
        tags: [["a", repoAddress, "wss://pointer.example.com"]],
      })

      expect(getEventRelayHints(issue as any, {relays: ["wss://explicit.example.com"]})).toEqual([
        "wss://repo-relay.example.com/",
        "wss://repo-relay2.example.com/",
      ])
    })

    it("uses repo announcement relays for comments referencing a repo root", async () => {
      mockRepoLookup()
      relayMocks.trackerRelays = new Set(["wss://seen.example.com"])

      const {getEventRelayHints} = await import("./event-links")
      const comment = makeEvent({kind: 1111, tags: [["A", repoAddress]]})

      expect(getEventRelayHints(comment as any)).toEqual([
        "wss://repo-relay.example.com/",
        "wss://repo-relay2.example.com/",
      ])
    })

    it("falls back to the a-tag relay hint when the announcement is unknown", async () => {
      mockRepoLookup(null)

      const {getEventRelayHints} = await import("./event-links")
      const issue = makeEvent({
        kind: 1621,
        tags: [["a", repoAddress, "wss://pointer.example.com"]],
      })

      expect(getEventRelayHints(issue as any)).toEqual(["wss://pointer.example.com/"])
    })

    it("uses the repo announcement's own relays tag for hints", async () => {
      relayMocks.trackerRelays = new Set(["wss://seen.example.com"])

      const {getEventRelayHints} = await import("./event-links")

      expect(getEventRelayHints(repoAnnouncement as any)).toEqual([
        "wss://repo-relay.example.com/",
        "wss://repo-relay2.example.com/",
      ])
    })

    it("encodes only repo relays in issue share links", async () => {
      mockRepoLookup()
      relayMocks.trackerRelays = new Set(["wss://seen.example.com"])

      const {makeEventShareEntity} = await import("./event-links")
      const issue = makeEvent({kind: 1621, tags: [["a", repoAddress]]})

      const decoded = nip19.decode(makeEventShareEntity(issue as any))

      expect(decoded.type).toBe("nevent")
      expect(decoded.data).toMatchObject({
        id: issue.id,
        kind: 1621,
        relays: ["wss://repo-relay.example.com/", "wss://repo-relay2.example.com/"],
      })
    })

    it("can skip repo relay resolution when requested", async () => {
      mockRepoLookup()

      const {getEventRelayHints} = await import("./event-links")
      const issue = makeEvent({kind: 1621, tags: [["a", repoAddress]]})

      expect(
        getEventRelayHints(issue as any, {
          relays: ["wss://explicit.example.com"],
          includeRepoRelays: false,
        }),
      ).toEqual(["wss://explicit.example.com/"])
    })
  })
})
