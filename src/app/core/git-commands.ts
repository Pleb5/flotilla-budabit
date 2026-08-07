import type {
  CommentEvent,
  IssueEvent,
  RepoAnnouncementEvent,
  StatusEvent,
  RepoStateEvent,
  UserGraspListEvent,
} from "@nostr-git/core/events"
import {buildRoleLabelEvent} from "@app/util/labels"
import {
  abortThunk,
  publishThunk,
  pubkey,
  repository,
  retryThunk,
  signer,
  waitForAnyRelayAck,
} from "@welshman/app"
import {load, Pool, publish, PublishStatus, SocketEvent} from "@welshman/net"
import {GIT_RELAYS, getRepoAnnouncementPublishRelays} from "./git-state"
import {Router} from "@welshman/router"
import {publishDelete} from "@app/core/commands"
import {getUserDataPublishRelays} from "@app/core/community-relays"
import {
  canTraceRepoPublishTransport,
  logPublishRelaySummary,
  logRepoPublishTransport,
} from "@app/core/diagnostics"
import {
  COMMENT,
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  isRelayUrl,
  isSignedEvent,
  normalizeRelayUrl,
  prep,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE} from "@nostr-git/core/events"
import type {Event as NostrEvent} from "nostr-tools"
import {getDeclaredRepoRelays, requireRepoPublicationScope} from "@app/core/repo-publication"
import {signEventForPublication} from "@app/core/publication"

export const GRASP_RELAY_ACK_TIMEOUT_MS = 30_000

const repoPublishAttemptCounts = new Map<string, number>()
const repoPublishSocketIds = new WeakMap<object, number>()
const repoPublishWebSocketGenerations = new WeakMap<object, number>()
let nextRepoPublishSocketId = 1
let nextRepoPublishWebSocketGeneration = 1

type NativeRepoPublishAck = {relay: string; ok: boolean; detail: string}

export const parseNativeRepoPublishAck = (
  relay: string,
  eventId: string,
  message: unknown,
): NativeRepoPublishAck | undefined => {
  if (!Array.isArray(message) || message[0] !== "OK" || message[1] !== eventId) return
  const detail = String(message[3] || "")
  if (message[2] === false && detail.toLowerCase().startsWith("auth-required:")) return
  return {relay, ok: message[2] === true, detail}
}

const observeNativeRepoPublishAck = (pool: Pool, relay: string, eventId: string) => {
  let ack: NativeRepoPublishAck | undefined
  let socket: any
  const listeners: Array<{ws: WebSocket; listener: EventListener}> = []
  const attached = new WeakSet<object>()

  const attach = () => {
    const ws = socket?._ws as WebSocket | undefined
    if (!ws || attached.has(ws)) return
    attached.add(ws)
    const listener: EventListener = event => {
      try {
        const message = JSON.parse(String((event as MessageEvent).data || ""))
        ack = parseNativeRepoPublishAck(relay, eventId, message) || ack
      } catch {
        // Ignore malformed relay messages; Welshman will report its own outcome.
      }
    }
    ws.addEventListener("message", listener)
    listeners.push({ws, listener})
  }
  const onStatus = () => attach()

  try {
    socket = pool.get(relay) as any
    socket.on(SocketEvent.Status, onStatus)
    attach()
  } catch {
    // Native observation is a fallback; the normal publish result remains authoritative.
  }

  return {
    getAck: () => ack,
    stop: () => {
      try {
        socket?.off(SocketEvent.Status, onStatus)
      } catch {
        // pass
      }
      for (const {ws, listener} of listeners) ws.removeEventListener("message", listener)
    },
  }
}

export const applyNativeRepoPublishAcks = <
  T extends {relay: string; status: string; detail?: string},
>(
  results: Record<string, T>,
  nativeAcks: NativeRepoPublishAck[],
): Record<string, T> => {
  const next = {...results}
  for (const ack of nativeAcks) {
    const entry = Object.entries(next).find(
      ([, result]) => normalizeRelayUrl(result.relay) === normalizeRelayUrl(ack.relay),
    )
    const key = entry?.[0] || ack.relay
    const current = entry?.[1]
    if (current && current.status !== PublishStatus.Timeout) continue
    next[key] = {
      ...(current || ({relay: ack.relay} as T)),
      relay: current?.relay || ack.relay,
      status: ack.ok ? PublishStatus.Success : PublishStatus.Failure,
      detail: ack.detail,
    }
  }
  return next
}

