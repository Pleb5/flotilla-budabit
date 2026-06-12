export const DEFAULT_NATURAL_INFO_REFS_TTL_MS = 60_000
export const DEFAULT_NATURAL_MEMORY_MAX_ENTRIES = 2_000
export const DEFAULT_NATURAL_MEMORY_MAX_BYTES = 64 * 1024 * 1024

export interface GitNaturalInfoRefs {
  refs: Record<string, string>
  capabilities: string[]
  symrefs: Record<string, string>
  headRef?: string
  headCommit?: string
}

export type GitNaturalObjectType = "commit" | "tree" | "blob" | "tag"

export interface GitNaturalCommitObject {
  hash: string
  tree?: string
  parents?: string[]
  data?: Uint8Array
}

export interface GitNaturalTreeObject {
  hash: string
  data?: Uint8Array
  entries?: Array<{
    name: string
    mode: string
    hash: string
    type: "tree" | "blob" | "commit" | "unknown"
  }>
}

export interface GitNaturalBlobObject {
  hash: string
  data: Uint8Array
}

export interface GitNaturalRawObject {
  hash: string
  type: GitNaturalObjectType
  data: Uint8Array
}

export interface GitNaturalRawObjectBatch {
  commitHash: string
  filter: "blob:none" | "tree:0" | string
  objects: Map<string, GitNaturalRawObject>
  fetchedAt: number
}

export interface GitNaturalHistoryBatch<TCommit = GitNaturalCommitObject> {
  startCommitHash: string
  limit: number
  commits: TCommit[]
  fetchedAt: number
}

export interface GitNaturalAsyncObjectStore {
  getCommit(hash: string): Promise<GitNaturalCommitObject | undefined>
  putCommit(commit: GitNaturalCommitObject): Promise<void>
  getBlob(hash: string): Promise<GitNaturalBlobObject | undefined>
  putBlob(blob: GitNaturalBlobObject): Promise<void>
  getTree(hash: string): Promise<GitNaturalTreeObject | undefined>
  putTree(tree: GitNaturalTreeObject): Promise<void>
  getRawObjectBatch(
    commitHash: string,
    filter: string,
  ): Promise<GitNaturalRawObjectBatch | undefined>
  putRawObjectBatch(batch: GitNaturalRawObjectBatch): Promise<void>
  getHistoryBatch<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): Promise<GitNaturalHistoryBatch<TCommit> | undefined>
  putHistoryBatch<TCommit extends GitNaturalCommitObject>(
    batch: GitNaturalHistoryBatch<TCommit>,
  ): Promise<void>
  close?(): void
}

export const gitNaturalCacheKeys = {
  infoRefs: (url: string): string => `infoRefs:${normalizeUrlKey(url)}`,
  commit: (hash: string): string => `commit:${normalizeObjectHash(hash)}`,
  blob: (hash: string): string => `blob:${normalizeObjectHash(hash)}`,
  tree: (hash: string): string => `tree:${normalizeObjectHash(hash)}`,
  rawObjectBatch: (commitHash: string, filter: string): string =>
    `raw:${normalizeObjectHash(commitHash)}:${filter}`,
  historyBatch: (startCommitHash: string, limit: number): string =>
    `history:${normalizeObjectHash(startCommitHash)}:${limit}`,
}

export function normalizeObjectHash(hash: string): string {
  return String(hash || "")
    .trim()
    .toLowerCase()
}

function normalizeUrlKey(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
}

interface TimedInfoRefs {
  infoRefs: GitNaturalInfoRefs
  fetchedAt: number
}

export interface GitNaturalObjectCacheConfig {
  infoRefsTtlMs?: number
  now?: () => number
  asyncStore?: GitNaturalAsyncObjectStore | false
  maxMemoryEntries?: number
  maxMemoryBytes?: number
}

export interface GitNaturalMemoryStats {
  entries: number
  bytes: number
  maxEntries: number
  maxBytes: number
}

