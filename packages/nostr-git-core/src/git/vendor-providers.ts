// Multi-vendor Git provider system
// Supports GitHub, GitLab, Gitea, Bitbucket and generic Git providers

import {isGraspRelayUrl, isGraspRepoHttpUrl} from "../utils/grasp-url.js"

export type GitVendor =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "generic"
  | "grasp"
  | "grasp-rest"

export interface RepoMetadata {
  id: string
  name: string
  fullName: string
  description?: string
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
  deleteRepo(owner: string, repo: string, token: string): Promise<void>
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
export function detectVendorFromUrl(url: string): GitVendor {
  const normalizedUrl = url.toLowerCase()

  if (isGraspRepoHttpUrl(url) || isGraspRelayUrl(url)) {
    return "grasp-rest"
  } else if (normalizedUrl.includes("github.com")) {
    return "github"
  } else if (normalizedUrl.includes("gitlab.com") || normalizedUrl.includes("gitlab.")) {
    return "gitlab"
  } else if (normalizedUrl.includes("gitea.")) {
    return "gitea"
  } else if (normalizedUrl.includes("bitbucket.org") || normalizedUrl.includes("bitbucket.")) {
    return "bitbucket"
  }

  return "generic"
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
  // Convert SSH to HTTPS
  if (url.startsWith("git@")) {
    const match = url.match(/git@([^:]+):(.+)\.git$/)
    if (match) {
      return `https://${match[1]}/${match[2]}.git`
    }
  }

  // Ensure .git suffix
  if (!url.endsWith(".git")) {
    return `${url}.git`
  }

  return url
}
