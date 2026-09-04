import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

let exposed: any
const targetOid = "b".repeat(40)

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    addRemote: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    fetch: vi.fn(async () => ({fetchHead: targetOid})),
    resolveRef: vi.fn(async () => targetOid),
    findMergeBase: vi.fn(async () => []),
  }),
}))

vi.mock("../../src/git/natural-read-provider.js", () => ({
  GitNaturalReadProvider: class {
    async resolveRef({url, ref}: {url: string; ref: string}) {
      return {
        requestedRef: ref,
        resolvedRef: `refs/heads/${ref}`,
        commitHash: targetOid,
        source: {remoteUrl: url},
      }
    }

    async listCommits({url}: {url: string}) {
      throw new Error(`history unavailable from ${url}`)
    }
  },
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("worker composite read attempts", () => {
  it("returns terminal Git-natural source attempts after local merge-base fallback", async () => {
    const sourceUrls = [
      "https://source-primary.example/repo.git",
      "https://source-secondary.example/repo.git",
    ]
    const result = await exposed.getMergeBaseBetween({
      repoId: "owner/repo",
      headOid: "a".repeat(40),
      targetBranch: "main",
      cloneUrls: ["https://target.example/repo.git"],
      sourceCloneUrls: sourceUrls,
      sourceReadScope: "pr-source:event",
    })

    expect(result.sourceAttempts).toEqual(
      sourceUrls.map(url =>
        expect.objectContaining({
          url,
          success: false,
          error: expect.stringContaining("history unavailable"),
        }),
      ),
    )
  })
})
