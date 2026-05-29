// @vitest-environment jsdom

import {describe, expect, it} from "vitest"

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

  it("makeChatId returns recipient pubkey", async () => {
    const {makeChatId} = await import("./state")
    const recipient = "a".repeat(64)
    expect(makeChatId(recipient)).toBe(recipient)
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
        {
          id: "sent-2",
          kind: 4444,
          pubkey: selfPubkey,
          tags: [["p", otherPubkey]],
          created_at: 30,
        },
      ] as any,
      selfPubkey,
    )

    expect(Array.from(chats.keys())).toEqual([otherPubkey])
    expect(chats.get(otherPubkey)).toMatchObject({
      id: otherPubkey,
      pubkeys: [selfPubkey, otherPubkey],
      last_activity: 30,
      search_text: otherPubkey,
    })
    expect(chats.get(otherPubkey)?.messages.map(event => event.id)).toEqual([
      "sent-1",
      "recv-1",
      "sent-2",
    ])
    expect(chats.get(otherPubkey)?.latestMessage?.id).toBe("sent-2")
    expect(chats.get(otherPubkey)?.latestIncomingMessage?.id).toBe("recv-1")
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
    expect(shouldIgnoreError("other error")).toBe(false)
  })

  it("makeCommentFilter builds filter with kinds", async () => {
    const {makeCommentFilter} = await import("./state")
    const filter = makeCommentFilter([1, 3])
    expect(filter.kinds).toEqual([1111])
    expect(filter["#K"]).toEqual(["1", "3"])
  })

  it("encodeRelay encodes URL for path-safe values", async () => {
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

  it("defaultSettings has expected structure and values", async () => {
    const {defaultSettings} = await import("./state")
    expect(defaultSettings.show_media).toBe(true)
    expect(defaultSettings.hide_sensitive).toBe(true)
    expect(defaultSettings.trusted_relays).toEqual([])
    expect(defaultSettings.font_size).toBe(1.1)
  })

  it("ROOM constant is defined for Nostr h-tag compatibility", async () => {
    const {ROOM} = await import("./state")
    expect(ROOM).toBe("h")
  })
})
