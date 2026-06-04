import type { Token } from "../stores/tokens.js";
import { createHostMatcher, matchesHost } from "./tokenMatcher.js";
import { AllTokensFailedError, TokenNotFoundError } from "./tokenErrors.js";

/**
 * Try all tokens for a given host until one succeeds.
 * This is useful when multiple tokens exist for the same host (e.g., multiple GitHub tokens).
 *
 * @param tokens - Array of tokens to try
 * @param hostMatcher - Function that returns true if a token's host matches, or a hostname string
 * @param operation - Async function that takes a token and host, and returns a result
 * @returns Promise that resolves with the first successful result
 * @throws TokenNotFoundError if no tokens found
 * @throws AllTokensFailedError if all tokens fail
 */
export async function tryTokensForHost<T>(
  tokens: Token[],
  hostMatcher: ((host: string) => boolean) | string,
  operation: (token: string, host: string) => Promise<T>
): Promise<T> {
  // Support both function matcher and hostname string
  const matcher = typeof hostMatcher === 'string' 
    ? createHostMatcher(hostMatcher)
    : hostMatcher;
  
  const matchingTokens = tokens.filter((t) => matcher(t.host));

  if (matchingTokens.length === 0) {
    const hostname = typeof hostMatcher === 'string' ? hostMatcher : 'specified host';
    throw new TokenNotFoundError(hostname);
  }

  const errors: Error[] = [];

  for (const tokenEntry of matchingTokens) {
    try {
      const result = await operation(tokenEntry.token, tokenEntry.host);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      // Continue to next token
    }
  }

  // All tokens failed - throw typed error
  const hostname = typeof hostMatcher === 'string' ? hostMatcher : 'specified host';
  throw new AllTokensFailedError(hostname, errors);
}

/**
 * Get all tokens matching a host.
 * This is a simpler version for cases where we just need to find tokens.
 *
 * @param tokens - Array of tokens to search
 * @param hostMatcher - Function that returns true if a token's host matches, or a hostname string
 * @returns Array of matching tokens
 */
export function getTokensForHost(
  tokens: Token[], 
  hostMatcher: ((host: string) => boolean) | string
): Token[] {
  // Support both function matcher and hostname string
  const matcher = typeof hostMatcher === 'string' 
    ? createHostMatcher(hostMatcher)
    : hostMatcher;
  
  return tokens.filter((t) => matcher(t.host));
}
