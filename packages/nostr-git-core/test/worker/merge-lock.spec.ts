import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

let exposed: any
const safePushToRemoteUtil = vi.fn(async () => ({success: true}))

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({}),
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: () => ({promises: {}}),
  isRepoClonedFs: async () => true,
}))

vi.mock("../../src/worker/workers/push.js", () => ({
  safePushToRemoteUtil,
  validateExplicitGraspPush: vi.fn(),
}))

vi.mock("../../src/worker/workers/pr-merge.js", () => ({
  analyzePRMergeUtil: vi.fn(),
  mergePRAndPushUtil: vi.fn(async (_git: any, opts: any, deps: any) => {
    return await deps.safePushToRemote({
      repoId: opts.repoId,
      remoteUrl: "https://github.com/owner/repo.git",
      branch: "main",
      provider: "github",
    })
  }),
}))

await import("../../src/worker/worker.js")

describe("worker merge repository lock", () => {
  it("does not reacquire its repository lock through the safe-push callback", async () => {
    const result = await Promise.race([
      exposed.mergePRAndPush({
        repoId: "owner/repo",
        cloneUrls: ["https://github.com/owner/repo.git"],
        tipCommitOid: "a".repeat(40),
      }),
      new Promise(resolve => setTimeout(() => resolve({timeout: true}), 1000)),
    ])

    expect(result).toEqual({success: true})
    expect(safePushToRemoteUtil).toHaveBeenCalledOnce()
  })
})
