import {describe, expect, it} from "vitest"
import {withRepoOperationLock} from "../../src/worker/workers/repo-operation-lock.js"

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
})
