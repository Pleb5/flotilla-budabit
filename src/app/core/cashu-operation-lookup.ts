import type {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import type {Manager, ReceiveOperation, SendOperation} from "@cashu/coco-core"
import {cashuTokenIdentity, receiveOperationIdentity} from "./cashu-token-status"
import {CashuStatusCache, type OperationRef} from "./cashu-status-cache"
import {assertCashuWorkActive, runCashuBackground} from "./cashu-background"
import {beginCashuDiagnostic} from "./cashu-diagnostics"

const PAGE_SIZE = 50
export const RECEIPT_LOOKUP_ROWS = 1000
const LOOKUP_TIME_MS = 500
export class CashuReceiptLookupIncomplete extends Error {
  constructor() {
    super("More wallet history to check. Continue checking the receipt.")
  }
}
const reference = (
  kind: "receive" | "send",
  operation: ReceiveOperation | SendOperation,
): OperationRef | undefined => {
  const identity =
    "inputProofs" in operation
      ? receiveOperationIdentity(operation)
      : "token" in operation && operation.token
        ? cashuTokenIdentity(operation.token)
        : undefined
  if (!identity) return
  return {
    key: `${kind}:${identity}`,
    identity,
    kind,
    operationId: operation.id,
    priority:
      operation.state === "finalized"
        ? 3
        : operation.state === "executing" || operation.state === "pending"
          ? 2
          : operation.state === "prepared"
            ? 1
            : 0,
  }
}

// Keyset pagination keeps insertions/deletions in other operations from shifting
// offsets and skipping a receipt. Only keys are read; SDK APIs hydrate matches.
const receiveKeys = (repo: IndexedDbRepositories, mintUrl: string, after?: IDBValidKey) =>
  new Promise<string[]>((resolve, reject) => {
    const tx = repo.db.backendDB().transaction("coco_cashu_receive_operations", "readonly")
    const request = tx
      .objectStore("coco_cashu_receive_operations")
      .index("mintUrl")
      .openKeyCursor(IDBKeyRange.only(mintUrl))
    const keys: string[] = []
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || keys.length === PAGE_SIZE) return resolve(keys)
      if (after !== undefined && indexedDB.cmp(cursor.primaryKey, after) <= 0) {
        if (indexedDB.cmp(cursor.primaryKey, after) < 0 && cursor.continuePrimaryKey)
          cursor.continuePrimaryKey(mintUrl, after)
        else cursor.continue()
        return
      }
      keys.push(String(cursor.primaryKey))
      cursor.continue()
    }
  })

/** Previews only use point lookups. Historical reconciliation requires an explicit action. */
export class CashuOperationLookup {
  private unsubscribers: (() => void)[] = []
  private writes = new Set<{run: () => Promise<void>; controller: AbortController}>()
  private controller = new AbortController()
  private cursors = new Map<string, {after?: string; candidate?: string}>()
  constructor(
    manager: Manager,
    private repo: IndexedDbRepositories,
    private cache: CashuStatusCache,
  ) {
    const receive = ({operation}: {operation: ReceiveOperation}) =>
      this.remember("receive", operation)
    const send = ({operation}: {operation: SendOperation}) => this.remember("send", operation)
    for (const event of [
      "receive-op:prepared",
      "receive-op:finalized",
      "receive-op:rolled-back",
    ] as const)
      this.unsubscribers.push(manager.on(event, receive))
    for (const event of ["send:pending", "send:finalized", "send:rolled-back"] as const)
      this.unsubscribers.push(manager.on(event, send))
  }
  private remember(kind: "receive" | "send", operation: ReceiveOperation | SendOperation) {
    // This index is disposable; a dropped write falls back only during an
    // explicit receive. Never accumulate an unbounded background event queue.
    if (this.writes.size >= 128 || this.controller.signal.aborted) return
    let writing: Promise<void> | undefined
    const pending = {
      controller: new AbortController(),
      run: () =>
        (writing ||= (async () => {
          assertCashuWorkActive(this.controller.signal)
          const ref = reference(kind, operation)
          if (ref) await this.cache.index([ref])
        })().catch(() => {})),
    }
    this.writes.add(pending)
    void runCashuBackground(
      "index-write",
      pending.run,
      AbortSignal.any([pending.controller.signal, this.controller.signal]),
    )
      .catch(() => {})
      .finally(() => this.writes.delete(pending))
  }
  dispose() {
    this.controller.abort()
    this.cursors.clear()
    for (const unsubscribe of this.unsubscribers) unsubscribe()
  }
  async flush() {
    // An explicit action promotes small forward writes instead of waiting for
    // optional background admission. Already-running writes are joined once.
    await Promise.all(
      [...this.writes].map(pending => {
        pending.controller.abort()
        return pending.run()
      }),
    )
  }