export class GitNaturalObjectCache {
  private readonly infoRefsTtlMs: number
  private readonly now: () => number
  private readonly asyncStore?: GitNaturalAsyncObjectStore
  private readonly maxMemoryEntries: number
  private readonly maxMemoryBytes: number
  private readonly pendingWrites = new Set<Promise<void>>()
  private readonly infoRefs = new Map<string, TimedInfoRefs>()
  private readonly commits = new Map<string, GitNaturalCommitObject>()
  private readonly blobs = new Map<string, GitNaturalBlobObject>()
  private readonly trees = new Map<string, GitNaturalTreeObject>()
  private readonly rawObjectBatches = new Map<string, GitNaturalRawObjectBatch>()
  private readonly historyBatches = new Map<string, GitNaturalHistoryBatch>()
  private readonly memoryLru = new Map<string, number>()
  private memoryBytes = 0

  constructor(config: GitNaturalObjectCacheConfig = {}) {
    this.infoRefsTtlMs = config.infoRefsTtlMs ?? DEFAULT_NATURAL_INFO_REFS_TTL_MS
    this.now = config.now ?? (() => Date.now())
    this.asyncStore = config.asyncStore || undefined
    this.maxMemoryEntries = Math.max(
      0,
      config.maxMemoryEntries ?? DEFAULT_NATURAL_MEMORY_MAX_ENTRIES,
    )
    this.maxMemoryBytes = Math.max(0, config.maxMemoryBytes ?? DEFAULT_NATURAL_MEMORY_MAX_BYTES)
  }

  getInfoRefs(url: string): GitNaturalInfoRefs | undefined {
    const cached = this.infoRefs.get(gitNaturalCacheKeys.infoRefs(url))
    if (!cached) return undefined
    if (this.now() - cached.fetchedAt > this.infoRefsTtlMs) return undefined
    return cached.infoRefs
  }

  peekInfoRefsStale(url: string): GitNaturalInfoRefs | undefined {
    return this.infoRefs.get(gitNaturalCacheKeys.infoRefs(url))?.infoRefs
  }

  putInfoRefs(url: string, infoRefs: GitNaturalInfoRefs): void {
    this.infoRefs.set(gitNaturalCacheKeys.infoRefs(url), {
      infoRefs,
      fetchedAt: this.now(),
    })
  }

  invalidateInfoRefs(url: string): void {
    this.infoRefs.delete(gitNaturalCacheKeys.infoRefs(url))
  }

  getCommit(hash: string): GitNaturalCommitObject | undefined {
    const key = gitNaturalCacheKeys.commit(hash)
    const cached = this.commits.get(key)
    if (cached) this.touchMemoryEntry(key)
    return cached
  }

  async getCommitAsync(hash: string): Promise<GitNaturalCommitObject | undefined> {
    const cached = this.getCommit(hash)
    if (cached) return cached
    const stored = await this.readAsync(store => store.getCommit(hash))
    if (stored) this.putCommitMemory(stored)
    return stored
  }

  putCommit(commit: GitNaturalCommitObject): void {
    this.putCommitMemory(commit)
    this.persistAsync(store => store.putCommit(commit))
  }

  getBlob(hash: string): GitNaturalBlobObject | undefined {
    const key = gitNaturalCacheKeys.blob(hash)
    const cached = this.blobs.get(key)
    if (cached) this.touchMemoryEntry(key)
    return cached
  }

  async getBlobAsync(hash: string): Promise<GitNaturalBlobObject | undefined> {
    const cached = this.getBlob(hash)
    if (cached) return cached
    const stored = await this.readAsync(store => store.getBlob(hash))
    if (stored) this.putBlobMemory(stored)
    return stored
  }

  putBlob(blob: GitNaturalBlobObject): void {
    this.putBlobMemory(blob)
    this.persistAsync(store => store.putBlob(blob))
  }

  getTree(hash: string): GitNaturalTreeObject | undefined {
    const key = gitNaturalCacheKeys.tree(hash)
    const cached = this.trees.get(key)
    if (cached) this.touchMemoryEntry(key)
    return cached
  }

