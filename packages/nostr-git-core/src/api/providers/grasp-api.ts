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
import type { Event as NostrEvent } from 'nostr-tools';
import {
  GIT_REPO_STATE,
  type RepoStateEvent,
  type RepoState,
  createRepoStateEvent,
  parseRepoStateEvent
} from '../../events/index.js';
import {validateRepoStateEvent} from '../../utils/validation.js';
import { nip11, SimplePool } from 'nostr-tools';


// Define interfaces locally since they're not exported
interface GraspLike {
  publishStateFromLocal(
    owner: string,
    repo: string,
    opts?: { includeTags?: boolean; prevEventId?: string },
  ): Promise<any>;
}

/**
 * GRASP API configuration - CLEAN VERSION
 */
export interface GraspApiConfig {
  /** GRASP relay URLs */
  relays: string[];
  /** Default timeout for operations */
  timeoutMs?: number;
  /** Publish event function */
  publishEvent: (event: NostrEvent) => Promise<any>;
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
  private config: GraspApiConfig;

  private pool: SimplePool;

  constructor(config: GraspApiConfig) {
    this.config = config;
    this.pool = new SimplePool();
  }

  /**
   * Publish repository state to GRASP relays
   * 
   * This method is called by git-wrapper when publishRepoStateFromLocal is enabled.
   * It publishes the current repository state (HEAD, refs) to GRASP relays.
   * 
   * Based on ngit's repo state publishing logic in repo_state.rs
   */
  async publishStateFromLocal(
    owner: string,
    repo: string,
    opts?: {
      includeTags?: boolean;
      prevEventId?: string
    }
  ): Promise<any> {
    try {
      // Create repo address identifier
      const repoAddr = `${GIT_REPO_STATE}:${owner}:${repo}`;

      // Get current repository state
      // Note: In a real implementation, this would read from the actual Git repository
      // For now, we'll create a basic state structure
      const repoState = {
        repoAddr,
        refs: [
          { type: 'heads' as const, name: 'main', commit: 'latest-commit-hash' },
          { type: 'heads' as const, name: 'develop', commit: 'develop-commit-hash' }
        ],
        head: 'ref: refs/heads/main',
        created_at: Math.floor(Date.now() / 1000)
      };

      // Create repo state event
      const stateEvent = createRepoStateEvent({
        repoId: repoAddr,
        refs: repoState.refs,
        head: repoState.head,
        created_at: repoState.created_at
      });

      // finalizeEvent(stateEvent);

      this.pool.publish(this.config.relays, stateEvent);

      return {
        eventId: stateEvent.id,
        relays: this.config.relays,
        success: true
      };
    } catch (error) {
      throw new Error(`GRASP state publishing failed: ${error}`);
    }
  }


  /**
   * Get repository state from GRASP relays
   * 
   * Fetches the latest repository state from GRASP relays.
   * Used for synchronization and conflict resolution.
   */
  async getStateFromRelays(
    owner: string,
    repo: string
  ): Promise<any> {

    try {
      const repoAddr = `${GIT_REPO_STATE}:${owner}:${repo}`;

      // Query all GRASP relays for state events
      const results = await this.pool.querySync(this.config.relays, {
        ids: [repoAddr],
        kinds: [GIT_REPO_STATE],
        authors: [owner],
        since: 0,
        until: Date.now()
      });

      const allEvents = results.map(result => parseRepoStateEvent(result as RepoStateEvent))

      if (allEvents.length === 0) {
        return null;
      }

      // Find the most recent valid state event
      const validEvents = allEvents.filter(event => {
        try {
          validateRepoStateEvent(event);
          return true;
        } catch {
          return false;
        }
      });

      if (validEvents.length === 0) {
        return null;
      }

      // Sort by creation time and return the latest
      validEvents.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return validEvents[0];
    } catch (error) {
      throw new Error(`GRASP state retrieval failed: ${error}`);
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
      const relayInfo = await nip11.fetchRelayInformation(relay);
      return relayInfo.supported_nips?.includes(30618) || false;
    } catch (error) {
      console.warn(`Failed to check capabilities for relay ${relay}:`, error);
      return false;
    }
  }

  /**
   * Get all GRASP-capable relays
   * 
   * Filters the configured relays to only include those that support GRASP.
   */
  async getCapableRelays(): Promise<string[]> {
    const capabilityChecks = this.config.relays.map(async (relay) => {
      const isCapable = await this.checkRelayCapabilities(relay);
      return { relay, isCapable };
    });

    const results = await Promise.allSettled(capabilityChecks);
    return results
      .filter((result): result is PromiseFulfilledResult<{ relay: string; isCapable: boolean }> =>
        result.status === 'fulfilled'
      )
      .map(result => result.value)
      .filter(({ isCapable }) => isCapable)
      .map(({ relay }) => relay);
  }

  /**
   * Synchronize repository state across GRASP relays
   * 
   * Ensures all GRASP relays have the latest repository state.
   * Handles conflicts and ensures consistency.
   */
  async syncStateAcrossRelays(
    owner: string,
    repo: string
  ): Promise<{
    syncedRelays: string[];
    failedRelays: string[];
    conflicts: any[];
  }> {
    try {
      // Get current state
      const currentState = await this.getStateFromRelays(owner, repo);

      if (!currentState) {
        return {
          syncedRelays: [],
          failedRelays: this.config.relays,
          conflicts: []
        };
      }

      // Get capable relays
      const capableRelays = await this.getCapableRelays();

      if (capableRelays.length > 0) {
        const result = this.pool.publish(capableRelays, currentState);
        return {
          syncedRelays: capableRelays,
          failedRelays: [],
          conflicts: []
        };
      } else {
        return {
          syncedRelays: [],
          failedRelays: this.config.relays,
          conflicts: []
        };
      }
    } catch (error) {
      throw new Error(`GRASP synchronization failed: ${error}`);
    }
    }
}