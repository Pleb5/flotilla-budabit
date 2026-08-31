import {derived, writable, type Readable} from "svelte/store"
import {
  abortThunk,
  pubkey,
  publishThunk,
  repository,
  retryThunk,
  tracker,
  waitForAnyRelayAck,
} from "@welshman/app"
import {randomId} from "@welshman/lib"
import type {PublishResultsByRelay} from "@welshman/net"
import {
  LOCAL_RELAY_URL,
  isRelayUrl,
  isSignedEvent,
  normalizeRelayUrl,
  type EventTemplate,
  type HashedEvent,
  type TrustedEvent,
} from "@welshman/util"
import {recoverActiveNip46Receiver} from "@app/util/nip46"
import {recordPublicationOperationDiagnostic} from "@app/core/publication-diagnostics"

export type PublicationPreviewPolicy = "retain-on-failure" | "rollback-on-failure" | "none"

export type PublicationPhase = "publishing" | "confirmed" | "unconfirmed" | "cancelled"

export type StartPublicationOptions = {
  event: EventTemplate
  relays: string[]
  confirmRelays?: string[]
  delay?: number
  label: string
  href?: string
  semanticKey?: string
  preview: PublicationPreviewPolicy
  validateRetry?: (event: HashedEvent) => void | Promise<void>
}

export type StartLinkedPublicationOptions = Omit<
  StartPublicationOptions,
  "confirmRelays" | "delay" | "validateRetry"
> & {
  targetEvent: (primaryAckRelay: string, primaryEvent: HashedEvent) => EventTemplate
}

export type PublicationSnapshot = {
  readonly operationId: string
  readonly ownerPubkey: string
  readonly label: string
  readonly href?: string
  readonly semanticKey?: string
  readonly stage?: "primary" | "target"
  readonly event: HashedEvent
  readonly phase: PublicationPhase
  readonly preview: PublicationPreviewPolicy
  readonly attempt: number
  readonly results: PublishResultsByRelay
  readonly error?: string
}

export type PublicationHandle = {
  operationId: string
  settled: Promise<PublicationSnapshot>
}

type PublicationThunk = ReturnType<typeof publishThunk>

type PublicationRuntime = {
  snapshot: PublicationSnapshot
  thunk: PublicationThunk
  confirmRelays: string[]
  generation: number
  committed: boolean
  unsubscribeThunk?: () => void
  ackWaitController?: AbortController
  resolveAttempt?: (snapshot: PublicationSnapshot) => void
  retryPromise?: Promise<PublicationSnapshot>
  validateRetry?: (event: HashedEvent) => void | Promise<void>
}

type LinkedPublicationRuntime = {
  snapshot: PublicationSnapshot
  primaryThunk: PublicationThunk
  targetThunk?: PublicationThunk
  targetEvent: (primaryAckRelay: string, primaryEvent: HashedEvent) => EventTemplate
  relays: string[]
  stage: "primary" | "target"
  primaryAckRelay?: string
  generation: number
  primaryCommitted: boolean
  targetCommitted: boolean
  unsubscribeThunk?: () => void
  ackWaitController?: AbortController
  resolveAttempt?: (snapshot: PublicationSnapshot) => void
  retryPromise?: Promise<PublicationSnapshot>
}

const CONFIRMED_HANDOFF_MS = 5_000
export const MAX_PUBLICATION_OPERATIONS = 100
const operationStore = writable<Map<string, PublicationSnapshot>>(new Map())
const runtimes = new Map<string, PublicationRuntime>()
const linkedRuntimes = new Map<string, LinkedPublicationRuntime>()
const confirmedCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
let reservedAdmissions = 0
let trackerObserverAttached = false

export class PublicationCapacityError extends Error {
  readonly name = "PublicationCapacityError"
  readonly code = "PUBLICATION_CAPACITY_REACHED"

  constructor() {
    super(
      `Publication recovery is full (${MAX_PUBLICATION_OPERATIONS} items). Wait for a publication to finish, or cancel or discard an existing item in Publication recovery, then try again. This item was not sent.`,
    )
  }
}

export const publicationOperations: Readable<Map<string, PublicationSnapshot>> = {
  subscribe: operationStore.subscribe,
}

