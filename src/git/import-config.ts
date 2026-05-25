import type {RepoCommunityBinding} from "../events/index.js"

/**
 * Import Configuration for Repository Import Feature
 *
 * Configuration interface and defaults for importing repositories from
 * Git hosting providers (GitHub, GitLab, Gitea, Bitbucket) into Nostr.
 */

/**
 * Configuration options for repository import operations
 */
export interface ImportConfig {
  /**
   * Maximum number of retry attempts for failed operations
   * @default 3
   */
  maxRetries: number

  /**
   * Enable fine-grained progress updates
   * @default true
   */
  enableProgressTracking: boolean

  /**
   * Filter to import only items created after this date
   * Undefined means import all items
   */
  sinceDate?: Date

  /**
   * Whether to fork the repository (if not owned)
   * @default false
   */
  forkRepo: boolean

  /**
   * Custom name for the fork (if forking is enabled)
   * If not provided, defaults to `imported-${repoName}`
   */
  forkName?: string

  /**
   * Whether to mirror issues to Nostr
   * @default true
   */
  mirrorIssues: boolean

  /**
   * Whether to mirror pull requests to Nostr
   * @default true
   */
  mirrorPullRequests: boolean

  /**
   * Whether to mirror issue comments to Nostr
   * @default true
   */
  mirrorComments: boolean

  /**
   * Number of events to publish in a single batch before waiting
   * @default 30
   */
  relayBatchSize?: number

  /**
   * Delay between batches (ms) when publishing events in batches
   * @default 250
   */
  relayBatchDelay?: number

  /**
   * Nostr relays to publish events to
   * @default []
   */
  relays?: string[]

  /**
   * Progress callback function
   * Called with message, optional current count, and optional total count
   */
  onProgress?: (message: string, current?: number, total?: number) => void

  /**
   * Abort check callback function
   * Returns true if the operation should be aborted
   */
  onAbort?: () => boolean

  /**
   * Explicit branch names selected for remote sync.
   * Default branch should be included by caller.
   */
  selectedBranches?: string[]

  /**
   * Destination repository name used for created targets and final Nostr repo metadata.
   * Defaults to the source repository name when omitted.
   */
  destinationRepoName?: string

  /**
   * Optional community bound directly to the final repo announcement.
   */
  community?: RepoCommunityBinding
}

/**
 * Default import configuration values
 */
export const DEFAULT_IMPORT_CONFIG: ImportConfig = {
  maxRetries: 3,
  enableProgressTracking: true,
  forkRepo: false,
  mirrorIssues: true,
  mirrorPullRequests: true,
  mirrorComments: true,
  relayBatchSize: 30,
  relayBatchDelay: 250,
}

/**
 * Create an ImportConfig with default values, overridden by provided options
 *
 * @param overrides - Partial configuration to override defaults
 * @returns ImportConfig with defaults and overrides applied
 */
export function createImportConfig(overrides?: Partial<ImportConfig>): ImportConfig {
  return {
    ...DEFAULT_IMPORT_CONFIG,
    ...overrides,
  }
}
