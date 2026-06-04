/**
 * GRASP REST API Implementation
 *
 * Implements the GitServiceApi interface using the grasp relay REST API
 * for querying repository data without cloning. This is an alternative to
 * the Smart HTTP + Nostr event-based approach in grasp.ts.
 *
 * Based on @fiatjaf/git-natural-api
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
import {nip19} from "nostr-tools"
import {toNpub} from "../../utils/nostr-pubkey.js"
import {
  createInvalidInputError,
  createRepoNotFoundError,
  type GitErrorContext,
} from "../../errors/index.js"

/**
 * Git object types from packfile format
 */
enum GitObjectType {
  Commit = 1,
  Tree = 2,
  Blob = 3,
  Tag = 4,
  OfsDelta = 6,
  RefDelta = 7,
}

interface ParsedObject {
  type: GitObjectType
  size: number
  data: Uint8Array
  offset: number
  hash: string
}

interface TreeEntry {
  path: string
  mode: string
  isDir: boolean
  hash: string
}

interface Tree {
  directories: Array<{
    name: string
    hash: string
    content: Tree | null
  }>
  files: Array<{
    name: string
    hash: string
    content: Uint8Array | null
  }>
}

interface InfoRefsResponse {
  refs: Record<string, string>
  capabilities: string[]
  symrefs: Record<string, string>
}

interface CommitData {
  hash: string
  tree: string
  parents: string[]
  author: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  committer: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  message: string
}

/**
 * GRASP REST API client implementing GitServiceApi
 */
export class GraspRestApiProvider implements GitServiceApi {
  private readonly baseUrl: string
  private readonly pubkey: string

  constructor(baseUrl: string, pubkey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.pubkey = pubkey
  }

  /**
   * Get repository information from info/refs endpoint
   */
  private async getInfoRefs(owner: string, repo: string): Promise<InfoRefsResponse> {
    const npub = toNpub(owner)
    const url = `${this.baseUrl}/${npub}/${repo}.git/info/refs?service=git-upload-pack`

    const response = await fetch(url)
    if (!response.ok) {
      throw createRepoNotFoundError(this.buildContext({remote: url, operation: "getInfoRefs"}))
    }

    const text = await response.text()
    const result: InfoRefsResponse = {
      refs: {},
      capabilities: [],
      symrefs: {},
    }

    const lines = text.split("\n").filter(line => line.length > 0)
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]

      if (line.startsWith("0000")) line = line.slice(4)

      const length = parseInt(line.substring(0, 4), 16)
      if (isNaN(length)) continue

      const content = line.substring(4, length)

      if (i === 0 && content.startsWith("# service=")) {
        continue
      }