const startRepoPublishTransportTrace = (pool: Pool, relay: string, eventId: string) => {
  if (!canTraceRepoPublishTransport()) return () => undefined

  const socket = pool.get(relay) as any
  let socketId = repoPublishSocketIds.get(socket)
  if (!socketId) {
    socketId = nextRepoPublishSocketId++
    repoPublishSocketIds.set(socket, socketId)
  }
  const attemptKey = `${normalizeRelayUrl(relay)}:${eventId}`
  const attempt = (repoPublishAttemptCounts.get(attemptKey) || 0) + 1
  repoPublishAttemptCounts.set(attemptKey, attempt)
  const startedAt = performance.now()
  const nativeListeners: Array<{ws: WebSocket; type: string; listener: EventListener}> = []
  const attachedWebSockets = new WeakSet<object>()

  const snapshot = () => {
    const ws = socket._ws as WebSocket | undefined
    let generation: number | undefined
    if (ws) {
      generation = repoPublishWebSocketGenerations.get(ws)
      if (!generation) {
        generation = nextRepoPublishWebSocketGeneration++
        repoPublishWebSocketGenerations.set(ws, generation)
      }
    }
    return {
      socketId,
      generation,
      socketStatus: socket.status,
      readyState: ws?.readyState,
      elapsedMs: Math.round(performance.now() - startedAt),
    }
  }
  const trace = (phase: string, extra: Record<string, unknown> = {}) =>
    logRepoPublishTransport({relay, eventId, attempt, phase, ...snapshot(), ...extra})
  const attachNativeListeners = () => {
    const ws = socket._ws as WebSocket | undefined
    if (!ws || attachedWebSockets.has(ws)) return
    attachedWebSockets.add(ws)
    let nativeGeneration = repoPublishWebSocketGenerations.get(ws)
    if (!nativeGeneration) {
      nativeGeneration = nextRepoPublishWebSocketGeneration++
      repoPublishWebSocketGenerations.set(ws, nativeGeneration)
    }

    const onError: EventListener = () => trace("native-error", {nativeGeneration})
    const onClose: EventListener = event => {
      const close = event as CloseEvent
      trace("native-close", {
        nativeGeneration,
        code: close.code,
        reason: close.reason,
        wasClean: close.wasClean,
      })
    }
    const onMessage: EventListener = event => {
      try {
        const message = JSON.parse(String((event as MessageEvent).data || ""))
        if (shouldTraceRelayMessage(message)) {
          trace("native-message", {
            nativeGeneration,
            messageType: message[0],
            ok: message[2],
            detail: message[3],
          })
        }
      } catch {
        // Welshman reports malformed relay messages separately.
      }
    }
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)
    ws.addEventListener("message", onMessage)
    nativeListeners.push(
      {ws, type: "error", listener: onError},
      {ws, type: "close", listener: onClose},
      {ws, type: "message", listener: onMessage},
    )
  }
  const isMatchingClientEvent = (message: any) =>
    message?.[0] === "EVENT" && message?.[1]?.id === eventId
  const shouldTraceRelayMessage = (message: any) =>
    (message?.[0] === "OK" && message?.[1] === eventId) ||
    message?.[0] === "NOTICE" ||
    message?.[0] === "AUTH"
  const onStatus = (status: unknown) => {
    attachNativeListeners()
    trace("status", {status})
  }
  const onSending = (message: unknown) => {
    if (isMatchingClientEvent(message)) trace("queued")
  }
  const onSend = (message: unknown) => {
    if (isMatchingClientEvent(message)) trace("send-returned")
  }
  const onReceiving = (message: any) => {
    if (shouldTraceRelayMessage(message)) {
      trace("raw-receive", {messageType: message[0], ok: message[2], detail: message[3]})
    }
  }
  const onReceive = (message: any) => {
    if (shouldTraceRelayMessage(message)) {
      trace("processed-receive", {messageType: message[0], ok: message[2], detail: message[3]})
    }
  }

  socket.on(SocketEvent.Status, onStatus)
  socket.on(SocketEvent.Sending, onSending)
  socket.on(SocketEvent.Send, onSend)
  socket.on(SocketEvent.Receiving, onReceiving)
  socket.on(SocketEvent.Receive, onReceive)
  attachNativeListeners()
  trace("start")

  return (result: string = "complete") => {
    trace("complete", {result})
    const cleanup = () => {
      socket.off(SocketEvent.Status, onStatus)
      socket.off(SocketEvent.Sending, onSending)
      socket.off(SocketEvent.Send, onSend)
      socket.off(SocketEvent.Receiving, onReceiving)
      socket.off(SocketEvent.Receive, onReceive)
      for (const {ws, type, listener} of nativeListeners) {
        ws.removeEventListener(type, listener)
      }
    }
    if (result === PublishStatus.Timeout) setTimeout(cleanup, 2000)
    else cleanup()
  }
}

