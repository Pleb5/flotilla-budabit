/**
 * GitHub REST API Implementation
 *
 * Implements the GitServiceApi interface for GitHub's REST API v3/v4.
 * Handles authentication, rate limiting, and API-specific quirks.
 *
 * API Documentation: https://docs.github.com/en/rest
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
 * GitHub API client implementing GitServiceApi
 */
export class GitHubApi implements GitServiceApi {
  private readonly token: string
  private readonly baseUrl: string

  constructor(token: string, baseUrl: string = "https://api.github.com") {
    this.token = token
    this.baseUrl = baseUrl.replace(/\/$/, "") // Remove trailing slash
  }

  /**
   * Make authenticated request to GitHub API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      ...((options.headers as Record<string, string>) || {}),
    }

    // Only add Authorization header if token is provided
    if (this.token && this.token.trim()) {
      headers.Authorization = `token ${this.token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`GitHub API error ${response.status}: ${errorBody}`)
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

  private mapRepoMetadata(data: any): RepoMetadata {
    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
      owner: {
        login: data.owner.login,
        type: data.owner.type === "Organization" ? "Organization" : "User",
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

  /**
   * Repository Operations
   */
  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    const data = await this.request<any>(`/repos/${owner}/${repo}`)

    return this.mapRepoMetadata(data)
  }

  async createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata> {
    const data = await this.request<any>("/user/repos", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: options.name,
        description: options.description,
        private: options.private || false,
        auto_init: options.autoInit || false,
      }),
    })

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
      owner: {
        login: data.owner.login,
        type: data.owner.type === "Organization" ? "Organization" : "User",
      },
    }
  }

  async updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata> {
    const data = await this.request<any>(`/repos/${owner}/${repo}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        private: updates.private,
      }),
    })

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
      owner: {
        login: data.owner.login,
        type: data.owner.type === "Organization" ? "Organization" : "User",
      },
    }
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    await this.request<void>(`/repos/${owner}/${repo}`, {
      method: "DELETE",
    })
  }

  async forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata> {
    const body: any = {}
    if (options?.name) {
      body.name = options.name
    }
    if (options?.organization) {
      body.organization = options.organization
    }

    const data = await this.request<any>(`/repos/${owner}/${repo}/forks`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return this.mapRepoMetadata(data)
  }

  async checkExistingFork(owner: string, repo: string): Promise<RepoMetadata | null> {
    const expectedFullName = `${owner}/${repo}`.toLowerCase()

    for (let page = 1; page <= 10; page++) {
      const repos = await this.request<any[]>(`/user/repos?type=owner&per_page=100&page=${page}`)
      const existingFork = repos.find(candidate => {
        if (!candidate?.fork) return false

        const parentFullName = String(candidate?.parent?.full_name || "").toLowerCase()
        const sourceFullName = String(candidate?.source?.full_name || "").toLowerCase()

        return parentFullName === expectedFullName || sourceFullName === expectedFullName
      })

      if (existingFork) {
        return this.mapRepoMetadata(existingFork)
      }

      if (!Array.isArray(repos) || repos.length < 100) {
        break
      }
    }

    return null
  }

  /**
   * Commit Operations
   */
  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
    const params = new URLSearchParams()
    if (options?.sha) params.append("sha", options.sha)
    if (options?.path) params.append("path", options.path)
    if (options?.since) params.append("since", options.since)
    if (options?.until) params.append("until", options.until)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/commits${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date,
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date,
      },
      url: commit.url,
      htmlUrl: commit.html_url,
      parents: commit.parents.map((parent: any) => ({
        sha: parent.sha,
        url: parent.url,
      })),
      stats: commit.stats
        ? {
            additions: commit.stats.additions,
            deletions: commit.stats.deletions,
            total: commit.stats.total,
          }
        : undefined,
    }))
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/commits/${sha}`)

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author.name,
        email: data.commit.author.email,
        date: data.commit.author.date,
      },
      committer: {
        name: data.commit.committer.name,
        email: data.commit.committer.email,
        date: data.commit.committer.date,
      },
      url: data.url,
      htmlUrl: data.html_url,
      parents: data.parents.map((parent: any) => ({
        sha: parent.sha,
        url: parent.url,
      })),
      stats: data.stats
        ? {
            additions: data.stats.additions,
            deletions: data.stats.deletions,
            total: data.stats.total,
          }
        : undefined,
    }
  }

  /**
   * Issue Operations
   */
  async listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    const params = new URLSearchParams()
    if (options?.state) params.append("state", options.state)
    if (options?.labels) params.append("labels", options.labels.join(","))
    if (options?.assignee) params.append("assignee", options.assignee)
    if (options?.creator) params.append("creator", options.creator)
    if (options?.since) params.append("since", options.since)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/issues${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(issue => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body || "",
      state: issue.state === "closed" ? "closed" : "open",
      author: {
        login: issue.user.login,
        avatarUrl: issue.user.avatar_url,
      },
      assignees: issue.assignees.map((assignee: any) => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
      })),
      labels: issue.labels.map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      closedBy: issue.closed_by
        ? {
            login: issue.closed_by.login,
            avatarUrl: issue.closed_by.avatar_url,
          }
        : undefined,
      url: issue.url,
      htmlUrl: issue.html_url,
      isPullRequest: !!issue.pull_request,
    }))
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/issues/${issueNumber}`)

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      closedBy: data.closed_by
        ? {
            login: data.closed_by.login,
            avatarUrl: data.closed_by.avatar_url,
          }
        : undefined,
      url: data.url,
      htmlUrl: data.html_url,
    }
  }

  async createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        assignees: issue.assignees,
        labels: issue.labels,
      }),
    })

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.url,
      htmlUrl: data.html_url,
    }
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(updates),
    })

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.login,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: any) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.url,
      htmlUrl: data.html_url,
    }
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    return this.updateIssue(owner, repo, issueNumber, {title: undefined, body: undefined})
  }

  /**
   * Comment Operations
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const params = new URLSearchParams()
    if (options?.since) params.append("since", options.since)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/issues/${issueNumber}/comments${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any[]>(endpoint)

    return data.map(comment => ({
      id: comment.id,
      body: comment.body || "",
      author: {
        login: comment.user.login,
        avatarUrl: comment.user.avatar_url,
      },
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      url: comment.url,
      htmlUrl: comment.html_url,
      inReplyToId: undefined,
    }))
  }

  async listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    return this.listIssueComments(owner, repo, prNumber, options)
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<Comment> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/issues/comments/${commentId}`)

    return {
      id: data.id,
      body: data.body || "",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.url,
      htmlUrl: data.html_url,
      inReplyToId: undefined,
    }
  }

  async listAllIssueComments(
    owner: string,
    repo: string,
    options?: ListCommentsOptions,
  ): Promise<Array<Comment & {issueNumber: number; isPullRequest: boolean}>> {
    const params = new URLSearchParams()
    if (options?.since) params.append("since", options.since)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/issues/comments${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any[]>(endpoint)

    return data.map(comment => {
      const issueUrlMatch = comment.issue_url?.match(/\/issues\/(\d+)$/)
      const issueNumber = issueUrlMatch ? parseInt(issueUrlMatch[1], 10) : 0
      const isPullRequest = false

      return {
        id: comment.id,
        body: comment.body || "",
        author: {
          login: comment.user.login,
          avatarUrl: comment.user.avatar_url,
        },
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        url: comment.url,
        htmlUrl: comment.html_url,
        inReplyToId: undefined,
        issueNumber,
        isPullRequest,
      }
    })
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
    if (options?.state) params.append("state", options.state)
    if (options?.head) params.append("head", options.head)
    if (options?.base) params.append("base", options.base)
    if (options?.sort) params.append("sort", options.sort)
    if (options?.direction) params.append("direction", options.direction)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/pulls${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(pr => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body || "",
      state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
      author: {
        login: pr.user.login,
        avatarUrl: pr.user.avatar_url,
      },
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
        repo: pr.head.repo
          ? {
              name: pr.head.repo.name,
              owner: pr.head.repo.owner.login,
            }
          : {
              name: "unknown",
              owner: "unknown",
            },
      },
      base: {
        ref: pr.base.ref,
        sha: pr.base.sha,
        repo: pr.base.repo
          ? {
              name: pr.base.repo.name,
              owner: pr.base.repo.owner.login,
            }
          : {
              name: "unknown",
              owner: "unknown",
            },
      },
      mergeable: pr.mergeable,
      merged: pr.merged,
      mergedAt: pr.merged_at,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.url,
      htmlUrl: pr.html_url,
      diffUrl: pr.diff_url,
      patchUrl: pr.patch_url,
    }))
  }

  async listPullRequestCommits(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {per_page?: number; page?: number},
  ): Promise<Commit[]> {
    const params = new URLSearchParams()
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())
    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/commits${queryString ? `?${queryString}` : ""}`
    const data = await this.request<any[]>(endpoint)
    return data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author?.name ?? "",
        email: commit.commit.author?.email ?? "",
        date: commit.commit.author?.date ?? "",
      },
      committer: {
        name: commit.commit.committer?.name ?? "",
        email: commit.commit.committer?.email ?? "",
        date: commit.commit.committer?.date ?? "",
      },
      url: commit.url,
      htmlUrl: commit.html_url,
      parents: (commit.parents ?? []).map((parent: {sha: string; url: string}) => ({
        sha: parent.sha,
        url: parent.url,
      })),
      stats: commit.stats
        ? {
            additions: commit.stats.additions,
            deletions: commit.stats.deletions,
            total: commit.stats.total,
          }
        : undefined,
    }))
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/pulls/${prNumber}`)

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.merged ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
        repo: data.head.repo
          ? {
              name: data.head.repo.name,
              owner: data.head.repo.owner.login,
            }
          : {
              name: "unknown",
              owner: "unknown",
            },
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
        repo: data.base.repo
          ? {
              name: data.base.repo.name,
              owner: data.base.repo.owner.login,
            }
          : {
              name: "unknown",
              owner: "unknown",
            },
      },
      mergeable: data.mergeable,
      merged: data.merged,
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.url,
      htmlUrl: data.html_url,
      diffUrl: data.diff_url,
      patchUrl: data.patch_url,
    }
  }

  async createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: pr.title,
        body: pr.body,
        head: pr.head,
        base: pr.base,
        draft: pr.draft,
      }),
    })

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.merged ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
        repo: {
          name: data.head.repo.name,
          owner: data.head.repo.owner.login,
        },
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
        repo: {
          name: data.base.repo.name,
          owner: data.base.repo.owner.login,
        },
      },
      mergeable: data.mergeable,
      merged: data.merged,
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.url,
      htmlUrl: data.html_url,
      diffUrl: data.diff_url,
      patchUrl: data.patch_url,
    }
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    const data = await this.request<any>(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(updates),
    })

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || "",
      state: data.merged ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
        repo: {
          name: data.head.repo.name,
          owner: data.head.repo.owner.login,
        },
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
        repo: {
          name: data.base.repo.name,
          owner: data.base.repo.owner.login,
        },
      },
      mergeable: data.mergeable,
      merged: data.merged,
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.url,
      htmlUrl: data.html_url,
      diffUrl: data.diff_url,
      patchUrl: data.patch_url,
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
    await this.request(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        commit_title: options?.commitTitle,
        commit_message: options?.commitMessage,
        merge_method: options?.mergeMethod || "merge",
      }),
    })

    // Return updated PR after merge
    return this.getPullRequest(owner, repo, prNumber)
  }

  /**
   * Patch Operations (GitHub doesn't have native patch support, so we use PRs)
   */
  async listPatches(owner: string, repo: string): Promise<Patch[]> {
    // For GitHub, patches are essentially pull requests
    const prs = await this.listPullRequests(owner, repo)

    return prs.map(pr => ({
      id: pr.id.toString(),
      title: pr.title,
      description: pr.body,
      author: pr.author,
      commits: [], // Would need separate API call to get commits
      files: [], // Would need separate API call to get files
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }))
  }

  async getPatch(owner: string, repo: string, patchId: string): Promise<Patch> {
    // For GitHub, treat patch ID as PR number
    const pr = await this.getPullRequest(owner, repo, parseInt(patchId))

    return {
      id: pr.id.toString(),
      title: pr.title,
      description: pr.body,
      author: pr.author,
      commits: [], // Would need separate API call to get commits
      files: [], // Would need separate API call to get files
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
      login: data.login,
      id: data.id,
      avatarUrl: data.avatar_url,
      name: data.name,
      email: data.email,
      bio: data.bio,
      company: data.company,
      location: data.location,
      blog: data.blog,
      htmlUrl: data.html_url,
    }
  }

  async getUser(username: string): Promise<User> {
    const data = await this.request<any>(`/users/${username}`)

    return {
      login: data.login,
      id: data.id,
      avatarUrl: data.avatar_url,
      name: data.name,
      email: data.email,
      bio: data.bio,
      company: data.company,
      location: data.location,
      blog: data.blog,
      htmlUrl: data.html_url,
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
    const params = new URLSearchParams()
    if (ref) params.append("ref", ref)

    const queryString = params.toString()
    const endpoint = `/repos/${owner}/${repo}/contents/${path}${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any>(endpoint)

    return {
      content: data.content,
      encoding: data.encoding,
      sha: data.sha,
    }
  }

  /**
   * Branch Operations
   */
  async listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const data = await this.request<any[]>(`/repos/${owner}/${repo}/branches`)

    return data.map(branch => ({
      name: branch.name,
      commit: {
        sha: branch.commit.sha,
        url: branch.commit.url,
      },
    }))
  }

  async getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}> {
    const encodedBranch = encodeURIComponent(branch)
    const data = await this.request<any>(`/repos/${owner}/${repo}/branches/${encodedBranch}`)

    return {
      name: data.name,
      commit: {
        sha: data.commit.sha,
        url: data.commit.url,
      },
      protected: data.protected,
    }
  }

  async upsertBranchRef(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected?: boolean}> {
    const branchRef = `refs/heads/${branch}`
    try {
      await this.request<any>(`/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ref: branchRef, sha}),
      })
      const created = await this.getBranch(owner, repo, branch)
      return {
        name: created.name,
        commit: created.commit,
        protected: created.protected,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "")
      const isAlreadyExists = /422/.test(message) || /already exists/i.test(message)
      if (!isAlreadyExists) {
        throw error
      }

      await this.request<any>(
        `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        {
          method: "PATCH",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({sha, force: true}),
        },
      )

      const updated = await this.getBranch(owner, repo, branch)
      return {
        name: updated.name,
        commit: updated.commit,
        protected: updated.protected,
      }
    }
  }

  /**
   * Tag Operations
   */
  async listTags(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const data = await this.request<any[]>(`/repos/${owner}/${repo}/tags`)

    return data.map(tag => ({
      name: tag.name,
      commit: {
        sha: tag.commit.sha,
        url: tag.commit.url,
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
    const data = await this.request<any>(`/repos/${owner}/${repo}/releases/tags/${tag}`)

    return {
      name: data.tag_name,
      commit: {
        sha: data.target_commitish,
        url: "", // GitHub releases don't provide commit URL directly
      },
      zipballUrl: data.zipball_url,
      tarballUrl: data.tarball_url,
    }
  }
}
