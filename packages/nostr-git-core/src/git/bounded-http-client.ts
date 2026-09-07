type GitHttpRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
}

type GitHttpResponse = {
  url: string
  method?: string
  headers: Record<string, string>
  body: AsyncIterableIterator<Uint8Array>
  statusCode: number
  statusMessage: string
}

type GitHttpClient = {
  request(request: GitHttpRequest): Promise<GitHttpResponse>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const GIT_HTTP_INACTIVITY_TIMEOUT_MS = 90_000

/**
 * Build a browser Git HTTP client whose timeout measures network inactivity,
 * not total clone/fetch duration. isomorphic-git's public `signal` option is
 * currently reserved and its stock web client does not pass it to fetch, so
 * the watchdog must live at this transport boundary.
 */
export function createBoundedGitHttpClient(
  fallbackClient: GitHttpClient,
  options: {
    signal?: AbortSignal
    inactivityTimeoutMs?: number
    maxBytes?: number
    fetcher?: FetchLike
  } = {},
): GitHttpClient {
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) {
    if (options.maxBytes) throw new Error("Bounded Git transport requires fetch support")
    return fallbackClient
  }

  return {
    request: request => {
      // clone/push do their own internal advertisements after the explicit ref probe.
      // Those GETs must keep the small ref budget, not inherit the 64 MiB pack budget.
      const maxBytes =
        options.maxBytes &&
        (request.method || "GET") === "GET" &&
        new URL(request.url).pathname.endsWith("/info/refs")
          ? Math.min(options.maxBytes, 2 * 1024 * 1024)
          : options.maxBytes
      return requestWithInactivityTimeout(request, {
        fetcher,
        signal: options.signal,
        maxBytes,
        inactivityTimeoutMs: options.inactivityTimeoutMs ?? GIT_HTTP_INACTIVITY_TIMEOUT_MS,
      })
    },
  }
}

async function requestWithInactivityTimeout(
  request: GitHttpRequest,
  options: {
    fetcher: FetchLike
    signal?: AbortSignal
    inactivityTimeoutMs: number
    maxBytes?: number
  },
): Promise<GitHttpResponse> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let cleanedUp = false

  const timeoutError = () =>
    new Error(`Git HTTP request stalled for ${options.inactivityTimeoutMs}ms: ${request.url}`)
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    if (timeout !== undefined) clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
  const armTimeout = () => {
    if (cleanedUp || options.inactivityTimeoutMs <= 0) return
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort(timeoutError())
      cleanup()
    }, options.inactivityTimeoutMs)
  }
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason)
    cleanup()
  }
  options.signal?.addEventListener("abort", abortFromCaller, {once: true})
  if (options.signal?.aborted) abortFromCaller()

  try {
    controller.signal.throwIfAborted()
    armTimeout()
    const body = request.body
      ? await collectBody(request.body, armTimeout, options.maxBytes, controller.signal)
      : undefined
    controller.signal.throwIfAborted()
    const response = await options.fetcher(request.url, {
      method: request.method || "GET",
      headers: request.headers,
      ...(body ? {body: body as BodyInit} : {}),
      signal: controller.signal,
      ...(options.maxBytes ? {credentials: "omit" as const} : {}),
    })
    armTimeout()

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    if (options.maxBytes && Number(headers["content-length"]) > options.maxBytes) {
      await response.body?.cancel()
      throw new Error("Git HTTP data exceeds the browser import byte limit")
    }

    let source: AsyncIterableIterator<Uint8Array>
    if (options.maxBytes && !response.ok) {
      // Git's status/auth handling may never consume an error body. Do not leave it streaming.
      await response.body?.cancel()
      source = singleValueIterator(new Uint8Array())
      cleanup()
    } else if (response.body?.getReader && response.ok) {
      source = readableStreamIterator(response.body)
    } else {
      if (options.maxBytes && response.body)
        throw new Error("Bounded Git transport requires streaming response support")
      source = singleValueIterator(
        options.maxBytes ? new Uint8Array() : new Uint8Array(await response.arrayBuffer()),
      )
      cleanup()
    }
    return {
      url: response.url,
      method: request.method || "GET",
      headers,
      body: boundedBodyIterator(source, {
        armTimeout,
        cleanup,
        didTimeOut: () => timedOut,
        timeoutError,
        maxBytes: options.maxBytes,
      }),
      statusCode: response.status,
      statusMessage: response.statusText,
    }
  } catch (error) {
    cleanup()
    if (timedOut) throw timeoutError()
    throw error
  }
}

async function collectBody(
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  onChunk: () => void,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  // A geometrically grown buffer bounds both byte storage and chunk-object overhead.
  // Copy immediately: async producers may reuse/mutate their yielded views.
  let buffer = new Uint8Array(0)
  let size = 0
  for await (const chunk of body) {
    signal?.throwIfAborted()
    const required = size + chunk.byteLength
    if (maxBytes && required > maxBytes)
      throw new Error("Git HTTP data exceeds the browser import byte limit")
    if (required > buffer.byteLength) {
      const capacity = Math.max(
        required,
        Math.min(maxBytes ?? Number.MAX_SAFE_INTEGER, Math.max(64 * 1024, buffer.byteLength * 2)),
      )
      const next = new Uint8Array(capacity)
      next.set(buffer.subarray(0, size))
      buffer = next
    }
    buffer.set(chunk, size)
    size = required
    onChunk()
  }
  signal?.throwIfAborted()
  return buffer.subarray(0, size)
}

function readableStreamIterator(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader()
  let closed = false
  const release = () => {
    if (!closed) {
      closed = true
      reader.releaseLock()
    }
  }
  return {
    async next() {
      if (closed) return {done: true, value: undefined}
      try {
        const result = await reader.read()
        if (result.done) release()
        return result
      } catch (error) {
        release()
        throw error
      }
    },
    async return() {
      if (closed) return {done: true, value: undefined}
      try {
        await reader.cancel()
      } finally {
        release()
      }
      return {done: true, value: undefined}
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}

function singleValueIterator(value: Uint8Array): AsyncIterableIterator<Uint8Array> {
  let pending = true
  return {
    async next() {
      if (!pending) return {done: true, value: undefined}
      pending = false
      return {done: false, value}
    },
    async return() {
      pending = false
      return {done: true, value: undefined}
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}

function boundedBodyIterator(
  source: AsyncIterableIterator<Uint8Array>,
  controls: {
    armTimeout: () => void
    cleanup: () => void
    didTimeOut: () => boolean
    timeoutError: () => Error
    maxBytes?: number
  },
): AsyncIterableIterator<Uint8Array> {
  let bytes = 0
  return {
    async next() {
      controls.armTimeout()
      try {
        const result = await source.next()
        if (!result.done) {
          bytes += result.value.byteLength
          if (controls.maxBytes && bytes > controls.maxBytes) {
            await source.return?.()
            throw new Error("Git HTTP data exceeds the browser import byte limit")
          }
        }
        if (result.done) controls.cleanup()
        else controls.armTimeout()
        return result
      } catch (error) {
        controls.cleanup()
        if (controls.didTimeOut()) throw controls.timeoutError()
        throw error
      }
    },
    async return() {
      controls.cleanup()
      return source.return ? await source.return() : {done: true, value: undefined}
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}
