import {
  gitNaturalCacheKeys,
  type GitNaturalAsyncObjectStore,
  type GitNaturalBlobObject,
  type GitNaturalCommitObject,
  type GitNaturalHistoryBatch,
  type GitNaturalRawObject,
  type GitNaturalRawObjectBatch,
  type GitNaturalTreeObject,
} from "./natural-read-cache.js"

const DEFAULT_DB_NAME = "nostr-git-natural-cache"
const DEFAULT_DB_VERSION = 1
const STORE_OBJECTS = "objects"
const RECORD_VERSION = 1
const DEFAULT_MAX_ENTRIES = 5_000
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024
const DEFAULT_CLEANUP_EVERY_WRITES = 50

export interface GitNaturalIndexedObjectStoreConfig {
  dbName?: string
  dbVersion?: number
  indexedDB?: IDBFactory | null
  now?: () => number
  maxEntries?: number
  maxBytes?: number
  cleanupEveryWrites?: number
}

type GitNaturalIndexedRecordKind = "commit" | "tree" | "blob" | "raw" | "history"

interface GitNaturalIndexedRecordBase {
  key: string
  kind: GitNaturalIndexedRecordKind
  version: number
  size: number
  createdAt: number
  lastUpdatedAt: number
  lastAccessedAt: number
}

interface CommitRecord extends GitNaturalIndexedRecordBase {
  kind: "commit"
  commit: GitNaturalCommitObject
}

interface TreeRecord extends GitNaturalIndexedRecordBase {
  kind: "tree"
  tree: GitNaturalTreeObject
}

interface BlobRecord extends GitNaturalIndexedRecordBase {
  kind: "blob"
  blob: GitNaturalBlobObject
}

interface RawBatchRecord extends GitNaturalIndexedRecordBase {
  kind: "raw"
  batch: {
    commitHash: string
    filter: string
    objects: Array<[string, GitNaturalRawObject]>
    fetchedAt: number
  }
}

interface HistoryBatchRecord<TCommit = GitNaturalCommitObject> extends GitNaturalIndexedRecordBase {
  kind: "history"
  batch: GitNaturalHistoryBatch<TCommit>
}

type GitNaturalIndexedRecord =
  | CommitRecord
  | TreeRecord
  | BlobRecord
  | RawBatchRecord
  | HistoryBatchRecord

export class GitNaturalIndexedObjectStore implements GitNaturalAsyncObjectStore {
  private readonly dbName: string
  private readonly dbVersion: number
  private readonly indexedDBFactory?: IDBFactory | null
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly cleanupEveryWrites: number
  private db: IDBDatabase | null = null
  private dbPromise: Promise<IDBDatabase | null> | null = null
  private disabled = false
  private writeCount = 0

  constructor(config: GitNaturalIndexedObjectStoreConfig = {}) {
    this.dbName = config.dbName ?? DEFAULT_DB_NAME
    this.dbVersion = config.dbVersion ?? DEFAULT_DB_VERSION
    this.indexedDBFactory = config.indexedDB
    this.now = config.now ?? (() => Date.now())
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    this.cleanupEveryWrites = Math.max(1, config.cleanupEveryWrites ?? DEFAULT_CLEANUP_EVERY_WRITES)
  }

  async getCommit(hash: string): Promise<GitNaturalCommitObject | undefined> {
    return (await this.getRecord<CommitRecord>(gitNaturalCacheKeys.commit(hash), "commit"))?.commit
  }

  async putCommit(commit: GitNaturalCommitObject): Promise<void> {
    await this.putRecord({
      key: gitNaturalCacheKeys.commit(commit.hash),
      kind: "commit",
      commit,
      size: estimateCommitSize(commit),
    })
  }

  async getBlob(hash: string): Promise<GitNaturalBlobObject | undefined> {
    return (await this.getRecord<BlobRecord>(gitNaturalCacheKeys.blob(hash), "blob"))?.blob
  }

  async putBlob(blob: GitNaturalBlobObject): Promise<void> {
    await this.putRecord({
      key: gitNaturalCacheKeys.blob(blob.hash),
      kind: "blob",
      blob,
      size: blob.data.length,
    })
  }

