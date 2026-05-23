import {beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {
  createRepoAnnouncementEvent,
  DEFAULT_GRASP_SET_ID,
  GRASP_SET_KIND,
} from "@nostr-git/core/events"
import {repository, pubkey} from "@welshman/app"

vi.mock("@nostr-git/ui", () => ({
  graspServersStore: {subscribe: () => () => {}},
}))

import {
  getRepoAnnouncementRelays,
  getRepoScopedRelays,
  repoMaintainerSetProfilesByRepoAddress,
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

  describe("repo maintainer set profiles", () => {
    it("treats root-listed maintainers without reciprocal same-repo announcements as pending", () => {
      const root = "a".repeat(64)
      const mutual = "b".repeat(64)
      const missing = "c".repeat(64)
      const nonReciprocal = "d".repeat(64)
      const mismatchedEuc = "e".repeat(64)
      const identifier = "demo"
      const rootAddress = `30617:${root}:${identifier}`

      repository.load([
        makeRepoAnnouncement({
          pubkey: root,
          identifier,
          maintainers: [mutual, missing, nonReciprocal, mismatchedEuc],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: mutual,
          identifier,
          maintainers: [root],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: nonReciprocal,
          identifier,
          maintainers: [],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: mismatchedEuc,
          identifier,
          maintainers: [root],
          euc: "different-euc",
        }),
      ])

      const profile = get(repoMaintainerSetProfilesByRepoAddress).get(rootAddress)

      expect(profile?.maintainerSet).toEqual([root, mutual, mismatchedEuc])
      expect(profile?.pendingMaintainers).toEqual([missing, nonReciprocal])
    })

    it("adds pending maintainers listed by root-listed maintainers only", () => {
      const root = "a".repeat(64)
      const rootListed = "b".repeat(64)
      const secondHop = "c".repeat(64)
      const randomListsRoot = "d".repeat(64)
      const mismatchedEucRootListed = "e".repeat(64)
      const mismatchedEucSecondHop = "f".repeat(64)
      const identifier = "demo"
      const rootAddress = `30617:${root}:${identifier}`

      repository.load([
        makeRepoAnnouncement({
          pubkey: root,
          identifier,
          maintainers: [rootListed, mismatchedEucRootListed],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: rootListed,
          identifier,
          maintainers: [root, secondHop],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: randomListsRoot,
          identifier,
          maintainers: [root],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: mismatchedEucRootListed,
          identifier,
          maintainers: [root, mismatchedEucSecondHop],
          euc: "different-euc",
        }),
      ])

      const profile = get(repoMaintainerSetProfilesByRepoAddress).get(rootAddress)

      expect(profile?.maintainerSet).toEqual([root, rootListed, mismatchedEucRootListed])
      expect(profile?.pendingMaintainers).toEqual([secondHop, mismatchedEucSecondHop])
      expect(profile?.pendingMaintainers).not.toContain(randomListsRoot)
    })

    it("trusts mutual root-listed maintainers regardless of EUC metadata", () => {
      const root = "a".repeat(64)
      const candidate = "b".repeat(64)
      const identifier = "demo"
      const rootAddress = `30617:${root}:${identifier}`

      repository.load([
        makeRepoAnnouncement({
          pubkey: root,
          identifier,
          maintainers: [candidate],
          euc: "root-euc",
        }),
        makeRepoAnnouncement({
          pubkey: candidate,
          identifier,
          maintainers: [root],
          euc: "different-euc",
        }),
      ])

      const profile = get(repoMaintainerSetProfilesByRepoAddress).get(rootAddress)

      expect(profile?.maintainerSet).toEqual([root, candidate])
      expect(profile?.pendingMaintainers).toEqual([])
    })

    it("preserves every accepted maintainer source for duplicate infra", () => {
      const root = "a".repeat(64)
      const candidate = "b".repeat(64)
      const identifier = "demo"
      const rootAddress = `30617:${root}:${identifier}`
      const cloneUrl = "https://git.example.com/demo.git"
      const relayUrl = "wss://relay.example.com"

      repository.load([
        makeRepoAnnouncement({
          pubkey: root,
          identifier,
          maintainers: [candidate],
          clone: [cloneUrl],
          relays: [relayUrl],
        }),
        makeRepoAnnouncement({
          pubkey: candidate,
          identifier,
          maintainers: [root],
          clone: [cloneUrl],
          relays: [relayUrl],
        }),
      ])

      const profile = get(repoMaintainerSetProfilesByRepoAddress).get(rootAddress)

      expect(profile?.cloneUrls).toEqual([cloneUrl])
      expect(profile?.relays).toEqual(["wss://relay.example.com/"])
      expect(profile?.cloneUrlSources.map(source => source.maintainer)).toEqual([root, candidate])
      expect(profile?.relaySources.map(source => source.maintainer)).toEqual([root, candidate])
    })
  })
})
