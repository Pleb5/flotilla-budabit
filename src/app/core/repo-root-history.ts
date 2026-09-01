import {
  COMMENT,
  DELETE,
  GIT_ISSUE,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
  REPORT,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {GIT_LABEL, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE} from "@nostr-git/core/events"
import {validatePullRequestEvent} from "@nostr-git/core/utils"
import {
  requestFiniteRelay,
  type FiniteRelayRequestOptions,
  type FiniteRelayResult,
} from "@app/core/finite-relay-request"
import {getMatchingRepoPublicationAddress} from "@app/core/repo-publication"
import {getRelayPolicy} from "@app/core/relay-policy"
import {normalizeRepoRelay} from "@app/core/repo-relays"

const GIT_COVER_LETTER = 1624
const STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE]

export const DEFAULT_REPO_ROOT_PAGE_SIZE = 100
export const DEFAULT_REPO_ROOT_TIMEOUT_MS = 10_000
export const REPO_ROOT_CHUNK_SIZE = 100
export const REPO_RELAY_CONCURRENCY = 6

export const mapRepoRelayWork = async <T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
  concurrency = REPO_RELAY_CONCURRENCY,
) => {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const runners = Array.from(
    {length: Math.min(values.length, Math.max(1, concurrency))},
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++
        results[index] = await worker(values[index])
      }
    },
  )
  await Promise.all(runners)
  return results
}

export type RepoRootHistoryStatus = "idle" | "loading" | "complete" | "partial" | "failed"
export type RepoRootLoadOperation = "recent" | "older"

export type RepoRootRelayState = {
  relay: string
  status: RepoRootHistoryStatus
  until?: number
  exhausted: boolean
  boundarySaturated: boolean
  pageSize: number
  eventCount: number
  outcome?: FiniteRelayResult["outcome"]
  reason?: string
  queuedAt?: number
  startedAt?: number
  finishedAt?: number
  operation?: RepoRootLoadOperation
}

export type RepoRootHistorySnapshot = {
  status: RepoRootHistoryStatus
  rootStatus?: RepoRootHistoryStatus
  operation: RepoRootLoadOperation | null
  relays: RepoRootRelayState[]
  hasOlder: boolean
  exhausted: boolean
}

export type RepoRootHistoryOptions = {
  relays: string[]
  addresses: string[]
  signal: AbortSignal
  pageSize?: number
  timeoutMs?: number
  priority: number
  onEvent: (event: TrustedEvent, relay: string) => void
  onState: (snapshot: RepoRootHistorySnapshot) => void
}

export type RepoRootHistoryDependencies = {
  requestFiniteRelay: (options: FiniteRelayRequestOptions) => Promise<FiniteRelayResult>
  getRelayPageLimit?: (relay: string) => number
}

export const getIncompleteRepoRootGapScopes = ({
  relays,
  rootIds,
  getOutcome,
}: {
  relays: string[]
  rootIds: string[]
  getOutcome: (rootId: string, relay: string) => FiniteRelayResult["outcome"] | undefined
}) =>
  relays.flatMap(relay => {
    const incompleteRootIds = rootIds.filter(rootId => getOutcome(rootId, relay) !== "eose")
    return incompleteRootIds.length > 0 ? [{relay, rootIds: incompleteRootIds}] : []
  })

export type EnsureRepoRootStatus = "complete" | "partial" | "failed" | "unavailable" | "aborted"

export type EnsureRepoRootResult = {
  status: EnsureRepoRootStatus
  requestedId: string
  rootId?: string
  rootKind?: typeof GIT_ISSUE | typeof GIT_PULL_REQUEST
}

export type RepoRootResolverOptions = {
  getRelays: () => string[]
  getAddresses: () => string[]
  signal: AbortSignal
  priority: number
  getEvent: (id: string) => TrustedEvent | undefined
  isDeleted: (event: TrustedEvent) => boolean
  onEvent: (event: TrustedEvent, relay: string) => void
  loadGap: (rootId: string) => Promise<FiniteRelayResult[]>
  timeoutMs?: number
}

const chunkValues = (values: string[], size: number) => {
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const normalizeRequestRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRepoRelay).filter(Boolean)))

export const buildRepoRootPageFilter = ({
  addresses,
  pageSize,
  until,
}: {
  addresses: string[]
  pageSize: number
  until?: number
}): Filter => ({
  kinds: [GIT_ISSUE, GIT_PULL_REQUEST],
  "#a": addresses,
  limit: pageSize,
  ...(until === undefined ? {} : {until}),
})

