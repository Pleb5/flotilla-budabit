import {
  on,
  uniq,
  flatten,
  addToMapKey,
  defer,
  type Deferred,
  call,
  randomId,
  pushToMapKey,
  batcher,
} from "@welshman/lib"
import {
  type Filter,
  unionFilters,
  matchFilters,
  type TrustedEvent,
  deduplicateEvents,
  getFilterResultCardinality,
} from "@welshman/util"
import {
  type RelayMessage,
  ClientMessageType,
  isRelayEvent,
  isRelayEose,
  isRelayClosed,
  isRelayNotice,
} from "./message.js"
import {getAdapter, type AdapterContext, AdapterEvent} from "./adapter.js"
import {type Socket, SocketEvent, SocketStatus} from "./socket.js"
import {netContext} from "./context.js"
import {Tracker} from "./tracker.js"

export type RequestLifetime = "finite" | "live"

export type RequestClass = "finite" | "critical-live" | "background-live"

export type RequestClassCounts = {
  total: number
  finite: number
  live: number
  criticalLive: number
  backgroundLive: number
}

export type RequestSchedulerOwnerSnapshot = {
  owner: string
  activeSubscriptions: number
  activeFilters: number
  queuedSubscriptions: number
  queuedFilters: number
}

export type RequestSchedulerSnapshot = {
  relay: string
  configuredMaxSubscriptions: number
  configuredMaxLiveSubscriptions: number
  configuredMaxBackgroundLiveSubscriptions: number
  learnedMaxSubscriptions: number | null
  effectiveMaxSubscriptions: number
  active: RequestClassCounts
  queued: RequestClassCounts
  oldestQueuedAgeMs: number
  oldestQueuedAgeMsByClass: Record<RequestClass, number>
  owners: RequestSchedulerOwnerSnapshot[]
  noticeCount: number
  lastQueueStartDelayMs: number
  maxQueueStartDelayMs: number
}

export type RelayRequestPolicy = {
  maxFiltersPerSubscription?: number
  maxSubscriptions?: number
  maxLiveSubscriptions?: number
  maxBackgroundLiveSubscriptions?: number
  maxMessageBytes?: number
  criticalLivePriority?: number
  priority?: number
}

export type RequestPolicyResolver = (relay: string) => RelayRequestPolicy

type RequestPolicyRegistration = {
  resolver: RequestPolicyResolver
}

const requestPolicyResolvers: RequestPolicyRegistration[] = []

const resolveRequestPolicy = (relay: string) =>
  requestPolicyResolvers.at(-1)?.resolver(relay) || {}

export const setRequestPolicy = (resolver: RequestPolicyResolver) => {
  const registration: RequestPolicyRegistration = {resolver}

  requestPolicyResolvers.push(registration)

  return () => {
    const index = requestPolicyResolvers.indexOf(registration)

    if (index >= 0) {
      requestPolicyResolvers.splice(index, 1)
    }
  }
}

type SchedulerJob = {
  cancelled: boolean
  maxBackgroundLiveSubscriptions: number
  maxLiveSubscriptions: number
  maxSubscriptions: number
  owner: string | undefined
  priority: number
  queuedAt: number
  remainingFilterCount: number
  remainingWeight: number
  requestClass: RequestClass
  sequence: number
  start: () => void
  started: boolean
  weight: number
}

type SchedulerPolicy = {
  maxBackgroundLiveSubscriptions: number
  maxLiveSubscriptions: number
  maxSubscriptions: number
}

type SubscriptionScheduler = {
  activeJobs: Set<SchedulerJob>
  active: {
    backgroundLive: number
    live: number
    total: number
  }
  configuredMaxBackgroundLiveSubscriptions: number
  configuredMaxLiveSubscriptions: number
  configuredMaxSubscriptions: number
  lastQueueStartDelayMs: number
  learnedMaxSubscriptions: number
  latestMaxBackgroundLiveSubscriptions: number
  latestMaxLiveSubscriptions: number
  latestMaxSubscriptions: number
  maxBackgroundLiveSubscriptions: number
  maxLiveSubscriptions: number
  maxSubscriptions: number
  maxQueueStartDelayMs: number
  noticeCount: number
  pausedUntil: number
  queue: SchedulerJob[]
  relay: string
  resumeTimer?: ReturnType<typeof setTimeout>
}

const subscriptionSchedulers = new WeakMap<Socket, SubscriptionScheduler>()

const trackedSubscriptionSchedulers = new Set<SubscriptionScheduler>()

const schedulerSubscribers = new Set<(snapshots: RequestSchedulerSnapshot[]) => void>()

let subscriptionSequence = 0

const finiteAgeInterval = 1000

const finiteMaxAgeBoost = 1000

const getEffectivePriority = (job: SchedulerJob, timestamp: number) =>
  job.priority +
  (job.requestClass === "finite"
    ? Math.min(finiteMaxAgeBoost, Math.floor((timestamp - job.queuedAt) / finiteAgeInterval))
    : 0)

