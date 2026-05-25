import type {
  IssueEvent,
  RepoAnnouncement,
  RepoCommunityBinding,
  RepoState,
  RepoAnnouncementEvent,
  RepoStateEvent,
  StatusEvent,
  CommentEvent,
  LabelEvent,
} from "@nostr-git/core/events";
import type { Readable } from "svelte/store";
import {
  createPermissionDeniedError,
  RetriableError,
  UserActionableError,
  FatalError,
  GitErrorCode,
} from "@nostr-git/core/errors";

import {
  parseRepoAnnouncementEvent,
  parseRepoStateEvent,
  createRepoAnnouncementEvent,
  createRepoStateEvent,
} from "@nostr-git/core/events";
import { nip19 } from "nostr-tools";
import { parseRepoId } from "@nostr-git/core/utils";
import { context } from "$lib/stores/context";
import { toast } from "$lib/stores/toast";
import type { Token } from "$lib/stores/tokens";
import { tokens } from "$lib/stores/tokens";
import { tryTokensForHost } from "$lib/utils/tokenHelpers";
import { WorkerManager, type WorkerProgressEvent, type CloneProgress } from "./WorkerManager";
import { CacheManager, MergeAnalysisCacheManager, CacheType } from "./CacheManager";
import { CommitManager } from "./CommitManager";
import { BranchManager, type RefDiscoverySource } from "./BranchManager";
import { FileManager } from "./FileManager";
import {
  RepoCore,
  type RepoContext,
  type EffectiveLabelsV2,
  detectVendorFromUrl,
  extractHostname,
} from "@nostr-git/core/git";
import { VendorReadRouter } from "./VendorReadRouter";
import { isDisplayableGitRef, normalizeGitRefName } from "./branch-ref";
import { resolvePreferredBranchFromRefs } from "./branch-selection";
import { resolveLoadPageBranch } from "./load-page-branch";
import {
  disposeSubscriptions,
  getRepoStateEventsSignature,
  getRepoStateSnapshotSignature,
} from "./repo-runtime-utils";
import { isGraspRepoHttpUrl } from "$lib/utils/grasp-url";
import {
  getSelectedBranchPreference,
  setSelectedBranchPreference,
} from "$lib/stores/branchPreferences";

export type PushFanoutMode = "best-effort" | "all-or-nothing";

export interface PushFanoutResult {
  branch: string;
  results: Array<{
    remoteUrl: string;
    provider?: string;
    host?: string;
    success: boolean;
    error?: unknown;
  }>;
  anySucceeded: boolean;
  allSucceeded: boolean;
}

export class Repo {
  name: string = $state("");
  description: string = $state("");
  key: string = $state("");
  issues = $state<IssueEvent[]>([]);
  hashtags = $state<string[]>([]);
  tokens = $state<Token[]>([]);
  refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> = $state(
    []
  );
  earliestUniqueCommit: string = $state("");
  createdAt: string = $state("");
  clone: string[] = $state([]);
  web: string[] = $state([]);
  address: string = $state("");
  community: RepoCommunityBinding | undefined = $state(undefined);
  viewerPubkey: string | null = $state(null);
  editable: boolean = $state(false);

  // User identity for git commit operations (author name and email)
  authorName: string = $state("");
  authorEmail: string = $state("");

  repoEvent: RepoAnnouncementEvent | undefined = $state(undefined);
  #repo: RepoAnnouncement | undefined = $state(undefined);
  #repoStateEvent: RepoStateEvent | undefined = $state(undefined);
  #state: RepoState | undefined = $state(undefined);

  // Clone URL error tracking - surfaces 404s and other errors to the UI
  #cloneUrlErrors: Array<{ url: string; error: string; status?: number }> = $state([]);
  #effectiveCloneUrls: string[] = $state([]);
  currentReadRemoteUrl: string = $state("");

  // Reactive selected branch so UI can respond to changes
  #selectedBranchState: string | undefined = $state(undefined);
  #branchSwitching: boolean = $state(false);
  #refsLoading: boolean = $state(false);
  #refsSeededFromHead: boolean = $state(false);
  // Counter that increments when branch switch completes - components can track this
  #branchChangeTrigger: number = $state(0);
  // Reactive commits state so UI can respond to branch changes
  #commitsState: any[] = $state([]);
  #totalCommitsState: number | undefined = $state(undefined);
  #hasMoreCommitsState: boolean = $state(false);
  // Optional multi-state/status/comments/labels streams
  #repoStateEventsArr = $state<RepoStateEvent[] | undefined>(undefined);
  #pendingRepoStateEvent: RepoStateEvent | undefined;
  #statusEventsArr = $state<StatusEvent[] | undefined>(undefined);
  #commentEventsArr = $state<CommentEvent[] | undefined>(undefined);
  #labelEventsArr = $state<LabelEvent[] | undefined>(undefined);

  // Manager components
  workerManager!: WorkerManager;
  cacheManager!: CacheManager;
  mergeAnalysisCacheManager!: MergeAnalysisCacheManager;
  commitManager!: CommitManager;
  branchManager!: BranchManager;
  fileManager!: FileManager;
  vendorReadRouter!: VendorReadRouter;

  // Private caches used across helpers
  #repoStateRefsCache:
    | Map<string, { commitId: string; type: "heads" | "tags"; fullRef: string }>
    | undefined;
  #statusCache: Map<
    string,
    {
      state: "open" | "draft" | "closed" | "merged" | "resolved";
      by: string;
      at: number;
      eventId: string;
    } | null
  > = new Map();
  #issueThreadCache: Map<string, { rootId: string; comments: CommentEvent[] }> = new Map();
  #labelsCache: Map<string, EffectiveLabelsV2> = new Map();

  // Cached resolved branch to avoid redundant fallback iterations
  #resolvedDefaultBranch: string | null = null;
  #branchResolutionTimestamp: number = 0;
  #branchResolutionTTL = 5 * 60 * 1000; // 5 minutes cache TTL

