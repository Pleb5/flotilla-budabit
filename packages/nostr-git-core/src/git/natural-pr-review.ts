import type {
  GitNaturalDiffBetweenResult,
  GitNaturalDiffChange,
  GitNaturalListCommitsResult,
  GitNaturalResolveRefResult,
} from "./natural-read-provider.js"
import type {GitNaturalCommit} from "./natural-read-types.js"
import {
  filterValidCloneUrls,
  orderReadUrlsByPreference,
  type ReadFallbackResult,
  type UrlAttemptResult,
  withUrlFallback,
} from "../utils/clone-url-fallback.js"

export interface GitNaturalPRReviewReader {
  resolveRef(params: {
    url: string
    ref: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalResolveRefResult>
  listCommits(params: {
    url: string
    commitHash: string
    depth: number
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalListCommitsResult>
  getDiffBetween(params: {
    url: string
    baseCommitHash: string
    headCommitHash: string
    corsProxy?: string | null
    signal?: AbortSignal
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
  sourceAttempts?: GitNaturalPRReviewUrlAttempt[]
  targetAttempts?: GitNaturalPRReviewUrlAttempt[]
  readSource?: GitNaturalDiffBetweenResult["source"]
}

export type GitNaturalPRReviewUrlAttempt = Omit<UrlAttemptResult, "result">

export interface GitNaturalPRReviewAttempts {
  sourceAttempts: GitNaturalPRReviewUrlAttempt[]
  targetAttempts: GitNaturalPRReviewUrlAttempt[]
}

export interface GetGitNaturalPRReviewDataOptions {
  repoId: string
  tipCommitOid: string
  targetBranch?: string
  sourceUrls: string[]
  targetUrls?: string[]
  mergeBase?: string
  targetCommitOid?: string
  sourceReadScope?: string
  maxCommits?: number
  corsProxy?: string | null
  onAttempts?: (attempts: GitNaturalPRReviewAttempts) => void
  reader: GitNaturalPRReviewReader
}

const DEFAULT_PR_NATURAL_MAX_COMMITS = 100

export async function getGitNaturalPRReviewData(
  options: GetGitNaturalPRReviewDataOptions,
): Promise<GitNaturalPRReviewData | null> {
  const tipCommitOid = normalizeFullOid(options.tipCommitOid)
  if (!tipCommitOid) return null

  const sourceUrls = normalizeHttpUrls(options.sourceUrls, options.repoId, options.sourceReadScope)
  const targetUrls = normalizeHttpUrls(options.targetUrls || [], options.repoId)
  if (sourceUrls.length === 0) return null

  const maxCommits = Math.max(1, options.maxCommits ?? DEFAULT_PR_NATURAL_MAX_COMMITS)
  const sourceHistory = await tryListCommits(options.reader, sourceUrls, {
    repoId: options.repoId,
    readScope: options.sourceReadScope,
    commitHash: tipCommitOid,
    depth: maxCommits,
    corsProxy: options.corsProxy,
  })
  const sourceAttempts = summarizeAttempts(sourceHistory.attempts)
  const targetAttempts: GitNaturalPRReviewUrlAttempt[] = []
  const reportAttempts = () =>
    options.onAttempts?.({
      sourceAttempts: [...sourceAttempts],
      targetAttempts: [...targetAttempts],
    })
  if (!sourceHistory.result?.commits?.length) {
    reportAttempts()
    return null
  }
  let usedCloneUrl = latestAttemptUrl(sourceHistory)

  const providedMergeBase = normalizeFullOid(options.mergeBase)
  let targetCommit = normalizeFullOid(options.targetCommitOid)
  let usedTargetCloneUrl: string | undefined
  if (!targetCommit && options.targetBranch && targetUrls.length > 0) {
    const target = await tryResolveRef(options.reader, targetUrls, {
      repoId: options.repoId,
      ref: options.targetBranch,
      corsProxy: options.corsProxy,
    })
    targetAttempts.push(...summarizeAttempts(target.attempts))
    usedTargetCloneUrl = latestAttemptUrl(target)
    targetCommit = target.result?.commitHash
  }

  let targetHistory: ReadFallbackResult<GitNaturalListCommitsResult> | null = null
  let computedMergeBase: string | undefined
  if (targetCommit) {
    targetHistory = await tryListCommits(
      options.reader,
      targetUrls.length > 0 ? targetUrls : sourceUrls,
      {
        repoId: options.repoId,
        ...(targetUrls.length === 0 ? {readScope: options.sourceReadScope} : {}),
        commitHash: targetCommit,
        depth: maxCommits,
        corsProxy: options.corsProxy,
      },
    )
    if (targetUrls.length > 0) {
      targetAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedTargetCloneUrl = latestAttemptUrl(targetHistory) || usedTargetCloneUrl
    } else {
      sourceAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedCloneUrl = latestAttemptUrl(targetHistory) || usedCloneUrl
    }
    computedMergeBase = targetHistory.result
      ? findBestCommonCommit(
          sourceHistory.result.commits,
          targetHistory.result.commits,
          tipCommitOid,
          targetCommit,
        )
      : undefined
  }

  const baseOid = targetCommit ? computedMergeBase : providedMergeBase

  if (!baseOid) {
    reportAttempts()
    return null
  }

  const diffParams = {
    repoId: options.repoId,
    baseCommitHash: baseOid,
    headCommitHash: tipCommitOid,
    corsProxy: options.corsProxy,
  }
  const sourceDiff = await tryGetDiffBetween(options.reader, sourceUrls, {
    ...diffParams,
    readScope: options.sourceReadScope,
  })
  sourceAttempts.push(...summarizeAttempts(sourceDiff.attempts))
  usedCloneUrl = latestAttemptUrl(sourceDiff) || usedCloneUrl

  let diff = sourceDiff
  if (!diff.result && isTerminalCancellation(sourceDiff)) {
    reportAttempts()
    return null
  }
  if (!diff.result && targetUrls.length > 0) {
    diff = await tryGetDiffBetween(options.reader, targetUrls, diffParams)
    targetAttempts.push(...summarizeAttempts(diff.attempts))
    usedTargetCloneUrl = latestAttemptUrl(diff) || usedTargetCloneUrl
  }
  if (!diff.result) {
    reportAttempts()
    return null
  }

  const sourceReachable = commitsUntilBase(sourceHistory.result.commits, baseOid, tipCommitOid)
  const targetReachable = targetHistory?.result
    ? commitsUntilBase(targetHistory.result.commits, baseOid, targetCommit || baseOid)
    : []
  if (!sourceReachable || (targetHistory?.result && !targetReachable)) {
    reportAttempts()
    return null
  }
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
    ...(targetHistory?.result ? {behindCount: targetCommits.length} : {}),
    commits,
    commitOids: commits.map(commit => commit.oid),
    changes: diff.result.changes,
    source: "git-natural",
    ...(usedCloneUrl ? {usedCloneUrl} : {}),
    ...(usedTargetCloneUrl ? {usedTargetCloneUrl} : {}),
    sourceAttempts,
    targetAttempts,
    readSource: diff.result.source,
  }
}

function isTerminalCancellation(result: ReadFallbackResult): boolean {
  const lastAttempt = result.attempts[result.attempts.length - 1]
  const code = String(lastAttempt?.errorCode || "")
    .toLowerCase()
    .replace(/_/g, "-")
  return [
    "cancellation-unconfirmed",
    "operation-aborted",
    "aborterror",
    "abort-error",
    "abort-err",
    "err-aborted",
  ].includes(code)
}

function normalizeHttpUrls(urls: string[], repoId: string, readScope?: string): string[] {
  return orderReadUrlsByPreference(filterValidCloneUrls(urls), repoId, readScope).filter(url =>
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
  params: {repoId: string; readScope?: string; ref: string; corsProxy?: string | null},
): Promise<ReadFallbackResult<GitNaturalResolveRefResult>> {
  return withUrlFallback(
    urls,
    (url, signal) => reader.resolveRef({url, ref: params.ref, corsProxy: params.corsProxy, signal}),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 15000},
  )
}

async function tryListCommits(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {
    repoId: string
    readScope?: string
    commitHash: string
    depth: number
    corsProxy?: string | null
  },
): Promise<ReadFallbackResult<GitNaturalListCommitsResult>> {
  return withUrlFallback(
    urls,
    (url, signal) =>
      reader.listCommits({
        url,
        commitHash: params.commitHash,
        depth: params.depth,
        corsProxy: params.corsProxy,
        signal,
      }),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 15000},
  )
}

async function tryGetDiffBetween(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {
    repoId: string
    readScope?: string
    baseCommitHash: string
    headCommitHash: string
    corsProxy?: string | null
  },
): Promise<ReadFallbackResult<GitNaturalDiffBetweenResult>> {
  return withUrlFallback(
    urls,
    (url, signal) =>
      reader.getDiffBetween({
        url,
        baseCommitHash: params.baseCommitHash,
        headCommitHash: params.headCommitHash,
        corsProxy: params.corsProxy,
        signal,
      }),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0},
  )
}

function latestAttemptUrl(result: ReadFallbackResult): string | undefined {
  return result.attempts[result.attempts.length - 1]?.url || result.usedUrl
}

function summarizeAttempts<T>(attempts: UrlAttemptResult<T>[]): GitNaturalPRReviewUrlAttempt[] {
  return attempts.map(({url, success, error, errorCode, durationMs}) => ({
    url,
    success,
    ...(error ? {error} : {}),
    ...(errorCode ? {errorCode} : {}),
    ...(durationMs !== undefined ? {durationMs} : {}),
  }))
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
