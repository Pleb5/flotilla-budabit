/**
 * Repository Import Hook
 *
 * Main import logic for importing repositories from Git hosting providers
 * (GitHub, GitLab, Gitea, Bitbucket) into the Nostr Git system.
 */

import {
  getGitServiceApiFromUrl,
  parseRepoUrl,
  validateTokenPermissions,
  checkRepoOwnership,
  type ImportConfig,
  DEFAULT_IMPORT_CONFIG,
  ImportAbortController,
  ImportAbortedError,
  RateLimiter,
  generatePlatformUserProfile,
  getProfileMapKey,
  convertIssuesToNostrEvents,
  convertIssueStatusToEvent,
  convertCommentsToNostrEvents,
  convertPullRequestsToNostrEvents,
  signEvent,
  type UserProfileMap,
  type CommentEventMap,
} from "@nostr-git/core";
import { parseRepoId } from "@nostr-git/core/utils";
import type {
  RepoAnnouncementEvent,
  RepoStateEvent,
  NostrEvent,
  NostrFilter,
  EventIO,
} from "@nostr-git/core";
import type { GitComment as Comment, RepoMetadata } from "@nostr-git/core";
import { nip19 } from "nostr-tools";
import {
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  getSuccessfulGraspRelayUrls,
} from "../utils/grasp-pipeline.js";
import {
  buildImportedRepoMetadata,
  buildImportedRepoEvents,
  getImportedRepoName,
} from "../utils/import-repo-metadata.js";
import {
  syncLocalRepoToTargets,
  type RemoteSyncRef,
  type RemoteSyncTargetResult,
} from "../utils/remote-sync.js";
import type { RemoteTargetSelection } from "../utils/remote-targets.js";
import {
  getEffectiveImportConfig,
  shouldFetchBranchActivity,
  sortImportBranches,
  type SourceAccessMode,
} from "../utils/import-source-access.js";

/**
 * Import phase identifiers for structured progress reporting.
 * Order matches the actual import flow.
 */
export const IMPORT_PHASES = [
  "connecting",
  "repository",
  "remotes",
  "issues",
  "pull_requests",
  "comments",
  "profiles",
] as const;

export type ImportPhase = (typeof IMPORT_PHASES)[number] | "complete";

/** Human-readable labels for each phase (for UI) */
export const IMPORT_PHASE_LABELS: Record<ImportPhase, string> = {
  connecting: "Connecting",
  repository: "Repository",
  remotes: "Remote sync",
  issues: "Issues",
  pull_requests: "Pull requests",
  comments: "Comments",
  profiles: "User profiles",
  complete: "Complete",
};

/**
 * Counts of mirrored items per phase (set as each phase completes)
 */
export interface ImportCompletedCounts {
  issues?: number;
  pull_requests?: number;
  comments?: number;
}

/**
 * Import progress information
 */
export interface ImportProgress {
  /**
   * Current phase in the import flow
   */
  phase: ImportPhase;

  /**
   * Current step/message (human-readable detail for the current phase)
   */
  step: string;

  /**
   * Current item number (for batch operations)
   */
  current?: number;

  /**
   * Total items (for batch operations)
   */
  total?: number;

  /**
   * Whether the import is complete
   */
  isComplete: boolean;

  /**
   * Error message if import failed
   */
  error?: string;

  /**
   * Counts of mirrored items for completed phases (issues, pull_requests, comments)
   */
  completedCounts?: ImportCompletedCounts;
}

/**
 * Import result
 */
export interface ImportResult {
  /**
   * Repository announcement event
   */
  announcementEvent: RepoAnnouncementEvent;

  /**
   * Repository state event
   */
  stateEvent: RepoStateEvent;

  /**
   * Number of issues imported
   */
  issuesImported: number;

  /**
   * Number of comments imported
   */
  commentsImported: number;

  /**
   * Number of PRs imported
   */
  prsImported: number;

  /**
   * Number of profiles created
   */
  profilesCreated: number;

  /**
   * Final repository metadata (after forking if needed)
   */
  repo: RepoMetadata;

  /**
   * Result for each selected remote target push.
   */
  remotePushResults?: ImportRemotePushResult[];
}

export type ImportRemoteProvider = "github" | "gitlab" | "gitea" | "bitbucket" | "grasp";

export type ImportRemoteTarget = RemoteTargetSelection;

export type ImportRemotePushResult = RemoteSyncTargetResult;

export interface ImportRepoRollbackParams {
  repoName: string;
  relays: string[];
}

/**
 * Options for the import hook
 */
export interface UseImportRepoOptions {
  /**
   * Git worker API instance used for clone/create/push operations.
   */
  workerApi?: any;

  /**
   * EventIO instance for publishing events
   */
  eventIO?: EventIO;

  /**
   * Fetch events from Nostr relays. Used for NIP-39 bridged identity lookups.
   * Can use host app's relay pool directly (e.g. welshman load) without needing full EventIO.
   */
  onFetchEvents?: (filters: NostrFilter[]) => Promise<NostrEvent[]>;

  /**
   * Fetch events from specific relay URLs. Used for GRASP state visibility checks.
   */
  onFetchRelayEvents?: (params: {
    relays: string[];
    filters: NostrFilter[];
    timeoutMs?: number;
  }) => Promise<NostrEvent[]>;

  /**
   * Function to sign events (required if eventIO not provided)
   */
  onSignEvent?: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>;

  /**
   * Function to publish events (required if eventIO not provided)
   */
  onPublishEvent?: (event: NostrEvent) => Promise<unknown>;

  /**
   * Roll back already-published repository announcement/state events.
   * Used when remote sync totally fails after provisional GRASP publish.
   */
  onRollbackPublishedRepoEvents?: (params: ImportRepoRollbackParams) => Promise<void>;

  /**
   * Progress callback
   */
  onProgress?: (progress: ImportProgress) => void;

  /**
   * Import completed callback
   */
  onImportCompleted?: (result: ImportResult) => void;

  /**
   * User's Nostr public key (hex format)
   */
  userPubkey: string;
}

// ===== Import Context & Types =====

/**
 * Shared context for import operations
 * Holds all state and dependencies needed throughout the import process
 */
interface ImportContext {
  // Core dependencies
  abortController: ImportAbortController;
  rateLimiter: RateLimiter;
  withRateLimit: <T>(provider: string, method: string, operation: () => Promise<T>) => Promise<T>;
  updateProgress: (step: string, current?: number, total?: number) => void;

  // API and platform info
  api: Awaited<ReturnType<typeof getGitServiceApiFromUrl>>;
  platform: string;
  parsed: ReturnType<typeof parseRepoUrl>;
  sourceToken?: string;
  sourceAccessMode: SourceAccessMode;

  // Repository info
  finalRepo: RepoMetadata | null;
  repoAddr: string;

  // Timestamps
  importTimestamp: number;
  startTimestamp: number;
  currentTimestamp: number; // Increments for each event published
  latestRepoMetadataCreatedAt: number;

  // User profiles
  userProfiles: UserProfileMap;
  profileEvents: Map<string, NostrEvent>;

  // NIP-39 bridged identities: platform:username -> Nostr pubkey (when profile has i-tag proof)
  bridgedNostrPubkeys: Map<string, string>;
  nip39CheckedKeys: Set<string>; // profileKeys we've already looked up (avoid re-query)

  // Lightweight tracking maps (for dependency resolution)
  issueEventIdMap: Map<number, string>; // issue.number -> nostr event ID
  prEventIdMap: Map<number, string>; // pr.number -> nostr event ID
  commentEventMap: Map<string, string>; // platformCommentId -> nostr event ID (for threading)

  // Running counters
  issuesPublished: number;
  prsPublished: number;
  commentsPublished: number;

  // Configuration
  config: ImportConfig;
  userPubkey: string;
  batchSize: number; // Number of events per batch
  batchDelay: number; // Delay between batches (ms)

  // Batched event publishing
  eventQueue: NostrEvent[]; // Queue of events waiting to be published

  // Event publishing
  onSignEvent?: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>;
  onPublishEvent?: (event: NostrEvent) => Promise<unknown>;
  eventIO?: EventIO;
  onFetchEvents?: (filters: NostrFilter[]) => Promise<NostrEvent[]>;
  onFetchRelayEvents?: (params: {
    relays: string[];
    filters: NostrFilter[];
    timeoutMs?: number;
  }) => Promise<NostrEvent[]>;

