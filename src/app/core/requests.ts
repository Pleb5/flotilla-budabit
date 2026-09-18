import {get, writable} from "svelte/store"
import {uniq, int, YEAR, DAY, sleep, insertAt, sortBy, now, on} from "@welshman/lib"
import {
  DELETE,
  EVENT_DATE,
  EVENT_TIME,
  matchFilters,
  getAddress,
  isShareableRelayUrl,
  getRelaysFromList,
  sanitizeRelayUrls,
} from "@welshman/util"
import type {TrustedEvent, Filter, List} from "@welshman/util"
import {feedFromFilters, makeRelayFeed, makeIntersectionFeed} from "@welshman/feeds"
import {request, Tracker, type RequestOptions} from "@welshman/net"
import {repository, makeFeedController, loadRelay, tracker} from "@welshman/app"
import {createScroller} from "@lib/html"
import {daysBetween} from "@lib/util"
import {getEventsForUrl} from "@app/core/state"
import {
  deleteEventsDeleteTarget,
  editedTargetIds,
  isVisibleAfterDeletesAndEdits,
} from "@app/core/event-edits"
import {CALENDAR_EVENT_KINDS, getCalendarEventRange} from "@app/core/calendar-events"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {FINITE_RELAY_ADMISSION_TIMEOUT_MS} from "@app/core/finite-relay-request"

// Utils

const INITIAL_FEED_LOAD_TIMEOUT = 3000
const CALENDAR_REQUEST_TIMEOUT = 3000
const MAX_EMPTY_ADMISSION_SCAN_PAGES = 3
const COMMUNITY_HISTORY_PAGE_SIZE = 100
const COMMUNITY_HISTORY_MAX_PAGES = 3
const COMMUNITY_HISTORY_TIMEOUT_MS = 30_000

const summarizeRepositoryFilters = (filters: Filter[]) =>
  filters.slice(0, 20).map(filter => ({
    keys: Object.keys(filter).sort().slice(0, 20),
    ...(filter.kinds ? {kinds: filter.kinds.slice(0, 20)} : {}),
    ...(filter.authors ? {authors: filter.authors.length} : {}),
    ...(filter.ids ? {ids: filter.ids.length} : {}),
    tags: Object.keys(filter)
      .filter(key => key.startsWith("#"))
      .sort()
      .slice(0, 20),
  }))

const getRepositoryKindRoute = (filters: Filter[], additionalKinds: number[] = []) => {
  if (filters.length === 0 || filters.some(filter => !filter.kinds?.length)) return

  return {
    kinds: Array.from(
      new Set([...additionalKinds, ...filters.flatMap(filter => filter.kinds || [])]),
    ),
  }
}
const COMMUNITY_HISTORY_TAG_CHUNK_SIZE = 100

const filterIncludesKind = (filter: Filter, kind: number) =>
  filter.kinds
    ? filter.kinds.includes(kind)
    : CALENDAR_EVENT_KINDS.includes(kind as (typeof CALENDAR_EVENT_KINDS)[number])

export const makeCalendarDateBasedFilters = (filters: Filter[]): Filter[] =>
  filters.flatMap(filter => {
    if (!filterIncludesKind(filter, EVENT_DATE)) return []

    const {"#D": dayTags, ...dateFilter} = filter
    void dayTags

    return [{...dateFilter, kinds: [EVENT_DATE]}]
  })

export const makeCalendarTimeBasedFilters = (
  filters: Filter[],
  since: number,
  until: number,
): Filter[] => {
  const hashes = daysBetween(since, until).map(String)

  return filters.flatMap(filter =>
    filterIncludesKind(filter, EVENT_TIME) ? [{...filter, kinds: [EVENT_TIME], "#D": hashes}] : [],
  )
}

export type InitialLoadResult = {complete: boolean; timedOut: boolean; saturated?: boolean}

export type BoundedCommunityHistoryResult = {
  events: TrustedEvent[]
  complete: boolean
  timedOut: boolean
  saturated: boolean
}

export type BoundedCommunityHistoryOptions = {
  relays: string[]
  relayFilters: Filter[]
  localFilters: Filter[]
  signal?: AbortSignal
  priority?: number
  owner?: string
  pageSize?: number
  maxPages?: number
  timeoutMs?: number
  /** Exact identity scans may prove an inclusive timestamp boundary before advancing. */
  verifyTimestampBoundaries?: boolean
}

