<script lang="ts">
  import { tick } from "svelte";
  import {
    X,
    GitFork,
    AlertCircle,
    CheckCircle2,
    Info,
    Loader2,
    ChevronDown,
    ExternalLink,
    GitCommit,
    Hash,
    Globe,
    Users,
    Plus,
    Trash2,
  } from "@lucide/svelte";
  import { nip19 } from "nostr-tools";
  import { Repo } from "./Repo.svelte";
  import { useRegistry } from "../../useRegistry";
  import { isSameLogicalRepoAugmentation, useForkRepo } from "../../hooks/useForkRepo.svelte";
  import { deriveForkProgressPhases } from "./fork-progress";
  import { tokens } from "$lib/stores/tokens";
  import { PeoplePicker } from "@nostr-git/ui";
  import { commonHashtags } from "../../stores/hashtags";
  import { normalizeGraspServerUrls } from "../../stores/graspServers.js";
  import type { NostrEvent } from "@nostr-git/core";
  import type { Token } from "$lib/stores/tokens";
  import type { ForkResult, ForkConfig } from "../../hooks/useForkRepo.svelte";
  import { toast } from "../../stores/toast";
  import RepoCommunitySelect from "./RepoCommunitySelect.svelte";
  import GitOperationActivity from "./GitOperationActivity.svelte";
  import type { SubscribeGitProgress } from "../../utils/git-operation-progress.js";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import type {
    ProfileSearchContext,
    ProfileSearchUpdateSignal,
  } from "../../types/profile-search.js";
  import {
    findRepoCommunityOption,
    getRepoCommunityOptionBinding,
  } from "./repo-community-options.js";
  import {
    DEFAULT_BRANCH_COPY_FILTER_TOOLTIP,
    deriveBranchCopyFilterState,
    type BranchCopyFilterConfig,
  } from "./fork-branch-filter";
  import {
    buildRemoteTargetOptions,
    getAdvertisedRemoteTargetIds,
    normalizeRelayUrl,
    preflightRemoteTargets,
    reconcileRemoteTargetSelection,
    toRemoteTargetSelection,
    type RemoteTargetOption,
  } from "../../utils/remote-targets.js";
  import {
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
    reconcileSelectedGraspRelays,
    type DeleteRepoEvent,
    type PublishRepoEvent,
  } from "../../utils/grasp-pipeline.js";
  import {
    buildGraspServiceDescriptors,
    formatUnbackedGraspRelayError,
    getGraspRelayUrlsBackedByCloneUrls,
    getUnbackedKnownGraspRelayUrls,
    mergeGraspServiceDescriptors,
    resolveKnownGraspServices,
    type GraspServiceDescriptor,
  } from "../../utils/grasp-service-coupling.js";
  import {
    ACCESS_TOKEN_SETTINGS_PATH,
    getAccessTokenManagementMessage,
    isAccessTokenManagementIssue,
  } from "../../utils/tokenManagement.js";

  interface Props {
    repo: Repo;
    pubkey: string;
    branchCopyFilter?: BranchCopyFilterConfig;
    workerApi?: any;
    workerInstance?: Worker;
    subscribeGitProgress?: SubscribeGitProgress;
    onPublishEvent: PublishRepoEvent;
    onDeleteEvent?: DeleteRepoEvent;
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
      throwOnTimeout?: boolean;
    }) => Promise<NostrEvent[]>;
    onRollbackPublishedRepoEvents?: (params: {
      repoName: string;
      relays: string[];
      events?: NostrEvent[];
    }) => Promise<void>;
    onClose?: () => void;
    graspServerUrls?: string[];
    useForkRepoImpl?: (
      options?: Parameters<typeof useForkRepo>[0]
    ) => ReturnType<typeof useForkRepo>;
    navigateToForkedRepo?: (result: ForkResult) => void | Promise<void>;
    onOperationComplete?: () => void;
    defaultRelays?: string[];
    sourceCloneUrls?: string[];
    defaultMaintainers?: string[];
    communityOptions?: RepoCommunityOption[];
    defaultCommunityPubkey?: string;
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
  }

  const {
    repo,
    pubkey,
    branchCopyFilter,
    workerApi,
    workerInstance,
    subscribeGitProgress,
    onPublishEvent,
    onDeleteEvent,
    onFetchRelayEvents,
    onRollbackPublishedRepoEvents,
    onClose,
    graspServerUrls = [],
    useForkRepoImpl,
    navigateToForkedRepo,
    onOperationComplete,
    defaultRelays = [],
    sourceCloneUrls = [],
    defaultMaintainers = [],
    communityOptions = [],
    defaultCommunityPubkey = "",
    getProfile,
    searchProfiles,
    searchProfilesUpdateSignal,
    searchRelays,
  }: Props = $props();

  const forkImpl = $derived(useForkRepoImpl ?? useForkRepo);
  const { Markdown } = useRegistry();

  let completedResult = $state<ForkResult | null>(null);
  let showDetails = $state(false);
  let dialogEl = $state<HTMLDivElement | null>(null);
  let initialFocusEl = $state<HTMLInputElement | null>(null);
  let shouldCloseAfterAbort = $state(false);
  let isCancelingFork = $state(false);
  let isNavigatingToRepo = $state(false);
  let closeNotified = false;
  let selectedCommunityPubkey = $state(defaultCommunityPubkey);

  function searchMaintainerProfiles(query: string) {
    if (!searchProfiles) return Promise.resolve([]);
    return searchProfiles(query, {
      communityPubkey: selectedCommunityPubkey || undefined,
    });
  }

  const forkOptions = $derived.by(() => {
    const baseOptions = {
      userPubkey: pubkey,
      workerApi,
      workerInstance,
      onForkCompleted: (result: ForkResult) => {
        completedResult = result;
        const failedTargets = result.remotePushResults.filter((item) => !item.success);
        const successfulTargets = result.remotePushResults.filter((item) => item.success);

        toast.push({
          message:
            failedTargets.length > 0
              ? `Repository synced to ${successfulTargets.length}/${result.remotePushResults.length} targets`
              : "Repository forked successfully!",
          variant: failedTargets.length > 0 ? "warning" : "default",
        });
        onOperationComplete?.();
      },
      onPublishEvent,
      onDeleteEvent,
      onFetchRelayEvents,
      subscribeGitProgress,
    };

    if (onRollbackPublishedRepoEvents) {
      return { ...baseOptions, onRollbackPublishedRepoEvents };
    }

    return baseOptions;
  });

  function notifyClose() {
    if (closeNotified) return;
    closeNotified = true;
    onClose?.();
  }

  const forkState = $derived(forkImpl(forkOptions));
  const progress = $derived(forkState.progress);
  const progressPhases = $derived.by(() => deriveForkProgressPhases(progress || []));
  const error = $derived(forkState.error);
  const warning = $derived(forkState.warning);
  const forkTokenIssue = $derived(Boolean(error && isAccessTokenManagementIssue(error)));
  const isForking = $derived(forkState.isForking);
  const isProgressComplete = $derived(Boolean(forkState.isComplete));
  const currentProgressMessage = $derived.by(() => {
    if (!progress || progress.length === 0) return "";
    const runningStep = [...progress].reverse().find((step) => step.status === "running");
    if (runningStep) return runningStep.message;
    const lastStep = progress[progress.length - 1];
    return lastStep?.message || "";
  });

  function parseCloneUrl(url: string): { hostname: string; owner: string; name: string } {
    try {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        const owner = pathParts[pathParts.length - 2];
        const name = pathParts[pathParts.length - 1].replace(/\.git$/, "");
        return { hostname: parsedUrl.hostname, owner, name };
      }
    } catch {
      // try SSH form below
    }

    const sshMatch = url.match(/git@([^:]+):([^/]+)\/([^/.]+)(?:\.git)?/);
    if (sshMatch) {
      return {
        hostname: sshMatch[1],
        owner: sshMatch[2],
        name: sshMatch[3],
      };
    }

    const genericMatch = url.match(/(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/([^/.]+)(?:\.git)?/);
    if (genericMatch) {
      return {
        hostname: genericMatch[1],
        owner: genericMatch[2],
        name: genericMatch[3],
      };
    }

    return { hostname: "unknown", owner: "unknown", name: "repository" };
  }

  function toDisplayOwner(owner: string): string {
    if (!owner) return owner;
    if (owner.startsWith("npub1")) return owner;
    if (/^[0-9a-f]{64}$/i.test(owner)) {
      try {
        return nip19.npubEncode(owner.toLowerCase());
      } catch {
        return owner;
      }
    }
    return owner;
  }

  function splitRepoDisplay(value: string, fallbackOwner: string, fallbackName: string) {
    const trimmed = (value || "").trim();
    const fallback = { owner: fallbackOwner, name: fallbackName };

    if (!trimmed) return fallback;

    const colonIndex = trimmed.lastIndexOf(":");
    if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
      return {
        owner: toDisplayOwner(trimmed.slice(0, colonIndex)),
        name: trimmed.slice(colonIndex + 1),
      };
    }

    const slashIndex = trimmed.indexOf("/");
    if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
      return {
        owner: toDisplayOwner(trimmed.slice(0, slashIndex)),
        name: trimmed.slice(slashIndex + 1),
      };
    }

    return fallback;
  }

  const cloneUrl = $derived(
    (sourceCloneUrls.length > 0 ? sourceCloneUrls : repo.clone || []).find((url) => {
      const trimmed = String(url || "").trim();
      return trimmed && !trimmed.startsWith("nostr://") && !trimmed.startsWith("nostr:");
    }) || ""
  );
  const parsedUrl = $derived(parseCloneUrl(cloneUrl));
  const sourceIdentifier = $derived.by(
    () =>
      repo.repoEvent?.tags.find((tag) => tag[0] === "d")?.[1] || parsedUrl.name || repo.name || ""
  );
  const originalRepo = $derived({
    owner: parsedUrl.owner,
    name: sourceIdentifier,
    displayName: repo.name || sourceIdentifier,
    description: repo.description || "",
    cloneUrls: sourceCloneUrls.length > 0 ? sourceCloneUrls : repo.clone || [],
    webUrls: repo.web || [],
    sourceAnnouncementEvent: repo.repoEvent,
    defaultBranch: repo.selectedBranch || repo.mainBranch || "main",
    community: repo.community,
    earliestUniqueCommit: repo.earliestUniqueCommit || "",
  });
  const ownerDisplayOwner = $derived.by(() => toDisplayOwner(originalRepo.owner));
  const ownerDisplayName = $derived.by(() => originalRepo.name || "repository");
  const ownerDisplay = $derived.by(() => `${ownerDisplayOwner}/${ownerDisplayName}`);
  const ownerIsNostr = $derived.by(() =>
    /^(nostr:)?(npub|nprofile)1/i.test(ownerDisplayOwner || "")
  );
  const currentUserDisplayOwner = $derived.by(() => toDisplayOwner(pubkey || ""));
  const forkDisplayParts = $derived.by(() =>
    splitRepoDisplay(
      completedResult?.repoId || "",
      currentUserDisplayOwner || ownerDisplayOwner,
      forkName || ownerDisplayName
    )
  );
  const forkOwnerDisplayOwner = $derived.by(() => forkDisplayParts.owner);
  const forkOwnerDisplayName = $derived.by(() => forkDisplayParts.name);
  const forkOwnerDisplay = $derived.by(() => {
    return `${forkOwnerDisplayOwner}/${forkOwnerDisplayName}`;
  });
  const forkOwnerIsNostr = $derived.by(() =>
    /^(nostr:)?(npub|nprofile)1/i.test(forkOwnerDisplayOwner || "")
  );
  const branchCopyFilterState = $derived.by(() =>
    deriveBranchCopyFilterState({
      branchNames: (repo?.branches || []).map((branch) => branch?.name || ""),
      branchCopyFilter,
    })
  );
  const branchCopyFilterTooltip = $derived.by(
    () => branchCopyFilter?.tooltip || DEFAULT_BRANCH_COPY_FILTER_TOOLTIP
  );

  let isOpen = $state(true);
  let tokenList = $state<Token[]>([]);
  tokens.subscribe((value: Token[]) => {
    tokenList = value;
  });

  let forkName = $state("");
  let validationError = $state<string | undefined>();
  let resolvedGraspServices = $state<GraspServiceDescriptor[]>([]);
  let resolvingGraspServices = $state(false);
  let graspServiceResolutionRunId = 0;
  const isAugmentingExistingRepo = $derived.by(() =>
    isSameLogicalRepoAugmentation({
      sourceAnnouncementEvent: originalRepo.sourceAnnouncementEvent,
      destinationName: forkName,
      userPubkey: pubkey,
    })
  );

  function validateForkName(name: string): string | undefined {
    if (!name.trim()) return "Fork name is required";
    if (name.length < 1 || name.length > 100) {
      return "Fork name must be between 1 and 100 characters";
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return "Fork name can only contain letters, numbers, dots, hyphens, and underscores";
    }
    return undefined;
  }

  $effect(() => {
    validationError = validateForkName(forkName);
  });

  let formSeedKey = $state("");
  $effect(() => {
    const currentSeedKey = `${parsedUrl.hostname}/${originalRepo.owner}/${originalRepo.name}`;
    if (currentSeedKey !== formSeedKey) {
      formSeedKey = currentSeedKey;
      forkName = originalRepo.name;
      graspTargetRelayUrls = [""];
      initializedGraspTargetRelayUrls = false;
      selectedForkTargetIds = [];
      userChangedTargetSelection = false;
      parkedTargetRelayUrls = [];
      explicitlyRemovedPreferredRelayUrls = [];
    }
  });

  let graspServerUrlsLocal = $state<string[]>([]);
  let graspTargetRelayUrls = $state<string[]>([]);
  let newGraspRelayUrl = $state("");
  let initializedGraspTargetRelayUrls = $state(false);

  $effect(() => {
    const incoming = Array.from(
      new Set((graspServerUrls || []).map(normalizeRelayUrl).filter(Boolean))
    );

    const changed =
      incoming.length !== graspServerUrlsLocal.length ||
      incoming.some((value, index) => value !== graspServerUrlsLocal[index]);
    if (changed) {
      graspServerUrlsLocal = incoming;
    }

    if (!initializedGraspTargetRelayUrls && incoming.length > 0) {
      graspTargetRelayUrls = [...incoming];
      initializedGraspTargetRelayUrls = true;
    }
  });

  const knownGraspServers = $derived.by(() => {
    const selectedRelayUrls = new Set(graspTargetRelayUrls.map(normalizeRelayUrl).filter(Boolean));
    const selectedCommunity = findRepoCommunityOption(communityOptions, selectedCommunityPubkey);
    const communityGraspServerUrls = [
      ...(selectedCommunity?.graspServers || []),
      ...communityOptions
        .filter((option) => option.pubkey !== selectedCommunity?.pubkey)
        .flatMap((option) => option.graspServers || []),
    ];

    return normalizeGraspServerUrls([
      ...(selectedCommunity?.graspServers || []),
      ...graspServerUrlsLocal,
      ...communityGraspServerUrls.filter(
        (url) => !(selectedCommunity?.graspServers || []).includes(url)
      ),
    ])
      .map(normalizeRelayUrl)
      .filter((url) => Boolean(url) && !selectedRelayUrls.has(url));
  });

  function upsertGraspRelay(url: string) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized) return;
    initializedGraspTargetRelayUrls = true;
    if (graspTargetRelayUrls.every((value) => !normalizeRelayUrl(value))) {
      graspTargetRelayUrls = [normalized];
      if (!graspServerUrlsLocal.includes(normalized)) {
        graspServerUrlsLocal = [...graspServerUrlsLocal, normalized];
      }
      return;
    }
    if (!graspTargetRelayUrls.includes(normalized)) {
      graspTargetRelayUrls = [...graspTargetRelayUrls, normalized];
    }
    if (!graspServerUrlsLocal.includes(normalized)) {
      graspServerUrlsLocal = [...graspServerUrlsLocal, normalized];
    }
  }

  function removeGraspRelay(index: number) {
    initializedGraspTargetRelayUrls = true;
    const nextRelayUrls = graspTargetRelayUrls.filter((_, i) => i !== index);
    graspTargetRelayUrls = nextRelayUrls.length > 0 ? nextRelayUrls : [""];
  }

  function updateGraspRelay(index: number, value: string) {
    initializedGraspTargetRelayUrls = true;
    graspTargetRelayUrls = graspTargetRelayUrls.map((existingValue, valueIndex) =>
      valueIndex === index ? normalizeRelayUrl(value) : existingValue
    );
  }

  function commitNewGraspRelay() {
    if (!newGraspRelayUrl.trim()) return;
    upsertGraspRelay(newGraspRelayUrl);
    newGraspRelayUrl = "";
  }

  type ForkTargetStatus = RemoteTargetOption["status"];

  let forkTargets = $state<RemoteTargetOption[]>([]);
  let selectedForkTargetIds = $state<string[]>([]);
  let userChangedTargetSelection = $state(false);
  let targetPreflightRunId = 0;

  const targetPreflightPending = $derived.by(
    () => forkTargets.length > 0 && forkTargets.some((target) => target.status === "checking")
  );
  const selectedForkTargets = $derived.by(() =>
    forkTargets
      .filter((target) => selectedForkTargetIds.includes(target.id) && target.status === "ready")
      .map(toRemoteTargetSelection)
  );
  const selectedGraspRelayUrls = $derived.by(() =>
    forkTargets
      .filter(
        (target) =>
          selectedForkTargetIds.includes(target.id) &&
          target.status === "ready" &&
          target.provider === "grasp"
      )
      .map((target) => normalizeRelayUrl(target.relayUrl || ""))
      .filter(Boolean)
  );

  const advertisedForkTargetIds = $derived.by(() =>
    isAugmentingExistingRepo
      ? getAdvertisedRemoteTargetIds({
          targets: forkTargets,
          cloneUrls: originalRepo.cloneUrls || [],
          ownerPubkey: originalRepo.sourceAnnouncementEvent?.pubkey || "",
          identifier: sourceIdentifier,
        })
      : []
  );

  function isAdvertisedForkTarget(target: RemoteTargetOption): boolean {
    return advertisedForkTargetIds.includes(target.id);
  }

  function isSelectedForkTarget(target: RemoteTargetOption): boolean {
    return selectedForkTargetIds.includes(target.id);
  }

  $effect(() => {
    const next = reconcileSelectedGraspRelays({
      editableRelayUrls: preferredRelays,
      parkedTargetRelayUrls,
      selectedGraspRelayUrls,
      preservedRelayUrls: isAugmentingExistingRepo ? defaultRelays : [],
      explicitlyRemovedRelayUrls: explicitlyRemovedPreferredRelayUrls,
    });

    if (
      next.editableRelayUrls.length !== preferredRelays.length ||
      next.editableRelayUrls.some((value, index) => value !== preferredRelays[index])
    ) {
      preferredRelays = next.editableRelayUrls;
    }
    if (
      next.parkedTargetRelayUrls.length !== parkedTargetRelayUrls.length ||
      next.parkedTargetRelayUrls.some((value, index) => value !== parkedTargetRelayUrls[index])
    ) {
      parkedTargetRelayUrls = next.parkedTargetRelayUrls;
    }
  });

  function targetStatusLabel(target: RemoteTargetOption): string {
    if (target.status === "ready" && isAdvertisedForkTarget(target)) {
      return isSelectedForkTarget(target) ? "Advertised (sync)" : "Advertised (preserved)";
    }
    if (target.status === "ready" && target.existsAlready) {
      return isSelectedForkTarget(target) ? "Existing (add)" : "Existing (available)";
    }
    if (target.status === "ready") {
      return isSelectedForkTarget(target) ? "Ready (add)" : "Ready (available)";
    }
    if (target.status === "checking") return "Checking";
    if (target.status === "failed" && target.existsAlready) return "Exists";
    if (target.status === "no-token") return "No token";
    if (target.status === "unsupported") return "Unsupported";
    return "Failed";
  }

  function targetDetail(target: RemoteTargetOption): string {
    if (target.status === "ready" && isAdvertisedForkTarget(target)) {
      return isSelectedForkTarget(target)
        ? "Already in the repository announcement; selected for synchronization."
        : "Already in the repository announcement and preserved without synchronization.";
    }
    if (target.status === "ready" && !isSelectedForkTarget(target)) {
      return target.existsAlready
        ? "Existing destination available; select it to synchronize and advertise."
        : "Available destination; select it to add as a repository remote.";
    }
    return target.detail || "";
  }

  function targetStatusTone(target: RemoteTargetOption): string {
    if (target.status === "ready") return "text-green-700 dark:text-green-400";
    if (target.status === "checking") return "text-gray-400";
    if (target.status === "no-token" || target.status === "unsupported") {
      return "text-yellow-700 dark:text-yellow-400";
    }
    return "text-red-700 dark:text-red-400";
  }

  function handleForkTargetSelectionChange() {
    userChangedTargetSelection = true;
  }

  function selectAllReadyTargets() {
    selectedForkTargetIds = forkTargets
      .filter((target) => target.status === "ready")
      .map((target) => target.id);
    userChangedTargetSelection = true;
  }

  function clearSelectedTargets() {
    selectedForkTargetIds = [];
    userChangedTargetSelection = true;
  }

  $effect(() => {
    const currentRun = ++targetPreflightRunId;
    const seeds = buildRemoteTargetOptions({ tokenList, graspRelayUrls: graspTargetRelayUrls });
    const nameError = validateForkName(forkName);

    if (nameError) {
      selectedForkTargetIds = [];
      forkTargets = seeds.map((target) =>
        target.status === "unsupported"
          ? target
          : { ...target, status: "failed" as ForkTargetStatus, detail: nameError }
      );
      return;
    }

    forkTargets = seeds;
    if (!forkName.trim()) return;

    Promise.resolve(
      preflightRemoteTargets({
        targets: seeds,
        tokenList,
        userPubkey: pubkey,
        repoName: forkName.trim(),
        options: {
          allowExistingRepoReuse: isAugmentingExistingRepo,
          existingRepoMessage:
            "Destination already exists. A renamed fork requires a new destination.",
        },
      })
    ).then((nextTargets) => {
      if (currentRun !== targetPreflightRunId) return;

      forkTargets = nextTargets;
      selectedForkTargetIds = reconcileRemoteTargetSelection({
        targets: nextTargets,
        selectedIds: selectedForkTargetIds,
        userChangedSelection: userChangedTargetSelection,
      });
    });
  });

  let earliestUniqueCommit = $state(repo.earliestUniqueCommit || "");
  let useBranchCopyFilter = $state(false);
  let availableCommits = $state<Array<any>>([]);
  let loadingCommits = $state(false);
  let commitSearchQuery = $state("");
  let showCommitDropdown = $state(false);
  let commitInputFocused = $state(false);

  $effect(() => {
    if (branchCopyFilterState.mode !== "toggle" && useBranchCopyFilter) {
      useBranchCopyFilter = false;
    }
  });

  $effect(() => {
    if (!repo) return;
    const targetBranch = repo.selectedBranch || repo.mainBranch || "";
    const existingCommits = repo.commits;
    if (existingCommits && existingCommits.length > 0) {
      availableCommits = existingCommits;
      loadingCommits = false;
      return;
    }

    loadingCommits = true;
    repo
      .getCommitHistory({ depth: 100, branch: targetBranch || undefined })
      .then((result) => {
        const commits = Array.isArray(result)
          ? result
          : Array.isArray(result?.commits)
            ? result.commits
            : [];
        availableCommits = commits.length > 0 ? commits : repo.commits || [];
        loadingCommits = false;
      })
      .catch(() => {
        availableCommits = repo.commits || [];
        loadingCommits = false;
      });
  });

  $effect(() => {
    if (commitInputFocused && availableCommits.length > 0 && !loadingCommits) {
      showCommitDropdown = true;
    }
  });

  const filteredCommits = $derived.by(() => {
    if (!commitSearchQuery) return availableCommits.slice(0, 20);
    const query = commitSearchQuery.toLowerCase();
    return availableCommits
      .filter((commit) => {
        const oid = commit.oid || "";
        const message = commit.message || commit.commit?.message || "";
        const author = commit.author || commit.commit?.author?.name || "";
        return (
          oid.toLowerCase().includes(query) ||
          message.toLowerCase().includes(query) ||
          author.toLowerCase().includes(query)
        );
      })
      .slice(0, 20);
  });

  let tags = $state<string[]>([]);
  let maintainers = $state<string[]>([]);
  let preferredRelays = $state<string[]>([]);
  let parkedTargetRelayUrls = $state<string[]>([]);
  let explicitlyRemovedPreferredRelayUrls = $state<string[]>([]);
  let relaysInitialized = $state(false);
  let tagsInitialized = $state(false);
  let maintainersInitialized = $state(false);

  $effect(() => {
    if (!relaysInitialized && preferredRelays.length === 0 && defaultRelays.length > 0) {
      preferredRelays = [...defaultRelays];
      relaysInitialized = true;
    }
  });

  $effect(() => {
    if (tagsInitialized || !repo?.repoEvent) return;
    const repoTags = (repo?.hashtags || []).filter(Boolean);
    if (tags.length === 0 && repoTags.length > 0) {
      tags = [...repoTags];
    }
    tagsInitialized = true;
  });

  $effect(() => {
    if (maintainersInitialized || !repo?.repoEvent) return;
    const repoMaintainers = defaultMaintainers.filter(Boolean);
    if (maintainers.length === 0 && repoMaintainers.length > 0) {
      maintainers = [...repoMaintainers];
    }
    maintainersInitialized = true;
  });

  const effectivePreferredRelays = $derived.by(() => {
    return getEffectiveRepoRelayUrls(preferredRelays, selectedGraspRelayUrls);
  });
  const declaredGraspServices = $derived.by(() =>
    mergeGraspServiceDescriptors([
      ...buildGraspServiceDescriptors(
        findRepoCommunityOption(communityOptions, selectedCommunityPubkey)?.graspServers || [],
        "community-10222"
      ),
      ...buildGraspServiceDescriptors(graspServerUrlsLocal, "user-10317"),
      ...buildGraspServiceDescriptors(
        communityOptions
          .filter((option) => option.pubkey !== selectedCommunityPubkey)
          .flatMap((option) => option.graspServers || []),
        "community-10222"
      ),
    ])
  );
  const advertisedGraspRelayUrls = $derived.by(() =>
    isAugmentingExistingRepo && originalRepo.sourceAnnouncementEvent
      ? getGraspRelayUrlsBackedByCloneUrls({
          repoRelayUrls: effectivePreferredRelays,
          cloneUrls: originalRepo.sourceAnnouncementEvent.tags
            .filter((tag) => tag[0] === "clone")
            .flatMap((tag) => tag.slice(1)),
          knownServices: resolvedGraspServices,
          ownerPubkey: originalRepo.sourceAnnouncementEvent.pubkey,
          identifier: sourceIdentifier,
        })
      : []
  );
  const unbackedGraspRelayUrls = $derived.by(() =>
    getUnbackedKnownGraspRelayUrls({
      repoRelayUrls: effectivePreferredRelays,
      backedGraspRelayUrls: [...selectedGraspRelayUrls, ...advertisedGraspRelayUrls],
      knownServices: resolvedGraspServices,
    })
  );
  const graspRelayCouplingError = $derived.by(() =>
    resolvingGraspServices
      ? "Checking repository relay capabilities..."
      : unbackedGraspRelayUrls.length > 0
        ? formatUnbackedGraspRelayError(unbackedGraspRelayUrls)
        : ""
  );

  $effect(() => {
    const relayUrls = [...effectivePreferredRelays];
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

  let relaySearchQuery = $state("");
  let relaySearchResults = $state<string[]>([]);
  let showRelayAutocomplete = $state(false);
  let relayInputElement: HTMLInputElement | undefined = $state();
  let relaySearchTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const query = relaySearchQuery.trim();
    if (relaySearchTimeout) clearTimeout(relaySearchTimeout);

    if (query && searchRelays) {
      relaySearchTimeout = setTimeout(async () => {
        try {
          const results = await searchRelays(query);
          relaySearchResults = results.filter((relay) => !effectivePreferredRelays.includes(relay));
          showRelayAutocomplete = relaySearchResults.length > 0;
        } catch {
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

  function addItem(arr: string[]): string[] {
    return [...(arr || []), ""];
  }
  function removeItem(arr: string[], index: number): string[] {
    return (arr || []).filter((_, i) => i !== index);
  }
  function updateItem(arr: string[], index: number, value: string): string[] {
    return (arr || []).map((item, i) => (i === index ? value : item));
  }

  function removePreferredRelay(index: number): void {
    const relayUrl = normalizeRelayUrl(preferredRelays[index] || "");
    if (relayUrl && !explicitlyRemovedPreferredRelayUrls.includes(relayUrl)) {
      explicitlyRemovedPreferredRelayUrls = [...explicitlyRemovedPreferredRelayUrls, relayUrl];
    }
    preferredRelays = removeItem(preferredRelays, index);
  }

  function updatePreferredRelay(index: number, value: string): void {
    const previousRelayUrl = normalizeRelayUrl(preferredRelays[index] || "");
    const nextRelayUrl = normalizeRelayUrl(value);
    if (
      previousRelayUrl &&
      previousRelayUrl !== nextRelayUrl &&
      !explicitlyRemovedPreferredRelayUrls.includes(previousRelayUrl)
    ) {
      explicitlyRemovedPreferredRelayUrls = [
        ...explicitlyRemovedPreferredRelayUrls,
        previousRelayUrl,
      ];
    }
    if (nextRelayUrl) {
      explicitlyRemovedPreferredRelayUrls = explicitlyRemovedPreferredRelayUrls.filter(
        (relayUrl) => relayUrl !== nextRelayUrl
      );
    }
    preferredRelays = updateItem(preferredRelays, index, value);
  }

  function addPreferredRelay(relayUrl: string): void {
    const normalized = normalizeRelayUrl(relayUrl);
    if (!normalized || preferredRelays.includes(normalized)) return;
    explicitlyRemovedPreferredRelayUrls = explicitlyRemovedPreferredRelayUrls.filter(
      (removedRelayUrl) => removedRelayUrl !== normalized
    );
    preferredRelays = [...preferredRelays, normalized];
  }

  let hashtagSearchQuery = $state("");
  let hashtagSearchResults = $state<string[]>([]);
  let showHashtagAutocomplete = $state(false);
  let hashtagInputElement: HTMLInputElement | undefined = $state();
  let highlightedHashtagIndex = $state(-1);

  function normalizeHashtag(tag: string): string {
    return tag.toLowerCase().replace(/^#/, "").trim();
  }

  function tagExists(tag: string): boolean {
    const normalized = normalizeHashtag(tag);
    return tags.some((value) => normalizeHashtag(value) === normalized);
  }

  function getNormalizedQuery(): string {
    return normalizeHashtag(hashtagSearchQuery);
  }

  function canCreateCustomTag(): boolean {
    const normalized = getNormalizedQuery();
    return normalized.length > 0 && !tagExists(normalized);
  }

  function getTotalHashtagOptions(): number {
    return hashtagSearchResults.length + (canCreateCustomTag() ? 1 : 0);
  }

  $effect(() => {
    const query = hashtagSearchQuery.trim();
    if (query) {
      hashtagSearchResults = commonHashtags.search(normalizeHashtag(query), 10);
      showHashtagAutocomplete = true;
    } else {
      hashtagSearchResults = [];
      showHashtagAutocomplete = false;
    }
    highlightedHashtagIndex = -1;
  });

  function addHashtag(tag: string) {
    const normalized = normalizeHashtag(tag);
    if (normalized && !tagExists(normalized)) {
      tags = [...tags, normalized];
      hashtagSearchQuery = "";
      showHashtagAutocomplete = false;
      highlightedHashtagIndex = -1;
    }
  }

  function handleHashtagKeydown(event: KeyboardEvent) {
    if (!showHashtagAutocomplete && event.key === "Enter" && hashtagSearchQuery.trim()) {
      event.preventDefault();
      addHashtag(hashtagSearchQuery);
      return;
    }

    if (!showHashtagAutocomplete) return;

    const totalOptions = getTotalHashtagOptions();
    const canCreate = canCreateCustomTag();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        highlightedHashtagIndex = Math.min(highlightedHashtagIndex + 1, totalOptions - 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        highlightedHashtagIndex = Math.max(highlightedHashtagIndex - 1, -1);
        break;
      case "Enter":
        event.preventDefault();
        if (highlightedHashtagIndex >= 0 && highlightedHashtagIndex < hashtagSearchResults.length) {
          addHashtag(hashtagSearchResults[highlightedHashtagIndex]);
        } else if (highlightedHashtagIndex === hashtagSearchResults.length && canCreate) {
          addHashtag(hashtagSearchQuery);
        } else if (canCreate) {
          addHashtag(hashtagSearchQuery);
        }
        break;
      case "Escape":
        event.preventDefault();
        hashtagSearchQuery = "";
        showHashtagAutocomplete = false;
        highlightedHashtagIndex = -1;
        break;
    }
  }

  const completedSuccessfulTargets = $derived.by(
    () => completedResult?.remotePushResults.filter((item) => item.success) || []
  );
  const completedFailedTargets = $derived.by(
    () => completedResult?.remotePushResults.filter((item) => !item.success) || []
  );
  const primaryForkUrl = $derived.by(
    () => completedResult?.webUrl || completedResult?.forkUrl || ""
  );

  async function waitForNavigationFeedbackPaint() {
    await tick();
    if (typeof requestAnimationFrame !== "function") return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function handleNavigateToForkedRepo() {
    if (!completedResult || !navigateToForkedRepo || isNavigatingToRepo) return;

    isNavigatingToRepo = true;
    try {
      await waitForNavigationFeedbackPaint();
      await navigateToForkedRepo(completedResult);
    } catch (error) {
      console.error("Failed to navigate to forked repository:", error);
    } finally {
      isNavigatingToRepo = false;
    }
  }

  function handleClose() {
    if (isNavigatingToRepo) return;

    if (isForking) {
      shouldCloseAfterAbort = true;
      void requestForkAbort("User cancelled fork");
      return;
    }

    completedResult = null;
    showDetails = false;
    isOpen = false;
    notifyClose();
    window.history.back();
  }

  async function requestForkAbort(reason: string) {
    if (isCancelingFork) return;
    isCancelingFork = true;
    try {
      forkState.abortFork?.(reason);
    } finally {
      if (!isForking) isCancelingFork = false;
    }
  }

  function handleAbort() {
    shouldCloseAfterAbort = true;
    void requestForkAbort("User cancelled fork");
  }

  async function copyForkUrl() {
    try {
      if (!primaryForkUrl) return;
      await navigator.clipboard.writeText(primaryForkUrl);
      toast.push({ message: "Copied repository URL", variant: "default" });
    } catch {
      toast.push({ message: "Failed to copy URL", theme: "error" });
    }
  }

  async function copyCloneCommand() {
    try {
      const url = completedResult?.forkUrl || "";
      if (!url) return;
      await navigator.clipboard.writeText(`git clone ${url}`);
      toast.push({ message: "Copied git clone command", variant: "default" });
    } catch {
      toast.push({ message: "Failed to copy command", theme: "error" });
    }
  }

  async function handleFork() {
    completedResult = null;
    showDetails = false;

    const nameError = validateForkName(forkName);
    if (nameError) {
      validationError = nameError;
      return;
    }

    if (selectedForkTargets.length === 0) {
      validationError = "Select at least one ready target";
      return;
    }

    if (graspRelayCouplingError) {
      validationError = graspRelayCouplingError;
      return;
    }

    validationError = undefined;

    const forkConfig: ForkConfig = {
      forkName: forkName.trim(),
      visibility: "public",
      targets: selectedForkTargets,
      includeBranches:
        !isAugmentingExistingRepo &&
        branchCopyFilterState.mode === "toggle" &&
        useBranchCopyFilter &&
        branchCopyFilterState.maintainerBranchNames.length > 0
          ? branchCopyFilterState.maintainerBranchNames
          : undefined,
      earliestUniqueCommit: earliestUniqueCommit || undefined,
      tags,
      maintainers,
      relays: effectivePreferredRelays,
      knownGraspRelayUrls: resolvedGraspServices.map((service) => service.relayUrl),
      knownGraspServices: resolvedGraspServices,
      community: selectedCommunityPubkey
        ? getRepoCommunityOptionBinding(
            findRepoCommunityOption(communityOptions, selectedCommunityPubkey)
          ) ||
          repo.community ||
          null
        : null,
    };

    try {
      await forkState.forkRepository(originalRepo, forkConfig);
    } catch (forkError) {
      toast.push({
        message: forkError instanceof Error ? forkError.message : "Failed to fork repository",
        theme: "error",
      });
    }
  }

  function handleRetry() {
    if (error && !isForking) {
      void handleFork();
    }
  }

  function onFormSubmit(event: Event) {
    event.preventDefault();
    if (!isForking) {
      void handleFork();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget && !isForking && !isNavigatingToRepo) {
      handleClose();
    }
  }

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !isForking && !isNavigatingToRepo) {
      handleClose();
    }
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    handleBackdropKeydown(event);
    handleKeydownTrap(event);
  }

  $effect(() => {
    if (shouldCloseAfterAbort && !isForking) {
      shouldCloseAfterAbort = false;
      isCancelingFork = false;
      handleClose();
    }
  });

  $effect(() => {
    if (!isForking) {
      isCancelingFork = false;
    }
  });

  $effect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        if (initialFocusEl && typeof initialFocusEl.focus === "function") {
          initialFocusEl.focus();
        }
      });
    }
  });

  $effect(() => {
    return () => {
      if (isForking && !isNavigatingToRepo) {
        forkState.abortFork?.("Fork dialog closed");
      }
      notifyClose();
    };
  });

  function handleKeydownTrap(event: KeyboardEvent) {
    if (event.key !== "Tab" || !dialogEl) return;
    const focusableSelectors = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const nodes = Array.from(dialogEl.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
      (el) => el.offsetParent !== null
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const forward = !event.shiftKey;
    if (forward && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!forward && active === first) {
      event.preventDefault();
      last.focus();
    }
  }
</script>

<svelte:window onkeydown={handleBackdropKeydown} />

{#if isOpen}
  <div
    class="fixed inset-0 z-50 isolate flex items-center justify-center bg-black/50 p-2 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="fork-dialog-title"
    aria-busy={isForking || isNavigatingToRepo}
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleDialogKeydown}
  >
    <div
      bind:this={dialogEl}
      role="document"
      class="ng-themed-modal relative z-[60] flex h-[calc(100dvh-1rem)] w-full max-w-2xl transform-gpu flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none sm:h-auto sm:max-h-[90dvh]"
    >
      <div class="flex shrink-0 items-center justify-between border-b border-gray-700 p-4 sm:p-6">
        <div class="flex min-w-0 items-center space-x-3">
          <GitFork class="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h2 id="fork-dialog-title" class="min-w-0 break-words text-xl font-semibold text-white">
            {isAugmentingExistingRepo ? "Add Repository Remote" : "Fork Repository"}
          </h2>
        </div>
        {#if !isForking && !isNavigatingToRepo}
          <button
            type="button"
            onclick={handleClose}
            class="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-gray-200"
            aria-label="Close dialog"
          >
            <X class="w-5 h-5" />
          </button>
        {/if}
      </div>

      <div
        class="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-6"
      >
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-600">
          <div class="flex flex-col gap-1">
            <div class="flex min-w-0 items-center space-x-3">
              <GitFork class="w-5 h-5 text-gray-400" />
              <div class="min-w-0 break-words text-sm font-medium text-white">
                {#if Markdown && ownerIsNostr}
                  <div class="fork-owner-inline">
                    <Markdown
                      content={ownerDisplayOwner}
                      relays={defaultRelays}
                      variant="comment"
                    />
                    <span>/{ownerDisplayName}</span>
                  </div>
                {:else}
                  {ownerDisplay}
                {/if}
              </div>
            </div>
            {#if originalRepo.description}
              <div class="text-sm text-gray-400 ml-8">
                {#if Markdown}
                  <Markdown
                    content={originalRepo.description}
                    relays={defaultRelays}
                    variant="comment"
                  />
                {:else}
                  <p>{originalRepo.description}</p>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        {#if !isForking && !isProgressComplete}
          <form id="fork-form" class="space-y-5" onsubmit={onFormSubmit}>
            <div>
              <label for="fork-name" class="block text-sm font-medium text-gray-300 mb-2">
                Repository name *
              </label>
              <input
                id="fork-name"
                type="text"
                bind:value={forkName}
                bind:this={initialFocusEl}
                placeholder="Enter fork name"
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                aria-invalid={!!validationError}
                aria-describedby={validationError ? "fork-name-error" : undefined}
              />
              {#if validationError}
                <p
                  id="fork-name-error"
                  class="mt-1 text-sm text-red-700 dark:text-red-400 flex items-center space-x-1"
                >
                  <AlertCircle class="w-4 h-4" />
                  <span>{validationError}</span>
                </p>
              {/if}
              <p class="mt-1 text-xs text-gray-400">
                Keeping the same name adds new successful remotes to the repo's clone URL list.
              </p>
            </div>

            <div class="space-y-4 border border-gray-700 rounded-lg p-4 bg-gray-900/60">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 class="text-sm font-medium text-gray-200">Fork targets</h3>
                  <p class="text-xs text-gray-400">
                    Duplicate this repository to one or more writable destinations.
                  </p>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onclick={selectAllReadyTargets}
                    class="px-2 py-1 border border-gray-600 rounded text-gray-300 hover:text-white hover:border-gray-500"
                  >
                    Select all ready
                  </button>
                  <button
                    type="button"
                    onclick={clearSelectedTargets}
                    class="px-2 py-1 border border-gray-600 rounded text-gray-300 hover:text-white hover:border-gray-500"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div>
                <div class="flex items-center gap-2 mb-2">
                  <Globe class="w-4 h-4 text-gray-400" />
                  <span class="text-sm font-medium text-gray-300">GRASP target relays</span>
                </div>
                <div class="space-y-2">
                  {#if graspTargetRelayUrls.length > 0}
                    {#each graspTargetRelayUrls as relayUrl, index}
                      <div class="flex min-w-0 items-center gap-2">
                        <input
                          id={index === 0 ? "relay-url" : undefined}
                          type="text"
                          value={graspTargetRelayUrls[index]}
                          oninput={(event) =>
                            updateGraspRelay(index, (event.target as HTMLInputElement).value)}
                          class="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="wss://relay.example.com"
                        />
                        <button
                          type="button"
                          onclick={() => removeGraspRelay(index)}
                          class="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          aria-label="Remove GRASP relay"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    {/each}
                  {/if}

                  <div class="flex min-w-0 items-center gap-2">
                    <input
                      type="text"
                      bind:value={newGraspRelayUrl}
                      class="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Add another GRASP relay target"
                      onkeydown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitNewGraspRelay();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onclick={commitNewGraspRelay}
                      class="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-gray-600 px-3 py-2 text-gray-300 hover:border-gray-500 hover:text-white"
                    >
                      <Plus class="w-4 h-4" />
                    </button>
                  </div>

                  {#if knownGraspServers.length > 0}
                    <div class="flex flex-wrap gap-2">
                      {#each knownGraspServers as relayUrl}
                        <button
                          type="button"
                          class="max-w-full break-all rounded border border-gray-600 px-2.5 py-1 text-left text-xs text-gray-300 hover:border-gray-500"
                          onclick={() => upsertGraspRelay(relayUrl)}
                        >
                          {relayUrl}
                        </button>
                      {/each}
                    </div>
                  {/if}

                  <p class="text-xs text-gray-400">
                    Configured GRASP candidates stay listed when unchecked. Use the trash control to
                    remove a candidate.
                  </p>
                </div>
              </div>

              <div class="space-y-2 bg-gray-800 rounded-lg p-4 border border-gray-600">
                {#if forkTargets.length === 0}
                  <p class="text-sm text-gray-400">No writable targets detected yet.</p>
                  <p class="text-xs text-gray-400">
                    Add host tokens in settings and/or add GRASP relay URLs above.
                  </p>
                {:else}
                  {#each forkTargets as target (target.id)}
                    <label class="flex items-start gap-3">
                      <input
                        type="checkbox"
                        value={target.id}
                        bind:group={selectedForkTargetIds}
                        disabled={target.status !== "ready" || isForking}
                        onchange={handleForkTargetSelectionChange}
                        class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <div class="flex-1 min-w-0">
                        <div
                          class="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                        >
                          <span class="min-w-0 break-words text-sm text-white">{target.label}</span>
                          <span class={`shrink-0 text-xs ${targetStatusTone(target)}`}
                            >{targetStatusLabel(target)}</span
                          >
                        </div>
                        {#if targetDetail(target)}
                          <p class="mt-0.5 break-words text-xs text-gray-400">
                            {targetDetail(target)}
                          </p>
                        {/if}
                      </div>
                    </label>
                  {/each}
                {/if}
              </div>
              <p class="text-xs text-gray-400">
                {#if targetPreflightPending}
                  Running destination preflight checks...
                {:else if isAugmentingExistingRepo}
                  Unchecked advertised remotes remain in the repository announcement. Select a
                  target only when it should be synchronized or added.
                {:else}
                  Select at least one target with Ready status.
                {/if}
              </p>
            </div>

            {#if branchCopyFilterState.mode !== "hidden" && !isAugmentingExistingRepo}
              <div class="space-y-3 border border-gray-700 rounded-lg p-4 bg-gray-900/60">
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="text-sm font-medium text-gray-200">Branch copy filter</h3>
                    <button
                      type="button"
                      title={branchCopyFilterTooltip}
                      aria-label="About branch filtering"
                      class="inline-flex min-h-10 min-w-10 items-center justify-center text-gray-400 hover:text-gray-300 sm:-m-3"
                    >
                      <Info class="w-4 h-4" />
                    </button>
                  </div>
                  <p class="text-xs text-gray-400">
                    {branchCopyFilter?.description ||
                      "For large repositories, you can limit which branches are copied into the fork."}
                  </p>
                </div>

                {#if branchCopyFilterState.mode === "loading"}
                  <div class="flex items-center gap-2 text-sm text-gray-300">
                    <Loader2 class="w-4 h-4 animate-spin text-gray-400" />
                    <p>
                      Checking maintainer branches for this {branchCopyFilterState.totalBranches}-branch
                      repo...
                    </p>
                  </div>
                {:else if branchCopyFilterState.mode === "toggle"}
                  <label class="flex items-start gap-3">
                    <input
                      type="checkbox"
                      bind:checked={useBranchCopyFilter}
                      disabled={isForking}
                      class="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm text-white">{branchCopyFilter?.label}</div>
                      <p class="text-xs text-gray-400 mt-0.5">
                        Copy {branchCopyFilterState.maintainerBranchNames.length} of {branchCopyFilterState.totalBranches}
                        current branch{branchCopyFilterState.totalBranches === 1 ? "" : "es"}. The
                        default branch stays included.
                      </p>
                    </div>
                  </label>
                {:else if branchCopyFilterState.mode === "empty"}
                  <p class="text-sm text-gray-300">
                    No maintainer branches found; including all {branchCopyFilterState.totalBranches}
                    branch{branchCopyFilterState.totalBranches === 1 ? "" : "es"} in this fork.
                  </p>
                {:else}
                  <p class="text-sm text-gray-300">
                    Maintainer merge targets cover all {branchCopyFilterState.totalBranches}
                    branch{branchCopyFilterState.totalBranches === 1 ? "" : "es"}; including all
                    branches in this fork.
                  </p>
                {/if}
              </div>
            {/if}

            <div>
              <label for="earliest-commit" class="block text-sm font-medium text-gray-300 mb-2">
                <GitCommit class="w-4 h-4 inline mr-1" />
                Earliest Unique Commit {loadingCommits ? "(loading...)" : ""}
              </label>
              <div class="relative">
                <input
                  id="earliest-commit"
                  type="text"
                  bind:value={commitSearchQuery}
                  onfocus={() => {
                    commitInputFocused = true;
                    if (availableCommits.length > 0) showCommitDropdown = true;
                  }}
                  onblur={() => {
                    commitInputFocused = false;
                    setTimeout(() => (showCommitDropdown = false), 200);
                  }}
                  disabled={loadingCommits}
                  autocomplete="off"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
                  placeholder={earliestUniqueCommit || "Search commits or paste commit hash..."}
                />
                {#if commitInputFocused && loadingCommits}
                  <div
                    class="absolute z-10 mt-1 max-h-[min(15rem,50dvh)] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-lg"
                  >
                    <div class="flex items-center space-x-2 text-sm text-gray-300">
                      <Loader2 class="w-4 h-4 animate-spin" />
                      <span>Loading commits...</span>
                    </div>
                  </div>
                {:else if showCommitDropdown && filteredCommits.length > 0}
                  <div
                    class="absolute z-10 mt-1 max-h-[min(24rem,50dvh)] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-lg"
                  >
                    {#each filteredCommits as commit}
                      <button
                        type="button"
                        onclick={() => {
                          earliestUniqueCommit = commit.oid;
                          commitSearchQuery = "";
                          showCommitDropdown = false;
                        }}
                        class="w-full text-left px-3 py-2 hover:bg-gray-700 border-b border-gray-700 last:border-b-0"
                      >
                        <div class="flex items-start gap-2">
                          <GitCommit class="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div class="flex-1 min-w-0">
                            <div class="text-xs font-mono text-blue-700 dark:text-blue-400">
                              {commit.oid?.slice(0, 7) || "unknown"}
                            </div>
                            <div class="break-words text-sm text-white">
                              {commit.message?.split("\n")[0] ||
                                commit.commit?.message?.split("\n")[0] ||
                                "No message"}
                            </div>
                            <div class="text-xs text-gray-400 mt-0.5">
                              {commit.author || commit.commit?.author?.name || "Unknown"} · {new Date(
                                (commit.timestamp || commit.commit?.author?.timestamp || 0) * 1000
                              ).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              {#if earliestUniqueCommit}
                <div
                  class="mt-2 flex min-w-0 items-center justify-between rounded bg-gray-800/50 p-2 font-mono text-xs text-gray-300"
                >
                  <span class="min-w-0 break-all">{earliestUniqueCommit}</span>
                  <button
                    type="button"
                    onclick={() => (earliestUniqueCommit = "")}
                    class="ml-2 inline-flex min-h-10 min-w-10 flex-shrink-0 items-center justify-center text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    aria-label="Clear commit"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              {/if}
              <p class="text-gray-400 text-xs mt-1">
                The commit ID of the earliest unique commit to identify this fork among other forks
              </p>
            </div>

            <div class="space-y-4 border-t border-gray-700 pt-4">
              <div>
                <h4 class="text-sm font-medium text-gray-300">Fork metadata</h4>
                <p class="text-xs text-gray-400">
                  Optional NIP-34 fields for your fork announcement.
                </p>
              </div>

              <RepoCommunitySelect
                options={communityOptions}
                bind:value={selectedCommunityPubkey}
                label="Repository community"
                description="Optionally bind this fork to one community as part of its identity."
              />

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  <Hash class="w-4 h-4 inline mr-1" />
                  Tags/Topics
                </label>
                {#if tags.length > 0}
                  <div class="flex flex-wrap gap-2 mb-2">
                    {#each tags as tag}
                      <div
                        class="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-gray-800 py-2 pl-3 text-sm"
                      >
                        <Hash class="w-3 h-3 text-gray-400" />
                        <span class="min-w-0 break-all text-sm text-white">{tag}</span>
                        <button
                          type="button"
                          onclick={() => (tags = tags.filter((value) => value !== tag))}
                          class="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-gray-200"
                          aria-label="Remove tag"
                        >
                          <X class="w-4 h-4" />
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="relative">
                  <input
                    bind:this={hashtagInputElement}
                    type="text"
                    bind:value={hashtagSearchQuery}
                    onfocus={() => {
                      if (hashtagSearchQuery.trim()) {
                        showHashtagAutocomplete =
                          hashtagSearchResults.length > 0 || canCreateCustomTag();
                      }
                    }}
                    onblur={() => {
                      setTimeout(() => {
                        showHashtagAutocomplete = false;
                        highlightedHashtagIndex = -1;
                      }, 250);
                    }}
                    onkeydown={handleHashtagKeydown}
                    autocomplete="off"
                    class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Search or type to add tags (press Enter)"
                  />
                  {#if showHashtagAutocomplete}
                    <div
                      role="listbox"
                      aria-label="Hashtag suggestions"
                      class="absolute z-[50] mt-1 max-h-[min(15rem,50dvh)] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-lg"
                    >
                      {#each hashtagSearchResults as tag, index}
                        {@const isAlreadyAdded = tagExists(tag)}
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === highlightedHashtagIndex}
                          disabled={isAlreadyAdded}
                          onmousedown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onclick={() => {
                            if (!isAlreadyAdded) addHashtag(tag);
                          }}
                          class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 {index ===
                          highlightedHashtagIndex
                            ? 'bg-gray-700'
                            : 'hover:bg-gray-700'} {isAlreadyAdded
                            ? 'opacity-50 cursor-not-allowed'
                            : ''}"
                        >
                          <Hash class="w-3 h-3 text-gray-400" />
                          <span class="min-w-0 flex-1 break-all">{tag}</span>
                          {#if isAlreadyAdded}
                            <span class="text-xs text-gray-400">(already added)</span>
                          {/if}
                        </button>
                      {/each}
                      {#if canCreateCustomTag()}
                        <button
                          type="button"
                          role="option"
                          aria-selected={highlightedHashtagIndex === hashtagSearchResults.length}
                          onmousedown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onclick={() => addHashtag(hashtagSearchQuery)}
                          class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-t border-gray-700 {highlightedHashtagIndex ===
                          hashtagSearchResults.length
                            ? 'bg-gray-700'
                            : 'hover:bg-gray-700'}"
                        >
                          <Plus class="w-3 h-3 text-blue-700 dark:text-blue-400" />
                          <span
                            class="min-w-0 break-words font-medium text-blue-700 dark:text-blue-400"
                            >Create tag: {getNormalizedQuery()}</span
                          >
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
                <p class="mt-1 text-xs text-gray-400">Add tags or topics for this repository</p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  <Users class="w-4 h-4 inline mr-1" />
                  Additional Maintainers
                </label>
                <PeoplePicker
                  selected={maintainers}
                  placeholder="Search by name, nip-05, or npub..."
                  maxSelections={50}
                  showAvatars={true}
                  showSuggestionsOnFocus={true}
                  compact={false}
                  getProfile={getProfile}
                  searchProfiles={searchProfiles ? searchMaintainerProfiles : undefined}
                  searchProfilesUpdateSignal={searchProfilesUpdateSignal}
                  searchProfilesContextKey={selectedCommunityPubkey}
                  add={(value: string) => {
                    if (!maintainers.includes(value)) maintainers = [...maintainers, value];
                  }}
                  remove={(value: string) => {
                    maintainers = maintainers.filter((entry) => entry !== value);
                  }}
                />
                <p class="mt-1 text-xs text-gray-400">Maintainer public keys (npub or hex)</p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  <Globe class="w-4 h-4 inline mr-1" />
                  Preferred Relays
                </label>
                <div class="space-y-2">
                  {#if selectedGraspRelayUrls.length > 0}
                    {#each selectedGraspRelayUrls as relayUrl}
                      <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={relayUrl}
                          readonly
                          aria-label="Selected GRASP relay"
                          class="min-w-0 w-full flex-1 rounded-lg border border-blue-500/40 bg-gray-800 px-3 py-2 text-white focus:outline-none"
                        />
                        <span
                          class="self-start whitespace-nowrap rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 sm:self-auto"
                        >
                          Target relay
                        </span>
                      </div>
                    {/each}
                  {/if}

                  {#each preferredRelays as relay, index}
                    <div class="flex min-w-0 items-center gap-2">
                      <input
                        type="text"
                        value={preferredRelays[index]}
                        oninput={(event) =>
                          updatePreferredRelay(index, (event.target as HTMLInputElement).value)}
                        placeholder="wss://relay.example.com"
                        class="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        class="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        aria-label="Remove relay"
                        onclick={() => removePreferredRelay(index)}
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                  {/each}

                  {#if searchRelays}
                    <div class="relative">
                      <input
                        bind:this={relayInputElement}
                        type="text"
                        bind:value={relaySearchQuery}
                        onfocus={() => (showRelayAutocomplete = relaySearchResults.length > 0)}
                        onblur={(event) => {
                          setTimeout(() => {
                            if (
                              !event.relatedTarget ||
                              !(event.relatedTarget as HTMLElement).closest(
                                "#fork-relay-suggestions"
                              )
                            ) {
                              showRelayAutocomplete = false;
                            }
                          }, 200);
                        }}
                        autocomplete="off"
                        class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Search for relays..."
                      />
                      {#if showRelayAutocomplete && relaySearchResults.length > 0}
                        <div
                          id="fork-relay-suggestions"
                          class="absolute z-50 mt-1 max-h-[min(15rem,50dvh)] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 shadow-lg"
                        >
                          {#each relaySearchResults as relayUrl}
                            <button
                              type="button"
                              onmousedown={(event) => event.preventDefault()}
                              onclick={() => {
                                addPreferredRelay(relayUrl);
                                relaySearchQuery = "";
                                showRelayAutocomplete = false;
                              }}
                              class="w-full break-all px-3 py-2 text-left font-mono text-sm hover:bg-gray-700"
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
                      class="min-h-10 px-3 py-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      onclick={() => (preferredRelays = addItem(preferredRelays))}
                    >
                      <Plus class="w-4 h-4 inline mr-1" />
                      Add relay
                    </button>
                  {/if}
                </div>
                <p class="mt-1 text-xs text-gray-400">
                  Selected GRASP target relays are included automatically when publishing.
                </p>
                {#if graspRelayCouplingError}
                  <p class="mt-2 text-sm text-red-400" role="alert">{graspRelayCouplingError}</p>
                {/if}
              </div>
            </div>
          </form>
        {/if}

        <div class="sr-only" aria-live="polite">
          {#if error}
            Fork failed: {error}
          {:else if isForking}
            {currentProgressMessage}
          {:else if isProgressComplete}
            {#if warning}
              {isAugmentingExistingRepo
                ? "Repository sync completed with warnings."
                : "Fork completed with warnings."}
            {:else}
              {isAugmentingExistingRepo
                ? "Repository sync completed successfully."
                : "Fork completed successfully."}
            {/if}
          {/if}
        </div>

        {#if warning}
          <div
            class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-900/40"
          >
            <div class="flex items-start space-x-3">
              <AlertCircle
                class="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5 flex-shrink-0"
              />
              <div class="flex-1">
                <h4 class="text-amber-800 dark:text-amber-200 font-medium mb-1">
                  {error
                    ? "Partial synchronization details"
                    : isAugmentingExistingRepo
                      ? "Repository sync completed with warnings"
                      : "Fork completed with warnings"}
                </h4>
                <p class="text-amber-700 dark:text-amber-100 text-sm">{warning}</p>
              </div>
            </div>
          </div>
        {/if}

        {#if error}
          <div
            class="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-500 dark:bg-red-900/50"
          >
            <div class="flex items-start space-x-3">
              <AlertCircle class="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div class="flex-1">
                <h4 class="text-red-800 dark:text-red-400 font-medium mb-1">
                  {isAugmentingExistingRepo ? "Repository Sync Failed" : "Fork Failed"}
                </h4>
                <div class="text-red-700 dark:text-red-300 text-sm">
                  {#if Markdown}
                    <Markdown content={error} relays={defaultRelays} variant="comment" />
                  {:else}
                    <p>{error}</p>
                  {/if}
                </div>
                {#if forkTokenIssue}
                  <p class="mt-2 text-xs text-red-700 dark:text-red-300">
                    {getAccessTokenManagementMessage(error)}
                    <a
                      href={ACCESS_TOKEN_SETTINGS_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="ml-1 underline underline-offset-2"
                    >
                      Open token settings
                    </a>
                  </p>
                {/if}
                {#if !isForking}
                  <button
                    type="button"
                    onclick={handleRetry}
                    class="mt-3 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm underline"
                  >
                    Try again
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {:else if isProgressComplete}
          <div class="space-y-4">
            {#if !warning}
              <div class="flex items-center space-x-3">
                <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
                <span class="text-green-700 dark:text-green-400 font-medium">
                  {isAugmentingExistingRepo
                    ? "Repository sync completed successfully!"
                    : "Fork completed successfully!"}
                </span>
              </div>
            {/if}

            {#if primaryForkUrl}
              <div class="bg-gray-800 rounded-lg p-4 border border-gray-600">
                <p class="text-sm text-gray-300">Primary repository URL:</p>
                <div
                  class="mt-2 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <a
                    href={primaryForkUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="inline-flex min-w-0 items-start gap-1 break-all text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <span>{primaryForkUrl}</span>
                    <ExternalLink class="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onclick={copyForkUrl}
                    class="min-h-10 w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white sm:w-auto"
                  >
                    Copy URL
                  </button>
                </div>
              </div>
            {/if}

            <div class="bg-gray-800 rounded-lg p-4 border border-gray-600 space-y-3">
              <div>
                <p class="text-sm text-gray-300 mb-2">Successful targets</p>
                <div class="space-y-2">
                  {#each completedSuccessfulTargets as target}
                    <div
                      class="flex min-w-0 flex-col items-start gap-2 text-sm sm:flex-row sm:justify-between sm:gap-3"
                    >
                      <div class="min-w-0">
                        <div class="text-white">{target.label}</div>
                        <div class="text-gray-400 break-all">
                          {target.webUrl || target.remoteUrl}
                        </div>
                      </div>
                      <CheckCircle2
                        class="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0"
                      />
                    </div>
                  {/each}
                </div>
              </div>

              {#if completedFailedTargets.length > 0}
                <div class="border-t border-gray-700 pt-3">
                  <p class="text-sm text-amber-700 dark:text-amber-300 mb-2">
                    Targets that still need manual retry
                  </p>
                  <div class="space-y-2">
                    {#each completedFailedTargets as target}
                      <div class="text-sm">
                        <div class="text-white">{target.label}</div>
                        <div class="text-amber-700/80 dark:text-amber-200/80">
                          {target.error || "Sync failed"}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>

            <div class="mt-2">
              <button
                type="button"
                class="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1"
                onclick={() => (showDetails = !showDetails)}
                aria-expanded={showDetails}
              >
                <ChevronDown
                  class={"w-3 h-3 transition-transform " + (showDetails ? "rotate-180" : "")}
                />
                {showDetails ? "Hide details" : "Show details"}
              </button>
            </div>

            {#if showDetails}
              <div
                class="mt-2 rounded-md border border-gray-700 bg-gray-900 p-3 text-xs text-gray-300 space-y-2"
              >
                {#if completedResult?.forkUrl}
                  <div
                    class="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span>Clone with Git</span>
                    <button
                      type="button"
                      onclick={copyCloneCommand}
                      class="min-h-10 w-full rounded border border-gray-700 px-2 py-1 hover:border-gray-600 sm:w-auto"
                    >
                      Copy
                    </button>
                  </div>
                  <code class="block bg-black/40 rounded px-2 py-1 break-all"
                    >git clone {completedResult?.forkUrl}</code
                  >
                {/if}
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                  <span class="text-gray-400">Repository:</span>
                  {#if Markdown && forkOwnerIsNostr}
                    <div class="fork-owner-inline">
                      <Markdown
                        content={forkOwnerDisplayOwner}
                        relays={defaultRelays}
                        variant="comment"
                      />
                      <span>/{forkOwnerDisplayName}</span>
                    </div>
                  {:else}
                    <span class="text-gray-300">{forkOwnerDisplay}</span>
                  {/if}
                </div>
                {#if completedResult?.defaultBranch}
                  <div class="text-gray-400">
                    Default branch: <span class="text-gray-300"
                      >{completedResult.defaultBranch}</span
                    >
                  </div>
                {/if}
                {#if completedResult?.branches?.length}
                  <div class="text-gray-400">
                    Branches: <span class="text-gray-300"
                      >{completedResult.branches.join(", ")}</span
                    >
                  </div>
                {/if}
                {#if completedResult?.tags?.length}
                  <div class="text-gray-400">
                    Tags: <span class="text-gray-300">{completedResult.tags.join(", ")}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if isForking && progress && progress.length > 0}
          <div class="space-y-4">
            <div>
              <h3 class="text-lg font-medium text-white mb-1">Fork progress</h3>
              <p class="text-sm text-gray-400">
                This may take a few minutes. Don't close this window while the fork is running.
              </p>
            </div>

            <GitOperationActivity activity={forkState.operationActivity} />

            <div class="space-y-0">
              {#each progressPhases as phase, i}
                {@const isLast = i === progressPhases.length - 1}
                <div class="flex gap-3">
                  <div class="flex flex-col items-center flex-shrink-0">
                    <div
                      class="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                      class:bg-green-600={phase.status === "completed"}
                      class:bg-blue-600={phase.status === "active"}
                      class:bg-red-600={phase.status === "error"}
                      class:bg-gray-700={phase.status === "pending"}
                    >
                      {#if phase.status === "completed"}
                        <CheckCircle2 class="w-4 h-4 text-white" />
                      {:else if phase.status === "active"}
                        <Loader2 class="w-4 h-4 text-white animate-spin" />
                      {:else if phase.status === "error"}
                        <AlertCircle class="w-4 h-4 text-white" />
                      {:else}
                        <span class="text-xs font-medium text-gray-300">{i + 1}</span>
                      {/if}
                    </div>
                    {#if !isLast}
                      <div
                        class="w-0.5 h-6 mt-1 rounded-full transition-colors"
                        class:bg-green-600={phase.status === "completed"}
                        class:bg-gray-700={phase.status !== "completed"}
                      ></div>
                    {/if}
                  </div>
                  <div class="flex-1 min-w-0 pb-4">
                    <p
                      class={`text-sm font-medium transition-colors ${
                        phase.status === "completed"
                          ? "text-green-700 dark:text-green-400"
                          : phase.status === "active"
                            ? "text-blue-700 dark:text-blue-400"
                            : phase.status === "error"
                              ? "text-red-700 dark:text-red-400"
                              : "text-gray-400"
                      }`}
                    >
                      {phase.label}
                    </p>
                    {#if phase.status !== "pending" && phase.detail}
                      <p class="mt-0.5 break-words text-sm text-gray-400">
                        {phase.detail}
                      </p>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      {#if !isProgressComplete}
        <div
          class="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-700 bg-gray-900 p-4 sm:flex-row sm:items-center sm:justify-end sm:p-6"
        >
          <button
            type="button"
            onclick={isForking ? handleAbort : handleClose}
            disabled={isCancelingFork}
            class="min-h-10 w-full px-4 py-2 text-gray-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {#if isForking}
              {isCancelingFork
                ? "Canceling..."
                : isAugmentingExistingRepo
                  ? "Cancel sync"
                  : "Cancel fork"}
            {:else}
              Cancel
            {/if}
          </button>
          <button
            type="submit"
            form="fork-form"
            disabled={isForking ||
              targetPreflightPending ||
              !!validationError ||
              Boolean(graspRelayCouplingError) ||
              selectedForkTargets.length === 0}
            class="flex min-h-10 w-full items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 !text-white rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {#if isForking}
              <Loader2 class="w-4 h-4 animate-spin" />
              <span>{isAugmentingExistingRepo ? "Syncing remotes..." : "Forking..."}</span>
            {:else}
              <GitFork class="w-4 h-4" />
              <span>{isAugmentingExistingRepo ? "Add selected remotes" : "Fork repository"}</span>
            {/if}
          </button>
        </div>
      {:else}
        <div
          class="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-700 bg-gray-900 p-4 sm:flex-row sm:items-center sm:justify-end sm:p-6"
        >
          <button
            type="button"
            onclick={handleClose}
            disabled={isNavigatingToRepo}
            class="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-gray-700 px-4 py-2 !text-white transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            <CheckCircle2 class="w-4 h-4" />
            <span>Done</span>
          </button>
          {#if navigateToForkedRepo && completedResult}
            <button
              type="button"
              onclick={handleNavigateToForkedRepo}
              disabled={isNavigatingToRepo}
              class="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 !text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {#if isNavigatingToRepo}
                <Loader2 class="w-4 h-4 animate-spin" />
                <span>Opening repository...</span>
              {:else}
                <ExternalLink class="w-4 h-4" />
                <span>Go to repo</span>
              {/if}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .fork-owner-inline {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .fork-owner-inline :global(.markdown) {
    display: inline;
  }

  .fork-owner-inline :global(p) {
    margin: 0;
  }
</style>
