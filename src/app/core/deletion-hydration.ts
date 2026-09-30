import {
  DELETE,
  getAddress,
  isReplaceable,
  matchFilter,
  sanitizeRelayUrls,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import type {FiniteRelayRequestOptions, FiniteRelayResult} from "./finite-relay-request"

export const DELETE_TARGET_CHUNK_SIZE = 100
const PAGE_SIZE = 100
const MAX_PAGE_SIZE = 800
const MAX_CONCURRENT = 2
const REFRESH_MS = 60_000
const MAX_RETAINED_SCOPES = 24

/** Target authors are checked by the repository, not expanded into relay filters. */
export const makeDeletionTargetFilters = (events: TrustedEvent[]): Filter[] => {
  const ids = new Set<string>()
  const addresses = new Set<string>()
  for (const event of events) {
    if (!event.id || !event.pubkey || event.kind === DELETE) continue
    if (isReplaceable(event)) addresses.add(getAddress(event))
    else ids.add(event.id)
  }
  return (
    [
      ["#e", ids],
      ["#a", addresses],
    ] as const
  ).flatMap(([tag, values]) => {
    const sorted = [...values].sort()
    const filters: Filter[] = []
    for (let index = 0; index < sorted.length; index += DELETE_TARGET_CHUNK_SIZE) {
      filters.push({
        kinds: [DELETE],
        [tag]: sorted.slice(index, index + DELETE_TARGET_CHUNK_SIZE),
      } as Filter)
    }
    return filters
  })
}

export type DeletionDemand = {
  /** Include the account and exact community/repository identity. */
  scope: string
  navigation: string
  relays: string[]
  filters?: Filter[]
  targets?: TrustedEvent[]
  priority?: number
}

type Read = {
  relay: string
  filter: Filter
  wanted: boolean
  through?: number
  head?: number
  until?: number
  limit: number
  due: number
  failures: number
  turn: number
  status: "pending" | "complete" | "partial"
  controller?: AbortController
}
type Scope = {
  navigation: string
  demands: Map<symbol, DeletionDemand>
  reads: Read[]
  touched: number
  dirty: boolean
}
type Dependencies = {
  request: (options: FiniteRelayRequestOptions) => Promise<FiniteRelayResult>
  receive: (event: TrustedEvent, relay: string) => void
  now?: () => number
  getPageLimit?: (relay: string) => number
}

const filterKey = (filter: Filter) =>
  JSON.stringify(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)))

/** Lazy, session-only coverage. Each relay must finish its own history, independently.
 * No request is made until a foreground consumer registers demand. */
