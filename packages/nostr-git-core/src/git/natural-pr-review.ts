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
  /** Maximum unique commits loaded across source and target before returning an unresolved result. */
  maxCommits?: number
  /** Maximum commits requested in one frontier expansion. */
  historyBatchSize?: number
  corsProxy?: string | null
  signal?: AbortSignal
  onAttempts?: (attempts: GitNaturalPRReviewAttempts) => void
  reader: GitNaturalPRReviewReader
}

const DEFAULT_PR_NATURAL_MAX_COMMITS = 5_000
const DEFAULT_PR_NATURAL_HISTORY_BATCH_SIZE = 100
const INITIAL_PR_NATURAL_HISTORY_BATCH_SIZE = 15

interface ExpandedNaturalHistory {
  commits: GitNaturalCommit[]
  graph: Map<string, GitNaturalCommit>
  unresolvedParentOids: string[]
  complete: boolean
  attempts: UrlAttemptResult<GitNaturalListCommitsResult>[]
  usedUrl?: string
}

interface NaturalHistoryTraversal extends ExpandedNaturalHistory {
  pending: string[]
  requestedFrontiers: Set<string>
}

interface ExpandedNaturalHistories {
  source: ExpandedNaturalHistory
  target: ExpandedNaturalHistory
  complete: boolean
}

