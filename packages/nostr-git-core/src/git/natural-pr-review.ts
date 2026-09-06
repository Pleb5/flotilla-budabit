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
  /** Maximum unique commits loaded per side before returning an unresolved result. */
  maxCommits?: number
  /** Maximum commits requested in one frontier expansion. */
  historyBatchSize?: number
  corsProxy?: string | null
  onAttempts?: (attempts: GitNaturalPRReviewAttempts) => void
  reader: GitNaturalPRReviewReader
}

const DEFAULT_PR_NATURAL_MAX_COMMITS = 5_000
const DEFAULT_PR_NATURAL_HISTORY_BATCH_SIZE = 100

interface ExpandedNaturalHistory {
  commits: GitNaturalCommit[]
  graph: Map<string, GitNaturalCommit>
  unresolvedParentOids: string[]
  complete: boolean
  attempts: UrlAttemptResult<GitNaturalListCommitsResult>[]
  usedUrl?: string
}

export async function getGitNaturalPRReviewData(
  options: GetGitNaturalPRReviewDataOptions,
): Promise<GitNaturalPRReviewData | null> {
  const tipCommitOid = normalizeFullOid(options.tipCommitOid)
  if (!tipCommitOid) return null

  const sourceUrls = normalizeHttpUrls(options.sourceUrls, options.repoId, options.sourceReadScope)
  const targetUrls = normalizeHttpUrls(options.targetUrls || [], options.repoId)
  if (sourceUrls.length === 0) return null

  const maxCommits = Math.max(1, options.maxCommits ?? DEFAULT_PR_NATURAL_MAX_COMMITS)
  const historyBatchSize = Math.max(
    1,
    Math.min(maxCommits, options.historyBatchSize ?? DEFAULT_PR_NATURAL_HISTORY_BATCH_SIZE),
  )
  const sourceHistory = await expandNaturalHistory(options.reader, sourceUrls, {
    repoId: options.repoId,
    readScope: options.sourceReadScope,
    commitHash: tipCommitOid,
    maxCommits,
    batchSize: historyBatchSize,
    corsProxy: options.corsProxy,
  })
  const sourceAttempts = summarizeAttempts(sourceHistory.attempts)
  const targetAttempts: GitNaturalPRReviewUrlAttempt[] = []
  const reportAttempts = () =>
    options.onAttempts?.({
      sourceAttempts: [...sourceAttempts],
      targetAttempts: [...targetAttempts],
    })
  if (!sourceHistory.complete || sourceHistory.commits.length === 0) {
    reportAttempts()
    return null
  }
  let usedCloneUrl = sourceHistory.usedUrl

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

  let targetHistory: ExpandedNaturalHistory | null = null
  let computedMergeBase: string | undefined
  if (targetCommit) {
    targetHistory = await expandNaturalHistory(
      options.reader,
      targetUrls.length > 0 ? targetUrls : sourceUrls,
      {
        repoId: options.repoId,
        ...(targetUrls.length === 0 ? {readScope: options.sourceReadScope} : {}),
        commitHash: targetCommit,
        maxCommits,
        batchSize: historyBatchSize,
        corsProxy: options.corsProxy,
      },
    )
    if (targetUrls.length > 0) {
      targetAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedTargetCloneUrl = targetHistory.usedUrl || usedTargetCloneUrl
    } else {
      sourceAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedCloneUrl = targetHistory.usedUrl || usedCloneUrl
    }
    if (!targetHistory.complete) {
      reportAttempts()
      return null
    }
    computedMergeBase = targetHistory.commits.length
      ? findBestCommonCommit(
          sourceHistory.commits,
          targetHistory.commits,
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

  const sourceIds = collectReachableOids(sourceHistory.graph, tipCommitOid)
  const targetIds = targetHistory
    ? collectReachableOids(targetHistory.graph, targetCommit || baseOid)
    : collectReachableOids(sourceHistory.graph, baseOid)
  if (!sourceIds || !targetIds || !sourceIds.has(baseOid) || !targetIds.has(baseOid)) {
    reportAttempts()
    return null
  }
  const commits = sourceHistory.commits
    .filter(commit => sourceIds.has(commit.hash) && !targetIds.has(commit.hash))
    .map(naturalCommitToReviewCommit)
  const targetCommits = (targetHistory?.commits || []).filter(
    commit => targetIds.has(commit.hash) && !sourceIds.has(commit.hash),
  )
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
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0},
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
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0},
  )
}

