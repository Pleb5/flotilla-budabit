import {describe, expect, it} from "vitest"

import {convertPullRequestsToNostrEvents, type UserProfileMap} from "../../src/index.js"

describe("platform-to-nostr pull requests", () => {
  it("retains the platform PR number and uses the last imported commit as the tip", () => {
    const profiles: UserProfileMap = new Map([
      ["github:alice", {privkey: "1".repeat(64), pubkey: "2".repeat(64)}],
    ])
    const commits = ["a".repeat(40), "b".repeat(40)]

    const [converted] = convertPullRequestsToNostrEvents(
      [
        {
          id: 42,
          number: 42,
          title: "Import PR",
          body: "Body",
          state: "open",
          author: {login: "alice"},
          head: {
            ref: "feature",
            sha: "c".repeat(40),
            repo: {name: "repo", owner: "alice"},
          },
          base: {
            ref: "main",
            sha: "d".repeat(40),
            repo: {name: "repo", owner: "owner"},
          },
          merged: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          url: "https://api.github.com/repos/owner/repo/pulls/42",
          htmlUrl: "https://github.com/owner/repo/pull/42",
          diffUrl: "https://github.com/owner/repo/pull/42.diff",
          patchUrl: "https://github.com/owner/repo/pull/42.patch",
        },
      ],
      `30617:${"3".repeat(64)}:repo`,
      "github",
      profiles,
      1_800_000_000,
      1_800_000_001,
      new Map([[42, commits]]),
    )

    expect(converted.platformPullRequestNumber).toBe(42)
    expect(converted.event.tags).toContainEqual(["c", commits[1]])
  })
})
