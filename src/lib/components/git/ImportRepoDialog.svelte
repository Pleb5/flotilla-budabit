<script lang="ts">
  import {
    X,
    Download,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Calendar,
    GitBranch,
    MessageSquare,
    FileText,
    Globe,
    Trash2,
    Plus,
    ExternalLink,
  } from "@lucide/svelte";
  import {
    useImportRepo,
    type ImportProgress,
    type ImportResult,
    type ImportRemoteTarget,
    IMPORT_PHASES,
    IMPORT_PHASE_LABELS,
    type ImportPhase,
  } from "../../hooks/useImportRepo.svelte";
  import { tokens } from "../../stores/tokens.js";
  import { getRecommendedGraspServerUrls, graspServersStore } from "../../stores/graspServers.js";
  import {
    parseRepoUrl,
    DEFAULT_RELAYS,
    checkRepoOwnership,
    getGitServiceApiFromUrl,
  } from "@nostr-git/core";
  import { tryTokensForHost } from "../../utils/tokenHelpers.js";
  import { matchesHost } from "../../utils/tokenMatcher.js";
  import { AllTokensFailedError, TokenNotFoundError } from "../../utils/tokenErrors.js";
  import { toast } from "../../stores/toast";
  import type { Token } from "../../stores/tokens.js";
  import type { EventIO, NostrEvent } from "@nostr-git/core";
  import type { ImportConfig } from "@nostr-git/core";
  import {
    buildRemoteTargetOptions,
    getDefaultSelectedRemoteTargetIds,
    preflightRemoteTargets,
    toRemoteTargetSelection,
    validateRemoteTargetRepoName,
    type RemoteTargetOption,
  } from "../../utils/remote-targets.js";
  import {
    hasValidatedSourceAccess,
    shouldFetchBranchActivity,
    sortImportBranches,
    type SourceAccessMode,
  } from "../../utils/import-source-access.js";
  import { canProceedImportStep2 } from "../../utils/import-dialog-state.js";
  import {
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
    getMandatoryGraspRelayUrls,
  } from "../../utils/grasp-pipeline.js";
  import {
    getAccessTokenManagementMessage,
    isWorkflowScopeIssue,
  } from "../../utils/tokenManagement.js";
  import RepoCommunitySelect from "./RepoCommunitySelect.svelte";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import { findRepoCommunityOption, getRepoCommunityOptionBinding } from "./repo-community-options.js";

  interface Props {
    pubkey: string;
    workerApi?: any;
    onSignEvent?: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>; // Optional - works with all signers
    eventIO?: EventIO;
    onFetchEvents?: (filters: import("@nostr-git/core").NostrFilter[]) => Promise<NostrEvent[]>;
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
    }) => Promise<NostrEvent[]>;
    onClose: () => void;
    onPublishEvent?: (event: NostrEvent) => Promise<unknown>;
    onRollbackPublishedRepoEvents?: (params: {
      repoName: string;
      relays: string[];
    }) => Promise<void>;
    onImportComplete?: (result: ImportResult) => void;
    onNavigateToRepo?: (result: ImportResult) => void; // Optional callback to navigate to the imported repo
    onAbortImport?: () => Promise<void> | void;
    defaultRelays?: string[];
    searchRelays?: (query: string) => Promise<string[]>;
    communityOptions?: RepoCommunityOption[];
    defaultCommunityPubkey?: string;
  }

  const {
    pubkey,
    workerApi,
    onSignEvent,
    eventIO,
    onFetchEvents,
    onFetchRelayEvents,
    onClose,
    onPublishEvent,
    onRollbackPublishedRepoEvents,
    onImportComplete,
    onNavigateToRepo,
    onAbortImport,
    defaultRelays = DEFAULT_RELAYS.default.slice(0, 2),
    searchRelays,
    communityOptions = [],
    defaultCommunityPubkey = "",
  }: Props = $props();

  // Validate that we have at least one signing method
  if (!onSignEvent && !eventIO) {
    throw new Error("Either onSignEvent callback or eventIO must be provided for signing events");
  }

  // Initialize the useImportRepo hook
  const importState = useImportRepo({
    userPubkey: pubkey,
    workerApi,
    onSignEvent,
    eventIO,
    onFetchEvents,
    onFetchRelayEvents,
    onProgress: (progress) => {
      currentProgress = progress;
    },
    onImportCompleted: (result) => {
      completedResult = result;
      // Ensure currentProgress reflects completion
      if (currentProgress) {
        currentProgress = { ...currentProgress, isComplete: true };
      }
      toast.push({
        message: "Repository imported successfully!",
        variant: "default",
      });
      onImportComplete?.(result);
    },
    onPublishEvent,
    onRollbackPublishedRepoEvents,
  });

  // Step management (1: URL + Token + Date, 2: Preview + Config, 3: Progress)
  let currentStep = $state(1);
  let currentProgress = $state<ImportProgress | undefined>();
  let completedResult = $state<ImportResult | null>(null);

  // Form state - Step 1
  let repoUrl = $state("");
  let selectedHost = $state<string | null>(null);
  let sinceDate = $state<Date | undefined>(undefined);
  let sourceToken = $state<string | null>(null);
  let tokenValidated = $state(false);
  let isValidatingToken = $state(false);
  let tokenValidationError = $state<string | undefined>();
  let validatedForUrl = $state<string | null>(null);
  let validationTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceValidationRunId = 0;
  let sourceAccessMode = $state<SourceAccessMode | null>(null);
  let validatedSourceAccess = $state<SourceAccessResult | null>(null);

  // Form state - Step 2
  let repoMetadata = $state<{
    owner: string;
    name: string;
    defaultBranch: string;
    description?: string;
    htmlUrl: string;
    isOwner: boolean;
  } | null>(null);
  let destinationRepoName = $state("");
  let destinationRepoSeedKey = $state("");
  let selectedRelays = $state<string[]>([...defaultRelays]);
  let announceRepo = $state(true); // Always enabled
  let mirrorIssues = $state(true);
  let mirrorPullRequests = $state(true);
  let mirrorComments = $state(true);
  let selectedCommunityPubkey = $state(defaultCommunityPubkey);

  type ImportTargetOption = RemoteTargetOption;

  let importTargets = $state<ImportTargetOption[]>([]);
  let selectedImportTargetIds = $state<string[]>([]);
  let initializedTargetSelection = $state(false);
  let targetPreflightRunId = 0;
  let graspServerOptions = $state<string[]>([]);
  let graspRelayUrls = $state<string[]>([]);
  let newGraspRelayUrl = $state("");

  type ImportBranchOption = {
    name: string;
    commitSha?: string;
    commitDate?: string;
    timestampMs: number;
    isDefault: boolean;
  };

  let defaultImportBranch = $state("main");
  let importBranchOptions = $state<ImportBranchOption[]>([]);
  let selectedAdditionalBranchNames = $state<string[]>([]);
  let isLoadingImportBranches = $state(false);
  let importBranchLoadError = $state<string | undefined>();

  // UI state
  let validationError = $state<string | undefined>();
  let isCheckingOwnership = $state(false);
  let relaySearchQuery = $state("");
  let relaySearchResults = $state<string[]>([]);
  let showRelayAutocomplete = $state(false);
  let relayInputElement: HTMLInputElement | undefined = $state();

  // Token management
  let tokenList = $state<Token[]>([]);
  tokens.subscribe((t) => {
    tokenList = t;
  });

  graspServersStore.subscribe((urls) => {
    graspServerOptions = urls;
    if (graspRelayUrls.length === 0 && urls.length > 0) {
      graspRelayUrls = [...urls];
    }
  });

  async function waitForTokens(): Promise<Token[]> {
    return await tokens.waitForInitialization();
  }

  let relaySearchTimeout: ReturnType<typeof setTimeout> | null = null;
  const recommendedGraspServerOptions = $derived.by(() =>
    getRecommendedGraspServerUrls(graspServerOptions)
  );

  $effect(() => {
    const query = relaySearchQuery.trim();
    if (relaySearchTimeout) clearTimeout(relaySearchTimeout);

    if (query && searchRelays) {
      relaySearchTimeout = setTimeout(async () => {
        try {
          const results = await searchRelays(query);
          relaySearchResults = results.filter((relay) => !effectiveSelectedRelays.includes(relay));
          showRelayAutocomplete = relaySearchResults.length > 0;
        } catch (error) {
          console.error("Failed to search relays", error);
          relaySearchResults = [];
          showRelayAutocomplete = false;
        }
      }, 300);
    } else {
      relaySearchResults = [];
      showRelayAutocomplete = false;
    }

    return () => {
      if (relaySearchTimeout) clearTimeout(relaySearchTimeout);
    };
  });

  function normalizeRelayUrl(value: string): string {
    return (value || "").trim().replace(/\/+$/, "");
  }

  function appendRelay(relayUrl: string) {
    const normalized = normalizeRelayUrl(relayUrl);
    if (!normalized) return;

    if (!effectiveSelectedRelays.includes(normalized)) {
      selectedRelays = [...selectedRelays, normalized];
    }

    relaySearchQuery = "";
    relaySearchResults = [];
    showRelayAutocomplete = false;
  }

  function normalizeTokenHostForTarget(host: string): string {
    const normalized = (host || "").trim().toLowerCase();
    if (normalized === "api.github.com") return "github.com";
    return normalized;
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

  function parseDateToTimestampMs(value?: string): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildSmartHttpCandidateUrls(sourceRepoUrl: string): string[] {
    const trimmed = sourceRepoUrl.trim().replace(/\/+$/, "");
    if (!trimmed) return [];

    const candidates: string[] = [];
    const add = (value: string) => {
      const normalized = value.trim();
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    if (/^https?:\/\//i.test(trimmed) && !trimmed.endsWith(".git")) {
      add(`${trimmed}.git`);
    }

    add(trimmed);

    return candidates;
  }

  async function loadImportBranches(
    sourceRepoUrl: string,
    owner: string,
    repo: string,
    token: string,
    preferredDefaultBranch?: string,
    accessMode: SourceAccessMode = token.trim() ? "token" : "anonymous"
  ) {
    isLoadingImportBranches = true;
    importBranchLoadError = undefined;

    try {
      const normalizedDefaultBranch = (preferredDefaultBranch || "main").trim() || "main";
      defaultImportBranch = normalizedDefaultBranch;

      const branchByName = new Map<string, { name: string; commitSha?: string }>();

      if (workerApi?.listServerRefs) {
        for (const candidateUrl of buildSmartHttpCandidateUrls(sourceRepoUrl)) {
          try {
            const refs = await workerApi.listServerRefs({
              url: candidateUrl,
              prefix: "refs/heads/",
              symrefs: false,
            });

            for (const item of refs || []) {
              const rawRef = String(item?.ref || "");
              if (!rawRef.startsWith("refs/heads/")) continue;
              const branchName = rawRef.replace(/^refs\/heads\//, "").trim();
              if (!branchName) continue;
              const commitSha =
                typeof item?.oid === "string" && item.oid.trim() ? item.oid.trim() : undefined;
              branchByName.set(branchName, { name: branchName, commitSha });
            }

            if (branchByName.size > 0) {
              break;
            }
          } catch {
            // try next candidate URL before falling back to provider API
          }
        }
      }

      const api = getGitServiceApiFromUrl(sourceRepoUrl, token);

      if (branchByName.size === 0) {
        const sourceBranches = await api.listBranches(owner, repo);
        for (const branch of sourceBranches || []) {
          const branchName = String(branch?.name || "").trim();
          if (!branchName) continue;
          const commitSha =
            typeof branch?.commit?.sha === "string" && branch.commit.sha.trim()
              ? branch.commit.sha.trim()
              : undefined;
          branchByName.set(branchName, { name: branchName, commitSha });
        }
      }

      if (!branchByName.has(normalizedDefaultBranch)) {
        branchByName.set(normalizedDefaultBranch, { name: normalizedDefaultBranch });
      }

      const branchCandidates = Array.from(branchByName.values());
      const enriched = shouldFetchBranchActivity(accessMode)
        ? await mapWithConcurrency(branchCandidates, 6, async (candidate) => {
            try {
              let commitDate = "";
              let commitSha = candidate.commitSha;

              if (commitSha) {
                const commit = await api.getCommit(owner, repo, commitSha);
                commitDate = commit?.committer?.date || commit?.author?.date || "";
              } else {
                const commits = await api.listCommits(owner, repo, {
                  sha: candidate.name,
                  per_page: 1,
                });
                const latest = Array.isArray(commits) ? commits[0] : undefined;
                commitSha = latest?.sha || commitSha;
                commitDate = latest?.committer?.date || latest?.author?.date || "";
              }

              return {
                name: candidate.name,
                commitSha,
                commitDate,
                timestampMs: parseDateToTimestampMs(commitDate),
                isDefault: candidate.name === normalizedDefaultBranch,
              } satisfies ImportBranchOption;
            } catch {
              return {
                name: candidate.name,
                commitSha: candidate.commitSha,
                commitDate: undefined,
                timestampMs: 0,
                isDefault: candidate.name === normalizedDefaultBranch,
              } satisfies ImportBranchOption;
            }
          })
        : branchCandidates.map((candidate) => ({
            name: candidate.name,
            commitSha: candidate.commitSha,
            commitDate: undefined,
            timestampMs: 0,
            isDefault: candidate.name === normalizedDefaultBranch,
          }));

      importBranchOptions = sortImportBranches(enriched);
      selectedAdditionalBranchNames = [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      importBranchLoadError = message || "Failed to load branch options";
      importBranchOptions = [
        {
          name: defaultImportBranch,
          isDefault: true,
          timestampMs: 0,
        },
      ];
      selectedAdditionalBranchNames = [];
    } finally {
      isLoadingImportBranches = false;
    }
  }

  function selectAllAdditionalBranches() {
    selectedAdditionalBranchNames = importBranchOptions
      .filter((branch) => !branch.isDefault)
      .map((branch) => branch.name);
  }

  function clearAdditionalBranches() {
    selectedAdditionalBranchNames = [];
  }

  const selectedBranchNamesForImport = $derived.by(() => {
    const defaultBranch = defaultImportBranch || "main";
    const selected = Array.from(
      new Set([
        defaultBranch,
        ...selectedAdditionalBranchNames.filter((name) => name && name !== defaultBranch),
      ])
    );
    return selected;
  });

  function getProviderBaseUrl(
    provider: ImportTargetOption["provider"],
    host?: string
  ): string | undefined {
    if (!host || provider === "grasp") return undefined;
    const normalizedHost = host.toLowerCase();

    if (provider === "github") {
      if (normalizedHost === "github.com") return undefined;
      return `https://${host}/api/v3`;
    }
    if (provider === "gitlab") {
      if (normalizedHost === "gitlab.com") return undefined;
      return `https://${host}/api/v4`;
    }
    if (provider === "gitea") {
      return `https://${host}/api/v1`;
    }
    if (provider === "bitbucket") {
      if (normalizedHost === "bitbucket.org") return undefined;
      return `https://${host}/api/2.0`;
    }
    return undefined;
  }

  function upsertGraspRelay(url: string) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized) return;
    if (!graspRelayUrls.includes(normalized)) {
      graspRelayUrls = [...graspRelayUrls, normalized];
      initializedTargetSelection = false;
    }
  }

  function removeGraspRelay(index: number) {
    graspRelayUrls = graspRelayUrls.filter((_, i) => i !== index);
    initializedTargetSelection = false;
  }

  const selectedGraspTargetRelays = $derived.by(() =>
    importTargets
      .filter(
        (target) =>
          selectedImportTargetIds.includes(target.id) &&
          target.status === "ready" &&
          target.provider === "grasp" &&
          target.relayUrl
      )
      .map((target) => normalizeRelayUrl(target.relayUrl || ""))
      .filter(Boolean)
  );

  const mandatoryGraspRelays = $derived.by(() =>
    getMandatoryGraspRelayUrls(selectedGraspTargetRelays)
  );

  $effect(() => {
    const nextSelectedRelays = getEditableRepoRelayUrls(selectedRelays || [], mandatoryGraspRelays);

    if (
      nextSelectedRelays.length !== selectedRelays.length ||
      nextSelectedRelays.some((value, index) => value !== selectedRelays[index])
    ) {
      selectedRelays = nextSelectedRelays;
    }
  });

  const effectiveSelectedRelays = $derived.by(() =>
    getEffectiveRepoRelayUrls(selectedRelays || [], mandatoryGraspRelays)
  );

  function commitNewGraspRelay() {
    if (!newGraspRelayUrl.trim()) return;
    upsertGraspRelay(newGraspRelayUrl);
    newGraspRelayUrl = "";
  }

  const targetRepoName = $derived.by(() => {
    return destinationRepoName.trim();
  });

  $effect(() => {
    if (!repoMetadata) return;

    const seedKey = `${repoMetadata.owner}/${repoMetadata.name}`;
    if (seedKey === destinationRepoSeedKey) return;

    destinationRepoSeedKey = seedKey;
    destinationRepoName = repoMetadata.name;
  });

  function validateDestinationRepoName(name: string): string | undefined {
    return validateRemoteTargetRepoName(name);
  }

  function buildImportTargets(): ImportTargetOption[] {
    return buildRemoteTargetOptions({ tokenList, graspRelayUrls });
  }

  async function runTargetPreflight() {
    if (currentStep !== 2 || !repoMetadata) return;

    const currentRun = ++targetPreflightRunId;
    const seeds = buildImportTargets();

    const destinationNameError = validateDestinationRepoName(targetRepoName);
    if (destinationNameError) {
      selectedImportTargetIds = [];
      importTargets = seeds.map((target) =>
        target.status === "unsupported"
          ? target
          : {
              ...target,
              status: "failed" as const,
              detail: destinationNameError,
            }
      );
      return;
    }

    importTargets = seeds;

    const nextTargets = await preflightRemoteTargets({
      targets: seeds,
      tokenList,
      userPubkey: pubkey,
      repoName: targetRepoName,
    });

    if (currentRun !== targetPreflightRunId) return;

    importTargets = nextTargets;
    const readyTargets = nextTargets.filter((target) => target.status === "ready");

    selectedImportTargetIds = selectedImportTargetIds.filter((id) =>
      readyTargets.some((target) => target.id === id)
    );

    if (!initializedTargetSelection) {
      selectedImportTargetIds = getDefaultSelectedRemoteTargetIds(nextTargets);
      initializedTargetSelection = true;
    }
  }

  // Detect provider from URL
  $effect(() => {
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      selectedHost = null;
      return;
    }

    try {
      const parsed = parseRepoUrl(trimmed);
      selectedHost = parsed.host;
    } catch {
      selectedHost = null;
    }
  });

  // Validate URL
  function validateUrl(url: string): string | undefined {
    const trimmed = url.trim();

    if (!trimmed) {
      return "Repository URL is required";
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      return "Repository URL must start with https:// or http://";
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return "Repository URL must use https:// or http://";
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathSegments.length < 2) {
      return "Repository URL must include owner and repo (https://host/owner/repo)";
    }

    try {
      parseRepoUrl(trimmed);
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid repository URL format";
    }
  }

  interface SourceAccessResult {
    mode: SourceAccessMode;
    token: string | null;
    ownership: Awaited<ReturnType<typeof checkRepoOwnership>> | null;
    repo: Awaited<ReturnType<typeof checkRepoOwnership>>["repo"];
    isOwner: boolean;
  }

  class SourceAccessFallbackError extends Error {
    tokenError: unknown;
    anonymousError: unknown;

    constructor(tokenError: unknown, anonymousError: unknown) {
      super("Source access failed for both token and anonymous modes");
      this.tokenError = tokenError;
      this.anonymousError = anonymousError;
    }
  }

  function classifySourceReadError(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes("404") || normalized.includes("not found")) {
      return "Repository not found or not publicly accessible";
    }
    if (
      normalized.includes("401") ||
      normalized.includes("403") ||
      normalized.includes("unauthorized") ||
      normalized.includes("forbidden")
    ) {
      return "Repository is not publicly accessible";
    }
    return "Could not access the repository publicly";
  }

  function toFriendlySourceAccessError(error: unknown, host: string): string {
    if (error instanceof SourceAccessFallbackError) {
      const publicReason = classifySourceReadError(
        error.anonymousError instanceof Error
          ? error.anonymousError.message
          : String(error.anonymousError || "")
      );
      return `${publicReason}. Add a source token in settings for private repositories or richer imports.`;
    }

    if (error instanceof TokenNotFoundError) {
      return `No token found for ${host}. Public repositories can still be imported anonymously if provider access is available.`;
    }

    const classify = (message: string): string => {
      const normalized = message.toLowerCase();
      if (normalized.includes("404") || normalized.includes("not found")) {
        return "Repository not found or token has no access";
      }
      if (
        normalized.includes("401") ||
        normalized.includes("unauthorized") ||
        normalized.includes("bad credentials")
      ) {
        return "Invalid token credentials";
      }
      if (normalized.includes("403") || normalized.includes("forbidden")) {
        return "Token lacks required repository permissions";
      }
      return "Token could not access this repository";
    };

    if (error instanceof AllTokensFailedError) {
      const reasons = Array.from(new Set(error.errors.map((entry) => classify(entry.message))));
      return `None of your tokens for ${host} can access this repository (${reasons.join(", ")}).`;
    }

    if (error instanceof Error) {
      return classify(error.message);
    }

    return "Unable to access source repository with available tokens";
  }

  async function resolveSourceAccess(
    parsed: ReturnType<typeof parseRepoUrl>
  ): Promise<SourceAccessResult> {
    const allTokens = await waitForTokens();
    const normalizedRepoUrl = repoUrl.trim();
    const normalizedSourceHost = normalizeTokenHostForTarget(parsed.host);

    try {
      const tokenAccess = await tryTokensForHost(
        allTokens,
        (tokenHost: string) => {
          const normalizedTokenHost = normalizeTokenHostForTarget(tokenHost);
          return (
            matchesHost(normalizedTokenHost, normalizedSourceHost) ||
            matchesHost(normalizedSourceHost, normalizedTokenHost)
          );
        },
        async (candidateToken: string) => {
          const api = getGitServiceApiFromUrl(normalizedRepoUrl, candidateToken);
          const ownership = await checkRepoOwnership(api, parsed.owner, parsed.repo);
          return {
            mode: "token" as const,
            token: candidateToken,
            ownership,
            repo: ownership.repo,
            isOwner: ownership.isOwner,
          };
        }
      );

      return tokenAccess;
    } catch (tokenError) {
      try {
        const api = getGitServiceApiFromUrl(normalizedRepoUrl, "");
        const repo = await api.getRepo(parsed.owner, parsed.repo);
        return {
          mode: "anonymous",
          token: null,
          ownership: null,
          repo,
          isOwner: false,
        };
      } catch (anonymousError) {
        throw new SourceAccessFallbackError(tokenError, anonymousError);
      }
    }
  }

  async function validateSourceToken() {
    const runId = ++sourceValidationRunId;
    const urlError = validateUrl(repoUrl);
    if (urlError) {
      if (runId === sourceValidationRunId) {
        tokenValidationError = urlError;
        tokenValidated = false;
        sourceToken = null;
        validatedForUrl = null;
      }
      return;
    }

    let parsed: ReturnType<typeof parseRepoUrl>;
    try {
      parsed = parseRepoUrl(repoUrl.trim());
    } catch (error) {
      if (runId === sourceValidationRunId) {
        tokenValidationError =
          error instanceof Error ? error.message : "Invalid repository URL format";
        tokenValidated = false;
        sourceToken = null;
        validatedForUrl = null;
      }
      return;
    }

    if (runId === sourceValidationRunId) {
      isValidatingToken = true;
      tokenValidationError = undefined;
    }

    try {
      const access = await resolveSourceAccess(parsed);
      if (runId !== sourceValidationRunId) return;
      sourceToken = access.token;
      sourceAccessMode = access.mode;
      validatedSourceAccess = access;
      tokenValidated = true;
      validatedForUrl = repoUrl.trim();
    } catch (error) {
      if (runId !== sourceValidationRunId) return;
      sourceToken = null;
      sourceAccessMode = null;
      validatedSourceAccess = null;
      tokenValidated = false;
      validatedForUrl = null;
      tokenValidationError = toFriendlySourceAccessError(error, parsed.host);
    } finally {
      if (runId === sourceValidationRunId) {
        isValidatingToken = false;
      }
    }
  }

  let lastSourceTokenUrl: string | null = null;
  $effect(() => {
    const normalizedUrl = repoUrl.trim();
    if (normalizedUrl === lastSourceTokenUrl) return;
    lastSourceTokenUrl = normalizedUrl;
    sourceValidationRunId++;
    if (validationTimer) {
      clearTimeout(validationTimer);
      validationTimer = null;
    }
    sourceToken = null;
    sourceAccessMode = null;
    validatedSourceAccess = null;
    tokenValidated = false;
    tokenValidationError = undefined;
    validatedForUrl = null;
  });

  $effect(() => {
    void repoUrl;
    void selectedHost;
    void currentStep;

    if (currentStep !== 1) return;

    const normalizedUrl = repoUrl.trim();
    if (!normalizedUrl || !selectedHost) return;
    if (validatedForUrl === normalizedUrl) return;

    const urlError = validateUrl(normalizedUrl);
    if (urlError) {
      tokenValidated = false;
      sourceToken = null;
      validatedForUrl = null;
      tokenValidationError = urlError;
      return;
    }

    if (validationTimer) clearTimeout(validationTimer);
    validationTimer = setTimeout(() => {
      void validateSourceToken();
    }, 450);

    return () => {
      if (validationTimer) {
        clearTimeout(validationTimer);
        validationTimer = null;
      }
    };
  });

  $effect(() => {
    void currentStep;
    void repoMetadata;
    void targetRepoName;
    void tokenList;
    void graspRelayUrls;

    if (currentStep !== 2 || !repoMetadata || !targetRepoName) {
      return;
    }

    void runTargetPreflight();
  });

  $effect(() => {
    if (sourceAccessMode !== "anonymous") return;

    mirrorIssues = false;
    mirrorPullRequests = false;
    mirrorComments = false;
  });

  // Step 1: Validate and proceed to Step 2
  async function handleStep1Next() {
    const urlError = validateUrl(repoUrl);
    if (urlError) {
      validationError = urlError;
      return;
    }

    if (
      !hasValidatedSourceAccess({
        tokenValidated,
        validatedForUrl,
        currentUrl: repoUrl,
        validatedSourceAccess,
      })
    ) {
      validationError = "Please validate source access before continuing";
      return;
    }

    validationError = undefined;

    // Parse URL and get repo metadata
    try {
      const normalizedRepoUrl = repoUrl.trim();
      const parsed = parseRepoUrl(normalizedRepoUrl);

      // Fetch repo metadata and check ownership
      isCheckingOwnership = true;
      try {
        const access =
          validatedSourceAccess && validatedForUrl === normalizedRepoUrl
            ? validatedSourceAccess
            : await resolveSourceAccess(parsed);

        sourceToken = access.token;
        sourceAccessMode = access.mode;
        validatedSourceAccess = access;
        tokenValidated = true;
        validatedForUrl = normalizedRepoUrl;

        repoMetadata = {
          owner: parsed.owner,
          name: parsed.repo,
          defaultBranch: access.repo.defaultBranch || "main",
          description: access.repo.description,
          htmlUrl: access.repo.htmlUrl,
          isOwner: access.isOwner,
        };

        // Owner: mirror issues/PRs/comments by default; non-owner: start conservative
        const mirrorByDefault = access.mode === "token" && access.isOwner;
        mirrorIssues = mirrorByDefault;
        mirrorPullRequests = mirrorByDefault;
        mirrorComments = mirrorByDefault;
        initializedTargetSelection = false;
        selectedImportTargetIds = [];

        currentStep = 2;
        void loadImportBranches(
          normalizedRepoUrl,
          parsed.owner,
          parsed.repo,
          access.token || "",
          access.repo.defaultBranch || "main",
          access.mode
        );
      } catch (err) {
        validationError = toFriendlySourceAccessError(err, parsed.host);
      } finally {
        isCheckingOwnership = false;
      }
    } catch (err) {
      validationError = err instanceof Error ? err.message : "Failed to initialize import";
    }
  }

  // Step 2: Validate and start import
  async function handleStep2Next() {
    if (!repoMetadata) {
      validationError = "Repository metadata not available";
      return;
    }

    const destinationNameError = validateDestinationRepoName(destinationRepoName);
    if (destinationNameError) {
      validationError = destinationNameError;
      return;
    }

    // Validate relays
    if (effectiveSelectedRelays.length === 0) {
      validationError = "At least one relay is required";
      return;
    }

    const selectedTargets: ImportRemoteTarget[] = importTargets
      .filter((target) => selectedImportTargetIds.includes(target.id) && target.status === "ready")
      .map((target) => toRemoteTargetSelection(target));

    if (!repoMetadata.isOwner && selectedTargets.length === 0) {
      validationError = "Select at least one writable import target";
      return;
    }

    validationError = undefined;

    if (!validatedSourceAccess || validatedForUrl !== repoUrl.trim()) {
      validationError = "Source repository access is missing. Go back and re-validate access.";
      return;
    }
    const token = sourceToken || "";

    // Create import config
    const config: ImportConfig = {
      maxRetries: 3,
      enableProgressTracking: true,
      sinceDate: sinceDate,
      forkRepo: false,
      destinationRepoName: targetRepoName,
      mirrorIssues: sourceAccessMode === "anonymous" ? false : mirrorIssues,
      mirrorPullRequests: sourceAccessMode === "anonymous" ? false : mirrorPullRequests,
      mirrorComments: sourceAccessMode === "anonymous" ? false : mirrorComments,
      relays: effectiveSelectedRelays,
      community: getRepoCommunityOptionBinding(
        findRepoCommunityOption(communityOptions, selectedCommunityPubkey)
      ),
    };
    (config as ImportConfig & { selectedBranches?: string[] }).selectedBranches =
      selectedBranchNamesForImport;

    // Start import
    currentStep = 3;
    try {
      await importState.importRepository(repoUrl, token, config, selectedTargets);
    } catch (err) {
      // Error is handled by the hook and shown in progress
      console.error("Import failed:", err);
    }
  }

  // Relay management
  function addRelay() {
    if (relaySearchQuery.trim()) {
      appendRelay(relaySearchQuery);
      return;
    }

    selectedRelays = [...selectedRelays, ""];
  }

  function removeRelay(index: number) {
    if (selectedRelays.length > 1 || mandatoryGraspRelays.length > 0) {
      selectedRelays = selectedRelays.filter((_, i) => i !== index);
    }
  }

  function handleImportTargetSelectionChange() {
    initializedTargetSelection = true;
  }

  function targetStatusLabel(target: ImportTargetOption): string {
    if (target.status === "ready") return "Ready";
    if (target.status === "checking") return "Checking";
    if (target.status === "no-token") return "No token";
    if (target.status === "unsupported") return "Unsupported";
    return "Failed";
  }

  function targetStatusTone(target: ImportTargetOption): string {
    if (target.status === "ready") return "text-green-700 dark:text-green-400";
    if (target.status === "checking") return "text-gray-400";
    if (target.status === "no-token") return "text-yellow-700 dark:text-yellow-400";
    if (target.status === "unsupported") return "text-yellow-700 dark:text-yellow-400";
    return "text-red-700 dark:text-red-400";
  }

  // Track if we should close after abort completes
  let shouldCloseAfterAbort = $state(false);
  let isCancelingImport = $state(false);

  // Watch for when import completes after abort
  $effect(() => {
    if (shouldCloseAfterAbort && !importState.isImporting) {
      shouldCloseAfterAbort = false;
      isCancelingImport = false;
      onClose();
    }
  });

  $effect(() => {
    if (!importState.isImporting) {
      isCancelingImport = false;
    }
  });

  // Cleanup: abort import if component unmounts while import is in progress
  $effect(() => {
    return () => {
      // Cleanup function runs when component unmounts
      if (importState.isImporting) {
        void requestImportAbort("Component unmounted");
      }
    };
  });

  // Handle explicit close (X button) - will abort if importing
  function handleClose() {
    if (importState.isImporting) {
      // Explicit close during import: abort and close after abort completes
      shouldCloseAfterAbort = true;
      void requestImportAbort("User cancelled import");
    } else {
      onClose();
    }
  }

  // Prevent dialog close when importing (backdrop click)
  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget && !importState.isImporting) {
      onClose();
    }
  }

  // Handle keyboard events for accessibility (Escape key)
  function handleBackdropKeydown(event: KeyboardEvent) {
    console.log("🚀 ImportRepoDialog: handleBackdropKeydown called", {
      event,
      importState: importState.isImporting,
    });
    if (event.key === "Escape" && !importState.isImporting) {
      onClose();
    }
  }

  async function requestImportAbort(reason: string) {
    if (isCancelingImport) return;
    isCancelingImport = true;
    importState.abortImport(reason);
    try {
      await onAbortImport?.();
    } catch {
      // pass
    } finally {
      // Keep canceling state while import teardown finishes
      if (!importState.isImporting) {
        isCancelingImport = false;
      }
    }
  }

  function handleAbort() {
    // Abort and close after abort completes
    shouldCloseAfterAbort = true;
    void requestImportAbort("User cancelled import");
  }

  // Computed properties
  const canProceedStep1 = $derived(
    hasValidatedSourceAccess({
      tokenValidated,
      validatedForUrl,
      currentUrl: repoUrl,
      validatedSourceAccess,
    }) &&
      !isValidatingToken &&
      !isCheckingOwnership
  );
  const canProceedStep2 = $derived(
    canProceedImportStep2({
      hasRepoMetadata: repoMetadata !== null,
      effectiveRelayCount: effectiveSelectedRelays.length,
      isOwner: Boolean(repoMetadata?.isOwner),
      selectedImportTargetIds,
      importTargets,
    })
  );
  const targetPreflightPending = $derived(
    currentStep === 2 && importTargets.some((target) => target.status === "checking")
  );
  const isProgressComplete = $derived(currentProgress?.isComplete && completedResult !== null);
  const workflowScopeIssue = $derived.by(() =>
    Boolean(currentProgress?.error && isWorkflowScopeIssue(currentProgress.error))
  );

  // Phased progress from hook: use explicit phase and IMPORT_PHASES order (no string matching)
  type PhaseStatus = "completed" | "active" | "pending";
  const progressPhases = $derived.by(() => {
    const p = currentProgress;
    const list = IMPORT_PHASES.map(
      (
        id
      ): {
        id: ImportPhase;
        label: string;
        status: PhaseStatus;
        detail?: string;
        current?: number;
        total?: number;
        mirroredCount?: number;
      } => ({
        id,
        label: IMPORT_PHASE_LABELS[id],
        status: "pending" as PhaseStatus,
      })
    );
    if (!p) return list;

    const c = p.completedCounts;
    list.forEach((ph) => {
      if (ph.id === "issues" && c?.issues != null) ph.mirroredCount = c.issues;
      if (ph.id === "pull_requests" && c?.pull_requests != null) ph.mirroredCount = c.pull_requests;
      if (ph.id === "comments" && c?.comments != null) ph.mirroredCount = c.comments;
    });

    const phaseIndex =
      p.phase === "complete"
        ? list.length
        : IMPORT_PHASES.indexOf((p.phase ?? "connecting") as (typeof IMPORT_PHASES)[number]);
    const activeIndex = phaseIndex >= 0 ? Math.min(phaseIndex, list.length - 1) : 0;

    if (p.isComplete) {
      list.forEach((ph) => (ph.status = "completed"));
      return list;
    }

    list.forEach((ph, i) => {
      ph.status = i < activeIndex ? "completed" : i === activeIndex ? "active" : "pending";
      if (i === activeIndex) {
        ph.detail = p.step;
        ph.current = p.current;
        ph.total = p.total;
      }
    });
    return list;
  });
