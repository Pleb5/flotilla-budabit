import {describe, expect, it} from "vitest"
import {GitNaturalObjectCache} from "../../src/git/natural-read-cache.js"

const hash = (n: number) => n.toString(16).padStart(40, "0")

describe("GitNaturalObjectCache", () => {
  it("evicts least-recently-used memory entries by count", () => {
    const cache = new GitNaturalObjectCache({
      asyncStore: false,
      maxMemoryEntries: 2,
      maxMemoryBytes: 10_000,
    })

    cache.putBlob({hash: hash(1), data: new Uint8Array([1])})
    cache.putBlob({hash: hash(2), data: new Uint8Array([2])})
    expect(cache.getBlob(hash(1))?.data[0]).toBe(1)

    cache.putBlob({hash: hash(3), data: new Uint8Array([3])})

    expect(cache.getBlob(hash(1))?.data[0]).toBe(1)
    expect(cache.getBlob(hash(2))).toBeUndefined()
    expect(cache.getBlob(hash(3))?.data[0]).toBe(3)
    expect(cache.getMemoryStats()).toMatchObject({entries: 2, maxEntries: 2})
  })

  it("evicts memory entries by estimated byte size", () => {
    const cache = new GitNaturalObjectCache({
      asyncStore: false,
      maxMemoryEntries: 10,
      maxMemoryBytes: 6,
    })

    cache.putBlob({hash: hash(1), data: new Uint8Array([1, 1, 1, 1])})
    cache.putBlob({hash: hash(2), data: new Uint8Array([2, 2, 2, 2])})

    expect(cache.getBlob(hash(1))).toBeUndefined()
    expect(cache.getBlob(hash(2))?.data.length).toBe(4)
    expect(cache.getMemoryStats().bytes).toBeLessThanOrEqual(6)
  })

  it("clears memory stats with cached objects", () => {
    const cache = new GitNaturalObjectCache({asyncStore: false})

    cache.putCommit({hash: hash(1), data: new Uint8Array([1, 2, 3])})
    expect(cache.getMemoryStats().entries).toBe(1)

    cache.clearMemory()

    expect(cache.getCommit(hash(1))).toBeUndefined()
    expect(cache.getMemoryStats()).toMatchObject({entries: 0, bytes: 0})
  })
})