const getClassCounts = (jobs: Iterable<SchedulerJob>): RequestClassCounts => {
  const counts = {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0}

  for (const job of jobs) {
    const weight = job.remainingWeight

    counts.total += weight

    if (job.requestClass === "finite") counts.finite += weight
    else counts.live += weight

    if (job.requestClass === "critical-live") counts.criticalLive += weight
    if (job.requestClass === "background-live") counts.backgroundLive += weight
  }

  return counts
}

const getOwnerSnapshots = (scheduler: SubscriptionScheduler) => {
  const owners = new Map<string, RequestSchedulerOwnerSnapshot>()

  const add = (job: SchedulerJob, active: boolean) => {
    const owner = job.owner || "unowned"
    const snapshot = owners.get(owner) || {
      owner,
      activeSubscriptions: 0,
      activeFilters: 0,
      queuedSubscriptions: 0,
      queuedFilters: 0,
    }

    if (active) {
      snapshot.activeSubscriptions += job.remainingWeight
      snapshot.activeFilters += job.remainingFilterCount
    } else {
      snapshot.queuedSubscriptions += job.remainingWeight
      snapshot.queuedFilters += job.remainingFilterCount
    }

    owners.set(owner, snapshot)
  }

  scheduler.activeJobs.forEach(job => add(job, true))
  scheduler.queue.filter(job => !job.cancelled).forEach(job => add(job, false))

  return Array.from(owners.values()).sort((a, b) => a.owner.localeCompare(b.owner))
}

const getSchedulerSnapshot = (
  scheduler: SubscriptionScheduler,
  timestamp: number,
): RequestSchedulerSnapshot => {
  const queuedJobs = scheduler.queue.filter(job => !job.cancelled)

  const getOldestAge = (requestClass: RequestClass) => {
    const queuedAt = queuedJobs
      .filter(job => job.requestClass === requestClass)
      .reduce((oldest, job) => Math.min(oldest, job.queuedAt), Infinity)

    return Number.isFinite(queuedAt) ? Math.max(0, timestamp - queuedAt) : 0
  }

  return {
    relay: scheduler.relay,
    configuredMaxSubscriptions: scheduler.configuredMaxSubscriptions,
    configuredMaxLiveSubscriptions: scheduler.configuredMaxLiveSubscriptions,
    configuredMaxBackgroundLiveSubscriptions: scheduler.configuredMaxBackgroundLiveSubscriptions,
    learnedMaxSubscriptions: Number.isFinite(scheduler.learnedMaxSubscriptions)
      ? scheduler.learnedMaxSubscriptions
      : null,
    effectiveMaxSubscriptions: scheduler.maxSubscriptions,
    active: getClassCounts(scheduler.activeJobs),
    queued: getClassCounts(queuedJobs),
    oldestQueuedAgeMs:
      queuedJobs.length > 0
        ? Math.max(0, timestamp - Math.min(...queuedJobs.map(job => job.queuedAt)))
        : 0,
    oldestQueuedAgeMsByClass: {
      finite: getOldestAge("finite"),
      "critical-live": getOldestAge("critical-live"),
      "background-live": getOldestAge("background-live"),
    },
    owners: getOwnerSnapshots(scheduler),
    noticeCount: scheduler.noticeCount,
    lastQueueStartDelayMs: scheduler.lastQueueStartDelayMs,
    maxQueueStartDelayMs: scheduler.maxQueueStartDelayMs,
  }
}

export const getRequestSchedulerSnapshots = (): RequestSchedulerSnapshot[] => {
  const timestamp = Date.now()

  return Array.from(trackedSubscriptionSchedulers, scheduler =>
    getSchedulerSnapshot(scheduler, timestamp),
  ).sort((a, b) => a.relay.localeCompare(b.relay))
}

const emitSchedulerState = () => {
  if (schedulerSubscribers.size === 0) return

  const snapshots = getRequestSchedulerSnapshots()

  schedulerSubscribers.forEach(listener => {
    try {
      listener(snapshots)
    } catch {
      // Diagnostics must not interfere with request scheduling.
    }
  })
}

export const subscribeRequestScheduler = (
  listener: (snapshots: RequestSchedulerSnapshot[]) => void,
) => {
  schedulerSubscribers.add(listener)
  listener(getRequestSchedulerSnapshots())

  return () => {
    schedulerSubscribers.delete(listener)
  }
}

const canStartJob = (scheduler: SubscriptionScheduler, job: SchedulerJob) => {
  if (
    scheduler.active.total + job.weight >
    Math.min(scheduler.maxSubscriptions, job.maxSubscriptions)
  )
    return false

  if (job.requestClass === "finite") return true

  if (
    scheduler.active.live + job.weight >
    Math.min(scheduler.maxLiveSubscriptions, job.maxLiveSubscriptions)
  )
    return false

  return (
    job.requestClass !== "background-live" ||
    scheduler.active.backgroundLive + job.weight <=
      Math.min(scheduler.maxBackgroundLiveSubscriptions, job.maxBackgroundLiveSubscriptions)
  )
}

