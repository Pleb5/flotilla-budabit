import { WorkerManager } from "./WorkerManager";
import { CacheManager, CacheType } from "./CacheManager";
import { context } from "$lib/stores/context";
import { createNetworkError, createUnknownError } from "@nostr-git/core/errors";
import type { VendorReadRouter } from "./VendorReadRouter";
import type { RepoAnnouncementEvent } from "@nostr-git/core/events";
import { parseRepoAnnouncementEvent } from "@nostr-git/core/events";
import { normalizeGitRefName } from "./branch-ref";

/**
 * Configuration options for CommitManager
 */
export interface CommitManagerConfig {
  /** Default commits per page */
  defaultCommitsPerPage?: number;
  /** Maximum commits per page */
  maxCommitsPerPage?: number;
  /** Default depth for commit history */
  defaultDepth?: number;
  /** Enable caching of commit data */
  enableCaching?: boolean;
  /** Optional vendor-first read router (API-first, git fallback) */
  vendorReadRouter?: VendorReadRouter;
}

/**
 * Pagination state for commit history
 */
export interface CommitPagination {
  page: number;
  pageSize: number;
  total?: number;
  hasMore: boolean;
  loading: boolean;
}

/**
 * Result of commit loading operations
 */
export interface CommitLoadResult {
  success: boolean;
  commits?: any[];
  totalCount?: number;
  error?: string;
  fromCache?: boolean;
}

/**
 * CommitManager handles all commit-related operations including history loading,
 * pagination, caching, and coordination with the git worker system.
 *
 * This component is part of the composition-based refactor of the Repo class,
 * extracting commit-specific functionality into a focused, reusable component.
 */
export class CommitManager {
  private workerManager: WorkerManager;
  private cacheManager?: CacheManager;
  private config: Required<Omit<CommitManagerConfig, "vendorReadRouter">> &
    Pick<CommitManagerConfig, "vendorReadRouter">;
  private vendorReadRouter?: VendorReadRouter;
  private repoEventSnapshot?: RepoAnnouncementEvent;
  private cloneUrlsOverride: string[] = [];
  // Repo identifiers
  private canonicalKey?: string; // for caches and internal maps
  private workerRepoId?: string; // for worker API calls
  // Cache
  private readonly COMMIT_CACHE_NAME = "commit_history";

  // Commit state
  private commits: any[] = [];
  private totalCommits?: number;
  private currentPage: number = 1;
  private commitsPerPage: number;
  private hasMoreCommits: boolean = false;
  private currentBranch?: string; // The branch currently being used for commits
  private currentMainBranch?: string; // The main branch for fallback

  // Loading state
  private loadingIds: {
    commits: string | null;
    branches: string | null;
  } = {
    commits: null,
    branches: null,
  };

  constructor(
    workerManager: WorkerManager,
    cacheManager?: CacheManager,
    config: CommitManagerConfig = {}
  ) {
    this.workerManager = workerManager;
    this.cacheManager = cacheManager;

    // Set default configuration
    this.config = {
      defaultCommitsPerPage: config.defaultCommitsPerPage ?? 30,
      maxCommitsPerPage: config.maxCommitsPerPage ?? 100,
      defaultDepth: config.defaultDepth ?? 100,
      enableCaching: config.enableCaching ?? true,
      vendorReadRouter: config.vendorReadRouter ?? undefined,
    };

    this.vendorReadRouter = config.vendorReadRouter;

    this.commitsPerPage = this.config.defaultCommitsPerPage;

    // Register commit cache if available
    if (this.cacheManager) {
      this.cacheManager.registerCache(this.COMMIT_CACHE_NAME, {
        type: CacheType.LOCAL_STORAGE,
        keyPrefix: "commit_history_cache_",
        defaultTTL: 15 * 60 * 1000,
        autoCleanup: true,
        cleanupInterval: 5 * 60 * 1000,
      });
    }
  }

  /**
   * Set the current repository identifiers
   */
  setRepoKeys(keys: { canonicalKey?: string; workerRepoId?: string }) {
    if (keys.canonicalKey) this.canonicalKey = keys.canonicalKey;
    if (keys.workerRepoId) this.workerRepoId = keys.workerRepoId;
  }

