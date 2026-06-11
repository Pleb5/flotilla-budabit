import {describe, expect, it, vi} from "vitest"

import {
  getGitNaturalPRReviewData,
  type GitNaturalPRReviewReader,
} from "../../src/git/natural-pr-review.js"
import type {GitNaturalCommit} from "../../src/git/natural-read-types.js"

const SOURCE_URL = "https://source.example/repo.git"
const TARGET_URL = "https://target.example/repo.git"
const HEAD = "a".repeat(40)
const MID = "b".repeat(40)
const BASE = "c".repeat(40)
const TARGET = "d".repeat(40)

describe("getGitNaturalPRReviewData", () => {
  it("loads PR commits and diff naturally when merge base is provided", async () => {
    const reader = createReader({
      histories: new Map([[HEAD, [commit(HEAD, [MID]), commit(MID, [BASE]), commit(BASE)]]]),
      diffs: new Map([[SOURCE_URL, [{path: "README.md", status: "modified", diffHunks: []}]]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      mergeBase: BASE,
      reader,
    })

    expect(review).toMatchObject({
      success: true,
      baseOid: BASE,
      headOid: HEAD,
      mergeBase: BASE,
      source: "git-natural",
      usedCloneUrl: SOURCE_URL,
    })
    expect(review?.commitOids).toEqual([HEAD, MID])
    expect(review?.changes).toHaveLength(1)
    expect(reader.resolveRef).not.toHaveBeenCalled()
    expect(reader.getDiffBetween).toHaveBeenCalledWith(
      expect.objectContaining({url: SOURCE_URL, baseCommitHash: BASE, headCommitHash: HEAD}),
    )
  })

  it("resolves target branch and finds merge base from natural histories", async () => {
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [BASE]), commit(BASE)]],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE)]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, [{path: "src/index.ts", status: "added", diffHunks: []}]]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review?.baseOid).toBe(BASE)
    expect(review?.targetCommit).toBe(TARGET)
    expect(review?.usedTargetCloneUrl).toBe(TARGET_URL)
    expect(review?.commitOids).toEqual([HEAD])
    expect(reader.resolveRef).toHaveBeenCalledWith(expect.objectContaining({url: TARGET_URL, ref: "main"}))
  })

  it("returns null when natural diff cannot load both sides from any URL", async () => {
    const reader = createReader({
      histories: new Map([[HEAD, [commit(HEAD, [BASE]), commit(BASE)]]]),
      diffError: new Error("object not found"),
    })

    await expect(
      getGitNaturalPRReviewData({
        repoId: "repo",
        tipCommitOid: HEAD,
        targetBranch: "main",
        sourceUrls: [SOURCE_URL],
        targetUrls: [TARGET_URL],
        mergeBase: BASE,
        reader,
      }),
    ).resolves.toBeNull()
  })
})

function createReader(options: {
  histories?: Map<string, GitNaturalCommit[]>
  refs?: Map<string, string>
  diffs?: Map<string, Array<{path: string; status: "added" | "modified" | "deleted" | "renamed"; diffHunks: []}>>
  diffError?: Error
}): GitNaturalPRReviewReader & Record<string, any> {
  return {
    resolveRef: vi.fn(async ({url, ref}) => {
      const commitHash = options.refs?.get(url)
      if (!commitHash) throw new Error("ref not found")
      return {
        requestedRef: ref,
        resolvedRef: `refs/heads/${ref}`,
        commitHash,
        source: sourceMetadata(url, "resolveRef"),
      }
    }),
    listCommits: vi.fn(async ({url, commitHash, depth}) => {
      const commits = options.histories?.get(commitHash)
      if (!commits) throw new Error(`history not found for ${url}`)
      return {
        ref: commitHash,
        commitHash,
        commits: commits.slice(0, depth),
        source: sourceMetadata(url, "listCommits"),
      }
    }),
    getDiffBetween: vi.fn(async ({url, baseCommitHash, headCommitHash}) => {
      if (options.diffError) throw options.diffError
      const changes = options.diffs?.get(url)
      if (!changes) throw new Error(`diff not found for ${url}`)
      return {
        baseCommitHash,
        headCommitHash,
        changes,
        source: sourceMetadata(url, "getDiffBetween"),
      }
    }),
  }
}

function commit(hash: string, parents: string[] = []): GitNaturalCommit {
  return {
    hash,
    tree: "e".repeat(40),
    parents,
    author: {name: `Author ${hash.slice(0, 1)}`, email: `${hash.slice(0, 1)}@example.com`, timestamp: 1, timezone: "+0000"},
    committer: {name: "Committer", email: "c@example.com", timestamp: 1, timezone: "+0000"},
    message: `commit ${hash.slice(0, 1)}`,
  }
}

function sourceMetadata(url: string, operation: "resolveRef" | "listCommits" | "getDiffBetween") {
  return {
    kind: "git-natural" as const,
    label: "Git natural Smart HTTP",
    operation,
    remoteUrl: url,
    effectiveUrl: url,
    usesProxy: false,
    attemptedUrls: [url],
    capabilities: ["filter"],
    elapsedMs: 0,
  }
}
