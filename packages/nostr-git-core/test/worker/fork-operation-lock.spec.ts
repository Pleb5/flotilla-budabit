import {describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

import {withRepoOperationLock} from "../../src/worker/workers/repo-operation-lock.js"

const {forkAndCloneRepoMock} = vi.hoisted(() => ({
  forkAndCloneRepoMock: vi.fn(async () => ({
    success: true,
    repoId: "target-owner/fork",
    forkUrl: "https://example.com/target-owner/fork.git",
    defaultBranch: "main",
    branches: ["main"],
    tags: [],
  })),
}))
let exposed: any

vi.mock("comlink", () => ({
  expose: (api: any) => {
    exposed = api
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({}),
}))

vi.mock("../../src/worker/workers/repo-management.js", () => ({
  getGitignoreTemplate: vi.fn(),
  getLicenseTemplate: vi.fn(),
  createLocalRepo: vi.fn(),
  createRemoteRepo: vi.fn(),
  forkAndCloneRepo: forkAndCloneRepoMock,
  deleteRemoteRepo: vi.fn(),
  updateRemoteRepoMetadata: vi.fn(),
  updateAndPushFiles: vi.fn(),
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

describe("fork operation locking", () => {
  it("locks the owner/repo fallback even when sourceRepoId identifies another path", async () => {
    let releaseSource!: () => void
    let sourceLocked!: () => void
    const sourceLockReady = new Promise<void>(resolve => {
      sourceLocked = resolve
    })
    const sourceGate = new Promise<void>(resolve => {
      releaseSource = resolve
    })
    const heldSource = withRepoOperationLock("upstream-owner/upstream-repo", async () => {
      sourceLocked()
      await sourceGate
    })
    await sourceLockReady

    const fork = exposed.forkAndCloneRepo({
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "fork",
      visibility: "public",
      token: "token",
      dir: "target-owner/fork",
      sourceRepoId: "event-owner/source",
    })
    await Promise.resolve()
    expect(forkAndCloneRepoMock).not.toHaveBeenCalled()

    releaseSource()
    await Promise.all([heldSource, fork])
    expect(forkAndCloneRepoMock).toHaveBeenCalledOnce()
  })
})