  /**
   * Set the repository event snapshot for vendor API fallback
   * Call this when the repo event is available
   */
  setRepoEvent(repoEvent: RepoAnnouncementEvent): void {
    this.repoEventSnapshot = repoEvent;
  }

  setCloneUrls(cloneUrls: string[]): void {
    this.cloneUrlsOverride = Array.from(
      new Set((cloneUrls || []).map((u) => String(u || "").trim()).filter(Boolean))
    );
  }

  /**
   * Extract clone URLs from a repo event
   */
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

  private parseVendorDateTimestamp(value: unknown): number | undefined {
    if (!value) return undefined;
    const time = new Date(String(value)).getTime();
    if (!Number.isFinite(time)) return undefined;
    return Math.floor(time / 1000);
  }

  /**
   * Set the current branch for commit loading
   * This is useful when switching branches to ensure subsequent operations use the correct branch
   */
  setCurrentBranch(branch: string, mainBranch?: string): void {
    this.currentBranch = branch;
    if (mainBranch) {
      this.currentMainBranch = mainBranch;
    }
  }

  /**
   * Get the current branch being used for commits
   */
  getCurrentBranch(): string | undefined {
    return this.currentBranch;
  }

  /**
   * Get current commits
   */
  getCommits(): any[] {
    console.log(
      `[CommitManager.getCommits] Returning ${this.commits.length} commits, currentBranch=${this.currentBranch}`
    );
    return this.commits;
  }

  /**
   * Get total commit count
   */
  getTotalCommits(): number | undefined {
    return this.totalCommits;
  }

  /**
   * Get current page number
   */
  getCurrentPage(): number {
    return this.currentPage;
  }

  /**
   * Get commits per page
   */
  getCommitsPerPage(): number {
    return this.commitsPerPage;
  }

  /**
   * Check if there are more commits to load
   */
  getHasMoreCommits(): boolean {
    return this.hasMoreCommits;
  }

  /**
   * Get current pagination state
   */
  getPagination(): CommitPagination {
    return {
      page: this.currentPage,
      pageSize: this.commitsPerPage,
      total: this.totalCommits,
      hasMore: this.hasMoreCommits,
      loading: this.loadingIds.commits !== null,
    };
  }

  /**
   * Check if commits are currently loading
   */
  isLoading(): boolean {
    return this.loadingIds.commits !== null;
  }

  /**
   * Set commits per page (with validation)
   */
  setCommitsPerPage(count: number): void {
    if (count > 0 && count <= this.config.maxCommitsPerPage) {
      this.commitsPerPage = count;
      // Reset pagination when page size changes
      this.currentPage = 1;
      this.commits = [];
      this.totalCommits = undefined;
      this.hasMoreCommits = false;
    }
  }

  /**
   * Load commits for a specific page
   */
  async loadPage(page: number): Promise<CommitLoadResult> {
    this.currentPage = page;
    return await this.loadCommits();
  }

  /**
   * Load more commits (next page)
   */
  async loadMoreCommits(): Promise<CommitLoadResult> {
    if (this.hasMoreCommits && !this.isLoading()) {
      this.currentPage++;
      return await this.loadCommits();
    }
    return { success: false, error: "No more commits to load or already loading" };
  }

  /**
   * Refresh commits (reload current page)
   */
  async refreshCommits(): Promise<CommitLoadResult> {
    // Clear cache if enabled
    if (this.config.enableCaching && this.cacheManager) {
      // Clear commit history cache to force fresh load
      await this.cacheManager.clear(this.COMMIT_CACHE_NAME);
    }

    return await this.loadCommits();
  }

