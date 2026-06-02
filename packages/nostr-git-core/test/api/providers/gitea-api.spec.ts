import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"
import "fake-indexeddb/auto"
import {GiteaApi} from "../../../src/api/providers/gitea.js"

const makeFetchOk = (json: any) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => json,
    text: async () => JSON.stringify(json),
  })
const makeFetchErr = (status = 404, text = "Not Found") =>
  vi.fn().mockResolvedValue({ok: false, status, text: async () => text})

describe("GiteaApi request/shape mapping", () => {
  const token = "gt_token"
  const owner = "o"
  const repo = "r"

  const meta = {
    id: 42,
    name: repo,
    full_name: `${owner}/${repo}`,
    description: "d",
    default_branch: "main",
    private: true,
    clone_url: "https://gitea.example/o/r.git",
    html_url: "https://gitea.example/o/r",
    owner: {login: owner, type: "User"},
  }

  let origFetch: any
  beforeEach(() => {
    origFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it("requires baseUrl and maps getRepo; sends token auth header", async () => {
    // Constructor requires baseUrl
    expect(() => new GiteaApi(token)).toThrow(/requires a base URL/)

    globalThis.fetch = makeFetchOk(meta) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const data = await api.getRepo(owner, repo)
    expect(data.id).toBe(String(meta.id))
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toBe("https://gitea.example/api/v1/repos/o/r")
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.headers.Authorization).toBe(`token ${token}`)
  })

  it("omits auth header when token is empty for public reads", async () => {
    globalThis.fetch = makeFetchOk(meta) as any
    const api = new GiteaApi("", "https://gitea.example/api/v1")
    await api.getRepo(owner, repo)
    const init = (globalThis.fetch as any).mock.calls[0][1]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it("propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(500, "fail") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.getRepo(owner, repo)).rejects.toThrow(/Gitea API error 500: fail/)
  })

  it("listBranches maps name and commit id/url", async () => {
    const payload = [
      {name: "main", commit: {id: "abc", url: "u1"}},
      {name: "dev", commit: {id: "def", url: "u2"}},
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.listBranches(owner, repo)
    expect(out).toEqual([
      {name: "main", commit: {sha: "abc", url: "u1"}},
      {name: "dev", commit: {sha: "def", url: "u2"}},
    ])
  })

  it("getFileContent returns content/encoding/sha", async () => {
    const payload = {content: "YQ==", encoding: "base64", sha: "dead"}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const res = await api.getFileContent(owner, repo, "README.md", "main")
    expect(res.encoding).toBe("base64")
    expect(res.sha).toBe("dead")
    expect(res.content).toBe("YQ==")
  })

  it("getFileContent propagates error text when response not ok", async () => {
    globalThis.fetch = makeFetchErr(404, "nope") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.getFileContent(owner, repo, "missing.txt")).rejects.toThrow(
      /Gitea API error 404: nope/,
    )
  })

  it("listIssues maps fields including author, assignees, labels", async () => {
    const payload = [
      {
        id: 9,
        number: 9,
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
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.listIssues(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      id: 9,
      number: 9,
      title: "Bug",
      body: "desc",
      state: "open",
      author: {login: "alice", avatarUrl: "a.png"},
      assignees: [{login: "bob", avatarUrl: "b.png"}],
      labels: [{name: "bug", color: "f00", description: "red"}],
      url: "u",
      htmlUrl: "h",
    })
  })

  it("getIssue maps fields (state, labels, dates)", async () => {
    const payload = {
      id: 10,
      number: 10,
      title: "Feature",
      body: "body",
      state: "closed",
      user: {login: "eve", avatar_url: "e.png"},
      assignees: [],
      labels: [{name: "feat", color: "0f0", description: ""}],
      created_at: "2020-02-01",
      updated_at: "2020-02-02",
      closed_at: "2020-02-03",
      url: "u2",
      html_url: "h2",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.getIssue(owner, repo, 10)
    expect(out.state).toBe("closed")
    expect(out.labels[0].name).toBe("feat")
    expect(out.htmlUrl).toBe("h2")
  })

  it("listIssues propagates errors", async () => {
    globalThis.fetch = makeFetchErr(500, "oops") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.listIssues(owner, repo)).rejects.toThrow(/Gitea API error 500: oops/)
  })

  it("createIssue maps response including assignees and labels", async () => {
    const payload = {
      id: 11,
      number: 11,
      title: "New",
      body: "body",
      state: "open",
      user: {login: "alice", avatar_url: "a.png"},
      assignees: [{login: "bob", avatar_url: "b.png"}],
      labels: [{name: "bug", color: "f00", description: "red"}],
      created_at: "c",
      updated_at: "u",
      closed_at: null,
      url: "u",
      html_url: "h",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.createIssue(owner, repo, {
      title: "New",
      body: "body",
      assignees: ["bob"],
      labels: ["bug"],
    } as any)
    expect(out.number).toBe(11)
    expect(out.labels?.[0].name).toBe("bug")
  })

  it("createIssue propagates errors", async () => {
    globalThis.fetch = makeFetchErr(400, "invalid") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.createIssue(owner, repo, {title: "x"} as any)).rejects.toThrow(
      /Gitea API error 400: invalid/,
    )
  })

  it("updateIssue maps updated fields", async () => {
    const payload = {
      id: 12,
      number: 12,
      title: "Upd",
      body: "new body",
      state: "open",
      user: {login: "alice", avatar_url: "a.png"},
      assignees: [],
      labels: [],
      created_at: "c",
      updated_at: "u",
      closed_at: null,
      url: "u",
      html_url: "h",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.updateIssue(owner, repo, 12, {title: "Upd", body: "new body"})
    expect(out.title).toBe("Upd")
    expect(out.body).toBe("new body")
  })

  it("updateIssue propagates errors", async () => {
    globalThis.fetch = makeFetchErr(500, "boom") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.updateIssue(owner, repo, 12, {title: "x"})).rejects.toThrow(
      /Gitea API error 500: boom/,
    )
  })

  it("closeIssue maps fields and sets state closed", async () => {
    const payload = {
      id: 13,
      number: 13,
      title: "C",
      body: "",
      state: "closed",
      user: {login: "bob", avatar_url: "b.png"},
      assignees: [],
      labels: [],
      created_at: "c",
      updated_at: "u",
      closed_at: "u",
      url: "u",
      html_url: "h",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.closeIssue(owner, repo, 13)
    expect(out.state).toBe("closed")
    expect(out.number).toBe(13)
  })

  it("closeIssue propagates errors", async () => {
    globalThis.fetch = makeFetchErr(409, "conflict") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.closeIssue(owner, repo, 13)).rejects.toThrow(/Gitea API error 409: conflict/)
  })

  it("getBranch maps name/commit/protected", async () => {
    const branch = "feature/with-slash"
    const payload = {name: branch, protected: true, commit: {id: "abc", url: "u"}}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.getBranch(owner, repo, branch)
    expect(out).toEqual({name: branch, commit: {sha: "abc", url: "u"}, protected: true})
    const url = (globalThis.fetch as any).mock.calls[0][0]
    expect(url).toContain("/repos/o/r/branches/feature%2Fwith-slash")
  })

  it("getBranch propagates errors", async () => {
    globalThis.fetch = makeFetchErr(404, "missing") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.getBranch(owner, repo, "dev")).rejects.toThrow(/Gitea API error 404: missing/)
  })

  it("listTags maps name and commit sha/url", async () => {
    const payload = [
      {name: "v1", commit: {sha: "t1", url: "u1"}},
      {name: "v2", commit: {sha: "t2", url: "u2"}},
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.listTags(owner, repo)
    expect(out).toEqual([
      {name: "v1", commit: {sha: "t1", url: "u1"}},
      {name: "v2", commit: {sha: "t2", url: "u2"}},
    ])
  })

  it("getTag returns tag metadata with archive URLs and commit", async () => {
    const payload = {name: "v3", commit: {sha: "th", url: "turl"}}
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.getTag(owner, repo, "v3")
    expect(out.name).toBe("v3")
    expect(out.commit.sha).toBe("th")
    expect(out.zipballUrl).toBe("https://gitea.example/api/v1/repos/o/r/archive/v3.zip")
    expect(out.tarballUrl).toBe("https://gitea.example/api/v1/repos/o/r/archive/v3.tar.gz")
  })

  it("listTags propagates errors", async () => {
    globalThis.fetch = makeFetchErr(502, "bad gateway") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.listTags(owner, repo)).rejects.toThrow(/Gitea API error 502: bad gateway/)
  })

  it("getTag propagates errors", async () => {
    globalThis.fetch = makeFetchErr(403, "forbidden") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.getTag(owner, repo, "v1")).rejects.toThrow(/Gitea API error 403: forbidden/)
  })

  it("listPullRequests maps state and head/base fields", async () => {
    const payload = [
      {
        id: 20,
        number: 20,
        title: "PR",
        body: "b",
        state: "open",
        merged: false,
        user: {login: "alice", avatar_url: "a.png"},
        head: {ref: "feat", sha: "abc", repo: {name: "r", owner: {login: "o"}}},
        base: {ref: "main", sha: "def", repo: {name: "r", owner: {login: "o"}}},
        mergeable: true,
        merged_at: null,
        created_at: "c",
        updated_at: "u",
        url: "u",
        html_url: "h",
        diff_url: "d",
        patch_url: "p",
      },
    ]
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.listPullRequests(owner, repo, {state: "open"})
    expect(out[0]).toMatchObject({
      number: 20,
      state: "open",
      head: {ref: "feat", sha: "abc"},
      base: {ref: "main", sha: "def"},
      mergeable: true,
      merged: false,
    })
  })

  it("getPullRequest maps merged state and base fields", async () => {
    const payload = {
      id: 21,
      number: 21,
      title: "PR2",
      body: "d",
      state: "closed",
      merged: true,
      user: {login: "bob", avatar_url: "b.png"},
      head: {ref: "fix", sha: "111", repo: {name: "r", owner: {login: "o"}}},
      base: {ref: "main", sha: "222", repo: {name: "r", owner: {login: "o"}}},
      mergeable: false,
      merged_at: "now",
      created_at: "c",
      updated_at: "u",
      url: "u",
      html_url: "h",
      diff_url: "d",
      patch_url: "p",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.getPullRequest(owner, repo, 21)
    expect(out.merged).toBe(true)
    expect(out.state).toBe("merged")
    expect(out.base.ref).toBe("main")
  })

  it("createPullRequest maps response to PullRequest shape", async () => {
    const payload = {
      id: 22,
      number: 22,
      title: "newPR",
      body: "b",
      state: "open",
      merged: false,
      user: {login: "alice", avatar_url: "a.png"},
      head: {ref: "feat", sha: "abc", repo: {name: "r", owner: {login: "o"}}},
      base: {ref: "main", sha: "def", repo: {name: "r", owner: {login: "o"}}},
      mergeable: true,
      merged_at: null,
      created_at: "c",
      updated_at: "u",
      url: "u",
      html_url: "h",
      diff_url: "d",
      patch_url: "p",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.createPullRequest(owner, repo, {
      title: "newPR",
      body: "b",
      head: "feat",
      base: "main",
    })
    expect(out.number).toBe(22)
    expect(out.head.ref).toBe("feat")
  })

  it("createPullRequest propagates errors", async () => {
    globalThis.fetch = makeFetchErr(400, "invalid") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(
      api.createPullRequest(owner, repo, {title: "x", head: "a", base: "b"} as any),
    ).rejects.toThrow(/Gitea API error 400: invalid/)
  })

  it("updatePullRequest maps updated fields", async () => {
    const payload = {
      id: 23,
      number: 23,
      title: "updPR",
      body: "nb",
      state: "open",
      merged: false,
      user: {login: "alice", avatar_url: "a.png"},
      head: {ref: "feat", sha: "abc", repo: {name: "r", owner: {login: "o"}}},
      base: {ref: "main", sha: "def", repo: {name: "r", owner: {login: "o"}}},
      mergeable: true,
      merged_at: null,
      created_at: "c",
      updated_at: "u",
      url: "u",
      html_url: "h",
      diff_url: "d",
      patch_url: "p",
    }
    globalThis.fetch = makeFetchOk(payload) as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.updatePullRequest(owner, repo, 23, {title: "updPR", body: "nb"})
    expect(out.title).toBe("updPR")
    expect(out.body).toBe("nb")
  })

  it("updatePullRequest propagates errors", async () => {
    globalThis.fetch = makeFetchErr(500, "boom") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.updatePullRequest(owner, repo, 23, {title: "x"})).rejects.toThrow(
      /Gitea API error 500: boom/,
    )
  })

  it("mergePullRequest performs POST then GETs PR and returns mapped PR", async () => {
    const pr = {
      id: 24,
      number: 24,
      title: "mPR",
      body: "",
      state: "closed",
      merged: true,
      user: {login: "octo", avatar_url: "a"},
      head: {ref: "feat", sha: "h", repo: {name: "r", owner: {login: "o"}}},
      base: {ref: "main", sha: "b", repo: {name: "r", owner: {login: "o"}}},
      mergeable: false,
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
      // POST merge
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
        text: async () => JSON.stringify({}),
      })
      // GET PR
      .mockResolvedValueOnce({
        ok: true,
        json: async () => pr,
        text: async () => JSON.stringify(pr),
      })
    globalThis.fetch = fetchMock as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    const out = await api.mergePullRequest(owner, repo, 24, {mergeMethod: "squash"})
    expect(out.number).toBe(24)
    const firstInit = (globalThis.fetch as any).mock.calls[0][1]
    expect(firstInit.method).toBe("POST")
  })

  it("mergePullRequest propagates error text when merge POST fails", async () => {
    globalThis.fetch = makeFetchErr(409, "conflict") as any
    const api = new GiteaApi(token, "https://gitea.example/api/v1")
    await expect(api.mergePullRequest(owner, repo, 1)).rejects.toThrow(
      /Gitea API error 409: conflict/,
    )
  })
})
