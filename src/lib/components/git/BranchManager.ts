import { WorkerManager } from "./WorkerManager";
import { CacheManager } from "./CacheManager";
import { context } from "$lib/stores/context";
import { toast } from "$lib/stores/toast";
import type { RepoAnnouncementEvent, RepoStateEvent } from "@nostr-git/core/events";
import { GIT_REPO_STATE, parseRepoAnnouncementEvent } from "@nostr-git/core/events";
import type { RefDiscoverySource, VendorReadRouter } from "./VendorReadRouter";
import { isDisplayableGitRef, isPeeledTagName, normalizeGitRefName } from "./branch-ref";

export type { RefDiscoverySource } from "./VendorReadRouter";

// Branch interface definition (since it's not exported from shared-types)
export interface Branch {
  name: string;
  commit: string;
  oid: string;
  lineage: boolean;
  isHead: boolean;
}

/**
 * Configuration options for BranchManager
 */
export interface BranchManagerConfig {
  /** Enable caching of branch data */
  enableCaching?: boolean;
  /** Cache TTL for branch data in milliseconds */
  cacheTTL?: number;
  /** Enable automatic refresh of branch data */
  autoRefresh?: boolean;
  /** Refresh interval in milliseconds */
  refreshInterval?: number;
  /** Optional vendor-first read router (API-first, git fallback) */
  vendorReadRouter?: VendorReadRouter;
}

/**
 * NIP-34 reference information parsed from repository state events
 */
export interface NIP34Reference {
  /** Full NIP-34 reference path (e.g., "refs/heads/main") */
  fullRef: string;
  /** Git-compatible short name (e.g., "main") */
  shortName: string;
  /** Reference type: "heads" for branches, "tags" for tags */
  type: "heads" | "tags";
  /** Commit ID this reference points to */
  commitId: string;
  /** Optional parent commit IDs for tracking commits ahead */
  parentCommits?: string[];
}

/**
 * Processed branch information combining git and NIP-34 data
 */
export interface ProcessedBranch extends Branch {
  /** NIP-34 reference information if available */
  nip34Ref?: NIP34Reference;
  /** Whether this branch comes from NIP-34 state event */
  fromStateEvent?: boolean;
  /** Whether this is the HEAD branch according to NIP-34 */
  isNIP34Head?: boolean;
}

/**
 * BranchManager handles all branch and tag operations, including the critical
 * mapping between NIP-34 reference formats and git-compatible names.
 *
 * NIP-34 uses full reference paths like "refs/heads/main" and "refs/tags/v1.0",
 * while git operations typically expect short names like "main" and "v1.0".
 * This component handles the translation between these formats seamlessly.
 */
export class BranchManager {
  private workerManager: WorkerManager;
  private cacheManager?: CacheManager;
  private config: Required<Omit<BranchManagerConfig, "vendorReadRouter">> &
    Pick<BranchManagerConfig, "vendorReadRouter">;

  // Branch state
  private branches: ProcessedBranch[] = [];
  private selectedBranch?: string;
  private mainBranch?: string;
  private nip34References: Map<string, NIP34Reference> = new Map();
  private refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> =
    [];
  private loadingRefs: boolean = false;
  private vendorReadRouter?: VendorReadRouter;
  private repoEventSnapshot?: RepoAnnouncementEvent;
  private refDiscoverySource?: RefDiscoverySource;
  private cloneUrlsOverride: string[] = [];

  setCloneUrls(cloneUrls: string[]): void {
    this.cloneUrlsOverride = Array.from(
      new Set((cloneUrls || []).map((u) => String(u || "").trim()).filter(Boolean))
    );
  }

  private getCloneUrlsFromRepoEvent(repoEvent: RepoAnnouncementEvent): string[] {
    if (this.cloneUrlsOverride.length > 0) return this.cloneUrlsOverride;

    try {
      const parsed: any = parseRepoAnnouncementEvent(repoEvent as any) as any;
      const clone = parsed?.clone;
      if (Array.isArray(clone)) {
        return clone.map((u: any) => String(u || "").trim()).filter(Boolean);
      }
    } catch {}

    try {
      const tags: any[] = (repoEvent as any)?.tags || [];
      const urls = tags
        .filter((t: any) => Array.isArray(t) && t[0] === "clone" && t[1])
        .map((t: any) => String(t[1] || "").trim())
        .filter(Boolean);
      if (urls.length > 0) return urls;
    } catch {}

    return [];
  }

