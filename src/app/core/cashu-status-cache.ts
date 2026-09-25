import type {CashuTokenCheck} from "./cashu-token-status"
import {runCashuBackground} from "./cashu-background"
import {beginCashuDiagnostic} from "./cashu-diagnostics"

export const CASHU_STATUS_DB = "budabit-cashu-status-v1"
export const LEGACY_CHECKS_KEY = "budabit_cashu_token_checks_v1"
export const STATUS_CACHE_LIMIT = 2000
export const STATUS_CACHE_AGE = 30 * 24 * 60 * 60 * 1000
export type OperationRef = {
  key: string
  identity: string
  kind: "send" | "receive"
  operationId: string
  priority: number
}
type Observation = {id: string; touchedAt: number; attemptedAt?: number; check?: CashuTokenCheck}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error || new Error("Status cache transaction aborted"))
    tx.onerror = () => {} // onabort is the terminal error event
  })
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id)
export const validCashuCheck = (
  check: CashuTokenCheck | undefined,
  now: number,
): check is CashuTokenCheck =>
  Boolean(
    check &&
    ["spent", "unspent", "partial", "pending"].includes(check.state) &&
    [check.checkedAt, check.spent, check.unspent, check.pending].every(
      n => Number.isSafeInteger(n) && n >= 0,
    ) &&
    check.checkedAt <= now &&
    (check.state === "spent" || check.checkedAt > now - STATUS_CACHE_AGE) &&
    Number.isSafeInteger(check.spent + check.unspent + check.pending) &&
    (check.state === "spent"
      ? check.spent > 0 && !check.unspent && !check.pending
      : check.state === "unspent"
        ? check.unspent > 0 && !check.spent && !check.pending
        : check.state === "partial"
          ? check.spent > 0 && check.unspent + check.pending > 0
          : check.pending > 0 && !check.spent),
  )

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(CASHU_STATUS_DB, 1)
    opening.onupgradeneeded = () => {
      const db = opening.result
      db.createObjectStore("meta")
      db.createObjectStore("checks", {keyPath: "id"}).createIndex("touchedAt", "touchedAt")
      db.createObjectStore("operations", {keyPath: "key"}).createIndex("identity", "identity")
    }
    opening.onsuccess = () => {
      opening.result.onversionchange = () => opening.result.close()
      resolve(opening.result)
    }
    opening.onerror = () => reject(opening.error)
  })

// Runs inside the writer transaction: concurrent tabs cannot exceed the cap or
// overwrite a newer observation with a stale read-modify-write snapshot.
const prune = async (store: IDBObjectStore, now: number) => {
  await new Promise<void>((resolve, reject) => {
    const cursor = store
      .index("touchedAt")
      .openCursor(IDBKeyRange.upperBound(now - STATUS_CACHE_AGE))
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return resolve()
      if ((row.value as Observation).check?.state !== "spent") row.delete()
      row.continue()
    }
  })
  let excess = (await request(store.count())) - STATUS_CACHE_LIMIT
  if (excess <= 0) return
  await new Promise<void>((resolve, reject) => {
    const cursor = store.index("touchedAt").openCursor()
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row || excess-- <= 0) return resolve()
      row.delete()
      row.continue()
    }
  })
}

