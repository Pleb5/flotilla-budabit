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
