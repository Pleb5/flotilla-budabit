import type { RepoAnnouncementEvent } from "@nostr-git/core/events";
import {
  createAuthRequiredError,
  createFsError,
  createNetworkError,
  createTimeoutError,
  createUnknownError,
  wrapError,
} from "@nostr-git/core/errors";
import {
  detectVendorFromUrl,
  type GitNaturalFileContentResult,
  type GitNaturalListCommitsResult,
  type GitNaturalListDirectoryResult,
  type GitNaturalListRefsResult,
  type GitNaturalReadSourceMetadata,
} from "@nostr-git/core/git";
import { withUrlFallback, filterValidCloneUrls, isGraspRepoHttpUrl } from "@nostr-git/core/utils";
import { nip19 } from "nostr-tools";

import type { Token } from "$lib/stores/tokens";
import { tryTokensForHost, getTokensForHost } from "$lib/utils/tokenHelpers";
import { WorkerManager } from "./WorkerManager";
import { isDisplayableGitRef, normalizeGitRefName } from "./branch-ref";

export interface VendorReadRouterConfig {
  getTokens: () => Promise<Token[]>;
  preferVendorReads?: boolean; // default true
  /**
   * Git natural reads use Git Smart HTTP through worker RPCs.
   * Default is disabled so production-visible read order remains unchanged.
   */
  gitNaturalReads?: GitNaturalReadMode;
  /** Scope Git natural rollout. `enabled` defaults to all HTTP(S); app rollout can use GRASP/generic first. */
  gitNaturalReadPolicy?: GitNaturalReadPolicy;
  /** Override the worker/default CORS proxy for Git natural reads. Use null to force direct. */
  gitNaturalCorsProxy?: string | null;
}

export type GitNaturalReadMode = "disabled" | "enabled" | "shadow";
export type GitNaturalReadPolicy = "all-http" | "grasp-and-generic";

export type ReadSourceKind =
  | "repo-state"
  | "git-natural"
  | "provider-rest"
  | "git-remote"
  | "worker-clone"
  | "local";

export type ReadOperation =
  | "listDirectory"
  | "getFileContent"
  | "listRefs"
  | "listCommits"
  | "getCommit"
  | "getCommitCount"
  | "diff";

export interface ReadSourceMetadata {
  kind: ReadSourceKind;
  label: string;
  operation?: ReadOperation;
  remoteUrl?: string;
  effectiveUrl?: string;
  usesProxy?: boolean;
  attemptedUrls?: string[];
  ref?: string;
  commitHash?: string;
  objectHash?: string;
  capability?: string;
  capabilities?: string[];
  fallbackReason?: string;
  elapsedMs?: number;
  defaultBranch?: string;
  details?: string;
}

export interface VendorRef {
  name: string;
  type: "heads" | "tags";
  fullRef: string;
  commitId: string;
}

export interface VendorRefResult {
  refs: VendorRef[];
  defaultBranch?: string;
}

export interface VendorFileInfo {
  path: string;
  type: "file" | "directory" | string;
  size?: number;
  mode?: string;
  oid?: string;
}

export interface VendorDirectoryResult {
  files: VendorFileInfo[];
  path: string;
  ref: string;
  fromVendor: boolean;
  source?: ReadSourceMetadata;
}

export interface VendorFileContentResult {
  content: string;
  path: string;
  ref: string;
  encoding?: string;
  size: number;
  fromVendor: boolean;
  source?: ReadSourceMetadata;
}

/**
 * Commit information from vendor REST APIs
 */
export interface VendorCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  parents: Array<{ sha: string }>;
}

export interface VendorCommitResult {
  commits: VendorCommit[];
  ref: string;
  fromVendor: boolean;
  hasMore?: boolean;
  source?: ReadSourceMetadata;
}

export type RefDiscoverySource = ReadSourceMetadata;

type SupportedVendor = "github" | "gitlab" | "gitea" | "bitbucket" | "grasp-rest";

// GRASP relays currently expose git smart HTTP endpoints, not the REST endpoints below.
// Keep REST reads disabled until a compatible GRASP REST API is deployed.
const ENABLE_GRASP_REST_READS: boolean = false;

/**
 * Callback for reporting clone URL errors to the UI
 */
export type CloneUrlErrorCallback = (url: string, error: string, status?: number) => void;
export type CloneUrlSuccessCallback = (url: string) => void;
type ReadFailureSummary = { url: string; error?: string };

/**
 * VendorReadRouter coordinates remote reads across Git natural, provider REST, and worker fallback.
 * - Remote fast paths are best-effort and should never block fallback git reads.
 * - Heavy git/FS operations always go through WorkerManager RPC.
 */
export class VendorReadRouter {
  private getTokens: () => Promise<Token[]>;
  private preferVendorReads: boolean;
  private gitNaturalReads: GitNaturalReadMode;
  private gitNaturalReadPolicy: GitNaturalReadPolicy;
  private gitNaturalCorsProxy?: string | null;
  private onCloneUrlError?: CloneUrlErrorCallback;
  private onCloneUrlSuccess?: CloneUrlSuccessCallback;

  constructor(config: VendorReadRouterConfig) {
    this.getTokens = config.getTokens;
    this.preferVendorReads = config.preferVendorReads ?? true;
    this.gitNaturalReads = config.gitNaturalReads ?? "disabled";
    this.gitNaturalReadPolicy = config.gitNaturalReadPolicy ?? "all-http";
    this.gitNaturalCorsProxy = config.gitNaturalCorsProxy;
  }

  /**
   * Set a callback to be notified when clone URL errors occur (404, auth errors, etc.)
   * This allows the UI to display these errors to the user.
   */
  setCloneUrlErrorCallback(callback: CloneUrlErrorCallback | undefined): void {
    this.onCloneUrlError = callback;
  }

  setCloneUrlSuccessCallback(callback: CloneUrlSuccessCallback | undefined): void {
    this.onCloneUrlSuccess = callback;
  }

  /**
   * Report a clone URL error to the registered callback
   */
  private reportCloneUrlError(url: string, error: string, status?: number): void {
    if (this.onCloneUrlError) {
      this.onCloneUrlError(url, error, status);
    }
  }

  private reportCloneUrlSuccess(url: string): void {
    if (this.onCloneUrlSuccess) {
      this.onCloneUrlSuccess(url);
    }
  }

  private readSource(
    params: ReadSourceMetadata & {
      startedAt: number;
    }
  ): ReadSourceMetadata {
    const { startedAt, elapsedMs, ...source } = params;
    return {
      ...source,
      elapsedMs: elapsedMs ?? Math.max(0, Date.now() - startedAt),
    };
  }

  private shouldTryGitNaturalReads(): boolean {
    return this.gitNaturalReads === "enabled";
  }

  private shouldShadowGitNaturalReads(): boolean {
    return this.gitNaturalReads === "shadow";
  }

