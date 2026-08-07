/**
 * NostrGitProvider - Core Provider for Nostr Git Operations
 *
 * This provider integrates with the upgraded @nostr-git/git-wrapper package to provide
 * full GRASP support, multi-relay coordination, and ngit-compatible functionality.
 */

import type {GitProvider, HttpOverrides} from "../../git/provider.js"
import type {BlossomPushSummary} from "../../blossom/index.js"
import {createGitProvider} from "../../git/factory.js"
import type {EventIO, PublishResult} from "../../types/index.js"
import type {RepoAnnouncementEvent, RepoStateEvent} from "../../events/index.js"
import {getTags} from "../../events/index.js"
import {sanitizeRelays} from "../../utils/sanitize-relays.js"
import {getRepoActivityRelays} from "../../utils/repo-relay-policy.js"
import {isGraspRepoHttpUrl} from "../../utils/grasp-url.js"

export interface NostrGitConfig {
  eventIO: EventIO
  grasp?: GraspLike
  publishRepoState?: boolean
  publishRepoAnnouncements?: boolean
  httpOverrides?: HttpOverrides
  gitProvider?: GitProvider
}

interface GraspLike {
  supportsStatePublicationFromLocal?: boolean
  publishStateFromLocal(
    owner: string,
    repo: string,
    opts: {relays: string[]; includeTags?: boolean; prevEventId?: string},
  ): Promise<PublishResult>
}

const LOCAL_REPO_STATE_UNSUPPORTED =
  "Local repository state publication is unsupported without a real repository state source"
const PROVIDER_MANAGED_PUSH_UNSUPPORTED =
  "Provider-managed Nostr repository pushes are unsupported until real state publication is implemented"
const PROVIDER_GIT_INSPECTION_UNSUPPORTED =
  "NostrGitProvider repository inspection is unsupported; use the underlying GitProvider"

export interface RepoAnnouncementDiscoveryOptions {
  announcementRelays: string[]
}

export interface RepoRelayOptions {
  relays: string[]
}

const requireRepoRelays = (relays: string[]): string[] => {
  const normalized = sanitizeRelays(relays || [])
  if (normalized.length === 0) {
    throw new Error("Repository operation requires at least one explicit relay")
  }
  return normalized
}

export interface RepoDiscovery {
  repoId: string
  urls: string[]
  announcement?: RepoAnnouncementEvent
  state?: RepoStateEvent
  maintainers: string[]
  relays: string[]
}

export interface NostrPushResult {
  server?: any
  patchEventIds?: string[]
  stateEventId?: string
  blossomSummary?: BlossomPushSummary
}

/**
 * NostrGitProvider - A wrapper around GitProvider that adds Nostr-specific functionality
 *
 * This class provides GRASP integration and Nostr event coordination while delegating
 * all standard Git operations to the underlying GitProvider from git-wrapper.
 */
export class NostrGitProvider {
  private baseGitProvider: GitProvider
  private nostrConfig: NostrGitConfig

  constructor(config: NostrGitConfig) {
    this.nostrConfig = config

    // Create the underlying git provider (isomorphic-git or libgit2)
    this.baseGitProvider = config.gitProvider ?? createGitProvider()
  }

  configureGrasp(grasp: GraspLike): void {
    this.nostrConfig.grasp = grasp
  }

  updateConfig(config: Partial<NostrGitConfig>): void {
    this.nostrConfig = {
      ...this.nostrConfig,
      ...config,
    }
  }

  /**
   * Get the underlying GitProvider for direct Git operations
   */
  getGitProvider(): GitProvider {
    return this.baseGitProvider
  }

