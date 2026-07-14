import {describe, expect, it, vi} from "vitest"
import {ClientMessageType, MockAdapter, requestOne} from "@welshman/net"

describe("Welshman request patch", () => {
  it("batches filters into bounded subscription ids", async () => {
    const send = vi.fn()
    const adapter = new MockAdapter("wss://relay.example", send)
    const controller = new AbortController()
    const filters = Array.from({length: 231}, (_, index) => ({kinds: [index + 1]}))
    const result = requestOne({
      relay: adapter.url,
      filters,
      maxFiltersPerSubscription: 100,
      signal: controller.signal,
      context: {getAdapter: () => adapter},
    })

    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map(([message]) => message.slice(2).length)).toEqual([100, 100, 31])
    expect(new Set(send.mock.calls.map(([message]) => message[1])).size).toBe(3)
    expect(send.mock.calls.flatMap(([message]) => message.slice(2))).toEqual(filters)
    expect(send.mock.calls.every(([message]) => message[0] === ClientMessageType.Req)).toBe(true)

    controller.abort()
    await result
  })
})
