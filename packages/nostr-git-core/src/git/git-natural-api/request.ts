export interface GitNaturalFetchResponse {
  ok?: boolean
  status: number
  statusText?: string
  text?: () => Promise<string>
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type GitNaturalFetch = (
  input: string,
  init?: RequestInit,
) => Promise<GitNaturalFetchResponse>

export interface GitNaturalRequestOptions {
  fetcher: GitNaturalFetch
  signal?: AbortSignal
  timeoutMs?: number
  cancellationSettleTimeoutMs?: number
}

export class GitNaturalRequestTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`Git natural request timed out after ${timeoutMs}ms for ${url}`)
    this.name = "GitNaturalRequestTimeoutError"
  }
}

export class GitNaturalRequestCancellationUnconfirmedError extends Error {
  constructor(readonly url: string) {
    super(`Git natural request did not settle after cancellation for ${url}`)
    this.name = "GitNaturalRequestCancellationUnconfirmedError"
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_CANCELLATION_SETTLE_TIMEOUT_MS = 1_000

export async function requestBytes(
  url: string,
  init: RequestInit,
  options: GitNaturalRequestOptions,
  operation: string,
): Promise<Uint8Array> {
  throwIfAborted(options.signal)
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  let cancellationCause: "caller" | "timeout" | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rejectCallerAbort: (() => void) | undefined

  const callerAbortPromise = options.signal
    ? new Promise<never>((_resolve, reject) => {
        rejectCallerAbort = () => reject(abortError())
      })
    : undefined

  const abortFromCaller = () => {
    if (cancellationCause === undefined) cancellationCause = "caller"
    if (cancellationCause === "caller" && timeout !== undefined) {
      clearTimeout(timeout)
      timeout = undefined
    }
    controller.abort()
    rejectCallerAbort?.()
  }
  options.signal?.addEventListener("abort", abortFromCaller, {once: true})
  if (options.signal?.aborted) abortFromCaller()

  const request = (async () => {
    const response = await options.fetcher(url, {...init, signal: controller.signal})
    assertSuccessfulResponse(response, operation)
    return new Uint8Array(await response.arrayBuffer())
  })()

  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            if (cancellationCause !== undefined) return
            cancellationCause = "timeout"
            controller.abort()
            reject(new GitNaturalRequestTimeoutError(url, timeoutMs))
          }, timeoutMs)
        })
      : undefined

  try {
    const contenders: Array<Promise<Uint8Array>> = [request]
    if (timeoutPromise) contenders.push(timeoutPromise)
    if (callerAbortPromise) contenders.push(callerAbortPromise)
    return await Promise.race(contenders)
  } catch (error) {
    if (cancellationCause === undefined) throw error

    controller.abort()
    const settled = await waitForSettlement(
      request,
      options.cancellationSettleTimeoutMs ?? DEFAULT_CANCELLATION_SETTLE_TIMEOUT_MS,
    )
    if (!settled) throw new GitNaturalRequestCancellationUnconfirmedError(url)
    if (cancellationCause === "timeout") throw new GitNaturalRequestTimeoutError(url, timeoutMs)
    throw abortError()
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}

export function assertSuccessfulResponse(response: GitNaturalFetchResponse, operation: string): void {
  const ok =
    typeof response.ok === "boolean"
      ? response.ok
      : Number.isFinite(response.status) && response.status >= 200 && response.status < 300
  if (ok) return

  const statusText = response.statusText ? ` ${response.statusText}` : ""
  throw new Error(`${operation} failed with HTTP ${response.status}${statusText}`)
}

async function waitForSettlement(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<false>(resolve => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError")
}
