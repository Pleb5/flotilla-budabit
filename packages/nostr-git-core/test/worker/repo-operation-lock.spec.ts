import {describe, expect, it, vi} from "vitest"
import {
  withRepoOperationLock,
  withRepoOperationLocks,
} from "../../src/worker/workers/repo-operation-lock.js"

describe("repository operation lock", () => {
  it("serializes operations for one repository without blocking another", async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = withRepoOperationLock("repo-a", async () => {
      order.push("first:start")
      await firstGate
      order.push("first:end")
    })
    const second = withRepoOperationLock("repo-a", async () => {
      order.push("second")
    })
    const other = withRepoOperationLock("repo-b", async () => {
      order.push("other")
    })

    await other
    expect(order).toEqual(["first:start", "other"])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "other", "first:end", "second"])
  })

  it("serializes aliases that resolve to the same repository directory", async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = withRepoOperationLock("owner:name", async () => {
      order.push("first:start")
      await firstGate
      order.push("first:end")
    })
    const second = withRepoOperationLock("owner/name", async () => {
      order.push("second")
    })

    await vi.waitFor(() => expect(order).toEqual(["first:start"]))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })

  it("orders multi-repository locks consistently", async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = withRepoOperationLocks(["owner/source", "owner/target"], async () => {
      order.push("first:start")
      await firstGate
      order.push("first:end")
    })
    const second = withRepoOperationLocks(["owner/target", "owner/source"], async () => {
      order.push("second")
    })

    await vi.waitFor(() => expect(order).toEqual(["first:start"]))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })
})
