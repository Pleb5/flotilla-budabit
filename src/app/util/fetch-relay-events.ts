import {load, makeLoader, Pool} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl, type Filter, type TrustedEvent} from "@welshman/util"
import {normalizeRelayHints} from "@app/util/event-links"

const DEFAULT_RELAY_FETCH_TIMEOUT_MS = 2500

export async function fetchRelayEventsWithTimeout<TEvent = any>(params: {
  relays: string[]
  filters: any[]
  timeoutMs?: number
  signal?: AbortSignal
  throwOnTimeout?: boolean
  isolated?: boolean
  maxEvents?: number
  maxBytes?: number
  onOutcome?: (outcome: {timedOut: boolean; sawEose: boolean; capped: boolean}) => void
}): Promise<TEvent[]> {
  const events: TEvent[] = []
  const eventIds = new Set<string>()
  let sawEose = false
  let disconnectedRelay = ""
  const controller = new AbortController()
  const isolatedPool = params.isolated ? new Pool() : undefined
  const onAbort = () => controller.abort()
  params.signal?.addEventListener("abort", onAbort, {once: true})
  let timedOut = false
  let capped = false
  let bytes = 0
  const timeoutId = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Math.max(1, params.timeoutMs || DEFAULT_RELAY_FETCH_TIMEOUT_MS),
  )

  try {
    const relays = normalizeRelayHints(params.relays as any)
    const loadEvents = isolatedPool
      ? makeLoader({delay: 0, threshold: 1, context: {pool: isolatedPool}})
      : load
    await loadEvents({
      relays,
      filters: params.filters,
      signal: controller.signal,
      onEvent: event => {
        if (controller.signal.aborted) return
        if (eventIds.has(event.id)) return
        const eventBytes = params.maxBytes
          ? new TextEncoder().encode(JSON.stringify(event)).byteLength
          : 0
        if (params.maxBytes && bytes + eventBytes > params.maxBytes) {
          capped = true
          controller.abort()
          return
        }
        bytes += eventBytes
        eventIds.add(event.id)
        events.push(event as TEvent)
        if (params.maxEvents && events.length >= params.maxEvents) {
          capped = true
          controller.abort()
        }
      },
      onEose: () => {
        sawEose = true
      },
      onDisconnect: relay => {
        disconnectedRelay = relay
      },
    })
    if (params.throwOnTimeout && events.length === 0 && !sawEose) {
      throw new Error(
        disconnectedRelay
          ? `Relay disconnected before EOSE: ${disconnectedRelay}`
          : "Relay query ended without EOSE",
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "")
    const normalizedMessage = message.toLowerCase()
    const isAbort =
      controller.signal.aborted ||
      normalizedMessage.includes("abort") ||
      normalizedMessage.includes("signal is aborted")

    if (!isAbort) {
      throw error
    }
    if (timedOut && params.throwOnTimeout) {
      throw new Error(
        `Relay query timed out after ${params.timeoutMs || DEFAULT_RELAY_FETCH_TIMEOUT_MS}ms`,
      )
    }
  } finally {
    clearTimeout(timeoutId)
    params.signal?.removeEventListener("abort", onAbort)
    isolatedPool?.clear()
    params.onOutcome?.({timedOut, sawEose, capped})
  }

  return events
}

/** Small exact reads for initial import, not whole-relay history inventory. */
export async function fetchInitialImportRelayEvents(params: {
  relays: string[]
  filters: any[]
  timeoutMs?: number
  throwOnTimeout?: boolean
}) {
  if (params.relays.length !== 1)
    throw new Error("Initial import reads require one repository relay")
  let complete = false
  const events = await fetchRelayEventsWithTimeout({
    ...params,
    isolated: true,
    throwOnTimeout: true,
    maxEvents: 10,
    maxBytes: 64 * 1024,
    onOutcome: outcome => {
      complete = outcome.sawEose && !outcome.capped && !outcome.timedOut
    },
  })
  if (!complete)
    throw new Error("Initial import relay read was incomplete or exceeded its small-query budget")
  return events
}

export type CompleteRelayInventory = {
  events: TrustedEvent[]
  eventsByRelay: Map<string, TrustedEvent[]>
  relays: string[]
}

const makeAbortError = () => new DOMException("Operation aborted", "AbortError")

const normalizeInventoryRelays = (relays: string[]) => {
  const normalized = new Set<string>()

  for (const relay of relays || []) {
    try {
      const url = normalizeRelayUrl(relay)
      if (isRelayUrl(url)) normalized.add(url)
    } catch {
      continue
    }
  }

  return Array.from(normalized)
}

export async function fetchCompleteRelayInventory(params: {
  relays: string[]
  filters: Filter[]
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<CompleteRelayInventory> {
  const relays = normalizeInventoryRelays(params.relays)
  if (relays.length === 0) throw new Error("Repository deletion requires declared metadata relays")
  if (params.signal?.aborted) throw makeAbortError()

  const pool = new Pool()
  const operationController = new AbortController()
  const signal = params.signal
    ? AbortSignal.any([params.signal, operationController.signal])
    : operationController.signal
  const eventsByRelay = new Map<string, TrustedEvent[]>()
  const loader = makeLoader({
    delay: 0,
    threshold: 1,
    timeout: Math.max(1, params.timeoutMs || DEFAULT_RELAY_FETCH_TIMEOUT_MS),
    context: {pool},
    isEventDeleted: () => false,
  })

  const queryRelay = async (relay: string) => {
    const events: TrustedEvent[] = []
    let sawEose = false
    let terminalError = ""

    try {
      await loader({
        relays: [relay],
        filters: params.filters,
        signal,
        onEvent: event => events.push(event),
        onEose: url => {
          if (normalizeRelayUrl(url) === relay) sawEose = true
        },
        onDisconnect: url => {
          if (!sawEose) terminalError = `Relay disconnected before EOSE: ${url}`
        },
        onClosed: (message, url) => {
          if (!sawEose)
            terminalError = `Relay closed before EOSE: ${url}${message ? ` (${message})` : ""}`
        },
      })
    } catch (error) {
      if (params.signal?.aborted) throw makeAbortError()
      throw error
    }

    if (params.signal?.aborted) throw makeAbortError()
    if (terminalError) throw new Error(terminalError)
    if (!sawEose) throw new Error(`Relay did not complete repository inventory with EOSE: ${relay}`)

    const deduped = Array.from(new Map(events.map(event => [event.id, event])).values())
    eventsByRelay.set(relay, deduped)
    return deduped
  }

  try {
    const requests = relays.map(relay =>
      queryRelay(relay).catch(error => {
        operationController.abort()
        throw error
      }),
    )
    const settled = await Promise.allSettled(requests)
    const failure = settled.find(result => result.status === "rejected") as
      | PromiseRejectedResult
      | undefined
    if (failure) throw failure.reason

    const events = Array.from(
      new Map(
        settled.flatMap(result =>
          result.status === "fulfilled"
            ? result.value.map(event => [event.id, event] as const)
            : [],
        ),
      ).values(),
    )

    return {events, eventsByRelay, relays}
  } finally {
    operationController.abort()
    pool.clear()
  }
}