export const makeSameAuthorDeleteFilters = (events: TrustedEvent[]): Filter[] => {
  const targetsByAuthor = new Map<string, {ids: Set<string>; addresses: Set<string>}>()

  for (const event of events) {
    if (!event.id || !event.pubkey) continue

    const targets = targetsByAuthor.get(event.pubkey) || {
      ids: new Set<string>(),
      addresses: new Set<string>(),
    }
    targets.ids.add(event.id)
    if (event.kind >= 30_000 && event.kind < 40_000) targets.addresses.add(getAddress(event))
    targetsByAuthor.set(event.pubkey, targets)
  }

  return Array.from(targetsByAuthor).flatMap(([author, targets]) => {
    const filters: Filter[] = []

    for (const [tagName, values] of [
      ["#e", Array.from(targets.ids)],
      ["#a", Array.from(targets.addresses)],
    ] as const) {
      for (let index = 0; index < values.length; index += COMMUNITY_HISTORY_TAG_CHUNK_SIZE) {
        filters.push({
          kinds: [DELETE],
          authors: [author],
          [tagName]: values.slice(index, index + COMMUNITY_HISTORY_TAG_CHUNK_SIZE),
        } as Filter)
      }
    }

    return filters
  })
}

type CommunityHistoryRequest = (options: RequestOptions) => Promise<unknown>

type BoundedCommunityHistoryDependencies = {
  request: CommunityHistoryRequest
  publish: (event: TrustedEvent) => void
  track: (eventId: string, relay: string) => void
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type CommunityHistoryFilterState = {
  filter: Filter
  cursor?: number
  pages: number
}

type CommunityHistoryPageResult = {
  events: TrustedEvent[]
  complete: boolean
  timedOut: boolean
}

const cloneFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ) as Filter

const makeCommunityHistoryPageFilter = (
  state: CommunityHistoryFilterState,
  pageSize: number,
): Filter => ({
  ...cloneFilter(state.filter),
  limit: pageSize,
  ...(state.cursor === undefined ? {} : {until: state.cursor}),
})