  async getTreeAsync(hash: string): Promise<GitNaturalTreeObject | undefined> {
    const cached = this.getTree(hash)
    if (cached) return cached
    const stored = await this.readAsync(store => store.getTree(hash))
    if (stored) this.putTreeMemory(stored)
    return stored
  }

  putTree(tree: GitNaturalTreeObject): void {
    this.putTreeMemory(tree)
    this.persistAsync(store => store.putTree(tree))
  }

  getRawObjectBatch(commitHash: string, filter: string): GitNaturalRawObjectBatch | undefined {
    const key = gitNaturalCacheKeys.rawObjectBatch(commitHash, filter)
    const cached = this.rawObjectBatches.get(key)
    if (cached) this.touchMemoryEntry(key)
    return cached
  }

  async getRawObjectBatchAsync(
    commitHash: string,
    filter: string,
  ): Promise<GitNaturalRawObjectBatch | undefined> {
    const cached = this.getRawObjectBatch(commitHash, filter)
    if (cached) return cached
    const stored = await this.readAsync(store => store.getRawObjectBatch(commitHash, filter))
    if (stored) this.putRawObjectBatchMemory(stored)
    return stored
  }

  putRawObjectBatch(batch: GitNaturalRawObjectBatch): void {
    this.putRawObjectBatchMemory(batch)
    this.persistAsync(store => store.putRawObjectBatch(batch))
  }

  getHistoryBatch<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): GitNaturalHistoryBatch<TCommit> | undefined {
    const key = gitNaturalCacheKeys.historyBatch(startCommitHash, limit)
    const cached = this.historyBatches.get(key) as GitNaturalHistoryBatch<TCommit> | undefined
    if (cached) this.touchMemoryEntry(key)
    return cached
  }

  async getHistoryBatchAsync<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): Promise<GitNaturalHistoryBatch<TCommit> | undefined> {
    const cached = this.getHistoryBatch<TCommit>(startCommitHash, limit)
    if (cached) return cached
    const stored = await this.readAsync(store =>
      store.getHistoryBatch<TCommit>(startCommitHash, limit),
    )
    if (stored) this.putHistoryBatchMemory(stored)
    return stored
  }

  putHistoryBatch<TCommit extends GitNaturalCommitObject>(
    batch: GitNaturalHistoryBatch<TCommit>,
  ): void {
    this.putHistoryBatchMemory(batch)
    this.persistAsync(store => store.putHistoryBatch(batch))
  }

  async flushPersistence(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites))
  }

  close(): void {
    this.asyncStore?.close?.()
  }

  getMemoryStats(): GitNaturalMemoryStats {
    return {
      entries: this.memoryLru.size,
      bytes: this.memoryBytes,
      maxEntries: this.maxMemoryEntries,
      maxBytes: this.maxMemoryBytes,
    }
  }

  clearMemory(): void {
    this.infoRefs.clear()
    this.commits.clear()
    this.blobs.clear()
    this.trees.clear()
    this.rawObjectBatches.clear()
    this.historyBatches.clear()
    this.memoryLru.clear()
    this.memoryBytes = 0
  }

  private putCommitMemory(commit: GitNaturalCommitObject): void {
    const key = gitNaturalCacheKeys.commit(commit.hash)
    this.commits.set(key, commit)
    this.rememberMemoryEntry(key, estimateCommitSize(commit))
  }

  private putBlobMemory(blob: GitNaturalBlobObject): void {
    const key = gitNaturalCacheKeys.blob(blob.hash)
    this.blobs.set(key, blob)
    this.rememberMemoryEntry(key, blob.data.byteLength)
  }

  private putTreeMemory(tree: GitNaturalTreeObject): void {
    const key = gitNaturalCacheKeys.tree(tree.hash)
    this.trees.set(key, tree)
    this.rememberMemoryEntry(key, estimateTreeSize(tree))
  }

  private putRawObjectBatchMemory(batch: GitNaturalRawObjectBatch): void {
    const key = gitNaturalCacheKeys.rawObjectBatch(batch.commitHash, batch.filter)
    this.rawObjectBatches.set(key, batch)
    this.rememberMemoryEntry(key, estimateRawObjectBatchSize(batch))
  }

  private putHistoryBatchMemory<TCommit = GitNaturalCommitObject>(
    batch: GitNaturalHistoryBatch<TCommit>,
  ): void {
    const key = gitNaturalCacheKeys.historyBatch(batch.startCommitHash, batch.limit)
    const normalizedBatch = batch as GitNaturalHistoryBatch
    this.historyBatches.set(key, normalizedBatch)
    this.rememberMemoryEntry(key, estimateHistoryBatchSize(normalizedBatch))
  }

  private touchMemoryEntry(key: string): void {
    const size = this.memoryLru.get(key)
    if (size === undefined) return

    this.memoryLru.delete(key)
    this.memoryLru.set(key, size)
  }

  private rememberMemoryEntry(key: string, size: number): void {
    const normalizedSize = Math.max(0, Math.round(size || 0))
    const existingSize = this.memoryLru.get(key)
    if (existingSize !== undefined) {
      this.memoryLru.delete(key)
      this.memoryBytes -= existingSize
    }

    this.memoryLru.set(key, normalizedSize)
    this.memoryBytes += normalizedSize
    this.evictMemoryEntries()
  }

  private evictMemoryEntries(): void {
    while (
      this.memoryLru.size > 0 &&
      (this.memoryLru.size > this.maxMemoryEntries || this.memoryBytes > this.maxMemoryBytes)
    ) {
      const oldest = this.memoryLru.entries().next().value as [string, number] | undefined
      if (!oldest) return
      this.deleteMemoryEntry(oldest[0])
    }
  }

  private deleteMemoryEntry(key: string): void {
    const size = this.memoryLru.get(key)
    if (size === undefined) return

    this.memoryLru.delete(key)
    this.memoryBytes = Math.max(0, this.memoryBytes - size)

    if (key.startsWith("commit:")) this.commits.delete(key)
    else if (key.startsWith("blob:")) this.blobs.delete(key)
    else if (key.startsWith("tree:")) this.trees.delete(key)
    else if (key.startsWith("raw:")) this.rawObjectBatches.delete(key)
    else if (key.startsWith("history:")) this.historyBatches.delete(key)
  }

  private async readAsync<T>(
    operation: (store: GitNaturalAsyncObjectStore) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    if (!this.asyncStore) return undefined
    try {
      return await operation(this.asyncStore)
    } catch {
      return undefined
    }
  }

  private persistAsync(operation: (store: GitNaturalAsyncObjectStore) => Promise<void>): void {
    if (!this.asyncStore) return
    const write = operation(this.asyncStore).catch(() => undefined)
    this.pendingWrites.add(write)
    void write.finally(() => this.pendingWrites.delete(write))
  }
}

