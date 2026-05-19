import {describe, expect, it} from "vitest"
import {
  getBudabitBlossomAuthServerDomain,
  makeBudabitBlossomAuthEvent,
  makeBudabitBlossomAuthHeader,
} from "./blossom-auth"

describe("blossom auth helpers", () => {
  it("scopes auth events to BUD-11 server domain tags", () => {
    const event = makeBudabitBlossomAuthEvent({
      action: "upload",
      server: "https://CDN.Example.COM:8443/upload",
      hashes: ["A".repeat(64)],
      expiration: 123,
      content: "Upload Blob",
    })

    expect(event.kind).toBe(24242)
    expect(event.content).toBe("Upload Blob")
    expect(event.tags).toContainEqual(["t", "upload"])
    expect(event.tags).toContainEqual(["expiration", "123"])
    expect(event.tags).toContainEqual(["server", "cdn.example.com"])
    expect(event.tags).toContainEqual(["x", "a".repeat(64)])
    expect(event.tags.some(tag => tag[0] === "u")).toBe(false)
  })

  it("extracts lowercase auth server domains", () => {
    expect(getBudabitBlossomAuthServerDomain("wss://Relay.Example.com/path")).toBe(
      "relay.example.com",
    )
    expect(getBudabitBlossomAuthServerDomain("not-a-url")).toBe("")
  })

  it("encodes auth headers as base64url without padding", () => {
    const signedEvent = {
      id: "id",
      kind: 24242,
      pubkey: "p".repeat(64),
      created_at: 1,
      tags: [["t", "get"]],
      content: "Get Blob",
      sig: "s".repeat(128),
    }
    const header = makeBudabitBlossomAuthHeader(signedEvent)
    const token = header.replace(/^Nostr /, "")
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))

    expect(header.startsWith("Nostr ")).toBe(true)
    expect(token).not.toMatch(/[+/=]/)
    expect(decoded).toEqual(signedEvent)
  })
})
