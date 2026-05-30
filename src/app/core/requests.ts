import {get, writable} from "svelte/store"
import {
  uniq,
  int,
  YEAR,
  DAY,
  sleep,
  insertAt,
  sortBy,
  now,
  on,
  isDefined,
  filterVals,
  fromPairs,
} from "@welshman/lib"
import {
  DELETE,
  EVENT_TIME,
  RELAY_INVITE,
  ALERT_EMAIL,
  ALERT_WEB,
  ALERT_IOS,
  ALERT_ANDROID,
  ALERT_STATUS,
  matchFilters,
  getTagValue,
  getAddress,
  isShareableRelayUrl,
  getRelaysFromList,
} from "@welshman/util"
import type {TrustedEvent, Filter, List} from "@welshman/util"
import {feedFromFilters, makeRelayFeed, makeIntersectionFeed} from "@welshman/feeds"
import {load, request} from "@welshman/net"
import {repository, makeFeedController, loadRelay, tracker} from "@welshman/app"
import {createScroller} from "@lib/html"
import {daysBetween} from "@lib/util"
import {NOTIFIER_RELAY, getEventsForUrl} from "@app/core/state"
import {
  deleteEventsDeleteTarget,
  editedTargetIds,
  isVisibleAfterDeletesAndEdits,
} from "@app/core/event-edits"

// Utils

const INITIAL_FEED_LOAD_TIMEOUT = 3000
const CALENDAR_REQUEST_TIMEOUT = 3000

const waitForSettled = async (promise: Promise<unknown>, timeoutMs: number) => {
  await Promise.race([Promise.allSettled([promise]), sleep(timeoutMs)])
}

const withTimeoutSignal = (signal: AbortSignal, timeoutMs: number) =>
  AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])

export interface FeedOptions {
  element: HTMLElement
  relays: string[]
  feedFilters: Filter[]
  subscriptionFilters?: Filter[]
  initialEvents?: TrustedEvent[]
  onInitialLoad?: () => void
  onExhausted?: () => void
}

