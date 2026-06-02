import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"
import "fake-indexeddb/auto"
import {GitHubApi} from "../../../src/api/providers/github.js"

const makeFetchOk = (json: any) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => json,
    text: async () => JSON.stringify(json),
  })
const makeFetchErr = (status = 404, text = "Not Found") =>
  vi.fn().mockResolvedValue({ok: false, status, text: async () => text})

describe("GitHubApi request/shape mapping", () => {
  const token = "t0k"
  const owner = "octo"
  const repo = "hello"

  const sampleRepo = {
    id: 123,
    name: repo,
    full_name: `${owner}/${repo}`,
    description: "desc",
    default_branch: "main",
    private: true,
    clone_url: "https://github.com/octo/hello.git",
    html_url: "https://github.com/octo/hello",
    owner: {login: owner, type: "User"},
  }

  let origFetch: any
  beforeEach(() => {
    origFetch = globalThis.fetch
  })

  it("getFileContent success maps fields and passes ref param", async () => {
    const payload = {content: "YmFzZTY0", encoding: "base64", sha: "abc"}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getFileContent(owner, repo, "path.txt", "main")
    expect(out).toEqual(payload)
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toMatch(/\/contents\/path.txt\?/)
    expect(url).toMatch(/ref=main/)
  })

  it("mergePullRequest performs PUT then GETs PR and returns mapped PR", async () => {
    const mergeOk = {merged: true, sha: "deadbeef"}
    const prPayload = {
      id: 7,
      number: 7,
      title: "t",
      body: "",
      state: "open",
      merged: true,
      user: {login: "octo", avatar_url: "a"},
      head: {ref: "feat", sha: "h", repo: {name: repo, owner: {login: owner}}},
      base: {ref: "main", sha: "b", repo: {name: repo, owner: {login: owner}}},
      mergeable: true,
      merged_at: "now",
      created_at: "c",
      updated_at: "u",
      url: "u",
      html_url: "h",
      diff_url: "d",
      patch_url: "p",
    }
    const fetchMock = vi
      .fn()
      // PUT merge
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mergeOk,
        text: async () => JSON.stringify(mergeOk),
      })
      // GET PR
      .mockResolvedValueOnce({
        ok: true,
        json: async () => prPayload,
        text: async () => JSON.stringify(prPayload),
      })
    globalThis.fetch = fetchMock as any
    const api = new GitHubApi(token)
    const out = await api.mergePullRequest(owner, repo, 7, {mergeMethod: "squash"})
    expect(out.number).toBe(7)
    // First call is PUT
    const firstInit = (globalThis.fetch as any).mock.calls[0][1]
    expect(firstInit.method).toBe("PUT")
    // Second call is GET PR
    const secondUrl = (globalThis.fetch as any).mock.calls[1][0]
    expect(String(secondUrl)).toMatch(/\/repos\/octo\/hello\/pulls\/7$/)
  })

  it("mergePullRequest propagates error text when merge PUT fails", async () => {
    globalThis.fetch = makeFetchErr(409, "conflict") as any
    const api = new GitHubApi(token)
    await expect(api.mergePullRequest(owner, repo, 1)).rejects.toThrow(
      /GitHub API error 409: conflict/,
    )
  })

  it("getCommit propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(500, "boom") as any
    const api = new GitHubApi(token)
    await expect(api.getCommit(owner, repo, "badsha")).rejects.toThrow(/GitHub API error 500: boom/)
  })

  it("listCommits propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(404, "nope") as any
    const api = new GitHubApi(token)
    await expect(api.listCommits(owner, repo, {sha: "main"})).rejects.toThrow(
      /GitHub API error 404: nope/,
    )
  })

  it("getCommit maps author/committer, parents and stats", async () => {
    const payload = {
      sha: "c1",
      commit: {
        message: "m",
        author: {name: "A", email: "a@e", date: "2020-01-01"},
        committer: {name: "C", email: "c@e", date: "2020-01-01"},
      },
      parents: [{sha: "p1", url: "pu1"}],
      url: "u",
      html_url: "h",
      stats: {additions: 1, deletions: 2, total: 3},
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getCommit(owner, repo, "c1")
    expect(out.sha).toBe("c1")
    expect(out.author?.name).toBe("A")
    expect(out.committer?.name).toBe("C")
    expect(out.parents?.[0].sha).toBe("p1")
    expect(out.stats?.additions).toBe(1)
  })

  it("listCommits maps array of commits and passes sha/per_page params", async () => {
    const payload = [
      {
        sha: "c1",
        commit: {
          message: "m",
          author: {name: "A", email: "a@e", date: "2020-01-01"},
          committer: {name: "C", email: "c@e", date: "2020-01-01"},
        },
        parents: [{sha: "p1", url: "pu1"}],
        url: "u",
        html_url: "h",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.listCommits(owner, repo, {sha: "main", per_page: 1})
    expect(out[0].sha).toBe("c1")
    expect(out[0].parents?.[0].sha).toBe("p1")
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toMatch(/\/commits\?/)
    expect(url).toMatch(/(sha=main&per_page=1|per_page=1&sha=main)/)
  })

  it("getTag maps release tag fields to tag object", async () => {
    const payload = {
      tag_name: "v1.2.3",
      target_commitish: "deadbeef",
      zipball_url: "z",
      tarball_url: "t",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getTag(owner, repo, "v1.2.3")
    expect(out).toMatchObject({
      name: "v1.2.3",
      commit: {sha: "deadbeef"},
      zipballUrl: "z",
      tarballUrl: "t",
    })
  })

  it("closeIssue delegates to updateIssue (PATCH) and returns mapped issue", async () => {
    const payload = {
      id: 5,
      number: 5,
      title: "x",
      body: "",
      state: "closed",
      user: {login: "alice", avatar_url: "a"},
      assignees: [],
      labels: [],
      created_at: "c",
      updated_at: "u",
      closed_at: "cl",
      url: "u",
      html_url: "h",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.closeIssue(owner, repo, 5)
    expect(out.state).toBe("closed")
    // Verify PATCH method used in the call frame
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.method).toBe("PATCH")
  })
  afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it("getRepo maps fields and sends auth headers", async () => {
    globalThis.fetch = makeFetchOk(sampleRepo) as any
    const api = new GitHubApi(token)
    const data = await api.getRepo(owner, repo)
    expect(data.id).toBe(String(sampleRepo.id))
    expect(data.defaultBranch).toBe("main")
    expect(data.isPrivate).toBe(true)
    // header verification
    expect((globalThis.fetch as any).mock.calls[0][0]).toMatch("/repos/octo/hello")
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.headers.Authorization).toBe(`token ${token}`)
    expect(init.headers.Accept).toContain("github")
  })

  it("checkExistingFork finds an existing renamed fork for the authenticated user", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          ...sampleRepo,
          name: "hello-fork",
          full_name: `${owner}/hello-fork`,
          clone_url: `https://github.com/${owner}/hello-fork.git`,
          html_url: `https://github.com/${owner}/hello-fork`,
          fork: true,
          parent: {full_name: `${owner}/${repo}`},
          source: {full_name: `${owner}/${repo}`},
        },
      ],
      text: async () =>
        JSON.stringify([
          {
            ...sampleRepo,
            name: "hello-fork",
            full_name: `${owner}/hello-fork`,
            clone_url: `https://github.com/${owner}/hello-fork.git`,
            html_url: `https://github.com/${owner}/hello-fork`,
            fork: true,
            parent: {full_name: `${owner}/${repo}`},
            source: {full_name: `${owner}/${repo}`},
          },
        ]),
    })
    globalThis.fetch = fetchMock as any

    const api = new GitHubApi(token)
    const existingFork = await api.checkExistingFork(owner, repo)

    expect(existingFork?.name).toBe("hello-fork")
    expect((globalThis.fetch as any).mock.calls[0][0]).toMatch(
      /\/user\/repos\?type=owner&per_page=100&page=1$/,
    )
  })

  it("respects baseUrl override", async () => {
    globalThis.fetch = makeFetchOk(sampleRepo) as any
    const api = new GitHubApi(token, "https://example.api")
    await api.getRepo(owner, repo)
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toBe("https://example.api/repos/octo/hello")
  })

  it("propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(500, "boom") as any
    const api = new GitHubApi(token)
    await expect(api.getRepo(owner, repo)).rejects.toThrow(/GitHub API error 500: boom/)
  })

  it("listIssues maps fields including author, assignees, labels", async () => {
    const payload = [
      {
        id: 1,
        number: 7,
        title: "Bug",
        body: "desc",
        state: "open",
        user: {login: "alice", avatar_url: "a.png"},
        assignees: [{login: "bob", avatar_url: "b.png"}],
        labels: [{name: "bug", color: "f00", description: "red"}],
        created_at: "2020-01-01",
        updated_at: "2020-01-02",
        closed_at: null,
        url: "u",
        html_url: "h",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.listIssues(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      id: 1,
      number: 7,
      title: "Bug",
      body: "desc",
      state: "open",
      author: {login: "alice", avatarUrl: "a.png"},
      assignees: [{login: "bob", avatarUrl: "b.png"}],
      labels: [{name: "bug", color: "f00", description: "red"}],
    })
  })

  it("getIssue maps fields and state closed", async () => {
    const payload = {
      id: 2,
      number: 8,
      title: "Closed",
      body: "b",
      state: "closed",
      user: {login: "eve", avatar_url: "e.png"},
      assignees: [],
      labels: [],
      created_at: "2020-02-01",
      updated_at: "2020-02-02",
      closed_at: "2020-02-03",
      url: "u2",
      html_url: "h2",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getIssue(owner, repo, 8)
    expect(out.state).toBe("closed")
    expect(out.number).toBe(8)
    expect(out.htmlUrl).toBe("h2")
  })

  it("listIssues propagates errors", async () => {
    globalThis.fetch = makeFetchErr(502, "bad gateway") as any
    const api = new GitHubApi(token)
    await expect(api.listIssues(owner, repo)).rejects.toThrow(/GitHub API error 502: bad gateway/)
  })

  it("listPullRequests maps state, head/base and urls", async () => {
    const payload = [
      {
        id: 10,
        number: 10,
        title: "PR title",
        body: "body",
        state: "open",
        merged: false,
        user: {login: "alice", avatar_url: "a.png"},
        head: {ref: "feat", sha: "abc", repo: {name: "hello", owner: {login: "octo"}}},
        base: {ref: "main", sha: "def", repo: {name: "hello", owner: {login: "octo"}}},
        mergeable: true,
        merged_at: null,
        created_at: "2020-01-01",
        updated_at: "2020-01-02",
        url: "u",
        html_url: "h",
        diff_url: "d",
        patch_url: "p",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.listPullRequests(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      number: 10,
      state: "open",
      head: {ref: "feat", sha: "abc"},
      base: {ref: "main", sha: "def"},
      url: "u",
      htmlUrl: "h",
      diffUrl: "d",
      patchUrl: "p",
    })
  })

  it("getPullRequest maps merged state", async () => {
    const payload = {
      id: 11,
      number: 11,
      title: "PR2",
      body: "b",
      state: "closed",
      merged: true,
      user: {login: "bob", avatar_url: "b.png"},
      head: {ref: "fix", sha: "111", repo: {name: "hello", owner: {login: "octo"}}},
      base: {ref: "main", sha: "222", repo: {name: "hello", owner: {login: "octo"}}},
      mergeable: true,
      merged_at: "2020-02-02",
      created_at: "2020-02-01",
      updated_at: "2020-02-02",
      url: "u2",
      html_url: "h2",
      diff_url: "d2",
      patch_url: "p2",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getPullRequest(owner, repo, 11)
    expect(out.state).toBe("merged")
    expect(out.merged).toBe(true)
    expect(out.base.ref).toBe("main")
  })

  it("listPullRequests propagates errors", async () => {
    globalThis.fetch = makeFetchErr(500, "oops") as any
    const api = new GitHubApi(token)
    await expect(api.listPullRequests(owner, repo)).rejects.toThrow(/GitHub API error 500: oops/)
  })

  it("createPullRequest propagates errors", async () => {
    globalThis.fetch = makeFetchErr(400, "invalid") as any
    const api = new GitHubApi(token)
    await expect(
      api.createPullRequest(owner, repo, {title: "t", body: "b", head: "h", base: "m"}),
    ).rejects.toThrow(/GitHub API error 400: invalid/)
  })

  it("getFileContent propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(404, "nope") as any
    const api = new GitHubApi(token)
    await expect(api.getFileContent(owner, repo, "missing.txt")).rejects.toThrow(
      /GitHub API error 404: nope/,
    )
  })

  it("listBranches maps name and commit.sha", async () => {
    const payload = [{name: "main", commit: {sha: "abc", url: "u"}}]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.listBranches(owner, repo)
    expect(out[0]).toMatchObject({name: "main", commit: {sha: "abc"}})
  })

  it("getBranch encodes slash-containing branch names", async () => {
    const branch = "feature/with-slash"
    const payload = {name: branch, protected: false, commit: {sha: "abc", url: "u"}}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.getBranch(owner, repo, branch)
    expect(out).toEqual({name: branch, protected: false, commit: {sha: "abc", url: "u"}})
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toContain("/repos/octo/hello/branches/feature%2Fwith-slash")
  })

  it("listTags maps name and commit.sha", async () => {
    const payload = [{name: "v1.0.0", commit: {sha: "t1", url: "u"}}]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitHubApi(token)
    const out = await api.listTags(owner, repo)
    expect(out[0]).toMatchObject({name: "v1.0.0", commit: {sha: "t1"}})
  })
})