  private getNaturalReadUrls(remotes: string[]): string[] {
    const httpRemotes = remotes.filter((url) => /^https?:\/\//i.test(url));
    if (this.gitNaturalReadPolicy === "all-http") return httpRemotes;

    return httpRemotes.filter((url) => {
      if (isGraspRepoHttpUrl(url)) return true;
      return this.getSupportedVendor(url) === null;
    });
  }

  private naturalRequestBase(remoteUrl: string): {
    url: string;
    enabled: true;
    corsProxy?: string | null;
  } {
    return {
      url: remoteUrl,
      enabled: true,
      ...(this.gitNaturalCorsProxy !== undefined ? { corsProxy: this.gitNaturalCorsProxy } : {}),
    };
  }

  private naturalReadSource(
    source: GitNaturalReadSourceMetadata,
    operation: ReadOperation,
    attemptedUrls: string[],
    startedAt: number
  ): ReadSourceMetadata {
    const { operation: _operation, ref, ...rest } = source;
    return this.readSource({
      ...rest,
      operation,
      attemptedUrls,
      ref: ref ? normalizeGitRefName(ref) : undefined,
      startedAt,
    });
  }

  private naturalListRefsToVendor(
    result: GitNaturalListRefsResult,
    attemptedUrls: string[],
    startedAt: number
  ): {
    refs: VendorRef[];
    fromVendor: boolean;
    source: RefDiscoverySource;
    defaultBranch?: string;
  } {
    const parsed = this.parseServerRefs(result.refs || []);
    const defaultBranch = result.defaultBranch || parsed.defaultBranch;
    return {
      refs: parsed.refs.filter((ref) => isDisplayableGitRef(ref)),
      fromVendor: false,
      defaultBranch,
      source: this.naturalReadSource(
        {
          ...result.source,
          ...(defaultBranch ? { defaultBranch } : {}),
        },
        "listRefs",
        attemptedUrls,
        startedAt
      ),
    };
  }

  private naturalListDirectoryToVendor(
    result: GitNaturalListDirectoryResult,
    attemptedUrls: string[],
    startedAt: number
  ): VendorDirectoryResult {
    return {
      files: (result.entries || []).map((entry) => ({
        path: entry.path || entry.name || "",
        type: entry.type === "directory" ? "directory" : entry.type === "file" ? "file" : entry.type,
        mode: entry.mode,
        oid: entry.oid,
      })),
      path: result.path || "",
      ref: normalizeGitRefName(result.ref),
      fromVendor: false,
      source: this.naturalReadSource(result.source, "listDirectory", attemptedUrls, startedAt),
    };
  }

  private naturalGetFileContentToVendor(
    result: GitNaturalFileContentResult,
    attemptedUrls: string[],
    startedAt: number
  ): VendorFileContentResult {
    const content = this.decodeBase64ToUtf8(result.content || "");
    return {
      content,
      path: result.path,
      ref: normalizeGitRefName(result.ref),
      encoding: "utf-8",
      size: content.length,
      fromVendor: false,
      source: this.naturalReadSource(result.source, "getFileContent", attemptedUrls, startedAt),
    };
  }

  private naturalListCommitsToVendor(
    result: GitNaturalListCommitsResult,
    attemptedUrls: string[],
    startedAt: number,
    depth: number
  ): VendorCommitResult {
    const commits: VendorCommit[] = (result.commits || []).map((commit) => ({
      sha: commit.hash,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        date: this.gitTimestampToIso(commit.author.timestamp),
      },
      committer: {
        name: commit.committer.name,
        email: commit.committer.email,
        date: this.gitTimestampToIso(commit.committer.timestamp),
      },
      parents: (commit.parents || []).map((sha) => ({ sha })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(result.ref),
      fromVendor: false,
      hasMore: commits.length >= depth,
      source: this.naturalReadSource(result.source, "listCommits", attemptedUrls, startedAt),
    };
  }

  private gitTimestampToIso(timestamp: number | undefined): string {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
    return new Date(timestamp * 1000).toISOString();
  }

  private runGitNaturalShadow<T extends { source?: any }>(params: {
    operation: ReadOperation;
    remotes: string[];
    repoKey?: string;
    ref?: string;
    path?: string;
    baseline: T;
    readNatural: (remoteUrl: string, attemptedUrls: string[], startedAt: number) => Promise<T>;
    matches: (natural: T, baseline: T) => boolean;
    summarize: (value: T) => unknown;
  }): void {
    if (!this.shouldShadowGitNaturalReads()) return;
    const naturalUrls = this.getNaturalReadUrls(params.remotes);
    if (naturalUrls.length === 0) return;

    void (async () => {
      const startedAt = Date.now();
      const fallbackResult = await withUrlFallback(
        naturalUrls,
        async (remoteUrl: string) => {
          return await params.readNatural(remoteUrl, [remoteUrl], startedAt);
        },
        { repoId: params.repoKey, perUrlTimeoutMs: 15_000 }
      );

      if (!fallbackResult.success || !fallbackResult.result) return;

      const natural = fallbackResult.result;
      if (natural.source) {
        natural.source = {
          ...natural.source,
          attemptedUrls: fallbackResult.attempts.map((attempt) => attempt.url),
        };
      }

      if (params.matches(natural, params.baseline)) return;

      const naturalSource = natural.source;
      const baselineSource = params.baseline.source;
      console.warn("[VendorReadRouter] Git natural shadow mismatch", {
        operation: params.operation,
        remoteUrl: fallbackResult.usedUrl || naturalUrls[0],
        ref: params.ref || naturalSource?.ref || baselineSource?.ref,
        commitHash: naturalSource?.commitHash || baselineSource?.commitHash,
        path: params.path,
        objectHash: naturalSource?.objectHash || baselineSource?.objectHash,
        baseline: params.summarize(params.baseline),
        natural: params.summarize(natural),
        baselineSource: this.summarizeReadSource(baselineSource),
        naturalSource: this.summarizeReadSource(naturalSource),
      });
    })().catch((error) => {
      console.debug("[VendorReadRouter] Git natural shadow read failed", {
        operation: params.operation,
        remotes: naturalUrls,
        ref: params.ref,
        path: params.path,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private summarizeReadSource(source?: Partial<ReadSourceMetadata>): Record<string, unknown> | undefined {
    if (!source) return undefined;
    return {
      kind: source.kind,
      operation: source.operation,
      remoteUrl: source.remoteUrl,
      effectiveUrl: source.effectiveUrl,
      usesProxy: source.usesProxy,
      attemptedUrls: source.attemptedUrls,
      ref: source.ref,
      commitHash: source.commitHash,
      objectHash: source.objectHash,
      capability: source.capability,
      fallbackReason: source.fallbackReason,
    };
  }

  private summarizeRefsResult(result: {
    refs?: VendorRef[];
    defaultBranch?: string;
  }): unknown {
    return {
      defaultBranch: result.defaultBranch,
      refs: (result.refs || [])
        .map((ref) => ({
          name: ref.name,
          type: ref.type,
          fullRef: ref.fullRef,
          commitId: ref.commitId,
        }))
        .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`)),
    };
  }

  private summarizeDirectoryResult(result: Pick<VendorDirectoryResult, "files" | "path" | "ref">): unknown {
    return {
      path: result.path,
      ref: normalizeGitRefName(result.ref),
      files: (result.files || [])
        .map((file) => ({
          path: file.path,
          type: file.type,
          oid: file.oid,
        }))
        .sort((a, b) => String(a.path).localeCompare(String(b.path))),
    };
  }

  private summarizeFileContentResult(
    result: Pick<VendorFileContentResult, "content" | "encoding" | "path" | "ref" | "size">
  ): unknown {
    return {
      path: result.path,
      ref: normalizeGitRefName(result.ref),
      encoding: result.encoding,
      size: result.size,
      contentLength: result.content.length,
    };
  }

  private summarizeCommitResult(result: Pick<VendorCommitResult, "commits" | "ref" | "hasMore">): unknown {
    return {
      ref: normalizeGitRefName(result.ref),
      hasMore: result.hasMore,
      commits: (result.commits || []).map((commit) => ({
        sha: commit.sha,
        parents: (commit.parents || []).map((parent) => parent.sha),
      })),
    };
  }

  private refsMatch(
    natural: { refs?: VendorRef[]; defaultBranch?: string },
    baseline: { refs?: VendorRef[]; defaultBranch?: string }
  ): boolean {
    return JSON.stringify(this.summarizeRefsResult(natural)) === JSON.stringify(this.summarizeRefsResult(baseline));
  }

  private directoriesMatch(
    natural: Pick<VendorDirectoryResult, "files" | "path" | "ref">,
    baseline: Pick<VendorDirectoryResult, "files" | "path" | "ref">
  ): boolean {
    return (
      JSON.stringify(this.summarizeDirectoryResult(natural)) ===
      JSON.stringify(this.summarizeDirectoryResult(baseline))
    );
  }

  private fileContentsMatch(
    natural: Pick<VendorFileContentResult, "content" | "path" | "ref" | "size">,
    baseline: Pick<VendorFileContentResult, "content" | "path" | "ref" | "size">
  ): boolean {
    return (
      natural.content === baseline.content &&
      natural.path === baseline.path &&
      normalizeGitRefName(natural.ref) === normalizeGitRefName(baseline.ref)
    );
  }

  private commitsMatch(
    natural: Pick<VendorCommitResult, "commits" | "ref" | "hasMore">,
    baseline: Pick<VendorCommitResult, "commits" | "ref" | "hasMore">
  ): boolean {
    return (
      JSON.stringify(this.summarizeCommitResult(natural)) ===
      JSON.stringify(this.summarizeCommitResult(baseline))
    );
  }

  private failedAttemptSummaries(attempts: Array<{ url: string; success: boolean; error?: string }>): ReadFailureSummary[] {
    return attempts
      .filter((attempt) => !attempt.success)
      .map((attempt) => ({ url: attempt.url, error: attempt.error || "Unknown error" }));
  }

  private formatFailureContext(label: string, failures: ReadFailureSummary[]): string {
    if (failures.length === 0) return "";
    return ` ${label}: ${failures
      .map((attempt) => `${attempt.url}: ${attempt.error || "Unknown error"}`)
      .join(" | ")}`;
  }

  private reportGitNaturalFailures(failures: ReadFailureSummary[]): void {
    for (const attempt of failures) {
      const message = `Git natural read failed: ${attempt.error || "Unknown error"}`;
      this.reportCloneUrlError(attempt.url, message, this.extractHttpStatus(attempt.error));
    }
  }

  private logGitNaturalFallback(
    operation: ReadOperation,
    attempts: Array<{ url: string; success: boolean; error?: string }>
  ): ReadFailureSummary[] {
    const failures = this.failedAttemptSummaries(attempts);
    if (failures.length === 0) return [];
    console.warn("[VendorReadRouter] Git natural read failed, falling back", {
      operation,
      attempts: failures.map((attempt) => ({ url: attempt.url, error: attempt.error })),
    });
    return failures;
  }

  /**
   * Extract HTTP status code from error message if present
   */
  private extractHttpStatus(error?: string): number | undefined {
    if (!error) return undefined;
    const match = error.match(/HTTP\s*(\d{3})/i);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private isBenignEmptyRepoCommitError(error?: string): boolean {
    return this.extractHttpStatus(error) === 409;
  }

  async listDirectory(params: {
    workerManager: WorkerManager;
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    cloneUrls: string[];
    branch: string;
    path?: string;
  }): Promise<VendorDirectoryResult> {
    const path = params.path || "";
    const branch = params.branch || "";
    const remotes = this.getValidRemotes(params.cloneUrls);
    const startedAt = Date.now();
    let naturalAttempted = false;
    let providerReadAttempted = false;
    let pendingNaturalFailures: ReadFailureSummary[] = [];

    // 1) Optional Git natural fast path. This stays feature-flagged because it
    // changes the production-visible source order when enabled.
    if (this.shouldTryGitNaturalReads()) {
      const naturalUrls = this.getNaturalReadUrls(remotes);
      if (naturalUrls.length > 0) {
        naturalAttempted = true;
        console.log(`[VendorReadRouter] Trying Git natural for listDirectory...`);
        const naturalResult = await withUrlFallback(
          naturalUrls,
          async (remoteUrl: string) => {
            return await params.workerManager.gitNaturalListDirectory({
              ...this.naturalRequestBase(remoteUrl),
              ref: branch,
              path,
            });
          },
          { repoId: params.repoKey, perUrlTimeoutMs: 15_000 }
        );

        if (naturalResult.success && naturalResult.result) {
          if (naturalResult.usedUrl) {
            this.reportCloneUrlSuccess(naturalResult.usedUrl);
          }
          console.log(`[VendorReadRouter] Git natural success`);
          return this.naturalListDirectoryToVendor(
            naturalResult.result,
            naturalResult.attempts.map((attempt) => attempt.url),
            startedAt
          );
        }

        pendingNaturalFailures = this.logGitNaturalFallback("listDirectory", naturalResult.attempts);
      }
    }

    // 2) Vendor fast path only for the selected remote policy. A later GitHub/GitLab
    // URL must not jump ahead of the first clone URL just because it has an API.
    if (this.preferVendorReads && remotes.length > 0) {
      const vendorUrls = this.getPolicyVendorUrls(remotes);

      if (vendorUrls.length > 0) {
        providerReadAttempted = true;
        // Try each vendor URL with fallback
        console.log(`[VendorReadRouter] Trying REST API for listDirectory...`);
        const vendorResult = await withUrlFallback(
          vendorUrls,
          async (remoteUrl: string) => {
            const vendor = this.getSupportedVendor(remoteUrl)!;
            return await this.vendorListDirectory({
              vendor,
              remoteUrl,
              branch,
              path,
            });
          },
          { repoId: params.repoKey }
        );

        if (vendorResult.success && vendorResult.result) {
          if (vendorResult.usedUrl) {
            this.reportCloneUrlSuccess(vendorResult.usedUrl);
          }
          console.log(`[VendorReadRouter] REST API success (fromVendor: true)`);
          const result = {
            ...vendorResult.result,
            fromVendor: true,
            source: this.readSource({
              kind: "provider-rest",
              label: "Provider REST API",
              operation: "listDirectory",
              remoteUrl: vendorResult.usedUrl || vendorUrls[0],
              attemptedUrls: vendorResult.attempts.map((attempt) => attempt.url),
              ref: normalizeGitRefName(branch),
              fallbackReason: naturalAttempted ? "git-natural-failed" : undefined,
              startedAt,
              details: "Directory listing comes from the remote provider REST API.",
            }),
          };
          this.runGitNaturalShadow({
            operation: "listDirectory",
            remotes,
            repoKey: params.repoKey,
            ref: normalizeGitRefName(branch),
            path,
            baseline: result,
            readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
              const natural = await params.workerManager.gitNaturalListDirectory({
                ...this.naturalRequestBase(remoteUrl),
                ref: branch,
                path,
              });
              return this.naturalListDirectoryToVendor(natural, attemptedUrls, shadowStartedAt);
            },
            matches: (natural, baseline) => this.directoriesMatch(natural, baseline),
            summarize: (value) => this.summarizeDirectoryResult(value),
          });
          return result;
        }

        // All vendor URLs failed, fall back to git worker
        console.warn(`[VendorReadRouter] REST API failed, falling back to git`);
        console.warn(
          `[VendorReadRouter] All ${vendorResult.attempts.length} vendor URL(s) failed for listDirectory`
        );
        for (const attempt of vendorResult.attempts) {
          if (!attempt.success) {
            console.warn(`  - ${attempt.url}: ${attempt.error}`);
            // Report error to UI callback
            const status = this.extractHttpStatus(attempt.error);
            this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
          }
        }
      }
    }

    // 3) Git worker fallback
    console.log(`[VendorReadRouter] Using git worker fallback`);
    try {
      const filesRaw = await params.workerManager.listRepoFilesFromEvent({
        repoEvent: params.repoEvent,
        repoKey: params.repoKey,
        branch,
        path,
      });

      const files: VendorFileInfo[] = (filesRaw || []).map((f: any) => ({
        path: f.path || f.name || "",
        type:
          f.type === "dir" || f.type === "tree" || f.type === "directory" ? "directory" : "file",
        size: f.size,
        mode: f.mode,
        oid: f.oid || f.sha,
      }));

      const result = {
        files,
        path,
        ref: normalizeGitRefName(branch),
        fromVendor: false,
        source: this.readSource({
          kind: "worker-clone",
          label: "Worker clone fallback",
          operation: "listDirectory",
          attemptedUrls: remotes,
          ref: normalizeGitRefName(branch),
          fallbackReason: naturalAttempted
            ? providerReadAttempted
              ? "git-natural-and-provider-rest-unavailable-or-failed"
              : "git-natural-failed"
            : "provider-rest-unavailable-or-failed",
          startedAt,
          details: "Directory listing comes from the worker-backed local git fallback.",
        }),
      };
      this.runGitNaturalShadow({
        operation: "listDirectory",
        remotes,
        repoKey: params.repoKey,
        ref: normalizeGitRefName(branch),
        path,
        baseline: result,
        readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
          const natural = await params.workerManager.gitNaturalListDirectory({
            ...this.naturalRequestBase(remoteUrl),
            ref: branch,
            path,
          });
          return this.naturalListDirectoryToVendor(natural, attemptedUrls, shadowStartedAt);
        },
        matches: (natural, baseline) => this.directoriesMatch(natural, baseline),
        summarize: (value) => this.summarizeDirectoryResult(value),
      });
      return result;
    } catch (workerErr) {
      const err = workerErr instanceof Error ? workerErr : new Error(String(workerErr));
      if (pendingNaturalFailures.length > 0) {
        this.reportGitNaturalFailures(pendingNaturalFailures);
        err.message = `${err.message}${this.formatFailureContext(
          "after Git natural read failed",
          pendingNaturalFailures
        )}`;
      }
      throw err;
    }
  }

  async getFileContent(params: {
    workerManager: WorkerManager;
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    cloneUrls: string[];
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const branch = params.branch || "";
    const remotes = this.getValidRemotes(params.cloneUrls);
    const ctx = this.ctx({ op: "getFileContent", remote: remotes[0], branch, path: params.path });
    const startedAt = Date.now();
    let naturalAttempted = false;
    let providerReadAttempted = false;
    let pendingNaturalFailures: ReadFailureSummary[] = [];

    // 1) Optional Git natural fast path.
    if (this.shouldTryGitNaturalReads()) {
      const naturalUrls = this.getNaturalReadUrls(remotes);
      if (naturalUrls.length > 0) {
        naturalAttempted = true;
        console.log(`[VendorReadRouter] Trying Git natural for getFileContent...`);
        const naturalResult = await withUrlFallback(
          naturalUrls,
          async (remoteUrl: string) => {
            return await params.workerManager.gitNaturalGetFileContent({
              ...this.naturalRequestBase(remoteUrl),
              ref: branch,
              path: params.path,
            });
          },
          { repoId: params.repoKey, perUrlTimeoutMs: 15_000 }
        );

        if (naturalResult.success && naturalResult.result) {
          if (naturalResult.usedUrl) {
            this.reportCloneUrlSuccess(naturalResult.usedUrl);
          }
          console.log(`[VendorReadRouter] Git natural success`);
          return this.naturalGetFileContentToVendor(
            naturalResult.result,
            naturalResult.attempts.map((attempt) => attempt.url),
            startedAt
          );
        }

        pendingNaturalFailures = this.logGitNaturalFallback("getFileContent", naturalResult.attempts);
      }
    }

    // 2) Vendor fast path only for the selected remote policy.
    if (this.preferVendorReads && remotes.length > 0) {
      const vendorUrls = this.getPolicyVendorUrls(remotes);

      if (vendorUrls.length > 0) {
        providerReadAttempted = true;
        // Try each vendor URL with fallback
        console.log(`[VendorReadRouter] Trying REST API for getFileContent...`);
        const vendorResult = await withUrlFallback(
          vendorUrls,
          async (remoteUrl: string) => {
            const vendor = this.getSupportedVendor(remoteUrl)!;
            return await this.vendorGetFileContent({
              vendor,
              remoteUrl,
              branch,
              path: params.path,
            });
          },
          { repoId: params.repoKey }
        );

        if (vendorResult.success && vendorResult.result) {
          if (vendorResult.usedUrl) {
            this.reportCloneUrlSuccess(vendorResult.usedUrl);
          }
          console.log(`[VendorReadRouter] REST API success (fromVendor: true)`);
          const result = {
            ...vendorResult.result,
            fromVendor: true,
            source: this.readSource({
              kind: "provider-rest",
              label: "Provider REST API",
              operation: "getFileContent",
              remoteUrl: vendorResult.usedUrl || vendorUrls[0],
              attemptedUrls: vendorResult.attempts.map((attempt) => attempt.url),
              ref: normalizeGitRefName(branch),
              fallbackReason: naturalAttempted ? "git-natural-failed" : undefined,
              startedAt,
              details: "File content comes from the remote provider REST API.",
            }),
          };
          this.runGitNaturalShadow({
            operation: "getFileContent",
            remotes,
            repoKey: params.repoKey,
            ref: normalizeGitRefName(branch),
            path: params.path,
            baseline: result,
            readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
              const natural = await params.workerManager.gitNaturalGetFileContent({
                ...this.naturalRequestBase(remoteUrl),
                ref: branch,
                path: params.path,
              });
              return this.naturalGetFileContentToVendor(natural, attemptedUrls, shadowStartedAt);
            },
            matches: (natural, baseline) => this.fileContentsMatch(natural, baseline),
            summarize: (value) => this.summarizeFileContentResult(value),
          });
          return result;
        }

        // All vendor URLs failed, fall back to git worker
        console.warn(`[VendorReadRouter] REST API failed, falling back to git`);
        console.warn(
          `[VendorReadRouter] All ${vendorResult.attempts.length} vendor URL(s) failed for getFileContent`
        );
        for (const attempt of vendorResult.attempts) {
          if (!attempt.success) {
            const status = this.extractHttpStatus(attempt.error);
            this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
          }
        }
      }
    }

    // 3) Git worker fallback
    console.log(`[VendorReadRouter] Using git worker fallback`);
    try {
      const contentRaw = await params.workerManager.getRepoFileContentFromEvent({
        repoEvent: params.repoEvent,
        repoKey: params.repoKey,
        branch,
        path: params.path,
      });
      const content = typeof contentRaw === "string" ? contentRaw : String(contentRaw ?? "");

      const result = {
        content,
        path: params.path,
        ref: normalizeGitRefName(branch),
        encoding: "utf-8",
        size: content.length,
        fromVendor: false,
        source: this.readSource({
          kind: "worker-clone",
          label: "Worker clone fallback",
          operation: "getFileContent",
          attemptedUrls: remotes,
          ref: normalizeGitRefName(branch),
          fallbackReason: naturalAttempted
            ? providerReadAttempted
              ? "git-natural-and-provider-rest-unavailable-or-failed"
              : "git-natural-failed"
            : "provider-rest-unavailable-or-failed",
          startedAt,
          details: "File content comes from the worker-backed local git fallback.",
        }),
      };
      this.runGitNaturalShadow({
        operation: "getFileContent",
        remotes,
        repoKey: params.repoKey,
        ref: normalizeGitRefName(branch),
        path: params.path,
        baseline: result,
        readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
          const natural = await params.workerManager.gitNaturalGetFileContent({
            ...this.naturalRequestBase(remoteUrl),
            ref: branch,
            path: params.path,
          });
          return this.naturalGetFileContentToVendor(natural, attemptedUrls, shadowStartedAt);
        },
        matches: (natural, baseline) => this.fileContentsMatch(natural, baseline),
        summarize: (value) => this.summarizeFileContentResult(value),
      });
      return result;
    } catch (workerErr) {
      const err = workerErr instanceof Error ? workerErr : new Error(String(workerErr));
      if (pendingNaturalFailures.length > 0) {
        this.reportGitNaturalFailures(pendingNaturalFailures);
      }
      const naturalContext = pendingNaturalFailures.length
        ? this.formatFailureContext("after Git natural read failed", pendingNaturalFailures)
        : "";
      err.message = `${err.message}${ctx}${naturalContext}`;
      throw err;
    }
  }

  async listRefs(params: {
    workerManager: WorkerManager;
    repoEvent: RepoAnnouncementEvent;
    cloneUrls: string[];
  }): Promise<{
    refs: VendorRef[];
    fromVendor: boolean;
    source: RefDiscoverySource;
    defaultBranch?: string;
  }> {
    const remotes = this.getValidRemotes(params.cloneUrls);
    const startedAt = Date.now();
    let naturalAttempted = false;
    let providerReadAttempted = false;

    // 1) Optional Git natural fast path.
    if (this.shouldTryGitNaturalReads()) {
      const naturalUrls = this.getNaturalReadUrls(remotes);
      if (naturalUrls.length > 0) {
        naturalAttempted = true;
        console.log(`[VendorReadRouter] Trying Git natural for listRefs...`);
        const naturalResult = await withUrlFallback(
          naturalUrls,
          async (remoteUrl: string) => {
            return await params.workerManager.gitNaturalListRefs({
              ...this.naturalRequestBase(remoteUrl),
              symrefs: true,
            });
          },
          { repoId: this.pickRemote(params.cloneUrls) || undefined, perUrlTimeoutMs: 15_000 }
        );

        if (naturalResult.success && naturalResult.result) {
          if (naturalResult.usedUrl) {
            this.reportCloneUrlSuccess(naturalResult.usedUrl);
          }
          console.log(`[VendorReadRouter] Git natural success`);
          return this.naturalListRefsToVendor(
            naturalResult.result,
            naturalResult.attempts.map((attempt) => attempt.url),
            startedAt
          );
        }

        this.logGitNaturalFallback("listRefs", naturalResult.attempts);
      }
    }

    // 2) Vendor fast path only for the selected remote policy.
    if (this.preferVendorReads && remotes.length > 0) {
      const vendorUrls = this.getPolicyVendorUrls(remotes);

      if (vendorUrls.length > 0) {
        providerReadAttempted = true;
        console.log(`[VendorReadRouter] Trying REST API for listRefs...`);
        const vendorResult = await withUrlFallback(vendorUrls, async (remoteUrl: string) => {
          const vendor = this.getSupportedVendor(remoteUrl)!;
          return await this.vendorListRefs({ vendor, remoteUrl });
        });

        if (vendorResult.success && vendorResult.result) {
          if (vendorResult.usedUrl) {
            this.reportCloneUrlSuccess(vendorResult.usedUrl);
          }
          console.log(`[VendorReadRouter] REST API success (fromVendor: true)`);
          const result: {
            refs: VendorRef[];
            fromVendor: boolean;
            source: RefDiscoverySource;
            defaultBranch?: string;
          } = {
            refs: vendorResult.result.refs.filter((ref) => isDisplayableGitRef(ref)),
            fromVendor: true,
            defaultBranch: vendorResult.result.defaultBranch,
            source: {
              kind: "provider-rest",
              label: "Provider REST API",
              operation: "listRefs",
              remoteUrl: vendorResult.usedUrl || vendorUrls[0],
              attemptedUrls: vendorResult.attempts.map((attempt) => attempt.url),
              defaultBranch: vendorResult.result.defaultBranch,
              fallbackReason: naturalAttempted ? "git-natural-failed" : undefined,
              elapsedMs: Math.max(0, Date.now() - startedAt),
              details: "Ref list comes from the remote provider API.",
            },
          };
          this.runGitNaturalShadow({
            operation: "listRefs",
            remotes,
            ref: vendorResult.result.defaultBranch,
            baseline: result,
            readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
              const natural = await params.workerManager.gitNaturalListRefs({
                ...this.naturalRequestBase(remoteUrl),
                symrefs: true,
              });
              return this.naturalListRefsToVendor(natural, attemptedUrls, shadowStartedAt);
            },
            matches: (natural, baseline) => this.refsMatch(natural, baseline),
            summarize: (value) => this.summarizeRefsResult(value),
          });
          return result;
        }

        console.warn(`[VendorReadRouter] REST API failed, falling back to git`);
        console.warn(
          `[VendorReadRouter] All ${vendorResult.attempts.length} vendor URL(s) failed for listRefs`
        );
        for (const attempt of vendorResult.attempts) {
          if (!attempt.success) {
            const status = this.extractHttpStatus(attempt.error);
            this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
          }
        }
      }
    }

    // 3) Git remote advertised refs fallback
    if (remotes.length > 0) {
      console.log(`[VendorReadRouter] Using git advertised refs fallback`);
      const gitResult = await withUrlFallback(
        remotes,
        async (remoteUrl: string) => {
          const refs = await params.workerManager.listServerRefs({
            url: remoteUrl,
            symrefs: true,
          });
          return this.parseServerRefs(refs || []);
        },
        { repoId: this.pickRemote(params.cloneUrls) || undefined }
      );

      if (gitResult.success && gitResult.result) {
        if (gitResult.usedUrl) {
          this.reportCloneUrlSuccess(gitResult.usedUrl);
        }

        const result: {
          refs: VendorRef[];
          fromVendor: boolean;
          source: RefDiscoverySource;
          defaultBranch?: string;
        } = {
          refs: gitResult.result.refs,
          fromVendor: false,
          defaultBranch: gitResult.result.defaultBranch,
          source: {
            kind: "git-remote",
            label: "Git remote",
            operation: "listRefs",
            remoteUrl: gitResult.usedUrl || remotes[0],
            attemptedUrls: gitResult.attempts.map((attempt) => attempt.url),
            ref: gitResult.result.defaultBranch,
            defaultBranch: gitResult.result.defaultBranch,
            fallbackReason: naturalAttempted
              ? providerReadAttempted
                ? "git-natural-and-provider-rest-failed"
                : "git-natural-failed"
              : undefined,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            details: "Ref list comes from advertised refs on the git remote.",
          },
        };
        this.runGitNaturalShadow({
          operation: "listRefs",
          remotes,
          ref: gitResult.result.defaultBranch,
          baseline: result,
          readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
            const natural = await params.workerManager.gitNaturalListRefs({
              ...this.naturalRequestBase(remoteUrl),
              symrefs: true,
            });
            return this.naturalListRefsToVendor(natural, attemptedUrls, shadowStartedAt);
          },
          matches: (natural, baseline) => this.refsMatch(natural, baseline),
          summarize: (value) => this.summarizeRefsResult(value),
        });
        return result;
      }

      for (const attempt of gitResult.attempts) {
        if (!attempt.success) {
          const status = this.extractHttpStatus(attempt.error);
          this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
        }
      }
    }

    // 4) Local clone fallback
    console.log(`[VendorReadRouter] Falling back to locally known refs`);
    const branches = await params.workerManager.listBranchesFromEvent({
      repoEvent: params.repoEvent,
    });

    const refs: VendorRef[] = (branches || [])
      .map((b: any) => {
        const name = typeof b === "string" ? b : String(b?.name ?? "");
        return {
          name,
          type: "heads" as const,
          fullRef: `refs/heads/${name}`,
          commitId: String((b as any)?.commitId ?? (b as any)?.oid ?? ""),
        };
      })
      .filter((ref: VendorRef) => isDisplayableGitRef(ref));

    const result: {
      refs: VendorRef[];
      fromVendor: boolean;
      source: RefDiscoverySource;
      defaultBranch?: string;
    } = {
      refs,
      fromVendor: false,
      source: {
        kind: "local",
        label: "Local clone",
        operation: "listRefs",
        attemptedUrls: remotes,
        fallbackReason: naturalAttempted
          ? providerReadAttempted
            ? "git-natural-provider-rest-and-remote-ref-discovery-failed"
            : "git-natural-and-remote-ref-discovery-failed"
          : "remote-ref-discovery-failed",
        elapsedMs: Math.max(0, Date.now() - startedAt),
        details: "Remote ref discovery failed, so only locally known refs are shown.",
      },
    };
    this.runGitNaturalShadow({
      operation: "listRefs",
      remotes,
      baseline: result,
      readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
        const natural = await params.workerManager.gitNaturalListRefs({
          ...this.naturalRequestBase(remoteUrl),
          symrefs: true,
        });
        return this.naturalListRefsToVendor(natural, attemptedUrls, shadowStartedAt);
      },
      matches: (natural, baseline) => this.refsMatch(natural, baseline),
      summarize: (value) => this.summarizeRefsResult(value),
    });
    return result;
  }

  private parseServerRefs(
    refs: Array<{
      ref?: string;
      oid?: string;
      target?: string;
      symref?: string;
      symrefTarget?: string;
    }>
  ): VendorRefResult {
    const merged = new Map<string, VendorRef>();
    let defaultBranch: string | undefined;

    for (const ref of refs || []) {
      const fullRef = String(ref?.ref || "");
      if (fullRef === "HEAD") {
        const target = String(ref?.target || ref?.symref || ref?.symrefTarget || "");
        if (target.startsWith("refs/heads/")) {
          defaultBranch = normalizeGitRefName(target);
        }
        continue;
      }

      const commitId = String(ref?.oid || "");
      if (!fullRef || !commitId) continue;

      if (fullRef.startsWith("refs/heads/")) {
        const name = fullRef.slice("refs/heads/".length);
        const nextRef: VendorRef = { name, type: "heads", fullRef, commitId };
        if (isDisplayableGitRef(nextRef)) {
          merged.set(`heads:${name}`, nextRef);
        }
      } else if (fullRef.startsWith("refs/tags/")) {
        const name = fullRef.slice("refs/tags/".length);
        const nextRef: VendorRef = { name, type: "tags", fullRef, commitId };
        if (isDisplayableGitRef(nextRef)) {
          merged.set(`tags:${name}`, nextRef);
        }
      }
    }

    return {
      refs: Array.from(merged.values()).sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "heads" ? -1 : 1
      ),
      defaultBranch,
    };
  }

  /**
   * List commits from a branch using vendor REST API first, then fall back to git worker.
   * This is the main entry point for commit history that prefers REST API for performance.
   */
  async listCommits(params: {
    workerManager: WorkerManager;
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    cloneUrls: string[];
    branch: string;
    depth?: number;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const branch = params.branch || "main";
    const remotes = this.getValidRemotes(params.cloneUrls);
    const depth = params.depth || 30;
    const page = params.page || 1;
    const perPage = params.perPage || 30;
    let pendingVendorFailures: Array<{ url: string; error?: string }> = [];
    const startedAt = Date.now();
    let naturalAttempted = false;
    let providerReadAttempted = false;
    let pendingNaturalFailures: ReadFailureSummary[] = [];

    // 1) Optional Git natural fast path.
    if (this.shouldTryGitNaturalReads()) {
      const naturalUrls = this.getNaturalReadUrls(remotes);
      if (naturalUrls.length > 0) {
        naturalAttempted = true;
        console.log(`[VendorReadRouter] Trying Git natural for listCommits...`);
        const naturalResult = await withUrlFallback(
          naturalUrls,
          async (remoteUrl: string) => {
            return await params.workerManager.gitNaturalListCommits({
              ...this.naturalRequestBase(remoteUrl),
              ref: branch,
              depth,
            });
          },
          { repoId: params.repoKey, perUrlTimeoutMs: 15_000 }
        );

        if (naturalResult.success && naturalResult.result) {
          if (naturalResult.usedUrl) {
            this.reportCloneUrlSuccess(naturalResult.usedUrl);
          }
          console.log(`[VendorReadRouter] Git natural success`);
          return this.naturalListCommitsToVendor(
            naturalResult.result,
            naturalResult.attempts.map((attempt) => attempt.url),
            startedAt,
            depth
          );
        }

        pendingNaturalFailures = this.logGitNaturalFallback("listCommits", naturalResult.attempts);
      }
    }

    // 2) Vendor fast path only for the selected remote policy.
    if (this.preferVendorReads && remotes.length > 0) {
      const vendorUrls = this.getPolicyVendorUrls(remotes);

      if (vendorUrls.length > 0) {
        providerReadAttempted = true;
        console.log(`[VendorReadRouter] Trying REST API for listCommits...`);
        const vendorResult = await withUrlFallback(
          vendorUrls,
          async (remoteUrl: string) => {
            const vendor = this.getSupportedVendor(remoteUrl)!;
            return await this.vendorListCommits({
              vendor,
              remoteUrl,
              branch,
              page,
              perPage,
            });
          },
          { repoId: params.repoKey }
        );

        if (vendorResult.success && vendorResult.result) {
          if (vendorResult.usedUrl) {
            this.reportCloneUrlSuccess(vendorResult.usedUrl);
          }
          console.log(`[VendorReadRouter] REST API success (fromVendor: true)`);
          const result = {
            ...vendorResult.result,
            fromVendor: true,
            source: this.readSource({
              kind: "provider-rest",
              label: "Provider REST API",
              operation: "listCommits",
              remoteUrl: vendorResult.usedUrl || vendorUrls[0],
              attemptedUrls: vendorResult.attempts.map((attempt) => attempt.url),
              ref: normalizeGitRefName(branch),
              fallbackReason: naturalAttempted ? "git-natural-failed" : undefined,
              startedAt,
              details: "Commit history comes from the remote provider REST API.",
            }),
          };
          this.runGitNaturalShadow({
            operation: "listCommits",
            remotes,
            repoKey: params.repoKey,
            ref: normalizeGitRefName(branch),
            baseline: result,
            readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
              const natural = await params.workerManager.gitNaturalListCommits({
                ...this.naturalRequestBase(remoteUrl),
                ref: branch,
                depth,
              });
              return this.naturalListCommitsToVendor(natural, attemptedUrls, shadowStartedAt, depth);
            },
            matches: (natural, baseline) => this.commitsMatch(natural, baseline),
            summarize: (value) => this.summarizeCommitResult(value),
          });
          return result;
        }

        console.warn(`[VendorReadRouter] REST API failed, falling back to git`);
        console.warn(
          `[VendorReadRouter] All ${vendorResult.attempts.length} vendor URL(s) failed for listCommits`
        );
        pendingVendorFailures = vendorResult.attempts
          .filter((attempt) => !attempt.success)
          .map((attempt) => ({
            url: attempt.url,
            error: attempt.error || "Unknown error",
          }));
      }
    }

    // 3) Git worker fallback
    console.log(`[VendorReadRouter] Using git worker fallback`);
    let commitsResult: any;

    try {
      commitsResult = await params.workerManager.getCommitHistory({
        repoId: params.repoKey || "",
        branch,
        depth,
      });
    } catch (error) {
      if (
        pendingVendorFailures.some((attempt) => this.isBenignEmptyRepoCommitError(attempt.error))
      ) {
        const result = {
          commits: [],
          ref: normalizeGitRefName(branch),
          fromVendor: false,
          hasMore: false,
          source: this.readSource({
            kind: "worker-clone",
            label: "Worker clone fallback",
            operation: "listCommits",
            attemptedUrls: remotes,
            ref: normalizeGitRefName(branch),
            fallbackReason: naturalAttempted
              ? "git-natural-and-provider-rest-empty-repo"
              : "provider-rest-empty-repo",
            startedAt,
            details: "Commit history fallback treated a provider empty-repo response as empty history.",
          }),
        };
        this.runGitNaturalShadow({
          operation: "listCommits",
          remotes,
          repoKey: params.repoKey,
          ref: normalizeGitRefName(branch),
          baseline: result,
          readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
            const natural = await params.workerManager.gitNaturalListCommits({
              ...this.naturalRequestBase(remoteUrl),
              ref: branch,
              depth,
            });
            return this.naturalListCommitsToVendor(natural, attemptedUrls, shadowStartedAt, depth);
          },
          matches: (natural, baseline) => this.commitsMatch(natural, baseline),
          summarize: (value) => this.summarizeCommitResult(value),
        });
        return result;
      }

      for (const attempt of pendingVendorFailures) {
        const status = this.extractHttpStatus(attempt.error);
        this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
      }
      if (pendingNaturalFailures.length > 0) {
        this.reportGitNaturalFailures(pendingNaturalFailures);
      }
      const err = error instanceof Error ? error : new Error(String(error));
      err.message = `${err.message}${this.formatFailureContext(
        "after Git natural read failed",
        pendingNaturalFailures
      )}`;
      throw err;
    }

    if (commitsResult?.success === false) {
      if (
        pendingVendorFailures.some((attempt) => this.isBenignEmptyRepoCommitError(attempt.error))
      ) {
        const result = {
          commits: [],
          ref: normalizeGitRefName(branch),
          fromVendor: false,
          hasMore: false,
          source: this.readSource({
            kind: "worker-clone",
            label: "Worker clone fallback",
            operation: "listCommits",
            attemptedUrls: remotes,
            ref: normalizeGitRefName(branch),
            fallbackReason: naturalAttempted
              ? "git-natural-and-provider-rest-empty-repo"
              : "provider-rest-empty-repo",
            startedAt,
            details: "Commit history fallback treated a provider empty-repo response as empty history.",
          }),
        };
        this.runGitNaturalShadow({
          operation: "listCommits",
          remotes,
          repoKey: params.repoKey,
          ref: normalizeGitRefName(branch),
          baseline: result,
          readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
            const natural = await params.workerManager.gitNaturalListCommits({
              ...this.naturalRequestBase(remoteUrl),
              ref: branch,
              depth,
            });
            return this.naturalListCommitsToVendor(natural, attemptedUrls, shadowStartedAt, depth);
          },
          matches: (natural, baseline) => this.commitsMatch(natural, baseline),
          summarize: (value) => this.summarizeCommitResult(value),
        });
        return result;
      }

      for (const attempt of pendingVendorFailures.filter(
        (entry) => !this.isBenignEmptyRepoCommitError(entry.error)
      )) {
        const status = this.extractHttpStatus(attempt.error);
        this.reportCloneUrlError(attempt.url, attempt.error || "Unknown error", status);
      }
      if (pendingNaturalFailures.length > 0) {
        this.reportGitNaturalFailures(pendingNaturalFailures);
      }

      const naturalContext = this.formatFailureContext(
        "after Git natural read failed",
        pendingNaturalFailures
      );
      const vendorContext = pendingVendorFailures.length
        ? ` after vendor REST failed: ${pendingVendorFailures
            .map((attempt) => `${attempt.url}: ${attempt.error || "Unknown error"}`)
            .join(" | ")}`
        : "";
      throw createUnknownError(
        `${commitsResult.error || "Git worker commit history fallback failed"}${naturalContext}${vendorContext}`
      );
    }

    const commits: VendorCommit[] = (commitsResult.commits || []).map((c: any) => ({
      sha: c.oid || c.sha || "",
      message: c.commit?.message || c.message || "",
      author: {
        name: c.commit?.author?.name || c.author?.name || "",
        email: c.commit?.author?.email || c.author?.email || "",
        date: c.commit?.author?.timestamp
          ? new Date(c.commit.author.timestamp * 1000).toISOString()
          : c.author?.date || "",
      },
      committer: {
        name: c.commit?.committer?.name || c.committer?.name || "",
        email: c.commit?.committer?.email || c.committer?.email || "",
        date: c.commit?.committer?.timestamp
          ? new Date(c.commit.committer.timestamp * 1000).toISOString()
          : c.committer?.date || "",
      },
      parents: (c.commit?.parent || c.parents || []).map((p: any) =>
        typeof p === "string" ? { sha: p } : { sha: p.sha || p.oid || "" }
      ),
    }));

    const result = {
      commits,
      ref: normalizeGitRefName(branch),
      fromVendor: false,
      hasMore: commits.length >= depth,
      source: this.readSource({
        kind: "worker-clone",
        label: "Worker clone fallback",
        operation: "listCommits",
        attemptedUrls: remotes,
        ref: normalizeGitRefName(branch),
        fallbackReason: naturalAttempted
          ? providerReadAttempted
            ? "git-natural-and-provider-rest-failed"
            : "git-natural-failed"
          : pendingVendorFailures.length
            ? "provider-rest-failed"
            : "provider-rest-unavailable",
        startedAt,
        details: "Commit history comes from the worker-backed local git fallback.",
      }),
    };
    this.runGitNaturalShadow({
      operation: "listCommits",
      remotes,
      repoKey: params.repoKey,
      ref: normalizeGitRefName(branch),
      baseline: result,
      readNatural: async (remoteUrl, attemptedUrls, shadowStartedAt) => {
        const natural = await params.workerManager.gitNaturalListCommits({
          ...this.naturalRequestBase(remoteUrl),
          ref: branch,
          depth,
        });
        return this.naturalListCommitsToVendor(natural, attemptedUrls, shadowStartedAt, depth);
      },
      matches: (natural, baseline) => this.commitsMatch(natural, baseline),
      summarize: (value) => this.summarizeCommitResult(value),
    });
    return result;
  }

  // -------------------------
  // Vendor implementations
  // -------------------------

  private getSupportedVendor(remoteUrl: string): SupportedVendor | null {
    try {
      const v = detectVendorFromUrl(remoteUrl) as any;
      if (v === "github") return "github";
      if (v === "gitlab") return "gitlab";
      if (v === "gitea") return "gitea";
      if (v === "bitbucket") return "bitbucket";
      if (v === "grasp-rest") return ENABLE_GRASP_REST_READS ? "grasp-rest" : null;
      return null;
    } catch {
      return null;
    }
  }

  private getPolicyVendorUrls(remotes: string[]): string[] {
    if (!this.preferVendorReads) return [];
    const selectedRemote = remotes[0];
    if (!selectedRemote) return [];

    const vendor = this.getSupportedVendor(selectedRemote);
    if (!vendor) return [];

    console.log(`[VendorReadRouter] Detected selected vendor: ${vendor} for URL: ${selectedRemote}`);
    return [selectedRemote];
  }

  /**
   * Check if any of the provided clone URLs have vendor API support.
   * This can be used to skip slow git operations when vendor API is available.
   */
  hasVendorSupport(cloneUrls: string[]): boolean {
    if (!this.preferVendorReads) return false;
    const remotes = this.getValidRemotes(cloneUrls);
    return this.getPolicyVendorUrls(remotes).length > 0;
  }

  /**
   * Get commit count for a branch. Tries vendor API first, falls back to git worker.
   * Returns an estimate when using vendor API (exact count not available without cloning).
   * Never throws - returns { success: false } on error.
   */
  async getCommitCount(params: {
    workerManager: WorkerManager;
    repoEvent: RepoAnnouncementEvent;
    repoKey?: string;
    cloneUrls: string[];
    branch: string;
  }): Promise<{
    success: boolean;
    count?: number;
    isEstimate?: boolean;
    fromVendor?: boolean;
    error?: string;
  }> {
    const branch = params.branch || "main";
    const remotes = this.getValidRemotes(params.cloneUrls);

    // 1) Check if vendor API is available
    if (this.preferVendorReads && remotes.length > 0) {
      const vendorUrls = this.getPolicyVendorUrls(remotes);

      if (vendorUrls.length > 0) {
        // For vendor APIs, we can't get exact count without pagination
        // Return a flag indicating this is an estimate based on loaded commits
        // The caller should use the commits they've already loaded as the count
        console.log(
          `[VendorReadRouter] getCommitCount: vendor API available, returning estimate flag`
        );
        return {
          success: true,
          isEstimate: true,
          fromVendor: true,
        };
      }
    }

    // 2) Git worker fallback - only if repo is cloned
    try {
      const countResult = await params.workerManager.getCommitCount({
        repoId: params.repoKey || "",
        branch,
      });

      if (countResult.success) {
        return {
          success: true,
          count: countResult.count,
          isEstimate: false,
          fromVendor: false,
        };
      }

      return {
        success: false,
        error: countResult.error || "Failed to get commit count from git",
      };
    } catch (err) {
      // Don't throw - return graceful failure
      console.warn(`[VendorReadRouter] getCommitCount git fallback failed:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async vendorListDirectory(params: {
    vendor: SupportedVendor;
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorDirectoryResult> {
    const { vendor, remoteUrl, branch, path } = params;
    switch (vendor) {
      case "github":
      case "gitea":
        return this.vendorListDirectoryGitHubLike({ vendor, remoteUrl, branch, path });
      case "gitlab":
        return this.vendorListDirectoryGitLab({ vendor, remoteUrl, branch, path });
      case "bitbucket":
        return this.vendorListDirectoryBitbucket({ vendor, remoteUrl, branch, path });
      case "grasp-rest":
        return this.vendorListDirectoryGraspRest({ remoteUrl, branch, path });
      default:
        throw createUnknownError(`Unsupported vendor: ${vendor}`);
    }
  }

  private async vendorGetFileContent(params: {
    vendor: SupportedVendor;
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const { vendor, remoteUrl, branch, path } = params;
    switch (vendor) {
      case "github":
      case "gitea":
        return this.vendorGetFileContentGitHubLike({ vendor, remoteUrl, branch, path });
      case "gitlab":
        return this.vendorGetFileContentGitLab({ vendor, remoteUrl, branch, path });
      case "bitbucket":
        return this.vendorGetFileContentBitbucket({ vendor, remoteUrl, branch, path });
      case "grasp-rest":
        return this.vendorGetFileContentGraspRest({ remoteUrl, branch, path });
      default:
        throw createUnknownError(`Unsupported vendor: ${vendor}`);
    }
  }

  private async vendorListRefs(params: {
    vendor: SupportedVendor;
    remoteUrl: string;
  }): Promise<VendorRefResult> {
    switch (params.vendor) {
      case "github":
        return this.vendorListRefsGitHub(params.remoteUrl);
      case "gitlab":
        return this.vendorListRefsGitLab(params.remoteUrl);
      case "gitea":
        return this.vendorListRefsGitea(params.remoteUrl);
      case "bitbucket":
        return this.vendorListRefsBitbucket(params.remoteUrl);
      case "grasp-rest":
        return this.vendorListRefsGraspRest(params.remoteUrl);
    }
  }

  private async vendorListCommits(params: {
    vendor: SupportedVendor;
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    switch (params.vendor) {
      case "github":
        return this.vendorListCommitsGitHub(params);
      case "gitea":
        return this.vendorListCommitsGitea(params);
      case "gitlab":
        return this.vendorListCommitsGitLab(params);
      case "bitbucket":
        return this.vendorListCommitsBitbucket(params);
      case "grasp-rest":
        return this.vendorListCommitsGraspRest(params);
      default:
        throw createUnknownError(`Unsupported vendor: ${params.vendor}`);
    }
  }

  // -------------------------
  // GitHub-like (GitHub/Gitea) vendor support
  // -------------------------

  private async vendorListDirectoryGitHubLike(params: {
    vendor: "github" | "gitea";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorDirectoryResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase(params.vendor, host);

    const cleanPath = this.normalizeRepoPath(params.path);
    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/contents/${encodeURIComponent(cleanPath)}?ref=${encodeURIComponent(params.branch)}`;

    const ctx = this.ctx({
      op: "listDirectory",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: params.vendor,
      ctx,
    });

    // GitHub-style API returns array for directory, object for file
    if (Array.isArray(json)) {
      const files: VendorFileInfo[] = json.map((item: any) => ({
        path: item.path || item.name || "",
        type: item.type === "dir" ? "directory" : "file",
        size: item.size,
        oid: item.sha,
      }));
      return {
        files,
        path: params.path || "/",
        ref: normalizeGitRefName(params.branch),
        fromVendor: true,
      };
    }

    if (json && typeof json === "object") {
      // If the path points to a file, surface as a singleton entry (still a successful vendor response)
      const item = json as any;
      const files: VendorFileInfo[] = [
        {
          path: item.path || item.name || params.path,
          type: item.type === "dir" ? "directory" : "file",
          size: item.size,
          oid: item.sha,
        },
      ];
      return {
        files,
        path: params.path || "/",
        ref: normalizeGitRefName(params.branch),
        fromVendor: true,
      };
    }

    throw createUnknownError(`Unexpected vendor directory response.${ctx}`);
  }

  private async vendorGetFileContentGitHubLike(params: {
    vendor: "github" | "gitea";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase(params.vendor, host);
    const cleanPath = this.normalizeRepoPath(params.path);

    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/contents/${encodeURIComponent(cleanPath)}?ref=${encodeURIComponent(params.branch)}`;

    const ctx = this.ctx({
      op: "getFileContent",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: params.vendor,
      ctx,
    });

    if (!json || typeof json !== "object") {
      throw createUnknownError(`Unexpected vendor file response.${ctx}`);
    }

    const obj: any = json;
    if (obj.type && obj.type !== "file") {
      throw createFsError(`Expected a file but got type='${String(obj.type)}'.${ctx}`);
    }

    const encoding = String(obj.encoding || "");
    const contentField = obj.content;

    if (encoding === "base64" && typeof contentField === "string") {
      const decoded = this.decodeBase64ToUtf8(contentField);
      return {
        content: decoded,
        path: params.path,
        ref: normalizeGitRefName(params.branch),
        encoding: "utf-8",
        size: decoded.length,
        fromVendor: true,
      };
    }

    // Some providers may return raw content directly
    if (typeof contentField === "string") {
      return {
        content: contentField,
        path: params.path,
        ref: normalizeGitRefName(params.branch),
        encoding: "utf-8",
        size: contentField.length,
        fromVendor: true,
      };
    }

    throw createUnknownError(`Vendor did not return file content.${ctx}`);
  }

  private async vendorListRefsGitHub(remoteUrl: string): Promise<VendorRefResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(remoteUrl);
    const apiBase = this.getApiBase("github", host);
    const ctx = this.ctx({ op: "listRefs", remote: remoteUrl });

    const pageSize = 100;
    const maxPages = 50;

    const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
      const allItems: any[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const separator = baseUrl.includes("?") ? "&" : "?";
        const url = `${baseUrl}${separator}page=${page}&per_page=${pageSize}`;
        const json = await this.fetchJsonWithOptionalTokenRetry({
          host,
          url,
          vendor: "github",
          ctx,
        });

        if (!Array.isArray(json)) break;
        allItems.push(...json);
        if (json.length < pageSize) break;
      }
      return allItems;
    };

    const [repoJson, branchesJson, tagsJson] = await Promise.all([
      this.fetchJsonWithOptionalTokenRetry({
        host,
        url: `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        vendor: "github",
        ctx,
      }),
      fetchAllPages(
        `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
      ),
      fetchAllPages(
        `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`
      ),
    ]);

    const out: VendorRef[] = [];
    if (Array.isArray(branchesJson)) {
      for (const b of branchesJson) {
        const name = String((b as any)?.name || "");
        const commitId = String((b as any)?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "heads", fullRef: `refs/heads/${name}`, commitId });
      }
    }
    if (Array.isArray(tagsJson)) {
      for (const t of tagsJson) {
        const name = String((t as any)?.name || "");
        const commitId = String((t as any)?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "tags", fullRef: `refs/tags/${name}`, commitId });
      }
    }
    return {
      refs: out,
      defaultBranch: normalizeGitRefName((repoJson as any)?.default_branch) || undefined,
    };
  }

  private async vendorListRefsGitea(remoteUrl: string): Promise<VendorRefResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(remoteUrl);
    const apiBase = this.getApiBase("gitea", host);
    const ctx = this.ctx({ op: "listRefs", remote: remoteUrl });

    const pageSize = 100;
    const maxPages = 50;

    const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
      const allItems: any[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const separator = baseUrl.includes("?") ? "&" : "?";
        const url = `${baseUrl}${separator}page=${page}&limit=${pageSize}`;
        const json = await this.fetchJsonWithOptionalTokenRetry({
          host,
          url,
          vendor: "gitea",
          ctx,
        });
        if (!Array.isArray(json)) break;
        allItems.push(...json);
        if (json.length < pageSize) break;
      }
      return allItems;
    };

    const [repoJson, branchesJson, tagsJson] = await Promise.all([
      this.fetchJsonWithOptionalTokenRetry({
        host,
        url: `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        vendor: "gitea",
        ctx,
      }),
      fetchAllPages(
        `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
      ),
      fetchAllPages(
        `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`
      ),
    ]);

    const out: VendorRef[] = [];
    if (Array.isArray(branchesJson)) {
      for (const b of branchesJson) {
        const name = String((b as any)?.name || "");
        const commitId = String((b as any)?.commit?.id || (b as any)?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "heads", fullRef: `refs/heads/${name}`, commitId });
      }
    }
    if (Array.isArray(tagsJson)) {
      for (const t of tagsJson) {
        const name = String((t as any)?.name || "");
        const commitId = String((t as any)?.id || (t as any)?.commit?.id || "");
        if (!name) continue;
        out.push({ name, type: "tags", fullRef: `refs/tags/${name}`, commitId });
      }
    }
    return {
      refs: out,
      defaultBranch: normalizeGitRefName((repoJson as any)?.default_branch) || undefined,
    };
  }

  // -------------------------
  // GitLab vendor support
  // -------------------------

  private async vendorListDirectoryGitLab(params: {
    vendor: "gitlab";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorDirectoryResult> {
    const parsed = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const host = parsed.host;
    const projectPath = `${parsed.owner}/${parsed.repo}`; // owner may contain slashes for groups/subgroups
    const projectId = encodeURIComponent(projectPath);

    const apiBase = this.getApiBase("gitlab", host);
    const cleanPath = this.normalizeRepoPath(params.path);
    const url = `${apiBase}/projects/${projectId}/repository/tree?ref=${encodeURIComponent(
      params.branch
    )}&path=${encodeURIComponent(cleanPath)}&per_page=100`;

    const ctx = this.ctx({
      op: "listDirectory",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "gitlab",
      ctx,
    });

    if (!Array.isArray(json)) {
      throw createUnknownError(`Unexpected GitLab tree response.${ctx}`);
    }

    const files: VendorFileInfo[] = json.map((item: any) => ({
      path: item.path || item.name || "",
      type: item.type === "tree" ? "directory" : "file",
      oid: item.id,
    }));

    return {
      files,
      path: params.path || "/",
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
    };
  }

  private async vendorGetFileContentGitLab(params: {
    vendor: "gitlab";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const parsed = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const host = parsed.host;
    const projectPath = `${parsed.owner}/${parsed.repo}`;
    const projectId = encodeURIComponent(projectPath);
    const apiBase = this.getApiBase("gitlab", host);

    // Prefer raw endpoint to avoid base64 decoding
    const filePath = this.normalizeRepoPath(params.path);
    const url = `${apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(
      filePath
    )}/raw?ref=${encodeURIComponent(params.branch)}`;

    const ctx = this.ctx({
      op: "getFileContent",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const content = await this.fetchTextWithOptionalTokenRetry({
      host,
      url,
      vendor: "gitlab",
      ctx,
    });

    return {
      content,
      path: params.path,
      ref: normalizeGitRefName(params.branch),
      encoding: "utf-8",
      size: content.length,
      fromVendor: true,
    };
  }

  private async vendorListRefsGitLab(remoteUrl: string): Promise<VendorRefResult> {
    const parsed = this.parseOwnerRepoFromCloneUrl(remoteUrl);
    const host = parsed.host;
    const projectPath = `${parsed.owner}/${parsed.repo}`;
    const projectId = encodeURIComponent(projectPath);
    const apiBase = this.getApiBase("gitlab", host);
    const ctx = this.ctx({ op: "listRefs", remote: remoteUrl });

    const pageSize = 100;
    const maxPages = 50;

    const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
      const allItems: any[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const separator = baseUrl.includes("?") ? "&" : "?";
        const url = `${baseUrl}${separator}page=${page}&per_page=${pageSize}`;
        const json = await this.fetchJsonWithOptionalTokenRetry({
          host,
          url,
          vendor: "gitlab",
          ctx,
        });
        if (!Array.isArray(json)) break;
        allItems.push(...json);
        if (json.length < pageSize) break;
      }
      return allItems;
    };

    const [projectJson, branchesJson, tagsJson] = await Promise.all([
      this.fetchJsonWithOptionalTokenRetry({
        host,
        url: `${apiBase}/projects/${projectId}`,
        vendor: "gitlab",
        ctx,
      }),
      fetchAllPages(`${apiBase}/projects/${projectId}/repository/branches`),
      fetchAllPages(`${apiBase}/projects/${projectId}/repository/tags`),
    ]);

    const out: VendorRef[] = [];

    if (Array.isArray(branchesJson)) {
      for (const b of branchesJson) {
        const name = String((b as any)?.name || "");
        const commitId = String((b as any)?.commit?.id || (b as any)?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "heads", fullRef: `refs/heads/${name}`, commitId });
      }
    }

    if (Array.isArray(tagsJson)) {
      for (const t of tagsJson) {
        const name = String((t as any)?.name || "");
        const commitId = String((t as any)?.commit?.id || (t as any)?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "tags", fullRef: `refs/tags/${name}`, commitId });
      }
    }

    return {
      refs: out,
      defaultBranch: normalizeGitRefName((projectJson as any)?.default_branch) || undefined,
    };
  }

  // -------------------------
  // Bitbucket vendor support
  // -------------------------

  private async vendorListDirectoryBitbucket(params: {
    vendor: "bitbucket";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorDirectoryResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase("bitbucket", host);
    const cleanPath = this.normalizeRepoPath(params.path);

    // Bitbucket uses /src/{commit}/{path} for directory listing
    const url = `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/src/${encodeURIComponent(params.branch)}/${cleanPath ? encodeURIComponent(cleanPath) : ""}?pagelen=100`;

    const ctx = this.ctx({
      op: "listDirectory",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "bitbucket",
      ctx,
    });

    if (!json || typeof json !== "object") {
      throw createUnknownError(`Unexpected Bitbucket directory response.${ctx}`);
    }

    const values = (json as any).values || [];
    const files: VendorFileInfo[] = values.map((item: any) => ({
      path: item.path || "",
      type: item.type === "commit_directory" ? "directory" : "file",
      size: item.size,
      oid: item.commit?.hash,
    }));

    return {
      files,
      path: params.path || "/",
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
    };
  }

  private async vendorGetFileContentBitbucket(params: {
    vendor: "bitbucket";
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase("bitbucket", host);
    const filePath = this.normalizeRepoPath(params.path);

    // Bitbucket returns raw file content from /src endpoint
    const url = `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/src/${encodeURIComponent(params.branch)}/${encodeURIComponent(filePath)}`;

    const ctx = this.ctx({
      op: "getFileContent",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const content = await this.fetchTextWithOptionalTokenRetry({
      host,
      url,
      vendor: "bitbucket",
      ctx,
    });

    return {
      content,
      path: params.path,
      ref: normalizeGitRefName(params.branch),
      encoding: "utf-8",
      size: content.length,
      fromVendor: true,
    };
  }

  private async vendorListRefsBitbucket(remoteUrl: string): Promise<VendorRefResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(remoteUrl);
    const apiBase = this.getApiBase("bitbucket", host);
    const ctx = this.ctx({ op: "listRefs", remote: remoteUrl });

    const pageSize = 100;
    const maxPages = 50;

    const fetchAllPages = async (baseUrl: string): Promise<any[]> => {
      const allItems: any[] = [];
      let nextUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}pagelen=${pageSize}`;

      for (let page = 1; page <= maxPages && nextUrl; page++) {
        const json = await this.fetchJsonWithOptionalTokenRetry({
          host,
          url: nextUrl,
          vendor: "bitbucket",
          ctx,
        });

        const values = json && Array.isArray((json as any).values) ? (json as any).values : [];
        allItems.push(...values);
        nextUrl = typeof (json as any)?.next === "string" ? (json as any).next : "";
        if (!nextUrl) break;
      }

      return allItems;
    };

    const [repoJson, branchesValues, tagsValues] = await Promise.all([
      this.fetchJsonWithOptionalTokenRetry({
        host,
        url: `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        vendor: "bitbucket",
        ctx,
      }),
      fetchAllPages(
        `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/refs/branches`
      ),
      fetchAllPages(
        `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/refs/tags`
      ),
    ]);

    const out: VendorRef[] = [];

    if (Array.isArray(branchesValues)) {
      for (const b of branchesValues) {
        const name = String(b?.name || "");
        const commitId = String(b?.target?.hash || "");
        if (!name) continue;
        out.push({ name, type: "heads", fullRef: `refs/heads/${name}`, commitId });
      }
    }

    if (Array.isArray(tagsValues)) {
      for (const t of tagsValues) {
        const name = String(t?.name || "");
        const commitId = String(t?.target?.hash || "");
        if (!name) continue;
        out.push({ name, type: "tags", fullRef: `refs/tags/${name}`, commitId });
      }
    }

    return {
      refs: out,
      defaultBranch: normalizeGitRefName((repoJson as any)?.mainbranch?.name) || undefined,
    };
  }

  // -------------------------
  // GraspRest vendor support
  // -------------------------

  private async vendorListDirectoryGraspRest(params: {
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorDirectoryResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const ownerNpub = this.normalizeGraspOwner(owner);
    const apiBase = this.getApiBase("grasp-rest", host);
    const cleanPath = this.normalizeRepoPath(params.path);

    const url = `${apiBase}/repos/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(
      repo
    )}/tree/${encodeURIComponent(params.branch)}/${cleanPath ? encodeURIComponent(cleanPath) : ""}`;

    const ctx = this.ctx({
      op: "listDirectory",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "grasp-rest",
      ctx,
    });

    if (!json || typeof json !== "object") {
      throw createUnknownError(`Unexpected GraspRest directory response.${ctx}`);
    }

    const files: VendorFileInfo[] = json.map((item: any) => ({
      path: item.path || "",
      type: item.type === "tree" ? "directory" : "file",
      size: item.size,
      oid: item.sha,
    }));

    return {
      files,
      path: params.path || "/",
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
    };
  }

  private async vendorGetFileContentGraspRest(params: {
    remoteUrl: string;
    branch: string;
    path: string;
  }): Promise<VendorFileContentResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const ownerNpub = this.normalizeGraspOwner(owner);
    const apiBase = this.getApiBase("grasp-rest", host);
    const filePath = this.normalizeRepoPath(params.path);

    const url = `${apiBase}/repos/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(
      repo
    )}/blob/${encodeURIComponent(params.branch)}/${encodeURIComponent(filePath)}`;

    const ctx = this.ctx({
      op: "getFileContent",
      remote: params.remoteUrl,
      branch: params.branch,
      path: params.path,
    });

    const content = await this.fetchTextWithOptionalTokenRetry({
      host,
      url,
      vendor: "grasp-rest",
      ctx,
    });

    return {
      content,
      path: params.path,
      ref: normalizeGitRefName(params.branch),
      encoding: "utf-8",
      size: content.length,
      fromVendor: true,
    };
  }

  private async vendorListRefsGraspRest(remoteUrl: string): Promise<VendorRefResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(remoteUrl);
    const ownerNpub = this.normalizeGraspOwner(owner);
    const apiBase = this.getApiBase("grasp-rest", host);
    const ctx = this.ctx({ op: "listRefs", remote: remoteUrl });

    const branchesUrl = `${apiBase}/repos/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(
      repo
    )}/branches`;
    const tagsUrl = `${apiBase}/repos/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(repo)}/tags`;

    const [branchesJson, tagsJson] = await Promise.all([
      this.fetchJsonWithOptionalTokenRetry({ host, url: branchesUrl, vendor: "grasp-rest", ctx }),
      this.fetchJsonWithOptionalTokenRetry({ host, url: tagsUrl, vendor: "grasp-rest", ctx }),
    ]);

    const out: VendorRef[] = [];

    if (Array.isArray(branchesJson)) {
      for (const b of branchesJson) {
        const name = String(b?.name || "");
        const commitId = String(b?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "heads", fullRef: `refs/heads/${name}`, commitId });
      }
    }

    if (Array.isArray(tagsJson)) {
      for (const t of tagsJson) {
        const name = String(t?.name || "");
        const commitId = String(t?.commit?.sha || "");
        if (!name) continue;
        out.push({ name, type: "tags", fullRef: `refs/tags/${name}`, commitId });
      }
    }

    return { refs: out };
  }

  private async vendorListCommitsGraspRest(params: {
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const ownerNpub = this.normalizeGraspOwner(owner);
    const apiBase = this.getApiBase("grasp-rest", host);
    const page = params.page || 1;
    const perPage = params.perPage || 30;

    const url = `${apiBase}/repos/${encodeURIComponent(ownerNpub)}/${encodeURIComponent(
      repo
    )}/commits?sha=${encodeURIComponent(params.branch)}&page=${page}&per_page=${perPage}`;

    const ctx = this.ctx({
      op: "listCommits",
      remote: params.remoteUrl,
      branch: params.branch,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "grasp-rest",
      ctx,
    });

    if (!Array.isArray(json)) {
      throw createUnknownError(`Unexpected GraspRest commits response.${ctx}`);
    }

    const commits: VendorCommit[] = json.map((c: any) => ({
      sha: c.sha || "",
      message: c.commit?.message || "",
      author: {
        name: c.commit?.author?.name || "",
        email: c.commit?.author?.email || "",
        date: c.commit?.author?.date || "",
      },
      committer: {
        name: c.commit?.committer?.name || "",
        email: c.commit?.committer?.email || "",
        date: c.commit?.committer?.date || "",
      },
      parents: (c.parents || []).map((p: any) => ({ sha: p.sha || "" })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
      hasMore: commits.length === perPage,
    };
  }

  // -------------------------
  // Commit listing implementations
  // -------------------------

  private async vendorListCommitsGitHub(params: {
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase("github", host);
    const page = params.page || 1;
    const perPage = params.perPage || 30;

    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/commits?sha=${encodeURIComponent(params.branch)}&page=${page}&per_page=${perPage}`;

    const ctx = this.ctx({
      op: "listCommits",
      remote: params.remoteUrl,
      branch: params.branch,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "github",
      ctx,
    });

    if (!Array.isArray(json)) {
      throw createUnknownError(`Unexpected GitHub commits response.${ctx}`);
    }

    const commits: VendorCommit[] = json.map((c: any) => ({
      sha: c.sha || "",
      message: c.commit?.message || "",
      author: {
        name: c.commit?.author?.name || "",
        email: c.commit?.author?.email || "",
        date: c.commit?.author?.date || "",
      },
      committer: {
        name: c.commit?.committer?.name || "",
        email: c.commit?.committer?.email || "",
        date: c.commit?.committer?.date || "",
      },
      parents: (c.parents || []).map((p: any) => ({ sha: p.sha || "" })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
      hasMore: commits.length === perPage,
    };
  }

  private async vendorListCommitsGitea(params: {
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase("gitea", host);
    const page = params.page || 1;
    const perPage = params.perPage || 30;

    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/commits?sha=${encodeURIComponent(params.branch)}&page=${page}&limit=${perPage}`;

    const ctx = this.ctx({
      op: "listCommits",
      remote: params.remoteUrl,
      branch: params.branch,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "gitea",
      ctx,
    });

    if (!Array.isArray(json)) {
      throw createUnknownError(`Unexpected Gitea commits response.${ctx}`);
    }

    const commits: VendorCommit[] = json.map((c: any) => ({
      sha: c.sha || "",
      message: c.commit?.message || "",
      author: {
        name: c.commit?.author?.name || "",
        email: c.commit?.author?.email || "",
        date: c.commit?.author?.date || "",
      },
      committer: {
        name: c.commit?.committer?.name || "",
        email: c.commit?.committer?.email || "",
        date: c.commit?.committer?.date || "",
      },
      parents: (c.parents || []).map((p: any) => ({ sha: p.sha || "" })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
      hasMore: commits.length === perPage,
    };
  }

  private async vendorListCommitsGitLab(params: {
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const parsed = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const host = parsed.host;
    const projectPath = `${parsed.owner}/${parsed.repo}`;
    const projectId = encodeURIComponent(projectPath);
    const apiBase = this.getApiBase("gitlab", host);
    const page = params.page || 1;
    const perPage = params.perPage || 30;

    const url = `${apiBase}/projects/${projectId}/repository/commits?ref_name=${encodeURIComponent(
      params.branch
    )}&page=${page}&per_page=${perPage}`;

    const ctx = this.ctx({
      op: "listCommits",
      remote: params.remoteUrl,
      branch: params.branch,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "gitlab",
      ctx,
    });

    if (!Array.isArray(json)) {
      throw createUnknownError(`Unexpected GitLab commits response.${ctx}`);
    }

    const commits: VendorCommit[] = json.map((c: any) => ({
      sha: c.id || "",
      message: c.message || "",
      author: {
        name: c.author_name || "",
        email: c.author_email || "",
        date: c.authored_date || "",
      },
      committer: {
        name: c.committer_name || "",
        email: c.committer_email || "",
        date: c.committed_date || "",
      },
      parents: (c.parent_ids || []).map((pid: string) => ({ sha: pid })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
      hasMore: commits.length === perPage,
    };
  }

  private async vendorListCommitsBitbucket(params: {
    remoteUrl: string;
    branch: string;
    page?: number;
    perPage?: number;
  }): Promise<VendorCommitResult> {
    const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(params.remoteUrl);
    const apiBase = this.getApiBase("bitbucket", host);
    const perPage = params.perPage || 30;

    // Bitbucket uses include parameter for branch filtering
    const url = `${apiBase}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/commits?include=${encodeURIComponent(params.branch)}&pagelen=${perPage}`;

    const ctx = this.ctx({
      op: "listCommits",
      remote: params.remoteUrl,
      branch: params.branch,
    });

    const json = await this.fetchJsonWithOptionalTokenRetry({
      host,
      url,
      vendor: "bitbucket",
      ctx,
    });

    if (!json || typeof json !== "object") {
      throw createUnknownError(`Unexpected Bitbucket commits response.${ctx}`);
    }

    const values = (json as any).values || [];
    const commits: VendorCommit[] = values.map((c: any) => ({
      sha: c.hash || "",
      message: c.message || "",
      author: {
        name: c.author?.user?.display_name || c.author?.raw?.split("<")[0]?.trim() || "",
        email: c.author?.user?.email || c.author?.raw?.match(/<(.+)>/)?.[1] || "",
        date: c.date || "",
      },
      committer: {
        name: c.author?.user?.display_name || c.author?.raw?.split("<")[0]?.trim() || "",
        email: c.author?.user?.email || c.author?.raw?.match(/<(.+)>/)?.[1] || "",
        date: c.date || "",
      },
      parents: (c.parents || []).map((p: any) => ({ sha: p.hash || "" })),
    }));

    return {
      commits,
      ref: normalizeGitRefName(params.branch),
      fromVendor: true,
      hasMore: !!(json as any).next,
    };
  }

  // -------------------------
  // Fetch helpers + normalization
  // -------------------------

  /**
   * Get the first valid remote URL (for backward compatibility)
   */
  private pickRemote(cloneUrls: string[]): string | null {
    const validUrls = this.getValidRemotes(cloneUrls);
    return validUrls.length > 0 ? validUrls[0] : null;
  }

  /**
   * Get all valid remote URLs for fallback attempts
   */
  private getValidRemotes(cloneUrls: string[]): string[] {
    return filterValidCloneUrls(cloneUrls);
  }

  private ctx(parts: {
    op: string;
    remote?: string | null;
    branch?: string;
    path?: string;
  }): string {
    const tokens: string[] = [];
    tokens.push(`op=${parts.op}`);
    if (parts.remote) tokens.push(`remote=${parts.remote}`);
    if (parts.branch) tokens.push(`branch=${parts.branch}`);
    if (parts.path) tokens.push(`path=${parts.path}`);
    return tokens.length ? ` (${tokens.join(", ")})` : "";
  }

  private normalizeRepoPath(path: string): string {
    const p = String(path || "");
    if (!p) return "";
    return p.startsWith("/") ? p.slice(1) : p;
  }

  private getApiBase(vendor: SupportedVendor, host: string): string {
    const h = host.trim();
    if (vendor === "github") {
      // Special-case github.com to api.github.com; otherwise assume GH Enterprise at /api/v3
      if (h.toLowerCase() === "github.com") return "https://api.github.com";
      return `https://${h}/api/v3`;
    } else if (vendor === "gitlab") {
      return `https://${h}/api/v4`;
    } else if (vendor === "gitea") {
      return `https://${h}/api/v1`;
    } else if (vendor === "bitbucket") {
      // Special-case bitbucket.org to api.bitbucket.org; otherwise assume self-hosted
      if (h.toLowerCase() === "bitbucket.org") return "https://api.bitbucket.org/2.0";
      return `https://${h}/api/2.0`;
    } else if (vendor === "grasp-rest") {
      // For grasp-rest, convert ws(s):// to http(s)://
      if (h.startsWith("ws://")) {
        return h.replace("ws://", "http://");
      } else if (h.startsWith("wss://")) {
        return h.replace("wss://", "https://");
      }
      return `https://${h}`;
    }
    return `https://${h}`;
  }

  private parseOwnerRepoFromCloneUrl(url: string): { host: string; owner: string; repo: string } {
    // Supports:
    // - https://host/owner/repo.git
    // - http://host/owner/repo.git
    // - git@host:owner/repo.git
    // - ssh://git@host/owner/repo.git
    const raw = String(url || "").trim();

    // http(s)
    try {
      const u = new URL(raw);
      const host = u.hostname;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const repo = parts[parts.length - 1].replace(/\.git$/i, "");
        const owner = parts.slice(0, -1).join("/"); // support gitlab groups/subgroups
        return { host, owner, repo };
      }
    } catch {
      // fall through
    }

    // ssh (scp-like)
    const m = raw.match(/^git@([^:]+):(.+)$/);
    if (m) {
      const host = m[1];
      const path = m[2].replace(/^\//, "");
      const parts = path.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const repo = parts[parts.length - 1].replace(/\.git$/i, "");
        const owner = parts.slice(0, -1).join("/");
        return { host, owner, repo };
      }
    }

    // Generic fallback: try to find host and /owner/repo in string
    const g = raw.match(
      /^(?:https?:\/\/|ssh:\/\/git@)([^\/:]+)[\/:]([^\/]+)\/([^\/.]+)(?:\.git)?/i
    );
    if (g) {
      return { host: g[1], owner: g[2], repo: g[3] };
    }

    throw createUnknownError(`Unable to parse clone URL: ${raw}`);
  }

  private normalizeGraspOwner(owner: string): string {
    try {
      return owner.startsWith("npub1") ? owner : nip19.npubEncode(owner);
    } catch {
      return owner;
    }
  }

  private decodeBase64ToUtf8(base64: string): string {
    // GitHub-style content often includes newlines
    const b64 = String(base64 || "").replace(/\s+/g, "");
    let binary = "";
    if (typeof (globalThis as any).atob === "function") {
      binary = (globalThis as any).atob(b64);
    } else if (typeof (globalThis as any).Buffer !== "undefined") {
      const buf = (globalThis as any).Buffer.from(b64, "base64");
      binary = buf.toString("binary");
    } else {
      throw createUnknownError("No base64 decoder available in this environment");
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return decoder.decode(bytes);
  }

  private async fetchJsonWithOptionalTokenRetry(params: {
    host: string;
    url: string;
    vendor: SupportedVendor;
    ctx: string;
  }): Promise<any> {
    const tokens = await this.getTokens().catch(() => []);
    const matching = getTokensForHost(tokens, params.host);

    // If tokens exist for this host, retry across them; else attempt unauth for public repos
    if (matching.length > 0) {
      return await tryTokensForHost(tokens, params.host, async (token: string) => {
        return await this.fetchJson({
          url: params.url,
          vendor: params.vendor,
          token,
          ctx: params.ctx,
        });
      });
    }

    return await this.fetchJson({
      url: params.url,
      vendor: params.vendor,
      token: undefined,
      ctx: params.ctx,
    });
  }

  private async fetchTextWithOptionalTokenRetry(params: {
    host: string;
    url: string;
    vendor: SupportedVendor;
    ctx: string;
  }): Promise<string> {
    const tokens = await this.getTokens().catch(() => []);
    const matching = getTokensForHost(tokens, params.host);

    if (matching.length > 0) {
      return await tryTokensForHost(tokens, params.host, async (token: string) => {
        return await this.fetchText({
          url: params.url,
          vendor: params.vendor,
          token,
          ctx: params.ctx,
        });
      });
    }

    return await this.fetchText({
      url: params.url,
      vendor: params.vendor,
      token: undefined,
      ctx: params.ctx,
    });
  }

  private vendorHeaders(vendor: SupportedVendor, token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (!token) return headers;

    if (vendor === "github" || vendor === "gitea") {
      headers.Authorization = `token ${token}`;
    } else if (vendor === "gitlab") {
      headers.Authorization = `Bearer ${token}`;
    } else if (vendor === "bitbucket") {
      headers.Authorization = `Bearer ${token}`;
    } else if (vendor === "grasp-rest") {
      // grasp-rest uses bearer token for authentication
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  private async fetchJson(params: {
    url: string;
    vendor: SupportedVendor;
    token?: string;
    ctx: string;
  }): Promise<any> {
    const res = await this.fetchWithTimeout({
      url: params.url,
      headers: this.vendorHeaders(params.vendor, params.token),
      ctx: params.ctx,
    });
    const txt = await res.text();
    let json: any;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch (e) {
      const err = createUnknownError(`Invalid JSON response.${params.ctx}`);
      throw (wrapError as any)(e, err);
    }
    return json;
  }

  private async fetchText(params: {
    url: string;
    vendor: SupportedVendor;
    token?: string;
    ctx: string;
  }): Promise<string> {
    const res = await this.fetchWithTimeout({
      url: params.url,
      headers: this.vendorHeaders(params.vendor, params.token),
      ctx: params.ctx,
    });
    return await res.text();
  }

  private async fetchWithTimeout(params: {
    url: string;
    headers: Record<string, string>;
    timeoutMs?: number;
    ctx: string;
  }): Promise<Response> {
    const timeoutMs = params.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(params.url, {
        method: "GET",
        headers: params.headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw this.httpError(res.status, params.ctx);
      }

      return res;
    } catch (e: any) {
      // Abort -> timeout
      if (e && (e.name === "AbortError" || String(e.message || "").includes("abort"))) {
        const terr = createTimeoutError();
        terr.message = `Vendor request timed out after ${timeoutMs}ms.${params.ctx}`;
        throw (wrapError as any)(e, terr);
      }

      // If we already created a typed error via httpError, rethrow
      if (e instanceof Error) {
        const name = (e as any).name || "";
        if (name === "FatalError" || name === "RetriableError" || name === "UserActionableError") {
          throw e;
        }
      }

      // Fetch network failures typically throw TypeError
      const nerr = createNetworkError();
      nerr.message = `Vendor network error.${params.ctx}`;
      throw (wrapError as any)(e, nerr);
    } finally {
      clearTimeout(t);
    }
  }

  private httpError(status: number, ctx: string): Error {
    if (status === 401 || status === 403) {
      const aerr = createAuthRequiredError();
      aerr.message = `Vendor authentication required (HTTP ${status}).${ctx}`;
      return aerr;
    }
    if (status === 404) {
      return createFsError(`Not found (HTTP 404).${ctx}`);
    }
    if (status === 409 && ctx.includes("op=listCommits")) {
      return createFsError(`Repository is empty (HTTP 409).${ctx}`);
    }
    if (status === 429 || (status >= 500 && status <= 599)) {
      const nerr = createNetworkError();
      nerr.message = `Vendor service error (HTTP ${status}).${ctx}`;
      return nerr;
    }
    return createUnknownError(`Vendor request failed (HTTP ${status}).${ctx}`);
  }
}
