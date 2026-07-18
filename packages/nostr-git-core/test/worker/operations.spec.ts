import {describe, expect, it, vi} from "vitest"
import {OperationRegistry, type OperationStatus} from "../../src/worker/operations.js"

describe("worker operation lifecycle", () => {
  it("isolates concurrent records and cancels only the requested operation", () => {
    const emitted: OperationStatus[] = []
    const registry = new OperationRegistry(status => emitted.push(status))
    const clone = registry.start({
      operationId: "clone-a",
      operation: "cloneRemoteRepo",
      stage: "Discovering refs",
    })
    const push = registry.start({
      operationId: "push-b",
      operation: "pushToRemote",
      stage: "Preparing push",
    })

    registry.cancel("clone-a", "not needed")
    clone.finishCancellation()
    push.complete([{ref: "refs/heads/main"}])

    expect(registry.getStatus("clone-a")).toMatchObject({
      operationId: "clone-a",
      state: "cancelled",
      sideEffectMayHaveOccurred: false,
    })
    expect(registry.getStatus("push-b")).toMatchObject({
      operationId: "push-b",
      state: "completed",
      receipts: [{ref: "refs/heads/main"}],
    })
    expect(push.signal.aborted).toBe(false)
    expect(
      emitted.every(status => status.operationId === "clone-a" || status.operationId === "push-b"),
    ).toBe(true)
  })

  it("classifies cancellation after a side-effect boundary as unknown", () => {
    const registry = new OperationRegistry()
    const operation = registry.start({
      operationId: "remote-create",
      operation: "createRemoteRepo",
      stage: "Preparing request",
    })

    operation.markSideEffectBoundary("Requesting remote repository creation")
    registry.cancel("remote-create")
    operation.finishCancellation(new DOMException("aborted", "AbortError"))

    expect(registry.getStatus("remote-create")).toMatchObject({
      state: "unknown",
      stage: "Outcome unknown",
      sideEffectMayHaveOccurred: true,
      error: {name: "AbortError", message: "aborted"},
    })
  })

  it("waits for terminal state and returns terminal records immediately thereafter", async () => {
    const registry = new OperationRegistry()
    const operation = registry.start({
      operationId: "local-create",
      operation: "createLocalRepo",
      stage: "Checking target",
    })
    const waiting = registry.waitForTerminal("local-create", 1_000)

    operation.complete([{commitSha: "a".repeat(40)}])

    await expect(waiting).resolves.toMatchObject({
      state: "completed",
      completedAt: expect.any(Number),
    })
    await expect(registry.waitForTerminal("local-create")).resolves.toMatchObject({
      operationId: "local-create",
      state: "completed",
    })
  })

  it("rejects unknown waits, duplicate IDs, and timed out terminal waits", async () => {
    vi.useFakeTimers()
    try {
      const registry = new OperationRegistry()
      registry.start({operationId: "active", operation: "deleteRepo", stage: "Preparing"})

      expect(() =>
        registry.start({operationId: "active", operation: "deleteRepo", stage: "Preparing"}),
      ).toThrow(/already exists/i)
      await expect(registry.waitForTerminal("missing")).rejects.toThrow(/unknown operation/i)

      const waiting = registry.waitForTerminal("active", 10)
      const timedOut = expect(waiting).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(10)
      await timedOut
    } finally {
      vi.useRealTimers()
    }
  })
})
