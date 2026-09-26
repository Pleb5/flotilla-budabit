import type {SendOperation} from "@cashu/coco-core"
import {getEncodedToken} from "@cashu/coco-core"
import type {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {cashuSatsNumber} from "@app/util/cashu-amount"
import {assertCashuWorkActive} from "./cashu-background"

export const SAVED_SEND_PAGE_SIZE = 25
const states = ["executing", "pending", "prepared", "rolling_back"] as const
export type SavedSendCursor = {state: string; id: string}
export type SavedCashuSend = {
  id: string
  mintUrl: string
  amount: number
  createdAt: number
  state: SendOperation["state"]
  token?: string
}
export type SavedSendPage = {entries: SavedCashuSend[]; next?: SavedSendCursor}

export const savedCashuSend = (operation: SendOperation): SavedCashuSend => ({
  id: operation.id,
  mintUrl: operation.mintUrl,
  amount: cashuSatsNumber(operation.amount),
  createdAt: operation.createdAt,
  state: operation.state,
  token: "token" in operation && operation.token ? getEncodedToken(operation.token) : undefined,
})

// Seek through the existing state index, skipping terminal states altogether.
// Stable (state, primary key) cursors keep deletions from shifting later pages.
// Only one page of SDK operations is hydrated, regardless of history size/age.
export const readSavedCashuSends = async (
  repo: IndexedDbRepositories,
  after?: SavedSendCursor,
  signal?: AbortSignal,
): Promise<SavedSendPage> => {
  assertCashuWorkActive(signal)
  const keys = await new Promise<SavedSendCursor[]>((resolve, reject) => {
    const tx = repo.db.backendDB().transaction("coco_cashu_send_operations", "readonly")
    const request = tx
      .objectStore("coco_cashu_send_operations")
      .index("state")
      .openKeyCursor(IDBKeyRange.bound(after?.state || states[0], states[states.length - 1]))
    const keys: SavedSendCursor[] = []
    tx.oncomplete = () => resolve(keys)
    tx.onabort = () => reject(tx.error || new Error("Could not read saved tokens"))
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || keys.length > SAVED_SEND_PAGE_SIZE || signal?.aborted) return
      const state = String(cursor.key)
      const nextState = states.find(value => value >= state)
      if (!nextState) return
      if (nextState !== state) {
        cursor.continue(nextState)
        return
      }
      if (after && state === after.state && indexedDB.cmp(cursor.primaryKey, after.id) <= 0) {
        if (indexedDB.cmp(cursor.primaryKey, after.id) < 0)
          cursor.continuePrimaryKey(state, after.id)
        else cursor.continue()
        return
      }
      keys.push({state, id: String(cursor.primaryKey)})
      cursor.continue()
    }
  })
  const entries: SavedCashuSend[] = []
  for (const {id} of keys.slice(0, SAVED_SEND_PAGE_SIZE)) {
    assertCashuWorkActive(signal)
    const operation = await repo.sendOperationRepository.getById(id)
    if (operation?.unit === "sat" && states.some(state => state === operation.state))
      entries.push(savedCashuSend(operation))
  }
  assertCashuWorkActive(signal)
  return {
    entries,
    next: keys.length > SAVED_SEND_PAGE_SIZE ? keys[SAVED_SEND_PAGE_SIZE - 1] : undefined,
  }
}