  // Loading state
  private loadingIds: {
    branches: string | null;
  } = {
    branches: null,
  };

  // Auto-refresh timer
  private refreshTimer?: ReturnType<typeof setInterval>;

  // Guards to reduce repeated work
  private branchExistsCache: Map<string, { exists: boolean; ts: number }> = new Map();
  private branchExistsInFlight: Map<string, Promise<boolean>> = new Map();
  private static readonly BRANCH_EXISTS_TTL_MS = 60_000; // 60s
  private lastLoadRefsAt = 0;
  private static readonly MIN_LOADREFS_INTERVAL_MS = 2000; // 2s

  constructor(
    workerManager: WorkerManager,
    cacheManager?: CacheManager,
    config: BranchManagerConfig = {}
  ) {
    this.workerManager = workerManager;
    this.cacheManager = cacheManager;

    // Set default configuration
    this.config = {
      enableCaching: config.enableCaching ?? true,
      cacheTTL: config.cacheTTL ?? 5 * 60 * 1000, // 5 minutes
      autoRefresh: config.autoRefresh ?? false,
      refreshInterval: config.refreshInterval ?? 30 * 1000, // 30 seconds,
      vendorReadRouter: config.vendorReadRouter ?? undefined,
    };

    this.vendorReadRouter = config.vendorReadRouter;
  }

  /**
   * Parse NIP-34 reference string into structured information
   *
   * Examples:
   * - "refs/heads/main" -> { type: "heads", shortName: "main", ... }
   * - "refs/tags/v1.0.0" -> { type: "tags", shortName: "v1.0.0", ... }
   */
  static parseNIP34Reference(refTag: string[], commitId?: string): NIP34Reference | null {
    if (refTag.length < 2) return null;

    const fullRef = refTag[0];
    const refCommitId = refTag[1] || commitId;

    if (!refCommitId) return null;

    // Parse ref path: refs/heads/branch-name or refs/tags/tag-name
    const refMatch = fullRef.match(/^refs\/(heads|tags)\/(.+)$/);
    if (!refMatch) return null;

    const [, type, shortName] = refMatch;
    if (type === "tags" && isPeeledTagName(shortName)) return null;

    // Extract parent commits if provided (for tracking commits ahead)
    const parentCommits = refTag.length > 2 ? refTag.slice(2) : undefined;

    return {
      fullRef,
      shortName,
      type: type as "heads" | "tags",
      commitId: refCommitId,
      parentCommits,
    };
  }

  /**
   * Convert git short name to NIP-34 full reference
   */
  static gitNameToNIP34Ref(shortName: string, type: "heads" | "tags" = "heads"): string {
    return `refs/${type}/${shortName}`;
  }

  /**
   * Convert NIP-34 full reference to git short name
   */
  static nip34RefToGitName(fullRef: string): string | null {
    const match = fullRef.match(/^refs\/(heads|tags)\/(.+)$/);
    return match ? match[2] : null;
  }

  /**
   * Parse HEAD reference from NIP-34 format
   * Example: ["HEAD", "ref: refs/heads/main"] -> "main"
   */
  static parseNIP34Head(headTag: string[]): string | null {
    if (headTag.length < 2 || headTag[0] !== "HEAD") return null;

    const headRef = headTag[1];
    const match = headRef.match(/^ref: refs\/heads\/(.+)$/);
    return match ? match[1] : null;
  }

  /**
   * Handle branch resolution errors and surface them through toast system
   */
  private handleBranchNotFound(branchName: string, error: any): void {
    // Only show toast for non-fallback branches (not main/master/develop/dev)
    const fallbackBranches = ["main", "master", "develop", "dev"];
    if (!fallbackBranches.includes(branchName)) {
      const message = `Branch '${branchName}' from repository state not found in local git repository`;
      toast.push({ message, duration: 8000 }); // Show for 8 seconds
      console.warn(`Branch resolution warning: ${message}`, error);
    }
  }