// Helper to safely get user relay URLs, filtering out invalid values
const getUserRelayUrls = (): string[] => {
  try {
    const urls = Router.get().FromUser().getUrls()
    // Ensure we have an array of strings only
    if (!Array.isArray(urls)) return []
    return urls.filter(url => typeof url === "string" && url.length > 0)
  } catch {
    return []
  }
}

const getScopedRelayUrls = (
  event: Pick<NostrEvent, "kind" | "pubkey" | "tags">,
  relays: string[] = [],
  repoAddress?: string,
) => {
  const scopedRelays = requireRepoPublicationScope({event, relays, repoAddress})

  logPublishRelaySummary({
    category: "repo-scoped",
    relays: scopedRelays,
    repoRelays: relays,
  })

  return scopedRelays
}

export const publishEvent = <T extends NostrEvent>(
  event: T,
  relays: string[] = [],
  repoAddress?: string,
  options: {optimistic?: boolean} = {},
) => {
  return publishThunk({
    relays: getScopedRelayUrls(event, relays, repoAddress),
    event: event,
    optimistic: options.optimistic,
  })
}

export type RepoPublishOptions = {publishLocally?: boolean; repoAddress?: string}
type RepoPublishExecutionOptions = RepoPublishOptions & {signal?: AbortSignal}

const publishRepoEventWithRelayOutcomesUsingPool = async (
  pool: Pool,
  event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
  relays: string[],
  options: RepoPublishExecutionOptions = {},
) => {
  const scopedRelays = getScopedRelayUrls(event, relays, options.repoAddress)
  const activePubkey = pubkey.get()
  const activeSigner = signer.get()
  const signedEvent = isSignedEvent(event as TrustedEvent)
    ? event
    : activePubkey && activeSigner
      ? await activeSigner.sign(prep(event, activePubkey), {
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(GRASP_RELAY_ACK_TIMEOUT_MS)])
            : AbortSignal.timeout(GRASP_RELAY_ACK_TIMEOUT_MS),
        })
      : undefined

  if (!signedEvent || !isSignedEvent(signedEvent as TrustedEvent)) {
    throw new Error("Repository event signing failed")
  }
  options.signal?.throwIfAborted()

  if (options.publishLocally !== false) {
    repository.publish(signedEvent as TrustedEvent)
  }

  let results: Awaited<ReturnType<typeof publish>> = {}
  let publishThrew = false
  const nativeAckObservers = scopedRelays.map(relay => ({
    relay,
    observer: observeNativeRepoPublishAck(pool, relay, signedEvent.id),
  }))
  const transportTraces = scopedRelays.map(relay => ({
    relay,
    finish: startRepoPublishTransportTrace(pool, relay, signedEvent.id),
  }))
  try {
    results = await publish({
      relays: scopedRelays,
      event: signedEvent,
      timeout: GRASP_RELAY_ACK_TIMEOUT_MS,
      context: {pool},
      signal: options.signal,
    })
  } catch (error) {
    publishThrew = true
    const detail = error instanceof Error ? error.message : String(error || "publish failed")
    results = Object.fromEntries(
      scopedRelays.map(relay => [relay, {relay, status: PublishStatus.Failure, detail}]),
    )
  } finally {
    results = applyNativeRepoPublishAcks(
      results,
      nativeAckObservers.flatMap(({observer}) => {
        const ack = observer.getAck()
        observer.stop()
        return ack ? [ack] : []
      }),
    )
    for (const trace of transportTraces) {
      const result = Object.values(results).find(
        candidate => normalizeRelayUrl(candidate.relay) === normalizeRelayUrl(trace.relay),
      )
      trace.finish(result?.status || PublishStatus.Failure)
    }
  }

  for (const result of Object.values(results)) {
    if (publishThrew || result.status === PublishStatus.Timeout) {
      pool.remove(result.relay)
    }
  }

  const relayOutcomes = Object.values(results).map(result => ({
    relay: result.relay,
    status: result.status,
    detail: result.detail,
  }))

  const ackedRelays = relayOutcomes.flatMap(outcome =>
    outcome.status === PublishStatus.Success ? [outcome.relay] : [],
  )
  const failedRelays = relayOutcomes.flatMap(outcome =>
    outcome.status === PublishStatus.Success ? [] : [outcome.relay],
  )

  return {
    event: signedEvent as NostrEvent,
    relayOutcomes,
    ackedRelays,
    failedRelays,
    successCount: ackedRelays.length,
    hasRelayOutcomes: relayOutcomes.length > 0,
  }
}