  /**
   * Load commit history for a repository and branch
   */
  async loadCommits(
    repoId?: string,
    branch?: string,
    mainBranch?: string
  ): Promise<CommitLoadResult> {
    const effectiveRepoId = repoId || this.workerRepoId;

    // Use stored values as fallbacks when parameters not provided
    const effectiveMainBranch = mainBranch || this.currentMainBranch;
    const effectiveBranch = branch || this.currentBranch || effectiveMainBranch;

    // Debug logging to trace the issue
    console.log("[CommitManager] loadCommits called with:", {
      repoId,
      workerRepoId: this.workerRepoId,
      effectiveRepoId,
      branch,
      effectiveBranch,
      mainBranch,
      effectiveMainBranch,
      storedBranch: this.currentBranch,
      storedMainBranch: this.currentMainBranch,
    });

    // Validate repoId is not empty string
    if (!effectiveRepoId || effectiveRepoId.trim() === "" || !effectiveMainBranch) {
      console.debug("[CommitManager] loadCommits skipped: missing repoId or mainBranch", {
        effectiveRepoId,
        effectiveMainBranch,
      });
      return { success: false, error: "Repository ID and main branch are required" };
    }

    // Store the branch info for subsequent calls (loadMoreCommits, loadPage, etc.)
    if (mainBranch) {
      this.currentMainBranch = mainBranch;
    }
    if (branch) {
      this.currentBranch = branch;
    }

    try {
      // Clear any previous error
      if (this.loadingIds.commits) {
        context.remove(this.loadingIds.commits);
      }

      this.loadingIds.commits = context.loading("Loading commits...");

      // Try cache first if enabled
      const cacheEnabled = !!(this.config.enableCaching && this.cacheManager && this.canonicalKey);
      // Ensure branchName is normalized while preserving branch paths (e.g. fix/ipk-builds)
      const branchName =
        normalizeGitRefName(effectiveBranch ?? effectiveMainBranch) ||
        normalizeGitRefName(effectiveMainBranch) ||
        "main";
      console.log(
        "[CommitManager] branchName resolved to:",
        branchName,
        "from branch:",
        branch,
        "mainBranch:",
        mainBranch
      );
      const pageKey = cacheEnabled
        ? `${this.canonicalKey}:${branchName}:p${this.currentPage}:s${this.commitsPerPage}`
        : undefined;
      console.log("[CommitManager] pageKey:", pageKey, "cacheEnabled:", cacheEnabled);
      type CommitPageCacheEntry = {
        commits: any[];
        total?: number;
        page: number;
        pageSize: number;
        branch: string;
        repoKey: string;
      };
      if (cacheEnabled && pageKey) {
        console.log(`[CommitManager] Checking cache for key: ${pageKey}`);
        const cached = await this.cacheManager!.get<CommitPageCacheEntry>(
          this.COMMIT_CACHE_NAME,
          pageKey
        );
        if (cached) {
          console.log(
            `[CommitManager] Cache hit for ${pageKey}: repoKey=${cached.repoKey}, branch=${cached.branch}, commits=${cached.commits?.length}`
          );
        } else {
          console.log(`[CommitManager] Cache miss for ${pageKey}`);
        }
        if (cached && cached.repoKey === this.canonicalKey && cached.branch === branchName) {
          // Apply cached state
          this.commits = cached.commits;
          this.totalCommits = cached.total;
          this.hasMoreCommits = cached.total
            ? this.currentPage * this.commitsPerPage < cached.total
            : cached.commits.length === this.commitsPerPage; // heuristic if no total

          console.log(
            `[CommitManager] Using cached commits: ${this.commits.length} for branch ${branchName}`
          );
          if (this.loadingIds.commits) {
            context.remove(this.loadingIds.commits);
            this.loadingIds.commits = null;
          }
          return {
            success: true,
            commits: this.commits,
            totalCount: this.totalCommits,
            fromCache: true,
          };
        }
      }

      // Calculate the depth needed for current page
      const requiredDepth = this.commitsPerPage * this.currentPage;

      // Double-check repoId before worker call (defensive)
      if (!effectiveRepoId || effectiveRepoId.trim() === "") {
        console.error("[CommitManager] effectiveRepoId is empty before getRepoDataLevel call");
        return { success: false, error: "Repository ID is empty" };
      }

      // Try vendor API FIRST if available (API-first for fast UI response)
      // This avoids waiting for slow git clone/sync operations for supported vendors like GitHub
      let commitsResult: {
        success: boolean;
        commits?: any[];
        fallbackUsed?: string;
        error?: string;
        fromVendor?: boolean;
        hasMore?: boolean;
      };

      if (this.vendorReadRouter && this.repoEventSnapshot) {
        try {
          const cloneUrls = this.getCloneUrlsFromRepoEvent(this.repoEventSnapshot);
          console.log(
            `[CommitManager] Trying VendorReadRouter.listCommits FIRST for branch=${branchName}, depth=${requiredDepth}`
          );

          const vendorResult = await this.vendorReadRouter.listCommits({
            workerManager: this.workerManager,
            repoEvent: this.repoEventSnapshot,
            repoKey: this.canonicalKey,
            cloneUrls,
            branch: branchName,
            depth: requiredDepth,
            page: this.currentPage,
            perPage: this.commitsPerPage,
          });

          // Convert vendor result format to internal format
          commitsResult = {
            success: true,
            commits: vendorResult.commits.map((c: any) => ({
              oid: c.sha,
              commit: {
                message: c.message,
                author: {
                  name: c.author.name,
                  email: c.author.email,
                  timestamp: this.parseVendorDateTimestamp(c.author.date),
                },
                committer: {
                  name: c.committer.name,
                  email: c.committer.email,
                  timestamp: this.parseVendorDateTimestamp(c.committer.date),
                },
                parent: c.parents?.map((p: any) => p.sha) || [],
              },
            })),
            fromVendor: vendorResult.fromVendor,
            hasMore: vendorResult.hasMore,
          };
          console.log(
            `[CommitManager] VendorReadRouter returned ${commitsResult.commits?.length || 0} commits, fromVendor=${vendorResult.fromVendor}`
          );
        } catch (vendorError) {
          console.warn(
            `[CommitManager] VendorReadRouter.listCommits failed, falling back to git:`,
            vendorError
          );
          // Fall through to git worker below
          commitsResult = { success: false, error: String(vendorError) };
        }
      } else {
        // No vendor router or repo event, use git worker directly
        commitsResult = { success: false };
      }

      // If vendor failed or wasn't available, fall back to git worker
      // This requires ensuring the repo is cloned first
      if (!commitsResult.success || !commitsResult.commits) {
        // Check current data level - only needed for git fallback
        const dataLevel = await this.workerManager.getRepoDataLevel(effectiveRepoId);

        // For commit history, we need full clone to avoid NotFoundError
        if (dataLevel !== "full") {
          console.log(`Upgrading to full clone for commit history (current: ${dataLevel})`);
          const upgradeResult = await this.workerManager.ensureFullClone({
            repoId: effectiveRepoId as string,
            branch: branchName as string,
            depth: Math.max(requiredDepth, this.config.defaultDepth) as number,
          });

          if (!upgradeResult.success) {
            const err = createNetworkError();
            err.message =
              `Failed to ensure full clone for commit history ` +
              `(repoId=${String(effectiveRepoId)}, branch=${String(branchName)}, dataLevel=${String(dataLevel)}, depth=${String(
                Math.max(requiredDepth, this.config.defaultDepth)
              )}): ` +
              `${String(upgradeResult.error || "unknown error")}`;
            throw err;
          }
        }

        console.log(
          `[CommitManager] Calling worker.getCommitHistory with repoId=${effectiveRepoId}, branch=${branchName}, depth=${requiredDepth}`
        );
        commitsResult = await this.workerManager.getCommitHistory({
          repoId: effectiveRepoId as string,
          branch: branchName as string,
          depth: requiredDepth as number,
        });
        console.log(
          `[CommitManager] Worker returned ${commitsResult.commits?.length || 0} commits, success=${commitsResult.success}, fallbackUsed=${commitsResult.fallbackUsed || "none"}`
        );

        // Warn if worker used a fallback branch - this could explain "wrong commits" issues
        if (commitsResult.fallbackUsed && commitsResult.fallbackUsed !== branchName) {
          console.warn(
            `[CommitManager] WARNING: Worker used fallback branch '${commitsResult.fallbackUsed}' instead of requested '${branchName}'`
          );
        }
      }

      if (commitsResult.success) {
        const allCommits = commitsResult.commits || [];
        const startIndex = (this.currentPage - 1) * this.commitsPerPage;
        const endIndex = startIndex + this.commitsPerPage;

        const pageCommits = commitsResult.fromVendor
          ? allCommits
          : allCommits.slice(startIndex, endIndex);

        // If it's the first page, replace the commits, otherwise append
        this.commits = this.currentPage === 1 ? pageCommits : [...this.commits, ...pageCommits];
        console.log(
          `[CommitManager] Stored ${this.commits.length} commits (page ${this.currentPage}, branch: ${this.currentBranch})`
        );

        this.hasMoreCommits = commitsResult.fromVendor
          ? Boolean(commitsResult.hasMore)
          : commitsResult.hasMore !== undefined
            ? Boolean(commitsResult.hasMore)
            : endIndex < allCommits.length;

        // Only fetch total count on first load and cache it
        if (this.currentPage === 1 && this.totalCommits === undefined) {
          if (commitsResult.fromVendor) {
            this.totalCommits = startIndex + this.commits.length;
            if (this.hasMoreCommits) {
              console.log(
                `[CommitManager] Vendor pagination active, showing running estimate: ${this.totalCommits}+`
              );
            }
          } else if (allCommits.length < requiredDepth) {
            // If we got fewer commits than requested, we have all of them
            this.totalCommits = allCommits.length;
          } else if (this.vendorReadRouter && this.repoEventSnapshot) {
            // Use unified getCommitCount that handles vendor API gracefully
            const cloneUrls = this.getCloneUrlsFromRepoEvent(this.repoEventSnapshot);
            const countResult = await this.vendorReadRouter.getCommitCount({
              workerManager: this.workerManager,
              repoEvent: this.repoEventSnapshot,
              repoKey: this.canonicalKey,
              cloneUrls,
              branch: branchName as string,
            });

            if (countResult.success) {
              if (countResult.isEstimate) {
                // Vendor API doesn't provide exact count - use loaded commits as estimate
                this.totalCommits = allCommits.length;
                this.hasMoreCommits = true; // Assume there are more when we hit the limit
                console.log(
                  `[CommitManager] Using vendor commit count estimate: ${this.totalCommits}+`
                );
              } else {
                this.totalCommits = countResult.count;
              }
            } else {
              // Graceful fallback - use loaded commits as estimate
              this.totalCommits = allCommits.length;
              this.hasMoreCommits = true;
              console.log(
                `[CommitManager] getCommitCount failed, using estimate: ${this.totalCommits}+`
              );
            }
          } else {
            // No vendor router - try git worker directly (may fail if not cloned)
            try {
              const countResult = await this.workerManager.getCommitCount({
                repoId: effectiveRepoId as string,
                branch: branchName as string,
              });

              if (countResult.success) {
                this.totalCommits = countResult.count;
              }
            } catch {
              // Graceful fallback - use loaded commits as estimate
              this.totalCommits = allCommits.length;
              this.hasMoreCommits = true;
            }
          }
        }

        // Update loading message to success
        if (this.loadingIds.commits) {
          const message =
            this.currentPage === 1
              ? `Loaded ${pageCommits.length} commits`
              : `Loaded ${pageCommits.length} more commits`;

          context.update(this.loadingIds.commits, {
            type: "success",
            message,
            duration: 2000,
          });
          this.loadingIds.commits = null;
        }

        return {
          success: true,
          commits: pageCommits,
          totalCount: this.totalCommits,
        };
      } else {
        const message =
          `Failed to load commit history ` +
          `(repoId=${String(effectiveRepoId)}, branch=${String(branchName)}, depth=${String(requiredDepth)}): ` +
          `${String(commitsResult.error || "unknown error")}`;
        const err = createUnknownError(message);
        throw err;
      }
    } catch (error) {
      console.error("Failed to load commits:", error);

      if (this.loadingIds.commits) {
        context.update(this.loadingIds.commits, {
          type: "error",
          message: "Failed to load commits",
          details: error instanceof Error ? error.message : "Unknown error",
          duration: 5000,
        });
        this.loadingIds.commits = null;
      } else {
        context.error(
          "Failed to load commits",
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      this.commits = [];
      this.hasMoreCommits = false;

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get commit history for a repository and branch (delegated method)
   * Uses VendorReadRouter first if available, with git fallback
   */
  async getCommitHistory({
    repoId,
    branch,
    depth,
  }: {
    repoId: string;
    branch: string;
    depth: number;
  }): Promise<any> {
    // Try vendor API first if available
    if (this.vendorReadRouter && this.repoEventSnapshot) {
      try {
        const cloneUrls = this.getCloneUrlsFromRepoEvent(this.repoEventSnapshot);
        console.log(
          `[CommitManager.getCommitHistory] Trying VendorReadRouter.listCommits for branch=${branch}`
        );

        const vendorResult = await this.vendorReadRouter.listCommits({
          workerManager: this.workerManager,
          repoEvent: this.repoEventSnapshot,
          repoKey: this.canonicalKey || repoId,
          cloneUrls,
          branch,
          depth,
          perPage: depth,
        });

        // Convert vendor result format to internal format
        const commits = vendorResult.commits.map((c: any) => ({
          oid: c.sha,
          commit: {
            message: c.message,
            author: {
              name: c.author.name,
              email: c.author.email,
              timestamp: this.parseVendorDateTimestamp(c.author.date),
            },
            committer: {
              name: c.committer.name,
              email: c.committer.email,
              timestamp: this.parseVendorDateTimestamp(c.committer.date),
            },
            parent: c.parents?.map((p: any) => p.sha) || [],
          },
        }));

        console.log(
          `[CommitManager.getCommitHistory] VendorReadRouter returned ${commits.length} commits, fromVendor=${vendorResult.fromVendor}`
        );
        return { success: true, commits };
      } catch (vendorError) {
        console.warn(
          `[CommitManager.getCommitHistory] VendorReadRouter.listCommits failed, falling back to git:`,
          vendorError
        );
        // Fall through to git worker below
      }
    }

    // Fall back to git worker
    return await this.workerManager.getCommitHistory({
      repoId,
      branch,
      depth,
    });
  }

  /**
   * Get file history for a specific file
   */
  async getFileHistory({
    repoEvent,
    path,
    branch,
    maxCount,
  }: {
    repoEvent: any;
    path: string;
    branch: string;
    maxCount?: number;
  }): Promise<any> {
    return await this.workerManager.getFileHistory({
      repoEvent,
      path,
      branch,
      maxCount,
    });
  }

  /**
   * Reset commit state
   * @param clearBranch If true, also clears the stored branch (default: false to preserve branch across pagination resets)
   */
  reset(clearBranch: boolean = false): void {
    this.commits = [];
    this.totalCommits = undefined;
    this.currentPage = 1;
    this.hasMoreCommits = false;

    // Optionally clear stored branch (useful when explicitly switching branches)
    if (clearBranch) {
      this.currentBranch = undefined;
      // Note: We keep currentMainBranch as it rarely changes
    }

    // Clear any loading states
    if (this.loadingIds.commits) {
      context.remove(this.loadingIds.commits);
      this.loadingIds.commits = null;
    }
  }

  /**
   * Get commit statistics (for debugging/monitoring)
   */
  getStats(): {
    totalCommits?: number;
    loadedCommits: number;
    currentPage: number;
    commitsPerPage: number;
    hasMore: boolean;
    isLoading: boolean;
  } {
    return {
      totalCommits: this.totalCommits,
      loadedCommits: this.commits.length,
      currentPage: this.currentPage,
      commitsPerPage: this.commitsPerPage,
      hasMore: this.hasMoreCommits,
      isLoading: this.isLoading(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CommitManagerConfig>): void {
    this.config = { ...this.config, ...config };

    // Apply immediate changes
    if (config.defaultCommitsPerPage && config.defaultCommitsPerPage !== this.commitsPerPage) {
      this.setCommitsPerPage(config.defaultCommitsPerPage);
    }

    console.log("CommitManager configuration updated:", this.config);
  }

  /**
   * Dispose of the commit manager
   */
  dispose(): void {
    // Clear loading states
    if (this.loadingIds.commits) {
      context.remove(this.loadingIds.commits);
    }
    if (this.loadingIds.branches) {
      context.remove(this.loadingIds.branches);
    }

    // Reset state
    this.reset();

    console.log("CommitManager disposed");
  }
}
