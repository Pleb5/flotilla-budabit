import {describe, expect, it} from "vitest"
import {
  createPullRequestEvent,
  createStatusEvent,
  type PullRequestEvent,
} from "@nostr-git/core/events"
import {isAcceptedRepoRootEvent} from "./repo-root-history"
import {getMaintainerTargetBranches} from "./repo-maintainer-branches"

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const author = "c".repeat(64)
const address = `30617:${owner}:repo`
const pr = (id: string, targets: PullRequestEvent["tags"]): PullRequestEvent => ({
  ...createPullRequestEvent({
    repoAddr: address,
    tipCommitOid: "1".repeat(40),
    branchName: "source-only",
    content: "PR",
    created_at: 1,
  }),
  id,
  pubkey: author,
  sig: "fixture-only",
  tags: [["a", address], ["c", "1".repeat(40)], ["branch-name", "source-only"], ...targets],
})
const applied = (rootId: string, pubkey = owner) => ({
  ...createStatusEvent({
    kind: 1631,
    rootId,
    recipients: [author],
    relays: ["wss://repo.example"],
    content: "Applied",
    created_at: 2,
  }),
  id: `status-${rootId}`,
  pubkey,
  sig: "fixture-only",
})
const targets = (
  pullRequests: PullRequestEvent[],
  appliedStatuses = pullRequests.map(p => applied(p.id)),
) =>
  getMaintainerTargetBranches({
    repoAddresses: [address],
    pullRequests,
    appliedStatuses,
    maintainers: new Set([owner, maintainer]),
  })

describe("maintainer-only fork targets", () => {
  it("includes mixed b and legacy accepted merge histories, not source branches", () => {
    const pullRequests = [
      pr("new", [["b", "release"]]),
      pr("legacy", [["target-branch", "stable"]]),
      pr("both", [
        ["b", "release"],
        ["target-branch", "release"],
      ]),
    ]
    expect(pullRequests.every(event => isAcceptedRepoRootEvent(event, [address]))).toBe(true)
    expect(
      targets(pullRequests, [applied("new"), applied("legacy", maintainer), applied("both")]),
    ).toEqual(["release", "stable"])
  })
  it("keeps an entirely b-tagged history eligible for the branch filter", () => {
    expect(targets([pr("first", [["b", "next"]]), pr("second", [["b", "release"]])])).toEqual([
      "next",
      "release",
    ])
  })
  it("excludes ambiguous, empty and absent targets without guessing a default", () => {
    expect(
      targets([
        pr("conflict", [
          ["b", "next"],
          ["target-branch", "release"],
        ]),
        pr("duplicate-conflict", [
          ["b", "next"],
          ["b", "release"],
        ]),
        pr("empty", [["b", ""]]),
        pr("whitespace", [["target-branch", " "]]),
        pr("absent", []),
        pr("good", [["b", "main"]]),
      ]),
    ).toEqual(["main"])
  })
  it("requires owner/direct-maintainer application and the current repository", () => {
    const foreign = pr("foreign", [["b", "foreign-target"]])
    foreign.tags[0] = ["a", `30617:${owner}:other`]
    const pullRequests = [
      pr("author-only", [["b", "unauthorized"]]),
      pr("open", [["b", "open"]]),
      foreign,
    ]
    expect(
      targets(pullRequests, [
        applied("author-only", author),
        {...applied("open"), kind: 1630},
        applied("foreign"),
      ]),
    ).toEqual([])
  })
})
