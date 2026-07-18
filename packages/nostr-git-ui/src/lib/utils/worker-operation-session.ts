import type { OperationStatus, WorkerMutationOperation } from "@nostr-git/core";

export interface WorkerOperationApi {
  cancelOperation?: (options: { operationId: string; reason?: string }) => unknown;
  getOperationStatus?: (options: { operationId: string }) => unknown;
  waitForOperationTerminal?: (options: { operationId: string; timeoutMs?: number }) => unknown;
}

export type WorkerOperationTerminalStatus = OperationStatus;

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "unknown"]);

function createIdPart(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isOperationStatus(value: unknown): value is OperationStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<OperationStatus>;
  return (
    typeof status.operationId === "string" &&
    typeof status.operation === "string" &&
    typeof status.state === "string" &&
    typeof status.stage === "string"
  );
}

function isTerminalStatus(value: unknown): value is OperationStatus {
  return isOperationStatus(value) && TERMINAL_STATES.has(value.state);
}

function createUnknownStatus(
  operationId: string,
  operation: WorkerMutationOperation,
  reason: string
): OperationStatus {
  const now = Date.now();
  return {
    operationId,
    operation,
    stage: "Outcome unknown",
    state: "unknown",
    sideEffectMayHaveOccurred: true,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
    error: { name: "OperationStatusUnavailable", message: reason },
  };
}

async function withBoundedWait<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for worker operation after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createWorkerOperationIdFactory(baseOperationId: string) {
  const base = String(baseOperationId || "worker-operation").trim() || "worker-operation";
  const sessionId = createIdPart();
  let sequence = 0;

  return (operation: WorkerMutationOperation): string => {
    sequence += 1;
    return `${base}:${sessionId}:${operation}:${sequence}`;
  };
}

export async function waitForWorkerOperationTerminal(
  workerApi: WorkerOperationApi | null | undefined,
  operationId: string,
  operation: WorkerMutationOperation,
  timeoutMs = 5000
): Promise<OperationStatus> {
  if (!workerApi) {
    return createUnknownStatus(
      operationId,
      operation,
      "Git worker operation status is unavailable"
    );
  }

  try {
    if (workerApi.getOperationStatus) {
      const current = await withBoundedWait(
        Promise.resolve(workerApi.getOperationStatus({ operationId })),
        timeoutMs
      );
      if (isTerminalStatus(current)) return current;
    }

    if (workerApi.waitForOperationTerminal) {
      const status = await withBoundedWait(
        Promise.resolve(
          workerApi.waitForOperationTerminal({
            operationId,
            timeoutMs,
          })
        ),
        timeoutMs
      );
      if (isTerminalStatus(status)) return status;
    }

    if (workerApi.getOperationStatus) {
      const finalStatus = await withBoundedWait(
        Promise.resolve(workerApi.getOperationStatus({ operationId })),
        timeoutMs
      );
      if (isTerminalStatus(finalStatus)) return finalStatus;
    }
  } catch (error) {
    return createUnknownStatus(
      operationId,
      operation,
      error instanceof Error ? error.message : String(error)
    );
  }

  return createUnknownStatus(
    operationId,
    operation,
    "Worker returned no terminal operation status"
  );
}

export function hasUnknownWorkerOperation(statuses: OperationStatus[]): boolean {
  return statuses.some((status) => status.state === "unknown");
}

export class WorkerOperationSession {
  readonly #operations = new Map<string, WorkerMutationOperation>();
  readonly #activeOperationIds = new Set<string>();
  readonly #terminalStatuses = new Map<string, OperationStatus>();
  readonly #createOperationId: ReturnType<typeof createWorkerOperationIdFactory>;
  #pendingCancellation: Promise<void> = Promise.resolve();

  constructor(
    readonly workerApi: WorkerOperationApi | null | undefined,
    readonly baseOperationId: string,
    readonly terminalTimeoutMs = 5000,
    readonly onTerminalStatus?: (status: OperationStatus) => Promise<void> | void
  ) {
    this.#createOperationId = createWorkerOperationIdFactory(baseOperationId);
  }

  createOperationId(operation: WorkerMutationOperation): string {
    return this.#createOperationId(operation);
  }

  registerOperation(operationId: string, operation: WorkerMutationOperation): void {
    this.#operations.set(operationId, operation);
    this.#activeOperationIds.add(operationId);
  }

  unregisterOperation(operationId: string): void {
    this.#activeOperationIds.delete(operationId);
  }

  async runOperation<T>(
    operation: WorkerMutationOperation,
    callback: (operationId: string) => Promise<T>
  ): Promise<T> {
    const operationId = this.createOperationId(operation);
    this.registerOperation(operationId, operation);
    try {
      return await callback(operationId);
    } finally {
      this.unregisterOperation(operationId);
    }
  }

  requestCancellation(reason?: string): Promise<void> {
    const activeIds = Array.from(this.#activeOperationIds);
    const request = Promise.allSettled(
      activeIds.map((operationId) =>
        withBoundedWait(
          Promise.resolve(this.workerApi?.cancelOperation?.({ operationId, reason })),
          this.terminalTimeoutMs
        )
      )
    ).then(() => undefined);
    this.#pendingCancellation = Promise.allSettled([this.#pendingCancellation, request]).then(
      () => undefined
    );
    return request;
  }

  async waitForOperationTerminal(operationId: string): Promise<OperationStatus> {
    const cached = this.#terminalStatuses.get(operationId);
    if (cached) return cached;

    const operation = this.#operations.get(operationId);
    if (!operation) {
      return createUnknownStatus(operationId, "pushToRemote", "Operation was not registered");
    }
    const status = await waitForWorkerOperationTerminal(
      this.workerApi,
      operationId,
      operation,
      this.terminalTimeoutMs
    );
    await this.onTerminalStatus?.(status);
    this.#terminalStatuses.set(operationId, status);
    return status;
  }

  async waitForTrackedOperations(): Promise<OperationStatus[]> {
    await this.#pendingCancellation;
    return await Promise.all(
      Array.from(this.#operations.keys()).map((operationId) =>
        this.waitForOperationTerminal(operationId)
      )
    );
  }

  async cancelAndWait(reason?: string): Promise<OperationStatus[]> {
    const activeIds = Array.from(this.#activeOperationIds);
    await this.requestCancellation(reason);
    return await Promise.all(
      activeIds.map((operationId) => this.waitForOperationTerminal(operationId))
    );
  }
}
