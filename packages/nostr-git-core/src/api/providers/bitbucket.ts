/**
 * Bitbucket REST API Implementation
 *
 * Implements the GitServiceApi interface for Bitbucket's REST API v2.0.
 * Supports Bitbucket Cloud (bitbucket.org).
 *
 * API Documentation: https://developer.atlassian.com/bitbucket/api/2/reference/
 */

import type {
  GitServiceApi,
  RepoMetadata,
  Commit,
  Issue,
  PullRequest,
  Patch,
  Comment,
  NewIssue,
  NewPullRequest,
  ListCommitsOptions,
  ListIssuesOptions,
  ListPullRequestsOptions,
  ListCommentsOptions,
  User,
  GitForkOptions,
} from "../api.js"

/**
 * Bitbucket API client implementing GitServiceApi
 */
export class BitbucketApi implements GitServiceApi {
  private readonly token: string
  private readonly baseUrl: string

  constructor(token: string, baseUrl: string = "https://api.bitbucket.org/2.0") {
    this.token = token
    this.baseUrl = baseUrl.replace(/\/$/, "") // Remove trailing slash
  }

  /**
   * Make authenticated request to Bitbucket API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    }

    if (this.token && this.token.trim()) {
      headers.Authorization = `Bearer ${this.token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Bitbucket API error ${response.status}: ${errorBody}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    if (!text) {
      return undefined as T
    }

    return JSON.parse(text) as T
  }

  /**
   * Repository Operations
   */
  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}`)

    return {
      id: data.uuid,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.mainbranch?.name || "main",
      isPrivate: data.is_private,
      cloneUrl: data.links.clone.find((link: any) => link.name === "https")?.href || "",
      htmlUrl: data.links.html.href,
      owner: {
        login: data.owner.username,
        type: data.owner.type === "team" ? "Organization" : "User",
      },
      permissions: data.permissions
        ? {
            admin: !!data.permissions.admin,
            push: !!data.permissions.push,
            pull: !!data.permissions.pull,
          }
        : undefined,
    }
  }

  async createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata> {
    // Get current user to determine workspace
    const currentUser = await this.getCurrentUser()

    const data = await this.request<any>(`/repositories/${currentUser.login}/${options.name}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: options.name,
        description: options.description,
        is_private: options.private || false,
        has_wiki: false,
        has_issues: true,
      }),
    })

    return {
      id: data.uuid,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.mainbranch?.name || "main",
      isPrivate: data.is_private,
      cloneUrl: data.links.clone.find((link: any) => link.name === "https")?.href || "",
      htmlUrl: data.links.html.href,
      owner: {
        login: data.owner.username,
        type: data.owner.type === "team" ? "Organization" : "User",
      },
    }
  }

  async updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        is_private: updates.private,
      }),
    })

    return {
      id: data.uuid,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.mainbranch?.name || "main",
      isPrivate: data.is_private,
      cloneUrl: data.links.clone.find((link: any) => link.name === "https")?.href || "",
      htmlUrl: data.links.html.href,
      owner: {
        login: data.owner.username,
        type: data.owner.type === "team" ? "Organization" : "User",
      },
    }
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    await this.request<void>(`/repositories/${owner}/${repo}`, {method: "DELETE"})
  }

  async forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata> {
    const body: any = {}
    if (options?.name) {
      body.name = options.name
    }

    const data = await this.request<any>(`/repositories/${owner}/${repo}/forks`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return {
      id: data.uuid,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.mainbranch?.name || "main",
      isPrivate: data.is_private,
      cloneUrl: data.links.clone.find((link: any) => link.name === "https")?.href || "",
      htmlUrl: data.links.html.href,
      owner: {
        login: data.owner.username,
        type: data.owner.type === "team" ? "Organization" : "User",
      },
    }
  }

  /**
   * Commit Operations
   */
  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
    const params = new URLSearchParams()
    if (options?.sha) params.append("include", options.sha)
    if (options?.path) params.append("path", options.path)
    if (options?.per_page) params.append("pagelen", options.per_page.toString())

    const queryString = params.toString()
    const endpoint = `/repositories/${owner}/${repo}/commits${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any>(endpoint)

    return data.values.map((commit: any) => ({
      sha: commit.hash,
      message: commit.message,
      author: {
        name: commit.author.user?.display_name || commit.author.raw,
        email: commit.author.user?.email || "",
        date: commit.date,
      },
      committer: {
        name: commit.author.user?.display_name || commit.author.raw,
        email: commit.author.user?.email || "",
        date: commit.date,
      },
      url: commit.links.self.href,
      htmlUrl: commit.links.html.href,
      parents:
        commit.parents?.map((parent: any) => ({
          sha: parent.hash,
          url: parent.links.self.href,
        })) || [],
    }))
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/commit/${sha}`)

    return {
      sha: data.hash,
      message: data.message,
      author: {
        name: data.author.user?.display_name || data.author.raw,
        email: data.author.user?.email || "",
        date: data.date,
      },
      committer: {
        name: data.author.user?.display_name || data.author.raw,
        email: data.author.user?.email || "",
        date: data.date,
      },
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
      parents:
        data.parents?.map((parent: any) => ({
          sha: parent.hash,
          url: parent.links.self.href,
        })) || [],
    }
  }

  /**
   * Issue Operations
   */
  async listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    const params = new URLSearchParams()
    if (options?.state) {
      const state = options.state === "all" ? "" : options.state
      if (state) params.append("q", `state="${state}"`)
    }
    if (options?.per_page) params.append("pagelen", options.per_page.toString())

    const queryString = params.toString()
    const endpoint = `/repositories/${owner}/${repo}/issues${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any>(endpoint)

    return data.values.map((issue: any) => ({
      id: issue.id,
      number: issue.id,
      title: issue.title,
      body: issue.content?.raw || "",
      state: issue.state === "closed" ? "closed" : "open",
      author: {
        login: issue.reporter.username,
        avatarUrl: issue.reporter.links.avatar.href,
      },
      assignees: issue.assignee
        ? [
            {
              login: issue.assignee.username,
              avatarUrl: issue.assignee.links.avatar.href,
            },
          ]
        : [],
      labels: [], // Bitbucket doesn't have labels in the same way
      createdAt: issue.created_on,
      updatedAt: issue.updated_on,
      closedAt: issue.state === "closed" ? issue.updated_on : undefined,
      url: issue.links.self.href,
      htmlUrl: issue.links.html.href,
    }))
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/issues/${issueNumber}`)

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.content?.raw || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.reporter.username,
        avatarUrl: data.reporter.links.avatar.href,
      },
      assignees: data.assignee
        ? [
            {
              login: data.assignee.username,
              avatarUrl: data.assignee.links.avatar.href,
            },
          ]
        : [],
      labels: [],
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      closedAt: data.state === "closed" ? data.updated_on : undefined,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
    }
  }

  async createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: issue.title,
        content: {
          raw: issue.body,
          markup: "markdown",
        },
        kind: "bug", // Bitbucket requires a kind
      }),
    })

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.content?.raw || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.reporter.username,
        avatarUrl: data.reporter.links.avatar.href,
      },
      assignees: data.assignee
        ? [
            {
              login: data.assignee.username,
              avatarUrl: data.assignee.links.avatar.href,
            },
          ]
        : [],
      labels: [],
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      closedAt: data.state === "closed" ? data.updated_on : undefined,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
    }
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue> {
    const body: any = {}
    if (updates.title) body.title = updates.title
    if (updates.body) body.content = {raw: updates.body, markup: "markdown"}

    const data = await this.request<any>(`/repositories/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.content?.raw || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.reporter.username,
        avatarUrl: data.reporter.links.avatar.href,
      },
      assignees: data.assignee
        ? [
            {
              login: data.assignee.username,
              avatarUrl: data.assignee.links.avatar.href,
            },
          ]
        : [],
      labels: [],
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      closedAt: data.state === "closed" ? data.updated_on : undefined,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
    }
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({state: "closed"}),
    })

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.content?.raw || "",
      state: "closed",
      author: {
        login: data.reporter.username,
        avatarUrl: data.reporter.links.avatar.href,
      },
      assignees: data.assignee
        ? [
            {
              login: data.assignee.username,
              avatarUrl: data.assignee.links.avatar.href,
            },
          ]
        : [],
      labels: [],
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      closedAt: data.updated_on,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
    }
  }

  /**
   * Comment Operations
   * API: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/#api-repositories-workspace-repo-slug-issues-issue-id-comments-get
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const params = new URLSearchParams()
    if (options?.per_page) params.append("pagelen", options.per_page.toString())

    const queryString = params.toString()
    const endpoint = `/repositories/${owner}/${repo}/issues/${issueNumber}/comments${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any>(endpoint)

    return data.values.map((comment: any) => ({
      id: comment.id,
      body: comment.content?.raw || "",
      author: {
        login: comment.user.username,
        avatarUrl: comment.user.links.avatar.href,
      },
      createdAt: comment.created_on,
      updatedAt: comment.updated_on,
      url: comment.links.self.href,
      htmlUrl: comment.links.html.href,
      inReplyToId: comment.parent?.id,
    }))
  }

  async listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const params = new URLSearchParams()
    if (options?.per_page) params.append("pagelen", options.per_page.toString())

    const queryString = params.toString()
    const endpoint = `/repositories/${owner}/${repo}/pullrequests/${prNumber}/comments${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any>(endpoint)

    return data.values.map((comment: any) => ({
      id: comment.id,
      body: comment.content?.raw || "",
      author: {
        login: comment.user.username,
        avatarUrl: comment.user.links.avatar.href,
      },
      createdAt: comment.created_on,
      updatedAt: comment.updated_on,
      url: comment.links.self.href,
      htmlUrl: comment.links.html.href,
      inReplyToId: comment.parent?.id,
    }))
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<Comment> {
    const data = await this.request<any>(
      `/repositories/${owner}/${repo}/pullrequests/comments/${commentId}`,
    )

    return {
      id: data.id,
      body: data.content?.raw || "",
      author: {
        login: data.user.username,
        avatarUrl: data.user.links.avatar.href,
      },
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
      inReplyToId: data.parent?.id,
    }
  }

  /**
   * Pull Request Operations
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions,
  ): Promise<PullRequest[]> {
    const params = new URLSearchParams()
    if (options?.state) params.append("state", options.state.toUpperCase())
    if (options?.per_page) params.append("pagelen", options.per_page.toString())

    const queryString = params.toString()
    const endpoint = `/repositories/${owner}/${repo}/pullrequests${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any>(endpoint)

    return data.values.map((pr: any) => ({
      id: pr.id,
      number: pr.id,
      title: pr.title,
      body: pr.description || "",
      state: pr.state === "MERGED" ? "merged" : pr.state === "DECLINED" ? "closed" : "open",
      author: {
        login: pr.author.username,
        avatarUrl: pr.author.links.avatar.href,
      },
      head: {
        ref: pr.source.branch.name,
        sha: pr.source.commit.hash,
        repo: {
          name: pr.source.repository.name,
          owner: pr.source.repository.owner.username,
        },
      },
      base: {
        ref: pr.destination.branch.name,
        sha: pr.destination.commit.hash,
        repo: {
          name: pr.destination.repository.name,
          owner: pr.destination.repository.owner.username,
        },
      },
      mergeable: pr.state === "OPEN",
      merged: pr.state === "MERGED",
      mergedAt: pr.state === "MERGED" ? pr.updated_on : undefined,
      createdAt: pr.created_on,
      updatedAt: pr.updated_on,
      url: pr.links.self.href,
      htmlUrl: pr.links.html.href,
      diffUrl: pr.links.diff.href,
      patchUrl: pr.links.diff.href, // Bitbucket uses same URL for diff and patch
    }))
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/pullrequests/${prNumber}`)

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.description || "",
      state: data.state === "MERGED" ? "merged" : data.state === "DECLINED" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.links.avatar.href,
      },
      head: {
        ref: data.source.branch.name,
        sha: data.source.commit.hash,
        repo: {
          name: data.source.repository.name,
          owner: data.source.repository.owner.username,
        },
      },
      base: {
        ref: data.destination.branch.name,
        sha: data.destination.commit.hash,
        repo: {
          name: data.destination.repository.name,
          owner: data.destination.repository.owner.username,
        },
      },
      mergeable: data.state === "OPEN",
      merged: data.state === "MERGED",
      mergedAt: data.state === "MERGED" ? data.updated_on : undefined,
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
      diffUrl: data.links.diff.href,
      patchUrl: data.links.diff.href,
    }
  }

  async createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/pullrequests`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: pr.title,
        description: pr.body,
        source: {
          branch: {
            name: pr.head,
          },
        },
        destination: {
          branch: {
            name: pr.base,
          },
        },
      }),
    })

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.description || "",
      state: data.state === "MERGED" ? "merged" : data.state === "DECLINED" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.links.avatar.href,
      },
      head: {
        ref: data.source.branch.name,
        sha: data.source.commit.hash,
        repo: {
          name: data.source.repository.name,
          owner: data.source.repository.owner.username,
        },
      },
      base: {
        ref: data.destination.branch.name,
        sha: data.destination.commit.hash,
        repo: {
          name: data.destination.repository.name,
          owner: data.destination.repository.owner.username,
        },
      },
      mergeable: data.state === "OPEN",
      merged: data.state === "MERGED",
      mergedAt: data.state === "MERGED" ? data.updated_on : undefined,
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
      diffUrl: data.links.diff.href,
      patchUrl: data.links.diff.href,
    }
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    const body: any = {}
    if (updates.title) body.title = updates.title
    if (updates.body) body.description = updates.body

    const data = await this.request<any>(
      `/repositories/${owner}/${repo}/pullrequests/${prNumber}`,
      {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      },
    )

    return {
      id: data.id,
      number: data.id,
      title: data.title,
      body: data.description || "",
      state: data.state === "MERGED" ? "merged" : data.state === "DECLINED" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.links.avatar.href,
      },
      head: {
        ref: data.source.branch.name,
        sha: data.source.commit.hash,
        repo: {
          name: data.source.repository.name,
          owner: data.source.repository.owner.username,
        },
      },
      base: {
        ref: data.destination.branch.name,
        sha: data.destination.commit.hash,
        repo: {
          name: data.destination.repository.name,
          owner: data.destination.repository.owner.username,
        },
      },
      mergeable: data.state === "OPEN",
      merged: data.state === "MERGED",
      mergedAt: data.state === "MERGED" ? data.updated_on : undefined,
      createdAt: data.created_on,
      updatedAt: data.updated_on,
      url: data.links.self.href,
      htmlUrl: data.links.html.href,
      diffUrl: data.links.diff.href,
      patchUrl: data.links.diff.href,
    }
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {
      commitTitle?: string
      commitMessage?: string
      mergeMethod?: "merge" | "squash" | "rebase"
    },
  ): Promise<PullRequest> {
    const body: any = {}
    if (options?.commitMessage) body.message = options.commitMessage
    if (options?.mergeMethod === "squash") body.merge_strategy = "squash"

    await this.request(`/repositories/${owner}/${repo}/pullrequests/${prNumber}/merge`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return this.getPullRequest(owner, repo, prNumber)
  }

  /**
   * Patch Operations (Bitbucket doesn't have native patch support, so we use PRs)
   */
  async listPatches(owner: string, repo: string): Promise<Patch[]> {
    const prs = await this.listPullRequests(owner, repo)

    return prs.map(pr => ({
      id: pr.id.toString(),
      title: pr.title,
      description: pr.body,
      author: pr.author,
      commits: [],
      files: [],
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }))
  }

  async getPatch(owner: string, repo: string, patchId: string): Promise<Patch> {
    const pr = await this.getPullRequest(owner, repo, parseInt(patchId))

    return {
      id: pr.id.toString(),
      title: pr.title,
      description: pr.body,
      author: pr.author,
      commits: [],
      files: [],
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }
  }

  /**
   * User Operations
   */
  async getCurrentUser(): Promise<User> {
    const data = await this.request<any>("/user")

    return {
      login: data.username,
      id: data.account_id,
      avatarUrl: data.links.avatar.href,
      name: data.display_name,
      email: data.email,
      bio: "",
      company: "",
      location: data.location,
      blog: data.website,
      htmlUrl: data.links.html.href,
    }
  }

  async getUser(username: string): Promise<User> {
    const data = await this.request<any>(`/users/${username}`)

    return {
      login: data.username,
      id: data.account_id,
      avatarUrl: data.links.avatar.href,
      name: data.display_name,
      email: "",
      bio: "",
      company: "",
      location: data.location,
      blog: data.website,
      htmlUrl: data.links.html.href,
    }
  }

  /**
   * Repository Content Operations
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{content: string; encoding: string; sha: string}> {
    const branch = ref || "main"
    const encodedBranch = encodeURIComponent(branch)
    const endpoint = `/repositories/${owner}/${repo}/src/${encodedBranch}/${path}`

    const headers: Record<string, string> = {}
    if (this.token && this.token.trim()) {
      headers.Authorization = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers,
    })

    if (!response.ok) {
      throw new Error(`Bitbucket API error ${response.status}: ${await response.text()}`)
    }

    const content = await response.text()

    return {
      content: btoa(content), // Base64 encode to match other providers
      encoding: "base64",
      sha: "", // Bitbucket doesn't provide SHA for file content
    }
  }

  /**
   * Branch Operations
   */
  async listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/refs/branches`)

    return data.values.map((branch: any) => ({
      name: branch.name,
      commit: {
        sha: branch.target.hash,
        url: branch.target.links.self.href,
      },
    }))
  }

  async getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}> {
    const encodedBranch = encodeURIComponent(branch)
    const data = await this.request<any>(
      `/repositories/${owner}/${repo}/refs/branches/${encodedBranch}`,
    )

    return {
      name: data.name,
      commit: {
        sha: data.target.hash,
        url: data.target.links.self.href,
      },
      protected: false, // Bitbucket doesn't expose branch protection in this API
    }
  }

  async upsertBranchRef(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected?: boolean}> {
    try {
      const data = await this.request<any>(`/repositories/${owner}/${repo}/refs/branches`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: branch,
          target: {hash: sha},
        }),
      })

      return {
        name: data.name,
        commit: {
          sha: data.target?.hash || sha,
          url: data.target?.links?.self?.href || "",
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "")
      const isAlreadyExists = /already exists/i.test(message) || /400/.test(message)
      if (!isAlreadyExists) {
        throw error
      }

      const existing = await this.getBranch(owner, repo, branch)
      if (existing.commit.sha === sha) {
        return {
          name: existing.name,
          commit: existing.commit,
          protected: existing.protected,
        }
      }

      throw error
    }
  }

  /**
   * Tag Operations
   */
  async listTags(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/refs/tags`)

    return data.values.map((tag: any) => ({
      name: tag.name,
      commit: {
        sha: tag.target.hash,
        url: tag.target.links.self.href,
      },
    }))
  }

  async getTag(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<{
    name: string
    commit: {sha: string; url: string}
    zipballUrl: string
    tarballUrl: string
  }> {
    const data = await this.request<any>(`/repositories/${owner}/${repo}/refs/tags/${tag}`)

    return {
      name: data.name,
      commit: {
        sha: data.target.hash,
        url: data.target.links.self.href,
      },
      zipballUrl: `${this.baseUrl}/repositories/${owner}/${repo}/downloads/${tag}.zip`,
      tarballUrl: `${this.baseUrl}/repositories/${owner}/${repo}/downloads/${tag}.tar.gz`,
    }
  }
}