const updateTrackedScheduler = (scheduler: SubscriptionScheduler) => {
  if (scheduler.active.total > 0 || scheduler.queue.some(job => !job.cancelled)) {
    trackedSubscriptionSchedulers.add(scheduler)
  } else {
    trackedSubscriptionSchedulers.delete(scheduler)
  }
}

const applyLatestSchedulerPolicy = (scheduler: SubscriptionScheduler, allowRelaxation: boolean) => {
  const select = (current: number, latest: number) =>
    allowRelaxation ? latest : Math.min(current, latest)

  scheduler.configuredMaxBackgroundLiveSubscriptions = select(
    scheduler.configuredMaxBackgroundLiveSubscriptions,
    scheduler.latestMaxBackgroundLiveSubscriptions,
  )
  scheduler.configuredMaxLiveSubscriptions = select(
    scheduler.configuredMaxLiveSubscriptions,
    scheduler.latestMaxLiveSubscriptions,
  )
  scheduler.configuredMaxSubscriptions = select(
    scheduler.configuredMaxSubscriptions,
    scheduler.latestMaxSubscriptions,
  )
  scheduler.maxBackgroundLiveSubscriptions = scheduler.configuredMaxBackgroundLiveSubscriptions
  scheduler.maxLiveSubscriptions = scheduler.configuredMaxLiveSubscriptions
  scheduler.maxSubscriptions = Math.min(
    scheduler.configuredMaxSubscriptions,
    scheduler.learnedMaxSubscriptions,
  )
}

const drainScheduler = (scheduler: SubscriptionScheduler) => {
  if (scheduler.pausedUntil > Date.now()) {
    if (!scheduler.resumeTimer) {
      scheduler.resumeTimer = setTimeout(() => {
        scheduler.resumeTimer = undefined
        drainScheduler(scheduler)
      }, scheduler.pausedUntil - Date.now())
    }

    updateTrackedScheduler(scheduler)
    emitSchedulerState()

    return
  }

  scheduler.queue = scheduler.queue.filter(job => !job.cancelled)

  const timestamp = Date.now()

  scheduler.queue.sort(
    (a, b) =>
      getEffectivePriority(b, timestamp) - getEffectivePriority(a, timestamp) ||
      a.sequence - b.sequence,
  )

  while (scheduler.queue.length > 0) {
    const index = scheduler.queue.findIndex(job => canStartJob(scheduler, job))

    if (index < 0) break

    const [job] = scheduler.queue.splice(index, 1)

    job.started = true

    const queueDelay = Math.max(0, timestamp - job.queuedAt)

    scheduler.lastQueueStartDelayMs = queueDelay
    scheduler.maxQueueStartDelayMs = Math.max(scheduler.maxQueueStartDelayMs, queueDelay)
    scheduler.activeJobs.add(job)
    scheduler.active.total += job.weight

    if (job.requestClass !== "finite") {
      scheduler.active.live += job.weight
    }

    if (job.requestClass === "background-live") {
      scheduler.active.backgroundLive += job.weight
    }

    job.start()
  }

  updateTrackedScheduler(scheduler)
  emitSchedulerState()
}

const getSubscriptionScheduler = (socket: Socket, policy: SchedulerPolicy) => {
  let scheduler = subscriptionSchedulers.get(socket)

  if (!scheduler) {
    const created: SubscriptionScheduler = {
      activeJobs: new Set(),
      active: {
        backgroundLive: 0,
        live: 0,
        total: 0,
      },
      configuredMaxBackgroundLiveSubscriptions: policy.maxBackgroundLiveSubscriptions,
      configuredMaxLiveSubscriptions: policy.maxLiveSubscriptions,
      configuredMaxSubscriptions: policy.maxSubscriptions,
      lastQueueStartDelayMs: 0,
      learnedMaxSubscriptions: Infinity,
      latestMaxBackgroundLiveSubscriptions: policy.maxBackgroundLiveSubscriptions,
      latestMaxLiveSubscriptions: policy.maxLiveSubscriptions,
      latestMaxSubscriptions: policy.maxSubscriptions,
      maxBackgroundLiveSubscriptions: policy.maxBackgroundLiveSubscriptions,
      maxLiveSubscriptions: policy.maxLiveSubscriptions,
      maxSubscriptions: policy.maxSubscriptions,
      maxQueueStartDelayMs: 0,
      noticeCount: 0,
      pausedUntil: 0,
      queue: [],
      relay: socket.url,
    }

    scheduler = created

    subscriptionSchedulers.set(socket, created)

    on(socket, SocketEvent.Receive, (message: RelayMessage) => {
      if (isRelayNotice(message)) {
        created.noticeCount += 1
        emitSchedulerState()
      }

      if (isRelayNotice(message) && /too many concurrent reqs/i.test(message[1] || "")) {
        created.learnedMaxSubscriptions = Math.max(
          1,
          Math.min(created.learnedMaxSubscriptions, created.active.total - 1),
        )
        created.maxSubscriptions = Math.min(
          created.configuredMaxSubscriptions,
          created.learnedMaxSubscriptions,
        )
        created.pausedUntil = Date.now() + 250

        drainScheduler(created)
      }
    })

    on(socket, SocketEvent.Status, (status: SocketStatus) => {
      if (status === SocketStatus.Open) {
        created.learnedMaxSubscriptions = Infinity
        applyLatestSchedulerPolicy(created, true)
        drainScheduler(created)
      }
    })
  } else {
    scheduler.latestMaxBackgroundLiveSubscriptions = policy.maxBackgroundLiveSubscriptions
    scheduler.latestMaxLiveSubscriptions = policy.maxLiveSubscriptions
    scheduler.latestMaxSubscriptions = policy.maxSubscriptions

    applyLatestSchedulerPolicy(scheduler, scheduler.active.total === 0)
    emitSchedulerState()
  }

  return scheduler
}

