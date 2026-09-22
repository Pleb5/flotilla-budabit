import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {
  Socket,
  SocketAdapter,
  SocketEvent,
  publishOne,
  PublishStatus,
  setPublishPolicy,
} from "@welshman/net"
import type {SignedEvent} from "@welshman/util"
import {createRelayWriteCapabilityPolicy} from "./relay-write-capabilities"

// Resolve the transport dependency from the workspace package that owns it.
vi.mock("../../../packages/welshman/packages/net/node_modules/isomorphic-ws", () => ({
  default: class {
    onopen?: () => void
    onclose?: () => void
    send = vi.fn()
    close = () => this.onclose?.()
    constructor() {
      setTimeout(() => this.onopen?.(), 0)
    }
  },
}))

describe("write capability learning through a real socket receive queue", () => {
  const relay = "wss://terminal.example/"
  const event = {id: "a".repeat(64), kind: 32222} as SignedEvent
  const denial = "blocked: kind 32222 is not allowed"
  let socket: Socket
  let restore: () => void
  beforeEach(async () => {
    vi.useFakeTimers()
    socket = new Socket(relay, [])
    socket.open()
    await vi.advanceTimersByTimeAsync(0)
  })
  afterEach(() => {
    restore?.()
    socket.cleanup()
    vi.useRealTimers()
  })

  it.each(["close", "error"] as const)(
    "learns a matching rejection before peer %s discards the receive queue",
    async termination => {
      const policy = createRelayWriteCapabilityPolicy()
      const observeAck = vi.fn(policy.observeAck)
      restore = setPublishPolicy({...policy, observeAck})
      const getAdapter = vi.fn(() => new SocketAdapter(socket))
      const onFailure = vi.fn()
      const first = publishOne({event, relay, context: {getAdapter}, onFailure})
      await vi.advanceTimersByTimeAsync(100)
      expect(socket._ws!.send).toHaveBeenCalledWith(JSON.stringify(["EVENT", event]))
      socket._ws!.onmessage?.({data: JSON.stringify(["OK", event.id, false, denial])} as any)
      expect(observeAck).not.toHaveBeenCalled()
      if (termination === "close") socket._ws!.onclose?.({} as any)
      else socket._ws!.onerror?.({} as any)
      await vi.runAllTimersAsync()
      expect((await first).status).toBe(PublishStatus.Failure)
      expect(observeAck).toHaveBeenCalledExactlyOnceWith(relay, event, false, denial)
      expect(onFailure).toHaveBeenCalledOnce()
      expect((await publishOne({event, relay, context: {getAdapter}})).status).toBe(
        PublishStatus.Skipped,
      )
      expect(getAdapter).toHaveBeenCalledOnce()
    },
  )

  it("preserves acceptance from a popped batch and clears a restriction learned by another in-flight publication", async () => {
    const policy = createRelayWriteCapabilityPolicy()
    const observeAck = vi.fn(policy.observeAck)
    restore = setPublishPolicy({...policy, observeAck})
    const context = {getAdapter: () => new SocketAdapter(socket)}
    const secondEvent = {...event, id: "b".repeat(64)}
    const first = publishOne({event, relay, context})
    const second = publishOne({event: secondEvent, relay, context})
    await vi.advanceTimersByTimeAsync(100)
    const ws = socket._ws!
    socket.on(SocketEvent.Receive, message => {
      if (message[0] === "EVENT") ws.onclose?.({} as any)
    })
    for (const message of [
      ["OK", event.id, false, denial],
      ["EVENT", "read", {}],
      ["OK", secondEvent.id, true, "stored"],
    ]) {
      ws.onmessage?.({data: JSON.stringify(message)} as any)
    }
    await vi.runAllTimersAsync()
    expect((await first).status).toBe(PublishStatus.Failure)
    expect((await second).status).toBe(PublishStatus.Success)
    expect(policy.check(relay, event)).toBeUndefined()
    expect(observeAck).toHaveBeenCalledTimes(2)
  })

  it("does not learn another event's rejection or change the timeout after a bare disconnect", async () => {
    const policy = createRelayWriteCapabilityPolicy()
    const observeAck = vi.fn(policy.observeAck)
    restore = setPublishPolicy({...policy, observeAck})
    const onTimeout = vi.fn()
    const pending = publishOne({
      event,
      relay,
      timeout: 1234,
      onTimeout,
      context: {getAdapter: () => new SocketAdapter(socket)},
    })
    await vi.advanceTimersByTimeAsync(100)
    socket._ws!.onmessage?.({data: JSON.stringify(["OK", "unrelated", false, denial])} as any)
    socket._ws!.onclose?.({} as any)
    await vi.advanceTimersByTimeAsync(1133)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).status).toBe(PublishStatus.Timeout)
    expect(observeAck).not.toHaveBeenCalled()
    expect(policy.check(relay, event)).toBeUndefined()
  })
})