  // Worker API for remote sync
  workerApi?: any;

  // Remote sync results
  remotePushResults: ImportRemotePushResult[];
  remoteTargets: ImportRemoteTarget[];
  selectedBranchRefs?: ImportBranchPushRef[];
}

// ===== Batch Publishing Functions =====

/**
 * Publish a single event using batched publishing
 * Events are collected into batches and published together for better performance
 */
async function publishEventBatched(context: ImportContext, event: NostrEvent): Promise<void> {
  context.eventQueue.push(event);

  // If queue reaches batch size, flush it
  if (context.eventQueue.length >= context.batchSize) {
    await flushEventQueue(context);
  }
}

/**
 * Flush all queued events by publishing them in parallel, then wait before next batch
 */
async function flushEventQueue(context: ImportContext): Promise<void> {
  if (context.eventQueue.length === 0) return;

  const batch = [...context.eventQueue];
  context.eventQueue = [];

  // Publish all events in batch in parallel
  await Promise.allSettled(
    batch.map((event) => {
      if (context.onPublishEvent) {
        return context.onPublishEvent(event);
      }
      // If no onPublishEvent, just resolve (events can't be published)
      return Promise.resolve();
    })
  );

  // Single delay after the batch (not per event)
  if (context.batchDelay > 0) {
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, context.batchDelay)),
      context.abortController.waitForAbort(),
    ]);
  }
}

// ===== Setup Functions =====

/**
 * Create and configure rate limiter
 */
function createRateLimiter(
  updateProgress: (step: string, current?: number, total?: number) => void
): RateLimiter {
  const rateLimiter = new RateLimiter({
    secondsBetweenRequests: 0.25,
    secondaryRateWait: 60,
    maxRetries: 3,
  });

  rateLimiter.onProgress = (message: string) => {
    updateProgress(message);
  };

  return rateLimiter;
}

/**
 * Create rate limit wrapper function
 */
