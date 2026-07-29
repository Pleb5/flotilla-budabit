import {afterEach, describe, expect, it, vi} from "vitest"
import {IDB} from "./indexeddb"

describe("IDB.connectWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("continues when opening IndexedDB remains blocked", async () => {
    vi.useFakeTimers()
    const db = new IDB({name: "blocked-test", version: 1})
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    vi.spyOn(db, "connect").mockReturnValue(new Promise(() => undefined))

    const result = db.connectWithTimeout(100)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(false)
    expect(consoleWarn).toHaveBeenCalledWith(
      "IndexedDB 'blocked-test' open timed out; continuing without persistent storage",
    )
  })

  it("reports a successful connection before the deadline", async () => {
    vi.useFakeTimers()
    const db = new IDB({name: "connected-test", version: 1})

    vi.spyOn(db, "connect").mockResolvedValue({} as any)

    await expect(db.connectWithTimeout(100)).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(100)
  })
})