const scheduleSubscription = (
  socket: Socket | undefined,
  policy: SchedulerPolicy,
  limits: SchedulerPolicy,
  requestClass: RequestClass,
  priority: number,
  owner: string | undefined,
  filterCounts: number[],
  start: () => void,
) => {
  const weight = filterCounts.length

  if (!socket) {
    return {releases: Array.from({length: weight}, () => () => {}), start}
  }

  const scheduler = getSubscriptionScheduler(socket, policy)

  const job: SchedulerJob = {
    cancelled: false,
    maxBackgroundLiveSubscriptions: limits.maxBackgroundLiveSubscriptions,
    maxLiveSubscriptions: limits.maxLiveSubscriptions,
    maxSubscriptions: limits.maxSubscriptions,
    owner,
    priority,
    queuedAt: Date.now(),
    remainingFilterCount: filterCounts.reduce((sum, count) => sum + count, 0),
    remainingWeight: weight,
    requestClass,
    sequence: subscriptionSequence++,
    start,
    started: false,
    weight,
  }

  scheduler.queue.push(job)
  updateTrackedScheduler(scheduler)
  emitSchedulerState()

  const releases = Array.from({length: weight}, (_, index) => {
    let released = false

    return () => {
      if (released) return

      released = true

      if (!job.started) {
        job.cancelled = true
      } else {
        job.remainingWeight = Math.max(0, job.remainingWeight - 1)
        job.remainingFilterCount = Math.max(0, job.remainingFilterCount - filterCounts[index])

        if (job.remainingWeight === 0) {
          scheduler.activeJobs.delete(job)
        }

        scheduler.active.total = Math.max(0, scheduler.active.total - 1)

        if (job.requestClass !== "finite") {
          scheduler.active.live = Math.max(0, scheduler.active.live - 1)
        }

        if (job.requestClass === "background-live") {
          scheduler.active.backgroundLive = Math.max(0, scheduler.active.backgroundLive - 1)
        }

        if (scheduler.active.total === 0) {
          applyLatestSchedulerPolicy(scheduler, true)
        }
      }

      drainScheduler(scheduler)
    }
  })

  return {releases, start: () => drainScheduler(scheduler)}
}

export class RequestAdmissionError extends Error {
  constructor(
    readonly requestClass: RequestClass,
    readonly requiredSubscriptions: number,
    readonly maxSubscriptions: number,
  ) {
    super(
      `${requestClass} request requires ${requiredSubscriptions} subscriptions but its cap is ${maxSubscriptions}`,
    )

    this.name = "RequestAdmissionError"
  }
}

const validateLimit = (name: string, value: number | undefined) => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

const getLimit = (fallback: number, ...values: (number | undefined)[]) => {
  const defined = values.filter((value): value is number => value !== undefined)

  return defined.length > 0 ? Math.min(...defined) : fallback
}

const messageEncoder = new TextEncoder()

const getMessageBytes = (message: unknown) =>
  messageEncoder.encode(JSON.stringify(message)).byteLength

const chunkFilters = (filters: Filter[], maxFilters: number, maxMessageBytes: number) => {
  const chunks: Filter[][] = []

  let chunk: Filter[] = []

  for (const filter of filters) {
    if (
      chunk.length >= maxFilters ||
      (chunk.length > 0 &&
        getMessageBytes([ClientMessageType.Req, "REQ-00000000", ...chunk, filter]) >
          maxMessageBytes)
    ) {
      chunks.push(chunk)
      chunk = []
    }

    chunk.push(filter)

    if (getMessageBytes([ClientMessageType.Req, "REQ-00000000", ...chunk]) > maxMessageBytes) {
      throw new Error("REQ exceeds maxMessageBytes")
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk)
  }

  return chunks
}

