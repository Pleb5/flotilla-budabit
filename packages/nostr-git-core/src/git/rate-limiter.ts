/**
 * Rate Limiter for Git Service API Requests
 *
 * Implements PyGithub-style three-layer rate limiting approach:
 * 1. Proactive Request Throttling - prevents hitting limits
 * 2. Retry Mechanism - handles rate limit errors with backoff
 * 3. Rate Limit Tracking - monitors remaining quota
 *
 * Reference: https://github.com/PyGithub/PyGithub
 */

/**
 * Configuration for rate limiter behavior
 */
export interface RateLimitConfig {
  /**
   * Minimum seconds between any requests (default: 0.25)
   */
  secondsBetweenRequests?: number;

  /**
   * Fixed delay for secondary rate limits in seconds (default: 60)
   */
  secondaryRateWait?: number;

  /**
   * Maximum number of retry attempts (default: 3)
   */
  maxRetries?: number;
}

/**
 * Rate limit status for a provider
 */
export interface RateLimitStatus {
  /**
   * Remaining requests in the current window
   */
  remaining: number;

  /**
   * Total requests allowed in the window
   */
  limit: number;

  /**
   * Unix timestamp (milliseconds) when the limit resets
   */
  resetTimestamp: number;
}

/**
 * Default rate limit configuration
 */
const DEFAULT_CONFIG: Required<RateLimitConfig> = {
  secondsBetweenRequests: 0.25,
  secondaryRateWait: 60,
  maxRetries: 3
};

/**
 * Rate limiter implementing PyGithub-style three-layer approach
 */
export class RateLimiter {
  private readonly config: Required<RateLimitConfig>;
  private readonly lastRequestTime: Map<string, number> = new Map();
  private readonly rateLimitStatus: Map<string, RateLimitStatus> = new Map();

  /**
   * Progress callback for rate limit wait messages
   * Called with messages like "Rate limit hit, waiting 60 seconds... (45s remaining)"
   */
  public onProgress?: (message: string) => void;

  constructor(config?: RateLimitConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Throttle a request before making it (Proactive Throttling)
   *
   * Waits if necessary to satisfy minimum delays between requests.
   * Delay is measured from the end of the previous request, not the start.
   *
   * @param provider - Provider identifier (e.g., 'github', 'gitlab')
   * @param method - HTTP method (e.g., 'GET', 'POST')
   */
  async throttle(provider: string, method: string): Promise<void> {
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(provider) || 0;

    const requestDelay = this.config.secondsBetweenRequests * 1000;

    const timeSinceLastRequest = now - lastRequest;
    const delayMs = Math.max(0, requestDelay - timeSinceLastRequest);

    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    this.lastRequestTime.set(provider, Date.now());
  }

  /**
   * Determine if an error should be retried and calculate backoff delay
   *
   * @param error - Error object from failed request
   * @param attempt - Current attempt number (1-indexed)
   * @returns Object with retry decision and delay in milliseconds
   */
  async shouldRetry(error: any, attempt: number): Promise<{ retry: boolean; delay: number }> {
    if (attempt >= this.config.maxRetries) {
      return { retry: false, delay: 0 };
    }

    const status = error?.status || error?.response?.status;
    const headers = error?.headers || error?.response?.headers || new Headers();
    const responseBody = error?.response?.data || error?.body || '';

    if (status >= 500 && status < 600) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      return { retry: true, delay };
    }

    if (status === 403) {
      const retryAfter = headers.get('Retry-After');
      if (retryAfter) {
        const delay = parseInt(retryAfter, 10) * 1000;
        return { retry: true, delay };
      }

      const bodyText =
        typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      const lowerBody = bodyText.toLowerCase();

      if (
        lowerBody.includes('api rate limit exceeded') ||
        lowerBody.includes('rate limit exceeded')
      ) {
        const resetHeader = headers.get('X-RateLimit-Reset');
        if (resetHeader) {
          const resetTimestamp = parseInt(resetHeader, 10) * 1000;
          const now = Date.now();
          const delay = Math.max(0, resetTimestamp - now) + 1000;
          return { retry: true, delay };
        }
        const delay = Math.pow(2, attempt - 1) * 1000;
        return { retry: true, delay };
      }

      if (
        lowerBody.includes('secondary rate limit') ||
        lowerBody.includes('abuse detection') ||
        lowerBody.includes('retry after')
      ) {
        const delay = this.config.secondaryRateWait * 1000;
        return { retry: true, delay };
      }
    }

    return { retry: false, delay: 0 };
  }

  /**
   * Update rate limit status from response headers
   *
   * Extracts X-RateLimit-* headers and stores them for the provider.
   * Called after each successful request to track remaining quota.
   *
   * @param provider - Provider identifier
   * @param headers - Response headers from the API
   */
  updateRateLimitStatus(provider: string, headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    const limit = headers.get('X-RateLimit-Limit');
    const reset = headers.get('X-RateLimit-Reset');

    if (remaining !== null && limit !== null && reset !== null) {
      this.rateLimitStatus.set(provider, {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        resetTimestamp: parseInt(reset, 10) * 1000
      });
    }
  }

  /**
   * Get remaining quota for a provider
   *
   * @param provider - Provider identifier
   * @returns Remaining requests, or null if unknown
   */
  getRemainingQuota(provider: string): number | null {
    const status = this.rateLimitStatus.get(provider);
    return status?.remaining ?? null;
  }

  /**
   * Get reset time for a provider
   *
   * @param provider - Provider identifier
   * @returns Unix timestamp in milliseconds when limit resets, or null if unknown
   */
  getResetTime(provider: string): number | null {
    const status = this.rateLimitStatus.get(provider);
    return status?.resetTimestamp ?? null;
  }

  /**
   * Wait for rate limit to reset with progress updates
   *
   * @param provider - Provider identifier
   * @param delayMs - Delay in milliseconds
   */
  async waitWithProgress(provider: string, delayMs: number): Promise<void> {
    if (!this.onProgress || delayMs <= 0) {
      await this.sleep(delayMs);
      return;
    }

    const startTime = Date.now();
    const updateInterval = 1000;

    while (Date.now() - startTime < delayMs) {
      const elapsed = Date.now() - startTime;
      const remaining = Math.ceil((delayMs - elapsed) / 1000);

      if (remaining > 0) {
        this.onProgress(
          `Rate limit hit, waiting ${Math.ceil(delayMs / 1000)} seconds... (${remaining}s remaining)`
        );
        await this.sleep(Math.min(updateInterval, delayMs - elapsed));
      } else {
        break;
      }
    }

    const finalWait = delayMs - (Date.now() - startTime);
    if (finalWait > 0) {
      await this.sleep(finalWait);
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset rate limit tracking for a provider (useful for testing)
   *
   * @param provider - Provider identifier
   */
  reset(provider?: string): void {
    if (provider) {
      this.lastRequestTime.delete(provider);
      this.rateLimitStatus.delete(provider);
    } else {
      this.lastRequestTime.clear();
      this.rateLimitStatus.clear();
    }
  }
}
