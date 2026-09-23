import {get, writable} from "svelte/store"
import {matchFilters, sanitizeRelayUrls, type Filter, type TrustedEvent} from "@welshman/util"
import type {FiniteRelayRequestOptions, FiniteRelayResult} from "./finite-relay-request"

export const DM_KIND = 4444
export const DM_INBOX = "inbox"
export const DM_HISTORY_PAGE_SIZE = 100
export const DM_HISTORY_CONCURRENCY = 2
export const DM_HISTORY_FRESH_MS = 30_000
const PAGE_YIELD_MS = 100
const RETRY_DELAYS = [1_000, 4_000]
const MAX_RETAINED_SCOPES = 24

export const makeDmHistoryFilters = (self: string, partner?: string): Filter[] =>
  partner === self
    ? [{kinds: [DM_KIND], authors: [self], "#p": [self]}]
    : [
        {kinds: [DM_KIND], "#p": [self], ...(partner ? {authors: [partner]} : {})},
        {kinds: [DM_KIND], authors: [self], ...(partner ? {"#p": [partner]} : {})},
      ]

export type DmHistoryContext = {
  pubkey?: string
  relays: string[]
  partner?: string
  partnerRelays?: string[]
  active: boolean
  available: boolean
  signerReady: boolean
}

export type DmHistorySnapshot = {
  status: "waiting" | "loading" | "ready" | "partial" | "paused"
  phase?: "queued" | "authenticating" | "loading"
  loading: boolean
  initialComplete: boolean
  exhausted: boolean
  hasOlder: boolean
  pages: number
  errors: string[]
}

export const emptyDmHistory: DmHistorySnapshot = {
  status: "waiting",
  loading: false,
  initialComplete: false,
  exhausted: false,
  hasOlder: true,
  pages: 0,
  errors: [],
}

type Refresh = {head: number; until: number; since?: number}
type Stream = {
  relay: string
  filter: Filter
  initialized: boolean
  until?: number
  head?: number
  refreshedAt: number
  refresh?: Refresh
  exhausted: boolean
  saturated: boolean
  pageSize: number
  failures: number
  retryAt: number
  error?: string
  urgent: boolean
  phase?: DmHistorySnapshot["phase"]
  controller?: AbortController
}
type Exact = {id: string; done: Set<string>; errors: Map<string, string>}
type Scope = {
  key: string
  streams: Map<string, Stream>
  relays: string[]
  pages: number
  touched: number
  exact?: Exact
}
type Job = {
  scope: Scope
  stream: Stream
  mode: "recent" | "older" | "exact"
  priority: number
  controller: AbortController
}

type Dependencies = {
  request: (options: FiniteRelayRequestOptions) => Promise<FiniteRelayResult>
  getRelayLimit?: (relay: string) => number
  now?: () => number
}

