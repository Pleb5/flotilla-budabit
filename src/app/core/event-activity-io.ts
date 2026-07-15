import {repository, tracker} from "@welshman/app"
import {request} from "@welshman/net"
import {isRelayUrl, normalizeRelayUrl, type Filter, type TrustedEvent} from "@welshman/util"

const ACTIVITY_BATCH_MS = 75
const ACTIVITY_HISTORY_TIMEOUT_MS = 30_000
const ACTIVITY_LIVE_RETRY_MS = 5_500
const ACTIVITY_LIVE_OVERLAP_SECONDS = 5
const ACTIVITY_TAG_CHUNK_SIZE = 100
const ACTIVITY_PRIORITY = -100
const ACTIVITY_TAGS = ["#E", "#A", "#a"] as const

type ActivityTag = (typeof ACTIVITY_TAGS)[number]
type Timer = ReturnType<typeof setTimeout>

export type EventActivityRequestOptions = {
  relays: string[]
  filters: Filter[]
  autoClose?: boolean
  lifetime: "finite" | "live"
  priority: number
  owner?: string
  signal: AbortSignal
  onEvent: (event: TrustedEvent, relay: string) => void
  onDuplicate?: (event: TrustedEvent, relay: string) => void
  onEose?: (relay: string) => void
  onClosed?: (message: string, relay: string) => void
  onDisconnect?: (relay: string) => void
}

export type EventActivityRegistration = {
  routeScope: string
  relays: string[]
  scopeH?: string
  filters: Filter[]
  coreCommunityLiveCovered?: boolean
}

type EventActivityIODependencies = {
  request: (options: EventActivityRequestOptions) => Promise<unknown>
  publish: (event: TrustedEvent) => void
  track: (eventId: string, relay: string) => void
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => Timer
  clearTimer?: (timer: Timer) => void
  batchMs?: number
  historyTimeoutMs?: number
  liveRetryMs?: number
  overlapSeconds?: number
  onError?: (message: string, error: unknown) => void
}

type ActivityTarget = {
  filters: Filter[]
  historyPending: boolean
  refs: number
}

type LiveRequest = {
  controller: AbortController
  eoseRelays: Set<string>
  signature: string
}

type RouteState = {
  liveSince: number
  refs: number
  releaseTimer?: Timer
}

const cloneFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ) as Filter

const normalizeFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries(filter)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? [...value].sort((left, right) => String(left).localeCompare(String(right)))
          : value,
      ]),
  ) as Filter

const getFilterKey = (filter: Filter) => JSON.stringify(normalizeFilter(filter))

const getBaseFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries(filter).filter(
      ([key]) => !ACTIVITY_TAGS.includes(key as ActivityTag) && key !== "since" && key !== "until",
    ),
  ) as Filter

const getTargetKey = (filters: Filter[]) => filters.map(getFilterKey).sort().join("|")

const normalizeRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)

    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean))).sort()

