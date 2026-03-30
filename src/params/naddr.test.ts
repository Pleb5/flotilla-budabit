import {describe, expect, it, vi} from "vitest"
import {nip19} from "nostr-tools"

vi.mock("nostr-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools")>()
  return {
    ...actual,
    nip19: {
      ...actual.nip19,
      decode: vi.fn(actual.nip19.decode),
    },
  }
})

import {match} from "./naddr"

const VALID_PUBKEY = "a".repeat(64)
const VALID_IDENTIFIER = "repo"

describe("naddr param matcher", () => {
  it("returns false when param does not start with naddr1", () => {
    expect(match("")).toBe(false)
    expect(match("naddr")).toBe(false)
    expect(match("naddr0")).toBe(false)
    expect(match("npub1abc")).toBe(false)
    expect(match("foo")).toBe(false)
  })

  it("returns true for valid naddr", () => {
    const validNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    expect(match(validNaddr)).toBe(true)
  })

  it("returns false when nip19.decode throws", () => {
    vi.mocked(nip19.decode).mockImplementationOnce(() => {
      throw new Error("invalid bech32")
    })
    expect(match("naddr1invalid")).toBe(false)
  })

  it("returns false when decoded type is not naddr", () => {
    vi.mocked(nip19.decode).mockReturnValueOnce({
      type: "npub",
      data: VALID_PUBKEY,
    })
    expect(match("naddr1qxy")).toBe(false)
  })

  it("returns false when data.kind is negative", () => {
    const validNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    vi.mocked(nip19.decode).mockReturnValueOnce({
      type: "naddr",
      data: {
        kind: -1,
        pubkey: VALID_PUBKEY,
        identifier: VALID_IDENTIFIER,
        relays: [],
      },
    })
    expect(match(validNaddr)).toBe(false)
  })

  it("returns false when data.pubkey length is not 64", () => {
    const validNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    vi.mocked(nip19.decode).mockReturnValueOnce({
      type: "naddr",
      data: {
        kind: 30617,
        pubkey: "short",
        identifier: VALID_IDENTIFIER,
        relays: [],
      },
    })
    expect(match(validNaddr)).toBe(false)
  })

  it("returns false when data.identifier is empty", () => {
    const validNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: VALID_PUBKEY,
      identifier: VALID_IDENTIFIER,
      relays: [],
    })
    vi.mocked(nip19.decode).mockReturnValueOnce({
      type: "naddr",
      data: {
        kind: 30617,
        pubkey: VALID_PUBKEY,
        identifier: "",
        relays: [],
      },
    })
    expect(match(validNaddr)).toBe(false)
  })
})
