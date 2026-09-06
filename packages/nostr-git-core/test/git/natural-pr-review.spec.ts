import {beforeEach, describe, expect, it, vi} from "vitest"

import {
  getGitNaturalPRReviewData,
  type GitNaturalPRReviewReader,
} from "../../src/git/natural-pr-review.js"
import type {GitNaturalCommit} from "../../src/git/natural-read-types.js"
import {GitNaturalReadError} from "../../src/git/natural-read-transport.js"
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

  it("chooses a deterministic best base for a criss-cross graph", async () => {
    const root = "1".repeat(40)
    const firstBase = "2".repeat(40)
    const secondBase = "3".repeat(40)
    const sourceMerge = "4".repeat(40)
    const targetMerge = "5".repeat(40)
    const sourceTip = "6".repeat(40)
    const targetTip = "7".repeat(40)
    const reader = createReader({
      histories: new Map([
        [
          sourceTip,
          [
            commit(sourceTip, [sourceMerge]),
            commit(sourceMerge, [firstBase, secondBase]),
            commit(firstBase, [root]),
            commit(secondBase, [root]),
            commit(root),
          ],
        ],
        [
          targetTip,
          [
            commit(targetTip, [targetMerge]),
            commit(targetMerge, [secondBase, firstBase]),
            commit(secondBase, [root]),
            commit(firstBase, [root]),
            commit(root),
          ],
        ],
      ]),
      refs: new Map([[TARGET_URL, targetTip]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "criss-cross",
      tipCommitOid: sourceTip,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review).toMatchObject({
      baseOid: firstBase,
      aheadCount: 2,
      behindCount: 2,
      commitOids: [sourceTip, sourceMerge],
    })
    expect(reader.getDiffBetween).toHaveBeenCalledWith(
      expect.objectContaining({baseCommitHash: firstBase, headCommitHash: sourceTip}),
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

  it("subtracts target reachability from a source merge with pre-base side ancestry", async () => {
    const root = "1".repeat(40)
    const sideRoot = "2".repeat(40)
    const sideTip = "3".repeat(40)
    const reader = createReader({
      histories: new Map([
        [
          HEAD,
          [
            commit(HEAD, [BASE, sideTip]),
            commit(BASE, [root]),
            commit(sideTip, [sideRoot]),
            commit(sideRoot, [root]),
            commit(root),
          ],
        ],
        [TARGET, [commit(TARGET, [BASE]), commit(BASE, [root]), commit(root)]],
      ]),
      refs: new Map([[TARGET_URL, TARGET]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "pre-base-side-ancestry",
      tipCommitOid: HEAD,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review).toMatchObject({mergeBase: BASE, aheadCount: 3, behindCount: 1})
    expect(review?.commitOids).toEqual([HEAD, sideTip, sideRoot])
  })

  it("propagates shared reachability through loaded ancestry without fetching repository roots", async () => {
    const sourceSide = "1".repeat(40)
    const sharedMain = "2".repeat(40)
    const sharedSide = "3".repeat(40)
    const reader = createReader({
      histories: new Map([
        [
          HEAD,
          [
            commit(HEAD, [TARGET, sourceSide]),
            commit(TARGET, [sharedMain, sharedSide]),
            commit(sourceSide, [sharedSide]),
            commit(sharedSide),
          ],
        ],
        [TARGET, [commit(TARGET, [sharedMain, sharedSide]), commit(sharedMain)]],
      ]),
      diffs: new Map([[SOURCE_URL, []]]),
    })

    const review = await getGitNaturalPRReviewData({
      repoId: "shared-reachability",
      tipCommitOid: HEAD,
      targetCommitOid: TARGET,
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review).toMatchObject({
      mergeBase: TARGET,
      aheadCount: 2,
      behindCount: 0,
      commitOids: [HEAD, sourceSide],
    })
    expect(reader.listCommits).toHaveBeenCalledTimes(2)
  })

  it("iteratively expands a merge base beyond the former 100-commit boundary", async () => {
    const sourceCommitCount = 125
    const graph = new Map<string, GitNaturalCommit>()
    const base = numberedOid(1)
    graph.set(base, commit(base))
    let parent = base
    for (let index = 0; index < sourceCommitCount; index += 1) {
      const next = numberedOid(index + 2)
      graph.set(next, commit(next, [parent]))
      parent = next
    }
    const sourceTip = parent
    const targetTip = numberedOid(10_000)
    graph.set(targetTip, commit(targetTip, [base]))

    const reader: GitNaturalPRReviewReader & Record<string, any> = {
      resolveRef: vi.fn(),
      listCommits: vi.fn(async ({url, commitHash, depth}) => {
        const commits: GitNaturalCommit[] = []
        let current: string | undefined = commitHash
        while (current && commits.length < depth) {
          const next = graph.get(current)
          if (!next) throw new Error(`history not found for ${url}: ${current}`)
          commits.push(next)
          current = next.parents[0]
        }
        return {
          ref: commitHash,
          commitHash,
          commits,
          hasMore: Boolean(current),
          unresolvedParentOids: current ? [current] : [],
          source: sourceMetadata(url, "listCommits"),
        }
      }),
      getDiffBetween: vi.fn(async ({url, baseCommitHash, headCommitHash}) => ({
        baseCommitHash,
        headCommitHash,
        changes: [],
        source: sourceMetadata(url, "getDiffBetween"),
      })),
    }

    const review = await getGitNaturalPRReviewData({
      repoId: "deep-pr-history",
      tipCommitOid: sourceTip,
      targetCommitOid: targetTip,
      targetBranch: "main",
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      reader,
    })

    expect(review).toMatchObject({
      success: true,
      mergeBase: base,
      aheadCount: sourceCommitCount,
      behindCount: 1,
    })
    expect(review?.commitOids[0]).toBe(sourceTip)
    expect(review?.commitOids.at(-1)).toBe(numberedOid(2))
    expect(
      reader.listCommits.mock.calls.filter(([request]: any[]) => request.url === SOURCE_URL),
    ).toHaveLength(3)
  })

  it("stops at a nearby shared frontier instead of counting 6000 shared commits", async () => {
    const graph = new Map<string, GitNaturalCommit>()
    let sharedParent: string | undefined
    for (let index = 1; index <= 6_001; index += 1) {
      const oid = numberedOid(index)
      graph.set(oid, commit(oid, sharedParent ? [sharedParent] : []))
      sharedParent = oid
    }
    const base = sharedParent!
    const sourceOnly = numberedOid(20_002)
    const sourceTip = numberedOid(20_000)
    const targetTip = numberedOid(20_001)
    graph.set(sourceOnly, commit(sourceOnly, [base]))
    graph.set(sourceTip, commit(sourceTip, [sourceOnly]))
    graph.set(targetTip, commit(targetTip, [base]))

    const reader: GitNaturalPRReviewReader & Record<string, any> = {
      resolveRef: vi.fn(),
      listCommits: vi.fn(async ({url, commitHash, depth}) => {
        const commits: GitNaturalCommit[] = []
        let current: string | undefined = commitHash
        while (current && commits.length < depth) {
          const next = graph.get(current)
          if (!next) throw new Error(`history not found for ${url}: ${current}`)
          commits.push(next)
          current = next.parents[0]
        }
        return {
          ref: commitHash,
          commitHash,
          commits,
          hasMore: Boolean(current),
          unresolvedParentOids: current ? [current] : [],
          source: sourceMetadata(url, "listCommits"),
        }
      }),
      getDiffBetween: vi.fn(async ({url, baseCommitHash, headCommitHash}) => ({
        baseCommitHash,
        headCommitHash,
        changes: [],
        source: sourceMetadata(url, "getDiffBetween"),
      })),
    }

    const review = await getGitNaturalPRReviewData({
      repoId: "nearby-shared-frontier",
      tipCommitOid: sourceTip,
      targetCommitOid: targetTip,
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      maxCommits: 20,
      historyBatchSize: 4,
      reader,
    })

    expect(review).toMatchObject({
      success: true,
      mergeBase: base,
      aheadCount: 2,
      behindCount: 1,
      commitOids: [sourceTip, sourceOnly],
    })
    expect(reader.listCommits).toHaveBeenCalledTimes(2)
    expect(reader.listCommits.mock.calls.map(([request]: any[]) => request.commitHash)).toEqual([
      sourceTip,
      targetTip,
    ])
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

  it("does not start a target read after unconfirmed source cancellation", async () => {
    const targetDiff = vi.fn(async () => ({changes: []}) as any)
    const reader: GitNaturalPRReviewReader = {
      resolveRef: vi.fn(),
      listCommits: vi.fn(
        async () =>
          ({
            commits: [commit(HEAD, [BASE]), commit(BASE)],
          }) as any,
      ),
      getDiffBetween: vi.fn(async ({url}) => {
        if (url === SOURCE_URL) {
          throw new GitNaturalReadError("cancellation-unconfirmed", "source request did not settle")
        }
        return targetDiff()
      }),
    }

    await expect(
      getGitNaturalPRReviewData({
        repoId: "repo",
        tipCommitOid: HEAD,
        targetCommitOid: BASE,
        sourceUrls: [SOURCE_URL],
        targetUrls: [TARGET_URL],
        reader,
      }),
    ).resolves.toBeNull()
    expect(targetDiff).not.toHaveBeenCalled()
  })

  it("propagates caller cancellation through an active history request", async () => {
    const startedSignals: AbortSignal[] = []
    const reader: GitNaturalPRReviewReader = {
      resolveRef: vi.fn(),
      listCommits: vi.fn(
        ({signal}) =>
          new Promise((_resolve, reject) => {
            startedSignals.push(signal!)
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              {once: true},
            )
          }),
      ),
      getDiffBetween: vi.fn(),
    }
    const controller = new AbortController()

    const pending = getGitNaturalPRReviewData({
      repoId: "cancelled-pr-history",
      tipCommitOid: HEAD,
      targetCommitOid: TARGET,
      sourceUrls: [SOURCE_URL],
      targetUrls: [TARGET_URL],
      signal: controller.signal,
      reader,
    })
    await vi.waitFor(() => expect(startedSignals).toHaveLength(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({name: "AbortError"})
    expect(startedSignals).toHaveLength(1)
    expect(startedSignals[0].aborted).toBe(true)
    expect(reader.getDiffBetween).not.toHaveBeenCalled()
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

  it("preserves HTTP status in PR-scoped fallback evidence", async () => {
    const onAttempts = vi.fn()
    const reader = createReader({
      histories: new Map([[HEAD, [commit(HEAD, [BASE]), commit(BASE)]]]),
      diffError: new GitNaturalReadError("http-error", "HTTP 502 Bad Gateway", {
        status: 502,
        remoteUrl: SOURCE_URL,
      }),
    })

    await expect(
      getGitNaturalPRReviewData({
        repoId: "pr-http-evidence",
        tipCommitOid: HEAD,
        sourceUrls: [SOURCE_URL],
        mergeBase: BASE,
        reader,
        onAttempts,
      }),
    ).resolves.toBeNull()

    expect(onAttempts).toHaveBeenCalledWith({
      sourceAttempts: expect.arrayContaining([
        expect.objectContaining({
          url: SOURCE_URL,
          success: false,
          errorCode: "http-error",
          status: 502,
        }),
      ]),
      targetAttempts: [],
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

  it("allows a progressing diff to exceed the former 15-second aggregate deadline", async () => {
    vi.useFakeTimers()
    const reader = createReader({
      histories: new Map([[HEAD, [commit(HEAD, [BASE]), commit(BASE)]]]),
      diffs: new Map([[SOURCE_URL, []]]),
    })
    reader.getDiffBetween.mockImplementation(async ({url, baseCommitHash, headCommitHash}: any) => {
      await new Promise(resolve => setTimeout(resolve, 16_001))
      return {
        baseCommitHash,
        headCommitHash,
        changes: [],
        source: sourceMetadata(url, "getDiffBetween"),
      }
    })

    try {
      const reviewPromise = getGitNaturalPRReviewData({
        repoId: "long-natural-diff",
        tipCommitOid: HEAD,
        targetBranch: "main",
        sourceUrls: [SOURCE_URL],
        targetUrls: [TARGET_URL],
        mergeBase: BASE,
        reader,
      })
      await vi.advanceTimersByTimeAsync(16_001)
      await expect(reviewPromise).resolves.toMatchObject({success: true, changes: []})
    } finally {
      vi.useRealTimers()
    }
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

function numberedOid(value: number): string {
  return value.toString(16).padStart(40, "0")
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
