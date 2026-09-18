import fixture from "../fixtures/cashu-v1-wallet.json"

export {fixture as legacyCashuWallet}

// Native IndexedDB recreation deliberately does not depend on the current Coco schema.
export const loadLegacyCashuWallet = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, fixture.version)
    request.onupgradeneeded = () => {
      for (const spec of fixture.stores) {
        const store = request.result.createObjectStore(spec.name, {
          keyPath: spec.keyPath,
          autoIncrement: spec.autoIncrement,
        })
        for (const index of spec.indexes) {
          store.createIndex(index.name, index.keyPath, index)
        }
        for (const row of spec.rows) store.add(row)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
