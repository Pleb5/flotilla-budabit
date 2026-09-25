import {beginCashuDiagnostic, type CashuDiagnosticOperation} from "./cashu-diagnostics"

type Scheduler = {
  postTask: <T>(
    callback: () => T | Promise<T>,
    options: {priority: "background"; signal?: AbortSignal},
  ) => Promise<T>
}
export const cashuAbort = () => new DOMException("Wallet work cancelled", "AbortError")
export const assertCashuWorkActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw cashuAbort()
}

/** Schedule the work itself (not just an empty yield) at background priority.
 * Callers bound each task/page and re-enter this scheduler between pages. */
export const runCashuBackground = <T>(
  operation: CashuDiagnosticOperation,
  work: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const record = beginCashuDiagnostic(operation, {priority: "background"})
  let finished = false
  const finish: typeof record = record
    ? detail => {
        if (!finished) {
          finished = true
          record(detail)
        }
      }
    : undefined
  const queued = finish ? performance.now() : 0
  const run = async () => {
    assertCashuWorkActive(signal)
    const queueMs = finish ? performance.now() - queued : 0
    try {
      const value = await work()
      finish?.({queueMs})
      return value
    } catch (error) {
      finish?.({queueMs, outcome: signal?.aborted ? "cancelled" : "error"})
      throw error
    }
  }
  if (signal?.aborted) {
    finish?.({outcome: "cancelled"})
    return Promise.reject(cashuAbort())
  }
  const scheduler = (globalThis as typeof globalThis & {scheduler?: Scheduler}).scheduler
  if (scheduler?.postTask)
    return scheduler.postTask(run, {priority: "background", signal}).catch(error => {
      finish?.({outcome: signal?.aborted ? "cancelled" : "error"})
      throw error
    })
  return new Promise<T>((resolve, reject) => {
    let idle: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      signal?.removeEventListener("abort", cancel)
      if (idle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idle)
      if (timer !== undefined) clearTimeout(timer)
    }
    const cancel = () => {
      cleanup()
      finish?.({outcome: "cancelled"})
      reject(cashuAbort())
    }
    const start = () => {
      cleanup()
      void run().then(resolve, reject)
    }
    signal?.addEventListener("abort", cancel, {once: true})
    if (typeof requestIdleCallback === "function") idle = requestIdleCallback(start, {timeout: 500})
    else timer = setTimeout(start, typeof window === "undefined" ? 0 : 16)
  })
}
