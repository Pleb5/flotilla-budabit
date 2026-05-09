// Authentication utilities extracted from git-worker
// Keeps a simple token-per-host configuration and provides onAuth callbacks

export interface AuthToken {
  host: string
  token: string
}

export interface AuthConfig {
  tokens: AuthToken[]
}

let authConfig: AuthConfig = {tokens: []}

function isLikelyGitLab(hostname: string, tokenHost: string, token: string): boolean {
  const normalizedHost = hostname.toLowerCase().trim()
  const normalizedTokenHost = tokenHost.toLowerCase().trim()
  const isGitLabHost =
    normalizedHost === "gitlab.com" ||
    normalizedHost.endsWith(".gitlab.com") ||
    normalizedHost.includes("gitlab.") ||
    normalizedTokenHost === "gitlab.com" ||
    normalizedTokenHost.endsWith(".gitlab.com") ||
    normalizedTokenHost.includes("gitlab.")
  const isGitLabToken = token.startsWith("glpat-")
  return isGitLabHost || isGitLabToken
}

export function setAuthConfig(config: AuthConfig): void {
  authConfig = config
  console.log("Git worker authentication configured for", config.tokens.length, "hosts")
}

/**
 * Return an isomorphic-git onAuth callback for the URL, if a matching token exists.
 * Note: This function is synchronous for compatibility with isomorphic-git's onAuth callback.
 * Uses inline matching logic (same as matchesHost) to avoid async overhead.
 */
export function getAuthCallback(url: string) {
  if (!authConfig.tokens.length) return undefined

  // Extract hostname
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase().trim()
  } catch {
    return undefined
  }

  // Use inline matching logic (same as matchesHost but synchronous)
  // This avoids async overhead and maintains compatibility with isomorphic-git
  const match = authConfig.tokens.find(t => {
    const tokenHost = t.host.toLowerCase().trim()
    return tokenHost === hostname || hostname.endsWith("." + tokenHost)
  })

  if (!match) return undefined

  const username = isLikelyGitLab(hostname, match.host, match.token) ? "oauth2" : "token"
  return () => ({username, password: match.token})
}

/**
 * Return configured hostnames for logging/debugging purposes.
 */
export function getConfiguredAuthHosts(): string[] {
  try {
    return (authConfig.tokens || []).map(t => t.host)
  } catch {
    return []
  }
}

/**
 * Get all tokens matching a hostname for retry logic.
 * Uses inline matching logic for consistency with getAuthCallback.
 */
export async function getTokensForHost(hostname: string): Promise<AuthToken[]> {
  if (!authConfig.tokens.length) return []

  // Use inline matching logic (same as getAuthCallback and matchesHost)
  // This avoids dependency on UI package and keeps worker self-contained
  const normalizedHostname = hostname.toLowerCase().trim()
  return authConfig.tokens.filter(t => {
    const tokenHost = t.host.toLowerCase().trim()
    return tokenHost === normalizedHostname || normalizedHostname.endsWith("." + tokenHost)
  })
}

/**
 * Try a push operation with multiple tokens until one succeeds.
 * This provides fallback retry logic for internal git push operations when multiple tokens exist for the same host.
 *
 * Note: This is only used by internal worker operations (e.g., cloneAndFork, mergePRAndPush).
 * Operations called from UI layer (e.g., pushToRemote, updateAndPushFiles) should receive tokens
 * from the UI layer, which handles retry logic using tryTokensForHost().
 */
export async function tryPushWithTokens<T>(
  url: string,
  pushOperation: (
    authCallback: (() => {username: string; password: string}) | undefined,
  ) => Promise<T>,
): Promise<T> {
  // Extract hostname
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    // If URL parsing fails, try with the first available token or no auth
    return pushOperation(getAuthCallback(url))
  }

  // Get all matching tokens
  const matchingTokens = await getTokensForHost(hostname)

  if (matchingTokens.length === 0) {
    // No tokens found, try without auth
    return pushOperation(undefined)
  }

  // Try each token until one succeeds
  const errors: Error[] = []
  for (const tokenEntry of matchingTokens) {
    try {
      const username = isLikelyGitLab(hostname, tokenEntry.host, tokenEntry.token)
        ? "oauth2"
        : "token"
      const authCallback = () => ({username, password: tokenEntry.token})
      const result = await pushOperation(authCallback)
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      errors.push(err)
      // Continue to next token
    }
  }

  // All tokens failed - throw standard error with details
  const errorMessages = errors.map((e, i) => `Token ${i + 1}: ${e.message}`).join("; ")
  const error = new Error(
    `All tokens failed for push operation on ${hostname}. Errors: ${errorMessages}`,
  )
  ;(error as any).hostname = hostname
  ;(error as any).errors = errors
  throw error
}
