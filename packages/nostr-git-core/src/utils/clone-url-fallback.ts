/**
 * Clone URL fallback and multi-write utilities for handling repositories
 * with multiple clone URLs (NIP-34 support).
 *
 * Read Operations: Try URLs in order with fallback on failure
 * Write Operations: Write to ALL URLs and report individual results
 */

import { detectVendorFromUrl, isGitRemoteUrlEnabled } from '../git/vendor-providers.js';

export interface UrlAttemptResult<T = unknown> {
  url: string;
  success: boolean;
  result?: T;
  error?: string;
  errorCode?: string;
  status?: number;
  durationMs?: number;
}

export interface ReadFallbackResult<T = unknown> {
  success: boolean;
  result?: T;
  usedUrl?: string;
  attempts: UrlAttemptResult<T>[];
  /** Index of the URL that succeeded (for caching) */
  successIndex?: number;
}

export interface MultiWriteResult<T = unknown> {
  success: boolean;
  /** True if at least one write succeeded */
  partialSuccess: boolean;
  results: UrlAttemptResult<T>[];
  successCount: number;
  failureCount: number;
  /** Summary message for logging/display */
  summary: string;
}

export interface CloneUrlCacheEntry {
  preferredUrl: string;
  lastSuccessAt: number;
  failedUrls: string[];
  lastFailure?: string;
  updatedAt?: number;
}

/**
 * Custom error class for URL timeout errors.
 * Used to distinguish timeouts from other errors in fallback logic.
 */
