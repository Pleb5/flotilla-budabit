import type { Event as NostrEvent } from "nostr-tools";
import { getGitServiceApi } from "@nostr-git/core/git";
import { tokens as tokensStore, type Token } from "../stores/tokens.js";
import {
  createRepoAnnouncementEvent as createAnnouncementEventShared,
  createRepoStateEvent as createStateEventShared,
} from "@nostr-git/core/events";
import { parseRepoId } from "@nostr-git/core/utils";
import { tryTokensForHost, getTokensForHost } from "../utils/tokenHelpers.js";
import { checkGraspRepoExists } from "../utils/grasp-availability.js";
import { syncLocalRepoToTargets } from "../utils/remote-sync.js";
import {
  createGraspAnnouncementAndState,
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  getSuccessfulGraspRelayUrls,
  normalizeGraspOrigins,
  toNpubOrSelf,
  type FetchRelayEvents,
} from "../utils/grasp-pipeline.js";

export function getPublishedEventFromPublishResult(result: unknown): NostrEvent | undefined {
  const event = (result as { event?: NostrEvent } | undefined)?.event;
  return event?.id ? event : undefined;
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
    // No token: we cannot query provider API, treat as unknown but do not block
    return {
      results: [
        {
          provider,
          host: "unknown",
          available: true,
          reason: "No token configured; unable to check. Assuming available.",
        },
      ],
      hasConflicts: false,
      availableProviders: [provider],
      conflictProviders: [],
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
          // Unknown error: return soft-OK to avoid blocking
          return {
            results: [
              {
                provider,
                host: host,
                available: true,
                error: String(error?.message || error),
                username,
              },
            ],
            hasConflicts: false,
            availableProviders: [provider],
            conflictProviders: [],
          };
        }
      }
    );
    return result;
  } catch (e: any) {
    // Network or API error; soft-OK
    return {
      results: [
        {
          provider,
          host: "unknown",
          available: true,
          error: String(e?.message || e),
        },
      ],
      hasConflicts: false,
      availableProviders: [provider],
      conflictProviders: [],
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
  onPublishEvent?: (
    event: Omit<NostrEvent, "id" | "sig" | "pubkey" | "created_at">
  ) => Promise<unknown>;
  userPubkey?: string; // User's nostr pubkey (required for GRASP repos)
  /** Callback to create NIP-98 auth header for GRASP push (must be called on main thread) */
  createAuthHeader?: (url: string, method?: string) => Promise<string | null>;
  /** Fetch events from specific relays for GRASP state visibility checks */
  onFetchRelayEvents?: FetchRelayEvents;
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

  function isProviderUrl(url: string, provider: string, relayUrls: string[]): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.host.toLowerCase();
      if (provider === "github") return host === "github.com";
      if (provider === "gitlab") return host === "gitlab.com";
      if (provider === "bitbucket") return host === "bitbucket.org";
      if (provider === "gitea") return host.includes("gitea");
      if (provider === "grasp") {
        const relayHosts = relayUrls
          .map((relay) => normalizeGraspOrigins(relay).httpOrigin)
          .map((origin) => {
            try {
              return new URL(origin).host.toLowerCase();
            } catch {
              return "";
            }
          })
          .filter(Boolean);
        return relayHosts.includes(host);
      }
      return false;
    } catch {
      return false;
    }
  }

  async function createRepository(config: NewRepoConfig): Promise<NewRepoResult | null> {
    if (isCreating) {
      throw new Error("Repository creation already in progress");
    }

    try {
      isCreating = true;
      error = null;
      progress = [];

      // Compute canonical key up-front so all subsequent steps use it
      const canonicalKey = await computeCanonicalKey(config);

      const selectedProviders = getSelectedProviders(config);
      const includesGrasp = selectedProviders.includes("grasp");
      const selectedGraspTargetRelays = includesGrasp
        ? normalizeList([config.relayUrl || "", ...(config.relayUrls || [])])
        : [];
      const editableRelays = getEditableRepoRelayUrls(
        config.relays || [],
        selectedGraspTargetRelays
      );

      // Step 1: Create local repository
      updateProgress("local", "Creating local repository...", "running");
      const localRepo = await createLocalRepo({ ...config }, canonicalKey);
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

      let announcementEvent: any = undefined;
      let stateEvent: any = undefined;
      let latestRepoMetadataCreatedAt = 0;

      // Step 2 and 3: Create and push remotes per provider.
      const successfulRemoteRepos: Array<{
        url: string;
        provider: string;
        webUrl: string;
        relayUrl?: string;
      }> = [];
      const failedProviders: Array<{ provider: string; reason: string }> = [];

      for (const provider of selectedProviders) {
        const remoteStep = `remote-${provider}`;
        const pushStep = `push-${provider}`;

        if (provider === "grasp") {
          if (selectedGraspTargetRelays.length === 0) {
            throw new Error("GRASP provider requires at least one relay URL");
          }

          const graspPubkey = userPubkey || config.authorPubkey || "";
          if (!graspPubkey) {
            throw new Error("GRASP provider requires user pubkey");
          }
          if (!onPublishEvent) {
            throw new Error("GRASP provider requires onPublishEvent");
          }

          const graspWorkerApi = options.workerApi
            ? options.workerApi
            : (await (await import("@nostr-git/core")).getGitWorker()).api;
          const graspTargets = selectedGraspTargetRelays.map((relayUrl) => ({
            id: `grasp:${relayUrl}`,
            label: `GRASP (${relayUrl.replace(/^wss?:\/\//, "")})`,
            provider: "grasp" as const,
            relayUrl,
          }));

          updateProgress(
            remoteStep,
            `Creating remote repositories on ${graspTargets.length} GRASP target${graspTargets.length === 1 ? "" : "s"}...`,
            "running"
          );
          updateProgress(pushStep, "Publishing GRASP metadata and pushing refs...", "running");

          const remoteResults = await syncLocalRepoToTargets({
            workerApi: graspWorkerApi,
            localRepoId: canonicalKey,
            repoName: config.name,
            repoDescription: config.description || "",
            defaultBranch,
            refs: remoteSyncRefs,
            targets: graspTargets,
            userPubkey: graspPubkey,
            relays: editableRelays,
            maintainers:
              config.maintainers && config.maintainers.length > 0 ? config.maintainers : undefined,
            onPublishEvent: onPublishEvent as (event: any) => Promise<unknown>,
            onFetchRelayEvents: options.onFetchRelayEvents,
            updateProgress: (message) => updateProgress(pushStep, message, "running"),
            runAbortable: async (operation) => await operation(),
            latestRepoMetadataCreatedAt,
            onLatestRepoMetadataCreatedAt: (value) => {
              latestRepoMetadataCreatedAt = value;
            },
            requireNonGraspSuccessBeforeGrasp: false,
          });

          const successfulGraspRepos = remoteResults.filter(
            (result) => result.success && result.remoteUrl
          );
          const failedGraspTargets = remoteResults.filter((result) => !result.success);

          successfulRemoteRepos.push(
            ...successfulGraspRepos.map((result) => ({
              url: result.remoteUrl as string,
              provider: provider,
              webUrl: result.webUrl || result.remoteUrl || "",
              relayUrl: graspTargets.find((target) => target.id === result.id)?.relayUrl,
            }))
          );

          failedProviders.push(
            ...failedGraspTargets.map((result) => ({
              provider: result.label || provider,
              reason: result.error || "Unknown error",
            }))
          );

          if (successfulGraspRepos.length === 0) {
            const reason = failedGraspTargets
              .map((result) => `${result.label}: ${result.error || "sync failed"}`)
              .join("; ");
            updateProgress(remoteStep, `Failed on ${provider}: ${reason}`, "error", reason);
            updateProgress(pushStep, `Skipped push for ${provider}`, "completed");
            continue;
          }

          updateProgress(
            remoteStep,
            `Created ${successfulGraspRepos.length}/${graspTargets.length} GRASP remote${successfulGraspRepos.length === 1 ? "" : "s"}`,
            "completed"
          );
          updateProgress(
            pushStep,
            `Pushed to ${successfulGraspRepos.length}/${graspTargets.length} GRASP target${graspTargets.length === 1 ? "" : "s"}`,
            "completed"
          );
          continue;
        }

        const providerConfig: NewRepoConfig = {
          ...config,
          provider,
        };

        updateProgress(remoteStep, `Creating remote repository on ${provider}...`, "running");
        try {
          const remoteRepo = await createRemoteRepo(providerConfig);
          updateProgress(remoteStep, `Remote repository created on ${provider}`, "completed");

          if (!remoteRepo) continue;

          updateProgress(pushStep, `Pushing to ${provider}...`, "running");
          await pushToRemote({ ...providerConfig }, remoteRepo, canonicalKey, localRepo);
          updateProgress(pushStep, `Successfully pushed to ${provider}`, "completed");
          successfulRemoteRepos.push(remoteRepo);
        } catch (providerError) {
          const reason =
            providerError instanceof Error
              ? providerError.message
              : String(providerError || "Unknown error");
          failedProviders.push({ provider, reason });
          updateProgress(remoteStep, `Failed on ${provider}: ${reason}`, "error", reason);
          updateProgress(pushStep, `Skipped push for ${provider}`, "completed");
        }
      }

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
      const successfulGraspRelays = getSuccessfulGraspRelayUrls(
        successfulRemoteRepos
          .filter((remoteRepo) => remoteRepo.provider === "grasp")
          .map((remoteRepo) => remoteRepo.url)
      );
      const finalRelays = getEffectiveRepoRelayUrls(editableRelays, successfulGraspRelays);

      const finalCloneUrls = normalizeList(
        providerPriority
          .flatMap((provider) =>
            (byProvider.get(provider) || []).map((remoteRepo) => remoteRepo.url)
          )
          .filter(Boolean)
      );

      const providerWebUrls = normalizeList(
        providerPriority
          .flatMap((provider) =>
            (byProvider.get(provider) || []).map((remoteRepo) =>
              (remoteRepo.webUrl || remoteRepo.url || "").replace(/\.git$/, "")
            )
          )
          .filter(Boolean)
      );

      const preservedWebUrls = normalizeList(
        (config.webUrls || []).filter((url) => {
          const trimmed = String(url || "").trim();
          if (!trimmed) return false;
          if (trimmed.includes("gitworkshop.dev")) return true;
          if (trimmed.includes("/c/") && trimmed.includes("/git/")) return true;
          return !selectedProviders.some((provider) =>
            isProviderUrl(trimmed, provider, config.relayUrls || [])
          );
        })
      );

      const finalWebUrls = normalizeList([...providerWebUrls, ...preservedWebUrls]);

      updateProgress("events", "Creating Nostr events...", "running");

      if (includesGrasp) {
        const primaryRelay = successfulGraspRelays[0] || selectedGraspTargetRelays[0] || "";
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
        });

        announcementEvent = graspEvents.announcementEvent;
        stateEvent = graspEvents.stateEvent;

        if (
          latestRepoMetadataCreatedAt &&
          announcementEvent.created_at <= latestRepoMetadataCreatedAt
        ) {
          announcementEvent = {
            ...announcementEvent,
            created_at: latestRepoMetadataCreatedAt + 1,
          };
        }
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
        });

        stateEvent = createStateEventShared({
          repoId: config.name,
          refs,
          head: config.defaultBranch,
        });
      }

      updateProgress("events", "Nostr events created successfully", "completed");

      if (onPublishEvent) {
        updateProgress("publish", "Publishing to Nostr relays...", "running");
        announcementEvent =
          getPublishedEventFromPublishResult(await onPublishEvent(announcementEvent)) ||
          announcementEvent;
        if (!includesGrasp) {
          stateEvent =
            getPublishedEventFromPublishResult(await onPublishEvent(stateEvent)) || stateEvent;
        }
        updateProgress("publish", "Successfully published to Nostr relays", "completed");
      }

      if (failedProviders.length > 0) {
        const warningMessage = failedProviders
          .map((failure) => `${failure.provider}: ${failure.reason}`)
          .join("; ");
        updateProgress(
          "providers-warning",
          `Some providers failed and were excluded from final metadata (${warningMessage})`,
          "completed"
        );
      }

      const primaryRemoteProvider = providerPriority.find(
        (provider) => (byProvider.get(provider)?.length || 0) > 0
      );
      const remoteRepo =
        (primaryRemoteProvider ? byProvider.get(primaryRemoteProvider)?.[0] : undefined) ||
        successfulRemoteRepos[0];

      const result: NewRepoResult = {
        localRepo,
        remoteRepo,
        remoteRepos: successfulRemoteRepos,
        announcementEvent,
        stateEvent,
      };

      onRepoCreated?.(result);
      return result;
    } catch (err) {
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

        return repoResult;
      });

      console.log("🚀 API call completed, result:", result);
      console.log("🚀 Remote repository created successfully:", result);
      return {
        url: result.remoteUrl,
        provider: result.provider,
        webUrl: result.webUrl || result.remoteUrl,
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

      const requiresNip98Retry = (result: any): boolean => {
        const summary = [
          result?.error,
          result?.details,
          result?.code,
          result?.message,
          result?.stack,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          summary.includes("401") ||
          summary.includes("403") ||
          summary.includes("unauthorized") ||
          summary.includes("forbidden") ||
          summary.includes("authentication") ||
          summary.includes("auth required")
        );
      };

      const createNip98AuthHeaders = async (): Promise<Record<string, string> | null> => {
        if (!options.createAuthHeader) return null;

        console.log("[NEW REPO] Creating NIP-98 auth headers for GRASP auth retry");

        // Build the smart HTTP URL (same logic as worker)
        let smartUrl = pushUrl;
        try {
          const u = new URL(pushUrl);
          let p = u.pathname.startsWith("/git/") ? u.pathname.slice(4) : u.pathname;
          if (!p.endsWith(".git")) p = p.endsWith("/") ? `${p.slice(0, -1)}.git` : `${p}.git`;
          smartUrl = `${u.protocol}//${u.host}${p}`;
        } catch {
          // pass
        }

        const infoRefsUrl = `${smartUrl}/info/refs?service=git-receive-pack`;
        const receivePackUrl = `${smartUrl}/git-receive-pack`;

        console.log("[NEW REPO] Signing auth headers for URLs:", { infoRefsUrl, receivePackUrl });

        const [infoRefsAuth, receivePackAuth] = await Promise.all([
          options.createAuthHeader(infoRefsUrl, "GET"),
          options.createAuthHeader(receivePackUrl, "POST"),
        ]);

        if (!infoRefsAuth || !receivePackAuth) {
          console.warn("[NEW REPO] Failed to create NIP-98 auth headers", {
            infoRefsAuth: !!infoRefsAuth,
            receivePackAuth: !!receivePackAuth,
          });
          return null;
        }

        console.log("[NEW REPO] NIP-98 auth headers created successfully for both URLs");
        return {
          [infoRefsUrl]: infoRefsAuth,
          [receivePackUrl]: receivePackAuth,
        };
      };

      // Unauthenticated first (GRASP-01 smart-http), then fallback to NIP-98 only when needed.
      let directPushResult = await api.pushToRemote({
        repoId: canonicalKey || config.name,
        remoteUrl: pushUrl,
        branch: config.defaultBranch,
        token: providerToken,
        provider: config.provider as any,
      });

      if (!directPushResult?.success && requiresNip98Retry(directPushResult)) {
        const authHeaders = await createNip98AuthHeaders();
        if (authHeaders) {
          console.log("[NEW REPO] Retrying GRASP push with NIP-98 headers");
          directPushResult = await api.pushToRemote({
            repoId: canonicalKey || config.name,
            remoteUrl: pushUrl,
            branch: config.defaultBranch,
            token: providerToken,
            provider: config.provider as any,
            authHeaders,
          });
        }
      }

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

    // Actions
    createRepository,
    reset,
    retry,
  };
}
