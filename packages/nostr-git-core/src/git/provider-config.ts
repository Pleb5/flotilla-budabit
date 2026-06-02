/**
 * Provider Configuration System
 *
 * Centralized configuration for Git provider capabilities and restrictions.
 * Makes it easy to add new providers without modifying UI code.
 */

export interface ProviderCapabilities {
  /**
   * Whether the provider allows forking your own repository
   */
  allowOwnRepoFork: boolean

  /**
   * Whether the provider allows multiple forks of the same repository
   */
  allowMultipleForks: boolean

  /**
   * Human-readable description of namespace/fork restrictions
   */
  namespaceRestriction: string | null

  /**
   * Whether the provider supports checking for existing forks
   */
  supportsForkChecking: boolean

  /**
   * Whether the provider supports renaming repositories
   */
  supportsRenaming: boolean

  /**
   * Whether the provider supports removing fork relationships
   */
  supportsForkRelationshipRemoval: boolean

  /**
   * URL pattern for repository settings/edit page (relative to repo URL)
   * Use {url} placeholder if the pattern needs the full URL, or just the path suffix
   * Example: "/settings" or "/-/edit" or "/-/settings"
   */
  settingsUrlPattern: string | null

  /**
   * URL pattern for fork settings page (relative to repo URL)
   * Use anchor/hash for specific sections if needed
   * Example: "/-/edit#js-project-fork-settings"
   */
  forkSettingsUrlPattern: string | null
}

/**
 * Provider capability registry
 * Add new providers here without modifying UI code
 */
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  github: {
    allowOwnRepoFork: false,
    allowMultipleForks: false,
    namespaceRestriction: "GitHub allows only one fork per account",
    supportsForkChecking: true,
    supportsRenaming: true,
    supportsForkRelationshipRemoval: false,
    settingsUrlPattern: "/settings",
    forkSettingsUrlPattern: null,
  },
  gitlab: {
    allowOwnRepoFork: true,
    allowMultipleForks: false,
    namespaceRestriction: "GitLab allows only one fork per namespace",
    supportsForkChecking: true,
    supportsRenaming: true,
    supportsForkRelationshipRemoval: true,
    settingsUrlPattern: "/edit",
    forkSettingsUrlPattern: "/edit#js-project-advanced-settings",
  },
  gitea: {
    allowOwnRepoFork: true,
    allowMultipleForks: false,
    namespaceRestriction: "Gitea allows only one fork per namespace",
    supportsForkChecking: false, // Not implemented yet
    supportsRenaming: true,
    supportsForkRelationshipRemoval: false,
    settingsUrlPattern: "/settings",
    forkSettingsUrlPattern: null,
  },
  bitbucket: {
    allowOwnRepoFork: true,
    allowMultipleForks: true,
    namespaceRestriction: null,
    supportsForkChecking: false, // Not implemented yet
    supportsRenaming: true,
    supportsForkRelationshipRemoval: false,
    settingsUrlPattern: "/admin",
    forkSettingsUrlPattern: null,
  },
  grasp: {
    allowOwnRepoFork: true,
    allowMultipleForks: true,
    namespaceRestriction: null,
    supportsForkChecking: false, // Event-based system, no pre-check needed
    supportsRenaming: false, // Event-based system, different model
    supportsForkRelationshipRemoval: false,
    settingsUrlPattern: null,
    forkSettingsUrlPattern: null,
  },
  generic: {
    allowOwnRepoFork: true,
    allowMultipleForks: true,
    namespaceRestriction: null,
    supportsForkChecking: false,
    supportsRenaming: false,
    supportsForkRelationshipRemoval: false,
    settingsUrlPattern: null,
    forkSettingsUrlPattern: null,
  },
}

/**
 * Get provider capabilities
 * Falls back to generic if provider not found
 */
export function getProviderCapabilities(provider: string): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.generic
}

/**
 * Map service host to provider name
 */
export const SERVICE_TO_PROVIDER: Record<string, string> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
  grasp: "grasp",
}

/**
 * Get provider name from service host
 */
export function getProviderFromService(service: string): string {
  return SERVICE_TO_PROVIDER[service] || "generic"
}

/**
 * Build a URL by appending a path pattern to a base URL
 * Handles trailing slashes and ensures proper URL construction
 */
export function buildProviderUrl(
  baseUrl: string | null | undefined,
  pathPattern: string | null,
): string | null {
  if (!baseUrl || !pathPattern) return null

  const trimmedBaseUrl = baseUrl.trim()
  if (!trimmedBaseUrl) return null

  // Remove trailing slash from base URL if present
  const normalizedBase = trimmedBaseUrl.replace(/\/$/, "")
  // Ensure path pattern starts with /
  const normalizedPath = pathPattern.startsWith("/") ? pathPattern : `/${pathPattern}`

  return `${normalizedBase}${normalizedPath}`
}