export const createRepoPublishTransport = () => {
  const pool = new Pool()
  const controller = new AbortController()
  let pending = Promise.resolve()
  let disposed = false

  return {
    publish: (
      event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
      relays: string[],
      options: RepoPublishOptions = {},
    ) => {
      if (disposed) throw new Error("Repository publication transport is closed")
      const scopedRelays = getScopedRelayUrls(event, relays, options.repoAddress)
      const operation = pending.then(() => {
        if (disposed) throw new Error("Repository publication transport is closed")
        return publishRepoEventWithRelayOutcomesUsingPool(pool, event, scopedRelays, {
          ...options,
          signal: controller.signal,
        })
      })
      pending = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      controller.abort()
      pool.clear()
    },
  }
}

export type RepoPublishTransport = ReturnType<typeof createRepoPublishTransport>

export const publishRepoEventWithRelayOutcomes = async (
  event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
  relays: string[],
  options: RepoPublishOptions = {},
) => {
  const transport = createRepoPublishTransport()
  try {
    return await transport.publish(event, relays, options)
  } finally {
    transport.dispose()
  }
}

export const postComment = (
  comment: CommentEvent,
  relays: string[],
  repoAddress?: string,
  options: {optimistic?: boolean} = {},
) => {
  return publishThunk({
    relays: getScopedRelayUrls(comment, relays, repoAddress),
    event: comment,
    optimistic: options.optimistic,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[], repoAddress?: string) => {
  return publishThunk({
    event: issue,
    relays: getScopedRelayUrls(issue, relays, repoAddress),
  })
}

export const postStatus = (
  status: StatusEvent,
  relays: string[],
  repoAddress?: string,
  options: {optimistic?: boolean} = {},
) => {
  return publishThunk({
    relays: getScopedRelayUrls(status, relays, repoAddress),
    event: status,
    optimistic: options.optimistic,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  const repoRelays = getScopedRelayUrls(repo, [...getDeclaredRepoRelays(repo), ...relays])
  const merged = getRepoAnnouncementPublishRelays({
    repoEvent: repo,
    repoRelays,
    userOutboxRelays: getUserRelayUrls(),
    gitIndexerRelays: GIT_RELAYS,
  })
  return publishThunk({
    relays: merged,
    event: repo,
  })
}

export const postRepoStateEvent = (
  repoEvent: RepoStateEvent,
  relays: string[],
  repoAddress?: string,
) => {
  return publishThunk({
    relays: getScopedRelayUrls(repoEvent, relays, repoAddress),
    event: repoEvent,
  })
}

// Publish a NIP-32 label event (kind 1985)
export const postLabel = (
  labelEvent: any,
  relays: string[],
  repoAddress?: string,
  options: {optimistic?: boolean} = {},
) => {
  return publishThunk({
    relays: getScopedRelayUrls(labelEvent, relays, repoAddress),
    event: labelEvent,
    optimistic: options.optimistic,
  })
}

type RepoPublicationThunk = ReturnType<typeof publishThunk>
type RepoPublicationKind = "comment" | "status" | "label" | "event" | "delete"

type RepoPublicationOperation = {
  thunk?: RepoPublicationThunk
  acked: boolean
  committed: boolean
  inFlight?: Promise<TrustedEvent>
}

const repoPublicationOperations = new Map<string, RepoPublicationOperation>()

const getRepoPublicationKey = ({
  publication,
  rootId,
  event,
  author,
  relays,
  repoAddress,
}: {
  publication: RepoPublicationKind
  rootId: string
  event: Pick<NostrEvent, "kind" | "content" | "tags"> & {id?: string}
  author: string
  relays: string[]
  repoAddress?: string
}) =>
  JSON.stringify([
    publication,
    author,
    rootId,
    repoAddress,
    relays,
    event.kind,
    event.content,
    event.tags,
    publication === "delete" ? event.id : undefined,
  ])

export const publishRepoEventAfterAck = ({
  publication,
  rootId,
  event,
  relays,
  repoAddress,
}: {
  publication: RepoPublicationKind
  rootId: string
  event: NostrEvent
  relays: string[]
  repoAddress?: string
}) => {
  const scopedRelays = getScopedRelayUrls(event, relays, repoAddress)
  const publicationKey = getRepoPublicationKey({
    publication,
    rootId,
    event,
    author: pubkey.get() || "",
    relays: [...scopedRelays].sort(),
    repoAddress,
  })
  const operation: RepoPublicationOperation = repoPublicationOperations.get(publicationKey) || {
    acked: false,
    committed: false,
  }

  repoPublicationOperations.set(publicationKey, operation)
  if (operation.inFlight) return operation.inFlight

  const inFlight = (async () => {
    if (!operation.thunk) {
      if (publication === "delete") {
        operation.thunk = publishDelete({
          event: event as TrustedEvent,
          relays: scopedRelays,
          repoAddress,
          optimistic: false,
        })
      } else {
        const signedEvent = await signEventForPublication(event)

        if (publication === "comment") {
          operation.thunk = postComment(signedEvent as CommentEvent, scopedRelays, repoAddress, {
            optimistic: false,
          })
        } else if (publication === "status") {
          operation.thunk = postStatus(signedEvent as StatusEvent, scopedRelays, repoAddress, {
            optimistic: false,
          })
        } else if (publication === "label") {
          operation.thunk = postLabel(signedEvent, scopedRelays, repoAddress, {optimistic: false})
        } else {
          operation.thunk = publishEvent(signedEvent, scopedRelays, repoAddress, {
            optimistic: false,
          })
        }
      }
    } else if (!operation.acked) {
      operation.thunk = retryThunk(operation.thunk) as RepoPublicationThunk
    }

    if (!operation.acked) {
      await waitForAnyRelayAck(operation.thunk, operation.thunk.options.relays)
      operation.acked = true
    }

    if (!operation.committed) {
      repository.publish(operation.thunk.event as TrustedEvent)
      operation.committed = true
    }

    repoPublicationOperations.delete(publicationKey)
    return operation.thunk.event as TrustedEvent
  })().finally(() => {
    operation.inFlight = undefined
  })

  operation.inFlight = inFlight
  return inFlight
}

export const postPermalink = (permalink: NostrEvent, relays: string[], repoAddress?: string) => {
  return publishThunk({
    event: permalink,
    relays: getScopedRelayUrls(permalink, relays, repoAddress),
  })
}

export const postGraspServersList = (
  graspServersList: UserGraspListEvent,
  options: {optimistic?: boolean} = {},
) => {
  const merged = getUserDataPublishRelays([...getUserRelayUrls(), ...GIT_RELAYS])
  return publishThunk({
    event: graspServersList,
    relays: merged,
    optimistic: options.optimistic,
  })
}

export const postExtensionSettings = (event: Parameters<typeof publishThunk>[0]["event"]) => {
  const merged = getUserDataPublishRelays([...getUserRelayUrls(), ...GIT_RELAYS])
  return publishThunk({
    event,
    relays: merged,
  })
}

// Publish a NIP-32 role label event (kind 1985) for assignees/reviewers
export const postRoleLabel = (params: {
  rootId: string
  role: "assignee" | "reviewer"
  pubkeys: string[]
  repoAddr?: string
  relays: string[]
  expectedRepoAddress?: string
  created_at?: number
}) => {
  const {rootId, role, pubkeys, repoAddr, relays, expectedRepoAddress, created_at} = params
  const event = buildRoleLabelEvent({
    rootId,
    role,
    pubkeys,
    repoAddr,
    created_at,
  })
  return publishThunk({
    relays: getScopedRelayUrls(event, relays, expectedRepoAddress || repoAddr),
    event: event,
  })
}

export const deleteRoleLabelEvent = ({
  relays,
  event,
  repoAddress,
}: {
  relays: string[]
  event: TrustedEvent
  repoAddress?: string
}) => publishDelete({event, relays, repoAddress})

export type DeleteProgress = {
  label: string
  completed: number
  total: number
  current?: string
}

type DeleteCallbacks = {
  signal?: AbortSignal
  onProgress?: (progress: DeleteProgress) => void
}

const createAbortError = () => new DOMException("Delete operation cancelled", "AbortError")

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const awaitWithAbort = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> => {
  throwIfAborted(signal)

  if (!signal) {
    return await promise
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.()
      reject(createAbortError())
    }

    signal.addEventListener("abort", abort, {once: true})

    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort)
    })
  })
}

