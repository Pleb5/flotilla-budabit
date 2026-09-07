import {describe, expect, it, vi} from "vitest"

import {createBoundedGitHttpClient} from "../../src/git/bounded-http-client.js"

describe("bounded Git HTTP client", () => {
  it("keeps internal clone/push ref advertisements below the larger pack-transfer budget", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, {headers: {"content-length": String(3 * 1024 * 1024)}}),
    )
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {
      fetcher,
      maxBytes: 64 * 1024 * 1024,
    })
    await expect(
      client.request({url: "https://example.com/repo.git/info/refs?service=git-upload-pack"}),
    ).rejects.toThrow("byte limit")
    const pack = await client.request({
      url: "https://example.com/repo.git/git-upload-pack",
      method: "POST",
    })
    expect(pack.statusCode).toBe(200)
    await pack.body.return!()
  })
  it("copies reused upload chunks without retaining a whole array of chunk objects", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null))
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {fetcher, maxBytes: 8})
    async function* body() {
      const chunk = Uint8Array.of(1)
      yield chunk
      chunk[0] = 2
      yield chunk
    }
    const response = await client.request({url: "https://example.com/repo.git", body: body()})
    expect(Array.from(fetcher.mock.calls[0][1]!.body as Uint8Array)).toEqual([1, 2])
    expect(fetcher.mock.calls[0][1]?.credentials).toBe("omit")
    await response.body.return!()
  })
  it("does not aggregate or send an already aborted upload", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn()
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {
      fetcher,
      maxBytes: 8,
      signal: controller.signal,
    })
    await expect(
      client.request({url: "https://example.com/repo.git", body: [Uint8Array.of(1)]}),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("cancels bounded HTTP error bodies even if Git only inspects the status", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({cancel})
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {
      maxBytes: 8,
      fetcher: async () => new Response(stream, {status: 401}),
    })
    const response = await client.request({url: "https://example.com/repo.git"})
    expect(response.statusCode).toBe(401)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it("releases a response reader on normal completion", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1))
        controller.close()
      },
    })
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {
      maxBytes: 8,
      fetcher: async () => new Response(stream),
    })
    const response = await client.request({url: "https://example.com/repo.git"})
    for await (const _chunk of response.body) {
      /* consume */
    }
    expect(stream.locked).toBe(false)
  })
  it("bounds uploaded and downloaded bytes before aggregating them", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(16)))
    const client = createBoundedGitHttpClient({request: vi.fn()} as any, {fetcher, maxBytes: 8})
    await expect(
      client.request({url: "https://example.com/repo.git", body: [new Uint8Array(9)]}),
    ).rejects.toThrow("byte limit")
    expect(fetcher).not.toHaveBeenCalled()
    const response = await client.request({url: "https://example.com/repo.git"})
    await expect(response.body.next()).rejects.toThrow("byte limit")
  })
  it("aborts a request after network inactivity", async () => {
    const fetcher = vi.fn(
      async (_url: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            {once: true},
          )
        }),
    )
    const fallback = {request: vi.fn()}
    const client = createBoundedGitHttpClient(fallback as any, {
      fetcher,
      inactivityTimeoutMs: 5,
    })

    await expect(client.request({url: "https://example.com/repo.git"})).rejects.toThrow(
      "Git HTTP request stalled for 5ms",
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fallback.request).not.toHaveBeenCalled()
  })

  it("resets the inactivity watchdog as response chunks arrive", async () => {
    vi.useFakeTimers()
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.enqueue(Uint8Array.of(1)), 4)
          setTimeout(() => controller.enqueue(Uint8Array.of(2)), 8)
          setTimeout(() => controller.close(), 12)
        },
      })
      const fetcher = vi.fn(async () => new Response(stream, {status: 200}))
      const client = createBoundedGitHttpClient({request: vi.fn()} as any, {
        fetcher,
        inactivityTimeoutMs: 5,
      })
      const responsePromise = client.request({url: "https://example.com/repo.git"})
      await vi.advanceTimersByTimeAsync(0)
      const response = await responsePromise
      const chunks: number[] = []
      const consume = (async () => {
        for await (const chunk of response.body) chunks.push(...chunk)
      })()

      await vi.advanceTimersByTimeAsync(12)
      await consume
      expect(chunks).toEqual([1, 2])
    } finally {
      vi.useRealTimers()
    }
  })
})
