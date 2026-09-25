import {afterEach, describe, expect, it, vi} from "vitest"
import {runCashuBackground} from "./cashu-background"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe("wallet background admission", () => {
  it("runs the lookup itself at scheduler background priority", async () => {
    let admitted: (() => unknown) | undefined
    const postTask = vi.fn(
      (callback, {signal}) =>
        new Promise((resolve, reject) => {
          admitted = () => resolve(callback())
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          )
        }),
    )
    vi.stubGlobal("scheduler", {postTask})
    const work = vi.fn(() => 7)
    const controller = new AbortController()
    const task = runCashuBackground("lookup", work, controller.signal)
    expect(work).not.toHaveBeenCalled()
    expect(postTask).toHaveBeenCalledWith(expect.any(Function), {
      priority: "background",
      signal: controller.signal,
    })
    admitted!()
    expect(await task).toBe(7)
    expect(work).toHaveBeenCalledOnce()
  })

  it.each(["idle", "timer", "scheduler"])(
    "cancels queued work using the %s fallback",
    async mode => {
      vi.useFakeTimers()
      const cancel = vi.fn()
      vi.stubGlobal(
        "scheduler",
        mode === "scheduler"
          ? {
              postTask: (_callback: unknown, {signal}: {signal: AbortSignal}) =>
                new Promise((_, reject) =>
                  signal.addEventListener("abort", () =>
                    reject(new DOMException("Cancelled", "AbortError")),
                  ),
                ),
            }
          : undefined,
      )
      vi.stubGlobal("requestIdleCallback", mode === "idle" ? vi.fn(() => 123) : undefined)
      vi.stubGlobal("cancelIdleCallback", cancel)
      const controller = new AbortController()
      const work = vi.fn()
      const task = runCashuBackground("lookup", work, controller.signal)
      const rejection = expect(task).rejects.toMatchObject({name: "AbortError"})
      controller.abort()
      await rejection
      await vi.runAllTimersAsync()
      expect(work).not.toHaveBeenCalled()
      if (mode === "idle") expect(cancel).toHaveBeenCalledWith(123)
    },
  )

  it("executes through the timer fallback without requiring browser APIs", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("scheduler", undefined)
    vi.stubGlobal("requestIdleCallback", undefined)
    const task = runCashuBackground("lookup", () => "ready")
    await vi.runAllTimersAsync()
    expect(await task).toBe("ready")
  })
})
