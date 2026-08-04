<script lang="ts">
  import RepoDetailsStep from "./RepoDetailsStep.svelte";
  import AdvancedSettingsStep from "./AdvancedSettingsStep.svelte";
  import RepoProgressStep from "./RepoProgressStep.svelte";
  import RepoCommunitySelect from "./RepoCommunitySelect.svelte";
  import type { SubscribeGitProgress } from "../../utils/git-operation-progress.js";
  import StepChooseService from "./steps/StepChooseService.svelte";
  import { nip19, type Event as NostrEvent } from "nostr-tools";
  import { useRegistry } from "../../useRegistry";
  import {
    buildGraspRepoUrls,
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
    getMandatoryGraspRelayUrls,
    type DeleteRepoEvent,
    type PublishRepoEvent,
  } from "../../utils/grasp-pipeline.js";
  import {
    useNewRepo,
    type NewRepoResult,
    checkProviderRepoAvailability,
  } from "../../hooks/useNewRepo.svelte";
  import { tokens as tokensStore, type Token } from "../../stores/tokens.js";
  import { graspServersStore } from "../../stores/graspServers.js";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import type {
    ProfileSearchContext,
    ProfileSearchUpdateSignal,
  } from "../../types/profile-search.js";
  import {
    buildGraspServiceDescriptors,
    formatUnbackedGraspRelayError,
    getUnbackedKnownGraspRelayUrls,
    mergeGraspServiceDescriptors,
    resolveKnownGraspServices,
    type GraspServiceDescriptor,
  } from "../../utils/grasp-service-coupling.js";
  import {
    findRepoCommunityOption,
    getRepoCommunityOptionBinding,
  } from "./repo-community-options.js";
  const { Button } = useRegistry();

  function deriveOrigins(input: string): { wsOrigin: string; httpOrigin: string } {
    try {
      if (!input) return { wsOrigin: "", httpOrigin: "" };
      const normalized = input.trim();
      const prefixed = /^(https?:\/\/|wss?:\/\/)/i.test(normalized)
        ? normalized
        : `https://${normalized}`;
      const url = new URL(prefixed);
      const isSecure = typeof window !== "undefined" && window.location?.protocol === "https:";
      const protocol = url.protocol.replace(":", "");
      const host = url.host;
      const httpScheme = isSecure
        ? "https"
        : protocol === "http" || protocol === "https"
          ? protocol
          : "http";
      const wsScheme = isSecure ? "wss" : protocol.startsWith("ws") ? protocol : "ws";
      return { wsOrigin: `${wsScheme}://${host}`, httpOrigin: `${httpScheme}://${host}` };
    } catch {
      return { wsOrigin: "", httpOrigin: "" };
    }
  }

  interface Props {
    workerApi?: any; // Git worker API instance (optional for backward compatibility)
    workerInstance?: Worker; // Worker instance for event signing
    subscribeGitProgress?: SubscribeGitProgress;
    onRepoCreated?: (repoData: NewRepoResult) => void;
    /** Called when user chooses to navigate to the newly created repo (app should goto repo URL) */
    onNavigateToRepo?: (repoData: NewRepoResult) => void | Promise<void>;
    onCancel?: () => void;
    onDispose?: () => void;
    onPublishEvent?: PublishRepoEvent;
    onDeleteEvent?: DeleteRepoEvent;
    defaultRelays?: string[];
    platformRelays?: string[];
    platformUrl?: string;
    makeRepoPath?: (relayUrl: string, naddr: string) => string;
    userPubkey?: string; // User's nostr pubkey (required for GRASP repos)
    /** Default author name for git commits (from user profile) */
    defaultAuthorName?: string;
    /** Default author email for git commits (nip-05 or npub-based email) */
    defaultAuthorEmail?: string;
    getProfile?: (
      pubkey: string
    ) => Promise<{ name?: string; picture?: string; nip05?: string; display_name?: string } | null>;
    searchProfiles?: (
      query: string,
      context?: ProfileSearchContext
    ) => Promise<
      Array<{
        pubkey: string;
        name?: string;
        picture?: string;
        nip05?: string;
        display_name?: string;
      }>
    >;
    searchProfilesUpdateSignal?: ProfileSearchUpdateSignal;
    searchRelays?: (query: string) => Promise<string[]>;
    communityOptions?: RepoCommunityOption[];
    defaultCommunityPubkey?: string;
    /** Fetch events from specific relays for GRASP state visibility checks */
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
      throwOnTimeout?: boolean;
    }) => Promise<NostrEvent[]>;
  }

  const {
    workerApi,
    workerInstance,
    subscribeGitProgress,
    onRepoCreated,
    onNavigateToRepo,
    onCancel,
    onDispose,
    onPublishEvent,
    onDeleteEvent,
    defaultRelays = [],
    platformRelays = [],
    platformUrl = "",
    makeRepoPath,
    userPubkey,
    defaultAuthorName = "",
    defaultAuthorEmail = "",
    getProfile,
    searchProfiles,
    searchProfilesUpdateSignal,
    searchRelays,
    communityOptions = [],
    defaultCommunityPubkey = "",
    onFetchRelayEvents,
  }: Props = $props();

  console.log("defaultRelays", defaultRelays);

  $effect(() => {
    return () => {
      if (isCreating()) abortCreation("Repository wizard unmounted");
      onDispose?.();
    };
  });

  let createdResult = $state<NewRepoResult | null>(null);

  // Initialize the useNewRepo hook
  const { createRepository, isCreating, progress, error, reset, abortCreation, operationActivity } =
    useNewRepo({
      workerApi, // Pass the worker API from props
      workerInstance, // Pass the worker instance from props
      onProgress: (steps) => {
        // Transform status to completed boolean for RepoProgressStep
        progressSteps = steps.map((step) => ({
          step: step.step,
          message: step.message,
          description: step.message,
          completed: step.status === "completed",
          status: step.status,
        }));
      },
      onRepoCreated: (result) => {
        createdRepoResult = result;
        onRepoCreated?.(result);
      },
      onPublishEvent: onPublishEvent,
      onDeleteEvent,
      onFetchRelayEvents,
      subscribeGitProgress,
      userPubkey, // Pass user pubkey for GRASP repos
    });

  // Store result when repo is created so we can offer "Navigate to repo"
  let createdRepoResult = $state<NewRepoResult | null>(null);

  // Token management
  let tokens = $state<Token[]>([]);
  let selectedProviders = $state<string[]>([]);
  let graspRelayUrls = $state<string[]>([]);
  let userEditedWebUrl = $state(false);
  let userEditedCloneUrl = $state(false);
  let userEditedRelays = $state(false);
  let selectedCommunityPubkey = $state(defaultCommunityPubkey);
  let resolvedGraspServices = $state<GraspServiceDescriptor[]>([]);
  let resolvingGraspServices = $state(false);
  let graspServiceResolutionRunId = 0;

  // Grasp server options sourced from global singleton store
  let graspServerOptions = $state<string[]>([]);
  graspServersStore.subscribe((urls) => {
    graspServerOptions = urls;
  });

  $effect(() => {
    // Pre-populate GRASP relay URLs from the user's saved GRASP relay set
    void selectedProviders;
    void graspServerOptions;
    if (
      selectedProviders.includes("grasp") &&
      graspRelayUrls.length === 0 &&
      graspServerOptions.length > 0
    ) {
      graspRelayUrls = [...graspServerOptions];
      syncGraspRelaysToPreferredRelays(graspServerOptions);
    }
  });

  // Repository name availability tracking
  let nameAvailabilityResults = $state<{
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
  } | null>(null);
  let isCheckingAvailability = $state(false);

  // Subscribe to token store changes
  tokensStore.subscribe((t) => {
    tokens = t;
  });

  // Compute sensible defaults for Advanced Settings
  function providerHost(p?: string): string | undefined {
    if (!p) return undefined;
    const map: Record<string, string> = {
      github: "github.com",
      gitlab: "gitlab.com",
      gitea: "gitea.com",
      bitbucket: "bitbucket.org",
    };
    return map[p] || undefined;
  }

  function dedupeStrings(values: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const trimmed = (value || "").trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  function syncGraspRelaysToPreferredRelays(urls: string[]) {
    if (!selectedProviders.includes("grasp")) return;
    const nextRelays = getEditableRepoRelayUrls(advancedSettings.relays || [], urls || []);

    if (!arraysEqual(advancedSettings.relays, nextRelays)) {
      advancedSettings.relays = nextRelays;
    }
  }

  function getDefaultEditableRepoRelays(urls: string[] = graspRelayUrls): string[] {
    const defaultRelaySet = dedupeStrings([...(defaultRelays || [])]);
    return getEditableRepoRelayUrls(
      defaultRelaySet,
      selectedProviders.includes("grasp") ? urls || [] : []
    );
  }

  function getEffectiveRepoRelays(): string[] {
    return getEffectiveRepoRelayUrls(
      advancedSettings.relays || [],
      selectedProviders.includes("grasp") ? graspRelayUrls || [] : []
    );
  }

  const selectedCommunityGraspServerUrls = $derived.by(
    () => findRepoCommunityOption(communityOptions, selectedCommunityPubkey)?.graspServers || []
  );
  const otherCommunityGraspServerUrls = $derived.by(() =>
    communityOptions
      .filter((option) => option.pubkey !== selectedCommunityPubkey)
      .flatMap((option) => option.graspServers || [])
  );
  const recommendedGraspServerOptions = $derived.by(() =>
    dedupeStrings([
      ...selectedCommunityGraspServerUrls,
      ...graspServerOptions,
      ...otherCommunityGraspServerUrls,
    ])
  );
  const declaredGraspServices = $derived.by(() =>
    mergeGraspServiceDescriptors([
      ...buildGraspServiceDescriptors(selectedCommunityGraspServerUrls, "community-10222"),
      ...buildGraspServiceDescriptors(graspServerOptions, "user-10317"),
      ...buildGraspServiceDescriptors(otherCommunityGraspServerUrls, "community-10222"),
    ])
  );
  const unbackedGraspRelays = $derived.by(() =>
    getUnbackedKnownGraspRelayUrls({
      repoRelayUrls: getEffectiveRepoRelays(),
      backedGraspRelayUrls: selectedProviders.includes("grasp") ? graspRelayUrls : [],
      knownServices: resolvedGraspServices,
    })
  );
  const relayCouplingError = $derived.by(() =>
    resolvingGraspServices
      ? "Checking repository relay capabilities..."
      : unbackedGraspRelays.length > 0
        ? formatUnbackedGraspRelayError(unbackedGraspRelays)
        : ""
  );

  $effect(() => {
    const relayUrls = getEffectiveRepoRelays();
    const knownServices = [...declaredGraspServices];
    const runId = ++graspServiceResolutionRunId;
    resolvingGraspServices = true;
    void resolveKnownGraspServices({ relayUrls, knownServices })
      .then((services) => {
        if (runId !== graspServiceResolutionRunId) return;
        resolvedGraspServices = services;
        resolvingGraspServices = false;
      })
      .catch(() => {
        if (runId !== graspServiceResolutionRunId) return;
        resolvedGraspServices = knownServices;
        resolvingGraspServices = false;
      });
  });

  const mandatoryGraspRelays = $derived.by(() =>
    selectedProviders.includes("grasp") ? getMandatoryGraspRelayUrls(graspRelayUrls || []) : []
  );

  function buildBudabitRepoUrl(name: string): string | undefined {
    if (!userPubkey || !makeRepoPath || typeof window === "undefined") return undefined;
    const configuredPlatformRelays = [...platformRelays];
    const routeRelay =
      configuredPlatformRelays[0] || defaultRelays[0] || advancedSettings.relays[0];
    if (!routeRelay) return undefined;

    const platformOrigin = (platformUrl || "").trim().replace(/\/$/, "") || window.location.origin;

    const relays = dedupeStrings([
      ...configuredPlatformRelays,
      ...getEffectiveRepoRelays(),
      ...defaultRelays,
      routeRelay,
    ]);

    try {
      const naddr = nip19.naddrEncode({
        kind: 30617,
        pubkey: userPubkey,
        identifier: name,
        relays,
      });
      return `${platformOrigin}${makeRepoPath(routeRelay, naddr)}`;
    } catch {
      return undefined;
    }
  }

  function buildGitWorkshopRepoUrl(name: string): string | undefined {
    if (!userPubkey) return undefined;
    return `https://gitworkshop.dev/${nip19.npubEncode(userPubkey)}/${name}`;
  }

  function getProviderResult(provider: string) {
    return (
      nameAvailabilityResults?.results?.find((r) => r.provider === provider) ||
      nameAvailabilityResults?.results?.find((r) => r.host === providerHost(provider))
    );
  }

  function getProviderUrlDefaults(name: string) {
    const entries = selectedProviders.flatMap((provider) => {
      if (provider === "grasp") {
        if (!userPubkey) return [];

        const graspUrls = buildGraspRepoUrls({
          relayUrls: graspRelayUrls || [],
          ownerPubkey: userPubkey,
          repoName: name,
        });

        return graspUrls.cloneUrls.map((cloneUrl, index) => ({
          provider,
          cloneUrl,
          webUrl: graspUrls.webUrls[index] || cloneUrl.replace(/\.git$/, ""),
        }));
      }

      const providerResult = getProviderResult(provider);
      const username = providerResult?.username;
      const host = providerResult?.host || providerHost(provider);
      const webUrl = host && username ? `https://${host}/${username}/${name}` : "";
      const cloneUrl = webUrl ? `${webUrl}.git` : "";
      return [{ provider, webUrl, cloneUrl }];
    });

    return entries;
  }

  function getCloneProviderOrder(entries: Array<{ provider: string; cloneUrl: string }>): string[] {
    const byCloneUrl = new Map<string, string>();
    for (const entry of entries) {
      if (entry.cloneUrl) byCloneUrl.set(entry.cloneUrl, entry.provider);
    }

    const ordered = advancedSettings.cloneUrls
      .map((url) => byCloneUrl.get((url || "").trim()) || "")
      .filter(Boolean);

    return dedupeStrings([...ordered, ...selectedProviders]);
  }

  function updateAdvancedDefaults() {
    const name = repoDetails.name?.trim();
    if (!name) return;
    const providerDefaults = getProviderUrlDefaults(name);

    // 1) webUrls (primary web URL default)
    if (!userEditedWebUrl) {
      const defaultWebUrls = dedupeStrings([
        buildBudabitRepoUrl(name) || "",
        buildGitWorkshopRepoUrl(name) || "",
      ]);
      if (!arraysEqual(advancedSettings.webUrls, defaultWebUrls)) {
        advancedSettings.webUrls = defaultWebUrls;
      }
    }

    // 2) cloneUrls defaults
    if (!userEditedCloneUrl) {
      const defaultCloneUrls = dedupeStrings(providerDefaults.map((entry) => entry.cloneUrl));
      if (!arraysEqual(advancedSettings.cloneUrls, defaultCloneUrls)) {
        advancedSettings.cloneUrls = defaultCloneUrls;
      }
    }

    if (!userEditedRelays) {
      const defaultRelaySet = getDefaultEditableRepoRelays();
      if (!arraysEqual(advancedSettings.relays, defaultRelaySet)) {
        advancedSettings.relays = defaultRelaySet;
      }
    }
  }

  // Step management (1: Choose Service, 2: Repo Details, 3: Advanced, 4: Create)
  let currentStep = $state(1);
  let stepContentContainer = $state<HTMLDivElement | undefined>();

  // Repository details (Step 1)
  let repoDetails = $state({
    name: "",
    description: "",
    initializeWithReadme: true,
  });

  // Advanced settings (Step 2)
  let advancedSettings = $state({
    gitignoreTemplate: "",
    licenseTemplate: "",
    defaultBranch: "master",
    // Author information (populated from user profile via props)
    authorName: defaultAuthorName,
    authorEmail: defaultAuthorEmail,
    // NIP-34 metadata
    maintainers: [] as string[],
    relays: [...defaultRelays] as string[],
    tags: [] as string[],
    webUrls: [] as string[],
    cloneUrls: [] as string[],
  });

  // Populate relays from defaults before the user edits relay list
  $effect(() => {
    if (
      !userEditedRelays &&
      (advancedSettings.relays?.length ?? 0) === 0 &&
      (defaultRelays?.length ?? 0) > 0
    ) {
      advancedSettings.relays = getDefaultEditableRepoRelays();
    }
  });

  // Creation progress (Step 3) - now managed by useNewRepo hook
  let progressSteps = $state<
    {
      step: string;
      message: string;
      completed: boolean;
      error?: string;
    }[]
  >([]);

  // Validation
  interface ValidationErrors {
    name?: string;
    description?: string;
  }

  let validationErrors = $state<ValidationErrors>({});

  // Check repository name availability across all providers
  async function checkNameAvailability(name: string): Promise<typeof nameAvailabilityResults> {
    if (!name.trim() || selectedProviders.length === 0) {
      nameAvailabilityResults = null;
      return null;
    }

    isCheckingAvailability = true;
    try {
      const checks = await Promise.all(
        selectedProviders.flatMap((provider) =>
          provider === "grasp"
            ? graspRelayUrls.map((relayUrl) =>
                checkProviderRepoAvailability(provider, name, tokens, relayUrl, userPubkey)
              )
            : [checkProviderRepoAvailability(provider, name, tokens, undefined, userPubkey)]
        )
      );

      const merged = {
        results: checks.flatMap((result) => result.results),
        hasConflicts: checks.some((result) => result.hasConflicts),
        availableProviders: dedupeStrings(checks.flatMap((result) => result.availableProviders)),
        conflictProviders: dedupeStrings(checks.flatMap((result) => result.conflictProviders)),
      };

      nameAvailabilityResults = merged;
      return merged;
    } catch (error) {
      console.error("Error checking name availability:", error);
      const unavailable = {
        results: selectedProviders.map((provider) => ({
          provider,
          host: providerHost(provider) || "unknown",
          available: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        hasConflicts: true,
        availableProviders: [] as string[],
        conflictProviders: [...selectedProviders],
      };
      nameAvailabilityResults = unavailable;
      return unavailable;
    } finally {
      isCheckingAvailability = false;
    }
  }

  // Debounced name availability check
  let nameCheckTimeout: number | null = null;
  function debouncedNameCheck(name: string) {
    if (nameCheckTimeout) {
      clearTimeout(nameCheckTimeout);
    }
    nameCheckTimeout = setTimeout(() => {
      checkNameAvailability(name);
    }, 500) as any;
  }

  // Validation functions
  function validateRepoName(name: string): string | undefined {
    if (!name.trim()) {
      return "Repository name is required";
    }
    if (name.length < 3) {
      return "Repository name must be at least 3 characters";
    }
    if (name.length > 100) {
      return "Repository name must be 100 characters or less";
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return "Repository name can only contain letters, numbers, dots, hyphens, and underscores";
    }
    return undefined;
  }

  function validateDescription(description: string): string | undefined {
    if (description.length > 350) {
      return "Description must be 350 characters or less";
    }
    return undefined;
  }

  function validateStep1(): boolean {
    const errors: ValidationErrors = {};

    const nameError = validateRepoName(repoDetails.name);
    if (nameError) errors.name = nameError;

    const descError = validateDescription(repoDetails.description);
    if (descError) errors.description = descError;

    return Object.keys(errors).length === 0;
  }

  function updateValidationErrors() {
    const errors: ValidationErrors = {};

    const nameError = validateRepoName(repoDetails.name);
    if (nameError) errors.name = nameError;

    const descError = validateDescription(repoDetails.description);
    if (descError) errors.description = descError;

    validationErrors = errors;
  }

  // Navigation
  function availabilityBlocksCreation(result: typeof nameAvailabilityResults): boolean {
    return (
      !result ||
      result.hasConflicts ||
      result.results.some((item) => !item.available || Boolean(item.error))
    );
  }

  async function nextStep() {
    if (currentStep === 1) {
      // Require provider selection (and valid GRASP relay when applicable)
      if (selectedProviders.length > 0 && isValidGraspConfig()) {
        currentStep = 2;
      }
    } else if (currentStep === 2 && validateStep1()) {
      const availability = await checkNameAvailability(repoDetails.name);
      if (availabilityBlocksCreation(availability)) return;
      currentStep = 3;
    } else if (currentStep === 3) {
      currentStep = 4; // Go to creation progress
      startRepositoryCreation();
    }
  }

  function prevStep() {
    if (currentStep === 2) {
      currentStep = 1;
    } else if (currentStep === 3) {
      currentStep = 2;
    } else if (currentStep === 4 && !isCreating()) {
      currentStep = 3;
    }
  }

  // Provider selection handler
  function handleProvidersChange(providers: string[]) {
    selectedProviders = [...providers];
    if (!selectedProviders.includes("grasp")) {
      try {
        window.dispatchEvent(new Event("nostr-git:clear-relay-override"));
        console.info("Cleared relay override (non-GRASP provider)");
      } catch {}
    }
    // Clear previous availability results when provider changes
    nameAvailabilityResults = null;
    // Reset web/clone URL state so they reflect the new service
    advancedSettings.webUrls = [];
    advancedSettings.cloneUrls = [];
    userEditedRelays = false;
    userEditedWebUrl = false;
    userEditedCloneUrl = false;
    // Auto re-check if a name is already entered
    if (repoDetails.name && repoDetails.name.trim().length > 0) {
      debouncedNameCheck(repoDetails.name);
    }
    // Recompute defaults for advanced settings
    updateAdvancedDefaults();
    syncGraspRelaysToPreferredRelays(graspRelayUrls);
  }

  // GRASP relay URLs handler
  function handleRelayUrlsChange(urls: string[]) {
    graspRelayUrls = urls;
    syncGraspRelaysToPreferredRelays(urls);
    const primary = urls[0] || "";
    const { wsOrigin } = deriveOrigins(primary);
    const relayTarget = wsOrigin || primary;
    if (selectedProviders.includes("grasp") && relayTarget) {
      try {
        window.dispatchEvent(
          new CustomEvent("nostr-git:set-relay-override", { detail: { relays: [relayTarget] } })
        );
        console.info("Relay override set to", relayTarget);
      } catch (err) {
        console.warn("Failed to dispatch relay override event", err);
      }
    }
    if (
      selectedProviders.includes("grasp") &&
      repoDetails.name &&
      repoDetails.name.trim().length > 0
    ) {
      debouncedNameCheck(repoDetails.name);
    }
    updateAdvancedDefaults();
  }

  // Validate relay URL for GRASP provider
  function isValidGraspConfig(): boolean {
    if (!selectedProviders.includes("grasp")) return true;
    const urls = graspRelayUrls || [];
    if (urls.length === 0) return false;
    return urls.every((u) => {
      const v = (u || "").trim();
      return v !== "" && (v.startsWith("wss://") || v.startsWith("ws://"));
    });
  }

  // Repository creation using useNewRepo hook
  async function startRepositoryCreation() {
    if (!validateStep1()) return;

    if (selectedProviders.length === 0) return;

    const availability = await checkNameAvailability(repoDetails.name);
    if (availabilityBlocksCreation(availability)) return;

    const relayCount = getEffectiveRepoRelays().length;
    if (relayCount === 0) return;
    if (relayCouplingError) return;

    const providerDefaults = getProviderUrlDefaults(repoDetails.name.trim());
    const cloneProviderOrder = getCloneProviderOrder(providerDefaults);
    const selectedCommunity = getRepoCommunityOptionBinding(
      findRepoCommunityOption(communityOptions, selectedCommunityPubkey)
    );

    try {
      createdResult = null;
      await createRepository({
        name: repoDetails.name,
        description: repoDetails.description,
        initializeWithReadme: repoDetails.initializeWithReadme,
        gitignoreTemplate: advancedSettings.gitignoreTemplate,
        licenseTemplate: advancedSettings.licenseTemplate,
        defaultBranch: advancedSettings.defaultBranch,
        provider: selectedProviders[0] as string,
        providers: [...selectedProviders],
        relayUrls: selectedProviders.includes("grasp") ? graspRelayUrls : undefined,
        relayUrl: selectedProviders.includes("grasp") ? graspRelayUrls[0] : undefined,
        authorName: advancedSettings.authorName,
        authorEmail: advancedSettings.authorEmail,
        authorPubkey: userPubkey,
        maintainers: advancedSettings.maintainers,
        relays: getEffectiveRepoRelays(),
        knownGraspRelayUrls: resolvedGraspServices.map((service) => service.relayUrl),
        tags: advancedSettings.tags,
        webUrls: advancedSettings.webUrls.filter((v) => v && v.trim()),
        cloneUrls: advancedSettings.cloneUrls.filter((v) => v && v.trim()),
        cloneUrlOrder: cloneProviderOrder,
        community: selectedCommunity,
        webUrl: advancedSettings.webUrls.find((v) => v && v.trim()) || "",
        cloneUrl: advancedSettings.cloneUrls.find((v) => v && v.trim()) || "",
      });
    } catch (error) {
      console.error("Repository creation failed:", error);
    }
  }

  function handleRetry() {
    // Reset progress and try again using the hook
    createdResult = null;
    reset();
    startRepositoryCreation();
  }

  function handleClose() {
    if (isCreating()) abortCreation("User cancelled repository creation");
    if (onCancel) {
      onCancel();
    }
  }

  function handleViewRepo() {
    if (createdResult && onNavigateToRepo) {
      onNavigateToRepo(createdResult);
    }
  }

  // Step component event handlers
  function handleRepoNameChange(name: string) {
    repoDetails.name = name;
    // Trigger debounced availability check
    debouncedNameCheck(name);
    // Update validation errors after change
    updateValidationErrors();
    // Recompute defaults for advanced settings
    updateAdvancedDefaults();
  }

  function handleDescriptionChange(description: string) {
    repoDetails.description = description;
    // Update validation errors after change
    updateValidationErrors();
  }

  function handleReadmeChange(initialize: boolean) {
    repoDetails.initializeWithReadme = initialize;
  }

  function handleGitignoreChange(template: string) {
    advancedSettings.gitignoreTemplate = template;
  }

  function handleLicenseChange(template: string) {
    advancedSettings.licenseTemplate = template;
  }

  function handleDefaultBranchChange(branch: string) {
    advancedSettings.defaultBranch = branch;
  }

  // Author information handlers
  function handleAuthorNameChange(name: string) {
    advancedSettings.authorName = name;
  }

  function handleAuthorEmailChange(email: string) {
    advancedSettings.authorEmail = email;
  }

  // NIP-34 metadata handlers
  function handleMaintainersChange(maintainers: string[]) {
    advancedSettings.maintainers = maintainers;
  }

  function handleRelaysChange(relays: string[]) {
    advancedSettings.relays = getEditableRepoRelayUrls(
      relays,
      selectedProviders.includes("grasp") ? graspRelayUrls || [] : []
    );
    userEditedRelays = true;
  }

  function handleTagsChange(tags: string[]) {
    advancedSettings.tags = tags;
  }

  function handleWebUrlsChange(urls: string[]) {
    advancedSettings.webUrls = urls;
    userEditedWebUrl = true;
  }

  function handleCloneUrlsChange(urls: string[]) {
    advancedSettings.cloneUrls = urls;
    userEditedCloneUrl = true;
  }

  // When availability results arrive (e.g., we learned the username), try to fill defaults
  $effect(() => {
    void nameAvailabilityResults;
    void selectedProviders;
    void graspRelayUrls;
    void repoDetails.name;
    void advancedSettings.relays;
    updateAdvancedDefaults();
  });

  $effect(() => {
    return () => {
      try {
        window.dispatchEvent(new Event("nostr-git:clear-relay-override"));
        console.info("Relay override cleared on wizard unmount");
      } catch {}
    };
  });

  // Scroll to top when step changes
  $effect(() => {
    void currentStep; // Track currentStep changes
    if (stepContentContainer) {
      stepContentContainer.scrollTop = 0;
    }
  });
</script>

<div
  class="ng-themed-modal bg-card text-card-foreground mx-auto flex h-[calc(100dvh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border shadow sm:h-auto sm:max-h-[calc(100dvh-4rem)] lg:max-w-5xl xl:max-w-6xl"
>
  <div class="shrink-0 space-y-4 border-b border-border px-4 pb-4 pt-4 sm:px-6 sm:pt-6">
    <!-- Header -->
    <div class="text-center space-y-2">
      <h1 class="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        Create a New Repository
      </h1>
      <p class="break-words text-sm text-muted-foreground sm:text-base">
        Set up a new git repository with Nostr integration
      </p>
    </div>

    <!-- Progress Indicator -->
    <div
      class="grid grid-cols-2 gap-2 sm:gap-4 md:flex md:items-center md:justify-center md:space-x-4"
    >
      <div class="flex min-w-0 items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 1}
          class:text-accent-foreground={currentStep >= 1}
          class:bg-muted={currentStep < 1}
          class:text-muted-foreground={currentStep < 1}
        >
          {currentStep > 1 ? "✓" : "1"}
        </div>
        <span class="min-w-0 break-words text-xs font-medium text-foreground sm:text-sm"
          >Choose Service</span
        >
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex min-w-0 items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 2}
          class:text-accent-foreground={currentStep >= 2}
          class:bg-muted={currentStep < 2}
          class:text-muted-foreground={currentStep < 2}
        >
          {currentStep > 2 ? "✓" : "2"}
        </div>
        <span class="min-w-0 break-words text-xs font-medium text-foreground sm:text-sm"
          >Repository Details</span
        >
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex min-w-0 items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 3}
          class:text-accent-foreground={currentStep >= 3}
          class:bg-muted={currentStep < 3}
          class:text-muted-foreground={currentStep < 3}
        >
          {currentStep > 3 ? "✓" : "3"}
        </div>
        <span class="min-w-0 break-words text-xs font-medium text-foreground sm:text-sm"
          >Advanced Settings</span
        >
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex min-w-0 items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 4}
          class:text-accent-foreground={currentStep >= 4}
          class:bg-muted={currentStep < 4}
          class:text-muted-foreground={currentStep < 4}
        >
          {currentStep > 4 ? "✓" : "4"}
        </div>
        <span class="min-w-0 break-words text-xs font-medium text-foreground sm:text-sm"
          >Create Repository</span
        >
      </div>
    </div>
  </div>

  {#if currentStep === 4}
    <RepoProgressStep
      isCreating={isCreating()}
      progress={progressSteps}
      onRetry={handleRetry}
      onClose={handleClose}
      createdRepoResult={createdRepoResult}
      onNavigateToRepo={onNavigateToRepo}
      operationActivity={operationActivity()}
      modalLayout={true}
    />
  {:else}
    <!-- Step Content -->
    <div
      bind:this={stepContentContainer}
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere]"
    >
      <div class="px-4 pb-12 pt-5 sm:px-6 sm:pb-16 sm:pt-6">
        {#if currentStep === 1}
          <StepChooseService
            selectedProviders={selectedProviders}
            onProvidersChange={handleProvidersChange as any}
            disabledProviders={nameAvailabilityResults?.conflictProviders || []}
            relayUrls={graspRelayUrls}
            onRelayUrlsChange={handleRelayUrlsChange}
            graspServerOptions={recommendedGraspServerOptions}
          />
        {:else if currentStep === 2}
          <RepoDetailsStep
            repoName={repoDetails.name}
            description={repoDetails.description}
            initializeWithReadme={repoDetails.initializeWithReadme}
            defaultBranch={advancedSettings.defaultBranch}
            gitignoreTemplate={advancedSettings.gitignoreTemplate}
            licenseTemplate={advancedSettings.licenseTemplate}
            onRepoNameChange={handleRepoNameChange}
            onDescriptionChange={handleDescriptionChange}
            onReadmeChange={handleReadmeChange}
            onDefaultBranchChange={handleDefaultBranchChange}
            onGitignoreChange={handleGitignoreChange}
            onLicenseChange={handleLicenseChange}
            validationErrors={validationErrors}
            nameAvailabilityResults={nameAvailabilityResults}
            isCheckingAvailability={isCheckingAvailability}
          />
        {:else if currentStep === 3}
          <AdvancedSettingsStep
            gitignoreTemplate={advancedSettings.gitignoreTemplate}
            licenseTemplate={advancedSettings.licenseTemplate}
            defaultBranch={advancedSettings.defaultBranch}
            authorName={advancedSettings.authorName}
            authorEmail={advancedSettings.authorEmail}
            maintainers={advancedSettings.maintainers}
            relays={advancedSettings.relays}
            mandatoryRelays={mandatoryGraspRelays}
            relayError={relayCouplingError}
            tags={advancedSettings.tags}
            webUrls={advancedSettings.webUrls}
            cloneUrls={advancedSettings.cloneUrls}
            onGitignoreChange={handleGitignoreChange}
            onLicenseChange={handleLicenseChange}
            onDefaultBranchChange={handleDefaultBranchChange}
            onAuthorNameChange={handleAuthorNameChange}
            onAuthorEmailChange={handleAuthorEmailChange}
            onMaintainersChange={handleMaintainersChange}
            onRelaysChange={handleRelaysChange}
            onTagsChange={handleTagsChange}
            onWebUrlsChange={handleWebUrlsChange}
            getProfile={getProfile}
            searchProfiles={searchProfiles}
            searchProfilesUpdateSignal={searchProfilesUpdateSignal}
            communityPubkey={selectedCommunityPubkey}
            searchRelays={searchRelays}
            onCloneUrlsChange={handleCloneUrlsChange}
          />
          <div class="mt-6">
            <RepoCommunitySelect
              options={communityOptions}
              bind:value={selectedCommunityPubkey}
              label="Repository community"
              description="Optionally bind this repository to one community as part of its identity."
            />
          </div>
        {/if}
      </div>
    </div>

    <!-- Navigation Buttons -->
    <div class="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-6">
      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          onclick={onCancel}
          variant="outline"
          class="w-full border-border bg-card text-foreground hover:bg-muted hover:text-foreground sm:w-auto"
          >Cancel</Button
        >

        <div class="flex flex-col-reverse gap-3 sm:flex-row">
          {#if currentStep > 1}
            <Button
              onclick={prevStep}
              variant="outline"
              class="w-full border-border bg-card text-foreground hover:bg-muted hover:text-foreground sm:w-auto"
              >Previous</Button
            >
          {/if}

          <Button
            onclick={nextStep}
            disabled={(currentStep === 1 &&
              (selectedProviders.length === 0 ||
                (selectedProviders.includes("grasp") && !isValidGraspConfig()))) ||
              (currentStep === 2 &&
                (!validateStep1() ||
                  isCheckingAvailability ||
                  availabilityBlocksCreation(nameAvailabilityResults))) ||
              (currentStep === 3 &&
                (getEffectiveRepoRelays().length === 0 ||
                  Boolean(relayCouplingError) ||
                  isCheckingAvailability ||
                  availabilityBlocksCreation(nameAvailabilityResults)))}
            variant="git"
            class="w-full sm:w-auto"
          >
            {currentStep === 3 ? "Create Repository" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