export const recoverablePublicationOperations = derived(publicationOperations, operations =>
  Array.from(operations.values()).filter(operation =>
    ["publishing", "unconfirmed"].includes(operation.phase),
  ),
)

export const publicationOperationsNeedingAttention = derived(
  recoverablePublicationOperations,
  operations =>
    operations.filter(operation => operation.phase === "unconfirmed" || operation.attempt > 1),
)

const copyResults = (results: PublishResultsByRelay): PublishResultsByRelay =>
  Object.fromEntries(
    Object.entries(results).map(([relay, result]) => [relay, {...result}]),
  ) as PublishResultsByRelay

const publishSnapshot = (snapshot: PublicationSnapshot) => {
  operationStore.update(operations => {
    const next = new Map(operations)
    next.set(snapshot.operationId, snapshot)
    return next
  })
}

const removeSnapshot = (operationId: string) => {
  operationStore.update(operations => {
    if (!operations.has(operationId)) return operations

    const next = new Map(operations)
    next.delete(operationId)
    return next
  })
}

const updateSnapshot = (
  runtime: {snapshot: PublicationSnapshot},
  patch: Partial<PublicationSnapshot>,
): PublicationSnapshot => {
  const previous = runtime.snapshot
  const snapshot = Object.freeze({
    ...runtime.snapshot,
    ...patch,
    results: copyResults(patch.results || runtime.snapshot.results),
  })

  runtime.snapshot = snapshot
  publishSnapshot(snapshot)
  if (
    snapshot.phase !== previous.phase ||
    snapshot.stage !== previous.stage ||
    snapshot.attempt !== previous.attempt
  ) {
    recordPublicationOperationDiagnostic("operation-transition", snapshot, {
      previousPhase: previous.phase,
      ...(previous.stage ? {previousStage: previous.stage} : {}),
      previousAttempt: previous.attempt,
    })
  }
  return snapshot
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error || "Publication was not confirmed by any relay")
}

const getRepositoryEvent = (eventId: string) => {
  if (typeof repository.getEvent !== "function") return undefined
  return repository.getEvent(eventId)
}

const settleAttempt = (runtime: PublicationRuntime, snapshot: PublicationSnapshot) => {
  const resolve = runtime.resolveAttempt
  runtime.resolveAttempt = undefined
  resolve?.(snapshot)
}

const stopThunkSubscription = (runtime: PublicationRuntime) => {
  runtime.unsubscribeThunk?.()
  runtime.unsubscribeThunk = undefined
}

const stopAckWait = (runtime: PublicationRuntime) => {
  const controller = runtime.ackWaitController
  runtime.ackWaitController = undefined
  controller?.abort()
}

const removeRuntime = (runtime: PublicationRuntime, removeOperationSnapshot = true) => {
  runtime.generation += 1
  stopThunkSubscription(runtime)
  stopAckWait(runtime)
  runtimes.delete(runtime.snapshot.operationId)
  if (removeOperationSnapshot) removeSnapshot(runtime.snapshot.operationId)
  syncTrackerObserver()
}

const scheduleConfirmedCleanup = (operationId: string) => {
  const existingTimer = confirmedCleanupTimers.get(operationId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    confirmedCleanupTimers.delete(operationId)
    removeSnapshot(operationId)
  }, CONFIRMED_HANDOFF_MS)
  confirmedCleanupTimers.set(operationId, timer)
}

const commitEvent = (runtime: PublicationRuntime, event: HashedEvent) => {
  if (runtime.committed) return

  runtime.committed = true
  if (!getRepositoryEvent(event.id)) repository.publish(event as TrustedEvent)
}

const confirmOperation = (
  runtime: PublicationRuntime,
  {generation, event}: {generation?: number; event?: HashedEvent} = {},
) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (generation !== undefined && runtime.generation !== generation) return
  if (!["publishing", "unconfirmed"].includes(runtime.snapshot.phase)) return

  const confirmedEvent = event || runtime.thunk.event
  commitEvent(runtime, confirmedEvent)
  stopThunkSubscription(runtime)

  const snapshot = updateSnapshot(runtime, {
    event: confirmedEvent,
    phase: "confirmed",
    results: runtime.thunk.results,
    error: undefined,
  })

  settleAttempt(runtime, snapshot)
  removeRuntime(runtime, false)
  scheduleConfirmedCleanup(snapshot.operationId)
}

