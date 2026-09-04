import {beforeEach, describe, expect, it, vi} from "vitest"

import {
  getGitNaturalPRReviewData,
  type GitNaturalPRReviewReader,
} from "../../src/git/natural-pr-review.js"
import type {GitNaturalCommit} from "../../src/git/natural-read-types.js"
import {clearUrlPreferenceCache} from "../../src/utils/clone-url-fallback.js"

const SOURCE_URL = "https://source.example/repo.git"
const TARGET_URL = "https://target.example/repo.git"
const HEAD = "a".repeat(40)
const MID = "b".repeat(40)
const BASE = "c".repeat(40)
const TARGET = "d".repeat(40)

describe("getGitNaturalPRReviewData", () => {
  beforeEach(() => clearUrlPreferenceCache())

  it("validates a provided merge base against natural target history", async () => {
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [MID]), commit(MID, [BASE]), commit(BASE)]],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE)]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
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
      aheadCount: 2,
      behindCount: 1,
    })
    expect(review?.commitOids).toEqual([HEAD, MID])
    expect(review?.changes).toHaveLength(1)
    expect(reader.resolveRef).toHaveBeenCalledWith(
      expect.objectContaining({url: TARGET_URL, ref: "main"}),
    )
    expect(reader.getDiffBetween).toHaveBeenCalledWith(
      expect.objectContaining({url: SOURCE_URL, baseCommitHash: BASE, headCommitHash: HEAD}),
    )
  })

  it("surfaces a claimed merge-base mismatch and diffs from the computed base", async () => {
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [MID]), commit(MID, [BASE]), commit(BASE)]],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE)]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      mergeBase: MID,
      reader,
    })

    expect(review).toMatchObject({
      baseOid: BASE,
      mergeBase: BASE,
      claimedMergeBase: MID,
      claimedMergeBaseMismatch: true,
    })
    expect(reader.getDiffBetween).toHaveBeenCalledWith(
      expect.objectContaining({baseCommitHash: BASE, headCommitHash: HEAD}),
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
    expect(reader.resolveRef).toHaveBeenCalledWith(
      expect.objectContaining({url: TARGET_URL, ref: "main"}),
    )
  })

  it("uses an explicit target commit without resolving a cached branch ref", async () => {
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [BASE]), commit(BASE)]],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE)]],
      ]),
      refs: new Map([[TARGET_URL, "e".repeat(40)]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      targetCommitOid: TARGET,
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review?.targetCommit).toBe(TARGET)
    expect(review?.aheadCount).toBe(1)
    expect(review?.behindCount).toBe(1)
    expect(reader.resolveRef).not.toHaveBeenCalled()
  })

  it("keeps source-side commits reached after an early base in traversal order", async () => {
    const side = "e".repeat(40)
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [BASE, side]), commit(BASE), commit(side, [BASE])]],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE)]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review?.aheadCount).toBe(2)
    expect(review?.commitOids).toEqual([HEAD, side])
  })

  it("excludes an older common ancestor dominated by a nonlinear common ancestor", async () => {
    const sourceSide = "1".repeat(40)
    const targetSide = "2".repeat(40)
    const reader = createReader({
      histories: new Map([
        [
          HEAD,
          [
            commit(HEAD, [BASE, sourceSide]),
            commit(BASE),
            commit(sourceSide, [MID]),
            commit(MID, [BASE]),
          ],
        ],
        [
          TARGET,
          [
            commit(TARGET, [BASE, targetSide]),
            commit(BASE),
            commit(targetSide, [MID]),
            commit(MID, [BASE]),
          ],
        ],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review?.baseOid).toBe(MID)
    expect(reader.getDiffBetween).toHaveBeenCalledWith(
      expect.objectContaining({baseCommitHash: MID}),
    )
  })

  it("deterministically selects between incomparable nonlinear common ancestors", async () => {
    const first = "1".repeat(40)
    const second = "2".repeat(40)
    const root = "3".repeat(40)
    const reader = createReader({
      histories: new Map([
        [
          HEAD,
          [
            commit(HEAD, [first, second]),
            commit(second, [root]),
            commit(first, [root]),
            commit(root),
          ],
        ],
        [
          TARGET,
          [
            commit(TARGET, [second, first]),
            commit(second, [root]),
            commit(first, [root]),
            commit(root),
          ],
        ],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "repo",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review?.baseOid).toBe(first)
  })

  it("does not infer dominance across missing nonlinear history", async () => {
    const older = "1".repeat(40)
    const newer = "2".repeat(40)
    const missing = "3".repeat(40)
    const reader = createReader({
      histories: new Map([
        [HEAD, [commit(HEAD, [older, newer]), commit(older), commit(newer, [missing])]],
        [TARGET, [commit(TARGET, [older, newer]), commit(older), commit(newer, [missing])]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    await expect(
      getGitNaturalPRReviewData({
        repoId: "repo",
        tipCommitOid: HEAD,
        targetBranch: "main",
        sourceUrls: [SOURCE_URL],
        targetUrls: [TARGET_URL],
        reader,
      }),
    ).resolves.toBeNull()
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

  it("reports partial role attempts before returning null", async () => {
    const sourceUrls = [SOURCE_URL, "https://source-fallback.example/repo.git"]
    const targetUrls = [TARGET_URL, "https://target-fallback.example/repo.git"]
    const onAttempts = vi.fn()
    const reader = createReader({
      histories: new Map([[HEAD, [commit(HEAD, [BASE]), commit(BASE)]]]),
      diffError: new Error("object not found"),
    })

    await expect(
      getGitNaturalPRReviewData({
        repoId: "terminal-natural-review",
        tipCommitOid: HEAD,
        targetBranch: "main",
        sourceUrls,
        targetUrls,
        mergeBase: BASE,
        reader,
        onAttempts,
      }),
    ).resolves.toBeNull()

    expect(onAttempts).toHaveBeenCalledWith({
      sourceAttempts: expect.arrayContaining(
        sourceUrls.map(url => expect.objectContaining({url, success: false})),
      ),
      targetAttempts: expect.arrayContaining(
        targetUrls.map(url => expect.objectContaining({url, success: false})),
      ),
    })
  })

  it("attributes the furthest source and target operations when diff falls back roles", async () => {
    const sourceUrls = [
      "https://source-primary.example/repo.git",
      "https://source-secondary.example/repo.git",
    ]
    const targetUrls = [
      "https://target-primary.example/repo.git",
      "https://target-secondary.example/repo.git",
      "https://target-tertiary.example/repo.git",
    ]
    const reader: GitNaturalPRReviewReader & Record<string, any> = {
      resolveRef: vi.fn(async ({url, ref}) => {
        if (url !== targetUrls[0]) throw new Error("target ref unavailable")
        return {
          requestedRef: ref,
          resolvedRef: `refs/heads/${ref}`,
          commitHash: TARGET,
          source: sourceMetadata(url, "resolveRef"),
        }
      }),
      listCommits: vi.fn(async ({url, commitHash}) => {
        if (commitHash === TARGET && url === targetUrls[0]) {
          throw new Error("target history unavailable")
        }
        const commits =
          commitHash === HEAD
            ? [commit(HEAD, [BASE]), commit(BASE)]
            : [commit(TARGET, [BASE]), commit(BASE)]
        return {
          ref: commitHash,
          commitHash,
          commits,
          source: sourceMetadata(url, "listCommits"),
        }
      }),
      getDiffBetween: vi.fn(async ({url, baseCommitHash, headCommitHash}) => {
        if (url !== targetUrls[2]) throw new Error("diff unavailable")
        return {
          baseCommitHash,
          headCommitHash,
          changes: [],
          source: sourceMetadata(url, "getDiffBetween"),
        }
      }),
    }

    const review = await getGitNaturalPRReviewData({
      repoId: "composite-pr-role-attribution",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls,
      targetUrls,
      sourceReadScope: "pr-source:event",
      reader,
    })

    expect(review).toMatchObject({
      success: true,
      usedCloneUrl: sourceUrls[1],
      usedTargetCloneUrl: targetUrls[2],
    })
    expect(review?.sourceAttempts?.slice(-2)).toEqual([
      expect.objectContaining({url: sourceUrls[0], success: false}),
      expect.objectContaining({url: sourceUrls[1], success: false}),
    ])
    expect(review?.targetAttempts?.slice(-2)).toEqual([
      expect.objectContaining({url: targetUrls[1], success: false}),
      expect.objectContaining({url: targetUrls[2], success: true}),
    ])
  })
})

function createReader(options: {
  histories?: Map<string, GitNaturalCommit[]>
  refs?: Map<string, string>
  diffs?: Map<
    string,
    Array<{path: string; status: "added" | "modified" | "deleted" | "renamed"; diffHunks: []}>
  >
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
    author: {
      name: `Author ${hash.slice(0, 1)}`,
      email: `${hash.slice(0, 1)}@example.com`,
      timestamp: 1,
      timezone: "+0000",
    },
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