async function expandNaturalHistory(
  reader: GitNaturalPRReviewReader,
  urls: string[],
  params: {
    repoId: string
    readScope?: string
    commitHash: string
    maxCommits: number
    batchSize: number
    corsProxy?: string | null
  },
): Promise<ExpandedNaturalHistory> {
  const graph = new Map<string, GitNaturalCommit>()
  const commits: GitNaturalCommit[] = []
  const attempts: UrlAttemptResult<GitNaturalListCommitsResult>[] = []
  const pending = [params.commitHash]
  const requestedFrontiers = new Set<string>()
  let usedUrl: string | undefined

  while (pending.length > 0 && graph.size < params.maxCommits) {
    const frontier = pending.shift()!
    if (graph.has(frontier) || requestedFrontiers.has(frontier)) continue
    requestedFrontiers.add(frontier)

    const remaining = params.maxCommits - graph.size
    const result = await tryListCommits(reader, urls, {
      repoId: params.repoId,
      readScope: params.readScope,
      commitHash: frontier,
      depth: Math.min(params.batchSize, remaining),
      corsProxy: params.corsProxy,
    })
    attempts.push(...result.attempts)
    usedUrl = result.usedUrl || latestAttemptUrl(result) || usedUrl
    if (!result.result?.commits?.length) {
      return {
        commits,
        graph,
        unresolvedParentOids: uniqueOids([frontier, ...pending]),
        complete: false,
        attempts,
        usedUrl,
      }
    }

    for (const commit of result.result.commits) {
      const oid = normalizeFullOid(commit.hash)
      if (!oid || graph.has(oid)) continue
      graph.set(oid, commit)
      commits.push(commit)
    }
    if (!graph.has(frontier)) {
      return {
        commits,
        graph,
        unresolvedParentOids: uniqueOids([frontier, ...pending]),
        complete: false,
        attempts,
        usedUrl,
      }
    }

    const reportedFrontier = result.result.unresolvedParentOids || []
    const discoveredFrontier = result.result.commits.flatMap(commit => commit.parents || [])
    for (const parent of [...reportedFrontier, ...discoveredFrontier]) {
      const oid = normalizeFullOid(parent)
      if (oid && !graph.has(oid) && !requestedFrontiers.has(oid) && !pending.includes(oid)) {
        pending.push(oid)
      }
    }
  }

  const unresolvedParentOids = uniqueOids([
    ...pending,
    ...commits.flatMap(commit => commit.parents || []).filter(parent => !graph.has(parent)),
  ])
  return {
    commits,
    graph,
    unresolvedParentOids,
    complete: unresolvedParentOids.length === 0,
    attempts,
    usedUrl,
  }
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
  return attempts.map(({url, success, error, errorCode, status, durationMs}) => ({
    url,
    success,
    ...(error ? {error} : {}),
    ...(errorCode ? {errorCode} : {}),
    ...(status !== undefined ? {status} : {}),
    ...(durationMs !== undefined ? {durationMs} : {}),
  }))
}

function collectReachableOids(
  graph: Map<string, GitNaturalCommit>,
  tipOid: string,
): Set<string> | null {
  const reachable = new Set<string>()
  const pending = [tipOid]
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (reachable.has(oid)) continue
    const commit = graph.get(oid)
    if (!commit) return null
    reachable.add(oid)
    pending.push(...(commit.parents || []))
  }
  return reachable
}

function uniqueOids(oids: string[]): string[] {
  return Array.from(
    new Set(oids.map(normalizeFullOid).filter((oid): oid is string => Boolean(oid))),
  )
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
