import {get} from "svelte/store"
import type {Thunk} from "@welshman/app"
import {LOCAL_RELAY_URL, type EventTemplate, type TrustedEvent} from "@welshman/util"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const trackerListeners = {
    add: new Set<(eventId: string, relay: string) => void>(),
    load: new Set<() => void>(),
  }

  return {
    activePubkey: "a".repeat(64),
    abortThunk: vi.fn(),
    publishThunk: vi.fn(),
    repositoryGetEvent: vi.fn(),
    repositoryPublish: vi.fn(),
    recordPublicationDiagnostic: vi.fn(),
    retryThunk: vi.fn(),
    trackerHasRelay: vi.fn(),
    trackerListeners,
    trackerOff: vi.fn(),
    trackerOn: vi.fn(),
    trackerRelays: new Map<string, Set<string>>(),
    waitForAnyRelayAck: vi.fn(),
  }
})

vi.mock("@welshman/app", () => ({
  abortThunk: mocks.abortThunk,
  pubkey: {get: () => mocks.activePubkey},
  publishThunk: mocks.publishThunk,
  repository: {getEvent: mocks.repositoryGetEvent, publish: mocks.repositoryPublish},
  retryThunk: mocks.retryThunk,
  tracker: {
    getRelays: (eventId: string) => mocks.trackerRelays.get(eventId) || new Set<string>(),
    hasRelay: mocks.trackerHasRelay,
    off: mocks.trackerOff,
    on: mocks.trackerOn,
  },
  waitForAnyRelayAck: mocks.waitForAnyRelayAck,
}))

vi.mock("@app/util/nip46", () => ({
  recoverActiveNip46Receiver: vi.fn(async () => true),
}))

vi.mock("@app/core/publication-diagnostics", () => ({
  recordPublicationOperationDiagnostic: mocks.recordPublicationDiagnostic,
}))

import {recoverActiveNip46Receiver} from "@app/util/nip46"
import {
  cancelPublication,
  clearPublicationOperations,
  discardPublication,
  isPublicationPreviewVisible,
  MAX_PUBLICATION_OPERATIONS,
  normalizePublicationRelays,
  PublicationCapacityError,
  publicationOperations,
  publicationOperationsNeedingAttention,
  recoverablePublicationOperations,
  retryPublication,
  startLinkedPublication,
  startPublication,
  type PublicationSnapshot,
} from "./publication-operations"

type TestThunk = {
  pubkey: string
  event: TrustedEvent
  options: {
    event: EventTemplate
    relays: string[]
    optimistic: boolean
    presentation?: "global" | "private"
  }
  results: Record<string, {relay: string; status: string; detail?: string}>
}

const owner = "a".repeat(64)
const otherOwner = "b".repeat(64)
const relayOne = "wss://relay-one.example/"
const relayTwo = "wss://relay-two.example/"
const acknowledgement = {
  relay: relayOne,
  status: "success" as const,
  detail: "accepted",
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {promise, resolve, reject}
}

const makeEvent = (marker: string): TrustedEvent =>
  ({
    id: marker.repeat(64),
    pubkey: owner,
    created_at: 1,
    kind: 1,
    tags: [],
    content: `publication-${marker}`,
    sig: marker.repeat(128),
  }) as TrustedEvent

const makeThunk = (options: {
  event: EventTemplate
  relays: string[]
  optimistic: boolean
}): TestThunk => ({
  pubkey: owner,
  event: options.event as TrustedEvent,
  options,
  results: Object.fromEntries(
    options.relays.map(relay => [relay, {relay, status: "sending", detail: "sending..."}]),
  ),
})

const makeOptions = (
  event: TrustedEvent,
  preview: "retain-on-failure" | "rollback-on-failure" | "none" = "retain-on-failure",
) => ({
  event,
  relays: [relayOne, relayTwo],
  label: "Publish event",
  preview,
})

const getOperation = (operationId: string) => get(publicationOperations).get(operationId)

const emitTrackerAdd = (eventId: string, relay: string) => {
  mocks.trackerRelays.set(eventId, new Set([...(mocks.trackerRelays.get(eventId) || []), relay]))
  for (const listener of mocks.trackerListeners.add) listener(eventId, relay)
}

