import {describe, expect, it, vi} from "vitest"

vi.mock("@nostr-git/core", () => ({
  getGitServiceApi: vi.fn(),
  parseRepoUrl: vi.fn(),
  filterValidCloneUrls: vi.fn((urls: string[]) => urls),
  reorderUrlsByPreference: vi.fn((urls: string[], _repoId?: string) => urls),
  hasRestApiSupport: vi.fn(
    (url: string) => url.includes("github.com") || url.includes("gitlab.com"),
  ),
}))

describe("commit-api", () => {
  it("returns null when no clone URLs provided", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi([], "abc123")

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith("[commit-api] No clone URLs provided")

    consoleSpy.mockRestore()
  })

  it("returns commit details when REST API succeeds", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const {getGitServiceApi, parseRepoUrl} = await import("@nostr-git/core")
    vi.mocked(parseRepoUrl).mockReturnValue({
      owner: "user",
      repo: "repo",
      provider: "github",
    } as any)
    vi.mocked(getGitServiceApi).mockReturnValue({
      getCommit: vi.fn().mockResolvedValue({
        sha: "abc123",
        author: {name: "Alice", email: "alice@example.com", date: "2024-01-15T10:00:00Z"},
        message: "feat: add feature",
        parents: [{sha: "parent1"}],
      }),
    } as any)

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi(["https://github.com/user/repo.git"], "abc123")

    expect(result).toMatchObject({
      success: true,
      meta: {
        sha: "abc123",
        author: "Alice",
        email: "alice@example.com",
        message: "feat: add feature",
        parents: ["parent1"],
      },
      changes: [],
      source: "rest-api",
    })

    consoleSpy.mockRestore()
  })

  it("skips URLs without REST API support", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi(["https://example.com/git/repo.git"], "abc123")

    expect(result).toBeNull()

    consoleSpy.mockRestore()
  })

  it("returns null when parseRepoUrl fails for all URLs", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const {parseRepoUrl} = await import("@nostr-git/core")
    vi.mocked(parseRepoUrl).mockReturnValue(null as any)

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi(["https://github.com/user/repo.git"], "abc123")

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
    warnSpy.mockRestore()
  })
})