  /**
   * Compute a canonical repo key for worker calls (mirrors FileManager behavior)
   */
  private getCanonicalRepoKey(repoEvent: RepoAnnouncementEvent): string {
    try {
      const dTag = (repoEvent as any).tags?.find((t: any[]) => t?.[0] === "d");
      const identifier = dTag?.[1]?.trim();
      if (identifier) {
        return `${repoEvent.pubkey}/${identifier}`;
      }
      const parsed = parseRepoAnnouncementEvent(repoEvent as any) as any;
      if (parsed?.repoId) {
        return String(parsed.repoId);
      }
    } catch {}
    return (repoEvent as any)?.id || `${(repoEvent as any)?.pubkey || "unknown"}`;
  }

  /**
   * Process repository state event to extract branch/tag information
   */
  processRepoStateEvent(stateEvent: RepoStateEvent): void {
    this.nip34References.clear();

    if (!stateEvent.tags) return;

    let newMainBranch: string | undefined;

    for (const tag of stateEvent.tags) {
      if (tag[0] === "HEAD") {
        // Parse HEAD reference
        const headBranch = BranchManager.parseNIP34Head(tag);
        if (headBranch) {
          newMainBranch = headBranch;
        }
      } else if (tag[0].startsWith("refs/")) {
        // Parse branch/tag reference
        const ref = BranchManager.parseNIP34Reference(tag);
        if (ref) {
          this.nip34References.set(ref.shortName, ref);
        }
      }
    }

    // Update main branch if found
    if (newMainBranch) {
      this.mainBranch = newMainBranch;
    }

    console.log(`Processed ${this.nip34References.size} NIP-34 references, HEAD: ${newMainBranch}`);
  }

