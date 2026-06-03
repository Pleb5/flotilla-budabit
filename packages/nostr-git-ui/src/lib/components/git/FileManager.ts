import { WorkerManager } from "./WorkerManager";
import { CacheManager } from "./CacheManager";
import type { RepoAnnouncementEvent } from "@nostr-git/core/events";
import { parseRepoAnnouncementEvent } from "@nostr-git/core/events";
import { toast } from "$lib/stores/toast";
import type { VendorReadRouter } from "./VendorReadRouter";
import { createTimeoutError } from "@nostr-git/core/errors";
import { normalizeGitRefName } from "./branch-ref";

/**
 * Configuration options for FileManager
 */
export interface FileManagerConfig {
  /** Enable caching of file content and metadata */
  enableCaching?: boolean;
  /** Cache TTL for file content in milliseconds */
  contentCacheTTL?: number;
  /** Cache TTL for file listings in milliseconds */
  listingCacheTTL?: number;
  /** Maximum file size to cache (in bytes) */
  maxCacheFileSize?: number;
  /** Enable automatic cache cleanup */
  autoCleanup?: boolean;
  /** Optional vendor-first read router (API-first, git fallback) */
  vendorReadRouter?: VendorReadRouter;
}

/**
 * File information with metadata
 */
export interface FileInfo {
  /** File path relative to repository root */
  path: string;
  /** File type (file, directory, symlink, etc.) */
  type: string;
  /** File size in bytes (if available) */
  size?: number;
  /** Last modified timestamp (if available) */
  lastModified?: Date;
  /** File mode/permissions (if available) */
  mode?: string;
  /** Commit hash where this file was last modified */
  lastCommit?: string;
}

/**
 * File content with metadata
 */
export interface FileContent {
  /** File content as string */
  content: string;
  /** File path */
  path: string;
  /** Branch or commit where content was retrieved */
  ref: string;
  /** File encoding (utf-8, binary, etc.) */
  encoding?: string;
  /** File size in bytes */
  size: number;
  /** Whether content was retrieved from cache */
  fromCache?: boolean;
}

/**
 * File history entry
 */
export interface FileHistoryEntry {
  /** Commit hash */
  commit: string;
  /** Commit message */
  message: string;
  /** Author information */
  author: {
    name: string;
    email: string;
    timestamp: Date;
  };
  /** Changes made to the file in this commit */
  changes?: {
    added: number;
    removed: number;
  };
}

/**
 * File listing result
 */
export interface FileListingResult {
  /** Array of files and directories */
  files: FileInfo[];
  /** Path that was listed */
  path: string;
  /** Branch or commit used for listing */
  ref: string;
  /** Whether result was retrieved from cache */
  fromCache?: boolean;
}

/**
 * FileManager handles all file-related operations including listing directories,
 * reading file content, checking file existence, and retrieving file history.
 *
 * This component is part of the composition-based refactor of the Repo class,
 * extracting file-specific functionality into a focused, reusable component.
 */
export class FileManager {
  private workerManager: WorkerManager;
  private cacheManager?: CacheManager;
  private config: Required<Omit<FileManagerConfig, "vendorReadRouter">> &
    Pick<FileManagerConfig, "vendorReadRouter">;
  private vendorReadRouter?: VendorReadRouter;
  private cloneUrlsOverride: string[] = [];

  setCloneUrls(cloneUrls: string[]): void {
    this.cloneUrlsOverride = Array.from(
      new Set((cloneUrls || []).map((u) => String(u || "").trim()).filter(Boolean))
    );
  }

  // Cache keys for different types of file operations
  private static readonly CACHE_KEYS = {
    CONTENT: "file_content",
    LISTING: "file_listing",
    HISTORY: "file_history",
    EXISTS: "file_exists",
  } as const;

