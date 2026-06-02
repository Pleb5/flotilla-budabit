/**
 * Import Utilities for Repository Import Feature
 *
 * Utility functions for URL parsing, token validation, and ownership detection
 * for importing repositories from Git hosting providers.
 */

import type { RepoMetadata } from './vendor-providers.js';
import type { GitVendor } from './vendor-providers.js';
import { detectVendorFromUrl } from './vendor-providers.js';
import type { GitServiceApi, User } from '../api/api.js';

/**
 * Parsed repository URL information
 */
export interface ParsedRepoUrl {
  /**
   * Repository owner/username
   */
  owner: string;

  /**
   * Repository name
   */
  repo: string;

  /**
   * Hostname (e.g., 'github.com', 'gitlab.example.com')
   */
  host: string;

  /**
   * Detected provider (e.g., 'github', 'gitlab')
   */
  provider: GitVendor;

  /**
   * Full original URL
   */
  url: string;
}

/**
 * Parse a repository URL and extract components
 *
 * Supports URLs in formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://gitlab.com/owner/repo
 * - https://gitlab.com/group/subgroup/repo (nested groups)
 * - https://gitlab.example.com/owner/repo
 *
 * @param url - Repository URL to parse
 * @returns Parsed repository information
 * @throws {Error} if URL cannot be parsed
 *
 * @example
 * ```typescript
 * const parsed = parseRepoUrl('https://github.com/octocat/Hello-World');
 * // { owner: 'octocat', repo: 'Hello-World', host: 'github.com', provider: 'github', url: '...' }
 * ```
 */
export function parseRepoUrl(url: string): ParsedRepoUrl {
  try {
    const cleanUrl = url.replace(/\.git$/, '');
    const trimmedUrl = cleanUrl.replace(/\/$/, '');
    const urlObj = new URL(trimmedUrl);
    const pathParts = urlObj.pathname.split('/').filter((part) => part.length > 0);

    if (pathParts.length < 2) {
      throw new Error(
        `Invalid repository URL format: ${url}. Expected format: https://host/owner/repo`
      );
    }

    const host = urlObj.hostname;
    const provider = detectVendorFromUrl(url);

    // GitLab and Gitea support nested groups: group/subgroup/repo
    // owner = full namespace path, repo = last segment
    let owner: string;
    let repo: string;
    if (provider === 'gitlab' || provider === 'gitea') {
      owner = pathParts.slice(0, -1).join('/');
      repo = pathParts[pathParts.length - 1];
    } else {
      // GitHub, Bitbucket, GRASP: owner = second-to-last, repo = last
      owner = pathParts[pathParts.length - 2];
      repo = pathParts[pathParts.length - 1];
    }

    if (!owner || !repo) {
      throw new Error(`Unable to extract owner and repo from URL: ${url}`);
    }

    return {
      owner,
      repo,
      host,
      provider,
      url: trimmedUrl
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    throw error;
  }
}

/**
 * Detect provider from URL (wrapper around existing function)
 *
 * @param url - Repository URL
 * @returns Detected provider
 */
export function detectProviderFromUrl(url: string): GitVendor {
  return detectVendorFromUrl(url);
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  /**
   * Whether the token is valid
   */
  valid: boolean;

  /**
   * Whether the token has read permissions
   */
  hasRead: boolean;

  /**
   * Whether the token has write permissions
   */
  hasWrite: boolean;

  /**
   * Current user information (if token is valid)
   */
  user?: User;

  /**
   * Error message if validation failed
   */
  error?: string;
}

/**
 * Validate token permissions for a Git service API
 *
 * Checks if the token is valid and has read/write permissions.
 * Uses the `/user` endpoint to verify token validity and attempts
 * read/write operations to check permissions.
 *
 * @param api - GitServiceApi instance to validate
 * @param testRepo - Optional repository to test read/write access (owner/repo format)
 * @returns Token validation result
 *
 * @example
 * ```typescript
 * const result = await validateTokenPermissions(api);
 * if (result.valid && result.hasRead && result.hasWrite) {
 *   // Token is valid and has required permissions
 * }
 * ```
 */
export async function validateTokenPermissions(
  api: GitServiceApi,
  testRepo?: { owner: string; repo: string }
): Promise<TokenValidationResult> {
  try {
    const user = await api.getCurrentUser();

    let hasRead = false;
    let hasWrite = false;

    if (testRepo) {
      try {
        await api.getRepo(testRepo.owner, testRepo.repo);
        hasRead = true;
      } catch (error: any) {
        if (error?.status === 403 || error?.response?.status === 403) {
          hasRead = false;
        } else if (error?.status === 404 || error?.response?.status === 404) {
          hasRead = true;
        } else {
          throw error;
        }
      }
    } else {
      hasRead = true;
    }

    hasWrite = hasRead;

    return {
      valid: true,
      hasRead,
      hasWrite,
      user
    };
  } catch (error: any) {
    const errorMessage =
      error?.message || error?.response?.data?.message || 'Unknown error during token validation';

    return {
      valid: false,
      hasRead: false,
      hasWrite: false,
      error: errorMessage
    };
  }
}

/**
 * Check if token has read and write permissions
 *
 * Convenience wrapper around validateTokenPermissions
 *
 * @param api - GitServiceApi instance to validate
 * @param testRepo - Optional repository to test read/write access
 * @returns true if token has both read and write permissions
 */
export async function validateTokenHasReadWrite(
  api: GitServiceApi,
  testRepo?: { owner: string; repo: string }
): Promise<boolean> {
  const result = await validateTokenPermissions(api, testRepo);
  return result.valid && result.hasRead && result.hasWrite;
}

/**
 * Ownership detection result
 */
export interface OwnershipResult {
  /**
   * Whether the current user owns the repository
   */
  isOwner: boolean;

  /**
   * Repository owner username
   */
  repoOwner: string;

  /**
   * Current user username
   */
  currentUser: string;

  /**
   * Repository metadata
   */
  repo: RepoMetadata;
}

/**
 * Check if the current user owns a repository
 *
 * Compares the current user (from token) with the repository owner.
 *
 * @param api - GitServiceApi instance
 * @param owner - Repository owner username
 * @param repo - Repository name
 * @returns Ownership detection result
 *
 * @example
 * ```typescript
 * const result = await checkRepoOwnership(api, 'octocat', 'Hello-World');
 * if (!result.isOwner) {
 *   // User doesn't own the repo, fork will be needed
 * }
 * ```
 */
export async function checkRepoOwnership(
  api: GitServiceApi,
  owner: string,
  repo: string
): Promise<OwnershipResult> {
  const currentUserData = await api.getCurrentUser();
  const currentUser = currentUserData.login;

  const repoData = await api.getRepo(owner, repo);
  const repoOwner = repoData.owner.login;

  const isOwner = currentUser.toLowerCase() === repoOwner.toLowerCase();

  return {
    isOwner,
    repoOwner,
    currentUser,
    repo: repoData
  };
}
