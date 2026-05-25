<script lang="ts">
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
  import { useForkRepo } from "../../hooks/useForkRepo.svelte";
  import { deriveForkProgressPhases } from "./fork-progress";
  import { tokens } from "$lib/stores/tokens";
  import { PeoplePicker } from "@nostr-git/ui";
  import { commonHashtags } from "../../stores/hashtags";
  import { getRecommendedGraspServerUrls } from "../../stores/graspServers.js";
  import type { NostrEvent } from "@nostr-git/core";
  import type { RepoAnnouncementEvent, RepoStateEvent } from "@nostr-git/core/events";
  import type { Token } from "$lib/stores/tokens";
  import type { ForkResult, ForkConfig } from "../../hooks/useForkRepo.svelte";
  import { toast } from "../../stores/toast";
  import RepoCommunitySelect from "./RepoCommunitySelect.svelte";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import { findRepoCommunityOption, getRepoCommunityOptionBinding } from "./repo-community-options.js";
  import {
    DEFAULT_BRANCH_COPY_FILTER_TOOLTIP,
    deriveBranchCopyFilterState,
    type BranchCopyFilterConfig,
  } from "./fork-branch-filter";
  import {
    buildRemoteTargetOptions,
    getDefaultSelectedRemoteTargetIds,
    normalizeRelayUrl,
    preflightRemoteTargets,
    toRemoteTargetSelection,
    type RemoteTargetOption,
  } from "../../utils/remote-targets.js";
  import {
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
  } from "../../utils/grasp-pipeline.js";
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
    onPublishEvent: (event: RepoAnnouncementEvent | RepoStateEvent) => Promise<unknown>;
    onFetchRelayEvents?: (params: {
      relays: string[];
      filters: import("@nostr-git/core").NostrFilter[];
      timeoutMs?: number;
    }) => Promise<NostrEvent[]>;
    onRollbackPublishedRepoEvents?: (params: {
      repoName: string;
      relays: string[];
    }) => Promise<void>;
    graspServerUrls?: string[];
    useForkRepoImpl?: (
      options?: Parameters<typeof useForkRepo>[0]
    ) => ReturnType<typeof useForkRepo>;
    navigateToForkedRepo?: (result: ForkResult) => void;
    defaultRelays?: string[];
    sourceCloneUrls?: string[];
    defaultMaintainers?: string[];
    communityOptions?: RepoCommunityOption[];
    defaultCommunityPubkey?: string;
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
  }

  const {
    repo,
    pubkey,
    branchCopyFilter,
    workerApi,
    workerInstance,
    onPublishEvent,
    onFetchRelayEvents,
    onRollbackPublishedRepoEvents,
    graspServerUrls = [],
    useForkRepoImpl,
    navigateToForkedRepo,
    defaultRelays = [],
    sourceCloneUrls = [],
    defaultMaintainers = [],
    communityOptions = [],
    defaultCommunityPubkey = "",
    getProfile,
    searchProfiles,
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
  let selectedCommunityPubkey = $state(defaultCommunityPubkey);

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

        if (navigateToForkedRepo && result.announcementEvent) {
          navigateToForkedRepo(result);
        }
      },
      onPublishEvent,
      onFetchRelayEvents,
    };

    if (onRollbackPublishedRepoEvents) {
      return { ...baseOptions, onRollbackPublishedRepoEvents };
    }

    return baseOptions;
  });

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
  const originalRepo = $derived({
    owner: parsedUrl.owner,
    name: parsedUrl.name,
    description: repo.description || "",
    cloneUrls: sourceCloneUrls.length > 0 ? sourceCloneUrls : repo.clone || [],
    sourceRepoId: repo.repoId || "",
    defaultBranch: repo.selectedBranch || repo.mainBranch || "main",
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

    return getRecommendedGraspServerUrls(graspServerUrlsLocal)
      .map(normalizeRelayUrl)
      .filter((url) => Boolean(url) && !selectedRelayUrls.has(url));
  });

  function upsertGraspRelay(url: string) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized) return;
    initializedGraspTargetRelayUrls = true;
    if (graspTargetRelayUrls.every((value) => !normalizeRelayUrl(value))) {
      graspTargetRelayUrls = [normalized];
      initializedTargetSelection = false;
      if (!graspServerUrlsLocal.includes(normalized)) {
        graspServerUrlsLocal = [...graspServerUrlsLocal, normalized];
      }
      return;
    }
    if (!graspTargetRelayUrls.includes(normalized)) {
      graspTargetRelayUrls = [...graspTargetRelayUrls, normalized];
      initializedTargetSelection = false;
    }
    if (!graspServerUrlsLocal.includes(normalized)) {
      graspServerUrlsLocal = [...graspServerUrlsLocal, normalized];
    }
  }

  function removeGraspRelay(index: number) {
    initializedGraspTargetRelayUrls = true;
    const nextRelayUrls = graspTargetRelayUrls.filter((_, i) => i !== index);
    graspTargetRelayUrls = nextRelayUrls.length > 0 ? nextRelayUrls : [""];
    initializedTargetSelection = false;
  }

  function updateGraspRelay(index: number, value: string) {
    initializedGraspTargetRelayUrls = true;
    graspTargetRelayUrls = graspTargetRelayUrls.map((existingValue, valueIndex) =>
      valueIndex === index ? normalizeRelayUrl(value) : existingValue
    );
    initializedTargetSelection = false;
  }

  function commitNewGraspRelay() {
    if (!newGraspRelayUrl.trim()) return;
    upsertGraspRelay(newGraspRelayUrl);
    newGraspRelayUrl = "";
  }

  type ForkTargetStatus = RemoteTargetOption["status"];

  let forkTargets = $state<RemoteTargetOption[]>([]);
  let selectedForkTargetIds = $state<string[]>([]);
  let initializedTargetSelection = $state(false);
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

  $effect(() => {
    const nextPreferredRelays = getEditableRepoRelayUrls(preferredRelays, selectedGraspRelayUrls);

    if (
      nextPreferredRelays.length !== preferredRelays.length ||
      nextPreferredRelays.some((value, index) => value !== preferredRelays[index])
    ) {
      preferredRelays = nextPreferredRelays;
    }
  });

  function targetStatusLabel(target: RemoteTargetOption): string {
    if (target.status === "ready") return target.existsAlready ? "Ready (existing)" : "Ready";
    if (target.status === "checking") return "Checking";
    if (target.status === "failed" && target.existsAlready) return "Exists";
    if (target.status === "no-token") return "No token";
    if (target.status === "unsupported") return "Unsupported";
    return "Failed";
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
    initializedTargetSelection = true;
  }

  function selectAllReadyTargets() {
    selectedForkTargetIds = forkTargets
      .filter((target) => target.status === "ready")
      .map((target) => target.id);
    initializedTargetSelection = true;
  }

  function clearSelectedTargets() {
    selectedForkTargetIds = [];
    initializedTargetSelection = true;
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
          allowExistingRepoReuse: false,
          existingRepoMessage:
            "Destination already exists. Fork only creates new destinations; use import or attach the remote manually if you want to sync an existing repository.",
        },
      })
    ).then((nextTargets) => {
      if (currentRun !== targetPreflightRunId) return;

      forkTargets = nextTargets;
      const readyTargets = nextTargets.filter((target) => target.status === "ready");
      selectedForkTargetIds = selectedForkTargetIds.filter((id) =>
        readyTargets.some((target) => target.id === id)
      );

      if (!initializedTargetSelection) {
        selectedForkTargetIds = getDefaultSelectedRemoteTargetIds(nextTargets);
        initializedTargetSelection = true;
      }
    });
  });

  let earliestUniqueCommit = $state("");
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
    const repoMaintainers = (defaultMaintainers.length > 0 ? defaultMaintainers : repo?.maintainers || []).filter(Boolean);
    if (maintainers.length === 0 && repoMaintainers.length > 0) {
      maintainers = [...repoMaintainers];
    }
    maintainersInitialized = true;
  });

  const effectivePreferredRelays = $derived.by(() => {
    return getEffectiveRepoRelayUrls(preferredRelays, selectedGraspRelayUrls);
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

  function handleClose() {
    if (isForking) {
      shouldCloseAfterAbort = true;
      void requestForkAbort("User cancelled fork");
      return;
    }

    completedResult = null;
    showDetails = false;
    isOpen = false;
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

    validationError = undefined;

    const forkConfig: ForkConfig = {
      forkName: forkName.trim(),
      visibility: "public",
      targets: selectedForkTargets,
      includeBranches:
        branchCopyFilterState.mode === "toggle" &&
        useBranchCopyFilter &&
        branchCopyFilterState.maintainerBranchNames.length > 0
          ? branchCopyFilterState.maintainerBranchNames
          : undefined,
      earliestUniqueCommit: earliestUniqueCommit || undefined,
      tags,
      maintainers,
      relays: effectivePreferredRelays,
      community: getRepoCommunityOptionBinding(
        findRepoCommunityOption(communityOptions, selectedCommunityPubkey)
      ),
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
    if (event.target === event.currentTarget && !isForking) {
      handleClose();
    }
  }

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !isForking) {
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
      if (isForking) {
        forkState.abortFork?.("Fork dialog closed");
      }
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
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 isolate"
    role="dialog"
    aria-modal="true"
    aria-labelledby="fork-dialog-title"
    aria-busy={isForking}
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleDialogKeydown}
  >
    <div
      bind:this={dialogEl}
      role="document"
      class="ng-themed-modal bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden border border-gray-700 relative z-[60] outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 transform-gpu"
    >
      <div class="flex items-center justify-between p-6 border-b border-gray-700">
        <div class="flex items-center space-x-3">
          <GitFork class="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h2 id="fork-dialog-title" class="text-xl font-semibold text-white">Fork Repository</h2>
        </div>
        {#if !isForking}
          <button
            type="button"
            onclick={handleClose}
            class="text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close dialog"
          >
            <X class="w-5 h-5" />
          </button>
        {/if}
      </div>

      <div class="p-6 space-y-6">
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-600">
          <div class="flex flex-col gap-1">
            <div class="flex items-center space-x-3">
              <GitFork class="w-5 h-5 text-gray-400" />
              <div class="text-sm font-medium text-white">
                {#if Markdown && ownerIsNostr}
                  <div class="fork-owner-inline">
                    <Markdown content={ownerDisplayOwner} relays={defaultRelays} variant="comment" />
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
                      <div class="flex items-center gap-2">
                        <input
                          id={index === 0 ? "relay-url" : undefined}
                          type="text"
                          value={graspTargetRelayUrls[index]}
                          oninput={(event) =>
                            updateGraspRelay(index, (event.target as HTMLInputElement).value)}
                          class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="wss://relay.example.com"
                        />
                        <button
                          type="button"
                          onclick={() => removeGraspRelay(index)}
                          class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          aria-label="Remove GRASP relay"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    {/each}
                  {/if}

                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={newGraspRelayUrl}
                      class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                      class="px-3 py-2 border border-gray-600 rounded-lg text-gray-300 hover:text-white hover:border-gray-500"
                    >
                      <Plus class="w-4 h-4" />
                    </button>
                  </div>

                  {#if knownGraspServers.length > 0}
                    <div class="flex flex-wrap gap-2">
                      {#each knownGraspServers as relayUrl}
                        <button
                          type="button"
                          class="px-2.5 py-1 text-xs rounded border border-gray-600 text-gray-300 hover:border-gray-500"
                          onclick={() => upsertGraspRelay(relayUrl)}
                        >
                          {relayUrl}
                        </button>
                      {/each}
                    </div>
                  {/if}

                  <p class="text-xs text-gray-400">
                    The first configured relay is added automatically and selected when it passes
                    preflight.
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
              <p class="text-xs text-gray-400">
                {#if targetPreflightPending}
                  Running destination preflight checks...
                {:else}
                  Select at least one target with Ready status.
                {/if}
              </p>
            </div>

            {#if branchCopyFilterState.mode !== "hidden"}
              <div class="space-y-3 border border-gray-700 rounded-lg p-4 bg-gray-900/60">
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="text-sm font-medium text-gray-200">Branch copy filter</h3>
                    <button
                      type="button"
                      title={branchCopyFilterTooltip}
                      aria-label="About trusted branch filtering"
                      class="text-gray-400 hover:text-gray-300 cursor-help"
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
                    Trusted maintainer merges cover all {branchCopyFilterState.totalBranches}
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
                    class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-4"
                  >
                    <div class="flex items-center space-x-2 text-sm text-gray-300">
                      <Loader2 class="w-4 h-4 animate-spin" />
                      <span>Loading commits...</span>
                    </div>
                  </div>
                {:else if showCommitDropdown && filteredCommits.length > 0}
                  <div
                    class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto"
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
                            <div class="text-sm text-white truncate">
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
                  class="mt-2 p-2 bg-gray-800/50 rounded text-xs font-mono text-gray-300 flex items-center justify-between"
                >
                  <span class="truncate">{earliestUniqueCommit}</span>
                  <button
                    type="button"
                    onclick={() => (earliestUniqueCommit = "")}
                    class="ml-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex-shrink-0"
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
                      <div class="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 text-sm">
                        <Hash class="w-3 h-3 text-gray-400" />
                        <span class="text-white text-sm">{tag}</span>
                        <button
                          type="button"
                          onclick={() => (tags = tags.filter((value) => value !== tag))}
                          class="text-gray-400 hover:text-gray-200 transition-colors"
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
                      class="absolute z-[50] w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
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
                          <span class="flex-1">{tag}</span>
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
                          <span class="text-blue-700 dark:text-blue-400 font-medium"
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
                  searchProfiles={searchProfiles}
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
                      <div class="flex items-center space-x-2">
                        <input
                          type="text"
                          value={relayUrl}
                          readonly
                          aria-label="Selected GRASP relay"
                          class="flex-1 px-3 py-2 bg-gray-800 border border-blue-500/40 rounded-lg text-white focus:outline-none"
                        />
                        <span
                          class="px-2.5 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg whitespace-nowrap"
                        >
                          Target relay
                        </span>
                      </div>
                    {/each}
                  {/if}

                  {#each preferredRelays as relay, index}
                    <div class="flex items-center space-x-2">
                      <input
                        type="text"
                        value={preferredRelays[index]}
                        oninput={(event) =>
                          (preferredRelays = updateItem(
                            preferredRelays,
                            index,
                            (event.target as HTMLInputElement).value
                          ))}
                        placeholder="wss://relay.example.com"
                        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <button
                        type="button"
                        class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        aria-label="Remove relay"
                        onclick={() => (preferredRelays = removeItem(preferredRelays, index))}
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
                          class="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                        >
                          {#each relaySearchResults as relayUrl}
                            <button
                              type="button"
                              onmousedown={(event) => event.preventDefault()}
                              onclick={() => {
                                if (!preferredRelays.includes(relayUrl)) {
                                  preferredRelays = [...preferredRelays, relayUrl];
                                }
                                relaySearchQuery = "";
                                showRelayAutocomplete = false;
                              }}
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
                      class="px-3 py-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
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
            Fork completed successfully.
          {/if}
        </div>

        {#if warning}
          <div
            class="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-900/40"
          >
            <div class="flex items-start space-x-3">
              <AlertCircle class="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5 flex-shrink-0" />
              <div class="flex-1">
                <h4 class="text-amber-800 dark:text-amber-200 font-medium mb-1">
                  Fork completed with warnings
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
                <h4 class="text-red-800 dark:text-red-400 font-medium mb-1">Fork Failed</h4>
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
                      class="ml-1 underline underline-offset-2">
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
            <div class="flex items-center space-x-3">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
              <span class="text-green-700 dark:text-green-400 font-medium">
                Fork completed successfully!
              </span>
            </div>

            {#if primaryForkUrl}
              <div class="bg-gray-800 rounded-lg p-4 border border-gray-600">
                <p class="text-sm text-gray-300">Primary repository URL:</p>
                <div class="mt-2 flex items-center justify-between gap-3">
                  <a
                    href={primaryForkUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 break-all inline-flex items-center gap-1"
                  >
                    <span>{primaryForkUrl}</span>
                    <ExternalLink class="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onclick={copyForkUrl}
                    class="px-2 py-1 text-xs border border-gray-600 rounded text-gray-300 hover:text-white hover:border-gray-500"
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
                    <div class="flex items-start justify-between gap-3 text-sm">
                      <div class="min-w-0">
                        <div class="text-white">{target.label}</div>
                        <div class="text-gray-400 break-all">
                          {target.webUrl || target.remoteUrl}
                        </div>
                      </div>
                      <CheckCircle2 class="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
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
                  <div class="flex items-center justify-between">
                    <span>Clone with Git</span>
                    <button
                      type="button"
                      onclick={copyCloneCommand}
                      class="px-2 py-1 border border-gray-700 rounded hover:border-gray-600"
                    >
                      Copy
                    </button>
                  </div>
                  <code class="block bg-black/40 rounded px-2 py-1 break-all"
                    >git clone {completedResult?.forkUrl}</code
                  >
                {/if}
                <div class="flex items-center gap-1">
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
                      <p class="text-sm text-gray-400 mt-0.5 truncate" title={phase.detail}>
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
        <div class="flex items-center justify-end space-x-3 p-6 border-t border-gray-700">
          <button
            type="button"
            onclick={isForking ? handleAbort : handleClose}
            disabled={isCancelingFork}
            class="px-4 py-2 text-gray-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if isForking}
              {isCancelingFork ? "Canceling..." : "Cancel fork"}
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
              selectedForkTargets.length === 0}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 !text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {#if isForking}
              <Loader2 class="w-4 h-4 animate-spin" />
              <span>Forking...</span>
            {:else}
              <GitFork class="w-4 h-4" />
              <span>Fork repository</span>
            {/if}
          </button>
        </div>
      {:else}
        <div class="flex items-center justify-end space-x-3 p-6 border-t border-gray-700">
          <button
            type="button"
            onclick={handleClose}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 !text-white rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <CheckCircle2 class="w-4 h-4" />
            <span>Done</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .fork-owner-inline :global(.markdown) {
    display: inline;
  }

  .fork-owner-inline :global(p) {
    margin: 0;
  }
</style>
