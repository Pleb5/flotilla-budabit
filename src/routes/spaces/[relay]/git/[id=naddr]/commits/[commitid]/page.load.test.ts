import {describe, expect, it, vi} from "vitest"

vi.mock("@src/lib/budabit/worker-singleton", () => ({
  getInitializedGitWorker: vi.fn(),
}))

vi.mock("@nostr-git/core/utils", () => ({
  parseRepoId: vi.fn((id: string) => (id ? id.replace(":", "/") : id)),
}))

const mkLoadEvent = (params: {commitid: string}, parentData: {repoId?: string}) =>
  ({
    params,
    data: null,
    route: {},
    url: new URL("https://example.com"),
    fetch: () => Promise.resolve(new Response()),
    setHeaders: () => {},
    parent: () => Promise.resolve(parentData),
    depends: () => {},
    untrack: (fn: () => void) => fn(),
    tracing: {},
  }) as any

describe("commits [commitid] page load", () => {
  it("returns only commitid when parent has no repoId", async () => {
    const {load} = await import("./+page")
    const result = await load(mkLoadEvent({commitid: "abc123"}, {}))

    expect(result).toEqual({commitid: "abc123"})
  })

  it("returns only commitid when getCommitDetails.success is false", async () => {
    const {getInitializedGitWorker} = await import("@src/lib/budabit/worker-singleton")
    vi.mocked(getInitializedGitWorker).mockResolvedValue({
      api: {getCommitDetails: vi.fn().mockResolvedValue({success: false})},
      worker: {} as Worker,
    })

    const {load} = await import("./+page")
    const result = await load(mkLoadEvent({commitid: "abc123"}, {repoId: "pubkey:repo"}))

    expect(result).toEqual({commitid: "abc123"})
  })

  it("returns commitMeta, changes, and commitid when getCommitDetails succeeds", async () => {
    const mockMeta = {
      sha: "abc123",
      author: "Alice",
      email: "alice@example.com",
      date: "2024-01-15T10:00:00Z",
      message: "feat: add feature",
      parents: [] as string[],
    }
    const mockChanges = [
      {
        path: "src/foo.ts",
        status: "modified" as const,
        diffHunks: [{oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, patches: []}],
      },
    ]

    const {getInitializedGitWorker} = await import("@src/lib/budabit/worker-singleton")
    vi.mocked(getInitializedGitWorker).mockResolvedValue({
      api: {
        getCommitDetails: vi.fn().mockResolvedValue({
          success: true,
          meta: mockMeta,
          changes: mockChanges,
        }),
      },
      worker: {} as Worker,
    })

    const {load} = await import("./+page")
    const result = await load(mkLoadEvent({commitid: "abc123"}, {repoId: "pubkey:repo"}))

    expect(result).toMatchObject({
      commitid: "abc123",
      commitMeta: {
        sha: "abc123",
        author: "Alice",
        email: "alice@example.com",
        date: "2024-01-15T10:00:00Z",
        message: "feat: add feature",
        parents: [],
        pubkey: undefined,
        nip05: undefined,
        nip39: undefined,
      },
      changes: mockChanges,
    })
  })

  it("returns only commitid when getCommitDetails throws", async () => {
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {})

    const {getInitializedGitWorker} = await import("@src/lib/budabit/worker-singleton")
    vi.mocked(getInitializedGitWorker).mockResolvedValue({
      api: {
        getCommitDetails: vi.fn().mockRejectedValue(new Error("Worker error")),
      },
      worker: {} as Worker,
    })

    const {load} = await import("./+page")
    const result = await load(mkLoadEvent({commitid: "abc123"}, {repoId: "pubkey:repo"}))

    expect(result).toEqual({commitid: "abc123"})
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[commit/+page.ts]"),
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it("calls getCommitDetails with canonical repoId from parseRepoId", async () => {
    const {parseRepoId} = await import("@nostr-git/core/utils")
    vi.mocked(parseRepoId).mockReturnValue("pubkey/repo")

    const getCommitDetails = vi.fn().mockResolvedValue({
      success: true,
      meta: {
        sha: "abc",
        author: "A",
        email: "e@x.com",
        date: "2024-01-01",
        message: "msg",
        parents: [],
      },
      changes: [],
    })

    const {getInitializedGitWorker} = await import("@src/lib/budabit/worker-singleton")
    vi.mocked(getInitializedGitWorker).mockResolvedValue({
      api: {getCommitDetails},
      worker: {} as Worker,
    })

    const {load} = await import("./+page")
    await load(mkLoadEvent({commitid: "commit-xyz"}, {repoId: "pubkey:repo"}))

    expect(parseRepoId).toHaveBeenCalledWith("pubkey:repo")
    expect(getCommitDetails).toHaveBeenCalledWith({
      repoId: "pubkey/repo",
      commitId: "commit-xyz",
    })
  })
})