/** One account's finite history work. Live subscriptions are owned by dm-sync. */
export const createDmHistory = (dependencies: Dependencies) => {
  const now = dependencies.now || Date.now
  const snapshots = writable(new Map<string, DmHistorySnapshot>())
  const scopes = new Map<string, Scope>()
  const jobs = new Set<Job>()
  let context: DmHistoryContext = {
    relays: [],
    active: false,
    available: true,
    signerReady: false,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let wakeAt = Infinity
  let disposed = false
  let sequence = 0
  let contextKey = ""

  const isDemanded = (scope: Scope) =>
    scope.key === DM_INBOX || (context.active && scope.key === context.partner)
  const streamsFor = (scope: Scope) =>
    Array.from(scope.streams.values()).filter(stream => scope.relays.includes(stream.relay))
  const canRun = () => Boolean(context.pubkey && context.signerReady && context.available)
  const relayLimit = (relay: string) =>
    Math.max(1, dependencies.getRelayLimit?.(relay) || DM_HISTORY_PAGE_SIZE)

  const publish = () => {
    const previous = get(snapshots)
    const next = new Map<string, DmHistorySnapshot>()
    let changed = previous.size !== scopes.size
    for (const scope of scopes.values()) {
      const streams = streamsFor(scope)
      const errors = Array.from(
        new Set([
          ...streams.flatMap(stream => (stream.error ? [`${stream.relay}: ${stream.error}`] : [])),
          ...streams
            .filter(stream => stream.saturated)
            .map(
              stream =>
                `${stream.relay}: Too many messages share a timestamp; some history could not be verified.`,
            ),
          ...Array.from(scope.exact?.errors || [], ([relay, reason]) => `${relay}: ${reason}`),
        ]),
      )
      const active = streams.filter(stream => stream.controller)
      const pending = streams.some(
        stream => !stream.error && (stream.refresh || (context.active && !stream.exhausted)),
      )
      const initialComplete = streams.length > 0 && streams.every(stream => stream.initialized)
      const exhausted =
        initialComplete &&
        streams.every(
          stream => stream.exhausted && !stream.refresh && !stream.saturated && !stream.error,
        )
      const loading = canRun() && isDemanded(scope) && (active.length > 0 || pending)
      const state: DmHistorySnapshot = {
        status: errors.length
          ? "partial"
          : !context.signerReady || !streams.length
            ? "waiting"
            : !context.available || !isDemanded(scope)
              ? "paused"
              : loading
                ? "loading"
                : "ready",
        phase: active.find(stream => stream.phase === "authenticating")?.phase || active[0]?.phase,
        loading,
        initialComplete,
        exhausted,
        hasOlder: !initialComplete || streams.some(stream => !stream.exhausted || stream.refresh),
        pages: scope.pages,
        errors,
      }
      const old = previous.get(scope.key)
      if (JSON.stringify(old) === JSON.stringify(state)) next.set(scope.key, old!)
      else {
        next.set(scope.key, state)
        changed = true
      }
    }
    if (changed) snapshots.set(next)
  }

  const wake = (delay = 25) => {
    if (disposed) return
    const at = now() + delay
    if (timer && wakeAt <= at) return
    if (timer) clearTimeout(timer)
    wakeAt = at
    timer = setTimeout(() => {
      timer = undefined
      wakeAt = Infinity
      pump()
    }, delay)
  }

  const refresh = (stream: Stream) => {
    if (stream.refresh || now() - stream.refreshedAt < DM_HISTORY_FRESH_MS) return
    const head = Math.floor(now() / 1000)
    stream.refresh = {head, until: head, ...(stream.head === undefined ? {} : {since: stream.head})}
  }

  const ensureScope = (key: string, relays: string[]) => {
    let scope = scopes.get(key)
    if (!scope) {
      scope = {key, streams: new Map(), relays, pages: 0, touched: ++sequence}
      scopes.set(key, scope)
    }
    scope.relays = relays
    scope.touched = ++sequence
    for (const relay of relays) {
      makeDmHistoryFilters(context.pubkey!, key === DM_INBOX ? undefined : key).forEach(
        (filter, index) => {
          const id = `${relay}:${index}`
          let stream = scope!.streams.get(id)
          if (!stream) {
            stream = {
              relay,
              filter,
              initialized: false,
              refreshedAt: -Infinity,
              exhausted: false,
              saturated: false,
              pageSize: Math.min(DM_HISTORY_PAGE_SIZE, relayLimit(relay)),
              failures: 0,
              retryAt: 0,
              urgent: false,
            }
            scope!.streams.set(id, stream)
            refresh(stream)
          }
        },
      )
    }
    // Relay removals release both network work and retained progress for that relay.
    for (const [id, stream] of scope.streams) {
      if (!relays.includes(stream.relay)) {
        stream.controller?.abort()
        scope.streams.delete(id)
      }
    }
    return scope
  }

  const priorityFor = (scope: Scope, stream: Stream, mode: Job["mode"]) => {
    if (!context.active) return -100
    if (mode === "exact" || stream.urgent) return 350
    if (scope.key === context.partner) return mode === "recent" ? 350 : 100
    if (!context.partner) return mode === "recent" ? 350 : 100
    return mode === "recent" ? 100 : 0
  }

  const nextMode = (scope: Scope, stream: Stream): Job["mode"] | undefined => {
    if (scope.exact && !scope.exact.done.has(stream.relay) && !scope.exact.errors.has(stream.relay))
      return "exact"
    if (stream.error && (stream.retryAt === Infinity || stream.retryAt > now())) return
    if (stream.refresh) return "recent"
    if (context.active && !stream.exhausted) return "older"
  }

  const advancePage = (job: Job, events: TrustedEvent[], limit: number) => {
    const {stream, mode} = job
    const recent = mode === "recent"
    const scan = stream.refresh
    const initial = !stream.initialized
    const oldCursor = recent ? scan!.until : stream.until
    const full = events.length >= limit
    const oldest = events.length ? Math.min(...events.map(event => event.created_at)) : undefined
    let cursor = oldest
    if (full && oldest === oldCursor) {
      if (stream.pageSize < relayLimit(stream.relay)) {
        stream.pageSize = Math.min(relayLimit(stream.relay), stream.pageSize * 2)
        return
      }
      // NIP-01 has no secondary cursor. Continue older work, retaining the gap explicitly.
      stream.saturated = true
      cursor = Math.max(0, oldest! - 1)
    }
    if (initial) {
      stream.initialized = true
      stream.until = cursor
      stream.exhausted = !full
    } else if (!recent) {
      stream.until = cursor
      stream.exhausted = !full || cursor === 0
    }
    if (recent) {
      if (initial || !full || (scan!.since !== undefined && cursor! < scan!.since)) {
        stream.head = scan!.head
        stream.refreshedAt = now()
        stream.refresh = undefined
      } else scan!.until = cursor!
    }
  }

  const start = (job: Job) => {
    const {scope, stream, mode, controller} = job
    const exact = scope.exact
    const limit = Math.min(stream.pageSize, relayLimit(stream.relay))
    const filter: Filter =
      mode === "exact"
        ? {...stream.filter, ids: [exact!.id], limit: 1}
        : mode === "recent"
          ? {
              ...stream.filter,
              until: stream.refresh!.until,
              ...(stream.refresh!.since === undefined ? {} : {since: stream.refresh!.since}),
              limit,
            }
          : {...stream.filter, ...(stream.until === undefined ? {} : {until: stream.until}), limit}
    // Exact lookup must cover both directions, independent of which stream got the slot.
    const filters =
      mode === "exact"
        ? makeDmHistoryFilters(context.pubkey!, scope.key).map(f => ({
            ...f,
            ids: [exact!.id],
            limit: 1,
          }))
        : [filter]
    stream.controller = controller
    stream.phase = "queued"
    jobs.add(job)
    void dependencies
      .request({
        relay: stream.relay,
        filters,
        signal: controller.signal,
        timeoutMs: 15_000,
        priority: job.priority,
        owner: `dm-history:${scope.key === DM_INBOX ? "inbox" : "conversation"}:${mode}`,
        onPhase: phase => {
          if (controller.signal.aborted) return
          stream.phase = phase
          publish()
        },
      })
      .then(result => {
        if (controller.signal.aborted) return
        if (mode === "exact") {
          if (scope.exact !== exact) return
          if (result.outcome === "eose") exact!.done.add(stream.relay)
          else exact!.errors.set(stream.relay, result.reason || result.outcome)
          return
        }
        if (result.outcome === "eose") {
          stream.error = undefined
          stream.failures = 0
          stream.retryAt = 0
          stream.urgent = false
          scope.pages++
          const events = Array.from(
            new Map(
              result.events
                .filter(event => matchFilters(filters, event))
                .map(event => [event.id, event]),
            ).values(),
          )
          advancePage(job, events, limit)
        } else if (result.outcome !== "aborted") {
          stream.error = result.reason || `History request ${result.outcome}`
          const transient =
            ["timeout", "disconnect", "error"].includes(result.outcome) ||
            /^rate-limited:/i.test(result.reason || "")
          const delay = RETRY_DELAYS[stream.failures++]
          stream.retryAt = transient && delay !== undefined ? now() + delay : Infinity
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          stream.error = error instanceof Error ? error.message : String(error)
          stream.retryAt = Infinity
        }
      })
      .finally(() => {
        jobs.delete(job)
        if (stream.controller === controller) {
          stream.controller = undefined
          stream.phase = undefined
        }
        if (!disposed) {
          publish()
          wake(PAGE_YIELD_MS)
        }
      })
  }

  function pump() {
    if (disposed || !canRun()) return
    const occupied = new Set(Array.from(jobs, job => job.stream.relay))
    const candidates: Omit<Job, "controller">[] = []
    let retryAt = Infinity
    for (const scope of scopes.values()) {
      if (!isDemanded(scope)) continue
      for (const stream of streamsFor(scope)) {
        if (stream.controller) continue
        if (stream.error && stream.retryAt > now()) retryAt = Math.min(retryAt, stream.retryAt)
        const mode = nextMode(scope, stream)
        if (mode) candidates.push({scope, stream, mode, priority: priorityFor(scope, stream, mode)})
      }
    }
    candidates.sort((a, b) => b.priority - a.priority)
    for (const candidate of candidates) {
      if (jobs.size >= DM_HISTORY_CONCURRENCY) break
      if (occupied.has(candidate.stream.relay)) continue
      occupied.add(candidate.stream.relay)
      start({...candidate, controller: new AbortController()})
    }
    if (Number.isFinite(retryAt)) wake(Math.max(PAGE_YIELD_MS, retryAt - now()))
    publish()
  }

  const clearFailures = (scope: Scope, relay?: string) => {
    for (const stream of streamsFor(scope)) {
      if (relay && stream.relay !== relay) continue
      stream.error = undefined
      stream.failures = 0
      stream.retryAt = 0
    }
    if (relay) scope.exact?.errors.delete(relay)
    else scope.exact?.errors.clear()
  }

  return {
    subscribe: snapshots.subscribe,
    getSnapshot: (key = DM_INBOX) => get(snapshots).get(key) || emptyDmHistory,
    configure(input: DmHistoryContext) {
      if (disposed) return
      const previous = context
      const next = {
        ...input,
        relays: sanitizeRelayUrls(input.relays).sort(),
        partnerRelays: sanitizeRelayUrls(input.partnerRelays || []).sort(),
      }
      const key = JSON.stringify(next)
      if (key === contextKey) return
      contextKey = key
      context = next
      if (previous.pubkey !== context.pubkey) {
        for (const job of jobs) job.controller.abort()
        scopes.clear()
      }
      if (context.pubkey) {
        ensureScope(DM_INBOX, context.relays)
        if (context.active && context.partner)
          ensureScope(
            context.partner,
            sanitizeRelayUrls([...context.relays, ...context.partnerRelays!]),
          )
        const entered = context.active && (!previous.active || previous.partner !== context.partner)
        const resumed =
          (!previous.signerReady && context.signerReady) ||
          (!previous.available && context.available)
        for (const scope of scopes.values()) {
          if (!isDemanded(scope)) continue
          if (entered || resumed) {
            clearFailures(scope)
            for (const stream of streamsFor(scope)) refresh(stream)
          }
        }
      }
      for (const job of jobs) {
        if (!canRun() || !isDemanded(job.scope) || (!context.active && job.mode === "older"))
          job.controller.abort()
        else if (
          job.stream.phase === "queued" &&
          priorityFor(job.scope, job.stream, job.mode) > job.priority
        )
          job.controller.abort()
      }
      // Preempt only inbox work that blocks the newly selected conversation.
      if (context.active && context.partner && previous.partner !== context.partner) {
        const target = scopes.get(context.partner)
        if (target && streamsFor(target).some(stream => stream.refresh)) {
          for (const job of jobs) {
            if (
              job.scope.key === DM_INBOX &&
              (jobs.size >= DM_HISTORY_CONCURRENCY || target.relays.includes(job.stream.relay))
            )
              job.controller.abort()
          }
        }
      }
      const inactive = Array.from(scopes.values())
        .filter(scope => !isDemanded(scope))
        .sort((a, b) => a.touched - b.touched)
      while (scopes.size > MAX_RETAINED_SCOPES && inactive.length)
        scopes.delete(inactive.shift()!.key)
      publish()
      wake()
    },
    retry(key = DM_INBOX) {
      const scope = scopes.get(key)
      if (!scope) return
      const streams = streamsFor(scope)
      const failed = streams.filter(
        stream => stream.error || stream.saturated || !stream.initialized,
      )
      clearFailures(scope)
      for (const stream of failed.length ? failed : streams) {
        // A manual retry also rechecks a saturated boundary, rather than claiming it was covered.
        if (stream.saturated) {
          stream.initialized = false
          stream.saturated = false
          stream.exhausted = false
          stream.refreshedAt = -Infinity
          stream.head = undefined
        }
        refresh(stream)
      }
      publish()
      wake(0)
    },
    recover(relay?: string, refreshRecent = false) {
      for (const scope of scopes.values())
        if (isDemanded(scope)) {
          clearFailures(scope, relay)
          if (refreshRecent)
            for (const stream of streamsFor(scope)) {
              if (relay && stream.relay !== relay) continue
              stream.refreshedAt = -Infinity
              refresh(stream)
            }
        }
      publish()
      wake()
    },
    loadOlder(key: string) {
      const scope = scopes.get(key)
      if (!scope) return
      clearFailures(scope)
      for (const stream of streamsFor(scope)) if (!stream.exhausted) stream.urgent = true
      for (const job of jobs) {
        if (job.scope === scope && job.priority < 350 && job.stream.phase === "queued")
          job.controller.abort()
        else if (
          job.scope.key === DM_INBOX &&
          scope.key !== DM_INBOX &&
          scope.relays.includes(job.stream.relay)
        )
          job.controller.abort()
      }
      wake(0)
    },
    loadEvent(key: string, id: string) {
      const scope = scopes.get(key)
      if (!scope || !/^[a-f0-9]{64}$/i.test(id) || scope.exact?.id === id) return
      scope.exact = {id, done: new Set(), errors: new Map()}
      for (const job of jobs) {
        if (
          scope.relays.includes(job.stream.relay) &&
          (job.mode === "exact" || job.priority < 350 || job.stream.phase === "queued")
        )
          job.controller.abort()
      }
      wake(0)
    },
    destroy() {
      disposed = true
      if (timer) clearTimeout(timer)
      for (const job of jobs) job.controller.abort()
      scopes.clear()
      snapshots.set(new Map())
    },
  }
}
