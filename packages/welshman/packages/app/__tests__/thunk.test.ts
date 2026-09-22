import {get} from "svelte/store"
import {MockAdapter, PublishStatus, LOCAL_RELAY_URL, setPublishPolicy} from "@welshman/net"
import {Nip01Signer} from "@welshman/signer"
import {NOTE, DIRECT_MESSAGE, WRAP, makeEvent, getPubkey, makeSecret, prep} from "@welshman/util"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {repository, tracker} from "../src/core"
import {addSession, dropSession, makeNip01Session} from "../src/session"
import {
  abortThunk,
  MergedThunk,
  publishThunk,
  retryThunk,
  subscribePublicationLifecycle,
  thunks,
  Thunk,
  thunkQueue,
  flattenThunks,
  waitForAnyRelayAck,
  getThunkError,
} from "../src/thunk"

const secret = makeSecret()

const pubkey = getPubkey(secret)
const relay1 = "wss://relay-1.example/"
const relay2 = "wss://relay-2.example/"
const target = "wss://target.example/"
const outside = "wss://outside.example/"
const missing = "wss://missing.example/"

const mockRequest = {
  event: prep({...makeEvent(NOTE), pubkey}),
  relays: [LOCAL_RELAY_URL],
}

describe("thunk", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    addSession(makeNip01Session(secret))
    thunks.set([])
  })

  afterEach(async () => {
    thunkQueue.stop()
    thunkQueue.clear()
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    vi.clearAllMocks()
    thunks.set([])
    thunkQueue.start()
    dropSession(pubkey)
  })

  describe("MergedThunk", () => {
    it("settles all-skipped publications and never supplies a required ACK", async () => {
      const restore = setPublishPolicy({
        check: () => ({detail: "blocked: kind 32222 is not allowed"}),
        observeAck: vi.fn(),
      })
      try {
        const getAdapter = vi.fn()
        const thunk = new Thunk({
          ...mockRequest,
          event: makeEvent(32222),
          relays: [relay1],
          context: {getAdapter},
        })
        const onSkipped = vi.fn()
        thunk.subscribe(value => onSkipped(value.results[relay1]?.status))
        await thunk.publish()
        await thunk.complete
        expect(thunk.results[relay1].status).toBe(PublishStatus.Skipped)
        expect(onSkipped).toHaveBeenCalledWith(PublishStatus.Skipped)
        expect(getAdapter).not.toHaveBeenCalled()
        expect(getThunkError(thunk)).toBe("blocked: kind 32222 is not allowed")
        await expect(waitForAnyRelayAck(thunk)).rejects.toThrow("No target relay acknowledged")
        const merged = new MergedThunk([thunk])
        expect(merged.results[relay1].status).toBe(PublishStatus.Skipped)
      } finally {
        restore()
      }
    })

    it("preserves a successful destination when a skipped destination is retried", async () => {
      const restore = setPublishPolicy({
        check: relay =>
          relay === relay1 ? {detail: "blocked: kind 30222 is not allowed"} : undefined,
        observeAck: vi.fn(),
      })
      try {
        const thunk = new Thunk({...mockRequest, event: makeEvent(30222), relays: [relay1, relay2]})
        thunk.results[relay1] = {
          relay: relay1,
          status: PublishStatus.Skipped,
          detail: "kind unsupported",
        }
        thunk.results[relay2] = {relay: relay2, status: PublishStatus.Success, detail: "stored"}
        const retry = retryThunk(thunk, {failedOnly: true}) as Thunk
        await vi.runAllTimersAsync()
        expect(retry.results[relay1].status).toBe(PublishStatus.Skipped)
        expect(retry.results[relay2].status).toBe(PublishStatus.Success)
        expect(getThunkError(retry)).toBe("")
        await expect(waitForAnyRelayAck(retry, [relay1])).rejects.toThrow("skipped")
        await expect(waitForAnyRelayAck(retry, [relay2])).resolves.toMatchObject({
          status: PublishStatus.Success,
        })
      } finally {
        restore()
      }
    })

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
      const thunk = new Thunk({...mockRequest, relays: [relay1, relay2]})
      const ack = waitForAnyRelayAck(thunk, ["WSS://RELAY-1.EXAMPLE", relay2])
      const success = {
        relay: relay2,
        status: PublishStatus.Success,
        detail: "accepted",
      }

      thunk.results[relay1] = {
        relay: relay1,
        status: PublishStatus.Failure,
        detail: "denied",
      }
      thunk._notify()
      thunk.results[relay2] = success
      thunk._notify()

      await expect(ack).resolves.toBe(success)
      expect(thunk._subs).toHaveLength(0)
    })

    it("ignores success outside the explicit target relays", async () => {
      const thunk = new Thunk({...mockRequest, relays: [target, outside]})
      const ack = waitForAnyRelayAck(thunk, [target])
      const settled = vi.fn()

      void ack.then(settled, settled)
      thunk.results[outside] = {
        relay: outside,
        status: PublishStatus.Success,
        detail: "accepted",
      }
      thunk._notify()
      await Promise.resolve()

      expect(settled).not.toHaveBeenCalled()

      const success = {
        relay: target,
        status: PublishStatus.Success,
        detail: "accepted",
      }

      thunk.results[target] = success
      thunk._notify()

      await expect(ack).resolves.toBe(success)
    })

    it("rejects once all represented targets are terminal and details missing targets", async () => {
      const thunk = new Thunk({...mockRequest, relays: [relay1, relay2, outside]})
      const ack = waitForAnyRelayAck(thunk, [relay1, relay2, missing])
      const settled = vi.fn()

      void ack.then(settled, settled)
      thunk.results[relay1] = {
        relay: relay1,
        status: PublishStatus.Failure,
        detail: "denied",
      }
      thunk._notify()
      await Promise.resolve()

      expect(settled).not.toHaveBeenCalled()

      thunk.results[relay2] = {
        relay: relay2,
        status: PublishStatus.Timeout,
        detail: "timed out",
      }
      thunk._notify()

      await expect(ack).rejects.toThrow(
        `No target relay acknowledged publication (${relay1}: failure (denied); ${relay2}: timeout (timed out); ${missing}: no result)`,
      )
      expect(thunk._subs).toHaveLength(0)
    })

    it("rejects empty target relays", async () => {
      const thunk = new Thunk(mockRequest)

      await expect(waitForAnyRelayAck(thunk, [])).rejects.toThrow(
        "Cannot wait for a relay ACK without target relays",
      )
    })

    it("detaches an aborted ACK observer without aborting transport", async () => {
      const thunk = new Thunk({...mockRequest, relays: [relay1]})
      const controller = new AbortController()
      const ack = waitForAnyRelayAck(thunk, [relay1], {signal: controller.signal})

      expect(thunk._subs).toHaveLength(1)

      controller.abort()

      await expect(ack).rejects.toMatchObject({name: "AbortError"})
      expect(thunk._subs).toHaveLength(0)
      expect(thunk.controller.signal.aborted).toBe(false)
    })

    it("does not subscribe an already-aborted ACK observer", async () => {
      const thunk = new Thunk({...mockRequest, relays: [relay1]})
      const controller = new AbortController()
      controller.abort()

      await expect(
        waitForAnyRelayAck(thunk, [relay1], {signal: controller.signal}),
      ).rejects.toMatchObject({name: "AbortError"})
      expect(thunk._subs).toHaveLength(0)
      expect(thunk.controller.signal.aborted).toBe(false)
    })
  })

  describe("publishThunk", () => {
    it("preserves successful relay results when merging failed-only retries", () => {
      const thunk = new Thunk({...mockRequest, relays: [relay1, relay2]})
      thunk.results[relay1] = {relay: relay1, status: PublishStatus.Success, detail: "stored"}
      thunk.results[relay2] = {
        relay: relay2,
        status: PublishStatus.Failure,
        detail: "rate-limited: wait",
      }
      const retry = retryThunk(new MergedThunk([thunk]), {failedOnly: true}) as MergedThunk
      expect(retry.thunks[0].options.relays).toEqual([relay2])
      expect(retry.results[relay1].status).toBe(PublishStatus.Success)
      expect(retry.results[relay2].status).toBe(PublishStatus.Sending)
      abortThunk(retry)
    })
    it("retries only unsuccessful destinations while retaining prior acknowledgements", async () => {
      const event = await Nip01Signer.ephemeral().sign(makeEvent(NOTE))
      const thunk = new Thunk({event, relays: [relay1, relay2], optimistic: false})
      thunk.results[relay1] = {relay: relay1, status: PublishStatus.Success, detail: "stored"}
      thunk.results[relay2] = {
        relay: relay2,
        status: PublishStatus.Failure,
        detail: "error: relay policy is loading, retry shortly",
      }
      const retry = retryThunk(thunk, {failedOnly: true}) as Thunk
      expect(retry.event).toBe(event)
      expect(retry.options.relays).toEqual([relay2])
      expect(retry.results[relay1]).toEqual(thunk.results[relay1])
      expect(retry.results[relay1]).not.toBe(thunk.results[relay1])
      expect(retry.results[relay2].status).toBe(PublishStatus.Sending)
      abortThunk(retry)
    })

    it("canonicalizes destinations and preserves the signed event on retry", async () => {
      const event = await Nip01Signer.ephemeral().sign(
        makeEvent(NOTE, {tags: [["test", "canonical-retry"]]}),
      )
      const thunk = new Thunk({
        event,
        relays: ["WSS://RELAY-1.EXAMPLE", relay1, "wss://relay-2.example/Path"],
        optimistic: false,
      })

      expect(thunk.options.relays).toEqual([relay1, "wss://relay-2.example/Path"])
      expect(Object.keys(thunk.results)).toEqual(thunk.options.relays)
      expect(Object.values(thunk.results).map(result => result.relay)).toEqual(thunk.options.relays)

      const retry = retryThunk(thunk) as Thunk

      expect(retry.event).toBe(thunk.event)
      expect(retry.options.event).toBe(thunk.event)
      expect(retry.options.relays).toEqual(thunk.options.relays)
      abortThunk(retry)
    })

    it("reuses the exact NIP-59 wrapper on retry", async () => {
      const relay = "wss://wrapped-retry.example/"
      const send = vi.fn()
      const adapter = new MockAdapter(relay, send)
      const thunk = new Thunk({
        event: makeEvent(DIRECT_MESSAGE, {content: "private"}),
        recipient: pubkey,
        relays: [relay],
        optimistic: false,
        context: {getAdapter: () => adapter},
      })

      const initialPublish = thunk.publish()
      await vi.advanceTimersByTimeAsync(0)
      const initialWrapper = send.mock.calls[0][0][1]
      adapter.receive(["OK", initialWrapper.id, true, "accepted"])
      await initialPublish

      send.mockClear()
      const retry = retryThunk(thunk) as Thunk
      await vi.advanceTimersByTimeAsync(100)
      const retriedWrapper = send.mock.calls[0][0][1]

      expect(retriedWrapper).toBe(initialWrapper)
      expect(retry.wrap).toBe(initialWrapper)
      adapter.receive(["OK", retriedWrapper.id, true, "accepted"])
      await retry.complete
    })

    it("observes sanitized lifecycle results and retry correlation without event data", () => {
      const events: unknown[] = []
      const unsubscribeThrowing = subscribePublicationLifecycle(() => {
        throw new Error("observer failed")
      })
      const unsubscribe = subscribePublicationLifecycle(event => events.push(event))
      const thunk = new Thunk({
        event: makeEvent(NOTE, {
          content: "private publication content",
          tags: [["secret", "private tag"]],
        }),
        relays: ["WSS://Relay.Example/Path?token=private#fragment"],
        operationId: "operation-1",
        publicationStage: "primary",
      })

      expect(() =>
        thunk._setPending({
          relay: "wss://relay.example/Path?token=private",
          status: PublishStatus.Pending,
          detail: "private pending detail",
        }),
      ).not.toThrow()
      thunk._setFailure({
        relay: "wss://relay.example/Path?token=private",
        status: PublishStatus.Failure,
        detail: "private failure detail",
      })
      thunk._setTimeout({
        relay: "wss://relay.example/Path?token=private",
        status: PublishStatus.Timeout,
        detail: "private timeout detail",
      })
      thunk._setSuccess({
        relay: "wss://relay.example/Path?token=private",
        status: PublishStatus.Success,
        detail: "private success detail",
      })
      const retry = retryThunk(thunk) as Thunk

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "created",
          publicationId: thunk.diagnosticId,
          eventKind: NOTE,
          attempt: 1,
          destinations: ["wss://relay.example/Path"],
          operationId: "operation-1",
          publicationStage: "primary",
        }),
      )
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "retry",
          publicationId: retry.diagnosticId,
          previousPublicationId: thunk.diagnosticId,
          attempt: 2,
          operationId: "operation-1",
          publicationStage: "primary",
        }),
      )
      expect(
        events.filter((event: any) => event.type === "result").map((event: any) => event.status),
      ).toEqual([
        PublishStatus.Pending,
        PublishStatus.Failure,
        PublishStatus.Timeout,
        PublishStatus.Success,
      ])
      const serialized = JSON.stringify(events)
      expect(serialized).not.toContain("private")
      expect(serialized).not.toContain("content")
      expect(serialized).not.toContain("tags")
      expect(serialized).not.toContain("sig")

      unsubscribe()
      unsubscribeThrowing()
      abortThunk(retry)
    })

    it("should create and publish a thunk", async () => {
      const publishSpy = vi.spyOn(repository, "publish")
      const result = publishThunk(mockRequest)

      expect(publishSpy).toHaveBeenCalled()
      expect(result).toHaveProperty("event")
      expect(result).toHaveProperty("options")
      expect(get(thunks)).toContain(result)
    })

    it("publishes private thunks without exposing them through the global store", async () => {
      const relay = "wss://private-relay.example/"
      const send = vi.fn()
      const adapter = new MockAdapter(relay, send)
      const trackSpy = vi.spyOn(tracker, "track")
      const thunk = publishThunk({
        event: prep(makeEvent(NOTE, {tags: [["test", "private-presentation"]]}), pubkey),
        relays: [relay],
        optimistic: false,
        presentation: "private",
        context: {getAdapter: () => adapter},
      })
      const ack = waitForAnyRelayAck(thunk)

      expect(get(thunks)).not.toContain(thunk)

      await vi.advanceTimersByTimeAsync(100)
      expect(send).toHaveBeenCalledOnce()

      adapter.receive(["OK", thunk.event.id, true, "accepted"])

      await expect(ack).resolves.toMatchObject({relay, status: PublishStatus.Success})
      expect(trackSpy).toHaveBeenCalledWith(thunk.event.id, relay)
      expect(get(thunks)).not.toContain(thunk)
    })

    it("preserves private presentation when retrying", () => {
      const thunk = publishThunk({
        event: prep(makeEvent(NOTE, {tags: [["test", "private-retry"]]}), pubkey),
        relays: [LOCAL_RELAY_URL],
        optimistic: false,
        presentation: "private",
      })

      const retry = retryThunk(thunk)

      expect(retry.options.presentation).toBe("private")
      expect(get(thunks)).not.toContain(thunk)
      expect(get(thunks)).not.toContain(retry)
      abortThunk(thunk)
      abortThunk(retry)
    })

    it("does not insert or remove ordinary events when optimistic is false", async () => {
      const relay = "wss://optimistic-relay.example/"
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
      const relay = "wss://broken-relay.example/"
      const lifecycle: any[] = []
      const unsubscribe = subscribePublicationLifecycle(event => lifecycle.push(event))
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
      await thunk.complete

      expect(thunk.results[relay].status).toBe(PublishStatus.Failure)
      expect(lifecycle.filter(event => event.type === "completed")).toEqual([
        expect.objectContaining({terminalReason: "transport-exception"}),
      ])
      unsubscribe()
      consoleErrorSpy.mockRestore()
    })

    it("should handle abort", () => {
      const lifecycle: any[] = []
      const unsubscribe = subscribePublicationLifecycle(event => lifecycle.push(event))
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const thunk = publishThunk({
        ...mockRequest,
        event: makeEvent(NOTE, {tags: [["test", "publish-abort"]]}),
      })

      abortThunk(thunk)

      expect(removeEventSpy).toHaveBeenCalledWith(thunk.event.id)
      expect(lifecycle.filter(event => event.type === "completed")).toEqual([
        expect.objectContaining({terminalReason: "aborted"}),
      ])
      unsubscribe()
    })

    it("keeps a signing failure visible and replaces it on retry", async () => {
      const event = prep(makeEvent(NOTE, {tags: [["test", "signing-failure"]]}), pubkey)
      const removeEventSpy = vi.spyOn(repository, "removeEvent")
      const trackSpy = vi.spyOn(tracker, "track")
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const lifecycle: any[] = []
      const unsubscribe = subscribePublicationLifecycle(observation => lifecycle.push(observation))
      const thunk = publishThunk({event, relays: [LOCAL_RELAY_URL]})
      const optimisticEventId = thunk.event.id

      vi.spyOn(thunk.signer, "sign").mockRejectedValueOnce(new Error("signing failed"))
      const ack = expect(waitForAnyRelayAck(thunk)).rejects.toThrow("signing failed")
      expect(repository.getEvent(optimisticEventId)).toBe(thunk.event)
      expect(trackSpy).not.toHaveBeenCalled()

      await vi.runAllTimersAsync()
      await ack
      await thunk.complete

      expect(removeEventSpy).not.toHaveBeenCalled()
      expect(repository.getEvent(optimisticEventId)).toBe(thunk.event)
      expect(thunk.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Failure)
      expect(trackSpy).not.toHaveBeenCalled()
      expect(lifecycle.filter(item => item.publicationId === thunk.diagnosticId)).toContainEqual(
        expect.objectContaining({type: "completed", terminalReason: "signing-failure"}),
      )

      const retry = retryThunk(thunk)
      expect(thunk._optimisticEventId).toBeUndefined()
      expect(retry._optimisticEventId).toBe(optimisticEventId)

      await vi.runAllTimersAsync()

      expect(removeEventSpy).toHaveBeenCalledOnce()
      expect(removeEventSpy).toHaveBeenCalledWith(optimisticEventId)
      expect(repository.getEvent(optimisticEventId)).toBe(retry.event)
      expect(retry.event).toHaveProperty("sig")
      expect(retry.results[LOCAL_RELAY_URL].status).toEqual(PublishStatus.Success)
      unsubscribe()
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
    const relay = "wss://tracker-relay.example/"
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
