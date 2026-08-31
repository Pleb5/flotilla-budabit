import {request as welshmanRequest, type RequestOptions} from "@welshman/net"
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
import {
  GIT_LABEL,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
} from "@nostr-git/core/events"

const GIT_COVER_LETTER = 1624
const STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE]

type Timer = ReturnType<typeof setTimeout>

export type RepoStableLiveFilterOptions = {
  addresses: string[]
  repoPubkey: string
  repoName: string
  ownerPubkeys: string[]
  viewer?: string
  includeAnnouncement: boolean
  includeActivity: boolean
}

export type RepoLiveRequestOptions = {
  relay: string
  filters: Filter[]
  signal: AbortSignal
  priority: number
  owner: string
  onEvent: (event: TrustedEvent, relay: string) => void
  retryBaseMs?: number
  retryMaxMs?: number
  overlapSeconds?: number
  initialReplayLimit?: number
}

export type RepoLiveRequestDependencies = {
  request: (options: RequestOptions) => Promise<TrustedEvent[]>
  now?: () => number
  random?: () => number
  setTimer?: (callback: () => void, delay: number) => Timer
  clearTimer?: (timer: Timer) => void
  onError?: (message: string, error?: unknown) => void
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort()
const REPO_SCOPE_FILTER_KEYS = ["#a", "#q", "#d", "#e", "#E", "#repo"] as const

const isRepoScopedFilter = (filter: Filter) =>
  REPO_SCOPE_FILTER_KEYS.some(key => {
    const values = filter[key]
    return Array.isArray(values) && values.length > 0
  })

const makeInitialLiveFilter = (filter: Filter, initialReplayLimit: number): Filter => {
  const next = {...filter, limit: isRepoScopedFilter(filter) ? initialReplayLimit : 0}
  delete next.since
  return next
}

const makeRetryLiveFilter = (filter: Filter, since: number): Filter => {
  const next = {...filter, since}
  delete next.limit
  return next
}

export const buildRepoStableLiveFilters = ({
  addresses,
  repoPubkey,
  repoName,
  ownerPubkeys,
  viewer,
  includeAnnouncement,
  includeActivity,
}: RepoStableLiveFilterOptions): Filter[] => {
  const filters: Filter[] = []
  const normalizedAddresses = unique(addresses)

  if (includeAnnouncement && repoPubkey && repoName) {
    filters.push({
      kinds: [GIT_REPO_ANNOUNCEMENT],
      authors: [repoPubkey],
      "#d": [repoName],
    })
  }

  if (!includeActivity) return filters

  const normalizedOwners = unique(ownerPubkeys.length > 0 ? ownerPubkeys : [repoPubkey])
  if (normalizedOwners.length > 0 && repoName) {
    filters.push({
      kinds: [GIT_REPO_STATE],
      authors: normalizedOwners,
      "#d": [repoName],
    })
  }

  if (normalizedAddresses.length > 0) {
    filters.push(
      {
        kinds: [
          GIT_ISSUE,
          GIT_PULL_REQUEST,
          GIT_PULL_REQUEST_UPDATE,
          GIT_LABEL,
          GIT_COVER_LETTER,
          ...STATUS_KINDS,
        ],
        "#a": normalizedAddresses,
      },
      {kinds: [COMMENT], "#q": normalizedAddresses},
      {kinds: [DELETE], "#repo": normalizedAddresses},
    )
  }

  if (viewer) {
    filters.push({
      kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
      "#p": [viewer],
    })
  }

  return filters
}

export const buildRepoExactThreadLiveFilters = (rootId: string): Filter[] =>
  rootId
    ? [
        {kinds: [COMMENT], "#E": [rootId]},
        {kinds: [COMMENT], "#e": [rootId]},
        {kinds: [GIT_PULL_REQUEST_UPDATE], "#E": [rootId]},
        {
          kinds: [GIT_LABEL, GIT_COVER_LETTER, ...STATUS_KINDS, REPORT, DELETE],
          "#e": [rootId],
        },
      ]
    : []

export const getRepoLiveFilterSignature = (filters: Filter[]) =>
  JSON.stringify(
    filters.map(filter =>
      Object.fromEntries(
        Object.entries(filter)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]),
      ),
    ),
  )

