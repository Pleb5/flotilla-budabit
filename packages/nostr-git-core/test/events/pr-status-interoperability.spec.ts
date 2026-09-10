import {describe, expect, it} from "vitest"
import {
  createPullRequestEvent,
  parsePullRequestEvent,
  createStatusEvent,
} from "../../src/events/nip34/nip34-utils.js"

const owner = "a".repeat(64)

describe("PR target and status interoperability", () => {
  const root = createPullRequestEvent({
    repoAddr: `30617:${owner}:repo`,
    tipCommitOid: "1".repeat(40),
    content: "PR",
    branchName: "source",
    targetBranch: "release",
  })
  it("emits b, keeps branch-name separate, and reads legacy targets", () => {
    expect(root.tags).toContainEqual(["b", "release"])
    expect(root.tags.some(tag => tag[0] === "target-branch")).toBe(false)
    expect(parsePullRequestEvent(root)).toMatchObject({
      targetBranch: "release",
      branchName: "source",
    })
    expect(
      parsePullRequestEvent({
        ...root,
        tags: [...root.tags.filter(tag => tag[0] !== "b"), ["target-branch", "legacy"]],
      }).targetBranch,
    ).toBe("legacy")
  })
  it("fails closed on conflicting/empty targets rather than guessing a default", () => {
    for (const value of ["other", ""]) {
      const parsed = parsePullRequestEvent({
        ...root,
        tags: [...root.tags, ["target-branch", value]],
      })
      expect(parsed.targetBranch).toBeUndefined()
      expect(parsed.targetBranchError).toBeTruthy()
    }
    expect(
      parsePullRequestEvent({...root, tags: [...root.tags, ["target-branch", "release"]]})
        .targetBranchError,
    ).toBeUndefined()
  })
  it("puts hints on references and indexes applied commits in r", () => {
    const merge = "1".repeat(40),
      applied = "2".repeat(40)
    const event = createStatusEvent({
      kind: 1631,
      content: "Merged",
      rootId: "pr",
      replyId: "update",
      repoAddr: `30617:${owner}:repo`,
      relays: ["wss://relay.test"],
      mergedCommit: merge,
      appliedCommits: [merge, applied],
    })
    expect(event.tags).toContainEqual(["e", "pr", "wss://relay.test", "root"])
    expect(event.tags).toContainEqual(["e", "update", "wss://relay.test", "reply"])
    expect(event.tags).toContainEqual(["a", `30617:${owner}:repo`, "wss://relay.test"])
    expect(event.tags.filter(tag => tag[0] === "r")).toEqual([
      ["r", merge],
      ["r", applied],
    ])
    expect(
      createStatusEvent({
        kind: 1630,
        content: "Open",
        rootId: "pr",
        repoAddr: `30617:${owner}:repo`,
        relays: ["wss://relay.test"],
      }).tags.some(tag => tag[0] === "r"),
    ).toBe(false)
  })
})