  async getTree(hash: string): Promise<GitNaturalTreeObject | undefined> {
    return (await this.getRecord<TreeRecord>(gitNaturalCacheKeys.tree(hash), "tree"))?.tree
  }

  async putTree(tree: GitNaturalTreeObject): Promise<void> {
    await this.putRecord({
      key: gitNaturalCacheKeys.tree(tree.hash),
      kind: "tree",
      tree,
      size: estimateTreeSize(tree),
    })
  }

  async getRawObjectBatch(commitHash: string, filter: string): Promise<GitNaturalRawObjectBatch | undefined> {
    const record = await this.getRecord<RawBatchRecord>(gitNaturalCacheKeys.rawObjectBatch(commitHash, filter), "raw")
    if (!record) return undefined
    return {
      commitHash: record.batch.commitHash,
      filter: record.batch.filter,
      objects: new Map(record.batch.objects),
      fetchedAt: record.batch.fetchedAt,
    }
  }

  async putRawObjectBatch(batch: GitNaturalRawObjectBatch): Promise<void> {
    const objects = Array.from(batch.objects.entries())
    await this.putRecord({
      key: gitNaturalCacheKeys.rawObjectBatch(batch.commitHash, batch.filter),
      kind: "raw",
      batch: {
        commitHash: batch.commitHash,
        filter: batch.filter,
        objects,
        fetchedAt: batch.fetchedAt,
      },
      size: objects.reduce((total, [, object]) => total + object.data.length, 0),
    })
  }

  async getHistoryBatch<TCommit = GitNaturalCommitObject>(
    startCommitHash: string,
    limit: number,
  ): Promise<GitNaturalHistoryBatch<TCommit> | undefined> {
    return (
      await this.getRecord<HistoryBatchRecord<TCommit>>(
        gitNaturalCacheKeys.historyBatch(startCommitHash, limit),
        "history",
      )
    )?.batch
  }

  async putHistoryBatch<TCommit extends GitNaturalCommitObject>(
    batch: GitNaturalHistoryBatch<TCommit>,
  ): Promise<void> {
    await this.putRecord({
      key: gitNaturalCacheKeys.historyBatch(batch.startCommitHash, batch.limit),
      kind: "history",
      batch,
      size: estimateHistorySize(batch),
    })
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.dbPromise = null
  }

