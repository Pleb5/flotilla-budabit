import {
  GitNaturalApiAdapter,
  type GitNaturalApiPackResult,
  type GitNaturalApiParsedObject,
  type GitNaturalApiTreeEntry,
} from "./natural-read-api-adapter.js"
import {
  GitNaturalReadError,
  type FetchInfoRefsResult,
  type FetchLike,
} from "./natural-read-transport.js"
import {
  GitNaturalObjectCache,
  normalizeObjectHash,
  type GitNaturalInfoRefs,
  type GitNaturalRawObject,
} from "./natural-read-cache.js"
import {createGitNaturalIndexedObjectStore} from "./natural-read-indexed-cache.js"
import {
  type GitNaturalCommit,
  type GitNaturalParsedObject,
  type GitNaturalParsedObjectType,
  type GitNaturalTreeEntry,
} from "./natural-read-types.js"
import {
  describeGitTreeChanges,
  renderGitDiffChanges,
  requiredGitDiffBlobOids,
  type GitDiffChange,
  type GitDiffHunk,
  type GitDiffTreeEntry,
} from "./diff-engine.js"

export type GitNaturalReadOperation =
  | "listRefs"
  | "resolveRef"
  | "listDirectory"
  | "getFileContent"
  | "listCommits"
  | "getCommit"
  | "getDiffBetween"

export interface GitNaturalReadSourceMetadata {
  kind: "git-natural"
  label: string
  operation: GitNaturalReadOperation
  remoteUrl: string
  effectiveUrl: string
  usesProxy: boolean
  attemptedUrls: string[]
  ref?: string
  commitHash?: string
  objectHash?: string
  capability?: string
  capabilities?: string[]
  fallbackReason?: string
  elapsedMs: number
  defaultBranch?: string
  details?: string
}

export interface GitNaturalServerRef {
  ref?: string
  oid?: string
  target?: string
  symref?: string
  value?: string
}

