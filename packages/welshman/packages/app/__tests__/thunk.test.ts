import {MockAdapter, PublishStatus, LOCAL_RELAY_URL} from "@welshman/net"
import {NOTE, DIRECT_MESSAGE, WRAP, makeEvent, getPubkey, makeSecret, prep} from "@welshman/util"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {repository, tracker} from "../src/core"
import {addSession, dropSession, makeNip01Session} from "../src/session"
import {
  abortThunk,
  MergedThunk,
  publishThunk,
  retryThunk,
  Thunk,
  thunkQueue,
  flattenThunks,
  waitForAnyRelayAck,
} from "../src/thunk"

const secret = makeSecret()

const pubkey = getPubkey(secret)

const mockRequest = {
  event: prep({...makeEvent(NOTE), pubkey}),
  relays: [LOCAL_RELAY_URL],
}

describe("thunk", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    addSession(makeNip01Session(secret))
  })

  afterEach(async () => {
    thunkQueue.stop()
    thunkQueue.clear()
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    vi.clearAllMocks()
    thunkQueue.start()
    dropSession(pubkey)
  })

  describe("MergedThunk", () => {
    it("should abort all thunks when merged controller aborts", () => {
      const thunk1 = publishThunk(mockRequest)
      const thunk2 = publishThunk(mockRequest)
      const merged = new MergedThunk([thunk1, thunk2])

      abortThunk(merged)

      expect(thunk1.controller.signal.aborted).toBe(true)
      expect(thunk2.controller.signal.aborted).toBe(true)
    })
  })

  describe("flattenThunks", () => {
    it("should iterate through nested thunks", () => {
      const thunk1 = publishThunk(mockRequest)
      const thunk2 = publishThunk(mockRequest)
      const merged = new MergedThunk([thunk1, thunk2])
      const thunks = Array.from(flattenThunks([merged, thunk1]))

      expect(thunks).toHaveLength(3)
    })
  })

  describe("waitForAnyRelayAck", () => {
    it("resolves on the first success from an explicit target relay", async () => {
      const thunk = new Thunk({...mockRequest, relays: ["relay-1", "relay-2"]})
      const ack = waitForAnyRelayAck(thunk, ["relay-1", "relay-2"])
      const success = {
        relay: "relay-2",
        status: PublishStatus.Success,
        detail: "accepted",
      }

      thunk.results["relay-1"] = {
        relay: "relay-1",
        status: PublishStatus.Failure,
        detail: "denied",
      }
      thunk._notify()
      thunk.results["relay-2"] = success
      thunk._notify()

      await expect(ack).resolves.toBe(success)
      expect(thunk._subs).toHaveLength(0)
    })

    it("ignores success outside the explicit target relays", async () => {
      const thunk = new Thunk({...mockRequest, relays: ["target", "outside"]})
      const ack = waitForAnyRelayAck(thunk, ["target"])
      const settled = vi.fn()

      void ack.then(settled, settled)
      thunk.results.outside = {
        relay: "outside",
        status: PublishStatus.Success,
        detail: "accepted",
      }
      thunk._notify()
      await Promise.resolve()

      expect(settled).not.toHaveBeenCalled()

      const success = {
        relay: "target",
        status: PublishStatus.Success,
        detail: "accepted",
      }

      thunk.results.target = success
      thunk._notify()

      await expect(ack).resolves.toBe(success)
    })

    it("rejects once all represented targets are terminal and details missing targets", async () => {
      const thunk = new Thunk({...mockRequest, relays: ["relay-1", "relay-2", "outside"]})
      const ack = waitForAnyRelayAck(thunk, ["relay-1", "relay-2", "missing"])
      const settled = vi.fn()

      void ack.then(settled, settled)
      thunk.results["relay-1"] = {
        relay: "relay-1",
        status: PublishStatus.Failure,
        detail: "denied",
      }
      thunk._notify()
      await Promise.resolve()

      expect(settled).not.toHaveBeenCalled()

      thunk.results["relay-2"] = {
        relay: "relay-2",
        status: PublishStatus.Timeout,
        detail: "timed out",
      }
      thunk._notify()

      await expect(ack).rejects.toThrow(
        "No target relay acknowledged publication (relay-1: failure (denied); relay-2: timeout (timed out); missing: no result)",
      )
      expect(thunk._subs).toHaveLength(0)
    })

    it("rejects empty target relays", async () => {
      const thunk = new Thunk(mockRequest)

      await expect(waitForAnyRelayAck(thunk, [])).rejects.toThrow(
        "Cannot wait for a relay ACK without target relays",
      )
    })
  })

  describe("publishThunk", () => {
    it("should create and publish a thunk", async () => {
      const publishSpy = vi.spyOn(repository, "publish")
      const result = publishThunk(mockRequest)

      expect(publishSpy).toHaveBeenCalled()
      expect(result).toHaveProperty("event")
      expect(result).toHaveProperty("options")
    })

    it("does not insert or remove ordinary events when optimistic is false", async () => {
      const relay = "optimistic-relay"
      const send = vi.fn()
      const adapter = new MockAdapter(relay, send)
      const event = prep(makeEvent(NOTE, {tags: [["test", "non-optimistic"]]}), pubkey)
      const publishSpy = vi.spyOn(repository, "publish")
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const thunk = publishThunk({
        event,
        relays: [relay],
        optimistic: false,
        context: {getAdapter: () => adapter},
      })

      expect(publishSpy).not.toHaveBeenCalled()
      expect(repository.getEvent(event.id)).toBeUndefined()

      await vi.advanceTimersByTimeAsync(100)

      expect(send).toHaveBeenCalledOnce()
      expect(publishSpy).not.toHaveBeenCalled()
      expect(repository.getEvent(thunk.event.id)).toBeUndefined()

      adapter.receive(["OK", thunk.event.id, true, "accepted"])
      await Promise.resolve()
      abortThunk(thunk)

      expect(publishSpy).not.toHaveBeenCalled()
      expect(removeEventSpy).not.toHaveBeenCalled()
    })

    it("settles relay ACK waiters when transport setup throws", async () => {
      const relay = "broken-relay"
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const thunk = publishThunk({
        event: prep(makeEvent(NOTE, {tags: [["test", "transport-failure"]]}), pubkey),
        relays: [relay],
        optimistic: false,
        context: {
          getAdapter: () => {
            throw new Error("transport failed")
          },
        },
      })
      const ack = expect(waitForAnyRelayAck(thunk)).rejects.toThrow("transport failed")

      await vi.runAllTimersAsync()
      await ack

      expect(thunk.results[relay].status).toBe(PublishStatus.Failure)
      consoleErrorSpy.mockRestore()
    })

    it("should handle abort", () => {
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const thunk = publishThunk({
        ...mockRequest,
        event: makeEvent(NOTE, {tags: [["test", "publish-abort"]]}),
      })

      abortThunk(thunk)

      expect(removeEventSpy).toHaveBeenCalledWith(thunk.event.id)
    })

    it("keeps a signing failure visible and replaces it on retry", async () => {
      const event = prep(makeEvent(NOTE, {tags: [["test", "signing-failure"]]}), pubkey)
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const trackSpy = vi.spyOn(tracker, "track")
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const thunk = publishThunk({event, relays: [LOCAL_RELAY_URL]})
      const optimisticEventId = thunk.event.id

      vi.spyOn(thunk.signer, "sign").mockRejectedValueOnce(new Error("signing failed"))
      const ack = expect(waitForAnyRelayAck(thunk)).rejects.toThrow("signing failed")
      expect(repository.getEvent(optimisticEventId)).toBe(thunk.event)
      expect(trackSpy).not.toHaveBeenCalled()

      await vi.runAllTimersAsync()
      await ack

      expect(removeEventSpy).not.toHaveBeenCalled()
      expect(repository.getEvent(optimisticEventId)).toBe(thunk.event)
      expect(thunk.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Failure)
      expect(trackSpy).not.toHaveBeenCalled()

      const retry = retryThunk(thunk)
      expect(thunk._optimisticEventId).toBeUndefined()
      expect(retry._optimisticEventId).toBe(optimisticEventId)

      await vi.runAllTimersAsync()

      expect(removeEventSpy).toHaveBeenCalledOnce()
      expect(removeEventSpy).toHaveBeenCalledWith(optimisticEventId)
      expect(repository.getEvent(optimisticEventId)).toBe(retry.event)
      expect(retry.event).toHaveProperty("sig")
      expect(retry.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Success)
      consoleErrorSpy.mockRestore()
    })
  })

  describe("abortThunk", () => {
    it("should abort a thunk and clean up", () => {
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const thunk = publishThunk({
        ...mockRequest,
        event: makeEvent(NOTE, {tags: [["test", "abort-thunk"]]}),
      })

      abortThunk(thunk)

      expect(removeEventSpy).toHaveBeenCalledWith(thunk.event.id)
    })
  })

  it("records tracker provenance only after a successful relay ACK", async () => {
    const relay = "tracker-relay"
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const track = vi.spyOn(tracker, "track")
    const thunk = publishThunk({
      event: prep(makeEvent(NOTE, {tags: [["test", "tracker-ack"]]}), pubkey),
      relays: [relay],
      optimistic: false,
      context: {getAdapter: () => adapter},
    })
    const ack = waitForAnyRelayAck(thunk)

    await vi.advanceTimersByTimeAsync(100)

    expect(send).toHaveBeenCalledOnce()
    expect(track).not.toHaveBeenCalled()

    adapter.receive(["OK", thunk.event.id, true, "accepted"])

    await expect(ack).resolves.toEqual({
      relay,
      status: PublishStatus.Success,
      detail: "accepted",
    })
    expect(track).toHaveBeenCalledOnce()
    expect(track).toHaveBeenCalledWith(thunk.event.id, relay)
  })

  it("should update status during publishing", async () => {
    const track = vi.spyOn(tracker, "track")
    const thunk = publishThunk(mockRequest)

    expect(track).not.toHaveBeenCalled()

    // Wait for initial async operations
    await vi.runAllTimersAsync()

    expect(thunk.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Success)

    // Verify tracker was called on success
    expect(track).toHaveBeenCalledWith(thunk.event.id, LOCAL_RELAY_URL)

    await vi.runAllTimersAsync()
    await thunk.complete

    expect(thunk.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Success)
  })

  describe("wrapped events", () => {
    it("if recipient is included, the event should be wrapped", async () => {
      const recipient = getPubkey(makeSecret())
      const event = prep({...makeEvent(DIRECT_MESSAGE), pubkey})
      const thunk = publishThunk({event, relays: [], recipient})
      const publishSpy = vi.spyOn(thunk, "_publish")

      await vi.runAllTimersAsync()

      expect(publishSpy.mock.calls[0][0].kind).toBe(WRAP)
      expect(publishSpy.mock.calls[0][0].id).not.toBe(thunk.event.id)
    })
  })
})
