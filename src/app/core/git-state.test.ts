import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  createPullRequestEvent,
  createRepoAnnouncementEvent,
  createStatusEvent,
  DEFAULT_GRASP_SET_ID,
  GIT_USER_GRASP_LIST,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
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

vi.mock("@welshman/router", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/router")>()

  return {
    ...actual,
    Router: {
      get: () => ({
        FromUser: () => ({getUrls: () => relayMocks.userOutboxRelays}),
      }),
    },
  }
})

vi.mock("@app/core/state", () => ({
  deriveEvent: () => ({subscribe: () => () => {}}),
  fromCsv: () => relayMocks.gitRelays,
}))

import {
  getRepoAnnouncementPublishRelays,
  getRepoAnnouncementRelays,
  getRepoDeclaredMaintainers,
  getRepoMaintainers,
  getOwnedRepoStateLoadScopes,
  getOwnedRepoStateLoadPlans,
  getRepoScopedRelays,
  getVerifiedRepoMaintainers,
  groupStatusEventsByRoot,
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

const nextId = () => {
  eventCounter += 1
  return eventCounter.toString(16).padStart(64, "0")
}

const makePullRequest = ({
  pubkey,
  repoAddr = `30617:${"a".repeat(64)}:demo`,
}: {
  pubkey: string
  repoAddr?: string
}) => {
  const id = nextId()
  return {
    ...createPullRequestEvent({
      content: "PR body",
      repoAddr,
      subject: "PR title",
      tipCommitOid: "c".repeat(40),
      created_at: eventCounter,
    }),
    id,
    pubkey,
    sig: "0".repeat(128),
  } as any
}

const makeStatus = ({
  pubkey,
  rootId,
  kind = GIT_STATUS_APPLIED,
}: {
  pubkey: string
  rootId: string
  kind?: typeof GIT_STATUS_APPLIED | typeof GIT_STATUS_CLOSED
}) => {
  const id = nextId()
  return {
    ...createStatusEvent({kind, content: "", rootId, created_at: eventCounter}),
    id,
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

    it("includes kind 10317 GRASP relays saved by the current user", () => {
      const currentPubkey = "a".repeat(64)
      pubkey.set(currentPubkey)

      repository.publish({
        id: "1".repeat(64),
        sig: "2".repeat(128),
        kind: GIT_USER_GRASP_LIST,
        pubkey: currentPubkey,
        created_at: 10,
        tags: [["g", "wss://custom.grasp.example"]],
        content: "",
      } as any)

      const relays = getRepoAnnouncementRelays()

      expect(relays).toContain("wss://custom.grasp.example/")
    })

    it("falls back to legacy kind 30002 GRASP relays when kind 10317 is absent", () => {
      const currentPubkey = "a".repeat(64)
      pubkey.set(currentPubkey)

      repository.publish({
        id: "1".repeat(64),
        sig: "2".repeat(128),
        kind: GRASP_SET_KIND,
        pubkey: currentPubkey,
        created_at: 10,
        tags: [["d", DEFAULT_GRASP_SET_ID]],
        content: JSON.stringify({urls: ["wss://legacy.grasp.example"]}),
      } as any)

      expect(getRepoAnnouncementRelays()).toContain("wss://legacy.grasp.example/")
    })

    it("does not fall back to legacy GRASP relays when kind 10317 is empty", () => {
      const currentPubkey = "a".repeat(64)
      pubkey.set(currentPubkey)

      repository.publish({
        id: "1".repeat(64),
        sig: "2".repeat(128),
        kind: GRASP_SET_KIND,
        pubkey: currentPubkey,
        created_at: 10,
        tags: [["d", DEFAULT_GRASP_SET_ID]],
        content: JSON.stringify({urls: ["wss://legacy.grasp.example"]}),
      } as any)
      repository.publish({
        id: "3".repeat(64),
        sig: "4".repeat(128),
        kind: GIT_USER_GRASP_LIST,
        pubkey: currentPubkey,
        created_at: 11,
        tags: [],
        content: "",
      } as any)

      expect(getRepoAnnouncementRelays()).not.toContain("wss://legacy.grasp.example/")
    })

    it("merges user outbox, git indexer, explicit GRASP, and repo relays for announcements", () => {
      const currentPubkey = "a".repeat(64)
      pubkey.set(currentPubkey)

      repository.publish({
        id: "1".repeat(64),
        sig: "2".repeat(128),
        kind: GIT_USER_GRASP_LIST,
        pubkey: currentPubkey,
        created_at: 10,
        tags: [["g", "wss://custom.grasp.example"]],
        content: "",
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

    it("derives scoped community relay targets from repo announcement h tags", () => {
      const communityPubkey = "c".repeat(64)
      const unrelatedCommunityPubkey = "d".repeat(64)

      expect(
        getRepoAnnouncementPublishRelays({
          repoEvent: {tags: [["h", communityPubkey]]},
          communityRefs: [
            {communityPubkey, relayHints: ["wss://community.example"]},
            {communityPubkey: unrelatedCommunityPubkey, relayHints: ["wss://unrelated.example"]},
          ],
          gitIndexerRelays: ["wss://git.example"],
          userOutboxRelays: ["wss://outbox.example"],
          userGraspRelays: [],
        }),
      ).toEqual(["wss://outbox.example/", "wss://git.example/", "wss://community.example/"])
    })
  })

  describe("getRepoScopedRelays", () => {
    const owner = "f".repeat(64)

    it("uses only normalized relays declared by a matching announcement", () => {
      const repoEvent = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo",
        relays: ["wss://repo.relay.example.com"],
      })

      const relays = getRepoScopedRelays(repoEvent, {pubkey: owner, identifier: "repo"})

      expect(relays).toEqual(["wss://repo.relay.example.com"])
    })

    it("keeps route hints in announcement discovery only", () => {
      const hint = "wss://hint.relay.example.com"
      const repoEvent = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo",
        relays: ["wss://repo.relay.example.com"],
      })

      expect(getRepoAnnouncementRelays([hint])).toContain("wss://hint.relay.example.com/")
      expect(getRepoScopedRelays(repoEvent, {pubkey: owner, identifier: "repo"})).toEqual([
        "wss://repo.relay.example.com",
      ])
    })

    it("rejects missing, malformed, mismatched, and relayless announcements", () => {
      const malformed = {
        kind: 30617,
        pubkey: owner,
        tags: [
          ["d", "repo"],
          ["relays", 1],
        ],
      } as any
      const relayless = makeRepoAnnouncement({pubkey: owner, identifier: "repo"})
      const valid = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo",
        relays: ["wss://repo.relay.example.com"],
      })
      const expected = {pubkey: owner, identifier: "repo"}

      expect(getRepoScopedRelays(undefined, expected)).toEqual([])
      expect(getRepoScopedRelays(malformed, expected)).toEqual([])
      expect(getRepoScopedRelays(relayless, expected)).toEqual([])
      expect(getRepoScopedRelays(valid, {...expected, identifier: "other"})).toEqual([])
      expect(getRepoScopedRelays(valid, {...expected, pubkey: "e".repeat(64)})).toEqual([])
    })
  })

  describe("getOwnedRepoStateLoadScopes", () => {
    it("partitions each repository state coordinate onto its own declared relays", () => {
      const owner = "a".repeat(64)
      const repoA = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo-a",
        relays: ["wss://relay-a.example"],
      })
      const repoB = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo-b",
        relays: ["wss://relay-b.example"],
      })

      expect(getOwnedRepoStateLoadScopes([repoA, repoB], owner)).toEqual([
        {repoId: "repo-a", relays: ["wss://relay-a.example"]},
        {repoId: "repo-b", relays: ["wss://relay-b.example"]},
      ])
    })

    it("excludes malformed, foreign, and relayless repository announcements", () => {
      const owner = "a".repeat(64)
      const valid = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "valid",
        relays: ["wss://valid.example"],
      })
      const foreign = makeRepoAnnouncement({
        pubkey: "b".repeat(64),
        identifier: "foreign",
        relays: ["wss://foreign.example"],
      })
      const relayless = makeRepoAnnouncement({pubkey: owner, identifier: "relayless"})
      const malformed = {
        kind: 30617,
        pubkey: owner,
        tags: [
          ["d", "malformed"],
          ["relays", false],
        ],
      } as any

      expect(getOwnedRepoStateLoadScopes([valid, foreign, relayless, malformed], owner)).toEqual([
        {repoId: "valid", relays: ["wss://valid.example"]},
      ])
    })

    it("groups shared relay state filters without leaking ids to unrelated relays", () => {
      const owner = "a".repeat(64)
      const repoA = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo-a",
        relays: ["wss://shared.example", "wss://relay-a.example"],
      })
      const repoB = makeRepoAnnouncement({
        pubkey: owner,
        identifier: "repo-b",
        relays: ["wss://shared.example", "wss://relay-b.example"],
      })

      expect(getOwnedRepoStateLoadPlans([repoA, repoB], owner)).toEqual([
        {relay: "wss://relay-a.example", repoIds: ["repo-a"]},
        {relay: "wss://relay-b.example", repoIds: ["repo-b"]},
        {relay: "wss://shared.example", repoIds: ["repo-a", "repo-b"]},
      ])
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

  describe("getRepoDeclaredMaintainers", () => {
    it("excludes the owner and deduplicates co-maintainers", () => {
      const owner = "a".repeat(64)
      const coMaintainer = "b".repeat(64)
      const event = makeRepoAnnouncement({
        pubkey: owner,
        maintainers: [owner, coMaintainer, coMaintainer],
      })

      expect(getRepoDeclaredMaintainers(event)).toEqual([coMaintainer])
    })
  })

  describe("getVerifiedRepoMaintainers", () => {
    it("verifies a declared maintainer after the owner merges one of their PRs", () => {
      const owner = "a".repeat(64)
      const maintainer = "b".repeat(64)
      const repoEvent = makeRepoAnnouncement({pubkey: owner, maintainers: [maintainer]})
      const pullRequest = makePullRequest({pubkey: maintainer})
      const mergedStatus = makeStatus({pubkey: owner, rootId: pullRequest.id})

      const verified = getVerifiedRepoMaintainers({
        repoEvent,
        pullRequests: [pullRequest],
        statusEventsByRoot: new Map([[pullRequest.id, [mergedStatus]]]),
      })

      expect(Array.from(verified)).toEqual([maintainer])
    })

    it("does not verify a maintainer when another maintainer merged their PR", () => {
      const owner = "a".repeat(64)
      const maintainer = "b".repeat(64)
      const merger = "c".repeat(64)
      const repoEvent = makeRepoAnnouncement({pubkey: owner, maintainers: [maintainer, merger]})
      const pullRequest = makePullRequest({pubkey: maintainer})
      const mergedStatus = makeStatus({pubkey: merger, rootId: pullRequest.id})

      const verified = getVerifiedRepoMaintainers({
        repoEvent,
        pullRequests: [pullRequest],
        statusEventsByRoot: new Map([[pullRequest.id, [mergedStatus]]]),
      })

      expect(verified.size).toBe(0)
    })

    it("does not verify the owner even if they are listed as a maintainer", () => {
      const owner = "a".repeat(64)
      const repoEvent = makeRepoAnnouncement({pubkey: owner, maintainers: [owner]})
      const pullRequest = makePullRequest({pubkey: owner})
      const mergedStatus = makeStatus({pubkey: owner, rootId: pullRequest.id})

      const verified = getVerifiedRepoMaintainers({
        repoEvent,
        pullRequests: [pullRequest],
        statusEventsByRoot: new Map([[pullRequest.id, [mergedStatus]]]),
      })

      expect(verified.size).toBe(0)
    })

    it("does not verify a maintainer who is no longer declared", () => {
      const owner = "a".repeat(64)
      const formerMaintainer = "b".repeat(64)
      const repoEvent = makeRepoAnnouncement({pubkey: owner, maintainers: []})
      const pullRequest = makePullRequest({pubkey: formerMaintainer})
      const mergedStatus = makeStatus({pubkey: owner, rootId: pullRequest.id})

      const verified = getVerifiedRepoMaintainers({
        repoEvent,
        pullRequests: [pullRequest],
        statusEventsByRoot: new Map([[pullRequest.id, [mergedStatus]]]),
      })

      expect(verified.size).toBe(0)
    })

    it("requires a merged status for the maintainer PR root", () => {
      const owner = "a".repeat(64)
      const maintainer = "b".repeat(64)
      const repoEvent = makeRepoAnnouncement({pubkey: owner, maintainers: [maintainer]})
      const pullRequest = makePullRequest({pubkey: maintainer})
      const closedStatus = makeStatus({
        pubkey: owner,
        rootId: pullRequest.id,
        kind: GIT_STATUS_CLOSED,
      })

      const verified = getVerifiedRepoMaintainers({
        repoEvent,
        pullRequests: [pullRequest],
        statusEventsByRoot: new Map([[pullRequest.id, [closedStatus]]]),
      })

      expect(verified.size).toBe(0)
    })
  })

  describe("groupStatusEventsByRoot", () => {
    it("groups status events by their root event id", () => {
      const rootA = "a".repeat(64)
      const rootB = "b".repeat(64)
      const owner = "c".repeat(64)
      const statusA = makeStatus({pubkey: owner, rootId: rootA})
      const statusB = makeStatus({pubkey: owner, rootId: rootB})

      const grouped = groupStatusEventsByRoot([statusA, statusB, statusA])

      expect(grouped.get(rootA)).toEqual([statusA])
      expect(grouped.get(rootB)).toEqual([statusB])
    })
  })
})
