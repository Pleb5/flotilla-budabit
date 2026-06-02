/**
 * Unified Git Service REST API Abstraction Layer
 *
 * This interface provides a unified abstraction over different Git hosting providers
 * (GitHub, GitLab, Gitea, Bitbucket) for REST API operations like issues, commits,
 * pull requests, etc.
 *
 * This extends the existing VendorProvider system to support comprehensive
 * REST API operations beyond just repository management.
 */

import {RepoMetadata} from "../git/vendor-providers.js"

// Re-export shared types from vendor-providers for convenience
export type {GitVendor, RepoMetadata} from "../git/vendor-providers.js"

/**
 * Commit information from Git service APIs
 */
export interface Commit {
  sha: string
  message: string
  author: {
    name: string
    email: string
    date: string
  }
  committer: {
    name: string
    email: string
    date: string
  }
  url: string
  htmlUrl: string
  parents: Array<{sha: string; url: string}>
  stats?: {
    additions: number
    deletions: number
    total: number
  }
}

/**
 * Issue information from Git service APIs
 */
export interface Issue {
  id: number
  number: number
  title: string
  body: string
  state: "open" | "closed"
  author: {
    login: string
    avatarUrl?: string
  }
  assignees: Array<{
    login: string
    avatarUrl?: string
  }>
  labels: Array<{
    name: string
    color: string
    description?: string
  }>
  createdAt: string
  updatedAt: string
  closedAt?: string
  closedBy?: {
    login: string
    avatarUrl?: string
  }
  url: string
  htmlUrl: string
  /**
   * Number of comments on the issue
   * Provided by some Git service APIs (e.g., GitHub)
   */
  commentsCount?: number
  /**
   * True when this item is a pull request (GitHub/Gitea issues API returns both).
   */
  isPullRequest?: boolean
}

/**
 * Comment information from Git service APIs
 */
export interface Comment {
  id: number
  body: string
  author: {
    login: string
    avatarUrl?: string
  }
  createdAt: string
  updatedAt: string
  url: string
  htmlUrl: string
  /**
   * ID of the comment this comment is replying to (for comment threading)
   * Only present if this comment is a reply to another comment
   */
  inReplyToId?: number
}

/**
 * Parameters for listing comments
 */
export interface ListCommentsOptions {
  per_page?: number
  page?: number
  /**
   * ISO 8601 date - only return comments updated at or after this time
   * Useful for filtering comments by date during imports
   */
  since?: string
}

/**
 * Pull Request/Merge Request information
 */
export interface PullRequest {
  id: number
  number: number
  title: string
  body: string
  state: "open" | "closed" | "merged"
  author: {
    login: string
    avatarUrl?: string
  }
  head: {
    ref: string
    sha: string
    repo: {
      name: string
      owner: string
    }
  }
  base: {
    ref: string
    sha: string
    repo: {
      name: string
      owner: string
    }
  }
  mergeable?: boolean
  merged: boolean
  mergedAt?: string
  createdAt: string
  updatedAt: string
  url: string
  htmlUrl: string
  diffUrl: string
  patchUrl: string
}

/**
 * Patch/Diff information
 */
export interface Patch {
  id: string
  title: string
  description: string
  author: {
    login: string
    avatarUrl?: string
  }
  commits: Commit[]
  files: Array<{
    filename: string
    status: "added" | "modified" | "removed" | "renamed"
    additions: number
    deletions: number
    changes: number
    patch?: string
  }>
  createdAt: string
  updatedAt: string
}

/**
 * Parameters for creating a new issue
 */
export interface NewIssue {
  title: string
  body?: string
  assignees?: string[]
  labels?: string[]
}

/**
 * Parameters for creating a new pull request
 */
export interface NewPullRequest {
  title: string
  body?: string
  head: string // branch name
  base: string // target branch name
  draft?: boolean
}

/**
 * Parameters for listing commits
 */