export const buildRepoRootGapFilters = (rootIds: string[]): Filter[] =>
  chunkValues(Array.from(new Set(rootIds.filter(Boolean))).sort(), REPO_ROOT_CHUNK_SIZE).flatMap(
    roots =>
      [
        {kinds: [COMMENT], "#E": roots},
        {kinds: [COMMENT], "#e": roots},
        {kinds: [GIT_PULL_REQUEST_UPDATE], "#E": roots},
        {kinds: [GIT_LABEL, GIT_COVER_LETTER], "#e": roots},
        {kinds: [...STATUS_KINDS, REPORT], "#e": roots},
        {kinds: [DELETE], "#e": roots},
      ] as Filter[],
  )

const getPullRequestRootId = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
  event.tags.find(tag => tag[0] === "E")?.[1] ||
  event.tags.find(tag => tag[0] === "e")?.[1] ||
  ""

export const isAcceptedRepoRootEvent = (
  event: TrustedEvent,
  addresses: string[],
): event is TrustedEvent & {kind: typeof GIT_ISSUE | typeof GIT_PULL_REQUEST} => {
  if (event.kind !== GIT_ISSUE && event.kind !== GIT_PULL_REQUEST) return false
  if (event.kind === GIT_PULL_REQUEST && !validatePullRequestEvent(event).success) return false

  try {
    return Boolean(getMatchingRepoPublicationAddress(event, addresses))
  } catch {
    return false
  }
}

const isAcceptedRepoRootLookupEvent = (event: TrustedEvent, addresses: string[]) => {
  if (
    event.kind !== GIT_ISSUE &&
    event.kind !== GIT_PULL_REQUEST &&
    event.kind !== GIT_PULL_REQUEST_UPDATE
  ) {
    return false
  }

  try {
    return Boolean(getMatchingRepoPublicationAddress(event, addresses))
  } catch {
    return false
  }
}

export const summarizeRepoRootResults = (
  results: FiniteRelayResult[],
  signal?: AbortSignal,
): EnsureRepoRootStatus => {
  if (
    signal?.aborted ||
    (results.length > 0 && results.every(result => result.outcome === "aborted"))
  ) {
    return "aborted"
  }
  if (results.length === 0 || results.every(result => result.outcome === "eose")) return "complete"
  if (results.every(result => result.outcome === "error")) return "failed"
  return "partial"
}