  constructor(
    workerManager: WorkerManager,
    cacheManager?: CacheManager,
    config: FileManagerConfig = {}
  ) {
    this.workerManager = workerManager;
    this.cacheManager = cacheManager;

    // Set default configuration
    this.config = {
      enableCaching: config.enableCaching ?? true,
      contentCacheTTL: config.contentCacheTTL ?? 10 * 60 * 1000, // 10 minutes
      listingCacheTTL: config.listingCacheTTL ?? 5 * 60 * 1000, // 5 minutes
      maxCacheFileSize: config.maxCacheFileSize ?? 1024 * 1024, // 1MB
      autoCleanup: config.autoCleanup ?? true,
      vendorReadRouter: config.vendorReadRouter ?? undefined,
    };

    this.vendorReadRouter = config.vendorReadRouter;
  }

  // In-flight and recent-call guards to avoid thrashing
  private inFlightListings: Map<string, Promise<FileListingResult>> = new Map();
  private recentListingCalls: Map<string, number> = new Map();
  private static readonly MIN_LISTING_INTERVAL_MS = 2000; // 2s guard per key
  // Failure backoff per key to avoid rapid retries on the same failing target
  private failureBackoffUntil: Map<string, number> = new Map();
  private static readonly FAILURE_BACKOFF_MS = 15_000; // 15s backoff per failing key
  // Toast spam guard per key
  private lastToastAt: Map<string, number> = new Map();
  private static readonly MIN_TOAST_INTERVAL_MS = 10_000; // 10s per key

  /**
   * List files and directories at a specific commit (used for tags)
   */
  async listRepoFilesAtCommit({
    repoEvent,
    repoKey: providedRepoKey,
    commit,
    path = "",
    useCache = true,
  }: {
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    commit: string;
    path?: string;
    useCache?: boolean;
  }): Promise<FileListingResult> {
    const repoKey = providedRepoKey || this.getCanonicalRepoKey(repoEvent);
    const ref = commit;
    const cacheKey = this.generateCacheKey("LISTING", repoKey, path, ref);

    // Rate-limit duplicate calls for same key
    const now = Date.now();
    const backoffUntil = this.failureBackoffUntil.get(cacheKey) || 0;
    if (now < backoffUntil) {
      // Still backing off; return cached (if any) or short-circuit
      if (this.config.enableCaching && this.cacheManager) {
        try {
          const cached = await this.cacheManager.get("file_listing", cacheKey);
          if (cached && typeof cached === "object") {
            return { ...(cached as FileListingResult), fromCache: true };
          }
        } catch {}
      }
      const terr = createTimeoutError();
      terr.message = `Listing temporarily backed off due to recent failures (ref=${ref}, path=${path || "/"})`;
      throw terr;
    }
    const lastTs = this.recentListingCalls.get(cacheKey) || 0;
    if (now - lastTs < FileManager.MIN_LISTING_INTERVAL_MS) {
      const pending = this.inFlightListings.get(cacheKey);
      if (pending) return pending;
      // fall through to cache if available below
    }

    // Try cache first if enabled
    if (this.config.enableCaching && useCache && this.cacheManager) {
      try {
        const cached = await this.cacheManager.get("file_listing", cacheKey);
        if (cached && typeof cached === "object") {
          console.log(`File listing (commit) cache hit for ${path} at ${ref}`);
          return { ...(cached as FileListingResult), fromCache: true };
        }
      } catch (error) {
        console.warn("Cache read failed for file listing (commit):", error);
      }
    }

    try {
      const pending = this.workerManager.listTreeAtCommit({
        repoEvent,
        commit,
        path,
        repoKey,
      });
      this.inFlightListings.set(cacheKey, pending as unknown as Promise<FileListingResult>);
      this.recentListingCalls.set(cacheKey, now);
      const result = await pending;

      const fileListingResult: FileListingResult = {
        files: result.map(
          (file: any): FileInfo => ({
            path: file.path || file.name,
            type: file.type || "file",
            size: file.size,
            mode: file.mode,
            lastCommit: file.oid,
          })
        ),
        path,
        ref,
        fromCache: false,
      };

      if (this.config.enableCaching && this.cacheManager) {
        await this.cacheManager.set(
          "file_listing",
          cacheKey,
          fileListingResult,
          this.config.listingCacheTTL
        );
      }

      return fileListingResult;
    } catch (error: any) {
      console.error(`Failed to list repository files for commit '${ref}':`, error);
      // Apply backoff on failure for this key
      this.failureBackoffUntil.set(cacheKey, Date.now() + FileManager.FAILURE_BACKOFF_MS);
      throw error;
    } finally {
      this.inFlightListings.delete(cacheKey);
    }
  }

