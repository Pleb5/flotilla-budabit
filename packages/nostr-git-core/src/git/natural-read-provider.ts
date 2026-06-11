import {diffArrays} from "diff"

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
import {
  type GitNaturalCommit,
  type GitNaturalParsedObject,
  type GitNaturalParsedObjectType,
  type GitNaturalTreeEntry,
} from "./natural-read-types.js"

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
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalGetCommitResult {
  ref: string
  commitHash: string
  commit: GitNaturalCommit
  source: GitNaturalReadSourceMetadata
}

export interface GitNaturalDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patches: Array<{line: string; type: "+" | "-" | " "}>
}

export interface GitNaturalDiffChange {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
  oldOid?: string
  newOid?: string
  oldMode?: string
  newMode?: string
  binary?: boolean
  diffHunks: GitNaturalDiffHunk[]
}

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
}

type RefResolutionCore = Omit<GitNaturalResolveRefResult, "source">

interface FlattenedTreeFile {
  path: string
  mode: string
  hash: string
}

interface ObjectBatchResult {
  objects: Map<string, GitNaturalParsedObject>
  pack?: GitNaturalApiPackResult
}

interface BlobObjectResult {
  object: GitNaturalParsedObject
  pack?: GitNaturalApiPackResult
}

const DEFAULT_REF = "HEAD"
const utf8Decoder = new TextDecoder("utf-8")

export class GitNaturalReadProvider {
  private readonly enabled: boolean
  private readonly cache: GitNaturalObjectCache
  private readonly adapter: GitNaturalApiAdapter
  private readonly corsProxy?: string | null
  private readonly now: () => number
  private readonly rawObjectBatchInflight = new Map<string, Promise<ObjectBatchResult>>()

