import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {normalizePubkey} from "./pubkeys"

describe("pubkey normalization", () => {
  it("normalizes hex pubkeys", () => {
    expect(normalizePubkey("A".repeat(64))).toBe("a".repeat(64))
  })

  it("normalizes npub values", () => {
    const pubkey = "b".repeat(64)

    expect(normalizePubkey(nip19.npubEncode(pubkey))).toBe(pubkey)
  })

  it("normalizes nprofile values", () => {
    const pubkey = "c".repeat(64)

    expect(normalizePubkey(nip19.nprofileEncode({pubkey, relays: ["wss://relay.example"]}))).toBe(
      pubkey,
    )
  })

  it("rejects invalid pubkeys", () => {
    expect(normalizePubkey("not-a-pubkey")).toBe("")
  })
})
