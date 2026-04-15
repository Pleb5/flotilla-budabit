import {beforeEach, describe, expect, it} from "vitest"
import {
  createRepoAnnouncementEvent,
  DEFAULT_GRASP_SET_ID,
  GRASP_SET_KIND,
} from "@nostr-git/core/events"
import {repository, pubkey} from "@welshman/app"
import {
  splitChannelId,
  makeChannelId,
  jobLink,
  gitLink,
  getRepoAnnouncementRelays,
  getRepoScopedRelays,
  ROOMS,
  GENERAL,
} from "./state"

describe("budabit state", () => {
  beforeEach(() => {
    repository.load([])
    pubkey.set(undefined)
  })

  describe("splitChannelId", () => {
    it("splits channel id by apostrophe", () => {
      expect(splitChannelId("wss://relay.com'room1")).toEqual(["wss://relay.com", "room1"])
      expect(splitChannelId("url'room")).toEqual(["url", "room"])
    })

    it("handles multiple segments", () => {
      expect(splitChannelId("a'b'c")).toEqual(["a", "b", "c"])
    })
  })

  describe("makeChannelId", () => {
    it("returns naddr1 when room starts with naddr1", () => {
      expect(makeChannelId("wss://relay.com", "naddr1abc")).toBe("naddr1")
    })

    it("concatenates url and room with apostrophe", () => {
      expect(makeChannelId("wss://relay.com", "general")).toBe("wss://relay.com'general")
    })
  })

  describe("jobLink", () => {
    it("builds test.satshoot.com URL with naddr", () => {
      expect(jobLink("naddr1abc")).toBe("https://test.satshoot.com/naddr1abc")
    })
  })

  describe("gitLink", () => {
    it("builds gitworkshop.dev URL with naddr", () => {
      expect(gitLink("naddr1xyz")).toBe("https://gitworkshop.dev/naddr1xyz")
    })
  })

  describe("getRepoAnnouncementRelays", () => {
    it("returns array of relay URLs", () => {
      const relays = getRepoAnnouncementRelays()
      expect(Array.isArray(relays)).toBe(true)
      expect(relays.every(url => typeof url === "string" && url.startsWith("wss://"))).toBe(true)
    })

    it("includes extra relays when provided", () => {
      const extra = "wss://extra.relay.example.com"
      const relays = getRepoAnnouncementRelays([extra])
      expect(relays.some(url => url.includes("extra.relay.example.com"))).toBe(true)
    })

    it("includes explicit GRASP relays saved by the current user", () => {
      const currentPubkey = "a".repeat(64)
      pubkey.set(currentPubkey)

      repository.publish({
        id: "1".repeat(64),
        sig: "2".repeat(128),
        kind: GRASP_SET_KIND,
        pubkey: currentPubkey,
        created_at: 10,
        tags: [["d", DEFAULT_GRASP_SET_ID]],
        content: JSON.stringify({urls: ["wss://custom.grasp.example"]}),
      } as any)

      const relays = getRepoAnnouncementRelays()

      expect(relays).toContain("wss://custom.grasp.example/")
    })
  })

  describe("getRepoScopedRelays", () => {
    it("uses repo relays plus naddr hints only", () => {
      const repoEvent = createRepoAnnouncementEvent({
        repoId: `${"f".repeat(64)}:repo`,
        relays: ["wss://repo.relay.example.com"],
      }) as any

      const relays = getRepoScopedRelays(repoEvent, ["wss://hint.relay.example.com"])

      expect(relays).toEqual(["wss://repo.relay.example.com/", "wss://hint.relay.example.com/"])
    })

    it("falls back to hints when repo announcement is unavailable", () => {
      const relays = getRepoScopedRelays(undefined, ["wss://hint.relay.example.com"])

      expect(relays).toEqual(["wss://hint.relay.example.com/"])
    })
  })

  describe("constants", () => {
    it("ROOMS and GENERAL are defined", () => {
      expect(ROOMS).toBe(10009)
      expect(GENERAL).toBe("_")
    })
  })
})
