/**
 * Direct REST API access for commit details
 * Bypasses the worker for repos with REST API support (GitHub, GitLab, etc.)
 */

import {getGitServiceApi, parseRepoUrl} from "@nostr-git/core"
import {
  filterValidCloneUrls,
  hasRestApiSupport,
  orderReadUrlsByPreference,
  withUrlFallback,
} from "@nostr-git/core"

function getRestApiBaseUrl(provider: string, host?: string): string | undefined {
  const hostname = String(host || "")
    .trim()
    .toLowerCase()
  if (!hostname) return undefined

  switch (provider) {
    case "github":
      return hostname === "github.com" ? undefined : `https://${hostname}/api/v3`
    case "gitlab":
      return `https://${hostname}/api/v4`
    case "gitea":
      return `https://${hostname}/api/v1`
    case "bitbucket":
      return hostname === "bitbucket.org" ? undefined : `https://${hostname}/api/2.0`
    default:
      return undefined
  }
}

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
  source?: "git-natural" | "rest-api" | "worker"
  remoteUrl?: string
  metadataRemoteUrl?: string
  fallbackReason?: "missing-filter-capability"
  fallbackUrl?: string
}

type GitNaturalCommitWorker = {
  gitNaturalGetCommit(params: {
    url: string
    commitHash: string
    enabled: true
    corsProxy?: string | null
    timeoutMs?: number
  }): Promise<any>
  gitNaturalGetDiffBetween(params: {
    url: string
    baseCommitHash: string
    headCommitHash: string
    enabled: true
    corsProxy?: string | null
    timeoutMs?: number
  }): Promise<any>
}

function naturalCommitToMeta(commit: any, fallbackSha: string): CommitMeta {
  const timestamp = Number(commit?.author?.timestamp || 0)
  return {
    sha: String(commit?.hash || fallbackSha),
    author: String(commit?.author?.name || "Unknown"),
    email: String(commit?.author?.email || ""),
    date: Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now(),
    message: String(commit?.message || ""),
    parents: Array.isArray(commit?.parents)
      ? commit.parents.map((parent: any) => String(parent))
      : [],
  }
}

function statsFromChanges(changes: any[]): CommitDetails["stats"] {
  let additions = 0
  let deletions = 0

  for (const change of changes || []) {
    for (const hunk of change?.diffHunks || []) {
      for (const patch of hunk?.patches || []) {
        if (patch?.type === "+" || patch?.type === "add") additions += 1
        if (patch?.type === "-" || patch?.type === "del") deletions += 1
      }
    }
  }

  return {additions, deletions, total: additions + deletions}
}

export async function getCommitDetailsViaGitNatural(
  workerManager: GitNaturalCommitWorker,
  cloneUrls: string[],
  commitId: string,
  repoId?: string,
  sameRemoteFallback?: (url: string, meta?: CommitMeta) => Promise<CommitDetails | null>,
): Promise<CommitDetails | null> {
  if (!cloneUrls?.length) {
    console.log("[commit-api] No clone URLs provided for Git natural commit details")
    return null
  }

  const validUrls = filterValidCloneUrls(cloneUrls)

  console.debug("[commit-api] Checking URLs for Git natural commit details:", {
    original: cloneUrls,
    valid: validUrls,
  })

  let lastMeta: CommitMeta | undefined
  let lastMetaUrl: string | undefined
  const result = await withUrlFallback<CommitDetails>(
    validUrls,
    async url => {
      let meta: CommitMeta | undefined
      try {
        console.debug(`[commit-api] Trying Git natural commit details for ${url}`)
        const commitResult = await workerManager.gitNaturalGetCommit({
          url,
          commitHash: commitId,
          enabled: true,
          timeoutMs: 15_000,
        })
        const commit = commitResult?.commit
        if (!commit) throw new Error("Git natural did not return a commit object")

        meta = naturalCommitToMeta(commit, commitId)
        lastMeta = meta
        lastMetaUrl = url
        const firstParent = meta.parents[0]
        if (!firstParent) {
          return {
            success: true,
            meta,
            changes: [],
            diffAvailable: false,
            warning:
              "Commit metadata loaded from Git natural. Root commit diff is not available yet.",
            source: "git-natural",
            remoteUrl: url,
          }
        }

        const diffResult = await workerManager.gitNaturalGetDiffBetween({
          url,
          baseCommitHash: firstParent,
          headCommitHash: meta.sha,
          enabled: true,
        })
        const changes = Array.isArray(diffResult?.changes) ? diffResult.changes : []
        console.log(`[commit-api] Git natural commit details success for ${commitId}`)
        return {
          success: true,
          meta,
          changes,
          diffAvailable: true,
          stats: statsFromChanges(changes),
          source: "git-natural",
          remoteUrl: url,
        } satisfies CommitDetails
      } catch (error) {
        if ((error as {code?: string})?.code !== "missing-filter-capability") throw error
        if (!sameRemoteFallback) throw error

        const fallback = await sameRemoteFallback(url, meta)
        if (!fallback?.success) {
          throw new Error(fallback?.error || `Clone-backed commit fallback failed for ${url}`)
        }
        return {
          ...fallback,
          fallbackReason: "missing-filter-capability",
          fallbackUrl: url,
          remoteUrl: fallback.remoteUrl || url,
        }
      }
    },
    {repoId, perUrlTimeoutMs: 0},
  )

  if (result.success && result.result) {
    return result.result
  }

  const lastAttempt = result.attempts[result.attempts.length - 1]
  const missingFilter = lastAttempt?.errorCode === "missing-filter-capability"
  console.debug("[commit-api] No Git natural commit detail URLs succeeded", result.attempts)

  if (lastMeta) {
    return {
      success: true,
      meta: lastMeta,
      changes: [],
      diffAvailable: false,
      warning: "Commit metadata loaded from Git natural, but the diff could not be loaded.",
      source: "git-natural",
      metadataRemoteUrl: lastMetaUrl,
      ...(missingFilter
        ? {fallbackReason: "missing-filter-capability" as const, fallbackUrl: lastAttempt.url}
        : {}),
    }
  }

  return {
    success: false,
    error: lastAttempt?.error || "Git natural commit details failed for all eligible remotes",
    ...(missingFilter
      ? {fallbackReason: "missing-filter-capability" as const, fallbackUrl: lastAttempt.url}
      : {}),
  }
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
  const orderedUrls = orderReadUrlsByPreference(validUrls, repoId)

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

      const {owner, repo, provider, host} = parsed
      console.log(`[commit-api] Parsed: owner=${owner}, repo=${repo}, provider=${provider}`)

      // Use empty token for public repo access
      const api = getGitServiceApi(provider, "", getRestApiBaseUrl(provider, host))
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