const reportDeleteProgress = (
  onProgress: DeleteCallbacks["onProgress"],
  progress: DeleteProgress,
) => {
  onProgress?.(progress)
}

const getDeleteTargetLabel = (event: TrustedEvent, root: TrustedEvent) => {
  if (event.id === root.id) {
    return root.kind === GIT_PULL_REQUEST ? "pull request" : "issue"
  }

  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "pull request update"
  if (event.kind === COMMENT) return "comment"
  if (event.kind === 1985) return "label"
  if (
    [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE].includes(event.kind)
  ) {
    return "status"
  }
  return "event"
}

type RetainedDelete = {
  thunk: ReturnType<typeof publishDelete>
  acked: boolean
  published: boolean
}

type RetainedDeleteOperation = {
  events: Map<string, TrustedEvent>
  deletes: Map<string, RetainedDelete>
  inFlight?: Promise<number>
}

const retainedDeleteOperations = new Map<string, RetainedDeleteOperation>()

const runDeleteEventsSequentially = async ({
  root,
  events,
  retainedDeletes,
  relays,
  repoAddress,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  events: TrustedEvent[]
  retainedDeletes: Map<string, RetainedDelete>
  relays: string[]
  repoAddress?: string
} & DeleteCallbacks) => {
  let deletedEvents = events.filter(event => retainedDeletes.get(event.id)?.published).length

  for (const event of events) {
    throwIfAborted(signal)

    let retainedDelete = retainedDeletes.get(event.id)
    if (retainedDelete?.acked && !retainedDelete.published) {
      repository.publish(retainedDelete.thunk.event as TrustedEvent)
      retainedDelete.published = true
      deletedEvents += 1
    }
    if (retainedDelete?.published) continue

    reportDeleteProgress(onProgress, {
      label: "Waiting for relay acknowledgements...",
      completed: deletedEvents,
      total: events.length,
      current: getDeleteTargetLabel(event, root),
    })

    const thunk = retainedDelete
      ? (retryThunk(retainedDelete.thunk) as ReturnType<typeof publishDelete>)
      : publishDelete({
          event,
          relays,
          repoAddress,
          optimistic: false,
        })

    if (retainedDelete) {
      retainedDelete.thunk = thunk
    } else {
      retainedDelete = {thunk, acked: false, published: false}
      retainedDeletes.set(event.id, retainedDelete)
    }

    await awaitWithAbort(waitForAnyRelayAck(thunk, thunk.options.relays), signal, () =>
      abortThunk(thunk),
    )
    retainedDelete.acked = true
    repository.publish(thunk.event as TrustedEvent)
    retainedDelete.published = true
    deletedEvents += 1

    reportDeleteProgress(onProgress, {
      label: "Delete requests acknowledged.",
      completed: deletedEvents,
      total: events.length,
      current: getDeleteTargetLabel(event, root),
    })
  }

  return deletedEvents
}