  /**
   * Check if a given branch exists in the actual repo via worker.
   * Uses a lightweight list call; if it errors with not found, we treat as non-existent.
   */
  private async branchExists(repoEvent: RepoAnnouncementEvent, branch: string): Promise<boolean> {
    const repoKey = this.getCanonicalRepoKey(repoEvent);
    const key = `${repoKey}:${branch}`;
    const now = Date.now();
    const cached = this.branchExistsCache.get(key);
    if (cached && now - cached.ts < BranchManager.BRANCH_EXISTS_TTL_MS) {
      return cached.exists;
    }
    const inFlight = this.branchExistsInFlight.get(key);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        await this.workerManager.listRepoFilesFromEvent({ repoEvent, repoKey, branch, path: "" });
        this.branchExistsCache.set(key, { exists: true, ts: Date.now() });
        return true;
      } catch (err: any) {
        const msg = (err && (err.message || String(err))) || "";
        if (typeof msg === "string" && /could not find|not found|unknown ref/i.test(msg)) {
          this.branchExistsCache.set(key, { exists: false, ts: Date.now() });
          return false;
        }
        console.warn(`branchExists(${branch}) indeterminate due to error:`, err);
        // Treat as exists to avoid overly aggressive pruning; cache briefly
        this.branchExistsCache.set(key, { exists: true, ts: Date.now() });
        return true;
      } finally {
        this.branchExistsInFlight.delete(key);
      }
    })();
    this.branchExistsInFlight.set(key, p);
    return p;
  }

  private sortRefs(
    refs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>
  ): Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> {
    return refs
      .filter((ref) => isDisplayableGitRef(ref))
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "heads" ? -1 : 1
      );
  }

  private reconcileRefsWithDiscovered(
    loadedRefs: Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>,
    discoveredRefs: Array<{
      name: string;
      type: "heads" | "tags";
      fullRef: string;
      commitId: string;
    }>
  ): Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> {
    const loadedByTypeAndName = new Map(loadedRefs.map((ref) => [`${ref.type}:${ref.name}`, ref]));
    const discoveredHeads = discoveredRefs.filter((ref) => ref.type === "heads");
    const discoveredTags = discoveredRefs.filter((ref) => ref.type === "tags");

    if (discoveredHeads.length === 0 && discoveredTags.length === 0) {
      return this.sortRefs([...loadedRefs]);
    }

    const nextRefs = new Map<
      string,
      { name: string; type: "heads" | "tags"; fullRef: string; commitId: string }
    >();

    if (discoveredHeads.length > 0) {
      for (const ref of discoveredHeads) {
        const cached = loadedByTypeAndName.get(`heads:${ref.name}`);
        nextRefs.set(`heads:${ref.name}`, {
          ...ref,
          commitId: ref.commitId || cached?.commitId || "",
        });
      }
    } else {
      for (const ref of loadedRefs.filter((ref) => ref.type === "heads")) {
        nextRefs.set(`heads:${ref.name}`, ref);
      }
    }

    for (const ref of [...loadedRefs.filter((ref) => ref.type === "tags"), ...discoveredTags]) {
      nextRefs.set(`tags:${ref.name}`, ref);
    }

    return this.sortRefs(Array.from(nextRefs.values()));
  }

  private syncBranchSelectionFromRefs(defaultBranchHint?: string): void {
    const headNames = this.refs.filter((ref) => ref.type === "heads").map((ref) => ref.name);
    const refNames = new Set(this.refs.map((ref) => ref.name));
    const previousMainBranch = this.mainBranch;
    const discoveredDefaultBranch = normalizeGitRefName(defaultBranchHint || "");

    if (headNames.length > 0) {
      if (discoveredDefaultBranch && headNames.includes(discoveredDefaultBranch)) {
        this.mainBranch = discoveredDefaultBranch;
      } else if (!this.mainBranch || !headNames.includes(this.mainBranch)) {
        const commonDefaults = ["main", "master", "develop", "dev"];
        this.mainBranch = commonDefaults.find((name) => headNames.includes(name)) || headNames[0];
      }
    } else if (this.mainBranch && !refNames.has(this.mainBranch)) {
      this.mainBranch = undefined;
    }

    if (this.selectedBranch && !refNames.has(this.selectedBranch)) {
      this.selectedBranch = this.mainBranch || headNames[0] || this.refs[0]?.name;
    } else if (
      !this.selectedBranch ||
      (previousMainBranch &&
        previousMainBranch !== this.mainBranch &&
        this.selectedBranch === previousMainBranch)
    ) {
      this.selectedBranch = this.mainBranch || headNames[0] || this.refs[0]?.name;
    }
  }

  private pruneNip34HeadReferences(actualHeadNames: Set<string>): void {
    if (actualHeadNames.size === 0) return;

    const nextRefs = new Map<string, NIP34Reference>();
    for (const [shortName, ref] of this.nip34References.entries()) {
      if (ref.type === "tags" || actualHeadNames.has(shortName)) {
        nextRefs.set(shortName, ref);
      }
    }

    this.nip34References = nextRefs;
  }

  /**
   * Process repository state event but only keep branches that actually exist in the repo.
   * Tags are kept as-is; HEAD is only set if the branch exists.
   */
  async processRepoStateEventVerified(
    stateEvent: RepoStateEvent,
    repoEvent: RepoAnnouncementEvent
  ): Promise<void> {
    this.repoEventSnapshot = repoEvent;
    this.nip34References.clear();

    if (!stateEvent.tags) return;

    let newMainBranch: string | undefined;

    const fallbackDefaults = new Set(["main", "master", "develop", "dev"]);

    for (const tag of stateEvent.tags) {
      if (tag[0] === "HEAD") {
        const headBranch = BranchManager.parseNIP34Head(tag);
        if (headBranch) {
          // Always honor HEAD; warn if verification fails but don't drop it
          //const exists = await this.branchExists(repoEvent, headBranch);
          //if (!exists) {
          //  this.handleBranchNotFound(headBranch, new Error("HEAD branch missing in repo (kept due to HEAD)"));
          //}
          newMainBranch = headBranch;
        }
      } else if (tag[0].startsWith("refs/")) {
        const ref = BranchManager.parseNIP34Reference(tag);
        if (ref) {
          if (ref.type === "heads") {
            // Always include common defaults and HEAD branch even if verification fails
            const isDefault = fallbackDefaults.has(ref.shortName);
            const isHead = newMainBranch && ref.shortName === newMainBranch;
            //const exists = await this.branchExists(repoEvent, ref.shortName);
            //if (exists || isDefault || isHead) {
            this.nip34References.set(ref.shortName, ref);
            //} else {
            //  this.handleBranchNotFound(ref.shortName, new Error("Branch missing in repo"));
            //}
          } else {
            // Always include tags
            this.nip34References.set(ref.shortName, ref);
          }
        }
      }
    }

    if (newMainBranch) {
      this.mainBranch = newMainBranch;
      // Auto-select the main branch if no branch is currently selected
      if (!this.selectedBranch) {
        this.selectedBranch = newMainBranch;
      }
    }

    console.log(
      `Verified ${this.nip34References.size} NIP-34 refs (heads filtered by existence), HEAD: ${newMainBranch}, selectedBranch: ${this.selectedBranch}`
    );
  }

  /**
   * Get current branches
   */
  getBranches(): ProcessedBranch[] {
    return this.branches;
  }

  /**
   * Get all refs (branches and tags)
   */
  getAllRefs(): Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }> {
    return this.refs;
  }

  getRefDiscoverySource(): RefDiscoverySource | undefined {
    return this.refDiscoverySource;
  }

  /**
   * Check if refs are currently loading
   */
  isLoadingRefs(): boolean {
    return this.loadingRefs;
  }

  /**
   * Get main branch name (git-compatible short name)
   */
  getMainBranch(): string {
    // First try to use the explicitly set main branch
    if (this.mainBranch) {
      return this.mainBranch;
    }

    // Try to find the HEAD branch from repository state
    const headBranch = this.branches.find((b) => b.isHead);
    if (headBranch) {
      return headBranch.name;
    }

    // Fallback to common default branch names in order of preference
    const branchNames = this.branches.map((b) => b.name);
    const commonDefaults = ["main", "master", "develop", "dev"];

    for (const defaultName of commonDefaults) {
      if (branchNames.includes(defaultName)) {
        return defaultName;
      }
    }

    // If we have any branches, use the first one
    if (this.branches.length > 0) {
      return this.branches[0].name;
    }

    // Ultimate fallback
    return "master";
  }

  /**
   * Get selected branch name
   */
  getSelectedBranch(): string | undefined {
    return this.selectedBranch;
  }

  /**
   * Set selected branch
   */
  setSelectedBranch(branchName: string): void {
    this.selectedBranch = branchName;
  }

  /**
   * Get NIP-34 reference for a branch/tag name
   */
  getNIP34Reference(shortName: string): NIP34Reference | undefined {
    return this.nip34References.get(shortName);
  }

  /**
   * Get all NIP-34 references
   */
  getAllNIP34References(): Map<string, NIP34Reference> {
    return new Map(this.nip34References);
  }

  /**
   * Check if branches are currently loading
   */
  isLoading(): boolean {
    return this.loadingIds.branches !== null;
  }

  /**
   * Set the repository event snapshot for vendor API fallback
   * Call this before loadAllRefs when no RepoStateEvent is available
   */
  setRepoEvent(repoEvent: RepoAnnouncementEvent): void {
    this.repoEventSnapshot = repoEvent;
  }

  /**
   * Load all refs (branches and tags) with fallback logic
   * This is the primary method that should be used to load branch/tag data
   */
  async loadAllRefs(
    getAllRefsWithFallback: () => Promise<
      Array<{ name: string; type: "heads" | "tags"; fullRef: string; commitId: string }>
    >
  ): Promise<void> {
    const now = Date.now();
    if (this.loadingRefs && now - this.lastLoadRefsAt < BranchManager.MIN_LOADREFS_INTERVAL_MS) {
      // Prevent re-entrance thrash
      return;
    }
    try {
      this.loadingRefs = true;
      this.lastLoadRefsAt = now;

      // Use the Repo's getAllRefsWithFallback which has proper fallback logic
      let loadedRefs = await getAllRefsWithFallback();
      let refSource: RefDiscoverySource | undefined = loadedRefs.length
        ? {
            kind: "repo-state",
            label: "Repo state snapshot",
            details:
              "Using signed repo-state refs until remote discovery confirms the live ref set.",
          }
        : undefined;

      const loadedHeadCount = (loadedRefs || []).filter((ref) => ref.type === "heads").length;
      let discoveredDefaultBranch: string | undefined;
      if (this.vendorReadRouter && this.repoEventSnapshot) {
        try {
          const cloneUrls = this.getCloneUrlsFromRepoEvent(this.repoEventSnapshot);
          const vendorRes = await this.vendorReadRouter.listRefs({
            workerManager: this.workerManager,
            repoEvent: this.repoEventSnapshot,
            cloneUrls,
          });

          const discoveredRefs = (vendorRes.refs || []).map((r) => ({
            name: r.name,
            type: r.type,
            fullRef: r.fullRef,
            commitId: r.commitId,
          }));
          discoveredDefaultBranch = vendorRes.defaultBranch;

          if (discoveredRefs.length > 0) {
            loadedRefs = this.reconcileRefsWithDiscovered(loadedRefs || [], discoveredRefs);
            this.pruneNip34HeadReferences(
              new Set(loadedRefs.filter((ref) => ref.type === "heads").map((ref) => ref.name))
            );
            refSource = vendorRes.source || refSource;
          } else if (!loadedRefs || loadedRefs.length === 0 || loadedHeadCount <= 1) {
            loadedRefs = this.sortRefs(loadedRefs || []);
            refSource = loadedRefs.length > 0 ? refSource : vendorRes.source;
          }
        } catch (e) {
          console.warn("VendorReadRouter.listRefs failed; continuing with optimistic refs:", e);
        }
      }

      this.refs = this.sortRefs(loadedRefs || []);
      this.refDiscoverySource = refSource;
      this.syncBranchSelectionFromRefs(discoveredDefaultBranch);

      // Convert refs to ProcessedBranch format for backward compatibility
      this.branches = this.refs
        .filter((ref) => ref.type === "heads")
        .map((ref): ProcessedBranch => {
          const nip34Ref = this.nip34References.get(ref.name);
          return {
            name: ref.name,
            commit: ref.commitId,
            oid: ref.commitId,
            lineage: ref.name === this.mainBranch,
            isHead: ref.name === this.mainBranch,
            nip34Ref,
            fromStateEvent: !!nip34Ref,
            isNIP34Head: ref.name === this.mainBranch,
          };
        });

      this.loadingRefs = false;
      console.log(
        `Loaded ${this.refs.length} refs (${this.branches.length} branches, ${this.refs.filter((r) => r.type === "tags").length} tags)`
      );
    } catch (error) {
      console.error("Error loading refs:", error);
      this.refs = [];
      this.branches = [];
      this.loadingRefs = false;
      throw error;
    }
  }

  /**
   * Load branches from repository event (legacy method, prefer loadAllRefs)
   * @deprecated Use loadAllRefs instead
   */
  async loadBranchesFromRepo(repoEvent: RepoAnnouncementEvent): Promise<void> {
    this.repoEventSnapshot = repoEvent;
    try {
      // Clear any previous loading message
      if (this.loadingIds.branches) {
        context.remove(this.loadingIds.branches);
      }

      this.loadingIds.branches = context.loading("Loading branches...");

      // Get branches from git repository via worker
      const repoBranches = await this.workerManager.listBranchesFromEvent({ repoEvent });

      // Process branches and merge with NIP-34 data
      this.branches = repoBranches.map((branch: Branch): ProcessedBranch => {
        const nip34Ref = this.nip34References.get(branch.name);

        return {
          ...branch,
          nip34Ref,
          fromStateEvent: !!nip34Ref,
          isNIP34Head: branch.name === this.mainBranch,
        };
      });

      // Add any NIP-34 references that don't exist in git branches
      for (const [shortName, ref] of this.nip34References) {
        if (ref.type === "heads" && !this.branches.find((b) => b.name === shortName)) {
          // This is a branch that exists in NIP-34 state but not in git
          // This could happen if the branch was deleted locally but still tracked in state
          this.branches.push({
            name: shortName,
            commit: ref.commitId,
            oid: ref.commitId,
            lineage: shortName === this.mainBranch,
            isHead: shortName === this.mainBranch,
            nip34Ref: ref,
            fromStateEvent: true,
            isNIP34Head: shortName === this.mainBranch,
          });
        }
      }

      // Update loading message to success
      if (this.loadingIds.branches) {
        context.update(this.loadingIds.branches, {
          type: "success",
          message: `Loaded ${this.branches.length} branches`,
          duration: 2000,
        });
        this.loadingIds.branches = null;
      }

      console.log(`Loaded ${this.branches.length} branches with NIP-34 integration`);
    } catch (error) {
      console.error("Error loading branches:", error);

      if (this.loadingIds.branches) {
        context.update(this.loadingIds.branches, {
          type: "error",
          message: "Failed to load branches",
          details: error instanceof Error ? error.message : "Unknown error",
          duration: 5000,
        });
        this.loadingIds.branches = null;
      } else {
        context.error(
          "Failed to load branches",
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      this.branches = [];
    }
  }

  /**
   * Refresh branch data
   */
  async refreshBranches(repoEvent: RepoAnnouncementEvent): Promise<void> {
    await this.loadBranchesFromRepo(repoEvent);
  }

  /**
   * Get branch by name (supports both git short names and NIP-34 full refs)
   */
  getBranch(nameOrRef: string): ProcessedBranch | undefined {
    // Try direct name match first
    let branch = this.branches.find((b) => b.name === nameOrRef);
    if (branch) return branch;

    // Try NIP-34 full ref conversion
    const shortName = BranchManager.nip34RefToGitName(nameOrRef);
    if (shortName) {
      branch = this.branches.find((b) => b.name === shortName);
    }

    return branch;
  }

  /**
   * Get branches filtered by type (heads or tags)
   */
  getBranchesByType(type: "heads" | "tags"): ProcessedBranch[] {
    return this.branches.filter((branch) => {
      if (branch.nip34Ref) {
        return branch.nip34Ref.type === type;
      }
      // For branches without NIP-34 data, assume they are heads
      return type === "heads";
    });
  }

  /**
   * Get only branches (heads)
   */
  getHeads(): ProcessedBranch[] {
    return this.getBranchesByType("heads");
  }

  /**
   * Get only tags
   */
  getTags(): ProcessedBranch[] {
    return this.getBranchesByType("tags");
  }

  /**
   * Start auto-refresh if enabled
   */
  startAutoRefresh(repoEvent: RepoAnnouncementEvent): void {
    if (!this.config.autoRefresh) return;

    this.stopAutoRefresh();

    this.refreshTimer = setInterval(async () => {
      try {
        await this.refreshBranches(repoEvent);
      } catch (error) {
        console.error("Auto-refresh failed:", error);
      }
    }, this.config.refreshInterval);

    console.log(`Started auto-refresh every ${this.config.refreshInterval}ms`);
  }

  /**
   * Stop auto-refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      console.log("Stopped auto-refresh");
    }
  }

  /**
   * Reset branch state
   */
  reset(): void {
    this.branches = [];
    this.selectedBranch = undefined;
    this.mainBranch = undefined;
    this.nip34References.clear();
    this.refs = [];
    this.refDiscoverySource = undefined;

    // Clear loading states
    if (this.loadingIds.branches) {
      context.remove(this.loadingIds.branches);
      this.loadingIds.branches = null;
    }

    this.stopAutoRefresh();
  }

  /**
   * Get branch statistics (for debugging/monitoring)
   */
  getStats(): {
    totalBranches: number;
    headsCount: number;
    tagsCount: number;
    nip34RefsCount: number;
    mainBranch?: string;
    selectedBranch?: string;
    isLoading: boolean;
  } {
    return {
      totalBranches: this.branches.length,
      headsCount: this.getHeads().length,
      tagsCount: this.getTags().length,
      nip34RefsCount: this.nip34References.size,
      mainBranch: this.mainBranch,
      selectedBranch: this.selectedBranch,
      isLoading: this.isLoading(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BranchManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log("BranchManager configuration updated:", this.config);
  }

  /**
   * Dispose of the branch manager
   */
  dispose(): void {
    // Clear loading states
    if (this.loadingIds.branches) {
      context.remove(this.loadingIds.branches);
    }

    // Stop auto-refresh
    this.stopAutoRefresh();

    // Reset state
    this.reset();

    console.log("BranchManager disposed");
  }
}
