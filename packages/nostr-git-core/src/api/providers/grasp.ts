/**
 * GRASP Git Relay API Implementation
 *
 * Implements the GitServiceApi interface for GRASP (Git Relays Authorized via Signed-Nostr Proofs).
 * Uses Nostr for authorization and coordination, with Git repositories hosted over Smart HTTP.
 *
 * GRASP Specification: https://github.com/nostr-protocol/nips/pull/XXX
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
import {nip19, SimplePool} from "nostr-tools"
import {toNpub, toHexPubkey} from "../../utils/nostr-pubkey.js"
import type {NostrFilter, EventIO} from "../../types/index.js"
import {createRepoStateEvent, getTagValue, getTags} from "../../events/index.js"
import {
  fetchRelayInfo,
  graspCapabilities as detectCapabilities,
  normalizeHttpOrigin,
  type GraspCapabilities,
  type RelayInfo,
} from "./grasp-capabilities.js"
import {encodeRepoAddress, getDefaultBranchFromHead} from "./grasp-state.js"
import {createMemFs} from "./grasp-fs.js"
import * as git from "isomorphic-git"
// @ts-ignore - isomorphic-git/http/web has type issues
import http from "isomorphic-git/http/web"
import type {Event as NostrEvent} from "nostr-tools"

import type {RepoState} from "../../events/index.js"

/**
 * GRASP Git Relay API Implementation
 *
 * Implements the GitServiceApi interface for GRASP (Git Relays Authorized via Signed-Nostr Proofs).
 * Uses Nostr for authorization and coordination, with Git repositories hosted over Smart HTTP.
 *
 */

/**
 * GRASP API client implementing GitServiceApi
 */
export class GraspApiProvider implements GitServiceApi {
  private capabilities?: GraspCapabilities
  private httpBase?: string
  private readonly relayUrl: string
  private readonly pubkey: string
  private relayInfo?: RelayInfo
  private pool: SimplePool = new SimplePool()
  private eventIO?: EventIO

