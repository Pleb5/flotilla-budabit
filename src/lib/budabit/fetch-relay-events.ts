import {load} from "@welshman/net"

const DEFAULT_RELAY_FETCH_TIMEOUT_MS = 2500

export async function fetchRelayEventsWithTimeout<TEvent = any>(params: {
  relays: string[]
  filters: any[]
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<TEvent[]> {
  const events: TEvent[] = []
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  params.signal?.addEventListener("abort", onAbort, {once: true})
  const timeoutId = setTimeout(
    () => controller.abort(),
    Math.max(1, params.timeoutMs || DEFAULT_RELAY_FETCH_TIMEOUT_MS),
  )

  try {
    await load({
      relays: params.relays,
      filters: params.filters,
      signal: controller.signal,
      onEvent: event => events.push(event as TEvent),
    })
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
  } finally {
    clearTimeout(timeoutId)
    params.signal?.removeEventListener("abort", onAbort)
  }

  return events
}
