import type {
  GitNaturalDiffBetweenResult,
  GitNaturalDiffChange,
  GitNaturalListCommitsResult,
  GitNaturalResolveRefResult,
} from "./natural-read-provider.js"
import type {GitNaturalCommit} from "./natural-read-types.js"
import {filterValidCloneUrls, reorderUrlsByPreference} from "../utils/clone-url-fallback.js"

export interface GitNaturalPRReviewReader {
  resolveRef(params: {url: string; ref: string; corsProxy?: string | null}): Promise<GitNaturalResolveRefResult>
  listCommits(params: {
    url: string
    commitHash: string
    depth: number
    corsProxy?: string | null
  }): Promise<GitNaturalListCommitsResult>
  getDiffBetween(params: {
    url: string
    baseCommitHash: string
    headCommitHash: string
    corsProxy?: string | null
  }): Promise<GitNaturalDiffBetweenResult>
}

export interface GitNaturalPRReviewData {
  success: true
  baseOid: string
  headOid: string
  targetCommit?: string
  mergeBase?: string
  commits: Array<{
    oid: string
    message: string
    author?: {name?: string; email?: string}
    parents?: string[]
  }>
  commitOids: string[]
  changes: GitNaturalDiffChange[]
  source: "git-natural"
  usedCloneUrl?: string
  usedTargetCloneUrl?: string
  readSource?: GitNaturalDiffBetweenResult["source"]
}

export interface GetGitNaturalPRReviewDataOptions {
  repoId: string
  tipCommitOid: string
  targetBranch?: string
  sourceUrls: string[]
  targetUrls?: string[]
  mergeBase?: string
  targetCommitOid?: string
  maxCommits?: number
  corsProxy?: string | null
  reader: GitNaturalPRReviewReader
}

interface UrlResult<T> {
  result: T
  usedUrl: string
}

const DEFAULT_PR_NATURAL_MAX_COMMITS = 100

export async function getGitNaturalPRReviewData(
  options: GetGitNaturalPRReviewDataOptions,
): Promise<GitNaturalPRReviewData | null> {
  const tipCommitOid = normalizeFullOid(options.tipCommitOid)
  if (!tipCommitOid) return null

  const sourceUrls = normalizeHttpUrls(options.sourceUrls, options.repoId)
  const targetUrls = normalizeHttpUrls(options.targetUrls || [], options.repoId)
  const diffUrls = uniqueStrings([...sourceUrls, ...targetUrls])
  if (sourceUrls.length === 0 || diffUrls.length === 0) return null

  const maxCommits = Math.max(1, options.maxCommits ?? DEFAULT_PR_NATURAL_MAX_COMMITS)
  const sourceHistory = await tryListCommits(options.reader, sourceUrls, {
    commitHash: tipCommitOid,
    depth: maxCommits,
    corsProxy: options.corsProxy,
  })
  if (!sourceHistory?.result.commits?.length) return null

  const providedMergeBase = normalizeFullOid(options.mergeBase)
  let targetCommit = normalizeFullOid(options.targetCommitOid)
  let usedTargetCloneUrl: string | undefined

  if (!providedMergeBase && !targetCommit && options.targetBranch && targetUrls.length > 0) {
    const target = await tryResolveRef(options.reader, targetUrls, {
      ref: options.targetBranch,
      corsProxy: options.corsProxy,
    })
    targetCommit = target?.result.commitHash
    usedTargetCloneUrl = target?.usedUrl
  }

  let baseOid = providedMergeBase
  if (!baseOid && targetCommit) {
    const targetHistory = await tryListCommits(options.reader, targetUrls.length > 0 ? targetUrls : diffUrls, {
      commitHash: targetCommit,
      depth: maxCommits,
      corsProxy: options.corsProxy,
    })
    if (!usedTargetCloneUrl) usedTargetCloneUrl = targetHistory?.usedUrl
    baseOid = targetHistory
      ? findFirstCommonCommit(sourceHistory.result.commits, targetHistory.result.commits)
      : undefined
  }

  if (!baseOid) return null

  const diff = await tryGetDiffBetween(options.reader, diffUrls, {
    baseCommitHash: baseOid,
    headCommitHash: tipCommitOid,
    corsProxy: options.corsProxy,
  })
  if (!diff) return null

  const commits = commitsUntilBase(sourceHistory.result.commits, baseOid, tipCommitOid)

  return {
    success: true,
    baseOid,
    headOid: tipCommitOid,
    ...(targetCommit ? {targetCommit} : {}),
    mergeBase: baseOid,
    commits,
    commitOids: commits.map(commit => commit.oid),
    changes: diff.result.changes,
    source: "git-natural",
    usedCloneUrl: sourceHistory.usedUrl,
    ...(usedTargetCloneUrl ? {usedTargetCloneUrl} : {}),
    readSource: diff.result.source,
  }
}

