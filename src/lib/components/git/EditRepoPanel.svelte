<script lang="ts">
  import {
    Settings,
    X,
    Save,
    AlertCircle,
    Plus,
    Trash2,
    GripVertical,
    ChevronUp,
    ChevronDown,
    Users,
    Globe,
    Link,
    Hash,
    GitBranch,
    GitCommit,
    CheckCircle2,
    Loader2,
  } from "@lucide/svelte";
  import { nip19, type NostrEvent } from "nostr-tools";
  import { PeoplePicker } from "@nostr-git/ui";
  import { Repo } from "./Repo.svelte";
  import { commonHashtags } from "../../stores/hashtags";
  import {
    getEditableRepoRelayUrls,
    getEffectiveRepoRelayUrls,
    getSuccessfulGraspRelayUrls,
  } from "../../utils/grasp-pipeline.js";
  import RepoCommunitySelect from "./RepoCommunitySelect.svelte";
  import type { RepoCommunityOption } from "./repo-community-options.js";
  import { findRepoCommunityOption, getRepoCommunityOptionBinding } from "./repo-community-options.js";

  // Types for edit configuration and progress
  interface EditProgress {
    stage: string;
    percentage: number;
    isComplete: boolean;
  }

  interface FormData {
    name: string;
    description: string;
    visibility: "public" | "private";
    defaultBranch: string;
    maintainers: string[];
    relays: string[];
    webUrls: string[];
    cloneUrls: string[];
    hashtags: string[];
    earliestUniqueCommit: string;
    communityPubkey: string;
  }

  interface SaveCompleteResult {
    renamed: boolean;
    previousName: string;
    nextName: string;
    relays: string[];
  }

  // Component props
  interface Props {
    repo: Repo;
    onPublishEvent: (event: NostrEvent) => Promise<void>;
    progress?: EditProgress;
    error?: string;
    isEditing?: boolean;
    variant?: "modal" | "page";
    canDelete?: boolean;
    onRequestDelete?: () => void;
    onSaveComplete?: (result: SaveCompleteResult) => Promise<void> | void;
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
    communityOptions?: RepoCommunityOption[];
  }

  const {
    repo,
    onPublishEvent,
    progress,
    error,
    isEditing = false,
    variant = "modal",
    canDelete = false,
    onRequestDelete,
    onSaveComplete,
    getProfile,
    searchProfiles,
    searchRelays,
    communityOptions = [],
  }: Props = $props();

  const isPage = $derived(variant === "page");

  const copyList = (values?: string[] | null) => (Array.isArray(values) ? [...values] : []);
  const getDeclaredMaintainers = (targetRepo: Repo): string[] =>
    Array.from(
      new Set(
        (targetRepo.repoEvent?.tags || [])
          .filter((tag: string[]) => tag[0] === "maintainers")
          .flatMap((tag: string[]) => tag.slice(1))
          .filter(Boolean)
      )
    );

  const cloneFormData = (data: FormData): FormData => ({
    ...data,
    maintainers: copyList(data.maintainers),
    relays: copyList(data.relays),
    webUrls: copyList(data.webUrls),
    cloneUrls: copyList(data.cloneUrls),
    hashtags: copyList(data.hashtags),
  });

  // Extract current values from repo
  function extractCurrentValues(): FormData {
    if (!repo) {
      return {
        name: "",
        description: "",
        visibility: "public" as "public" | "private",
        defaultBranch: "",
        maintainers: copyList(),
        relays: copyList(),
        webUrls: copyList(),
        cloneUrls: copyList(),
        hashtags: copyList(),
        earliestUniqueCommit: "",
        communityPubkey: "",
      };
    }

    // Get default branch from repo's mainBranch property (already resolved)
    const defaultBranch = repo.mainBranch || "";

    // Determine visibility from clone URL (basic heuristic)
    const editableCloneUrls = copyList(repo.clone).filter((url) => {
      const trimmed = String(url || "").trim();
      return trimmed && !trimmed.startsWith("nostr://") && !trimmed.startsWith("nostr:");
    });
    const cloneUrl = editableCloneUrls[0] || "";
    const isPrivate = cloneUrl.includes("private") || false;

    return {
      name: repo.name || "",
      description: repo.description || "",
      visibility: isPrivate ? "private" : ("public" as "public" | "private"),
      defaultBranch,
      maintainers: getDeclaredMaintainers(repo),
      relays: getEditableRepoRelayUrls(copyList(repo.relays), editableCloneUrls),
      webUrls: copyList(repo.web),
      cloneUrls: editableCloneUrls,
      hashtags: copyList(repo.hashtags),
      earliestUniqueCommit: repo.earliestUniqueCommit || "",
      communityPubkey: repo.community?.pubkey || "",
    };
  }

  // Form state - initialize with current values
  const initialValues = extractCurrentValues();
  let formData = $state<FormData>(cloneFormData(initialValues));
  let originalFormData = $state<FormData>(cloneFormData(initialValues));

  // Autocomplete state for relays
  let relaySearchQuery = $state("");
  let relaySearchResults = $state<string[]>([]);
  let showRelayAutocomplete = $state(false);

  // Autocomplete state for hashtags
  let hashtagSearchQuery = $state("");
  let hashtagSearchResults = $state<string[]>([]);
  let showHashtagAutocomplete = $state(false);
  let hashtagInputElement: HTMLInputElement | undefined = $state();
  let highlightedHashtagIndex = $state(-1);

  // Handle relay search with debounce
  let relaySearchTimeout: ReturnType<typeof setTimeout> | null = null;

  const mandatoryGraspRelays = $derived.by(() =>
    getSuccessfulGraspRelayUrls(formData.cloneUrls || [])
  );

  function normalizeRelayValue(value: string): string {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function hasRelay(relayUrl: string): boolean {
    const normalized = normalizeRelayValue(relayUrl);

    return [...mandatoryGraspRelays, ...formData.relays].some(
      (existing) => normalizeRelayValue(existing) === normalized
    );
  }

  $effect(() => {
    const query = relaySearchQuery;

    // Clear previous timeout
    if (relaySearchTimeout) clearTimeout(relaySearchTimeout);

    if (query && searchRelays) {
      relaySearchTimeout = setTimeout(async () => {
        try {
          const results = await searchRelays(query);
          relaySearchResults = results.filter((relayUrl) => !hasRelay(relayUrl));
          showRelayAutocomplete = relaySearchResults.length > 0;
        } catch (e) {
          console.error("Failed to search relays", e);
          relaySearchResults = [];
        }
      }, 300);
    } else {
      relaySearchResults = [];
      showRelayAutocomplete = false;
    }

    // Cleanup function
    return () => {
      if (relaySearchTimeout) clearTimeout(relaySearchTimeout);
    };
  });

  // Normalize hashtag: strip #, lowercase, trim
  function normalizeHashtag(tag: string): string {
    return tag.toLowerCase().replace(/^#/, "").trim();
  }

  // Check if a tag already exists (case-insensitive)
  function tagExists(tag: string): boolean {
    const normalized = normalizeHashtag(tag);
    return formData.hashtags.some((t) => normalizeHashtag(t) === normalized);
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

  // Handle hashtag search (client-side filtering)
  $effect(() => {
    const query = hashtagSearchQuery.trim();

    if (query) {
      const normalized = normalizeHashtag(query);
      const results = commonHashtags.search(normalized, 10);
      hashtagSearchResults = results;
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
      formData.hashtags = [...formData.hashtags, normalized];
      resetHashtagInput();
    }
  }

  function resetHashtagInput() {
    hashtagSearchQuery = "";
    showHashtagAutocomplete = false;
    highlightedHashtagIndex = -1;
  }

  function handleHashtagKeydown(e: KeyboardEvent) {
    if (!showHashtagAutocomplete && e.key === "Enter" && hashtagSearchQuery.trim()) {
      e.preventDefault();
      addHashtag(hashtagSearchQuery);
      return;
    }

    if (!showHashtagAutocomplete) return;

    const totalOptions = getTotalHashtagOptions();
    const canCreate = canCreateCustomTag();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        highlightedHashtagIndex = Math.min(highlightedHashtagIndex + 1, totalOptions - 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        highlightedHashtagIndex = Math.max(highlightedHashtagIndex - 1, -1);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedHashtagIndex >= 0 && highlightedHashtagIndex < hashtagSearchResults.length) {
          addHashtag(hashtagSearchResults[highlightedHashtagIndex]);
        } else if (highlightedHashtagIndex === hashtagSearchResults.length && canCreate) {
          addHashtag(hashtagSearchQuery);
        } else if (canCreate) {
          addHashtag(hashtagSearchQuery);
        }
        break;
      case "Escape":
        e.preventDefault();
        resetHashtagInput();
        break;
    }
  }

  // Load repository references with robust fallback logic
  let availableRefs: Array<{
    name: string;
    type: "heads" | "tags";
    fullRef: string;
    commitId: string;
  }> = [];
  let loadingRefs = $state(true);

  type AvailableCommit = {
    oid?: string;
    message?: string;
    author?: string;
    timestamp?: number;
    commit?: {
      message?: string;
      author?: {
        name?: string;
        timestamp?: number;
      };
    };
  };

  const unwrapCommitHistory = (result: any): AvailableCommit[] => {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.commits)) return result.commits;
    return [];
  };

  const getCommitMessage = (commit: AvailableCommit) =>
    commit.message || commit.commit?.message || "";

  const getCommitAuthor = (commit: AvailableCommit) =>
    commit.author || commit.commit?.author?.name || "";

  const getCommitTimestamp = (commit: AvailableCommit) =>
    commit.timestamp || commit.commit?.author?.timestamp || 0;

  // Load commit history for earliest unique commit selection
  let availableCommits: AvailableCommit[] = [];
  let loadingCommits = $state(false);
  let commitSearchQuery = $state("");
  let showCommitDropdown = $state(false);
  let earliestUniqueCommitTouched = $state(false);

  // Load refs when component mounts
  $effect(() => {
    if (repo) {
      loadingRefs = true;
      repo
        .getAllRefsWithFallback()
        .then((refs) => {
          availableRefs = refs;
          loadingRefs = false;
        })
        .catch((error) => {
          console.error("Failed to load repository references:", error);
          availableRefs = [];
          loadingRefs = false;
        });
    }
  });

  // Auto-fill earliest unique commit from default branch's commitId when available
  $effect(() => {
    // Only set if empty and refs are loaded
    if (
      !loadingRefs &&
      !earliestUniqueCommitTouched &&
      !originalFormData.earliestUniqueCommit?.trim() &&
      !formData.earliestUniqueCommit?.trim() &&
      formData.defaultBranch
    ) {
      const ref = availableRefs.find(
        (r) => r.type === "heads" && r.name === formData.defaultBranch
      );
      const commitId = ref?.commitId || "";
      if (commitId && /^[a-f0-9]{40}$/i.test(commitId)) {
        formData.earliestUniqueCommit = commitId;
      }
    }
  });

  // Get available branches for dropdown
  let availableBranches = $derived(availableRefs.filter((ref) => ref.type === "heads"));

  // Load commits when default branch changes
  $effect(() => {
    if (repo && formData.defaultBranch && !loadingRefs) {
      console.log("[EditRepoPanel] Loading commits for branch:", formData.defaultBranch);
      loadingCommits = true;

      // First try to get already loaded commits
      const existingCommits = repo.commits;
      console.log("[EditRepoPanel] Existing commits:", existingCommits?.length);

      if (existingCommits && existingCommits.length > 0) {
        availableCommits = existingCommits;
        loadingCommits = false;
      } else {
        // Try to load commits
        repo
          .getCommitHistory({ branch: formData.defaultBranch, depth: 100 })
          .then((result) => {
            const commits = unwrapCommitHistory(result);
            console.log(
              "[EditRepoPanel] Loaded commits from getCommitHistory:",
              commits.length,
              result
            );
            availableCommits = commits.length > 0 ? commits : repo.commits || [];
            loadingCommits = false;
          })
          .catch((error) => {
            console.error("Failed to load commit history:", error);
            // Fallback to repo.commits
            availableCommits = repo.commits || [];
            loadingCommits = false;
          });
      }
    }
  });

  // Filter commits based on search query
  let filteredCommits = $derived.by(() => {
    console.log(
      "[EditRepoPanel] Filtering commits, query:",
      commitSearchQuery,
      "available:",
      availableCommits.length
    );
    if (!commitSearchQuery) {
      const results = availableCommits.slice(0, 20);
      console.log("[EditRepoPanel] No query, returning first 20:", results.length);
      return results;
    }
    const query = commitSearchQuery.toLowerCase();
    const results = availableCommits
      .filter((c) => {
        const oid = c.oid || "";
        const message = getCommitMessage(c);
        const author = getCommitAuthor(c);
        return (
          oid.toLowerCase().includes(query) ||
          message.toLowerCase().includes(query) ||
          author.toLowerCase().includes(query)
        );
      })
      .slice(0, 20);
    console.log("[EditRepoPanel] Filtered results:", results.length);
    return results;
  });

  // Helper functions for multi-value fields
  function addArrayItem(
    field: keyof Pick<FormData, "maintainers" | "relays" | "webUrls" | "cloneUrls" | "hashtags">
  ) {
    formData[field] = [...formData[field], ""];
  }

  function removeArrayItem(
    field: keyof Pick<FormData, "maintainers" | "relays" | "webUrls" | "cloneUrls" | "hashtags">,
    index: number
  ) {
    formData[field] = formData[field].filter((_, i) => i !== index);
  }

  function updateArrayItem(
    field: keyof Pick<FormData, "maintainers" | "relays" | "webUrls" | "cloneUrls" | "hashtags">,
    index: number,
    value: string
  ) {
    formData[field] = formData[field].map((item, i) => (i === index ? value : item));
  }

  let draggingCloneIndex = $state<number | null>(null);
  let dragOverCloneIndex = $state<number | null>(null);

  function moveCloneUrl(fromIndex: number, toIndex: number) {
    const next = [...formData.cloneUrls];
    if (fromIndex < 0 || fromIndex >= next.length) return;
    if (fromIndex === toIndex) return;
    const [moved] = next.splice(fromIndex, 1);
    let targetIndex = toIndex;
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex > next.length) targetIndex = next.length;
    next.splice(targetIndex, 0, moved);
    formData.cloneUrls = next;
  }

  function handleCloneDragStart(index: number, event: DragEvent) {
    if (isEditing) return;
    draggingCloneIndex = index;
    dragOverCloneIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
  }

  function handleCloneDragOver(index: number, event: DragEvent) {
    if (draggingCloneIndex === null || isEditing) return;
    event.preventDefault();
    dragOverCloneIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleCloneDrop(index: number, event: DragEvent) {
    if (draggingCloneIndex === null || isEditing) return;
    event.preventDefault();
    moveCloneUrl(draggingCloneIndex, index);
    draggingCloneIndex = null;
    dragOverCloneIndex = null;
  }

  function handleCloneDragEnd() {
    draggingCloneIndex = null;
    dragOverCloneIndex = null;
  }

  // UI state
  let validationErrors = $state<Record<string, string>>({});

  // Update form data when repo changes
  $effect(() => {
    if (repo && repo.repoEvent && !isEditing) {
      const next = extractCurrentValues();
      formData = cloneFormData(next);
      originalFormData = cloneFormData(next);
      commitSearchQuery = "";
      showCommitDropdown = false;
      earliestUniqueCommitTouched = false;
    }
  });

  function validateForm(): Record<string, string> {
    const errors: Record<string, string> = {};

    // Repository name validation
    if (!formData.name.trim()) {
      errors.name = "Repository name is required";
    } else if (formData.name.length < 1 || formData.name.length > 100) {
      errors.name = "Repository name must be between 1 and 100 characters";
    } else if (!/^[a-zA-Z0-9._-]+$/.test(formData.name)) {
      errors.name =
        "Repository name can only contain letters, numbers, dots, hyphens, and underscores";
    }

    // Description validation
    if (formData.description.length > 500) {
      errors.description = "Description must be 500 characters or less";
    }

    // Default branch validation
    if (!formData.defaultBranch.trim()) {
      errors.defaultBranch = "Default branch is required";
    } else if (!/^[a-zA-Z0-9._/-]+$/.test(formData.defaultBranch)) {
      errors.defaultBranch = "Invalid branch name format";
    }

    // Maintainers validation (accept npub or 64-char hex)
    const invalidMaintainers = (
      Array.isArray(formData.maintainers) ? formData.maintainers : []
    ).filter((m) => {
      const v = m?.trim?.();
      if (!v) return false;
      return !/^npub1[ac-hj-np-z02-9]{58}$/i.test(v) && !/^[a-fA-F0-9]{64}$/.test(v);
    });
    if (invalidMaintainers.length > 0) {
      errors.maintainers = "Maintainers must be npub or 64-char hex pubkeys";
    }

    // Relays validation (wss:// URLs)
    const invalidRelays = (Array.isArray(formData.relays) ? formData.relays : []).filter(
      (r) => r?.trim?.() && !r.match(/^wss?:\/\/.+/)
    );
    if (invalidRelays.length > 0) {
      errors.relays = "Relays must be valid WebSocket URLs (wss://...)";
    }

    // Web URLs validation
    const invalidWebUrls = (Array.isArray(formData.webUrls) ? formData.webUrls : []).filter(
      (w) => w?.trim?.() && !w.match(/^https?:\/\/.+/)
    );
    if (invalidWebUrls.length > 0) {
      errors.webUrls = "Web URLs must be valid HTTP/HTTPS URLs";
    }

    // Clone URLs validation
    const invalidCloneUrls = (Array.isArray(formData.cloneUrls) ? formData.cloneUrls : []).filter(
      (c) => c?.trim?.() && !c.match(/^(https?:\/\/|git@).+/)
    );
    if (invalidCloneUrls.length > 0) {
      errors.cloneUrls = "Clone URLs must be valid git URLs (https:// or git@...)";
    }

    // Hashtags validation (no spaces, alphanumeric + hyphens)
    const invalidHashtags = (Array.isArray(formData.hashtags) ? formData.hashtags : []).filter(
      (h) => h?.trim?.() && !h.match(/^[a-zA-Z0-9-]+$/)
    );
    if (invalidHashtags.length > 0) {
      errors.hashtags = "Hashtags can only contain letters, numbers, and hyphens";
    }

    // Earliest unique commit validation (40-character hex)
    if (
      formData.earliestUniqueCommit.trim() &&
      !formData.earliestUniqueCommit.match(/^[a-f0-9]{40}$/i)
    ) {
      errors.earliestUniqueCommit = "Must be a valid 40-character commit hash";
    }

    return errors;
  }

  // Validate form on input
  $effect(() => {
    validationErrors = validateForm();
  });

  const back = () => history.back();

  function handleCancel() {
    if (isPage) {
      formData = cloneFormData(originalFormData);
      commitSearchQuery = "";
      showCommitDropdown = false;
      earliestUniqueCommitTouched = false;
      return;
    }

    if (!isEditing) {
      back();
    }
  }

  // Keyboard navigation support
  function handleKeydown(event: KeyboardEvent) {
    if (isPage) return;

    if (event.key === "Escape" && !isEditing) {
      event.preventDefault();
      back();
    }
  }

  // Focus management
  let dialogElement = $state<HTMLDivElement>();
  $effect(() => {
    if (dialogElement && !isPage) {
      // Focus the first focusable element when dialog opens
      const firstFocusable = dialogElement.querySelector(
        'input, textarea, button, [tabindex]:not([tabindex="-1"])'
      ) as HTMLElement;
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }
  });

  async function handleSave() {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      validationErrors = errors;
      return;
    }

    try {
      // Filter out empty strings from arrays
      const cleanMaintainers = formData.maintainers.filter((m) => m.trim());
      const normalizedMaintainers = cleanMaintainers.map((m) => {
        const v = m.trim();
        if (/^npub1/i.test(v)) {
          try {
            const dec = nip19.decode(v);
            if (dec.type === "npub" && typeof dec.data === "string") {
              return dec.data.toLowerCase();
            }
          } catch {
            // Validation should have caught invalid npubs; keep original as a fallback.
          }
        }
        return v.toLowerCase();
      });
      const cleanWebUrls = formData.webUrls.filter((w) => w.trim());
      const cleanCloneUrls = formData.cloneUrls.filter((c) => c.trim());
      const cleanRelays = getEffectiveRepoRelayUrls(
        formData.relays.filter((r) => r.trim()),
        cleanCloneUrls
      );
      const cleanHashtags = formData.hashtags.filter((h) => h.trim());
      const previousName = originalFormData.name.trim();
      const nextName = formData.name.trim();
      const renamed = previousName !== nextName;

      // Create updated repository announcement event using all NIP-34 fields
      const updatedAnnouncementEvent = repo.createRepoAnnouncementEvent({
        name: nextName,
        description: formData.description,
        cloneUrl: cleanCloneUrls[0] ?? "", // Primary clone URL
        webUrl: cleanWebUrls[0] ?? "", // Primary web URL
        defaultBranch: formData.defaultBranch,
        maintainers: normalizedMaintainers,
        relays: cleanRelays,
        hashtags: cleanHashtags,
        earliestUniqueCommit: formData.earliestUniqueCommit.trim().toLowerCase() || undefined,
        community: getRepoCommunityOptionBinding(
          findRepoCommunityOption(communityOptions, formData.communityPubkey)
        ),
        // Include all URLs in the event
        web: cleanWebUrls,
        clone: cleanCloneUrls,
      });

      // Create updated repository state event using existing repo state
      // Convert ProcessedBranch[] to string[] for branch names
      const branchNames = repo.branches?.map((branch) => branch.name) || [];

      // Convert repo.state.refs to the expected format if available
      const refs =
        repo.refs?.map((ref) => ({
          type: ref.fullRef.startsWith("refs/heads/") ? ("heads" as const) : ("tags" as const),
          name: ref.fullRef.replace(/^refs\/(heads|tags)\//, ""),
          commit: ref.commitId,
          //ancestry: ref.lineage,
        })) || [];

      const updatedStateEvent = repo.createRepoStateEvent({
        repositoryId: nextName,
        headBranch: formData.defaultBranch,
        branches: branchNames,
        refs: refs,
      });

      // Sign and publish the events
      await onPublishEvent(updatedAnnouncementEvent);
      await onPublishEvent(updatedStateEvent);

      if (onSaveComplete) {
        await onSaveComplete({
          renamed,
          previousName,
          nextName,
          relays: cleanRelays,
        });
      }

      if (isPage) {
        originalFormData = cloneFormData(formData);
        return;
      }

      if (!renamed || !onSaveComplete) {
        back();
      }
    } catch (error) {
      console.error("Failed to save repository changes:", error);
    }
  }

  function handleRetry() {
    if (error && !isEditing) {
      handleSave();
    }
  }

  // Prevent panel close when editing
  function handleBackdropClick(event: MouseEvent) {
    if (isPage) return;

    if (event.target === event.currentTarget && !isEditing) {
      back();
    }
  }

  // Check if form has changes
  const isFormDirty = $derived.by(() => {
    const original = originalFormData;

    // Normalize arrays by trimming empties for fair comparison (handleSave filters them out)
    const norm = (arr: string[] | undefined | any) => {
      if (!arr) return [];
      if (!Array.isArray(arr)) return [];
      return arr.filter((v) => v && typeof v === "string" && v.trim());
    };

    const basicChanged =
      formData.name !== original.name ||
      formData.description !== original.description ||
      formData.visibility !== original.visibility ||
      formData.communityPubkey.trim().toLowerCase() !==
        original.communityPubkey.trim().toLowerCase() ||
      formData.defaultBranch !== original.defaultBranch ||
      formData.earliestUniqueCommit.trim().toLowerCase() !==
        original.earliestUniqueCommit.trim().toLowerCase();

    const arraysChanged =
      JSON.stringify(norm(formData.maintainers)) !== JSON.stringify(norm(original.maintainers)) ||
      JSON.stringify(norm(formData.relays)) !== JSON.stringify(norm(original.relays)) ||
      JSON.stringify(norm(formData.webUrls)) !== JSON.stringify(norm(original.webUrls)) ||
      JSON.stringify(norm(formData.cloneUrls)) !== JSON.stringify(norm(original.cloneUrls)) ||
      JSON.stringify(norm(formData.hashtags)) !== JSON.stringify(norm(original.hashtags));

    return basicChanged || arraysChanged;
  });

  // Check if form is valid
  const isFormValid = $derived.by(() => Object.keys(validationErrors).length === 0);
  const workflowScopeIssue = $derived.by(() =>
    Boolean(error && /workflow|\.github\/workflows/i.test(error))
  );
</script>

<!-- Edit Repository Panel -->
<div
  class={isPage
    ? "outline-none"
    : "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none isolate"}
  role={isPage ? undefined : "dialog"}
  aria-modal={isPage ? undefined : "true"}
  aria-labelledby="edit-repo-title"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div
    bind:this={dialogElement}
    class={isPage
      ? "ng-themed-modal bg-gray-900 rounded-lg shadow-xl w-full border border-gray-700 flex flex-col overflow-hidden"
      : "ng-themed-modal bg-gray-900 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] border border-gray-700 flex flex-col overflow-hidden relative z-[60]"}
    role={isPage ? undefined : "document"}
  >
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-700 sm:p-6">
      <div class="flex items-center space-x-3">
        <Settings class="w-6 h-6 text-blue-600 dark:text-blue-400" />
        <h2 id="edit-repo-title" class="text-xl font-semibold text-white">Edit Repository</h2>
      </div>
      {#if !isEditing && !isPage}
        <button
          onclick={handleCancel}
          class="text-gray-400 hover:text-gray-200 transition-colors"
          aria-label="Close panel"
        >
          <X class="w-5 h-5" />
        </button>
      {/if}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div class="p-4 space-y-6 sm:p-6">
        <!-- Repository Metadata -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Repository Name -->
          <div>
            <label for="repo-name" class="block text-sm font-medium text-gray-300 mb-2">
              Repository name *
            </label>
            <input
              id="repo-name"
              type="text"
              bind:value={formData.name}
              disabled={isEditing}
              class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              class:border-red-500={validationErrors.name}
              placeholder="Enter repository name"
              aria-describedby={validationErrors.name ? "repo-name-error" : undefined}
              aria-invalid={validationErrors.name ? "true" : "false"}
              required
            />
            {#if validationErrors.name}
              <p
                id="repo-name-error"
                class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
                role="alert"
                aria-live="polite"
              >
                <AlertCircle class="w-4 h-4" />
                <span>{validationErrors.name}</span>
              </p>
            {/if}
          </div>
        </div>

        <!-- Description -->
        <div>
          <label for="repo-description" class="block text-sm font-medium text-gray-300 mb-2">
            Description
          </label>
          <textarea
            id="repo-description"
            bind:value={formData.description}
            disabled={isEditing}
            rows="3"
            class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            class:border-red-500={validationErrors.description}
            placeholder="Enter repository description"
            aria-describedby={validationErrors.description ? "repo-description-error" : undefined}
            aria-invalid={validationErrors.description ? "true" : "false"}
          ></textarea>
          {#if validationErrors.description}
            <p
              id="repo-description-error"
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.description}</span>
            </p>
          {/if}
        </div>

        <RepoCommunitySelect
          options={communityOptions}
          bind:value={formData.communityPubkey}
          label="Repository community"
          description="Set, change, or remove the community bound to this repository identity."
          disabled={isEditing}
        />

        <!-- Default Branch -->
        <div>
          <label for="default-branch" class="block text-sm font-medium text-gray-300 mb-2">
            <GitBranch class="w-4 h-4 inline mr-1" />
            Default branch *
          </label>
          {#if !loadingRefs && availableBranches.length > 0}
            <!-- Dropdown menu for existing branches -->
            <select
              id="default-branch"
              bind:value={formData.defaultBranch}
              disabled={isEditing}
              class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              class:border-red-500={validationErrors.defaultBranch}
              aria-describedby={validationErrors.defaultBranch ? "default-branch-error" : undefined}
              aria-invalid={validationErrors.defaultBranch ? "true" : "false"}
              required
            >
              <option value="" disabled>Select a branch</option>
              {#each availableBranches as branch}
                <option value={branch.name}>
                  {branch.name}
                  {#if branch.name === repo.mainBranch || branch.fullRef === repo.mainBranch}
                    (current default)
                  {/if}
                </option>
              {/each}
            </select>
          {:else if loadingRefs}
            <!-- Loading state -->
            <div
              class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-400 flex items-center space-x-2"
            >
              <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span>Loading branches...</span>
            </div>
          {:else}
            <!-- Fallback text input when no branches are available -->
            <input
              id="default-branch"
              type="text"
              bind:value={formData.defaultBranch}
              disabled={isEditing}
              class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              class:border-red-500={validationErrors.defaultBranch}
              placeholder="main"
              aria-describedby={validationErrors.defaultBranch ? "default-branch-error" : undefined}
              aria-invalid={validationErrors.defaultBranch ? "true" : "false"}
              required
            />
            <p class="text-gray-400 text-xs mt-1">
              No branches loaded. Enter branch name manually.
            </p>
          {/if}
          {#if validationErrors.defaultBranch}
            <p
              id="default-branch-error"
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.defaultBranch}</span>
            </p>
          {/if}
        </div>

        <!-- Maintainers -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            <Users class="w-4 h-4 inline mr-1" />
            Maintainers
          </label>

          <PeoplePicker
            selected={formData.maintainers as any}
            placeholder="Add maintainer (npub or search)..."
            disabled={isEditing}
            maxSelections={50}
            showAvatars={true}
            showSuggestionsOnFocus={true}
            compact={false}
            getProfile={getProfile}
            searchProfiles={searchProfiles}
            add={(pubkey: string) => {
              if (!formData.maintainers.includes(pubkey)) {
                formData.maintainers = [...formData.maintainers, pubkey];
              }
            }}
            {...{
              remove: (pubkey: string) => {
                formData.maintainers = formData.maintainers.filter((p) => p !== pubkey);
              },
            } as any}
            onDeleteLabel={(evt) => {
              const pubkey = evt.tags?.find((t) => t[0] === "p")?.[1];
              if (pubkey) {
                formData.maintainers = formData.maintainers.filter((p) => p !== pubkey);
              }
            }}
          />

          {#if validationErrors.maintainers}
            <p
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.maintainers}</span>
            </p>
          {/if}
        </div>

        <!-- Relays -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            <Globe class="w-4 h-4 inline mr-1" />
            Relays
          </label>
          <div class="space-y-2">
            {#each mandatoryGraspRelays as relayUrl}
              <div class="flex min-w-0 items-center space-x-2">
                <input
                  type="text"
                  value={relayUrl}
                  readonly
                  aria-label="GRASP target relay"
                  class="min-w-0 flex-1 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-blue-700 placeholder-gray-400 focus:outline-none dark:bg-gray-800/60 dark:text-blue-300"
                />
                <span
                  class="shrink-0 whitespace-nowrap rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-1 text-[10px] text-blue-700 dark:text-blue-300 sm:px-2 sm:text-xs"
                >
                  GRASP target
                </span>
              </div>
            {/each}

            {#each formData.relays as relay, index}
              <div class="flex min-w-0 items-center space-x-2">
                <input
                  type="text"
                  bind:value={formData.relays[index]}
                  oninput={(e) =>
                    updateArrayItem("relays", index, (e.target as HTMLInputElement).value)}
                  disabled={isEditing}
                  class="min-w-0 flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="wss://relay.example.com"
                />
                <button
                  type="button"
                  onclick={() => removeArrayItem("relays", index)}
                  disabled={isEditing}
                  class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Remove relay"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            {/each}

            <!-- Autocomplete input for adding relays -->
            {#if searchRelays}
              <div class="relative">
                <input
                  type="text"
                  bind:value={relaySearchQuery}
                  onfocus={() => (showRelayAutocomplete = relaySearchResults.length > 0)}
                  onblur={() => setTimeout(() => (showRelayAutocomplete = false), 200)}
                  disabled={isEditing}
                  autocomplete="off"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Search for relays..."
                />
                {#if showRelayAutocomplete && relaySearchResults.length > 0}
                  <div
                    class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  >
                    {#each relaySearchResults as relayUrl}
                      <button
                        type="button"
                        onclick={() => {
                          if (!hasRelay(relayUrl)) {
                            formData.relays = [...formData.relays, relayUrl];
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
                onclick={() => addArrayItem("relays")}
                disabled={isEditing}
                class="flex items-center space-x-2 px-3 py-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus class="w-4 h-4" />
                <span>Add relay</span>
              </button>
            {/if}
          </div>
          {#if validationErrors.relays}
            <p
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.relays}</span>
            </p>
          {/if}
        </div>

        <!-- Web URLs -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            <Globe class="w-4 h-4 inline mr-1" />
            Web URLs
          </label>
          <div class="space-y-2">
            {#each formData.webUrls as webUrl, index}
              <div class="flex items-center space-x-2">
                <input
                  type="text"
                  bind:value={formData.webUrls[index]}
                  oninput={(e) =>
                    updateArrayItem("webUrls", index, (e.target as HTMLInputElement).value)}
                  disabled={isEditing}
                  class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="https://github.com/user/repo"
                />
                <button
                  type="button"
                  onclick={() => removeArrayItem("webUrls", index)}
                  disabled={isEditing}
                  class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Remove web URL"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            {/each}
            <button
              type="button"
              onclick={() => addArrayItem("webUrls")}
              disabled={isEditing}
              class="flex items-center space-x-2 px-3 py-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus class="w-4 h-4" />
              <span>Add web URL</span>
            </button>
          </div>
          {#if validationErrors.webUrls}
            <p
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.webUrls}</span>
            </p>
          {/if}
        </div>

        <!-- Clone URLs -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            <Link class="w-4 h-4 inline mr-1" />
            Clone URLs
          </label>
          <div class="space-y-2">
            {#each formData.cloneUrls as cloneUrl, index}
              {@const isCloneDragOver = dragOverCloneIndex === index && draggingCloneIndex !== null}
              {@const isFirstClone = index === 0}
              {@const isLastClone = index === formData.cloneUrls.length - 1}
              <div
                role="listitem"
                class={`flex min-w-0 items-center space-x-2 rounded-lg ${
                  isCloneDragOver ? "bg-gray-800/40 ring-1 ring-blue-500/40" : ""
                }`}
                ondragover={(event) => handleCloneDragOver(index, event)}
                ondrop={(event) => handleCloneDrop(index, event)}
              >
                <button
                  type="button"
                  draggable={!isEditing}
                  disabled={isEditing}
                  aria-label="Reorder clone URL"
                  aria-grabbed={draggingCloneIndex === index ? "true" : "false"}
                  ondragstart={(event) => handleCloneDragStart(index, event)}
                  ondragend={handleCloneDragEnd}
                  class="hidden p-2 text-gray-400 hover:text-gray-200 cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed sm:block"
                  title="Drag to reorder"
                >
                  <GripVertical class="w-4 h-4" />
                </button>
                <div class="flex flex-col gap-1 sm:hidden">
                  <button
                    type="button"
                    onclick={() => moveCloneUrl(index, index - 1)}
                    disabled={isEditing || isFirstClone}
                    class="p-1 text-gray-400 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Move clone URL up"
                    title="Move up"
                  >
                    <ChevronUp class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onclick={() => moveCloneUrl(index, index + 1)}
                    disabled={isEditing || isLastClone}
                    class="p-1 text-gray-400 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Move clone URL down"
                    title="Move down"
                  >
                    <ChevronDown class="w-4 h-4" />
                  </button>
                </div>
                <div class="min-w-0 flex-1 space-y-1.5">
                  {#if index === 0}
                    <span
                      class="inline-flex w-fit rounded border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                    >
                      Primary clone URL
                    </span>
                  {/if}
                  <div class="min-w-0">
                    <input
                      type="text"
                      bind:value={formData.cloneUrls[index]}
                      oninput={(e) =>
                        updateArrayItem("cloneUrls", index, (e.target as HTMLInputElement).value)}
                      disabled={isEditing}
                      class="min-w-0 w-full flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="https://github.com/user/repo.git"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onclick={() => removeArrayItem("cloneUrls", index)}
                  disabled={isEditing}
                  class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Remove clone URL"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            {/each}
            <button
              type="button"
              onclick={() => addArrayItem("cloneUrls")}
              disabled={isEditing}
              class="flex items-center space-x-2 px-3 py-2 text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus class="w-4 h-4" />
              <span>Add clone URL</span>
            </button>
          </div>
          {#if validationErrors.cloneUrls}
            <p
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.cloneUrls}</span>
            </p>
          {/if}
        </div>

        <!-- Hashtags -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">
            <Hash class="w-4 h-4 inline mr-1" />
            Hashtags
          </label>
          <div class="space-y-2">
            {#each formData.hashtags as hashtag, index}
              <div class="flex items-center space-x-2">
                <input
                  type="text"
                  bind:value={formData.hashtags[index]}
                  oninput={(e) =>
                    updateArrayItem("hashtags", index, (e.target as HTMLInputElement).value)}
                  disabled={isEditing}
                  class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="javascript"
                />
                <button
                  type="button"
                  onclick={() => removeArrayItem("hashtags", index)}
                  disabled={isEditing}
                  class="p-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Remove hashtag"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            {/each}

            <!-- Autocomplete input for adding hashtags -->
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
                disabled={isEditing}
                autocomplete="off"
                class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Search or type to add tags (press Enter)"
              />
              {#if showHashtagAutocomplete}
                <div
                  class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                >
                  {#each hashtagSearchResults as tag, index}
                    {@const isAlreadyAdded = tagExists(tag)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlightedHashtagIndex}
                      disabled={isAlreadyAdded}
                      onmousedown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isAlreadyAdded) {
                          addHashtag(tag);
                        }
                      }}
                      class="w-full text-left px-3 py-2 text-sm flex items-center gap-2
                             {index === highlightedHashtagIndex
                        ? 'bg-gray-700'
                        : 'hover:bg-gray-700'}
                             {isAlreadyAdded ? 'opacity-50 cursor-not-allowed' : ''}"
                    >
                      <Hash class="w-3 h-3 text-gray-400" />
                      {tag}
                      {#if isAlreadyAdded}
                        <span class="text-xs text-gray-400 ml-auto">(already added)</span>
                      {/if}
                    </button>
                  {/each}
                  {#if canCreateCustomTag()}
                    <button
                      type="button"
                      role="option"
                      aria-selected={highlightedHashtagIndex === hashtagSearchResults.length}
                      onmousedown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        addHashtag(hashtagSearchQuery);
                      }}
                      class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-t border-gray-700
                             {highlightedHashtagIndex === hashtagSearchResults.length
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
          </div>
          {#if validationErrors.hashtags}
            <p
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.hashtags}</span>
            </p>
          {/if}
        </div>

        <!-- Earliest Unique Commit -->
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
                commitSearchQuery = formData.earliestUniqueCommit || "";
                showCommitDropdown = availableCommits.length > 0;
              }}
              oninput={() => {
                earliestUniqueCommitTouched = true;
                formData.earliestUniqueCommit = commitSearchQuery.trim();
              }}
              onblur={() => setTimeout(() => (showCommitDropdown = false), 200)}
              disabled={isEditing || loadingCommits}
              autocomplete="off"
              class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
              class:border-red-500={validationErrors.earliestUniqueCommit}
              placeholder={formData.earliestUniqueCommit ||
                "Search commits or paste commit hash..."}
              aria-describedby={validationErrors.earliestUniqueCommit
                ? "earliest-commit-error"
                : undefined}
              aria-invalid={validationErrors.earliestUniqueCommit ? "true" : "false"}
            />
            {#if showCommitDropdown && filteredCommits.length > 0}
              <div
                class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto"
              >
                {#each filteredCommits as commit}
                  <button
                    type="button"
                    onclick={() => {
                      const oid = commit.oid || "";
                      if (!oid) return;
                      earliestUniqueCommitTouched = true;
                      formData.earliestUniqueCommit = oid;
                      commitSearchQuery = oid;
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
                          {getCommitMessage(commit).split("\n")[0] || "No message"}
                        </div>
                        <div class="text-xs text-gray-400 mt-0.5">
                          {getCommitAuthor(commit) || "Unknown"} · {new Date(
                            getCommitTimestamp(commit) * 1000
                          ).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          {#if formData.earliestUniqueCommit}
            <div
              class="mt-2 p-2 bg-gray-800/50 rounded text-xs font-mono text-gray-300 flex items-center justify-between"
            >
              <span class="truncate">{formData.earliestUniqueCommit}</span>
              <button
                type="button"
                onclick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  earliestUniqueCommitTouched = true;
                  formData.earliestUniqueCommit = "";
                  commitSearchQuery = "";
                  showCommitDropdown = false;
                }}
                class="ml-2 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex-shrink-0"
                aria-label="Clear commit"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          {/if}
          {#if validationErrors.earliestUniqueCommit}
            <p
              id="earliest-commit-error"
              class="text-red-700 dark:text-red-400 text-sm mt-1 flex items-center space-x-1"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle class="w-4 h-4" />
              <span>{validationErrors.earliestUniqueCommit}</span>
            </p>
          {/if}
          <p class="text-gray-400 text-xs mt-1">
            The commit ID of the earliest unique commit to identify this repository among forks
          </p>
        </div>

        {#if onRequestDelete}
          <div class="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-600/40 dark:bg-red-950/30">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <h3 class="font-semibold text-red-700 dark:text-red-300">Danger Zone</h3>
                <p class="mt-1 text-sm text-red-700/80 dark:text-red-200/80">
                  Delete this repository and its related Nostr events. This action cannot be undone.
                </p>
                {#if !canDelete}
                  <p class="mt-2 text-sm text-red-700/70 dark:text-red-200/70">
                    Only the repository owner can delete it.
                  </p>
                {/if}
              </div>
              <button
                type="button"
                onclick={onRequestDelete}
                disabled={isEditing || !canDelete}
                class="flex w-full shrink-0 items-center justify-center space-x-2 rounded-lg bg-red-600 px-3 py-2 !text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Trash2 class="w-4 h-4" />
                <span>Delete repo</span>
              </button>
            </div>
          </div>
        {/if}

        <!-- Progress Display -->
        {#if isEditing && progress}
          <div class="space-y-4">
            <div class="flex items-center space-x-3">
              {#if progress.isComplete}
                <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
                <span class="text-green-700 dark:text-green-400 font-medium">
                  Repository updated successfully!
                </span>
              {:else}
                <Loader2 class="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                <span class="text-white">{progress.stage}</span>
              {/if}
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-700 rounded-full h-2">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style="width: {progress.percentage}%"
              ></div>
            </div>
            <div class="text-right text-sm text-gray-400">
              {Math.round(progress.percentage)}%
            </div>
          </div>
        {/if}

        <!-- Error Display -->
        {#if error}
          <div
            class="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-500 dark:bg-red-900/50"
          >
            <div class="flex items-start space-x-3">
              <AlertCircle class="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div class="flex-1">
                <h4 class="text-red-800 dark:text-red-400 font-medium mb-1">Update Failed</h4>
                <p class="text-red-700 dark:text-red-300 text-sm">{error}</p>
                {#if workflowScopeIssue}
                  <div class="mt-3 text-xs text-red-700/80 dark:text-red-200/80">
                    GitHub requires the workflow token scope to push files under
                    <span class="font-mono">.github/workflows</span>.
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
                {#if !isEditing}
                  <button
                    onclick={handleRetry}
                    class="mt-3 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm underline"
                  >
                    Try again
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    {#if !progress?.isComplete}
      <div class="flex flex-col gap-4 p-4 border-t border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div class="text-sm text-gray-400 sm:min-w-0">
          {#if isFormDirty}
            <span class="text-yellow-700 dark:text-yellow-400">• Unsaved changes</span>
          {:else}
            <span>No changes</span>
          {/if}
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-3 sm:gap-0">
          <button
            onclick={handleCancel}
            disabled={isEditing}
            class="w-full px-4 py-2 text-center text-gray-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
          >
            {isPage ? "Reset" : "Cancel"}
          </button>
          <button
            onclick={handleSave}
            disabled={isEditing || !isFormValid || !isFormDirty}
            class="flex w-full items-center justify-center space-x-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 !text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {#if isEditing}
              <Loader2 class="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            {:else}
              <Save class="w-4 h-4" />
              <span>Save Changes</span>
            {/if}
          </button>
        </div>
      </div>
    {:else}
      <div class="flex items-center justify-end p-4 border-t border-gray-700 sm:p-6">
        <button
          onclick={back}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 !text-white rounded-lg transition-colors flex items-center space-x-2"
        >
          <CheckCircle2 class="w-4 h-4" />
          <span>Done</span>
        </button>
      </div>
    {/if}
  </div>
</div>
