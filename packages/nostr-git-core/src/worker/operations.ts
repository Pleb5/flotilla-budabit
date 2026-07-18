export type WorkerMutationOperation =
  | "cloneRemoteRepo"
  | "createLocalRepo"
  | "createRemoteRepo"
  | "pushToRemote"
  | "deleteRepo"
  | "deleteRemoteRepo"

export type OperationTerminalState = "completed" | "failed" | "cancelled" | "unknown"
export type OperationState = "running" | OperationTerminalState

export interface OperationError {
  name: string
  message: string
  code?: string
}

/** A structured-clone-safe snapshot of one worker mutation. */
export interface OperationStatus {
  operationId: string
  operation: WorkerMutationOperation
  stage: string
  state: OperationState
  sideEffectMayHaveOccurred: boolean
  startedAt: number
  updatedAt: number
  completedAt?: number
  cancellationRequestedAt?: number
  error?: OperationError
  receipts?: unknown[]
}

export type GitOperationStatusEvent = {type: "git-operation-status"} & OperationStatus

export interface CancelOperationOptions {
  operationId: string
  reason?: string
}

export interface GetOperationStatusOptions {
  operationId: string
}

export interface WaitForOperationTerminalOptions {
  operationId: string
  timeoutMs?: number
}

export interface DeleteRepoOptions {
  repoId: string
  operationId?: string
}

export interface OperationControl {
  readonly signal: AbortSignal
  setStage(stage: string): void
  markSideEffectBoundary(stage?: string): void
  throwIfCancellationRequested(): void
}

type StatusListener = (status: OperationStatus) => void
type TerminalWaiter = (status: OperationStatus) => void

interface OperationEntry {
  status: OperationStatus
  controller: AbortController
  waiters: Set<TerminalWaiter>
}

const TERMINAL_STATES = new Set<OperationState>(["completed", "failed", "cancelled", "unknown"])

function isTerminal(state: OperationState): state is OperationTerminalState {
  return TERMINAL_STATES.has(state)
}

function copyReceipt<T>(receipt: T): T {
  try {
    return structuredClone(receipt)
  } catch {
    try {
      return JSON.parse(JSON.stringify(receipt)) as T
    } catch {
      return receipt
    }
  }
}

function copyStatus(status: OperationStatus): OperationStatus {
  return {
    ...status,
    ...(status.error ? {error: {...status.error}} : {}),
    ...(status.receipts ? {receipts: status.receipts.map(copyReceipt)} : {}),
  }
}

function operationError(error: unknown): OperationError {
  const value = error as {name?: unknown; message?: unknown; code?: unknown}
  return {
    name: typeof value?.name === "string" ? value.name : "Error",
    message:
      typeof value?.message === "string"
        ? value.message
        : error == null
          ? "Unknown operation error"
          : String(error),
    ...(typeof value?.code === "string" ? {code: value.code} : {}),
  }
}

function cancellationError(reason?: string): OperationError {
  return {
    name: "AbortError",
    message: reason ? `Operation cancelled: ${reason}` : "Operation cancelled",
  }
}

export class OperationHandle implements OperationControl {
  constructor(
    private readonly registry: OperationRegistry,
    readonly operationId: string,
  ) {}

  get signal(): AbortSignal {
    return this.registry.getSignal(this.operationId)
  }

  get cancellationRequested(): boolean {
    return this.signal.aborted
  }

  setStage(stage: string): void {
    this.registry.update(this.operationId, {stage})
  }

  markSideEffectBoundary(stage?: string): void {
    this.registry.update(this.operationId, {
      ...(stage ? {stage} : {}),
      sideEffectMayHaveOccurred: true,
    })
  }

  throwIfCancellationRequested(): void {
    if (!this.signal.aborted) return
    const reason = this.signal.reason
    throw new DOMException(
      typeof reason === "string" ? reason : "Operation cancelled",
      "AbortError",
    )
  }

  complete(receipts?: unknown[]): OperationStatus {
    return this.registry.finish(this.operationId, "completed", {
      stage: "Completed",
      ...(receipts?.length ? {receipts} : {}),
    })
  }

  fail(error: unknown): OperationStatus {
    return this.registry.finish(this.operationId, "failed", {
      stage: "Failed",
      error: operationError(error),
    })
  }

  finishCancellation(error?: unknown, receipts?: unknown[]): OperationStatus {
    const status = this.registry.getStatus(this.operationId)!
    const state: OperationTerminalState = status.sideEffectMayHaveOccurred ? "unknown" : "cancelled"
    return this.registry.finish(this.operationId, state, {
      stage: state === "unknown" ? "Outcome unknown" : "Cancelled",
      error:
        error == null
          ? cancellationError(
              typeof this.signal.reason === "string" ? this.signal.reason : undefined,
            )
          : operationError(error),
      ...(receipts?.length ? {receipts} : {}),
    })
  }
}

