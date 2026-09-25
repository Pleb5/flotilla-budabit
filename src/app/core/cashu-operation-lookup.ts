import type {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import type {Manager, ReceiveOperation, SendOperation} from "@cashu/coco-core"
import {cashuTokenIdentity, receiveOperationIdentity} from "./cashu-token-status"
import {CashuStatusCache, type OperationRef} from "./cashu-status-cache"

const PAGE_SIZE = 50
const MINT_LIMIT = 16
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0))
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

/** A derived hash/ID index. SDK operations remain authoritative, including state. */
export class CashuOperationLookup {
  private scanned = new Set<string>()
  private scans = new Map<string, Promise<void>>()
  private unsubscribers: (() => void)[] = []
  private writes = new Set<Promise<void>>()
  private disposed = false
  constructor(
    private manager: Manager,
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
    const ref = reference(kind, operation)
    if (!ref || this.disposed) return
    const task = this.cache
      .index([ref])
      .catch(() => {
        this.scanned.delete(operation.mintUrl)
      })
      .finally(() => this.writes.delete(task))
    this.writes.add(task)
    // Never let derived storage failure change a wallet operation's outcome.
  }
  dispose() {
    this.disposed = true
    for (const unsubscribe of this.unsubscribers) unsubscribe()
  }
  private active() {
    if (this.disposed) throw new Error("Wallet session changed")
  }

  async find(
    mintUrl: string,
    identity: string,
    fresh = false,
  ): Promise<{received?: ReceiveOperation; outgoing?: SendOperation}> {
    await Promise.all(this.writes)
    this.active()
    let refs = await this.cache.refs(identity).catch(() => [])
    // Missing receipt indexes are rebuilt lazily, at most once per mint until
    // this runtime ends. An explicit receive always verifies a miss afresh.
    let found: {received?: ReceiveOperation; outgoing?: SendOperation} = {}
    const read = async () => {
      found = {}
      for (const ref of refs) {
        if (ref.kind === "receive") {
          const op = await this.repo.receiveOperationRepository.getById(ref.operationId)
          if (op && receiveOperationIdentity(op) === identity) found.received = op
        } else {
          const op = await this.repo.sendOperationRepository.getById(ref.operationId)
          if (op && "token" in op && op.token && cashuTokenIdentity(op.token) === identity)
            found.outgoing = op
        }
      }
    }
    await read()
    if (
      (!found.received || found.received.state === "rolled_back") &&
      (fresh || !this.scanned.has(mintUrl))
    ) {
      let scan = this.scans.get(mintUrl)
      if (!scan) {
        this.scanned.delete(mintUrl)
        scan = this.scan(mintUrl, (kind, op) => {
          const ref = reference(kind, op)
          if (ref?.identity === identity) {
            // Also works when the optional index is unavailable or quota-limited.
            if (
              kind === "receive" &&
              (!found.received || ref.priority >= (reference(kind, found.received)?.priority || 0))
            )
              found.received = op as ReceiveOperation
            if (kind === "send") found.outgoing = op as SendOperation
          }
        }).finally(() => this.scans.delete(mintUrl))
        this.scans.set(mintUrl, scan)
        await scan
      } else {
        await scan
        refs = await this.cache.refs(identity).catch(() => [])
        await read()
        // If persistence failed, do not mistake an unavailable index for no receipt.
        if (!found.received && !this.scanned.has(mintUrl))
          return this.find(mintUrl, identity, fresh)
      }
    }
    this.active()
    return found
  }

  private async scan(
    mintUrl: string,
    visit: (kind: "receive" | "send", op: ReceiveOperation | SendOperation) => void,
  ) {
    let persisted = true
    for (const kind of ["receive", "send"] as const) {
      // Read only a bounded page from the SDK-owned schema. Hydrate through the
      // SDK API, so amount/token serialization remains its responsibility.
      const table = this.repo.db.table(`coco_cashu_${kind}_operations`)
      let offset = 0
      for (;;) {
        this.active()
        const ids = await table
          .where("mintUrl")
          .equals(mintUrl)
          .offset(offset)
          .limit(PAGE_SIZE)
          .primaryKeys()
        if (!ids.length) break
        const refs: OperationRef[] = []
        for (const id of ids) {
          this.active()
          const op = await (kind === "receive"
            ? this.repo.receiveOperationRepository.getById(String(id))
            : this.repo.sendOperationRepository.getById(String(id)))
          if (!op) continue
          visit(kind, op)
          const ref = reference(kind, op)
          if (ref) refs.push(ref)
        }
        await this.cache.index(refs).catch(() => {
          persisted = false
        })
        offset += ids.length
        if (ids.length < PAGE_SIZE) break
        await yieldToBrowser()
      }
    }
    if (persisted) {
      this.scanned.add(mintUrl)
      if (this.scanned.size > MINT_LIMIT) this.scanned.delete(this.scanned.values().next().value!)
    }
  }
}