export interface ListCommitsOptions {
  sha?: string // branch/commit to start from
  path?: string // only commits touching this path
  since?: string // ISO 8601 date
  until?: string // ISO 8601 date
  per_page?: number
  page?: number
}

/**
 * Parameters for listing issues
 */
export interface ListIssuesOptions {
  state?: "open" | "closed" | "all"
  labels?: string[]
  assignee?: string
  creator?: string
  since?: string // ISO 8601 date
  per_page?: number
  page?: number
}

/**
 * Parameters for listing pull requests
 */
export interface ListPullRequestsOptions {
  state?: "open" | "closed" | "all"
  head?: string // branch name
  base?: string // branch name
  sort?: "created" | "updated" | "popularity"
  direction?: "asc" | "desc"
  per_page?: number
  page?: number
}

/**
 * User information from Git service APIs
 */
export interface User {
  login: string
  id: number
  avatarUrl: string
  name?: string
  email?: string
  bio?: string
  company?: string
  location?: string
  blog?: string
  htmlUrl: string
}

/**
 * Repository fork options
 */
export interface GitForkOptions {
  name?: string // custom fork name
  organization?: string // fork to organization
}

/**
 * Unified Git Service API Interface
 *
 * This interface abstracts REST API operations across different Git hosting providers.
 * Each provider (GitHub, GitLab, Gitea, Bitbucket) implements this interface.
 */
export interface GitServiceApi {
  /**
   * Repository Operations
   */
  getRepo(owner: string, repo: string): Promise<RepoMetadata>
  createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata>
  updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata>
  deleteRepo(owner: string, repo: string): Promise<void>
  forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata>

  /**
   * Commit Operations
   */
  listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]>
  getCommit(owner: string, repo: string, sha: string): Promise<Commit>

  /**
   * Issue Operations
   */
  listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]>
  getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue>
  createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue>
  updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue>
  closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue>

  /**
   * Comment Operations
   */
  listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]>
  listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]>
  getComment(owner: string, repo: string, commentId: number): Promise<Comment>
  /**
   * List all issue comments for a repository (optional, more efficient for bulk imports)
   * Returns comments with issue/PR numbers attached
   * This endpoint fetches all comments for all issues and PRs in one go
   */
  listAllIssueComments?(
    owner: string,
    repo: string,
    options?: ListCommentsOptions,
  ): Promise<Array<Comment & {issueNumber: number; isPullRequest: boolean}>>

  /**
   * Pull Request Operations
   */
  listPullRequests(
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions,
  ): Promise<PullRequest[]>
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>
  /**
   * List commits that are part of a pull request (optional; not all providers implement this).
   * Returns commits in the PR that are not in the base branch, in chronological order.
   */
  listPullRequestCommits?(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {per_page?: number; page?: number},
  ): Promise<Commit[]>
  createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest>
  updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest>
  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {
      commitTitle?: string
      commitMessage?: string
      mergeMethod?: "merge" | "squash" | "rebase"
    },
  ): Promise<PullRequest>

  /**
   * Patch Operations (for services that support patch-based workflows)
   */
  listPatches(owner: string, repo: string): Promise<Patch[]>
  getPatch(owner: string, repo: string, patchId: string): Promise<Patch>

  /**
   * User Operations
   */
  getCurrentUser(): Promise<User>
  getUser(username: string): Promise<User>

  /**
   * Repository Content Operations
   */
  getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{content: string; encoding: string; sha: string}>

  /**
   * Branch Operations
   */
  listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>>
  getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}>
  /**
   * Create or update a branch ref to point at the provided commit SHA.
   * Optional because not every provider exposes a compatible endpoint.
   */
  upsertBranchRef?(
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected?: boolean}>

  /**
   * Tag Operations
   */
  listTags(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>>
  getTag(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<{
    name: string
    commit: {sha: string; url: string}
    zipballUrl: string
    tarballUrl: string
  }>
}