export type BaseRequestOptions = {
  maxFiltersPerSubscription?: number
  maxSubscriptions?: number
  maxLiveSubscriptions?: number
  maxBackgroundLiveSubscriptions?: number
  maxMessageBytes?: number
  criticalLivePriority?: number
  priority?: number
  lifetime?: RequestLifetime
  owner?: string
  signal?: AbortSignal
  tracker?: Tracker
  context?: AdapterContext
  autoClose?: boolean
  isEventValid?: (event: TrustedEvent, url: string) => boolean
  isEventDeleted?: (event: TrustedEvent, url: string) => boolean
  onEvent?: (event: TrustedEvent, url: string) => void
  onDeleted?: (event: unknown, url: string) => void
  onInvalid?: (event: unknown, url: string) => void
  onFiltered?: (event: TrustedEvent, url: string) => void
  onDuplicate?: (event: TrustedEvent, url: string) => void
  onStart?: (url: string) => void
  onDisconnect?: (url: string) => void
  onEose?: (url: string) => void
  onClosed?: (message: string, url: string) => void
  onClose?: () => void
}

export type RequestOneOptions = BaseRequestOptions & {
  relay: string
  filters: Filter[]
}

type RequestTask = {
  canRetryArray: boolean
  done: boolean
  filters: Filter[]
  id: string
  release: () => void
  sent: boolean
}