export const createDeletionHydration = (dependencies: Dependencies) => {
  const now = dependencies.now || Date.now
  const scopes = new Map<string, Scope>()
  const jobs = new Set<Read>()
  let active = true
  let disposed = false
  let sequence = 0
  let turn = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let timerAt = Infinity

  const wake = (delay = 100) => {
    if (disposed || !active) return
    const at = now() + delay
    if (timer && timerAt <= at) return
    if (timer) clearTimeout(timer)
    timerAt = at
    timer = setTimeout(() => {
      timer = undefined
      timerAt = Infinity
      pump()
    }, delay)
  }
  const reset = (read: Read) => {
    read.controller?.abort()
    read.controller = undefined
    read.head = undefined
    read.until = undefined
    read.limit = PAGE_SIZE
    read.failures = 0
    read.due = 0
    read.status = "pending"
  }
  const refresh = (relay?: string) => {
    for (const scope of scopes.values()) {
      if (!scope.demands.size) continue
      for (const read of scope.reads) if (!relay || read.relay === relay) reset(read)
    }
    wake()
  }

  const reconcile = (scope: Scope) => {
    for (const read of scope.reads) read.wanted = false
    const demands = [...scope.demands.values()]
    const relays = sanitizeRelayUrls(demands.flatMap(demand => demand.relays))
    const add = (relay: string, filter: Filter) => {
      let read = scope.reads.find(
        read => read.relay === relay && filterKey(read.filter) === filterKey(filter),
      )
      if (!read) {
        read = {
          relay,
          filter,
          wanted: true,
          limit: PAGE_SIZE,
          due: 0,
          failures: 0,
          turn: 0,
          status: "pending",
        }
        scope.reads.push(read)
      }
      read.wanted = true
    }
    for (const relay of relays) {
      const relevant = demands.filter(demand => sanitizeRelayUrls(demand.relays).includes(relay))
      for (const demand of relevant) {
        for (const filter of demand.filters || []) add(relay, {...filter, kinds: [DELETE]})
      }
      const targets = makeDeletionTargetFilters(relevant.flatMap(demand => demand.targets || []))
      for (const tag of ["#e", "#a"] as const) {
        const missing = new Set(targets.flatMap(filter => filter[tag] || []))
        // Keep existing chunks stable as content is added or deleted. Growing arrays
        // must not cancel/re-read every previous target or generate per-author jobs.
        for (const read of scope.reads) {
          if (read.relay !== relay || Object.keys(read.filter).length !== 2) continue
          const values = read.filter[tag]
          if (!values?.some(value => missing.has(value))) continue
          read.wanted = true
          values.forEach(value => missing.delete(value))
        }
        const values = [...missing].sort()
        for (let index = 0; index < values.length; index += DELETE_TARGET_CHUNK_SIZE) {
          add(relay, {
            kinds: [DELETE],
            [tag]: values.slice(index, index + DELETE_TARGET_CHUNK_SIZE),
          } as Filter)
        }
      }
    }
    for (const read of scope.reads) {
      if (!read.wanted && read.controller) reset(read)
    }
    // Released target chunks don't need indefinite retention; broad scope coverage
    // remains useful, but returning to a page always refreshes its demands.
    scope.reads = scope.reads.filter(read => read.wanted || jobs.has(read))
    scope.dirty = false
  }

  const start = (scope: Scope, read: Read) => {
    const controller = new AbortController()
    read.controller = controller
    read.turn = ++turn
    jobs.add(read)
    read.head ??= Math.floor(now() / 1000)
    const limit = Math.min(read.limit, dependencies.getPageLimit?.(read.relay) || MAX_PAGE_SIZE)
    const filter: Filter = {
      ...read.filter,
      limit,
      until: read.until ?? read.head,
      ...(read.through === undefined ? {} : {since: Math.max(0, read.through - 60)}),
    }
    const priority = Math.max(0, ...[...scope.demands.values()].map(demand => demand.priority || 0))
    void dependencies
      .request({
        relay: read.relay,
        filters: [filter],
        timeoutMs: 5_000,
        maxEvents: limit + 1,
        signal: controller.signal,
        priority,
        owner: "foreground-deletes",
        onEvent: (event, relay) => {
          if (!controller.signal.aborted && matchFilter(filter, event))
            dependencies.receive(event, relay)
        },
      })
      .then(result => {
        if (controller.signal.aborted) return
        const events = [
          ...new Map(
            result.events
              .filter(event => matchFilter(filter, event))
              .map(event => [event.id, event]),
          ).values(),
        ]
        if (result.outcome !== "eose" && result.outcome !== "capped") {
          read.status = "partial"
          read.due = now() + Math.min(60_000, 5_000 * 2 ** read.failures++)
          return
        }
        if (events.length >= limit) {
          const oldest = Math.min(...events.map(event => event.created_at))
          // Inclusive boundary: repeat the oldest second, expanding that bucket if
          // necessary. Never skip a full timestamp bucket and claim completeness.
          if (oldest === read.until) {
            if (
              limit <
              Math.min(MAX_PAGE_SIZE, dependencies.getPageLimit?.(read.relay) || MAX_PAGE_SIZE)
            ) {
              read.limit = Math.min(MAX_PAGE_SIZE, limit * 2)
            } else {
              read.status = "partial"
              read.due = Infinity
              return
            }
          } else {
            read.until = oldest
            read.limit = PAGE_SIZE
          }
          read.status = "pending"
          read.due = 0
          return
        }
        if (result.outcome === "capped") {
          read.status = "partial"
          read.due = Infinity
          return
        }
        read.through = read.head
        read.head = undefined
        read.until = undefined
        read.limit = PAGE_SIZE
        read.status = "complete"
        read.failures = 0
        read.due = now() + REFRESH_MS
      })
      .catch(() => {
        if (controller.signal.aborted) return
        read.status = "partial"
        read.due = now() + Math.min(60_000, 5_000 * 2 ** read.failures++)
      })
      .finally(() => {
        jobs.delete(read)
        if (read.controller === controller) read.controller = undefined
        wake()
      })
  }

  function pump() {
    if (!active || disposed) return
    for (const scope of scopes.values()) if (scope.dirty) reconcile(scope)
    const occupied = new Set([...jobs].map(read => read.relay))
    let nextDue = Infinity
    // Round-robin pages: a large scoped archive cannot starve newly displayed
    // targets, other scopes, or a slower relay.
    const reads = [...scopes.values()]
      .flatMap(scope => scope.reads.map(read => ({scope, read})))
      .sort((a, b) => a.read.turn - b.read.turn)
    for (const {scope, read} of reads) {
      if (!read.wanted || read.controller || jobs.has(read)) continue
      if (read.due > now()) {
        nextDue = Math.min(nextDue, read.due)
        continue
      }
      if (jobs.size >= MAX_CONCURRENT || occupied.has(read.relay)) continue
      occupied.add(read.relay)
      start(scope, read)
    }
    // A slow/authenticating relay must not postpone another relay's refresh or
    // retry while the second request slot is free.
    if (Number.isFinite(nextDue)) wake(Math.max(100, nextDue - now()))
  }

  return {
    register(initial: DeletionDemand) {
      const id = Symbol()
      let currentScope = ""
      const release = () => {
        const scope = scopes.get(currentScope)
        scope?.demands.delete(id)
        if (scope) reconcile(scope)
        currentScope = ""
      }
      const update = (demand: DeletionDemand) => {
        if (disposed) return
        if (currentScope !== demand.scope) release()
        if (!demand.scope) return
        currentScope = demand.scope
        let scope = scopes.get(currentScope)
        if (!scope) {
          scope = {
            navigation: demand.navigation,
            demands: new Map(),
            reads: [],
            touched: 0,
            dirty: true,
          }
          scopes.set(currentScope, scope)
        }
        if (!scope.demands.size || scope.navigation !== demand.navigation) {
          scope.reads.forEach(reset)
          scope.navigation = demand.navigation
        }
        scope.demands.set(id, demand)
        scope.dirty = true
        scope.touched = ++sequence
        const unused = [...scopes]
          .filter(([, value]) => !value.demands.size)
          .sort((a, b) => a[1].touched - b[1].touched)
        while (scopes.size > MAX_RETAINED_SCOPES && unused.length) scopes.delete(unused.shift()![0])
        wake()
      }
      update(initial)
      return {update, release}
    },
    refresh,
    setActive(value: boolean) {
      if (active === value) return
      active = value
      if (!active) {
        if (timer) clearTimeout(timer)
        timer = undefined
        for (const read of jobs) reset(read)
      } else refresh()
    },
    snapshot: () =>
      [...scopes].flatMap(([scope, value]) =>
        value.reads
          .filter(read => read.wanted)
          .map(read => ({
            scope,
            relay: read.relay,
            filter: read.filter,
            status: read.status,
            through: read.through,
          })),
      ),
    destroy() {
      disposed = true
      if (timer) clearTimeout(timer)
      for (const read of jobs) read.controller?.abort()
      scopes.clear()
    },
  }
}
