import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

const {fetchMock, fetchMode, reviewMock} = vi.hoisted(() => ({
  fetchMode: {failAllTargets: false},
  fetchMock: vi.fn(async ({url, ref}: {url: string; ref?: string}) => {
    if (fetchMode.failAllTargets && url.includes("target")) {
      throw new Error(`target refresh failed for ${url}`)
    }
    if (url.includes("primary")) throw new Error(`recovery failed for ${url}`)
    return {fetchHead: ref || null}
  }),
  reviewMock: vi.fn(async () => ({success: false, error: "review objects incomplete"})),
}))
let exposed: any

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    addRemote: vi.fn(async () => undefined),
    deleteRemote: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    fetch: fetchMock,
    log: vi.fn(async () => [{oid: "a".repeat(40)}]),
  }),
}))

vi.mock("../../src/git/natural-read-provider.js", () => ({
  GitNaturalReadProvider: class {
    async resolveRef({url, ref}: {url: string; ref: string}) {
      return {
        requestedRef: ref,
        resolvedRef: `refs/heads/${ref}`,
        commitHash: url.includes("source") ? "a".repeat(40) : "b".repeat(40),
        source: {remoteUrl: url},
      }
    }

    async listCommits({url, commitHash}: {url: string; commitHash: string}) {
      if (url.includes("source")) {
        const person = {name: "Test", email: "test@example.com", timestamp: 1, timezone: "+0000"}
        return {
          commits: [
            {
              hash: commitHash,
              tree: "c".repeat(40),
              parents: [],
              author: person,
              committer: person,
              message: "source",
            },
          ],
          source: {remoteUrl: url},
        }
      }
      throw new Error(`target history unavailable from ${url}`)
    }
  },
}))

vi.mock("../../src/git/merge-analysis.js", () => ({
  getPRPreviewData: vi.fn(),
  getPRReviewData: reviewMock,
  getCommitsAheadOfTipData: vi.fn(),
  getMergeBaseBetween: vi.fn(),
}))

vi.mock("../../src/git/pr-source-fetch.js", () => ({
  fetchPrSourceTip: vi.fn(async (_git: any, opts: {tipCommitOid: string}) => ({
    tipOid: opts.tipCommitOid.toLowerCase(),
    strategy: "tip-oid",
  })),
}))

vi.mock("../../src/worker/workers/repos.js", () => ({
  clearCloneTracking: vi.fn(),
  cloneRemoteRepoUtil: vi.fn(),
  ensureFullCloneUtil: vi.fn(),
  ensureOriginRemoteConfig: vi.fn(),
  ensureShallowCloneUtil: vi.fn(),
  initializeRepoUtil: vi.fn(),
  smartInitializeRepoUtil: vi.fn(async () => ({success: true})),
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("PR review recovery attempts", () => {
  it("returns clone-backed source and target recovery evidence", async () => {
    const sourceUrls = [
      "https://source-primary.example/repo.git",
      "https://source-secondary.example/repo.git",
    ]
    const targetUrls = [
      "https://target-primary.example/repo.git",
      "https://target-secondary.example/repo.git",
    ]

    const result = await exposed.getPRReviewData({
      repoId: "owner/repo",
      tipCommitOid: "a".repeat(40),
      targetCommitOid: "b".repeat(40),
      targetBranch: "main",
      cloneUrls: targetUrls,
      prCloneUrls: sourceUrls,
      sourceReadScope: "pr-source:event",
    })

    expect(result).toMatchObject({
      success: false,
      usedCloneUrl: sourceUrls[1],
      usedTargetCloneUrl: targetUrls[1],
    })
    expect(result.sourceAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({url: sourceUrls[0], success: false}),
        expect.objectContaining({url: sourceUrls[1], success: true}),
      ]),
    )
    expect(result.targetAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({url: targetUrls[0], success: false}),
        expect.objectContaining({url: targetUrls[1], success: true}),
      ]),
    )
    expect(reviewMock).toHaveBeenCalledTimes(2)
  })

  it("preserves Git-natural source attempts when target refresh fails", async () => {
    const sourceUrls = [
      "https://preview-source-primary.example/repo.git",
      "https://preview-source-secondary.example/repo.git",
    ]
    const targetUrls = [
      "https://preview-target-primary.example/repo.git",
      "https://preview-target-secondary.example/repo.git",
    ]
    fetchMode.failAllTargets = true

    try {
      const result = await exposed.getPRPreview({
        repoId: "owner/preview-repo",
        sourceBranch: "feature",
        targetBranch: "main",
        cloneUrls: targetUrls,
        sourceCloneUrls: sourceUrls,
        sourceReadScope: "pr-source:preview",
      })

      expect(result.success).toBe(false)
      expect(result.sourceAttempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({url: sourceUrls[0], success: true}),
        ]),
      )
      expect(result.targetAttempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({url: targetUrls[1], success: false}),
        ]),
      )
    } finally {
      fetchMode.failAllTargets = false
    }
  })
})