export class OperationRegistry {
  private readonly entries = new Map<string, OperationEntry>()

  constructor(private readonly onStatus?: StatusListener) {}

  start(params: {
    operationId: string
    operation: WorkerMutationOperation
    stage: string
  }): OperationHandle {
    const operationId = String(params.operationId || "").trim()
    if (!operationId) throw new Error("operationId must not be empty")
    if (this.entries.has(operationId)) {
      throw new Error(`Operation ID already exists: ${operationId}`)
    }

    const now = Date.now()
    const entry: OperationEntry = {
      status: {
        operationId,
        operation: params.operation,
        stage: params.stage,
        state: "running",
        sideEffectMayHaveOccurred: false,
        startedAt: now,
        updatedAt: now,
      },
      controller: new AbortController(),
      waiters: new Set(),
    }
    this.entries.set(operationId, entry)
    this.emit(entry.status)
    return new OperationHandle(this, operationId)
  }

  cancel(operationId: string, reason?: string): OperationStatus | null {
    const entry = this.entries.get(operationId)
    if (!entry) return null
    if (isTerminal(entry.status.state)) return copyStatus(entry.status)

    const now = Date.now()
    entry.status = {
      ...entry.status,
      updatedAt: now,
      cancellationRequestedAt: entry.status.cancellationRequestedAt ?? now,
    }
    if (!entry.controller.signal.aborted) entry.controller.abort(reason)
    this.emit(entry.status)
    return copyStatus(entry.status)
  }

  getStatus(operationId: string): OperationStatus | null {
    const entry = this.entries.get(operationId)
    return entry ? copyStatus(entry.status) : null
  }

  async waitForTerminal(operationId: string, timeoutMs?: number): Promise<OperationStatus> {
    const entry = this.entries.get(operationId)
    if (!entry) throw new Error(`Unknown operation ID: ${operationId}`)
    if (isTerminal(entry.status.state)) return copyStatus(entry.status)

    return await new Promise<OperationStatus>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const waiter: TerminalWaiter = status => {
        if (timeout) clearTimeout(timeout)
        resolve(copyStatus(status))
      }
      entry.waiters.add(waiter)

      if (timeoutMs != null) {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
          entry.waiters.delete(waiter)
          reject(new Error("timeoutMs must be a non-negative finite number"))
          return
        }
        timeout = setTimeout(() => {
          entry.waiters.delete(waiter)
          reject(new Error(`Timed out waiting for operation ${operationId}`))
        }, timeoutMs)
      }
    })
  }

  getSignal(operationId: string): AbortSignal {
    return this.getEntry(operationId).controller.signal
  }

  private getEntry(operationId: string): OperationEntry {
    const entry = this.entries.get(operationId)
    if (!entry) throw new Error(`Unknown operation ID: ${operationId}`)
    return entry
  }

  update(
    operationId: string,
    update: Partial<Pick<OperationStatus, "stage" | "sideEffectMayHaveOccurred">>,
  ): void {
    const entry = this.getEntry(operationId)
    if (isTerminal(entry.status.state)) return
    entry.status = {...entry.status, ...update, updatedAt: Date.now()}
    this.emit(entry.status)
  }

  finish(
    operationId: string,
    state: OperationTerminalState,
    update: Pick<OperationStatus, "stage"> & Partial<Pick<OperationStatus, "error" | "receipts">>,
  ): OperationStatus {
    const entry = this.getEntry(operationId)
    if (isTerminal(entry.status.state)) return copyStatus(entry.status)

    const now = Date.now()
    entry.status = {
      ...entry.status,
      ...update,
      ...(update.receipts ? {receipts: update.receipts.map(copyReceipt)} : {}),
      state,
      updatedAt: now,
      completedAt: now,
    }
    this.emit(entry.status)
    for (const waiter of entry.waiters) waiter(entry.status)
    entry.waiters.clear()
    return copyStatus(entry.status)
  }

  private emit(status: OperationStatus): void {
    this.onStatus?.(copyStatus(status))
  }
}

export function raceWithOperationSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(
      new DOMException(
        typeof signal.reason === "string" ? signal.reason : "Operation cancelled",
        "AbortError",
      ),
    )
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new DOMException(
          typeof signal.reason === "string" ? signal.reason : "Operation cancelled",
          "AbortError",
        ),
      )
    }
    signal.addEventListener("abort", onAbort, {once: true})
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