export const requestOne = (options: RequestOneOptions) => {
  const relayPolicy = resolveRequestPolicy(options.relay) || {}

  validateLimit("maxFiltersPerSubscription", options.maxFiltersPerSubscription)
  validateLimit("maxFiltersPerSubscription", relayPolicy.maxFiltersPerSubscription)
  validateLimit("maxSubscriptions", options.maxSubscriptions)
  validateLimit("maxSubscriptions", relayPolicy.maxSubscriptions)
  validateLimit("maxLiveSubscriptions", options.maxLiveSubscriptions)
  validateLimit("maxLiveSubscriptions", relayPolicy.maxLiveSubscriptions)
  validateLimit("maxBackgroundLiveSubscriptions", options.maxBackgroundLiveSubscriptions)
  validateLimit("maxBackgroundLiveSubscriptions", relayPolicy.maxBackgroundLiveSubscriptions)
  validateLimit("maxMessageBytes", options.maxMessageBytes)
  validateLimit("maxMessageBytes", relayPolicy.maxMessageBytes)

  const maxFilters = getLimit(
    1,
    options.maxFiltersPerSubscription,
    relayPolicy.maxFiltersPerSubscription,
  )
  const policyMaxSubscriptions = getLimit(Infinity, relayPolicy.maxSubscriptions)
  const policyMaxLiveSubscriptions = Math.min(
    policyMaxSubscriptions,
    getLimit(policyMaxSubscriptions, relayPolicy.maxLiveSubscriptions),
  )
  const policyMaxBackgroundLiveSubscriptions = Math.min(
    policyMaxLiveSubscriptions,
    getLimit(policyMaxLiveSubscriptions, relayPolicy.maxBackgroundLiveSubscriptions),
  )
  const maxSubscriptions = getLimit(policyMaxSubscriptions, options.maxSubscriptions)
  const maxLiveSubscriptions = Math.min(
    maxSubscriptions,
    getLimit(policyMaxLiveSubscriptions, options.maxLiveSubscriptions),
  )
  const maxBackgroundLiveSubscriptions = Math.min(
    maxLiveSubscriptions,
    getLimit(policyMaxBackgroundLiveSubscriptions, options.maxBackgroundLiveSubscriptions),
  )

  const schedulerPolicy: SchedulerPolicy = {
    maxBackgroundLiveSubscriptions: policyMaxBackgroundLiveSubscriptions,
    maxLiveSubscriptions: policyMaxLiveSubscriptions,
    maxSubscriptions: policyMaxSubscriptions,
  }

  const requestLimits: SchedulerPolicy = {
    maxBackgroundLiveSubscriptions,
    maxLiveSubscriptions,
    maxSubscriptions,
  }

  const maxMessageBytes = getLimit(Infinity, options.maxMessageBytes, relayPolicy.maxMessageBytes)

  const criticalLivePriorities = [
    options.criticalLivePriority,
    relayPolicy.criticalLivePriority,
  ].filter((value): value is number => value !== undefined)

  const criticalLivePriority =
    criticalLivePriorities.length > 0 ? Math.max(...criticalLivePriorities) : Infinity

  const priority = options.priority ?? relayPolicy.priority ?? 0

  if (
    !Number.isFinite(priority) ||
    (criticalLivePriority !== Infinity && !Number.isFinite(criticalLivePriority))
  ) {
    throw new Error("request priorities must be finite")
  }

  const lifetime = options.lifetime ?? (options.autoClose ? "finite" : "live")

  if (lifetime !== "finite" && lifetime !== "live") {
    throw new Error('request lifetime must be "finite" or "live"')
  }

  const requestClass: RequestClass =
    lifetime === "finite"
      ? "finite"
      : priority >= criticalLivePriority
        ? "critical-live"
        : "background-live"

  const filterChunks = chunkFilters(options.filters, maxFilters, maxMessageBytes)

  const classCap =
    requestClass === "background-live" ? maxBackgroundLiveSubscriptions : maxLiveSubscriptions

  if (requestClass !== "finite" && filterChunks.length > classCap) {
    throw new RequestAdmissionError(requestClass, filterChunks.length, classCap)
  }

  const ids = new Set<string>()
  const eose = new Set<string>()
  const events: TrustedEvent[] = []
  const deferred = defer<TrustedEvent[]>()
  const tracker = options.tracker || new Tracker()
  const adapter = getAdapter(options.relay, options.context)
  const isEventValid = options.isEventValid || netContext.isEventValid
  const isEventDeleted = options.isEventDeleted || netContext.isEventDeleted

  const makeTask = (filters: Filter[], canRetryArray = true): RequestTask => ({
    canRetryArray,
    done: false,
    filters,
    id: `REQ-${randomId().slice(0, 8)}`,
    release: () => {},
    sent: false,
  })

  const tasks = filterChunks.map(filters => makeTask(filters))

  tasks.forEach(task => ids.add(task.id))

  let closed = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribers: (() => void)[] = []

  const finishTask = (task: RequestTask, sendClose: boolean) => {
    if (task.done) return

    task.done = true

    if (sendClose && task.sent) {
      adapter.send([ClientMessageType.Close, task.id])
    }

    task.release()
  }

  const socket = adapter.sockets.length === 1 ? adapter.sockets[0] : undefined

  const sendTask = (task: RequestTask) => {
    if (closed) return

    options.onStart?.(options.relay)

    task.sent = true
    adapter.send([ClientMessageType.Req, task.id, ...task.filters])
  }

  const scheduleFiniteTasks = (candidateTasks: RequestTask[]) => {
    const scheduledTasks = candidateTasks.map(task => ({
      scheduled: scheduleSubscription(
        socket,
        schedulerPolicy,
        requestLimits,
        requestClass,
        priority,
        options.owner,
        [task.filters.length],
        () => sendTask(task),
      ),
      task,
    }))

    scheduledTasks.forEach(({scheduled, task}) => {
      task.release = scheduled.releases[0]
    })

    scheduledTasks.forEach(({scheduled}) => scheduled.start())
  }

  const isArrayTooBigReason = (reason?: string) =>
    /(?:bad req|arr(?:ay)? too big)/i.test(reason || "")

  const retryFiniteTask = (task: RequestTask, reason: string) => {
    if (
      requestClass !== "finite" ||
      !task.canRetryArray ||
      task.filters.length <= 1 ||
      !isArrayTooBigReason(reason)
    ) {
      return false
    }

    finishTask(task, false)

    const maxRetryFilters = Math.max(1, Math.floor(task.filters.length / 2))
    const replacements = chunkFilters(task.filters, maxRetryFilters, maxMessageBytes).map(
      filters => makeTask(filters, false),
    )

    tasks.splice(tasks.indexOf(task), 1, ...replacements)
    ids.delete(task.id)
    replacements.forEach(replacement => ids.add(replacement.id))
    scheduleFiniteTasks(replacements)

    return true
  }

  const close = () => {
    if (closed) return

    closed = true

    if (closeTimer) {
      clearTimeout(closeTimer)
    }

    for (const task of tasks) {
      finishTask(task, true)
    }

    options.onClose?.()
    adapter.cleanup()
    unsubscribers.map(call)
    deferred.resolve(deduplicateEvents(events))
  }

  if (filterChunks.length === 0) {
    close()

    return deferred
  }

  unsubscribers = [
    on(adapter, AdapterEvent.Receive, (message: RelayMessage, url: string) => {
      if (isRelayEvent(message)) {
        const [_, id, event] = message

        if (ids.has(id) && tasks.some(task => task.id === id && !task.done)) {
          if (tracker.track(event.id, url)) {
            options.onDuplicate?.(event, url)
          } else if (isEventDeleted(event, url)) {
            options.onDeleted?.(event, url)
          } else if (!isEventValid(event, url)) {
            options.onInvalid?.(event, url)
          } else if (!matchFilters(options.filters, event)) {
            options.onFiltered?.(event, url)
          } else {
            options.onEvent?.(event, url)
            events.push(event)
          }
        }
      }

      if (isRelayEose(message)) {
        const [_, id] = message
        const task = tasks.find(candidate => candidate.id === id)

        if (task && !task.done) {
          eose.add(id)

          if (options.autoClose) {
            finishTask(task, true)
          }

          if (tasks.every(candidate => eose.has(candidate.id))) {
            options.onEose?.(url)
          }

          if (options.autoClose && tasks.every(candidate => candidate.done)) {
            close()
          }
        }
      }

      if (isRelayClosed(message)) {
        const [_, id, reason] = message
        const task = tasks.find(candidate => candidate.id === id)

        if (task && !task.done) {
          if (retryFiniteTask(task, reason)) return

          finishTask(task, false)
          options.onClosed?.(reason, url)

          if (requestClass !== "finite" && isArrayTooBigReason(reason)) {
            close()

            return
          }

          if (tasks.every(candidate => candidate.done)) {
            close()
          }
        }
      }
    }),
  ]

  // Listen to disconnects from any sockets
  for (const socket of adapter.sockets) {
    unsubscribers.push(
      on(socket, SocketEvent.Status, (status: SocketStatus) => {
        if (![SocketStatus.Open, SocketStatus.Opening].includes(status)) {
          options.onDisconnect?.(socket.url)
          close()
        }
      }),
    )
  }

  // Handle abort signal
  if (options.signal) {
    const signal = options.signal
    signal.addEventListener("abort", close)
    unsubscribers.push(() => signal.removeEventListener("abort", close))
  }

  // If we're auto-closing, make sure it happens even if the relay doesn't send an eose
  // and the caller doesn't provide a signal, in order to avoid memory leaks
  if (options.autoClose && !options.signal) {
    closeTimer = setTimeout(close, 30_000)
  }

  if (options.signal?.aborted) {
    close()

    return deferred
  }

  if (requestClass === "finite") {
    scheduleFiniteTasks(tasks)
  } else {
    const scheduled = scheduleSubscription(
      socket,
      schedulerPolicy,
      requestLimits,
      requestClass,
      priority,
      options.owner,
      tasks.map(task => task.filters.length),
      () => tasks.forEach(sendTask),
    )

    tasks.forEach((task, index) => {
      task.release = scheduled.releases[index]
    })

    scheduled.start()
  }

  return deferred
}

