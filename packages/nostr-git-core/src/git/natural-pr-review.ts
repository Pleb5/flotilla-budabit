import type {
  GitNaturalDiffBetweenResult,
  GitNaturalDiffChange,
  GitNaturalListCommitsResult,
  GitNaturalResolveRefResult,
} from "./natural-read-provider.js"
import type {GitNaturalCommit} from "./natural-read-types.js"
import {filterValidCloneUrls, reorderUrlsByPreference} from "../utils/clone-url-fallback.js"

export interface GitNaturalPRReviewReader {
  resolveRef(params: {
    url: string
    ref: string
    corsProxy?: string | null
  }): Promise<GitNaturalResolveRefResult>
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
  claimedMergeBase?: string
  claimedMergeBaseMismatch?: boolean
  aheadCount?: number
  behindCount?: number
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

  if (!targetCommit && options.targetBranch && targetUrls.length > 0) {
    const target = await tryResolveRef(options.reader, targetUrls, {
      ref: options.targetBranch,
      corsProxy: options.corsProxy,
    })
    targetCommit = target?.result.commitHash
    usedTargetCloneUrl = target?.usedUrl
  }

  let targetHistory: UrlResult<GitNaturalListCommitsResult> | null = null
  let computedMergeBase: string | undefined
  if (targetCommit) {
    targetHistory = await tryListCommits(
      options.reader,
      targetUrls.length > 0 ? targetUrls : diffUrls,
      {
        commitHash: targetCommit,
        depth: maxCommits,
        corsProxy: options.corsProxy,
      },
    )
    if (!usedTargetCloneUrl) usedTargetCloneUrl = targetHistory?.usedUrl
    computedMergeBase = targetHistory
      ? findBestCommonCommit(
          sourceHistory.result.commits,
          targetHistory.result.commits,
          tipCommitOid,
          targetCommit,
        )
      : undefined
  }

  const baseOid = targetCommit ? computedMergeBase : providedMergeBase

  if (!baseOid) return null

  const diff = await tryGetDiffBetween(options.reader, diffUrls, {
    baseCommitHash: baseOid,
    headCommitHash: tipCommitOid,
    corsProxy: options.corsProxy,
  })
  if (!diff) return null

  const sourceReachable = commitsUntilBase(sourceHistory.result.commits, baseOid, tipCommitOid)
  const targetReachable = targetHistory
    ? commitsUntilBase(targetHistory.result.commits, baseOid, targetCommit || baseOid)
    : []
  if (!sourceReachable || (targetHistory && !targetReachable)) return null
  const resolvedTargetReachable = targetReachable || []
  const sourceIds = new Set(sourceReachable.map(commit => commit.oid))
  const targetIds = new Set(resolvedTargetReachable.map(commit => commit.oid))
  const commits = sourceReachable.filter(commit => !targetIds.has(commit.oid))
  const targetCommits = resolvedTargetReachable.filter(commit => !sourceIds.has(commit.oid))
  const claimedMergeBaseMismatch = Boolean(providedMergeBase && providedMergeBase !== baseOid)

  return {
    success: true,
    baseOid,
    headOid: tipCommitOid,
    ...(targetCommit ? {targetCommit} : {}),
    mergeBase: baseOid,
    ...(providedMergeBase ? {claimedMergeBase: providedMergeBase} : {}),
    ...(claimedMergeBaseMismatch ? {claimedMergeBaseMismatch: true} : {}),
    aheadCount: commits.length,
    ...(targetHistory ? {behindCount: targetCommits.length} : {}),
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
  return reorderUrlsByPreference(filterValidCloneUrls(urls), repoId).filter(url =>
    /^https?:\/\//i.test(url),
  )
}

function normalizeFullOid(value?: string): string | undefined {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
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
): GitNaturalPRReviewData["commits"] | null {
  const graph = new Map(commits.map(commit => [commit.hash, commit]))
  const reachable = new Set<string>()
  const pending = [tipOid]
  let reachedBase = tipOid === baseOid
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (oid === baseOid) {
      reachedBase = true
      continue
    }
    if (reachable.has(oid)) continue
    const commit = graph.get(oid)
    if (!commit) return null
    reachable.add(oid)
    pending.push(...(commit.parents || []))
  }
  if (!reachedBase) return null

  return commits.filter(commit => reachable.has(commit.hash)).map(naturalCommitToReviewCommit)
}

function naturalCommitToReviewCommit(
  commit: GitNaturalCommit,
): GitNaturalPRReviewData["commits"][number] {
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

function getGraphDistance(
  graph: Map<string, GitNaturalCommit>,
  tipOid: string,
  targetOid: string,
): number | undefined {
  const pending: Array<{oid: string; distance: number}> = [{oid: tipOid, distance: 0}]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const current = pending.shift()!
    if (current.oid === targetOid) return current.distance
    if (seen.has(current.oid)) continue
    seen.add(current.oid)
    const commit = graph.get(current.oid)
    if (!commit) continue
    pending.push(...(commit.parents || []).map(oid => ({oid, distance: current.distance + 1})))
  }
  return undefined
}

function findBestCommonCommit(
  sourceCommits: GitNaturalCommit[],
  targetCommits: GitNaturalCommit[],
  sourceTip: string,
  targetTip: string,
): string | undefined {
  const sourceGraph = new Map(sourceCommits.map(commit => [commit.hash, commit]))
  const targetGraph = new Map(targetCommits.map(commit => [commit.hash, commit]))
  const targetHashes = new Set(targetCommits.map(commit => commit.hash))
  const candidates = sourceCommits
    .filter(commit => targetHashes.has(commit.hash))
    .map(commit => ({
      oid: commit.hash,
      sourceDistance: getGraphDistance(sourceGraph, sourceTip, commit.hash),
      targetDistance: getGraphDistance(targetGraph, targetTip, commit.hash),
    }))
    .filter(
      (candidate): candidate is {oid: string; sourceDistance: number; targetDistance: number} =>
        candidate.sourceDistance !== undefined && candidate.targetDistance !== undefined,
    )

  return candidates
    .filter(
      candidate =>
        !candidates.some(
          other =>
            other.oid !== candidate.oid &&
            (getGraphDistance(sourceGraph, other.oid, candidate.oid) !== undefined ||
              getGraphDistance(targetGraph, other.oid, candidate.oid) !== undefined),
        ),
    )
    .sort(
      (left, right) =>
        Math.max(left.sourceDistance, left.targetDistance) -
          Math.max(right.sourceDistance, right.targetDistance) ||
        left.sourceDistance + left.targetDistance - (right.sourceDistance + right.targetDistance) ||
        (left.oid < right.oid ? -1 : left.oid > right.oid ? 1 : 0),
    )[0]?.oid
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
