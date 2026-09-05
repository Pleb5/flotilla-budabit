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
    fetcher?: FetchLike
  } = {},
): GitHttpClient {
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) return fallbackClient

  return {
    request: request =>
      requestWithInactivityTimeout(request, {
        fetcher,
        signal: options.signal,
        inactivityTimeoutMs: options.inactivityTimeoutMs ?? GIT_HTTP_INACTIVITY_TIMEOUT_MS,
      }),
  }
}

async function requestWithInactivityTimeout(
  request: GitHttpRequest,
  options: {
    fetcher: FetchLike
    signal?: AbortSignal
    inactivityTimeoutMs: number
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
    armTimeout()
    const body = request.body ? await collectBody(request.body, armTimeout) : undefined
    const response = await options.fetcher(request.url, {
      method: request.method || "GET",
      headers: request.headers,
      ...(body ? {body: body as BodyInit} : {}),
      signal: controller.signal,
    })
    armTimeout()

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    let source: AsyncIterableIterator<Uint8Array>
    if (response.body?.getReader && response.ok) {
      source = readableStreamIterator(response.body)
    } else {
      source = singleValueIterator(new Uint8Array(await response.arrayBuffer()))
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
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    chunks.push(chunk)
    size += chunk.byteLength
    onChunk()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function readableStreamIterator(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader()
  return {
    next: () => reader.read(),
    async return() {
      try {
        await reader.cancel()
      } finally {
        reader.releaseLock()
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
  },
): AsyncIterableIterator<Uint8Array> {
  return {
    async next() {
      controls.armTimeout()
      try {
        const result = await source.next()
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