export class UrlTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  readonly code = 'TIMEOUT';

  constructor(message: string, url: string, timeoutMs: number) {
    super(message);
    this.name = 'UrlTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class UrlCancellationUnconfirmedError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  readonly code = 'CANCELLATION_UNCONFIRMED';

  constructor(url: string, timeoutMs: number) {
    super(`Timed-out operation did not settle after abort for ${url}`);
    this.name = 'UrlCancellationUnconfirmedError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Simple in-memory cache for URL preferences.
 * Maps repoId -> preferred URL info.
 */
const urlPreferenceCache = new Map<string, CloneUrlCacheEntry>();
const READ_SCOPE_SEPARATOR = "\0";

function readPreferenceCacheKey(repoId: string, readScope?: string): string {
  return readScope ? `${repoId}${READ_SCOPE_SEPARATOR}${readScope}` : repoId;
}

/**
 * Get cached URL preference for a repo.
 */
export function getCachedUrlPreference(
  repoId: string,
  readScope?: string
): CloneUrlCacheEntry | undefined {
  return urlPreferenceCache.get(readPreferenceCacheKey(repoId, readScope));
}

/**
 * Update URL preference cache after a successful read.
 */
export function updateUrlPreferenceCache(
  repoId: string,
  successfulUrl: string,
  failedUrls: string[] = [],
  readScope?: string
): void {
  const cacheKey = readPreferenceCacheKey(repoId, readScope);
  const existing = urlPreferenceCache.get(cacheKey);
  urlPreferenceCache.set(cacheKey, {
    preferredUrl: successfulUrl,
    lastSuccessAt: Date.now(),
    failedUrls: Array.from(new Set([...(existing?.failedUrls || []), ...failedUrls])),
    updatedAt: Date.now(),
  });
}

/**
 * Advance the active read cursor after a URL-specific failure.
 * Read fallback only moves forward; declared/write URL ordering is unaffected.
 */
export function advanceReadUrlPreference(
  repoId: string,
  failedUrl: string,
  nextUrl: string | undefined,
  error?: string,
  declaredUrls?: string[],
  readScope?: string
): void {
  const cacheKey = readPreferenceCacheKey(repoId, readScope);
  const existing = urlPreferenceCache.get(cacheKey);
  if (existing && declaredUrls) {
    const currentIndex = declaredUrls.indexOf(existing.preferredUrl);
    const nextIndex = declaredUrls.indexOf(nextUrl || failedUrl);
    if (currentIndex >= 0 && nextIndex >= 0 && currentIndex > nextIndex) return;
  }
  urlPreferenceCache.set(cacheKey, {
    preferredUrl: nextUrl || failedUrl,
    lastSuccessAt: existing?.lastSuccessAt || 0,
    failedUrls: Array.from(new Set([...(existing?.failedUrls || []), failedUrl])),
    lastFailure: error,
    updatedAt: Date.now(),
  });
}

function recordReadUrlSuccess(
  repoId: string,
  successfulUrl: string,
  failedUrls: string[],
  declaredUrls: string[],
  readScope?: string
): void {
  const existing = getCachedUrlPreference(repoId, readScope);
  if (existing) {
    const currentIndex = declaredUrls.indexOf(existing.preferredUrl);
    const successIndex = declaredUrls.indexOf(successfulUrl);
    if (currentIndex >= 0 && successIndex >= 0 && currentIndex > successIndex) return;
  }
  updateUrlPreferenceCache(repoId, successfulUrl, failedUrls, readScope);
}

/**
 * Clear cached URL preference for a repo.
 */
export function clearUrlPreferenceCache(repoId?: string, readScope?: string): void {
  if (repoId) {
    if (readScope) {
      urlPreferenceCache.delete(readPreferenceCacheKey(repoId, readScope));
      return;
    }
    for (const key of urlPreferenceCache.keys()) {
      if (key === repoId || key.startsWith(`${repoId}${READ_SCOPE_SEPARATOR}`)) {
        urlPreferenceCache.delete(key);
      }
    }
  } else {
    urlPreferenceCache.clear();
  }
}

/**
 * Check if a URL points to a REST API-capable Git provider.
 * These providers (GitHub, GitLab, Gitea, Bitbucket) support faster metadata
 * fetching via REST API instead of full git clone.
 */
export function hasRestApiSupport(url: string): boolean {
  const vendor = detectVendorFromUrl(url);
  // These vendors have REST APIs that can be used for faster repo access
  return isGitRemoteUrlEnabled(url) && (
    vendor === 'github' || vendor === 'gitlab' || vendor === 'gitea' || vendor === 'bitbucket'
  );
}

/**
 * Sort URLs to prioritize REST API-capable providers.
 * Deprecated policy shim: clone URL order is the repository's declared remote policy.
 * API support may speed up a selected remote, but must not promote that remote ahead
 * of earlier clone URLs.
 */
export function sortUrlsByApiPriority(urls: string[]): string[] {
  return [...urls];
}

/**
 * Preserve the caller's clone URL order.
 *
 * Fallback success is cached for diagnostics, but it must not rewrite the
 * repository's declared primary remote policy on future reads.
 */
export function reorderUrlsByPreference(urls: string[], repoId?: string): string[] {
  void repoId;
  return [...urls];
}

/**
 * Order read URLs from the repository's active fallback cursor.
 *
 * Unlike reorderUrlsByPreference(), this is intentionally read-specific. Once
 * a repository advances to a fallback, later reads continue from that URL and
 * never wrap back to an earlier failed remote until the cache is reset.
 */
export function orderReadUrlsByPreference(
  urls: string[],
  repoId?: string,
  readScope?: string
): string[] {
  const ordered = [...urls];
  if (!repoId) return ordered;

  const cacheKey = readPreferenceCacheKey(repoId, readScope);
  const cached = urlPreferenceCache.get(cacheKey);
  if (!cached?.preferredUrl) return ordered;

  const activeIndex = ordered.indexOf(cached.preferredUrl);
  if (activeIndex === -1) {
    urlPreferenceCache.delete(cacheKey);
    return ordered;
  }

  return ordered.slice(activeIndex);
}

/**
 * Filter clone URLs to only include valid, usable URLs.
 * Skips pseudo-URLs like nostr:// that aren't real git remotes.
 */
export function filterValidCloneUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];

  return urls.filter((u) => {
    const s = String(u || "").trim();
    if (!s) return false;
    // Skip nostr/grasp pseudo URLs
    if (/^nostr:(?:\/\/)?/i.test(s)) return false;
    if (!isGitRemoteUrlEnabled(s)) return false;
    // Accept http(s), ssh, git protocols
    return true;
  });
}

