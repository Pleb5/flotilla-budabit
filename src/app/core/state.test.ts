// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

describe("state", () => {
  it("fromCsv splits comma-separated values and filters empty", async () => {
    const {fromCsv} = await import("./state")
    expect(fromCsv("a,b,c")).toEqual(["a", "b", "c"])
    expect(fromCsv("a,,b")).toEqual(["a", "b"])
    expect(fromCsv("")).toEqual([])
    expect(fromCsv("single")).toEqual(["single"])
  })

  it("fromCsv handles null/undefined as empty string", async () => {
    const {fromCsv} = await import("./state")
    expect(fromCsv(null as any)).toEqual([])
  })

  it("dufflepud concatenates path to base URL", async () => {
    const {dufflepud} = await import("./state")
    expect(dufflepud("api/upload")).toContain("/api/upload")
    expect(dufflepud("")).toMatch(/\/$/)
  })

  it("entityLink builds coracle URL", async () => {
    const {entityLink} = await import("./state")
    expect(entityLink("nevent1abc")).toBe("https://coracle.social/nevent1abc")
  })

  it("makeRoomId and splitRoomId round-trip", async () => {
    const {makeRoomId, splitRoomId} = await import("./state")
    const url = "wss://relay.example.com"
    const h = "room123"
    const id = makeRoomId(url, h)
    expect(id).toBe("wss://relay.example.com'room123")
    expect(splitRoomId(id)).toEqual([url, h])
  })

  it("makeChatId returns recipient pubkey", async () => {
    const {makeChatId} = await import("./state")
    const recipient = "a".repeat(64)
    expect(makeChatId(recipient)).toBe(recipient)
  })

  it("deriveChat id format is recipient pubkey", async () => {
    const {makeChatId} = await import("./state")
    expect(makeChatId("pk1")).toBe("pk1")
  })

  it("buildChatsById groups inbound and outbound DMs after pubkey loads", async () => {
    const {buildChatsById} = await import("./state")
    const selfPubkey = "a".repeat(64)
    const otherPubkey = "b".repeat(64)

    const chats = buildChatsById(
      [
        {
          id: "sent-1",
          kind: 4444,
          pubkey: selfPubkey,
          tags: [["p", otherPubkey]],
          created_at: 10,
        },
        {
          id: "recv-1",
          kind: 4444,
          pubkey: otherPubkey,
          tags: [["p", selfPubkey]],
          created_at: 20,
        },
      ] as any,
      selfPubkey,
    )

    expect(Array.from(chats.keys())).toEqual([otherPubkey])
    expect(chats.get(otherPubkey)).toMatchObject({
      id: otherPubkey,
      pubkeys: [selfPubkey, otherPubkey],
      last_activity: 20,
      search_text: otherPubkey,
    })
    expect(chats.get(otherPubkey)?.messages.map(event => event.id)).toEqual(["sent-1", "recv-1"])
  })

  it("buildChatsById returns empty when pubkey is unavailable", async () => {
    const {buildChatsById} = await import("./state")
    const selfPubkey = "a".repeat(64)
    const otherPubkey = "b".repeat(64)

    const chats = buildChatsById([
      {
        id: "recv-1",
        kind: 4444,
        pubkey: otherPubkey,
        tags: [["p", selfPubkey]],
        created_at: 20,
      },
    ] as any)

    expect(chats.size).toBe(0)
  })

  it("makeChannelId delegates to makeRoomId", async () => {
    const {makeChannelId, makeRoomId} = await import("./state")
    expect(makeChannelId("wss://r.com", "h1")).toBe(makeRoomId("wss://r.com", "h1"))
  })

  it("splitChannelId delegates to splitRoomId", async () => {
    const {splitChannelId, splitRoomId} = await import("./state")
    expect(splitChannelId("a'b")).toEqual(splitRoomId("a'b"))
  })

  it("displayReaction maps content to emoji", async () => {
    const {displayReaction} = await import("./state")
    expect(displayReaction("")).toBe("❤️")
    expect(displayReaction("+")).toBe("❤️")
    expect(displayReaction("-")).toBe("👎")
    expect(displayReaction("custom")).toBe("custom")
  })

  it("shouldIgnoreError identifies ignorable errors", async () => {
    const {shouldIgnoreError} = await import("./state")
    expect(shouldIgnoreError("mute: some reason")).toBe(true)
    expect(shouldIgnoreError("Error: Signing was aborted")).toBe(true)
    expect(shouldIgnoreError("missing group (`h`) tag")).toBe(true)
    expect(shouldIgnoreError("other error")).toBe(false)
  })

  it("makeCommentFilter builds filter with kinds", async () => {
    const {makeCommentFilter} = await import("./state")
    const filter = makeCommentFilter([1, 3])
    expect(filter.kinds).toEqual([1111])
    expect(filter["#K"]).toEqual(["1", "3"])
  })

  it("encodeRelay encodes URL for path", async () => {
    const {encodeRelay} = await import("./state")
    const encoded = encodeRelay("wss://relay.example.com")
    expect(encoded).not.toContain("://")
    expect(encoded).not.toContain("/")
  })

  it("decodeRelay decodes encoded URL", async () => {
    const {encodeRelay, decodeRelay} = await import("./state")
    const url = "wss://relay.example.com"
    const encoded = encodeRelay(url)
    expect(decodeRelay(encoded)).toMatch(/relay\.example\.com/)
  })

  it("parseInviteLink extracts url and claim from query params", async () => {
    const {parseInviteLink} = await import("./state")
    const result = parseInviteLink(
      "https://app.example.com/invite?r=wss://relay.example.com&c=claim123",
    )
    expect(result).toBeDefined()
    expect(result!.url).toMatch(/relay\.example\.com/)
    expect(result!.claim).toBe("claim123")
  })

  it("parseInviteLink returns undefined for invalid URLs", async () => {
    const {parseInviteLink} = await import("./state")
    expect(parseInviteLink("not-a-url")).toBeUndefined()
  })

  it("parseInviteLink accepts plain relay URL", async () => {
    const {parseInviteLink} = await import("./state")
    const result = parseInviteLink("wss://relay.example.com")
    expect(result).toBeDefined()
    expect(result!.url).toMatch(/relay\.example\.com/)
    expect(result!.claim).toBe("")
  })

  it("hasNip29 returns true when relay supports NIP-29", async () => {
    const {hasNip29} = await import("./state")
    expect(hasNip29({supported_nips: [29]} as any)).toBe(true)
    expect(hasNip29({supported_nips: ["29"]} as any)).toBe(true)
  })

  it("hasNip29 returns false when relay lacks NIP-29", async () => {
    const {hasNip29} = await import("./state")
    expect(hasNip29({supported_nips: [1, 2]} as any)).toBe(false)
    expect(hasNip29(undefined)).toBeUndefined()
  })

  it("defaultSettings has expected structure and values", async () => {
    const {defaultSettings} = await import("./state")
    expect(defaultSettings.show_media).toBe(true)
    expect(defaultSettings.hide_sensitive).toBe(true)
    expect(defaultSettings.trusted_relays).toEqual([])
    expect(defaultSettings.report_usage).toBe(true)
    expect(defaultSettings.font_size).toBe(1.1)
  })

  it("ROOM and PROTECTED constants are defined", async () => {
    const {ROOM, PROTECTED} = await import("./state")
    expect(ROOM).toBe("h")
    expect(PROTECTED).toEqual(["-"])
  })

  it("getSpaceUrlsFromGroupList returns empty for undefined list", async () => {
    const {getSpaceUrlsFromGroupList} = await import("./state")
    expect(getSpaceUrlsFromGroupList(undefined)).toEqual([])
  })

  it("getSpaceRoomsFromGroupList returns empty for undefined list", async () => {
    const {getSpaceRoomsFromGroupList} = await import("./state")
    expect(getSpaceRoomsFromGroupList("wss://relay.example.com", undefined)).toEqual([])
  })

  it("getSpaceRoomsFromGroupList returns rooms when list has matching group tags", async () => {
    const {getSpaceRoomsFromGroupList} = await import("./state")
    const list = {
      kind: 10004,
      publicTags: [["h", "room1", "wss://relay.damus.io"]],
      privateTags: [],
    } as any
    const rooms = getSpaceRoomsFromGroupList("wss://relay.damus.io", list)
    expect(rooms).toContain("room1")
  })

  it("canCreateRoomByPlatformPolicy uses env allowlist on platform relays", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_PLATFORM_RELAYS", "wss://relay.example.com")
    vi.stubEnv(
      "VITE_PLATFORM_ROOM_CREATOR_PUBKEYS",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )

    const {canCreateRoomByPlatformPolicy} = await import("./state")

    expect(
      canCreateRoomByPlatformPolicy({
        relayUrl: "wss://relay.example.com",
        viewerPubkey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        relayOwnerPubkey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toBe(true)

    expect(
      canCreateRoomByPlatformPolicy({
        relayUrl: "wss://relay.example.com",
        viewerPubkey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        relayOwnerPubkey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toBe(false)

    vi.unstubAllEnvs()
  })

  it("canCreateRoomByPlatformPolicy falls back to relay owner when allowlist is unset", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_PLATFORM_RELAYS", "wss://relay.example.com")
    vi.stubEnv("VITE_PLATFORM_ROOM_CREATOR_PUBKEYS", "")

    const {canCreateRoomByPlatformPolicy} = await import("./state")

    expect(
      canCreateRoomByPlatformPolicy({
        relayUrl: "wss://relay.example.com",
        viewerPubkey: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        relayOwnerPubkey: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    ).toBe(true)

    expect(
      canCreateRoomByPlatformPolicy({
        relayUrl: "wss://relay.example.com",
        viewerPubkey: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        relayOwnerPubkey: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }),
    ).toBe(false)

    vi.unstubAllEnvs()
  })

  it("makeBudaBitRoomMetaEvent publishes room meta with archived tag", async () => {
    const {makeBudaBitRoomMetaEvent} = await import("./state")

    const event = makeBudaBitRoomMetaEvent({h: "room-1", name: "Demo Room"} as any, {
      archived: true,
    })

    expect(event.kind).toBe(39000)
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ["d", "room-1"],
        ["name", "Demo Room"],
        ["archived", "true"],
      ]),
    )
    expect(event.tags.some(tag => tag[0] === "h")).toBe(false)
  })

  it("makeBudaBitRoomMetaEvent removes archived tag when restoring a room", async () => {
    const {makeBudaBitRoomMetaEvent} = await import("./state")

    const event = makeBudaBitRoomMetaEvent(
      {
        h: "room-1",
        name: "Demo Room",
        event: {
          tags: [
            ["d", "room-1"],
            ["name", "Demo Room"],
            ["archived", "true"],
          ],
        },
      } as any,
      {archived: false},
    )

    expect(event.tags.some(tag => tag[0] === "archived")).toBe(false)
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ["d", "room-1"],
        ["name", "Demo Room"],
      ]),
    )
  })

  it("getRoomMetaRelays prefers platform relays and falls back to current relay", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_PLATFORM_RELAYS", "wss://relay.one,wss://relay.two")

    let {getRoomMetaRelays} = await import("./state")

    expect(getRoomMetaRelays("wss://relay.other")).toEqual(["wss://relay.one/", "wss://relay.two/"])

    vi.resetModules()
    vi.stubEnv("VITE_PLATFORM_RELAYS", "")
    ;({getRoomMetaRelays} = await import("./state"))

    expect(getRoomMetaRelays("wss://relay.other")).toEqual(["wss://relay.other/"])

    vi.unstubAllEnvs()
  })
})
