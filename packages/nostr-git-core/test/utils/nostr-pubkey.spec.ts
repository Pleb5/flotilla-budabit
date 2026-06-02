import {describe, it, expect} from "vitest"
import {nip19} from "nostr-tools"
import {toNpub, toHexPubkey, isHexPubkey, isNpub} from "../../src/utils/nostr-pubkey.js"

const HEX = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
const NPUB = nip19.npubEncode(HEX)

describe("nostr-pubkey helpers", () => {
  describe("isHexPubkey", () => {
    it("returns true for 64-char lowercase hex", () => {
      expect(isHexPubkey(HEX)).toBe(true)
    })
    it("returns true for 64-char uppercase hex", () => {
      expect(isHexPubkey(HEX.toUpperCase())).toBe(true)
    })
    it("returns false for npub", () => {
      expect(isHexPubkey(NPUB)).toBe(false)
    })
    it("returns false for short hex", () => {
      expect(isHexPubkey("deadbeef")).toBe(false)
    })
  })

  describe("isNpub", () => {
    it("returns true for npub1... string", () => {
      expect(isNpub(NPUB)).toBe(true)
    })
    it("returns false for hex", () => {
      expect(isNpub(HEX)).toBe(false)
    })
    it("returns false for random string", () => {
      expect(isNpub("alice")).toBe(false)
    })
  })

  describe("toNpub", () => {
    it("encodes hex pubkey to npub", () => {
      expect(toNpub(HEX)).toBe(NPUB)
    })
    it("passes through a valid npub unchanged", () => {
      expect(toNpub(NPUB)).toBe(NPUB)
    })
    it("throws on empty string", () => {
      expect(() => toNpub("")).toThrow()
    })
    it("throws on arbitrary string", () => {
      expect(() => toNpub("not-a-pubkey")).toThrow()
    })
    it("throws on short hex", () => {
      expect(() => toNpub("deadbeef")).toThrow()
    })
  })

  describe("toHexPubkey", () => {
    it("returns lowercase hex unchanged for hex input", () => {
      expect(toHexPubkey(HEX)).toBe(HEX)
    })
    it("normalizes uppercase hex to lowercase", () => {
      expect(toHexPubkey(HEX.toUpperCase())).toBe(HEX)
    })
    it("decodes npub to hex", () => {
      expect(toHexPubkey(NPUB)).toBe(HEX)
    })
    it("round-trips: toNpub -> toHexPubkey -> original hex", () => {
      expect(toHexPubkey(toNpub(HEX))).toBe(HEX)
    })
    it("round-trips: toHexPubkey -> toNpub -> original npub", () => {
      expect(toNpub(toHexPubkey(NPUB))).toBe(NPUB)
    })
    it("throws on empty string", () => {
      expect(() => toHexPubkey("")).toThrow()
    })
    it("throws on arbitrary string", () => {
      expect(() => toHexPubkey("not-a-pubkey")).toThrow()
    })
  })
})
