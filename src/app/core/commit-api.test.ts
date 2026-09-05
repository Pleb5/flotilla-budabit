import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@nostr-git/core", () => ({
  getGitServiceApi: vi.fn(),
  parseRepoUrl: vi.fn(),
  filterValidCloneUrls: vi.fn((urls: string[]) => urls),
  orderReadUrlsByPreference: vi.fn((urls: string[], _repoId?: string) => urls),
  withUrlFallback: vi.fn(async (urls: string[], operation: (url: string) => Promise<unknown>) => {
    const attempts: any[] = []
    for (const url of urls) {
      try {
        const result = await operation(url)
        attempts.push({url, success: true, result})
        return {success: true, result, usedUrl: url, attempts}
      } catch (error) {
        attempts.push({
          url,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: (error as any)?.code || (error as any)?.name,
        })
      }
    }
    return {success: false, attempts}
  }),
  hasRestApiSupport: vi.fn((url: string) => url.includes("github.com") || url.includes("gitlab.")),
}))

describe("commit-api", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when no clone URLs provided", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi([], "abc123")

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith("[commit-api] No clone URLs provided")

    consoleSpy.mockRestore()
  })

  it("retries commit metadata and diff together on the next remote", async () => {
    const primary = "https://relay.example/repo.git"
    const secondary = "https://github.com/user/repo.git"
    const callOrder: string[] = []
    const smartInitializeRepo = vi.fn()
    const getCommitDetails = vi.fn()
    const sameRemoteFallback = vi.fn()
    const worker = {
      gitNaturalGetCommit: vi.fn(async ({url}: {url: string}) => {
        callOrder.push(`meta:${url}`)
        return {
          commit: {
            hash: "head",
            author: {name: "Alice", email: "alice@example.com", timestamp: 1},
            message: "Change",
            parents: ["parent"],
          },
        }
      }),
      gitNaturalGetDiffBetween: vi.fn(async ({url}: {url: string}) => {
        callOrder.push(`diff:${url}`)
        if (url === primary) throw new Error("pack parser failed")
        return {changes: [{path: "README.md", diffHunks: []}]}
      }),
      smartInitializeRepo,
      getCommitDetails,
    }

    const {getCommitDetailsViaGitNatural} = await import("./commit-api")
    const result = await getCommitDetailsViaGitNatural(
      worker,
      [primary, secondary],
      "head",
      "owner/repo",
      sameRemoteFallback,
    )

    expect(callOrder).toEqual([
      `meta:${primary}`,
      `diff:${primary}`,
      `meta:${secondary}`,
      `diff:${secondary}`,
    ])
    expect(result).toMatchObject({
      success: true,
      source: "git-natural",
      remoteUrl: secondary,
      diffAvailable: true,
      changes: [{path: "README.md"}],
    })
    expect(smartInitializeRepo).not.toHaveBeenCalled()
    expect(getCommitDetails).not.toHaveBeenCalled()
    expect(sameRemoteFallback).not.toHaveBeenCalled()
    expect(worker.gitNaturalGetCommit).toHaveBeenCalledWith(
      expect.objectContaining({timeoutMs: 15_000}),
    )
    expect(worker.gitNaturalGetDiffBetween).toHaveBeenCalledWith(
      expect.not.objectContaining({timeoutMs: expect.anything()}),
    )
  })

  it("returns metadata-only only after every natural diff attempt fails", async () => {
    const urls = ["https://primary.example/repo.git", "https://secondary.example/repo.git"]
    const worker = {
      gitNaturalGetCommit: vi.fn(async ({url}: {url: string}) => ({
        commit: {
          hash: url.includes("primary") ? "primary-head" : "secondary-head",
          author: {name: "Alice", email: "alice@example.com", timestamp: 1},
          message: "Change",
          parents: ["parent"],
        },
      })),
      gitNaturalGetDiffBetween: vi.fn(async () => {
        throw new Error("pack parser failed")
      }),
    }

    const {getCommitDetailsViaGitNatural} = await import("./commit-api")
    const result = await getCommitDetailsViaGitNatural(worker, urls, "head", "owner/repo")

    expect(worker.gitNaturalGetCommit).toHaveBeenCalledTimes(2)
    expect(worker.gitNaturalGetDiffBetween).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      success: true,
      meta: {sha: "secondary-head"},
      changes: [],
      diffAvailable: false,
    })
    expect(result?.fallbackReason).toBeUndefined()
    expect(result?.remoteUrl).toBeUndefined()
  })

  it("advances after a same-remote missing-filter fallback fails", async () => {
    const primary = "https://primary.example/repo.git"
    const secondary = "https://secondary.example/repo.git"
    const callOrder: string[] = []
    const worker = {
      gitNaturalGetCommit: vi.fn(async ({url}: {url: string}) => {
        callOrder.push(`meta:${url}`)
        return {
          commit: {
            hash: "head",
            author: {name: "Alice", email: "alice@example.com", timestamp: 1},
            message: "Change",
            parents: ["parent"],
          },
        }
      }),
      gitNaturalGetDiffBetween: vi.fn(async ({url}: {url: string}) => {
        callOrder.push(`diff:${url}`)
        if (url === primary) {
          const error = new Error("filter unsupported") as Error & {code: string}
          error.code = "missing-filter-capability"
          throw error
        }
        return {changes: []}
      }),
    }
    const sameRemoteFallback = vi.fn(async (url: string) => {
      callOrder.push(`clone:${url}`)
      return {success: false, error: "clone failed"}
    })

    const {getCommitDetailsViaGitNatural} = await import("./commit-api")
    const result = await getCommitDetailsViaGitNatural(
      worker,
      [primary, secondary],
      "head",
      "owner/repo",
      sameRemoteFallback,
    )

    expect(callOrder).toEqual([
      `meta:${primary}`,
      `diff:${primary}`,
      `clone:${primary}`,
      `meta:${secondary}`,
      `diff:${secondary}`,
    ])
    expect(result).toMatchObject({success: true, remoteUrl: secondary, diffAvailable: true})
  })

  it("authorizes clone fallback only for explicit missing filter support", async () => {
    const remoteUrl = "https://example.com/repo.git"
    const worker = {
      gitNaturalGetCommit: vi.fn(async () => ({
        commit: {
          hash: "head",
          author: {name: "Alice", email: "alice@example.com", timestamp: 1},
          message: "Change",
          parents: ["parent"],
        },
      })),
      gitNaturalGetDiffBetween: vi.fn(async () => {
        const error = new Error("Git server does not advertise filter support") as Error & {
          code: string
        }
        error.code = "missing-filter-capability"
        throw error
      }),
    }

    const {getCommitDetailsViaGitNatural} = await import("./commit-api")
    const result = await getCommitDetailsViaGitNatural(worker, [remoteUrl], "head", "owner/repo")

    expect(result).toMatchObject({
      success: true,
      diffAvailable: false,
      fallbackReason: "missing-filter-capability",
      fallbackUrl: remoteUrl,
    })
  })

  it("returns commit details when REST API succeeds", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const {getGitServiceApi, parseRepoUrl} = await import("@nostr-git/core")
    vi.mocked(parseRepoUrl).mockReturnValue({
      owner: "user",
      repo: "repo",
      host: "github.com",
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

  it("passes self-hosted REST API base URLs to the provider", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const {getGitServiceApi, parseRepoUrl} = await import("@nostr-git/core")
    vi.mocked(parseRepoUrl).mockReturnValue({
      owner: "group/subgroup",
      repo: "repo",
      host: "gitlab.example.com",
      provider: "gitlab",
    } as any)
    vi.mocked(getGitServiceApi).mockReturnValue({
      getCommit: vi.fn().mockResolvedValue({
        sha: "abc123",
        author: {name: "Alice", email: "alice@example.com", date: "2024-01-15T10:00:00Z"},
        message: "fix: self hosted",
        parents: [],
      }),
    } as any)

    const {getCommitDetailsViaRestApi} = await import("./commit-api")
    const result = await getCommitDetailsViaRestApi(
      ["https://gitlab.example.com/group/subgroup/repo.git"],
      "abc123",
    )

    expect(result?.success).toBe(true)
    expect(getGitServiceApi).toHaveBeenCalledWith("gitlab", "", "https://gitlab.example.com/api/v4")

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
