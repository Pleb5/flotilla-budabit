import "fake-indexeddb/auto"
import {afterEach, describe, expect, it, vi} from "vitest"
import {Repository} from "@welshman/net"
import {getAddress, type TrustedEvent} from "@welshman/util"
import {
  createDeletionCache,
  createDeletionStorage,
  DELETION_CACHE_LIMIT,
  type DeletionRecord,
} from "./deletion-cache"

const target: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "a".repeat(64),
  created_at: 10,
  kind: 31923,
  tags: [["d", "event"]],
  content: "large content not retained",
  sig: "",
}
const deletion: TrustedEvent = {
  ...target,
  id: "delete",
  kind: 5,
  created_at: 11,
  tags: [
    ["a", getAddress(target)],
    ["e", target.id],
  ],
}

afterEach(() => vi.useRealTimers())

describe("selective deletion persistence", () => {
  it("does no eager I/O, batches positive writes, and reads only demanded targets", async () => {
    vi.useFakeTimers()
    const storage = {
      get: vi.fn(async (_keys: string[]) => []),
      put: vi.fn(async (_records: DeletionRecord[]) => {}),
    }
    const cache = createDeletionCache({storage, restore: vi.fn()})
    expect(storage.get).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
    cache.remember({...deletion, pubkey: "b".repeat(64)}, target)
    cache.remember({...deletion, created_at: 9}, target)
    cache.remember({...deletion, tags: [["e", target.id]]}, target)
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.put).not.toHaveBeenCalled()
    cache.remember(deletion, target)
    cache.remember(deletion, target)
    await vi.advanceTimersByTimeAsync(999)
    expect(storage.put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(storage.put).toHaveBeenCalledTimes(1)
    expect(storage.put.mock.calls[0][0]).toHaveLength(1)
    expect(storage.put.mock.calls[0][0][0]).not.toHaveProperty("content")
    await cache.hydrate([target, target])
    await cache.hydrate([{...target, id: "new", created_at: 12}])
    expect(storage.get).toHaveBeenCalledTimes(1)
    expect(storage.get).toHaveBeenCalledWith([`${getAddress(target)}:${target.pubkey}`])
    cache.reset()
  })

  it("prevents stale reappearance after restart, allows newer versions, and bounds storage", async () => {
    const storage = createDeletionStorage()
    await storage.clear()
    const cache = createDeletionCache({storage, restore: () => {}})
    cache.remember(deletion, target)
    await cache.flush()
    const repo = new Repository()
    repo.publish(target)
    const restored = createDeletionCache({
      storage,
      restore: records => repo.restoreDeletions(records),
    })
    await restored.hydrate([target])
    expect(repo.query([{kinds: [target.kind]}])).toEqual([])
    const newer = {...target, id: "fresh", created_at: 12}
    repo.publish(newer)
    expect(repo.query([{kinds: [target.kind]}])).toEqual([newer])

    const records: DeletionRecord[] = Array.from({length: DELETION_CACHE_LIMIT + 1}, (_, i) => ({
      key: `id-${i}:${target.pubkey}`,
      target: `id-${i}`,
      pubkey: target.pubkey,
      created_at: 11,
      storedAt: Date.now() + i + 1,
    }))
    await storage.put(records)
    const retained = await storage.get(records.map(record => record.key))
    expect(retained).toHaveLength(DELETION_CACHE_LIMIT)
    expect(retained.some(record => record.key === records[0].key)).toBe(false)
    // No content, signatures, or raw archive. The bound is <1 MiB even for
    // ordinary 64-byte event IDs and author keys, including key duplication.
    const typical = {
      ...records[0],
      key: `${"e".repeat(64)}:${target.pubkey}`,
      target: "e".repeat(64),
    }
    expect(
      new TextEncoder().encode(JSON.stringify(typical)).length * DELETION_CACHE_LIMIT,
    ).toBeLessThan(1024 * 1024)
    cache.reset()
    restored.reset()
    await storage.clear()
  })

  it("does not restore a late cache read after logout/reset", async () => {
    let finish!: (records: DeletionRecord[]) => void
    const restore = vi.fn()
    const storage = {
      put: vi.fn(),
      get: () =>
        new Promise<DeletionRecord[]>(resolve => {
          finish = resolve
        }),
    }
    const cache = createDeletionCache({storage, restore})
    const work = cache.hydrate([target])
    cache.reset()
    finish([
      {key: "key", target: getAddress(target), pubkey: target.pubkey, created_at: 11, storedAt: 0},
    ])
    await work
    expect(restore).not.toHaveBeenCalled()
  })

  it("cancels unstarted cache batches on exit without claiming unread keys", async () => {
    let finish!: (records: DeletionRecord[]) => void
    const storage = {
      put: vi.fn(),
      get: vi.fn(
        (_keys: string[]) =>
          new Promise<DeletionRecord[]>(resolve => {
            finish = resolve
          }),
      ),
    }
    const cache = createDeletionCache({storage, restore: vi.fn()})
    const targets = Array.from({length: 201}, (_, i) => ({
      ...target,
      tags: [["d", `event-${i}`]],
    }))
    const controller = new AbortController()
    const firstVisit = cache.hydrate(targets, controller.signal)
    expect(storage.get.mock.calls[0][0]).toHaveLength(100)
    controller.abort()
    finish([])
    await firstVisit
    expect(storage.get).toHaveBeenCalledTimes(1)

    storage.get.mockImplementation(async () => [])
    await cache.hydrate(targets)
    expect(storage.get.mock.calls.slice(1).map(([keys]) => keys.length)).toEqual([100, 1])
    cache.reset()
  })
})
