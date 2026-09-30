import {openDB, type IDBPDatabase} from "idb"
import {getAddress, isReplaceable, type TrustedEvent} from "@welshman/util"
import {deletionDeletesEvent} from "./deletion-rules"

export const DELETION_CACHE_DATABASE = "budabit-deletions-v1"
export const DELETION_CACHE_LIMIT = 2048
export type DeletionRecord = {
  key: string
  target: string
  pubkey: string
  created_at: number
  storedAt: number
}
export type DeletionStorage = {
  get: (keys: string[]) => Promise<DeletionRecord[]>
  put: (records: DeletionRecord[]) => Promise<void>
}

const targetKey = (event: TrustedEvent) => {
  const target = isReplaceable(event) ? getAddress(event) : event.id
  return {target, key: `${target}:${event.pubkey}`}
}

/** Opens on first foreground demand. No getAll/startup replay or per-event writes. */
export const createDeletionStorage = () => {
  let connection: Promise<IDBPDatabase> | undefined
  const open = () =>
    (connection ||= openDB(DELETION_CACHE_DATABASE, 1, {
      upgrade(db) {
        db.createObjectStore("deletions", {keyPath: "key"}).createIndex("storedAt", "storedAt")
      },
      blocking() {
        void connection?.then(db => db.close())
        connection = undefined
      },
      terminated() {
        connection = undefined
      },
    }).catch(error => {
      connection = undefined
      throw error
    }))
  return {
    async get(keys: string[]) {
      const db = await open()
      const tx = db.transaction("deletions", "readonly")
      const records = await Promise.all(keys.map(key => tx.store.get(key)))
      await tx.done
      return records.filter(Boolean) as DeletionRecord[]
    },
    async put(records: DeletionRecord[]) {
      const db = await open()
      const tx = db.transaction("deletions", "readwrite")
      for (const record of records) {
        const current = (await tx.store.get(record.key)) as DeletionRecord | undefined
        if (!current || current.created_at < record.created_at) await tx.store.put(record)
      }
      let excess = (await tx.store.count()) - DELETION_CACHE_LIMIT
      let cursor = excess > 0 ? await tx.store.index("storedAt").openCursor() : null
      while (cursor && excess-- > 0) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      await tx.done
    },
    async clear() {
      if (connection) {
        const db = await connection
        await db.clear("deletions")
        db.close()
        connection = undefined
      } else if (typeof indexedDB !== "undefined") {
        const db = await open()
        await db.clear("deletions")
        db.close()
        connection = undefined
      }
    },
  }
}

export const createDeletionCache = ({
  storage,
  restore,
  now = Date.now,
}: {
  storage: DeletionStorage
  restore: (records: DeletionRecord[]) => void
  now?: () => number
}) => {
  const loaded = new Set<string>()
  const pending = new Map<string, DeletionRecord>()
  const written = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  const flush = async () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const records = [...pending.values()]
    pending.clear()
    try {
      if (records.length) await storage.put(records)
    } catch {
      for (const record of records) written.delete(record.key)
    }
  }
  const rememberKnown = (target: TrustedEvent, evidence: {pubkey: string; created_at: number}) => {
    if (evidence.pubkey !== target.pubkey) return
    if (isReplaceable(target) && evidence.created_at < target.created_at) return
    const {key, target: value} = targetKey(target)
    if ((written.get(key) ?? -1) >= evidence.created_at) return
    written.set(key, evidence.created_at)
    while (written.size > DELETION_CACHE_LIMIT) written.delete(written.keys().next().value!)
    pending.set(key, {
      key,
      target: value,
      pubkey: target.pubkey,
      created_at: evidence.created_at,
      storedAt: now(),
    })
    while (pending.size > DELETION_CACHE_LIMIT) pending.delete(pending.keys().next().value!)
    if (!timer) timer = setTimeout(() => void flush(), 1000)
  }
  return {
    async hydrate(events: TrustedEvent[], signal?: AbortSignal) {
      const keys = [...new Set(events.map(event => targetKey(event).key))].filter(
        key => !loaded.has(key),
      )
      const token = generation
      // Reads are bounded batches and never part of the content-ready barrier.
      for (
        let index = 0;
        index < keys.length && token === generation && !signal?.aborted;
        index += 100
      ) {
        const batch = keys.slice(index, index + 100).filter(key => !loaded.has(key))
        if (!batch.length) continue
        batch.forEach(key => loaded.add(key))
        try {
          const records = await storage.get(batch)
          if (token !== generation) return
          for (const record of records) {
            written.set(record.key, Math.max(written.get(record.key) ?? -1, record.created_at))
          }
          while (written.size > DELETION_CACHE_LIMIT) written.delete(written.keys().next().value!)
          // Finish an admitted batch for other consumers sharing its keys, but
          // leaving a page cancels all remaining batches.
          restore(records)
        } catch {
          if (token !== generation) return
          batch.forEach(key => loaded.delete(key))
        }
      }
      while (loaded.size > 4096) loaded.delete(loaded.values().next().value!)
    },
    remember(deletion: TrustedEvent, target: TrustedEvent) {
      if (!deletionDeletesEvent(deletion, target)) return
      rememberKnown(target, deletion)
    },
    rememberKnown,
    flush,
    reset() {
      generation++
      if (timer) clearTimeout(timer)
      timer = undefined
      pending.clear()
      loaded.clear()
      written.clear()
    },
  }
}