const deleteEventsSequentially = ({
  root,
  events,
  relays,
  repoAddress,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  events: TrustedEvent[]
  relays: string[]
  repoAddress?: string
} & DeleteCallbacks) => {
  if (pubkey.get() !== root.pubkey) {
    return Promise.reject(new Error("Restore the event author's account before deleting it."))
  }

  const operationKey = JSON.stringify([root.id, root.pubkey, repoAddress, [...relays].sort()])
  let operation = retainedDeleteOperations.get(operationKey)

  if (!operation) {
    operation = {events: new Map(), deletes: new Map()}
    retainedDeleteOperations.set(operationKey, operation)
  }
  if (operation.inFlight) return operation.inFlight

  for (const event of events) {
    if (event.id !== root.id) operation.events.set(event.id, event)
  }
  operation.events.delete(root.id)
  operation.events.set(root.id, root)

  const inFlight = runDeleteEventsSequentially({
    root,
    events: Array.from(operation.events.values()),
    retainedDeletes: operation.deletes,
    relays,
    repoAddress,
    signal,
    onProgress,
  })
    .then(result => {
      retainedDeleteOperations.delete(operationKey)
      return result
    })
    .finally(() => {
      operation!.inFlight = undefined
    })

  operation.inFlight = inFlight
  return inFlight
}