export const createRepoRootResolver =
  (dependencies: RepoRootHistoryDependencies) => (options: RepoRootResolverOptions) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPO_ROOT_TIMEOUT_MS
    const inFlight = new Map<
      string,
      {
        promise: Promise<EnsureRepoRootResult>
        controller: AbortController
        demandCount: number
      }
    >()
    const exactResultsById = new Map<string, Map<string, FiniteRelayResult>>()

    const requestExact = async (
      id: string,
      relays: string[],
      addresses: string[],
      signal: AbortSignal,
      onAccepted?: (event: TrustedEvent) => void,
    ) => {
      const resultsByRelay = exactResultsById.get(id) || new Map<string, FiniteRelayResult>()
      exactResultsById.set(id, resultsByRelay)
      const targets = relays.filter(relay => resultsByRelay.get(relay)?.outcome !== "eose")
      const delivered = new Set<string>()
      let accepted: TrustedEvent | undefined
      const receive = (event: TrustedEvent, relay: string) => {
        if (
          event.id !== id ||
          options.isDeleted(event) ||
          !isAcceptedRepoRootLookupEvent(event, addresses)
        ) {
          return
        }

        accepted ||= event
        const deliveryKey = `${relay}\u0000${event.id}`
        if (delivered.has(deliveryKey)) return
        delivered.add(deliveryKey)
        options.onEvent(event, relay)
        onAccepted?.(event)
      }
      const currentResults = await mapRepoRelayWork(targets, relay =>
        dependencies.requestFiniteRelay({
          relay,
          filters: [{ids: [id], limit: 1}],
          signal,
          timeoutMs,
          priority: options.priority,
          owner: "repo-roots:exact",
          onEvent: receive,
        }),
      )
      for (const result of currentResults) resultsByRelay.set(result.relay, result)
      const results = relays.flatMap(relay => {
        const result = resultsByRelay.get(relay)
        return result ? [result] : []
      })
      for (const result of results) {
        for (const event of result.events) {
          receive(event, result.relay)
        }
      }

      return {event: accepted, results}
    }

    const resolve = async (
      requestedId: string,
      signal: AbortSignal,
    ): Promise<EnsureRepoRootResult> => {
      if (signal.aborted) return {status: "aborted", requestedId}

      const relays = normalizeRequestRelays(options.getRelays())
      const addresses = Array.from(new Set(options.getAddresses().filter(Boolean)))
      if (relays.length === 0 || addresses.length === 0) {
        return {status: "unavailable", requestedId}
      }

      const results: FiniteRelayResult[] = []
      let event = options.getEvent(requestedId)
      let eagerRootLookup:
        | Promise<{
            event: TrustedEvent | undefined
            results: FiniteRelayResult[]
          }>
        | undefined
      if (!event || options.isDeleted(event) || !isAcceptedRepoRootLookupEvent(event, addresses)) {
        const exact = await requestExact(requestedId, relays, addresses, signal, accepted => {
          if (accepted.kind !== GIT_PULL_REQUEST_UPDATE || eagerRootLookup) return
          const rootId = getPullRequestRootId(accepted)
          const cachedRoot = rootId ? options.getEvent(rootId) : undefined
          if (
            !rootId ||
            rootId === accepted.id ||
            (cachedRoot &&
              !options.isDeleted(cachedRoot) &&
              isAcceptedRepoRootEvent(cachedRoot, addresses))
          ) {
            return
          }
          eagerRootLookup = requestExact(rootId, relays, addresses, signal)
        })
        event = exact.event
        results.push(...exact.results)
      }

      if (signal.aborted) return {status: "aborted", requestedId}
      if (!event) return {status: summarizeRepoRootResults(results, signal), requestedId}

      let root = event
      if (event.kind === GIT_PULL_REQUEST_UPDATE) {
        const rootId = getPullRequestRootId(event)
        if (!rootId || rootId === event.id) {
          return {status: summarizeRepoRootResults(results, signal), requestedId}
        }

        const cachedRoot = options.getEvent(rootId)
        if (
          cachedRoot &&
          !options.isDeleted(cachedRoot) &&
          isAcceptedRepoRootEvent(cachedRoot, addresses)
        ) {
          root = cachedRoot
        } else {
          const exactRoot = eagerRootLookup
            ? await eagerRootLookup
            : await requestExact(rootId, relays, addresses, signal)
          results.push(...exactRoot.results)
          if (!exactRoot.event || !isAcceptedRepoRootEvent(exactRoot.event, addresses)) {
            return {status: summarizeRepoRootResults(results, signal), requestedId}
          }
          root = exactRoot.event
        }
      }

      if (!isAcceptedRepoRootEvent(root, addresses)) {
        return {status: summarizeRepoRootResults(results, signal), requestedId}
      }

      try {
        results.push(...(await options.loadGap(root.id)))
      } catch {
        return {
          status: signal.aborted ? "aborted" : "failed",
          requestedId,
          rootId: root.id,
          rootKind: root.kind,
        }
      }

      return {
        status: summarizeRepoRootResults(results, signal),
        requestedId,
        rootId: root.id,
        rootKind: root.kind,
      }
    }

    return (id: string, signal?: AbortSignal, retry = false): Promise<EnsureRepoRootResult> => {
      const requestedId = String(id || "").trim()
      if (!requestedId) {
        return Promise.resolve({status: "complete", requestedId} as EnsureRepoRootResult)
      }
      if (signal?.aborted || options.signal.aborted) {
        return Promise.resolve({status: "aborted", requestedId})
      }

      if (retry) {
        exactResultsById.clear()
        inFlight.get(requestedId)?.controller.abort()
        inFlight.delete(requestedId)
      }

      let pending = inFlight.get(requestedId)
      if (!pending || pending.controller.signal.aborted) {
        const controller = new AbortController()
        const requestSignal = AbortSignal.any([options.signal, controller.signal])
        const promise = resolve(requestedId, requestSignal).finally(() => {
          if (inFlight.get(requestedId)?.promise === promise) inFlight.delete(requestedId)
        })
        pending = {promise, controller, demandCount: 0}
        inFlight.set(requestedId, pending)
      }

      const demand = pending
      demand.demandCount += 1
      return new Promise<EnsureRepoRootResult>((resolveDemand, rejectDemand) => {
        let settled = false
        const finish = (result: EnsureRepoRootResult, aborted: boolean) => {
          if (settled) return
          settled = true
          signal?.removeEventListener("abort", onAbort)
          demand.demandCount -= 1
          if (aborted && demand.demandCount === 0) demand.controller.abort()
          resolveDemand(result)
        }
        const onAbort = () => finish({status: "aborted", requestedId}, true)
        signal?.addEventListener("abort", onAbort, {once: true})
        demand.promise.then(
          result => finish(result, false),
          error => {
            if (settled) return
            settled = true
            signal?.removeEventListener("abort", onAbort)
            demand.demandCount -= 1
            rejectDemand(error)
          },
        )
      })
    }
  }

