import {describe, expect, it} from "vitest"

import {
  convertCommentsToNostrEvents,
  convertPullRequestsToNostrEvents,
  type UserProfileMap,
} from "../../src/index.js"

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
    expect(converted.event.tags).toContainEqual(["branch-name", "feature"])
    expect(converted.event.tags).toContainEqual(["target-branch", "main"])
    expect(converted.event.tags).toContainEqual(["merge-base", "d".repeat(40)])
  })
})

describe("platform-to-nostr comments", () => {
  const profiles: UserProfileMap = new Map([
    ["github:alice", {privkey: "1".repeat(64), pubkey: "2".repeat(64)}],
  ])
  const comment = {
    id: 7,
    body: "Imported comment",
    author: {login: "alice"},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "https://api.github.com/repos/owner/repo/issues/comments/7",
    htmlUrl: "https://github.com/owner/repo/issues/1#issuecomment-7",
  }
  const repoAddr = `30617:${"3".repeat(64)}:repo`

  it.each([
    ["issue", 1621],
    ["pull request", 1618],
  ])("uses the %s root kind and repository q context", (_label, rootKind) => {
    const [converted] = convertCommentsToNostrEvents(
      [comment],
      "4".repeat(64),
      "github",
      profiles,
      new Map(),
      1_800_000_000,
      1_800_000_001,
      {rootKind, repoAddr},
    )

    expect(converted.event.tags).toContainEqual(["K", String(rootKind)])
    expect(converted.event.tags).toContainEqual(["q", repoAddr])
  })

  it("keeps the original issue-comment call signature", () => {
    const [converted] = convertCommentsToNostrEvents(
      [comment],
      "4".repeat(64),
      "github",
      profiles,
      new Map(),
      1_800_000_000,
      1_800_000_001,
    )

    expect(converted.event.tags).toContainEqual(["K", "1621"])
    expect(converted.event.tags.some(tag => tag[0] === "q")).toBe(false)
  })
})
