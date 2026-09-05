import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

import {
  getCachedUrlPreference,
  updateUrlPreferenceCache,
} from "../../src/utils/clone-url-fallback.js"

let exposed: any

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    listRemotes: vi.fn(async () => []),
  }),
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("resetRepoToRemote read cursor", () => {
  it("clears the worker cursor even when no local origin exists", async () => {
    const repoId = "owner/reset-cursor"
    const primary = "https://primary.example/repo.git"
    const secondary = "https://secondary.example/repo.git"
    updateUrlPreferenceCache(repoId, secondary, [primary])

    const result = await exposed.resetRepoToRemote({repoId, branch: "main"})

    expect(result).toMatchObject({success: true, skipped: "no-origin"})
    expect(getCachedUrlPreference(repoId)).toBeUndefined()
  })
})
