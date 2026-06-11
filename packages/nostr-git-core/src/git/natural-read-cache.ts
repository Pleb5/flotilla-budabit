export const DEFAULT_NATURAL_INFO_REFS_TTL_MS = 60_000

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
  getRawObjectBatch(commitHash: string, filter: string): Promise<GitNaturalRawObjectBatch | undefined>
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
  return String(hash || "").trim().toLowerCase()
}

function normalizeUrlKey(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "")
}

interface TimedInfoRefs {
  infoRefs: GitNaturalInfoRefs
  fetchedAt: number
}

export interface GitNaturalObjectCacheConfig {
  infoRefsTtlMs?: number
  now?: () => number
  asyncStore?: GitNaturalAsyncObjectStore | false
}

export class GitNaturalObjectCache {
  private readonly infoRefsTtlMs: number
  private readonly now: () => number
  private readonly asyncStore?: GitNaturalAsyncObjectStore
  private readonly pendingWrites = new Set<Promise<void>>()
  private readonly infoRefs = new Map<string, TimedInfoRefs>()
  private readonly commits = new Map<string, GitNaturalCommitObject>()
  private readonly blobs = new Map<string, GitNaturalBlobObject>()
  private readonly trees = new Map<string, GitNaturalTreeObject>()
  private readonly rawObjectBatches = new Map<string, GitNaturalRawObjectBatch>()
  private readonly historyBatches = new Map<string, GitNaturalHistoryBatch>()

  constructor(config: GitNaturalObjectCacheConfig = {}) {
    this.infoRefsTtlMs = config.infoRefsTtlMs ?? DEFAULT_NATURAL_INFO_REFS_TTL_MS
    this.now = config.now ?? (() => Date.now())
    this.asyncStore = config.asyncStore || undefined
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
    return this.commits.get(gitNaturalCacheKeys.commit(hash))
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
    return this.blobs.get(gitNaturalCacheKeys.blob(hash))
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
    return this.trees.get(gitNaturalCacheKeys.tree(hash))
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
    return this.rawObjectBatches.get(gitNaturalCacheKeys.rawObjectBatch(commitHash, filter))
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
    return this.historyBatches.get(gitNaturalCacheKeys.historyBatch(startCommitHash, limit)) as
      | GitNaturalHistoryBatch<TCommit>
      | undefined
  }

  async getHistoryBatchAsync<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): Promise<GitNaturalHistoryBatch<TCommit> | undefined> {
    const cached = this.getHistoryBatch<TCommit>(startCommitHash, limit)
    if (cached) return cached
    const stored = await this.readAsync(store => store.getHistoryBatch<TCommit>(startCommitHash, limit))
    if (stored) this.putHistoryBatchMemory(stored)
    return stored
  }

  putHistoryBatch<TCommit extends GitNaturalCommitObject>(batch: GitNaturalHistoryBatch<TCommit>): void {
    this.putHistoryBatchMemory(batch)
    this.persistAsync(store => store.putHistoryBatch(batch))
  }

  async flushPersistence(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites))
  }

  close(): void {
    this.asyncStore?.close?.()
  }

  clearMemory(): void {
    this.infoRefs.clear()
    this.commits.clear()
    this.blobs.clear()
    this.trees.clear()
    this.rawObjectBatches.clear()
    this.historyBatches.clear()
  }

  private putCommitMemory(commit: GitNaturalCommitObject): void {
    this.commits.set(gitNaturalCacheKeys.commit(commit.hash), commit)
  }

  private putBlobMemory(blob: GitNaturalBlobObject): void {
    this.blobs.set(gitNaturalCacheKeys.blob(blob.hash), blob)
  }

  private putTreeMemory(tree: GitNaturalTreeObject): void {
    this.trees.set(gitNaturalCacheKeys.tree(tree.hash), tree)
  }

  private putRawObjectBatchMemory(batch: GitNaturalRawObjectBatch): void {
    this.rawObjectBatches.set(
      gitNaturalCacheKeys.rawObjectBatch(batch.commitHash, batch.filter),
      batch,
    )
  }

  private putHistoryBatchMemory<TCommit = GitNaturalCommitObject>(
    batch: GitNaturalHistoryBatch<TCommit>,
  ): void {
    this.historyBatches.set(
      gitNaturalCacheKeys.historyBatch(batch.startCommitHash, batch.limit),
      batch as GitNaturalHistoryBatch,
    )
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
