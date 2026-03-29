/**
 * Direct REST API access for commit details
 * Bypasses the worker for repos with REST API support (GitHub, GitLab, etc.)
 */

import {getGitServiceApi, parseRepoUrl} from "@nostr-git/core"
import {filterValidCloneUrls, reorderUrlsByPreference, hasRestApiSupport} from "@nostr-git/core"

export interface CommitMeta {
  sha: string
  author: string
  email: string
  date: number
  message: string
  parents: string[]
}

export interface CommitDetails {
  success: boolean
  meta?: CommitMeta
  changes?: any[]
  diffAvailable?: boolean
  warning?: string
  stats?: {
    additions: number
    deletions: number
    total: number
  }
  error?: string
  source?: "rest-api" | "worker"
}

/**
 * Get commit details using REST API if available, otherwise return null
 * This should be tried BEFORE calling the worker
 */
export async function getCommitDetailsViaRestApi(
  cloneUrls: string[],
  commitId: string,
  repoId?: string,
): Promise<CommitDetails | null> {
  if (!cloneUrls?.length) {
    console.log("[commit-api] No clone URLs provided")
    return null
  }

  const validUrls = filterValidCloneUrls(cloneUrls)
  const orderedUrls = reorderUrlsByPreference(validUrls, repoId)

  console.log("[commit-api] Checking URLs for REST API support:", {
    original: cloneUrls,
    valid: validUrls,
    ordered: orderedUrls,
  })

  // Try each URL that supports REST API
  for (const url of orderedUrls) {
    if (!hasRestApiSupport(url)) {
      console.log(`[commit-api] URL ${url} does not support REST API, skipping`)
      continue
    }

    try {
      console.log(`[commit-api] Trying REST API for ${url}`)
      const parsed = parseRepoUrl(url)
      if (!parsed) {
        console.warn(`[commit-api] Failed to parse URL: ${url}`)
        continue
      }

      const {owner, repo, provider} = parsed
      console.log(`[commit-api] Parsed: owner=${owner}, repo=${repo}, provider=${provider}`)

      // Use empty token for public repo access
      const api = getGitServiceApi(provider, "")
      const commitData = await api.getCommit(owner, repo, commitId)

      console.log(`[commit-api] REST API success for commit ${commitId}`)

      return {
        success: true,
        meta: {
          sha: commitData.sha,
          author: commitData.author.name,
          email: commitData.author.email,
          date: new Date(commitData.author.date).getTime(),
          message: commitData.message,
          parents: commitData.parents?.map((p: any) => p.sha) || [],
        },
        changes: [], // REST API doesn't provide detailed diffs
        diffAvailable: false,
        warning: "Commit metadata loaded from REST API. Loading full git diff...",
        stats: commitData.stats
          ? {
              additions: Number(commitData.stats.additions || 0),
              deletions: Number(commitData.stats.deletions || 0),
              total: Number(commitData.stats.total || 0),
            }
          : undefined,
        source: "rest-api",
      }
    } catch (error) {
      console.warn(`[commit-api] REST API failed for ${url}:`, error)
      // Continue to next URL
    }
  }

  console.log("[commit-api] No REST API URLs succeeded, caller should try worker")
  return null
}