export const createRepoLiveRequester = (dependencies: RepoLiveRequestDependencies) => {
  const now = dependencies.now || Date.now
  const random = dependencies.random || Math.random
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = dependencies.clearTimer || (timer => clearTimeout(timer))
  const onError =
    dependencies.onError ||
    ((message: string, error?: unknown) => console.warn(`[repo-live] ${message}`, error))

  return (options: RepoLiveRequestOptions) => {
    const retryBaseMs = options.retryBaseMs ?? 1000
    const retryMaxMs = options.retryMaxMs ?? 30_000
    const overlapSeconds = options.overlapSeconds ?? 10
    const initialReplayLimit = Math.max(0, Math.floor(options.initialReplayLimit ?? 0))
    const initialSince = Math.floor(now() / 1000) - overlapSeconds

    let stopped = false
    let retryCount = 0
    let initialReplayComplete = false
    let lastReceivedAt = 0
    let retryTimer: Timer | undefined
    let attemptController: AbortController | undefined

    const scheduleRetry = () => {
      if (stopped || options.signal.aborted || retryTimer) return

      const baseDelay = Math.min(retryMaxMs, retryBaseMs * 2 ** retryCount++)
      const delay = Math.round(baseDelay * (1 + random() * 0.2))
      retryTimer = setTimer(() => {
        retryTimer = undefined
        start()
      }, delay)
    }

    const start = () => {
      if (stopped || options.signal.aborted) return

      const controller = new AbortController()
      attemptController = controller
      const since = Math.max(initialSince, lastReceivedAt - overlapSeconds)
      const filters = options.filters.map(filter =>
        initialReplayComplete
          ? makeRetryLiveFilter(filter, since)
          : makeInitialLiveFilter(filter, initialReplayLimit),
      )

      let pending: Promise<TrustedEvent[]>
      try {
        pending = dependencies.request({
          relays: [options.relay],
          filters,
          lifetime: "live",
          signal: AbortSignal.any([options.signal, controller.signal]),
          priority: options.priority,
          owner: options.owner,
          onEvent: (event, relay) => {
            lastReceivedAt = Math.max(lastReceivedAt, event.created_at)
            options.onEvent(event, relay)
          },
          onDuplicate: (event, relay) => {
            lastReceivedAt = Math.max(lastReceivedAt, event.created_at)
            options.onEvent(event, relay)
          },
          onEose: () => {
            initialReplayComplete = true
            retryCount = 0
          },
          onClosed: reason => {
            onError(`Relay ${options.relay} closed ${options.owner}: ${reason}`)
          },
          onDisconnect: () => {
            onError(`Relay ${options.relay} disconnected ${options.owner}`)
          },
        })
      } catch (error) {
        if (!stopped && !options.signal.aborted) {
          onError(`Failed to start ${options.owner} on ${options.relay}`, error)
          scheduleRetry()
        }
        return
      }

      void pending
        .catch(error => {
          if (!stopped && !options.signal.aborted && !controller.signal.aborted) {
            onError(`Failed ${options.owner} on ${options.relay}`, error)
          }
        })
        .finally(() => {
          if (attemptController === controller) attemptController = undefined
          if (!controller.signal.aborted) scheduleRetry()
        })
    }

    start()

    return () => {
      if (stopped) return
      stopped = true
      if (retryTimer) clearTimer(retryTimer)
      retryTimer = undefined
      attemptController?.abort()
      attemptController = undefined
    }
  }
}

export const startRepoLiveRequest = createRepoLiveRequester({request: welshmanRequest})