export function isPushCapableCloneUrl(url: string): boolean {
  const value = String(url || "").trim();
  return isGitRemoteUrlEnabled(value) && (
    /^https?:\/\//i.test(value) ||
    /^wss?:\/\//i.test(value) ||
    /^ssh:\/\//i.test(value) ||
    /^git@/i.test(value)
  );
}

/**
 * Execute a read operation with fallback through multiple URLs.
 * Tries each URL in order until one succeeds.
 *
 * @param urls - List of clone URLs to try
 * @param operation - Async function that performs the read operation
 * @param options - Configuration options
 * @returns Result with the successful URL and all attempts
 */
export async function withUrlFallback<T>(
  urls: string[],
  operation: (url: string, signal?: AbortSignal) => Promise<T>,
  options?: {
    repoId?: string;
    /** Continue trying remaining URLs even after success (for validation) */
    tryAll?: boolean;
    /** Custom error classifier to determine if error is retriable */
    isRetriable?: (error: unknown) => boolean;
    /** Timeout in milliseconds for each URL attempt. If exceeded, tries next URL. Default: 15000 (15s) */
    perUrlTimeoutMs?: number;
    /** Maximum time to wait for an aborted operation to settle before stopping fallback. */
    cancellationSettleTimeoutMs?: number;
    /** Independent read cursor within the repository, such as a fork PR source. */
    readScope?: string;
  }
): Promise<ReadFallbackResult<T>> {
  const {
    repoId,
    tryAll = false,
    isRetriable = defaultIsRetriable,
    perUrlTimeoutMs = 15000,
    cancellationSettleTimeoutMs = 1000,
    readScope,
  } = options || {};

  // Filter and reorder URLs
  const validUrls = filterValidCloneUrls(urls);
  const orderedUrls = orderReadUrlsByPreference(validUrls, repoId, readScope);

  if (orderedUrls.length === 0) {
    return {
      success: false,
      attempts: [],
    };
  }

  const attempts: UrlAttemptResult<T>[] = [];
  let successResult: T | undefined;
  let successUrl: string | undefined;
  let successIndex: number | undefined;
  const failedUrls: string[] = [];

  for (let i = 0; i < orderedUrls.length; i++) {
    const url = orderedUrls[i];
    if (repoId) {
      const activeUrl = orderReadUrlsByPreference(validUrls, repoId, readScope)[0];
      const activeIndex = activeUrl ? validUrls.indexOf(activeUrl) : -1;
      const urlIndex = validUrls.indexOf(url);
      if (activeIndex >= 0 && urlIndex >= 0 && urlIndex < activeIndex) continue;
    }
    const startTime = Date.now();
    try {
      let result: T;

      if (perUrlTimeoutMs > 0) {
        const controller = new AbortController();
        const operationPromise = operation(url, controller.signal);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new UrlTimeoutError(
                `URL timeout after ${perUrlTimeoutMs}ms: ${url}`,
                url,
                perUrlTimeoutMs
              )
            );
          }, perUrlTimeoutMs);
        });

        try {
          result = await Promise.race([operationPromise, timeoutPromise]);
        } catch (error) {
          if (error instanceof UrlTimeoutError) {
            controller.abort();
            // Do not advance to another remote while the cancelled operation is still running.
            const settled = await waitForPromiseSettlement(
              operationPromise,
              cancellationSettleTimeoutMs
            );
            if (!settled) {
              throw new UrlCancellationUnconfirmedError(url, cancellationSettleTimeoutMs);
            }
          }
          throw error;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      } else {
        result = await operation(url);
      }

      const durationMs = Date.now() - startTime;

      attempts.push({
        url,
        success: true,
        result,
        durationMs,
      });

      if (successUrl === undefined) {
        successResult = result;
        successUrl = url;
        successIndex = i;

        // Log when we successfully used a fallback URL (not the first one)
        if (i > 0) {
          console.log(`[withUrlFallback] Success with fallback URL #${i + 1}: ${url} (${durationMs}ms)`);
        }
      }

      // Stop if we don't need to try all
      if (!tryAll) {
        break;
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof UrlTimeoutError;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = (error as any)?.name;
      const sourceErrorCode =
        errorName === "AbortError" ? errorName : (error as any)?.code || errorName || "UNKNOWN";
      const sourceStatus = Number((error as any)?.status);
      const cancellationUnconfirmed =
        error instanceof UrlCancellationUnconfirmedError ||
        String(sourceErrorCode).toLowerCase().replace(/_/g, "-") === "cancellation-unconfirmed";
      const normalizedErrorCode = String(sourceErrorCode).toLowerCase().replace(/_/g, "-");
      const cancellationConfirmed =
        !isTimeout &&
        ["aborterror", "abort-error", "abort-err", "err-aborted", "operation-aborted"].includes(
          normalizedErrorCode
        );
      const errorCode = isTimeout ? 'TIMEOUT' : sourceErrorCode;

      attempts.push({
        url,
        success: false,
        error: errorMessage,
        errorCode,
        ...(Number.isFinite(sourceStatus) && sourceStatus > 0 ? { status: sourceStatus } : {}),
        durationMs,
      });

      failedUrls.push(url);

      if (repoId && !cancellationConfirmed) {
        advanceReadUrlPreference(
          repoId,
          url,
          cancellationUnconfirmed ? undefined : orderedUrls[i + 1],
          errorMessage,
          validUrls,
          readScope
        );
      }

      // Log timeout to help with debugging
      if (isTimeout) {
        console.log(`[withUrlFallback] URL timed out after ${perUrlTimeoutMs}ms, trying next: ${url}`);
      }

      // Starting another remote is unsafe when the timed-out operation ignored abort.
      if (
        cancellationConfirmed ||
        cancellationUnconfirmed ||
        (!isTimeout && !isRetriable(error))
      ) {
        break;
      }
    }
  }

  // Update cache if we had a success
  if (successUrl && repoId) {
    recordReadUrlSuccess(repoId, successUrl, failedUrls, validUrls, readScope);
  }

  return {
    success: successUrl !== undefined,
    result: successResult,
    usedUrl: successUrl,
    attempts,
    successIndex,
  };
}

