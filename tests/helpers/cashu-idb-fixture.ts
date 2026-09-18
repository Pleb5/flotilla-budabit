import fixture from "../fixtures/cashu-v1-wallet.json"

export {fixture as legacyCashuWallet}

interface CashuDatabaseFixture {
  version: number
  stores: {
    name: string
    keyPath: string | string[] | null
    autoIncrement: boolean
    indexes: {name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean}[]
    rows: unknown[]
    keys?: IDBValidKey[]
  }[]
}

// Native IndexedDB recreation deliberately does not depend on the current Coco schema.
export const loadCashuDatabaseFixture = (name: string, data: CashuDatabaseFixture): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, data.version)
    request.onupgradeneeded = () => {
      for (const spec of data.stores) {
        const store = request.result.createObjectStore(spec.name, {
          keyPath: spec.keyPath,
          autoIncrement: spec.autoIncrement,
        })
        for (const index of spec.indexes) {
          store.createIndex(index.name, index.keyPath, index)
        }
        spec.rows.forEach((row, index) => {
          if (spec.keyPath === null && spec.keys) store.add(row, spec.keys[index])
          else store.add(row)
        })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })

export const loadLegacyCashuWallet = (name: string): Promise<void> =>
  loadCashuDatabaseFixture(name, fixture)