  constructor(relayUrl: string, pubkey: string, io?: EventIO) {
    // Normalize to base ws(s) origin with no path
    let normalized = relayUrl.replace(/\/$/, "")
    try {
      const u = new URL(relayUrl)
      const origin = `${u.protocol}//${u.host}`
      normalized = origin.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")
    } catch {
      normalized = relayUrl
        .replace(/^http:\/\//, "ws://")
        .replace(/^https:\/\//, "wss://")
        .replace(/(ws[s]?:\/\/[^/]+).*/, "$1")
    }
    this.relayUrl = normalized
    this.pubkey = pubkey
    this.eventIO = io
  }

  /**
   * Load NIP-11 info and capability metadata for relay, caching results.
   * Mirrors logic from ngit to establish smart-HTTP and GRASP support.
   */
  private async ensureCapabilities(force = false): Promise<void> {
    if (this.capabilities && this.httpBase && !force) return
    try {
      // Mirrors ngit client.rs: uses NIP-11 to get relay info and advertise smart_http endpoints
      const info = await fetchRelayInfo(this.relayUrl)
      this.capabilities = detectCapabilities(info, this.relayUrl)
      // Prefer spec root origin (no path) first; use pathful as fallback only
      const origins = this.capabilities.httpOrigins || []
      const root = origins.find(o => {
        try {
          const u = new URL(o)
          return !u.pathname || u.pathname === "/"
        } catch {
          return false
        }
      })
      const pathful = origins.find(o => {
        try {
          const u = new URL(o)
          return u.pathname && u.pathname !== "/"
        } catch {
          return false
        }
      })
      this.httpBase = root || pathful || origins[0] || normalizeHttpOrigin(this.relayUrl)
      this.relayInfo = info
    } catch (err) {
      console.warn("Failed to ensure capabilities:", err)
      // Fallback: derive capabilities heuristically from relay URL
      this.capabilities = detectCapabilities({} as any, this.relayUrl)
      const origins = this.capabilities.httpOrigins || []
      const root = origins.find(o => {
        try {
          const u = new URL(o)
          return !u.pathname || u.pathname === "/"
        } catch {
          return false
        }
      })
      const pathful = origins.find(o => {
        try {
          const u = new URL(o)
          return u.pathname && u.pathname !== "/"
        } catch {
          return false
        }
      })
      this.httpBase = root || pathful || origins[0] || normalizeHttpOrigin(this.relayUrl)
    }
  }

  /** Determine if a relay URL is suitable for Nostr relay connections */
  private isValidNostrRelayUrl(url: string): boolean {
    try {
      const u = new URL(url)
      if (!(u.protocol === "ws:" || u.protocol === "wss:")) return false
      const host = u.hostname.toLowerCase()
      // Allow localhost and loopback
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true
      // Require a dot in hostname for public hosts (rudimentary check)
      return host.includes(".")
    } catch {
      return false
    }
  }

  /**
   * Check if GRASP is supported by the relay
   */
  private async isGraspSupported(): Promise<boolean> {
    await this.ensureCapabilities()
    return this.relayInfo?.supported_grasps?.includes("GRASP-01") || false
  }

  /**
   * Make authenticated Git Smart HTTP request
   */
  private async gitRequest(
    npub: string,
    repo: string,
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    await this.ensureCapabilities()
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const gitUrl = `${httpOrigin}/${npub}/${repo}.git${endpoint}`

    return fetch(gitUrl, {
      ...options,
      mode: "cors",
      credentials: "omit",
      // Mirrors ngit (fetch.rs/push.rs) which relies on server CORS and does not set forbidden headers
      // Do not set User-Agent header in browsers.
      headers: {
        ...(options.headers || {}),
      },
    })
  }

  /**
   * Publish Nostr event to relay - CLEAN VERSION
   * Uses EventIO which handles signing internally - no more signer passing!
   */
  /**
   * Get current GRASP capabilities of the relay
   */
  public async getCapabilities(): Promise<GraspCapabilities> {
    await this.ensureCapabilities()
    return this.capabilities!
  }

  /**
   * Get relay information via NIP-11
   */
  public async getRelayInfo(): Promise<RelayInfo> {
    await this.ensureCapabilities()
    return this.relayInfo ?? {}
  }

  /**
   * Repository Operations
   */
  // Parse kind 31990 repo state event into head + refs
  // Mirrors ngit repo_state.rs::try_from
  private parseRepoStateFromEvent(ev: NostrEvent | any): {
    head?: string
    refs: Record<string, string>
  } {
    const tags: string[][] = ev?.tags || []
    const refs: Record<string, string> = {}
    let head: string | undefined
    for (const t of tags) {
      if (t[0] === "HEAD" && t[1]) head = t[1]
      if (t[0] === "ref" && t[1] && t[2]) refs[t[1]] = t[2]
    }
    return {head, refs}
  }

  // Fetch latest repo state via nostr
  // Mirrors ngit client.rs::get_state_from_cache with network fallback
  // NOTE: ngit uses STATE_KIND = 30618
  private async fetchLatestState(
    owner: string,
    repo: string,
  ): Promise<{head?: string; refs: Record<string, string>} | null> {
    const npub = toNpub(owner)
    const addr = `${npub}:${repo}`
    try {
      const events = await this.queryEvents([{kinds: [30618], "#a": [addr], limit: 1}])
      const ev = events?.[0]
      if (!ev) return null
      return this.parseRepoStateFromEvent(ev)
    } catch {
      return null
    }
  }

  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    // Mirrors ngit repo_ref.rs::get_repo_coordinates_when_remote_unknown + repo_state.rs
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const webUrl = `${httpOrigin}/${npub}/${repo}`
    const cloneUrl = `${webUrl}.git`

    // Fetch announcement and state in parallel
    const [ann, st] = await Promise.all([
      (async () => {
        try {
          const evs = await this.queryEvents([
            {kinds: [30617], authors: [toHexPubkey(owner)], "#d": [repo], limit: 1},
          ])
          return evs?.[0] ?? null
        } catch {
          return null
        }
      })(),
      this.fetchLatestState(owner, repo),
    ])

    const description = ann
      ? (() => {
          try {
            return JSON.parse(ann.content)?.description ?? undefined
          } catch {
            return undefined
          }
        })()
      : undefined
    const defaultBranch = getDefaultBranchFromHead(st?.head || "")

    return {
      id: `${npub}/${repo}`,
      name: repo,
      fullName: `${npub}/${repo}`,
      description,
      // Do not hardcode a default branch; only set if present in state
      defaultBranch: defaultBranch || "",
      isPrivate: false,
      cloneUrl,
      htmlUrl: webUrl,
      owner: {login: npub, type: "User"},
    }
  }

  async publishStateFromLocal(
    owner: string,
    repo: string,
    opts?: {includeTags?: boolean; prevEventId?: string},
  ): Promise<NostrEvent | null> {
    await this.ensureCapabilities()
    if (!this.capabilities?.grasp01) {
      // Mirrors ngit client.rs::supported_grasps behavior
      console.warn("Relay does not support GRASP-01")
      return null
    }
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      // Mirrors ngit repo_state.rs::build - collect refs and HEAD
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({fs, http, dir, url: remoteUrl, depth: 1})
      const branches = await git.listBranches({fs, dir})
      const tags = opts?.includeTags ? await git.listTags({fs, dir}) : []
      const refs: Record<string, string> = {}
      for (const b of branches) {
        try {
          refs[`refs/heads/${b}`] = await git.resolveRef({fs, dir, ref: `refs/heads/${b}`})
        } catch {}
      }
      if (opts?.includeTags) {
        for (const t of tags) {
          try {
            refs[`refs/tags/${t}`] = await git.resolveRef({fs, dir, ref: `refs/tags/${t}`})
          } catch {}
        }
      }
      let headRef: string | undefined
      try {
        const resolvedHead = await git.resolveRef({fs, dir, ref: "HEAD"})
        headRef = resolvedHead.startsWith("refs/") ? resolvedHead : `refs/heads/${resolvedHead}`
      } catch {}

      const event = createRepoStateEvent({
        // Mirrors ngit repo_state.rs address tag: "a" -> "<npub>:<repo>"
        repoId: encodeRepoAddress(toHexPubkey(owner), repo),
        head: headRef,
        refs: Object.entries(refs).map(([ref, commit]) => ({
          type: ref.startsWith("refs/heads/") ? "heads" : "tags",
          name: ref, // keep full ref path; shared-types flattener will handle
          commit,
        })),
      })
      if (headRef && !event.tags.find(t => t[0] === "HEAD")) {
        // shared-types expects HEAD tag value in the form `ref: refs/heads/<branch>`
        // Mirrors ngit repo_state.rs::add_head
        event.tags.push(["HEAD", `ref: ${headRef}` as any])
      }
      // If an EventIO is injected, publish directly; otherwise return unsigned for the UI to handle.
      // Mirrors ngit architectural flexibility where publishing lives in client layer (client.rs)
      if (this.eventIO?.publishEvent) {
        try {
          await this.eventIO.publishEvent(event as any)
        } catch (e) {
          console.warn("EventIO.publishEvent failed; returning unsigned event instead", e)
          return event as unknown as NostrEvent
        }
      }
      return event as unknown as NostrEvent
    } catch (err) {
      console.error("publishStateFromLocal failed:", err)
      throw new Error(`Failed to build state event: ${err}`)
    }
  }

