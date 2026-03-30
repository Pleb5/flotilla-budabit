import {describe, expect, it, vi, beforeEach} from "vitest"
import {createTokenWalker} from "./markdownTokenWalker"
import {nip19} from "nostr-tools"

vi.mock("nostr-tools", () => ({
  nip19: {
    decode: vi.fn(),
  },
}))

vi.mock("@welshman/app", () => ({
  profilesByPubkey: {
    subscribe: vi.fn((cb: (v: Map<string, unknown>) => void) => {
      cb(new Map())
      return () => {}
    }),
  },
  loadProfile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./markdownUtils.js", () => ({
  resolveNip05: vi.fn(),
}))

vi.mock("svelte/store", () => ({
  get: vi.fn(() => new Map()),
}))

describe("markdownTokenWalker", () => {
  const mockProfilesByPubkey = new Map<string, {name?: string; display_name?: string}>()
  const mockLoadProfile = vi.fn().mockResolvedValue(undefined)
  const mockResolveNip05 = vi.fn()

  beforeEach(async () => {
    vi.mocked(nip19.decode).mockReset()
    mockLoadProfile.mockReset().mockResolvedValue(undefined)
    mockResolveNip05.mockReset()
    mockProfilesByPubkey.clear()

    const {get} = await import("svelte/store")
    vi.mocked(get).mockReturnValue(mockProfilesByPubkey as any)

    const {loadProfile} = await import("@welshman/app")
    vi.mocked(loadProfile).mockImplementation(mockLoadProfile as any)

    const {resolveNip05} = await import("./markdownUtils.js")
    vi.mocked(resolveNip05).mockImplementation(mockResolveNip05 as any)
  })

  describe("createTokenWalker", () => {
    it("returns an async function", async () => {
      const walker = createTokenWalker({defaultRelays: []})
      expect(typeof walker).toBe("function")
      await expect(walker({type: "text"} as any)).resolves.toBeUndefined()
    })

    it("ignores non-nostr and non-email tokens", async () => {
      const walker = createTokenWalker({defaultRelays: ["wss://relay"]})
      await walker({type: "text", raw: "hello"} as any)
      expect(nip19.decode).not.toHaveBeenCalled()
      expect(mockResolveNip05).not.toHaveBeenCalled()
    })

    it("skips nostr token without fullId", async () => {
      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr"} as any
      await walker(token)
      expect(nip19.decode).not.toHaveBeenCalled()
      expect(token.pubkey).toBeUndefined()
    })

    it("enriches nostr npub token with pubkey from nip19.decode", async () => {
      const pubkey = "a".repeat(64)
      vi.mocked(nip19.decode).mockReturnValue({type: "npub", data: pubkey} as any)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr", fullId: "npub1acdef0ghjkmnpqrstuvwxyz023456789"} as any
      await walker(token)

      expect(nip19.decode).toHaveBeenCalledWith("npub1acdef0ghjkmnpqrstuvwxyz023456789")
      expect(token.pubkey).toBe(pubkey)
    })

    it("enriches nostr nprofile token with pubkey", async () => {
      const pubkey = "b".repeat(64)
      vi.mocked(nip19.decode).mockReturnValue({
        type: "nprofile",
        data: {pubkey},
      } as any)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr", fullId: "nprofile1acdef0ghjkmnpqrstuvwxyz023456"} as any
      await walker(token)

      expect(token.pubkey).toBe(pubkey)
    })

    it("sets userName from profile when available", async () => {
      const pubkey = "c".repeat(64)
      mockProfilesByPubkey.set(pubkey, {name: "Alice", display_name: "alice"})
      vi.mocked(nip19.decode).mockReturnValue({type: "npub", data: pubkey} as any)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr", fullId: "npub1acdef0ghjkmnpqrstuvwxyz023456789"} as any
      await walker(token)

      expect(token.userName).toBe("Alice")
    })

    it("prefers profile.name over profile.display_name", async () => {
      const pubkey = "d".repeat(64)
      mockProfilesByPubkey.set(pubkey, {name: "Bob", display_name: "bob_display"})
      vi.mocked(nip19.decode).mockReturnValue({type: "npub", data: pubkey} as any)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr", fullId: "npub1acdef0ghjkmnpqrstuvwxyz023456789"} as any
      await walker(token)

      expect(token.userName).toBe("Bob")
    })

    it("calls loadProfile when profile not in store and defaultRelays provided", async () => {
      const pubkey = "e".repeat(64)
      vi.mocked(nip19.decode).mockReturnValue({type: "npub", data: pubkey} as any)

      const walker = createTokenWalker({defaultRelays: ["wss://relay.example.com"]})
      const token = {type: "nostr", fullId: "npub1acdef0ghjkmnpqrstuvwxyz023456789"} as any
      await walker(token)

      expect(mockLoadProfile).toHaveBeenCalledWith(pubkey, ["wss://relay.example.com"])
    })

    it("skips nostr token when decode returns non-profile type", async () => {
      vi.mocked(nip19.decode).mockReturnValue({type: "note", data: "noteid"} as any)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "nostr", fullId: "note1acdef0ghjkmnpqrstuvwxyz023456"} as any
      await walker(token)

      expect(token.pubkey).toBeUndefined()
    })

    it("enriches email token when resolveNip05 returns pubkey", async () => {
      const pubkey = "f".repeat(64)
      mockResolveNip05.mockResolvedValue(pubkey)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "email", text: "user@example.com"} as any
      await walker(token)

      expect(mockResolveNip05).toHaveBeenCalledWith("user@example.com")
      expect(token.isNip05).toBe(true)
      expect(token.pubkey).toBe(pubkey)
      expect(token.tagType).toBe("npub")
      expect(token.content).toBe(pubkey)
    })

    it("sets isNip05 false when resolveNip05 returns null", async () => {
      mockResolveNip05.mockResolvedValue(null)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "email", text: "user@example.com"} as any
      await walker(token)

      expect(token.isNip05).toBe(false)
    })

    it("sets userName from profile for NIP-05 email when profile exists", async () => {
      const pubkey = "g".repeat(64)
      mockResolveNip05.mockResolvedValue(pubkey)
      mockProfilesByPubkey.set(pubkey, {display_name: "Grace"})

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "email", text: "grace@example.com"} as any
      await walker(token)

      expect(token.userName).toBe("Grace")
    })

    it("sets userName to email text for NIP-05 when no profile", async () => {
      const pubkey = "h".repeat(64)
      mockResolveNip05.mockResolvedValue(pubkey)

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "email", text: "user@example.com"} as any
      await walker(token)

      expect(token.userName).toBe("user@example.com")
    })

    it("sets isNip05 false and logs on resolveNip05 failure", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      mockResolveNip05.mockRejectedValue(new Error("Network error"))

      const walker = createTokenWalker({defaultRelays: []})
      const token = {type: "email", text: "fail@example.com"} as any
      await walker(token)

      expect(token.isNip05).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})