export async function getGitNaturalPRReviewData(
  options: GetGitNaturalPRReviewDataOptions,
): Promise<GitNaturalPRReviewData | null> {
  const tipCommitOid = normalizeFullOid(options.tipCommitOid)
  if (!tipCommitOid) return null
  options.signal?.throwIfAborted()

  const sourceUrls = normalizeHttpUrls(options.sourceUrls, options.repoId, options.sourceReadScope)
  const targetUrls = normalizeHttpUrls(options.targetUrls || [], options.repoId)
  if (sourceUrls.length === 0) return null

  const maxCommits = Math.max(1, options.maxCommits ?? DEFAULT_PR_NATURAL_MAX_COMMITS)
  const historyBatchSize = Math.max(
    1,
    Math.min(maxCommits, options.historyBatchSize ?? DEFAULT_PR_NATURAL_HISTORY_BATCH_SIZE),
  )
  const sourceAttempts: GitNaturalPRReviewUrlAttempt[] = []
  const targetAttempts: GitNaturalPRReviewUrlAttempt[] = []
  const reportAttempts = () =>
    options.onAttempts?.({
      sourceAttempts: [...sourceAttempts],
      targetAttempts: [...targetAttempts],
    })
  let usedCloneUrl: string | undefined

  const providedMergeBase = normalizeFullOid(options.mergeBase)
  let targetCommit = normalizeFullOid(options.targetCommitOid)
  let usedTargetCloneUrl: string | undefined
  if (!targetCommit && options.targetBranch && targetUrls.length > 0) {
    const target = await tryResolveRef(options.reader, targetUrls, {
      repoId: options.repoId,
      ref: options.targetBranch,
      corsProxy: options.corsProxy,
      signal: options.signal,
    })
    targetAttempts.push(...summarizeAttempts(target.attempts))
    usedTargetCloneUrl = latestAttemptUrl(target)
    targetCommit = target.result?.commitHash
  }

  let sourceHistory: ExpandedNaturalHistory
  let targetHistory: ExpandedNaturalHistory | null = null
  let computedMergeBase: string | undefined
  if (targetCommit) {
    const histories = await expandNaturalHistories(
      options.reader,
      sourceUrls,
      {
        repoId: options.repoId,
        readScope: options.sourceReadScope,
        commitHash: tipCommitOid,
        maxCommits,
        batchSize: historyBatchSize,
        corsProxy: options.corsProxy,
        signal: options.signal,
      },
      targetUrls.length > 0 ? targetUrls : sourceUrls,
      {
        repoId: options.repoId,
        ...(targetUrls.length === 0 ? {readScope: options.sourceReadScope} : {}),
        commitHash: targetCommit,
        maxCommits,
        batchSize: historyBatchSize,
        corsProxy: options.corsProxy,
        signal: options.signal,
      },
    )
    sourceHistory = histories.source
    targetHistory = histories.target
    sourceAttempts.push(...summarizeAttempts(sourceHistory.attempts))
    usedCloneUrl = sourceHistory.usedUrl
    if (targetUrls.length > 0) {
      targetAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedTargetCloneUrl = targetHistory.usedUrl || usedTargetCloneUrl
    } else {
      sourceAttempts.push(...summarizeAttempts(targetHistory.attempts))
      usedCloneUrl = targetHistory.usedUrl || usedCloneUrl
    }
    if (!histories.complete || sourceHistory.commits.length === 0) {
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
  } else {
    sourceHistory = await expandNaturalHistory(options.reader, sourceUrls, {
      repoId: options.repoId,
      readScope: options.sourceReadScope,
      commitHash: tipCommitOid,
      maxCommits,
      batchSize: historyBatchSize,
      corsProxy: options.corsProxy,
      signal: options.signal,
    })
    sourceAttempts.push(...summarizeAttempts(sourceHistory.attempts))
    usedCloneUrl = sourceHistory.usedUrl
    if (!sourceHistory.complete || sourceHistory.commits.length === 0) {
      reportAttempts()
      return null
    }
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
    signal: options.signal,
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

  const sharedIds = targetHistory
    ? collectSharedReachableOids(sourceHistory.graph, targetHistory.graph)
    : undefined
  const sourceIds = targetHistory
    ? collectReachableExcludingOids(sourceHistory.graph, sharedIds!, tipCommitOid)
    : collectReachableOids(sourceHistory.graph, tipCommitOid)
  const targetIds = targetHistory
    ? collectReachableExcludingOids(targetHistory.graph, sharedIds!, targetCommit || baseOid)
    : collectReachableOids(sourceHistory.graph, baseOid)
  if (
    !sourceIds ||
    !targetIds ||
    (targetHistory
      ? !sourceHistory.graph.has(baseOid) || !targetHistory.graph.has(baseOid)
      : !sourceIds.has(baseOid) || !targetIds.has(baseOid))
  ) {
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

async function expandNaturalHistories(
  reader: GitNaturalPRReviewReader,
  sourceUrls: string[],
  sourceParams: {
    repoId: string
    readScope?: string
    commitHash: string
    maxCommits: number
    batchSize: number
    corsProxy?: string | null
    signal?: AbortSignal
  },
  targetUrls: string[],
  targetParams: {
    repoId: string
    readScope?: string
    commitHash: string
    maxCommits: number
    batchSize: number
    corsProxy?: string | null
    signal?: AbortSignal
  },
): Promise<ExpandedNaturalHistories> {
  const source = createNaturalHistoryTraversal(sourceParams.commitHash)
  const target = createNaturalHistoryTraversal(targetParams.commitHash)
  const uniqueCommits = new Set<string>()
  const requestedSharedFrontiers = new Set<string>()
  let nextSide: "source" | "target" = "source"
  let failed = false
  let resolved = false

  while (!failed && uniqueCommits.size < sourceParams.maxCommits) {
    pruneNaturalHistoryPending(source)
    pruneNaturalHistoryPending(target)
    const shared = collectSharedReachableOids(source.graph, target.graph)
    const sourceExclusive = collectExclusiveMissingFrontiers(
      source.graph,
      shared,
      sourceParams.commitHash,
    )
    const targetExclusive = collectExclusiveMissingFrontiers(
      target.graph,
      shared,
      targetParams.commitHash,
    )
    const commonFrontier = collectCommonFrontierState(source.graph, target.graph)

    if (
      commonFrontier.common.size > 0 &&
      sourceExclusive.size === 0 &&
      targetExclusive.size === 0
    ) {
      const sharedFrontier = commonFrontier.unresolvedComparisonOids.find(
        oid => !requestedSharedFrontiers.has(oid),
      )
      if (!sharedFrontier) {
        resolved = commonFrontier.unresolvedComparisonOids.length === 0
        failed = !resolved
        break
      }
      requestedSharedFrontiers.add(sharedFrontier)
      const result = await tryListCommits(reader, sourceUrls, {
        repoId: sourceParams.repoId,
        readScope: sourceParams.readScope,
        commitHash: sharedFrontier,
        depth: Math.min(sourceParams.batchSize, sourceParams.maxCommits - uniqueCommits.size),
        corsProxy: sourceParams.corsProxy,
        signal: sourceParams.signal,
      })
      source.attempts.push(...result.attempts)
      source.usedUrl = result.usedUrl || latestAttemptUrl(result) || source.usedUrl
      if (!result.result?.commits?.length) {
        failed = true
        break
      }
      addNaturalHistoryCommits(source, result.result.commits, uniqueCommits)
      addNaturalHistoryCommits(target, result.result.commits, uniqueCommits)
      if (!source.graph.has(sharedFrontier) || !target.graph.has(sharedFrontier)) {
        failed = true
      }
      continue
    }

    const sourceFrontier = selectNaturalHistoryFrontier(
      source,
      sourceExclusive,
      targetExclusive.size > 0,
    )
    const targetFrontier = selectNaturalHistoryFrontier(
      target,
      targetExclusive,
      sourceExclusive.size > 0,
    )
    if (!sourceFrontier && !targetFrontier) {
      resolved = true
      break
    }

    const useSource: boolean = Boolean(sourceFrontier) && (!targetFrontier || nextSide === "source")
    const traversal = useSource ? source : target
    const urls = useSource ? sourceUrls : targetUrls
    const params = useSource ? sourceParams : targetParams
    const frontier = (useSource ? sourceFrontier : targetFrontier)!
    nextSide = useSource ? "target" : "source"
    traversal.pending.splice(traversal.pending.indexOf(frontier), 1)
    traversal.requestedFrontiers.add(frontier)

    const result = await tryListCommits(reader, urls, {
      repoId: params.repoId,
      readScope: params.readScope,
      commitHash: frontier,
      depth: Math.min(
        traversal.requestedFrontiers.size === 1
          ? Math.min(params.batchSize, INITIAL_PR_NATURAL_HISTORY_BATCH_SIZE)
          : params.batchSize,
        params.maxCommits - uniqueCommits.size,
      ),
      corsProxy: params.corsProxy,
      signal: params.signal,
    })
    traversal.attempts.push(...result.attempts)
    traversal.usedUrl = result.usedUrl || latestAttemptUrl(result) || traversal.usedUrl
    if (!result.result?.commits?.length) {
      traversal.pending.unshift(frontier)
      failed = true
      break
    }

    addNaturalHistoryCommits(traversal, result.result.commits, uniqueCommits)
    if (!traversal.graph.has(frontier)) {
      traversal.pending.unshift(frontier)
      failed = true
      break
    }

    const discoveredParents = result.result.commits.flatMap(commit => commit.parents || [])
    for (const parent of [...(result.result.unresolvedParentOids || []), ...discoveredParents]) {
      const oid = normalizeFullOid(parent)
      if (
        oid &&
        !traversal.graph.has(oid) &&
        !traversal.requestedFrontiers.has(oid) &&
        !traversal.pending.includes(oid)
      ) {
        traversal.pending.push(oid)
      }
    }
  }

  const shared = collectSharedReachableOids(source.graph, target.graph)
  const sourceUnresolved = collectExclusiveMissingFrontiers(
    source.graph,
    shared,
    sourceParams.commitHash,
  )
  const targetUnresolved = collectExclusiveMissingFrontiers(
    target.graph,
    shared,
    targetParams.commitHash,
  )
  source.unresolvedParentOids = [...sourceUnresolved]
  target.unresolvedParentOids = [...targetUnresolved]
  source.complete = !failed && resolved && sourceUnresolved.size === 0
  target.complete = !failed && resolved && targetUnresolved.size === 0
  return {source, target, complete: source.complete && target.complete}
}

function addNaturalHistoryCommits(
  traversal: NaturalHistoryTraversal,
  commits: GitNaturalCommit[],
  uniqueCommits: Set<string>,
): void {
  for (const commit of commits) {
    const oid = normalizeFullOid(commit.hash)
    if (!oid) continue
    uniqueCommits.add(oid)
    if (traversal.graph.has(oid)) continue
    traversal.graph.set(oid, commit)
    traversal.commits.push(commit)
  }
}

function createNaturalHistoryTraversal(commitHash: string): NaturalHistoryTraversal {
  return {
    commits: [],
    graph: new Map(),
    unresolvedParentOids: [],
    complete: false,
    attempts: [],
    pending: [commitHash],
    requestedFrontiers: new Set(),
  }
}

function selectNaturalHistoryFrontier(
  traversal: NaturalHistoryTraversal,
  exclusive: Set<string>,
  needsSharedSupport: boolean,
): string | undefined {
  pruneNaturalHistoryPending(traversal)
  return (
    traversal.pending.find(oid => exclusive.has(oid)) ||
    (needsSharedSupport ? traversal.pending[0] : undefined)
  )
}

function pruneNaturalHistoryPending(traversal: NaturalHistoryTraversal): void {
  traversal.pending = traversal.pending.filter(
    oid => !traversal.graph.has(oid) && !traversal.requestedFrontiers.has(oid),
  )
}

function collectExclusiveMissingFrontiers(
  graph: Map<string, GitNaturalCommit>,
  shared: Set<string>,
  tipOid: string,
): Set<string> {
  const missing = new Set<string>()
  const pending = [tipOid]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (seen.has(oid) || shared.has(oid)) continue
    seen.add(oid)
    const commit = graph.get(oid)
    if (!commit) {
      missing.add(oid)
      continue
    }
    pending.push(...(commit.parents || []))
  }
  return missing
}

function collectSharedReachableOids(
  sourceGraph: Map<string, GitNaturalCommit>,
  targetGraph: Map<string, GitNaturalCommit>,
): Set<string> {
  const shared = new Set(Array.from(sourceGraph.keys()).filter(oid => targetGraph.has(oid)))
  const unionGraph = new Map([...sourceGraph, ...targetGraph])
  const pending = [...shared]
  while (pending.length > 0) {
    const oid = pending.pop()!
    for (const parent of unionGraph.get(oid)?.parents || []) {
      if (shared.has(parent)) continue
      shared.add(parent)
      if (unionGraph.has(parent)) pending.push(parent)
    }
  }
  return shared
}

function collectCommonFrontierState(
  sourceGraph: Map<string, GitNaturalCommit>,
  targetGraph: Map<string, GitNaturalCommit>,
): {common: Set<string>; unresolvedComparisonOids: string[]} {
  const common = new Set(Array.from(sourceGraph.keys()).filter(oid => targetGraph.has(oid)))
  const unionGraph = new Map([...sourceGraph, ...targetGraph])
  const candidates = Array.from(common).filter(
    candidate =>
      !Array.from(common).some(
        other => other !== candidate && isReachableInGraph(unionGraph, other, candidate),
      ),
  )
  if (candidates.length <= 1) return {common, unresolvedComparisonOids: []}

  const unresolved = new Set<string>()
  for (const candidate of candidates) {
    const pending = [...(unionGraph.get(candidate)?.parents || [])]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const oid = pending.pop()!
      if (seen.has(oid) || common.has(oid)) continue
      seen.add(oid)
      const commit = unionGraph.get(oid)
      if (!commit) {
        unresolved.add(oid)
        continue
      }
      pending.push(...(commit.parents || []))
    }
  }
  return {common, unresolvedComparisonOids: [...unresolved].sort()}
}

function isReachableInGraph(
  graph: Map<string, GitNaturalCommit>,
  startOid: string,
  targetOid: string,
): boolean {
  const pending = [startOid]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (oid === targetOid) return true
    if (seen.has(oid)) continue
    seen.add(oid)
    pending.push(...(graph.get(oid)?.parents || []))
  }
  return false
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
  params: {
    repoId: string
    readScope?: string
    ref: string
    corsProxy?: string | null
    signal?: AbortSignal
  },
): Promise<ReadFallbackResult<GitNaturalResolveRefResult>> {
  const result = await withUrlFallback(
    urls,
    (url, signal) => reader.resolveRef({url, ref: params.ref, corsProxy: params.corsProxy, signal}),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0, signal: params.signal},
  )
  params.signal?.throwIfAborted()
  return result
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
    signal?: AbortSignal
  },
): Promise<ReadFallbackResult<GitNaturalListCommitsResult>> {
  const result = await withUrlFallback(
    urls,
    (url, signal) =>
      reader.listCommits({
        url,
        commitHash: params.commitHash,
        depth: params.depth,
        corsProxy: params.corsProxy,
        signal,
      }),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0, signal: params.signal},
  )
  params.signal?.throwIfAborted()
  return result
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
    signal?: AbortSignal
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
      signal: params.signal,
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
    signal?: AbortSignal
  },
): Promise<ReadFallbackResult<GitNaturalDiffBetweenResult>> {
  const result = await withUrlFallback(
    urls,
    (url, signal) =>
      reader.getDiffBetween({
        url,
        baseCommitHash: params.baseCommitHash,
        headCommitHash: params.headCommitHash,
        corsProxy: params.corsProxy,
        signal,
      }),
    {repoId: params.repoId, readScope: params.readScope, perUrlTimeoutMs: 0, signal: params.signal},
  )
  params.signal?.throwIfAborted()
  return result
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

function collectReachableExcludingOids(
  graph: Map<string, GitNaturalCommit>,
  excluded: Set<string>,
  tipOid: string,
): Set<string> | null {
  const reachable = new Set<string>()
  const pending = [tipOid]
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (reachable.has(oid) || excluded.has(oid)) continue
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