const chunkValues = (values: string[], size: number) => {
  const chunks: string[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

class ActivityCoordinator {
  private readonly targets = new Map<string, ActivityTarget>()
  private readonly historyRequests = new Map<AbortController, Timer>()
  private flushTimer?: Timer
  private retryTimer?: Timer
  private currentLive?: LiveRequest
  private pendingLive?: LiveRequest
  private registrationCount = 0
  private closed = false

  constructor(
    private readonly dependencies: Required<
      Pick<
        EventActivityIODependencies,
        "request" | "publish" | "track" | "setTimer" | "clearTimer" | "onError"
      >
    > & {
      batchMs: number
      historyTimeoutMs: number
      liveRetryMs: number
    },
    private readonly relays: string[],
    private readonly baseFilter: Filter,
    private readonly liveSince: number,
    private readonly liveCovered: boolean,
  ) {}

  register(filters: Filter[]) {
    const key = getTargetKey(filters)
    const existing = this.targets.get(key)

    this.registrationCount += 1
    if (existing) {
      existing.refs += 1
    } else {
      this.targets.set(key, {
        filters: filters.map(cloneFilter),
        historyPending: true,
        refs: 1,
      })
      this.schedule()
    }

    return () => this.unregister(key)
  }

  private unregister(key: string) {
    if (this.closed) return true

    const target = this.targets.get(key)
    if (!target) return this.registrationCount === 0

    target.refs -= 1
    this.registrationCount -= 1

    if (target.refs === 0) {
      this.targets.delete(key)
      this.schedule()
    }

    return this.registrationCount === 0
  }

  private schedule() {
    if (this.closed || this.flushTimer) return
    if (this.retryTimer) {
      this.dependencies.clearTimer(this.retryTimer)
      this.retryTimer = undefined
    }

    this.flushTimer = this.dependencies.setTimer(() => {
      this.flushTimer = undefined
      this.flush()
    }, this.dependencies.batchMs)
  }

  private flush() {
    if (this.closed) return

    const historicalFilters: Filter[] = []
    for (const target of this.targets.values()) {
      if (!target.historyPending) continue

      target.historyPending = false
      historicalFilters.push(
        ...target.filters.map(filter => ({...cloneFilter(filter), until: this.liveSince})),
      )
    }

    if (historicalFilters.length > 0) this.loadHistory(historicalFilters)
    this.reconcileLive()
  }

  private loadHistory(filters: Filter[]) {
    const controller = new AbortController()
    const timeout = this.dependencies.setTimer(
      () => controller.abort(),
      this.dependencies.historyTimeoutMs,
    )
    this.historyRequests.set(controller, timeout)

    let result: Promise<unknown>
    try {
      result = this.dependencies.request({
        relays: this.relays,
        filters,
        autoClose: true,
        lifetime: "finite",
        priority: ACTIVITY_PRIORITY,
        owner: "event-activity",
        signal: controller.signal,
        onEvent: (event, relay) => this.receiveEvent(event, relay),
        onDuplicate: (event, relay) => this.receiveEvent(event, relay),
      })
    } catch (error) {
      this.finishHistory(controller)
      this.dependencies.onError("Failed to load event activity history", error)
      return
    }

    void result
      .catch(error => {
        if (!controller.signal.aborted) {
          this.dependencies.onError("Failed to load event activity history", error)
        }
      })
      .finally(() => this.finishHistory(controller))
  }

  private finishHistory(controller: AbortController) {
    const timeout = this.historyRequests.get(controller)
    if (timeout) this.dependencies.clearTimer(timeout)
    this.historyRequests.delete(controller)
  }

  private buildLiveFilters() {
    const valuesByTag = new Map<ActivityTag, Set<string>>(
      ACTIVITY_TAGS.map(tag => [tag, new Set<string>()]),
    )

    for (const target of this.targets.values()) {
      for (const filter of target.filters) {
        for (const tag of ACTIVITY_TAGS) {
          for (const value of filter[tag] || []) valuesByTag.get(tag)?.add(value)
        }
      }
    }

    const filters: Filter[] = []
    for (const tag of ACTIVITY_TAGS) {
      const values = Array.from(valuesByTag.get(tag) || []).sort()
      for (const chunk of chunkValues(values, ACTIVITY_TAG_CHUNK_SIZE)) {
        filters.push({...cloneFilter(this.baseFilter), [tag]: chunk, since: this.liveSince})
      }
    }

    return filters
  }

  private reconcileLive() {
    if (this.liveCovered || this.targets.size === 0) {
      this.stopLiveRequests()
      return
    }

    const filters = this.buildLiveFilters()
    const signature = filters.map(getFilterKey).join("|")

    if (this.currentLive?.signature === signature) {
      this.stopPendingLive()
      return
    }
    if (this.pendingLive?.signature === signature) return

    this.stopPendingLive()
    this.openLive(filters, signature)
  }

  private openLive(filters: Filter[], signature: string) {
    const candidate: LiveRequest = {
      controller: new AbortController(),
      eoseRelays: new Set(),
      signature,
    }
    if (this.currentLive) {
      this.pendingLive = candidate
    } else {
      this.currentLive = candidate
    }

    let result: Promise<unknown>
    try {
      result = this.dependencies.request({
        relays: this.relays,
        filters,
        lifetime: "live",
        priority: ACTIVITY_PRIORITY,
        owner: "event-activity",
        signal: candidate.controller.signal,
        onEvent: (event, relay) => this.receiveEvent(event, relay),
        onDuplicate: (event, relay) => this.receiveEvent(event, relay),
        onEose: relay => this.markLiveReady(candidate, relay),
        onClosed: () => this.failLive(candidate),
        onDisconnect: () => this.failLive(candidate),
      })
    } catch (error) {
      this.handleLiveClose(candidate)
      this.dependencies.onError("Failed to subscribe to event activity", error)
      return
    }

    void result
      .catch(error => {
        if (!candidate.controller.signal.aborted) {
          this.dependencies.onError("Failed to subscribe to event activity", error)
        }
      })
      .finally(() => this.handleLiveClose(candidate))
  }

  private markLiveReady(candidate: LiveRequest, relay: string) {
    if (this.pendingLive !== candidate || candidate.controller.signal.aborted) return

    candidate.eoseRelays.add(normalizeRelay(relay) || relay)
    if (!this.relays.every(url => candidate.eoseRelays.has(url))) return

    const previous = this.currentLive
    this.currentLive = candidate
    this.pendingLive = undefined
    if (this.retryTimer) {
      this.dependencies.clearTimer(this.retryTimer)
      this.retryTimer = undefined
    }
    previous?.controller.abort()
  }

  private handleLiveClose(candidate: LiveRequest) {
    let shouldRetry = false

    if (this.pendingLive === candidate) {
      this.pendingLive = undefined
      shouldRetry = !candidate.controller.signal.aborted
    }
    if (this.currentLive === candidate) {
      this.currentLive = undefined
      shouldRetry = !candidate.controller.signal.aborted
    }

    if (shouldRetry) this.scheduleLiveRetry()
  }

  private failLive(candidate: LiveRequest) {
    if (this.pendingLive === candidate) {
      this.pendingLive = undefined
    } else if (this.currentLive === candidate) {
      this.currentLive = undefined
    } else {
      return
    }

    candidate.controller.abort()
    this.scheduleLiveRetry()
  }

  private scheduleLiveRetry() {
    if (this.closed || this.liveCovered || this.targets.size === 0 || this.retryTimer) return

    this.retryTimer = this.dependencies.setTimer(() => {
      this.retryTimer = undefined
      this.schedule()
    }, this.dependencies.liveRetryMs)
  }

  private receiveEvent(event: TrustedEvent, relay: string) {
    this.dependencies.track(event.id, relay)
    this.dependencies.publish(event)
  }

  private stopPendingLive() {
    const pending = this.pendingLive
    this.pendingLive = undefined
    pending?.controller.abort()
  }

  private stopLiveRequests() {
    this.stopPendingLive()
    const current = this.currentLive
    this.currentLive = undefined
    current?.controller.abort()
  }

  close() {
    if (this.closed) return
    this.closed = true

    if (this.flushTimer) this.dependencies.clearTimer(this.flushTimer)
    if (this.retryTimer) this.dependencies.clearTimer(this.retryTimer)
    this.flushTimer = undefined
    this.retryTimer = undefined

    for (const [controller, timeout] of this.historyRequests) {
      this.dependencies.clearTimer(timeout)
      controller.abort()
    }
    this.historyRequests.clear()
    this.stopLiveRequests()
    this.targets.clear()
  }
}

export const createEventActivityIO = (dependencies: EventActivityIODependencies) => {
  const now = dependencies.now || Date.now
  const setTimer = dependencies.setTimer || setTimeout
  const clearTimer = dependencies.clearTimer || clearTimeout
  const batchMs = dependencies.batchMs ?? ACTIVITY_BATCH_MS
  const overlapSeconds = dependencies.overlapSeconds ?? ACTIVITY_LIVE_OVERLAP_SECONDS
  const coordinatorDependencies = {
    request: dependencies.request,
    publish: dependencies.publish,
    track: dependencies.track,
    setTimer,
    clearTimer,
    batchMs,
    historyTimeoutMs: dependencies.historyTimeoutMs ?? ACTIVITY_HISTORY_TIMEOUT_MS,
    liveRetryMs: dependencies.liveRetryMs ?? ACTIVITY_LIVE_RETRY_MS,
    onError:
      dependencies.onError ||
      ((message, error) => console.warn(`[event-activity] ${message}`, error)),
  }
  const coordinators = new Map<string, ActivityCoordinator>()
  const routeStates = new Map<string, RouteState>()

  const register = (options: EventActivityRegistration) => {
    const relays = normalizeRelays(options.relays)
    if (relays.length === 0 || options.filters.length === 0) return () => undefined

    const baseFilters = new Map(
      options.filters.map(filter => {
        const baseFilter = getBaseFilter(filter)
        return [getFilterKey(baseFilter), baseFilter]
      }),
    )
    if (baseFilters.size !== 1) {
      throw new Error("Event activity filters must share one compatible base filter")
    }

    const routeScope = options.routeScope || "unknown"
    let routeState = routeStates.get(routeScope)
    if (!routeState) {
      routeState = {
        liveSince: Math.floor(now() / 1000) - overlapSeconds,
        refs: 0,
      }
      routeStates.set(routeScope, routeState)
    }
    if (routeState.releaseTimer) {
      clearTimer(routeState.releaseTimer)
      routeState.releaseTimer = undefined
    }
    routeState.refs += 1

    const [baseSignature, baseFilter] = Array.from(baseFilters.entries())[0]
    const scopeH = options.scopeH || ""
    const liveCovered = Boolean(scopeH && options.coreCommunityLiveCovered)
    const coordinatorKey = JSON.stringify({
      routeScope,
      relays,
      scopeH,
      baseSignature,
      liveCovered,
    })
    let coordinator = coordinators.get(coordinatorKey)
    if (!coordinator) {
      coordinator = new ActivityCoordinator(
        coordinatorDependencies,
        relays,
        baseFilter,
        routeState.liveSince,
        liveCovered,
      )
      coordinators.set(coordinatorKey, coordinator)
    }

    const unregisterTarget = coordinator.register(options.filters)
    let registered = true

    return () => {
      if (!registered) return
      registered = false

      if (unregisterTarget()) {
        coordinator?.close()
        coordinators.delete(coordinatorKey)
      }

      routeState.refs -= 1
      if (routeState.refs === 0) {
        routeState.releaseTimer = setTimer(() => {
          if (routeState?.refs === 0) routeStates.delete(routeScope)
        }, batchMs)
      }
    }
  }

  const close = () => {
    for (const coordinator of coordinators.values()) coordinator.close()
    for (const routeState of routeStates.values()) {
      if (routeState.releaseTimer) clearTimer(routeState.releaseTimer)
    }
    coordinators.clear()
    routeStates.clear()
  }

  return {register, close}
}

const eventActivityIO = createEventActivityIO({
  request: options => request(options),
  publish: event => repository.publish(event),
  track: (eventId, relay) => tracker.addRelay(eventId, relay),
})

export const registerEventActivity = (options: EventActivityRegistration) =>
  eventActivityIO.register(options)