export const deleteIssueWithLabels = async ({
  issue,
  relays = [],
  repoAddress,
  signal,
  onProgress,
}: {
  issue: TrustedEvent
  relays?: string[]
  repoAddress?: string
} & DeleteCallbacks): Promise<{labelsDeleted: number}> => {
  if (!issue) return {labelsDeleted: 0}
  if (issue.kind !== 1621) return {labelsDeleted: 0}

  const merged = getScopedRelayUrls(issue, relays, repoAddress)

  if (!issue.id || !issue.pubkey || merged.length === 0) {
    return {labelsDeleted: 0}
  }

  reportDeleteProgress(onProgress, {
    label: "Loading author labels...",
    completed: 0,
    total: 1,
    current: "issue",
  })

  throwIfAborted(signal)

  try {
    await awaitWithAbort(
      load({
        relays: merged,
        filters: [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
        signal,
      }),
      signal,
    )
  } catch {
    throwIfAborted(signal)
    // ignore label load errors; deletion can still proceed
  }

  const labelEvents = repository.query(
    [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
    {shouldSort: false},
  ) as TrustedEvent[]

  await deleteEventsSequentially({
    root: issue,
    events: [...labelEvents, issue],
    relays: merged,
    repoAddress,
    signal,
    onProgress,
  })

  return {labelsDeleted: labelEvents.length}
}

export const deletePullRequestWithRelated = async ({
  root,
  relays = [],
  repoAddress,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  relays?: string[]
  repoAddress?: string
} & DeleteCallbacks): Promise<{deletedEvents: number; relatedDeleted: number}> => {
  if (!root?.id) return {deletedEvents: 0, relatedDeleted: 0}
  if (root.kind !== GIT_PULL_REQUEST) {
    return {deletedEvents: 0, relatedDeleted: 0}
  }

  const merged = getScopedRelayUrls(root, relays, repoAddress)

  if (merged.length === 0) {
    return {deletedEvents: 0, relatedDeleted: 0}
  }

  reportDeleteProgress(onProgress, {
    label: "Loading related events...",
    completed: 0,
    total: 1,
    current: "pull request",
  })

  throwIfAborted(signal)

  const filters: Filter[] = [
    {
      kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
      "#e": [root.id],
    },
    {
      kinds: [1985],
      "#e": [root.id],
    },
    {
      kinds: [COMMENT],
      "#E": [root.id],
    },
    {
      kinds: [COMMENT],
      "#e": [root.id],
    },
  ]

  filters.push({
    kinds: [GIT_PULL_REQUEST_UPDATE],
    "#E": [root.id],
  })
  filters.push({
    kinds: [GIT_PULL_REQUEST_UPDATE],
    "#e": [root.id],
  })

  try {
    await awaitWithAbort(load({relays: merged, filters, signal}), signal)
  } catch {
    throwIfAborted(signal)
    // pass
  }

  const relatedEvents = repository.query(filters, {shouldSort: false}) as TrustedEvent[]
  const eventsToDelete = new Map<string, TrustedEvent>()

  for (const event of relatedEvents) {
    if (!event?.id || event.id === root.id) continue
    if (event.pubkey !== root.pubkey) continue
    eventsToDelete.set(event.id, event)
  }

  eventsToDelete.set(root.id, root)

  const deletedEvents = await deleteEventsSequentially({
    root,
    events: Array.from(eventsToDelete.values()),
    relays: merged,
    repoAddress,
    signal,
    onProgress,
  })

  return {
    deletedEvents,
    relatedDeleted: Math.max(0, deletedEvents - 1),
  }
}
