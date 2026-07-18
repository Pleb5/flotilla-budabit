import type { Event as NostrEvent } from "nostr-tools";
import { getGitServiceApi } from "@nostr-git/core/git";
import { tokens as tokensStore, type Token } from "../stores/tokens.js";
import {
  createRepoAnnouncementEvent as createAnnouncementEventShared,
  createRepoStateEvent as createStateEventShared,
  type RepoCommunityBinding,
} from "@nostr-git/core/events";
import { parseRepoId } from "@nostr-git/core/utils";
import { tryTokensForHost, getTokensForHost } from "../utils/tokenHelpers.js";
import { checkGraspRepoExists } from "../utils/grasp-availability.js";
import {
  applyReconciledGraspResults,
  getRemoteSyncProvisionalEvents,
  publishRepoSyncAnnouncement,
  syncLocalRepoToTargets,
  type RemoteSyncTargetResult,
} from "../utils/remote-sync.js";
import {
  preflightNewRemoteTargets,
  type RemoteTargetProvider,
  type RemoteTargetSelection,
} from "../utils/remote-targets.js";
import {
  getRepoCreationProvisionalEvents,
  RepoCreationTransactionJournal,
  trackRepoCreationPublisher,
} from "../utils/repo-creation-transaction.js";
import {
  createGraspAnnouncementAndState,
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  getSuccessfulGraspRelayUrls,
  normalizeGraspOrigins,
  reconcileRepoCreationEvents,
  toNpubOrSelf,
  type DeleteRepoEvent,
  type FetchRelayEvents,
  type PublishRepoEvent,
} from "../utils/grasp-pipeline.js";
import {
  createGitOperationId,
  createGitOperationProgressObserver,
  type GitOperationActivity,
  type SubscribeGitProgress,
} from "../utils/git-operation-progress.js";
import {
  assertRepoCoordinateAvailable,
  assertRepoCreationPrerequisites,
} from "../utils/repo-creation-preflight.js";

export function getPublishedEventFromPublishResult(result: unknown): NostrEvent | undefined {
  const event = (result as { event?: NostrEvent } | undefined)?.event;
  return event?.id ? event : undefined;
}

type NewRepoWebUrlKind = "budabit" | "gitworkshop";

function parseNewRepoWebUrl(value: string): URL | undefined {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;

  try {
    if (trimmed.startsWith("/")) return new URL(trimmed, "https://budabit.club");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return new URL(`https://${trimmed}`);
    return new URL(trimmed);
  } catch {
    return undefined;
  }
}

function getNewRepoWebUrlKind(value: string): NewRepoWebUrlKind | undefined {
  const parsed = parseNewRepoWebUrl(value);
  if (!parsed) return undefined;

  const host = parsed.host.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (host === "gitworkshop.dev" || host.endsWith(".gitworkshop.dev")) return "gitworkshop";
  if (host === "budabit.club" || host.endsWith(".budabit.club")) return "budabit";
  if (pathname.startsWith("/git/") || pathname.includes("/git/")) return "budabit";

  return undefined;
}

export function selectNewRepoWebUrls(values: string[] | undefined): string[] {
  const selected: Partial<Record<NewRepoWebUrlKind, string>> = {};

  for (const value of values || []) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;

    const kind = getNewRepoWebUrlKind(trimmed);
    if (kind && !selected[kind]) selected[kind] = trimmed;
  }

  return [selected.budabit, selected.gitworkshop].filter((value): value is string =>
    Boolean(value)
  );
}