const getSnapshot = (
  states: Map<string, RepoRootRelayState>,
  operation: RepoRootLoadOperation | null,
): RepoRootHistorySnapshot => {
  const relays = Array.from(states.values(), state => ({...state})).sort((left, right) =>
    left.relay.localeCompare(right.relay),
  )
  const loading = relays.some(state => state.status === "loading")
  const idle = relays.length === 0 || relays.every(state => state.status === "idle")
  const failed = relays.filter(state => state.status === "failed").length
  const partial = relays.some(state => state.status === "partial" || state.boundarySaturated)
  const exhausted = relays.length > 0 && relays.every(state => state.exhausted)

  return {
    status: loading
      ? "loading"
      : idle
        ? "idle"
        : failed === relays.length && relays.length > 0
          ? "failed"
          : partial || failed > 0
            ? "partial"
            : relays.length > 0
              ? "complete"
              : "idle",
    operation,
    relays,
    hasOlder: relays.some(state => !state.exhausted),
    exhausted,
  }
}

export const createRepoRootHistory =
  (dependencies: RepoRootHistoryDependencies) => (options: RepoRootHistoryOptions) => {
    const pageSize = options.pageSize ?? DEFAULT_REPO_ROOT_PAGE_SIZE
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPO_ROOT_TIMEOUT_MS
    const states = new Map<string, RepoRootRelayState>(
      normalizeRequestRelays(options.relays).map(relay => {
        const relayLimit = dependencies.getRelayPageLimit?.(relay) ?? pageSize
        const initialPageSize =
          typeof relayLimit === "number" ? Math.min(pageSize, relayLimit) : pageSize
        return [
          relay,
          {
            relay,
            status: "idle",
            exhausted: false,
            boundarySaturated: false,
            pageSize: Math.max(1, initialPageSize),
            eventCount: 0,
          },
        ]
      }),
    )
    let loading: Promise<void> | undefined
    let operation: RepoRootLoadOperation | null = null

    const publish = () => options.onState(getSnapshot(states, operation))

    const loadPage = async (nextOperation: RepoRootLoadOperation, retry = false) => {
      if (loading || options.signal.aborted) return loading
      const initial = nextOperation === "recent"
      const targets = Array.from(states.values()).filter(state => {
        if (retry) {
          return (
            state.operation === nextOperation &&
            state.outcome !== undefined &&
            state.outcome !== "eose" &&
            state.outcome !== "aborted"
          )
        }
        return initial || !state.exhausted
      })
      if (targets.length === 0) return Promise.resolve()
      operation = nextOperation

      loading = mapRepoRelayWork(targets, async state => {
        const relayLimit = dependencies.getRelayPageLimit?.(state.relay)
        if (relayLimit !== undefined) {
          state.pageSize = Math.max(1, Math.min(state.pageSize, relayLimit))
        }
        state.operation = nextOperation
        state.status = "loading"
        state.boundarySaturated = false
        publish()

        try {
          while (!options.signal.aborted) {
            const result = await dependencies.requestFiniteRelay({
              relay: state.relay,
              filters: [
                buildRepoRootPageFilter({
                  addresses: options.addresses,
                  pageSize: state.pageSize,
                  until: initial ? undefined : state.until,
                }),
              ],
              signal: options.signal,
              timeoutMs,
              priority: options.priority,
              owner: initial ? "repo-roots:recent" : "repo-roots:older",
              onEvent: options.onEvent,
            })
            state.outcome = result.outcome
            state.reason = result.reason
            state.queuedAt = result.queuedAt
            state.startedAt = result.startedAt
            state.finishedAt = result.finishedAt
            state.eventCount += result.events.length

            if (result.outcome !== "eose") {
              state.status = result.outcome === "error" ? "failed" : "partial"
              return
            }

            if (result.events.length === 0) {
              state.exhausted = true
              state.status = "complete"
              return
            }

            const oldest = Math.min(...result.events.map(event => event.created_at))
            const previousUntil = state.until
            state.until = oldest
            if (result.events.length < state.pageSize) {
              state.exhausted = true
              state.status = "complete"
              return
            }
            const boundarySaturated =
              previousUntil === oldest && result.events.length >= state.pageSize
            if (boundarySaturated) {
              const relayLimit = Math.max(
                state.pageSize,
                dependencies.getRelayPageLimit?.(state.relay) ?? state.pageSize,
              )
              if (result.events.length >= state.pageSize && state.pageSize < relayLimit) {
                state.pageSize = Math.min(relayLimit, state.pageSize * 2)
                continue
              }
            }

            if (previousUntil === oldest && result.events.length < state.pageSize) {
              state.until = Math.max(0, oldest - 1)
            }

            state.boundarySaturated = boundarySaturated
            state.exhausted = false
            state.status = boundarySaturated ? "partial" : "complete"
            return
          }
        } finally {
          publish()
        }
      })
        .then(() => undefined)
        .finally(() => {
          loading = undefined
          publish()
        })

      return loading
    }

    publish()
    return {
      loadRecent: () => loadPage("recent"),
      loadOlder: () => loadPage("older"),
      retry: () => (operation ? loadPage(operation, true) : Promise.resolve()),
      getSnapshot: () => getSnapshot(states, operation),
    }
  }