  private async open(): Promise<IDBDatabase | null> {
    if (this.disabled) return null
    if (this.dbPromise) return this.dbPromise

    const factory = this.resolveIndexedDB()
    if (!factory) {
      this.disabled = true
      return null
    }

    this.dbPromise = new Promise(resolve => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(this.dbName, this.dbVersion)
      } catch {
        this.disabled = true
        resolve(null)
        return
      }

      request.onerror = () => {
        this.dbPromise = null
        resolve(null)
      }
      request.onblocked = () => resolve(null)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
          const store = db.createObjectStore(STORE_OBJECTS, {keyPath: "key"})
          store.createIndex("kind", "kind")
          store.createIndex("lastAccessedAt", "lastAccessedAt")
          store.createIndex("lastUpdatedAt", "lastUpdatedAt")
        }
      }
      request.onsuccess = () => {
        this.db = request.result
        resolve(request.result)
      }
    })

    return this.dbPromise
  }

  private resolveIndexedDB(): IDBFactory | undefined {
    if (this.indexedDBFactory !== undefined) return this.indexedDBFactory ?? undefined
    return typeof globalThis.indexedDB === "undefined" ? undefined : globalThis.indexedDB
  }

  private async getRecord<TRecord extends GitNaturalIndexedRecordBase>(
    key: string,
    kind: GitNaturalIndexedRecordKind,
  ): Promise<TRecord | undefined> {
    const db = await this.open()
    if (!db) return undefined

    return new Promise(resolve => {
      let record: TRecord | undefined
      let settled = false
      const finish = (value?: TRecord) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      try {
        const tx = db.transaction(STORE_OBJECTS, "readwrite")
        tx.onabort = () => finish(undefined)
        tx.onerror = () => finish(undefined)
        tx.oncomplete = () => finish(record)
        const store = tx.objectStore(STORE_OBJECTS)
        const request = store.get(key)
        request.onerror = () => finish(undefined)
        request.onsuccess = () => {
          const result = request.result as TRecord | undefined
          if (!result || result.kind !== kind || result.version !== RECORD_VERSION) return
          record = {...result, lastAccessedAt: this.now()}
          store.put(record)
        }
      } catch {
        finish(undefined)
      }
    })
  }

  private async putRecord<TRecord extends Omit<GitNaturalIndexedRecord, keyof GitNaturalIndexedRecordBase> & {
    key: string
    kind: GitNaturalIndexedRecordKind
    size: number
  }>(record: TRecord): Promise<void> {
    const db = await this.open()
    if (!db) return

    const now = this.now()
    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }

      try {
        const tx = db.transaction(STORE_OBJECTS, "readwrite")
        tx.onabort = finish
        tx.onerror = finish
        tx.oncomplete = finish
        const store = tx.objectStore(STORE_OBJECTS)
        const existingRequest = store.get(record.key)
        existingRequest.onerror = finish
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as GitNaturalIndexedRecord | undefined
          store.put({
            ...record,
            version: RECORD_VERSION,
            createdAt: existing?.createdAt ?? now,
            lastUpdatedAt: now,
            lastAccessedAt: now,
          })
        }
      } catch {
        finish()
      }
    })

    this.writeCount += 1
    if (this.writeCount % this.cleanupEveryWrites === 0) await this.cleanup()
  }

  private async cleanup(): Promise<void> {
    const records = await this.getAllRecords()
    if (records.length === 0) return

    let totalBytes = records.reduce((total, record) => total + Math.max(0, record.size || 0), 0)
    if (records.length <= this.maxEntries && totalBytes <= this.maxBytes) return

    const keysToDelete: string[] = []
    const oldestFirst = [...records].sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
    for (const record of oldestFirst) {
      if (records.length - keysToDelete.length <= this.maxEntries && totalBytes <= this.maxBytes) break
      keysToDelete.push(record.key)
      totalBytes -= Math.max(0, record.size || 0)
    }

    await this.deleteRecords(keysToDelete)
  }

  private async getAllRecords(): Promise<GitNaturalIndexedRecord[]> {
    const db = await this.open()
    if (!db) return []

    return new Promise(resolve => {
      let settled = false
      const finish = (records: GitNaturalIndexedRecord[] = []) => {
        if (settled) return
        settled = true
        resolve(records)
      }

      try {
        const tx = db.transaction(STORE_OBJECTS, "readonly")
        tx.onabort = () => finish([])
        tx.onerror = () => finish([])
        const request = tx.objectStore(STORE_OBJECTS).getAll()
        request.onerror = () => finish([])
        request.onsuccess = () => finish((request.result || []) as GitNaturalIndexedRecord[])
      } catch {
        finish([])
      }
    })
  }

  private async deleteRecords(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const db = await this.open()
    if (!db) return

    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }

      try {
        const tx = db.transaction(STORE_OBJECTS, "readwrite")
        tx.onabort = finish
        tx.onerror = finish
        tx.oncomplete = finish
        const store = tx.objectStore(STORE_OBJECTS)
        for (const key of keys) store.delete(key)
      } catch {
        finish()
      }
    })
  }
}

export function createGitNaturalIndexedObjectStore(
  config: GitNaturalIndexedObjectStoreConfig = {},
): GitNaturalAsyncObjectStore {
  return new GitNaturalIndexedObjectStore(config)
}

function estimateCommitSize(commit: GitNaturalCommitObject): number {
  return commit.data?.length ?? 160 + (commit.parents?.length ?? 0) * 40
}

function estimateTreeSize(tree: GitNaturalTreeObject): number {
  return tree.data?.length ?? (tree.entries?.length ?? 0) * 80
}

function estimateHistorySize<TCommit extends GitNaturalCommitObject>(
  batch: GitNaturalHistoryBatch<TCommit>,
): number {
  return batch.commits.reduce((total, commit) => total + estimateCommitSize(commit), 0)
}
