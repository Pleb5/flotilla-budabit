import {
  getRequestSchedulerSnapshots,
  subscribeRequestScheduler,
  type RequestSchedulerSnapshot,
} from "@welshman/net"

export type RelayDiagnosticWarningKind = "saturation" | "priority-queue" | "live-growth"

export type RelayDiagnosticWarning = {
  kind: RelayDiagnosticWarningKind
  relay: string
  snapshot: RequestSchedulerSnapshot
}

type RelayDiagnosticMonitorOptions = {
  enabled: boolean
  now?: () => number
  warn?: (message: string, warning: RelayDiagnosticWarning) => void
  warningIntervalMs?: number
  highPriorityQueueAgeMs?: number
  maxWarningsPerInspection?: number
}

const DEFAULT_WARNING_INTERVAL_MS = 30_000
const DEFAULT_HIGH_PRIORITY_QUEUE_AGE_MS = 5_000
const DEFAULT_MAX_WARNINGS_PER_INSPECTION = 3

export const aggregateRelayDiagnostics = (snapshots: RequestSchedulerSnapshot[]) => {
  const byRelay = new Map<string, RequestSchedulerSnapshot>()

  for (const snapshot of snapshots) {
    const current = byRelay.get(snapshot.relay)
    if (!current) {
      byRelay.set(snapshot.relay, {
        ...snapshot,
        active: {...snapshot.active},
        queued: {...snapshot.queued},
        oldestQueuedAgeMsByClass: {...snapshot.oldestQueuedAgeMsByClass},
        owners: snapshot.owners.map(owner => ({...owner})),
      })
      continue
    }

    for (const key of Object.keys(current.active) as Array<keyof typeof current.active>) {
      current.active[key] += snapshot.active[key]
      current.queued[key] += snapshot.queued[key]
    }
    current.configuredMaxSubscriptions = Math.min(
      current.configuredMaxSubscriptions,
      snapshot.configuredMaxSubscriptions,
    )
    current.configuredMaxLiveSubscriptions = Math.min(
      current.configuredMaxLiveSubscriptions,
      snapshot.configuredMaxLiveSubscriptions,
    )
    current.configuredMaxBackgroundLiveSubscriptions = Math.min(
      current.configuredMaxBackgroundLiveSubscriptions,
      snapshot.configuredMaxBackgroundLiveSubscriptions,
    )
    current.effectiveMaxSubscriptions = Math.min(
      current.effectiveMaxSubscriptions,
      snapshot.effectiveMaxSubscriptions,
    )
    if (snapshot.learnedMaxSubscriptions !== null) {
      current.learnedMaxSubscriptions =
        current.learnedMaxSubscriptions === null
          ? snapshot.learnedMaxSubscriptions
          : Math.min(current.learnedMaxSubscriptions, snapshot.learnedMaxSubscriptions)
    }
    current.oldestQueuedAgeMs = Math.max(current.oldestQueuedAgeMs, snapshot.oldestQueuedAgeMs)
    for (const requestClass of ["finite", "critical-live", "background-live"] as const) {
      current.oldestQueuedAgeMsByClass[requestClass] = Math.max(
        current.oldestQueuedAgeMsByClass[requestClass],
        snapshot.oldestQueuedAgeMsByClass[requestClass],
      )
    }
    current.noticeCount += snapshot.noticeCount
    current.lastQueueStartDelayMs = Math.max(
      current.lastQueueStartDelayMs,
      snapshot.lastQueueStartDelayMs,
    )
    current.maxQueueStartDelayMs = Math.max(
      current.maxQueueStartDelayMs,
      snapshot.maxQueueStartDelayMs,
    )

    for (const owner of snapshot.owners) {
      const existing = current.owners.find(candidate => candidate.owner === owner.owner)
      if (existing) {
        existing.activeSubscriptions += owner.activeSubscriptions
        existing.activeFilters += owner.activeFilters
        existing.queuedSubscriptions += owner.queuedSubscriptions
        existing.queuedFilters += owner.queuedFilters
      } else {
        current.owners.push({...owner})
      }
    }
    current.owners.sort((a, b) => a.owner.localeCompare(b.owner))
  }

  return Array.from(byRelay.values()).sort((a, b) => a.relay.localeCompare(b.relay))
}

export const readRelayDiagnostics = () => aggregateRelayDiagnostics(getRequestSchedulerSnapshots())

export const subscribeRelayDiagnostics = (
  listener: (snapshots: RequestSchedulerSnapshot[]) => void,
) => subscribeRequestScheduler(snapshots => listener(aggregateRelayDiagnostics(snapshots)))

export const createRelayDiagnosticMonitor = ({
  enabled,
  now = Date.now,
  warn = (message, warning) => console.warn(message, warning),
  warningIntervalMs = DEFAULT_WARNING_INTERVAL_MS,
  highPriorityQueueAgeMs = DEFAULT_HIGH_PRIORITY_QUEUE_AGE_MS,
  maxWarningsPerInspection = DEFAULT_MAX_WARNINGS_PER_INSPECTION,
}: RelayDiagnosticMonitorOptions) => {
  const lastWarningAt = new Map<string, number>()
  const previousLiveByRelay = new Map<string, number>()

  const inspect = (snapshots: RequestSchedulerSnapshot[]) => {
    if (!enabled) return

    const timestamp = now()
    const warnings: RelayDiagnosticWarning[] = []
    for (const snapshot of snapshots) {
      const previousLive = previousLiveByRelay.get(snapshot.relay)
      previousLiveByRelay.set(snapshot.relay, snapshot.active.live)

      if (
        snapshot.queued.total > 0 &&
        snapshot.active.total >= snapshot.effectiveMaxSubscriptions
      ) {
        warnings.push({kind: "saturation", relay: snapshot.relay, snapshot})
      }

      const oldestPriorityAge = Math.max(
        snapshot.oldestQueuedAgeMsByClass.finite,
        snapshot.oldestQueuedAgeMsByClass["critical-live"],
      )
      if (oldestPriorityAge >= highPriorityQueueAgeMs) {
        warnings.push({kind: "priority-queue", relay: snapshot.relay, snapshot})
      }

      const liveGrowthThreshold = Math.max(
        4,
        Math.ceil(snapshot.configuredMaxLiveSubscriptions * 0.8),
      )
      if (
        previousLive !== undefined &&
        snapshot.active.live > previousLive &&
        snapshot.active.live >= liveGrowthThreshold
      ) {
        warnings.push({kind: "live-growth", relay: snapshot.relay, snapshot})
      }
    }

    let emitted = 0
    for (const warning of warnings) {
      if (emitted >= maxWarningsPerInspection) break
      const key = `${warning.kind}:${warning.relay}`
      const previousWarningAt = lastWarningAt.get(key)
      if (previousWarningAt !== undefined && timestamp - previousWarningAt < warningIntervalMs) {
        continue
      }

      lastWarningAt.set(key, timestamp)
      emitted += 1
      warn(`[relay-diagnostics] ${warning.kind} on ${warning.relay}`, warning)
    }
  }

  return {inspect}
}

export const installRelayDiagnostics = ({
  enabled,
  pollIntervalMs = 1_000,
}: {
  enabled: boolean
  pollIntervalMs?: number
}) => {
  if (!enabled) return () => {}

  const monitor = createRelayDiagnosticMonitor({enabled})
  const unsubscribe = subscribeRelayDiagnostics(monitor.inspect)
  const interval = setInterval(() => monitor.inspect(readRelayDiagnostics()), pollIntervalMs)

  return () => {
    clearInterval(interval)
    unsubscribe()
  }
}