async function checkGraspRepoAvailability(
  repoName: string,
  relayUrl?: string,
  userPubkey?: string
): Promise<{ available: boolean; reason?: string; username?: string }> {
  if (!relayUrl) {
    return {
      available: false,
      reason: "GRASP relay URL is required to check repository availability",
    };
  }
  if (!userPubkey) {
    return {
      available: false,
      reason: "User pubkey is required to check GRASP repository availability",
    };
  }

  try {
    const username = toNpubOrSelf(userPubkey);
    const probe = await checkGraspRepoExists({
      relayUrl,
      userPubkey,
      owner: username,
      repoName,
    });

    if (probe.exists) {
      return {
        available: false,
        reason: "Repository name already exists on this GRASP relay",
        username,
      };
    }

    return { available: true, username };
  } catch (error) {
    return {
      available: false,
      reason: `Failed to check GRASP availability: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if a repository name is available on GitHub
 * @param repoName - The repository name to check
 * @param token - GitHub authentication token
 * @returns Promise with availability status and reason if unavailable
 */
export async function checkGitHubRepoAvailability(
  repoName: string,
  token: string
): Promise<{
  available: boolean;
  reason?: string;
  username?: string;
}> {
  try {
    // Use GitServiceApi abstraction instead of hardcoded GitHub API calls
    const api = getGitServiceApi("github", token);

    // Get the authenticated user's information
    const currentUser = await api.getCurrentUser();
    const username = currentUser.login;

    // Check if repository already exists by trying to fetch it
    try {
      await api.getRepo(username, repoName);
      // Repository exists
      return {
        available: false,
        reason: "Repository name already exists in your account",
        username,
      };
    } catch (error: any) {
      // Repository doesn't exist (good!) - API throws error for 404
      if (error.message?.includes("404") || error.message?.includes("Not Found")) {
        return { available: true, username };
      }
      // Some other error occurred
      throw error;
    }
  } catch (error) {
    console.error("Error checking repo availability:", error);
    return {
      available: false,
      reason: `Failed to check availability: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check repository name availability for a single selected provider
 * @param provider - one of 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'grasp'
 * @param repoName - repository name to check
 * @param tokens - user tokens
 * @param relayUrl - optional relay URL for GRASP (not used for availability, informational only)
 */
export async function checkProviderRepoAvailability(
  provider: string,
  repoName: string,
  tokens: Token[],
  relayUrl?: string,
  userPubkey?: string
): Promise<{
  results: Array<{
    provider: string;
    host: string;
    available: boolean;
    reason?: string;
    username?: string;
    error?: string;
  }>;
  hasConflicts: boolean;
  availableProviders: string[];
  conflictProviders: string[];
}> {
  // GRASP checks availability against the selected relay and current npub namespace.
  if (provider === "grasp") {
    const check = await checkGraspRepoAvailability(repoName, relayUrl, userPubkey);
    return {
      results: [
        {
          provider,
          host: relayUrl || "nostr-relay",
          available: check.available,
          reason: check.reason,
          username: check.username,
        },
      ],
      hasConflicts: !check.available,
      availableProviders: check.available ? ["grasp"] : [],
      conflictProviders: check.available ? [] : ["grasp"],
    };
  }

  // Map provider to default hostname for token matching
  const defaultHosts: Record<string, string> = {
    github: "github.com",
    gitlab: "gitlab.com",
    gitea: "gitea.com",
    bitbucket: "bitbucket.org",
  };

  const defaultHost = defaultHosts[provider as keyof typeof defaultHosts] || provider;
  const matchingTokens = getTokensForHost(tokens, defaultHost);

  if (matchingTokens.length === 0) {
    // No token means destination availability cannot be proven.
    return {
      results: [
        {
          provider,
          host: "unknown",
          available: false,
          reason: "No token configured; destination availability is unknown.",
        },
      ],
      hasConflicts: true,
      availableProviders: [],
      conflictProviders: [provider],
    };
  }

  // Try all tokens until one succeeds
  try {
    console.log(
      `[checkProviderRepoAvailability] Trying tokens for ${provider} (host: ${defaultHost})`
    );
    console.log(`[checkProviderRepoAvailability] Found ${matchingTokens.length} matching tokens`);
    matchingTokens.forEach((t, i) => {
      const tokenPreview = t.token
        ? `${t.token.substring(0, 4)}...${t.token.substring(t.token.length - 4)}`
        : "empty";
      console.log(
        `[checkProviderRepoAvailability] Token ${i + 1}: host="${t.host}", token=${tokenPreview}, length=${t.token?.length || 0}`
      );
    });

    const result = await tryTokensForHost(
      tokens,
      defaultHost,
      async (token: string, host: string) => {
        const tokenPreview = token
          ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
          : "empty";
        console.log(
          `[checkProviderRepoAvailability] Attempting with token: ${tokenPreview} for host: ${host}`
        );
        const api = getGitServiceApi(provider as any, token);
        console.log(`[checkProviderRepoAvailability] Calling getCurrentUser for ${provider}...`);
        let currentUser;
        try {
          currentUser = await api.getCurrentUser();
          console.log(`[checkProviderRepoAvailability] getCurrentUser succeeded:`, currentUser);
        } catch (authError: any) {
          console.error(
            `[checkProviderRepoAvailability] getCurrentUser failed:`,
            authError?.message || authError
          );
          throw authError;
        }
        const username = (currentUser as any).login || (currentUser as any).username || "me";

        try {
          await api.getRepo(username, repoName);
          // Exists → conflict
          return {
            results: [
              {
                provider,
                host: host, // Use the host of the token that succeeded
                available: false,
                reason: `Repository name already exists in your ${provider} account`,
                username,
              },
            ],
            hasConflicts: true,
            availableProviders: [],
            conflictProviders: [provider],
          };
        } catch (error: any) {
          if (error?.message?.includes("404") || error?.message?.includes("Not Found")) {
            return {
              results: [
                {
                  provider,
                  host: host,
                  available: true,
                  username,
                },
              ],
              hasConflicts: false,
              availableProviders: [provider],
              conflictProviders: [],
            };
          }
          // Unknown provider evidence must block creation.
          return {
            results: [
              {
                provider,
                host: host,
                available: false,
                error: String(error?.message || error),
                username,
              },
            ],
            hasConflicts: true,
            availableProviders: [],
            conflictProviders: [provider],
          };
        }
      }
    );
    return result;
  } catch (e: any) {
    // Network or API errors leave destination availability unknown.
    return {
      results: [
        {
          provider,
          host: "unknown",
          available: false,
          error: String(e?.message || e),
        },
      ],
      hasConflicts: true,
      availableProviders: [],
      conflictProviders: [provider],
    };
  }
}

/**
 * Check repository name availability across all providers the user has tokens for
 * @param repoName - The repository name to check
 * @param tokens - Array of user tokens
 * @returns Promise with availability results for each provider
 */
export async function checkMultiProviderRepoAvailability(
  repoName: string,
  tokens: Token[]
): Promise<{
  results: Array<{
    provider: string;
    host: string;
    available: boolean;
    reason?: string;
    username?: string;
    error?: string;
  }>;
  hasConflicts: boolean;
  availableProviders: string[];
  conflictProviders: string[];
}> {
  // Map between provider names and their API hosts
  const providerHosts: Record<string, string> = {
    github: "github.com",
    gitlab: "gitlab.com",
    gitea: "gitea.com",
    bitbucket: "bitbucket.org",
  };

  const results: Array<{
    provider: string;
    host: string;
    available: boolean;
    reason?: string;
    username?: string;
    error?: string;
  }> = [];
  const availableProviders: string[] = [];
  const conflictProviders: string[] = [];

  // Check availability for each provider the user has tokens for
  for (const token of tokens) {
    // Handle both standard providers and GRASP relays
    let provider;

    if (token.host === "grasp.relay") {
      provider = "grasp";
    } else {
      // Map host to provider name (github.com -> github)
      provider = Object.entries(providerHosts).find(
        ([providerName, host]) => host === token.host
      )?.[0];
    }

    if (!provider) {
      console.warn(`Unknown provider for host: ${token.host}`);
      // Skip unknown providers
      continue;
    }

    try {
      const api = getGitServiceApi(provider as any, token.token);

      // Get the authenticated user's information
      const currentUser = await api.getCurrentUser();
      const username = currentUser.login;

      // Check if repository already exists
      try {
        await api.getRepo(username, repoName);
        // Repository exists - conflict
        results.push({
          provider,
          host: token.host,
          available: false,
          reason: `Repository name already exists in your ${provider} account`,
          username,
        });
        conflictProviders.push(provider);
      } catch (error: any) {
        // Repository doesn't exist (good!)
        if (error.message?.includes("404") || error.message?.includes("Not Found")) {
          results.push({
            provider,
            host: token.host,
            available: true,
            username,
          });
          availableProviders.push(provider);
        } else {
          // Some other error occurred
          throw error;
        }
      }
    } catch (error) {
      // Network error or API issue
      console.warn(`Error checking repo availability on ${provider}:`, error);
      results.push({
        provider,
        host: token.host,
        available: true, // Assume available if we can't check
        error: error instanceof Error ? error.message : String(error),
      });
      availableProviders.push(provider); // Assume available
    }
  }

  return {
    results,
    hasConflicts: conflictProviders.length > 0,
    availableProviders,
    conflictProviders,
  };
}

export interface NewRepoConfig {
  name: string;
  description?: string;
  defaultBranch: string;
  initializeWithReadme?: boolean;
  gitignoreTemplate?: string;
  licenseTemplate?: string;
  authorName?: string;
  authorEmail?: string;
  authorPubkey?: string;
  provider: string; // Git provider (github, gitlab, gitea, etc.)
  providers?: string[]; // Optional multi-provider creation
  relayUrl?: string; // For GRASP provider (primary)
  relayUrls?: string[]; // For GRASP provider (multi-relay)
  // Author information
  // NIP-34 metadata
  maintainers?: string[]; // Additional maintainer pubkeys
  relays?: string[]; // Preferred relays for this repo
  tags?: string[]; // Repository tags/topics
  webUrl?: string; // Web browsing URL
  webUrls?: string[]; // Preferred ordered web URLs
  cloneUrl?: string; // Git clone URL
  cloneUrls?: string[]; // Preferred ordered clone URLs
  cloneUrlOrder?: string[]; // Provider order for clone URL priority
  community?: RepoCommunityBinding;
}

export interface NewRepoResult {
  localRepo: {
    repoId: string;
    path: string;
    branch: string;
    initialCommit: string;
  };
  remoteRepo?: {
    url: string;
    provider: string;
    webUrl: string;
  };
  remoteRepos?: Array<{
    url: string;
    provider: string;
    webUrl: string;
  }>;
  announcementEvent: Omit<NostrEvent, "id" | "sig" | "pubkey" | "created_at">;
  stateEvent: Omit<NostrEvent, "id" | "sig" | "pubkey" | "created_at">;
}

export interface NewRepoProgress {
  step: string;
  message: string;
  status: "pending" | "running" | "completed" | "error";
  error?: string;
}

export interface UseNewRepoOptions {
  workerApi?: any; // Git worker API instance (optional for backward compatibility)
  workerInstance?: Worker; // Worker instance for event signing (required for GRASP)
  onProgress?: (progress: NewRepoProgress[]) => void;
  onRepoCreated?: (result: NewRepoResult) => void;
  onPublishEvent?: PublishRepoEvent;
  onDeleteEvent?: DeleteRepoEvent;
  userPubkey?: string; // User's nostr pubkey (required for GRASP repos)
  /** Fetch events from specific relays for GRASP state visibility checks */
  onFetchRelayEvents?: FetchRelayEvents;
  subscribeGitProgress?: SubscribeGitProgress;
}

/**
 * Svelte hook for creating new repositories with NIP-34 integration
 *
 * @example
 * ```typescript
 * const { createRepository, isCreating, progress, error } = useNewRepo({
 *   onProgress: (steps) => console.log('Progress:', steps),
 *   onRepoCreated: (result) => console.log('Created:', result),
 *   onPublishEvent: async (event) => await publishToRelay(event)
 * });
 *
 * // Create a new repository
 * await createRepository({
 *   name: 'my-project',
 *   description: 'A cool project',
 *   initializeWithReadme: true,
 *   gitignoreTemplate: 'node',
 *   licenseTemplate: 'mit',
 *   defaultBranch: 'main'
 * });
 * ```
 */
export function useNewRepo(options: UseNewRepoOptions = {}) {
  let isCreating = $state(false);
  let progress = $state<NewRepoProgress[]>([]);
  let error = $state<string | null>(null);
  let operationActivity = $state<GitOperationActivity | undefined>();

  let tokens = $state<Token[]>([]);

  // Subscribe to token store changes and update reactive state
  tokensStore.subscribe((t) => {
    tokens = t;
    console.log("🔐 Token store updated, now have", t.length, "tokens");
  });

  const { onProgress, onRepoCreated, onPublishEvent } = options;
  const userPubkey = options.userPubkey;

  function updateProgress(
    step: string,
    message: string,
    status: NewRepoProgress["status"],
    errorMsg?: string
  ) {
    const stepIndex = progress.findIndex((p) => p.step === step);
    const newStep: NewRepoProgress = { step, message, status, error: errorMsg };

    if (stepIndex >= 0) {
      progress[stepIndex] = newStep;
    } else {
      progress = [...progress, newStep];
    }

    onProgress?.(progress);
  }

  // Resolve the canonical repo key for this creation flow
  async function computeCanonicalKey(config: NewRepoConfig): Promise<string> {
    if (config.authorPubkey) {
      const providers =
        config.providers && config.providers.length > 0 ? config.providers : [config.provider];
      const usesGrasp = providers.includes("grasp") || config.provider === "grasp";
      const owner = usesGrasp ? toNpubOrSelf(config.authorPubkey) : config.authorPubkey;
      // Use "owner:name" form which parseRepoId will normalize
      return parseRepoId(`${owner}:${config.name}`);
    }
    throw new Error("Could not get pubkey for GRASP canonical key");
  }

  function normalizeList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const trimmed = String(value || "").trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  function getSelectedProviders(config: NewRepoConfig): string[] {
    const values = normalizeList(
      config.providers && config.providers.length > 0 ? config.providers : [config.provider]
    );
    return values.length > 0 ? values : [config.provider];
  }

  async function createRepository(config: NewRepoConfig): Promise<NewRepoResult | null> {
    if (isCreating) {
      throw new Error("Repository creation already in progress");
    }

    let transactionRemoteResults: RemoteSyncTargetResult[] = [];
    let transactionJournal: RepoCreationTransactionJournal | undefined;
    let transactionPublisher = onPublishEvent;
    let transactionWorkerApi = options.workerApi;
    const operationId = createGitOperationId("new");
    operationActivity = undefined;
    const onOperationProgress = createGitOperationProgressObserver(
      operationId,
      (activity) => (operationActivity = activity)
    );
    const unsubscribeGitProgress = options.subscribeGitProgress?.(onOperationProgress);

    try {
      isCreating = true;
      error = null;
      progress = [];

      // Compute canonical key up-front so all subsequent steps use it
      const canonicalKey = await computeCanonicalKey(config);
      transactionJournal = new RepoCreationTransactionJournal({
        id: `new:${canonicalKey}:${Date.now()}`,
        operation: "new",
        ownerPubkey: userPubkey || config.authorPubkey || "",
        repoName: config.name,
        localRepoId: canonicalKey,
        localResource: { ownedByTransaction: true, stage: "planned" },
      });
      transactionPublisher = trackRepoCreationPublisher(transactionJournal, onPublishEvent);

      const selectedProviders = getSelectedProviders(config);
      const includesGrasp = selectedProviders.includes("grasp");
      const selectedGraspTargetRelays = includesGrasp
        ? normalizeList([config.relayUrl || "", ...(config.relayUrls || [])])
        : [];
      const editableRelays = getEditableRepoRelayUrls(
        config.relays || [],
        selectedGraspTargetRelays
      );
      const configuredWebUrls = selectNewRepoWebUrls(config.webUrls || []);

      let announcementEvent: any = undefined;
      let stateEvent: any = undefined;
      let latestRepoMetadataCreatedAt = 0;

      // Step 2 and 3: Create, push, and verify every selected target as one transaction.
      const successfulRemoteRepos: Array<{
        url: string;
        provider: string;
        webUrl: string;
        relayUrl?: string;
      }> = [];
      const failedProviders: Array<{ provider: string; reason: string }> = [];
      if (includesGrasp && selectedGraspTargetRelays.length === 0) {
        throw new Error("GRASP provider requires at least one relay URL");
      }
      const creationPubkey = userPubkey || config.authorPubkey || "";
      if (!creationPubkey) {
        throw new Error("Repository creation requires user pubkey");
      }
      if (includesGrasp && !onPublishEvent) {
        throw new Error("GRASP provider requires onPublishEvent");
      }

      let availableTokens = await tokensStore.waitForInitialization();
      if (
        selectedProviders.some((provider) => provider !== "grasp") &&
        availableTokens.length === 0
      ) {
        await tokensStore.refresh();
        availableTokens = await tokensStore.waitForInitialization();
      }

      const defaultProviderHosts: Record<string, string> = {
        github: "github.com",
        gitlab: "gitlab.com",
        gitea: "gitea.com",
        bitbucket: "bitbucket.org",
      };
      let targets = selectedProviders.flatMap<RemoteTargetSelection>((provider) => {
        if (provider === "grasp") {
          return selectedGraspTargetRelays.map((relayUrl) => ({
            id: `grasp:${relayUrl}`,
            label: `GRASP (${relayUrl.replace(/^wss?:\/\//, "")})`,
            provider: "grasp" as const,
            relayUrl,
          }));
        }

        const host = defaultProviderHosts[provider] || provider;
        const providerTokens = getTokensForHost(availableTokens, host).map((entry) => entry.token);
        return [
          {
            id: `git:${host}`,
            label: `${provider[0]?.toUpperCase()}${provider.slice(1)} (${host})`,
            provider: provider as RemoteTargetProvider,
            host,
            token: providerTokens[0],
            tokens: providerTokens,
          },
        ];
      });
      transactionJournal.setTargets(targets);

      const workerApi = options.workerApi
        ? options.workerApi
        : (await (await import("@nostr-git/core")).getGitWorker()).api;
      transactionWorkerApi = workerApi;
      const effectiveRelayUrls = getEffectiveRepoRelayUrls(
        editableRelays,
        selectedGraspTargetRelays
      );
      const verifiedRelayUrls = assertRepoCreationPrerequisites({
        ownerPubkey: creationPubkey,
        repoName: config.name,
        targets,
        relayUrls: effectiveRelayUrls,
        onPublishEvent,
        onFetchRelayEvents: options.onFetchRelayEvents,
        onDeleteEvent: options.onDeleteEvent,
      });
      await assertRepoCoordinateAvailable({
        ownerPubkey: creationPubkey,
        repoName: config.name,
        relayUrls: verifiedRelayUrls,
        onFetchRelayEvents: options.onFetchRelayEvents!,
      });
      if (workerApi.isRepoCloned && (await workerApi.isRepoCloned({ repoId: canonicalKey }))) {
        throw new Error("A local repository already exists for this owner and name");
      }
      targets = await preflightNewRemoteTargets({
        targets,
        tokenList: availableTokens,
        userPubkey: creationPubkey,
        repoName: config.name,
        existingRepoMessage:
          "Destination already exists. New repository creation requires unused targets.",
      });
      transactionJournal.setTargets(targets);

      updateProgress("remotes", "Publishing repository metadata before Git setup...", "running");
      const announcementAdmission = await publishRepoSyncAnnouncement({
        repoName: config.name,
        repoDescription: config.description || "",
        userPubkey: creationPubkey,
        targets,
        relayUrls: verifiedRelayUrls,
        sourceCloneUrls: normalizeList([config.cloneUrl || "", ...(config.cloneUrls || [])]),
        sourceWebUrls: configuredWebUrls,
        community: config.community,
        onPublishEvent: transactionPublisher!,
        onFetchRelayEvents: options.onFetchRelayEvents,
        updateProgress: (message) => updateProgress("remotes", message, "running"),
        runAbortable: async (operation) => await operation(),
      });
      latestRepoMetadataCreatedAt = Math.max(
        latestRepoMetadataCreatedAt,
        announcementAdmission.latestAnnouncementCreatedAt
      );

      // Create only after all metadata and destination checks complete.
      transactionJournal.setLocalResourceStatus("creating");
      updateProgress("local", "Creating local repository...", "running");
      const localRepo = await createLocalRepo({ ...config }, canonicalKey);
      transactionJournal.setLocalResourceStatus("created");
      updateProgress("local", "Local repository created successfully", "completed");

      const defaultBranch = config.defaultBranch || "master";
      const refs = localRepo?.initialCommit
        ? [
            {
              type: "heads" as const,
              name: defaultBranch,
              commit: localRepo.initialCommit,
            },
          ]
        : undefined;
      const remoteSyncRefs = refs
        ? refs.map((ref) => ({
            ...ref,
            ref: `refs/heads/${ref.name}`,
          }))
        : [];
      updateProgress(
        "remotes",
        `Creating and verifying ${targets.length} remote target${targets.length === 1 ? "" : "s"}...`,
        "running"
      );
      transactionRemoteResults = await syncLocalRepoToTargets({
        workerApi,
        localRepoId: canonicalKey,
        repoName: config.name,
        repoDescription: config.description || "",
        defaultBranch,
        refs: remoteSyncRefs,
        targets,
        userPubkey: creationPubkey,
        relays: verifiedRelayUrls,
        webUrls: configuredWebUrls,
        maintainers:
          config.maintainers && config.maintainers.length > 0 ? config.maintainers : undefined,
        community: config.community,
        onPublishEvent: transactionPublisher,
        onFetchRelayEvents: options.onFetchRelayEvents,
        updateProgress: (message) => updateProgress("remotes", message, "running"),
        runAbortable: async (operation) => await operation(),
        latestRepoMetadataCreatedAt,
        onLatestRepoMetadataCreatedAt: (value) => {
          latestRepoMetadataCreatedAt = value;
        },
        requireNonGraspSuccessBeforeGrasp: false,
        graspFirst: true,
        operationId,
        onOperationProgress,
        prepublishedAnnouncement: announcementAdmission.announcementEvent,
        prepublishedAnnouncementByGraspRelay: announcementAdmission.announcementByGraspRelay,
        preprovisionedGraspRelayUrls: announcementAdmission.graspRelayUrls,
        onCheckpoint: (checkpoint) => transactionJournal!.recordRemoteSyncCheckpoint(checkpoint),
        onTargetSettled: (result) => transactionJournal!.recordTargetResult(result),
      });
      operationActivity = undefined;
      const remoteResults = transactionRemoteResults;
      transactionJournal.setTargetResults(remoteResults);

      for (const result of remoteResults) {
        if (result.success && result.remoteUrl) {
          successfulRemoteRepos.push({
            url: result.remoteUrl,
            provider: result.provider,
            webUrl: result.webUrl || result.remoteUrl,
            relayUrl: result.relayUrl,
          });
        } else {
          failedProviders.push({
            provider: result.label || result.provider,
            reason: result.error || "Unknown error",
          });
        }
      }
      updateProgress(
        "remotes",
        `Verified ${successfulRemoteRepos.length}/${targets.length} remote target${targets.length === 1 ? "" : "s"}`,
        successfulRemoteRepos.length > 0 ? "completed" : "error"
      );

      if (successfulRemoteRepos.length === 0) {
        const providerFailures = failedProviders
          .map((failure) => `${failure.provider}: ${failure.reason}`)
          .join("; ");
        throw new Error(
          `Failed to create repository on all selected providers (${providerFailures})`
        );
      }

      const byProvider = new Map<
        string,
        Array<{ url: string; provider: string; webUrl: string; relayUrl?: string }>
      >();
      for (const remoteRepo of successfulRemoteRepos) {
        const existing = byProvider.get(remoteRepo.provider) || [];
        byProvider.set(remoteRepo.provider, [...existing, remoteRepo]);
      }

      const providerPriority = normalizeList([
        ...(config.cloneUrlOrder || []),
        ...selectedProviders,
      ]);
      const successfulGraspRepos = successfulRemoteRepos.filter(
        (remoteRepo) => remoteRepo.provider === "grasp" && remoteRepo.relayUrl
      );
      const successfulGraspRelays = getSuccessfulGraspRelayUrls(
        successfulGraspRepos.map((remoteRepo) => remoteRepo.url)
      );
      let finalRelays = getEffectiveRepoRelayUrls(editableRelays, successfulGraspRelays);

      let finalCloneUrls = normalizeList(
        providerPriority
          .flatMap((provider) =>
            provider === "grasp"
              ? successfulGraspRepos.map((remoteRepo) => remoteRepo.url)
              : (byProvider.get(provider) || []).map((remoteRepo) => remoteRepo.url)
          )
          .filter(Boolean)
      );

      let finalWebUrls = normalizeList([
        ...configuredWebUrls,
        ...successfulRemoteRepos.map((remoteRepo) => remoteRepo.webUrl).filter(Boolean),
      ]);

      updateProgress("events", "Creating Nostr events...", "running");

      const finalCreatedAt = Math.max(
        Math.floor(Date.now() / 1000),
        latestRepoMetadataCreatedAt + 1
      );

      if (includesGrasp) {
        const primaryRelay = selectedGraspTargetRelays[0] || successfulGraspRelays[0] || "";
        const graspPubkey = userPubkey || config.authorPubkey || "";
        const graspEvents = createGraspAnnouncementAndState({
          relayUrl: primaryRelay,
          ownerPubkey: graspPubkey,
          repoName: config.name,
          description: config.description || "",
          relays: finalRelays,
          cloneUrls: finalCloneUrls,
          webUrls: finalWebUrls,
          maintainers:
            config.maintainers && config.maintainers.length > 0 ? config.maintainers : undefined,
          hashtags: config.tags && config.tags.length > 0 ? config.tags : undefined,
          earliestUniqueCommit: localRepo?.initialCommit || undefined,
          refs,
          head: config.defaultBranch,
          community: config.community,
        });
        announcementEvent = graspEvents.announcementEvent;
        stateEvent = { ...graspEvents.stateEvent, created_at: finalCreatedAt };
      } else {
        announcementEvent = createAnnouncementEventShared({
          repoId: config.name,
          name: config.name,
          description: config.description || "",
          web: finalWebUrls.length > 0 ? finalWebUrls : undefined,
          clone: finalCloneUrls.length > 0 ? finalCloneUrls : undefined,
          relays: finalRelays,
          maintainers:
            config.maintainers && config.maintainers.length > 0 ? config.maintainers : undefined,
          hashtags: config.tags && config.tags.length > 0 ? config.tags : undefined,
          community: config.community,
          created_at: finalCreatedAt,
        });

        stateEvent = createStateEventShared({
          repoId: config.name,
          refs,
          head: config.defaultBranch,
          created_at: finalCreatedAt,
        });
      }

      updateProgress("events", "Nostr events created successfully", "completed");

      if (transactionPublisher) {
        transactionJournal.setPhase("metadata-pending");
        updateProgress("publish", "Publishing to Nostr relays...", "running");
        const allSuccessfulGraspCloneUrls = new Set(
          successfulGraspRepos.map((remoteRepo) => remoteRepo.url)
        );
        const graspWebUrlByCloneUrl = new Map(
          successfulGraspRepos.map((remoteRepo) => [remoteRepo.url, remoteRepo.webUrl])
        );
        const fixedCloneUrls = finalCloneUrls.filter(
          (cloneUrl) => !allSuccessfulGraspCloneUrls.has(cloneUrl)
        );
        const candidateCloneOrder = [...finalCloneUrls];
        const graspWebUrls = new Set(
          successfulGraspRepos.map((remoteRepo) => remoteRepo.webUrl).filter(Boolean)
        );
        const fixedWebUrls = finalWebUrls.filter((webUrl) => !graspWebUrls.has(webUrl));
        const reconciled = await reconcileRepoCreationEvents({
          relayUrls: finalRelays,
          provisionalRelayUrls: selectedGraspTargetRelays,
          graspTargets: successfulGraspRepos.map((remoteRepo) => ({
            relayUrl: remoteRepo.relayUrl as string,
            cloneUrl: remoteRepo.url,
          })),
          stateEvent,
          onPublishEvent: transactionPublisher,
          fetchRelayEvents: options.onFetchRelayEvents,
          provisionalEvents: getRepoCreationProvisionalEvents(transactionJournal.record),
          onDeleteEvent: options.onDeleteEvent,
          minCreatedAt: latestRepoMetadataCreatedAt,
          buildAnnouncement: ({ relays, graspCloneUrls, createdAt }) => {
            const retainedCloneUrls = new Set([...fixedCloneUrls, ...graspCloneUrls]);
            return createAnnouncementEventShared({
              repoId: config.name,
              name: config.name,
              description: config.description || "",
              clone: candidateCloneOrder.filter((cloneUrl) => retainedCloneUrls.has(cloneUrl)),
              web: normalizeList([
                ...fixedWebUrls,
                ...graspCloneUrls
                  .map((cloneUrl) => graspWebUrlByCloneUrl.get(cloneUrl))
                  .filter((value): value is string => Boolean(value)),
              ]),
              relays,
              maintainers:
                config.maintainers && config.maintainers.length > 0
                  ? config.maintainers
                  : undefined,
              hashtags: config.tags && config.tags.length > 0 ? config.tags : undefined,
              earliestUniqueCommit: localRepo?.initialCommit || undefined,
              community: config.community,
              created_at: createdAt,
            });
          },
        });
        announcementEvent = reconciled.announcementEvent;
        stateEvent = reconciled.stateEvent;
        finalRelays = reconciled.relays;
        const retainedCloneUrls = new Set([...fixedCloneUrls, ...reconciled.graspCloneUrls]);
        finalCloneUrls = candidateCloneOrder.filter((cloneUrl) => retainedCloneUrls.has(cloneUrl));
        finalWebUrls = normalizeList([
          ...fixedWebUrls,
          ...reconciled.graspCloneUrls
            .map((cloneUrl) => graspWebUrlByCloneUrl.get(cloneUrl))
            .filter((value): value is string => Boolean(value)),
        ]);
        transactionJournal.setTargetResults(
          applyReconciledGraspResults(remoteResults, reconciled.graspCloneUrls)
        );
        transactionJournal.setPendingCompensations(reconciled.cleanupFailures);
        updateProgress("publish", "Successfully published to Nostr relays", "completed");
      }

      if (failedProviders.length > 0) {
        const warningMessage = failedProviders
          .map((failure) => `${failure.provider}: ${failure.reason}`)
          .join("; ");
        updateProgress(
          "providers-warning",
          `Some providers failed and were omitted from final repository metadata (${warningMessage})`,
          "completed"
        );
      }

      const committedGraspCloneUrls = new Set(finalCloneUrls);
      const committedRemoteRepos = successfulRemoteRepos.filter(
        (remoteRepo) =>
          remoteRepo.provider !== "grasp" || committedGraspCloneUrls.has(remoteRepo.url)
      );
      const committedByProvider = new Map<string, typeof committedRemoteRepos>();
      for (const remoteRepo of committedRemoteRepos) {
        committedByProvider.set(remoteRepo.provider, [
          ...(committedByProvider.get(remoteRepo.provider) || []),
          remoteRepo,
        ]);
      }
      const primaryRemoteProvider = providerPriority.find(
        (provider) => (committedByProvider.get(provider)?.length || 0) > 0
      );
      const remoteRepo =
        (primaryRemoteProvider ? committedByProvider.get(primaryRemoteProvider)?.[0] : undefined) ||
        committedRemoteRepos[0];

      const result: NewRepoResult = {
        localRepo,
        remoteRepo,
        remoteRepos: committedRemoteRepos,
        announcementEvent,
        stateEvent,
      };

      onRepoCreated?.(result);
      transactionJournal.complete();
      return result;
    } catch (err) {
      const provisionalEvents = transactionJournal
        ? getRepoCreationProvisionalEvents(transactionJournal.record)
        : getRemoteSyncProvisionalEvents(transactionRemoteResults);
      const compensableEvents = provisionalEvents.filter((item) => item.relayUrls.length > 0);
      if (
        options.onDeleteEvent &&
        compensableEvents.length > 0 &&
        transactionRemoteResults.every((result) => !result.success)
      ) {
        const cleanupResults = await Promise.allSettled(
          compensableEvents.map((item) =>
            Promise.resolve(options.onDeleteEvent?.(item.event, item.relayUrls))
          )
        );
        transactionJournal?.setPendingCompensations(
          cleanupResults.flatMap((result, index) =>
            result.status === "rejected"
              ? [
                  {
                    action: "delete" as const,
                    eventId: compensableEvents[index].event.id,
                    relayUrls: compensableEvents[index].relayUrls,
                    error:
                      result.reason instanceof Error
                        ? result.reason.message
                        : String(result.reason),
                  },
                ]
              : []
          )
        );
      }
      transactionJournal?.setTargetResults(transactionRemoteResults);
      const hasSuccessfulTarget = transactionRemoteResults.some((result) => result.success);
      if (
        !hasSuccessfulTarget &&
        transactionJournal?.record.localResource.ownedByTransaction &&
        transactionJournal.record.localResource.stage === "created" &&
        transactionWorkerApi?.deleteRepo
      ) {
        try {
          transactionJournal.setLocalResourceStatus("cleanup-pending");
          const cleanup = await transactionWorkerApi.deleteRepo({
            repoId: transactionJournal.record.localRepoId,
          });
          if (cleanup?.success === false) {
            throw new Error(cleanup.error || "Failed to delete transaction-owned local repository");
          }
          transactionJournal.setLocalResourceStatus("cleaned");
        } catch (cleanupError) {
          transactionJournal.setLocalResourceStatus("cleanup-pending", cleanupError);
        }
      } else if (transactionJournal?.record.localResource.stage === "creating") {
        transactionJournal.setLocalResourceStatus("unknown", err);
      }
      transactionJournal?.setPhase(
        transactionJournal.record.phase === "metadata-pending" ? "metadata-pending" : "failed",
        err
      );
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      error = errorMessage;

      // Update the current step to error status
      const currentStep = progress.find((p) => p.status === "running");
      if (currentStep) {
        updateProgress(currentStep.step, `Failed: ${errorMessage}`, "error", errorMessage);
      }

      console.error("Repository creation failed:", err);
      return null;
    } finally {
      unsubscribeGitProgress?.();
      isCreating = false;
    }
  }

  async function createLocalRepo(config: NewRepoConfig, canonicalKey?: string) {
    console.log("🏗️ Starting createLocalRepo function...");
    console.log("🏗️ createLocalRepo canonicalKey:", canonicalKey);
    console.log("🏗️ createLocalRepo config:", config);

    // Use passed workerApi if available, otherwise create new worker
    let api: any;
    if (options.workerApi) {
      api = options.workerApi;
    } else {
      const { getGitWorker } = await import("@nostr-git/core");
      const workerInstance = await getGitWorker();
      api = workerInstance.api;
    }

    const createLocalRepoParams = {
      repoId: canonicalKey ?? config.name,
      name: config.name,
      description: config.description,
      defaultBranch: config.defaultBranch,
      initializeWithReadme: config.initializeWithReadme,
      gitignoreTemplate: config.gitignoreTemplate,
      licenseTemplate: config.licenseTemplate,
      authorName: config.authorName,
      authorEmail: config.authorEmail,
    };
    console.log("🏗️ createLocalRepo params:", createLocalRepoParams);

    const result = await api.createLocalRepo(createLocalRepoParams);
    console.log("🏗️ createLocalRepo result:", result);

    if (!result.success) {
      throw new Error(result.error || "Failed to create local repository");
    }

    return {
      repoId: canonicalKey ?? config.name,
      path: result.repoPath,
      branch: config.defaultBranch,
      initialCommit: result.commitSha || result.initialCommit, // Worker returns commitSha
    };
  }

  async function checkRepoAvailability(config: NewRepoConfig, token: string) {
    try {
      // Use GitServiceApi abstraction instead of hardcoded GitHub API calls
      const api = getGitServiceApi(config.provider as any, token);

      // Get the authenticated user's information
      const currentUser = await api.getCurrentUser();
      const username = currentUser.login;

      console.log(
        "🚀 Checking availability for:",
        `${username}/${config.name}`,
        "on",
        config.provider
      );

      // Check if repository already exists by trying to fetch it
      try {
        await api.getRepo(username, config.name);
        // Repository exists
        return {
          available: false,
          reason: `Repository name already exists in your ${config.provider} account`,
          username,
        };
      } catch (error: any) {
        // Repository doesn't exist (good!) - API throws error for 404
        if (error.message?.includes("404") || error.message?.includes("Not Found")) {
          return { available: true, username };
        }
        // Some other error occurred
        throw error;
      }
    } catch (error) {
      console.error(`Error checking repo availability on ${config.provider}:`, error);
      return {
        available: false,
        reason: `Failed to check availability: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async function createRemoteRepo(config: NewRepoConfig) {
    console.log("🚀 Starting createRemoteRepo function...");
    try {
      // Use passed workerApi if available, otherwise use singleton worker
      let api: any;
      if (options.workerApi) {
        console.log("🚀 Using provided workerApi");
        api = options.workerApi;
      } else {
        console.log("🚀 No workerApi provided, falling back to new worker");
        // Note: Cannot auto-import singleton from library context
        // The app must pass workerApi explicitly
        const { getGitWorker } = await import("@nostr-git/core");
        const workerInstance = getGitWorker();
        api = workerInstance.api;
        console.log("🚀 Created new worker (workerApi not provided)");
      }
      console.log("🚀 Git worker obtained successfully");

      // Handle GRASP separately (doesn't use token retry logic)
      if (config.provider === "grasp") {
        console.log(
          "🔐 Setting up GRASP repository creation with EventIO (no more signer passing!)"
        );

        const primaryRelay =
          config.relayUrl ||
          (config.relayUrls && config.relayUrls.length > 0 ? config.relayUrls[0] : undefined);
        if (!primaryRelay) throw new Error("GRASP provider requires a relay URL");

        const token = config.authorPubkey || "";
        if (!token) throw new Error("GRASP provider requires authorPubkey");

        // Normalize GRASP URLs to ensure proper protocol handling
        const { wsOrigin } = normalizeGraspOrigins(primaryRelay);
        console.log("🔐 Normalized GRASP URLs:", { wsOrigin });

        const availability = await checkGraspRepoAvailability(config.name, wsOrigin, token);
        if (!availability.available) {
          const reason = availability.reason || "Repository name is not available";
          const isAlreadyExists = /already exists/i.test(reason);
          if (!isAlreadyExists) {
            throw new Error(reason);
          }

          const owner = availability.username || toNpubOrSelf(token);
          const { httpOrigin } = normalizeGraspOrigins(wsOrigin);
          const existingRemoteUrl = `${httpOrigin}/${owner}/${config.name}.git`;
          return {
            url: existingRemoteUrl,
            provider: "grasp",
            webUrl: existingRemoteUrl.replace(/\.git$/, ""),
            createdRemote: false,
            token: undefined,
          };
        }

        const result = await api.createRemoteRepo({
          provider: config.provider as any,
          token,
          name: config.name,
          description: config.description || "",
          isPrivate: false,
          baseUrl: wsOrigin, // Use normalized WebSocket origin for GRASP API
        });

        console.log("🚀 API call completed, result:", result);
        if (!result.success) {
          console.error("Remote repository creation failed:", result.error);
          throw new Error(`Remote repository creation failed: ${result.error}`);
        }

        console.log("🚀 Remote repository created successfully:", result);
        return {
          url: result.remoteUrl, // Use remoteUrl from the API response
          provider: result.provider,
          webUrl: result.webUrl || result.remoteUrl, // Fallback to remoteUrl if webUrl not provided
          createdRemote: true,
          token: undefined,
        };
      }

      // Standard Git providers
      const providerHosts: Record<string, string> = {
        github: "github.com",
        gitlab: "gitlab.com",
        gitea: "gitea.com",
        bitbucket: "bitbucket.org",
      };

      const providerHost = providerHosts[config.provider] || config.provider;
      const matchingTokens = getTokensForHost(tokens, providerHost);

      if (matchingTokens.length === 0) {
        // Try to wait for tokens to load if they're not available yet
        await tokensStore.waitForInitialization();
        await tokensStore.refresh();
        const refreshedTokens = getTokensForHost(tokens, providerHost);
        if (refreshedTokens.length === 0) {
          throw new Error(
            `No ${config.provider} authentication token found. Please add a ${config.provider} token in settings.`
          );
        }
      }

      let usedToken = "";
      const result = await tryTokensForHost(tokens, providerHost, async (token: string) => {
        console.log("🚀 Checking repository name availability...");
        const availability = await checkRepoAvailability(config, token);
        if (!availability.available) {
          throw new Error(availability.reason || "Repository name is not available");
        }

        const repoResult = await api.createRemoteRepo({
          provider: config.provider as any,
          token,
          name: config.name,
          description: config.description,
          isPrivate: false, // Default to public for now
        });

        if (!repoResult.success) {
          console.error("Remote repository creation failed:", repoResult.error);
          throw new Error(`Remote repository creation failed: ${repoResult.error}`);
        }

        usedToken = token;
        return repoResult;
      });

      console.log("🚀 API call completed, result:", result);
      console.log("🚀 Remote repository created successfully:", result);
      return {
        url: result.remoteUrl,
        provider: result.provider,
        webUrl: result.webUrl || result.remoteUrl,
        token: usedToken,
        createdRemote: true,
      };
    } catch (error) {
      console.error("Remote repository creation failed with exception:", error);
      throw error; // Don't silently continue - let the error bubble up
    }
  }

  async function pushToRemote(
    config: NewRepoConfig,
    remoteRepo: any,
    canonicalKey?: string,
    localRepo?: any
  ) {
    console.log("🚀 Starting pushToRemote function...");
    console.log("🚀 pushToRemote canonicalKey:", canonicalKey);
    console.log("🚀 pushToRemote config:", config);

    // Use passed workerApi and workerInstance if available, otherwise create new worker
    let api: any, worker: Worker;
    if (options.workerApi && options.workerInstance) {
      // Use the provided worker API and instance (already configured with EventIO)
      api = options.workerApi;
      worker = options.workerInstance;
      console.log("🔐 Using provided worker API and instance for push");
    } else {
      // Fallback: create new worker (won't have EventIO configured)
      console.warn(
        "🔐 No workerApi/workerInstance provided for push, creating new worker (EventIO may not be configured)"
      );
      const { getGitWorker } = await import("@nostr-git/core");
      const workerInstance = await getGitWorker();
      api = workerInstance.api;
      worker = workerInstance.worker;
    }

    // Get the provider-specific host for token lookup
    const providerHosts: Record<string, string> = {
      github: "github.com",
      gitlab: "gitlab.com",
      gitea: "gitea.com",
      bitbucket: "bitbucket.org",
    };

    // For GRASP, ensure we use HTTP(S) endpoint for push operations
    let pushUrl: string;
    if (config.provider === "grasp") {
      // Use the URL from the GRASP API which already has the correct npub format
      pushUrl = remoteRepo.url; // Fixed: use .url not .remoteUrl
      console.log("🔐 Using GRASP API URL for push:", { pushUrl });

      // For GRASP, we use EventIO instead of explicit signer passing
      console.log("🔐 GRASP push - EventIO handles signing internally (no more signer passing!)");
      const providerToken = config.authorPubkey || "";

      console.log("🚀 Pushing to remote with URL:", pushUrl);
      console.log("🚀 Push config:", {
        provider: config.provider,
        repoPath: canonicalKey ?? config.name,
        defaultBranch: config.defaultBranch,
        remoteUrl: pushUrl,
      });

      // For GRASP, use direct push since we just created the local repo
      console.log("[NEW REPO] Using direct pushToRemote for GRASP");

      const directPushResult = await api.pushToRemote({
        repoId: canonicalKey || config.name,
        remoteUrl: pushUrl,
        branch: config.defaultBranch,
        token: providerToken,
        provider: config.provider as any,
      });

      const pushResult = {
        success: directPushResult?.success || false,
        pushed: directPushResult?.success,
      };

      if (!pushResult.success) {
        const errorMsg = directPushResult?.error || "Unknown push error";
        console.error("[NEW REPO] GRASP push failed:", errorMsg);
        console.error("[NEW REPO] Full push result:", directPushResult);
        throw new Error(`Failed to push to GRASP remote repository: ${errorMsg}`);
      }

      return pushResult;
    } else {
      // For standard Git providers, try all tokens until one succeeds
      pushUrl = remoteRepo.url;
      const providerHost = providerHosts[config.provider] || config.provider;

      const matchingTokens = getTokensForHost(tokens, providerHost);
      if (matchingTokens.length === 0) {
        throw new Error(`No ${config.provider} authentication token found for push operation`);
      }

      const pushResult = await tryTokensForHost(
        tokens,
        providerHost,
        async (token: string, host: string) => {
          // For other providers, use safePushToRemote for preflight checks
          // Note: requireUpToDate is false for new repo creation since we just created
          // both the local and remote repos - no need to check if remote is "up to date"
          console.log("[NEW REPO] Using safePushToRemote for non-GRASP provider");
          const result = await api.safePushToRemote({
            repoId: canonicalKey || config.name,
            remoteUrl: pushUrl,
            branch: config.defaultBranch,
            token: token,
            provider: config.provider as any,
            preflight: {
              blockIfUncommitted: true,
              requireUpToDate: false, // Skip for new repo - we just created it
              blockIfShallow: false,
            },
          });

          if (!result?.success) {
            if (result?.requiresConfirmation) {
              throw new Error(result.warning || "Force push requires confirmation.");
            }
            if (result?.reason === "workflow_scope_missing") {
              throw new Error(
                "GitHub rejected this push because the token is missing Workflow permission for .github/workflows files. Update the GitHub token permissions and retry."
              );
            }
            throw new Error(result?.error || "Safe push failed");
          }

          return result;
        }
      );

      console.log("[NEW REPO] Push result:", pushResult);
      return remoteRepo;
    }
  }

  function reset() {
    isCreating = false;
    progress = [];
    error = null;
  }

  function retry() {
    // Reset error state and allow retry
    error = null;
    progress = progress.map((p) =>
      p.status === "error" ? { ...p, status: "pending" as const } : p
    );
  }

  return {
    // State
    isCreating: () => isCreating,
    progress: () => progress,
    error: () => error,
    operationActivity: () => operationActivity,

    // Actions
    createRepository,
    reset,
    retry,
  };
}
