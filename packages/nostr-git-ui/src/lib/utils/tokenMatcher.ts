/**
 * Centralized token matching utility
 * Provides consistent hostname matching logic for token selection
 */

/**
 * Check if a token's host matches a URL hostname
 * Supports exact matches and subdomain matching (e.g., "github.com" matches "api.github.com")
 *
 * @param tokenHost - The host stored with the token (e.g., "github.com")
 * @param urlHostname - The hostname from the URL (e.g., "api.github.com")
 * @returns true if the token host matches the URL hostname
 *
 * @example
 * ```typescript
 * matchesHost("github.com", "github.com") // true
 * matchesHost("github.com", "api.github.com") // true
 * matchesHost("github.com", "gitlab.com") // false
 * ```
 */
export function matchesHost(tokenHost: string, urlHostname: string): boolean {
  // Normalize both hosts (lowercase, trim)
  const normalizedTokenHost = tokenHost.toLowerCase().trim();
  const normalizedUrlHost = urlHostname.toLowerCase().trim();

  // Exact match
  if (normalizedTokenHost === normalizedUrlHost) {
    return true;
  }

  // Subdomain match: urlHost ends with "." + tokenHost
  // e.g., "api.github.com" ends with ".github.com"
  if (normalizedUrlHost.endsWith('.' + normalizedTokenHost)) {
    return true;
  }

  return false;
}

/**
 * Create a host matcher function for use with token filtering
 * Returns a function that can be used with Array.filter() or similar
 *
 * @param urlHostname - The hostname to match against
 * @returns A function that takes a token host and returns true if it matches
 *
 * @example
 * ```typescript
 * const matcher = createHostMatcher("api.github.com");
 * const matchingTokens = tokens.filter(t => matcher(t.host));
 * ```
 */
export function createHostMatcher(urlHostname: string): (tokenHost: string) => boolean {
  return (tokenHost: string) => matchesHost(tokenHost, urlHostname);
}

