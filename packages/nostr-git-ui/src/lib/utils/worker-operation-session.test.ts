import { describe, expect, it, vi } from "vitest";

import {
  WorkerOperationSession,
  hasUnknownWorkerOperation,
  waitForWorkerOperationTerminal,
} from "./worker-operation-session.js";

function status(operationId: string, state: "completed" | "cancelled" | "unknown") {
  return {
    operationId,
    operation: "pushToRemote" as const,
    stage: state,
    state,
    sideEffectMayHaveOccurred: state === "unknown",
    startedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
}

describe("WorkerOperationSession", () => {
  it("creates unique child mutation IDs across calls and concurrent sessions", () => {
    const first = new WorkerOperationSession({}, "import:base");
    const second = new WorkerOperationSession({}, "import:base");
    const ids = [
      first.createOperationId("cloneRemoteRepo"),
      first.createOperationId("pushToRemote"),
      second.createOperationId("cloneRemoteRepo"),
      second.createOperationId("pushToRemote"),
    ];

    expect(new Set(ids)).toHaveLength(ids.length);
    expect(ids.every((id) => id.startsWith("import:base:"))).toBe(true);
  });

  it("isolates cancellation to each session's active operations", async () => {
    const cancelOperation = vi.fn();
    const workerApi = {
      cancelOperation,
      getOperationStatus: ({ operationId }: { operationId: string }) =>
        status(operationId, "cancelled"),
    };
    const first = new WorkerOperationSession(workerApi, "import:first");
    const second = new WorkerOperationSession(workerApi, "import:second");
    const firstId = first.createOperationId("cloneRemoteRepo");
    const secondId = second.createOperationId("cloneRemoteRepo");
    first.registerOperation(firstId, "cloneRemoteRepo");
    second.registerOperation(secondId, "cloneRemoteRepo");

    await first.cancelAndWait("cancel first");

    expect(cancelOperation).toHaveBeenCalledTimes(1);
    expect(cancelOperation).toHaveBeenCalledWith({
      operationId: firstId,
      reason: "cancel first",
    });
    expect(cancelOperation).not.toHaveBeenCalledWith(
      expect.objectContaining({ operationId: secondId })
    );
  });

  it("requests cancellation for all operations before waiting for terminal status", async () => {
    const ordering: string[] = [];
    const workerApi = {
      cancelOperation: ({ operationId }: { operationId: string }) => {
        ordering.push(`cancel:${operationId}`);
      },
      getOperationStatus: vi.fn().mockReturnValue(null),
      waitForOperationTerminal: ({ operationId }: { operationId: string }) => {
        ordering.push(`wait:${operationId}`);
        return status(operationId, "cancelled");
      },
    };
    const session = new WorkerOperationSession(workerApi, "fork:base");
    const cloneId = session.createOperationId("cloneRemoteRepo");
    const pushId = session.createOperationId("pushToRemote");
    session.registerOperation(cloneId, "cloneRemoteRepo");
    session.registerOperation(pushId, "pushToRemote");

    await session.cancelAndWait("stop");
    ordering.push("cleanup");

    expect(ordering.slice(0, 2)).toEqual([`cancel:${cloneId}`, `cancel:${pushId}`]);
    expect(ordering.slice(2)).toEqual([`wait:${cloneId}`, `wait:${pushId}`, "cleanup"]);
  });

  it("returns synthetic unknown status when terminal status times out or is unavailable", async () => {
    const timeoutStatus = await waitForWorkerOperationTerminal(
      {
        getOperationStatus: () => null,
        waitForOperationTerminal: () => new Promise(() => undefined),
      },
      "new:child",
      "createLocalRepo",
      5
    );
    const unavailableStatus = await waitForWorkerOperationTerminal(
      {},
      "new:missing",
      "createLocalRepo",
      5
    );

    expect(timeoutStatus).toMatchObject({ state: "unknown", sideEffectMayHaveOccurred: true });
    expect(unavailableStatus).toMatchObject({ state: "unknown", sideEffectMayHaveOccurred: true });
    expect(hasUnknownWorkerOperation([timeoutStatus, unavailableStatus])).toBe(true);
  });

  it("keeps a synthetic unknown terminal result conservative on later cleanup checks", async () => {
    const getOperationStatus = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockImplementation(({ operationId }) => status(operationId, "completed"));
    const session = new WorkerOperationSession(
      {
        getOperationStatus,
        waitForOperationTerminal: () => new Promise(() => undefined),
      },
      "new:base",
      5
    );
    const operationId = session.createOperationId("createLocalRepo");
    session.registerOperation(operationId, "createLocalRepo");

    const first = await session.waitForOperationTerminal(operationId);
    const second = await session.waitForOperationTerminal(operationId);

    expect(first.state).toBe("unknown");
    expect(second).toBe(first);
    expect(getOperationStatus).toHaveBeenCalledTimes(1);
  });

  it("records each terminal receipt once", async () => {
    const onTerminalStatus = vi.fn();
    const session = new WorkerOperationSession(
      {
        getOperationStatus: ({ operationId }) => status(operationId, "completed"),
      },
      "import:base",
      5000,
      onTerminalStatus
    );
    const operationId = session.createOperationId("pushToRemote");
    session.registerOperation(operationId, "pushToRemote");

    await session.waitForOperationTerminal(operationId);
    await session.waitForOperationTerminal(operationId);

    expect(onTerminalStatus).toHaveBeenCalledTimes(1);
    expect(onTerminalStatus).toHaveBeenCalledWith(
      expect.objectContaining({ operationId, state: "completed" })
    );
  });

  it("retries terminal receipt persistence before caching it", async () => {
    const onTerminalStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage full"))
      .mockResolvedValueOnce(undefined);
    const session = new WorkerOperationSession(
      { getOperationStatus: ({ operationId }) => status(operationId, "completed") },
      "new:base",
      5000,
      onTerminalStatus
    );
    const operationId = session.createOperationId("createLocalRepo");
    session.registerOperation(operationId, "createLocalRepo");

    await expect(session.waitForOperationTerminal(operationId)).rejects.toThrow("storage full");
    await expect(session.waitForOperationTerminal(operationId)).resolves.toMatchObject({
      state: "completed",
    });

    expect(onTerminalStatus).toHaveBeenCalledTimes(2);
  });
});
