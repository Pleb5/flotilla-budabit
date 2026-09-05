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
})