export type RequestOptions = BaseRequestOptions & {
  relays: string[]
  filters: Filter[]
  threshold?: number
}

export const request = async (options: RequestOptions) => {
  const successful = new Set<string>()
  const failed = new Set<string>()
  const ctrl = new AbortController()
  const relays = new Set(options.relays)
  const tracker = options.tracker || new Tracker()
  const signal = options.signal ? AbortSignal.any([options.signal, ctrl.signal]) : ctrl.signal
  const threshold = options.threshold || 1

  if (relays.size !== options.relays.length) {
    console.warn("Non-unique relays passed to request")
  }

  return flatten(
    await Promise.all(
      Array.from(relays).map(relay =>
        requestOne({
          ...options,
          tracker,
          signal,
          relay,
          onEose: url => {
            successful.add(relay)
            options.onEose?.(url)
          },
          onClosed: (reason, url) => {
            failed.add(relay)
            options.onClosed?.(reason, url)
          },
          onDisconnect: url => {
            failed.add(relay)
            options.onDisconnect?.(url)
          },
          onClose: () => {
            if (
              successful.has(relay) &&
              !failed.has(relay) &&
              successful.size >= relays.size * threshold
            ) {
              options.onClose?.()
              ctrl.abort()
            }
          },
        }),
      ),
    ),
  )
}

export type LoaderOptions = {
  maxFiltersPerSubscription?: number
  maxSubscriptions?: number
  maxLiveSubscriptions?: number
  maxBackgroundLiveSubscriptions?: number
  maxMessageBytes?: number
  criticalLivePriority?: number
  priority?: number
  owner?: string
  delay: number
  timeout?: number
  threshold?: number
  context?: AdapterContext
  isEventValid?: (event: TrustedEvent, url: string) => boolean
  isEventDeleted?: (event: TrustedEvent, url: string) => boolean
}

export type LoadOptions = {
  relays: string[]
  filters: Filter[]
  signal?: AbortSignal
  priority?: number
  owner?: string
  onStart?: (url: string) => void
  onEvent?: (event: TrustedEvent, url: string) => void
  onDisconnect?: (url: string) => void
  onEose?: (url: string) => void
  onClosed?: (message: string, url: string) => void
  onClose?: () => void
}

export type Loader = (options: LoadOptions) => Promise<TrustedEvent[]>

/**
 * Creates a convenience function which returns a promise of events from a request.
 * It may return early if filter cardinality is known, and it delays requests in order
 * to implement batching
 * @param options - LoaderOptions
 * @returns - a load function
 */
