import {openDB, deleteDB} from "idb"
import type {IDBPDatabase} from "idb"
import type {Unsubscriber} from "svelte/store"
import {call} from "@welshman/lib"
import type {Maybe} from "@welshman/lib"

export type IDBAdapter = {
  name: string
  keyPath: string
  init: (table: IDBTable<any>) => Promise<Unsubscriber>
}

export type IDBAdapters = IDBAdapter[]

export type IDBOptions = {
  name: string
  version: number
}

export class IDB {
  adapters: IDBAdapters = []
  connection: Maybe<Promise<IDBPDatabase>>
  unsubscribers: Maybe<Unsubscriber[]>
  isClearing = false

  constructor(readonly options: IDBOptions) {}

  private closeConnection = async () => {
    const connection = this.connection
    this.connection = undefined
    await connection?.then(c => c.close()).catch(() => {})
  }

  private waitForDelete = async (name: string, timeoutMs = 2500) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    let done = false

    const finish = () => {
      if (done) return
      done = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
    }

    await new Promise<void>(resolve => {
      timeout = setTimeout(() => {
        console.warn(`IndexedDB '${name}' delete timed out`)
        finish()
        resolve()
      }, timeoutMs)

      deleteDB(name, {
        blocked() {
          console.warn(`IndexedDB '${name}' delete blocked by another context`)
        },
      })
        .catch(error => {
          console.warn(`IndexedDB '${name}' delete failed`, error)
        })
        .finally(() => {
          finish()
          resolve()
        })
    })
  }

  async connect() {
    if (!this.connection) {
      const dbManager = this
      const {name, version} = this.options
      const adapters = this.adapters

      this.connection = openDB(name, version, {
        upgrade(idbDb: IDBPDatabase) {
          const names = new Set(adapters.map(a => a.name))

          for (const table of idbDb.objectStoreNames) {
            if (!names.has(table)) {
              idbDb.deleteObjectStore(table)
            }
          }

          for (const {name, keyPath} of adapters) {
            try {
              idbDb.createObjectStore(name, {keyPath})
            } catch (e) {
              console.warn(e)
            }
          }
        },
        blocked() {
          console.warn(`IndexedDB '${name}' open blocked by another context`)
        },
        blocking() {
          console.warn(`IndexedDB '${name}' closing due to external delete/versionchange`)
          void dbManager.closeConnection()
        },
        terminated() {
          dbManager.connection = undefined
        },
      })

      this.unsubscribers = await Promise.all(adapters.map(({name, init}) => init(this.table(name))))
    }

    return this.connection
  }

  table = <T>(name: string) => new IDBTable<T>(this, name)

  getAll = async <T>(table: string): Promise<T[]> => {
    if (this.isClearing) return []

    try {
      const connection = await this.connect()
      const tx = connection.transaction(table, "readwrite")
      const store = tx.objectStore(table)
      const result = await store.getAll()

      await tx.done

      return result || []
    } catch (e: any) {
      if (e?.name === "InvalidStateError") {
        return []
      }

      throw e
    }
  }

  bulkPut = async <T>(table: string, data: Iterable<T>) => {
    if (this.isClearing) return

    try {
      const connection = await this.connect()
      const tx = connection.transaction(table, "readwrite")
      const store = tx.objectStore(table)

      await Promise.all(
        Array.from(data).map(item => {
          try {
            store.put(item)
          } catch (e) {
            console.error(e, item)
          }
        }),
      )

      await tx.done
    } catch (e: any) {
      if (e?.name !== "InvalidStateError") {
        throw e
      }
    }
  }

  bulkDelete = async (table: string, ids: Iterable<string>) => {
    if (this.isClearing) return

    try {
      const connection = await this.connect()
      const tx = connection.transaction(table, "readwrite")
      const store = tx.objectStore(table)

      await Promise.all(Array.from(ids).map(id => store.delete(id)))
      await tx.done
    } catch (e: any) {
      if (e?.name !== "InvalidStateError") {
        throw e
      }
    }
  }

  close = () => {
    this.unsubscribers?.forEach(call)
    this.unsubscribers = undefined

    void this.closeConnection()
  }

  clear = async () => {
    this.isClearing = true

    try {
      this.unsubscribers?.forEach(call)
      this.unsubscribers = undefined

      await this.closeConnection()
      await this.waitForDelete(this.options.name)
    } finally {
      this.isClearing = false
    }
  }
}

export class IDBTable<T> {
  constructor(
    readonly db: IDB,
    readonly name: string,
  ) {}

  getAll = () => this.db.getAll<T>(this.name)

  bulkPut = (data: Iterable<T>) => this.db.bulkPut(this.name, data)

  bulkDelete = (ids: Iterable<string>) => this.db.bulkDelete(this.name, ids)
}