</script>

<svelte:window onkeydown={handleBackdropKeydown} />

<!-- Import Repository Dialog -->
<div
  class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 isolate"
  role="dialog"
  aria-modal="true"
  aria-labelledby="import-dialog-title"
  aria-busy={importState.isImporting}
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleBackdropKeydown}
>
  <div
    class="ng-themed-modal bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl border border-gray-700 overflow-hidden max-h-[90vh] flex flex-col"
  >
    <!-- Header -->
    <div class="flex items-center justify-between p-6 border-b border-gray-700">
      <div class="flex items-center space-x-3">
        <Download class="w-6 h-6 text-blue-600 dark:text-blue-400" />
        <h2 id="import-dialog-title" class="text-xl font-semibold text-white">Import Repository</h2>
      </div>
      {#if !importState.isImporting}
        <button
          type="button"
          onclick={handleClose}
          class="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close dialog"
          title={"Close"}
        >
          <X class="w-5 h-5" />
        </button>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <!-- Step 1: URL + Token + Date -->
      {#if currentStep === 1}
        <div class="space-y-4">
          <div>
            <h3 class="text-lg font-medium text-white mb-4">Step 1: Repository URL</h3>

            <!-- URL Input -->
            <div class="mb-4">
              <label for="repo-url" class="block text-sm font-medium text-gray-300 mb-2">
                Repository URL *
              </label>
              <input
                id="repo-url"
                type="text"
                bind:value={repoUrl}
                placeholder="https://github.com/owner/repo"
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                aria-invalid={!!validationError}
              />
              {#if validationError}
                <p class="mt-1 text-sm text-red-700 dark:text-red-400 flex items-center gap-1">
                  <AlertCircle class="w-4 h-4" />
                  {validationError}
                </p>
              {/if}
            </div>

            <!-- Token Validation -->
            {#if selectedHost}
              <div class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-300">
                    Source Access for {selectedHost}
                  </span>
                  <button
                    type="button"
                    onclick={validateSourceToken}
                    disabled={isValidatingToken}
                    class="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isValidatingToken ? "Validating..." : "Validate"}
                  </button>
                </div>
                <div class="flex items-center space-x-2">
                  {#if tokenValidated}
                    <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
                    <span class="text-sm text-green-700 dark:text-green-400">
                      {#if sourceAccessMode === "anonymous"}
                        Public source access validated (anonymous)
                      {:else}
                        Source access validated
                      {/if}
                    </span>
                  {:else if tokenValidationError}
                    <AlertCircle class="w-5 h-5 text-red-600 dark:text-red-400" />
                    <span class="text-sm text-red-700 dark:text-red-400">{tokenValidationError}</span>
                  {:else if isValidatingToken}
                    <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
                    <span class="text-sm text-gray-400">Validating source access...</span>
                  {:else}
                    <AlertCircle class="w-5 h-5 text-yellow-700 dark:text-yellow-400" />
                    <span class="text-sm text-yellow-700 dark:text-yellow-400">Validate source access to continue</span>
                  {/if}
                </div>
                {#if tokenValidated && sourceAccessMode === "anonymous"}
                  <p class="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Repo-only import is available anonymously. Importing issues, pull requests, and
                    comments still requires a source token.
                  </p>
                {/if}
              </div>
            {/if}

            <!-- Date Picker -->
            <div class="mb-4">
              <label
                for="since-date"
                class="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2"
              >
                <Calendar class="w-4 h-4" />
                <span>Only import items after (optional):</span>
              </label>
              <input
                id="since-date"
                type="date"
                value={sinceDate ? sinceDate.toISOString().split("T")[0] : ""}
                onchange={(e) => {
                  const value = (e.target as HTMLInputElement).value;
                  sinceDate = value ? new Date(value) : undefined;
                }}
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Leave empty to import all items"
              />
              <p class="mt-1 text-xs text-gray-400">
                Only import issues, comments, and PRs created after this date
              </p>
            </div>

            <!-- Next Button -->
            <div class="flex justify-end">
              <button
                type="button"
                onclick={handleStep1Next}
                disabled={!canProceedStep1 || isCheckingOwnership}
                class="px-4 py-2 bg-blue-600 !text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {#if isCheckingOwnership}
                  <Loader2 class="w-4 h-4 animate-spin" />
                  Checking repository...
                {:else}
                  Next: Review & Configure
                {/if}
              </button>
            </div>
          </div>
        </div>

        <!-- Step 2: Preview + Config -->
      {:else if currentStep === 2 && repoMetadata}
        <div class="space-y-4">
          <div>
            <h3 class="text-lg font-medium text-white mb-4">Step 2: Configure Import</h3>

            <!-- Repo Preview -->
            <div class="bg-gray-800 rounded-lg p-4 border border-gray-600 mb-4">
              <div class="flex items-start space-x-3">
                <GitBranch class="w-5 h-5 text-gray-400 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <h4 class="text-sm font-medium text-white">
                    {repoMetadata.owner}/{repoMetadata.name}
                  </h4>
                  {#if repoMetadata.description}
                    <p class="text-sm text-gray-400 mt-1">{repoMetadata.description}</p>
                  {/if}
                  <a
                    href={repoMetadata.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mt-1 inline-flex items-center gap-1"
                  >
                    View on {selectedHost}
                    <ExternalLink class="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            <div class="mb-4 bg-gray-800 rounded-lg p-4 border border-gray-600">
              <label
                class="block text-sm font-medium text-gray-300 mb-2"
                for="import-destination-repo-name"
              >
                Destination repository name
              </label>
              <input
                id="import-destination-repo-name"
                type="text"
                bind:value={destinationRepoName}
                class="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter destination repository name"
              />
              <p class="mt-2 text-xs text-gray-400">
                Selected import targets and the final Nostr repo announcement will use this name.
              </p>
            </div>

            <div class="mb-4">
              <RepoCommunitySelect
                options={communityOptions}
                bind:value={selectedCommunityPubkey}
                label="Repository community"
                description="Optionally bind the imported repository to one community as part of its identity."
              />
            </div>

            <!-- Branch Selection -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-gray-300 mb-2">Branches to Import</h4>
              <p class="text-xs text-gray-400 mb-3">
                Default branch is always included. When commit activity is available, newer branches
                are listed first.
              </p>

              <div class="space-y-2 bg-gray-800 rounded-lg p-4 border border-gray-600">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs text-gray-400">
                    {#if isLoadingImportBranches}
                      Loading branch metadata...
                    {:else}
                      Importing {selectedBranchNamesForImport.length} of {importBranchOptions.length}
                      branches
                    {/if}
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-2 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:border-blue-600 hover:text-blue-700 dark:hover:border-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      onclick={selectAllAdditionalBranches}
                      disabled={isLoadingImportBranches || importBranchOptions.length <= 1}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      class="px-2 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:border-blue-600 hover:text-blue-700 dark:hover:border-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      onclick={clearAdditionalBranches}
                      disabled={isLoadingImportBranches ||
                        selectedAdditionalBranchNames.length === 0}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>

                {#if importBranchLoadError}
                  <p class="text-xs text-amber-700 dark:text-amber-300">
                    {importBranchLoadError}. Using default branch only.
                  </p>
                {/if}

                <div class="max-h-64 overflow-y-auto rounded border border-gray-700 bg-gray-900/60">
                  {#if isLoadingImportBranches}
                    <div class="flex items-center gap-2 px-3 py-3 text-xs text-gray-300">
                      <Loader2 class="w-3.5 h-3.5 animate-spin" />
                      Resolving available branches...
                    </div>
                  {:else if importBranchOptions.length === 0}
                    <p class="px-3 py-3 text-xs text-gray-400">No branches detected.</p>
                  {:else}
                    <div class="divide-y divide-gray-700">
                      {#each importBranchOptions as branch (branch.name)}
                        <label class="flex items-center justify-between gap-2 px-3 py-2">
                          <span class="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={branch.isDefault ||
                                selectedAdditionalBranchNames.includes(branch.name)}
                              disabled={branch.isDefault || importState.isImporting}
                              onchange={(event) => {
                                if (branch.isDefault) return;
                                const isChecked = (event.currentTarget as HTMLInputElement).checked;
                                if (isChecked) {
                                  selectedAdditionalBranchNames = Array.from(
                                    new Set([...selectedAdditionalBranchNames, branch.name])
                                  );
                                } else {
                                  selectedAdditionalBranchNames =
                                    selectedAdditionalBranchNames.filter(
                                      (name) => name !== branch.name
                                    );
                                }
                              }}
                              class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <span class="text-sm text-white truncate" title={branch.name}
                              >{branch.name}</span
                            >
                            {#if branch.isDefault}
                              <span
                                class="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-200 border border-blue-500/30"
                                >default</span
                              >
                            {/if}
                          </span>
                          <span class="text-[11px] text-gray-400 whitespace-nowrap">
                            {#if branch.commitDate}
                              {new Date(branch.commitDate).toLocaleString()}
                            {:else}
                              unknown
                            {/if}
                          </span>
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Import Targets -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-gray-300 mb-2">Import Targets *</h4>
              <p class="text-xs text-gray-400 mb-3">
                Select where this repository should be created and pushed. One target failing will
                not stop other targets from syncing.
              </p>

              <div class="mb-3 bg-gray-800 rounded-lg p-3 border border-gray-600 space-y-2">
                <p class="text-xs font-medium text-gray-300">GRASP relays</p>
                <div class="flex flex-wrap gap-2">
                  {#each graspRelayUrls as relayUrl, idx (relayUrl + idx)}
                    <span
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-200 border border-blue-500/30"
                    >
                      <span class="max-w-[220px] truncate" title={relayUrl}
                        >{relayUrl.replace(/^wss?:\/\//, "")}</span
                      >
                      <button
                        type="button"
                        class="hover:text-red-300"
                        onclick={() => removeGraspRelay(idx)}
                        title="Remove GRASP relay"
                      >
                        x
                      </button>
                    </span>
                  {/each}
                  <div class="inline-flex items-center">
                    <input
                      type="text"
                      bind:value={newGraspRelayUrl}
                      placeholder="wss://relay.example.com"
                      class="w-48 px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded-l-full text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onkeydown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitNewGraspRelay();
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="px-2 py-1 text-xs bg-blue-600 !text-white rounded-r-full hover:bg-blue-700"
                      onclick={commitNewGraspRelay}
                    >
                      +
                    </button>
                  </div>
                </div>
                {#if recommendedGraspServerOptions.length > 0}
                  <div class="flex flex-wrap gap-1">
                    {#each recommendedGraspServerOptions.filter((opt) => !graspRelayUrls.includes(normalizeRelayUrl(opt))) as opt}
                      <button
                        type="button"
                        class="px-2 py-1 text-xs rounded-full border border-dashed border-gray-500 text-gray-300 hover:border-blue-400 hover:text-blue-300"
                        onclick={() => upsertGraspRelay(opt)}
                      >
                        + {opt.replace(/^wss?:\/\//, "")}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>

              <div class="space-y-2 bg-gray-800 rounded-lg p-4 border border-gray-600">
                {#if importTargets.length === 0}
                  <p class="text-sm text-gray-400">No writable targets detected yet.</p>
                  <p class="text-xs text-gray-400">
                    Add host tokens in settings and/or add GRASP relay URLs above.
                  </p>
                {:else}
                  {#each importTargets as target (target.id)}
                    <label class="flex items-start gap-3">
                      <input
                        type="checkbox"
                        value={target.id}
                        bind:group={selectedImportTargetIds}
                        disabled={target.status !== "ready" || importState.isImporting}
                        onchange={handleImportTargetSelectionChange}
                        class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-sm text-white truncate">{target.label}</span>
                          <span class={`text-xs ${targetStatusTone(target)}`}
                            >{targetStatusLabel(target)}</span
                          >
                        </div>
                        {#if target.detail}
                          <p class="text-xs text-gray-400 mt-0.5">{target.detail}</p>
                        {/if}
                      </div>
                    </label>
                  {/each}
                {/if}
              </div>
              {#if targetPreflightPending}
                <p class="text-xs text-gray-400 mt-2">Running access preflight checks...</p>
              {:else}
                <p class="text-xs text-gray-400 mt-2">
                  {#if repoMetadata.isOwner}
                    Selecting import targets is optional for repositories you own.
                  {:else}
                    Select at least one target with Ready status.
                  {/if}
                </p>
              {/if}
            </div>

            <!-- Relay Selection -->
            <div class="mb-4">
              <div class="flex items-center gap-2 mb-2">
                <Globe class="w-4 h-4" />
                <span class="text-sm font-medium text-gray-300">Nostr Relays *</span>
              </div>
              <div class="space-y-2">
                {#each mandatoryGraspRelays as relayUrl}
                  <div class="flex items-center space-x-2">
                    <input
                      type="text"
                      value={relayUrl}
                      readonly
                      aria-label="Selected GRASP relay"
                      class="flex-1 px-3 py-2 bg-gray-800 border border-blue-500/40 rounded-lg text-white focus:outline-none"
                    />
                    <span
                      class="px-2.5 py-2 text-xs font-medium text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg whitespace-nowrap"
                    >
                      GRASP target
                    </span>
                  </div>
                {/each}

                {#each selectedRelays as relay, index}
                  <div class="flex items-center space-x-2">
                    <input
                      type="text"
                      bind:value={selectedRelays[index]}
                      class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="wss://relay.example.com"
                    />
                    <button
                      type="button"
                      onclick={() => removeRelay(index)}
                      disabled={selectedRelays.length === 1 && mandatoryGraspRelays.length === 0}
                      class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Remove relay"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                {/each}

                {#if searchRelays}
                  <div class="relative">
                    <div class="flex items-center gap-2">
                      <input
                        bind:this={relayInputElement}
                        type="text"
                        bind:value={relaySearchQuery}
                        onfocus={() => {
                          if (relaySearchQuery.trim()) {
                            showRelayAutocomplete = relaySearchResults.length > 0;
                          }
                        }}
                        onblur={(event) => {
                          setTimeout(() => {
                            if (
                              !event.relatedTarget ||
                              !(event.relatedTarget as HTMLElement).closest(
                                "#import-relay-suggestions-listbox"
                              )
                            ) {
                              showRelayAutocomplete = false;
                            }
                          }, 200);
                        }}
                        onkeydown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            appendRelay(relaySearchQuery);
                          }
                        }}
                        autocomplete="off"
                        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Search or enter relay URL"
                      />
                      <button
                        type="button"
                        onclick={addRelay}
                        class="flex items-center gap-2 px-3 py-2 text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <Plus class="w-4 h-4" />
                        Add Relay
                      </button>
                    </div>

                    {#if showRelayAutocomplete && relaySearchResults.length > 0}
                      <div
                        id="import-relay-suggestions-listbox"
                        class="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                      >
                        {#each relaySearchResults as relayUrl}
                          <button
                            type="button"
                            onmousedown={(event) => {
                              event.preventDefault();
                            }}
                            onclick={() => appendRelay(relayUrl)}
                            class="w-full text-left px-3 py-2 hover:bg-gray-700 text-sm font-mono"
                          >
                            {relayUrl}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  <button
                    type="button"
                    onclick={addRelay}
                    class="flex items-center gap-2 text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <Plus class="w-4 h-4" />
                    Add Relay
                  </button>
                {/if}
              </div>
              <p class="mt-1 text-xs text-gray-400">
                Repository metadata will be published to these relays. Selected GRASP targets add
                matching repo relays automatically.
              </p>
            </div>

            <!-- Confirmation Checkboxes -->
            <div class="mb-4">
              <h4 class="text-sm font-medium text-gray-300 mb-2">Import Options</h4>
              <div class="space-y-3 bg-gray-800 rounded-lg p-4 border border-gray-600">
                <!-- Announce Repo (always enabled) -->
                <label class="flex items-start space-x-3 cursor-not-allowed">
                  <input
                    type="checkbox"
                    checked={announceRepo}
                    disabled
                    class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 cursor-not-allowed"
                  />
                  <div class="flex-1">
                    <span class="text-sm text-white">Announce Repo on Nostr</span>
                    <p class="text-xs text-gray-400 mt-0.5">
                      Repository will be announced on Nostr (always enabled)
                    </p>
                  </div>
                </label>

                <!-- Mirror Issues -->
                <label
                  class={`flex items-start space-x-3 ${sourceAccessMode === "anonymous" ? "cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    bind:checked={mirrorIssues}
                    disabled={sourceAccessMode === "anonymous"}
                    class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div class="flex-1">
                    <span class="text-sm text-white flex items-center gap-2">
                      <FileText class="w-4 h-4" />
                      Mirror Issues
                    </span>
                    <p class="text-xs text-gray-400 mt-0.5">
                      {#if sourceAccessMode === "anonymous"}
                        Requires a source token
                      {:else}
                        Import all issues
                      {/if}
                    </p>
                  </div>
                </label>

                <!-- Mirror Pull Requests -->
                <label
                  class={`flex items-start space-x-3 ${sourceAccessMode === "anonymous" ? "cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    bind:checked={mirrorPullRequests}
                    disabled={sourceAccessMode === "anonymous"}
                    class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div class="flex-1">
                    <span class="text-sm text-white flex items-center gap-2">
                      <GitBranch class="w-4 h-4" />
                      Mirror Pull Requests
                    </span>
                    <p class="text-xs text-gray-400 mt-0.5">
                      {#if sourceAccessMode === "anonymous"}
                        Requires a source token
                      {:else}
                        Import all pull requests
                      {/if}
                    </p>
                  </div>
                </label>

                <!-- Mirror Comments -->
                <label
                  class={`flex items-start space-x-3 ${sourceAccessMode === "anonymous" ? "cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    bind:checked={mirrorComments}
                    disabled={sourceAccessMode === "anonymous" ||
                      (!mirrorIssues && !mirrorPullRequests)}
                    class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div class="flex-1">
                    <span class="text-sm text-white flex items-center gap-2">
                      <MessageSquare class="w-4 h-4" />
                      Mirror Comments
                    </span>
                    <p class="text-xs text-gray-400 mt-0.5">
                      {#if sourceAccessMode === "anonymous"}
                        Requires a source token
                      {:else}
                        Import all comments for issues and PRs
                      {/if}
                    </p>
                  </div>
                </label>
              </div>
              <p class="text-xs text-gray-400 mt-3">
                {#if sourceAccessMode === "anonymous"}
                  Anonymous source imports currently mirror repo contents only. Add a source token
                  to import issues, pull requests, comments, and richer metadata.
                {:else}
                  Note: For issues and comments, placeholder Nostr accounts will be created on the
                  fly with matching names of the original authors.
                {/if}
              </p>
            </div>

            {#if validationError}
              <div
                class="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-500 dark:bg-red-900/50"
              >
                <div class="flex items-start space-x-3">
                  <AlertCircle class="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <p class="text-sm text-red-700 dark:text-red-400">{validationError}</p>
                </div>
              </div>
            {/if}

            <!-- Action Buttons -->
            <div class="flex justify-between">
              <button
                type="button"
                onclick={() => (currentStep = 1)}
                disabled={importState.isImporting}
                class="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                type="button"
                onclick={handleStep2Next}
                disabled={!canProceedStep2 || importState.isImporting}
                class="px-6 py-2 bg-blue-600 !text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                SET THIS REPO FREE
              </button>
            </div>
          </div>
        </div>

        <!-- Step 3: Progress -->
      {:else if currentStep === 3}
        <div class="space-y-4">
          <div>
            <h3 class="text-lg font-medium text-white mb-1">Import progress</h3>
            <p class="text-sm text-gray-400 mb-4">
              {#if currentProgress?.isComplete}
                All done. Your repository is ready.
              {:else if currentProgress?.error}
                Something went wrong. You can cancel and try again.
              {:else}
                This may take a few minutes. Don’t close this window.
              {/if}
            </p>

            <!-- Phased stepper -->
            {#if currentProgress}
              <div class="space-y-0 mb-4">
                {#each progressPhases as phase, i}
                  {@const isLast = i === progressPhases.length - 1}
                  <div class="flex gap-3">
                    <!-- Left: icon + connector line -->
                    <div class="flex flex-col items-center flex-shrink-0">
                      <div
                        class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                        class:bg-green-600={phase.status === "completed"}
                        class:bg-blue-600={phase.status === "active" && !currentProgress.error}
                        class:bg-red-600={phase.status === "active" && currentProgress.error}
                        class:bg-gray-600={phase.status === "pending"}
                      >
                        {#if phase.status === "completed"}
                          <CheckCircle2 class="w-4 h-4 text-white" />
                        {:else if phase.status === "active"}
                          {#if currentProgress.error}
                            <AlertCircle class="w-4 h-4 text-white" />
                          {:else}
                            <Loader2 class="w-4 h-4 text-white animate-spin" />
                          {/if}
                        {:else}
                          <span class="text-xs font-medium text-gray-300">{i + 1}</span>
                        {/if}
                      </div>
                      {#if !isLast}
                        <div
                          class="w-0.5 h-6 mt-1 rounded-full transition-colors"
                          class:bg-green-600={phase.status === "completed"}
                          class:bg-gray-600={phase.status !== "completed"}
                        ></div>
                      {/if}
                    </div>
                    <!-- Right: label + detail + progress -->
                    <div class="flex-1 min-w-0 pb-4">
                      <p
                        class={`text-sm font-medium transition-colors ${
                          phase.status === "completed"
                            ? "text-green-700 dark:text-green-400"
                            : phase.status === "active" && !currentProgress.error
                              ? "text-blue-700 dark:text-blue-400"
                              : phase.status === "active" && currentProgress.error
                                ? "text-red-700 dark:text-red-400"
                                : "text-gray-400"
                        }`}
                      >
                        {phase.label}
                      </p>
                      {#if phase.status === "completed" && phase.mirroredCount != null}
                        <p class="text-xs text-green-700/90 dark:text-green-300/90 mt-0.5">
                          {phase.mirroredCount} mirrored
                        </p>
                      {/if}
                      {#if phase.status === "active" && phase.detail}
                        <p class="text-sm text-gray-400 mt-0.5 truncate" title={phase.detail}>
                          {phase.detail}
                        </p>
                        {#if phase.current != null && phase.total != null && phase.total > 0}
                          <div class="mt-2 flex items-center gap-2">
                            <div class="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                class="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style="width: {(phase.total && phase.total >= 1
                                  ? Math.min(100, ((phase.current ?? 0) / phase.total) * 100)
                                  : 0) + '%'}"
                              ></div>
                            </div>
                            <span class="text-xs text-gray-400 tabular-nums"
                              >{phase.current} / {phase.total}</span
                            >
                          </div>
                        {:else if phase.current != null}
                          <p class="text-xs text-gray-400 mt-0.5">{phase.current} so far</p>
                        {/if}
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>

              <!-- Error message (inline with stepper, or banner) -->
              {#if currentProgress.error}
                <div
                  class="rounded-lg border border-red-300 bg-red-50 p-4 mb-4 dark:border-red-500 dark:bg-red-900/50"
                >
                  <div class="flex items-start space-x-3">
                    <AlertCircle class="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <div class="flex-1">
                      <p class="text-sm text-red-800 dark:text-red-400 font-medium">Import failed</p>
                      <p class="text-sm text-red-700 dark:text-red-300 mt-1">{currentProgress.error}</p>
                      {#if workflowScopeIssue}
                        <div class="mt-3 text-xs text-red-700/80 dark:text-red-200/80">
                          {getAccessTokenManagementMessage(currentProgress.error)}
                          <a
                            href="/settings/profile"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="ml-2 inline-flex items-center text-red-700 hover:text-red-800 dark:text-red-200 dark:hover:text-red-100 underline"
                          >
                            Open settings
                          </a>
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
              {:else if currentProgress.isComplete && completedResult}
                <div
                  class="rounded-lg border border-green-300 bg-green-50 p-4 mb-4 dark:border-green-500 dark:bg-green-900/50"
                >
                  <div class="flex items-start space-x-3">
                    <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <div class="flex-1">
                      <p class="text-sm text-green-800 dark:text-green-400 font-medium">Import completed</p>
                      <p class="text-sm text-green-700 dark:text-green-300 mt-1">
                        {completedResult.issuesImported} issues,
                        {completedResult.commentsImported} comments,
                        {completedResult.prsImported} PRs, and {completedResult.profilesCreated} profiles
                        created.
                      </p>
                      {#if completedResult.remotePushResults && completedResult.remotePushResults.length > 0}
                        {@const remoteSuccessCount = completedResult.remotePushResults.filter(
                          (r) => r.success
                        ).length}
                        {@const remoteFailureCount =
                          completedResult.remotePushResults.length - remoteSuccessCount}
                        <p class="text-sm text-green-700 dark:text-green-300 mt-1">
                          Remote sync: {remoteSuccessCount} succeeded{#if remoteFailureCount > 0}, {remoteFailureCount}
                            failed{/if}.
                        </p>
                        {#if remoteFailureCount > 0}
                          <div class="mt-2 space-y-1">
                            {#each completedResult.remotePushResults.filter((r) => !r.success) as failedRemote (failedRemote.id)}
                              <p class="text-xs text-yellow-700 dark:text-yellow-300">
                                {failedRemote.label}: {failedRemote.error || "Push failed"}
                              </p>
                            {/each}
                          </div>
                        {/if}
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/if}

            <!-- Abort Button -->
            {#if currentStep === 3 && currentProgress && !currentProgress.isComplete}
              <div class="flex justify-center pt-2">
                <button
                  type="button"
                  onclick={handleAbort}
                  disabled={isCancelingImport}
                  class="px-4 py-2 bg-red-600 !text-white rounded-lg hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {#if isCancelingImport}
                    <Loader2 class="w-4 h-4 animate-spin" />
                    Canceling...
                  {:else}
                    Cancel import
                  {/if}
                </button>
              </div>
            {/if}

            <!-- Action Buttons (when complete) -->
            {#if isProgressComplete}
              <div class="flex justify-between pt-2 border-t border-gray-700">
                <button
                  type="button"
                  onclick={handleClose}
                  class="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  Close
                </button>
                {#if onNavigateToRepo && completedResult}
                  <button
                    type="button"
                    onclick={() => {
                      if (completedResult) {
                        onNavigateToRepo(completedResult);
                      }
                    }}
                    class="px-4 py-2 bg-blue-600 !text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                  >
                    <ExternalLink class="w-4 h-4" />
                    View repository
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