function createWithRateLimit(rateLimiter: RateLimiter, abortController: ImportAbortController) {
  const runAbortable = async <T>(
    operation: () => Promise<T>,
    label: string,
    timeoutMs = 0
  ): Promise<T> => {
    abortController?.throwIfAborted();

    const operationPromise = operation();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const racePromises: Promise<T>[] = [
      operationPromise,
      abortController.waitForAbort() as Promise<T>,
    ];

    if (timeoutMs > 0) {
      racePromises.push(
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      );
    }

    try {
      return await Promise.race(racePromises);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  return async function withRateLimit<T>(
    provider: string,
    method: string,
    operation: () => Promise<T>
  ): Promise<T> {
    let attempt = 1;

    while (true) {
      abortController?.throwIfAborted();

      // Throttle before making the request
      await runAbortable(
        () => rateLimiter.throttle(provider, method),
        `Rate limit wait for ${provider}:${method}`
      );

      try {
        // Execute the operation
        const result = await runAbortable(
          operation,
          `Rate-limited operation ${provider}:${method}`,
          120000
        );
        return result;
      } catch (error: any) {
        // Check if we should retry
        const retryDecision = await rateLimiter.shouldRetry(error, attempt);

        if (!retryDecision.retry) {
          // Don't retry - throw the error
          throw error;
        }

        // Wait with progress updates if delay is significant
        if (retryDecision.delay > 0) {
          await runAbortable(
            () => rateLimiter.waitWithProgress(provider, retryDecision.delay),
            `Retry delay for ${provider}:${method}`
          );
        }

        attempt++;
      }
    }
  };
}

async function runAbortableOperation<T>(
  abortController: ImportAbortController,
  operation: () => Promise<T>,
  label: string,
  timeoutMs = 0
): Promise<T> {
  abortController.throwIfAborted();

  const operationPromise = operation();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const racePromises: Promise<T>[] = [
    operationPromise,
    abortController.waitForAbort() as Promise<T>,
  ];

  if (timeoutMs > 0) {
    racePromises.push(
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    );
  }

  try {
    return await Promise.race(racePromises);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Initialize import context with parsed URL and API connection
 */
async function initializeImportContext(
  repoUrl: string,
  token: string | null | undefined,
  config: ImportConfig,
  userPubkey: string,
  updateProgress: (step: string, current?: number, total?: number) => void,
  abortController: ImportAbortController,
  withRateLimit: ImportContext["withRateLimit"],
  onSignEvent?: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>,
  onPublishEvent?: (event: NostrEvent) => Promise<unknown>,
  workerApi?: any,
  eventIO?: EventIO,
  onFetchEvents?: (filters: NostrFilter[]) => Promise<NostrEvent[]>,
  onFetchRelayEvents?: (params: {
    relays: string[];
    filters: NostrFilter[];
    timeoutMs?: number;
  }) => Promise<NostrEvent[]>
): Promise<Partial<ImportContext>> {
  updateProgress("Parsing repository URL...");
  abortController.throwIfAborted();

  const parsed = parseRepoUrl(repoUrl);
  const platform = parsed.provider;

  updateProgress(`Connecting to ${platform}...`);
  abortController.throwIfAborted();

  const normalizedToken = token?.trim() || "";
  const api = getGitServiceApiFromUrl(repoUrl, normalizedToken);

  return {
    abortController,
    platform,
    parsed,
    api,
    sourceToken: normalizedToken || undefined,
    sourceAccessMode: normalizedToken ? "token" : "anonymous",
    config,
    userPubkey,
    batchSize: config.relayBatchSize ?? 30,
    batchDelay: config.relayBatchDelay ?? 250,
    eventQueue: [],
    onSignEvent,
    onPublishEvent,
    workerApi,
    eventIO,
    onFetchEvents,
    onFetchRelayEvents,
    withRateLimit,
    updateProgress,
  };
}

// ===== Validation Functions =====

/**
 * Validate token permissions and check repository ownership
 */
async function validateTokenAndOwnership(
  context: ImportContext
): Promise<{ repo: RepoMetadata; isOwner: boolean }> {
  if (context.sourceAccessMode === "anonymous") {
    context.updateProgress("Fetching public repository metadata...");
    context.abortController.throwIfAborted();

    const repo = await context.withRateLimit(context.platform, "GET", () =>
      context.api.getRepo(context.parsed.owner, context.parsed.repo)
    );

    return {
      repo,
      isOwner: false,
    };
  }

  // Step 3: Validate token permissions
  context.updateProgress("Validating token permissions...");
  context.abortController.throwIfAborted();

  const tokenValidation = await context.withRateLimit(context.platform, "GET", () =>
    validateTokenPermissions(context.api, {
      owner: context.parsed.owner,
      repo: context.parsed.repo,
    })
  );

  if (!tokenValidation.valid) {
    throw new Error(`Token validation failed: ${tokenValidation.error || "Invalid token"}`);
  }

  if (!tokenValidation.hasRead) {
    throw new Error("Token does not have read permissions");
  }

  // Step 4: Check repository ownership
  context.updateProgress("Checking repository ownership...");
  context.abortController.throwIfAborted();

  const ownership = await context.withRateLimit(context.platform, "GET", () =>
    checkRepoOwnership(context.api, context.parsed.owner, context.parsed.repo)
  );

  return {
    repo: ownership.repo,
    isOwner: ownership.isOwner,
  };
}

/**
 * Ensure repository metadata is available for import source.
 *
 * We no longer require creating a source-host fork for non-owned repositories.
 * Writable destinations are selected separately via import targets.
 */
async function ensureForkedRepo(context: ImportContext, isOwner: boolean): Promise<RepoMetadata> {
  if (!context.finalRepo) {
    throw new Error("Repository metadata is missing");
  }

  if (!isOwner) {
    context.updateProgress("Using source repository metadata (no source-host fork required)...");
  }

  return context.finalRepo;
}

/**
 * Fetch repository metadata (if not already fetched)
 */
async function fetchRepoMetadata(
  context: ImportContext,
  ownershipRepo: RepoMetadata
): Promise<RepoMetadata> {
  if (context.finalRepo === ownershipRepo) {
    return ownershipRepo;
  }

  // At this point finalRepo should be set (either from fork or ownership check)
  if (!context.finalRepo) {
    throw new Error("Repository metadata is unexpectedly null");
  }

  return context.finalRepo;
}

// ===== Profile Management Functions =====

const NIP39_VERIFICATION_PREFIX = "Verifying that I control the following Nostr public key: ";
// npub is "npub1" + 52 bech32 chars; use {50,60} for flexibility
const NIP39_NPUB_REGEX =
  /Verifying that I control the following Nostr public key:\s*(npub1[a-zA-HJ-NP-Z0-9]{50,60})/;

/**
 * Verify NIP-39 GitHub Gist proof.
 * Fetches the gist, checks owner matches username, and that content contains
 * the attestation text with npub that decodes to expectedPubkey.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/39.md#github
 */
async function verifyGitHubGistProof(
  username: string,
  proof: string,
  expectedPubkey: string,
  withRateLimit: ImportContext["withRateLimit"]
): Promise<boolean> {
  if (!proof || !/^[a-f0-9]{32}$|^[a-zA-Z0-9]+$/.test(proof)) {
    return false;
  }

  try {
    const res = await withRateLimit("github", "GET", () =>
      fetch(`https://api.github.com/gists/${proof}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
    );

    if (!res.ok) return false;

    const gist = (await res.json()) as {
      owner?: { login?: string };
      files?: Record<string, { content?: string }>;
    };

    const ownerLogin = gist.owner?.login;
    if (!ownerLogin) return false;

    if (ownerLogin.toLowerCase() !== username.toLowerCase()) {
      return false;
    }

    const files = gist.files;
    if (!files || typeof files !== "object") return false;

    let foundNpub: string | null = null;
    for (const file of Object.values(files)) {
      const content = file?.content ?? "";
      const match = content.match(NIP39_NPUB_REGEX);
      if (match) {
        foundNpub = match[1];
        break;
      }
      if (content.includes(NIP39_VERIFICATION_PREFIX)) {
        const idx = content.indexOf(NIP39_VERIFICATION_PREFIX);
        const after = content.slice(idx + NIP39_VERIFICATION_PREFIX.length);
        const npubMatch = after.match(/^(npub1[a-zA-HJ-NP-Z0-9]{50,60})/);
        if (npubMatch) {
          foundNpub = npubMatch[1];
          break;
        }
      }
    }

    if (!foundNpub) return false;

    const decoded = nip19.decode(foundNpub);
    if (decoded.type !== "npub") return false;

    const verifiedPubkey = decoded.data as string;
    return verifiedPubkey === expectedPubkey;
  } catch {
    return false;
  }
}

const GITLAB_SNIPPETS_BASE = "https://gitlab.com/api/v4/snippets";

/**
 * Verify NIP-39 GitLab Snippet proof.
 * Fetches the snippet, checks author matches username, and that raw content
 * contains the attestation text with npub that decodes to expectedPubkey.
 * Uses GitLab.com; public snippets are readable without auth.
 *
 * @see https://docs.gitlab.com/ee/api/snippets.html
 */
async function verifyGitLabSnippetProof(
  username: string,
  proof: string,
  expectedPubkey: string,
  withRateLimit: ImportContext["withRateLimit"]
): Promise<boolean> {
  const snippetId = proof.trim();
  if (!snippetId || !/^\d+$/.test(snippetId)) {
    return false;
  }

  try {
    const metaRes = await withRateLimit("gitlab", "GET", () =>
      fetch(`${GITLAB_SNIPPETS_BASE}/${snippetId}`, {
        headers: { "Content-Type": "application/json" },
      })
    );

    if (!metaRes.ok) return false;

    const meta = (await metaRes.json()) as {
      author?: { username?: string };
    };

    const authorUsername = meta.author?.username;
    if (!authorUsername || authorUsername.toLowerCase() !== username.toLowerCase()) {
      return false;
    }

    const rawRes = await withRateLimit("gitlab", "GET", () =>
      fetch(`${GITLAB_SNIPPETS_BASE}/${snippetId}/raw`, {
        headers: { Accept: "text/plain" },
      })
    );

    if (!rawRes.ok) return false;

    const content = await rawRes.text();

    const match = content.match(NIP39_NPUB_REGEX);
    let foundNpub: string | null = match ? match[1] : null;
    if (!foundNpub && content.includes(NIP39_VERIFICATION_PREFIX)) {
      const idx = content.indexOf(NIP39_VERIFICATION_PREFIX);
      const after = content.slice(idx + NIP39_VERIFICATION_PREFIX.length);
      const npubMatch = after.match(/^(npub1[a-zA-HJ-NP-Z0-9]{50,60})/);
      if (npubMatch) foundNpub = npubMatch[1];
    }

    if (!foundNpub) return false;

    const decoded = nip19.decode(foundNpub);
    if (decoded.type !== "npub") return false;

    const verifiedPubkey = decoded.data as string;
    return verifiedPubkey === expectedPubkey;
  } catch {
    return false;
  }
}

/**
 * Look up Nostr pubkey for a platform user via NIP-39 identity proof.
 * Queries kind 0 (profile) events with ["i", "platform:identity", proof] tags.
 * Verifies the platform-specific proof (GitHub Gist or GitLab Snippet) before
 * accepting. Returns the pubkey if a verified bridged profile is found, null otherwise.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/39.md
 */
async function lookupNip39BridgedPubkey(
  context: ImportContext,
  platform: string,
  username: string
): Promise<string | null> {
  const profileKey = getProfileMapKey(platform, username);
  if (context.bridgedNostrPubkeys.has(profileKey)) {
    return context.bridgedNostrPubkeys.get(profileKey)!;
  }
  if (context.nip39CheckedKeys.has(profileKey)) {
    return null;
  }

  if (platform !== "github" && platform !== "gitlab") {
    return null;
  }

  const identity = `${platform}:${username}`;

  const fetchEvents = context.onFetchEvents ?? context.eventIO?.fetchEvents;
  if (!fetchEvents) {
    return null;
  }

  try {
    const events = await fetchEvents([{ kinds: [0], "#i": [identity], limit: 1 }]);

    if (events.length > 0) {
      const profile = events.reduce((a, b) => (a.created_at > b.created_at ? a : b));

      const iTag = profile.tags?.find((t) => t[0] === "i" && t[1] === identity) as
        | [string, string, string]
        | undefined;
      const proof = iTag?.[2];

      if (proof) {
        const verified =
          platform === "github"
            ? await verifyGitHubGistProof(username, proof, profile.pubkey, context.withRateLimit)
            : await verifyGitLabSnippetProof(
                username,
                proof,
                profile.pubkey,
                context.withRateLimit
              );
        if (verified) {
          context.bridgedNostrPubkeys.set(profileKey, profile.pubkey);
          return profile.pubkey;
        }
      }
    }
  } catch (err) {
    console.warn(`[import] NIP-39 lookup failed for ${identity}:`, err);
  }

  context.nip39CheckedKeys.add(profileKey);
  return null;
}

/**
 * Add p-tag for bridged Nostr identity when NIP-39 match exists.
 * Being tagged notifies the user and allows them to later claim the event.
 */
function addBridgedPTags(
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">,
  platform: string,
  username: string,
  bridgedNostrPubkeys: Map<string, string>
): void {
  const profileKey = getProfileMapKey(platform, username);
  const bridgedPubkey = bridgedNostrPubkeys.get(profileKey);
  if (bridgedPubkey && bridgedPubkey.length === 64) {
    event.tags = event.tags || [];
    event.tags.push(["p", bridgedPubkey]);
  }
}

/**
 * Ensure a user profile exists in the context
 * Uses provided username and avatarUrl directly (no API call needed)
 */
async function ensureUserProfile(context: ImportContext, username: string, avatarUrl?: string) {
  const profileKey = getProfileMapKey(context.platform, username);
  if (context.userProfiles.has(profileKey)) {
    return;
  }

  // Try NIP-39 lookup for bridged identities (platform:username -> Nostr pubkey)
  await lookupNip39BridgedPubkey(context, context.platform, username);

  // Generate profile directly from available data (no API call needed!)
  // GitHub/GitLab already provide username and avatarUrl in issues/MRs/comments
  const profile = generatePlatformUserProfile(context.platform, username);

  context.userProfiles.set(profileKey, {
    privkey: profile.privkey,
    pubkey: profile.pubkey,
  });
  context.profileEvents.set(profileKey, profile.profileEvent);
}

// ===== Streaming Fetch and Publish Functions =====

/**
 * Fetch and publish issues in streaming fashion (page-by-page)
 * Processes and publishes each issue immediately, keeping only ID mappings in memory
 */
async function fetchAndPublishIssuesStreaming(
  context: ImportContext
): Promise<{ count: number; statusEventsPublished: number }> {
  context.updateProgress("Fetching and publishing issues...");
  context.abortController.throwIfAborted();

  let page = 1;
  const perPage = 100;
  let totalIssues = 0;
  let statusEventsPublished = 0;
  // Track pages to estimate progress (we don't know total upfront, so we'll gradually progress through the range)
  while (true) {
    context.abortController.throwIfAborted();

    const sinceDate = context.config.sinceDate ? context.config.sinceDate.toISOString() : undefined;

    // Fetch one page of issues
    const pageIssues = await context.withRateLimit(context.platform, "GET", () =>
      context.api.listIssues(context.parsed.owner, context.parsed.repo, {
        per_page: perPage,
        page,
        since: sinceDate,
        state: "all",
      })
    );

    if (pageIssues.length === 0) {
      break;
    }

    const filteredIssues = pageIssues
      .filter((issue) => !issue.isPullRequest)
      .filter((issue) =>
        context.config.sinceDate ? new Date(issue.createdAt) >= context.config.sinceDate! : true
      );

    // Process and publish each issue immediately
    for (const issue of filteredIssues) {
      context.abortController.throwIfAborted();

      // Generate profile if needed (incremental)
      await ensureUserProfile(context, issue.author.login, issue.author.avatarUrl);

      // Also generate profile for the user who closed the issue (if different from author)
      if (issue.closedBy && issue.closedBy.login !== issue.author.login) {
        await ensureUserProfile(context, issue.closedBy.login, issue.closedBy.avatarUrl);
      }

      // Convert single issue to Nostr event
      const issueEventData = convertIssuesToNostrEvents(
        [issue], // Single issue
        context.repoAddr,
        context.platform,
        context.userProfiles,
        context.importTimestamp,
        context.currentTimestamp
      );

      if (issueEventData.length > 0) {
        const [eventData] = issueEventData;

        // Add p-tag for bridged Nostr identity (NIP-39) when match found
        addBridgedPTags(
          eventData.event,
          context.platform,
          issue.author.login,
          context.bridgedNostrPubkeys
        );

        // Sign issue event
        const signedIssueEvent = signEvent(eventData.event, eventData.privkey);

        // Publish issue event (batched)
        await publishEventBatched(context, signedIssueEvent);

        // Store only ID mapping (lightweight)
        context.issueEventIdMap.set(issue.number, signedIssueEvent.id);
        context.currentTimestamp += 1;
        totalIssues++;
        context.issuesPublished = totalIssues;

        // Generate and publish status events immediately
        const originalDate =
          issue.state === "open" ? issue.createdAt : (issue.closedAt ?? issue.createdAt);
        const statusEvent = convertIssueStatusToEvent(
          signedIssueEvent.id,
          issue.state,
          originalDate,
          context.repoAddr,
          context.currentTimestamp
        );

        context.abortController.throwIfAborted();

        // Sign status event with the profile of the user who created or closed the issue
        const signerUser = issue.state === "open" ? issue.author : issue.closedBy || issue.author;

        const signerProfileKey = getProfileMapKey(context.platform, signerUser.login);
        const signerProfile = context.userProfiles.get(signerProfileKey);
        if (!signerProfile) {
          throw new Error(
            `Missing profile for issue ${issue.state === "open" ? "creator" : "closer"} ${signerUser.login}; cannot sign status event for issue #${issue.number}`
          );
        }
        const signedStatusEvent = signEvent(statusEvent, signerProfile.privkey);

        // Publish status event (batched)
        await publishEventBatched(context, signedStatusEvent);

        context.currentTimestamp += 1;
        statusEventsPublished++;

        // Update progress with count of published issues
        context.updateProgress(`Publishing issues... (${totalIssues} published)`, totalIssues);
      }
    }

    page++;
  }

  // Flush any remaining events in the queue
  await flushEventQueue(context);

  return { count: totalIssues, statusEventsPublished };
}

/**
 * Fetch and publish pull requests in streaming fashion (page-by-page)
 * Processes and publishes each PR immediately, keeping only ID mappings in memory
 */
async function fetchAndPublishPRsStreaming(context: ImportContext): Promise<number> {
  context.updateProgress("Fetching and publishing pull requests...");
  context.abortController.throwIfAborted();

  let page = 1;
  const perPage = 100;
  let totalPRs = 0;

  while (true) {
    context.abortController.throwIfAborted();

    // Fetch one page of PRs
    const pagePrs = await context.withRateLimit(context.platform, "GET", () =>
      context.api.listPullRequests(context.parsed.owner, context.parsed.repo, {
        per_page: perPage,
        page,
        state: "all",
      })
    );

    // Filter by sinceDate if provided
    const filteredPrs = context.config.sinceDate
      ? pagePrs.filter((pr) => {
          const prDate = new Date(pr.createdAt);
          return prDate >= context.config.sinceDate!;
        })
      : pagePrs;

    if (filteredPrs.length === 0) {
      break;
    }

    // Process and publish each PR immediately
    for (const pr of filteredPrs) {
      context.abortController.throwIfAborted();

      // Generate profile if needed (incremental)
      await ensureUserProfile(context, pr.author.login, pr.author.avatarUrl);

      // Optionally fetch PR commits when the API supports it (for richer import)
      let prCommits: Map<number, string[]> | undefined;
      if (context.api.listPullRequestCommits) {
        try {
          const allShas: string[] = [];
          let commitPage = 1;
          const perPage = 100;
          while (true) {
            context.abortController.throwIfAborted();
            const commits = await context.withRateLimit(context.platform, "GET", () =>
              context.api.listPullRequestCommits!(
                context.parsed.owner,
                context.parsed.repo,
                pr.number,
                { per_page: perPage, page: commitPage }
              )
            );
            for (const c of commits) allShas.push(c.sha);
            if (commits.length < perPage) break;
            commitPage++;
          }
          if (allShas.length > 0) {
            prCommits = new Map([[pr.number, allShas]]);
          }
        } catch (err) {
          console.warn(`[import] Could not fetch commits for PR #${pr.number}:`, err);
        }
      }

      // Convert single PR to Nostr event (with title, body, branch, base, labels, commits)
      const prEventData = convertPullRequestsToNostrEvents(
        [pr], // Single PR
        context.repoAddr,
        context.platform,
        context.userProfiles,
        context.importTimestamp,
        context.currentTimestamp,
        prCommits
      );

      if (prEventData.length > 0) {
        const [eventData] = prEventData;

        // Add p-tag for bridged Nostr identity (NIP-39) when match found
        addBridgedPTags(
          eventData.event,
          context.platform,
          pr.author.login,
          context.bridgedNostrPubkeys
        );

        // Sign PR event
        const signedPrEvent = signEvent(eventData.event, eventData.privkey);

        // Store PR event ID for comment linking
        context.prEventIdMap.set(pr.number, signedPrEvent.id);

        // Publish PR event (batched)
        await publishEventBatched(context, signedPrEvent);

        context.currentTimestamp += 1;
        totalPRs++;
        context.prsPublished = totalPRs;

        // Update progress with count of published PRs
        context.updateProgress(`Publishing PRs... (${totalPRs} published)`, totalPRs);
      }
    }

    // Check if we should continue
    if (pagePrs.length < perPage) {
      break;
    }

    page++;
  }

  // Flush any remaining events in the queue
  await flushEventQueue(context);

  return totalPRs;
}

/**
 * Fetch and publish comments in streaming fashion (page-by-page)
 * Only processes comments for issues/PRs that were successfully published
 */
async function fetchAndPublishCommentsStreaming(
  context: ImportContext,
  issueNumbers: Set<number>,
  prNumbers: Set<number>
): Promise<number> {
  if (issueNumbers.size === 0 && prNumbers.size === 0) {
    return 0;
  }

  context.updateProgress("Fetching and publishing comments...");
  context.abortController.throwIfAborted();

  // Check if the API supports bulk comment fetching
  const apiWithBulkComments = context.api;
  let totalCommentsPublished = 0;
  const commentEventMap: CommentEventMap = new Map(); // For threading within each issue/PR

  if (apiWithBulkComments.listAllIssueComments) {
    // Use bulk endpoint if available
    const sinceDate = context.config.sinceDate ? context.config.sinceDate.toISOString() : undefined;
    let page = 1;
    const perPage = 100;

    while (true) {
      context.abortController.throwIfAborted();

      // Fetch one page of comments
      const pageComments: Array<Comment & { issueNumber: number; isPullRequest: boolean }> =
        await context.withRateLimit(context.platform, "GET", () =>
          apiWithBulkComments.listAllIssueComments!(context.parsed.owner, context.parsed.repo, {
            per_page: perPage,
            page,
            since: sinceDate,
          })
        );

      if (pageComments.length === 0) {
        break;
      }

      // Filter by sinceDate if provided
      const filteredComments = context.config.sinceDate
        ? pageComments.filter((comment) => {
            const commentDate = new Date(comment.createdAt);
            return commentDate >= context.config.sinceDate!;
          })
        : pageComments;

      // Process and publish each comment immediately
      for (const comment of filteredComments) {
        context.abortController.throwIfAborted();

        // Determine if this is a PR comment or issue comment
        const isPrComment = prNumbers.has(comment.issueNumber);
        const isIssueComment = issueNumbers.has(comment.issueNumber);

        // Only process comments for published issues/PRs
        if (!isPrComment && !isIssueComment) {
          continue;
        }

        // Get parent event ID
        const parentEventId = isPrComment
          ? context.prEventIdMap.get(comment.issueNumber)
          : context.issueEventIdMap.get(comment.issueNumber);

        if (!parentEventId) {
          console.warn(
            `Skipping comment for ${isPrComment ? "PR" : "issue"} #${comment.issueNumber} - parent event ID not found`
          );
          continue;
        }

        // Generate profile if needed
        await ensureUserProfile(context, comment.author.login, comment.author.avatarUrl);

        // Convert single comment to Nostr event
        const convertedComments = convertCommentsToNostrEvents(
          [comment],
          parentEventId,
          context.platform,
          context.userProfiles,
          commentEventMap,
          context.importTimestamp,
          context.currentTimestamp
        );

        if (convertedComments.length > 0) {
          const [convertedComment] = convertedComments;

          // Add p-tag for bridged Nostr identity (NIP-39) when match found
          addBridgedPTags(
            convertedComment.event,
            context.platform,
            comment.author.login,
            context.bridgedNostrPubkeys
          );

          // Sign comment event
          const signedCommentEvent = signEvent(convertedComment.event, convertedComment.privkey);

          // Publish comment event (batched)
          await publishEventBatched(context, signedCommentEvent);

          // Store comment event ID for threading (within same issue/PR)
          commentEventMap.set(convertedComment.platformCommentId, signedCommentEvent.id);

          context.currentTimestamp += 1;
          totalCommentsPublished++;
          context.commentsPublished = totalCommentsPublished;
        }
      }

      // Update progress with count of published comments
      context.updateProgress(
        `Publishing comments... (${totalCommentsPublished} published)`,
        totalCommentsPublished
      );

      if (pageComments.length < perPage) {
        break;
      }

      page++;
    }

    // Flush any remaining events in the queue after bulk comments
    await flushEventQueue(context);
  } else {
    // Fallback: fetch comments per issue/PR (less efficient but works)
    // This is a simplified version - in practice, you might want to optimize this further
    for (const issueNumber of issueNumbers) {
      context.abortController.throwIfAborted();

      const issueEventId = context.issueEventIdMap.get(issueNumber);
      if (!issueEventId) continue;

      const sinceDate = context.config.sinceDate
        ? context.config.sinceDate.toISOString()
        : undefined;
      let commentPage = 1;
      const commentsPerPage = 100;

      while (true) {
        context.abortController.throwIfAborted();

        const pageComments = await context.withRateLimit(context.platform, "GET", () =>
          context.api.listIssueComments(context.parsed.owner, context.parsed.repo, issueNumber, {
            per_page: commentsPerPage,
            page: commentPage,
            since: sinceDate,
          })
        );

        if (pageComments.length === 0) {
          break;
        }

        // Filter and publish each comment
        for (const comment of pageComments) {
          if (context.config.sinceDate) {
            const commentDate = new Date(comment.createdAt);
            if (commentDate < context.config.sinceDate!) {
              continue;
            }
          }

          await ensureUserProfile(context, comment.author.login, comment.author.avatarUrl);

          const convertedComments = convertCommentsToNostrEvents(
            [comment],
            issueEventId,
            context.platform,
            context.userProfiles,
            commentEventMap,
            context.importTimestamp,
            context.currentTimestamp
          );

          if (convertedComments.length > 0) {
            const [convertedComment] = convertedComments;

            addBridgedPTags(
              convertedComment.event,
              context.platform,
              comment.author.login,
              context.bridgedNostrPubkeys
            );

            const signedCommentEvent = signEvent(convertedComment.event, convertedComment.privkey);

            // Publish comment event (batched)
            await publishEventBatched(context, signedCommentEvent);

            commentEventMap.set(convertedComment.platformCommentId, signedCommentEvent.id);
            context.currentTimestamp += 1;
            totalCommentsPublished++;
            context.commentsPublished = totalCommentsPublished;
          }
        }

        if (pageComments.length < commentsPerPage) {
          break;
        }

        commentPage++;
      }

      // Clear commentEventMap after each issue to free memory
      commentEventMap.clear();
    }

    // Similar for PRs
    for (const prNumber of prNumbers) {
      context.abortController.throwIfAborted();

      const prEventId = context.prEventIdMap.get(prNumber);
      if (!prEventId) continue;

      const sinceDate = context.config.sinceDate
        ? context.config.sinceDate.toISOString()
        : undefined;
      let commentPage = 1;
      const commentsPerPage = 100;

      while (true) {
        context.abortController.throwIfAborted();

        const pageComments = await context.withRateLimit(context.platform, "GET", () =>
          context.api.listPullRequestComments(context.parsed.owner, context.parsed.repo, prNumber, {
            per_page: commentsPerPage,
            page: commentPage,
            since: sinceDate,
          })
        );

        if (pageComments.length === 0) {
          break;
        }

        for (const comment of pageComments) {
          if (context.config.sinceDate) {
            const commentDate = new Date(comment.createdAt);
            if (commentDate < context.config.sinceDate!) {
              continue;
            }
          }

          await ensureUserProfile(context, comment.author.login, comment.author.avatarUrl);

          const convertedComments = convertCommentsToNostrEvents(
            [comment],
            prEventId,
            context.platform,
            context.userProfiles,
            commentEventMap,
            context.importTimestamp,
            context.currentTimestamp
          );

          if (convertedComments.length > 0) {
            const [convertedComment] = convertedComments;

            addBridgedPTags(
              convertedComment.event,
              context.platform,
              comment.author.login,
              context.bridgedNostrPubkeys
            );

            const signedCommentEvent = signEvent(convertedComment.event, convertedComment.privkey);

            // Publish comment event (batched)
            await publishEventBatched(context, signedCommentEvent);

            commentEventMap.set(convertedComment.platformCommentId, signedCommentEvent.id);
            context.currentTimestamp += 1;
            totalCommentsPublished++;
            context.commentsPublished = totalCommentsPublished;
          }
        }

        if (pageComments.length < commentsPerPage) {
          break;
        }

        commentPage++;
      }

      commentEventMap.clear();
    }

    // Flush any remaining events in the queue after fallback comment fetching
    await flushEventQueue(context);
  }

  return totalCommentsPublished;
}

// ===== Remote Sync Functions =====

function getDestinationRepoName(
  context: Pick<ImportContext, "config" | "parsed"> & { finalRepo?: RepoMetadata | null }
): string {
  const configuredName = context.config.destinationRepoName?.trim();
  if (configuredName) return configuredName;

  if (context.finalRepo) {
    return getImportedRepoName(context.finalRepo);
  }

  return context.parsed.repo;
}

const IMPORT_BRANCH_PUSH_LIMIT = 5;

interface ImportBranchPushRef {
  name: string;
  ref: string;
  commit?: string;
}

function extractBranchCommitTimestampMs(commit: unknown): number {
  if (!commit || typeof commit !== "object") return 0;

  const candidate = commit as {
    committer?: { date?: string };
    author?: { date?: string };
  };

  const commitDate = candidate.committer?.date || candidate.author?.date;
  if (!commitDate) return 0;

  const parsed = Date.parse(commitDate);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function buildSourceCloneCandidates(...urls: Array<string | undefined>): string[] {
  const candidates: string[] = [];
  const add = (value?: string) => {
    const normalized = String(value || "")
      .trim()
      .replace(/\/+$/, "");
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);

    if (/^https?:\/\//i.test(normalized)) {
      if (!normalized.endsWith(".git")) {
        const withGit = `${normalized}.git`;
        if (!candidates.includes(withGit)) candidates.push(withGit);
      } else {
        const withoutGit = normalized.replace(/\.git$/i, "");
        if (withoutGit && !candidates.includes(withoutGit)) candidates.push(withoutGit);
      }
    }
  };

  for (const url of urls) add(url);
  return candidates;
}

async function resolveRecentBranchPushRefs(
  context: ImportContext,
  localRepoId: string,
  sourceUrls: string[],
  fallbackBranch: string
): Promise<ImportBranchPushRef[]> {
  const branchByName = new Map<string, { name: string; commit?: string }>();

  for (const sourceUrl of sourceUrls) {
    try {
      const remoteRefs = await runAbortableOperation<any[]>(
        context.abortController,
        () =>
          context.workerApi.listServerRefs({
            url: sourceUrl,
            prefix: "refs/heads/",
            symrefs: false,
          }),
        "Listing source remote refs",
        20000
      );

      for (const item of remoteRefs || []) {
        const rawRef = String(item?.ref || "");
        if (!rawRef.startsWith("refs/heads/")) continue;
        const branchName = rawRef.replace(/^refs\/heads\//, "").trim();
        if (!branchName) continue;
        const oid = typeof item?.oid === "string" && item.oid.trim() ? item.oid.trim() : undefined;
        branchByName.set(branchName, { name: branchName, commit: oid });
      }

      if (branchByName.size > 0) {
        break;
      }
    } catch {
      // try next source URL candidate
    }
  }

  if (branchByName.size === 0) {
    try {
      const localBranches = await runAbortableOperation<string[]>(
        context.abortController,
        () => context.workerApi.listBranches({ repoId: localRepoId }),
        "Listing local branches",
        30000
      );
      for (const branchName of localBranches || []) {
        const trimmed = String(branchName || "").trim();
        if (!trimmed) continue;
        branchByName.set(trimmed, { name: trimmed });
      }
    } catch {
      // pass
    }
  }

  const normalizedFallbackBranch = String(fallbackBranch || "").trim() || "main";
  if (!branchByName.has(normalizedFallbackBranch)) {
    branchByName.set(normalizedFallbackBranch, { name: normalizedFallbackBranch });
  }

  const configuredSelectedBranches = Array.from(
    new Set(
      ((context.config as ImportConfig & { selectedBranches?: string[] }).selectedBranches || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean)
    )
  );

  if (configuredSelectedBranches.length > 0) {
    const selectedBranchNames = Array.from(
      new Set([
        normalizedFallbackBranch,
        ...configuredSelectedBranches.filter((name) => name !== normalizedFallbackBranch),
      ])
    );

    return selectedBranchNames.map((name) => ({
      name,
      ref: `refs/heads/${name}`,
      commit: branchByName.get(name)?.commit,
    }));
  }

  const sourceRepo = (() => {
    for (const sourceUrl of sourceUrls) {
      try {
        return parseRepoUrl(sourceUrl);
      } catch {
        // continue
      }
    }
    return context.parsed;
  })();

  const otherBranchNames = Array.from(branchByName.keys()).filter(
    (branchName) => branchName !== normalizedFallbackBranch
  );

  if (!shouldFetchBranchActivity(context.sourceAccessMode)) {
    const selectedOtherBranches = sortImportBranches(
      otherBranchNames.map((branchName) => ({
        name: branchName,
        timestampMs: 0,
        isDefault: false,
      }))
    ).slice(0, Math.max(0, IMPORT_BRANCH_PUSH_LIMIT - 1));

    const selectedBranchNames = [
      normalizedFallbackBranch,
      ...selectedOtherBranches.map((branch) => branch.name),
    ];

    return Array.from(new Set(selectedBranchNames)).map((name) => ({
      name,
      ref: `refs/heads/${name}`,
      commit: branchByName.get(name)?.commit,
    }));
  }

  const recencyScored = await mapWithConcurrency(otherBranchNames, 6, async (branchName) => {
    try {
      const commits = await context.withRateLimit(context.platform, "listCommits", () =>
        context.api.listCommits(sourceRepo.owner, sourceRepo.repo, {
          sha: branchName,
          per_page: 1,
        })
      );
      const timestampMs = extractBranchCommitTimestampMs(
        Array.isArray(commits) ? commits[0] : undefined
      );
      return { name: branchName, timestampMs };
    } catch {
      return { name: branchName, timestampMs: 0 };
    }
  });

  const orderedBranches = sortImportBranches(
    recencyScored.map((branch) => ({ ...branch, isDefault: false }))
  );

  const selectedOtherBranches = orderedBranches.slice(0, Math.max(0, IMPORT_BRANCH_PUSH_LIMIT - 1));
  const selectedBranchNames = [
    normalizedFallbackBranch,
    ...selectedOtherBranches.map((branch) => branch.name),
  ];

  return Array.from(new Set(selectedBranchNames)).map((name) => ({
    name,
    ref: `refs/heads/${name}`,
    commit: branchByName.get(name)?.commit,
  }));
}

async function syncRepositoryToRemotes(
  context: ImportContext,
  sourceUrl: string,
  sourceToken: string | undefined,
  targets: ImportRemoteTarget[]
): Promise<ImportRemotePushResult[]> {
  if (!targets.length) return [];

  if (!context.workerApi) {
    return targets.map((target) => ({
      id: target.id,
      label: target.label,
      provider: target.provider,
      success: false,
      error: "Git worker unavailable for remote sync",
    }));
  }

  const repoName = getDestinationRepoName(context);
  const repoDescription = context.finalRepo?.description || "";
  const targetBranch = context.finalRepo?.defaultBranch || "main";
  const localRepoId = parseRepoId(
    `${context.userPubkey}:import-${repoName}-${context.importTimestamp}`
  );
  const localCloneDir = `/repos/${localRepoId}`;
  const sourceUrlCandidates = buildSourceCloneCandidates(sourceUrl, context.parsed?.url);

  if (sourceUrlCandidates.length === 0) {
    throw new Error("No valid source clone URL candidates available");
  }

  context.updateProgress("Preparing local mirror for remote sync...");
  context.abortController.throwIfAborted();

  let clonedFrom = "";
  let cloneFailure = "";
  for (let sourceIndex = 0; sourceIndex < sourceUrlCandidates.length; sourceIndex++) {
    const candidateUrl = sourceUrlCandidates[sourceIndex];
    try {
      context.updateProgress(
        `Cloning source repository (${sourceIndex + 1}/${sourceUrlCandidates.length})...`
      );
      await runAbortableOperation(
        context.abortController,
        () =>
          context.workerApi.cloneRemoteRepo({
            url: candidateUrl,
            dir: localCloneDir,
            token: sourceToken,
          }),
        "Cloning source repository",
        90000
      );
      clonedFrom = candidateUrl;
      break;
    } catch (error) {
      cloneFailure = error instanceof Error ? error.message : String(error);
    }
  }

  if (!clonedFrom) {
    throw new Error(
      `Failed to clone source repository from ${sourceUrlCandidates.length} candidate URL(s): ${cloneFailure || "unknown error"}`
    );
  }

  const branchPushRefs = await resolveRecentBranchPushRefs(
    context,
    localRepoId,
    sourceUrlCandidates,
    targetBranch
  );
  context.selectedBranchRefs = branchPushRefs;

  const pushPlanSummary =
    branchPushRefs.length <= 8
      ? branchPushRefs.map((branchRef) => branchRef.name).join(", ")
      : `${branchPushRefs
          .slice(0, 8)
          .map((branchRef) => branchRef.name)
          .join(", ")} (+${branchPushRefs.length - 8} more)`;
  context.updateProgress(
    `Prepared ${branchPushRefs.length} branch ref${branchPushRefs.length === 1 ? "" : "s"} for sync${
      pushPlanSummary ? `: ${pushPlanSummary}` : ""
    }`
  );

  const refs: RemoteSyncRef[] = branchPushRefs.map((branchRef) => ({
    type: "heads",
    name: branchRef.name,
    ref: branchRef.ref,
    commit: branchRef.commit,
  }));

  return await syncLocalRepoToTargets({
    workerApi: context.workerApi,
    localRepoId,
    repoName,
    repoDescription,
    defaultBranch: targetBranch,
    refs,
    targets,
    userPubkey: context.userPubkey,
    relays: context.config.relays || [],
    onPublishEvent: context.onPublishEvent as ((event: NostrEvent) => Promise<unknown>) | undefined,
    onFetchRelayEvents: context.onFetchRelayEvents,
    updateProgress: (message) => context.updateProgress(message),
    runAbortable: (operation, label, timeoutMs) =>
      runAbortableOperation(context.abortController, operation, label, timeoutMs),
    throwIfAborted: () => context.abortController.throwIfAborted(),
    withRateLimit: context.withRateLimit,
    latestRepoMetadataCreatedAt: context.latestRepoMetadataCreatedAt,
    onLatestRepoMetadataCreatedAt: (value) => {
      context.latestRepoMetadataCreatedAt = value;
    },
    community: context.config.community,
    requireNonGraspSuccessBeforeGrasp: true,
  });
}

// ===== Event Conversion Functions =====

/**
 * Convert repository metadata to Nostr events
 */
function convertRepoEvents(context: ImportContext): {
  announcement: Omit<NostrEvent, "id" | "sig" | "pubkey">;
  state: Omit<NostrEvent, "id" | "sig" | "pubkey">;
} {
  context.updateProgress("Converting repository metadata...");
  context.abortController.throwIfAborted();

  if (!context.finalRepo) {
    throw new Error("Repository metadata is not available for conversion");
  }

  // Get relays from config (required for repo announcement)
  const relays = Array.from(
    new Set(
      getEffectiveRepoRelayUrls(
        getEditableRepoRelayUrls(
          context.config.relays || [],
          context.remoteTargets
            .filter((target) => target.provider === "grasp" && target.relayUrl)
            .map((target) => target.relayUrl as string)
        ),
        getSuccessfulGraspRelayUrls(
          context.remotePushResults.map((result) => result.remoteUrl || "")
        )
      )
    )
  );

  if (relays.length === 0) {
    throw new Error("At least one relay is required for repository announcement");
  }

  const { announcement: repoAnnouncementEventTemplate, state: repoStateEventTemplate } =
    buildImportedRepoEvents({
      repo: context.finalRepo,
      relays,
      userPubkey: context.userPubkey,
      repoName: getDestinationRepoName(context),
      importTimestamp: context.importTimestamp,
      latestRepoMetadataCreatedAt: context.latestRepoMetadataCreatedAt,
      remotePushResults: context.remotePushResults,
      selectedBranchRefs: context.selectedBranchRefs || [],
      community: context.config.community,
    });

  return {
    announcement: repoAnnouncementEventTemplate,
    state: repoStateEventTemplate,
  };
}

// ===== Event Publishing Functions =====

/**
 * Sign and publish repository events
 */
async function publishRepoEvents(
  context: ImportContext,
  repoEvents: {
    announcement: Omit<NostrEvent, "id" | "sig" | "pubkey">;
    state: Omit<NostrEvent, "id" | "sig" | "pubkey">;
  }
): Promise<{ announcement: NostrEvent; state: NostrEvent }> {
  context.updateProgress("Publishing repository events...");
  context.abortController.throwIfAborted();

  let signedRepoAnnouncement: NostrEvent;
  let signedRepoState: NostrEvent;

  // Sign repo announcement event using available signer method
  // Note: We need the signed event to get its ID, so we can't use EventIO directly
  if (context.onSignEvent) {
    signedRepoAnnouncement = await context.onSignEvent(repoEvents.announcement);
    signedRepoState = await context.onSignEvent(repoEvents.state);
  } else if (context.eventIO) {
    // EventIO signs internally but doesn't return the signed event
    // We need the event ID, so we can't use EventIO for events that need IDs
    throw new Error(
      "EventIO cannot be used for repo events that need IDs. Please provide onSignEvent callback."
    );
  } else {
    throw new Error("onSignEvent callback is required to sign repo events");
  }

  // Publish signed repo events
  if (context.onPublishEvent) {
    await context.onPublishEvent(signedRepoAnnouncement);
    await context.onPublishEvent(signedRepoState);
  } else if (context.eventIO) {
    // EventIO doesn't accept already-signed events, so we need onPublishEvent
    throw new Error("onPublishEvent callback is required to publish signed events");
  } else {
    throw new Error("Either onPublishEvent callback must be provided to publish events");
  }

  return {
    announcement: signedRepoAnnouncement,
    state: signedRepoState,
  };
}

/**
 * Publish profile events (kind 0) for all platform users
 */
async function publishProfileEvents(context: ImportContext): Promise<void> {
  context.updateProgress(`Publishing ${context.profileEvents.size} user profiles...`);
  context.abortController.throwIfAborted();

  let profileCount = 0;
  for (const [, profileEvent] of context.profileEvents.entries()) {
    context.abortController.throwIfAborted();
    context.updateProgress(
      `Publishing profile ${++profileCount}/${context.profileEvents.size}...`,
      profileCount,
      context.profileEvents.size
    );

    // Publish profile event (batched)
    await publishEventBatched(context, profileEvent);
  }
}

/**
 * Svelte 5 composable for importing repositories from Git hosting providers
 */
export function useImportRepo(options: UseImportRepoOptions) {
  const {
    onProgress,
    onImportCompleted,
    userPubkey,
    workerApi,
    eventIO,
    onFetchEvents,
    onFetchRelayEvents,
    onSignEvent,
    onPublishEvent,
    onRollbackPublishedRepoEvents,
  } = options;

  // Validate that we have a way to sign user events (repo events, status events)
  if (!onSignEvent && !eventIO) {
    throw new Error("Either onSignEvent callback or eventIO must be provided to sign user events");
  }

  let isImporting = $state(false);
  let progress = $state<ImportProgress | undefined>();
  let error = $state<string | null>(null);
  let abortController: ImportAbortController | null = null;

  /** Current phase; updated before each phase so context.updateProgress(step, current, total) uses it */
  const currentPhaseRef = { current: "connecting" as ImportPhase };

  /** Counts of mirrored items per phase; updated as each phase completes (for UI to show "X mirrored") */
  const completedCountsRef: { current: ImportCompletedCounts } = { current: {} };

  /**
   * Update progress state and call callback.
   */
  function setProgress(phase: ImportPhase, step: string, current?: number, total?: number): void {
    progress = {
      phase,
      step,
      current,
      total,
      isComplete: phase === "complete",
      completedCounts: { ...completedCountsRef.current },
    };
    onProgress?.(progress);
  }

  /** Passed to context: updates progress using currentPhaseRef.current as phase */
  function contextUpdateProgress(step: string, current?: number, total?: number): void {
    setProgress(currentPhaseRef.current, step, current, total);
  }

  /**
   * Main import function
   *
   * @param repoUrl - Repository URL to import (e.g., "https://github.com/owner/repo")
   * @param token - Authentication token for the Git hosting provider
   * @param config - Import configuration options
   * @returns Import result with events and statistics
   */
  async function importRepository(
    repoUrl: string,
    token?: string | null,
    config: ImportConfig = DEFAULT_IMPORT_CONFIG,
    remoteTargets: ImportRemoteTarget[] = []
  ): Promise<ImportResult> {
    if (isImporting) {
      throw new Error("Import operation already in progress");
    }

    isImporting = true;
    error = null;
    abortController = new ImportAbortController();
    currentPhaseRef.current = "connecting";

    // Create rate limiter and wrapper (context progress uses currentPhaseRef)
    const rateLimiter = createRateLimiter(contextUpdateProgress);
    const withRateLimitFn = createWithRateLimit(rateLimiter, abortController);
    const normalizedToken = token?.trim() || "";
    const sourceAccessMode: SourceAccessMode = normalizedToken ? "token" : "anonymous";
    const effectiveConfig = getEffectiveImportConfig(config, sourceAccessMode);

    try {
      // Initialize context
      let signedRepoAnnouncement: NostrEvent | null = null;
      let signedRepoState: NostrEvent | null = null;

      const partialContext = await initializeImportContext(
        repoUrl,
        normalizedToken,
        effectiveConfig,
        userPubkey,
        contextUpdateProgress,
        abortController,
        withRateLimitFn,
        onSignEvent,
        onPublishEvent,
        workerApi,
        eventIO,
        onFetchEvents,
        onFetchRelayEvents
      );

      // Complete context initialization
      const context: ImportContext = {
        ...partialContext,
        rateLimiter,
        withRateLimit: withRateLimitFn,
        finalRepo: null, // Will be set during repository setup
        repoAddr: "", // Will be set below
        importTimestamp: Math.floor(Date.now() / 1000),
        startTimestamp: 0, // Will be set below
        currentTimestamp: 0, // Will be set below
        latestRepoMetadataCreatedAt: 0,
        userProfiles: new Map(),
        profileEvents: new Map(),
        bridgedNostrPubkeys: new Map(),
        nip39CheckedKeys: new Set(),
        issueEventIdMap: new Map(),
        prEventIdMap: new Map(),
        commentEventMap: new Map(),
        issuesPublished: 0,
        prsPublished: 0,
        commentsPublished: 0,
        remotePushResults: [],
        remoteTargets,
        selectedBranchRefs: [],
      } as ImportContext;

      // Validation & Repository Setup
      const { repo: ownershipRepo, isOwner } = await validateTokenAndOwnership(context);

      if (!ownershipRepo) {
        throw new Error("Failed to fetch repository information");
      }

      if (!isOwner && remoteTargets.length === 0) {
        throw new Error(
          "At least one writable import target is required for repositories you do not own"
        );
      }

      // Set initial repo
      context.finalRepo = ownershipRepo;

      currentPhaseRef.current = "repository";
      // Fork if needed (this updates context.finalRepo)
      const forkedOrOriginalRepo = await ensureForkedRepo(context, isOwner);
      if (!forkedOrOriginalRepo) {
        throw new Error("Failed to ensure repository access");
      }
      context.finalRepo = forkedOrOriginalRepo;

      // Fetch full metadata if needed
      const repoWithMetadata = await fetchRepoMetadata(context, ownershipRepo);
      if (!repoWithMetadata) {
        throw new Error("Failed to fetch repository metadata");
      }
      context.finalRepo = repoWithMetadata;

      // Final safety check before proceeding
      if (!context.finalRepo) {
        throw new Error("Repository metadata is null after setup - this should not happen");
      }

      // Initialize repo address and timestamps
      const repoName = getDestinationRepoName(context);
      context.repoAddr = `30617:${userPubkey}:${repoName}`;
      context.startTimestamp = context.importTimestamp - 3600; // Start from 1 hour ago
      context.currentTimestamp = context.startTimestamp;

      // Sync git data to selected remote targets (continue on individual failures)
      if (remoteTargets.length > 0) {
        currentPhaseRef.current = "remotes";
        const sourceCloneUrl = context.finalRepo.cloneUrl || repoUrl;
        context.remotePushResults = await syncRepositoryToRemotes(
          context,
          sourceCloneUrl,
          normalizedToken,
          remoteTargets
        );

        const successfulTargets = context.remotePushResults.filter((result) => result.success);
        if (successfulTargets.length === 0) {
          const hasGraspTarget = remoteTargets.some((target) => target.provider === "grasp");
          let rollbackWarning = "";

          if (hasGraspTarget && onRollbackPublishedRepoEvents) {
            const rollbackRelays = Array.from(
              new Set(
                getEffectiveRepoRelayUrls(
                  getEditableRepoRelayUrls(
                    context.config.relays || [],
                    remoteTargets
                      .filter((target) => target.provider === "grasp" && target.relayUrl)
                      .map((target) => target.relayUrl as string)
                  ),
                  remoteTargets
                    .filter((target) => target.provider === "grasp" && target.relayUrl)
                    .map((target) => target.relayUrl as string)
                )
              )
            );

            try {
              await onRollbackPublishedRepoEvents({
                repoName,
                relays: rollbackRelays,
              });
            } catch (rollbackError) {
              rollbackWarning = `; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
            }
          }

          const failedSummary = context.remotePushResults
            .map((result) => `${result.label}: ${result.error || "push failed"}`)
            .join("; ");
          throw new Error(
            `Failed to push to all selected import targets (${failedSummary})${rollbackWarning}`
          );
        }
      }

      // Step 2: Stream issues (fetch, process, publish immediately)
      let issuesImported = 0;
      if (context.config.mirrorIssues) {
        currentPhaseRef.current = "issues";
        const issueResult = await fetchAndPublishIssuesStreaming(context);
        issuesImported = issueResult.count;
        completedCountsRef.current.issues = issuesImported;
      }

      // Step 3: Stream PRs (fetch, process, publish immediately)
      let prsImported = 0;
      if (context.config.mirrorPullRequests) {
        currentPhaseRef.current = "pull_requests";
        prsImported = await fetchAndPublishPRsStreaming(context);
        completedCountsRef.current.pull_requests = prsImported;
      }

      // Step 4: Stream comments (if enabled)
      let commentsImported = 0;
      if (context.config.mirrorComments) {
        currentPhaseRef.current = "comments";
        const issueNumbers = new Set(Array.from(context.issueEventIdMap.keys()));
        const prNumbers = new Set(Array.from(context.prEventIdMap.keys()));
        commentsImported = await fetchAndPublishCommentsStreaming(context, issueNumbers, prNumbers);
        completedCountsRef.current.comments = commentsImported;
      }

      // Step 5: Publish user profiles encountered on the Git platform
      currentPhaseRef.current = "profiles";
      await publishProfileEvents(context);

      // Final flush: ensure all queued events are published before completing
      await flushEventQueue(context);

      // Publish repo announcement/state at the end (after remote sync and mirror data)
      currentPhaseRef.current = "repository";
      const repoEvents = convertRepoEvents(context);
      const publishedRepoEvents = await publishRepoEvents(context, repoEvents);
      signedRepoAnnouncement = publishedRepoEvents.announcement;
      signedRepoState = publishedRepoEvents.state;

      // Complete
      setProgress("complete", "Import completed successfully!");

      // Final validation before returning result
      if (!context.finalRepo) {
        throw new Error("Repository metadata was lost during import");
      }

      if (!signedRepoAnnouncement || !signedRepoState) {
        throw new Error("Repository events were not published");
      }

      const result: ImportResult = {
        announcementEvent: signedRepoAnnouncement as RepoAnnouncementEvent,
        stateEvent: signedRepoState as RepoStateEvent,
        issuesImported,
        commentsImported,
        prsImported,
        profilesCreated: context.userProfiles.size,
        repo: buildImportedRepoMetadata(context.finalRepo, context.config.destinationRepoName),
        remotePushResults: context.remotePushResults,
      };

      onImportCompleted?.(result);

      return result;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof ImportAbortedError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      error = errorMessage;

      if (progress) {
        progress.error = errorMessage;
        progress.isComplete = false;
      }

      // Re-throw ImportAbortedError as-is, wrap others
      if (err instanceof ImportAbortedError) {
        throw err;
      }
      throw new Error(errorMessage);
    } finally {
      isImporting = false;
      abortController = null;
    }
  }

  /**
   * Abort the current import operation
   */
  function abortImport(reason?: string): void {
    if (abortController) {
      abortController.abort(reason);
    }
  }

  return {
    importRepository,
    abortImport,
    get isImporting() {
      return isImporting;
    },
    get progress() {
      return progress;
    },
    get error() {
      return error;
    },
  };
}