      if (content.includes(" ")) {
        const parts = content.split(" ")
        const hash = parts[0]
        const refAndCaps = parts.slice(1).join(" ")

        if (refAndCaps.includes("\0")) {
          const [ref, capsString] = refAndCaps.split("\0")
          result.refs[ref.trim()] = hash

          const caps = capsString.trim().split(" ")
          result.capabilities = caps

          caps.forEach(cap => {
            if (cap.startsWith("symref=")) {
              const symrefData = cap.substring(7)
              const [from, to] = symrefData.split(":")
              result.symrefs[from] = to
            }
          })
        } else {
          result.refs[refAndCaps.trim()] = hash
        }
      }
    }

    return result
  }

  /**
   * Parse commit data from raw bytes
   */
  private parseCommit(data: Uint8Array, hash: string): CommitData {
    const decoder = new TextDecoder("utf-8")
    const content = decoder.decode(data)

    const headerEndIndex = content.indexOf("\n\n")
    if (headerEndIndex === -1) {
      throw new Error(`Invalid commit format for ${hash}: no message separator found`)
    }

    const header = content.slice(0, headerEndIndex)
    const message = content.slice(headerEndIndex + 2)

    const lines = header.split("\n")
    const result: Partial<CommitData> = {
      hash,
      parents: [],
      message,
    }

    for (const line of lines) {
      if (line.startsWith("tree ")) {
        result.tree = line.slice(5)
      } else if (line.startsWith("parent ")) {
        result.parents = result.parents || []
        result.parents.push(line.slice(7))
      } else if (line.startsWith("author ")) {
        result.author = this.parsePerson(line.slice(7))
      } else if (line.startsWith("committer ")) {
        result.committer = this.parsePerson(line.slice(10))
      }
    }

    if (!result.tree || !result.author || !result.committer) {
      throw new Error(`Invalid commit format for ${hash}`)
    }

    return result as CommitData
  }

  /**
   * Parse author/committer line
   */
  private parsePerson(line: string): {
    name: string
    email: string
    timestamp: number
    timezone: string
  } {
    const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
    if (!match) {
      throw new Error(`Invalid person format: ${line}`)
    }

    return {
      name: match[1],
      email: match[2],
      timestamp: parseInt(match[3], 10),
      timezone: match[4],
    }
  }

  /**
   * Get default branch from HEAD symref
   */
  private getDefaultBranch(info: InfoRefsResponse): string {
    const headRef = info.symrefs["HEAD"]
    if (headRef && headRef.startsWith("refs/heads/")) {
      return headRef.slice(11)
    }
    return "main"
  }

  private buildContext(context: GitErrorContext): GitErrorContext {
    return {...context}
  }

  /**
   * Repository Operations
   */
  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    const info = await this.getInfoRefs(owner, repo)
    const npub = toNpub(owner)
    const defaultBranch = this.getDefaultBranch(info)

    return {
      id: `${npub}/${repo}`,
      name: repo,
      fullName: `${npub}/${repo}`,
      description: undefined,
      defaultBranch,
      isPrivate: false,
      cloneUrl: `${this.baseUrl}/${npub}/${repo}.git`,
      htmlUrl: `${this.baseUrl}/${npub}/${repo}`,
      owner: {login: npub, type: "User"},
    }
  }

  async createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata> {
    throw createInvalidInputError(
      "GRASP REST API does not support creating repositories. Use the event-based GRASP API instead.",
      this.buildContext({operation: "createRepo"}),
    )
  }

  async updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata> {
    throw createInvalidInputError(
      "GRASP REST API does not support updating repositories. Use the event-based GRASP API instead.",
      this.buildContext({operation: "updateRepo"}),
    )
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    throw createInvalidInputError(
      "GRASP REST API does not support deleting repositories. Use the event-based GRASP API instead.",
      this.buildContext({operation: "deleteRepo"}),
    )
  }

  async forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata> {
    throw createInvalidInputError(
      "GRASP REST API does not support forking repositories. Use the event-based GRASP API instead.",
      this.buildContext({operation: "forkRepo"}),
    )
  }

  /**
   * Commit Operations
   */
  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
    throw createInvalidInputError(
      "GRASP REST API commit listing not yet implemented. Use the event-based GRASP API instead.",
      this.buildContext({operation: "listCommits"}),
    )
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    throw createInvalidInputError(
      "GRASP REST API commit retrieval not yet implemented. Use the event-based GRASP API instead.",
      this.buildContext({operation: "getCommit"}),
    )
  }

  /**
   * Issue Operations
   */
  async listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    throw createInvalidInputError(
      "GRASP REST API does not support issues. Use Nostr events for issue tracking.",
      this.buildContext({operation: "listIssues"}),
    )
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    throw createInvalidInputError(
      "GRASP REST API does not support issues. Use Nostr events for issue tracking.",
      this.buildContext({operation: "getIssue"}),
    )
  }

  async createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue> {
    throw createInvalidInputError(
      "GRASP REST API does not support issues. Use Nostr events for issue tracking.",
      this.buildContext({operation: "createIssue"}),
    )
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue> {
    throw createInvalidInputError(
      "GRASP REST API does not support issues. Use Nostr events for issue tracking.",
      this.buildContext({operation: "updateIssue"}),
    )
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    throw createInvalidInputError(
      "GRASP REST API does not support issues. Use Nostr events for issue tracking.",
      this.buildContext({operation: "closeIssue"}),
    )
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
    throw createInvalidInputError(
      "GRASP REST API does not support comments. Use Nostr events for comments.",
      this.buildContext({operation: "listIssueComments"}),
    )
  }

  async listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    throw createInvalidInputError(
      "GRASP REST API does not support comments. Use Nostr events for comments.",
      this.buildContext({operation: "listPullRequestComments"}),
    )
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<Comment> {
    throw createInvalidInputError(
      "GRASP REST API does not support comments. Use Nostr events for comments.",
      this.buildContext({operation: "getComment"}),
    )
  }

  /**
   * Pull Request Operations
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions,
  ): Promise<PullRequest[]> {
    throw createInvalidInputError(
      "GRASP REST API does not support pull requests. Use Nostr pull request events.",
      this.buildContext({operation: "listPullRequests"}),
    )
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    throw createInvalidInputError(
      "GRASP REST API does not support pull requests. Use Nostr pull request events.",
      this.buildContext({operation: "getPullRequest"}),
    )
  }

  async createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest> {
    throw createInvalidInputError(
      "GRASP REST API does not support pull requests. Use Nostr pull request events.",
      this.buildContext({operation: "createPullRequest"}),
    )
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    throw createInvalidInputError(
      "GRASP REST API does not support pull requests. Use Nostr pull request events.",
      this.buildContext({operation: "updatePullRequest"}),
    )
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
    throw createInvalidInputError(
      "GRASP REST API does not support pull requests. Use Nostr pull request events.",
      this.buildContext({operation: "mergePullRequest"}),
    )
  }

  /**
   * Patch Operations
   */
  async listPatches(owner: string, repo: string): Promise<Patch[]> {
    throw createInvalidInputError(
      "GRASP REST API does not support patches. Legacy Nostr patch events have been removed.",
      this.buildContext({operation: "listPatches"}),
    )
  }

  async getPatch(owner: string, repo: string, patchId: string): Promise<Patch> {
    throw createInvalidInputError(
      "GRASP REST API does not support patches. Legacy Nostr patch events have been removed.",
      this.buildContext({operation: "getPatch"}),
    )
  }

  /**
   * User Operations
   */
  async getCurrentUser(): Promise<User> {
    const npub = toNpub(this.pubkey)
    return {
      login: npub,
      id: parseInt(this.pubkey.slice(-8), 16),
      avatarUrl: "",
      name: undefined,
      email: undefined,
      bio: undefined,
      company: undefined,
      location: undefined,
      blog: undefined,
      htmlUrl: `${this.baseUrl}/users/${npub}`,
    }
  }

  async getUser(username: string): Promise<User> {
    let pubkey: string
    try {
      const decoded = nip19.decode(username)
      if (decoded.type !== "npub") {
        throw new Error("Invalid npub format")
      }
      pubkey = decoded.data
    } catch (error) {
      throw createInvalidInputError(
        `Invalid user identifier: ${username}`,
        this.buildContext({operation: "getUser"}),
      )
    }

    return {
      login: username,
      id: parseInt(pubkey.slice(-8), 16),
      avatarUrl: "",
      name: undefined,
      email: undefined,
      bio: undefined,
      company: undefined,
      location: undefined,
      blog: undefined,
      htmlUrl: `${this.baseUrl}/users/${username}`,
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
    throw createInvalidInputError(
      "GRASP REST API file content retrieval not yet implemented. Use the event-based GRASP API instead.",
      this.buildContext({operation: "getFileContent"}),
    )
  }

  /**
   * Branch Operations
   */
  async listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const info = await this.getInfoRefs(owner, repo)
    const npub = toNpub(owner)
    const branches: Array<{name: string; commit: {sha: string; url: string}}> = []

    for (const [ref, sha] of Object.entries(info.refs)) {
      if (ref.startsWith("refs/heads/")) {
        const branchName = ref.slice(11)
        branches.push({
          name: branchName,
          commit: {
            sha,
            url: `${this.baseUrl}/${npub}/${repo}/commit/${sha}`,
          },
        })
      }
    }

    return branches
  }

  async getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}> {
    const branches = await this.listBranches(owner, repo)
    const found = branches.find(b => b.name === branch)

    if (!found) {
      throw createInvalidInputError(
        `Branch not found: ${branch}`,
        this.buildContext({operation: "getBranch", remote: `${owner}/${repo}`}),
      )
    }

    return {
      ...found,
      protected: false,
    }
  }

  /**
   * Tag Operations
   */
  async listTags(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    const info = await this.getInfoRefs(owner, repo)
    const npub = toNpub(owner)
    const tags: Array<{name: string; commit: {sha: string; url: string}}> = []

    for (const [ref, sha] of Object.entries(info.refs)) {
      if (ref.startsWith("refs/tags/")) {
        const tagName = ref.slice(10)
        tags.push({
          name: tagName,
          commit: {
            sha,
            url: `${this.baseUrl}/${npub}/${repo}/commit/${sha}`,
          },
        })
      }
    }

    return tags
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
    const tags = await this.listTags(owner, repo)
    const found = tags.find(t => t.name === tag)

    if (!found) {
      throw createInvalidInputError(
        `Tag not found: ${tag}`,
        this.buildContext({operation: "getTag", remote: `${owner}/${repo}`}),
      )
    }

    const npub = toNpub(owner)
    return {
      ...found,
      zipballUrl: `${this.baseUrl}/${npub}/${repo}/archive/${tag}.zip`,
      tarballUrl: `${this.baseUrl}/${npub}/${repo}/archive/${tag}.tar.gz`,
    }
  }
}