function getBytesLength(data?: Uint8Array): number {
  return data?.byteLength || 0
}

function estimateCommitSize(commit: GitNaturalCommitObject): number {
  return (
    normalizeObjectHash(commit.hash).length +
    String(commit.tree || "").length +
    (commit.parents || []).reduce((total, parent) => total + String(parent || "").length, 0) +
    getBytesLength(commit.data)
  )
}

function estimateTreeSize(tree: GitNaturalTreeObject): number {
  const entriesSize = (tree.entries || []).reduce(
    (total, entry) =>
      total +
      String(entry.name || "").length +
      String(entry.mode || "").length +
      String(entry.hash || "").length +
      String(entry.type || "").length,
    0,
  )

  return normalizeObjectHash(tree.hash).length + getBytesLength(tree.data) + entriesSize
}

function estimateRawObjectBatchSize(batch: GitNaturalRawObjectBatch): number {
  let size = normalizeObjectHash(batch.commitHash).length + String(batch.filter || "").length
  for (const [hash, object] of batch.objects.entries()) {
    size +=
      String(hash || "").length + String(object.type || "").length + getBytesLength(object.data)
  }
  return size
}

function estimateHistoryBatchSize(batch: GitNaturalHistoryBatch): number {
  return batch.commits.reduce(
    (total, commit) => total + estimateCommitSize(commit),
    String(batch.startCommitHash || "").length + String(batch.limit || "").length,
  )
}