async function waitForPromiseSettlement(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> {
  if (timeoutMs <= 0) {
    void promise.catch(() => undefined);
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Execute a write operation to ALL URLs.
 * Continues even if some URLs fail to ensure data propagates to all remotes.
 *
 * @param urls - List of clone URLs to write to
 * @param operation - Async function that performs the write operation
 * @param options - Configuration options
 * @returns Result with success/failure for each URL
 */
export async function withMultiWrite<T>(
  urls: string[],
  operation: (url: string) => Promise<T>,
  options?: {
    /** Run writes in parallel (default: true) */
    parallel?: boolean;
    /** Continue on auth errors (default: false - auth errors usually mean we can't write) */
    continueOnAuthError?: boolean;
  }
): Promise<MultiWriteResult<T>> {
  const { parallel = true, continueOnAuthError = false } = options || {};

  const validUrls = filterValidCloneUrls(urls);

  if (validUrls.length === 0) {
    return {
      success: false,
      partialSuccess: false,
      results: [],
      successCount: 0,
      failureCount: 0,
      summary: "No valid clone URLs to write to",
    };
  }

  const executeWrite = async (url: string): Promise<UrlAttemptResult<T>> => {
    const startTime = Date.now();

    try {
      const result = await operation(url);
      return {
        url,
        success: true,
        result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code || (error as any)?.name || "UNKNOWN";

      return {
        url,
        success: false,
        error: errorMessage,
        errorCode,
        durationMs: Date.now() - startTime,
      };
    }
  };

  let results: UrlAttemptResult<T>[];

  if (parallel) {
    // Execute all writes in parallel
    results = await Promise.all(validUrls.map(executeWrite));
  } else {
    // Execute writes sequentially
    results = [];
    for (const url of validUrls) {
      const result = await executeWrite(url);
      results.push(result);

      // Stop on auth error if not configured to continue
      if (!result.success && !continueOnAuthError) {
        const isAuthError =
          result.errorCode === "UNAUTHORIZED" ||
          result.errorCode === "FORBIDDEN" ||
          /auth|token|permission|401|403/i.test(result.error || "");
        if (isAuthError) {
          break;
        }
      }
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;
  const success = failureCount === 0 && successCount > 0;
  const partialSuccess = successCount > 0;

  // Build summary message
  let summary: string;
  if (success) {
    summary = `Successfully wrote to all ${successCount} remote(s)`;
  } else if (partialSuccess) {
    summary = `Wrote to ${successCount}/${validUrls.length} remote(s), ${failureCount} failed`;
  } else {
    summary = `Failed to write to all ${failureCount} remote(s)`;
  }

  return {
    success,
    partialSuccess,
    results,
    successCount,
    failureCount,
    summary,
  };
}

/**
 * Default retriable error classifier.
 * Returns true for network/transient errors that might succeed with a different URL.
 */
function defaultIsRetriable(error: unknown): boolean {
  if (!error) return true;

  const message = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code || (error as any)?.name || "";
  const lower = (message + code).toLowerCase();

  if (lower.includes('cancellation_unconfirmed') || lower.includes('cancellation-unconfirmed')) {
    return false;
  }
  if (
    lower.includes("aborterror") ||
    lower.includes("operation_aborted") ||
    lower.includes("operation-aborted")
  ) {
    return false;
  }

  // Keep URL fallback moving even for auth/not-found errors. One mirror can
  // require credentials or be stale while another mirror remains readable.

  // Retriable errors - transient or URL-specific
  const retriable = [
    "econnrefused",
    "econnreset",
    "etimedout",
    "enotfound",
    "enetunreach",
    "ehostunreach",
    "eai_again",
    "network",
    "timeout",
    "cors",
    "failed to fetch",
    "connection",
    "socket",
    "ssl",
    "tls",
    "certificate",
    // Server errors might be transient
    "500",
    "502",
    "503",
    "504",
    // Rate limiting
    "429",
    "rate limit",
  ];

  for (const term of retriable) {
    if (lower.includes(term)) {
      return true;
    }
  }

  // Default to retriable for unknown errors
  return true;
}

/**
 * Wrap a git clone/fetch operation with URL fallback.
 * Convenience wrapper for common git read operations.
 */
export async function cloneWithFallback<T>(
  cloneUrls: string[],
  cloneFn: (url: string) => Promise<T>,
  repoId?: string
): Promise<ReadFallbackResult<T>> {
  return withUrlFallback(cloneUrls, cloneFn, { repoId, perUrlTimeoutMs: 0 });
}

/**
 * Wrap a git push operation to write to all remotes.
 * Convenience wrapper for common git write operations.
 */
export async function pushToAllRemotes<T>(
  remoteUrls: string[],
  pushFn: (url: string) => Promise<T>
): Promise<MultiWriteResult<T>> {
  return withMultiWrite(remoteUrls, pushFn, { parallel: true });
}

/**
 * Extract clone URLs from a NIP-34 repo announcement event.
 */
export function getCloneUrlsFromEvent(event: {
  tags: Array<[string, ...string[]]>;
}): string[] {
  const cloneUrls: string[] = [];

  for (const tag of event.tags) {
    if (tag[0] === "clone") {
      // Clone tag can have multiple URLs: ["clone", "url1", "url2", ...]
      for (let i = 1; i < tag.length; i++) {
        const url = tag[i];
        if (url && typeof url === "string" && url.trim()) {
          cloneUrls.push(url.trim());
        }
      }
    }
  }

  return cloneUrls;
}

export function getPrimaryCloneUrlFromEvent(event: {
  tags: Array<[string, ...string[]]>;
}): string | undefined {
  return getCloneUrlsFromEvent(event)[0];
}