  async find(identity: string, sendOperationId?: string) {
    assertCashuWorkActive(this.controller.signal)
    const refs = await this.cache.refs(identity).catch(() => [])
    const found: {received?: ReceiveOperation; outgoing?: SendOperation} = {}
    for (const ref of refs) {
      assertCashuWorkActive(this.controller.signal)
      if (ref.kind === "receive") {
        const op = await this.repo.receiveOperationRepository.getById(ref.operationId)
        if (op && receiveOperationIdentity(op) === identity) found.received = op
      } else {
        const op = await this.repo.sendOperationRepository.getById(ref.operationId)
        if (op && "token" in op && op.token && cashuTokenIdentity(op.token) === identity)
          found.outgoing = op
      }
    }
    if (!found.outgoing && sendOperationId) {
      const op = await this.repo.sendOperationRepository.getById(sendOperationId)
      if (op && "token" in op && op.token && cashuTokenIdentity(op.token) === identity) {
        found.outgoing = op
        await this.cache.index([reference("send", op)!]).catch(() => {})
      }
    }
    return found
  }

  async reconcileReceive(
    mintUrl: string,
    identity: string,
    signal?: AbortSignal,
  ): Promise<ReceiveOperation | undefined> {
    const active = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
    assertCashuWorkActive(active)
    // Only explicit reconciliation waits for pending forward-index writes.
    await this.flush()
    const known = (await this.find(identity)).received
    if (known && ["finalized", "executing", "prepared"].includes(known.state)) return known
    const cursor = this.cursors.get(identity) || {}
    this.cursors.delete(identity)
    this.cursors.set(identity, cursor)
    if (this.cursors.size > 16) this.cursors.delete(this.cursors.keys().next().value!)
    const finish = beginCashuDiagnostic("reconcile", {source: "explicit", priority: "background"})
    const start = performance.now()
    let rows = 0
    try {
      while (
        rows < RECEIPT_LOOKUP_ROWS &&
        (rows === 0 || performance.now() - start < LOOKUP_TIME_MS)
      ) {
        const result = await runCashuBackground(
          "reconcile",
          async () => {
            assertCashuWorkActive(active)
            const ids = await receiveKeys(this.repo, mintUrl, cursor.after)
            for (const id of ids) {
              assertCashuWorkActive(active)
              if (rows > 0 && performance.now() - start >= LOOKUP_TIME_MS)
                return {operation: undefined, done: false}
              const op = await this.repo.receiveOperationRepository.getById(id)
              rows++
              cursor.after = id
              if (!op || receiveOperationIdentity(op) !== identity) continue
              if (["finalized", "executing", "prepared"].includes(op.state)) {
                cursor.candidate = id
                await this.cache.index([reference("receive", op)!]).catch(() => {})
                if (op.state === "finalized") return {operation: op, done: true}
              }
            }
            return {operation: undefined, done: ids.length < PAGE_SIZE}
          },
          active,
        )
        if (result.done) {
          this.cursors.delete(identity)
          const operation =
            result.operation ||
            (cursor.candidate
              ? await this.repo.receiveOperationRepository.getById(cursor.candidate)
              : undefined)
          finish?.({rows, outcome: operation ? "hit" : "miss"})
          return operation || undefined
        }
      }
      finish?.({rows, outcome: "budget-exhausted"})
      throw new CashuReceiptLookupIncomplete()
    } catch (error) {
      if (!(error instanceof CashuReceiptLookupIncomplete))
        finish?.({rows, outcome: active.aborted ? "cancelled" : "error"})
      throw error
    }
  }
}