export const createDefaultRepoRootHistory = createRepoRootHistory({
  requestFiniteRelay,
  getRelayPageLimit: relay => getRelayPolicy(relay).maxLimit ?? DEFAULT_REPO_ROOT_PAGE_SIZE,
})
export const createDefaultRepoRootResolver = createRepoRootResolver({requestFiniteRelay})

const combineGapResults = (
  first: FiniteRelayResult,
  second?: FiniteRelayResult,
): FiniteRelayResult => {
  if (!second) return first
  const events = new Map([...first.events, ...second.events].map(event => [event.id, event]))
  return {
    relay: first.relay,
    outcome: first.outcome === "eose" ? second.outcome : first.outcome,
    events: Array.from(events.values()),
    queuedAt: Math.min(first.queuedAt, second.queuedAt),
    startedAt:
      first.startedAt === undefined
        ? second.startedAt
        : second.startedAt === undefined
          ? first.startedAt
          : Math.min(first.startedAt, second.startedAt),
    finishedAt: Math.max(first.finishedAt, second.finishedAt),
    ...((first.reason || second.reason) && {
      reason: [first.reason, second.reason].filter(Boolean).join("; "),
    }),
  }
}

export const createRepoRootGapLoader =
  (dependencies: RepoRootHistoryDependencies) =>
  async ({
    relays,
    rootIds,
    signal,
    priority,
    onEvent,
    timeoutMs = DEFAULT_REPO_ROOT_TIMEOUT_MS,
  }: {
    relays: string[]
    rootIds: string[]
    signal: AbortSignal
    priority: number
    onEvent: (event: TrustedEvent, relay: string) => void
    timeoutMs?: number
  }) => {
    const filters = buildRepoRootGapFilters(rootIds)
    if (filters.length === 0) return []

    const normalizedRelays = normalizeRequestRelays(relays)
    const firstResults = await mapRepoRelayWork(normalizedRelays, relay =>
      dependencies.requestFiniteRelay({
        relay,
        filters,
        signal,
        timeoutMs,
        priority,
        owner: "repo-roots:gap",
        onEvent,
      }),
    )
    const roots = new Set(rootIds)
    const childIds = Array.from(
      new Set(
        firstResults.flatMap(result =>
          result.events
            .filter(event => event.kind !== DELETE && !roots.has(event.id))
            .map(event => event.id),
        ),
      ),
    ).sort()
    if (childIds.length === 0) return firstResults

    const deletionFilters = chunkValues(childIds, REPO_ROOT_CHUNK_SIZE).map(
      ids => ({kinds: [DELETE], "#e": ids}) as Filter,
    )
    const secondResults = await mapRepoRelayWork(normalizedRelays, relay =>
      dependencies.requestFiniteRelay({
        relay,
        filters: deletionFilters,
        signal,
        timeoutMs,
        priority,
        owner: "repo-roots:child-deletes",
        onEvent,
      }),
    )

    return firstResults.map((result, index) => combineGapResults(result, secondResults[index]))
  }

export const loadRepoRootGap = createRepoRootGapLoader({requestFiniteRelay})
