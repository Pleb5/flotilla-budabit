import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  createRepoAnnouncementEvent,
  DEFAULT_GRASP_SET_ID,
  GRASP_SET_KIND,
} from "@nostr-git/core/events"
import {repository, pubkey} from "@welshman/app"

const relayMocks = vi.hoisted(() => ({
  userOutboxRelays: ["wss://outbox.example"],
  gitRelays: ["wss://git-indexer.example"],
}))

vi.mock("@nostr-git/ui", () => ({
  graspServersStore: {subscribe: () => () => {}},
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromUser: () => ({getUrls: () => relayMocks.userOutboxRelays}),
    }),
  },
}))

vi.mock("@app/core/state", () => ({
  deriveEvent: () => ({subscribe: () => () => {}}),
  fromCsv: () => relayMocks.gitRelays,
}))

import {
  getRepoAnnouncementPublishRelays,
  getRepoAnnouncementRelays,
  getRepoMaintainers,
  getRepoScopedRelays,
} from "./git-state"

let eventCounter = 0

const makeRepoAnnouncement = ({
  pubkey,
  identifier = "demo",
  maintainers = [],
  clone = [],
  relays = [],
  euc = "shared-euc",
}: {
  pubkey: string
  identifier?: string
  maintainers?: string[]
  clone?: string[]
  relays?: string[]
  euc?: string | null
}) => {
  eventCounter += 1
  return {
    ...createRepoAnnouncementEvent({
      repoId: identifier,
      maintainers,
      clone,
      relays,
      earliestUniqueCommit: euc || undefined,
      created_at: eventCounter,
    }),
    id: eventCounter.toString(16).padStart(64, "0"),
    pubkey,
    sig: "0".repeat(128),
  } as any
}

describe("budabit state", () => {
  beforeEach(() => {
    eventCounter = 0
    repository.load([])
    pubkey.set(undefined)
  })

  describe("getRepoAnnouncementRelays", () => {
    beforeEach(() => {
      relayMocks.userOutboxRelays = ["wss://outbox.example"]
    })

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

    it("merges user outbox, git indexer, explicit GRASP, and repo relays for announcements", () => {
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

      expect(
        getRepoAnnouncementRelays(["wss://repo.example", "wss://repo.example/", "not-a-relay"]),
      ).toEqual([
        "wss://outbox.example/",
        "wss://git-indexer.example/",
        "wss://custom.grasp.example/",
        "wss://repo.example/",
      ])
    })

    it("adds only h-tagged community relays to repo announcement publish targets", () => {
      const communityPubkey = "c".repeat(64)
      const unrelatedCommunityPubkey = "d".repeat(64)

      expect(
        getRepoAnnouncementPublishRelays({
          repoRelays: ["wss://repo.example"],
          communityPubkeys: [communityPubkey],
          communityRefs: [
            {communityPubkey, relayHints: ["wss://community.example"]},
            {communityPubkey: unrelatedCommunityPubkey, relayHints: ["wss://unrelated.example"]},
          ],
          gitIndexerRelays: ["wss://git.example"],
          userOutboxRelays: ["wss://outbox.example"],
          userGraspRelays: ["wss://grasp.example"],
        }),
      ).toEqual([
        "wss://outbox.example/",
        "wss://git.example/",
        "wss://grasp.example/",
        "wss://repo.example/",
        "wss://community.example/",
      ])
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

  describe("getRepoMaintainers", () => {
    it("returns the repo owner and tagged maintainers", () => {
      const root = "a".repeat(64)
      const mutual = "b".repeat(64)
      const identifier = "demo"
      const event = makeRepoAnnouncement({
        pubkey: root,
        identifier,
        maintainers: [mutual, mutual],
      })

      expect(getRepoMaintainers(event)).toEqual([root, mutual])
    })
  })
})
