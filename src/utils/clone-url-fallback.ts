/**
 * Clone URL fallback and multi-write utilities for handling repositories
 * with multiple clone URLs (NIP-34 support).
 *
 * Read Operations: Try URLs in order with fallback on failure
 * Write Operations: Write to ALL URLs and report individual results
 */

import { detectVendorFromUrl } from '../git/vendor-providers.js';

export interface UrlAttemptResult<T = unknown> {
  url: string;
  success: boolean;
  result?: T;
  error?: string;
  errorCode?: string;
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

/**
 * Simple in-memory cache for URL preferences.
 * Maps repoId -> preferred URL info.
 */
const urlPreferenceCache = new Map<string, CloneUrlCacheEntry>();

/**
 * Get cached URL preference for a repo.
 */
export function getCachedUrlPreference(repoId: string): CloneUrlCacheEntry | undefined {
  return urlPreferenceCache.get(repoId);
}

/**
 * Update URL preference cache after a successful read.
 */
export function updateUrlPreferenceCache(
  repoId: string,
  successfulUrl: string,
  failedUrls: string[] = []
): void {
  urlPreferenceCache.set(repoId, {
    preferredUrl: successfulUrl,
    lastSuccessAt: Date.now(),
    failedUrls,
  });
}

/**
 * Clear cached URL preference for a repo.
 */
export function clearUrlPreferenceCache(repoId?: string): void {
  if (repoId) {
    urlPreferenceCache.delete(repoId);
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
  return vendor === 'github' || vendor === 'gitlab' || vendor === 'gitea' || vendor === 'bitbucket';
}

/**
 * Sort URLs to prioritize REST API-capable providers.
 * This allows faster initial repo loading by trying API-capable sources first.
 */
export function sortUrlsByApiPriority(urls: string[]): string[] {
  if (urls.length <= 1) return urls;

  const apiUrls: string[] = [];
  const otherUrls: string[] = [];

  for (const url of urls) {
    if (hasRestApiSupport(url)) {
      apiUrls.push(url);
    } else {
      otherUrls.push(url);
    }
  }

  // Log when we're reordering for API priority
  if (apiUrls.length > 0 && otherUrls.length > 0) {
    console.log(`[sortUrlsByApiPriority] Prioritizing ${apiUrls.length} REST API-capable URL(s) over ${otherUrls.length} git-only URL(s)`);
  }

  // API-capable URLs first, then others
  return [...apiUrls, ...otherUrls];
}

/**
 * Reorder URLs to put cached preferred URL first, if available.
 * Also prioritizes REST API-capable URLs over git-only sources.
 */
export function reorderUrlsByPreference(urls: string[], repoId?: string): string[] {
  if (urls.length <= 1) return urls;

  // First, sort by API priority (REST API-capable sources first)
  let orderedUrls = sortUrlsByApiPriority(urls);

  // If no repoId, just return API-prioritized order
  if (!repoId) return orderedUrls;

  const cached = getCachedUrlPreference(repoId);
  if (!cached) return orderedUrls;

  // Check if cached preference is stale (older than 1 hour)
  const maxCacheAge = 60 * 60 * 1000;
  if (Date.now() - cached.lastSuccessAt > maxCacheAge) {
    clearUrlPreferenceCache(repoId);
    return orderedUrls;
  }

  // Put preferred URL first, then non-failed URLs, then failed URLs last
  const preferred = cached.preferredUrl;
  const failed = new Set(cached.failedUrls);

  const result: string[] = [];

  // Add preferred URL first if it's in the list
  if (orderedUrls.includes(preferred)) {
    result.push(preferred);
  }

  // Add non-failed URLs (maintaining API priority order)
  for (const url of orderedUrls) {
    if (url !== preferred && !failed.has(url)) {
      result.push(url);
    }
  }

  // Add previously failed URLs last (they might work now)
  for (const url of orderedUrls) {
    if (url !== preferred && failed.has(url)) {
      result.push(url);
    }
  }

  return result;
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
    if (s.startsWith("nostr://") || s.startsWith("nostr:")) return false;
    // Accept http(s), ssh, git protocols
    return true;
  });
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
  operation: (url: string) => Promise<T>,
  options?: {
    repoId?: string;
    /** Continue trying remaining URLs even after success (for validation) */
    tryAll?: boolean;
    /** Custom error classifier to determine if error is retriable */
    isRetriable?: (error: unknown) => boolean;
    /** Timeout in milliseconds for each URL attempt. If exceeded, tries next URL. Default: 15000 (15s) */
    perUrlTimeoutMs?: number;
  }
): Promise<ReadFallbackResult<T>> {
  const { 
    repoId, 
    tryAll = false, 
    isRetriable = defaultIsRetriable,
    perUrlTimeoutMs = 15000  // Default 15 second timeout per URL
  } = options || {};

  // Filter and reorder URLs
  const validUrls = filterValidCloneUrls(urls);
  const orderedUrls = reorderUrlsByPreference(validUrls, repoId);

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
    const startTime = Date.now();
    const isLastUrl = i === orderedUrls.length - 1;

    try {
      // Wrap operation with timeout - but only if we have more URLs to try
      // For the last URL, let it run without timeout to give it a fair chance
      let result: T;
      
      if (perUrlTimeoutMs > 0 && !isLastUrl) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new UrlTimeoutError(
              `URL timeout after ${perUrlTimeoutMs}ms: ${url}`,
              url,
              perUrlTimeoutMs
            ));
          }, perUrlTimeoutMs);
        });
        
        result = await Promise.race([operation(url), timeoutPromise]);
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
      const errorCode = isTimeout ? 'TIMEOUT' : ((error as any)?.code || (error as any)?.name || "UNKNOWN");

      attempts.push({
        url,
        success: false,
        error: errorMessage,
        errorCode,
        durationMs,
      });

      failedUrls.push(url);
      
      // Log timeout to help with debugging
      if (isTimeout) {
        console.log(`[withUrlFallback] URL timed out after ${perUrlTimeoutMs}ms, trying next: ${url}`);
      }

      // If error is not retriable (and not a timeout), don't try other URLs
      // Timeouts are always retriable - we want to try the next URL
      if (!isTimeout && !isRetriable(error)) {
        break;
      }
    }
  }

  // Update cache if we had a success
  if (successUrl && repoId) {
    updateUrlPreferenceCache(repoId, successUrl, failedUrls);
  }

  return {
    success: successUrl !== undefined,
    result: successResult,
    usedUrl: successUrl,
    attempts,
    successIndex,
  };
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
  return withUrlFallback(cloneUrls, cloneFn, { repoId });
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