export interface GitNaturalListRefsResult {
  refs: GitNaturalServerRef[]
  defaultBranch?: string
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalResolveRefResult {
  requestedRef: string
  resolvedRef: string
  commitHash: string
  objectHash?: string
  peeled?: boolean
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalDirectoryEntry {
  name: string
  path: string
  type: "file" | "directory" | "submodule" | "unknown"
  mode: string
  oid: string
}

export interface GitNaturalListDirectoryResult {
  path: string
  ref: string
  commitHash: string
  treeHash: string
  entries: GitNaturalDirectoryEntry[]
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalFileContentResult {
  path: string
  ref: string
  commitHash: string
  objectHash: string
  content: string
  encoding: "base64"
  size: number
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalListCommitsResult {
  ref: string
  commitHash: string
  commits: GitNaturalCommit[]
  hasMore: boolean
  unresolvedParentOids: string[]
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalGetCommitResult {
  ref: string
  commitHash: string
  commit: GitNaturalCommit
  source: GitNaturalReadSourceMetadata
}

export type GitNaturalDiffHunk = GitDiffHunk

export type GitNaturalDiffChange = GitDiffChange

export interface GitNaturalDiffBetweenResult {
  baseCommitHash: string
  headCommitHash: string
  changes: GitNaturalDiffChange[]
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalReadProviderConfig {
  enabled?: boolean
  cache?: GitNaturalObjectCache
  adapter?: GitNaturalApiAdapter
  fetcher?: FetchLike
  corsProxy?: string | null
  now?: () => number
  requestTimeoutMs?: number
  cancellationSettleTimeoutMs?: number
  authorizationForUrl?: (remoteUrl: string) => string | undefined
}

type RefResolutionCore = Omit<GitNaturalResolveRefResult, "source">

interface ObjectBatchResult {
  objects: Map<string, GitNaturalParsedObject>
  pack?: GitNaturalApiPackResult
}

interface BlobObjectResult {
  object: GitNaturalParsedObject
  pack?: GitNaturalApiPackResult
}

const DEFAULT_REF = "HEAD"
export const EMPTY_GIT_TREE_COMMIT_HASH = "0".repeat(40)
const COMMIT_HISTORY_BATCH_SIZE = 15
const DIFF_BLOB_FETCH_CONCURRENCY = 16
const DIFF_BLOB_TRANSIENT_HTTP_RETRIES = 1

export class GitNaturalReadProvider {
  private readonly enabled: boolean
  private readonly cache: GitNaturalObjectCache
  private readonly adapter: GitNaturalApiAdapter
  private readonly corsProxy?: string | null
  private readonly now: () => number
  private readonly rawObjectBatchInflight = new Map<string, Promise<ObjectBatchResult>>()

  constructor(config: GitNaturalReadProviderConfig = {}) {
    this.enabled = config.enabled ?? false
    this.cache =
      config.cache ??
      new GitNaturalObjectCache({
        now: config.now,
        asyncStore: createGitNaturalIndexedObjectStore({now: config.now}),
      })
    this.adapter =
      config.adapter ??
      new GitNaturalApiAdapter({
        cache: this.cache,
        fetcher: config.fetcher,
        corsProxy: config.corsProxy,
        now: config.now,
        requestTimeoutMs: config.requestTimeoutMs,
        cancellationSettleTimeoutMs: config.cancellationSettleTimeoutMs,
        authorizationForUrl: config.authorizationForUrl,
      })
    this.corsProxy = config.corsProxy
    this.now = config.now ?? (() => Date.now())
  }

  invalidateInfoRefs(url: string): void {
    this.cache.invalidateInfoRefs(url)
  }

  async listRefs(params: {
    url: string
    prefix?: string
    symrefs?: boolean
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalListRefsResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const info = await this.fetchInfoRefs(params, "listRefs")
    const refs = this.filterRefs(infoRefsToServerRefs(info.infoRefs), params)
    const defaultBranch = getDefaultBranch(info.infoRefs)

    return {
      refs,
      ...(defaultBranch ? {defaultBranch} : {}),
      source: this.source({
        operation: "listRefs",
        info,
        startedAt,
        ref: defaultBranch,
        defaultBranch,
        details: "Ref list comes from Git Smart HTTP info/refs.",
      }),
    }
  }

  async resolveRef(params: {
    url: string
    ref: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalResolveRefResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const info = await this.fetchInfoRefs(params, "resolveRef")
    const resolved = this.resolveRefFromInfo(info.infoRefs, params.ref)

    return {
      ...resolved,
      source: this.source({
        operation: "resolveRef",
        info,
        startedAt,
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        objectHash: resolved.objectHash,
        defaultBranch: getDefaultBranch(info.infoRefs),
        details: "Ref was resolved from Git Smart HTTP advertised refs.",
      }),
    }
  }

  async listDirectory(params: {
    url: string
    ref?: string
    commitHash?: string
    path?: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalListDirectoryResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const info = await this.fetchInfoRefs(params, "listDirectory")
    const resolved = params.commitHash
      ? directCommitResolution(params.commitHash, params.ref ?? params.commitHash)
      : this.resolveRefFromInfo(info.infoRefs, params.ref ?? DEFAULT_REF)
    const batch = await this.getBlobNoneObjects(params, info.infoRefs, resolved.commitHash)
    const rootTreeHash = this.getRootTreeHash(batch.objects, resolved.commitHash)
    const normalizedPath = normalizePath(params.path)
    const treeHash = this.resolveTreeHashAtPath(batch.objects, rootTreeHash, normalizedPath)
    const tree = this.getObject(batch.objects, treeHash, "tree")
    const entries = this.parseTreeEntries(tree.data).map(entry =>
      directoryEntryFromTreeEntry(entry, normalizedPath),
    )

    return {
      path: normalizedPath,
      ref: resolved.resolvedRef,
      commitHash: resolved.commitHash,
      treeHash,
      entries,
      source: this.source({
        operation: "listDirectory",
        info,
        pack: batch.pack,
        startedAt,
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        objectHash: treeHash,
        capability: "filter=blob:none",
        defaultBranch: getDefaultBranch(info.infoRefs),
        details: batch.pack
          ? "Directory tree was fetched with Git Smart HTTP blob:none filtering."
          : "Directory tree came from the Git natural raw-object cache.",
      }),
    }
  }

  async getFileContent(params: {
    url: string
    ref?: string
    commitHash?: string
    path: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalFileContentResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const info = await this.fetchInfoRefs(params, "getFileContent")
    const resolved = params.commitHash
      ? directCommitResolution(params.commitHash, params.ref ?? params.commitHash)
      : this.resolveRefFromInfo(info.infoRefs, params.ref ?? DEFAULT_REF)
    const normalizedPath = normalizePath(params.path)
    const batch = await this.getBlobNoneObjects(params, info.infoRefs, resolved.commitHash)
    const rootTreeHash = this.getRootTreeHash(batch.objects, resolved.commitHash)
    const entry = this.resolveEntryAtPath(batch.objects, rootTreeHash, normalizedPath)
    if (!entry || entry.type !== "blob") {
      throw new GitNaturalReadError(
        "object-not-found",
        `File not found in Git tree: ${normalizedPath}`,
        {remoteUrl: params.url},
      )
    }

    const blob = await this.getBlobObject(params, info.infoRefs, entry.hash)

    return {
      path: normalizedPath,
      ref: resolved.resolvedRef,
      commitHash: resolved.commitHash,
      objectHash: entry.hash,
      content: encodeBase64(blob.object.data),
      encoding: "base64",
      size: blob.object.data.length,
      source: this.source({
        operation: "getFileContent",
        info,
        pack: blob.pack,
        startedAt,
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        objectHash: entry.hash,
        capability: "object-by-hash",
        defaultBranch: getDefaultBranch(info.infoRefs),
        details: "File blob was fetched by object hash after blob:none tree discovery.",
      }),
    }
  }

  async listCommits(params: {
    url: string
    ref?: string
    commitHash?: string
    depth?: number
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalListCommitsResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const depth = Math.max(1, params.depth ?? 30)
    const info = await this.fetchInfoRefs(params, "listCommits")
    const resolved = params.commitHash
      ? directCommitResolution(params.commitHash, params.ref ?? params.commitHash)
      : this.resolveRefFromInfo(info.infoRefs, params.ref ?? DEFAULT_REF)

    const cached = await this.cache.getHistoryBatchAsync<GitNaturalCommit>(
      resolved.commitHash,
      depth,
    )
    if (cached?.commits?.length) {
      const frontier = unresolvedCommitParents(cached.commits)
      return {
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        commits: cached.commits,
        hasMore: frontier.length > 0,
        unresolvedParentOids: frontier,
        source: this.source({
          operation: "listCommits",
          info,
          startedAt,
          ref: resolved.resolvedRef,
          commitHash: resolved.commitHash,
          capability: "filter=tree:0",
          defaultBranch: getDefaultBranch(info.infoRefs),
          details: "Commit history came from the Git natural history cache.",
        }),
      }
    }

    const commits = await this.fetchCommitHistoryBatched(
      params,
      info.infoRefs,
      resolved.commitHash,
      depth,
    )
    if (commits.length === 0) {
      throw new GitNaturalReadError(
        "object-not-found",
        `No commit objects returned for ${resolved.commitHash}`,
        {remoteUrl: params.url},
      )
    }
    this.cache.putHistoryBatch({
      startCommitHash: resolved.commitHash,
      limit: depth,
      commits,
      fetchedAt: this.now(),
    })
    const frontier = unresolvedCommitParents(commits)

    return {
      ref: resolved.resolvedRef,
      commitHash: resolved.commitHash,
      commits,
      hasMore: frontier.length > 0,
      unresolvedParentOids: frontier,
      source: this.source({
        operation: "listCommits",
        info,
        startedAt,
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        capability: "filter=tree:0",
        defaultBranch: getDefaultBranch(info.infoRefs),
        details:
          "Commit history was fetched with Git Smart HTTP tree:0 filtering in bounded batches.",
      }),
    }
  }

  private async fetchCommitHistoryBatched(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    startCommitHash: string,
    depth: number,
  ): Promise<GitNaturalCommit[]> {
    const commits = new Map<string, GitNaturalCommit>()
    const requested = new Set<string>()
    const pending = [startCommitHash]
    let batchSize = Math.min(COMMIT_HISTORY_BATCH_SIZE, depth)

    while (pending.length > 0 && commits.size < depth) {
      const nextHash = pending.shift()!
      if (commits.has(nextHash) || requested.has(nextHash)) continue

      const remaining = depth - commits.size
      const batchDepth = Math.min(batchSize, remaining)

      try {
        const batch = await this.fetchCommitHistoryBatch(params, infoRefs, nextHash, batchDepth)
        requested.add(nextHash)
        if (batch.length === 0) continue

        for (const commit of batch) {
          if (!commits.has(commit.hash)) commits.set(commit.hash, commit)
        }

        for (const commit of batch) {
          for (const parent of commit.parents) {
            if (!commits.has(parent) && !requested.has(parent) && !pending.includes(parent)) {
              pending.push(parent)
            }
          }
        }
      } catch (error) {
        if (batchSize > 1 && isGitNaturalBigBatchError(error)) {
          batchSize = Math.max(1, Math.floor(batchSize / 2))
          pending.unshift(nextHash)
          continue
        }
        throw error
      }
    }

    return orderCommitsFromTip(Array.from(commits.values()), startCommitHash, depth)
  }

  private async fetchCommitHistoryBatch(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    startCommitHash: string,
    depth: number,
  ): Promise<GitNaturalCommit[]> {
    const cached = await this.cache.getHistoryBatchAsync<GitNaturalCommit>(startCommitHash, depth)
    if (cached?.commits?.length) return cached.commits

    const batch = await this.getTreeZeroObjects(params, infoRefs, startCommitHash, depth)
    const commits = orderCommitsFromTip(this.parseCommits(batch.objects), startCommitHash, depth)
    if (commits.length > 0) {
      this.cache.putHistoryBatch({
        startCommitHash,
        limit: depth,
        commits,
        fetchedAt: this.now(),
      })
    }
    return commits
  }

  async getCommit(params: {
    url: string
    ref?: string
    commitHash?: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalGetCommitResult> {
    this.assertEnabled()
    const result = await this.listCommits({...params, depth: 1})
    const commit = result.commits[0]
    if (!commit) {
      throw new GitNaturalReadError(
        "object-not-found",
        `No commit object returned for ${params.commitHash ?? params.ref ?? DEFAULT_REF}`,
        {remoteUrl: params.url},
      )
    }

    return {
      ref: result.ref,
      commitHash: commit.hash,
      commit,
      source: {
        ...result.source,
        operation: "getCommit",
        objectHash: commit.hash,
        details: "Single commit metadata was fetched with Git Smart HTTP tree:0 filtering.",
      },
    }
  }

  async getDiffBetween(params: {
    url: string
    baseCommitHash: string
    headCommitHash: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalDiffBetweenResult> {
    this.assertEnabled()
    const startedAt = this.now()
    const info = await this.fetchInfoRefs(params, "getDiffBetween")
    const emptyBase = normalizeObjectHash(params.baseCommitHash) === EMPTY_GIT_TREE_COMMIT_HASH
    const base = emptyBase
      ? directCommitResolution(EMPTY_GIT_TREE_COMMIT_HASH, EMPTY_GIT_TREE_COMMIT_HASH)
      : directCommitResolution(params.baseCommitHash, params.baseCommitHash)
    const head = directCommitResolution(params.headCommitHash, params.headCommitHash)

    const [baseBatch, headBatch] = emptyBase
      ? [emptyObjectBatch(), await this.getBlobNoneObjects(params, info.infoRefs, head.commitHash)]
      : base.commitHash === head.commitHash
        ? await this.getSameCommitBatches(params, info.infoRefs, base.commitHash)
        : await this.getDiffTreeBatches(params, info.infoRefs, base.commitHash, head.commitHash)

    const baseRootTreeHash = emptyBase
      ? undefined
      : this.getRootTreeHash(baseBatch.objects, base.commitHash)
    const headRootTreeHash = this.getRootTreeHash(headBatch.objects, head.commitHash)
    const baseFiles = baseRootTreeHash
      ? this.flattenFileTree(baseBatch.objects, baseRootTreeHash)
      : new Map<string, GitDiffTreeEntry>()
    const headFiles = this.flattenFileTree(headBatch.objects, headRootTreeHash)
    const changes = await this.buildDiffChanges(params, info.infoRefs, baseFiles, headFiles)

    return {
      baseCommitHash: base.commitHash,
      headCommitHash: head.commitHash,
      changes,
      source: this.source({
        operation: "getDiffBetween",
        info,
        pack: headBatch.pack ?? baseBatch.pack,
        startedAt,
        ref: head.resolvedRef,
        commitHash: head.commitHash,
        objectHash: headRootTreeHash,
        capability: "filter=blob:none,object-by-hash",
        defaultBranch: getDefaultBranch(info.infoRefs),
        details:
          "Diff metadata was fetched with Git Smart HTTP blob:none tree reads; changed file blobs were fetched lazily by object hash.",
      }),
    }
  }

  private assertEnabled(): void {
    if (this.enabled) return
    throw new GitNaturalReadError(
      "feature-disabled",
      "Git natural reads are disabled. Pass the opt-in feature flag before calling this provider.",
    )
  }

  private async fetchInfoRefs(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    operation: GitNaturalReadOperation,
  ): Promise<FetchInfoRefsResult> {
    try {
      return await this.adapter.fetchInfoRefs({
        url: params.url,
        corsProxy: this.resolveCorsProxy(params.corsProxy),
        signal: params.signal,
      })
    } catch (error) {
      if (error instanceof GitNaturalReadError) throw error
      if (error instanceof Error && error.name === "AbortError") throw error
      throw new GitNaturalReadError(
        "protocol-error",
        `Git natural ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        {remoteUrl: params.url, cause: error},
      )
    }
  }

  private resolveRefFromInfo(
    infoRefs: GitNaturalInfoRefs,
    requestedRef: string,
  ): RefResolutionCore {
    const requested = String(requestedRef || DEFAULT_REF).trim() || DEFAULT_REF
    if (/^[a-f0-9]{40}$/i.test(requested)) {
      return {
        requestedRef: requested,
        resolvedRef: requested,
        commitHash: requested.toLowerCase(),
      }
    }

    if (requested === "HEAD") {
      const headRef = infoRefs.symrefs.HEAD || infoRefs.headRef
      const headHash =
        (headRef && infoRefs.refs[headRef]) || infoRefs.refs.HEAD || infoRefs.headCommit
      if (headHash) {
        return {
          requestedRef: requested,
          resolvedRef: headRef || "HEAD",
          commitHash: headHash,
        }
      }
    }

    for (const candidate of refCandidates(requested)) {
      const directHash = infoRefs.refs[candidate]
      if (!directHash) continue
      const peeledHash = !candidate.endsWith("^{}") ? infoRefs.refs[`${candidate}^{}`] : undefined
      return {
        requestedRef: requested,
        resolvedRef: candidate,
        commitHash: peeledHash || directHash,
        ...(peeledHash ? {objectHash: directHash, peeled: true} : {}),
      }
    }

    throw new GitNaturalReadError("ref-not-found", `Ref not found: ${requested}`)
  }

  private async getBlobNoneObjects(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    commitHash: string,
  ): Promise<ObjectBatchResult> {
    return this.getFilteredObjectBatch({
      params,
      commitHash,
      cacheFilter: "blob:none",
      request: corsProxy =>
        this.adapter.fetchBlobNoneObjects({
          url: params.url,
          commitHash,
          serverCapabilities: infoRefs.capabilities,
          corsProxy,
          signal: params.signal,
        }),
    })
  }

  private async getTreeZeroObjects(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    commitHash: string,
    depth: number,
  ): Promise<ObjectBatchResult> {
    const cacheFilter = `tree:0:depth=${depth}`
    return this.getFilteredObjectBatch({
      params,
      commitHash,
      cacheFilter,
      request: corsProxy =>
        this.adapter.fetchTreeZeroObjects({
          url: params.url,
          commitHash,
          serverCapabilities: infoRefs.capabilities,
          maxCommits: depth,
          corsProxy,
          signal: params.signal,
        }),
    })
  }

  private async getFilteredObjectBatch(params: {
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal}
    commitHash: string
    cacheFilter: string
    request: (corsProxy: string | null | undefined) => Promise<GitNaturalApiPackResult>
  }): Promise<ObjectBatchResult> {
    const cached = await this.cache.getRawObjectBatchAsync(params.commitHash, params.cacheFilter)
    if (cached) return {objects: parsedObjectsFromRawObjects(cached.objects)}

    const corsProxy = this.resolveCorsProxy(params.params.corsProxy)
    const inFlightKey = rawObjectBatchInFlightKey(
      params.params.url,
      corsProxy,
      params.commitHash,
      params.cacheFilter,
    )
    const dedupeInFlight = params.params.signal === undefined
    if (dedupeInFlight) {
      const existing = this.rawObjectBatchInflight.get(inFlightKey)
      if (existing) return existing
    }

    const promise = (async () => {
      const pack = await params.request(corsProxy)
      const objects = parsedObjectsFromApiObjects(pack.pack.objects)
      this.storeObjects(objects, params.commitHash, params.cacheFilter)
      return {objects, pack}
    })()

    if (!dedupeInFlight) return promise

    this.rawObjectBatchInflight.set(inFlightKey, promise)
    try {
      return await promise
    } finally {
      if (this.rawObjectBatchInflight.get(inFlightKey) === promise) {
        this.rawObjectBatchInflight.delete(inFlightKey)
      }
    }
  }

  private async getBlobObject(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    blobHash: string,
  ): Promise<BlobObjectResult> {
    const cached = await this.cache.getBlobAsync(blobHash)
    if (cached) {
      return {
        object: {
          hash: cached.hash,
          type: "blob",
          typeCode: typeCodeFromObjectType("blob"),
          size: cached.data.length,
          data: cached.data,
          offset: 0,
        },
      }
    }

    const pack = await this.adapter.fetchObjectByHash({
      url: params.url,
      objectHash: blobHash,
      serverCapabilities: infoRefs.capabilities,
      corsProxy: this.resolveCorsProxy(params.corsProxy),
      signal: params.signal,
    })
    const objects = parsedObjectsFromApiObjects(pack.pack.objects)
    this.storeObjects(objects)
    return {object: this.getObject(objects, blobHash, "blob"), pack}
  }

  private async getDiffBlobObject(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    blobHash: string,
  ): Promise<BlobObjectResult> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.getBlobObject(params, infoRefs, blobHash)
      } catch (error) {
        if (
          retry >= DIFF_BLOB_TRANSIENT_HTTP_RETRIES ||
          params.signal?.aborted ||
          !isTransientServerError(error)
        ) {
          throw error
        }
      }
    }
  }

  private async getSameCommitBatches(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    commitHash: string,
  ): Promise<[ObjectBatchResult, ObjectBatchResult]> {
    const batch = await this.getBlobNoneObjects(params, infoRefs, commitHash)
    return [batch, batch]
  }

  private async getDiffTreeBatches(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    baseCommitHash: string,
    headCommitHash: string,
  ): Promise<[ObjectBatchResult, ObjectBatchResult]> {
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    params.signal?.addEventListener("abort", abortFromCaller, {once: true})
    if (params.signal?.aborted) controller.abort()

    let firstFailure: unknown
    const read = async (commitHash: string): Promise<ObjectBatchResult> => {
      try {
        return await this.getBlobNoneObjects(
          {...params, signal: controller.signal},
          infoRefs,
          commitHash,
        )
      } catch (error) {
        if (
          firstFailure === undefined ||
          (error instanceof GitNaturalReadError && error.code === "cancellation-unconfirmed")
        ) {
          firstFailure = error
        }
        controller.abort()
        throw error
      }
    }

    try {
      const settled = await Promise.allSettled([read(baseCommitHash), read(headCommitHash)])
      if (firstFailure !== undefined) throw firstFailure
      if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError")
      if (settled[0].status !== "fulfilled" || settled[1].status !== "fulfilled") {
        throw new Error("Diff tree requests did not complete")
      }
      return [settled[0].value, settled[1].value]
    } finally {
      params.signal?.removeEventListener("abort", abortFromCaller)
    }
  }

  private getRootTreeHash(
    objects: Map<string, GitNaturalParsedObject>,
    commitHash: string,
  ): string {
    const commitObject = this.getObject(objects, commitHash, "commit")
    return this.adapter.parseCommit(commitObject.data, commitHash).tree
  }

  private resolveTreeHashAtPath(
    objects: Map<string, GitNaturalParsedObject>,
    rootTreeHash: string,
    path: string,
  ): string {
    if (!path) return rootTreeHash
    const entry = this.resolveEntryAtPath(objects, rootTreeHash, path)
    if (!entry || entry.type !== "tree") {
      throw new GitNaturalReadError("object-not-found", `Directory not found in Git tree: ${path}`)
    }
    return entry.hash
  }

  private resolveEntryAtPath(
    objects: Map<string, GitNaturalParsedObject>,
    rootTreeHash: string,
    path: string,
  ): GitNaturalTreeEntry | undefined {
    const segments = normalizePath(path).split("/").filter(Boolean)
    let treeHash = rootTreeHash
    let entry: GitNaturalTreeEntry | undefined

    for (const [index, segment] of segments.entries()) {
      const tree = this.getObject(objects, treeHash, "tree")
      entry = this.parseTreeEntries(tree.data).find(item => item.name === segment)
      if (!entry) return undefined
      if (index === segments.length - 1) return entry
      if (entry.type !== "tree") return undefined
      treeHash = entry.hash
    }

    return undefined
  }

  private flattenFileTree(
    objects: Map<string, GitNaturalParsedObject>,
    treeHash: string,
    parentPath = "",
    files = new Map<string, GitDiffTreeEntry>(),
  ): Map<string, GitDiffTreeEntry> {
    const tree = this.getObject(objects, treeHash, "tree")
    for (const entry of this.parseTreeEntries(tree.data)) {
      const path = joinPath(parentPath, entry.name)
      if (entry.type === "blob") {
        files.set(path, {path, mode: entry.mode, oid: entry.hash, type: "blob"})
      } else if (entry.type === "commit") {
        files.set(path, {path, mode: entry.mode, oid: entry.hash, type: "submodule"})
      } else if (entry.type === "tree") {
        this.flattenFileTree(objects, entry.hash, path, files)
      }
    }
    return files
  }

  private async buildDiffChanges(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    baseFiles: Map<string, GitDiffTreeEntry>,
    headFiles: Map<string, GitDiffTreeEntry>,
  ): Promise<GitNaturalDiffChange[]> {
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const descriptors = describeGitTreeChanges(baseFiles, headFiles)
    const objects = await this.fetchDiffBlobs(
      params,
      infoRefs,
      requiredGitDiffBlobOids(descriptors),
    )
    const blobs = new Map(
      Array.from(objects, ([hash, object]) => [hash, this.getObject(objects, hash, "blob").data]),
    )
    return renderGitDiffChanges(descriptors, blobs)
  }

  private async fetchDiffBlobs(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    hashes: string[],
  ): Promise<Map<string, GitNaturalParsedObject>> {
    const objects = new Map<string, GitNaturalParsedObject>()
    if (hashes.length === 0) {
      if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError")
      return objects
    }

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    params.signal?.addEventListener("abort", abortFromCaller, {once: true})
    if (params.signal?.aborted) controller.abort()

    let nextIndex = 0
    let firstFailure: unknown
    const runWorker = async () => {
      while (!controller.signal.aborted && firstFailure === undefined) {
        const index = nextIndex++
        if (index >= hashes.length) return
        const hash = hashes[index]
        try {
          const result = await this.getDiffBlobObject(
            {...params, signal: controller.signal},
            infoRefs,
            hash,
          )
          objects.set(normalizeObjectHash(hash), result.object)
        } catch (error) {
          if (
            firstFailure === undefined ||
            (error instanceof GitNaturalReadError && error.code === "cancellation-unconfirmed")
          ) {
            firstFailure = error
          }
          controller.abort()
        }
      }
    }

    try {
      await Promise.allSettled(
        Array.from({length: Math.min(DIFF_BLOB_FETCH_CONCURRENCY, hashes.length)}, runWorker),
      )
      if (firstFailure !== undefined) throw firstFailure
      if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError")
      return objects
    } finally {
      params.signal?.removeEventListener("abort", abortFromCaller)
    }
  }

  private getObject(
    objects: Map<string, GitNaturalParsedObject>,
    hash: string,
    expectedType?: GitNaturalParsedObjectType,
  ): GitNaturalParsedObject {
    const object = objects.get(hash.toLowerCase()) ?? objects.get(hash)
    if (!object) {
      throw new GitNaturalReadError("object-not-found", `Git object not found: ${hash}`)
    }
    if (expectedType && object.type !== expectedType) {
      throw new GitNaturalReadError(
        "object-not-found",
        `Git object ${hash} is ${object.type}, expected ${expectedType}`,
      )
    }
    return object
  }

  private storeObjects(
    objects: Map<string, GitNaturalParsedObject>,
    commitHash?: string,
    filter?: string,
  ): void {
    for (const object of objects.values()) {
      if (object.type === "blob") this.cache.putBlob({hash: object.hash, data: object.data})
      else if (object.type === "tree") {
        this.cache.putTree({
          hash: object.hash,
          data: object.data,
          entries: this.parseTreeEntries(object.data),
        })
      } else if (object.type === "commit") {
        try {
          const commit = this.adapter.parseCommit(object.data, object.hash)
          this.cache.putCommit({
            hash: commit.hash,
            tree: commit.tree,
            parents: commit.parents,
            data: object.data,
          })
        } catch {
          this.cache.putCommit({hash: object.hash, data: object.data})
        }
      }
    }

    if (commitHash && filter) {
      this.cache.putRawObjectBatch({
        commitHash,
        filter,
        objects: new Map(
          Array.from(objects, ([hash, object]) => [hash, rawObjectFromParsed(object)]),
        ),
        fetchedAt: this.now(),
      })
    }
  }

  private parseTreeEntries(data: Uint8Array): GitNaturalTreeEntry[] {
    return this.adapter.parseTree(data).map(treeEntryFromApi)
  }

  private parseCommits(objects: Map<string, GitNaturalParsedObject>): GitNaturalCommit[] {
    const commits: GitNaturalCommit[] = []
    for (const object of objects.values()) {
      if (object.type !== "commit") continue
      commits.push(this.adapter.parseCommit(object.data, object.hash))
    }
    return commits
  }

  private resolveCorsProxy(corsProxy: string | null | undefined): string | null | undefined {
    return corsProxy !== undefined ? corsProxy : this.corsProxy
  }

  private filterRefs(
    refs: GitNaturalServerRef[],
    params: {prefix?: string; symrefs?: boolean},
  ): GitNaturalServerRef[] {
    return refs.filter(ref => {
      const refName = String(ref.ref || "")
      if (!refName) return false
      if (refName === "HEAD") return Boolean(params.symrefs)
      if (!params.prefix) return true
      return refName.startsWith(params.prefix)
    })
  }

  private source(params: {
    operation: GitNaturalReadOperation
    info: FetchInfoRefsResult
    pack?: GitNaturalApiPackResult
    startedAt: number
    ref?: string
    commitHash?: string
    objectHash?: string
    capability?: string
    fallbackReason?: string
    defaultBranch?: string
    details?: string
  }): GitNaturalReadSourceMetadata {
    const effectiveUrl = params.pack?.effectiveUrl ?? params.info.effectiveUrl
    const usesProxy = params.pack?.usesProxy ?? params.info.usesProxy
    return {
      kind: "git-natural",
      label: "Git natural Smart HTTP",
      operation: params.operation,
      remoteUrl: params.info.remoteUrl,
      effectiveUrl,
      usesProxy,
      attemptedUrls: [effectiveUrl],
      ...(params.ref ? {ref: params.ref} : {}),
      ...(params.commitHash ? {commitHash: params.commitHash} : {}),
      ...(params.objectHash ? {objectHash: params.objectHash} : {}),
      ...(params.capability ? {capability: params.capability} : {}),
      capabilities: params.info.infoRefs.capabilities,
      ...(params.fallbackReason ? {fallbackReason: params.fallbackReason} : {}),
      elapsedMs: Math.max(0, this.now() - params.startedAt),
      ...(params.defaultBranch ? {defaultBranch: params.defaultBranch} : {}),
      ...(params.details ? {details: params.details} : {}),
    }
  }
}

function infoRefsToServerRefs(infoRefs: GitNaturalInfoRefs): GitNaturalServerRef[] {
  const refs: GitNaturalServerRef[] = Object.entries(infoRefs.refs).map(([ref, oid]) => ({
    ref,
    oid,
  }))
  const headRef = infoRefs.symrefs.HEAD || infoRefs.headRef
  if (headRef) {
    const existing = refs.find(ref => ref.ref === "HEAD")
    const target = refs.find(ref => ref.ref === headRef)
    const head = {
      ref: "HEAD",
      oid: existing?.oid || target?.oid || infoRefs.headCommit,
      target: headRef,
      symref: headRef,
      value: `ref: ${headRef}`,
    }
    if (existing) Object.assign(existing, head)
    else refs.unshift(head)
  }
  return refs
}

function getDefaultBranch(infoRefs: GitNaturalInfoRefs): string | undefined {
  const headRef = infoRefs.symrefs.HEAD || infoRefs.headRef
  return headRef?.startsWith("refs/heads/") ? headRef.slice("refs/heads/".length) : undefined
}

function refCandidates(ref: string): string[] {
  if (ref.startsWith("refs/")) return [ref]
  return [`refs/heads/${ref}`, `refs/tags/${ref}`, ref]
}

function directCommitResolution(commitHash: string, ref: string): RefResolutionCore {
  if (!/^[a-f0-9]{40}$/i.test(commitHash)) {
    throw new GitNaturalReadError("ref-not-found", `Invalid commit hash: ${commitHash}`)
  }
  return {
    requestedRef: ref,
    resolvedRef: ref,
    commitHash: commitHash.toLowerCase(),
  }
}

function emptyObjectBatch(): ObjectBatchResult {
  return {objects: new Map()}
}

function unresolvedCommitParents(commits: GitNaturalCommit[]): string[] {
  const included = new Set(commits.map(commit => normalizeObjectHash(commit.hash)))
  const unresolved = new Set<string>()
  for (const commit of commits) {
    for (const parent of commit.parents || []) {
      const oid = normalizeObjectHash(parent)
      if (oid && !included.has(oid)) unresolved.add(oid)
    }
  }
  return Array.from(unresolved)
}

function isTransientServerError(error: unknown): boolean {
  return (
    error instanceof GitNaturalReadError &&
    error.code === "http-error" &&
    error.status !== undefined &&
    error.status >= 500 &&
    error.status <= 599
  )
}

function directoryEntryFromTreeEntry(
  entry: GitNaturalTreeEntry,
  parentPath: string,
): GitNaturalDirectoryEntry {
  return {
    name: entry.name,
    path: joinPath(parentPath, entry.name),
    type: directoryEntryType(entry),
    mode: entry.mode,
    oid: entry.hash,
  }
}

function directoryEntryType(entry: GitNaturalTreeEntry): GitNaturalDirectoryEntry["type"] {
  if (entry.type === "tree") return "directory"
  if (entry.type === "commit") return "submodule"
  if (entry.type === "blob") return "file"
  return "unknown"
}

function treeEntryFromApi(entry: GitNaturalApiTreeEntry): GitNaturalTreeEntry {
  return {
    name: entry.path,
    path: entry.path,
    mode: entry.mode,
    hash: entry.hash,
    type: treeEntryTypeFromApi(entry),
  }
}

function treeEntryTypeFromApi(entry: GitNaturalApiTreeEntry): GitNaturalTreeEntry["type"] {
  if (entry.isDir) return "tree"
  if (entry.mode === "160000") return "commit"
  if (entry.mode === "100644" || entry.mode === "100755" || entry.mode === "120000") return "blob"
  return "unknown"
}

function orderCommitsFromTip(
  commits: GitNaturalCommit[],
  tipHash: string,
  limit: number,
): GitNaturalCommit[] {
  const byHash = new Map(commits.map(commit => [commit.hash, commit]))
  const ordered: GitNaturalCommit[] = []
  const seen = new Set<string>()
  const pending = [tipHash]

  while (pending.length > 0 && ordered.length < limit) {
    const nextHash = pending.shift()!
    const commit = byHash.get(nextHash)
    if (!commit || seen.has(commit.hash)) continue
    ordered.push(commit)
    seen.add(commit.hash)
    pending.push(...commit.parents)
  }

  for (const commit of commits
    .filter(commit => !seen.has(commit.hash))
    .sort((a, b) => b.committer.timestamp - a.committer.timestamp)) {
    if (ordered.length >= limit) break
    ordered.push(commit)
  }

  return ordered
}

function isGitNaturalBigBatchError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current && !seen.has(current)) {
    seen.add(current)
    const asAny = current as {
      name?: string
      message?: string
      cause?: unknown
      constructor?: {name?: string}
    }
    const name = asAny.name || asAny.constructor?.name || ""
    const message = current instanceof Error ? current.message : String(current)

    if (
      name === "BigBatchError" ||
      /decompress too much data|too much data at the same time/i.test(message)
    ) {
      return true
    }

    current = asAny.cause
  }

  return false
}

function rawObjectFromParsed(object: GitNaturalParsedObject): GitNaturalRawObject {
  return {
    hash: object.hash,
    type: object.type,
    data: object.data,
  }
}

function parsedObjectsFromRawObjects(
  rawObjects: Map<string, GitNaturalRawObject>,
): Map<string, GitNaturalParsedObject> {
  return new Map(
    Array.from(rawObjects, ([hash, object]) => [
      hash,
      {
        hash: object.hash,
        type: object.type,
        typeCode: typeCodeFromObjectType(object.type),
        size: object.data.length,
        data: object.data,
        offset: 0,
      },
    ]),
  )
}

function parsedObjectsFromApiObjects(
  objects: Map<string, GitNaturalApiParsedObject>,
): Map<string, GitNaturalParsedObject> {
  return new Map(Array.from(objects, ([hash, object]) => [hash, parsedObjectFromApi(object)]))
}

function parsedObjectFromApi(object: GitNaturalApiParsedObject): GitNaturalParsedObject {
  return {
    hash: object.hash,
    type: objectTypeFromApiTypeCode(object.type),
    typeCode: object.type,
    size: object.size,
    data: object.data,
    offset: object.offset,
  }
}

function typeCodeFromObjectType(type: GitNaturalParsedObjectType): number {
  if (type === "commit") return 1
  if (type === "tree") return 2
  if (type === "blob") return 3
  return 4
}

function objectTypeFromApiTypeCode(typeCode: number): GitNaturalParsedObjectType {
  if (typeCode === 1) return "commit"
  if (typeCode === 2) return "tree"
  if (typeCode === 3) return "blob"
  return "tag"
}

function normalizePath(path?: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function rawObjectBatchInFlightKey(
  url: string,
  corsProxy: string | null | undefined,
  commitHash: string,
  filter: string,
): string {
  return [
    trimTrailingSlashes(url),
    corsProxyModeKey(corsProxy),
    normalizeObjectHash(commitHash),
    filter,
  ].join("\0")
}

function corsProxyModeKey(corsProxy: string | null | undefined): string {
  const value = String(corsProxy ?? "").trim()
  return value ? `proxy:${trimTrailingSlashes(value)}` : "direct"
}

function trimTrailingSlashes(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let output = ""
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index++]
    const second = index < bytes.length ? bytes[index++] : Number.NaN
    const third = index < bytes.length ? bytes[index++] : Number.NaN
    output += alphabet[first >> 2]
    output += alphabet[((first & 0x03) << 4) | ((second || 0) >> 4)]
    output += Number.isNaN(second) ? "=" : alphabet[((second & 0x0f) << 2) | ((third || 0) >> 6)]
    output += Number.isNaN(third) ? "=" : alphabet[third & 0x3f]
  }
  return output
}
