// Multi-vendor Git provider system
// Supports GitHub, GitLab, Gitea, Bitbucket and generic Git providers

import {isGraspRelayUrl, isGraspRepoHttpUrl} from "../utils/grasp-url.js"
import {
  ENABLE_DIRECT_NOSTR_GIT_PROVIDER,
  assertDirectNostrGitProviderEnabled,
  assertGitVendorEnabled,
  isGitVendorEnabled,
} from "./provider-policy.js"

export type GitVendor =
  | "github"
  | "gitlab"
  | "gitea"
  | "forgejo"
  | "bitbucket"
  | "generic"
  | "grasp"
  | "grasp-rest"

export interface RepoMetadata {
  id: string
  name: string
  fullName: string
  description?: string
  topics?: string[]
  defaultBranch: string
  isPrivate: boolean
  cloneUrl: string
  htmlUrl: string
  owner: {
    login: string
    type: "User" | "Organization"
  }
  permissions?: RepoPermissions
}

export interface RepoPermissions {
  admin?: boolean
  push?: boolean
  pull?: boolean
  role?: string
  accessLevel?: number
}

export interface VendorProvider {
  readonly vendor: GitVendor
  readonly hostname: string

  // Repository operations
  getRepoMetadata(owner: string, repo: string, token?: string): Promise<RepoMetadata>
  createRepo(name: string, options: CreateRepoOptions, token: string): Promise<RepoMetadata>
  updateRepo(
    owner: string,
    repo: string,
    options: UpdateRepoOptions,
    token: string,
  ): Promise<RepoMetadata>
  deleteRepo(
    owner: string,
    repo: string,
    token: string,
    options?: {signal?: AbortSignal},
  ): Promise<void>
  forkRepo(owner: string, repo: string, forkName: string, token: string): Promise<RepoMetadata>

  // URL transformations
  getCloneUrl(owner: string, repo: string): string
  getApiUrl(path: string): string
  parseRepoUrl(url: string): {owner: string; repo: string} | null

  // Authentication
  getTokenKey(): string
  getAuthHeaders(token: string): Record<string, string>
}

export interface CreateRepoOptions {
  description?: string
  isPrivate?: boolean
  hasIssues?: boolean
  hasWiki?: boolean
  autoInit?: boolean
  licenseTemplate?: string
  gitignoreTemplate?: string
}

export interface UpdateRepoOptions {
  name?: string
  description?: string
  homepage?: string
  isPrivate?: boolean
  hasIssues?: boolean
  hasWiki?: boolean
  defaultBranch?: string
}

/**
 * Detect Git vendor from URL
 */
const configuredGitHosts = new Map<string, GitVendor>()

/** Shared across source inspection, REST factories and target selection. */
export function registerGitHost(host: string, vendor: GitVendor): void {
  configuredGitHosts.set(host.toLowerCase(), vendor)
}

export function clearGitHosts(): void {
  configuredGitHosts.clear()
}

export function gitUrlToHttp(value: string): URL | null {
  try {
    let input = value.trim()
    const scp = input.match(/^git@([^:/]+):(.+)$/)
    if (scp) input = `https://${scp[1]}/${scp[2]}`
    if (!input.includes("://")) input = `https://${input}`
    const parsed = new URL(input)
    if (parsed.protocol === "ssh:" && !parsed.password && (!parsed.username || parsed.username === "git")) {
      return new URL(`https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`)
    }
    return parsed
  } catch {
    return null
  }
}

export function detectVendorFromUrl(url: string): GitVendor {
  const parsed = gitUrlToHttp(url)
  const host = parsed?.hostname.toLowerCase() || ""
  const configured = configuredGitHosts.get(parsed?.host.toLowerCase() || host)
  if (configured) return configured

  if (host === "github.com") {
    return "github"
  } else if (host === "gitlab.com" || host.startsWith("gitlab.")) {
    return "gitlab"
  } else if (host === "codeberg.org" || host.startsWith("forgejo.")) {
    return "forgejo"
  } else if (host.startsWith("gitea.")) {
    return "gitea"
  } else if (host === "bitbucket.org" || host.startsWith("bitbucket.")) {
    return "bitbucket"
  } else if (isGraspRepoHttpUrl(url) || isGraspRelayUrl(url)) {
    return "grasp-rest"
  }

  return "generic"
}

/** Check whether policy permits Git operations against a remote URL. */
export function isGitRemoteUrlEnabled(url: string): boolean {
  if (/^nostr:(?:\/\/)?/i.test(url)) return ENABLE_DIRECT_NOSTR_GIT_PROVIDER
  return isGitVendorEnabled(detectVendorFromUrl(url))
}

/** Reject a disabled remote before any provider or transport can use it. */
export function assertGitRemoteUrlEnabled(url: string, operation?: string): void {
  if (/^nostr:(?:\/\/)?/i.test(url)) {
    assertDirectNostrGitProviderEnabled(operation)
    return
  }
  assertGitVendorEnabled(detectVendorFromUrl(url), operation)
}

/**
 * Extract hostname from Git URL
 */
export function extractHostname(url: string): string {
  try {
    // Handle SSH URLs like git@github.com:owner/repo.git
    if (url.startsWith("git@")) {
      const match = url.match(/git@([^:]+):/)
      return match ? match[1] : ""
    }

    // Handle HTTPS URLs
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return ""
  }
}

/**
 * Normalize Git URL to HTTPS format
 */
export function normalizeGitUrl(url: string): string {
  const parsed = gitUrlToHttp(url)
  if (!parsed) return url
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "") + ".git"
  return parsed.toString()
}
