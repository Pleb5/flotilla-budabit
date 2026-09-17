<script lang="ts">
  import RepoDetailsStep from "./RepoDetailsStep.svelte";
  import RepoTypeStep from "./RepoTypeStep.svelte";
  import { onDestroy } from "svelte";
  import type { PublicRepoSource } from "@nostr-git/core/git";
  import { usePublicRepo, type PublicRepoResult } from "../../hooks/usePublicRepo.svelte.js";
  import {
    newRepoTargets,
    newRepoTargetHost,
    validGraspSelection,
  } from "../../utils/new-repo-targets.js";
  import { preflightRemoteTargets } from "../../utils/remote-targets.js";
  import {
    suggestRepoIdentifier,
    validateRepoIdentifier,
    validateRepoDisplayName,
  } from "@nostr-git/core/utils";
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
  import { useNewRepo, type NewRepoResult } from "../../hooks/useNewRepo.svelte";
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
    getRepoCommunityOptionKey,
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
    assertActor?: () => void;
    workerApi?: any; // Git worker API instance (optional for backward compatibility)
    workerInstance?: Worker; // Worker instance for event signing
    subscribeGitProgress?: SubscribeGitProgress;
    onRepoCreated?: (repoData: NewRepoResult | PublicRepoResult) => void;
    /** Called when user chooses to navigate to the newly created repo (app should goto repo URL) */
    onNavigateToRepo?: (repoData: NewRepoResult | PublicRepoResult) => void | Promise<void>;
    onCancel?: () => void;
    onDispose?: () => void;
    onPublishEvent?: PublishRepoEvent;
    onDeleteEvent?: DeleteRepoEvent;
    defaultRelays?: string[];
    platformRelays?: string[];
    platformUrl?: string;
    makeRepoPath?: (relayUrl: string, naddr: string) => string;
    userPubkey?: string; // User's nostr pubkey (required for GRASP repos)
    getKnownRepoEvents?: (
      owner: string,
      identifier: string
    ) => Array<Pick<NostrEvent, "kind" | "pubkey" | "tags">>;
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
    /** Fetch events from specific relays for GRASP state visibility checks */
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
      throwOnTimeout?: boolean;
    }) => Promise<NostrEvent[]>;
  }

  const {
    assertActor,
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
    getKnownRepoEvents,
    getProfile,
    searchProfiles,
    searchProfilesUpdateSignal,
    searchRelays,
    communityOptions = [],
    onFetchRelayEvents,
  }: Props = $props();

  console.log("defaultRelays", defaultRelays);

  $effect(() => {
    return () => {
      if (isCreating()) abortCreation("Repository wizard unmounted");
      publicRepo.abort();
      onDispose?.();
    };
  });

  let createdResult = $state<NewRepoResult | PublicRepoResult | null>(null);
  let closed = false;
  let repoType = $state<"new" | "import" | null>(null);
  let importAction = $state<"announce" | "copy">("announce");
  let sourceUrl = $state("");
  let source = $state<PublicRepoSource | null>(null);
  const importing = $derived(repoType === "import");
  const needsTargets = $derived(!importing || importAction === "copy");
  const edited = new Set<string>();
  const publicRepo = usePublicRepo({
    workerApi,
    workerInstance,
    userPubkey,
    onPublishEvent,
    onDeleteEvent,
    onFetchRelayEvents,
    getKnownRepoEvents,
    subscribeGitProgress,
    assertActor,
    onProgress: (steps) => {
      progressSteps = steps.map((step) => ({
        ...step,
        step: step.step === "fork" ? "copy" : step.step,
        completed: step.status === "completed",
      }));
    },
  });

  function acceptSource(value: PublicRepoSource) {
    source = value;
    if (value.empty) importAction = "announce";
    if (!edited.has("displayName")) repoDetails.displayName = value.displayName;
    if (!identifierEdited) repoDetails.name = suggestRepoIdentifier(value.name);
    if (!edited.has("description")) repoDetails.description = value.description;
    advancedSettings.defaultBranch = value.defaultBranch;
    if (!edited.has("tags")) advancedSettings.tags = value.topics;
    if (!userEditedWebUrl) advancedSettings.webUrls = [value.url];
    if (!userEditedCloneUrl) advancedSettings.cloneUrls = [value.cloneUrl];
    updateValidationErrors();
    debouncedNameCheck(repoDetails.name);
  }

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
      getKnownRepoEvents,
      subscribeGitProgress,
      userPubkey, // Pass user pubkey for GRASP repos
    });

  // Store result when repo is created so we can offer "Navigate to repo"
  let createdRepoResult = $state<NewRepoResult | PublicRepoResult | null>(null);

  // Token management
  let tokens = $state<Token[]>([]);
  let selectedProviders = $state<string[]>([]);
  let graspRelayUrls = $state<string[]>([]);
  const selectedTargets = $derived(
    needsTargets ? newRepoTargets(selectedProviders, graspRelayUrls, tokens) : []
  );
  const graspSelected = $derived(needsTargets && selectedProviders.includes("grasp"));
  let userEditedWebUrl = $state(false);
  let userEditedCloneUrl = $state(false);
  let userEditedRelays = $state(false);
  let selectedCommunityPubkey = $state("");
  let resolvedGraspServices = $state<GraspServiceDescriptor[]>([]);
  let resolvingGraspServices = $state(false);
  let graspServiceResolutionRunId = 0;

  // Grasp server options sourced from global singleton store
  let graspServerOptions = $state<string[]>([]);
  const unsubscribeGrasp = graspServersStore.subscribe((urls) => {
    graspServerOptions = urls;
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
  const unsubscribeTokens = tokensStore.subscribe((t) => {
    tokens = t;
  });
  onDestroy(() => {
    closed = true;
    unsubscribeGrasp();
    unsubscribeTokens();
    nameCheckRun++;
    graspServiceResolutionRunId++;
    if (nameCheckTimeout) clearTimeout(nameCheckTimeout);
  });

  // Compute sensible defaults for Advanced Settings
  function providerHost(p?: string): string | undefined {
    return p ? newRepoTargetHost(p) || undefined : undefined;
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
    if (!graspSelected) return;
    const nextRelays = getEditableRepoRelayUrls(advancedSettings.relays || [], urls || []);

    if (!arraysEqual(advancedSettings.relays, nextRelays)) {
      advancedSettings.relays = nextRelays;
    }
  }

  function getDefaultEditableRepoRelays(urls: string[] = graspRelayUrls): string[] {
    const defaultRelaySet = dedupeStrings([...(defaultRelays || [])]);
    return getEditableRepoRelayUrls(defaultRelaySet, graspSelected ? urls || [] : []);
  }

  function getEffectiveRepoRelays(): string[] {
    return getEffectiveRepoRelayUrls(
      advancedSettings.relays || [],
      graspSelected ? graspRelayUrls || [] : []
    );
  }

  const selectedCommunityGraspServerUrls = $derived.by(
    () => findRepoCommunityOption(communityOptions, selectedCommunityPubkey)?.graspServers || []
  );
  const otherCommunityGraspServerUrls = $derived.by(() =>
    communityOptions
      .filter((option) => getRepoCommunityOptionKey(option) !== selectedCommunityPubkey)
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
      ...buildGraspServiceDescriptors(selectedCommunityGraspServerUrls, "community-definition"),
      ...buildGraspServiceDescriptors(graspServerOptions, "user-10317"),
      ...buildGraspServiceDescriptors(otherCommunityGraspServerUrls, "community-definition"),
    ])
  );
  const unbackedGraspRelays = $derived.by(() =>
    getUnbackedKnownGraspRelayUrls({
      repoRelayUrls: getEffectiveRepoRelays(),
      backedGraspRelayUrls: graspSelected ? graspRelayUrls : [],
      knownServices: resolvedGraspServices,
    })
  );
  const relayCouplingError = $derived.by(() =>
    importing && importAction === "announce"
      ? ""
      : resolvingGraspServices
        ? "Checking repository relay capabilities..."
        : unbackedGraspRelays.length > 0
          ? formatUnbackedGraspRelayError(unbackedGraspRelays)
          : ""
  );
  const relaySelectionError = $derived.by(() =>
    getEffectiveRepoRelays().length === 0
      ? "Select at least one repository or GRASP relay before creating the repository."
      : relayCouplingError
  );

  $effect(() => {
    const relayUrls = getEffectiveRepoRelays();
    const knownServices = [...declaredGraspServices];
    const runId = ++graspServiceResolutionRunId;
    if (importing && importAction === "announce") {
      resolvingGraspServices = false;
      resolvedGraspServices = knownServices;
      return;
    }
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
    graspSelected ? getMandatoryGraspRelayUrls(graspRelayUrls || []) : []
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
    if (importing) return;
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
  let currentStep = $state(0);
  let stepContentContainer = $state<HTMLDivElement | undefined>();

  // Repository details (Step 1)
  let repoDetails = $state({
    displayName: "",
    name: "",
    description: "",
    initializeWithReadme: true,
  });

  let identifierEdited = $state(false);

  // Advanced settings (Step 2)
  let advancedSettings = $state({
    gitignoreTemplate: "",
    licenseTemplate: "",
    defaultBranch: "master",
    // Author information must be entered explicitly.
    authorName: "",
    authorEmail: "",
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
    displayName?: string;
    description?: string;
  }

  let validationErrors = $state<ValidationErrors>({});

  // Check repository name availability across all providers
  let nameCheckRun = 0;
  async function checkNameAvailability(name: string): Promise<typeof nameAvailabilityResults> {
    const run = ++nameCheckRun;
    if (validateRepoIdentifier(name) || !needsTargets || selectedProviders.length === 0) {
      nameAvailabilityResults = null;
      isCheckingAvailability = false;
      return null;
    }

    isCheckingAvailability = true;
    try {
      const checked = await preflightRemoteTargets({
        targets: selectedTargets.map((target) => ({ ...target, status: "checking" as const })),
        tokenList: tokens,
        userPubkey: userPubkey || "",
        repoName: name,
        options: { allowExistingRepoReuse: false },
      });
      const merged = {
        results: checked.map((target) => ({
          provider: target.provider,
          host: target.host || target.relayUrl || "",
          username: target.username,
          available: target.status === "ready",
          reason: target.detail,
          error: target.status === "ready" ? undefined : target.detail,
        })),
        hasConflicts: checked.some((target) => target.existsAlready),
        availableProviders: checked
          .filter((target) => target.status === "ready")
          .map((target) => target.provider),
        conflictProviders: checked
          .filter((target) => target.existsAlready)
          .map((target) => target.provider),
      };

      if (run !== nameCheckRun || name !== repoDetails.name) return null;
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
        hasConflicts: false,
        availableProviders: [] as string[],
        conflictProviders: [] as string[],
      };
      if (run !== nameCheckRun || name !== repoDetails.name) return null;
      nameAvailabilityResults = unavailable;
      return unavailable;
    } finally {
      if (run === nameCheckRun) isCheckingAvailability = false;
    }
  }

  // Debounced name availability check
  let nameCheckTimeout: number | null = null;
  function debouncedNameCheck(name: string) {
    nameCheckRun++;
    nameAvailabilityResults = null;
    isCheckingAvailability = false;
    if (nameCheckTimeout) {
      clearTimeout(nameCheckTimeout);
    }
    nameCheckTimeout = setTimeout(() => {
      checkNameAvailability(name);
    }, 500) as any;
  }

  // Validation functions
  function validateRepoName(name: string): string | undefined {
    return validateRepoIdentifier(name);
  }

  function validateDescription(description: string): string | undefined {
    if (description.length > 350) {
      return "Description must be 350 characters or less";
    }
    return undefined;
  }

  function validateStep1(): boolean {
    const errors: ValidationErrors = {};
    const displayNameError = validateRepoDisplayName(repoDetails.displayName);
    if (displayNameError) errors.displayName = displayNameError;

    const nameError = validateRepoName(repoDetails.name);
    if (nameError) errors.name = nameError;

    const descError = validateDescription(repoDetails.description);
    if (descError) errors.description = descError;

    return Object.keys(errors).length === 0;
  }

  function updateValidationErrors() {
    const errors: ValidationErrors = {};
    const displayNameError = validateRepoDisplayName(repoDetails.displayName);
    if (displayNameError) errors.displayName = displayNameError;

    const nameError = validateRepoName(repoDetails.name);
    if (nameError) errors.name = nameError;

    const descError = validateDescription(repoDetails.description);
    if (descError) errors.description = descError;

    validationErrors = errors;
  }

  // Navigation
  function changeImportAction(value: "announce" | "copy") {
    importAction = value;
    debouncedNameCheck(repoDetails.name);
  }
  function availabilityBlocksCreation(result: typeof nameAvailabilityResults): boolean {
    if (!needsTargets) return false;
    return (
      !result ||
      result.hasConflicts ||
      result.results.some((item) => !item.available || Boolean(item.error))
    );
  }

  async function nextStep() {
    if (currentStep === 0) {
      if (repoType && (!importing || source)) currentStep = 1;
    } else if (currentStep === 1) {
      // Require provider selection (and valid GRASP relay when applicable)
      if (!needsTargets || (selectedProviders.length > 0 && isValidGraspConfig())) {
        currentStep = 2;
        if (needsTargets && repoDetails.name) debouncedNameCheck(repoDetails.name);
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
    if (currentStep === 1) currentStep = 0;
    else if (currentStep === 2) {
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
    // Preserve user edits; untouched new-repo defaults are recomputed below.
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
    return validGraspSelection(graspSelected, graspRelayUrls);
  }

  // Repository creation using useNewRepo hook
  let preflightError = $state("");
  let isPreflighting = $state(false);
  async function startRepositoryCreation() {
    if (isPreflighting) return;
    preflightError = "";
    isPreflighting = true;
    let editStep = 3;
    let executionStarted = false;
    progressSteps = [
      { step: "preflight", message: "Checking repository availability…", completed: false },
    ];
    try {
      assertActor?.();
      editStep = 2;
      if (!validateStep1()) throw new Error("Review the repository details before continuing");

      editStep = 1;
      if (needsTargets && (selectedProviders.length === 0 || !isValidGraspConfig()))
        throw new Error("Select valid target remotes before continuing");

      const availability = await checkNameAvailability(repoDetails.name);
      if (closed) return;
      editStep = 3;
      assertActor?.();
      editStep = 2;
      if (availabilityBlocksCreation(availability))
        throw new Error("Destination availability changed. Review target errors before continuing");

      editStep = 3;
      const relayCount = getEffectiveRepoRelays().length;
      if (relayCount === 0 || relaySelectionError)
        throw new Error(relaySelectionError || "Select a metadata relay");

      const providerDefaults = getProviderUrlDefaults(repoDetails.name.trim());
      const cloneProviderOrder = getCloneProviderOrder(providerDefaults);
      const selectedCommunity = getRepoCommunityOptionBinding(
        findRepoCommunityOption(communityOptions, selectedCommunityPubkey)
      );

      createdResult = null;
      executionStarted = true;
      isPreflighting = false;
      if (importing && source) {
        progressSteps = [
          { step: "source", message: "Rechecking the public repository…", completed: false },
        ];
        const result = await publicRepo.createRepository({
          source,
          mode: importAction,
          forkName: repoDetails.name,
          displayName: repoDetails.displayName,
          description: repoDetails.description,
          targets: selectedTargets,
          relays: getEffectiveRepoRelays(),
          tags: advancedSettings.tags,
          webUrls: advancedSettings.webUrls,
          maintainers: advancedSettings.maintainers,
          community: selectedCommunity,
          knownGraspServices: resolvedGraspServices,
        });
        createdRepoResult = result;
        if (result) {
          progressSteps = [
            {
              step: "complete",
              message:
                importAction === "announce"
                  ? "Repository announced on Nostr. No Git copies were made."
                  : publicRepo.warning || "Independent copies and Nostr metadata verified.",
              completed: true,
            },
          ];
          onRepoCreated?.(result);
        } else
          progressSteps = [
            ...progressSteps,
            {
              step: "error",
              message: publicRepo.error || "Repository operation failed",
              error: publicRepo.error || "Repository operation failed",
              completed: false,
            },
          ];
        return;
      }
      await createRepository({
        name: repoDetails.name,
        displayName: repoDetails.displayName.trim(),
        description: repoDetails.description,
        initializeWithReadme: repoDetails.initializeWithReadme,
        gitignoreTemplate: advancedSettings.gitignoreTemplate,
        licenseTemplate: advancedSettings.licenseTemplate,
        defaultBranch: advancedSettings.defaultBranch,
        provider: selectedTargets[0]?.provider || "grasp",
        providers: [...new Set(selectedTargets.map((target) => target.provider))],
        targets: selectedTargets,
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
      if (closed) return;
      const message = error instanceof Error ? error.message : String(error);
      if (!executionStarted) {
        preflightError = message;
        currentStep = editStep;
        progressSteps = [];
      } else {
        progressSteps = [
          ...progressSteps,
          { step: "error", message, error: message, completed: false },
        ];
      }
    } finally {
      isPreflighting = false;
    }
  }

  function handleRetry() {
    // Reset progress and try again using the hook
    createdResult = null;
    reset();
    startRepositoryCreation();
  }

  function handleClose() {
    closed = true;
    publicRepo.abort();
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
  function handleDisplayNameChange(name: string) {
    edited.add("displayName");
    repoDetails.displayName = name;
    if (!identifierEdited) {
      repoDetails.name = suggestRepoIdentifier(name);
      debouncedNameCheck(repoDetails.name);
      updateAdvancedDefaults();
    }
    updateValidationErrors();
  }

  function handleRepoNameChange(name: string) {
    identifierEdited = true;
    repoDetails.name = name;
    // Trigger debounced availability check
    debouncedNameCheck(name);
    // Update validation errors after change
    updateValidationErrors();
    // Recompute defaults for advanced settings
    updateAdvancedDefaults();
  }

  function handleDescriptionChange(description: string) {
    edited.add("description");
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
    edited.add("tags");
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
  <div class="shrink-0 border-b border-border px-4 pb-4 pt-4 sm:px-6 sm:pt-6">
    <!-- Header -->
    <div class="text-center space-y-2">
      <h1 class="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {currentStep === 0
          ? "New Repository"
          : importing
            ? "Import an existing Repo"
            : "Create a New Repository"}
      </h1>
      <p class="break-words text-sm text-muted-foreground sm:text-base">
        {importing
          ? "Public source reads are anonymous. Issues, pull requests and comments are not imported."
          : "Set up a git repository with Nostr integration"}
      </p>
    </div>
  </div>

  {#if currentStep === 4}
    <RepoProgressStep
      isCreating={isPreflighting || isCreating() || publicRepo.isCreating}
      progress={progressSteps}
      onRetry={importing ? undefined : handleRetry}
      onClose={handleClose}
      createdRepoResult={createdRepoResult}
      onNavigateToRepo={onNavigateToRepo}
      operationActivity={importing ? publicRepo.operationActivity : operationActivity()}
      announcementOnly={importing && importAction === "announce"}
      modalLayout={true}
    />
  {:else}
    <!-- Step Content -->
    <div
      bind:this={stepContentContainer}
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere]"
    >
      <div class="px-4 pb-12 pt-5 sm:px-6 sm:pb-16 sm:pt-6">
        {#if preflightError}
          <p role="alert" class="mb-4 rounded border border-destructive p-3 text-destructive">
            {preflightError}
          </p>
        {/if}
        {#if currentStep === 0}
          <RepoTypeStep
            mode={repoType}
            sourceUrl={sourceUrl}
            source={source}
            onModeChange={(mode) => {
              repoType = mode;
              nameAvailabilityResults = null;
              if (mode === "import" && source) acceptSource(source);
            }}
            onUrlChange={(value) => {
              sourceUrl = value;
              source = null;
            }}
            onSource={acceptSource}
          />
        {:else if currentStep === 1}
          {#if importing}
            <fieldset class="mb-5 space-y-3 rounded border border-border p-4">
              <legend class="px-1 font-semibold">Choose target remotes</legend>
              <label class="flex items-center gap-3"
                ><input
                  type="radio"
                  name="import-action"
                  checked={importAction === "announce"}
                  onchange={() => changeImportAction("announce")}
                /> Announce only</label
              >
              <p class="text-sm text-muted-foreground">
                Publish the existing public source URLs on Nostr. No Git copy, destination token or
                source ownership claim.
              </p>
              <label class="flex items-center gap-3"
                ><input
                  type="radio"
                  name="import-action"
                  checked={importAction === "copy"}
                  onchange={() => changeImportAction("copy")}
                  disabled={source?.empty}
                /> Copy to target remotes</label
              >
              <p class="text-sm text-muted-foreground">
                Copy all branches and tags once. Synchronization remains manual; no native forge
                fork is created.
              </p>
              {#if source?.empty}<p class="text-sm text-muted-foreground">
                  This source is empty; use Announce only.
                </p>{/if}
            </fieldset>
          {/if}
          {#if needsTargets}
            <StepChooseService
              importing={importing}
              selectedProviders={selectedProviders}
              onProvidersChange={handleProvidersChange as any}
              disabledProviders={nameAvailabilityResults?.conflictProviders || []}
              relayUrls={graspRelayUrls}
              onRelayUrlsChange={handleRelayUrlsChange}
              graspServerOptions={recommendedGraspServerOptions}
            />
          {/if}
        {:else if currentStep === 2}
          <RepoDetailsStep
            importing={importing}
            repoName={repoDetails.name}
            displayName={repoDetails.displayName}
            onDisplayNameChange={handleDisplayNameChange}
            ownerPubkey={userPubkey}
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
            importing={importing}
            gitignoreTemplate={advancedSettings.gitignoreTemplate}
            licenseTemplate={advancedSettings.licenseTemplate}
            defaultBranch={advancedSettings.defaultBranch}
            authorName={advancedSettings.authorName}
            authorEmail={advancedSettings.authorEmail}
            maintainers={advancedSettings.maintainers}
            relays={advancedSettings.relays}
            mandatoryRelays={mandatoryGraspRelays}
            relayError={relaySelectionError}
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
          {#if importing && source}
            <section class="mt-6 space-y-2 rounded border border-border p-4">
              <h3 class="font-semibold">
                Review {importAction === "announce" ? "announcement" : "independent copies"}
              </h3>
              <p class="break-all text-sm">Source: {source.url}</p>
              <p class="text-sm">
                {importAction === "announce"
                  ? "Announce the existing public source URLs; no Git writes."
                  : `Create independent copies on: ${selectedTargets.map((target) => target.label).join(", ")}. Only verified destinations will be announced.`}
              </p>
              <p class="text-sm text-muted-foreground">
                Issues, pull requests and comments are not imported. Existing authorship and files
                are preserved. Copies are limited to 100 branches/tags, a 50 MiB reported source
                estimate and 64 MiB per Git HTTP body. Larger repositories can still be announced.
              </p>
              <p class="text-sm text-muted-foreground">
                Publication is public and may remain after cancellation. If interrupted, use saved
                repository recovery rather than starting again.
              </p>
            </section>
          {/if}
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
          {#if currentStep > 0}
            <Button
              onclick={prevStep}
              variant="outline"
              class="w-full border-border bg-card text-foreground hover:bg-muted hover:text-foreground sm:w-auto"
              >Previous</Button
            >
          {/if}

          <Button
            onclick={nextStep}
            disabled={(currentStep === 0 && (!repoType || (importing && !source))) ||
              (currentStep === 1 &&
                needsTargets &&
                (selectedProviders.length === 0 ||
                  (selectedProviders.includes("grasp") && !isValidGraspConfig()))) ||
              (currentStep === 2 &&
                (!validateStep1() ||
                  isCheckingAvailability ||
                  availabilityBlocksCreation(nameAvailabilityResults))) ||
              (currentStep === 3 &&
                ((!importing &&
                  (!advancedSettings.authorName.trim() || !advancedSettings.authorEmail.trim())) ||
                  getEffectiveRepoRelays().length === 0 ||
                  Boolean(relaySelectionError) ||
                  isCheckingAvailability ||
                  availabilityBlocksCreation(nameAvailabilityResults)))}
            variant="git"
            class="w-full sm:w-auto"
          >
            {currentStep === 3
              ? importing
                ? importAction === "announce"
                  ? "Announce Repository"
                  : "Copy and Announce Repository"
                : "Create Repository"
              : "Next"}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
