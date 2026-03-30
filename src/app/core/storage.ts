import {call} from "@welshman/lib"
import {IDB} from "@lib/indexeddb"

export const kv = call(() => {
  let p = Promise.resolve()

  const get = async <T>(key: string): Promise<T | undefined> => {
    const value = localStorage.getItem(key)
    if (!value) return undefined
    try {
      return JSON.parse(value)
    } catch (e) {
      return undefined
    }
  }

  const set = async <T>(key: string, value: T): Promise<void> => {
    p = p.then(() => localStorage.setItem(key, JSON.stringify(value)))

    await p
  }

  const clear = async () => {
    p = p.then(() => localStorage.clear())

    await p
  }

  return {get, set, clear}
})

export const db = new IDB({name: "flotilla-9gl", version: 1})