  /**
   * Discover a repository via Nostr events
   * Based on ngit's repo discovery logic
   */
  async discoverRepo(
    repoId: string,
    options: RepoAnnouncementDiscoveryOptions,
  ): Promise<RepoDiscovery | null> {
    const announcementRelays = requireRepoRelays(options?.announcementRelays)
    // Use EventIO to fetch repository announcement events
    const filters = [
      {
        kinds: [30617], // GIT_REPO_ANNOUNCEMENT
        "#d": [repoId],
      },
    ]

    const events = await this.nostrConfig.eventIO.fetchEvents(filters, {
      relays: announcementRelays,
    })

    if (events.length === 0) {
      return null
    }

    // Get the latest announcement event
    const announcement = events[0] as RepoAnnouncementEvent

    const cloneUrls = getTags(announcement as any, "clone").flatMap((t: any) =>
      (t as string[]).slice(1),
    )
    const maintainers = getTags(announcement as any, "maintainers").flatMap((t: any) =>
      (t as string[]).slice(1),
    )
    const relays = getRepoActivityRelays(announcement, {identifier: repoId})

    if (relays.length === 0) {
      return null
    }

    // Try to get repo state
    const stateFilters = [
      {
        kinds: [30618], // GIT_REPO_STATE
        authors: [announcement.pubkey],
        "#d": [repoId],
      },
    ]

    const stateEvents = await this.nostrConfig.eventIO.fetchEvents(stateFilters, {relays})
    const state = stateEvents.length > 0 ? (stateEvents[0] as RepoStateEvent) : undefined

    return {
      repoId,
      urls: cloneUrls,
      announcement,
      state,
      maintainers,
      relays,
    }
  }

  /**
   * Clone a repository with GRASP support
   * Delegates to base git provider
   */
  async clone(options: any): Promise<void> {
    return this.baseGitProvider.clone(options)
  }

  /**
   * Push changes with GRASP relay support
   * Based on ngit's push logic with multi-relay coordination
   */
  async push(options: any): Promise<NostrPushResult> {
    const remoteUrl = String(options?.url || "")
    if (/^nostr:\/\//i.test(remoteUrl) || isGraspRepoHttpUrl(remoteUrl)) {
      throw new Error(PROVIDER_MANAGED_PUSH_UNSUPPORTED)
    }

    const automaticallyPublishesRepoState = this.nostrConfig.publishRepoState === true
    const publishesRepoStateFromLocal = options.publishRepoStateFromLocal === true

    // The built-in local snapshot path is quarantined until it can read real Git state. Rejecting
    // here avoids completing the Git push and then returning a generic error that invites retries.
    if (automaticallyPublishesRepoState) {
      if (!options.dir) {
        throw new Error("Automatic repository state publication requires a local repository path")
      }
      await this.getRepoStateFromLocal(options.dir)
    }

    let owner: string | undefined
    let repo: string | undefined
    let repoRelays: string[] = []
    if (publishesRepoStateFromLocal) {
      if (!this.nostrConfig.grasp) {
        throw new Error("Repository state publication requires a configured GRASP provider")
      }
      if (this.nostrConfig.grasp.supportsStatePublicationFromLocal !== true) {
        throw new Error(LOCAL_REPO_STATE_UNSUPPORTED)
      }

      owner = options.ownerPubkey ?? options.owner
      repo = options.repoId ?? options.repo
      if (typeof owner !== "string" || owner.trim().length === 0) {
        throw new Error("Repository state publication requires an explicit owner")
      }
      if (typeof repo !== "string" || repo.trim().length === 0) {
        throw new Error("Repository state publication requires an explicit repository identifier")
      }
      repoRelays = requireRepoRelays(options.repoRelays)
    }

    // Required state must be accepted before Git work. This avoids ambiguous retries after a
    // remote side effect when relay publication fails.
    if (publishesRepoStateFromLocal) {
      const publication = await this.nostrConfig.grasp!.publishStateFromLocal(owner!, repo!, {
        ...options.graspOptions,
        relays: repoRelays,
      })
      const acceptedRelays = sanitizeRelays(publication?.relays || []).filter(relay =>
        repoRelays.includes(relay),
      )
      if (publication?.ok !== true || acceptedRelays.length === 0) {
        throw new Error(publication?.error || "Repository state publication was not accepted")
      }
    }

    // Delegate to base provider for actual push
    const result = await this.baseGitProvider.push(options)
    const pushResult: NostrPushResult = {
      ...result,
    }

    // Handle Blossom mirroring if requested and supported
    let blossomSummary: BlossomPushSummary | undefined

    if (
      options.blossomMirror &&
      options.dir &&
      options.fs &&
      typeof options.fs.pushToBlossom === "function"
    ) {
      try {
        const pushOptions = {
          endpoint: options.endpoint,
          onProgress: (pct: number) => {
            console.log(`Blossom upload progress: ${pct.toFixed(1)}%`)
          },
        }
        console.log("Starting Blossom mirror upload...")
        const summary = await options.fs.pushToBlossom(options.dir, pushOptions)
        blossomSummary = summary
        console.log("Blossom mirror upload completed")
        if (summary.failures.length > 0) {
          console.warn("Blossom mirror completed with failures:", summary.failures)
        }
      } catch (error) {
        console.error("Error during Blossom mirror upload:", error)
      }
    }

    if (blossomSummary) {
      pushResult.blossomSummary = blossomSummary
    }

    return pushResult
  }

