/**
 * GRASP API Implementation for Core Package - CLEAN VERSION
 *
 * This implements the GraspLike interface required by git-wrapper for GRASP integration.
 * Based on ngit's GRASP relay support and repo state management.
 *
 * IMPORTANT: This uses EventIO instead of the cursed SignEvent passing pattern.
 *
 * References:
 * - ngit/src/lib/repo_state.rs (RepoState management)
 * - ngit/src/lib/client.rs (relay coordination)
 */
import type {Event as NostrEvent} from "nostr-tools"
import {GIT_REPO_STATE, type RepoStateEvent, parseRepoStateEvent} from "../../events/index.js"
import {validateRepoStateEvent} from "../../utils/validation.js"
import {sanitizeRelays} from "../../utils/sanitize-relays.js"
import type {EventIORelayScope, PublishResult} from "../../types/index.js"
import {nip11, SimplePool} from "nostr-tools"

// Define interfaces locally since they're not exported
interface GraspLike {
  supportsStatePublicationFromLocal?: boolean
  publishStateFromLocal(
    owner: string,
    repo: string,
    opts: {relays: string[]; includeTags?: boolean; prevEventId?: string},
  ): Promise<any>
}

const LOCAL_REPO_STATE_UNSUPPORTED =
  "GRASP local repository state publication is unsupported without a real repository state source"
const STATE_SYNC_UNSUPPORTED =
  "GRASP state synchronization is unsupported without an unsigned authoritative state source"

const requireRepoRelays = (relays: string[]): string[] => {
  const normalized = sanitizeRelays(relays || [])
  if (normalized.length === 0) {
    throw new Error("GRASP repository operation requires at least one explicit relay")
  }
  return normalized
}

/**
 * GRASP API configuration - CLEAN VERSION
 */
export interface GraspApiConfig {
  /** Default timeout for operations */
  timeoutMs?: number
  /** Publish event function */
  publishEvent: (event: NostrEvent, scope: EventIORelayScope) => Promise<PublishResult>
}

/**
 * GRASP API implementation - CLEAN VERSION
 *
 * Provides GRASP relay functionality for git-wrapper integration.
 * Handles repository state publishing and synchronization.
 *
 * IMPORTANT: Uses EventIO which handles signing internally.
 */
export class GraspApi implements GraspLike {
  readonly supportsStatePublicationFromLocal = false

  private config: GraspApiConfig

  private pool: SimplePool

  constructor(config: GraspApiConfig) {
    this.config = config
    this.pool = new SimplePool()
  }

  /**
   * Local repository state publication is quarantined until a real Git snapshot source is wired.
   */
  async publishStateFromLocal(
    _owner: string,
    _repo: string,
    opts: {
      relays: string[]
      includeTags?: boolean
      prevEventId?: string
    },
  ): Promise<any> {
    requireRepoRelays(opts?.relays || [])
    throw new Error(LOCAL_REPO_STATE_UNSUPPORTED)
  }

  /**
   * Get repository state from GRASP relays
   *
   * Fetches the latest repository state from GRASP relays.
   * Used for synchronization and conflict resolution.
   */
  async getStateFromRelays(owner: string, repo: string, relays: string[]): Promise<any> {
    const repoRelays = requireRepoRelays(relays)
    try {
      // Query all GRASP relays for state events
      const results = await this.pool.querySync(repoRelays, {
        kinds: [GIT_REPO_STATE],
        authors: [owner],
        "#d": [repo],
        limit: 100,
      })

      // Find the most recent valid state event
      const validEvents = results.filter(event => {
        if (event.kind !== GIT_REPO_STATE || event.pubkey !== owner) return false
        if (!event.tags.some(tag => tag[0] === "d" && tag[1] === repo)) return false
        return validateRepoStateEvent(event).success
      })

      if (validEvents.length === 0) {
        return null
      }

      // Sort by creation time and return the latest
      validEvents.sort((a, b) => {
        const createdAtDiff = b.created_at - a.created_at
        return createdAtDiff || b.id.localeCompare(a.id)
      })
      return parseRepoStateEvent(validEvents[0] as RepoStateEvent)
    } catch (error) {
      throw new Error(`GRASP state retrieval failed: ${error}`)
    }
  }

  /**
   * Check GRASP relay capabilities
   *
   * Verifies that relays support GRASP functionality.
   * Based on NIP-11 relay information document.
   */
  async checkRelayCapabilities(relay: string): Promise<boolean> {
    try {
      const relayInfo = await nip11.fetchRelayInformation(relay)
      return relayInfo.supported_nips?.includes(34) || false
    } catch (error) {
      console.warn(`Failed to check capabilities for relay ${relay}:`, error)
      return false
    }
  }

  /**
   * Get all GRASP-capable relays
   *
   * Filters the configured relays to only include those that support GRASP.
   */
  async getCapableRelays(relays: string[]): Promise<string[]> {
    const repoRelays = requireRepoRelays(relays)
    const capabilityChecks = repoRelays.map(async relay => {
      const isCapable = await this.checkRelayCapabilities(relay)
      return {relay, isCapable}
    })

    const results = await Promise.allSettled(capabilityChecks)
    return results
      .filter(
        (result): result is PromiseFulfilledResult<{relay: string; isCapable: boolean}> =>
          result.status === "fulfilled",
      )
      .map(result => result.value)
      .filter(({isCapable}) => isCapable)
      .map(({relay}) => relay)
  }

  /**
   * Synchronize repository state across GRASP relays
   *
   * Ensures all GRASP relays have the latest repository state.
   * Handles conflicts and ensures consistency.
   */
  async syncStateAcrossRelays(
    _owner: string,
    _repo: string,
    relays: string[],
  ): Promise<{
    syncedRelays: string[]
    failedRelays: string[]
    conflicts: any[]
  }> {
    requireRepoRelays(relays)
    throw new Error(STATE_SYNC_UNSUPPORTED)
  }
}
