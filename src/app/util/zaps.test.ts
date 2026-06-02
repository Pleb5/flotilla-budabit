import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  authorInboxRelays: [] as string[],
  authorReadRelays: [] as string[],
  eventRelayHints: [] as string[],
  getEventRelayHints: vi.fn(),
  normalizeRelayHints: (...groups: any[]) => {
    const relays = new Set<string>()

    for (const group of groups) {
      const values = !group ? [] : typeof group === "string" ? [group] : group

      for (const relay of values) {
        if (typeof relay !== "string" || !relay.match(/^wss?:\/\//)) continue

        relays.add(relay.endsWith("/") ? relay : `${relay}/`)
      }
    }

    return Array.from(relays)
  },
}))

vi.mock("@welshman/lib", () => ({now: () => 1234}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      ForPubkey: () => ({getUrls: () => mocks.authorInboxRelays}),
      FromPubkey: () => ({getUrls: () => mocks.authorReadRelays}),
    }),
  },
}))

vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: ["wss://git.example.com"],
}))

vi.mock("@app/util/event-links", () => ({
  normalizeRelayHints: mocks.normalizeRelayHints,
  getEventRelayHints: mocks.getEventRelayHints,
}))

vi.mock("@welshman/util", () => ({
  ZAP_REQUEST: 9734,
  ZAP_RESPONSE: 9735,
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  isReplaceable: (event: {kind: number}) => event.kind >= 10000 && event.kind < 40000,
  makeEvent: (kind: number, {content = "", tags = []}: {content?: string; tags?: string[][]}) => ({
    kind,
    content,
    tags,
    created_at: 1,
  }),
  Address: class {
    event: {kind: number; pubkey: string; tags: string[][]}

    constructor(event: {kind: number; pubkey: string; tags: string[][]}) {
      this.event = event
    }

    static fromEvent(event: {kind: number; pubkey: string; tags: string[][]}) {
      return new this(event)
    }

    toString() {
      const identifier = this.event.tags.find(tag => tag[0] === "d")?.[1] || ""

      return `${this.event.kind}:${this.event.pubkey}:${identifier}`
    }
  },
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

describe("zap utilities", () => {
  beforeEach(() => {
    mocks.authorInboxRelays = []
    mocks.authorReadRelays = []
    mocks.eventRelayHints = []
    mocks.getEventRelayHints.mockReset()
    mocks.getEventRelayHints.mockImplementation((_event, options = {}) => {
      const primary = mocks.normalizeRelayHints(options.relays || [], mocks.eventRelayHints)

      return primary.length > 0 ? primary : mocks.normalizeRelayHints(options.fallbackRelays || [])
    })
  })

  it("uses scoped relay hints and author receipt relays for community zaps", async () => {
    mocks.authorInboxRelays = ["wss://author-inbox.example.com"]
    mocks.authorReadRelays = ["wss://author-read.example.com"]
    const {getZapRelays} = await import("./zaps")
    const event = makeEvent({tags: [["h", "community"]]})

    expect(
      getZapRelays({
        event: event as any,
        relayHints: ["wss://community.example.com"],
        scopeH: "community",
      }),
    ).toEqual([
      "wss://community.example.com/",
      "wss://author-inbox.example.com/",
      "wss://author-read.example.com/",
    ])
  })

  it("uses the zapped author's receipt relays for unscoped zaps", async () => {
    mocks.authorInboxRelays = ["wss://inbox.example.com"]
    mocks.authorReadRelays = ["wss://read.example.com"]
    const {getZapRelays} = await import("./zaps")
    const event = makeEvent()

    expect(getZapRelays({event: event as any, relayHints: ["wss://explicit.example.com"]})).toEqual([
      "wss://inbox.example.com/",
      "wss://read.example.com/",
    ])
  })

  it("falls back to event relay hints with git relays when author inbox relays are unknown", async () => {
    mocks.eventRelayHints = ["wss://seen.example.com"]
    const {getZapRelays} = await import("./zaps")
    const event = makeEvent()

    expect(getZapRelays({event: event as any})).toEqual(["wss://seen.example.com/"])
    expect(mocks.getEventRelayHints).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        fallbackRelays: ["wss://git.example.com"],
        includeAuthorRelays: true,
      }),
    )
  })

  it("uses explicit relay hints as unscoped fallback only when author inbox relays are unknown", async () => {
    const {getZapRelays} = await import("./zaps")
    const event = makeEvent()

    expect(getZapRelays({event: event as any, relayHints: ["wss://hint.example.com"]})).toEqual([
      "wss://hint.example.com/",
    ])
    expect(mocks.getEventRelayHints).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        relays: ["wss://hint.example.com/"],
        fallbackRelays: ["wss://git.example.com"],
        includeAuthorRelays: true,
      }),
    )
  })

  it("adds event, address, and community scope tags to zap requests", async () => {
    const {makeZapRequestForEvent} = await import("./zaps")
    const event = makeEvent({kind: 30023, tags: [["d", "note"], ["h", "community"]]})
    const request = makeZapRequestForEvent({
      event: event as any,
      zapper: {lnurl: "lnurl1test"},
      msats: 21_000,
      content: "⚡",
      relays: ["wss://community.example.com"],
      scopeH: "community",
    })

    expect(request).toMatchObject({kind: 9734, content: "⚡"})
    expect(request.tags).toEqual(
      expect.arrayContaining([
        ["relays", "wss://community.example.com/"],
        ["amount", "21000"],
        ["lnurl", "lnurl1test"],
        ["p", event.pubkey],
        ["e", event.id],
        ["a", `30023:${event.pubkey}:note`],
        ["h", "community"],
      ]),
    )
  })

  it("builds receipt filters from normal zap tags without requiring h tags", async () => {
    const {getZapReceiptFilters} = await import("./zaps")
    const event = makeEvent({kind: 30023, tags: [["d", "note"], ["h", "community"]]})
    const filters = getZapReceiptFilters({
      event: event as any,
      zapper: {nostrPubkey: "4".repeat(64)},
      since: 1200,
    })

    expect(filters).toEqual([
      {
        kinds: [9735],
        authors: ["4".repeat(64)],
        since: 1200,
        "#p": [event.pubkey],
        "#e": [event.id],
      },
      {
        kinds: [9735],
        authors: ["4".repeat(64)],
        since: 1200,
        "#p": [event.pubkey],
        "#a": [`30023:${event.pubkey}:note`],
      },
    ])
    expect(filters.some(filter => "#h" in filter)).toBe(false)
  })
})
