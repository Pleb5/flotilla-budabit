import { getGitWorker } from "@nostr-git/core";
import type { RepoAnnouncementEvent } from "@nostr-git/core/events";
import type {
  GitNaturalFileContentResult,
  GitNaturalGetCommitResult,
  GitNaturalListCommitsResult,
  GitNaturalListDirectoryResult,
  GitNaturalListRefsResult,
  GitNaturalResolveRefResult,
  PRReviewData,
} from "@nostr-git/core/git";
import {
  createAuthRequiredError,
  createNetworkError,
  createTimeoutError,
  createFsError,
  createUnknownError,
  wrapError,
  FatalError,
  RetriableError,
  UserActionableError,
  GitErrorCode,
  GitErrorCategory,
} from "@nostr-git/core/errors";
import { isGraspRepoHttpUrl, parseGraspRepoHttpUrl } from "$lib/utils/grasp-url";
import { normalizeGraspOrigins } from "$lib/utils/grasp-pipeline";

// Worker URL/factory must be injected by the consuming app (not imported here)
// because ?url imports only work at the app's bundler level, not in pre-built packages
export type GitWorkerFactory = () => Worker;

export interface WorkerManagerConfig {
  /** Factory function to create the worker (preferred) */
  workerFactory?: GitWorkerFactory;
  /** Worker URL as fallback if factory not provided */
  workerUrl?: string | URL;
}

export interface WorkerProgressEvent {
  repoId: string;
  phase: string;
  progress?: number;
  targetBranch?: string;
  message?: string;
}

export interface WorkerProgressCallback {
  (event: WorkerProgressEvent): void;
}

export interface CloneProgress {
  isCloning: boolean;
  phase: string;
  progress?: number;
}

export type PRReviewDataResult = PRReviewData & {
  changes?: any[];
  usedCloneUrl?: string;
  usedTargetCloneUrl?: string;
};

export interface AuthToken {
  host: string;
  token: string;
}

export interface AuthConfig {
  tokens: AuthToken[];
}

export interface GitConfig {
  defaultCorsProxy?: string | null;
}

/**
 * Structured error response from the worker.
 * When success is false, the worker now returns code, category, and hint.
 */
interface WorkerErrorResponse {
  success: false;
  error: string;
  code?: GitErrorCode;
  category?: GitErrorCategory;
  hint?: string;
  context?: Record<string, any>;
}

/**
 * Create a typed error from a structured worker error response.
 */
function createErrorFromWorkerResponse(response: WorkerErrorResponse): Error {
  const { error, code, category, hint, context } = response;

  // If we have structured error info, create the appropriate error type
  if (code && category) {
    const options = { hint, context };

    switch (category) {
      case GitErrorCategory.USER_ACTIONABLE:
        return new UserActionableError(error, code, options);
      case GitErrorCategory.RETRIABLE:
        return new RetriableError(error, code, options);
      case GitErrorCategory.FATAL:
        return new FatalError(error, code, options);
      default:
      // Fall through to wrapError
    }
  }

  // Fall back to wrapError for classification
  return wrapError(new Error(error), context);
}

/**
 * Check if a worker result is an error response with structured error info.
 */
function isWorkerErrorResponse(result: any): result is WorkerErrorResponse {
  return (
    result &&
    typeof result === "object" &&
    result.success === false &&
    typeof result.error === "string"
  );
}

/**
 * WorkerManager handles all git worker communication and lifecycle management.
 * This provides a clean interface for git operations while managing the underlying worker.
 */
export class WorkerManager {
  private static instances = new Set<WorkerManager>();
  private static globalGitConfig: GitConfig = {};
  private worker: Worker | null = null;
  private api: any = null;
  private isInitialized = false;
  private progressCallback?: WorkerProgressCallback;
  private authConfig: AuthConfig = { tokens: [] };
  private gitConfig: GitConfig = {};
  private workerConfig?: WorkerManagerConfig;
  // Throttle repeated initialize() calls and avoid duplicate work
  private initInFlight: Promise<void> | null = null;
  private lastInitAt = 0;
  private static readonly MIN_INIT_INTERVAL_MS = 1500;
  // Deduplicate auth-config updates
  private lastAuthConfigJson = "";
  // Deduplicate git-config updates
  private lastGitConfigJson = "";

  constructor(progressCallback?: WorkerProgressCallback, workerConfig?: WorkerManagerConfig) {
    this.progressCallback = progressCallback;
    this.workerConfig = workerConfig;
    this.gitConfig = { ...WorkerManager.globalGitConfig };
    WorkerManager.instances.add(this);
    // Clean architecture - worker handles EventIO internally
  }