/** Disposable summaries and a rebuildable index; never the wallet's source of truth. */
export class CashuStatusCache {
  private closed = false
  private db?: IDBDatabase
  private epoch = ""
  private ready?: Promise<void>
  private maintenance?: Promise<void>
  private controller = new AbortController()
  private ensureReady() {
    return (this.ready ||= this.initialize())
  }
  private maintain() {
    return (this.maintenance ||= runCashuBackground(
      "cache-maintenance",
      async () => {
        await this.ensureReady()
        await this.migrate()
      },
      this.controller.signal,
    ))
  }
  private async initialize() {
    const finish = beginCashuDiagnostic("cache-open")
    try {
      const db = await openDatabase()
      if (this.closed) {
        db.close()
        throw new Error("Status cache closed")
      }
      this.db = db
      const tx = db.transaction("meta", "readwrite")
      const done = completed(tx)
      this.epoch = (await request(tx.objectStore("meta").get("epoch"))) || crypto.randomUUID()
      tx.objectStore("meta").put(this.epoch, "epoch")
      await done
      finish?.()
    } catch (error) {
      finish?.({outcome: "error"})
      throw error
    }
  }
  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
    initializing = false,
  ): Promise<T> {
    if (!initializing) await this.ensureReady()
    if (this.closed || !this.db) throw new Error("Status cache closed")
    const tx = this.db.transaction(["meta", ...stores], mode)
    const done = completed(tx)
    void done.catch(() => {})
    try {
      if ((await request(tx.objectStore("meta").get("epoch"))) !== this.epoch || this.closed)
        throw new Error("Wallet session changed")
      const result = await fn(tx)
      await done
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* May already have aborted. */
      }
      throw error
    }
  }
  private async migrate() {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(LEGACY_CHECKS_KEY)
    } catch {
      /* Optional legacy cache. */
    }
    const now = Date.now()
    let entries: [string, CashuTokenCheck][] = []
    // Large legacy caches are disposable; avoid parsing an arbitrarily large
    // synchronous JSON blob on memory-constrained phones.
    if (raw && raw.length <= 2_000_000) {
      try {
        entries = Object.entries(JSON.parse(raw)).filter(
          ([id, check]) => validId(id) && validCashuCheck(check as CashuTokenCheck, now),
        ) as typeof entries
        entries.sort((a, b) => b[1].checkedAt - a[1].checkedAt)
        entries = entries.slice(0, STATUS_CACHE_LIMIT)
      } catch {
        /* Invalid legacy display data can be discarded. */
      }
    }
    await this.transaction(
      ["checks"],
      "readwrite",
      async tx => {
        const store = tx.objectStore("checks")
        for (const [id, check] of entries) {
          const current = await request<Observation | undefined>(store.get(id))
          const previous = validCashuCheck(current?.check, now) ? current.check : undefined
          if (!previous || (previous.state !== "spent" && previous.checkedAt < check.checkedAt))
            store.put({
              id,
              check,
              touchedAt: Math.max(current?.touchedAt || 0, check.checkedAt),
              attemptedAt: current?.attemptedAt,
            })
        }
        await prune(store, now)
      },
      true,
    )
    // Commit first. If migration fails, the old cache remains available to retry.
    if (raw !== null)
      try {
        localStorage.removeItem(LEGACY_CHECKS_KEY)
      } catch {
        /* Retry next time. */
      }
  }
  async get(id: string) {
    await this.maintain()
    return this.transaction(["checks"], "readonly", async tx => {
      const row = await request<Observation | undefined>(tx.objectStore("checks").get(id))
      return validCashuCheck(row?.check, Date.now()) ? row!.check : undefined
    })
  }
  async put(id: string, check: CashuTokenCheck) {
    if (!validId(id) || !validCashuCheck(check, Date.now())) return
    await this.maintain()
    await this.transaction(["checks"], "readwrite", async tx => {
      const store = tx.objectStore("checks")
      const current = await request<Observation | undefined>(store.get(id))
      const previous = validCashuCheck(current?.check, Date.now()) ? current.check : undefined
      if (!previous || (previous.state !== "spent" && previous.checkedAt <= check.checkedAt))
        store.put({
          id,
          check,
          touchedAt: Math.max(current?.touchedAt || 0, check.checkedAt),
          attemptedAt: current?.attemptedAt,
        })
      await prune(store, Date.now())
    })
  }
  async claim(id: string, interval: number) {
    await this.maintain()
    return this.transaction(["checks"], "readwrite", async tx => {
      const store = tx.objectStore("checks")
      const current = await request<Observation | undefined>(store.get(id))
      const now = Date.now()
      const last = Math.max(current?.attemptedAt || 0, current?.check?.checkedAt || 0)
      if (
        (validCashuCheck(current?.check, now) && current.check.state === "spent") ||
        (interval > 0 && last <= now && now - last < interval)
      )
        return false
      store.put({
        id,
        check: validCashuCheck(current?.check, now) ? current?.check : undefined,
        touchedAt: now,
        attemptedAt: now,
      })
      await prune(store, now)
      return now
    })
  }
  async release(id: string, attemptedAt: number) {
    await this.transaction(["checks"], "readwrite", async tx => {
      const store = tx.objectStore("checks")
      const current = await request<Observation | undefined>(store.get(id))
      if (current?.attemptedAt === attemptedAt) store.put({...current, attemptedAt: undefined})
    })
  }
  async refs(identity: string): Promise<OperationRef[]> {
    return this.transaction(["operations"], "readonly", tx =>
      request(tx.objectStore("operations").index("identity").getAll(identity)),
    )
  }
  async index(refs: OperationRef[]) {
    await this.transaction(["operations"], "readwrite", async tx => {
      const store = tx.objectStore("operations")
      for (const ref of refs) {
        const current = await request<OperationRef | undefined>(store.get(ref.key))
        if (!current || current.operationId === ref.operationId || current.priority <= ref.priority)
          store.put(ref)
      }
    })
  }
  close() {
    this.closed = true
    this.controller.abort()
    this.db?.close()
  }
}

export const clearCashuTokenChecks = async () => {
  try {
    localStorage.removeItem(LEGACY_CHECKS_KEY)
  } catch {
    /* Optional storage. */
  }
  // Changing the epoch invalidates old tabs and in-flight index/check writers.
  const db = await openDatabase()
  try {
    const tx = db.transaction(["meta", "checks", "operations"], "readwrite")
    const done = completed(tx)
    tx.objectStore("meta").put(crypto.randomUUID(), "epoch")
    tx.objectStore("checks").clear()
    tx.objectStore("operations").clear()
    await done
  } finally {
    db.close()
  }
}
