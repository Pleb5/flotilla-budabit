/**
 * Git Service API Factory - CLEAN VERSION
 *
 * Factory function to create the appropriate GitServiceApi implementation
 * based on the Git provider type and authentication token.
 *
 * Note: GRASP event publishing is handled in the UI layer (e.g., useNewRepo.svelte.ts).
 * The GraspApi here is a pure Smart HTTP client and does not take EventIO.
 */

import type {GitServiceApi} from "../api/index.js"
import {detectVendorFromUrl, gitUrlToHttp, type GitVendor} from "./vendor-providers.js"
import {GitHubApi} from "../api/providers/github.js"
import {GitLabApi} from "../api/providers/gitlab.js"
import {GiteaApi} from "../api/providers/gitea.js"
import {ForgejoApi} from "../api/providers/forgejo.js"
import {BitbucketApi} from "../api/providers/bitbucket.js"
import {GraspApiProvider} from "../api/providers/grasp.js"
import {normalizeHttpOrigin} from "../api/providers/grasp-capabilities.js"
import {GraspRestApiProvider} from "../api/providers/grasp-rest.js"
import {createInvalidInputError, type GitErrorContext} from "../errors/index.js"
import {parseGraspRepoHttpUrl} from "../utils/grasp-url.js"
import {
  ENABLE_BITBUCKET_PROVIDER,
  assertGitVendorEnabled,
  isGitVendorEnabled,
} from "./provider-policy.js"

/**
 * Create a GitServiceApi instance for the specified provider
 *
 * @param provider - The Git service provider ('github', 'gitlab', 'gitea', 'bitbucket', 'grasp')
 * @param token - Authentication token for the provider (or pubkey for GRASP)
 * @param baseUrl - Optional custom base URL (for self-hosted instances) or relay URL for GRASP
 * @returns GitServiceApi implementation for the provider
 *
 * @example
 * ```typescript
 * // GitHub.com
 * const githubApi = getGitServiceApi('github', 'ghp_xxxxxxxxxxxx');
 *
 * // Self-hosted GitLab
 * const gitlabApi = getGitServiceApi('gitlab', 'glpat-xxxxxxxxxxxx', 'https://gitlab.example.com');
 *
 * // GRASP relay (event publishing handled in UI layer)
 * const graspApi = getGitServiceApi('grasp', pubkey, 'wss://relay.example.com');
 * ```
 */
export function getGitServiceApi(
  provider: GitVendor,
  token: string,
  baseUrl?: string,
): GitServiceApi {
  assertGitVendorEnabled(provider, "REST API access")

  switch (provider) {
    case "github":
      return new GitHubApi(token, baseUrl)

    case "gitlab":
      return new GitLabApi(token, baseUrl)

    case "gitea":
      return new GiteaApi(token, baseUrl)

    case "forgejo":
      return new ForgejoApi(token, baseUrl)

    case "bitbucket":
      if (!ENABLE_BITBUCKET_PROVIDER) {
        throw new Error("Bitbucket provider is disabled for REST API access")
      }
      BITBUCKET_PROVIDER: {
        return new BitbucketApi(token, baseUrl)
      }
      throw new Error("Bitbucket provider is unavailable")

    case "grasp":
      if (!baseUrl) {
        throw createInvalidInputError(
          "GRASP provider requires a relay URL as baseUrl parameter",
          buildContext({operation: "getGitServiceApi", remote: baseUrl}),
        )
      }
      // Note: GRASP no longer takes EventIO. Event publishing moved to the UI layer (useNewRepo.svelte.ts).
      // This GraspApiProvider instance only handles Smart HTTP Git operations.
      return new GraspApiProvider(baseUrl, token)

    case "grasp-rest":
      if (!baseUrl) {
        throw createInvalidInputError(
          "GRASP REST provider requires a relay URL as baseUrl parameter",
          buildContext({operation: "getGitServiceApi", remote: baseUrl}),
        )
      }
      // GRASP REST API provider uses the git-natural-api approach for querying repos
      return new GraspRestApiProvider(normalizeHttpOrigin(baseUrl), token)

    case "generic":
      throw createInvalidInputError(
        "Generic Git provider does not support REST API operations. Use a specific provider (github, gitlab, gitea, bitbucket, grasp).",
        buildContext({operation: "getGitServiceApi"}),
      )

    default:
      throw createInvalidInputError(
        `Unknown Git provider: ${provider}. Supported providers: github, gitlab, gitea, bitbucket, grasp`,
        buildContext({operation: "getGitServiceApi"}),
      )
  }
}