const markUnconfirmed = (runtime: PublicationRuntime, generation: number, error: unknown) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (runtime.generation !== generation || runtime.snapshot.phase !== "publishing") return

  stopThunkSubscription(runtime)
  const snapshot = updateSnapshot(runtime, {
    event: runtime.thunk.event,
    phase: "unconfirmed",
    results: runtime.thunk.results,
    error: getErrorMessage(error),
  })

  settleAttempt(runtime, snapshot)
}

const normalizeTrackerRelay = (relay: string) => {
  if (relay === LOCAL_RELAY_URL || !isRelayUrl(relay)) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    return normalized !== LOCAL_RELAY_URL && isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const hasQualifyingTrackerEvidence = (runtime: PublicationRuntime, eventId: string) => {
  const seenRelays =
    typeof tracker.getRelays === "function" ? tracker.getRelays(eventId) : new Set<string>()
  const normalizedSeenRelays = new Set(
    Array.from(seenRelays, normalizeTrackerRelay).filter(Boolean),
  )
  return runtime.confirmRelays.some(
    relay => normalizedSeenRelays.has(relay) || tracker.hasRelay?.(eventId, relay),
  )
}

const reconcileTrackerEvidence = (
  runtime: PublicationRuntime,
  eventId = runtime.thunk.event.id,
  relay?: string,
) => {
  if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
  if (!["publishing", "unconfirmed"].includes(runtime.snapshot.phase)) return
  if (runtime.thunk.event.id !== eventId) return
  const normalizedRelay = relay ? normalizeTrackerRelay(relay) : ""
  if (relay && (!normalizedRelay || !runtime.confirmRelays.includes(normalizedRelay))) return
  if (!relay && !hasQualifyingTrackerEvidence(runtime, eventId)) return

  const repositoryEvent = getRepositoryEvent(eventId)
  const ownedEvent = runtime.thunk.event
  if (!repositoryEvent && !isSignedEvent(ownedEvent)) return

  confirmOperation(runtime, {event: repositoryEvent || ownedEvent})
}

const onTrackerAdd = (eventId: string, relay: string) => {
  const normalizedRelay = normalizeTrackerRelay(relay)
  if (!normalizedRelay) return

  queueMicrotask(() => {
    for (const runtime of runtimes.values()) {
      if (runtime.thunk.event.id !== eventId) continue
      reconcileTrackerEvidence(runtime, eventId, normalizedRelay)
    }
    for (const runtime of linkedRuntimes.values()) {
      if (getLinkedThunk(runtime)?.event.id !== eventId) continue
      reconcileLinkedTrackerEvidence(runtime, eventId, normalizedRelay)
    }
  })
}

const onTrackerLoad = () => {
  queueMicrotask(() => {
    for (const runtime of runtimes.values()) {
      reconcileTrackerEvidence(runtime)
    }
    for (const runtime of linkedRuntimes.values()) reconcileLinkedTrackerEvidence(runtime)
  })
}

function syncTrackerObserver() {
  const shouldAttach =
    (runtimes.size > 0 || linkedRuntimes.size > 0) && typeof tracker.on === "function"
  if (shouldAttach === trackerObserverAttached) return

  if (shouldAttach) {
    tracker.on("add", onTrackerAdd)
    tracker.on("load", onTrackerLoad)
    trackerObserverAttached = true
  } else if (trackerObserverAttached) {
    tracker.off?.("add", onTrackerAdd)
    tracker.off?.("load", onTrackerLoad)
    trackerObserverAttached = false
  }
}

const attachThunkSubscription = (runtime: PublicationRuntime, generation: number) => {
  stopThunkSubscription(runtime)
  if (typeof runtime.thunk.subscribe !== "function") return

  runtime.unsubscribeThunk = runtime.thunk.subscribe(thunk => {
    if (runtimes.get(runtime.snapshot.operationId) !== runtime) return
    if (runtime.generation !== generation) return

    updateSnapshot(runtime, {
      event: thunk.event,
      results: thunk.results,
    })
  })
}

const beginAttempt = (runtime: PublicationRuntime) => {
  const generation = runtime.generation
  stopAckWait(runtime)
  const ackWaitController = new AbortController()
  runtime.ackWaitController = ackWaitController
  const settled = new Promise<PublicationSnapshot>(resolve => {
    runtime.resolveAttempt = resolve
  })

  attachThunkSubscription(runtime, generation)
  syncTrackerObserver()

  if (hasQualifyingTrackerEvidence(runtime, runtime.thunk.event.id)) {
    queueMicrotask(() => reconcileTrackerEvidence(runtime))
  }

  void Promise.resolve()
    .then(() =>
      waitForAnyRelayAck(runtime.thunk, runtime.confirmRelays, {
        signal: ackWaitController.signal,
      }),
    )
    .then(
      () => confirmOperation(runtime, {generation}),
      error => {
        if (!ackWaitController.signal.aborted) markUnconfirmed(runtime, generation, error)
      },
    )
    .finally(() => {
      if (runtime.ackWaitController === ackWaitController) {
        runtime.ackWaitController = undefined
      }
    })

  return settled
}

export const normalizePublicationRelays = (relays: string[], label = "publication relay") => {
  const normalizedRelays: string[] = []

  for (const candidate of relays) {
    const relay = typeof candidate === "string" ? candidate.trim() : ""
    if (!relay || relay === LOCAL_RELAY_URL || !isRelayUrl(relay)) {
      throw new Error(`Invalid ${label}: ${String(candidate)}`)
    }

    let normalized: string
    try {
      normalized = normalizeRelayUrl(relay)
    } catch {
      throw new Error(`Invalid ${label}: ${candidate}`)
    }

    if (normalized === LOCAL_RELAY_URL || !isRelayUrl(normalized)) {
      throw new Error(`Invalid ${label}: ${candidate}`)
    }
    if (!normalizedRelays.includes(normalized)) normalizedRelays.push(normalized)
  }

  return normalizedRelays
}

const validateRelaySets = (relays: string[], confirmRelays: string[]) => {
  if (relays.length === 0) throw new Error("Publication requires at least one relay")
  if (confirmRelays.length === 0) {
    throw new Error("Publication requires at least one confirmation relay")
  }

  const destinations = new Set(relays)
  if (confirmRelays.some(relay => !destinations.has(relay))) {
    throw new Error("Confirmation relays must be publication destinations")
  }
}

const reserveAdmission = () => {
  if (runtimes.size + linkedRuntimes.size + reservedAdmissions >= MAX_PUBLICATION_OPERATIONS) {
    throw new PublicationCapacityError()
  }

  reservedAdmissions += 1
  let reserved = true

  return () => {
    if (!reserved) return
    reserved = false
    reservedAdmissions -= 1
  }
}

export const startPublication = (options: StartPublicationOptions): PublicationHandle => {
  const relays = normalizePublicationRelays(options.relays)
  const confirmRelays =
    options.confirmRelays === undefined
      ? [...relays]
      : normalizePublicationRelays(options.confirmRelays, "confirmation relay")
  validateRelaySets(relays, confirmRelays)
  const releaseAdmission = reserveAdmission()
  let thunk: PublicationThunk | undefined
  let runtime: PublicationRuntime | undefined

  try {
    const operationId = randomId()
    thunk = publishThunk({
      event: options.event,
      relays,
      operationId,
      optimistic: false,
      presentation: "private",
      ...(options.delay ? {delay: options.delay} : {}),
    })
    const snapshot: PublicationSnapshot = Object.freeze({
      operationId,
      ownerPubkey: thunk.pubkey,
      label: options.label,
      href: options.href,
      semanticKey: options.semanticKey,
      event: thunk.event,
      phase: "publishing",
      preview: options.preview,
      attempt: 1,
      results: copyResults(thunk.results),
    })
    runtime = {
      snapshot,
      thunk,
      confirmRelays,
      generation: 1,
      committed: false,
      validateRetry: options.validateRetry,
    }

    runtimes.set(operationId, runtime)
    releaseAdmission()
    publishSnapshot(snapshot)
    recordPublicationOperationDiagnostic("operation-created", snapshot)

    return {
      operationId,
      settled: beginAttempt(runtime),
    }
  } catch (error) {
    if (runtime && runtimes.get(runtime.snapshot.operationId) === runtime) {
      removeRuntime(runtime)
    }
    if (thunk) abortThunk(thunk)
    throw error
  } finally {
    releaseAdmission()
  }
}

const getLinkedThunk = (runtime: LinkedPublicationRuntime) =>
  runtime.stage === "primary" ? runtime.primaryThunk : runtime.targetThunk

const createLinkedTargetThunk = (runtime: LinkedPublicationRuntime) => {
  if (!runtime.primaryAckRelay) throw new Error("Primary publication relay is unavailable")
  if (pubkey.get() !== runtime.snapshot.ownerPubkey) {
    throw new Error("Restore the account that published the original before linking it")
  }

  const targetThunk = publishThunk({
    event: runtime.targetEvent(runtime.primaryAckRelay, runtime.primaryThunk.event),
    relays: runtime.relays,
    operationId: runtime.snapshot.operationId,
    publicationStage: "target",
    optimistic: false,
    presentation: "private",
  })
  if (targetThunk.pubkey !== runtime.snapshot.ownerPubkey) {
    abortThunk(targetThunk)
    throw new Error("Linked publication stages must use the same publishing account")
  }

  runtime.targetThunk = targetThunk
  return targetThunk
}

const stopLinkedThunkSubscription = (runtime: LinkedPublicationRuntime) => {
  runtime.unsubscribeThunk?.()
  runtime.unsubscribeThunk = undefined
}

const stopLinkedAckWait = (runtime: LinkedPublicationRuntime) => {
  const controller = runtime.ackWaitController
  runtime.ackWaitController = undefined
  controller?.abort()
}

const removeLinkedRuntime = (runtime: LinkedPublicationRuntime, removeOperationSnapshot = true) => {
  runtime.generation += 1
  stopLinkedThunkSubscription(runtime)
  stopLinkedAckWait(runtime)
  linkedRuntimes.delete(runtime.snapshot.operationId)
  if (removeOperationSnapshot) removeSnapshot(runtime.snapshot.operationId)
  syncTrackerObserver()
}

const settleLinkedAttempt = (runtime: LinkedPublicationRuntime, snapshot: PublicationSnapshot) => {
  const resolve = runtime.resolveAttempt
  runtime.resolveAttempt = undefined
  resolve?.(snapshot)
}

const markLinkedUnconfirmed = (
  runtime: LinkedPublicationRuntime,
  generation: number,
  error: unknown,
) => {
  if (linkedRuntimes.get(runtime.snapshot.operationId) !== runtime) return
  if (runtime.generation !== generation || runtime.snapshot.phase !== "publishing") return

  stopLinkedThunkSubscription(runtime)
  const snapshot = updateSnapshot(runtime, {
    phase: "unconfirmed",
    error: getErrorMessage(error),
  })
  settleLinkedAttempt(runtime, snapshot)
}

const commitLinkedEvent = (event: HashedEvent) => {
  if (!getRepositoryEvent(event.id)) repository.publish(event as TrustedEvent)
}

const confirmLinkedOperation = (runtime: LinkedPublicationRuntime, generation: number) => {
  if (linkedRuntimes.get(runtime.snapshot.operationId) !== runtime) return
  if (runtime.generation !== generation || runtime.snapshot.phase !== "publishing") return

  const targetThunk = runtime.targetThunk
  if (!targetThunk) return
  if (!runtime.targetCommitted) {
    runtime.targetCommitted = true
    commitLinkedEvent(targetThunk.event)
  }

  stopLinkedThunkSubscription(runtime)
  const snapshot = updateSnapshot(runtime, {
    phase: "confirmed",
    event: runtime.primaryThunk.event,
    results: targetThunk.results,
    error: undefined,
  })
  settleLinkedAttempt(runtime, snapshot)
  removeLinkedRuntime(runtime, false)
  scheduleConfirmedCleanup(snapshot.operationId)
}

const advanceLinkedStage = (
  runtime: LinkedPublicationRuntime,
  generation: number,
  acknowledgementRelay: string,
) => {
  if (linkedRuntimes.get(runtime.snapshot.operationId) !== runtime) return
  if (runtime.generation !== generation || runtime.snapshot.phase !== "publishing") return

  if (runtime.stage === "target") {
    confirmLinkedOperation(runtime, generation)
    return
  }

  if (!runtime.primaryCommitted) {
    runtime.primaryCommitted = true
    commitLinkedEvent(runtime.primaryThunk.event)
  }
  runtime.primaryAckRelay = acknowledgementRelay
  stopLinkedThunkSubscription(runtime)
  runtime.stage = "target"
  runtime.generation += 1
  updateSnapshot(runtime, {stage: "target", event: runtime.primaryThunk.event})
  let targetThunk: PublicationThunk
  try {
    targetThunk = createLinkedTargetThunk(runtime)
  } catch (error) {
    markLinkedUnconfirmed(runtime, runtime.generation, error)
    return
  }
  updateSnapshot(runtime, {
    results: targetThunk.results,
  })
  beginLinkedStage(runtime)
}

function reconcileLinkedTrackerEvidence(
  runtime: LinkedPublicationRuntime,
  eventId = getLinkedThunk(runtime)?.event.id,
  relay?: string,
) {
  const thunk = getLinkedThunk(runtime)
  if (!thunk || !eventId || thunk.event.id !== eventId) return
  if (linkedRuntimes.get(runtime.snapshot.operationId) !== runtime) return
  if (!["publishing", "unconfirmed"].includes(runtime.snapshot.phase)) return

  const allowedRelays =
    runtime.stage === "primary"
      ? runtime.relays
      : runtime.primaryAckRelay
        ? [runtime.primaryAckRelay]
        : []
  const candidateRelays = relay
    ? [normalizeTrackerRelay(relay)]
    : Array.from(tracker.getRelays(eventId))
  const acknowledgementRelay = candidateRelays
    .map(normalizeTrackerRelay)
    .find(candidate => candidate && allowedRelays.includes(candidate))
  if (!acknowledgementRelay) return

  const repositoryEvent = getRepositoryEvent(eventId)
  if (!repositoryEvent && !isSignedEvent(thunk.event)) return
  if (runtime.snapshot.phase === "unconfirmed") {
    updateSnapshot(runtime, {phase: "publishing", error: undefined})
  }
  advanceLinkedStage(runtime, runtime.generation, acknowledgementRelay)
}

const beginLinkedStage = (runtime: LinkedPublicationRuntime) => {
  const generation = runtime.generation
  const thunk = getLinkedThunk(runtime)
  if (!thunk) {
    markLinkedUnconfirmed(
      runtime,
      generation,
      new Error("Linked publication target is unavailable"),
    )
    return
  }

  stopLinkedAckWait(runtime)
  stopLinkedThunkSubscription(runtime)
  const ackWaitController = new AbortController()
  runtime.ackWaitController = ackWaitController

  if (typeof thunk.subscribe === "function") {
    runtime.unsubscribeThunk = thunk.subscribe(current => {
      if (linkedRuntimes.get(runtime.snapshot.operationId) !== runtime) return
      if (runtime.generation !== generation) return

      updateSnapshot(runtime, {
        ...(runtime.stage === "primary" ? {event: current.event} : {}),
        results: current.results,
      })
    })
  }

  const confirmRelays = runtime.stage === "primary" ? runtime.relays : [runtime.primaryAckRelay!]
  void waitForAnyRelayAck(thunk, confirmRelays, {signal: ackWaitController.signal})
    .then(acknowledgement => {
      advanceLinkedStage(runtime, generation, acknowledgement.relay)
    })
    .catch(error => {
      if (!ackWaitController.signal.aborted) markLinkedUnconfirmed(runtime, generation, error)
    })
    .finally(() => {
      if (runtime.ackWaitController === ackWaitController) {
        runtime.ackWaitController = undefined
      }
    })
}

const beginLinkedAttempt = (runtime: LinkedPublicationRuntime) => {
  const settled = new Promise<PublicationSnapshot>(resolve => {
    runtime.resolveAttempt = resolve
  })
  beginLinkedStage(runtime)
  return settled
}

export const startLinkedPublication = (
  options: StartLinkedPublicationOptions,
): PublicationHandle => {
  const relays = normalizePublicationRelays(options.relays)
  validateRelaySets(relays, relays)
  const releaseAdmission = reserveAdmission()
  let primaryThunk: PublicationThunk | undefined
  let runtime: LinkedPublicationRuntime | undefined

  try {
    const operationId = randomId()
    primaryThunk = publishThunk({
      event: options.event,
      relays,
      operationId,
      publicationStage: "primary",
      optimistic: false,
      presentation: "private",
    })
    const snapshot: PublicationSnapshot = Object.freeze({
      operationId,
      ownerPubkey: primaryThunk.pubkey,
      label: options.label,
      href: options.href,
      semanticKey: options.semanticKey,
      stage: "primary",
      event: primaryThunk.event,
      phase: "publishing",
      preview: options.preview,
      attempt: 1,
      results: copyResults(primaryThunk.results),
    })
    runtime = {
      snapshot,
      primaryThunk,
      targetEvent: options.targetEvent,
      relays,
      stage: "primary",
      generation: 1,
      primaryCommitted: false,
      targetCommitted: false,
    }

    linkedRuntimes.set(operationId, runtime)
    releaseAdmission()
    publishSnapshot(snapshot)
    recordPublicationOperationDiagnostic("linked-operation-created", snapshot)
    syncTrackerObserver()

    return {operationId, settled: beginLinkedAttempt(runtime)}
  } catch (error) {
    if (runtime && linkedRuntimes.get(runtime.snapshot.operationId) === runtime) {
      removeLinkedRuntime(runtime)
    }
    if (primaryThunk) abortThunk(primaryThunk)
    throw error
  } finally {
    releaseAdmission()
  }
}

const requireOwnedOperation = (operationId: string) => {
  const runtime = runtimes.get(operationId)
  if (!runtime) throw new Error("Publication operation is no longer available")
  if (runtime.snapshot.phase !== "unconfirmed") {
    throw new Error("Only unconfirmed publications can be retried")
  }
  if (pubkey.get() !== runtime.snapshot.ownerPubkey) {
    throw new Error("Restore the account that created this publication")
  }
  return runtime
}

const requireOwnedLinkedOperation = (operationId: string) => {
  const runtime = linkedRuntimes.get(operationId)
  if (!runtime) throw new Error("Publication operation is no longer available")
  if (runtime.snapshot.phase !== "unconfirmed") {
    throw new Error("Only unconfirmed publications can be retried")
  }
  if (pubkey.get() !== runtime.snapshot.ownerPubkey) {
    throw new Error("Restore the account that created this publication")
  }
  return runtime
}

const retryLinkedPublication = (operationId: string): Promise<PublicationSnapshot> => {
  let runtime: LinkedPublicationRuntime
  try {
    runtime = requireOwnedLinkedOperation(operationId)
  } catch (error) {
    return Promise.reject(error)
  }

  if (runtime.retryPromise) return runtime.retryPromise

  const generation = runtime.generation
  const thunk = getLinkedThunk(runtime)

  const retryPromise = (async () => {
    await recoverActiveNip46Receiver().catch(() => false)

    const current = requireOwnedLinkedOperation(operationId)
    if (
      current !== runtime ||
      runtime.generation !== generation ||
      getLinkedThunk(runtime) !== thunk
    ) {
      throw new Error("Publication operation changed before retry")
    }

    const retriedThunk = thunk
      ? (retryThunk(thunk) as PublicationThunk)
      : createLinkedTargetThunk(runtime)
    stopLinkedThunkSubscription(runtime)
    if (runtime.stage === "primary") runtime.primaryThunk = retriedThunk
    else runtime.targetThunk = retriedThunk
    runtime.generation += 1

    updateSnapshot(runtime, {
      event: runtime.primaryThunk.event,
      phase: "publishing",
      attempt: runtime.snapshot.attempt + 1,
      results: retriedThunk.results,
      error: undefined,
    })

    return beginLinkedAttempt(runtime)
  })().finally(() => {
    if (runtime.retryPromise === retryPromise) runtime.retryPromise = undefined
  })

  runtime.retryPromise = retryPromise
  return retryPromise
}

export const retryPublication = (operationId: string): Promise<PublicationSnapshot> => {
  if (linkedRuntimes.has(operationId)) return retryLinkedPublication(operationId)

  let runtime: PublicationRuntime
  try {
    runtime = requireOwnedOperation(operationId)
  } catch (error) {
    return Promise.reject(error)
  }

  if (runtime.retryPromise) return runtime.retryPromise

  const generation = runtime.generation
  const thunk = runtime.thunk
  const retryPromise = (async () => {
    await recoverActiveNip46Receiver().catch(() => false)

    const current = requireOwnedOperation(operationId)
    if (current !== runtime || runtime.generation !== generation || runtime.thunk !== thunk) {
      throw new Error("Publication operation changed before retry")
    }

    await runtime.validateRetry?.(runtime.thunk.event)

    const validated = requireOwnedOperation(operationId)
    if (validated !== runtime || runtime.generation !== generation || runtime.thunk !== thunk) {
      throw new Error("Publication operation changed before retry")
    }

    const retriedThunk = retryThunk(thunk) as PublicationThunk
    stopThunkSubscription(runtime)
    runtime.thunk = retriedThunk
    runtime.generation += 1

    updateSnapshot(runtime, {
      event: retriedThunk.event,
      phase: "publishing",
      attempt: runtime.snapshot.attempt + 1,
      results: retriedThunk.results,
      error: undefined,
    })

    return beginAttempt(runtime)
  })().finally(() => {
    if (runtime.retryPromise === retryPromise) runtime.retryPromise = undefined
  })

  runtime.retryPromise = retryPromise
  return retryPromise
}

export const cancelPublication = (operationId: string) => {
  const linkedRuntime = linkedRuntimes.get(operationId)
  if (linkedRuntime) {
    if (linkedRuntime.snapshot.phase !== "publishing") return
    const cancelled = Object.freeze({...linkedRuntime.snapshot, phase: "cancelled" as const})
    recordPublicationOperationDiagnostic("operation-cancelled", cancelled)
    const resolve = linkedRuntime.resolveAttempt
    linkedRuntime.resolveAttempt = undefined
    const thunk = getLinkedThunk(linkedRuntime)
    removeLinkedRuntime(linkedRuntime)
    if (thunk) abortThunk(thunk)
    resolve?.(cancelled)
    return
  }

  const runtime = runtimes.get(operationId)
  if (!runtime || runtime.snapshot.phase !== "publishing") return

  const cancelled = Object.freeze({...runtime.snapshot, phase: "cancelled" as const})
  recordPublicationOperationDiagnostic("operation-cancelled", cancelled)
  const resolve = runtime.resolveAttempt
  runtime.resolveAttempt = undefined
  removeRuntime(runtime)
  abortThunk(runtime.thunk)
  resolve?.(cancelled)
}

export const discardPublication = (operationId: string) => {
  const linkedRuntime = linkedRuntimes.get(operationId)
  if (linkedRuntime) {
    if (linkedRuntime.snapshot.phase !== "unconfirmed") return
    removeLinkedRuntime(linkedRuntime)
    return
  }

  const runtime = runtimes.get(operationId)
  if (!runtime || runtime.snapshot.phase !== "unconfirmed") return
  removeRuntime(runtime)
}

export const clearPublicationOperations = () => {
  for (const runtime of Array.from(runtimes.values())) {
    const wasPublishing = runtime.snapshot.phase === "publishing"
    const cancelled = Object.freeze({...runtime.snapshot, phase: "cancelled" as const})
    const resolve = runtime.resolveAttempt
    runtime.resolveAttempt = undefined
    removeRuntime(runtime)
    if (wasPublishing) abortThunk(runtime.thunk)
    resolve?.(cancelled)
  }

  for (const runtime of Array.from(linkedRuntimes.values())) {
    const wasPublishing = runtime.snapshot.phase === "publishing"
    const cancelled = Object.freeze({...runtime.snapshot, phase: "cancelled" as const})
    const resolve = runtime.resolveAttempt
    runtime.resolveAttempt = undefined
    const thunk = getLinkedThunk(runtime)
    removeLinkedRuntime(runtime)
    if (wasPublishing && thunk) abortThunk(thunk)
    resolve?.(cancelled)
  }

  for (const timer of confirmedCleanupTimers.values()) clearTimeout(timer)
  confirmedCleanupTimers.clear()
  syncTrackerObserver()

  operationStore.set(new Map())
}

export const isPublicationPreviewVisible = (operation: PublicationSnapshot) => {
  if (operation.phase === "publishing") return operation.preview !== "none"
  if (operation.phase === "unconfirmed") return operation.preview === "retain-on-failure"
  return false
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (trackerObserverAttached) {
      tracker.off?.("add", onTrackerAdd)
      tracker.off?.("load", onTrackerLoad)
      trackerObserverAttached = false
    }
  })
}
