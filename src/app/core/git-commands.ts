import type {
  CommentEvent,
  IssueEvent,
  RepoAnnouncementEvent,
  StatusEvent,
  RepoStateEvent,
  UserGraspListEvent,
} from "@nostr-git/core/events"
import {buildRoleLabelEvent} from "@app/util/labels"
import {abortThunk, publishThunk, pubkey, repository, signer} from "@welshman/app"
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

export const GRASP_RELAY_ACK_TIMEOUT_MS = 30_000

const repoPublishAttemptCounts = new Map<string, number>()
const repoPublishSocketIds = new WeakMap<object, number>()
const repoPublishWebSocketGenerations = new WeakMap<object, number>()
let nextRepoPublishSocketId = 1
let nextRepoPublishWebSocketGeneration = 1

const startRepoPublishTransportTrace = (relay: string, eventId: string) => {
  if (!canTraceRepoPublishTransport()) return () => undefined

  const socket = Pool.get().get(relay) as any
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

const getScopedRelayUrls = (relays: string[] = []) => {
  const scopedRelays = Array.from(
    new Set(
      relays
        .map(relay => {
          try {
            return normalizeRelayUrl(relay)
          } catch {
            return ""
          }
        })
        .filter(isRelayUrl),
    ),
  )

  logPublishRelaySummary({
    category: "repo-scoped",
    relays: scopedRelays,
    repoRelays: relays,
  })

  return scopedRelays
}

export const publishEvent = <T extends NostrEvent>(event: T, relays?: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: event,
  })
}

export const publishRepoEventWithRelayOutcomes = async (
  event: RepoAnnouncementEvent | RepoStateEvent | NostrEvent,
  relays: string[],
  options: {publishLocally?: boolean} = {},
) => {
  const scopedRelays = getScopedRelayUrls(relays)
  const activePubkey = pubkey.get()
  const activeSigner = signer.get()
  const signedEvent = isSignedEvent(event as TrustedEvent)
    ? event
    : activePubkey && activeSigner
      ? await activeSigner.sign(prep(event, activePubkey), {
          signal: AbortSignal.timeout(GRASP_RELAY_ACK_TIMEOUT_MS),
        })
      : undefined

  if (!signedEvent || !isSignedEvent(signedEvent as TrustedEvent)) {
    throw new Error("Repository event signing failed")
  }

  if (options.publishLocally !== false) {
    repository.publish(signedEvent as TrustedEvent)
  }

  let results: Awaited<ReturnType<typeof publish>> = {}
  const transportTraces = scopedRelays.map(relay => ({
    relay,
    finish: startRepoPublishTransportTrace(relay, signedEvent.id),
  }))
  try {
    results = await publish({
      relays: scopedRelays,
      event: signedEvent,
      timeout: GRASP_RELAY_ACK_TIMEOUT_MS,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "publish failed")
    results = Object.fromEntries(
      scopedRelays.map(relay => [relay, {relay, status: PublishStatus.Failure, detail}]),
    )
  } finally {
    for (const trace of transportTraces) {
      const result = Object.values(results).find(
        candidate => normalizeRelayUrl(candidate.relay) === normalizeRelayUrl(trace.relay),
      )
      trace.finish(result?.status || PublishStatus.Failure)
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

export const postComment = (comment: CommentEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: comment,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[]) => {
  return publishThunk({
    event: issue,
    relays: getScopedRelayUrls(relays),
  })
}

export const postStatus = (status: StatusEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: status,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  const merged = getRepoAnnouncementPublishRelays({
    repoEvent: repo,
    repoRelays: relays,
    userOutboxRelays: getUserRelayUrls(),
    gitIndexerRelays: GIT_RELAYS,
  })
  return publishThunk({
    relays: merged,
    event: repo,
  })
}

export const postRepoStateEvent = (repoEvent: RepoStateEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: repoEvent,
  })
}

// Publish a NIP-32 label event (kind 1985)
export const postLabel = (labelEvent: any, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: labelEvent,
  })
}

export const postPermalink = (permalink: NostrEvent, relays: string[]) => {
  return publishThunk({
    event: permalink,
    relays: getScopedRelayUrls(relays),
  })
}

export const postGraspServersList = (graspServersList: UserGraspListEvent) => {
  const merged = getUserDataPublishRelays([...getUserRelayUrls(), ...GIT_RELAYS])
  return publishThunk({
    event: graspServersList,
    relays: merged,
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
  created_at?: number
}) => {
  const {rootId, role, pubkeys, repoAddr, relays, created_at} = params
  const event = buildRoleLabelEvent({
    rootId,
    role,
    pubkeys,
    repoAddr,
    created_at,
  })
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: event,
  })
}

export const deleteRoleLabelEvent = ({relays, event}: {relays: string[]; event: TrustedEvent}) =>
  publishDelete({event, relays})

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

const waitForDeletePublish = async (
  thunk: {complete?: Promise<unknown>} | undefined,
  signal?: AbortSignal,
) => {
  if (!thunk?.complete) return

  await awaitWithAbort(thunk.complete, signal, () => abortThunk(thunk as any))
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

const deleteEventsSequentially = async ({
  root,
  events,
  relays,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  events: TrustedEvent[]
  relays: string[]
} & DeleteCallbacks) => {
  let deletedEvents = 0

  for (const event of events) {
    throwIfAborted(signal)

    reportDeleteProgress(onProgress, {
      label: "Waiting for relay acknowledgements...",
      completed: deletedEvents,
      total: events.length,
      current: getDeleteTargetLabel(event, root),
    })

    const thunk = publishDelete({
      event,
      relays,
    })

    await waitForDeletePublish(thunk, signal)
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

export const deleteIssueWithLabels = async ({
  issue,
  relays = [],
  signal,
  onProgress,
}: {
  issue: TrustedEvent
  relays?: string[]
} & DeleteCallbacks): Promise<{labelsDeleted: number}> => {
  if (!issue) return {labelsDeleted: 0}
  if (issue.kind !== 1621) return {labelsDeleted: 0}

  const merged = getScopedRelayUrls(relays)

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
    events: [issue, ...labelEvents],
    relays: merged,
    signal,
    onProgress,
  })

  return {labelsDeleted: labelEvents.length}
}

export const deletePullRequestWithRelated = async ({
  root,
  relays = [],
  signal,
  onProgress,
}: {
  root: TrustedEvent
  relays?: string[]
} & DeleteCallbacks): Promise<{deletedEvents: number; relatedDeleted: number}> => {
  if (!root?.id) return {deletedEvents: 0, relatedDeleted: 0}
  if (root.kind !== GIT_PULL_REQUEST) {
    return {deletedEvents: 0, relatedDeleted: 0}
  }

  const merged = getScopedRelayUrls(relays)

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
  eventsToDelete.set(root.id, root)

  for (const event of relatedEvents) {
    if (!event?.id || event.id === root.id) continue
    if (event.pubkey !== root.pubkey) continue
    eventsToDelete.set(event.id, event)
  }

  const deletedEvents = await deleteEventsSequentially({
    root,
    events: Array.from(eventsToDelete.values()),
    relays: merged,
    signal,
    onProgress,
  })

  return {
    deletedEvents,
    relatedDeleted: Math.max(0, deletedEvents - 1),
  }
}
