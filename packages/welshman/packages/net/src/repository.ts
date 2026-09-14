import {
  DAY,
  flatten,
  pick,
  pushToMapKey,
  pluck,
  sortBy,
  inc,
  uniq,
  omit,
  now,
  range,
} from "@welshman/lib"
import {
  DELETE,
  EPOCH,
  matchFilter,
  isReplaceable,
  getAddress,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"

export const LOCAL_RELAY_URL = "local://welshman.relay/"

const getDay = (ts: number) => Math.floor(ts / DAY)

export let repositorySingleton: Repository

export type RepositoryUpdate = {
  added: TrustedEvent[]
  removed: Set<string>
}

type RepositoryUpdateEnvelope = {
  update: RepositoryUpdate
  affectedKinds: Set<number>
}

type RepositoryUpdateRegistration = {
  id: number
  subscriber: RepositoryUpdateSubscriber
  listener: (update: RepositoryUpdate) => void
  kinds?: Set<number>
}

export type RepositoryUpdateTiming = {
  owner: "singleton" | "repository"
  status: "complete" | "failed"
  startTime: number
  durationMs: number
  added: number
  removed: number
  kinds: number[]
  listeners: number
  registeredListeners: number
  candidateListeners: number
  invokedListeners: number
  fallbackListeners: number
  routedListeners: number
  routingStatus: "known"
  subscribers: RepositoryUpdateSubscriberTiming[]
}

export type RepositoryUpdateSubscriber = {
  name: string
  filters?: RepositoryUpdateSubscriberFilter[]
}

export type RepositoryUpdateRoute = {
  kinds: readonly number[]
}

export type RepositoryUpdateSubscriberFilter = {
  keys: string[]
  kinds?: number[]
  authors?: number
  ids?: number
  tags?: string[]
  limit?: number
  since?: boolean
  until?: boolean
}

export type RepositoryUpdateSubscriberTiming = RepositoryUpdateSubscriber & {
  id: number
  startTime: number
  durationMs: number
}

let repositoryUpdateTimingListener: ((timing: RepositoryUpdateTiming) => void) | undefined

export const setRepositoryUpdateTimingListener = (
  listener: ((timing: RepositoryUpdateTiming) => void) | undefined,
) => {
  repositoryUpdateTimingListener = listener
  return () => {
    if (repositoryUpdateTimingListener === listener) repositoryUpdateTimingListener = undefined
  }
}

export const mergeRepositoryUpdates = (updates: RepositoryUpdate[]): RepositoryUpdate => {
  const added = new Map<string, TrustedEvent>()
  const removed = new Set<string>()

  for (const update of updates) {
    for (const event of update.added) {
      added.set(event.id, event)
      removed.delete(event.id)
    }

    for (const id of update.removed) {
      added.delete(id)
      removed.add(id)
    }
  }

  return {added: Array.from(added.values()), removed}
}

const mergeRepositoryUpdateEnvelopes = (
  envelopes: RepositoryUpdateEnvelope[],
): RepositoryUpdateEnvelope => ({
  update: mergeRepositoryUpdates(envelopes.map(envelope => envelope.update)),
  affectedKinds: new Set(envelopes.flatMap(envelope => Array.from(envelope.affectedKinds))),
})

export class Repository {
  // Optional boundaries for isolated consumers; public repository semantics
  // remain unchanged unless the embedding application installs a guard.
  acceptEvent: (event: TrustedEvent) => boolean = () => true
  constructor(readonly options: {deletionAwareReplaceables?: boolean} = {}) {}
  eventsById = new Map<string, TrustedEvent>()
  eventsByAddress = new Map<string, TrustedEvent>()
  eventsByTag = new Map<string, TrustedEvent[]>()
  eventsByDay = new Map<number, TrustedEvent[]>()
  eventsByAuthor = new Map<string, TrustedEvent[]>()
  eventsByKind = new Map<number, TrustedEvent[]>()
  deletes = new Map<string, {created_at: number; pubkey: string}[]>()
  replaced = new Set<string>()
  expired = new Map<string, number>()
  private batchDepth = 0
  private batchedUpdates: RepositoryUpdateEnvelope[] = []
  private pendingUpdates: RepositoryUpdateEnvelope[] = []
  private emittingUpdate = false
  private pendingUpdateTimer: ReturnType<typeof setTimeout> | undefined
  private updateSubscriberSequence = 0
  private updateSubscribers = new Map<number, RepositoryUpdateRegistration>()
  private fallbackUpdateSubscribers = new Set<number>()
  private updateSubscribersByKind = new Map<number, Set<number>>()
  private deferredEvents = new Map<string, TrustedEvent>()
  private deferredEventTimer: ReturnType<typeof setTimeout> | undefined
  private deferredEventFlushAt = 0
  private deferredEventDelayMs = Infinity
  private deferredEventBatchSize = Infinity

  static get() {
    if (!repositorySingleton) {
      repositorySingleton = new Repository()
    }

    return repositorySingleton
  }

  private registerUpdateListener = (
    subscriber: RepositoryUpdateSubscriber,
    route: RepositoryUpdateRoute | undefined,
    listener: (update: RepositoryUpdate) => void,
  ) => {
    const id = ++this.updateSubscriberSequence
    const kinds = route?.kinds.length ? new Set(route.kinds) : undefined
    const registration = {id, subscriber, listener, kinds}
    this.updateSubscribers.set(id, registration)

    if (kinds) {
      for (const kind of kinds) {
        let registrations = this.updateSubscribersByKind.get(kind)
        if (!registrations) {
          registrations = new Set()
          this.updateSubscribersByKind.set(kind, registrations)
        }
        registrations.add(id)
      }
    } else {
      this.fallbackUpdateSubscribers.add(id)
    }

    return () => {
      if (this.updateSubscribers.get(id) !== registration) return

      this.updateSubscribers.delete(id)
      this.fallbackUpdateSubscribers.delete(id)
      for (const kind of kinds || []) {
        const registrations = this.updateSubscribersByKind.get(kind)
        registrations?.delete(id)
        if (registrations?.size === 0) this.updateSubscribersByKind.delete(kind)
      }
    }
  }

  onUpdate = (
    subscriber: RepositoryUpdateSubscriber,
    listener: (update: RepositoryUpdate) => void,
  ) => this.registerUpdateListener(subscriber, undefined, listener)

  onRoutedUpdate = (
    subscriber: RepositoryUpdateSubscriber,
    route: RepositoryUpdateRoute,
    listener: (update: RepositoryUpdate) => void,
  ) => this.registerUpdateListener(subscriber, route, listener)

  private emitUpdate = (update: RepositoryUpdate, affectedKinds: Iterable<number>) => {
    const envelope = {update, affectedKinds: new Set(affectedKinds)}
    if (this.batchDepth > 0) {
      this.batchedUpdates.push(envelope)
      return
    }

    this.pendingUpdates.push(envelope)
    if (this.emittingUpdate || this.pendingUpdateTimer !== undefined) return

    this.drainPendingUpdates()
  }

  private getUpdateCandidates = (affectedKinds: Set<number>) => {
    const ids = new Set(this.fallbackUpdateSubscribers)
    for (const kind of affectedKinds) {
      for (const id of this.updateSubscribersByKind.get(kind) || []) ids.add(id)
    }

    return Array.from(ids)
      .sort((a, b) => a - b)
      .flatMap(id => {
        const registration = this.updateSubscribers.get(id)
        return registration ? [registration] : []
      })
  }

  private broadcastUpdate = (
    update: RepositoryUpdate,
    candidates: RepositoryUpdateRegistration[],
    timing?: {
      invokedListeners: number
      subscribers: RepositoryUpdateSubscriberTiming[]
    },
  ) => {
    for (const {id, subscriber, listener} of candidates) {
      if (!timing || typeof performance === "undefined") {
        listener(update)
        continue
      }

      timing.invokedListeners++
      const startTime = performance.now()
      try {
        listener(update)
      } finally {
        timing.subscribers.push({
          id,
          ...subscriber,
          startTime,
          durationMs: Math.max(0, performance.now() - startTime),
        })
      }
    }
  }

  private drainPendingUpdates = () => {
    const maxUpdates = 16
    let processed = 0

    this.emittingUpdate = true
    try {
      let pending: RepositoryUpdateEnvelope | undefined
      while (processed < maxUpdates && (pending = this.pendingUpdates.shift())) {
        processed++
        const candidates = this.getUpdateCandidates(pending.affectedKinds)
        const timingListener = repositoryUpdateTimingListener
        if (!timingListener || typeof performance === "undefined") {
          this.broadcastUpdate(pending.update, candidates)
          continue
        }

        const startTime = performance.now()
        const registeredListeners = this.updateSubscribers.size
        const fallbackListeners = this.fallbackUpdateSubscribers.size
        const routedListeners = registeredListeners - fallbackListeners
        const candidateListeners = candidates.length
        const timing = {invokedListeners: 0, subscribers: [] as RepositoryUpdateSubscriberTiming[]}
        let emissionError: unknown
        let emissionFailed = false
        try {
          this.broadcastUpdate(pending.update, candidates, timing)
        } catch (error) {
          emissionError = error
          emissionFailed = true
        }
        const durationMs = Math.max(0, performance.now() - startTime)
        try {
          timingListener({
            owner: this === repositorySingleton ? "singleton" : "repository",
            status: emissionFailed ? "failed" : "complete",
            startTime,
            durationMs,
            added: pending.update.added.length,
            removed: pending.update.removed.size,
            kinds: Array.from(pending.affectedKinds).slice(0, 20),
            listeners: registeredListeners,
            registeredListeners,
            candidateListeners,
            invokedListeners: timing.invokedListeners,
            fallbackListeners,
            routedListeners,
            routingStatus: "known",
            subscribers: timing.subscribers,
          })
        } catch (error) {
          if (!emissionFailed) throw error
        }
        if (emissionFailed) throw emissionError
      }
    } finally {
      this.emittingUpdate = false
      if (this.pendingUpdates.length > 0 && this.pendingUpdateTimer === undefined) {
        this.pendingUpdateTimer = setTimeout(() => {
          this.pendingUpdateTimer = undefined
          this.drainPendingUpdates()
        }, 0)
      }
    }
  }

  private scheduleDeferredEventFlush = (delayMs = this.deferredEventDelayMs) => {
    if (this.deferredEvents.size === 0) return

    const flushAt = Date.now() + delayMs
    if (this.deferredEventTimer !== undefined) {
      if (flushAt >= this.deferredEventFlushAt) return
      clearTimeout(this.deferredEventTimer)
    }

    this.deferredEventFlushAt = flushAt
    this.deferredEventTimer = setTimeout(() => {
      this.deferredEventTimer = undefined
      this.deferredEventFlushAt = 0
      this.flushDeferredEvents(this.deferredEventBatchSize)
    }, delayMs)
  }

  private flushDeferredEvents = (limit = Infinity) => {
    if (this.deferredEventTimer !== undefined) {
      clearTimeout(this.deferredEventTimer)
      this.deferredEventTimer = undefined
      this.deferredEventFlushAt = 0
    }
    if (this.deferredEvents.size === 0) return

    const events: TrustedEvent[] = []
    for (const [id, event] of this.deferredEvents) {
      events.push(event)
      this.deferredEvents.delete(id)
      if (events.length >= limit) break
    }

    try {
      this.batch(() => events.forEach(event => this.publishNow(event, true)))
    } finally {
      if (this.deferredEvents.size > 0) {
        this.scheduleDeferredEventFlush()
      } else {
        this.deferredEventDelayMs = Infinity
        this.deferredEventBatchSize = Infinity
      }
    }
  }

  private deferEvent = (event: TrustedEvent, delayMs: number, maxBatchSize: number) => {
    if (!event?.id) {
      console.warn("Attempted to publish invalid event to repository", event)
      return false
    }
    if (this.eventsById.has(event.id) || this.deferredEvents.has(event.id)) return false

    const boundedDelayMs = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0)
    const boundedBatchSize = Number.isFinite(maxBatchSize)
      ? Math.max(1, Math.floor(maxBatchSize))
      : Infinity
    this.deferredEvents.set(event.id, event)
    this.deferredEventDelayMs = Math.min(this.deferredEventDelayMs, boundedDelayMs)
    this.deferredEventBatchSize = Math.min(this.deferredEventBatchSize, boundedBatchSize)
    this.scheduleDeferredEventFlush(this.deferredEventDelayMs)
    return true
  }

  private cancelDeferredEvent = (id: string) => {
    this.deferredEvents.delete(id)
    if (this.deferredEvents.size > 0) return

    if (this.deferredEventTimer !== undefined) clearTimeout(this.deferredEventTimer)
    this.deferredEventTimer = undefined
    this.deferredEventFlushAt = 0
    this.deferredEventDelayMs = Infinity
    this.deferredEventBatchSize = Infinity
  }

  private takeDeferredEvents = () => {
    const events = Array.from(this.deferredEvents.values())
    this.deferredEvents.clear()
    if (this.deferredEventTimer !== undefined) clearTimeout(this.deferredEventTimer)
    this.deferredEventTimer = undefined
    this.deferredEventFlushAt = 0
    this.deferredEventDelayMs = Infinity
    this.deferredEventBatchSize = Infinity
    return events
  }

  private publishNow = (event: TrustedEvent, shouldNotify: boolean): boolean => {
    if (!this.acceptEvent(event)) return false
    if (!event?.id) {
      console.warn("Attempted to publish invalid event to repository", event)

      return false
    }

    // If we've already seen this event we're done
    if (this.eventsById.get(event.id)) {
      return false
    }

    const removed = new Set<string>()
    const address = getAddress(event)
    const duplicate = this.eventsByAddress.get(address)

    if (duplicate) {
      // If our event is younger than the duplicate, we're done
      if (event.created_at < duplicate.created_at) {
        return false
      }
      if (
        this.options.deletionAwareReplaceables &&
        event.created_at === duplicate.created_at &&
        event.id > duplicate.id
      )
        return false

      // If our event is newer than what it's replacing, delete the old version
      pushToMapKey(this.deletes, duplicate.id, pick(["pubkey", "created_at"], event))
      this.replaced.add(duplicate.id)

      // Notify listeners that it's been removed
      removed.add(duplicate.id)
    }

    // Add our new event by id
    this.eventsById.set(event.id, event)

    // Add our new event by address
    if (isReplaceable(event)) {
      this.eventsByAddress.set(address, event)
    }

    // Update our timestamp and author indexes
    this._updateIndex(this.eventsByDay, getDay(event.created_at), event, duplicate)
    this._updateIndex(this.eventsByAuthor, event.pubkey, event, duplicate)
    this._updateIndex(this.eventsByKind, event.kind, event, duplicate)

    // Update our tag indexes
    for (const tag of event.tags) {
      if (tag[0]?.length === 1) {
        this._updateIndex(this.eventsByTag, tag.slice(0, 2).join(":"), event, duplicate)

        // If this is a delete event, the tag value is an id or address. Track when it was
        // deleted so that replaceables can be restored.
        if (event.kind === DELETE && ["a", "e"].includes(tag[0]) && tag[1]) {
          pushToMapKey(this.deletes, tag[1], pick(["pubkey", "created_at"], event))

          const deletedEvent = this.getEvent(tag[1])
          if (deletedEvent && this.isDeleted(deletedEvent)) {
            removed.add(deletedEvent.id)
          }
        }
      }

      // Keep track of whether this event is expired
      if (tag[0] === "expiration") {
        const expiration = parseInt(tag[1] || "")
        if (!isNaN(expiration)) {
          this.expired.set(event.id, expiration)
        }
      }
    }

    // Notify, but only if the event hasn't been deleted
    if (shouldNotify && !this.isDeleted(event)) {
      const affectedKinds = new Set([event.kind])
      if (duplicate && removed.has(duplicate.id)) affectedKinds.add(duplicate.kind)
      for (const id of removed) {
        const removedEvent = this.eventsById.get(id)
        if (removedEvent) affectedKinds.add(removedEvent.kind)
      }
      this.emitUpdate({added: [event], removed}, affectedKinds)
    }

    return true
  }

  batch = <T>(callback: () => T): T => {
    this.batchDepth++
    try {
      return callback()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0 && this.batchedUpdates.length > 0) {
        const envelope = mergeRepositoryUpdateEnvelopes(this.batchedUpdates)
        this.batchedUpdates = []
        this.emitUpdate(envelope.update, envelope.affectedKinds)
      }
    }
  }

  // Dump/load/clear

  dump = () => {
    return Array.from(this.eventsById.values())
  }

  clear = () => {
    this.takeDeferredEvents() // clearing must not flush delayed private intake
    this.load([])
  }

  load = (events: TrustedEvent[]) => {
    const eventsWithDeferred = [...events, ...this.takeDeferredEvents()]
    const stale = new Set(this.eventsById.keys())
    const staleKindsById = new Map(
      Array.from(this.eventsById, ([id, event]) => [id, event.kind] as const),
    )

    this.eventsById.clear()
    this.eventsByAddress.clear()
    this.eventsByTag.clear()
    this.eventsByDay.clear()
    this.eventsByAuthor.clear()
    this.eventsByKind.clear()
    this.deletes.clear()
    this.replaced.clear()
    this.expired.clear()

    const added = []

    for (const event of eventsWithDeferred) {
      if (this.publish(event, {shouldNotify: false})) {
        // Don't send duplicate events to subscribers
        if (!stale.has(event.id)) {
          added.push(event)
        }
      }
    }

    const removed = new Set<string>()

    // Anything we had before clearing the repository has been removed
    for (const id of stale) {
      if (!this.eventsById.has(id)) {
        removed.add(id)
      }
    }

    // Anything removed via delete or replace has been removed
    for (const idOrAddress of this.deletes.keys()) {
      const event = this.getEvent(idOrAddress)

      if (event && this.isDeleted(event)) {
        removed.add(event.id)
      }
    }

    // Anything expired has been removed
    for (const id of this.expired.keys()) {
      removed.add(id)
    }

    const update = mergeRepositoryUpdates([{added, removed}])
    const affectedKinds = new Set(update.added.map(event => event.kind))
    for (const id of update.removed) {
      const currentKind = this.eventsById.get(id)?.kind
      const staleKind = staleKindsById.get(id)
      if (currentKind !== undefined) affectedKinds.add(currentKind)
      if (staleKind !== undefined) affectedKinds.add(staleKind)
    }
    this.emitUpdate(update, affectedKinds)
  }

  // API

  getEvent = (idOrAddress: string) => {
    return idOrAddress.includes(":")
      ? this.eventsByAddress.get(idOrAddress)
      : this.eventsById.get(idOrAddress)
  }

  hasEvent = (event: TrustedEvent) => {
    const duplicate = this.eventsById.get(event.id) || this.eventsByAddress.get(getAddress(event))

    return duplicate && duplicate.created_at >= event.created_at
  }

  removeEvent = (idOrAddress: string) => {
    for (const [id, event] of this.deferredEvents) {
      if (id === idOrAddress || getAddress(event) === idOrAddress) this.cancelDeferredEvent(id)
    }
    const event = this.getEvent(idOrAddress)

    if (event) {
      this.eventsById.delete(event.id)
      this.eventsByAddress.delete(getAddress(event))

      for (const [k, v] of event.tags) {
        if (k.length === 1) {
          this._updateIndex(this.eventsByTag, `${k}:${v}`, undefined, event)
        }
      }

      this._updateIndex(this.eventsByDay, getDay(event.created_at), undefined, event)
      this._updateIndex(this.eventsByAuthor, event.pubkey, undefined, event)
      this._updateIndex(this.eventsByKind, event.kind, undefined, event)

      this.emitUpdate({added: [], removed: new Set([event.id])}, [event.kind])
    }
  }

  query = (
    filters: Filter[],
    {includeDeleted = false, includeExpired = false, shouldSort = true} = {},
  ) => {
    const result: TrustedEvent[][] = []
    for (const originalFilter of filters) {
      // Attempt to fulfill the query using one of our indexes. Fall back to all events.
      const applied = this._applyAnyFilter(originalFilter)
      const filter = applied?.filter || originalFilter
      const events = applied ? this._getEvents(applied!.ids) : this.dump()
      const sorted = this._sortEvents(shouldSort || Boolean(filter.limit), events)

      const chunk: TrustedEvent[] = []
      for (const event of sorted) {
        if (filter.limit && chunk.length >= filter.limit) {
          break
        }

        if (!includeDeleted && this.isDeleted(event)) {
          continue
        }

        if (!includeExpired && this.isExpired(event)) {
          continue
        }

        if (matchFilter(filter, event)) {
          chunk.push(event)
        }
      }

      result.push(chunk)
    }

    // Only re-sort if we had multiple filters, or if our single filter wasn't sorted
    const shouldSortAll = shouldSort && (filters.length > 1 || !filters[0]?.limit)

    return this._sortEvents(shouldSortAll, uniq(flatten(result)))
  }

  publish = (
    event: TrustedEvent,
    {
      shouldNotify = true,
      deferMs,
      maxBatchSize = Infinity,
    }: {shouldNotify?: boolean; deferMs?: number; maxBatchSize?: number} = {},
  ): boolean => {
    if (deferMs !== undefined && shouldNotify) {
      return this.deferEvent(event, deferMs, maxBatchSize)
    }
    if (event?.id) this.cancelDeferredEvent(event.id)
    return this.publishNow(event, shouldNotify)
  }

  _isDeleted = (key: string, event: TrustedEvent) => {
    for (const {pubkey, created_at} of this.deletes.get(key) || []) {
      if (
        pubkey === event.pubkey &&
        (this.options.deletionAwareReplaceables
          ? created_at >= event.created_at
          : created_at > event.created_at)
      ) {
        return true
      }
    }

    return false
  }

  isDeletedByAddress = (event: TrustedEvent) => this._isDeleted(getAddress(event), event)

  isDeletedById = (event: TrustedEvent) =>
    this.replaced.has(event.id) ||
    (this.options.deletionAwareReplaceables
      ? (this.deletes.get(event.id) || []).some(deleteEvent => deleteEvent.pubkey === event.pubkey)
      : !isReplaceable(event) && this._isDeleted(event.id, event))

  isDeleted = (event: TrustedEvent) => this.isDeletedById(event) || this.isDeletedByAddress(event)

  isExpired = (event: TrustedEvent) => {
    const ts = this.expired.get(event.id)

    return Boolean(ts && ts < now())
  }

  // Utilities

  _sortEvents = (shouldSort: boolean, events: TrustedEvent[]) =>
    shouldSort ? sortBy(e => -e.created_at, events) : events

  _updateIndex = <K>(
    m: Map<K, TrustedEvent[]>,
    k: K,
    add?: TrustedEvent,
    remove?: TrustedEvent,
  ) => {
    let a = m.get(k) || []

    if (remove) {
      a = a.filter((x: TrustedEvent) => x !== remove)
    }

    if (add) {
      a.push(add)
    }

    if (a.length > 0) {
      m.set(k, a)
    } else {
      m.delete(k)
    }
  }

  _getEvents = (ids: Iterable<string>) => {
    const events: TrustedEvent[] = []

    for (const id of ids) {
      const event = this.eventsById.get(id)

      if (event) {
        events.push(event)
      }
    }

    return events
  }

  _applyIdsFilter = (filter: Filter) => {
    if (!filter.ids) return undefined

    return {
      filter: omit(["ids"], filter),
      ids: new Set(filter.ids),
    }
  }

  _applyAuthorsFilter = (filter: Filter) => {
    if (!filter.authors) return undefined

    const events = filter.authors.flatMap(pubkey => this.eventsByAuthor.get(pubkey) || [])

    return {
      filter: omit(["authors"], filter),
      ids: new Set(pluck<string>("id", events)),
    }
  }

  _applyTagsFilter = (filter: Filter) => {
    for (const [k, values] of Object.entries(filter)) {
      if (!k.startsWith("#") || k.length !== 2) {
        continue
      }

      const ids = new Set<string>()

      for (const v of values as string[]) {
        for (const event of this.eventsByTag.get(`${k[1]}:${v}`) || []) {
          ids.add(event.id)
        }
      }

      return {filter: omit([k], filter), ids}
    }

    return undefined
  }

  _applyKindsFilter = (filter: Filter) => {
    if (!filter.kinds) return undefined

    const events = filter.kinds.flatMap(kind => this.eventsByKind.get(kind) || [])

    return {
      filter: omit(["kinds"], filter),
      ids: new Set(pluck<string>("id", events)),
    }
  }

  _applyDaysFilter = (filter: Filter) => {
    if (!filter.since && !filter.until) return undefined

    const sinceDay = getDay(filter.since || EPOCH)
    const untilDay = getDay(filter.until || now())
    const days = Array.from(range(sinceDay, inc(untilDay)))
    const events = days.flatMap((day: number) => this.eventsByDay.get(day) || [])
    const ids = new Set(pluck<string>("id", events))

    return {filter, ids}
  }

  _applyAnyFilter = (filter: Filter) => {
    const matchers = [
      this._applyIdsFilter,
      this._applyAuthorsFilter,
      this._applyTagsFilter,
      this._applyKindsFilter,
      this._applyDaysFilter,
    ]

    for (const matcher of matchers) {
      const result = matcher(filter)

      if (result) {
        return result
      }
    }

    return undefined
  }
}
