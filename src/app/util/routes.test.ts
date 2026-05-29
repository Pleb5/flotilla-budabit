import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

const {repositoryQuery, requestMock} = vi.hoisted(() => ({
  repositoryQuery: vi.fn(() => []),
  requestMock: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock("$app/navigation", () => ({goto: vi.fn()}))
vi.mock("@lib/html", () => ({scrollToEvent: vi.fn()}))
vi.mock("@app/core/state", () => ({
  makeChatId: (recipient: string) => recipient,
  entityLink: (entity: string) => `https://coracle.social/${entity}`,
  DM_KIND: 4,
}))
vi.mock("@app/core/community-feeds", () => ({
  SMART_WIDGET_KIND: 30033,
}))
vi.mock("@welshman/net", () => ({request: requestMock}))
vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromPubkey: () => ({getUrls: () => []}),
      FromUser: () => ({getUrls: () => []}),
    }),
  },
}))
vi.mock("@welshman/app", () => ({
  pubkey: {get: vi.fn()},
  repository: {query: repositoryQuery},
  tracker: {getRelays: vi.fn(() => [])},
}))
vi.mock("@welshman/lib", () => ({
  identity: (value: unknown) => Boolean(value),
  sleep: vi.fn(),
}))
vi.mock("@welshman/util", () => ({
  COMMENT: 1111,
  EVENT_DATE: 31922,
  EVENT_TIME: 31923,
  MESSAGE: 9,
  THREAD: 11,
  ZAP_GOAL: 9041,
  getPubkeyTagValues: vi.fn(() => []),
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => url.startsWith("wss://"),
  isReplaceable: (event: {kind: number}) => event.kind >= 10000 && event.kind < 40000,
  Address: class {
    kind: number
    pubkey: string
    identifier: string
    relays: string[]

    constructor(kind: number, pubkey: string, identifier: string, relays: string[] = []) {
      this.kind = kind
      this.pubkey = pubkey
      this.identifier = identifier
      this.relays = relays
    }

    static fromEvent(event: {kind: number; pubkey: string; tags: string[][]}) {
      return new this(event.kind, event.pubkey, event.tags.find(tag => tag[0] === "d")?.[1] || "")
    }

    toString() {
      return `${this.kind}:${this.pubkey}:${this.identifier}`
    }

    toNaddr() {
      return `naddr:${this.kind}:${this.pubkey}:${this.identifier}`
    }
  },
}))

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 1,
  kind: 1,
  tags: [],
  content: "",
  sig: "3".repeat(128),
  ...overrides,
})