export const makeFeed = ({
  element,
  relays,
  feedFilters,
  subscriptionFilters,
  initialEvents,
  onInitialLoad,
  onExhausted,
}: FeedOptions) => {
  const seen = new Set<string>()
  const controller = new AbortController()
  const buffer = writable<TrustedEvent[]>([])
  const events = writable<TrustedEvent[]>([])

  let initialLoadComplete = false
  let initialLoadTimeout: ReturnType<typeof setTimeout> | undefined

  const markInitialLoadComplete = () => {
    if (initialLoadComplete || controller.signal.aborted) {
      return
    }

    initialLoadComplete = true
    if (initialLoadTimeout) {
      clearTimeout(initialLoadTimeout)
      initialLoadTimeout = undefined
    }
    onInitialLoad?.()
  }

  const markExhausted = () => {
    if (controller.signal.aborted) {
      return
    }

    onExhausted?.()
  }

  initialLoadTimeout = setTimeout(markInitialLoadComplete, INITIAL_FEED_LOAD_TIMEOUT)

  const relaysSet = new Set(relays)
  const liveFilters = subscriptionFilters || feedFilters

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
      return
    }

    events.update($events => {
      for (let i = 0; i < $events.length; i++) {
        if ($events[i].id === event.id) return $events
        if ($events[i].created_at < event.created_at) {
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
  }

  const unsubscribeSuppressedEdits = editedTargetIds.subscribe(ids => {
    if (ids.size === 0) return
    removeEvents(event => ids.has(event.id))
  })

  const unsubscribe = on(repository, "update", ({added, removed}) => {
    if (removed.size > 0) {
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
  })

  let exhausted = 0

  const controllers = relays.map(url =>
    makeFeedController({
      useWindowing: true,
      signal: controller.signal,
      feed: makeIntersectionFeed(makeRelayFeed(url), feedFromFilters(feedFilters)),
      onExhausted: () => {
        exhausted += 1
        if (exhausted >= relays.length) {
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
        await waitForSettled(
          Promise.all(controllers.map(ctrl => ctrl.load(100))),
          INITIAL_FEED_LOAD_TIMEOUT,
        )
      }

      markInitialLoadComplete()
    },
  })

  if (initialEvents && initialEvents.length > 0) {
    for (const event of [...initialEvents].sort((a, b) => b.created_at - a.created_at)) {
      insertEvent(event)
    }
  } else {
    for (const url of relays) {
      for (const event of getEventsForUrl(url, feedFilters)) {
        insertEvent(event)
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
  element,
  onInitialLoad,
  onExhausted,
}: {
  url?: string
  relays?: string[]
  filters: Filter[]
  element: HTMLElement
  onInitialLoad?: () => void
  onExhausted?: () => void
}) => {
  const interval = int(5, DAY)
  const controller = new AbortController()
  const loadRelays = uniq(
    [...(relays || []), ...(url ? [url] : [])].filter((relay): relay is string => Boolean(relay)),
  )

  let exhaustedScrollers = 0
  const initialBackwardWindow = [now() - interval, now()] as const
  const initialForwardWindow = [now(), now() + interval] as const
  let backwardWindow = [initialBackwardWindow[0] - interval, initialBackwardWindow[0]]
  let forwardWindow = [initialForwardWindow[1], initialForwardWindow[1] + interval]

  const getStart = (event: TrustedEvent) => parseInt(getTagValue("start", event.tags) || "")

  const getEnd = (event: TrustedEvent) => parseInt(getTagValue("end", event.tags) || "")

  const getEventsForRelays = () =>
    Array.from(
      new Map(
        loadRelays
          .flatMap(relay => getEventsForUrl(relay, filters))
          .filter(event => isVisibleAfterDeletesAndEdits(event))
          .map(event => [event.id, event]),
      ).values(),
    )

  const makeTimeframeFilters = (since: number, until: number): Filter[] => {
    const hashes = daysBetween(since, until).map(String)

    return filters.flatMap(filter => {
      if (filter.kinds && !filter.kinds.includes(EVENT_TIME)) return []

      return [{...filter, kinds: filter.kinds || [EVENT_TIME], "#D": hashes}]
    })
  }

  const initialEvents = sortBy(getStart, getEventsForRelays())
  const events = writable(initialEvents)

  const removeEvents = (predicate: (event: TrustedEvent) => boolean) => {
    events.update($events => $events.filter(event => !predicate(event)))
  }

  const insertEvent = (event: TrustedEvent) => {
    const start = getStart(event)
    const address = getAddress(event)

    if (!isVisibleAfterDeletesAndEdits(event)) return
    if (isNaN(start) || isNaN(getEnd(event))) return

    events.update($events => {
      const nextEvents = $events.filter(
        e => e.id !== event.id && (!address || getAddress(e) !== address),
      )

      for (let i = 0; i < nextEvents.length; i++) {
        if (getStart(nextEvents[i]) > start) return insertAt(i, event, nextEvents)
      }

      return [...nextEvents, event]
    })
  }

  const unsubscribe = on(repository, "update", ({added, removed}) => {
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
  })

  const unsubscribeSuppressedEdits = editedTargetIds.subscribe(ids => {
    if (ids.size === 0) return
    removeEvents(event => ids.has(event.id))
  })

  let initialLoadComplete = false

  const markInitialLoadComplete = () => {
    if (initialLoadComplete || controller.signal.aborted) {
      return
    }

    initialLoadComplete = true
    onInitialLoad?.()
  }

  const markExhausted = () => {
    if (controller.signal.aborted) {
      return
    }

    onExhausted?.()
  }

  const loadTimeframe = async (since: number, until: number) => {
    const timeframeFilters = makeTimeframeFilters(since, until)
    if (timeframeFilters.length === 0 || loadRelays.length === 0) return

    await request({
      relays: loadRelays,
      autoClose: true,
      signal: withTimeoutSignal(controller.signal, CALENDAR_REQUEST_TIMEOUT),
      filters: timeframeFilters,
    })
  }

  const maybeExhausted = () => {
    if (++exhaustedScrollers === 2) {
      markExhausted()
    }
  }

  const backwardScroller = createScroller({
    element,
    reverse: true,
    onScroll: async () => {
      const [since, until] = backwardWindow

      backwardWindow = [since - interval, since]

      if (until > now() - int(2, YEAR)) {
        await loadTimeframe(since, until)
      } else {
        backwardScroller.stop()
        maybeExhausted()
      }
    },
  })

  const forwardScroller = createScroller({
    element,
    onScroll: async () => {
      const [since, until] = forwardWindow

      forwardWindow = [until, until + interval]

      if (until < now() + int(2, YEAR)) {
        await loadTimeframe(since, until)
      } else {
        forwardScroller.stop()
        maybeExhausted()
      }
    },
  })

  const initialLoad =
    filters.length > 0 && loadRelays.length > 0
      ? Promise.allSettled([
          loadTimeframe(...initialBackwardWindow),
          loadTimeframe(...initialForwardWindow),
        ]).finally(markInitialLoadComplete)
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

const ALERTS_ENABLED = typeof __ALERTS__ !== "undefined" && __ALERTS__

export const loadAlerts = (pubkey: string) =>
  ALERTS_ENABLED
    ? request({
        autoClose: true,
        relays: [NOTIFIER_RELAY],
        filters: [{kinds: [ALERT_EMAIL, ALERT_WEB, ALERT_IOS, ALERT_ANDROID], authors: [pubkey]}],
      })
    : Promise.resolve([])

export const loadAlertStatuses = (pubkey: string) =>
  ALERTS_ENABLED
    ? request({
        autoClose: true,
        relays: [NOTIFIER_RELAY],
        filters: [{kinds: [ALERT_STATUS], "#p": [pubkey]}],
      })
    : Promise.resolve([])

export const discoverRelays = (lists: List[]) =>
  Promise.all(
    uniq(lists.flatMap($l => getRelaysFromList($l)))
      .filter(isShareableRelayUrl)
      .map(url => loadRelay(url)),
  )

export const requestRelayClaim = async (url: string) => {
  const filters = [{kinds: [RELAY_INVITE], limit: 1}]
  const events = await load({filters, relays: [url]})

  if (events.length > 0) {
    return getTagValue("claim", events[0].tags)
  }
}

export const requestRelayClaims = async (urls: string[]) =>
  filterVals(
    isDefined,
    fromPairs(await Promise.all(urls.map(async url => [url, await requestRelayClaim(url)]))),
  )