export const makeLoader = (options: LoaderOptions) =>
  batcher(options.delay, (allRequests: LoadOptions[]) => {
    const resultsByRequest = new Map<LoadOptions, Deferred<TrustedEvent[], unknown>>()
    const eventsByRequest = new Map<LoadOptions, TrustedEvent[]>()
    const requestsByRelay = new Map<string, LoadOptions[]>()
    const controllersByRelay = new Map<string, AbortController>()
    const signalsByRelay = new Map<string, AbortSignal>()
    const closedRequestsByRelay = new Map<string, Set<LoadOptions>>()
    const closedRelaysByRequest = new Map<LoadOptions, Set<string>>()
    const relays = uniq(allRequests.flatMap(r => r.relays))
    const threshold = options.threshold || 1
    const tracker = new Tracker()

    const abortHandlersByRequest = new Map<LoadOptions, () => void>()
    const resolvedRequests = new Set<LoadOptions>()

    const close = (relay: string, request: LoadOptions) => {
      addToMapKey(closedRequestsByRelay, relay, request)
      addToMapKey(closedRelaysByRequest, request, relay)

      const closedRelays = closedRelaysByRequest.get(request)?.size || 0
      if (
        !resolvedRequests.has(request) &&
        closedRelays >= uniq(request.relays).length * threshold
      ) {
        resolvedRequests.add(request)

        const events = deduplicateEvents(eventsByRequest.get(request) || [])

        request.onClose?.()
        resultsByRequest.get(request)?.resolve(events)

        // Clean up the abort listener once the request is fully resolved
        const abortHandler = abortHandlersByRequest.get(request)
        if (abortHandler) {
          request.signal?.removeEventListener("abort", abortHandler)
          abortHandlersByRequest.delete(request)
        }
      }

      if (closedRequestsByRelay.get(relay)?.size === requestsByRelay.get(relay)?.length) {
        controllersByRelay.get(relay)?.abort()
      }
    }

    for (const request of allRequests) {
      const requestRelays = uniq(request.relays)

      resultsByRequest.set(request, defer())

      if (request.signal?.aborted || requestRelays.length === 0) {
        request.onClose?.()
        resolvedRequests.add(request)
        resultsByRequest.get(request)?.resolve([])
        continue
      }

      for (const relay of requestRelays) {
        pushToMapKey(requestsByRelay, relay, request)
      }

      // Propagate one abort listener across all relays for this logical request.
      if (request.signal) {
        const abortHandler = () => requestRelays.forEach(relay => close(relay, request))
        abortHandlersByRequest.set(request, abortHandler)
        request.signal.addEventListener("abort", abortHandler)
      }
    }

    // Create an abort controller for each relay
    for (const relay of relays) {
      const controller = new AbortController()
      const signals = [controller.signal]

      if (options.timeout) {
        signals.push(AbortSignal.timeout(options.timeout))
      }

      controllersByRelay.set(relay, controller)
      signalsByRelay.set(relay, AbortSignal.any(signals))
    }

    Array.from(requestsByRelay).forEach(([relay, requests]) => {
      // Union all filters for a given request and send them together
      const filters = unionFilters(requests.flatMap(r => r.filters))

      // Propagate events to caller, but only for requests that have not been aborted
      const getOpenRequests = () =>
        requests.filter(request => !closedRequestsByRelay.get(relay)?.has(request))

      try {
        requestOne({
          relay,
          filters,
          tracker,
          autoClose: true,
          signal: signalsByRelay.get(relay),
          maxFiltersPerSubscription: options.maxFiltersPerSubscription,
          maxSubscriptions: options.maxSubscriptions,
          maxLiveSubscriptions: options.maxLiveSubscriptions,
          maxBackgroundLiveSubscriptions: options.maxBackgroundLiveSubscriptions,
          maxMessageBytes: options.maxMessageBytes,
          criticalLivePriority: options.criticalLivePriority,
          priority: Math.max(options.priority ?? 0, ...requests.map(request => request.priority ?? 0)),
          owner:
            Array.from(
              new Set([options.owner, ...requests.map(request => request.owner)].filter(Boolean)),
            )
              .sort()
              .join(",") || undefined,
          context: options.context,
          isEventValid: options.isEventValid,
          isEventDeleted: options.isEventDeleted,
          onEvent: (event: TrustedEvent, url: string) => {
            for (const request of getOpenRequests()) {
              if (matchFilters(request.filters, event)) {
                pushToMapKey(eventsByRequest, request, event)
                request.onEvent?.(event, url)

                // Calculate cardinality for unioned filters so that we can return early
                if (request.filters.length === 1) {
                  const cardinality = getFilterResultCardinality(request.filters[0])

                  if (eventsByRequest.get(request)?.length === cardinality) {
                    close(relay, request)
                  }
                }
              }
            }
          },
          onStart: (url: string) => getOpenRequests().forEach(request => request.onStart?.(url)),
          onDisconnect: (url: string) =>
            getOpenRequests().forEach(request => request.onDisconnect?.(url)),
          onEose: (url: string) => getOpenRequests().forEach(request => request.onEose?.(url)),
          onClosed: (reason: string, url: string) =>
            getOpenRequests().forEach(request => request.onClosed?.(reason, url)),
          onClose: () => requests.forEach(request => close(relay, request)),
        })
      } catch (error) {
        controllersByRelay.get(relay)?.abort()

        for (const request of requests) {
          resolvedRequests.add(request)

          const abortHandler = abortHandlersByRequest.get(request)
          if (abortHandler) {
            request.signal?.removeEventListener("abort", abortHandler)
            abortHandlersByRequest.delete(request)
          }

          resultsByRequest.get(request)?.reject(error)
        }
      }
    })

    return allRequests.map(r => resultsByRequest.get(r) || [])
  }) as Loader

export const load = makeLoader({delay: 200, timeout: 3000, threshold: 0.5})