  #loadingIds = {
    commits: null as string | null,
    branches: null as string | null,
    clone: null as string | null,
  };
  #storeUnsubs: Array<() => void> = [];
  #repoStateEventsSignature = "";
  #repoStateSnapshotSignature = "";

  // Clone progress state
  cloneProgress = $state<CloneProgress>({
    isCloning: false,
    phase: "",
    progress: 0,
  });

  // Initialization state - tracks when repo is ready for operations
  #initPromise: Promise<void> | null = null;
  #initResolve: (() => void) | null = null;
  #initReject: ((error: Error) => void) | null = null;
  isInitialized = $state(false);

  syncStatus: any = $state(null);
  refDiscoverySource = $state<RefDiscoverySource | null>(null);

  #updateEditable() {
    const viewer = this.viewerPubkey;
    this.editable = !!(viewer && this.isAuthorized(viewer));
  }

  #trackStoreSubscription(unsubscribe?: (() => void) | void) {
    if (typeof unsubscribe === "function") {
      this.#storeUnsubs.push(unsubscribe);
    }
  }

  #updateRepoStateSnapshotSignature(
    refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>
  ): boolean {
    const nextSignature = getRepoStateSnapshotSignature(refs);
    const changed = nextSignature !== this.#repoStateSnapshotSignature;
    this.#repoStateSnapshotSignature = nextSignature;
    return changed;
  }

  #processRepoStateEvent(
    event: RepoStateEvent,
    initialRepoEvent: RepoAnnouncementEvent | null
  ): void {
    if (this.#repoStateEvent?.id === event.id) return;

    console.log(
      `[Repo] repoStateEvent subscription fired:`,
      `has event with ${event.tags?.length || 0} tags`
    );
    this.#repoStateEvent = event;
    this.#state = parseRepoStateEvent(event);

    const parsedState = this.#state;
    let repoStateSnapshotChanged = false;
    console.log(`[Repo] Parsed state refs:`, parsedState?.refs?.length || 0);
    if (parsedState?.refs && parsedState.refs.length > 0) {
      const immediateRefs = parsedState.refs
        .filter((r: any) => r.ref && r.commit)
        .map((r: any) => {
          const parts = r.ref.split("/");
          const type = parts[1] === "heads" ? "heads" : parts[1] === "tags" ? "tags" : "heads";
          const name = parts.slice(2).join("/");
          return {
            name,
            type: type as "heads" | "tags",
            fullRef: r.ref,
            commitId: r.commit,
          };
        })
        .filter((r: any) => r.name)
        .filter((r: any) => isDisplayableGitRef(r));
      const sortedImmediateRefs = immediateRefs.sort((a, b) => {
        if (a.type !== b.type) return a.type === "heads" ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });
      repoStateSnapshotChanged = this.#updateRepoStateSnapshotSignature(sortedImmediateRefs);
      if (repoStateSnapshotChanged || this.refs.length === 0 || this.#refsSeededFromHead) {
        this.refs = sortedImmediateRefs;
        this.#refsSeededFromHead = false;
        console.log(`⚡ Instantly loaded ${this.refs.length} refs from owner RepoStateEvent`);
        this.refDiscoverySource = {
          kind: "repo-state",
          label: "Repo state snapshot",
          details: "Using owner-signed repo-state refs until remote discovery confirms the live ref set.",
        };
      }
      this.#maybeSelectBranchFromRefs(sortedImmediateRefs, parsedState?.head);
    } else {
      repoStateSnapshotChanged = this.#updateRepoStateSnapshotSignature([]);
      this.#seedRefsFromHead(parsedState?.head);
    }

    if (initialRepoEvent) {
      void this.branchManager.processRepoStateEventVerified(event, initialRepoEvent);
      if (repoStateSnapshotChanged && this.workerManager.isReady && !this.#refsLoading) {
        void this.#loadBranchesFromRepo(initialRepoEvent);
      }
    } else {
      this.branchManager.processRepoStateEvent(event);
    }

    this.invalidateBranchCache();
  }

  #processOwnerRepoStateEvents(
    nextRepoStateEvents: RepoStateEvent[] | undefined,
    initialRepoEvent: RepoAnnouncementEvent | null
  ): void {
    if (!nextRepoStateEvents || nextRepoStateEvents.length === 0) {
      this.#repoStateRefsCache = undefined;
      if (this.#updateRepoStateSnapshotSignature([])) {
        this.#seedRefsFromHead(this.#state?.head);
      }
      return;
    }

    if (!this.getOwnerPubkey()) return;

    const ownerStateEvent = RepoCore.selectOwnerRepoStateEvent(
      this.#coreCtx(),
      nextRepoStateEvents
    );
    const stateRefs = RepoCore.getRepoStateRefs(ownerStateEvent);
    this.#repoStateRefsCache = stateRefs;

    if (stateRefs.size > 0) {
      const immediateRefs: Array<{
        name: string;
        type: "heads" | "tags";
        fullRef: string;
        commitId: string;
      }> = [];
      for (const [key, ref] of stateRefs.entries()) {
        const name = key.split(":")[1];
        if (name && ref.type) {
          const nextRef = {
            name,
            type: ref.type,
            fullRef: ref.fullRef,
            commitId: ref.commitId,
          };
          if (isDisplayableGitRef(nextRef)) {
            immediateRefs.push(nextRef);
          }
        }
      }
      const sortedImmediateRefs = immediateRefs.sort((a, b) => {
        if (a.type !== b.type) return a.type === "heads" ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });
      const repoStateSnapshotChanged = this.#updateRepoStateSnapshotSignature(sortedImmediateRefs);
      if (repoStateSnapshotChanged || this.refs.length === 0 || this.#refsSeededFromHead) {
        this.refs = sortedImmediateRefs;
        this.#refsSeededFromHead = false;
        console.log(`⚡ Instantly loaded ${this.refs.length} refs from owner RepoStateEvent`);
        this.refDiscoverySource = {
          kind: "repo-state",
          label: "Repo state snapshot",
          details: "Using owner-signed repo-state refs until remote discovery confirms the live ref set.",
        };
      }
      this.#maybeSelectBranchFromRefs(
        sortedImmediateRefs,
        this.#getHeadHintFromRepoStateEvent(ownerStateEvent) || this.#state?.head
      );
      if (
        repoStateSnapshotChanged &&
        this.workerManager.isReady &&
        initialRepoEvent &&
        !this.#refsLoading
      ) {
        void this.#loadBranchesFromRepo(initialRepoEvent);
      }
    } else if (this.#updateRepoStateSnapshotSignature([])) {
      this.#seedRefsFromHead(this.#state?.head);
    }
  }

  #getBranchSelectionStorageKeys(): string[] {
    const identities = new Set<string>();
    for (const value of [this.address, this.key, this.repoEvent?.id]) {
      const normalized = String(value || "").trim();
      if (normalized) identities.add(normalized);
    }
    return Array.from(identities).map((identity) => `nostr-git:selected-ref:${identity}`);
  }

  #getBranchPreferenceKeys(): string[] {
    const keys = new Set<string>();
    for (const value of [this.address, this.key]) {
      const normalized = String(value || "").trim();
      if (normalized) keys.add(normalized);
    }

    return Array.from(keys);
  }

  #readLegacyPersistedSelectedBranch(): string {
    if (typeof window === "undefined") return "";

    try {
      for (const key of this.#getBranchSelectionStorageKeys()) {
        const branch = normalizeGitRefName(window.localStorage.getItem(key) || "");
        if (branch) return branch;
      }
    } catch {
      return "";
    }

    return "";
  }

  #readPersistedSelectedBranch(): string {
    const repoKeys = this.#getBranchPreferenceKeys();
    for (const repoKey of repoKeys) {
      const branch = getSelectedBranchPreference(repoKey);
      if (branch) return branch;
    }

    const legacyBranch = this.#readLegacyPersistedSelectedBranch();
    if (legacyBranch) {
      for (const repoKey of repoKeys) {
        setSelectedBranchPreference(repoKey, legacyBranch);
      }
    }

    return legacyBranch;
  }

  #persistSelectedBranch(branchName?: string): void {
    const branch = normalizeGitRefName(branchName || "");
    if (!branch) return;

    for (const repoKey of this.#getBranchPreferenceKeys()) {
      setSelectedBranchPreference(repoKey, branch);
    }
  }

  #restorePersistedSelectedBranch(): boolean {
    const branch = this.#readPersistedSelectedBranch();
    if (!branch) return false;

    const exists = (this.refs || []).some(
      (ref) => (ref.type === "heads" || ref.type === "tags") && ref.name === branch
    );
    if (!exists) return false;

    this.branchManager.setSelectedBranch(branch);
    const previousBranch = this.#selectedBranchState;
    this.#selectedBranchState = branch;
    if (previousBranch !== branch) {
      this.#branchChangeTrigger++;
    }
    return true;
  }

  hasRestorablePersistedSelectedBranch(): boolean {
    const branch = this.#readPersistedSelectedBranch();
    if (!branch) return false;

    return (this.refs || []).some(
      (ref) => (ref.type === "heads" || ref.type === "tags") && ref.name === branch
    );
  }

  assertEditable(action: string = "edit") {
    if (!this.editable) {
      const error = createPermissionDeniedError();
      error.message = `You do not have permission to ${action} for repo ${this.key || this.name || "repository"}`;
      throw error;
    }
  }

  constructor({
    repoEvent,
    repoStateEvent,
    issues,
    repoStateEvents,
    statusEvents,
    commentEvents,
    labelEvents,
    viewerPubkey,
    workerConfig,
    workerManager: existingWorkerManager,
    authorName: initialAuthorName,
    authorEmail: initialAuthorEmail,
  }: {
    repoEvent: Readable<RepoAnnouncementEvent>;
    repoStateEvent: Readable<RepoStateEvent>;
    issues: Readable<IssueEvent[]>;
    repoStateEvents?: Readable<RepoStateEvent[]>;
    statusEvents?: Readable<StatusEvent[]>;
    commentEvents?: Readable<CommentEvent[]>;
    labelEvents?: Readable<LabelEvent[]>;
    viewerPubkey?: Readable<string | null>;
    workerConfig?: { workerFactory?: () => Worker; workerUrl?: string | URL };
    /** Optional: pass an existing WorkerManager to share across Repo instances */
    workerManager?: WorkerManager;
    /** User's display name for git commit author */
    authorName?: string;
    /** User's email (nip-05 or npub-based) for git commit author */
    authorEmail?: string;
  }) {
    // Set author info if provided
    if (initialAuthorName) this.authorName = initialAuthorName;
    if (initialAuthorEmail) this.authorEmail = initialAuthorEmail;
    // Use provided WorkerManager or create a new one
    if (existingWorkerManager) {
      this.workerManager = existingWorkerManager;
      // Set up progress callback on the shared manager
      this.workerManager.setProgressCallback((progressEvent: WorkerProgressEvent) => {
        console.log(`Clone progress for ${progressEvent.repoId}: ${progressEvent.phase}`);
        this.cloneProgress = {
          isCloning: true,
          phase: progressEvent.phase,
          progress: progressEvent.progress,
        };
      });
    } else {
      // Initialize WorkerManager with optional worker config from consuming app
      this.workerManager = new WorkerManager((progressEvent: WorkerProgressEvent) => {
        console.log(`Clone progress for ${progressEvent.repoId}: ${progressEvent.phase}`);
        this.cloneProgress = {
          isCloning: true,
          phase: progressEvent.phase,
          progress: progressEvent.progress,
        };
      }, workerConfig);
    }

    // Keep worker auth config synced with token store updates
    // Single consolidated subscription for tokens - handles both local state and WorkerManager auth
    this.#trackStoreSubscription(
      tokens.subscribe(async (tokenList) => {
        this.tokens = tokenList;
        try {
          await this.workerManager.setAuthConfig({ tokens: tokenList });
          if (tokenList?.length) {
            console.log("🔐 Updated git auth tokens for", tokenList.length, "hosts");
          } else {
            console.log("🔐 Cleared git auth tokens");
          }
        } catch (e) {
          console.warn("🔐 Failed to update worker auth config from token changes:", e);
        }
      })
    );

    if (viewerPubkey) {
      this.#trackStoreSubscription(
        viewerPubkey.subscribe((pubkey) => {
          this.viewerPubkey = pubkey;
          this.#updateEditable();
        })
      );
    } else {
      this.#updateEditable();
    }

    // Initialize cache managers
    this.cacheManager = new CacheManager();

    // Register cache configurations for file operations
    this.cacheManager.registerCache("file_content", {
      type: CacheType.MEMORY,
      keyPrefix: "file_content_",
      defaultTTL: 10 * 60 * 1000, // 10 minutes
      maxSize: 100,
      autoCleanup: true,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
    });

    this.cacheManager.registerCache("file_listing", {
      type: CacheType.MEMORY,
      keyPrefix: "file_listing_",
      defaultTTL: 5 * 60 * 1000, // 5 minutes
      maxSize: 50,
      autoCleanup: true,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
    });

    this.mergeAnalysisCacheManager = new MergeAnalysisCacheManager(this.cacheManager);

    // Initialize VendorReadRouter for API-first reads with git fallback
    // This enables branch/tag discovery from vendor APIs (GitHub, GitLab, etc.) when no Repo State event is available
    this.vendorReadRouter = new VendorReadRouter({
      getTokens: () => tokens.waitForInitialization(),
      preferVendorReads: true,
    });

    // Wire up error callback to surface clone URL errors (404s, auth errors, etc.) to the UI
    this.vendorReadRouter.setCloneUrlErrorCallback((url, error, status) => {
      this.recordCloneUrlError(url, error, status);
    });
    this.vendorReadRouter.setCloneUrlSuccessCallback((url: string) => {
      this.recordCloneUrlSuccess(url);
    });

    // Initialize CommitManager with dependencies and vendor router for API-first commit reads
    this.commitManager = new CommitManager(this.workerManager, this.cacheManager, {
      defaultCommitsPerPage: 30,
      enableCaching: true,
      vendorReadRouter: this.vendorReadRouter,
    });

    // Initialize BranchManager with dependencies and vendor router for ref discovery fallback
    this.branchManager = new BranchManager(this.workerManager, this.cacheManager, {
      enableCaching: true,
      autoRefresh: false,
      vendorReadRouter: this.vendorReadRouter,
    });

    // Initialize FileManager with vendor router for API-first file reads
    this.fileManager = new FileManager(this.workerManager, this.cacheManager, {
      enableCaching: true,
      contentCacheTTL: 10 * 60 * 1000, // 10 minutes
      listingCacheTTL: 5 * 60 * 1000, // 5 minutes
      maxCacheFileSize: 1024 * 1024, // 1MB
      autoCleanup: true,
      vendorReadRouter: this.vendorReadRouter,
    });

    // Store initial repo event for deferred branch loading
    let initialRepoEvent: RepoAnnouncementEvent | null = null;

    this.#trackStoreSubscription(
      repoEvent.subscribe((event) => {
        if (event) {
          if (this.repoEvent?.id === event.id) return;
          this.repoEvent = event;
          this.#repo = parseRepoAnnouncementEvent(event);
          this.#updateEffectiveCloneUrls();
          this.name = this.#repo!.name!;
          this.description = this.#repo!.description!;
          // Compute canonical key from "pubkey:name" string (matches current @nostr-git/core signature)
          const _owner = this.getCanonicalRepoOwner();
          this.key = parseRepoId(`${_owner}:${this.#repo!.name}`);
          this.commitManager.setRepoKeys({
            canonicalKey: this.key,
            workerRepoId: this.repoEvent!.id,
          });
          this.commitManager.setRepoEvent(event);

          // Invalidate branch cache when repo event changes
          this.invalidateBranchCache();
          // Store the initial event for later processing
          if (!initialRepoEvent) {
            initialRepoEvent = event;
          }

          // Load branches if WorkerManager is ready and refs aren't populated yet
          if (
            this.workerManager.isReady &&
            (this.refs.length === 0 || this.#refsSeededFromHead) &&
            !this.#refsLoading
          ) {
            void this.#loadBranchesFromRepo(event);
          }

          this.clone = this.#repo!.clone!;
          this.web = this.#repo!.web!;
          this.hashtags = this.#repo!.hashtags!;
          this.earliestUniqueCommit = this.#repo!.earliestUniqueCommit!;
          this.createdAt = this.#repo!.createdAt;
          this.address = this.#repo!.address;
          this.community = this.#repo!.community;
          this.#updateEditable();

          const pendingRepoStateEvent = this.#pendingRepoStateEvent;
          if (pendingRepoStateEvent) {
            const owner = this.getOwnerPubkey();
            this.#pendingRepoStateEvent = undefined;
            if (owner && pendingRepoStateEvent.pubkey === owner) {
              this.#processRepoStateEvent(pendingRepoStateEvent, initialRepoEvent);
            }
          }
          if (this.#repoStateEventsArr !== undefined) {
            this.#processOwnerRepoStateEvents(this.#repoStateEventsArr, initialRepoEvent);
          }
        }
      })
    );

    this.#trackStoreSubscription(
      repoStateEvent.subscribe((event) => {
        if (event) {
          const owner = this.getOwnerPubkey();
          if (!owner) {
            this.#pendingRepoStateEvent = event;
            return;
          }
          if (event.pubkey !== owner) return;

          this.#pendingRepoStateEvent = undefined;
          this.#processRepoStateEvent(event, initialRepoEvent);
        }
      })
    );

    // Optional streams
    this.#trackStoreSubscription(
      repoStateEvents?.subscribe((events) => {
        const nextRepoStateEvents = events && events.length > 0 ? events : undefined;
        const repoStateEventsSignature = getRepoStateEventsSignature(nextRepoStateEvents);
        if (repoStateEventsSignature !== this.#repoStateEventsSignature) {
          this.#repoStateEventsArr = nextRepoStateEvents;
          this.#repoStateEventsSignature = repoStateEventsSignature;
        }

        this.#processOwnerRepoStateEvents(nextRepoStateEvents, initialRepoEvent);
      })
    );
    this.#trackStoreSubscription(
      statusEvents?.subscribe((events) => {
        this.#statusEventsArr = events;
        this.#statusCache.clear();
      })
    );
    this.#trackStoreSubscription(
      commentEvents?.subscribe((events) => {
        this.#commentEventsArr = events;
        this.#issueThreadCache.clear();
      })
    );
    this.#trackStoreSubscription(
      labelEvents?.subscribe((events) => {
        this.#labelEventsArr = events;
        this.#labelsCache.clear();
      })
    );

    // Note: Token subscription consolidated above in constructor

    // Create initialization promise that consumers can await
    this.#initPromise = new Promise<void>((resolve, reject) => {
      this.#initResolve = resolve;
      this.#initReject = reject;
    });

    // Smart initialization - refs are loaded from subscription handlers
    // Worker initialization happens in background, refs fallback runs after worker is ready
    (async () => {
      try {
        // Initialize the WorkerManager (can be slow)
        await this.workerManager.initialize();

        const loadedTokens = await tokens.waitForInitialization();
        // Wait for tokens to be loaded from localStorage before configuring auth
        if (loadedTokens.length > 0) {
          await this.workerManager.setAuthConfig({ tokens: loadedTokens });
          console.log("Configured git authentication for", loadedTokens.length, "hosts");
        } else {
          console.log("No authentication tokens found");
        }

        const branchStats = this.branchManager.getStats();
        const needsInitialBranchResolution =
          !!initialRepoEvent &&
          (this.refs.length === 0 ||
            this.#refsSeededFromHead ||
            !branchStats.mainBranch ||
            !branchStats.selectedBranch);

        if (needsInitialBranchResolution && initialRepoEvent) {
          await this.#loadBranchesFromRepo(initialRepoEvent);
        }

        await this.#loadCommitsFromRepo();

        // Only sync with remote if vendor API is NOT available
        // When vendor API is available (GitHub, GitLab, etc.), we can get data immediately
        // without waiting for slow git sync operations
        try {
          const repoId = this.key;
          const cloneUrls = [...(this.#repo?.clone || [])];
          const branch = this.#getKnownMainBranch() || this.branchManager.getMainBranch();
          const hasVendorApi = this.vendorReadRouter?.hasVendorSupport(cloneUrls) ?? false;

          if (repoId && cloneUrls.length > 0 && !hasVendorApi) {
            console.log(`[Repo init] No vendor API, syncing with remote...`);
            this.syncStatus = await this.workerManager.syncWithRemote({
              repoId,
              cloneUrls,
              branch,
            });
            if (this.syncStatus?.usedUrl) {
              this.recordCloneUrlSuccess(this.syncStatus.usedUrl);
            }
          } else if (hasVendorApi) {
            console.log(`[Repo init] Vendor API available, skipping git sync for fast UI response`);
          }
        } catch {}

        // Reload refs when the immediate repo-state snapshot is missing, synthetic,
        // or suspiciously partial (for example a stale 30618 that only advertises
        // one branch while the remote has more).
        const currentHeadRefs = this.refs.filter((ref) => ref.type === "heads");
        const hasStateSnapshot =
          !!this.#repoStateEvent ||
          !!(this.#repoStateEventsArr && this.#repoStateEventsArr.length > 0);
        const shouldRefreshRefs =
          this.refs.length === 0 ||
          this.#refsSeededFromHead ||
          hasStateSnapshot ||
          (!!this.#repoStateEvent && currentHeadRefs.length <= 1);

        if (shouldRefreshRefs) {
          try {
            this.#refsLoading = true;
            // Set repoEvent for vendor API fallback when no RepoStateEvent is available
            if (this.repoEvent) {
              this.branchManager.setRepoEvent(this.repoEvent);
            }
            await this.branchManager.loadAllRefs(() => this.getAllRefsWithFallback());
            const loadedRefs = this.branchManager.getAllRefs();
            if (loadedRefs.length > 0) {
              this.refs = loadedRefs;
              this.#refsSeededFromHead = false;
              if (!this.#restorePersistedSelectedBranch()) {
                const selectedFromManager =
                  this.branchManager.getSelectedBranch() || this.#selectedBranchState;
                if (selectedFromManager && selectedFromManager !== this.#selectedBranchState) {
                  this.#selectedBranchState = selectedFromManager;
                  this.#branchChangeTrigger++;
                }
              }
              this.refDiscoverySource =
                this.branchManager.getRefDiscoverySource() || this.refDiscoverySource;
            } else {
              this.#seedRefsFromHead(this.#state?.head);
            }
            console.log(`✅ Loaded ${this.refs.length} refs from vendor/git fallback`);
            if (!this.#selectedBranchState) {
              this.#maybeSelectBranchFromRefs(this.refs, this.#state?.head);
            }
          } catch (error) {
            console.error("Failed to load branches:", error);
            this.refs = [];
          } finally {
            this.#refsLoading = false;
          }
        }

        // Mark initialization as complete
        this.isInitialized = true;
        this.#initResolve?.();
      } catch (error) {
        console.error("Git initialization failed:", error);

        if (this.#loadingIds.clone) {
          context.update(this.#loadingIds.clone, {
            type: "error",
            message: "Failed to initialize repository",
            details: error instanceof Error ? error.message : String(error),
            duration: 5000,
          });
        }

        // Still mark as initialized (with error) so waiters don't hang forever
        this.isInitialized = true;
        this.#initResolve?.();
      }
    })();

    this.#trackStoreSubscription(
      issues.subscribe((issueEvents) => {
        this.issues = issueEvents;
      })
    );
    // Note: Token subscription consolidated at the top of constructor
  }

  /**
   * Wait for repository initialization to complete.
   * This includes worker initialization, token loading, and initial clone/sync.
   * Use this before attempting operations that require the repo to be ready.
   *
   * @example
   * ```typescript
   * await repoClass.waitForReady();
   * const readme = await repoClass.getFileContent({ path: 'README.md', branch: 'main' });
   * ```
   */
  async waitForReady(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    if (this.#initPromise) {
      await this.#initPromise;
    }
  }

  /**
   * Get cached resolved default branch or perform resolution and cache the result
   * This eliminates redundant fallback iterations across multiple git operations
   */
  async getResolvedDefaultBranch(requestedBranch?: string): Promise<string> {
    const now = Date.now();

    // Check if we have a valid cached result
    if (
      this.#resolvedDefaultBranch &&
      now - this.#branchResolutionTimestamp < this.#branchResolutionTTL
    ) {
      console.log(`Using cached resolved branch: ${this.#resolvedDefaultBranch}`);
      return this.#resolvedDefaultBranch;
    }

    // Perform fresh branch resolution
    console.log("Resolving default branch (cache miss or expired)");

    // Use BranchManager's robust branch resolution
    const resolvedBranch =
      requestedBranch || this.#getKnownMainBranch() || this.branchManager.getMainBranch();

    // Cache the result
    this.#resolvedDefaultBranch = resolvedBranch;
    this.#branchResolutionTimestamp = now;

    console.log(`Cached resolved branch: ${resolvedBranch}`);
    return resolvedBranch;
  }

  /**
   * Invalidate the cached resolved branch (call when repository state changes)
   */
  invalidateBranchCache(): void {
    console.log("Invalidating branch resolution cache");
    this.#resolvedDefaultBranch = null;
    this.#branchResolutionTimestamp = 0;
  }

  private getOwnerPubkey(): string {
    const owner = this.#repo?.owner?.trim();
    if (owner && owner.length > 0) return owner;
    return (this.repoEvent?.pubkey || "").trim();
  }

  private isGraspRepo(): boolean {
    const cloneUrls = this.#repo?.clone || [];
    return cloneUrls.some((url) => {
      try {
        return detectVendorFromUrl(url) === "grasp-rest";
      } catch {
        return /^wss?:\/\//i.test(String(url || ""));
      }
    });
  }

  private getCanonicalRepoOwner(): string {
    const owner = this.getOwnerPubkey();
    if (!owner || !this.isGraspRepo()) return owner;
    try {
      return owner.startsWith("npub1") ? owner : nip19.npubEncode(owner);
    } catch {
      return owner;
    }
  }

  /** Build a RepoCore context snapshot from current reactive state */
  #coreCtx(): RepoContext {
    return {
      repoEvent: this.repoEvent,
      repoStateEvent: this.#repoStateEvent,
      repo: this.#repo,
      issues: this.issues,
      repoStateEventsArr: this.#repoStateEventsArr,
      statusEventsArr: this.#statusEventsArr,
      commentEventsArr: this.#commentEventsArr,
      labelEventsArr: this.#labelEventsArr,
    } as RepoContext;
  }

  // -------------------------
  // Trust policy
  // -------------------------
  public isAuthorized(pubkey?: string): boolean {
    if (!pubkey) return false;
    const owner = this.getOwnerPubkey();
    return pubkey === owner;
  }

  // -------------------------
  // Status resolution (1630–1633)
  // -------------------------
  /** Resolve final status for a root id (issue or PR). */
  public resolveStatusFor(rootId: string): {
    state: "open" | "draft" | "closed" | "merged" | "resolved";
    by: string;
    at: number;
    eventId: string;
  } | null {
    if (!this.#statusEventsArr || this.#statusEventsArr.length === 0) return null;
    const cached = this.#statusCache.get(rootId);
    if (cached !== undefined) return cached;
    const result = RepoCore.resolveStatusFor(this.#coreCtx(), rootId);
    this.#statusCache.set(rootId, result as any);
    return result as any;
  }

  private findRootAuthor(rootId: string): string | undefined {
    const root = (this.issues || []).find((i) => i.id === rootId);
    return root?.pubkey;
  }

  // -------------------------
  // Issues + NIP-22 comments
  // -------------------------
  /** Return NIP-22 scoped comments for a given root id. */
  public getIssueThread(rootId: string): { rootId: string; comments: CommentEvent[] } {
    const cached = this.#issueThreadCache.get(rootId);
    if (cached) return cached;
    const res = RepoCore.getIssueThread(this.#coreCtx(), rootId);
    this.#issueThreadCache.set(rootId, res);
    return res;
  }

  // -------------------------
  // Labels (1985 + self)
  // -------------------------
  /** Materialize effective labels for an event/address/euc target. */
  public getEffectiveLabelsFor(target: {
    id?: string;
    address?: string;
    euc?: string;
  }): EffectiveLabelsV2 {
    const key = `${target.id || ""}|${target.address || ""}|${target.euc || ""}`;
    const cached = this.#labelsCache.get(key);
    if (cached) return cached;
    const result = RepoCore.getEffectiveLabelsFor(
      this.#coreCtx(),
      target
    ) as unknown as EffectiveLabelsV2;
    this.#labelsCache.set(key, result);
    return result;
  }

  public getRepoLabels(): EffectiveLabelsV2 {
    return RepoCore.getRepoLabels(this.#coreCtx()) as unknown as EffectiveLabelsV2;
  }

  public getIssueLabels(rootId: string): EffectiveLabelsV2 {
    return RepoCore.getIssueLabels(this.#coreCtx(), rootId) as unknown as EffectiveLabelsV2;
  }
  // -------------------------
  // Subscription hints (no network)
  // -------------------------
  public getRecommendedFilters(): any[] {
    return RepoCore.getRecommendedFilters(this.#coreCtx());
  }

  // -------------------------
  // UX helpers
  // -------------------------
  /**
   * Describe ancestry summary for a ref based on NIP-34 state if available.
   * Returns a compact count of commits ahead when ancestry/lineage is provided.
   */
  public describeAheadBehind(ref: string): { ahead: number | string[] } | null {
    // Normalize ref to fullRef if short name is passed
    const toFullRef = (s: string): string =>
      s.startsWith("refs/")
        ? s
        : s.startsWith("heads/") || s.startsWith("tags/")
          ? `refs/${s}`
          : `refs/heads/${s}`;
    const fullRef = toFullRef(ref);
    // Prefer owner-authored repo-state refs if present
    if (this.#repoStateEventsArr && this.#repoStateEventsArr.length > 0) {
      const ownerStateEvent = RepoCore.selectOwnerRepoStateEvent(
        this.#coreCtx(),
        this.#repoStateEventsArr
      );
      const stateRefs = RepoCore.getRepoStateRefs(ownerStateEvent);
      for (const [, v] of stateRefs.entries()) {
        if (v.fullRef === fullRef) {
          // No lineage info available in compact state map; cannot compute trail
          return { ahead: 0 };
        }
      }
    }
    // Fallback to single repo state event with possible lineage
    if (this.#repoStateEvent) {
      const parsed: any = parseRepoStateEvent(this.#repoStateEvent);
      const hit = (parsed.refs || []).find(
        (r: any) => (r.ref || `refs/${r.type}/${r.name}`) === fullRef
      );
      if (hit) {
        const lineage: string[] | undefined = hit.lineage || hit.ancestry || undefined;
        if (Array.isArray(lineage) && lineage.length > 0) {
          return { ahead: lineage.length };
        }
        return { ahead: 0 };
      }
    }
    return null;
  }

  /** Return a maintainer badge for a pubkey: "owner" | "maintainer" | null. */
  public getMaintainerBadge(pubkey: string): "owner" | "maintainer" | null {
    return RepoCore.getMaintainerBadge(this.#coreCtx(), pubkey);
  }

  /**
   * Get merge analysis for a PR (fetches from PR clone URLs, no cache).
   */
  async getPRMergeAnalysis(
    prCloneUrls: string[],
    tipCommitOid: string,
    targetBranch: string
  ): Promise<import("@nostr-git/core/git").PRMergeAnalysisResult | null> {
    if (!this.repoEvent || !this.workerManager) return null;
    const repoId = this.key;
    const fallbackMain = this.branchManager.getMainBranch();
    const effectiveBranch = typeof targetBranch === "string" ? targetBranch : fallbackMain;
    try {
      const result = await this.workerManager.analyzePRMerge({
        repoId,
        prCloneUrls,
        targetCloneUrls: this.cloneUrls,
        tipCommitOid,
        targetBranch: effectiveBranch,
      });
      return result;
    } catch (err) {
      console.error("[Repo] getPRMergeAnalysis failed:", err);
      throw err;
    }
  }

  setCommitsPerPage(count: number) {
    // Delegate to CommitManager
    this.commitManager.setCommitsPerPage(count);
  }

  async #loadCommitsFromRepo() {
    if (!this.repoEvent) return;

    try {
      const repoId = this.key;
      const cloneUrls = [...(this.#repo?.clone || [])];

      // Validate repoId is not empty string
      if (!repoId || repoId.trim() === "" || !cloneUrls.length) {
        console.debug("[Repo] #loadCommitsFromRepo skipped: missing repoId or clone URLs", {
          repoId,
          cloneUrls: cloneUrls.length,
        });
        return;
      }

      // Check if REST API is available for this repo
      const hasVendorApi = this.vendorReadRouter?.hasVendorSupport(cloneUrls) ?? false;

      const isOwner = this.viewerPubkey ? this.isAuthorized(this.viewerPubkey) : false;

      console.log(
        `[Repo] #loadCommitsFromRepo: hasVendorApi=${hasVendorApi}, isOwner=${isOwner}`
      );

      if (hasVendorApi && !isOwner) {
        // Non-owner with REST API: skip git clone entirely, use only REST API.
        console.log(`[Repo] Non-owner with REST API available - using REST API only`);
        this.#loadingIds.clone = context.loading("Loading repository via API...");

        // Load commits directly via REST API (CommitManager uses VendorReadRouter)
        await this.#loadCommits();

        context.update(this.#loadingIds.clone, {
          type: "success",
          message: "Repository loaded via API",
          duration: 3000,
        });
      } else if (hasVendorApi && isOwner) {
        // Owner with REST API: load metadata via REST API first for fast UI, then clone in background.
        console.log(
          `[Repo] Owner with REST API available - loading via API first, then cloning in background`
        );
        this.#loadingIds.clone = context.loading("Loading repository...");

        // First: Load commits immediately via REST API for fast UI response
        await this.#loadCommits();

        context.update(this.#loadingIds.clone, {
          type: "success",
          message: "Repository loaded via API",
          duration: 2000,
        });

        // Then: Clone in background for full git functionality (push, commit, etc.)
        // Fire-and-forget - don't block the UI
        this.workerManager
          .smartInitializeRepo({
            repoId,
            cloneUrls,
          })
          .then((result) => {
            if (result.success) {
              if (result.usedUrl) {
                this.recordCloneUrlSuccess(result.usedUrl);
              }
              console.log(`[Repo] Background git clone completed for owner`);
            } else {
              console.warn(`[Repo] Background git clone failed:`, result.error);
            }
          })
          .catch((err) => {
            console.warn(`[Repo] Background git clone error:`, err);
          });
      } else {
        // NO REST API: Use git clone as before
        this.#loadingIds.clone = context.loading("Initializing repository...");

        // Use smart initialization instead of always cloning
        const result = await this.workerManager.smartInitializeRepo({
          repoId,
          cloneUrls,
        });

        if (result.success) {
          if (result.usedUrl) {
            this.recordCloneUrlSuccess(result.usedUrl);
          }
          context.update(this.#loadingIds.clone, {
            type: "success",
            message: result.fromCache ? "Repository loaded from cache" : "Repository initialized",
            duration: 3000,
          });

          // Load commits after successful initialization
          await this.#loadCommits();
        } else {
          throw new Error(result.error || "Smart initialization failed");
        }
      }
    } catch (error) {
      console.error("Git initialization failed:", error);

      if (this.#loadingIds.clone) {
        context.update(this.#loadingIds.clone, {
          type: "error",
          message: "Failed to initialize repository",
          details: error instanceof Error ? error.message : String(error),
          duration: 5000,
        });
      }
    }
  }

  async #loadCommits() {
    const mainBranch = this.#getKnownMainBranch();

    // Validate repoId is not empty string
    if (!this.repoEvent || !mainBranch || !this.key || this.key.trim() === "") {
      console.debug("[Repo] #loadCommits skipped: missing repoEvent, mainBranch, or key", {
        hasRepoEvent: !!this.repoEvent,
        mainBranch,
        key: this.key,
      });
      return;
    }

    // Use selected branch if available, otherwise fall back to mainBranch
    const branchToLoad = this.selectedBranch || mainBranch;

    // Delegate to CommitManager
    const result = await this.commitManager.loadCommits(this.key, branchToLoad, mainBranch);
    if (result.success) {
      this.syncCommitsState();
    }
  }

  async #loadBranchesFromRepo(repoEvent: RepoAnnouncementEvent) {
    if (this.#refsLoading) return;
    this.#refsLoading = true;
    try {
      // Set repoEvent for vendor API fallback when no RepoStateEvent is available
      this.branchManager.setRepoEvent(repoEvent);

      // Process repository state event for NIP-34 references if available
      if (this.#repoStateEvent) {
        // Prefer verified processing when we have the repoEvent
        await this.branchManager.processRepoStateEventVerified(this.#repoStateEvent, repoEvent);
      }

      // Delegate to BranchManager
      await this.branchManager.loadAllRefs(() => this.getAllRefsWithFallback());

      const loadedRefs = this.branchManager.getAllRefs();
      if (loadedRefs.length > 0) {
        this.refs = loadedRefs;
        this.#refsSeededFromHead = false;
        if (!this.#restorePersistedSelectedBranch()) {
          this.#selectedBranchState =
            this.branchManager.getSelectedBranch() || this.#selectedBranchState;
        }
        this.refDiscoverySource =
          this.branchManager.getRefDiscoverySource() || this.refDiscoverySource;
      } else {
        this.#seedRefsFromHead(this.#state?.head);
      }
      if (!this.#selectedBranchState) {
        this.#maybeSelectBranchFromRefs(this.refs, this.#state?.head);
      }

      // Sync selected branch state from BranchManager to reactive state
      // This ensures the UI reflects the auto-selected main branch
      const selectedFromManager = this.branchManager.getSelectedBranch();
      if (selectedFromManager && selectedFromManager !== this.#selectedBranchState) {
        this.#selectedBranchState = selectedFromManager;
        this.#branchChangeTrigger++;
        console.log(`[Repo] Auto-selected branch from BranchManager: ${selectedFromManager}`);
      }
    } catch (error) {
      console.error("Failed to load branches:", error);
    } finally {
      this.#refsLoading = false;
    }
  }

  get repoId() {
    return this.key;
  }

  get mainBranch() {
    return this.branchManager.getMainBranch();
  }

  get branches() {
    // Derive branches from reactive refs for instant UI updates
    // Filter refs to only include heads (branches), not tags
    if (this.refs.length > 0) {
      return this.refs.filter((r) => r.type === "heads");
    }
    // Fallback to branchManager if refs not yet loaded
    return this.branchManager.getBranches();
  }

  async loadRefsForPRAnalysis(): Promise<
    Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>
  > {
    if (this.#refsLoading) {
      for (let attempt = 0; attempt < 20 && this.#refsLoading; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (this.repoEvent && !this.#refsLoading) {
      await this.#loadBranchesFromRepo(this.repoEvent);
    }

    return this.refs.length > 0 ? this.refs : this.branchManager.getAllRefs();
  }

  // Expose clone URLs from the parsed repo announcement
  get cloneUrls(): string[] {
    return this.#effectiveCloneUrls.length > 0 ? this.#effectiveCloneUrls : (this.#repo?.clone ?? []);
  }

  setCloneUrls(cloneUrls: string[]): void {
    this.#updateEffectiveCloneUrls(cloneUrls || []);
  }

  #updateEffectiveCloneUrls(extraCloneUrls: string[] = []): void {
    const declared = this.#repo?.clone || [];
    const nextCloneUrls = Array.from(
      new Set([...declared, ...extraCloneUrls].map((u) => String(u || "").trim()).filter(Boolean))
    );

    if (this.#arraysEqual(this.#effectiveCloneUrls, nextCloneUrls)) return;

    this.#effectiveCloneUrls = nextCloneUrls;
    this.commitManager?.setCloneUrls(this.#effectiveCloneUrls);
    this.branchManager?.setCloneUrls(this.#effectiveCloneUrls);
    this.fileManager?.setCloneUrls(this.#effectiveCloneUrls);
  }

  #arraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  // Expose clone URL errors for UI display (e.g., 404s, auth errors)
  get cloneUrlErrors(): Array<{ url: string; error: string; status?: number }> {
    return this.#cloneUrlErrors;
  }

  // Record a clone URL error (called by VendorReadRouter or other components)
  recordCloneUrlError(url: string, error: string, status?: number): void {
    const normalized = this.#normalizeCloneUrl(url);

    // Avoid duplicates
    const existing = this.#cloneUrlErrors.find(
      (e) => this.#normalizeCloneUrl(e.url) === normalized
    );
    if (existing) {
      existing.url = url;
      existing.error = error;
      existing.status = status;
    } else {
      this.#cloneUrlErrors = [...this.#cloneUrlErrors, { url, error, status }];
    }
  }

  // Clear a specific clone URL error after a successful operation
  clearCloneUrlError(url: string): void {
    const normalized = this.#normalizeCloneUrl(url);
    this.#cloneUrlErrors = this.#cloneUrlErrors.filter(
      (entry) => this.#normalizeCloneUrl(entry.url) !== normalized
    );
  }

  recordCloneUrlSuccess(url: string): void {
    const trimmed = String(url || "").trim();
    if (trimmed) {
      this.currentReadRemoteUrl = trimmed;
    }
    this.clearCloneUrlError(url);
  }

  // Clear clone URL errors (e.g., after successful operation)
  clearCloneUrlErrors(): void {
    this.#cloneUrlErrors = [];
  }

  // Check if any clone URLs have errors
  get hasCloneUrlErrors(): boolean {
    return this.#cloneUrlErrors.length > 0;
  }

  #normalizeCloneUrl(url: string): string {
    const raw = String(url || "").trim();
    if (!raw) return "";

    const stripGitSuffix = (value: string) => value.replace(/\.git$/i, "");

    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const path = stripGitSuffix(parsed.pathname.replace(/\/+$/, "").toLowerCase());
      return `${host}${path}`;
    } catch {
      return stripGitSuffix(
        raw
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "")
          .toLowerCase()
      );
    }
  }

  // Expose relays from the parsed repo announcement
  get relays(): string[] {
    return this.#repo?.relays ?? [];
  }

  // Latest NIP-34 repo state event (30618) for this repo announcement
  get repoStateEvent(): RepoStateEvent | undefined {
    return this.#repoStateEvent;
  }

  // All known 30618 events for this repo announcement
  get repoStateEvents(): RepoStateEvent[] {
    return this.#repoStateEventsArr || [];
  }

  // Expose maintainers from the parsed repo announcement
  get maintainers(): string[] {
    const owner = this.getOwnerPubkey();
    const combined = owner
      ? [...(this.#repo?.maintainers || []), owner]
      : this.#repo?.maintainers || [];
    return Array.from(new Set(combined.filter(Boolean)));
  }

  // Expose currently loaded commits for UI components (reactive)
  get commits(): any[] {
    console.log(`[Repo.commits getter] Returning ${this.#commitsState?.length || 0} commits`);
    return this.#commitsState;
  }

  // Sync commits from CommitManager to reactive state
  private syncCommitsState() {
    const newCommits = this.commitManager.getCommits();
    const currentBranch = this.commitManager.getCurrentBranch();
    console.log(
      `[Repo.syncCommitsState] Syncing ${newCommits.length} commits, currentBranch=${currentBranch}, selectedBranch=${this.selectedBranch}, isSwitching=${this.#branchSwitching}`
    );

    // IMPORTANT: Create a new array reference to ensure Svelte reactivity triggers
    // This is critical for Svelte 5's fine-grained reactivity to detect the change
    this.#commitsState = [...newCommits];
    this.#totalCommitsState = this.commitManager.getTotalCommits();
    this.#hasMoreCommitsState = this.commitManager.getHasMoreCommits();

    console.log(
      `[Repo.syncCommitsState] Updated #commitsState with ${this.#commitsState.length} commits`
    );
  }

  #getHeadBranchName(headHint?: string): string | null {
    const raw = String(headHint || "").trim();
    if (!raw) return null;
    const normalized = raw.replace(/^ref:\s*/i, "");
    const match = normalized.match(/^refs\/heads\/(.+)$/);
    return match ? match[1] : normalized;
  }

  #getKnownMainBranch(): string | undefined {
    const branchStats = this.branchManager.getStats();
    if (branchStats.mainBranch) {
      return branchStats.mainBranch;
    }

    const headName = this.#getHeadBranchName(this.#state?.head);
    if (headName) {
      return headName;
    }

    const heads = this.refs.filter((ref) => ref.type === "heads");
    const commonDefaults = ["main", "master", "develop", "dev"];
    return commonDefaults.find((name) => heads.some((ref) => ref.name === name)) || heads[0]?.name;
  }

  #getHeadHintFromRepoStateEvent(event?: RepoStateEvent): string | undefined {
    if (!event) return undefined;
    const parsed = parseRepoStateEvent(event) as any;
    return this.#getHeadBranchName(parsed?.head) || undefined;
  }

  #seedRefsFromHead(headHint?: string) {
    if (this.refs.length > 0) return;
    const headName = this.#getHeadBranchName(headHint);
    if (!headName) return;
    this.refs = [
      {
        name: headName,
        type: "heads",
        fullRef: `refs/heads/${headName}`,
        commitId: "",
      },
    ];
    this.#refsSeededFromHead = true;
    if (!this.#selectedBranchState) {
      this.#selectedBranchState = headName;
      this.#branchChangeTrigger++;
    }
    this.branchManager.setSelectedBranch(headName);
  }

  #maybeSelectBranchFromRefs(
    refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>,
    headHint?: string
  ) {
    if (this.#selectedBranchState) return;
    const chosen = resolvePreferredBranchFromRefs({
      refs,
      persistedBranch: this.#readPersistedSelectedBranch(),
      headHint,
      mainBranch: this.#getKnownMainBranch(),
    });

    if (!chosen) return;
    this.#selectedBranchState = chosen;
    this.branchManager.setSelectedBranch(chosen);
    this.#branchChangeTrigger++;
  }

  /**
   * Get all repository references (branches and tags) with robust fallback logic
   * This method encapsulates the sophisticated branch/ref handling logic that includes:
   * - NIP-34 reference processing
   * - Fallback to processed branches when NIP-34 refs aren't available
   * - Unified ref structure for both heads and tags
   * - Automatic branch loading with error handling
   * @returns Promise<Array<{name: string; type: "heads" | "tags"; fullRef: string; commitId: string}>>
   */
  async getAllRefsWithFallback(): Promise<
    Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>
  > {
    // Prefer owner-authored repo-state refs when available.
    if (this.#repoStateEventsArr && this.#repoStateEventsArr.length > 0) {
      if (!this.#repoStateRefsCache) {
        const ownerStateEvent = RepoCore.selectOwnerRepoStateEvent(
          this.#coreCtx(),
          this.#repoStateEventsArr
        );
        this.#repoStateRefsCache = RepoCore.getRepoStateRefs(ownerStateEvent);
      }
      const refs: Array<{
        name: string;
        type: "heads" | "tags";
        fullRef: string;
        commitId: string;
      }> = [];
      for (const [key, ref] of this.#repoStateRefsCache.entries()) {
        const name = key.split(":")[1];
        refs.push({ name, type: ref.type, fullRef: ref.fullRef, commitId: ref.commitId });
      }
      if (refs.length > 0) {
        return refs.sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "heads" ? -1 : 1
        );
      }
    }

    // Process single repo state event if available and not already processed
    if (this.#repoStateEvent && this.#repoStateEvent.tags) {
      const hasProcessedState = this.branchManager?.getAllNIP34References().size > 0;
      if (!hasProcessedState) {
        if (this.#repo) {
          await this.branchManager.processRepoStateEventVerified(
            this.#repoStateEvent,
            this.repoEvent!
          );
        } else {
          this.branchManager?.processRepoStateEvent(this.#repoStateEvent);
        }
      }
    } else if (!this.#repoStateEvent) {
      // No RepoStateEvent available - discover refs from vendor API or git worker
      // Note: We don't call loadAllRefs here to avoid infinite recursion.
      // Instead, we let loadAllRefs call us once via its callback, then it will
      // attempt vendor/git fallback if we return empty refs.
      // The branches will be populated by BranchManager.loadAllRefs() when called externally.
    }

    // Get NIP-34 references first (preferred)
    const nip34Refs = this.branchManager?.getAllNIP34References() || new Map();
    const processedBranches = this.branchManager?.getBranches() || [];

    const refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> =
      [];

    // Process NIP-34 references first
    for (const [shortName, ref] of nip34Refs) {
      refs.push({
        name: shortName,
        type: ref.type,
        fullRef: ref.fullRef,
        commitId: ref.commitId,
      });
    }

    // Fallback to processed branches if no NIP-34 refs available
    if (refs.length === 0 && processedBranches.length > 0) {
      for (const branch of processedBranches) {
        const refObj = {
          name: branch.name,
          type: "heads" as const,
          fullRef: `refs/heads/${branch.name}`,
          commitId: branch.oid || "",
        };
        refs.push(refObj);
      }
    }

    // Sort refs: heads first, then tags, alphabetically within each type
    return refs.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "heads" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get branch names only (for backward compatibility)
   * @returns Promise<string[]>
   */
  async getBranchNames(): Promise<string[]> {
    const refs = await this.getAllRefsWithFallback();
    return refs.filter((ref) => ref.type === "heads").map((ref) => ref.name);
  }

  /**
   * Get tag names only
   * @returns Promise<string[]>
   */
  async getTagNames(): Promise<string[]> {
    const refs = await this.getAllRefsWithFallback();
    return refs.filter((ref) => ref.type === "tags").map((ref) => ref.name);
  }

  get selectedBranch() {
    // Prefer reactive state when available to trigger Svelte updates
    return this.#selectedBranchState ?? this.branchManager.getSelectedBranch();
  }

  resetSelectedBranchToDefault(): void {
    const defaultBranch = normalizeGitRefName(this.mainBranch || "");
    if (!defaultBranch || this.selectedBranch === defaultBranch) return;

    this.branchManager.setSelectedBranch(defaultBranch);
    this.#selectedBranchState = defaultBranch;
    this.#branchChangeTrigger++;
  }

  get isBranchSwitching() {
    return this.#branchSwitching;
  }

  get isRefsLoading() {
    return this.#refsLoading;
  }

  /**
   * Counter that increments when a branch switch completes.
   * Components can track this to know when to reload data for the new branch.
   */
  get branchChangeTrigger() {
    return this.#branchChangeTrigger;
  }

  async setSelectedBranch(branchName: string, options: { persist?: boolean } = { persist: true }) {
    const previousBranch = this.selectedBranch;

    // Set switching flag to prevent premature loads
    this.#branchSwitching = true;

    // Update in BranchManager first
    this.branchManager.setSelectedBranch(branchName);

    // Normalize branch name while preserving branch paths (e.g. "fix/ipk-builds")
    const shortBranch = normalizeGitRefName(branchName) || branchName;

    // Update reactive state for UI immediately
    this.#selectedBranchState = shortBranch;
    if (options.persist !== false) {
      this.#persistSelectedBranch(shortBranch);
    }

    // Detect if the selection is a tag; skip worker branch ops in that case
    let isTag = false;
    try {
      const refs = this.branchManager.getAllRefs();
      const hit = refs.find((r) => r.name === shortBranch);
      isTag = hit?.type === "tags";
      if (isTag) {
        console.warn(`Selected ref '${shortBranch}' is a tag; skipping branch checkout.`);
      }
    } catch {}

    try {
      // Gather clone URLs for remote operations
      const cloneUrls = [...(this.#repo?.clone || [])];

      // Check if vendor API is available - if so, skip slow git sync operations
      // The vendor API (GitHub, GitLab, etc.) can provide commits/files immediately
      // without needing to clone/sync the repo first
      const hasVendorApi = this.vendorReadRouter?.hasVendorSupport(cloneUrls) ?? false;

      // Track if we need to clear cache (only if branch content actually changed)
      let shouldClearCache = false;

      // 1) Only sync with remote if vendor API is NOT available
      // When vendor API is available, we can get data immediately without waiting for git
      if (!hasVendorApi && this.key && cloneUrls.length > 0) {
        // Ensure worker is ready
        if (!this.workerManager?.isReady) {
          await this.workerManager.initialize();
        }

        try {
          console.log(`[setSelectedBranch] No vendor API, syncing with remote...`);
          this.syncStatus = await this.workerManager.syncWithRemote({
            repoId: this.key,
            cloneUrls,
            branch: shortBranch,
          });
          if (this.syncStatus?.usedUrl) {
            this.recordCloneUrlSuccess(this.syncStatus.usedUrl);
          }

          // Only clear cache if remote had updates or if sync reports it needs update
          if (this.syncStatus?.needsUpdate) {
            console.log("Branch content changed, will clear cache");
            shouldClearCache = true;
          } else {
            console.log("Branch already up-to-date, preserving cache for instant load");
          }
        } catch (syncErr) {
          console.warn("syncWithRemote failed, will try ensureFullClone:", syncErr);
          // If sync fails, play it safe and clear cache
          shouldClearCache = true;
        }

        // 2) Ensure the branch is fully available locally (deep clone as needed)
        if (this.key) {
          await this.workerManager.ensureFullClone({ repoId: this.key, branch: shortBranch });
        }
      } else if (hasVendorApi) {
        console.log(
          `[setSelectedBranch] Vendor API available, skipping git sync for fast UI response`
        );
      }

      // 3) Clear caches only if branch content actually changed
      if (shouldClearCache) {
        console.log("Clearing file cache due to branch update");
        try {
          await this.fileManager.clearCache(this.key);
        } catch {}
      } else {
        console.log("Preserving file cache - branch unchanged");
      }

      // 4) Load commits for new branch/tag
      // Reset commits first to ensure fresh load for the new branch
      this.commitManager.reset(true); // Clear stored branch since we're explicitly switching

      // Set the new branch in CommitManager so subsequent operations (loadMore, loadPage) use it
      const mainBranchName = this.branchManager.getMainBranch();
      this.commitManager.setCurrentBranch(shortBranch, mainBranchName);

      console.log(
        `[setSelectedBranch] Loading commits for ref: ${shortBranch} (isTag: ${isTag}), mainBranch: ${mainBranchName}`
      );

      const result = await this.commitManager.loadCommits(
        this.repoId,
        shortBranch, // The selected branch or tag
        mainBranchName
      );
      console.log(
        `[setSelectedBranch] Commits loaded:`,
        result.success,
        `count:`,
        this.commitManager.getCommits().length
      );
      // Note: syncCommitsState is called AFTER branchSwitching is cleared (in finally block)
      // to ensure UI components can properly pick up the new commits

      // Note: We rely on CommitManager's built-in caching (IndexedDB)
      // which is per-branch, so switching back to a recent branch is instant

      // Invalidate cached resolved default branch so future calls re-resolve against new selection
      this.invalidateBranchCache();

      // 4) Reload refs so UI sees updated heads/tags state
      try {
        this.#refsLoading = true;
        await this.branchManager.loadAllRefs(() => this.getAllRefsWithFallback());
        this.refs = this.branchManager.getAllRefs();
        this.#selectedBranchState =
          this.branchManager.getSelectedBranch() || this.#selectedBranchState;
        this.refDiscoverySource =
          this.branchManager.getRefDiscoverySource() || this.refDiscoverySource;
      } finally {
        this.#refsLoading = false;
      }

      // 5) Verify worker status (debug visibility)
      try {
        const status = await this.workerManager.getStatus({
          repoId: this.key,
          branch: shortBranch,
        });
        console.log("Worker status after branch switch:", status);
      } catch {}

      if (options.persist !== false) {
        this.#persistSelectedBranch(this.#selectedBranchState || shortBranch);
      }
    } catch (e) {
      const restoredBranch = previousBranch || this.mainBranch || this.refs[0]?.name;
      this.#selectedBranchState = restoredBranch;
      if (restoredBranch) {
        this.branchManager.setSelectedBranch(restoredBranch);
        if (options.persist !== false) {
          this.#persistSelectedBranch(restoredBranch);
        }
      }
      console.error("Failed to switch branch in worker or refresh commits:", e);
      toast.push({
        message: `Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`,
        theme: "error",
      });
    } finally {
      // Clear switching flag FIRST, then sync commits
      // This ensures UI components see isSwitching=false when they receive the new commits
      this.#branchSwitching = false;

      // Now sync commits state - UI effects will see isSwitching=false and can update
      this.syncCommitsState();

      // Increment trigger to signal branch switch completed - components can react to this
      this.#branchChangeTrigger++;
    }
  }

  get isLoading() {
    return (
      Object.values(this.#loadingIds).some((id) => id !== null) || this.commitManager.isLoading()
    );
  }

  get totalCommits() {
    return this.#totalCommitsState;
  }

  get currentPage() {
    return this.commitManager.getCurrentPage();
  }

  get commitsPerPage() {
    return this.commitManager.getCommitsPerPage();
  }

  // Get the current pagination state
  get pagination() {
    return this.commitManager.getPagination();
  }

  get hasMoreCommits() {
    return this.#hasMoreCommitsState;
  }

  async loadMoreCommits() {
    const result = await this.commitManager.loadMoreCommits();
    this.syncCommitsState();
    return result;
  }

  async loadPage(page: number) {
    try {
      // Use canonical repo ID consistently for worker calls
      const effectiveRepoId = this.repoId;

      // Get the actual resolved default branch with fallback
      let effectiveMainBranch: string;
      try {
        effectiveMainBranch = await this.getResolvedDefaultBranch();
      } catch (branchError) {
        console.warn("⚠️ getResolvedDefaultBranch failed, using fallback:", branchError);
        effectiveMainBranch = this.mainBranch || "";
      }

      // Validate repoId is not empty string
      if (
        !this.repoEvent ||
        !effectiveMainBranch ||
        !effectiveRepoId ||
        effectiveRepoId.trim() === ""
      ) {
        console.debug("[Repo] loadPage skipped: missing repoEvent, mainBranch, or repoId", {
          hasRepoEvent: !!this.repoEvent,
          effectiveMainBranch,
          effectiveRepoId,
        });
        return {
          success: false,
          error: "Repository event, main branch, and repository ID are required",
        };
      }

      // Use the CommitManager's loadPage method which sets the page and calls loadCommits
      const originalLoadCommits = this.commitManager.loadCommits.bind(this.commitManager);

      // Temporarily override loadCommits to provide the required parameters
      // IMPORTANT: Read the current branch at CALL TIME, not at closure creation time
      // This fixes the stale closure bug where branch selection changes between
      // when loadPage() is called and when loadCommits() is actually invoked
      this.commitManager.loadCommits = async () => {
        // Get the branch fresh at call time to avoid stale closure capture
        const storedBranch = this.commitManager.getCurrentBranch();
        const currentBranchToLoad = resolveLoadPageBranch({
          selectedBranch: this.selectedBranch,
          storedBranch,
          mainBranch: effectiveMainBranch,
        });
        console.log(
          `[Repo.loadPage] overridden loadCommits called with branch=${currentBranchToLoad} (storedBranch=${storedBranch}, selectedBranch=${this.selectedBranch})`
        );
        return await originalLoadCommits(
          effectiveRepoId!, // Use the effective repository ID
          currentBranchToLoad, // Use current branch at call time, not stale captured value
          effectiveMainBranch!
        );
      };

      try {
        const result = await this.commitManager.loadPage(page);
        this.syncCommitsState();
        return result;
      } finally {
        // Restore the original method
        this.commitManager.loadCommits = originalLoadCommits;
      }
    } catch (error) {
      console.error("❌ loadPage error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } as const;
    }
  }

  async listRepoFiles({ branch, path }: { branch?: string; path?: string }) {
    const target = branch || this.branchManager.getMainBranch();
    if (!this.repoEvent) {
      return {
        files: [],
        path: path || "/",
        ref: normalizeGitRefName(target),
        fromCache: false,
      } as const;
    }

    // If target name corresponds to a tag, list files by its commit
    try {
      const normalizedTarget = normalizeGitRefName(target);
      const refs = this.branchManager.getAllRefs();
      const hit = refs.find((r) => r.name === normalizedTarget);
      if (hit && hit.type === "tags" && hit.commitId) {
        return this.fileManager.listRepoFilesAtCommit({
          repoEvent: this.repoEvent,
          repoKey: this.key,
          commit: hit.commitId,
          path: path || "/",
        });
      }
    } catch {}

    // Otherwise, treat as a branch
    return this.fileManager.listRepoFiles({
      repoEvent: this.repoEvent,
      repoKey: this.key,
      branch: target,
      path: path || "/",
    });
  }

  async getFileContent({
    path,
    branch,
    commit,
  }: {
    path: string;
    branch?: string;
    commit?: string;
  }) {
    const targetBranch = branch || this.branchManager.getMainBranch();
    if (!this.repoEvent) {
      return {
        content: "",
        path,
        ref: commit || normalizeGitRefName(targetBranch),
        encoding: "utf-8",
        size: 0,
        fromCache: false,
      } as const;
    }
    return this.fileManager.getFileContent({
      repoEvent: this.repoEvent,
      repoKey: this.key,
      path,
      branch: targetBranch,
      commit,
    });
  }

  async fileExistsAtCommit({
    path,
    branch,
    commit,
  }: {
    path: string;
    branch?: string;
    commit?: string;
  }) {
    const targetBranch = branch || this.branchManager.getMainBranch();
    if (!this.repoEvent) return false;
    return this.fileManager.fileExistsAtCommit({
      repoEvent: this.repoEvent,
      repoKey: this.key,
      path,
      branch: targetBranch,
      commit,
    });
  }

  async getFileHistory({
    path,
    branch,
    maxCount,
  }: {
    path: string;
    branch?: string;
    maxCount?: number;
  }) {
    const targetBranch = branch || this.branchManager.getMainBranch();
    if (!this.repoEvent) return [];
    return this.fileManager.getFileHistory({
      repoEvent: this.repoEvent,
      repoKey: this.key,
      path,
      branch: targetBranch,
      maxCount,
    });
  }

  async getCommitHistory({ branch, depth }: { branch?: string; depth?: number }) {
    const targetBranch = branch || this.branchManager.getMainBranch();
    const effectiveDepth = depth ?? this.commitManager.getCommitsPerPage();

    // Try vendor API first if available (API-first, git fallback)
    if (this.vendorReadRouter && this.repoEvent) {
      try {
        const cloneUrls = this.cloneUrls;
        console.log(
          `[Repo.getCommitHistory] Trying VendorReadRouter.listCommits for branch=${targetBranch}`
        );

        const vendorResult = await this.vendorReadRouter.listCommits({
          workerManager: this.workerManager,
          repoEvent: this.repoEvent,
          repoKey: this.key,
          cloneUrls,
          branch: targetBranch,
          depth: effectiveDepth,
          perPage: effectiveDepth,
        });

        // Convert vendor result format to internal format
        const commits = vendorResult.commits.map((c: any) => ({
          oid: c.sha,
          commit: {
            message: c.message,
            author: {
              name: c.author.name,
              email: c.author.email,
              timestamp: c.author.date
                ? Math.floor(new Date(c.author.date).getTime() / 1000)
                : undefined,
            },
            committer: {
              name: c.committer.name,
              email: c.committer.email,
              timestamp: c.committer.date
                ? Math.floor(new Date(c.committer.date).getTime() / 1000)
                : undefined,
            },
            parent: c.parents?.map((p: any) => p.sha) || [],
          },
        }));

        console.log(
          `[Repo.getCommitHistory] VendorReadRouter returned ${commits.length} commits, fromVendor=${vendorResult.fromVendor}`
        );
        return { success: true, commits };
      } catch (vendorError) {
        console.warn(
          `[Repo.getCommitHistory] VendorReadRouter.listCommits failed, falling back to git:`,
          vendorError
        );
        // Fall through to git worker below
      }
    }

    // Fall back to git worker
    return await this.workerManager.getCommitHistory({
      repoId: this.key,
      branch: targetBranch,
      depth: effectiveDepth,
    });
  }

  /**
   * Reset the repository state and clear all caches
   * Forces fresh data to be loaded from remote and resets local git state
   */
  async reset() {
    console.log("Resetting repository state...");

    const branchBeforeReset =
      this.selectedBranch || this.mainBranch || this.branchManager?.getMainBranch() || "main";

    // Clone URL issues are session-local read observations. Clear them before a fresh reload
    // so successful probes can repopulate only current problems.
    this.clearCloneUrlErrors();

    // Reset managers that have reset methods
    this.commitManager?.reset();
    this.branchManager?.reset();
    this.refDiscoverySource = null;

    // Clear caches for managers that have clearCache methods
    try {
      await this.fileManager?.clearCache();
      await this.mergeAnalysisCacheManager?.clear();

      // Clear individual cache types in CacheManager
      if (this.cacheManager) {
        await this.cacheManager.clear("file_content");
        await this.cacheManager.clear("file_listing");
        await this.cacheManager.clear("file_exists");
        await this.cacheManager.clear("file_history");
      }
    } catch (error) {
      console.warn("Error clearing caches during reset:", error);
    }

    // Reset branch resolution cache
    this.invalidateBranchCache();

    // Reset clone progress
    this.cloneProgress = {
      isCloning: false,
      phase: "",
      progress: 0,
    };

    // Reset local git repository to match remote HEAD state
    if (this.repoEvent) {
      try {
        console.log("Resetting local git repository to match remote...");
        const resetResult = await this.workerManager.resetRepoToRemote(this.key, branchBeforeReset);

        if (resetResult.success) {
          console.log(`Git reset successful: ${resetResult.message}`);
        }
      } catch (resetError) {
        console.warn("Git reset to remote failed:", resetError);
        // Continue with cache clearing even if git reset fails
      }

      // Force reload branches and other data
      await this.#loadBranchesFromRepo(this.repoEvent);

    }

    console.log("Repository reset complete");
  }

  /**
   * Create repository announcement event data for NIP-34
   * @param repoData Repository creation data
   * @returns Unsigned event object for external signing and publishing
   */
  createRepoAnnouncementEvent(repoData: {
    name: string;
    description?: string;
    cloneUrl?: string; // Legacy single URL support
    webUrl?: string; // Legacy single URL support
    clone?: string[]; // NIP-34 multiple clone URLs
    web?: string[]; // NIP-34 multiple web URLs
    defaultBranch?: string;
    maintainers?: string[];
    relays?: string[];
    hashtags?: string[];
    earliestUniqueCommit?: string;
    community?: RepoCommunityBinding;
  }): RepoAnnouncementEvent {
    // Use the shared-types utility function
    // Resolve a robust earliestUniqueCommit:
    // - Prefer provided value if valid 40-hex
    // - Otherwise, try to resolve from the default branch using BranchManager (nip34Ref.commitId or oid)
    const providedEuc = repoData.earliestUniqueCommit?.trim();
    const is40Hex = (v?: string) => !!v && /^[a-f0-9]{40}$/.test(v);
    const branchObj = repoData.defaultBranch
      ? this.branchManager.getBranch(repoData.defaultBranch)
      : undefined;
    const resolvedFromBranch = branchObj?.nip34Ref?.commitId || branchObj?.oid || branchObj?.commit;
    const euc = is40Hex(providedEuc)
      ? providedEuc
      : is40Hex(resolvedFromBranch)
        ? resolvedFromBranch
        : undefined;

    // Pass the canonical repo key for addressable a-tags; name is used for NIP-34 d-tag (short id)
    return createRepoAnnouncementEvent({
      repoId: parseRepoId(`${this.getCanonicalRepoOwner()}:${repoData.name}`),
      name: repoData.name,
      description: repoData.description,
      // Support both legacy single URLs and new array format
      clone: repoData.clone || (repoData.cloneUrl ? [repoData.cloneUrl] : undefined),
      web: repoData.web || (repoData.webUrl ? [repoData.webUrl] : undefined),
      relays: repoData.relays,
      maintainers: repoData.maintainers,
      hashtags: repoData.hashtags,
      earliestUniqueCommit: euc,
      community: Object.prototype.hasOwnProperty.call(repoData, "community")
        ? repoData.community
        : this.community,
    });
  }

  /**
   * Create repository state event data for NIP-34
   * @param stateData Repository state data
   * @returns Unsigned event object for external signing and publishing
   */
  createRepoStateEvent(stateData: {
    repositoryId: string;
    headBranch?: string;
    branches?: string[];
    tags?: string[];
    refs?: Array<{ type: "heads" | "tags"; name: string; commit: string; ancestry?: string[] }>;
  }): RepoStateEvent {
    // Use the shared-types utility function
    return createRepoStateEvent({
      repoId: stateData.repositoryId,
      head: stateData.headBranch,
      refs: stateData.refs || [
        // Convert branches to refs format
        ...(stateData.branches?.map((branch) => ({
          type: "heads" as const,
          name: branch,
          commit: "HEAD", // This would be the actual commit hash
        })) || []),
        // Convert tags to refs format
        ...(stateData.tags?.map((tag) => ({
          type: "tags" as const,
          name: tag,
          commit: "HEAD", // This would be the actual commit hash
        })) || []),
      ],
    });
  }

  dispose() {
    disposeSubscriptions(this.#storeUnsubs.splice(0));
    this.cacheManager?.dispose();
    // MergeAnalysisCacheManager doesn't have a dispose method - it's managed by CacheManager
    this.commitManager?.dispose();
    this.branchManager?.dispose();
    this.fileManager?.dispose();
    this.workerManager?.dispose();
    console.log("Repo disposed");
  }

  // -------------------------
  // Thin wrappers for file edit + commit and head lookup
  // -------------------------
  async writeFileLocal({ path, content }: { path: string; content: string }): Promise<void> {
    if (!this.fileManager) throw new Error("FileManager unavailable");
    this.assertEditable();
    // Prefer a dedicated write API if present; otherwise, fall back to a generic method
    const anyFm: any = this.fileManager as any;
    if (typeof anyFm.writeFileLocal === "function") {
      await anyFm.writeFileLocal({ repoKey: this.key, path, content });
      return;
    }
    if (typeof anyFm.writeFile === "function") {
      await anyFm.writeFile({ repoKey: this.key, path, content });
      return;
    }
    throw new Error("writeFileLocal not implemented in FileManager");
  }

  async commit({ message }: { message: string }): Promise<{ commitId: string }> {
    if (!this.workerManager) throw new Error("WorkerManager unavailable");
    this.assertEditable();
    const branch = this.selectedBranch || this.mainBranch;
    const anyWm: any = this.workerManager as any;
    if (typeof anyWm.commit === "function") {
      const res = await anyWm.commit({ repoId: this.key, branch, message });
      return { commitId: res?.commitId || res?.id || "" };
    }
    throw new Error("commit not implemented in WorkerManager");
  }

  async pushToAllRemotes(params?: {
    branch?: string;
    mode?: PushFanoutMode;
    allowForce?: boolean;
    confirmDestructive?: boolean;
    remoteUrls?: string[];
    userPubkey?: string;
  }): Promise<PushFanoutResult> {
    this.assertEditable("push changes");

    const repoId = this.key;
    if (!repoId) {
      throw new FatalError("Cannot push: repository id is missing", GitErrorCode.INVALID_INPUT);
    }

    const mode: PushFanoutMode = params?.mode ?? "best-effort";
    const allowForce = params?.allowForce ?? false;
    const confirmDestructive = params?.confirmDestructive ?? false;

    // Resolve branch (short name)
    const fallbackMain = this.branchManager.getMainBranch();
    const branch =
      normalizeGitRefName(
        params?.branch ?? this.selectedBranch ?? this.mainBranch ?? fallbackMain
      ) || fallbackMain;

    const cloneUrlsRaw = [...(this.#repo?.clone || [])]
      .map((u) => String(u || "").trim())
      .filter(Boolean);

    // Only attempt URLs that look like push-capable remotes. We intentionally skip nostr:// URLs
    // that are meant for addressing/browsing rather than git push remotes.
    const isPushRemote = (u: string): boolean =>
      /^https?:\/\//i.test(u) || /^wss?:\/\//i.test(u) || /^ssh:\/\//i.test(u) || /^git@/i.test(u);

    const selectedUrls = new Set((params?.remoteUrls || []).map((u) => String(u || "").trim()));
    const cloneUrls = cloneUrlsRaw
      .filter(isPushRemote)
      .filter((u) => selectedUrls.size === 0 || selectedUrls.has(u));

    if (cloneUrls.length === 0) {
      throw new UserActionableError(
        "Cannot push: no push-capable remotes found in repository clone URLs",
        GitErrorCode.INVALID_INPUT
      );
    }

    // Ensure worker is ready for push operations
    await this.workerManager.initialize();

    // Load tokens once for fan-out; individual remote pushes select the right token by host
    let tokenList: Token[] = [];
    try {
      tokenList = await tokens.waitForInitialization();
    } catch {
      tokenList = [];
    }

    const getHost = (remoteUrl: string): string | undefined => {
      // Prefer core helper, but be resilient if it throws or returns empty
      try {
        const h = extractHostname(remoteUrl);
        if (h) return h;
      } catch {}
      try {
        const u = new URL(remoteUrl);
        return u.hostname || undefined;
      } catch {}
      const m = remoteUrl.match(/^git@([^:]+):/i);
      return m ? m[1] : undefined;
    };

    const results: PushFanoutResult["results"] = [];

    for (const remoteUrl of cloneUrls) {
      const host = getHost(remoteUrl);
      let provider: string | undefined = undefined;

      try {
        provider = String(detectVendorFromUrl(remoteUrl) || "");
      } catch {
        provider = undefined;
      }

      // Acquire token per host when possible (best-effort). GRASP remotes use pubkey auth.
      let token: string | undefined = undefined;

      const looksLikeGrasp = isGraspRepoHttpUrl(remoteUrl);
      if (!looksLikeGrasp) {
        if (!host) {
          results.push({
            remoteUrl,
            provider,
            host,
            success: false,
            error: new UserActionableError(
              `Cannot push to remote: unable to determine host for ${remoteUrl}`,
              GitErrorCode.INVALID_INPUT
            ),
          });
          continue;
        }

        try {
          token = await tryTokensForHost(tokenList, host, async (t: string) => t);
        } catch (e) {
          results.push({
            remoteUrl,
            provider,
            host,
            success: false,
            error: e,
          });
          continue;
        }
      }

      if (looksLikeGrasp) {
        provider = "grasp";
        token = params?.userPubkey || this.viewerPubkey || undefined;
      }

      try {
        const res = await this.workerManager.safePushToRemote({
          repoId,
          remoteUrl,
          branch,
          token,
          provider,
          allowForce,
          confirmDestructive,
        });

        results.push({
          remoteUrl,
          provider,
          host,
          success: !!res?.success,
          error: res?.success ? undefined : res,
        });
      } catch (e) {
        results.push({
          remoteUrl,
          provider,
          host,
          success: false,
          error: e,
        });
      }
    }

    const anySucceeded = results.some((r) => r.success);
    const allSucceeded = results.every((r) => r.success);

    const failed = results.filter((r) => !r.success);

    if (mode === "all-or-nothing" && failed.length > 0) {
      const msg =
        `Push failed for ${failed.length}/${results.length} remotes: ` +
        failed.map((r) => r.host || r.remoteUrl).join(", ");
      const err = new UserActionableError(msg, GitErrorCode.PERMISSION_DENIED);
      (err as any).details = { branch, results };
      throw err;
    }

    if (mode === "best-effort" && !anySucceeded) {
      const msg =
        `Push failed for all ${results.length} remotes: ` +
        failed.map((r) => r.host || r.remoteUrl).join(", ");
      const err = new RetriableError(msg, GitErrorCode.NETWORK_ERROR);
      (err as any).details = { branch, results };
      throw err;
    }

    return {
      branch,
      results,
      anySucceeded,
      allSucceeded,
    };
  }

  async getHeadCommitId(branchName?: string): Promise<string> {
    try {
      const short = normalizeGitRefName(branchName || this.selectedBranch || this.mainBranch || "");
      const refs = await this.getAllRefsWithFallback();
      const hit = refs.find((r) => r.type === "heads" && r.name === short);
      return hit?.commitId || "";
    } catch {
      return "";
    }
  }

}
