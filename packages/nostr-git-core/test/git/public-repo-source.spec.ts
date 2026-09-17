import {afterEach, describe, expect, it, vi} from "vitest"
import {
  inspectPublicRepoSource, parsePublicRepoUrl, PUBLIC_SOURCE_LIMITS,
} from "../../src/git/public-repo-source.js"
import {clearGitHosts, detectVendorFromUrl, registerGitHost} from "../../src/git/vendor-providers.js"
import {getGitServiceApiFromUrl} from "../../src/git/provider-factory.js"
import {ForgejoApi} from "../../src/api/providers/forgejo.js"
import {parsePermalink} from "../../src/git/permalink.js"

const signal = () => new AbortController().signal
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status})
const repo = (host: string, path = "owner/repo") => ({
  id: 42, name: "repo", full_name: path, description: "Source description", private: false,
  default_branch: "trunk", topics: ["nostr"], owner: {login: "owner", type: "User"}, html_url: `https://${host}/${path}`,
  clone_url: `https://${host}/${path}.git`,
})

afterEach(() => { clearGitHosts(); vi.restoreAllMocks(); vi.useRealTimers() })

describe("public repository inspection", () => {
  it.each([
    "https://github.com/owner/repo", "https://github.com/owner/repo.git",
    "https://github.com/owner/repo.git/", "github.com/owner/repo",
    "git@github.com:owner/repo.git", "git@github.com:owner/repo",
    "ssh://git@github.com/owner/repo.git",
  ])("normalizes %s", value => {
    expect(parsePublicRepoUrl(value)).toMatchObject({url: "https://github.com/owner/repo", provider: "github"})
  })

  it.each([
    "https://github.com/o/r/tree/main", "https://codeberg.org/o/r/issues/1",
    "https://gitlab.com/g/r/-/tree/main", "https://github.com/o/r?token=private",
    "https://person:private@github.com/o/r", "https://github.com/o/r#readme",
    "https://github.com/o%2Fx/r", "https://github.com", "file:///o/r", "not a url",
    "https://bitbucket.org/o/r",
  ])("rejects unsupported/unsafe root URL %s", value => {
    expect(() => parsePublicRepoUrl(value)).toThrow()
  })

  it("does not infer providers from lookalike domains or paths", () => {
    for (const url of ["https://github.com.evil.test/o/r", "https://example.com/github.com/repo", "https://notgitea.test/o/r"])
      expect(detectVendorFromUrl(url)).toBe("generic")
    expect(detectVendorFromUrl("https://codeberg.org/o/r")).toBe("forgejo")
  })

  it.each(["github.com", "gitea.example.org", "codeberg.org", "forgejo.example.org"])(
    "retrieves anonymous metadata from %s", async host => {
      const fetcher = vi.fn().mockResolvedValue(json(repo(host)))
      const result = await inspectPublicRepoSource(`https://${host}/owner/repo.git`, signal(), {fetcher})
      expect(result).toMatchObject({name: "repo", description: "Source description", defaultBranch: "trunk", topics: ["nostr"], empty: false})
      expect(fetcher).toHaveBeenCalledTimes(1)
      const init = fetcher.mock.calls[0][1]
      expect(init).toMatchObject({credentials: "omit", redirect: "error", headers: {Accept: "application/json"}})
      expect(new Headers(init.headers).has("authorization")).toBe(false)
      expect(fetcher.mock.calls[0][0]).not.toMatch(/issues|pulls|comments/)
    },
  )

  it("encodes the whole GitLab namespace without losing subgroups", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({
      ...repo("gitlab.com", "group/sub/repo"), visibility: "public", path_with_namespace: "group/sub/repo",
      web_url: "https://gitlab.com/group/sub/repo", http_url_to_repo: "https://gitlab.com/group/sub/repo.git",
    }))
    const source = await inspectPublicRepoSource("https://gitlab.com/group/sub/repo", signal(), {fetcher})
    expect(source.owner).toBe("group/sub")
    expect(fetcher.mock.calls[0][0]).toBe("https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo")
  })

  it("discovers custom Forgejo anonymously and shares that host with API factories", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({version: "15.0.0+gitea-1.22.0"}))
      .mockResolvedValueOnce(json(repo("git.example.org:8443")))
    const source = await inspectPublicRepoSource("https://git.example.org:8443/owner/repo", signal(), {fetcher})
    expect(source.provider).toBe("forgejo")
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([
      "https://git.example.org:8443/api/forgejo/v1/version", "https://git.example.org:8443/api/v1/repos/owner/repo",
    ])
    expect(getGitServiceApiFromUrl(source.url, "")).toBeInstanceOf(ForgejoApi)
  })

  it("falls back to Gitea version discovery, not token inference", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({version: "1.24.1"})).mockResolvedValueOnce(json(repo("git.example.org")))
    expect((await inspectPublicRepoSource("https://git.example.org/owner/repo", signal(), {fetcher})).provider).toBe("gitea")
  })

  it("allows explicit self-hosted GitLab selection when version discovery is unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({
      id: "project", name: "repo", visibility: "public", path_with_namespace: "group/repo",
      web_url: "https://git.example.org/group/repo", http_url_to_repo: "https://git.example.org/group/repo.git", default_branch: "main",
    }))
    expect((await inspectPublicRepoSource("https://git.example.org/group/repo", signal(), {fetcher, provider: "gitlab"})).provider).toBe("gitlab")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([401, 404, 403, 429, 500])("explains HTTP %i without exposing response bodies", async status => {
    const fetcher = vi.fn().mockResolvedValue(json({secret: "never echo"}, status))
    await expect(inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher}))
      .rejects.toThrow(status === 401 || status === 404 ? /not found or not publicly/ : status === 403 || status === 429 ? /rate-limited/ : /HTTP 500/)
  })

  it("rejects private repositories and mismatched source URLs", async () => {
    for (const data of [{...repo("github.com"), private: true}, {...repo("github.com"), clone_url: "https://other.example/owner/repo.git"}]) {
      await expect(inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher: vi.fn().mockResolvedValue(json(data))})).rejects.toThrow()
    }
  })

  it("keeps large or empty repositories available to announcement-only", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({...repo("github.com"), default_branch: null, size: 900_000}))
    const result = await inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher})
    expect(result).toMatchObject({empty: true, defaultBranch: "", sizeKiB: 900_000})
  })

  it("bounds consumed JSON and sanitizes network failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(json("x".repeat(PUBLIC_SOURCE_LIMITS.responseBytes)))
    await expect(inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher})).rejects.toThrow(/response limit/)
    fetcher.mockRejectedValue(new Error("https://private:credential@internal/"))
    await expect(inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher})).rejects.toThrow(/browser\/API access/)
  })

  it("does not fetch after cancellation", async () => {
    const abort = new AbortController()
    abort.abort()
    const fetcher = vi.fn()
    await expect(inspectPublicRepoSource("https://github.com/owner/repo", abort.signal, {fetcher})).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("aborts a running request at the public metadata deadline", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
    }))
    const request = inspectPublicRepoSource("https://github.com/owner/repo", signal(), {fetcher})
    const assertion = expect(request).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(PUBLIC_SOURCE_LIMITS.requestMs)
    await assertion
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it("uses the compatible Forgejo API for metadata and a custom host for destinations", async () => {
    registerGitHost("git.example.org:8443", "forgejo")
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(repo("git.example.org:8443")))
    const api = getGitServiceApiFromUrl("https://git.example.org:8443/owner/repo", "destination-token")
    await api.createRepo({name: "repo", autoInit: false})
    expect(fetcher).toHaveBeenCalledWith("https://git.example.org:8443/api/v1/user/repos", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({Authorization: "token destination-token"}),
    }))
    expect(parsePermalink("https://codeberg.org/owner/repo/src/commit/abc/file.ts#L2")?.platform).toBe("forgejo")
  })
})