  constructor(config: GitNaturalReadProviderConfig = {}) {
    this.enabled = config.enabled ?? false
    this.cache = config.cache ?? new GitNaturalObjectCache({now: config.now})
    this.adapter =
      config.adapter ??
      new GitNaturalApiAdapter({cache: this.cache, fetcher: config.fetcher, corsProxy: config.corsProxy, now: config.now})
    this.corsProxy = config.corsProxy
    this.now = config.now ?? (() => Date.now())
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
    const entries = this.parseTreeEntries(tree.data).map(entry => directoryEntryFromTreeEntry(entry, normalizedPath))

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

    const cached = this.cache.getHistoryBatch<GitNaturalCommit>(resolved.commitHash, depth)
    if (cached?.commits?.length) {
      return {
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        commits: cached.commits,
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

    const batch = await this.getTreeZeroObjects(params, info.infoRefs, resolved.commitHash, depth)
    const objects = batch.objects
    const commits = orderCommitsFromTip(this.parseCommits(objects), resolved.commitHash, depth)
    if (commits.length === 0) {
      throw new GitNaturalReadError(
        "object-not-found",
        `No commit objects returned for ${resolved.commitHash}`,
        {remoteUrl: params.url, effectiveUrl: batch.pack?.effectiveUrl},
      )
    }
    this.cache.putHistoryBatch({
      startCommitHash: resolved.commitHash,
      limit: depth,
      commits,
      fetchedAt: this.now(),
    })

    return {
      ref: resolved.resolvedRef,
      commitHash: resolved.commitHash,
      commits,
      source: this.source({
        operation: "listCommits",
        info,
        pack: batch.pack,
        startedAt,
        ref: resolved.resolvedRef,
        commitHash: resolved.commitHash,
        capability: "filter=tree:0",
        defaultBranch: getDefaultBranch(info.infoRefs),
        details: "Commit history was fetched with Git Smart HTTP tree:0 filtering.",
      }),
    }
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
    const base = directCommitResolution(params.baseCommitHash, params.baseCommitHash)
    const head = directCommitResolution(params.headCommitHash, params.headCommitHash)

    const [baseBatch, headBatch] =
      base.commitHash === head.commitHash
        ? await this.getSameCommitBatches(params, info.infoRefs, base.commitHash)
        : await Promise.all([
            this.getBlobNoneObjects(params, info.infoRefs, base.commitHash),
            this.getBlobNoneObjects(params, info.infoRefs, head.commitHash),
          ])

    const baseRootTreeHash = this.getRootTreeHash(baseBatch.objects, base.commitHash)
    const headRootTreeHash = this.getRootTreeHash(headBatch.objects, head.commitHash)
    const baseFiles = this.flattenFileTree(baseBatch.objects, baseRootTreeHash)
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
      throw new GitNaturalReadError(
        "protocol-error",
        `Git natural ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        {remoteUrl: params.url, cause: error},
      )
    }
  }

  private resolveRefFromInfo(infoRefs: GitNaturalInfoRefs, requestedRef: string): RefResolutionCore {
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
      const headHash = (headRef && infoRefs.refs[headRef]) || infoRefs.refs.HEAD || infoRefs.headCommit
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
    const cached = this.cache.getRawObjectBatch(params.commitHash, params.cacheFilter)
    if (cached) return {objects: parsedObjectsFromRawObjects(cached.objects)}

    const corsProxy = this.resolveCorsProxy(params.params.corsProxy)
    const inFlightKey = rawObjectBatchInFlightKey(
      params.params.url,
      corsProxy,
      params.commitHash,
      params.cacheFilter,
    )
    const existing = this.rawObjectBatchInflight.get(inFlightKey)
    if (existing) return existing

    const promise = (async () => {
      const pack = await params.request(corsProxy)
      const objects = parsedObjectsFromApiObjects(pack.pack.objects)
      this.storeObjects(objects, params.commitHash, params.cacheFilter)
      return {objects, pack}
    })()

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
    const cached = this.cache.getBlob(blobHash)
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

  private async getSameCommitBatches(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    commitHash: string,
  ): Promise<[ObjectBatchResult, ObjectBatchResult]> {
    const batch = await this.getBlobNoneObjects(params, infoRefs, commitHash)
    return [batch, batch]
  }

  private getRootTreeHash(objects: Map<string, GitNaturalParsedObject>, commitHash: string): string {
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
    files = new Map<string, FlattenedTreeFile>(),
  ): Map<string, FlattenedTreeFile> {
    const tree = this.getObject(objects, treeHash, "tree")
    for (const entry of this.parseTreeEntries(tree.data)) {
      const path = joinPath(parentPath, entry.name)
      if (entry.type === "blob") {
        files.set(path, {path, mode: entry.mode, hash: entry.hash})
      } else if (entry.type === "tree") {
        this.flattenFileTree(objects, entry.hash, path, files)
      }
    }
    return files
  }

  private async buildDiffChanges(
    params: {url: string; corsProxy?: string | null; signal?: AbortSignal},
    infoRefs: GitNaturalInfoRefs,
    baseFiles: Map<string, FlattenedTreeFile>,
    headFiles: Map<string, FlattenedTreeFile>,
  ): Promise<GitNaturalDiffChange[]> {
    const paths = Array.from(new Set([...baseFiles.keys(), ...headFiles.keys()])).sort()
    const changes: GitNaturalDiffChange[] = []

    for (const path of paths) {
      const base = baseFiles.get(path)
      const head = headFiles.get(path)
      if (base?.hash === head?.hash) continue

      if (!base && head) {
        const blob = await this.getBlobObject(params, infoRefs, head.hash)
        changes.push({
          path,
          status: "added",
          newOid: head.hash,
          newMode: head.mode,
          ...diffHunksForAddedFile(path, blob.object.data),
        })
      } else if (base && !head) {
        const blob = await this.getBlobObject(params, infoRefs, base.hash)
        changes.push({
          path,
          status: "deleted",
          oldOid: base.hash,
          oldMode: base.mode,
          ...diffHunksForDeletedFile(path, blob.object.data),
        })
      } else if (base && head) {
        const [oldBlob, newBlob] = await Promise.all([
          this.getBlobObject(params, infoRefs, base.hash),
          this.getBlobObject(params, infoRefs, head.hash),
        ])
        changes.push({
          path,
          status: "modified",
          oldOid: base.hash,
          newOid: head.hash,
          oldMode: base.mode,
          newMode: head.mode,
          ...diffHunksForModifiedFile(path, oldBlob.object.data, newBlob.object.data),
        })
      }
    }

    return changes
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
        this.cache.putTree({hash: object.hash, data: object.data, entries: this.parseTreeEntries(object.data)})
      } else if (object.type === "commit") {
        try {
          const commit = this.adapter.parseCommit(object.data, object.hash)
          this.cache.putCommit({hash: commit.hash, tree: commit.tree, parents: commit.parents, data: object.data})
        } catch {
          this.cache.putCommit({hash: object.hash, data: object.data})
        }
      }
    }

    if (commitHash && filter) {
      this.cache.putRawObjectBatch({
        commitHash,
        filter,
        objects: new Map(Array.from(objects, ([hash, object]) => [hash, rawObjectFromParsed(object)])),
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
  const refs: GitNaturalServerRef[] = Object.entries(infoRefs.refs).map(([ref, oid]) => ({ref, oid}))
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
  let nextHash: string | undefined = tipHash

  while (nextHash && ordered.length < limit) {
    const commit = byHash.get(nextHash)
    if (!commit || seen.has(commit.hash)) break
    ordered.push(commit)
    seen.add(commit.hash)
    nextHash = commit.parents[0]
  }

  for (const commit of commits
    .filter(commit => !seen.has(commit.hash))
    .sort((a, b) => b.committer.timestamp - a.committer.timestamp)) {
    if (ordered.length >= limit) break
    ordered.push(commit)
  }

  return ordered
}

function rawObjectFromParsed(object: GitNaturalParsedObject): GitNaturalRawObject {
  return {
    hash: object.hash,
    type: object.type,
    data: object.data,
  }
}

function parsedObjectsFromRawObjects(rawObjects: Map<string, GitNaturalRawObject>): Map<string, GitNaturalParsedObject> {
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
  return String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
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
  return [trimTrailingSlashes(url), corsProxyModeKey(corsProxy), normalizeObjectHash(commitHash), filter].join("\0")
}

function corsProxyModeKey(corsProxy: string | null | undefined): string {
  const value = String(corsProxy ?? "").trim()
  return value ? `proxy:${trimTrailingSlashes(value)}` : "direct"
}

function trimTrailingSlashes(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "")
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

function buildAddedFileDiffHunks(text: string): GitNaturalDiffHunk[] {
  const lines = text.split("\n")
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      patches: lines.map(line => ({line, type: "+" as const})),
    },
  ]
}

function buildDeletedFileDiffHunks(text: string): GitNaturalDiffHunk[] {
  const lines = text.split("\n")
  return [
    {
      oldStart: 1,
      oldLines: lines.length,
      newStart: 0,
      newLines: 0,
      patches: lines.map(line => ({line, type: "-" as const})),
    },
  ]
}

function diffHunksForAddedFile(path: string, data: Uint8Array): {binary?: boolean; diffHunks: GitNaturalDiffHunk[]} {
  if (isBinaryFile(path, data)) return {binary: true, diffHunks: []}
  return {diffHunks: buildAddedFileDiffHunks(utf8Decoder.decode(data))}
}

function diffHunksForDeletedFile(path: string, data: Uint8Array): {binary?: boolean; diffHunks: GitNaturalDiffHunk[]} {
  if (isBinaryFile(path, data)) return {binary: true, diffHunks: []}
  return {diffHunks: buildDeletedFileDiffHunks(utf8Decoder.decode(data))}
}

function diffHunksForModifiedFile(
  path: string,
  oldData: Uint8Array,
  newData: Uint8Array,
): {binary?: boolean; diffHunks: GitNaturalDiffHunk[]} {
  if (isBinaryFile(path, oldData) || isBinaryFile(path, newData)) {
    return {binary: true, diffHunks: []}
  }
  return {diffHunks: buildModifiedFileDiffHunks(utf8Decoder.decode(oldData), utf8Decoder.decode(newData))}
}

function isBinaryFile(path: string, data: Uint8Array): boolean {
  if (isBinaryByExtension(path)) return true
  const limit = Math.min(data.length, 8192)
  for (let index = 0; index < limit; index += 1) {
    if (data[index] === 0) return true
  }
  return false
}

const BINARY_DIFF_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "bz2",
  "db",
  "dll",
  "dylib",
  "eot",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "png",
  "rar",
  "so",
  "sqlite",
  "sqlite3",
  "tar",
  "tiff",
  "ttf",
  "wasm",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xz",
  "zip",
])

function isBinaryByExtension(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? ""
  return BINARY_DIFF_EXTENSIONS.has(extension)
}

function buildModifiedFileDiffHunks(oldText: string, newText: string): GitNaturalDiffHunk[] {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const chunks = diffArrays(oldLines, newLines)
  const patches: Array<{line: string; type: "+" | "-" | " "}> = []

  for (const chunk of chunks) {
    const lines = chunk.value || []
    if (chunk.added) {
      for (const line of lines) patches.push({line, type: "+"})
    } else if (chunk.removed) {
      for (const line of lines) patches.push({line, type: "-"})
    } else {
      for (const line of lines) patches.push({line, type: " "})
    }
  }

  if (patches.length === 0) return []

  return [
    {
      oldStart: 1,
      oldLines: oldLines.length,
      newStart: 1,
      newLines: newLines.length,
      patches,
    },
  ]
}