describe("routes", () => {
  beforeEach(() => {
    repositoryQuery.mockReset()
    repositoryQuery.mockReturnValue([])
    requestMock.mockReset()
    requestMock.mockResolvedValue(undefined)
  })

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
    expect(makeCommunityRoomPath(communityPubkey, "room-id")).toBe(
      `/c/${communityNpub}/rooms/room-id`,
    )
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

  it("builds npub profile paths when no relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "a".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)

    expect(makeProfilePath(profilePubkey)).toBe(`/people/${profileNpub}`)
    expect(nip19.decode(profileNpub)).toEqual({type: "npub", data: profilePubkey})
  })

  it("builds nprofile profile paths when relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "b".repeat(64)
    const path = makeProfilePath(profilePubkey, [
      "wss://profile-relay.example.com",
      "",
      "wss://backup-relay.example.com",
    ])
    const encodedProfile = decodeURIComponent(path.replace(/^\/people\//, ""))
    const decoded = nip19.decode(encodedProfile)

    expect(path.startsWith("/people/nprofile1")).toBe(true)
    expect(decoded.type).toBe("nprofile")
    expect(decoded.data).toMatchObject({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com", "wss://backup-relay.example.com"],
    })
  })

  it("keeps existing npub and nprofile route identifiers unchanged", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "c".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)
    const profileNprofile = nip19.nprofileEncode({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com"],
    })

    expect(makeProfilePath(profileNpub, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNpub}`,
    )
    expect(makeProfilePath(profileNprofile, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNprofile}`,
    )
  })

  it("parses encoded ncommunity route params", async () => {
    const {makeCommunityPath, parseCommunityRouteParam} = await import("./routes")
    const communityPubkey = "b".repeat(64)
    const value = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com",
    )}`
    const normalizedValue = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(
      "wss://relay.example.com/",
    )}`

    expect(makeCommunityPath(value)).toBe(`/c/${encodeURIComponent(normalizedValue)}`)
    expect(parseCommunityRouteParam(encodeURIComponent(value))).toEqual({
      pubkey: communityPubkey,
      relays: ["wss://relay.example.com/"],
      source: "ncommunity",
    })
  })

  it("routes community thread roots locally", async () => {
    const {getCommunityEventPath, getEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const event = makeEvent({id: "thread-root", kind: 11, tags: [["h", communityPubkey]]})

    expect(getCommunityEventPath(event as any)).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(await getEventPath(event as any, [])).toBe(`/c/${communityNpub}/threads/thread-root`)
  })

  it("routes community room roots locally", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const event = makeEvent({
      id: "room-root",
      kind: 11,
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })

    expect(getCommunityEventPath(event as any)).toBe(`/c/${communityNpub}/rooms/room-root`)
  })

  it("routes community replies and room messages to their parent roots", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 1111,
          tags: [
            ["h", communityPubkey],
            ["E", "thread-root"],
            ["K", "11"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 1111,
          tags: [
            ["h", communityPubkey],
            ["E", "calendar-root"],
            ["K", "31922"],
            ["A", `31922:${"2".repeat(64)}:calendar-d`],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/calendar/calendar-d`)
    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 9,
          tags: [
            ["h", communityPubkey],
            ["E", "room-root"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/rooms/room-root`)
  })

  it("routes community report targets to in-app context pages", async () => {
    const {getCommunityReportTargetPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 9,
        targetEventId: "message-id",
        targetRootId: "room-root",
      }),
    ).toBe(`/c/${communityNpub}/rooms/room-root`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 1111,
        targetRootKind: 11,
        targetRootId: "thread-root",
      }),
    ).toBe(`/c/${communityNpub}/threads/thread-root`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 31922,
        targetEventId: "calendar-id",
        targetIdentifier: "calendar-d",
      }),
    ).toBe(`/c/${communityNpub}/calendar/calendar-d`)
    expect(
      getCommunityReportTargetPath(communityPubkey, {
        targetEventKind: 9041,
        targetEventId: "goal-id",
      }),
    ).toBe(`/c/${communityNpub}/goals/goal-id`)
  })

  it("routes targetable community events to their section pages", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(makeEvent({kind: 31922, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/calendar`)
    expect(
      getCommunityEventPath(makeEvent({kind: 9041, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/goals`)
    expect(
      getCommunityEventPath(makeEvent({kind: 30033, tags: [["h", communityPubkey]]}) as any),
    ).toBe(`/c/${communityNpub}/widgets`)
  })

  it("routes targeted original events using cached targeting events", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: [
          ["d", "target-1"],
          ["k", "31922"],
          ["p", communityPubkey],
        ],
      }),
    ] as any)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 31922,
          tags: [
            ["h", "target-1"],
            ["d", "calendar-1"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/calendar`)
  })

  it("loads targeting events before falling back to external links", async () => {
    const {getEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)
    const targeting = makeEvent({
      kind: 30222,
      tags: [
        ["d", "target-1"],
        ["k", "9041"],
        ["p", communityPubkey],
      ],
    })

    repositoryQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([targeting] as any)

    await expect(
      getEventPath(makeEvent({kind: 9041, tags: [["h", "target-1"]]}) as any, [
        "wss://relay.example.com",
      ]),
    ).resolves.toBe(`/c/${communityNpub}/goals`)
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://relay.example.com/"], autoClose: true}),
    )
  })

  it("routes targeted publication events to their community sections", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const communityNpub = nip19.npubEncode(communityPubkey)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 30222,
          tags: [
            ["d", "target-1"],
            ["k", "30033"],
            ["p", communityPubkey],
          ],
        }) as any,
      ),
    ).toBe(`/c/${communityNpub}/widgets`)
  })

  it("keeps non-community events on external entity links", async () => {
    const {getCommunityEventPath, getEventPath} = await import("./routes")
    const event = makeEvent()
    const path = await getEventPath(event as any, ["wss://relay.example.com"])

    expect(getCommunityEventPath(event as any)).toBeUndefined()
    expect(
      getCommunityEventPath(makeEvent({kind: 11, tags: [["h", "topic"]]}) as any),
    ).toBeUndefined()
    expect(path.startsWith("https://coracle.social/nevent1")).toBe(true)
  })
})
