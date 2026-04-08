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

  const insertEvent = (event: TrustedEvent) => {
    let handled = false

    if (seen.has(event.id)) {
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

  const unsubscribe = on(repository, "update", ({added, removed}) => {
    if (removed.size > 0) {
      buffer.update($buffer => $buffer.filter(e => !removed.has(e.id)))
      events.update($events => $events.filter(e => !removed.has(e.id)))
    }

    for (const event of added) {
      if (!matchFilters(liveFilters, event)) {
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
      scroller.stop()
      controller.abort()
    },
  }
}

export const makeCalendarFeed = ({
  url,
  filters,
  element,
  onInitialLoad,
  onExhausted,
}: {
  url: string
  filters: Filter[]
  element: HTMLElement
  onInitialLoad?: () => void
  onExhausted?: () => void
}) => {
  const interval = int(5, DAY)
  const controller = new AbortController()

  let exhaustedScrollers = 0
  const initialBackwardWindow = [now() - interval, now()] as const
  const initialForwardWindow = [now(), now() + interval] as const
  let backwardWindow = [initialBackwardWindow[0] - interval, initialBackwardWindow[0]]
  let forwardWindow = [initialForwardWindow[1], initialForwardWindow[1] + interval]

  const getStart = (event: TrustedEvent) => parseInt(getTagValue("start", event.tags) || "")

  const getEnd = (event: TrustedEvent) => parseInt(getTagValue("end", event.tags) || "")

  const initialEvents = sortBy(getStart, getEventsForUrl(url, filters))
  const events = writable(initialEvents)

  const insertEvent = (event: TrustedEvent) => {
    const start = getStart(event)
    const address = getAddress(event)

    if (isNaN(start) || isNaN(getEnd(event))) return

    events.update($events => {
      for (let i = 0; i < $events.length; i++) {
        if ($events[i].id === event.id) return $events
        if (getStart($events[i]) > start) return insertAt(i, event, $events)
      }

      return [...$events.filter(e => getAddress(e) !== address), event]
    })
  }

  const unsubscribe = on(repository, "update", ({added, removed}) => {
    if (removed.size > 0) {
      events.update($events => $events.filter(e => !removed.has(e.id)))
    }

    for (const event of added) {
      if (matchFilters(filters, event)) {
        insertEvent(event)
      }
    }
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
    const hashes = daysBetween(since, until).map(String)

    await request({
      relays: [url],
      autoClose: true,
      signal: withTimeoutSignal(controller.signal, CALENDAR_REQUEST_TIMEOUT),
      filters: [{kinds: [EVENT_TIME], "#D": hashes}],
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

  const initialLoad = Promise.allSettled([
    loadTimeframe(...initialBackwardWindow),
    loadTimeframe(...initialForwardWindow),
  ]).finally(markInitialLoadComplete)

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
    },
  }
}

// Domain specific

export const loadAlerts = (pubkey: string) =>
  request({
    autoClose: true,
    relays: [NOTIFIER_RELAY],
    filters: [{kinds: [ALERT_EMAIL, ALERT_WEB, ALERT_IOS, ALERT_ANDROID], authors: [pubkey]}],
  })

export const loadAlertStatuses = (pubkey: string) =>
  request({
    autoClose: true,
    relays: [NOTIFIER_RELAY],
    filters: [{kinds: [ALERT_STATUS], "#p": [pubkey]}],
  })

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