/**
 * Detect Git provider from URL and create appropriate GitServiceApi instance
 *
 * @param url - Git repository URL or service base URL
 * @param token - Authentication token for the provider
 * @returns GitServiceApi implementation for the detected provider
 *
 * @example
 * ```typescript
 * // Auto-detect GitHub from repo URL
 * const api = getGitServiceApiFromUrl('https://github.com/owner/repo', 'ghp_xxxxxxxxxxxx');
 *
 * // Auto-detect self-hosted GitLab
 * const api = getGitServiceApiFromUrl('https://gitlab.example.com/owner/repo', 'glpat-xxxxxxxxxxxx');
 *
 * // Auto-detect GRASP relay (event publishing handled in UI layer)
 * const api = getGitServiceApiFromUrl('wss://relay.example.com', pubkey);
 * ```
 */
export function getGitServiceApiFromUrl(url: string, token: string): GitServiceApi {
  const provider = detectVendorFromUrl(url)
  if (provider === "generic") {
    throw createInvalidInputError(
      "Unable to detect Git provider. Supported providers: GitHub, GitLab, Gitea, Forgejo, GRASP",
      buildContext({operation: "getGitServiceApiFromUrl", remote: url}),
    )
  }
  return getGitServiceApi(provider, token, getGitApiBaseUrl(provider, url))
}

/** Use the parsed origin, retaining custom ports and avoiding hostname substring dispatch. */
export function getGitApiBaseUrl(provider: GitVendor, url: string): string | undefined {
  if (provider === "grasp" || provider === "grasp-rest")
    return parseGraspRepoHttpUrl(url)?.httpBase || url
  const parsed = gitUrlToHttp(url)
  if (!parsed) return undefined
  if (provider === "github")
    return parsed.hostname === "github.com" ? "https://api.github.com" : `${parsed.origin}/api/v3`
  if (provider === "gitlab") return `${parsed.origin}/api/v4`
  if (provider === "gitea" || provider === "forgejo") return `${parsed.origin}/api/v1`
  if (provider === "bitbucket") return "https://api.bitbucket.org/2.0"
  return undefined
}

/**
 * Get available Git service providers
 *
 * @returns Array of supported Git service provider names
 */
export function getAvailableProviders(): GitVendor[] {
  const providers: GitVendor[] = [
    "github",
    "gitlab",
    "gitea",
    "forgejo",
    "bitbucket",
    "grasp",
    "grasp-rest",
  ]
  return providers.filter(isGitVendorEnabled)
}

/**
 * Check if a provider supports REST API operations
 *
 * @param provider - Git service provider name
 * @returns true if the provider supports REST API operations
 */
export function supportsRestApi(provider: GitVendor): boolean {
  return (
    isGitVendorEnabled(provider) &&
    ["github", "gitlab", "gitea", "forgejo", "bitbucket", "grasp", "grasp-rest"].includes(provider)
  )
}

/**
 * Get default API base URL for a provider
 *
 * @param provider - Git service provider name
 * @returns Default API base URL for the provider
 */
export function getDefaultApiBaseUrl(provider: GitVendor): string {
  assertGitVendorEnabled(provider, "default API URL lookup")

  switch (provider) {
    case "github":
      return "https://api.github.com"
    case "gitlab":
      return "https://gitlab.com/api/v4"
    case "forgejo":
    case "gitea":
      throw createInvalidInputError(
        `${provider === "forgejo" ? "Forgejo" : "Gitea"} requires a custom base URL for self-hosted instances`,
        buildContext({operation: "getDefaultApiBaseUrl"}),
      )
    case "bitbucket":
      return "https://api.bitbucket.org/2.0"
    case "grasp":
      throw createInvalidInputError(
        "GRASP provider requires a custom relay URL",
        buildContext({operation: "getDefaultApiBaseUrl"}),
      )
    case "grasp-rest":
      throw createInvalidInputError(
        "GRASP REST provider requires a custom relay URL",
        buildContext({operation: "getDefaultApiBaseUrl"}),
      )
    case "generic":
      throw createInvalidInputError(
        "Generic provider does not have a default API base URL",
        buildContext({operation: "getDefaultApiBaseUrl"}),
      )
    default:
      throw createInvalidInputError(
        `Unknown provider: ${provider}`,
        buildContext({operation: "getDefaultApiBaseUrl"}),
      )
  }
}

function buildContext(context: GitErrorContext): GitErrorContext {
  return {
    ...context,
  }
}
