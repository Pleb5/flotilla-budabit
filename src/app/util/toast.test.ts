// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"

vi.mock("@lib/html", () => ({
  copyToClipboard: vi.fn(),
}))

describe("toast", () => {
  afterEach(async () => {
    const {toast} = await import("./toast")
    toast.set([])
  })

  describe("pushToast", () => {
    it("adds toast to store", async () => {
      const {pushToast, toast} = await import("./toast")

      const id = pushToast({message: "Test message"})

      expect(id).toBeDefined()
      const list = get(toast)
      expect(list).toHaveLength(1)
      expect(list[0].message).toBe("Test message")
      expect(list[0].id).toBe(id)
    })

    it("limits to MAX_TOASTS", async () => {
      const {pushToast, toast} = await import("./toast")

      for (let i = 0; i < 5; i++) {
        pushToast({message: `Toast ${i}`})
      }

      const list = get(toast)
      expect(list.length).toBeLessThanOrEqual(3)
    })
  })

  describe("popToast", () => {
    it("removes toast by id", async () => {
      const {pushToast, popToast, toast} = await import("./toast")

      const id = pushToast({message: "To remove"})
      expect(get(toast)).toHaveLength(1)

      popToast(id)
      expect(get(toast)).toHaveLength(0)
    })
  })

  describe("clip", () => {
    it("calls copyToClipboard and pushToast", async () => {
      const {copyToClipboard} = await import("@lib/html")
      const {clip, toast} = await import("./toast")

      clip("copied value")

      expect(copyToClipboard).toHaveBeenCalledWith("copied value")
      const list = get(toast)
      expect(list.at(-1)?.message).toBe("Copied to clipboard!")
    })

    it.each([
      nip19.npubEncode("2".repeat(64)),
      nip19.nprofileEncode({pubkey: "2".repeat(64)}),
      nip19.noteEncode("1".repeat(64)),
      nip19.neventEncode({id: "1".repeat(64), kind: 1618, relays: ["wss://repo.example.com"]}),
      nip19.naddrEncode({pubkey: "2".repeat(64), kind: 30617, identifier: "repo"}),
    ])("uses the Nostr copy confirmation for public identity %#", async value => {
      const {copyToClipboard} = await import("@lib/html")
      const {clip, toast} = await import("./toast")

      clip(value)

      expect(copyToClipboard).toHaveBeenCalledWith(value)
      expect(get(toast).at(-1)?.message).toBe("Nostr Event Link Copied")
    })

    it("keeps ordinary URL and private key copy messages unchanged", async () => {
      const {clip, toast} = await import("./toast")

      for (const value of ["https://example.com", nip19.nsecEncode(new Uint8Array(32).fill(7))]) {
        clip(value)
        expect(get(toast).at(-1)?.message).toBe("Copied to clipboard!")
      }
    })

    it("preserves explicitly requested copy feedback", async () => {
      const {clip, toast} = await import("./toast")

      clip("https://example.com", "URL copied")

      expect(get(toast).at(-1)?.message).toBe("URL copied")
    })
  })
})
