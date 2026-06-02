import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"
import "fake-indexeddb/auto"
import {GitLabApi} from "../../../src/api/providers/gitlab.js"

const makeFetchOk = (json: any) =>
  vi
    .fn()
    .mockResolvedValue({ok: true, json: async () => json, text: async () => JSON.stringify(json)})
const makeFetchErr = (status = 404, text = "Not Found") =>
  vi.fn().mockResolvedValue({ok: false, status, text: async () => text})

describe("GitLabApi request/shape mapping", () => {
  const token = "gl_token"
  const owner = "group"
  const repo = "app"

  const project = {
    id: 777,
    name: repo,
    path_with_namespace: `${owner}/${repo}`,
    description: "desc",
    default_branch: "main",
    visibility: "private",
    http_url_to_repo: "https://gitlab.com/group/app.git",
    web_url: "https://gitlab.com/group/app",
    namespace: {path: owner, kind: "group"},
  }

  let origFetch: any
  beforeEach(() => {
    origFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it("getRepo maps fields and sends Bearer auth; respects baseUrl", async () => {
    globalThis.fetch = makeFetchOk(project) as any
    const api = new GitLabApi(token, "https://gitlab.example/api/v4")
    const data = await api.getRepo(owner, repo)
    expect(data.id).toBe(String(project.id))
    expect(data.fullName).toBe(project.path_with_namespace)
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toBe(
      "https://gitlab.example/api/v4/projects/" + encodeURIComponent(`${owner}/${repo}`),
    )
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.headers.Authorization).toBe(`Bearer ${token}`)
  })

  it("checkExistingFork finds an existing renamed fork in the user namespace", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => project,
        text: async () => JSON.stringify(project),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({id: 1, username: owner}),
        text: async () => JSON.stringify({id: 1, username: owner}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            ...project,
            name: "app-fork",
            path_with_namespace: `${owner}/app-fork`,
            http_url_to_repo: `https://gitlab.com/${owner}/app-fork.git`,
            web_url: `https://gitlab.com/${owner}/app-fork`,
          },
        ],
        text: async () =>
          JSON.stringify([
            {
              ...project,
              name: "app-fork",
              path_with_namespace: `${owner}/app-fork`,
              http_url_to_repo: `https://gitlab.com/${owner}/app-fork.git`,
              web_url: `https://gitlab.com/${owner}/app-fork`,
            },
          ]),
      })
    globalThis.fetch = fetchMock as any

    const api = new GitLabApi(token)
    const existingFork = await api.checkExistingFork(owner, repo)

    expect(existingFork?.name).toBe("app-fork")
    expect((globalThis.fetch as any).mock.calls[2][0]).toMatch(/\/forks\?per_page=100&page=1$/)
  })

  it("omits auth header when token is empty for public reads", async () => {
    globalThis.fetch = makeFetchOk(project) as any
    const api = new GitLabApi("")
    await api.getRepo(owner, repo)
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it("propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(500, "boom") as any
    const api = new GitLabApi(token)
    await expect(api.getRepo(owner, repo)).rejects.toThrow(/GitLab API error 500: boom/)
  })

  it("listBranches maps name and commit id/url", async () => {
    const branches = [
      {name: "main", commit: {id: "abc", web_url: "u1"}},
      {name: "dev", commit: {id: "def", web_url: "u2"}},
    ]
    globalThis.fetch = makeFetchOk(branches) as any
    const api = new GitLabApi(token)
    const out = await api.listBranches(owner, repo)
    expect(out).toEqual([
      {name: "main", commit: {sha: "abc", url: "u1"}},
      {name: "dev", commit: {sha: "def", url: "u2"}},
    ])
  })

  it("getFileContent returns content/encoding/sha (blob_id)", async () => {
    const payload = {content: "Y29udGVudA==", encoding: "base64", blob_id: "sha123"}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitLabApi(token)
    const res = await api.getFileContent(owner, repo, "README.md", "main")
    expect(res.encoding).toBe("base64")
    expect(res.sha).toBe("sha123")
    expect(res.content).toBe("Y29udGVudA==")
  })

  it("getFileContent propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(404, "nope") as any
    const api = new GitLabApi(token)
    await expect(api.getFileContent(owner, repo, "missing.txt")).rejects.toThrow(
      /GitLab API error 404: nope/,
    )
  })

  it("listPullRequests maps state and head/base fields", async () => {
    const payload = [
      {
        iid: 10,
        title: "MR title",
        description: "body",
        state: "opened",
        author: {username: "alice", avatar_url: "a.png"},
        source_branch: "feat",
        sha: "abc",
        source_project_id: 1,
        target_branch: "main",
        target_project_id: 2,
        merge_status: "can_be_merged",
        merged_at: null,
        created_at: "2020-01-01",
        updated_at: "2020-01-02",
        web_url: "https://gitlab.com/g/a/-/merge_requests/10",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitLabApi(token)
    const out = await api.listPullRequests(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      number: 10,
      state: "open",
      head: {ref: "feat", sha: "abc"},
      base: {ref: "main"},
      mergeable: true,
      merged: false,
    })
  })

  it("getPullRequest maps merged state and base fields", async () => {
    const payload = {
      iid: 11,
      title: "MR2",
      description: "d",
      state: "merged",
      author: {username: "bob", avatar_url: "b.png"},
      source_branch: "fix",
      sha: "111",
      source_project_id: 1,
      target_branch: "main",
      target_project_id: 2,
      merge_status: "can_be_merged",
      merged_at: "2020-02-02",
      created_at: "2020-02-01",
      updated_at: "2020-02-02",
      web_url: "w",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitLabApi(token)
    const out = await api.getPullRequest(owner, repo, 11)
    expect(out.merged).toBe(true)
    expect(out.state).toBe("merged")
    expect(out.base.ref).toBe("main")
  })

  it("getPullRequest propagates errors", async () => {
    globalThis.fetch = makeFetchErr(500, "bad") as any
    const api = new GitLabApi(token)
    await expect(api.getPullRequest(owner, repo, 1)).rejects.toThrow(/GitLab API error 500: bad/)
  })

  it("listPullRequests propagates errors", async () => {
    globalThis.fetch = makeFetchErr(502, "bad gateway") as any
    const api = new GitLabApi(token)
    await expect(api.listPullRequests(owner, repo)).rejects.toThrow(
      /GitLab API error 502: bad gateway/,
    )
  })

  it("createPullRequest propagates errors", async () => {
    globalThis.fetch = makeFetchErr(400, "invalid") as any
    const api = new GitLabApi(token)
    await expect(
      api.createPullRequest(owner, repo, {title: "t", body: "b", head: "h", base: "m"}),
    ).rejects.toThrow(/GitLab API error 400: invalid/)
  })

  it("listIssues maps fields including author, assignees and labels", async () => {
    const payload = [
      {
        iid: 3,
        title: "Bug",
        description: "desc",
        state: "opened",
        author: {username: "alice", avatar_url: "a.png"},
        assignees: [{username: "bob", avatar_url: "b.png"}],
        labels: ["bug", "high"],
        created_at: "2020-01-01",
        updated_at: "2020-01-02",
        closed_at: null,
        web_url: "https://gitlab.com/g/a/-/issues/3",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitLabApi(token)
    const out = await api.listIssues(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      id: 3,
      number: 3,
      title: "Bug",
      body: "desc",
      state: "open",
      author: {login: "alice", avatarUrl: "a.png"},
      assignees: [{login: "bob", avatarUrl: "b.png"}],
      labels: [{name: "bug"}, {name: "high"}],
      url: "https://gitlab.com/g/a/-/issues/3",
      htmlUrl: "https://gitlab.com/g/a/-/issues/3",
    })
  })

  it("getIssue maps fields including labels and dates", async () => {
    const payload = {
      iid: 4,
      title: "Feature",
      description: "body",
      state: "closed",
      author: {username: "eve", avatar_url: "e.png"},
      assignees: [],
      labels: ["feat"],
      created_at: "2020-02-01",
      updated_at: "2020-02-02",
      closed_at: "2020-02-03",
      web_url: "https://gitlab.com/g/a/-/issues/4",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GitLabApi(token)
    const out = await api.getIssue(owner, repo, 4)
    expect(out.state).toBe("closed")
    expect(out.labels[0].name).toBe("feat")
    expect(out.htmlUrl).toContain("/issues/4")
  })

  it("listIssues propagates errors", async () => {
    globalThis.fetch = makeFetchErr(503, "unavailable") as any
    const api = new GitLabApi(token)
    await expect(api.listIssues(owner, repo)).rejects.toThrow(/GitLab API error 503: unavailable/)
  })

  it("closeIssue maps fields and sets state closed", async () => {
    const payload = {
      iid: 9,
      title: "Closed",
      description: "d",
      author: {username: "alice", avatar_url: "a.png"},
      assignees: [{username: "bob", avatar_url: "b.png"}],
      labels: ["bug"],
      created_at: "c",
      updated_at: "u",
      closed_at: "z",
      web_url: "https://gitlab.com/g/a/-/issues/9",
    }
    const api = new GitLabApi(token)
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    globalThis.fetch = makeFetchOk(payload) as any
    const out = await api.closeIssue(owner, repo, 9)
    expect(out.number).toBe(9)
    expect(out.state).toBe("closed")
    expect(out.htmlUrl).toContain("/issues/9")
  })

  it("getBranch maps name/commit/protected", async () => {
    const branch = {name: "main", protected: true, commit: {id: "abc", web_url: "u"}}
    const api = new GitLabApi(token)
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    globalThis.fetch = makeFetchOk(branch) as any
    const out = await api.getBranch(owner, repo, "main")
    expect(out).toEqual({name: "main", commit: {sha: "abc", url: "u"}, protected: true})
  })

  it("listTags maps name and commit id/url", async () => {
    const tags = [
      {name: "v1", commit: {id: "t1", web_url: "u1"}},
      {name: "v2", commit: {id: "t2", web_url: "u2"}},
    ]
    const api = new GitLabApi(token)
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    globalThis.fetch = makeFetchOk(tags) as any
    const out = await api.listTags(owner, repo)
    expect(out).toEqual([
      {name: "v1", commit: {sha: "t1", url: "u1"}},
      {name: "v2", commit: {sha: "t2", url: "u2"}},
    ])
  })

  it("getTag returns tag metadata with archive URLs and commit", async () => {
    const tag = {name: "v3", commit: {id: "t3", web_url: "u3"}}
    const api = new GitLabApi(token, "https://gitlab.example/api/v4")
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    globalThis.fetch = makeFetchOk(tag) as any
    const out = await api.getTag(owner, repo, "v3")
    expect(out.name).toBe("v3")
    expect(out.commit.sha).toBe("t3")
    expect(out.zipballUrl).toBe(
      "https://gitlab.example/api/v4/projects/777/repository/archive.zip?sha=v3",
    )
    expect(out.tarballUrl).toBe(
      "https://gitlab.example/api/v4/projects/777/repository/archive.tar.gz?sha=v3",
    )
  })

  it("mergePullRequest performs PUT then GETs MR and returns mapped PR", async () => {
    const mr = {
      iid: 12,
      title: "MR",
      description: "d",
      state: "merged",
      author: {username: "a", avatar_url: "x"},
      source_branch: "feat",
      sha: "abc",
      source_project_id: 1,
      target_branch: "main",
      target_project_id: 2,
      merge_status: "can_be_merged",
      merged_at: "now",
      created_at: "c",
      updated_at: "u",
      web_url: "https://gitlab.com/g/a/-/merge_requests/12",
    }
    const api = new GitLabApi(token)
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    const fetchMock = vi
      .fn()
      // PUT merge
      .mockResolvedValueOnce({ok: true, json: async () => ({}), text: async () => "{}"})
      // GET MR
      .mockResolvedValueOnce({ok: true, json: async () => mr, text: async () => JSON.stringify(mr)})
    globalThis.fetch = fetchMock as any
    const out = await api.mergePullRequest(owner, repo, 12, {mergeMethod: "squash"})
    expect(out.number).toBe(12)
    const firstInit = (globalThis.fetch as any).mock.calls[0][1]
    expect(firstInit.method).toBe("PUT")
  })

  it("mergePullRequest propagates error text when merge PUT fails", async () => {
    const api = new GitLabApi(token)
    vi.spyOn(api as any, "getProjectId").mockResolvedValue(777)
    globalThis.fetch = makeFetchErr(409, "conflict") as any
    await expect(api.mergePullRequest(owner, repo, 1)).rejects.toThrow(
      /GitLab API error 409: conflict/,
    )
  })
})