  static setGlobalGitConfig(config: GitConfig): void {
    WorkerManager.globalGitConfig = { ...WorkerManager.globalGitConfig, ...config };
    for (const instance of WorkerManager.instances) {
      void instance.setGitConfig(WorkerManager.globalGitConfig);
    }
  }

  static getGlobalGitConfig(): GitConfig {
    return { ...WorkerManager.globalGitConfig };
  }

  static async restartAll(): Promise<void> {
    const instances = Array.from(WorkerManager.instances);
    await Promise.all(
      instances.map(async (instance) => {
        try {
          await instance.restart();
        } catch (error) {
          console.warn("[WorkerManager] Failed to restart instance:", error);
        }
      })
    );
  }

  /**
   * Initialize the git worker and API
   */
  async initialize() {
    WorkerManager.instances.add(this);
    // If already initialized, return immediately
    if (this.isInitialized && this.api) {
      return;
    }
    // If initialization is in progress, wait for it
    if (this.initInFlight) {
      await this.initInFlight;
      return;
    }
    this.initInFlight = (async () => {
      // Use injected worker config from consuming app (workerFactory or workerUrl)
      // Falls back to default getGitWorker behavior if no config provided
      console.log("[WorkerManager] Initializing with config:", {
        hasWorkerFactory: !!this.workerConfig?.workerFactory,
        workerUrl: this.workerConfig?.workerUrl,
      });
      const { worker, api } = getGitWorker({
        workerFactory: this.workerConfig?.workerFactory,
        workerUrl: this.workerConfig?.workerUrl,
        onProgress: this.handleWorkerProgress,
        onError: (ev: ErrorEvent | MessageEvent) => {
          console.error("[WorkerManager] Worker load error:", ev);
        },
      });
      this.worker = worker;
      this.api = api as any;

      try {
        // Ping the worker to verify it's alive (fast failure detection)
        const pingTimeout = 5000; // 5 seconds
        const pingPromise = this.api.ping();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Worker ping timed out - worker may not have loaded correctly")),
            pingTimeout
          );
        });

        const pingResult = await Promise.race([pingPromise, timeoutPromise]);
        console.log("[WorkerManager] Worker ping successful:", pingResult);

        this.isInitialized = true;

        // Set authentication configuration in the worker (dedup)
        const cfgJson = JSON.stringify(this.authConfig || {});
        if (cfgJson !== this.lastAuthConfigJson) {
          if (
            this.authConfig.tokens.length > 0 &&
            this.api &&
            typeof (this.api as any).setAuthConfig === "function"
          ) {
            await (this.api as any).setAuthConfig(this.authConfig);
          }
          this.lastAuthConfigJson = cfgJson;
        }

        const gitCfgJson = JSON.stringify(this.gitConfig || {});
        if (gitCfgJson !== this.lastGitConfigJson) {
          if (this.api && typeof (this.api as any).setGitConfig === "function") {
            await (this.api as any).setGitConfig(this.gitConfig);
          }
          this.lastGitConfigJson = gitCfgJson;
        }
      } catch (error) {
        console.error("Failed to initialize git worker:", error);
        this.isInitialized = false;
        throw new FatalError(
          `Worker initialization failed: ${error instanceof Error ? error.message : String(error)}`,
          GitErrorCode.UNKNOWN_ERROR
        );
      }

