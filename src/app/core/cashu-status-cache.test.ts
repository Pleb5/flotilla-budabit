import "fake-indexeddb/auto"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {
  CashuStatusCache,
  CASHU_STATUS_DB,
  LEGACY_CHECKS_KEY,
  STATUS_CACHE_AGE,
  STATUS_CACHE_LIMIT,
  clearCashuTokenChecks,
} from "./cashu-status-cache"
import type {CashuTokenCheck} from "./cashu-token-status"

const open: CashuStatusCache[] = []
const cache = () => {
  const value = new CashuStatusCache()
  open.push(value)
  return value
}
const id = (n: number) => n.toString(16).padStart(64, "0")
const check = (
  checkedAt = Date.now(),
  state: "unspent" | "spent" = "unspent",
): CashuTokenCheck => ({
  state,
  checkedAt,
  spent: state === "spent" ? 4 : 0,
  unspent: state === "spent" ? 0 : 4,
  pending: 0,
})
const count = () =>
  new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open(CASHU_STATUS_DB)
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const db = opening.result
      const req = db.transaction("checks").objectStore("checks").count()
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    }
  })
beforeEach(async () => {
  await clearCashuTokenChecks()
})
afterEach(() => {
  for (const value of open.splice(0)) value.close()
  vi.restoreAllMocks()
  localStorage.removeItem(LEGACY_CHECKS_KEY)
})

describe("disposable Cashu status storage", () => {
  it("migrates only valid recent observations, caps oldest-first, and prunes subsequent writes", async () => {
    const now = Date.now()
    const old = Object.fromEntries(
      Array.from({length: STATUS_CACHE_LIMIT + 5}, (_, i) => [id(i), check(now - 10_000 + i)]),
    )
    old[id(3000)] = check(now - STATUS_CACHE_AGE - 1)
    old[id(3001)] = check(now + 10_000)
    old[id(3002)] = {...check(now), state: "spent"} // inconsistent amounts
    localStorage.setItem(LEGACY_CHECKS_KEY, JSON.stringify(old))
    const first = cache()
    expect(await first.get(id(2004))).toEqual(old[id(2004)])
    expect(await first.get(id(0))).toBeUndefined()
    expect(await first.get(id(3002))).toBeUndefined()
    expect(localStorage.getItem(LEGACY_CHECKS_KEY)).toBeNull()
    expect(await count()).toBe(STATUS_CACHE_LIMIT)
    const second = cache()
    await Promise.all([first.put(id(4000), check()), second.put(id(4001), check())])
    expect(await count()).toBe(STATUS_CACHE_LIMIT)
    expect(await first.get(id(5))).toBeUndefined()
    expect(await first.get(id(4001))).toBeDefined()
    expect(await second.get(id(4000))).toBeDefined()
  })

  it("expires stale nonterminal results without touching receipt lookup references", async () => {
    const first = cache()
    const now = Date.now()
    await first.put(id(1), check(now))
    await first.put(id(2), check(now, "spent"))
    const ref = {
      key: `receive:${id(1)}`,
      identity: id(1),
      kind: "receive" as const,
      operationId: "receipt",
      priority: 3,
    }
    await first.index([ref])
    vi.spyOn(Date, "now").mockReturnValue(now + STATUS_CACHE_AGE + 1)
    expect(await first.get(id(1))).toBeUndefined()
    expect(await first.get(id(2))).toEqual(check(now, "spent"))
    await first.put(id(3), check())
    expect(await count()).toBe(2)
    expect(await first.refs(id(1))).toEqual([ref])
  })

  it("merges per-record writes across tabs and never replaces spent evidence with older or unspent data", async () => {
    const [a, b] = [cache(), cache()]
    const now = Date.now()
    await a.put(id(1), check(now, "spent"))
    await b.put(id(1), check(now - 1))
    await b.put(id(1), check(now))
    expect(await b.get(id(1))).toEqual(check(now, "spent"))
    const claims = await Promise.all([a.claim(id(2), 60_000), b.claim(id(2), 60_000)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    a.close()
    b.close()
    expect(await cache().claim(id(2), 60_000)).toBe(false)
  })

  it("releases only its own paused attempt and preserves another tab's newer throttle", async () => {
    const a = cache()
    const at = await a.claim(id(1), 60_000)
    await a.release(id(1), at as number)
    expect(await a.claim(id(1), 60_000)).not.toBe(false)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000)
    const b = cache()
    const later = await b.claim(id(1), 1500)
    expect(later).not.toBe(false)
    await a.release(id(1), at as number)
    expect(await b.claim(id(1), 60_000)).toBe(false)
  })

  it("keeps failed migration retryable and cache failures separate from wallet data", async () => {
    const legacy = JSON.stringify({[id(1)]: check()})
    localStorage.setItem(LEGACY_CHECKS_KEY, legacy)
    const original = IDBObjectStore.prototype.put
    const quota = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === "checks") throw new DOMException("Synthetic quota", "QuotaExceededError")
      return original.call(this, value, key)
    })
    await expect(cache().get(id(1))).rejects.toThrow("Synthetic quota")
    expect(localStorage.getItem(LEGACY_CHECKS_KEY)).toBe(legacy)
    quota.mockRestore()
    expect(await cache().get(id(1))).toBeDefined()
    expect(localStorage.getItem(LEGACY_CHECKS_KEY)).toBeNull()
  })

  it("invalidates old-tab writes and indices when the wallet is replaced", async () => {
    const old = cache()
    await old.put(id(1), check())
    await clearCashuTokenChecks()
    await expect(old.put(id(1), check())).rejects.toThrow("Wallet session changed")
    await expect(
      old.index([
        {
          key: `receive:${id(1)}`,
          identity: id(1),
          kind: "receive",
          operationId: "old-wallet",
          priority: 3,
        },
      ]),
    ).rejects.toThrow("Wallet session changed")
    const next = cache()
    expect(await next.get(id(1))).toBeUndefined()
    expect(await next.refs(id(1))).toEqual([])
  })
})
