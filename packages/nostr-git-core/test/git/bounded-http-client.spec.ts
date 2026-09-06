import {describe, expect, it, vi} from "vitest"

import {createBoundedGitHttpClient} from "../../src/git/bounded-http-client.js"

describe("bounded Git HTTP client", () => {
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