  /**
   * Compute a canonical repo key for stable UI cache keys
   */
  private getCanonicalRepoKey(repoEvent: RepoAnnouncementEvent): string {
    // Stable, non-throwing canonical key used only for client-side caching.
    // Strategy:
    // 1) If 'd' tag is present, pair it with author pubkey to avoid collisions.
    // 2) Else, use parsed.repoId if available.
    // 3) Else, fall back to event id.
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
    // Last resort: event id ensures stability even if suboptimal.
    return (repoEvent as any)?.id || `${repoEvent.pubkey}`;
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

    // Fallback: try direct tags (in case parser shape differs)
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

  /**
   * Generate cache key for file operations
   */
  private generateCacheKey(
    type: keyof typeof FileManager.CACHE_KEYS,
    repoKey: string,
    path: string,
    ref: string
  ): string {
    return `${FileManager.CACHE_KEYS[type]}_${repoKey}_${ref}_${path}`;
  }

  /**
   * Get default branch name from full branch reference
   */
  private getShortBranchName(fullBranch?: string): string {
    return normalizeGitRefName(fullBranch);
  }

  /**
   * List files and directories in a repository path
   */
  async listRepoFiles({
    repoEvent,
    repoKey: providedRepoKey,
    branch,
    path = "",
    useCache = true,
  }: {
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    branch: string;
    path?: string;
    useCache?: boolean;
  }): Promise<FileListingResult> {
    const shortBranch = this.getShortBranchName(branch);
    const repoKey = providedRepoKey || this.getCanonicalRepoKey(repoEvent);
    const cacheKey = this.generateCacheKey("LISTING", repoKey, path, shortBranch);

    // Rate-limit duplicate calls for same key
    const now = Date.now();
    const backoffUntil = this.failureBackoffUntil.get(cacheKey) || 0;
    if (now < backoffUntil) {
      // Still backing off; return cached (if any) or short-circuit
      if (this.config.enableCaching && this.cacheManager) {
        try {
          const cached = await this.cacheManager.get("file_listing", cacheKey);
          if (cached && typeof cached === "object") {
            return { ...(cached as FileListingResult), fromCache: true };
          }
        } catch {}
      }
      const terr = createTimeoutError();
      terr.message = `Listing temporarily backed off due to recent failures (branch=${shortBranch || "?"}, path=${path || "/"})`;
      throw terr;
    }
    const lastTs = this.recentListingCalls.get(cacheKey) || 0;
    if (now - lastTs < FileManager.MIN_LISTING_INTERVAL_MS) {
      const pending = this.inFlightListings.get(cacheKey);
      if (pending) return pending;
      // fall through to cache if available
    }

    // Try cache first if enabled
    if (this.config.enableCaching && useCache && this.cacheManager) {
      try {
        const cached = await this.cacheManager.get("file_listing", cacheKey);
        if (cached && typeof cached === "object") {
          console.log(`File listing cache hit for ${path} on ${shortBranch}`);
          return { ...(cached as FileListingResult), fromCache: true };
        }
      } catch (error) {
        console.warn("Cache read failed for file listing:", error);
      }
    }

    const toFileListingResult = (filesRaw: any[], ref: string): FileListingResult => ({
      files: (filesRaw || []).map(
        (file: any): FileInfo => ({
          path: file.path || file.name,
          type: file.type || "file",
          size: file.size,
          mode: file.mode,
          lastCommit: file.oid || file.sha,
        })
      ),
      path,
      ref,
      fromCache: false,
    });

    try {
      const pending: Promise<FileListingResult> = (async () => {
        // Vendor-first (router handles worker fallback internally)
        if (this.vendorReadRouter) {
          const cloneUrls = this.getCloneUrlsFromRepoEvent(repoEvent);
          const vendorRes = await this.vendorReadRouter.listDirectory({
            workerManager: this.workerManager,
            repoEvent,
            repoKey,
            cloneUrls,
            branch: shortBranch,
            path,
          });

          const files = (vendorRes.files || []).map(
            (f: any): FileInfo => ({
              path: f.path || "",
              type: f.type || "file",
              size: f.size,
              mode: f.mode,
              lastCommit: f.oid,
            })
          );

          return {
            files,
            path: vendorRes.path || path,
            ref: vendorRes.ref || shortBranch || "",
            fromCache: false,
          };
        }

        // Worker-only fallback (no vendor router configured)
        const workerRaw = await this.workerManager.listRepoFilesFromEvent({
          repoEvent,
          branch: shortBranch,
          path,
          repoKey,
        });
        return toFileListingResult(workerRaw, shortBranch);
      })();

      this.inFlightListings.set(cacheKey, pending);
      this.recentListingCalls.set(cacheKey, now);
      const fileListingResult = await pending;

      // Cache the result if enabled
      if (this.config.enableCaching && this.cacheManager) {
        await this.cacheManager.set(
          "file_listing",
          cacheKey,
          fileListingResult,
          this.config.listingCacheTTL
        );
      }

      return fileListingResult;
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);

      // Handle stale local clone: "commit X is not available locally. Do a git fetch"
      const looksLikeStaleClone = /is not available locally|do a git fetch/i.test(msg);
      if (looksLikeStaleClone) {
        console.log(
          `[FileManager] Stale clone detected, re-initializing repo for branch ${shortBranch}`
        );
        try {
          const cloneUrls = this.getCloneUrlsFromRepoEvent(repoEvent);
          if (cloneUrls.length > 0) {
            // Use smartInitializeRepo with forceUpdate to handle both fresh clones and stale repos
            await this.workerManager.smartInitializeRepo({
              repoId: repoKey,
              cloneUrls,
              forceUpdate: true,
            });
            // Retry after re-initialization
            const retryRaw = await this.workerManager.listRepoFilesFromEvent({
              repoEvent,
              branch: shortBranch,
              path,
              repoKey,
            });
            const retryResult = toFileListingResult(retryRaw, shortBranch);
            if (this.config.enableCaching && this.cacheManager) {
              await this.cacheManager.set(
                "file_listing",
                cacheKey,
                retryResult,
                this.config.listingCacheTTL
              );
            }
            return retryResult;
          }
        } catch (syncError) {
          console.warn(`[FileManager] Re-init retry failed:`, syncError);
          // Fall through to other error handling
        }
      }

      // Preserve existing alternative-branch fallback, but only for likely-ref errors and root-ish listings
      const isRootish = !path || path === "/" || path === "";
      const looksLikeRefError = /could not find|unknown ref|not found.*ref|branch/i.test(msg);

      if (isRootish && looksLikeRefError) {
        const alternatives = shortBranch === "main" ? ["master", "develop"] : ["main", "master"];

        for (const altBranch of alternatives) {
          try {
            const result = await this.workerManager.listRepoFilesFromEvent({
              repoEvent,
              branch: altBranch,
              path,
              repoKey,
            });

            const altListing: FileListingResult = toFileListingResult(result, altBranch);

            if (this.config.enableCaching && this.cacheManager) {
              await this.cacheManager.set(
                "file_listing",
                cacheKey.replace(shortBranch, altBranch),
                altListing,
                this.config.listingCacheTTL
              );
            }

            return altListing;
          } catch {
            continue;
          }
        }
      }

      // Apply failure backoff for this key
      this.failureBackoffUntil.set(cacheKey, Date.now() + FileManager.FAILURE_BACKOFF_MS);
      // Avoid spamming toasts for the same key too frequently
      const lastToast = this.lastToastAt.get(cacheKey) || 0;
      if (Date.now() - lastToast > FileManager.MIN_TOAST_INTERVAL_MS) {
        toast.push({
          message: `Failed to list repository files for branch '${shortBranch}': ${error}`,
          duration: 8000,
        });
        this.lastToastAt.set(cacheKey, Date.now());
      }
      throw error;
    } finally {
      this.inFlightListings.delete(cacheKey);
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent({
    repoEvent,
    repoKey: providedRepoKey,
    path,
    branch,
    commit,
    useCache = true,
  }: {
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    path: string;
    branch?: string;
    commit?: string;
    useCache?: boolean;
  }): Promise<FileContent> {
    const repoKey = providedRepoKey || this.getCanonicalRepoKey(repoEvent);
    const ref = commit || this.getShortBranchName(branch || "");
    const cacheKey = this.generateCacheKey("CONTENT", repoKey, path, ref);

    // Try cache first if enabled
    if (this.config.enableCaching && useCache && this.cacheManager) {
      try {
        const cached = await this.cacheManager.get("file_content", cacheKey);
        if (cached && typeof cached === "object") {
          console.log(`File content cache hit for ${path} at ${ref}`);
          return { ...(cached as FileContent), fromCache: true };
        }
      } catch (error) {
        console.warn("Cache read failed for file content:", error);
      }
    }

    try {
      // Vendor-first only when reading by branch (commit reads stay on worker)
      if (this.vendorReadRouter && !commit) {
        const cloneUrls = this.getCloneUrlsFromRepoEvent(repoEvent);
        const vendorRes = await this.vendorReadRouter.getFileContent({
          workerManager: this.workerManager,
          repoEvent,
          repoKey,
          cloneUrls,
          branch: ref,
          path,
        });

        const result: FileContent = {
          content: vendorRes.content || "",
          path,
          ref: vendorRes.ref || ref,
          encoding: vendorRes.encoding || "utf-8",
          size:
            typeof vendorRes.size === "number" ? vendorRes.size : (vendorRes.content || "").length,
          fromCache: false,
        };

        // Cache the result if enabled and file is not too large
        if (
          this.config.enableCaching &&
          this.cacheManager &&
          result.size <= this.config.maxCacheFileSize
        ) {
          try {
            await this.cacheManager.set(
              "file_content",
              cacheKey,
              result,
              this.config.contentCacheTTL
            );
          } catch (error) {
            console.warn("Cache write failed for file content:", error);
          }
        }

        return result;
      }

      // Worker fallback (and always for commit-based reads)
      const content = await this.workerManager.getRepoFileContentFromEvent({
        repoEvent,
        branch: commit ? ("" as any) : ref,
        path,
        commit: commit || undefined,
        repoKey,
      });

      const result: FileContent = {
        content: content || "",
        path,
        ref,
        encoding: "utf-8", // Default encoding
        size: content?.length || 0,
      };

      // Cache the result if enabled and file is not too large
      if (
        this.config.enableCaching &&
        this.cacheManager &&
        result.size <= this.config.maxCacheFileSize
      ) {
        try {
          await this.cacheManager.set(
            "file_content",
            cacheKey,
            result,
            this.config.contentCacheTTL
          );
        } catch (error) {
          console.warn("Cache write failed for file content:", error);
        }
      }

      return result;
    } catch (error) {
      console.error(`Failed to get file content for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Check if file exists at specific commit or branch
   */
  async fileExistsAtCommit({
    repoEvent,
    repoKey: providedRepoKey,
    path,
    branch,
    commit,
    useCache = true,
  }: {
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    path: string;
    branch?: string;
    commit?: string;
    useCache?: boolean;
  }): Promise<boolean> {
    const repoKey = providedRepoKey || this.getCanonicalRepoKey(repoEvent);
    const ref = commit || this.getShortBranchName(branch || "");
    const cacheKey = this.generateCacheKey("EXISTS", repoKey, path, ref);

    // Try cache first if enabled
    if (this.config.enableCaching && useCache && this.cacheManager) {
      try {
        const cached = await this.cacheManager.get("file_exists", cacheKey);
        if (cached !== undefined) {
          console.log(`File exists cache hit for ${path} at ${ref}`);
          return cached as boolean;
        }
      } catch (error) {
        console.warn("Cache read failed for file exists check:", error);
      }
    }

    try {
      // Check existence via worker
      const exists = await this.workerManager.fileExistsAtCommit({
        repoEvent,
        branch: commit ? ("" as any) : ref,
        path,
        commit: commit || undefined,
        repoKey,
      });

      // Cache the result if enabled
      if (this.config.enableCaching && this.cacheManager) {
        try {
          await this.cacheManager.set("file_exists", cacheKey, exists, this.config.listingCacheTTL);
        } catch (error) {
          console.warn("Cache write failed for file exists check:", error);
        }
      }

      return exists;
    } catch (error) {
      console.error(`Failed to check file existence for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Get file history (commits that modified the file)
   */
  async getFileHistory({
    repoEvent,
    repoKey: providedRepoKey,
    path,
    branch,
    maxCount = 50,
    useCache = true,
  }: {
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    path: string;
    branch?: string;
    maxCount?: number;
    useCache?: boolean;
  }): Promise<FileHistoryEntry[]> {
    const shortBranch = this.getShortBranchName(branch);
    const repoKey = providedRepoKey || this.getCanonicalRepoKey(repoEvent);
    const cacheKey = this.generateCacheKey("HISTORY", repoKey, `${path}_${maxCount}`, shortBranch);

    // Try cache first if enabled
    if (this.config.enableCaching && useCache && this.cacheManager) {
      try {
        const cached = await this.cacheManager.get("file_history", cacheKey);
        if (cached && Array.isArray(cached)) {
          console.log(`File history cache hit for ${path} on ${shortBranch}`);
          return cached as FileHistoryEntry[];
        }
      } catch (error) {
        console.warn("Cache read failed for file history:", error);
      }
    }

    try {
      // Get history from worker
      const history = await this.workerManager.getFileHistory({
        repoEvent,
        path,
        branch: shortBranch,
        maxCount,
        repoKey,
      });

      // Transform to FileHistoryEntry format
      const result: FileHistoryEntry[] = (history || []).map((entry: any) => ({
        commit: entry.oid || entry.commit,
        message: entry.commit?.message || entry.message || "",
        author: {
          name: entry.commit?.author?.name || entry.author?.name || "Unknown",
          email: entry.commit?.author?.email || entry.author?.email || "",
          timestamp: new Date(entry.commit?.author?.timestamp || entry.timestamp || Date.now()),
        },
        changes: entry.changes,
      }));

      // Cache the result if enabled
      if (this.config.enableCaching && this.cacheManager) {
        try {
          await this.cacheManager.set(
            "file_history",
            cacheKey,
            result,
            this.config.contentCacheTTL
          );
        } catch (error) {
          console.warn("Cache write failed for file history:", error);
        }
      }

      return result;
    } catch (error) {
      console.error(`Failed to get file history for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Clear file-related caches
   */
  async clearCache(repoId?: string): Promise<void> {
    if (!this.cacheManager) return;

    try {
      if (repoId) {
        // Clear cache for specific repository
        const patterns = Object.values(FileManager.CACHE_KEYS).map((key) => `${key}_${repoId}_*`);

        for (const pattern of patterns) {
          // Note: This assumes CacheManager supports pattern-based clearing
          // If not, we'd need to track keys or implement pattern matching
          console.log(`Clearing file cache pattern: ${pattern}`);
        }
      } else {
        // Clear all file caches
        await this.cacheManager.clear("file_listing");
        await this.cacheManager.clear("file_content");
        await this.cacheManager.clear("file_exists");
        await this.cacheManager.clear("file_history");
      }

      console.log("File cache cleared");
    } catch (error) {
      console.error("Failed to clear file cache:", error);
    }
  }

  /**
   * Get file manager statistics
   */
  getStats(): {
    config: Required<Omit<FileManagerConfig, "vendorReadRouter">> &
      Pick<FileManagerConfig, "vendorReadRouter">;
    cacheEnabled: boolean;
    cacheManager: boolean;
  } {
    return {
      config: this.config,
      cacheEnabled: this.config.enableCaching,
      cacheManager: !!this.cacheManager,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FileManagerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log("FileManager configuration updated:", this.config);
  }

  /**
   * Dispose of the file manager
   */
  dispose(): void {
    // Clear any pending operations or timers if needed
    console.log("FileManager disposed");
  }
}