const emitTrackerLoad = () => {
  for (const listener of mocks.trackerListeners.load) listener()
}

const makeIndexedEvent = (index: number): TrustedEvent => ({
  ...makeEvent("a"),
  id: index.toString(16).padStart(64, "0"),
  content: `publication-${index}`,
})

describe("single-event publication operations", () => {
  beforeEach(() => {
    mocks.activePubkey = owner
    mocks.abortThunk.mockReset()
    mocks.publishThunk.mockReset()
    mocks.repositoryGetEvent.mockReset().mockReturnValue(undefined)
    mocks.repositoryPublish.mockReset().mockReturnValue(true)
    mocks.recordPublicationDiagnostic.mockReset()
    mocks.retryThunk.mockReset()
    mocks.trackerHasRelay.mockReset().mockReturnValue(false)
    mocks.trackerOff.mockReset()
    mocks.trackerOn.mockReset()
    mocks.trackerRelays.clear()
    mocks.trackerListeners.add.clear()
    mocks.trackerListeners.load.clear()
    mocks.waitForAnyRelayAck.mockReset()
    vi.mocked(recoverActiveNip46Receiver).mockClear()

    mocks.trackerOn.mockImplementation(
      (
        event: "add" | "load",
        listener: ((eventId: string, relay: string) => void) | (() => void),
      ) => {
        if (event === "add") {
          mocks.trackerListeners.add.add(listener as (eventId: string, relay: string) => void)
        } else {
          mocks.trackerListeners.load.add(listener as () => void)
        }
      },
    )
    mocks.trackerOff.mockImplementation(
      (
        event: "add" | "load",
        listener: ((eventId: string, relay: string) => void) | (() => void),
      ) => {
        if (event === "add") {
          mocks.trackerListeners.add.delete(listener as (eventId: string, relay: string) => void)
        } else {
          mocks.trackerListeners.load.delete(listener as () => void)
        }
      },
    )

    mocks.publishThunk.mockImplementation(options => makeThunk(options))
    mocks.retryThunk.mockImplementation((thunk: TestThunk) =>
      makeThunk({
        ...thunk.options,
        event: thunk.event,
        optimistic: false,
      }),
    )
  })

  afterEach(() => {
    clearPublicationOperations()
  })

  it("keeps the event outside repository until a qualifying relay ACKs", async () => {
    const ack = deferred<typeof acknowledgement>()
    mocks.waitForAnyRelayAck.mockReturnValue(ack.promise)
    const event = makeEvent("c")

    const operation = startPublication(makeOptions(event))

    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      operationId: operation.operationId,
      optimistic: false,
      presentation: "private",
    })
    await vi.waitFor(() => expect(mocks.waitForAnyRelayAck).toHaveBeenCalledOnce())
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)).toMatchObject({
      operationId: operation.operationId,
      ownerPubkey: owner,
      event,
      phase: "publishing",
      preview: "retain-on-failure",
      attempt: 1,
    })

    ack.resolve(acknowledgement)
    await operation.settled

    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
    expect(getOperation(operation.operationId)?.phase).toBe("confirmed")
  })

  it("uses explicit confirmation relays without widening transport destinations", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue({...acknowledgement, relay: relayTwo})
    const event = makeEvent("d")

    const operation = startPublication({
      ...makeOptions(event),
      confirmRelays: [relayTwo],
    })
    await operation.settled

    const thunk = mocks.publishThunk.mock.results[0]?.value
    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      operationId: operation.operationId,
      optimistic: false,
      presentation: "private",
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledWith(
      thunk,
      [relayTwo],
      expect.objectContaining({signal: expect.anything()}),
    )
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
  })

  it("preserves a delayed publication without changing confirmation relays", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue(acknowledgement)
    const event = makeEvent("7")

    const operation = startPublication({...makeOptions(event), delay: 750})
    await operation.settled

    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne, relayTwo],
      operationId: operation.operationId,
      optimistic: false,
      presentation: "private",
      delay: 750,
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledWith(
      mocks.publishThunk.mock.results[0]?.value,
      [relayOne, relayTwo],
      expect.objectContaining({signal: expect.anything()}),
    )
  })

  it("rejects an empty confirmation set before starting publication", () => {
    expect(() =>
      startPublication({
        ...makeOptions(makeEvent("5")),
        confirmRelays: [],
      }),
    ).toThrow("Publication requires at least one confirmation relay")

    expect(mocks.publishThunk).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("rejects confirmation relays outside the normalized destination set", () => {
    expect(() =>
      startPublication({
        ...makeOptions(makeEvent("5")),
        relays: ["wss://relay-one.example"],
        confirmRelays: ["wss://relay-two.example"],
      }),
    ).toThrow("Confirmation relays must be publication destinations")

    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("normalizes relay identities before deduplication and confirmation checks", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue(acknowledgement)
    const event = makeEvent("9")
    const operation = startPublication({
      ...makeOptions(event),
      relays: ["wss://relay-one.example", relayOne],
      confirmRelays: ["wss://relay-one.example"],
    })

    await operation.settled

    expect(mocks.publishThunk).toHaveBeenCalledWith({
      event,
      relays: [relayOne],
      operationId: operation.operationId,
      optimistic: false,
      presentation: "private",
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledWith(
      mocks.publishThunk.mock.results[0]?.value,
      [relayOne],
      expect.objectContaining({signal: expect.anything()}),
    )
    expect(Object.keys(getOperation(operation.operationId)?.results || {})).toEqual([relayOne])
  })

  it("rejects malformed and local relays before creating a thunk", () => {
    expect(() =>
      startPublication({...makeOptions(makeEvent("b")), relays: ["https://relay.example"]}),
    ).toThrow("Invalid publication relay")
    expect(() =>
      startPublication({...makeOptions(makeEvent("b")), relays: [LOCAL_RELAY_URL]}),
    ).toThrow("Invalid publication relay")
    expect(() =>
      startPublication({
        ...makeOptions(makeEvent("b")),
        confirmRelays: ["not a relay"],
      }),
    ).toThrow("Invalid confirmation relay")

    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("normalizes standalone publication relay lists strictly", () => {
    expect(normalizePublicationRelays(["relay-one.example", relayOne])).toEqual([relayOne])
    expect(() => normalizePublicationRelays(["file:///tmp/relay"])).toThrow(
      "Invalid publication relay",
    )
  })

  it("retains an unconfirmed operation without committing it", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("No relay confirmed publication"))
    const event = makeEvent("e")

    const operation = startPublication(makeOptions(event))
    await operation.settled

    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)).toMatchObject({
      event,
      phase: "unconfirmed",
      preview: "retain-on-failure",
      error: "No relay confirmed publication",
    })
    expect(mocks.recordPublicationDiagnostic).toHaveBeenCalledWith(
      "operation-transition",
      expect.objectContaining({operationId: operation.operationId, phase: "unconfirmed"}),
      expect.objectContaining({previousPhase: "publishing"}),
    )
  })

  it("keeps failed publications in attention while retrying until they confirm", async () => {
    const firstAttempt = deferred<typeof acknowledgement>()
    const retryAttempt = deferred<typeof acknowledgement>()
    mocks.waitForAnyRelayAck
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(retryAttempt.promise)
    const operation = startPublication(makeOptions(makeEvent("0")))

    expect(get(recoverablePublicationOperations).map(item => item.operationId)).toEqual([
      operation.operationId,
    ])
    expect(get(publicationOperationsNeedingAttention)).toEqual([])

    firstAttempt.reject(new Error("relay rejected event"))
    await operation.settled

    expect(get(publicationOperationsNeedingAttention).map(item => item.operationId)).toEqual([
      operation.operationId,
    ])

    const retried = retryPublication(operation.operationId)
    await vi.waitFor(() =>
      expect(getOperation(operation.operationId)).toMatchObject({phase: "publishing", attempt: 2}),
    )
    expect(get(publicationOperationsNeedingAttention).map(item => item.operationId)).toEqual([
      operation.operationId,
    ])

    retryAttempt.resolve(acknowledgement)
    await retried

    expect(get(recoverablePublicationOperations)).toEqual([])
    expect(get(publicationOperationsNeedingAttention)).toEqual([])
  })

  it("uses one tracker observer and confirms from normalized late evidence", async () => {
    const waitSignals: AbortSignal[] = []
    mocks.waitForAnyRelayAck.mockImplementation(
      (_thunk: TestThunk, _relays: string[], {signal}: {signal: AbortSignal}) => {
        waitSignals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true})
        })
      },
    )
    const first = startPublication(makeOptions(makeEvent("b")))
    startPublication(makeOptions(makeEvent("c")))

    await vi.waitFor(() => expect(waitSignals).toHaveLength(2))
    expect(mocks.trackerListeners.add.size).toBe(1)
    expect(mocks.trackerListeners.load.size).toBe(1)

    emitTrackerAdd(makeEvent("b").id, "wss://relay-one.example")
    await Promise.resolve()

    await expect(first.settled).resolves.toMatchObject({phase: "confirmed"})
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(makeEvent("b"))
    expect(waitSignals[0].aborted).toBe(true)
    expect(waitSignals[1].aborted).toBe(false)
    expect(mocks.abortThunk).not.toHaveBeenCalled()
    expect(mocks.trackerListeners.add.size).toBe(1)
    expect(mocks.trackerListeners.load.size).toBe(1)
  })

  it("detaches the tracker observer when the final runtime is removed", () => {
    mocks.waitForAnyRelayAck.mockReturnValue(new Promise(() => {}))
    const operation = startPublication(makeOptions(makeEvent("b")))

    cancelPublication(operation.operationId)

    expect(mocks.trackerListeners.add.size).toBe(0)
    expect(mocks.trackerListeners.load.size).toBe(0)
    expect(mocks.trackerOff).toHaveBeenCalledTimes(2)
  })

  it("reconciles normalized tracker evidence loaded from storage", async () => {
    let waitSignal: AbortSignal | undefined
    mocks.waitForAnyRelayAck.mockImplementation(
      (_thunk: TestThunk, _relays: string[], {signal}: {signal: AbortSignal}) => {
        waitSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true})
        })
      },
    )
    const event = makeEvent("d")
    const operation = startPublication(makeOptions(event))
    await vi.waitFor(() => expect(waitSignal).toBeDefined())

    mocks.trackerRelays.set(event.id, new Set(["wss://relay-two.example"]))
    emitTrackerLoad()
    await Promise.resolve()

    await expect(operation.settled).resolves.toMatchObject({phase: "confirmed"})
    expect(waitSignal?.aborted).toBe(true)
    expect(mocks.abortThunk).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
  })

  it("cancels the ACK wait before it subscribes when tracker evidence is already loaded", async () => {
    let waitSignal: AbortSignal | undefined
    const event = makeEvent("e")
    mocks.trackerRelays.set(event.id, new Set([relayOne]))
    mocks.waitForAnyRelayAck.mockImplementation(
      (_thunk: TestThunk, _relays: string[], {signal}: {signal: AbortSignal}) => {
        waitSignal = signal
        return signal.aborted ? Promise.reject(signal.reason) : new Promise(() => {})
      },
    )

    const operation = startPublication(makeOptions(event))

    await expect(operation.settled).resolves.toMatchObject({phase: "confirmed"})
    expect(waitSignal?.aborted).toBe(true)
    expect(mocks.abortThunk).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
  })

  it("bounds active runtimes and restores capacity after cancellation", () => {
    mocks.waitForAnyRelayAck.mockReturnValue(new Promise(() => {}))
    const operations = Array.from({length: MAX_PUBLICATION_OPERATIONS}, (_, index) =>
      startPublication(makeOptions(makeIndexedEvent(index + 1))),
    )

    expect(mocks.trackerListeners.add.size).toBe(1)
    expect(mocks.trackerListeners.load.size).toBe(1)
    expect(() => startPublication(makeOptions(makeIndexedEvent(10_000)))).toThrow(
      PublicationCapacityError,
    )
    expect(mocks.publishThunk).toHaveBeenCalledTimes(MAX_PUBLICATION_OPERATIONS)

    cancelPublication(operations[0].operationId)
    expect(() => startPublication(makeOptions(makeIndexedEvent(10_001)))).not.toThrow()
  })

  it("retries the exact event in the same logical operation and commits after confirmation", async () => {
    mocks.waitForAnyRelayAck
      .mockRejectedValueOnce(new Error("relay rejected event"))
      .mockResolvedValueOnce(acknowledgement)
    const event = makeEvent("f")

    const operation = startPublication(makeOptions(event))
    await operation.settled
    const firstThunk = mocks.publishThunk.mock.results[0]?.value as TestThunk

    const retried = await retryPublication(operation.operationId)

    expect(mocks.retryThunk).toHaveBeenCalledOnce()
    expect(mocks.retryThunk).toHaveBeenCalledWith(firstThunk)
    const retryThunk = mocks.retryThunk.mock.results[0]?.value as TestThunk
    expect(retryThunk).not.toBe(firstThunk)
    expect(retryThunk.event).toBe(firstThunk.event)
    expect(retryThunk.options.presentation).toBe("private")
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(
      2,
      retryThunk,
      [relayOne, relayTwo],
      expect.objectContaining({signal: expect.anything()}),
    )
    expect(retried).toMatchObject({
      operationId: operation.operationId,
      attempt: 2,
      phase: "confirmed",
    })
    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(event)
    expect(mocks.recordPublicationDiagnostic).toHaveBeenCalledWith(
      "operation-transition",
      expect.objectContaining({operationId: operation.operationId, attempt: 2}),
      expect.objectContaining({previousAttempt: 1}),
    )
  })

  it("retries signing for the same prepared event after a signing failure", async () => {
    const preparedEvent = {...makeEvent("6"), sig: undefined} as TrustedEvent
    const signedEvent = {...preparedEvent, sig: "6".repeat(128)} as TrustedEvent
    const retryThunk = makeThunk({
      event: preparedEvent,
      relays: [relayOne, relayTwo],
      optimistic: false,
    })
    retryThunk.event = signedEvent
    mocks.retryThunk.mockReturnValueOnce(retryThunk)
    mocks.waitForAnyRelayAck
      .mockRejectedValueOnce(new Error("signing failed"))
      .mockResolvedValueOnce(acknowledgement)

    const operation = startPublication(makeOptions(preparedEvent))
    await operation.settled
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()

    await retryPublication(operation.operationId)

    const firstThunk = mocks.publishThunk.mock.results[0]?.value as TestThunk
    expect(mocks.retryThunk).toHaveBeenCalledWith(firstThunk)
    expect(firstThunk.event).toBe(preparedEvent)
    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(signedEvent)
  })

  it("blocks retry when the active account no longer owns the operation", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication(makeOptions(makeEvent("1")))
    await operation.settled
    mocks.activePubkey = otherOwner

    await expect(retryPublication(operation.operationId)).rejects.toThrow(
      "Restore the account that created this publication",
    )

    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)?.phase).toBe("unconfirmed")
  })

  it("validates freshness before retrying an unconfirmed operation", async () => {
    const validateRetry = vi.fn(() => {
      throw new Error("A newer version of this publication already exists")
    })
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication({...makeOptions(makeEvent("8")), validateRetry})
    await operation.settled

    await expect(retryPublication(operation.operationId)).rejects.toThrow(
      "A newer version of this publication already exists",
    )

    expect(validateRetry).toHaveBeenCalledWith(makeEvent("8"))
    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(getOperation(operation.operationId)?.phase).toBe("unconfirmed")
  })

  it("discards an unconfirmed operation without changing repository state", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValue(new Error("relay rejected event"))
    const operation = startPublication(makeOptions(makeEvent("2")))
    await operation.settled

    expect(get(publicationOperationsNeedingAttention)).toHaveLength(1)

    discardPublication(operation.operationId)

    expect(getOperation(operation.operationId)).toBeUndefined()
    expect(get(publicationOperationsNeedingAttention)).toEqual([])
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("cancels in-flight work without committing its preview", async () => {
    let waitSignal: AbortSignal | undefined
    mocks.waitForAnyRelayAck.mockImplementation(
      (_thunk: TestThunk, _relays: string[], {signal}: {signal: AbortSignal}) => {
        waitSignal = signal
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true})
        })
      },
    )
    const operation = startPublication(makeOptions(makeEvent("3")))
    const thunk = mocks.publishThunk.mock.results[0]?.value as unknown as Thunk
    await vi.waitFor(() => expect(waitSignal).toBeDefined())

    expect(get(recoverablePublicationOperations)).toHaveLength(1)
    expect(get(publicationOperationsNeedingAttention)).toEqual([])

    cancelPublication(operation.operationId)

    await expect(operation.settled).resolves.toMatchObject({phase: "cancelled"})
    expect(waitSignal?.aborted).toBe(true)
    expect(mocks.abortThunk).toHaveBeenCalledWith(thunk)
    expect(getOperation(operation.operationId)).toBeUndefined()
    expect(get(recoverablePublicationOperations)).toEqual([])
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
  })

  it("clears every ACK observer while aborting publishing transports", async () => {
    const waitSignals: AbortSignal[] = []
    mocks.waitForAnyRelayAck.mockImplementation(
      (_thunk: TestThunk, _relays: string[], {signal}: {signal: AbortSignal}) => {
        waitSignals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true})
        })
      },
    )
    const first = startPublication(makeOptions(makeEvent("b")))
    const second = startPublication(makeOptions(makeEvent("c")))
    await vi.waitFor(() => expect(waitSignals).toHaveLength(2))

    clearPublicationOperations()

    await expect(first.settled).resolves.toMatchObject({phase: "cancelled"})
    await expect(second.settled).resolves.toMatchObject({phase: "cancelled"})
    expect(waitSignals.every(signal => signal.aborted)).toBe(true)
    expect(mocks.abortThunk).toHaveBeenCalledTimes(2)
    expect(get(publicationOperations).size).toBe(0)
  })

  it("keeps presentation policy separate from publication and repository state", () => {
    const base = {
      operationId: "operation",
      ownerPubkey: owner,
      label: "Publish event",
      event: makeEvent("4"),
      attempt: 1,
      results: {},
    } satisfies Omit<PublicationSnapshot, "phase" | "preview">

    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "retain-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "unconfirmed",
        preview: "retain-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "rollback-on-failure",
      }),
    ).toBe(true)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "unconfirmed",
        preview: "rollback-on-failure",
      }),
    ).toBe(false)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "publishing",
        preview: "none",
      }),
    ).toBe(false)
    expect(
      isPublicationPreviewVisible({
        ...base,
        phase: "confirmed",
        preview: "retain-on-failure",
      }),
    ).toBe(false)
  })

  it("publishes and commits linked stages in order while retaining the primary preview", async () => {
    const primary = makeEvent("5")
    const target = makeEvent("6")
    const primaryAck = deferred<typeof acknowledgement>()
    const targetAck = deferred<typeof acknowledgement>()
    const targetEvent = vi.fn(() => target)
    mocks.publishThunk.mockImplementation(makeThunk)
    mocks.waitForAnyRelayAck
      .mockImplementationOnce(() => primaryAck.promise)
      .mockImplementationOnce(() => targetAck.promise)

    const operation = startLinkedPublication({
      ...makeOptions(primary),
      targetEvent,
    })

    expect(mocks.publishThunk).toHaveBeenCalledOnce()
    expect(getOperation(operation.operationId)).toMatchObject({
      event: primary,
      stage: "primary",
      phase: "publishing",
    })

    primaryAck.resolve(acknowledgement)
    await vi.waitFor(() => expect(mocks.publishThunk).toHaveBeenCalledTimes(2))

    const targetThunk = mocks.publishThunk.mock.results[1]?.value as TestThunk
    expect(targetEvent).toHaveBeenCalledWith(relayOne, primary)
    expect(targetThunk.options).toMatchObject({
      event: target,
      relays: [relayOne, relayTwo],
      optimistic: false,
      presentation: "private",
    })
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(
      2,
      targetThunk,
      [relayOne],
      expect.anything(),
    )
    expect(mocks.repositoryPublish).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenCalledWith(primary)
    expect(getOperation(operation.operationId)).toMatchObject({event: primary, stage: "target"})
    expect(mocks.recordPublicationDiagnostic).toHaveBeenCalledWith(
      "operation-transition",
      expect.objectContaining({operationId: operation.operationId, stage: "target"}),
      expect.objectContaining({previousStage: "primary"}),
    )

    targetAck.resolve(acknowledgement)
    await expect(operation.settled).resolves.toMatchObject({
      event: primary,
      stage: "target",
      phase: "confirmed",
    })
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(2, target)
  })

  it("retries only the failed linked target", async () => {
    const primary = makeEvent("7")
    const target = makeEvent("8")
    const targetEvent = vi.fn(() => target)
    mocks.publishThunk.mockImplementation(makeThunk)
    mocks.retryThunk.mockImplementation((thunk: TestThunk) => makeThunk(thunk.options))
    mocks.waitForAnyRelayAck
      .mockResolvedValueOnce(acknowledgement)
      .mockRejectedValueOnce(new Error("target relay rejected event"))
      .mockResolvedValueOnce(acknowledgement)

    const operation = startLinkedPublication({...makeOptions(primary), targetEvent})
    await expect(operation.settled).resolves.toMatchObject({
      event: primary,
      stage: "target",
      phase: "unconfirmed",
    })
    const originalTargetThunk = mocks.publishThunk.mock.results[1]?.value as TestThunk

    await expect(retryPublication(operation.operationId)).resolves.toMatchObject({
      event: primary,
      phase: "confirmed",
    })

    expect(targetEvent).toHaveBeenCalledOnce()
    expect(mocks.publishThunk).toHaveBeenCalledTimes(2)
    expect(mocks.retryThunk).toHaveBeenCalledOnce()
    expect(mocks.retryThunk).toHaveBeenCalledWith(originalTargetThunk)
    expect(recoverActiveNip46Receiver).toHaveBeenCalledOnce()
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(1, primary)
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(2, target)
  })

  it("recovers a target setup failure without republishing the primary", async () => {
    const primary = makeEvent("9")
    const target = makeEvent("a")
    const targetEvent = vi
      .fn<() => TrustedEvent>()
      .mockImplementationOnce(() => {
        throw new Error("target setup failed")
      })
      .mockReturnValueOnce(target)
    mocks.publishThunk.mockImplementation(makeThunk)
    mocks.waitForAnyRelayAck.mockResolvedValue(acknowledgement)

    const operation = startLinkedPublication({...makeOptions(primary), targetEvent})
    await expect(operation.settled).resolves.toMatchObject({
      event: primary,
      stage: "target",
      phase: "unconfirmed",
      error: "target setup failed",
    })

    await expect(retryPublication(operation.operationId)).resolves.toMatchObject({
      event: primary,
      phase: "confirmed",
    })

    expect(targetEvent).toHaveBeenCalledTimes(2)
    expect(mocks.publishThunk).toHaveBeenCalledTimes(2)
    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(1, primary)
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(2, target)
  })

  it("advances both linked stages from qualifying tracker evidence", async () => {
    const primary = makeEvent("c")
    const target = makeEvent("d")
    mocks.publishThunk.mockImplementation(makeThunk)
    mocks.waitForAnyRelayAck.mockReturnValue(new Promise(() => undefined))

    const operation = startLinkedPublication({
      ...makeOptions(primary),
      targetEvent: () => target,
    })

    emitTrackerAdd(primary.id, relayOne)
    await vi.waitFor(() => expect(mocks.publishThunk).toHaveBeenCalledTimes(2))
    emitTrackerAdd(target.id, relayOne)

    await expect(operation.settled).resolves.toMatchObject({
      event: primary,
      phase: "confirmed",
    })
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(1, primary)
    expect(mocks.repositoryPublish).toHaveBeenNthCalledWith(2, target)
  })
})
