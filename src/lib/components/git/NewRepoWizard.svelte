<script lang="ts">
  import RepoDetailsStep from "./RepoDetailsStep.svelte";
  import AdvancedSettingsStep from "./AdvancedSettingsStep.svelte";
  import RepoProgressStep from "./RepoProgressStep.svelte";
  import StepChooseService from "./steps/StepChooseService.svelte";
  import { nip19, type Event as NostrEvent } from "nostr-tools";
  import { useRegistry } from "../../useRegistry";
  import {
    buildGraspRepoUrls,
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
    getMandatoryGraspRelayUrls,
  } from "../../utils/grasp-pipeline.js";
  import {
    useNewRepo,
    type NewRepoResult,
    checkProviderRepoAvailability,
  } from "../../hooks/useNewRepo.svelte";
  import { tokens as tokensStore, type Token } from "../../stores/tokens.js";
  import { graspServersStore } from "../../stores/graspServers.js";
  import { PLATFORM_RELAYS, PLATFORM_URL } from "@app/core/state";
  import { makeGitPath } from "@lib/budabit/routes";
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
    onRepoCreated?: (repoData: NewRepoResult) => void;
    /** Called when user chooses to navigate to the newly created repo (app should goto repo URL) */
    onNavigateToRepo?: (repoData: NewRepoResult) => void;
    onCancel?: () => void;
    onPublishEvent?: (
      event: Omit<NostrEvent, "id" | "sig" | "pubkey" | "created_at">
    ) => Promise<unknown>;
    defaultRelays?: string[];
    userPubkey?: string; // User's nostr pubkey (required for GRASP repos)
    /** Default author name for git commits (from user profile) */
    defaultAuthorName?: string;
    /** Default author email for git commits (nip-05 or npub-based email) */
    defaultAuthorEmail?: string;
    getProfile?: (
      pubkey: string
    ) => Promise<{ name?: string; picture?: string; nip05?: string; display_name?: string } | null>;
    searchProfiles?: (query: string) => Promise<
      Array<{
        pubkey: string;
        name?: string;
        picture?: string;
        nip05?: string;
        display_name?: string;
      }>
    >;
    searchRelays?: (query: string) => Promise<string[]>;
    /** Callback to create NIP-98 auth header for GRASP push (must be called on main thread) */
    createAuthHeader?: (url: string, method?: string) => Promise<string | null>;
    /** Fetch events from specific relays for GRASP state visibility checks */
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
    }) => Promise<NostrEvent[]>;
  }

  const {
    workerApi,
    workerInstance,
    onRepoCreated,
    onNavigateToRepo,
    onCancel,
    onPublishEvent,
    defaultRelays = [],
    userPubkey,
    defaultAuthorName = "",
    defaultAuthorEmail = "",
    getProfile,
    searchProfiles,
    searchRelays,
    createAuthHeader,
    onFetchRelayEvents,
  }: Props = $props();

  console.log("defaultRelays", defaultRelays);

  let createdResult = $state<NewRepoResult | null>(null);

  // Initialize the useNewRepo hook
  const { createRepository, isCreating, progress, error, reset } = useNewRepo({
    workerApi, // Pass the worker API from props
    workerInstance, // Pass the worker instance from props
    createAuthHeader, // Pass the NIP-98 auth header callback for GRASP push
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
    onFetchRelayEvents,
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

  function getEffectiveRepoRelays(): string[] {
    return getEffectiveRepoRelayUrls(
      advancedSettings.relays || [],
      selectedProviders.includes("grasp") ? graspRelayUrls || [] : []
    );
  }

  const mandatoryGraspRelays = $derived.by(() =>
    selectedProviders.includes("grasp") ? getMandatoryGraspRelayUrls(graspRelayUrls || []) : []
  );

  function buildBudabitRepoUrl(name: string): string | undefined {
    if (!userPubkey || typeof window === "undefined") return undefined;
    const platformRelays = [...PLATFORM_RELAYS];
    const routeRelay = platformRelays[0] || defaultRelays[0] || advancedSettings.relays[0];
    if (!routeRelay) return undefined;

    const platformOrigin = (PLATFORM_URL || "").trim().replace(/\/$/, "") || window.location.origin;

    const relays = dedupeStrings([
      ...platformRelays,
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
      return `${platformOrigin}${makeGitPath(routeRelay, naddr)}`;
    } catch {
      return undefined;
    }
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
    const ownerNpub = userPubkey ? nip19.npubEncode(userPubkey) : undefined;
    const providerDefaults = getProviderUrlDefaults(name);

    // 1) webUrls (primary web URL default)
    if (!userEditedWebUrl) {
      const defaultWebUrls = dedupeStrings([
        ownerNpub ? `https://gitworkshop.dev/${ownerNpub}/${name}` : "",
        buildBudabitRepoUrl(name) || "",
        ...providerDefaults.map((entry) => entry.webUrl),
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
      const defaultRelaySet = dedupeStrings([...(defaultRelays || [])]);
      if (!arraysEqual(advancedSettings.relays, defaultRelaySet)) {
        advancedSettings.relays = defaultRelaySet;
      }
    }
  }

  // Step management (1: Choose Service, 2: Repo Details, 3: Advanced, 4: Create)
  let currentStep = $state(1);
  let stepContentContainer: HTMLDivElement | undefined = undefined;

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
      advancedSettings.relays = [...defaultRelays];
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
  async function checkNameAvailability(name: string) {
    if (!name.trim() || selectedProviders.length === 0) {
      nameAvailabilityResults = null;
      return;
    }

    isCheckingAvailability = true;
    try {
      const checks = await Promise.all(
        selectedProviders.map((provider) =>
          checkProviderRepoAvailability(
            provider,
            name,
            tokens,
            provider === "grasp" ? graspRelayUrls[0] : undefined,
            userPubkey
          )
        )
      );

      const merged = {
        results: checks.flatMap((result) => result.results),
        hasConflicts: checks.some((result) => result.hasConflicts),
        availableProviders: dedupeStrings(checks.flatMap((result) => result.availableProviders)),
        conflictProviders: dedupeStrings(checks.flatMap((result) => result.conflictProviders)),
      };

      nameAvailabilityResults = merged;
    } catch (error) {
      console.error("Error checking name availability:", error);
      nameAvailabilityResults = null;
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
  function nextStep() {
    if (currentStep === 1) {
      // Require provider selection (and valid GRASP relay when applicable)
      if (selectedProviders.length > 0 && isValidGraspConfig()) {
        currentStep = 2;
      }
    } else if (currentStep === 2 && validateStep1()) {
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

    const relayCount = getEffectiveRepoRelays().length;
    if (relayCount === 0) return;

    const providerDefaults = getProviderUrlDefaults(repoDetails.name.trim());
    const cloneProviderOrder = getCloneProviderOrder(providerDefaults);

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
        tags: advancedSettings.tags,
        webUrls: advancedSettings.webUrls.filter((v) => v && v.trim()),
        cloneUrls: advancedSettings.cloneUrls.filter((v) => v && v.trim()),
        cloneUrlOrder: cloneProviderOrder,
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
  class="ng-themed-modal bg-background text-foreground rounded-lg border border-border shadow w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
>
  <div class="px-6 pt-6 pb-4 border-b border-border space-y-4">
    <!-- Header -->
    <div class="text-center space-y-2">
      <h1 class="text-3xl font-bold tracking-tight text-foreground">Create a New Repository</h1>
      <p class="text-muted-foreground">Set up a new git repository with Nostr integration</p>
    </div>

    <!-- Progress Indicator -->
    <div class="grid grid-cols-2 gap-4 md:flex md:items-center md:justify-center md:space-x-4">
      <div class="flex items-center space-x-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 1}
          class:text-accent-foreground={currentStep >= 1}
          class:bg-muted={currentStep < 1}
          class:text-muted-foreground={currentStep < 1}
        >
          {currentStep > 1 ? "✓" : "1"}
        </div>
        <span class="text-sm font-medium text-foreground">Choose Service</span>
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex items-center space-x-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 2}
          class:text-accent-foreground={currentStep >= 2}
          class:bg-muted={currentStep < 2}
          class:text-muted-foreground={currentStep < 2}
        >
          {currentStep > 2 ? "✓" : "2"}
        </div>
        <span class="text-sm font-medium text-foreground">Repository Details</span>
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex items-center space-x-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 3}
          class:text-accent-foreground={currentStep >= 3}
          class:bg-muted={currentStep < 3}
          class:text-muted-foreground={currentStep < 3}
        >
          {currentStep > 3 ? "✓" : "3"}
        </div>
        <span class="text-sm font-medium text-foreground">Advanced Settings</span>
      </div>

      <div class="hidden md:block w-12 h-px bg-border"></div>

      <div class="flex items-center space-x-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
          class:bg-accent={currentStep >= 4}
          class:text-accent-foreground={currentStep >= 4}
          class:bg-muted={currentStep < 4}
          class:text-muted-foreground={currentStep < 4}
        >
          {currentStep > 4 ? "✓" : "4"}
        </div>
        <span class="text-sm font-medium text-foreground">Create Repository</span>
      </div>
    </div>
  </div>

  <!-- Step Content -->
  <div bind:this={stepContentContainer} class="flex-1 min-h-0 overflow-y-auto">
    <div class="px-6 pt-6 pb-16">
      {#if currentStep === 1}
        <StepChooseService
          selectedProviders={selectedProviders}
          onProvidersChange={handleProvidersChange as any}
          disabledProviders={nameAvailabilityResults?.conflictProviders || []}
          relayUrls={graspRelayUrls}
          onRelayUrlsChange={handleRelayUrlsChange}
          graspServerOptions={graspServerOptions}
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
          searchRelays={searchRelays}
          onCloneUrlsChange={handleCloneUrlsChange}
        />
      {:else if currentStep === 4}
        <RepoProgressStep
          isCreating={isCreating()}
          progress={progressSteps}
          onRetry={handleRetry}
          onClose={handleClose}
          createdRepoResult={createdRepoResult}
          onNavigateToRepo={onNavigateToRepo}
        />
      {/if}
    </div>
  </div>

  <!-- Navigation Buttons -->
  {#if currentStep < 4}
    <div class="px-6 py-4 border-t border-border bg-background">
      <div class="flex justify-between">
        <Button onclick={onCancel} variant="outline" class="btn btn-secondary">Cancel</Button>

        <div class="flex space-x-3">
          {#if currentStep > 1}
            <Button onclick={prevStep} variant="outline" class="btn btn-secondary">Previous</Button>
          {/if}

          <Button
            onclick={nextStep}
            disabled={(currentStep === 1 &&
              (selectedProviders.length === 0 ||
                (selectedProviders.includes("grasp") && !isValidGraspConfig()))) ||
              (currentStep === 2 && !validateStep1()) ||
              (currentStep === 3 && getEffectiveRepoRelays().length === 0)}
            variant="git"
            class="btn btn-primary"
          >
            {currentStep === 3 ? "Create Repository" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
