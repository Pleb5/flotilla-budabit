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
}

export class GitNaturalObjectCache {
  private readonly infoRefsTtlMs: number
  private readonly now: () => number
  private readonly infoRefs = new Map<string, TimedInfoRefs>()
  private readonly commits = new Map<string, GitNaturalCommitObject>()
  private readonly blobs = new Map<string, GitNaturalBlobObject>()
  private readonly trees = new Map<string, GitNaturalTreeObject>()
  private readonly rawObjectBatches = new Map<string, GitNaturalRawObjectBatch>()
  private readonly historyBatches = new Map<string, GitNaturalHistoryBatch>()

  constructor(config: GitNaturalObjectCacheConfig = {}) {
    this.infoRefsTtlMs = config.infoRefsTtlMs ?? DEFAULT_NATURAL_INFO_REFS_TTL_MS
    this.now = config.now ?? (() => Date.now())
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

  putCommit(commit: GitNaturalCommitObject): void {
    this.commits.set(gitNaturalCacheKeys.commit(commit.hash), commit)
  }

  getBlob(hash: string): GitNaturalBlobObject | undefined {
    return this.blobs.get(gitNaturalCacheKeys.blob(hash))
  }

  putBlob(blob: GitNaturalBlobObject): void {
    this.blobs.set(gitNaturalCacheKeys.blob(blob.hash), blob)
  }

  getTree(hash: string): GitNaturalTreeObject | undefined {
    return this.trees.get(gitNaturalCacheKeys.tree(hash))
  }

  putTree(tree: GitNaturalTreeObject): void {
    this.trees.set(gitNaturalCacheKeys.tree(tree.hash), tree)
  }

  getRawObjectBatch(commitHash: string, filter: string): GitNaturalRawObjectBatch | undefined {
    return this.rawObjectBatches.get(gitNaturalCacheKeys.rawObjectBatch(commitHash, filter))
  }

  putRawObjectBatch(batch: GitNaturalRawObjectBatch): void {
    this.rawObjectBatches.set(
      gitNaturalCacheKeys.rawObjectBatch(batch.commitHash, batch.filter),
      batch,
    )
  }

  getHistoryBatch<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): GitNaturalHistoryBatch<TCommit> | undefined {
    return this.historyBatches.get(gitNaturalCacheKeys.historyBatch(startCommitHash, limit)) as
      | GitNaturalHistoryBatch<TCommit>
      | undefined
  }

  putHistoryBatch<TCommit extends GitNaturalCommitObject>(batch: GitNaturalHistoryBatch<TCommit>): void {
    this.historyBatches.set(
      gitNaturalCacheKeys.historyBatch(batch.startCommitHash, batch.limit),
      batch as GitNaturalHistoryBatch,
    )
  }

  clearMemory(): void {
    this.infoRefs.clear()
    this.commits.clear()
    this.blobs.clear()
    this.trees.clear()
    this.rawObjectBatches.clear()
    this.historyBatches.clear()
  }
}