export const createBoundedCommunityHistoryLoader = (
  dependencies: BoundedCommunityHistoryDependencies,
) => {
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = dependencies.clearTimer || (timer => clearTimeout(timer))

  return async ({
    relays,
    relayFilters,
    localFilters,
    signal,
    priority,
    owner,
    pageSize = COMMUNITY_HISTORY_PAGE_SIZE,
    maxPages = COMMUNITY_HISTORY_MAX_PAGES,
    timeoutMs = COMMUNITY_HISTORY_TIMEOUT_MS,
    verifyTimestampBoundaries = false,
  }: BoundedCommunityHistoryOptions): Promise<BoundedCommunityHistoryResult> => {
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
      throw new Error("Community history page size must be a positive integer")
    }
    if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
      throw new Error("Community history page budget must be a positive integer")
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Community history timeout must be a positive number")
    }

    if (localFilters.length === 0 || relayFilters.length === 0) {
      return {events: [], complete: true, timedOut: false, saturated: false}
    }

    const loadRelays = sanitizeRelayUrls(relays)
    if (loadRelays.length === 0 || signal?.aborted) {
      return {events: [], complete: false, timedOut: false, saturated: false}
    }

    const admittedEvents = new Map<string, TrustedEvent>()
    const trackedEventRelays = new Set<string>()

    const admitEvent = (event: TrustedEvent, relay: string) => {
      if (!matchFilters(localFilters, event)) return

      const relayKey = `${event.id}:${relay}`
      if (!trackedEventRelays.has(relayKey)) {
        trackedEventRelays.add(relayKey)
        dependencies.track(event.id, relay)
      }
      if (!admittedEvents.has(event.id)) {
        admittedEvents.set(event.id, event)
        dependencies.publish(event)
      }
    }

    const requestPage = async (
      relay: string,
      filters: Filter[],
    ): Promise<CommunityHistoryPageResult> => {
      if (signal?.aborted) return {events: [], complete: false, timedOut: false}
      const controller = new AbortController()
      const eventsById = new Map<string, TrustedEvent>()
      let sawEose = false
      let interrupted = false
      let timedOut = false
      let started = false
      let terminated = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let resolveTermination: (() => void) | undefined

      const termination = new Promise<void>(resolve => {
        resolveTermination = resolve
      })
      const startTimeout = (delay: number) => {
        if (timer) clearTimer(timer)
        timer = setTimer(() => terminate(true), delay)
      }
      const terminate = (timeout = false) => {
        if (terminated) return
        terminated = true
        timedOut ||= timeout
        resolveTermination?.()
        controller.abort()
      }
      const onCallerAbort = () => terminate()
      const receiveEvent = (event: TrustedEvent, eventRelay: string) => {
        if (controller.signal.aborted || eventsById.has(event.id)) return
        eventsById.set(event.id, event)
        admitEvent(event, eventRelay || relay)
      }

      signal?.addEventListener("abort", onCallerAbort, {once: true})
      startTimeout(Math.max(FINITE_RELAY_ADMISSION_TIMEOUT_MS, timeoutMs))

      const pending = Promise.resolve()
        .then(() =>
          dependencies.request({
            relays: [relay],
            filters,
            autoClose: true,
            lifetime: "finite",
            priority,
            owner,
            signal: controller.signal,
            onStart: () => {
              if (terminated || started) return
              started = true
              startTimeout(timeoutMs)
            },
            onEvent: receiveEvent,
            onDuplicate: receiveEvent,
            onEose: () => {
              sawEose = true
            },
            onClosed: () => {
              interrupted = true
              terminate()
            },
            onDisconnect: () => {
              interrupted = true
              terminate()
            },
          }),
        )
        .then(
          events => {
            if (Array.isArray(events)) {
              for (const event of events) receiveEvent(event as TrustedEvent, relay)
            }
          },
          () => {
            if (!controller.signal.aborted) interrupted = true
          },
        )

      await Promise.race([pending, termination])

      if (timer) clearTimer(timer)
      signal?.removeEventListener("abort", onCallerAbort)

      return {
        events: Array.from(eventsById.values()),
        complete: sawEose && !interrupted && !timedOut && !signal?.aborted,
        timedOut,
      }
    }

    const scanRelay = async (relay: string) => {
      let active: CommunityHistoryFilterState[] = relayFilters.map(
        filter =>
          ({
            filter: cloneFilter(filter),
            cursor: filter.until,
            pages: 0,
          }) satisfies CommunityHistoryFilterState,
      )
      let complete = true
      let timedOut = false
      let saturated = false

      while (active.length > 0 && !signal?.aborted) {
        const pageFilters = active.map(state => makeCommunityHistoryPageFilter(state, pageSize))
        const page = await requestPage(relay, pageFilters)
        timedOut ||= page.timedOut

        if (!page.complete) {
          complete = false
          break
        }

        const nextActive: CommunityHistoryFilterState[] = []
        for (let index = 0; index < active.length; index += 1) {
          const state = active[index]
          const pageFilter = pageFilters[index]
          const rawEvents = page.events.filter(event => matchFilters([pageFilter], event))

          state.pages += 1
          if (rawEvents.length < pageSize) continue

          // `until` is inclusive and Nostr has no secondary cursor. A full page
          // can hide more events at its oldest timestamp, so it is never proof
          // of complete history even when older pages are still useful to scan.
          const oldestTimestamp = Math.min(...rawEvents.map(event => event.created_at))
          if (!Number.isSafeInteger(oldestTimestamp)) {
            saturated = true
            complete = false
            continue
          }

          let boundaryComplete = false
          if (verifyTimestampBoundaries) {
            const boundaryFilter = {
              ...pageFilter,
              since: oldestTimestamp,
              until: oldestTimestamp,
            }
            const boundary = await requestPage(relay, [boundaryFilter])
            timedOut ||= boundary.timedOut
            // A transport failure is retryable; it does not establish that this
            // identity has an unpageable timestamp bucket.
            if (!boundary.complete) return {complete: false, timedOut, saturated}
            boundaryComplete =
              boundary.events.filter(event => matchFilters([boundaryFilter], event)).length <
              pageSize
          }
          if (!boundaryComplete) {
            saturated = true
            complete = false
          }

          const nextCursor = oldestTimestamp - 1
          if (state.filter.since !== undefined && nextCursor < state.filter.since) continue
          if (state.pages >= maxPages) {
            saturated = true
            complete = false
            continue
          }

          state.cursor = nextCursor
          nextActive.push(state)
        }

        active = nextActive
      }

      if (signal?.aborted) complete = false
      return {complete, timedOut, saturated}
    }

    const relayResults = await Promise.all(loadRelays.map(scanRelay))

    return {
      events: Array.from(admittedEvents.values()),
      complete: relayResults.every(result => result.complete),
      timedOut: relayResults.some(result => result.timedOut),
      saturated: relayResults.some(result => result.saturated),
    }
  }
}