  /**
   * Publish repository state to Nostr relays
   * Based on ngit's repo state publishing
   */
  async publishRepoState(dir: string, relays: string[]): Promise<string> {
    requireRepoRelays(relays)
    return this.getRepoStateFromLocal(dir)
  }

  /**
   * Publish repository announcement to Nostr relays
   * Based on ngit's repo announcement logic
   */
  async publishRepoAnnouncement(dir: string, relays: string[]): Promise<string> {
    requireRepoRelays(relays)
    return this.getRepoStateFromLocal(dir)
  }

  private async getRepoStateFromLocal(_dir: string): Promise<never> {
    throw new Error(LOCAL_REPO_STATE_UNSUPPORTED)
  }

  /**
   * List pull requests for a repository.
   */
  async listProposals(repoAddr: string, options: RepoRelayOptions): Promise<any[]> {
    const relays = requireRepoRelays(options?.relays)
    const filters = [
      {
        kinds: [1618, 1619],
        "#a": [repoAddr],
      },
    ]

    return this.nostrConfig.eventIO.fetchEvents(filters, {relays})
  }

  /**
   * Patch-based proposal sending was removed with legacy patch event support.
   */
  async sendProposal(repoAddr: string, commits: string[], options?: any): Promise<string[]> {
    throw new Error(
      "sendProposal no longer supports legacy patch events; publish a pull request event instead",
    )
  }

  /**
   * Get ahead/behind status between branches
   * Based on ngit's branch comparison
   */
  async getAheadBehind(
    _dir: string,
    _baseRef: string,
    _headRef: string,
  ): Promise<{ahead: string[]; behind: string[]}> {
    throw new Error(PROVIDER_GIT_INSPECTION_UNSUPPORTED)
  }

  /**
   * Check if repository has outstanding changes
   * Based on ngit's change detection
   */
  async hasOutstandingChanges(_dir: string): Promise<boolean> {
    throw new Error(PROVIDER_GIT_INSPECTION_UNSUPPORTED)
  }

  /**
   * Get the root commit of a repository
   * Based on ngit's root commit detection
   */
  async getRootCommit(_dir: string): Promise<string> {
    throw new Error(PROVIDER_GIT_INSPECTION_UNSUPPORTED)
  }

  /**
   * Get detailed commit information
   * Based on ngit's commit info extraction
   */
  async getCommitInfo(_dir: string, _commitId: string): Promise<any> {
    throw new Error(PROVIDER_GIT_INSPECTION_UNSUPPORTED)
  }

  /**
   * Get all branches in a repository
   * Based on ngit's branch listing
   */
  async getAllBranches(_dir: string): Promise<any[]> {
    throw new Error(PROVIDER_GIT_INSPECTION_UNSUPPORTED)
  }
}