  async createRepo(options: {
    name: string
    description?: string
    private?: boolean
    autoInit?: boolean
  }): Promise<RepoMetadata> {
    // NOTE: Event publishing moved to UI layer (useNewRepo.svelte.ts).
    // This method now only constructs metadata and Smart HTTP URLs.
    // The UI layer must publish RepoAnnouncementEvent and RepoStateEvent before calling this.

    console.log("[GraspApiProvider] createRepo - pubkey:", this.pubkey)
    console.log("[GraspApiProvider] createRepo - pubkey length:", this.pubkey.length)
    console.log("[GraspApiProvider] createRepo - pubkey type:", typeof this.pubkey)

    await this.ensureCapabilities()
    const npub = toNpub(this.pubkey)
    console.log("[GraspApiProvider] createRepo - npub:", npub)

    // Use derived Smart HTTP base from NIP-11 (may include path like /git). Mirrors ngit client.rs discovery
    const httpBase = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    console.log("[GraspApiProvider] createRepo - httpBase:", httpBase)

    const webUrl = `${httpBase}/${npub}/${options.name}` // no .git
    const cloneUrl = `${webUrl}.git`
    console.log("[GraspApiProvider] createRepo - webUrl:", webUrl)
    console.log("[GraspApiProvider] createRepo - cloneUrl:", cloneUrl)
    // Gather relay aliases: base relay plus optional configured aliases
    const aliases: string[] = []
    // base ws(s) relay
    aliases.push(this.relayUrl)
    // de-duplicate while preserving order
    const seen = new Set<string>()
    // Only include valid Nostr relay URLs in the relays tag to avoid adapter errors
    const relayAliases = aliases.filter(a => {
      if (seen.has(a)) return false
      seen.add(a)
      return this.isValidNostrRelayUrl(a)
    })

    const result = {
      id: "", // Will be set after event is published
      name: options.name,
      fullName: `${npub}/${options.name}`,
      description: options.description || "",
      // Do not hardcode default branch; leave empty until state/HEAD is known
      defaultBranch: "",
      isPrivate: options.private || false,
      cloneUrl: cloneUrl,
      htmlUrl: webUrl,
      owner: {
        login: npub,
        type: "User" as const,
      },
    }
    console.log("[GraspApiProvider] createRepo - returning result:", result)
    return result
  }

