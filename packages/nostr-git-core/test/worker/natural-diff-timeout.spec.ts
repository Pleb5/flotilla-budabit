import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

let exposed: any

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/natural-read-provider.js", () => ({
  GitNaturalReadProvider: class {
    async listDirectory({url}: {url: string}) {
      await new Promise(resolve => setTimeout(resolve, 16_001))
      return {entries: [], source: {remoteUrl: url}}
    }

    async getFileContent({url}: {url: string}) {
      await new Promise(resolve => setTimeout(resolve, 16_001))
      return {content: "", source: {remoteUrl: url}}
    }

    async listCommits({url}: {url: string}) {
      await new Promise(resolve => setTimeout(resolve, 16_001))
      return {commits: [], source: {remoteUrl: url}}
    }

    async getDiffBetween({url}: {url: string}) {
      await new Promise(resolve => setTimeout(resolve, 16_001))
      return {changes: [], source: {remoteUrl: url}}
    }
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

await import("../../src/worker/worker.js")

describe("Git-natural diff worker timeout", () => {
  it("does not apply a whole-operation timeout to a progressing diff", async () => {
    vi.useFakeTimers()
    const resultPromise = exposed.gitNaturalGetDiffBetween({
      url: "https://example.com/repo.git",
      baseCommitHash: "a".repeat(40),
      headCommitHash: "b".repeat(40),
      enabled: true,
      timeoutMs: 15_000,
    })
    await vi.advanceTimersByTimeAsync(16_001)
    const result = await resultPromise
    vi.useRealTimers()

    expect(result).toEqual({
      changes: [],
      source: {remoteUrl: "https://example.com/repo.git"},
    })
  })

  it.each([
    ["gitNaturalListDirectory", {ref: "main", path: ""}, "entries"],
    ["gitNaturalGetFileContent", {ref: "main", path: "README.md"}, "content"],
    ["gitNaturalListCommits", {ref: "main", depth: 30}, "commits"],
  ])("does not impose an aggregate deadline on %s", async (operation, params, resultKey) => {
    vi.useFakeTimers()
    try {
      const resultPromise = exposed[operation]({
        url: "https://example.com/repo.git",
        enabled: true,
        timeoutMs: 15_000,
        ...params,
      })
      await vi.advanceTimersByTimeAsync(16_001)
      const result = await resultPromise
      expect(result).toHaveProperty(resultKey)
    } finally {
      vi.useRealTimers()
    }
  })
})