export const loadBoundedCommunityHistory = createBoundedCommunityHistoryLoader({
  request: options => request(options),
  publish: event => repository.publish(event),
  track: (eventId, relay) => tracker.addRelay(eventId, relay),
})

const waitForSettled = (promise: Promise<unknown>, timeoutMs: number) =>
  Promise.race<InitialLoadResult>([
    promise.then(
      () => ({complete: true, timedOut: false}),
      () => ({complete: false, timedOut: false}),
    ),
    sleep(timeoutMs).then(() => ({complete: false, timedOut: true})),
  ])

export interface FeedOptions {
  element: HTMLElement
  relays: string[]
  feedFilters: Filter[]
  relayFilters?: Filter[]
  subscriptionFilters?: Filter[]
  initialEvents?: TrustedEvent[]
  initialLoadTimeoutMs?: number
  priority?: number
  owner?: string
  onInitialLoad?: (result: InitialLoadResult) => void
  onExhausted?: () => void
}

export const makeFeed = ({
  element,
  relays,
  feedFilters,
  relayFilters,
  subscriptionFilters,
  initialEvents,
  initialLoadTimeoutMs = INITIAL_FEED_LOAD_TIMEOUT,
  priority,
  owner,
  onInitialLoad,
  onExhausted,
}: FeedOptions) => {
  const seen = new Set<string>()
  const controller = new AbortController()
  const buffer = writable<TrustedEvent[]>([])
  const events = writable<TrustedEvent[]>([])

  let initialLoadComplete = false
  let initialLoadTimeout: ReturnType<typeof setTimeout> | undefined

  const markInitialLoadComplete = (
    result: InitialLoadResult = {complete: true, timedOut: false},
  ) => {
    if (initialLoadComplete || controller.signal.aborted) {
      return
    }

    initialLoadComplete = true
    if (initialLoadTimeout) {
      clearTimeout(initialLoadTimeout)
      initialLoadTimeout = undefined
    }
    onInitialLoad?.(result)
  }

  const markExhausted = () => {
    if (controller.signal.aborted) {
      return
    }

    onExhausted?.()
  }

  initialLoadTimeout = setTimeout(
    () => markInitialLoadComplete({complete: false, timedOut: true}),
    initialLoadTimeoutMs,
  )

  const relaysSet = new Set(sanitizeRelayUrls(relays))
  const liveFilters = subscriptionFilters || feedFilters
  const networkFilters = relayFilters || feedFilters
  // The controller applies its own page limit; limits are not part of the structural feed AST.
  const networkFeedFilters = networkFilters.map(filter => {
    const {limit, ...feedFilter} = filter
    void limit

    return feedFilter
  })
  let admittedEventCount = 0
  let receivedEventCount = 0

  const flushBuffer = (limit = 30) => {
    const $buffer = get(buffer)
    const nextEvents = $buffer.splice(0, limit)

    if (nextEvents.length > 0) {
      events.update($events => [...$events, ...nextEvents])
    }

    return nextEvents.length
  }

  const removeEvents = (predicate: (event: TrustedEvent) => boolean) => {
    buffer.update($buffer => $buffer.filter(event => !predicate(event)))
    events.update($events => $events.filter(event => !predicate(event)))
  }

  const insertEvent = (event: TrustedEvent) => {
    let handled = false

    if (seen.has(event.id) || !isVisibleAfterDeletesAndEdits(event)) {
      return false
    }

    events.update($events => {
      if ($events.length === 0 && initialLoadComplete) {
        handled = true
        return [event]
      }

      for (let i = 0; i < $events.length; i++) {
        if ($events[i].id === event.id) return $events
        if ($events[i].created_at <= event.created_at) {
          handled = true
          return insertAt(i, event, $events)
        }
      }

      return $events
    })

    if (!handled) {
      buffer.update($buffer => {
        for (let i = 0; i < $buffer.length; i++) {
          if ($buffer[i].id === event.id) return $buffer
          if ($buffer[i].created_at < event.created_at) return insertAt(i, event, $buffer)
        }

        return [...$buffer, event]
      })
    }

    seen.add(event.id)
    admittedEventCount += 1
    return true
  }

  const unsubscribeSuppressedEdits = editedTargetIds.subscribe(ids => {
    if (ids.size === 0) return
    removeEvents(event => ids.has(event.id))
  })

  const liveFeedSubscriber = {name: "live-feed", filters: summarizeRepositoryFilters(liveFilters)}
  const onRepositoryUpdate = ({added, removed}: {added: TrustedEvent[]; removed: Set<string>}) => {
    if (removed.size > 0) {
      for (const id of removed) seen.delete(id)
      removeEvents(event => removed.has(event.id))
    }

    const addedEvents = Array.from(added) as TrustedEvent[]
    const deleteEvents = addedEvents.filter(event => event.kind === DELETE)

    if (deleteEvents.length > 0) {
      removeEvents(event => deleteEventsDeleteTarget(deleteEvents, event))
    }

    for (const event of addedEvents) {
      if (!matchFilters(liveFilters, event) || !isVisibleAfterDeletesAndEdits(event)) {
        continue
      }

      const eventRelays = tracker.getRelays(event.id)
      for (const url of eventRelays) {
        if (relaysSet.has(url)) {
          insertEvent(event)
          break
        }
      }
    }
  }
  const liveFeedRoute = getRepositoryKindRoute(liveFilters, [DELETE])
  const unsubscribe = liveFeedRoute
    ? repository.onRoutedUpdate(liveFeedSubscriber, liveFeedRoute, onRepositoryUpdate)
    : repository.onUpdate(liveFeedSubscriber, onRepositoryUpdate)

  // Promote a cached event once a relay actually acknowledges or delivers it.
  const unsubscribeTracker = on(tracker, "add", (id: string, url: string) => {
    if (!relaysSet.has(url)) return

    const event = repository.getEvent(id)
    if (event && matchFilters(liveFilters, event) && isVisibleAfterDeletesAndEdits(event)) {
      insertEvent(event)
    }
  })

  const exhaustedRelays = new Set<string>()

  // One tracker shared across the per-relay controllers and their pages, so an
  // event returned by several relays or overlapping windows is verified and
  // emitted once instead of once per relay request.
  const feedTracker = new Tracker()

  const controllers = relays.map(url =>
    makeFeedController({
      useWindowing: true,
      signal: controller.signal,
      tracker: feedTracker,
      priority,
      owner,
      feed: makeIntersectionFeed(makeRelayFeed(url), feedFromFilters(networkFeedFilters)),
      onEvent: event => {
        receivedEventCount += 1
        if (matchFilters(feedFilters, event)) insertEvent(event)
      },
      onExhausted: () => {
        exhaustedRelays.add(url)
        if (exhaustedRelays.size >= relays.length) {
          markExhausted()
        }
      },
    }),
  )

  const scroller = createScroller({
    element,
    delay: 300,
    threshold: 10_000,
    onScroll: async () => {
      const initialBatchSize = flushBuffer()

      if (initialBatchSize > 0) {
        markInitialLoadComplete()
      }

      const $buffer = get(buffer)

      if ($buffer.length < 100) {
        const admittedBeforeLoad = admittedEventCount
        const receivedBeforeLoad = receivedEventCount
        let result: InitialLoadResult = {complete: true, timedOut: false}
        let scannedPages = 0

        do {
          const receivedBeforePage = receivedEventCount
          result = await waitForSettled(
            Promise.all(controllers.map(ctrl => ctrl.load(100))),
            initialLoadTimeoutMs,
          )
          scannedPages += 1
          if (receivedEventCount === receivedBeforePage) break
        } while (
          result.complete &&
          admittedEventCount === admittedBeforeLoad &&
          exhaustedRelays.size < relays.length &&
          scannedPages < MAX_EMPTY_ADMISSION_SCAN_PAGES
        )

        if (flushBuffer() > 0) {
          markInitialLoadComplete(result)
          return
        }

        const broadScanIncomplete =
          Boolean(relayFilters) &&
          admittedEventCount === admittedBeforeLoad &&
          exhaustedRelays.size < relays.length &&
          result.complete

        markInitialLoadComplete(
          broadScanIncomplete
            ? {
                complete: false,
                timedOut: false,
                ...(receivedEventCount > receivedBeforeLoad ? {saturated: true} : {}),
              }
            : result,
        )
        return
      }

      markInitialLoadComplete()
    },
  })

  if (initialEvents && initialEvents.length > 0) {
    for (const event of [...initialEvents].sort((a, b) => b.created_at - a.created_at)) {
      if (matchFilters(feedFilters, event)) insertEvent(event)
    }
  } else {
    for (const url of relays) {
      for (const event of getEventsForUrl(url, feedFilters)) {
        if (matchFilters(feedFilters, event)) insertEvent(event)
      }
    }
  }

  if (flushBuffer() > 0) {
    markInitialLoadComplete()
  }

  if (relays.length === 0) {
    setTimeout(() => {
      markInitialLoadComplete()
      markExhausted()
    }, 0)
  }

  return {
    events,
    cleanup: () => {
      if (initialLoadTimeout) {
        clearTimeout(initialLoadTimeout)
      }
      unsubscribe()
      unsubscribeTracker()
      unsubscribeSuppressedEdits()
      scroller.stop()
      controller.abort()
    },
  }
}

