import type {Filter, TrustedEvent} from "@welshman/util"
import type {RequestOptions} from "@welshman/net"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

type Request = (options: RequestOptions) => Promise<TrustedEvent[]>

type BackgroundLiveCoordinatorOptions = {
  request: Request
  owner?: string
  onEvent: (event: TrustedEvent, relay: string) => void
  onError: (relay: string, error: unknown) => void
  onReconnect?: (relay: string) => void
}

type BackgroundCatchUpOptions = {
  request: Request
  coordinator: BackgroundLiveCoordinator
  source: object
  relay: string
  filters: Filter[]
  liveFilters: Filter[]
  signal: AbortSignal
  onEvent: (event: TrustedEvent, relay: string) => void
  onError: (error: unknown) => void
  timeout?: number
}

type ActiveRequest = {
  controller: AbortController
  signature: string
  retryTimer?: ReturnType<typeof setTimeout>
}

const getFilterKey = (filter: Filter) =>
  JSON.stringify(Object.fromEntries(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))))

const getLiveFilters = (sources: Iterable<Filter[]>) => {
  const filtersByKey = new Map<string, Filter>()

  for (const filters of sources) {
    for (const filter of filters) {
      const liveFilter = {...filter, limit: 0}
      filtersByKey.set(getFilterKey(liveFilter), liveFilter)
    }
  }

  return Array.from(filtersByKey.values())
}

export const createBackgroundLiveCoordinator = ({
  request,
  owner = "background-live",
  onEvent,
  onError,
  onReconnect,
}: BackgroundLiveCoordinatorOptions) => {
  const filtersByRelayBySource = new Map<object, Map<string, Filter[]>>()
  const activeByRelay = new Map<string, ActiveRequest>()
  const failuresByRelay = new Map<string, number>()
  const interruptedRelays = new Set<string>()

  const reconcileRelay = (relay: string) => {
    const filters = getLiveFilters(
      Array.from(filtersByRelayBySource.values()).flatMap(filtersByRelay => {
        const sourceFilters = filtersByRelay.get(relay)
        return sourceFilters ? [sourceFilters] : []
      }),
    )
    const signature = filters.map(getFilterKey).sort().join("|")
    const active = activeByRelay.get(relay)

    if (active?.signature === signature) return

    if (active?.retryTimer) clearTimeout(active.retryTimer)
    active?.controller.abort()
    activeByRelay.delete(relay)

    if (filters.length === 0) {
      failuresByRelay.delete(relay)
      interruptedRelays.delete(relay)
      return
    }

    const controller = new AbortController()
    const next: ActiveRequest = {controller, signature}
    activeByRelay.set(relay, next)
    let interrupted = false

    const start = async () =>
      request({
        relays: [relay],
        filters,
        lifetime: "live",
        priority: RELAY_REQUEST_PRIORITY.background,
        owner,
        signal: controller.signal,
        onEvent,
        onDuplicate: onEvent,
        onClosed: () => {
          // One rejected chunk means the combined subscription has lost coverage,
          // even when other chunks remain open and keep the request pending.
          interrupted = true
          controller.abort()
        },
        onEose: () => {
          failuresByRelay.delete(relay)
          if (interruptedRelays.delete(relay)) onReconnect?.(relay)
        },
      })
    void start()
      .catch(error => {
        if (!controller.signal.aborted) onError(relay, error)
      })
      .finally(() => {
        if (activeByRelay.get(relay) !== next) return
        if (controller.signal.aborted && !interrupted) return
        interruptedRelays.add(relay)
        const failures = failuresByRelay.get(relay) || 0
        failuresByRelay.set(relay, failures + 1)
        next.retryTimer = setTimeout(
          () => {
            if (activeByRelay.get(relay) !== next) return
            activeByRelay.delete(relay)
            reconcileRelay(relay)
          },
          Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)),
        )
      })
  }

  const set = (source: object, relay: string, filters: Filter[]) => {
    const filtersByRelay = filtersByRelayBySource.get(source) || new Map<string, Filter[]>()
    filtersByRelayBySource.set(source, filtersByRelay)

    if (filters.length > 0) filtersByRelay.set(relay, filters)
    else filtersByRelay.delete(relay)

    if (filtersByRelay.size === 0) filtersByRelayBySource.delete(source)
    reconcileRelay(relay)
  }

  const clear = (source: object) => {
    const filtersByRelay = filtersByRelayBySource.get(source)
    if (!filtersByRelay) return

    filtersByRelayBySource.delete(source)
    for (const relay of filtersByRelay.keys()) reconcileRelay(relay)
  }

  const close = () => {
    filtersByRelayBySource.clear()
    for (const active of activeByRelay.values()) {
      if (active.retryTimer) clearTimeout(active.retryTimer)
      active.controller.abort()
    }
    activeByRelay.clear()
    failuresByRelay.clear()
    interruptedRelays.clear()
  }

  return {owner, set, clear, close}
}

export type BackgroundLiveCoordinator = ReturnType<typeof createBackgroundLiveCoordinator>

export const catchUpThenSetBackgroundLive = async ({
  request,
  coordinator,
  source,
  relay,
  filters,
  liveFilters,
  signal,
  onEvent,
  onError,
  timeout = 5_000,
}: BackgroundCatchUpOptions) => {
  const catchUpSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)])

  try {
    await request({
      relays: [relay],
      filters,
      autoClose: true,
      lifetime: "finite",
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: coordinator.owner,
      signal: catchUpSignal,
      onEvent,
      onDuplicate: onEvent,
    })
  } catch (error) {
    if (!signal.aborted) onError(error)
  } finally {
    if (!signal.aborted) coordinator.set(source, relay, liveFilters)
  }
}