function normalizeHttpUrls(urls: string[], repoId: string): string[] {
  return reorderUrlsByPreference(filterValidCloneUrls(urls), repoId).filter(url => /^https?:\/\//i.test(url))
}

function normalizeFullOid(value?: string): string | undefined {
  const normalized = String(value || "").trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(normalized) ? normalized : undefined
}

async function tryResolveRef(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {ref: string; corsProxy?: string | null},
): Promise<UrlResult<GitNaturalResolveRefResult> | null> {
  for (const url of urls) {
    try {
      return {
        result: await reader.resolveRef({url, ref: params.ref, corsProxy: params.corsProxy}),
        usedUrl: url,
      }
    } catch {
      // Try the next remote.
    }
  }
  return null
}

async function tryListCommits(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {commitHash: string; depth: number; corsProxy?: string | null},
): Promise<UrlResult<GitNaturalListCommitsResult> | null> {
  for (const url of urls) {
    try {
      return {
        result: await reader.listCommits({
          url,
          commitHash: params.commitHash,
          depth: params.depth,
          corsProxy: params.corsProxy,
        }),
        usedUrl: url,
      }
    } catch {
      // Try the next remote.
    }
  }
  return null
}

async function tryGetDiffBetween(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {baseCommitHash: string; headCommitHash: string; corsProxy?: string | null},
): Promise<UrlResult<GitNaturalDiffBetweenResult> | null> {
  for (const url of urls) {
    try {
      return {
        result: await reader.getDiffBetween({
          url,
          baseCommitHash: params.baseCommitHash,
          headCommitHash: params.headCommitHash,
          corsProxy: params.corsProxy,
        }),
        usedUrl: url,
      }
    } catch {
      // Try the next remote.
    }
  }
  return null
}

function commitsUntilBase(
  commits: GitNaturalCommit[],
  baseOid: string,
  tipOid: string,
): GitNaturalPRReviewData["commits"] {
  const result: GitNaturalPRReviewData["commits"] = []
  for (const commit of commits) {
    if (commit.hash === baseOid) break
    result.push(naturalCommitToReviewCommit(commit))
  }

  if (result.length === 0 && tipOid !== baseOid) {
    const tip = commits.find(commit => commit.hash === tipOid)
    if (tip) result.push(naturalCommitToReviewCommit(tip))
  }

  return result
}

function naturalCommitToReviewCommit(commit: GitNaturalCommit): GitNaturalPRReviewData["commits"][number] {
  return {
    oid: commit.hash,
    message: commit.message || "",
    author: {
      name: commit.author?.name,
      email: commit.author?.email,
    },
    parents: Array.isArray(commit.parents) ? commit.parents : [],
  }
}

function findFirstCommonCommit(
  sourceCommits: GitNaturalCommit[],
  targetCommits: GitNaturalCommit[],
): string | undefined {
  const targetHashes = new Set(targetCommits.map(commit => commit.hash))
  return sourceCommits.find(commit => targetHashes.has(commit.hash))?.hash
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
