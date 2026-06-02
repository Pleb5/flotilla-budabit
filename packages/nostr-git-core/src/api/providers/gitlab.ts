/**
 * GitLab REST API Implementation
 *
 * Implements the GitServiceApi interface for GitLab's REST API v4.
 * Supports both GitLab.com and self-hosted GitLab instances.
 *
 * API Documentation: https://docs.gitlab.com/ee/api/
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
 * GitLab API client implementing GitServiceApi
 */
export class GitLabApi implements GitServiceApi {
  private readonly token: string
  private readonly baseUrl: string

  constructor(token: string, baseUrl: string = "https://gitlab.com/api/v4") {
    this.token = token
    this.baseUrl = baseUrl.replace(/\/$/, "") // Remove trailing slash
  }

  /**
   * Make authenticated request to GitLab API
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
      throw new Error(`GitLab API error ${response.status}: ${errorBody}`)
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
   * Get project ID from owner/repo (GitLab uses project IDs for most operations)
   */
  private async getProjectId(owner: string, repo: string): Promise<number> {
    const projectPath = `${owner}/${repo}`
    const encodedPath = encodeURIComponent(projectPath)
    const project = await this.request<any>(`/projects/${encodedPath}`)
    return project.id
  }

  private mapRepoMetadata(data: any): RepoMetadata {
    const projectAccess = data.permissions?.project_access?.access_level ?? 0
    const groupAccess = data.permissions?.group_access?.access_level ?? 0
    const accessLevel = Math.max(projectAccess, groupAccess)
    const roleByAccess: Record<number, string> = {
      50: "Owner",
      40: "Maintainer",
      30: "Developer",
      20: "Reporter",
      10: "Guest",
    }
    const role = roleByAccess[accessLevel] || undefined

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.path_with_namespace,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.visibility === "private",
      cloneUrl: data.http_url_to_repo,
      htmlUrl: data.web_url,
      owner: {
        login: data.namespace.path,
        type: data.namespace.kind === "group" ? "Organization" : "User",
      },
      permissions: accessLevel
        ? {
            accessLevel,
            role,
            admin: accessLevel >= 50,
          }
        : undefined,
    }
  }

  /**
   * Repository Operations
   */
  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    const projectPath = `${owner}/${repo}`
    const encodedPath = encodeURIComponent(projectPath)
    const data = await this.request<any>(`/projects/${encodedPath}`)

    return this.mapRepoMetadata(data)
  }

  async createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata> {
    const data = await this.request<any>("/projects", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: options.name,
        description: options.description,
        visibility: options.private ? "private" : "public",
        initialize_with_readme: options.autoInit || false,
      }),
    })

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.path_with_namespace,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.visibility === "private",
      cloneUrl: data.http_url_to_repo,
      htmlUrl: data.web_url,
      owner: {
        login: data.namespace.path,
        type: data.namespace.kind === "group" ? "Organization" : "User",
      },
    }
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    const projectId = await this.getProjectId(owner, repo)
    await this.request<void>(`/projects/${projectId}`, {method: "DELETE"})
  }

  async updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata> {
    const projectId = await this.getProjectId(owner, repo)

    const data = await this.request<any>(`/projects/${projectId}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: updates.name,
        description: updates.description,
        visibility:
          updates.private !== undefined ? (updates.private ? "private" : "public") : undefined,
      }),
    })

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.path_with_namespace,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.visibility === "private",
      cloneUrl: data.http_url_to_repo,
      htmlUrl: data.web_url,
      owner: {
        login: data.namespace.path,
        type: data.namespace.kind === "group" ? "Organization" : "User",
      },
    }
  }

  async forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata> {
    // First, try to find the project on GitLab (same-provider forking)
    try {
      const projectId = await this.getProjectId(owner, repo)

      const body: any = {}
      if (options?.name) {
        body.name = options.name
        body.path = options.name
      }
      if (options?.organization) {
        body.namespace_id = options.organization
      }

      const data = await this.request<any>(`/projects/${projectId}/fork`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
      })

      return this.mapRepoMetadata(data)
    } catch (error: any) {
      // If project not found on GitLab, attempt cross-provider import from GitHub
      if (error.message?.includes("404") || error.message?.includes("Project Not Found")) {
        return this.importFromGitHub(owner, repo, options)
      }
      throw error
    }
  }

  async checkExistingFork(owner: string, repo: string): Promise<RepoMetadata | null> {
    const projectId = await this.getProjectId(owner, repo)
    const currentUser = await this.getCurrentUser()
    const normalizedUser = currentUser.login.toLowerCase()

    for (let page = 1; page <= 10; page++) {
      const forks = await this.request<any[]>(
        `/projects/${projectId}/forks?per_page=100&page=${page}`,
      )
      const existingFork = forks.find(candidate => {
        const namespacePath = String(
          candidate?.namespace?.full_path || candidate?.namespace?.path || "",
        ).toLowerCase()
        return namespacePath === normalizedUser
      })

      if (existingFork) {
        return this.mapRepoMetadata(existingFork)
      }

      if (!Array.isArray(forks) || forks.length < 100) {
        break
      }
    }

    return null
  }

  /**
   * Import a repository from GitHub to GitLab (cross-provider forking)
   */
  private async importFromGitHub(
    owner: string,
    repo: string,
    options?: GitForkOptions,
  ): Promise<RepoMetadata> {
    const githubUrl = `https://github.com/${owner}/${repo}.git`
    const projectName = options?.name || repo
    const projectPath = options?.name || repo

    const importBody = {
      name: projectName,
      path: projectPath,
      import_url: githubUrl,
      visibility: "public", // Default to public, could be made configurable
      description: `Imported from GitHub: ${owner}/${repo}`,
    }

    const data = await this.request<any>("/projects", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(importBody),
    })

    // Wait for import to complete before returning
    await this.waitForImportCompletion(data.id)

    return {
      id: data.id.toString(),
      name: data.name,
      fullName: data.path_with_namespace,
      description: data.description,
      defaultBranch: data.default_branch,
      isPrivate: data.visibility === "private",
      cloneUrl: data.http_url_to_repo,
      htmlUrl: data.web_url,
      owner: {
        login: data.namespace.path,
        type: data.namespace.kind === "group" ? "Organization" : "User",
      },
    }
  }

  /**
   * Wait for GitLab import to complete
   */
  private async waitForImportCompletion(projectId: number): Promise<void> {
    const maxAttempts = 60 // 5 minutes max (5 second intervals)
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        // Check import status via project API
        const project = await this.request<any>(`/projects/${projectId}`)

        // GitLab sets import_status field during import
        if (
          project.import_status === "finished" ||
          project.import_status === "none" ||
          !project.import_status
        ) {
          // Import completed successfully
          return
        }

        if (project.import_status === "failed") {
          throw new Error("GitLab repository import failed")
        }

        // Import still in progress, wait and retry
        await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds
        attempts++
      } catch (error: any) {
        // If we can't check status, assume import is complete after a reasonable wait
        if (attempts > 6) {
          // After 30 seconds, assume it's ready
          return
        }
        await new Promise(resolve => setTimeout(resolve, 5000))
        attempts++
      }
    }

    // Timeout reached, but don't fail - the import might still be working
    console.warn("GitLab import status check timed out, proceeding with clone attempt")
  }

  /**
   * Commit Operations
   */
  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (options?.sha) params.append("ref_name", options.sha)
    if (options?.path) params.append("path", options.path)
    if (options?.since) params.append("since", options.since)
    if (options?.until) params.append("until", options.until)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/projects/${projectId}/repository/commits${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(commit => ({
      sha: commit.id,
      message: commit.message,
      author: {
        name: commit.author_name,
        email: commit.author_email,
        date: commit.authored_date,
      },
      committer: {
        name: commit.committer_name,
        email: commit.committer_email,
        date: commit.committed_date,
      },
      url: commit.web_url,
      htmlUrl: commit.web_url,
      parents: commit.parent_ids.map((parentId: string) => ({
        sha: parentId,
        url: `${this.baseUrl}/projects/${projectId}/repository/commits/${parentId}`,
      })),
      stats: commit.stats
        ? {
            additions: commit.stats.additions,
            deletions: commit.stats.deletions,
            total: commit.stats.additions + commit.stats.deletions,
          }
        : undefined,
    }))
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any>(`/projects/${projectId}/repository/commits/${sha}`)

    return {
      sha: data.id,
      message: data.message,
      author: {
        name: data.author_name,
        email: data.author_email,
        date: data.authored_date,
      },
      committer: {
        name: data.committer_name,
        email: data.committer_email,
        date: data.committed_date,
      },
      url: data.web_url,
      htmlUrl: data.web_url,
      parents: data.parent_ids.map((parentId: string) => ({
        sha: parentId,
        url: `${this.baseUrl}/projects/${projectId}/repository/commits/${parentId}`,
      })),
      stats: data.stats
        ? {
            additions: data.stats.additions,
            deletions: data.stats.deletions,
            total: data.stats.additions + data.stats.deletions,
          }
        : undefined,
    }
  }

  /**
   * Issue Operations
   */
  async listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (options?.state) params.append("state", options.state)
    if (options?.labels) params.append("labels", options.labels.join(","))
    if (options?.assignee) params.append("assignee_username", options.assignee)
    if (options?.creator) params.append("author_username", options.creator)
    if (options?.since) params.append("updated_after", options.since)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/projects/${projectId}/issues${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(issue => ({
      id: issue.iid, // GitLab uses iid for issue numbers
      number: issue.iid,
      title: issue.title,
      body: issue.description || "",
      state: issue.state === "closed" ? "closed" : "open",
      author: {
        login: issue.author.username,
        avatarUrl: issue.author.avatar_url,
      },
      assignees: issue.assignees.map((assignee: any) => ({
        login: assignee.username,
        avatarUrl: assignee.avatar_url,
      })),
      labels: issue.labels.map((label: string) => ({
        name: label,
        color: "", // GitLab doesn't provide label colors in issue list
        description: "",
      })),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      closedBy: issue.closed_by
        ? {
            login: issue.closed_by.username,
            avatarUrl: issue.closed_by.avatar_url,
          }
        : undefined,
      url: issue.web_url,
      htmlUrl: issue.web_url,
    }))
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any>(`/projects/${projectId}/issues/${issueNumber}`)

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.username,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: string) => ({
        name: label,
        color: "",
        description: "",
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.web_url,
      htmlUrl: data.web_url,
    }
  }

  async createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue> {
    const projectId = await this.getProjectId(owner, repo)

    const data = await this.request<any>(`/projects/${projectId}/issues`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: issue.title,
        description: issue.body,
        assignee_ids: issue.assignees, // GitLab uses IDs, not usernames
        labels: issue.labels?.join(","),
      }),
    })

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.username,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: string) => ({
        name: label,
        color: "",
        description: "",
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.web_url,
      htmlUrl: data.web_url,
    }
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue> {
    const projectId = await this.getProjectId(owner, repo)

    const body: any = {}
    if (updates.title) body.title = updates.title
    if (updates.body) body.description = updates.body
    if (updates.assignees) body.assignee_ids = updates.assignees
    if (updates.labels) body.labels = updates.labels.join(",")

    const data = await this.request<any>(`/projects/${projectId}/issues/${issueNumber}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.username,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: string) => ({
        name: label,
        color: "",
        description: "",
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.web_url,
      htmlUrl: data.web_url,
    }
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const projectId = await this.getProjectId(owner, repo)

    const data = await this.request<any>(`/projects/${projectId}/issues/${issueNumber}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({state_event: "close"}),
    })

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: "closed",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      assignees: data.assignees.map((assignee: any) => ({
        login: assignee.username,
        avatarUrl: assignee.avatar_url,
      })),
      labels: data.labels.map((label: string) => ({
        name: label,
        color: "",
        description: "",
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      url: data.web_url,
      htmlUrl: data.web_url,
    }
  }

  /**
   * Comment Operations
   * GitLab uses "notes" instead of "comments"
   * API: https://docs.gitlab.com/ee/api/notes.html
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())
    params.append("sort", "asc")

    const queryString = params.toString()
    const endpoint = `/projects/${projectId}/issues/${issueNumber}/notes${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any[]>(endpoint)

    return data
      .filter(note => !note.system)
      .map(note => ({
        id: note.id,
        body: note.body || "",
        author: {
          login: note.author.username,
          avatarUrl: note.author.avatar_url,
        },
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        url: note.noteable_iid
          ? `${this.baseUrl}/projects/${projectId}/issues/${note.noteable_iid}#note_${note.id}`
          : "",
        htmlUrl: note.noteable_iid
          ? `${this.baseUrl}/projects/${projectId}/issues/${note.noteable_iid}#note_${note.id}`
          : "",
        inReplyToId: undefined,
      }))
  }

  async listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())
    params.append("sort", "asc")

    const queryString = params.toString()
    const endpoint = `/projects/${projectId}/merge_requests/${prNumber}/notes${
      queryString ? `?${queryString}` : ""
    }`

    const data = await this.request<any[]>(endpoint)

    return data
      .filter(note => !note.system)
      .map(note => ({
        id: note.id,
        body: note.body || "",
        author: {
          login: note.author.username,
          avatarUrl: note.author.avatar_url,
        },
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        url: note.noteable_iid
          ? `${this.baseUrl}/projects/${projectId}/merge_requests/${note.noteable_iid}#note_${note.id}`
          : "",
        htmlUrl: note.noteable_iid
          ? `${this.baseUrl}/projects/${projectId}/merge_requests/${note.noteable_iid}#note_${note.id}`
          : "",
        inReplyToId: undefined,
      }))
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<Comment> {
    const projectId = await this.getProjectId(owner, repo)

    const data = await this.request<any>(`/projects/${projectId}/notes/${commentId}`)

    return {
      id: data.id,
      body: data.body || "",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.noteable_iid
        ? `${this.baseUrl}/projects/${projectId}/issues/${data.noteable_iid}#note_${data.id}`
        : "",
      htmlUrl: data.noteable_iid
        ? `${this.baseUrl}/projects/${projectId}/issues/${data.noteable_iid}#note_${data.id}`
        : "",
      inReplyToId: undefined,
    }
  }

  /**
   * Pull Request Operations (GitLab calls them Merge Requests)
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions,
  ): Promise<PullRequest[]> {
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (options?.state) params.append("state", options.state)
    if (options?.head) params.append("source_branch", options.head)
    if (options?.base) params.append("target_branch", options.base)
    if (options?.sort) params.append("order_by", options.sort)
    if (options?.direction) params.append("sort", options.direction)
    if (options?.per_page) params.append("per_page", options.per_page.toString())
    if (options?.page) params.append("page", options.page.toString())

    const queryString = params.toString()
    const endpoint = `/projects/${projectId}/merge_requests${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any[]>(endpoint)

    return data.map(mr => ({
      id: mr.iid,
      number: mr.iid,
      title: mr.title,
      body: mr.description || "",
      state: mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : "open",
      author: {
        login: mr.author.username,
        avatarUrl: mr.author.avatar_url,
      },
      head: {
        ref: mr.source_branch,
        sha: mr.sha,
        repo: {
          name: mr.source_project_id.toString(),
          owner: owner,
        },
      },
      base: {
        ref: mr.target_branch,
        sha: mr.target_project_id.toString(),
        repo: {
          name: repo,
          owner: owner,
        },
      },
      mergeable: mr.merge_status === "can_be_merged",
      merged: mr.state === "merged",
      mergedAt: mr.merged_at,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      url: mr.web_url,
      htmlUrl: mr.web_url,
      diffUrl: `${mr.web_url}.diff`,
      patchUrl: `${mr.web_url}.patch`,
    }))
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any>(`/projects/${projectId}/merge_requests/${prNumber}`)

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "merged" ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      head: {
        ref: data.source_branch,
        sha: data.sha,
        repo: {
          name: data.source_project_id.toString(),
          owner: owner,
        },
      },
      base: {
        ref: data.target_branch,
        sha: data.target_project_id.toString(),
        repo: {
          name: repo,
          owner: owner,
        },
      },
      mergeable: data.merge_status === "can_be_merged",
      merged: data.state === "merged",
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.web_url,
      htmlUrl: data.web_url,
      diffUrl: `${data.web_url}.diff`,
      patchUrl: `${data.web_url}.patch`,
    }
  }

  async createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest> {
    const projectId = await this.getProjectId(owner, repo)

    const data = await this.request<any>(`/projects/${projectId}/merge_requests`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        title: pr.title,
        description: pr.body,
        source_branch: pr.head,
        target_branch: pr.base,
        remove_source_branch: false,
      }),
    })

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "merged" ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      head: {
        ref: data.source_branch,
        sha: data.sha,
        repo: {
          name: data.source_project_id.toString(),
          owner: owner,
        },
      },
      base: {
        ref: data.target_branch,
        sha: data.target_project_id.toString(),
        repo: {
          name: repo,
          owner: owner,
        },
      },
      mergeable: data.merge_status === "can_be_merged",
      merged: data.state === "merged",
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.web_url,
      htmlUrl: data.web_url,
      diffUrl: `${data.web_url}.diff`,
      patchUrl: `${data.web_url}.patch`,
    }
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    const projectId = await this.getProjectId(owner, repo)

    const body: any = {}
    if (updates.title) body.title = updates.title
    if (updates.body) body.description = updates.body
    if (updates.head) body.source_branch = updates.head
    if (updates.base) body.target_branch = updates.base

    const data = await this.request<any>(`/projects/${projectId}/merge_requests/${prNumber}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    return {
      id: data.iid,
      number: data.iid,
      title: data.title,
      body: data.description || "",
      state: data.state === "merged" ? "merged" : data.state === "closed" ? "closed" : "open",
      author: {
        login: data.author.username,
        avatarUrl: data.author.avatar_url,
      },
      head: {
        ref: data.source_branch,
        sha: data.sha,
        repo: {
          name: data.source_project_id.toString(),
          owner: owner,
        },
      },
      base: {
        ref: data.target_branch,
        sha: data.target_project_id.toString(),
        repo: {
          name: repo,
          owner: owner,
        },
      },
      mergeable: data.merge_status === "can_be_merged",
      merged: data.state === "merged",
      mergedAt: data.merged_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      url: data.web_url,
      htmlUrl: data.web_url,
      diffUrl: `${data.web_url}.diff`,
      patchUrl: `${data.web_url}.patch`,
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
    const projectId = await this.getProjectId(owner, repo)

    const body: any = {}
    if (options?.commitTitle) body.merge_commit_message = options.commitTitle
    if (options?.mergeMethod === "squash") body.squash = true
    if (options?.mergeMethod === "rebase") body.merge_when_pipeline_succeeds = true

    await this.request(`/projects/${projectId}/merge_requests/${prNumber}/merge`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    })

    // Return updated MR after merge
    return this.getPullRequest(owner, repo, prNumber)
  }

  /**
   * Patch Operations (GitLab doesn't have native patch support, so we use MRs)
   */
  async listPatches(owner: string, repo: string): Promise<Patch[]> {
    const mrs = await this.listPullRequests(owner, repo)

    return mrs.map(mr => ({
      id: mr.id.toString(),
      title: mr.title,
      description: mr.body,
      author: mr.author,
      commits: [],
      files: [],
      createdAt: mr.createdAt,
      updatedAt: mr.updatedAt,
    }))
  }

  async getPatch(owner: string, repo: string, patchId: string): Promise<Patch> {
    const mr = await this.getPullRequest(owner, repo, parseInt(patchId))

    return {
      id: mr.id.toString(),
      title: mr.title,
      description: mr.body,
      author: mr.author,
      commits: [],
      files: [],
      createdAt: mr.createdAt,
      updatedAt: mr.updatedAt,
    }
  }

  /**
   * User Operations
   */
  async getCurrentUser(): Promise<User> {
    const data = await this.request<any>("/user")

    return {
      login: data.username,
      id: data.id,
      avatarUrl: data.avatar_url,
      name: data.name,
      email: data.email,
      bio: data.bio,
      company: data.organization,
      location: data.location,
      blog: data.website_url,
      htmlUrl: data.web_url,
    }
  }

  async getUser(username: string): Promise<User> {
    const data = await this.request<any>(`/users?username=${username}`)
    const user = data[0] // GitLab returns array for user search

    return {
      login: user.username,
      id: user.id,
      avatarUrl: user.avatar_url,
      name: user.name,
      email: user.email,
      bio: user.bio,
      company: user.organization,
      location: user.location,
      blog: user.website_url,
      htmlUrl: user.web_url,
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
    const projectId = await this.getProjectId(owner, repo)

    const params = new URLSearchParams()
    if (ref) params.append("ref", ref)

    const queryString = params.toString()
    const encodedPath = encodeURIComponent(path)
    const endpoint = `/projects/${projectId}/repository/files/${encodedPath}${queryString ? `?${queryString}` : ""}`

    const data = await this.request<any>(endpoint)

    return {
      content: data.content,
      encoding: data.encoding,
      sha: data.blob_id,
    }
  }

  /**
   * Branch Operations
   */
  async listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any[]>(`/projects/${projectId}/repository/branches`)

    return data.map(branch => ({
      name: branch.name,
      commit: {
        sha: branch.commit.id,
        url: branch.commit.web_url,
      },
    }))
  }

  async getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}> {
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any>(
      `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`,
    )

    return {
      name: data.name,
      commit: {
        sha: data.commit.id,
        url: data.commit.web_url,
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
    const projectId = await this.getProjectId(owner, repo)
    try {
      const data = await this.request<any>(
        `/projects/${projectId}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(sha)}`,
        {method: "POST"},
      )

      return {
        name: data.name,
        commit: {
          sha: data.commit?.id || sha,
          url: data.commit?.web_url || "",
        },
        protected: data.protected,
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
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any[]>(`/projects/${projectId}/repository/tags`)

    return data.map(tag => ({
      name: tag.name,
      commit: {
        sha: tag.commit.id,
        url: tag.commit.web_url,
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
    const projectId = await this.getProjectId(owner, repo)
    const data = await this.request<any>(
      `/projects/${projectId}/repository/tags/${encodeURIComponent(tag)}`,
    )

    return {
      name: data.name,
      commit: {
        sha: data.commit.id,
        url: data.commit.web_url,
      },
      zipballUrl: `${this.baseUrl}/projects/${projectId}/repository/archive.zip?sha=${tag}`,
      tarballUrl: `${this.baseUrl}/projects/${projectId}/repository/archive.tar.gz?sha=${tag}`,
    }
  }
}
