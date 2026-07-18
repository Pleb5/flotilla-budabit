import {load} from "@welshman/net"
import {normalizeRelayHints} from "@app/util/event-links"

const DEFAULT_RELAY_FETCH_TIMEOUT_MS = 2500

export async function fetchRelayEventsWithTimeout<TEvent = any>(params: {
  relays: string[]
  filters: any[]
  timeoutMs?: number
  signal?: AbortSignal
  throwOnTimeout?: boolean
}): Promise<TEvent[]> {
  const events: TEvent[] = []
  let sawEose = false
  let disconnectedRelay = ""
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  params.signal?.addEventListener("abort", onAbort, {once: true})
  let timedOut = false
  const timeoutId = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Math.max(1, params.timeoutMs || DEFAULT_RELAY_FETCH_TIMEOUT_MS),
  )

  try {
    const relays = normalizeRelayHints(params.relays as any)
    await load({
      relays,
      filters: params.filters,
      signal: controller.signal,
      onEvent: event => events.push(event as TEvent),
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
  }

  return events
}