  async updateRepo(
    owner: string,
    repo: string,
    updates: {name?: string; description?: string; private?: boolean},
  ): Promise<RepoMetadata> {
    // NOTE: Event publishing moved to UI layer. This method requires external event data.
    throw new Error(
      "GRASP updateRepo() not supported without external EventIO. Update events via UI layer.",
    )
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    throw new Error("GRASP deleteRepo() not supported. Delete repo events via Nostr.")
  }

  async forkRepo(owner: string, repo: string, options?: GitForkOptions): Promise<RepoMetadata> {
    // NOTE: Event publishing moved to UI layer. This method requires external event data.
    throw new Error(
      "GRASP forkRepo() not supported without external EventIO. Fork repos and publish events via UI layer.",
    )
  }

  /**
   * Commit Operations
   */
  async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    // Mirrors ngit git/mod.rs::get_main_or_master_branch + traversal
    let ref = options?.sha
    if (!ref) {
      const st = await this.fetchLatestState(owner, repo)
      ref = getDefaultBranchFromHead(st?.head || "")
    }
    if (!ref) {
      throw new Error(
        "No ref provided and no HEAD in repo state. Provide options.sha or publish a state event with HEAD.",
      )
    }
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({
        fs,
        http,
        dir,
        url: remoteUrl,
        depth: options?.per_page ?? 20,
        singleBranch: true,
        ref,
      })
      const commits = await git.log({fs, dir, ref, depth: options?.per_page ?? 20})
      return commits.map((c: any) => ({
        sha: c.oid,
        url: `${remoteUrl}/commit/${c.oid}`,
        author: {
          name: c.commit.author.name,
          email: c.commit.author.email,
          date: new Date(c.commit.author.timestamp * 1000).toISOString(),
        },
        committer: {
          name: c.commit.committer.name,
          email: c.commit.committer.email,
          date: new Date(c.commit.committer.timestamp * 1000).toISOString(),
        },
        message: c.commit.message,
        parents: (c.commit.parent ?? []).map((p: string) => ({
          sha: p,
          url: `${remoteUrl}/commit/${p}`,
        })),
        htmlUrl: `${remoteUrl}/commit/${c.oid}`,
        commit: {
          message: c.commit.message,
          committer: {
            name: c.commit.committer.name,
            email: c.commit.committer.email,
            date: new Date(c.commit.committer.timestamp * 1000).toISOString(),
          },
          author: {
            name: c.commit.author.name,
            email: c.commit.author.email,
            date: new Date(c.commit.author.timestamp * 1000).toISOString(),
          },
        },
      }))
    } catch (err) {
      console.error("listCommits failed", err)
      return []
    }
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<Commit> {
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      // Mirrors ngit git/mod.rs::fetch_commit with shallow fetch
      await git.fetch({fs, http, dir, url: remoteUrl, depth: 1})
      const {commit} = await git.readCommit({fs, dir, oid: sha})
      return {
        sha,
        url: `${remoteUrl}/commit/${sha}`,
        author: {
          name: commit.author.name,
          email: commit.author.email,
          date: new Date(commit.author.timestamp * 1000).toISOString(),
        },
        committer: {
          name: commit.committer.name,
          email: commit.committer.email,
          date: new Date(commit.committer.timestamp * 1000).toISOString(),
        },
        message: commit.message,
        parents: (commit.parent ?? []).map((p: string) => ({
          sha: p,
          url: `${remoteUrl}/commit/${p}`,
        })),
        htmlUrl: `${remoteUrl}/commit/${sha}`,
      }
    } catch (err) {
      console.error("getCommit failed", err)
      throw new Error(`Failed to get commit: ${err}`)
    }
  }

  /**
   * Issue Operations
   */
  async listIssues(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    // NOTE: Nostr-based issues require external EventIO for querying.
    throw new Error(
      "GRASP listIssues() not supported without external EventIO. Query issue events via UI layer.",
    )
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const issues = await this.listIssues(owner, repo)
    const issue = issues.find(i => i.number === issueNumber)

    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`)
    }

    return issue
  }

  async createIssue(owner: string, repo: string, issue: NewIssue): Promise<Issue> {
    // NOTE: Event publishing moved to UI layer.
    throw new Error(
      "GRASP createIssue() not supported without external EventIO. Publish issue events via UI layer.",
    )
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<NewIssue>,
  ): Promise<Issue> {
    // For Nostr, we'd typically create a new event that references the original
    // This is a simplified implementation
    throw new Error("GRASP updateIssue not implemented - requires event replacement strategy")
  }

  async closeIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    // Create a close event that references the original issue
    const issue = await this.getIssue(owner, repo, issueNumber)

    // This would require finding the original event and creating a close event
    throw new Error("GRASP closeIssue not implemented - requires close event creation")
  }

  /**
   * Comment Operations (GRASP comments are NIP-22 comment events)
   * NIP-22: https://github.com/nostr-protocol/nips/blob/master/22.md
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const issue = await this.getIssue(owner, repo, issueNumber)

    const filter: NostrFilter = {
      kinds: [1111],
      "#E": [issue.url],
    }

    if (options?.since) {
      const sinceTimestamp = Math.floor(Date.parse(options.since) / 1000)
      filter.since = sinceTimestamp
    }

    const limit = options?.per_page || 100
    filter.limit = limit

    const events = await this.pool.querySync([this.relayUrl], filter)

    return events
      .sort((a, b) => a.created_at - b.created_at)
      .map(event => ({
        id: parseInt(event.id.slice(-8), 16),
        body: event.content,
        author: {
          login: event.pubkey.slice(0, 8),
          avatarUrl: "",
        },
        createdAt: new Date(event.created_at * 1000).toISOString(),
        updatedAt: new Date(event.created_at * 1000).toISOString(),
        url: `nostr:${event.id}`,
        htmlUrl: `nostr:${event.id}`,
        inReplyToId: this.getParentCommentId(event),
      }))
  }

  async listPullRequestComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ListCommentsOptions,
  ): Promise<Comment[]> {
    const pr = await this.getPullRequest(owner, repo, prNumber)

    const filter: NostrFilter = {
      kinds: [1111],
      "#E": [pr.url],
    }

    if (options?.since) {
      const sinceTimestamp = Math.floor(Date.parse(options.since) / 1000)
      filter.since = sinceTimestamp
    }

    const limit = options?.per_page || 100
    filter.limit = limit

    const events = await this.pool.querySync([this.relayUrl], filter)

    return events
      .sort((a, b) => a.created_at - b.created_at)
      .map(event => ({
        id: parseInt(event.id.slice(-8), 16),
        body: event.content,
        author: {
          login: event.pubkey.slice(0, 8),
          avatarUrl: "",
        },
        createdAt: new Date(event.created_at * 1000).toISOString(),
        updatedAt: new Date(event.created_at * 1000).toISOString(),
        url: `nostr:${event.id}`,
        htmlUrl: `nostr:${event.id}`,
        inReplyToId: this.getParentCommentId(event),
      }))
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<Comment> {
    const commentIdHex = commentId.toString(16).padStart(8, "0")

    // Note: We can't filter by exact event ID since we only have the last 8 hex chars
    // This is a limitation of the integer ID mapping. For better performance,
    // consider storing full event IDs or using a different ID scheme.
    const filter: NostrFilter = {
      kinds: [1111],
      limit: 100,
    }

    const events = await this.pool.querySync([this.relayUrl], filter)
    const event = events.find(e => e.id.endsWith(commentIdHex))

    if (!event) {
      throw new Error(`Comment ${commentId} not found`)
    }

    return {
      id: commentId,
      body: event.content,
      author: {
        login: event.pubkey.slice(0, 8),
        avatarUrl: "",
      },
      createdAt: new Date(event.created_at * 1000).toISOString(),
      updatedAt: new Date(event.created_at * 1000).toISOString(),
      url: `nostr:${event.id}`,
      htmlUrl: `nostr:${event.id}`,
      inReplyToId: this.getParentCommentId(event),
    }
  }

  /**
   * Helper to extract parent comment ID from NIP-22 comment event
   */
  private getParentCommentId(event: any): number | undefined {
    const parentTag = event.tags.find((tag: string[]) => tag[0] === "e" && tag.length > 1)
    if (parentTag && parentTag[1]) {
      return parseInt(parentTag[1].slice(-8), 16)
    }
    return undefined
  }

  /**
   * Pull Request Operations
   */
  async listPullRequests(
    owner: string,
    repo: string,
    options?: ListPullRequestsOptions,
  ): Promise<PullRequest[]> {
    throw new Error("GRASP listPullRequests() is not supported by REST endpoints. Query Nostr pull request events via the UI layer.")
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const prs = await this.listPullRequests(owner, repo)
    const pr = prs.find(p => p.number === prNumber)

    if (!pr) {
      throw new Error(`Pull request #${prNumber} not found`)
    }

    return pr
  }

  async createPullRequest(owner: string, repo: string, pr: NewPullRequest): Promise<PullRequest> {
    throw new Error("GRASP createPullRequest not implemented - publish a Nostr pull request event instead")
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    throw new Error("GRASP updatePullRequest not implemented - publish a Nostr pull request update event instead")
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
    throw new Error("GRASP mergePullRequest not implemented - publish a Nostr merged status event instead")
  }

  /**
   * Patch Operations
   */
  async listPatches(owner: string, repo: string): Promise<Patch[]> {
    throw new Error(
      "GRASP listPatches() is not supported. Legacy Nostr patch events have been removed.",
    )
  }

  async getPatch(owner: string, repo: string, patchId: string): Promise<Patch> {
    const patches = await this.listPatches(owner, repo)
    const patch = patches.find(p => p.id === patchId)

    if (!patch) {
      throw new Error(`Patch ${patchId} not found`)
    }

    return patch
  }

  /**
   * User Operations
   */
  async getCurrentUser(): Promise<User> {
    const npub = toNpub(this.pubkey)

    // Query for profile metadata (NIP-01 kind 0)
    const events = await this.queryEvents([
      {
        kinds: [0],
        authors: [this.pubkey],
        limit: 1,
      },
    ])

    let profile: any = {}
    if (events.length > 0) {
      try {
        profile = JSON.parse(events[0].content)
      } catch (error) {
        console.warn("Failed to parse profile metadata:", error)
      }
    }

    return {
      login: npub,
      id: parseInt(this.pubkey.slice(-8), 16),
      avatarUrl: profile.picture || "",
      name: profile.name,
      email: undefined, // Not typically in Nostr profiles
      bio: profile.about,
      company: undefined,
      location: undefined,
      blog: profile.website,
      htmlUrl: `${this.relayUrl}/users/${npub}`,
    }
  }

  async getUser(username: string): Promise<User> {
    // Assume username is npub format
    let pubkey: string
    try {
      const decoded = nip19.decode(username)
      if (decoded.type !== "npub") {
        throw new Error("Invalid npub format")
      }
      pubkey = decoded.data
    } catch (error) {
      throw new Error(`Invalid user identifier: ${username}`)
    }

    const events = await this.queryEvents([
      {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      },
    ])

    let profile: any = {}
    if (events.length > 0) {
      try {
        profile = JSON.parse(events[0].content)
      } catch (error) {
        console.warn("Failed to parse profile metadata:", error)
      }
    }

    return {
      login: username,
      id: parseInt(pubkey.slice(-8), 16),
      avatarUrl: profile.picture || "",
      name: profile.name,
      email: undefined,
      bio: profile.about,
      company: undefined,
      location: undefined,
      blog: profile.website,
      htmlUrl: `${this.relayUrl}/users/${username}`,
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
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      // Determine a ref to read from
      let targetRef = ref
      if (!targetRef) {
        try {
          const st = await this.fetchLatestState(owner, repo)
          targetRef = getDefaultBranchFromHead(st?.head || "") || undefined
        } catch {}
      }
      // Fetch minimal history for the target ref (or HEAD)
      await git.fetch({
        fs,
        http,
        dir,
        url: remoteUrl,
        depth: 1,
        ...(targetRef ? {ref: targetRef, singleBranch: true} : {}),
      })
      const {oid, blob} = await (git as any).readBlob({
        fs,
        dir,
        filepath: path,
        ...(targetRef ? {ref: targetRef} : {}),
      })
      const content = Buffer.from(blob as Uint8Array).toString("base64")
      return {content, encoding: "base64", sha: oid}
    } catch (err) {
      throw new Error(
        `GRASP getFileContent failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Branch Operations
   */
  async listBranches(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({fs, http, dir, url: remoteUrl, depth: 1, singleBranch: false})
      const branches = await git.listBranches({fs, dir})
      const out: Array<{name: string; commit: {sha: string; url: string}}> = []
      for (const name of branches) {
        try {
          const sha = await git.resolveRef({fs, dir, ref: `refs/heads/${name}`})
          out.push({name, commit: {sha, url: `${remoteUrl}/commit/${sha}`}})
        } catch {}
      }
      return out
    } catch (err) {
      throw new Error(
        `GRASP listBranches failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async getBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<{name: string; commit: {sha: string; url: string}; protected: boolean}> {
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({fs, http, dir, url: remoteUrl, depth: 1, ref: branch, singleBranch: true})
      const sha = await git.resolveRef({fs, dir, ref: `refs/heads/${branch}`}).catch(async () => {
        // Try symbolic HEAD style
        const head = await git.resolveRef({fs, dir, ref: "HEAD"})
        return head
      })
      return {name: branch, commit: {sha, url: `${remoteUrl}/commit/${sha}`}, protected: false}
    } catch (err) {
      throw new Error(`GRASP getBranch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Tag Operations
   */
  async listTags(
    owner: string,
    repo: string,
  ): Promise<Array<{name: string; commit: {sha: string; url: string}}>> {
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({
        fs,
        http,
        dir,
        url: remoteUrl,
        depth: 1,
        singleBranch: false,
        tags: true as any,
      })
      const tags = await git.listTags({fs, dir})
      const out: Array<{name: string; commit: {sha: string; url: string}}> = []
      for (const name of tags) {
        try {
          const sha = await git.resolveRef({fs, dir, ref: `refs/tags/${name}`})
          out.push({name, commit: {sha, url: `${remoteUrl}/commit/${sha}`}})
        } catch {}
      }
      return out
    } catch (err) {
      throw new Error(`GRASP listTags failed: ${err instanceof Error ? err.message : String(err)}`)
    }
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
    await this.ensureCapabilities()
    const npub = toNpub(owner)
    const httpOrigin = this.httpBase || normalizeHttpOrigin(this.relayUrl)
    const remoteUrl = `${httpOrigin}/${npub}/${repo}.git`
    const webUrl = `${httpOrigin}/${npub}/${repo}`
    try {
      const fs = createMemFs()
      const dir = "/grasp"
      await git.fetch({
        fs,
        http,
        dir,
        url: remoteUrl,
        depth: 1,
        singleBranch: false,
        tags: true as any,
      })
      const sha = await git.resolveRef({fs, dir, ref: `refs/tags/${tag}`})
      return {
        name: tag,
        commit: {sha, url: `${remoteUrl}/commit/${sha}`},
        zipballUrl: `${webUrl}/archive/${tag}.zip`,
        tarballUrl: `${webUrl}/archive/${tag}.tar.gz`,
      }
    } catch (err) {
      throw new Error(`GRASP getTag failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Support multiple filters and dedupe results
  // Mirrors ngit client.rs::get_events and consolidation
  async queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const all: Record<string, NostrEvent> = {}
    for (const f of filters) {
      try {
        const evs = await this.pool.querySync([this.relayUrl], f)
        for (const ev of evs as any[]) {
          if (!ev?.id) continue
          all[ev.id] = ev as NostrEvent
        }
      } catch (e) {
        console.warn("queryEvents filter failed:", f, e)
      }
    }
    return Object.values(all)
  }
}
