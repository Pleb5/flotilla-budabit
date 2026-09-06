import {beforeEach, describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"
import {
  clearUrlPreferenceCache,
  getCachedUrlPreference,
} from "../../src/utils/clone-url-fallback.js"

const {fetchMock, fetchMode, historySignals, naturalMode, reviewMock, smartInitializeMock} =
  vi.hoisted(() => ({
    fetchMode: {failAllTargets: false},
    historySignals: [] as AbortSignal[],
    naturalMode: {blockHistory: false, missingFilterHistory: false, successfulReview: false},
    fetchMock: vi.fn(async ({url, ref}: {url: string; ref?: string}) => {
      if (fetchMode.failAllTargets && url.includes("target")) {
        throw new Error(`target refresh failed for ${url}`)
      }
      if (url.includes("primary")) throw new Error(`recovery failed for ${url}`)
      return {fetchHead: ref || null}
    }),
    reviewMock: vi.fn(async () => ({success: false, error: "review objects incomplete"})),
    smartInitializeMock: vi.fn(async () => ({success: true})),
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

    async listCommits({
      url,
      commitHash,
      signal,
    }: {
      url: string
      commitHash: string
      signal?: AbortSignal
    }) {
      if (signal) historySignals.push(signal)
      if (naturalMode.blockHistory) {
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            {once: true},
          )
        })
      }
      if (naturalMode.missingFilterHistory) {
        throw Object.assign(new Error(`filter unavailable from ${url}`), {
          code: "missing-filter-capability",
        })
      }
      if (url.includes("source")) {
        const person = {name: "Test", email: "test@example.com", timestamp: 1, timezone: "+0000"}
        const base = "c".repeat(40)
        return {
          commits: [
            {
              hash: commitHash,
              tree: "c".repeat(40),
              parents: naturalMode.successfulReview ? [base] : [],
              author: person,
              committer: person,
              message: "source",
            },
            ...(naturalMode.successfulReview
              ? [
                  {
                    hash: base,
                    tree: "d".repeat(40),
                    parents: [],
                    author: person,
                    committer: person,
                    message: "base",
                  },
                ]
              : []),
          ],
          source: {remoteUrl: url},
        }
      }
      if (naturalMode.successfulReview) {
        const person = {name: "Test", email: "test@example.com", timestamp: 1, timezone: "+0000"}
        return {
          commits: [
            {
              hash: commitHash,
              tree: "c".repeat(40),
              parents: ["c".repeat(40)],
              author: person,
              committer: person,
              message: "target",
            },
            {
              hash: "c".repeat(40),
              tree: "d".repeat(40),
              parents: [],
              author: person,
              committer: person,
              message: "base",
            },
          ],
          source: {remoteUrl: url},
        }
      }
      throw new Error(`target history unavailable from ${url}`)
    }

    async getDiffBetween({url, baseCommitHash, headCommitHash}: any) {
      return {baseCommitHash, headCommitHash, changes: [], source: {remoteUrl: url}}
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
  smartInitializeRepoUtil: smartInitializeMock,
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("PR review recovery attempts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMode.failAllTargets = false
    historySignals.length = 0
    naturalMode.blockHistory = false
    naturalMode.missingFilterHistory = false
    naturalMode.successfulReview = false
    clearUrlPreferenceCache()
  })

  it("does not start clone-backed recovery after generic natural-read failures", async () => {
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

    expect(result).toMatchObject({success: false})
    expect(result.error).toContain("without missing-filter capability evidence")
    expect(result.sourceAttempts).toEqual(
      expect.arrayContaining([expect.objectContaining({url: sourceUrls[0], success: true})]),
    )
    expect(result.targetAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({url: targetUrls[0], success: false}),
        expect.objectContaining({url: targetUrls[1], success: false}),
      ]),
    )
    expect(smartInitializeMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reviewMock).not.toHaveBeenCalled()
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
      expect.arrayContaining([expect.objectContaining({url: sourceUrls[0], success: true})]),
    )
    expect(result.targetAttempts).toEqual(
      expect.arrayContaining([expect.objectContaining({url: targetUrls[1], success: false})]),
    )
    expect(smartInitializeMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("scopes allowed clone recovery to the active remote with capability evidence", async () => {
    naturalMode.missingFilterHistory = true
    const urls = ["https://primary.example/repo.git", "https://secondary.example/repo.git"]

    const result = await exposed.getPRReviewData({
      repoId: "owner/capability-recovery",
      tipCommitOid: "a".repeat(40),
      targetCommitOid: "b".repeat(40),
      targetBranch: "main",
      cloneUrls: urls,
    })

    expect(result.success).toBe(false)
    expect(smartInitializeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        cloneUrls: [urls[1]],
        strictCloneUrls: true,
        trackReadPreference: false,
      }),
      expect.anything(),
      expect.anything(),
    )
    expect(fetchMock.mock.calls.every(([params]) => params.url === urls[1])).toBe(true)
    expect(getCachedUrlPreference("owner/capability-recovery")).toMatchObject({
      preferredUrl: urls[1],
      lastSuccessAt: 0,
    })
  })

  it("cancels one composite natural review without affecting its replacement", async () => {
    naturalMode.blockHistory = true
    const oldOperationId = "pr-review:old"
    const oldReview = exposed.getPRReviewData({
      repoId: "owner/cancelled-review",
      tipCommitOid: "a".repeat(40),
      targetCommitOid: "b".repeat(40),
      targetBranch: "main",
      cloneUrls: ["https://target.example/repo.git"],
      prCloneUrls: ["https://source.example/repo.git"],
      operationId: oldOperationId,
    })
    await vi.waitFor(() => expect(historySignals).toHaveLength(1))
    expect(exposed.cancelGitNaturalRead({operationId: oldOperationId})).toBe(true)

    await expect(oldReview).resolves.toMatchObject({
      success: false,
      code: "operation-aborted",
    })
    expect(historySignals[0].aborted).toBe(true)
    expect(smartInitializeMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    naturalMode.blockHistory = false
    naturalMode.successfulReview = true
    await expect(
      exposed.getPRReviewData({
        repoId: "owner/cancelled-review",
        tipCommitOid: "a".repeat(40),
        targetCommitOid: "b".repeat(40),
        targetBranch: "main",
        cloneUrls: ["https://target.example/repo.git"],
        prCloneUrls: ["https://source.example/repo.git"],
        operationId: "pr-review:replacement",
      }),
    ).resolves.toMatchObject({success: true})
    expect(historySignals.slice(1).every(signal => !signal.aborted)).toBe(true)
  })

  it("honors composite PR cancellation before worker read registration", async () => {
    naturalMode.successfulReview = true
    const operationId = "pr-review:cancelled-before-registration"
    expect(exposed.cancelGitNaturalRead({operationId})).toBe(true)

    await expect(
      exposed.getPRReviewData({
        repoId: "owner/pre-cancelled-review",
        tipCommitOid: "a".repeat(40),
        targetCommitOid: "b".repeat(40),
        targetBranch: "main",
        cloneUrls: ["https://target.example/repo.git"],
        prCloneUrls: ["https://source.example/repo.git"],
        operationId,
      }),
    ).resolves.toMatchObject({success: false, code: "operation-aborted"})
    expect(historySignals).toHaveLength(0)
    expect(smartInitializeMock).not.toHaveBeenCalled()
  })
})
