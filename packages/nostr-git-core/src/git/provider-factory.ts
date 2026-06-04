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
import type {GitVendor} from "./vendor-providers.js"
import {GitHubApi} from "../api/providers/github.js"
import {GitLabApi} from "../api/providers/gitlab.js"
import {GiteaApi} from "../api/providers/gitea.js"
import {BitbucketApi} from "../api/providers/bitbucket.js"
import {GraspApiProvider} from "../api/providers/grasp.js"
import {normalizeHttpOrigin} from "../api/providers/grasp-capabilities.js"
import {GraspRestApiProvider} from "../api/providers/grasp-rest.js"
import {createInvalidInputError, type GitErrorContext} from "../errors/index.js"
import {isGraspRelayUrl, isGraspRepoHttpUrl} from "../utils/grasp-url.js"

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
  switch (provider) {
    case "github":
      return new GitHubApi(token, baseUrl)

    case "gitlab":
      return new GitLabApi(token, baseUrl)

    case "gitea":
      return new GiteaApi(token, baseUrl)

    case "bitbucket":
      return new BitbucketApi(token, baseUrl)

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
  const normalizedUrl = url.toLowerCase()

  // Detect provider from URL
  let provider: GitVendor
  let baseUrl: string | undefined

  if (normalizedUrl.includes("github.com")) {
    provider = "github"
    baseUrl = "https://api.github.com"
  } else if (normalizedUrl.includes("gitlab.com")) {
    provider = "gitlab"
    baseUrl = "https://gitlab.com/api/v4"
  } else if (normalizedUrl.includes("gitlab.")) {
    provider = "gitlab"
    // Extract base URL for self-hosted GitLab
    const match = url.match(/https?:\/\/([^\/]+)/)
    baseUrl = match ? `${match[0]}/api/v4` : undefined
  } else if (normalizedUrl.includes("gitea.")) {
    provider = "gitea"
    // Extract base URL for self-hosted Gitea
    const match = url.match(/https?:\/\/([^\/]+)/)
    baseUrl = match ? `${match[0]}/api/v1` : undefined
  } else if (normalizedUrl.includes("bitbucket.org") || normalizedUrl.includes("bitbucket.")) {
    provider = "bitbucket"
    baseUrl = "https://api.bitbucket.org/2.0"
  } else if (isGraspRepoHttpUrl(url) || isGraspRelayUrl(url)) {
    provider = "grasp-rest"
    baseUrl = url
  } else {
    throw createInvalidInputError(
      `Unable to detect Git provider from URL: ${url}. Supported providers: GitHub, GitLab, Gitea, Bitbucket, GRASP`,
      buildContext({operation: "getGitServiceApiFromUrl", remote: url}),
    )
  }

  return getGitServiceApi(provider, token, baseUrl)
}

/**
 * Get available Git service providers
 *
 * @returns Array of supported Git service provider names
 */
export function getAvailableProviders(): GitVendor[] {
  return ["github", "gitlab", "gitea", "bitbucket", "grasp", "grasp-rest"]
}

/**
 * Check if a provider supports REST API operations
 *
 * @param provider - Git service provider name
 * @returns true if the provider supports REST API operations
 */
export function supportsRestApi(provider: GitVendor): boolean {
  return ["github", "gitlab", "gitea", "bitbucket", "grasp", "grasp-rest"].includes(provider)
}

/**
 * Get default API base URL for a provider
 *
 * @param provider - Git service provider name
 * @returns Default API base URL for the provider
 */
export function getDefaultApiBaseUrl(provider: GitVendor): string {
  switch (provider) {
    case "github":
      return "https://api.github.com"
    case "gitlab":
      return "https://gitlab.com/api/v4"
    case "gitea":
      throw createInvalidInputError(
        "Gitea requires a custom base URL for self-hosted instances",
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
