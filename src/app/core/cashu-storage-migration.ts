// Pre-upgrade recovery material stays local, separate from the live wallet. It is
// never automatically restored: proofs in a snapshot can have been spent since.
const LEGACY_MAX_VERSION = 170 // Coco 1.0.0: Dexie schema 17
const OPEN_TIMEOUT_MS = 10_000

export const cashuSnapshotDatabaseName = (name: string) => `${name}-pre-coco-v2`

export interface CashuDatabaseSnapshot {
  source: string
  version: number
  capturedAt: number
  stores: {
    name: string
    keyPath: string | string[] | null
    autoIncrement: boolean
    indexes: {name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean}[]
    keys: IDBValidKey[]
    rows: unknown[]
  }[]
}

const openExisting = (name: string): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    let absent = false
    let settled = false
    const request = indexedDB.open(name)
    const timer = setTimeout(() => {
      settled = true
      reject(new Error("Wallet storage is busy. Close other Budabit tabs and try again."))
    }, OPEN_TIMEOUT_MS)
    request.onupgradeneeded = () => {
      absent = true
      request.transaction!.abort() // Do not create a database just to look for one.
    }
    request.onerror = () => {
      clearTimeout(timer)
      if (!settled) absent ? resolve(null) : reject(request.error)
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      if (settled) request.result.close()
      else resolve(request.result)
    }
  })

export const readCashuDatabaseSnapshot = async (
  name: string,
): Promise<CashuDatabaseSnapshot | null> => {
  const db = await openExisting(name)
  if (!db) return null
  try {
    if (!db.objectStoreNames.length)
      return {source: name, version: db.version, capturedAt: Date.now(), stores: []}
    return await new Promise((resolve, reject) => {
      const snapshot: CashuDatabaseSnapshot = {
        source: name,
        version: db.version,
        capturedAt: Date.now(),
        stores: [],
      }
      // One read transaction gives a consistent view of all wallet tables.
      const tx = db.transaction(Array.from(db.objectStoreNames), "readonly")
      for (const name of Array.from(db.objectStoreNames)) {
        const store = tx.objectStore(name)
        const entry: CashuDatabaseSnapshot["stores"][number] = {
          name,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: Array.from(store.indexNames, name => {
            const index = store.index(name)
            return {
              name,
              keyPath: index.keyPath,
              unique: index.unique,
              multiEntry: index.multiEntry,
            }
          }),
          keys: [],
          rows: [],
        }
        snapshot.stores.push(entry)
        store.getAllKeys().onsuccess = event => {
          entry.keys = (event.target as IDBRequest<IDBValidKey[]>).result
        }
        store.getAll().onsuccess = event => {
          entry.rows = (event.target as IDBRequest<unknown[]>).result
        }
      }
      tx.oncomplete = () => resolve(snapshot)
      tx.onabort = () => reject(tx.error || new Error("Could not read wallet snapshot"))
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const prepareCashuStorageUpgrade = async (name: string): Promise<void> => {
  const source = await openExisting(name)
  if (!source) return
  const legacy = source.version <= LEGACY_MAX_VERSION
  source.close()
  if (!legacy) return

  const snapshot = await readCashuDatabaseSnapshot(name)
  if (!snapshot || snapshot.version > LEGACY_MAX_VERSION) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const request = indexedDB.open(cashuSnapshotDatabaseName(name), 1)
    const timer = setTimeout(() => {
      settled = true
      reject(
        new Error("Could not open wallet migration snapshot. Close other Budabit tabs and retry."),
      )
    }, OPEN_TIMEOUT_MS)
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots")
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      const db = request.result
      if (settled) {
        db.close()
        return
      }
      const tx = db.transaction("snapshots", "readwrite")
      tx.objectStore("snapshots").put(snapshot, "wallet")
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onabort = () => {
        db.close()
        reject(tx.error || new Error("Could not preserve wallet migration snapshot"))
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}