export const makeCalendarFeed = ({
  url,
  relays,
  filters,
  relayFilters,
  element,
  onInitialLoad,
  onIncomplete,
  onExhausted,
}: {
  url?: string
  relays?: string[]
  filters: Filter[]
  relayFilters?: Filter[]
  element: HTMLElement
  onInitialLoad?: (result: InitialLoadResult) => void
  onIncomplete?: (result: InitialLoadResult) => void
  onExhausted?: () => void
}) => {
  const interval = int(5, DAY)
  const controller = new AbortController()
  const loadRelays = uniq(
    [...(relays || []), ...(url ? [url] : [])].filter((relay): relay is string => Boolean(relay)),
  )
  const networkFilters = relayFilters || filters

  let exhaustedScrollers = 0
  const initialBackwardWindow = [now() - interval, now()] as const
  const initialForwardWindow = [now(), now() + interval] as const
  let backwardWindow = [initialBackwardWindow[0] - interval, initialBackwardWindow[0]]
  let forwardWindow = [initialForwardWindow[1], initialForwardWindow[1] + interval]

  const getRange = (event: TrustedEvent) => getCalendarEventRange(event)
  const getStart = (event: TrustedEvent) => getRange(event)?.start ?? Number.POSITIVE_INFINITY
  const isValidCalendarEvent = (event: TrustedEvent) => {
    const range = getRange(event)

    return Boolean(range && (range.dateBased || range.end !== undefined))
  }

  const getEventsForRelays = () =>
    Array.from(
      new Map(
        loadRelays
          .flatMap(relay => getEventsForUrl(relay, filters))
          .filter(event => isVisibleAfterDeletesAndEdits(event))
          .map(event => [event.id, event]),
      ).values(),
    )

  const initialEvents = sortBy(
    event => -getStart(event),
    getEventsForRelays().filter(isValidCalendarEvent),
  )
  const events = writable(initialEvents)

  const removeEvents = (predicate: (event: TrustedEvent) => boolean) => {
    events.update($events => $events.filter(event => !predicate(event)))
  }

  const insertEvent = (event: TrustedEvent) => {
    const range = getRange(event)
    const address = getAddress(event)

    if (!isVisibleAfterDeletesAndEdits(event)) return
    if (!range || (!range.dateBased && range.end === undefined)) return

    events.update($events => {
      const nextEvents = $events.filter(
        e => e.id !== event.id && (!address || getAddress(e) !== address),
      )

      for (let i = 0; i < nextEvents.length; i++) {
        if (getStart(nextEvents[i]) < range.start) return insertAt(i, event, nextEvents)
      }

      return [...nextEvents, event]
    })
  }

  const unsubscribe = repository.onRoutedUpdate(
    {name: "calendar-feed", filters: summarizeRepositoryFilters(filters)},
    {kinds: [DELETE, ...CALENDAR_EVENT_KINDS]},
    ({added, removed}) => {
      if (removed.size > 0) {
        removeEvents(event => removed.has(event.id))
      }

      const addedEvents = Array.from(added) as TrustedEvent[]
      const deleteEvents = addedEvents.filter(event => event.kind === DELETE)

      if (deleteEvents.length > 0) {
        removeEvents(event => deleteEventsDeleteTarget(deleteEvents, event))
      }

      for (const event of addedEvents) {
        if (matchFilters(filters, event) && isVisibleAfterDeletesAndEdits(event)) {
          insertEvent(event)
        }
      }
    },
  )

  const unsubscribeSuppressedEdits = editedTargetIds.subscribe(ids => {
    if (ids.size === 0) return
    removeEvents(event => ids.has(event.id))
  })

  let initialLoadComplete = false

  const markInitialLoadComplete = (
    result: InitialLoadResult = {complete: true, timedOut: false},
  ) => {
    if (initialLoadComplete || controller.signal.aborted) {
      return
    }

    initialLoadComplete = true
    onInitialLoad?.(result)
  }

  const markExhausted = () => {
    if (controller.signal.aborted) {
      return
    }

    onExhausted?.()
  }

  const loadCalendarFilters = async (
    requestRelayFilters: Filter[],
    requestLocalFilters: Filter[],
  ): Promise<InitialLoadResult> => {
    if (
      requestRelayFilters.length === 0 ||
      requestLocalFilters.length === 0 ||
      loadRelays.length === 0
    ) {
      return {complete: true, timedOut: false}
    }

    try {
      const result = await loadBoundedCommunityHistory({
        relays: loadRelays,
        relayFilters: requestRelayFilters,
        localFilters: requestLocalFilters,
        timeoutMs: CALENDAR_REQUEST_TIMEOUT,
        priority: RELAY_REQUEST_PRIORITY.interactive,
        owner: "calendar-feed",
        signal: controller.signal,
      })

      return {complete: result.complete, timedOut: result.timedOut, saturated: result.saturated}
    } catch {
      return {complete: false, timedOut: false}
    }
  }

  const loadTimeframe = (since: number, until: number) =>
    loadCalendarFilters(
      makeCalendarTimeBasedFilters(networkFilters, since, until),
      makeCalendarTimeBasedFilters(filters, since, until),
    )

  const loadDateBasedEvents = () =>
    loadCalendarFilters(
      makeCalendarDateBasedFilters(networkFilters),
      makeCalendarDateBasedFilters(filters),
    )

  const maybeExhausted = () => {
    if (++exhaustedScrollers === 2) {
      markExhausted()
    }
  }

  const backwardScroller = createScroller({
    element,
    onScroll: async () => {
      const [since, until] = backwardWindow

      backwardWindow = [since - interval, since]

      if (until > now() - int(2, YEAR)) {
        const result = await loadTimeframe(since, until)
        if (!result.complete) onIncomplete?.(result)
      } else {
        backwardScroller.stop()
        maybeExhausted()
      }
    },
  })

  const forwardScroller = createScroller({
    element,
    reverse: true,
    onScroll: async () => {
      const [since, until] = forwardWindow

      forwardWindow = [until, until + interval]

      if (until < now() + int(2, YEAR)) {
        const result = await loadTimeframe(since, until)
        if (!result.complete) onIncomplete?.(result)
      } else {
        forwardScroller.stop()
        maybeExhausted()
      }
    },
  })

  const initialLoad =
    filters.length > 0 && networkFilters.length > 0 && loadRelays.length > 0
      ? Promise.all([
          loadDateBasedEvents(),
          loadTimeframe(...initialBackwardWindow),
          loadTimeframe(...initialForwardWindow),
        ]).then(results => {
          const result: InitialLoadResult = {
            complete: results.every(result => result.complete),
            timedOut: results.some(result => result.timedOut),
            ...(results.some(result => result.saturated) ? {saturated: true} : {}),
          }

          if (!result.complete) onIncomplete?.(result)
          markInitialLoadComplete(result)
        })
      : Promise.resolve().then(() => {
          markInitialLoadComplete()
          markExhausted()
        })

  if (initialEvents.length > 0) {
    markInitialLoadComplete()
  }

  void initialLoad

  return {
    events,
    cleanup: () => {
      backwardScroller.stop()
      forwardScroller.stop()
      controller.abort()
      unsubscribe()
      unsubscribeSuppressedEdits()
    },
  }
}

// Domain specific

export const discoverRelays = (lists: List[]) =>
  Promise.all(
    uniq(lists.flatMap($l => getRelaysFromList($l)))
      .filter(isShareableRelayUrl)
      .map(url => loadRelay(url)),
  )