      this.lastInitAt = Date.now();
    })();

    try {
      await this.initInFlight;
    } finally {
      this.initInFlight = null;
    }
  }

  /**
   * Execute a git operation in the worker
   */
  async execute<T>(
    operation: string,
    params: any,
    options?: { timeoutMs?: number; returnWorkerErrors?: boolean }
  ): Promise<T> {
    const ctxFrom = (p: any): string => {
      if (!p) return "";
      if (typeof p !== "object") return "";
      const parts: string[] = [];
      const repoId = p.repoId || p.repoKey;
      if (repoId) parts.push(`repoId=${String(repoId)}`);
      const remoteUrl = p.remoteUrl;
      if (remoteUrl) parts.push(`remote=${String(remoteUrl)}`);
      const branch = p.branch || p.targetBranch;
      if (branch) parts.push(`branch=${String(branch)}`);
      const path = p.path;
      if (path) parts.push(`path=${String(path)}`);
      const commit = p.commit || p.commitId;
      if (commit) parts.push(`commit=${String(commit)}`);
      return parts.length ? ` (${parts.join(", ")})` : "";
    };

    const withCause = (cause: unknown, err: Error): Error => {
      try {
        // Prefer library helper to preserve cause/stack/metadata if available
        return (wrapError as any)(cause, err) as Error;
      } catch {
        (err as any).cause = cause;
        return err;
      }
    };

    const ctx = ctxFrom(params);

    if (!this.isInitialized || !this.api) {
      throw createUnknownError(`WorkerManager not initialized. Call initialize() first.${ctx}`);
    }

    try {
      let safeParams = params;
      try {
        safeParams = JSON.parse(JSON.stringify(params));
      } catch {
        /* fall back to original */
      }

      const method = (this.api as any)[operation];

      if (typeof method !== "function") {
        throw new FatalError(
          `Operation '${operation}' is not supported by current worker.${ctx}`,
          GitErrorCode.UNKNOWN_ERROR
        );
      }

      // Check if params are actually serializable
      try {
        JSON.stringify(safeParams, null, 2);
      } catch (serError) {
        throw createUnknownError(
          `Cannot serialize params for '${operation}'.${ctx}`,
          undefined,
          serError instanceof Error ? serError : undefined
        );
      }

      // Add timeout to detect hanging worker calls
      // Allow custom timeout to be specified for long-running background operations
      const timeoutMs = options?.timeoutMs ?? 30000;

      // If timeout is 0 or negative, don't apply timeout (for truly long-running background ops)
      if (timeoutMs > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => {
            reject(createTimeoutError({ operation, timeoutMs, context: ctx }));
          }, timeoutMs);
          // Avoid leaking timers in unusual promise scheduling cases
          void t;
        });

        const resultPromise = method(safeParams);
        const result = await Promise.race([resultPromise, timeoutPromise]);

        // Check if worker returned a structured error response
        if (isWorkerErrorResponse(result)) {
          if (options?.returnWorkerErrors) {
            try {
              return JSON.parse(JSON.stringify(result)) as T;
            } catch {
              return result as T;
            }
          }
          throw createErrorFromWorkerResponse(result);
        }

        try {
          return JSON.parse(JSON.stringify(result)) as T;
        } catch {
          return result as T;
        }
      } else {
        // No timeout - for long-running background operations
        const result = await method(safeParams);

        // Check if worker returned a structured error response
        if (isWorkerErrorResponse(result)) {
          if (options?.returnWorkerErrors) {
            try {
              return JSON.parse(JSON.stringify(result)) as T;
            } catch {
              return result as T;
            }
          }
          throw createErrorFromWorkerResponse(result);
        }

        try {
          return JSON.parse(JSON.stringify(result)) as T;
        } catch {
          return result as T;
        }
      }
    } catch (error) {
      console.error("[WorkerManager] execute error:", error);

      // Pass through typed errors as-is
      if (error instanceof Error) {
        const name = (error as any).name || "";
        if (name === "FatalError" || name === "RetriableError" || name === "UserActionableError") {
          throw error;
        }
      }

      const msg = error instanceof Error ? error.message : String(error);
      const lowered = (msg || "").toLowerCase();

      // Comlink clone errors / worker capability mismatches should be fatal
      if (msg && msg.includes("Proxy object could not be cloned")) {
        const ferr = new FatalError(
          `Worker returned a non-transferable value for '${operation}'.${ctx}`,
          GitErrorCode.UNKNOWN_ERROR
        );
        throw withCause(error, ferr);
      }

      // Auth-ish errors
      if (/unauthorized|forbidden|permission denied|auth|token|401|403/.test(lowered)) {
        throw createAuthRequiredError(
          { operation, context: ctx },
          error instanceof Error ? error : undefined
        );
      }

      // Timeout-ish errors
      if (/timed out|timeout/.test(lowered)) {
        throw createTimeoutError(
          { operation, context: ctx },
          error instanceof Error ? error : undefined
        );
      }

      // Network-ish errors
      if (
        /failed to fetch|networkerror|fetch failed|econnreset|enotfound|eai_again/.test(lowered)
      ) {
        throw createNetworkError(
          { operation, context: ctx },
          error instanceof Error ? error : undefined
        );
      }

      // FS-ish errors (isomorphic-git and browser fs backends often emit these)
      if (/enoent|eacces|eperm|enospc|notfounderror/.test(lowered)) {
        throw createFsError(
          `Filesystem error during '${operation}'.${ctx}`,
          { operation },
          error instanceof Error ? error : undefined
        );
      }

      // Unknown
      throw createUnknownError(
        `Worker operation '${operation}' failed.${ctx}`,
        { operation },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Smart repository initialization
   */
  async smartInitializeRepo(params: {
    repoId: string;
    cloneUrls: string[];
    branch?: string;
    forceUpdate?: boolean;
    timeoutMs?: number; // Optional custom timeout for background operations
  }): Promise<any> {
    await this.initialize();
    const { timeoutMs, ...executeParams } = params;
    return this.execute("smartInitializeRepo", executeParams, { timeoutMs });
  }

  /**
   * Sync local repository with remote HEAD
   * Ensures the local repo always points to the latest remote HEAD
   */
  async syncWithRemote(params: {
    repoId: string;
    cloneUrls: string[];
    branch?: string;
    requireRemoteSync?: boolean;
    requireTrackingRef?: boolean;
    preferredUrl?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("syncWithRemote", params);
  }

  /**
   * Check if repository is cloned locally
   */
  async isRepoCloned(params: { repoId: string }): Promise<boolean> {
    await this.initialize();
    return this.execute("isRepoCloned", params);
  }

  /**
   * Push local repository to a remote
   */
  async pushToRemote(params: {
    repoId: string;
    remoteUrl: string;
    branch?: string;
    ref?: string;
    refs?: string[];
    token?: string;
    provider?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("pushToRemote", params);
  }

  /**
   * List server refs from a remote URL without cloning
   */
  async listServerRefs(params: {
    url: string;
    prefix?: string;
    symrefs?: boolean;
  }): Promise<Array<{ ref?: string; oid?: string; target?: string }>> {
    await this.initialize();
    return this.execute("listServerRefs", params);
  }

  async gitNaturalListRefs(params: {
    url: string;
    prefix?: string;
    symrefs?: boolean;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalListRefsResult> {
    await this.initialize();
    return this.execute("gitNaturalListRefs", params);
  }

  async gitNaturalResolveRef(params: {
    url: string;
    ref: string;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalResolveRefResult> {
    await this.initialize();
    return this.execute("gitNaturalResolveRef", params);
  }

  async gitNaturalListDirectory(params: {
    url: string;
    ref?: string;
    commitHash?: string;
    path?: string;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalListDirectoryResult> {
    await this.initialize();
    return this.execute("gitNaturalListDirectory", params);
  }

  async gitNaturalGetFileContent(params: {
    url: string;
    ref?: string;
    commitHash?: string;
    path: string;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalFileContentResult> {
    await this.initialize();
    return this.execute("gitNaturalGetFileContent", params);
  }

  async gitNaturalListCommits(params: {
    url: string;
    ref?: string;
    commitHash?: string;
    depth?: number;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalListCommitsResult> {
    await this.initialize();
    return this.execute("gitNaturalListCommits", params);
  }

  async gitNaturalGetCommit(params: {
    url: string;
    ref?: string;
    commitHash?: string;
    enabled: true;
    corsProxy?: string | null;
  }): Promise<GitNaturalGetCommitResult> {
    await this.initialize();
    return this.execute("gitNaturalGetCommit", params);
  }

  async discoverRemoteBackfill(params: {
    repoId: string;
    cloneUrls: string[];
    defaultBranch?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("discoverRemoteBackfill", params, { timeoutMs: 120000 });
  }

  async prepareRemoteBackfill(params: {
    repoId: string;
    targets: Array<{
      remoteUrl: string;
      refs: Array<{
        ref: string;
        name: string;
        type: "heads" | "tags";
        effectiveOid: string;
        currentOid?: string;
        sourceUrls: string[];
      }>;
    }>;
  }): Promise<any> {
    await this.initialize();
    return this.execute("prepareRemoteBackfill", params, { timeoutMs: 180000 });
  }

  async executeRemoteBackfill(params: {
    repoId: string;
    targets: Array<{
      remoteUrl: string;
      refs: Array<{
        ref: string;
        name: string;
        type: "heads" | "tags";
        effectiveOid: string;
        currentOid?: string;
        sourceUrls: string[];
      }>;
    }>;
    userPubkey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("executeRemoteBackfill", params, { timeoutMs: 180000 });
  }

  /**
   * Safe push with preflight checks and optional destructive-action confirmation
   */
  async safePushToRemote(params: {
    repoId: string;
    remoteUrl: string;
    branch?: string;
    token?: string;
    provider?: string;
    allowForce?: boolean;
    confirmDestructive?: boolean;
    preflight?: {
      blockIfUncommitted?: boolean;
      requireUpToDate?: boolean;
      blockIfShallow?: boolean;
    };
  }): Promise<any> {
    await this.initialize();
    return this.execute("safePushToRemote", params);
  }

  /**
   * Get repository data level (refs, shallow, full)
   */
  async getRepoDataLevel(repoId: string): Promise<string> {
    await this.initialize();
    return this.execute("getRepoDataLevel", { repoId });
  }

  /**
   * Ensure full clone of repository
   */
  async ensureFullClone(params: {
    repoId: string;
    branch: string;
    depth?: number;
    cloneUrls?: string[];
  }): Promise<any> {
    await this.initialize();
    return this.execute("ensureFullClone", params);
  }

  /**
   * Get commit history
   */
  async getCommitHistory(params: {
    repoId: string;
    branch: string;
    depth: number;
    offset?: number;
  }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitHistory", params);
  }

  /**
   * Get detailed information about a specific commit including metadata and file changes
   */
  async getCommitDetails(params: {
    repoId: string;
    commitId: string;
    branch?: string;
    cloneUrls?: string[];
  }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitDetails", params);
  }

  async getCommitMeta(params: {
    repoId: string;
    commitId: string;
    cloneUrls?: string[];
  }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitMeta", params);
  }

  /**
   * Get diff between two commits (baseOid -> headOid).
   * Returns changes with diffHunks for PR diff display.
   */
  async getDiffBetween(params: {
    repoId: string;
    baseOid: string;
    headOid: string;
    cloneUrls?: string[];
  }): Promise<{ success: boolean; changes?: any[]; error?: string }> {
    await this.initialize();
    return this.execute("getDiffBetween", params);
  }

  /**
   * Get PR commits and file diffs without running merge/conflict analysis.
   */
  async getPRReviewData(params: {
    repoId: string;
    tipCommitOid: string;
    targetBranch: string;
    cloneUrls: string[];
    prCloneUrls?: string[];
    mergeBase?: string;
    targetCommitOid?: string;
  }): Promise<PRReviewDataResult> {
    await this.initialize();
    return this.execute("getPRReviewData", params, {
      timeoutMs: 45000,
      returnWorkerErrors: true,
    });
  }

  /**
   * Get commit count
   */
  async getCommitCount(params: { repoId: string; branch: string }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitCount", params);
  }

  /**
   * Get working tree status using worker's getStatus()
   */
  async getStatus(params: { repoId: string; branch?: string }): Promise<any> {
    await this.initialize();
    return this.execute("getStatus", params);
  }

  /**
   * Delete repository
   */
  async deleteRepo(params: { repoId: string }): Promise<any> {
    await this.initialize();
    return this.execute("deleteRepo", params);
  }

  /**
   * Delete remote repository via provider API
   */
  async deleteRemoteRepo(params: { remoteUrl: string; token: string }): Promise<any> {
    await this.initialize();
    return this.execute("deleteRemoteRepo", params);
  }

  /**
   * Analyze PR merge (fetches from PR clone URLs, tries multiple on failure)
   */
  async analyzePRMerge(params: {
    repoId: string;
    prCloneUrls: string[];
    targetCloneUrls?: string[];
    tipCommitOid: string;
    targetBranch?: string;
  }): Promise<any> {
    await this.initialize();
    // PR analysis can require multiple remote fetch attempts; allow 50% more than default timeout.
    return this.execute("analyzePRMerge", params, { timeoutMs: 45000 });
  }

  /**
   * List branches from repository event (RPC)
   */
  async listBranchesFromEvent(params: { repoEvent: RepoAnnouncementEvent }): Promise<any> {
    await this.initialize();
    return this.execute("listBranchesFromEvent", params);
  }

  /**
   * Get PR preview: commits and files changed between source and target branches (RPC)
   * For fork PRs: cloneUrls = target/upstream, sourceCloneUrls = fork (where source branch lives)
   */
  async getPRPreview(params: {
    repoId: string;
    sourceBranch: string;
    targetBranch: string;
    cloneUrls: string[];
    sourceCloneUrls?: string[];
  }): Promise<any> {
    await this.initialize();
    return this.execute("getPRPreview", params);
  }

  /**
   * Find commits ahead of tip OID in source remote. Source-only - no target.
   * For fork PRs: cloneUrls = target (for init), sourceCloneUrls = fork.
   */
  async getCommitsAheadOfTip(params: {
    repoId: string;
    tipOid: string;
    cloneUrls: string[];
    sourceCloneUrls?: string[];
  }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitsAheadOfTip", params);
  }

  /**
   * Get merge base between head commit and target branch. Call when preparing PR update.
   */
  async getMergeBaseBetween(params: {
    repoId: string;
    headOid: string;
    targetBranch: string;
    cloneUrls: string[];
    sourceCloneUrls?: string[];
  }): Promise<{ mergeBase?: string; error?: string }> {
    await this.initialize();
    return this.execute("getMergeBaseBetween", params);
  }

  /**
   * List branch names from clone URLs without cloning (RPC).
   * Used when creating PRs from forks to populate source branch dropdown.
   */
  async listBranchesFromUrls(params: {
    cloneUrls: string[];
  }): Promise<{ branches: string[]; error?: string }> {
    await this.initialize();
    return this.execute("listBranchesFromUrls", params);
  }

  /**
   * List repository files (RPC)
   */
  async listRepoFilesFromEvent(params: {
    repoEvent: RepoAnnouncementEvent;
    branch?: string;
    path?: string;
    repoKey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("listRepoFilesFromEvent", params);
  }

  /**
   * Get repository file content (RPC)
   */
  async getRepoFileContentFromEvent(params: {
    repoEvent: RepoAnnouncementEvent;
    branch?: string;
    path: string;
    commit?: string;
    repoKey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("getRepoFileContentFromEvent", params);
  }

  /**
   * List tree at a specific commit (for tag browsing) (RPC)
   */
  async listTreeAtCommit(params: {
    repoEvent: RepoAnnouncementEvent;
    commit: string;
    path?: string;
    repoKey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("listTreeAtCommit", params);
  }

  /**
   * Check if file exists at commit (RPC)
   */
  async fileExistsAtCommit(params: {
    repoEvent: RepoAnnouncementEvent;
    branch?: string;
    path: string;
    commit?: string;
    repoKey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("fileExistsAtCommit", params);
  }

  /**
   * Get commit information (RPC)
   */
  async getCommitInfo(params: { repoEvent: RepoAnnouncementEvent; commit: string }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitInfo", params);
  }

  /**
   * Get file history (RPC)
   */
  async getFileHistory(params: {
    repoEvent: RepoAnnouncementEvent;
    path: string;
    branch: string;
    maxCount?: number;
    repoKey?: string;
  }): Promise<any> {
    await this.initialize();
    return this.execute("getFileHistory", params);
  }

  /**
   * Get commit history (alternative method using repo event) (RPC)
   */
  async getCommitHistoryFromEvent(params: {
    repoEvent: RepoAnnouncementEvent;
    branch: string;
    depth?: number;
  }): Promise<any> {
    await this.initialize();
    return this.execute("getCommitHistoryFromEvent", params);
  }

  /**
   * Merge a PR and push to remotes (RPC).
   *
   * For GRASP remotes the push requires a signed Nostr state event (kind 30618) pointing to the
   * new merge commit to be on the relay *before* the git push is accepted. This mirrors how
   * ngit-cli works: publish state → confirm relay received it → git push.
   *
   * When `publishStateEvent` is provided the method uses a two-phase approach for GRASP:
   *   1. Worker merges only (skipPush=true) → returns mergeCommitOid
   *   2. Main thread publishes state event with new SHA and waits for the callback to resolve
   *   3. Worker pushes (unauthenticated smart HTTP)
   *
   * For non-GRASP remotes the normal single-call path is used.
   */
  async mergePRAndPush(params: {
    repoId: string;
    cloneUrls: string[];
    targetCloneUrls?: string[];
    tipCommitOid: string;
    targetBranch?: string;
    mergeCommitMessage?: string;
    fastForward?: boolean;
    userPubkey?: string;
    skipPush?: boolean;
    /**
     * Called after the merge commit is created but before the git push.
     * Must publish a Nostr state event (kind 30618) with the new branch → SHA mapping to the
     * GRASP relay and resolve only once the event is confirmed (or best-effort sent).
     * Params: repoName (identifier only), branch name, new commit SHA, relay WebSocket URL.
     */
    publishStateEvent?: (opts: {
      repoName: string;
      branch: string;
      commitSha: string;
      relayUrl: string;
    }) => Promise<void>;
  }): Promise<{
    success: boolean;
    error?: string;
    mergeCommitOid?: string;
    pushedRemotes?: string[];
    skippedRemotes?: string[];
    warning?: string;
    pushErrors?: Array<{ remote: string; url: string; error: string; code: string; stack: string }>;
  }> {
    await this.initialize();

    const baseParams: Record<string, unknown> = {
      repoId: params.repoId,
      cloneUrls: params.cloneUrls,
      targetCloneUrls: params.targetCloneUrls,
      tipCommitOid: params.tipCommitOid,
      targetBranch: params.targetBranch,
      mergeCommitMessage: params.mergeCommitMessage,
      fastForward: params.fastForward,
      userPubkey: params.userPubkey,
      skipPush: params.skipPush,
    };

    // ── Two-phase flow for GRASP remotes ──────────────────────────────────────
    // GRASP authorizes pushes by checking the relay for a state event (30618) signed by the
    // maintainer that declares the new branch HEAD. We must publish it between merge and push.
    if (typeof params.publishStateEvent === "function") {
      try {
        const targetCloneUrls =
          params.targetCloneUrls && params.targetCloneUrls.length > 0
            ? params.targetCloneUrls
            : params.cloneUrls;

        // Ensure repo is cloned so listRemotes works
        await this.ensureFullClone({
          repoId: params.repoId,
          branch: params.targetBranch || "main",
          cloneUrls: targetCloneUrls,
        });

        const remotes = await this.execute<Array<{ remote: string; url: string }>>("listRemotes", {
          repoId: params.repoId,
        });

        const graspRemotes = (remotes || []).filter((r) => r.url && isGraspRepoHttpUrl(r.url));

        if (graspRemotes.length > 0) {
          // Phase 1: merge only
          const mergeOnlyResult = await this.execute<{
            success: boolean;
            error?: string;
            mergeCommitOid?: string;
          }>("mergePRAndPush", { ...baseParams, skipPush: true }, { timeoutMs: 120000 });

          if (!mergeOnlyResult?.success || !mergeOnlyResult.mergeCommitOid) {
            return {
              success: false,
              error: mergeOnlyResult?.error || "Merge failed",
            };
          }

          const mergeCommitOid = mergeOnlyResult.mergeCommitOid;
          const branch = params.targetBranch || "main";

          // Phase 2: publish state event for each GRASP remote, then push
          const pushedRemotes: string[] = [];
          const skippedRemotes: string[] = [];
          const pushErrors: Array<{
            remote: string;
            url: string;
            error: string;
            code: string;
            stack: string;
          }> = [];

          for (const remote of graspRemotes) {
            try {
              const parsedRemote = parseGraspRepoHttpUrl(remote.url);
              if (!parsedRemote) {
                throw new Error(`Invalid GRASP clone URL: ${remote.url}`);
              }

              const relayUrl = normalizeGraspOrigins(remote.url).wsOrigin;
              const repoName = parsedRemote.identifier;

              // Publish state event with new SHA — GRASP relay must confirm before push
              await params.publishStateEvent({
                repoName,
                branch,
                commitSha: mergeCommitOid,
                relayUrl,
              });

              // Phase 3: push (unauthenticated smart HTTP — relay now has the state event)
              const pushResult = await this.execute<{ success?: boolean; error?: string }>(
                "pushToRemote",
                {
                  repoId: params.repoId,
                  remoteUrl: remote.url,
                  branch,
                  token: params.userPubkey,
                  provider: "grasp",
                },
                { timeoutMs: 60000 }
              );

              if (pushResult?.success) {
                pushedRemotes.push(remote.remote);
              } else {
                throw new Error(pushResult?.error || "Push failed");
              }
            } catch (err: any) {
              pushErrors.push({
                remote: remote.remote,
                url: remote.url,
                error: err?.message || String(err),
                code: err?.code || "UNKNOWN",
                stack: err?.stack || "",
              });
              skippedRemotes.push(remote.remote);
            }
          }

          if (pushedRemotes.length === 0 && graspRemotes.length > 0) {
            // All GRASP pushes failed — reset local state
            try {
              await this.execute("resetRepoToRemote", {
                repoId: params.repoId,
                branch,
                cloneUrls: targetCloneUrls,
              });
            } catch {
              // best effort
            }
            const firstErr = pushErrors[0];
            return {
              success: false,
              error: firstErr
                ? `Push to ${firstErr.remote} failed: ${firstErr.error}`
                : "Push to all GRASP remotes failed",
              pushedRemotes,
              skippedRemotes,
              pushErrors,
            };
          }

          return {
            success: true,
            mergeCommitOid,
            pushedRemotes,
            skippedRemotes,
            pushErrors: pushErrors.length ? pushErrors : undefined,
          };
        }
      } catch (e: any) {
        console.error("[WorkerManager] GRASP two-phase merge failed:", e);
        return {
          success: false,
          error: e?.message || "GRASP two-phase merge failed",
        };
      }
    }

    // ── Normal single-call flow (non-GRASP or no publishStateEvent callback) ──
    return this.execute("mergePRAndPush", baseParams, { timeoutMs: 120000 });
  }

  /**
   * List configured git remotes for local repository clone.
   */
  async listRemotes(params: { repoId: string }): Promise<Array<{ remote: string; url: string }>> {
    await this.initialize();
    return this.execute("listRemotes", params);
  }

  /**
   * Check if worker is ready for operations
   */
  get isReady(): boolean {
    return this.isInitialized && this.worker !== null && this.api !== null;
  }

  /**
   * Get the underlying worker instance (for advanced use cases)
   */
  get workerInstance(): Worker | null {
    return this.worker;
  }

  /**
   * Get the API instance (for direct access if needed)
   */
  get apiInstance(): any {
    return this.api;
  }

  /**
   * Set authentication configuration for git operations
   */
  async setAuthConfig(config: AuthConfig): Promise<void> {
    this.authConfig = config;

    // If worker is already initialized, update the configuration
    if (this.isInitialized && this.api) {
      try {
        const nextJson = JSON.stringify(config || {});
        if (nextJson !== this.lastAuthConfigJson) {
          await this.api.setAuthConfig(config);
          this.lastAuthConfigJson = nextJson;
        } // else no-op
      } catch (error) {
        console.error("Failed to update authentication configuration:", error);
      }
    }
  }

  /**
   * Set git configuration for worker operations
   */
  async setGitConfig(config: GitConfig): Promise<void> {
    this.gitConfig = { ...this.gitConfig, ...config };

    if (this.isInitialized && this.api) {
      try {
        const nextJson = JSON.stringify(this.gitConfig || {});
        if (nextJson !== this.lastGitConfigJson) {
          if (typeof this.api.setGitConfig === "function") {
            await this.api.setGitConfig(this.gitConfig);
          }
          this.lastGitConfigJson = nextJson;
        }
      } catch (error) {
        console.error("Failed to update git configuration:", error);
      }
    }
  }

  /**
   * Add or update a single authentication token
   */
  async addAuthToken(token: AuthToken): Promise<void> {
    // Remove existing token for the same host
    this.authConfig.tokens = this.authConfig.tokens.filter((t) => t.host !== token.host);
    // Add the new token
    this.authConfig.tokens.push(token);

    // Update the worker if initialized
    if (this.isInitialized && this.api) {
      await this.setAuthConfig(this.authConfig);
    }
  }

  /**
   * Remove authentication token for a specific host
   */
  async removeAuthToken(host: string): Promise<void> {
    this.authConfig.tokens = this.authConfig.tokens.filter((t) => t.host !== host);

    // Update the worker if initialized
    if (this.isInitialized && this.api) {
      await this.setAuthConfig(this.authConfig);
    }
  }

  /**
   * Get current authentication configuration
   */
  getAuthConfig(): AuthConfig {
    return { ...this.authConfig };
  }

  /**
   * Reset repository to match remote HEAD state (RPC)
   * This performs a hard reset to remove any local commits that diverge from remote
   */
  async resetRepoToRemote(repoId: string, branch?: string): Promise<any> {
    await this.initialize();

    const result = await this.execute<{
      success: boolean;
      remoteCommit?: string;
      error?: string;
      code?: GitErrorCode;
      category?: GitErrorCategory;
      hint?: string;
    }>("resetRepoToRemote", { repoId, branch }, { timeoutMs: 60000 });

    if (!result?.success) {
      if (isWorkerErrorResponse(result)) {
        throw createErrorFromWorkerResponse(result);
      }
      throw createUnknownError(
        `Reset to remote failed (repoId=${repoId}${branch ? `, branch=${branch}` : ""})`
      );
    }

    console.log(`Repository ${repoId} reset to remote commit ${result.remoteCommit}`);
    return result;
  }

  /**
   * Update the progress callback
   */
  setProgressCallback(callback: WorkerProgressCallback): void {
    this.progressCallback = callback;
  }

  private handleWorkerProgress = (event: WorkerProgressEvent | MessageEvent): void => {
    const payload = event instanceof MessageEvent ? event.data : event;
    if (!payload || typeof payload !== "object") {
      return;
    }
    if (
      "type" in payload &&
      payload.type !== "clone-progress" &&
      payload.type !== "merge-progress"
    ) {
      return;
    }

    if (!this.progressCallback) {
      return;
    }

    this.progressCallback({
      repoId: (payload as any).repoId,
      phase: (payload as any).phase ?? (payload as any).step ?? "unknown",
      progress: typeof payload.progress === "number" ? payload.progress : undefined,
      targetBranch: (payload as any).targetBranch,
      message: (payload as any).message,
    });
  };

  /**
   * Terminate the worker and clean up resources
   */
  dispose(): void {
    WorkerManager.instances.delete(this);
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.api = null;
    this.isInitialized = false;
    this.progressCallback = undefined;
  }

  /**
   * Check if the worker is still alive and responsive
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isReady) {
      return false;
    }

    try {
      // Try a simple operation to verify worker is responsive
      await this.execute("ping", {});
      return true;
    } catch (error) {
      console.warn("Worker health check failed:", error);
      return false;
    }
  }

  /**
   * Restart the worker if it becomes unresponsive
   */
  async restart(): Promise<void> {
    this.dispose();
    await this.initialize();
  }
}
