import {describe, expect, it, vi} from "vitest"
import type {RequestSchedulerSnapshot} from "@welshman/net"
import {aggregateRelayDiagnostics, createRelayDiagnosticMonitor} from "./relay-diagnostics"

const makeSnapshot = (
  overrides: Partial<RequestSchedulerSnapshot> = {},
): RequestSchedulerSnapshot => ({
  relay: "wss://relay.example/",
  configuredMaxSubscriptions: 28,
  configuredMaxLiveSubscriptions: 24,
  configuredMaxBackgroundLiveSubscriptions: 18,
  learnedMaxSubscriptions: null,
  effectiveMaxSubscriptions: 28,
  active: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  queued: {total: 0, finite: 0, live: 0, criticalLive: 0, backgroundLive: 0},
  oldestQueuedAgeMs: 0,
  oldestQueuedAgeMsByClass: {finite: 0, "critical-live": 0, "background-live": 0},
  owners: [],
  noticeCount: 0,
  lastQueueStartDelayMs: 0,
  maxQueueStartDelayMs: 0,
  ...overrides,
})

describe("relay diagnostics", () => {
  it("aggregates duplicate socket snapshots by relay and owner", () => {
    const snapshots = aggregateRelayDiagnostics([
      makeSnapshot({
        active: {total: 1, finite: 0, live: 1, criticalLive: 0, backgroundLive: 1},
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 1,
            activeFilters: 2,
            queuedSubscriptions: 0,
            queuedFilters: 0,
          },
        ],
        noticeCount: 1,
      }),
      makeSnapshot({
        learnedMaxSubscriptions: 20,
        active: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
        queued: {total: 1, finite: 0, live: 1, criticalLive: 1, backgroundLive: 0},
        oldestQueuedAgeMs: 2_000,
        oldestQueuedAgeMsByClass: {
          finite: 0,
          "critical-live": 2_000,
          "background-live": 0,
        },
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 1,
            activeFilters: 1,
            queuedSubscriptions: 1,
            queuedFilters: 3,
          },
        ],
        noticeCount: 2,
      }),
    ])

    expect(snapshots).toEqual([
      expect.objectContaining({
        relay: "wss://relay.example/",
        learnedMaxSubscriptions: 20,
        active: {total: 2, finite: 1, live: 1, criticalLive: 0, backgroundLive: 1},
        queued: {total: 1, finite: 0, live: 1, criticalLive: 1, backgroundLive: 0},
        oldestQueuedAgeMs: 2_000,
        noticeCount: 3,
        owners: [
          {
            owner: "extension:a",
            activeSubscriptions: 2,
            activeFilters: 3,
            queuedSubscriptions: 1,
            queuedFilters: 3,
          },
        ],
      }),
    ])
  })

  it("does not emit production-disabled warnings", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({enabled: false, warn})

    monitor.inspect([
      makeSnapshot({
        active: {total: 28, finite: 8, live: 20, criticalLive: 2, backgroundLive: 18},
        queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
        oldestQueuedAgeMsByClass: {
          finite: 10_000,
          "critical-live": 0,
          "background-live": 0,
        },
      }),
    ])

    expect(warn).not.toHaveBeenCalled()
  })

  it("warns for saturation, stale priority work, and unexpected live growth", () => {
    let timestamp = 1_000
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({
      enabled: true,
      now: () => timestamp,
      warn,
      warningIntervalMs: 30_000,
    })
    monitor.inspect([
      makeSnapshot({
        active: {total: 26, finite: 7, live: 19, criticalLive: 1, backgroundLive: 18},
      }),
    ])

    const saturated = makeSnapshot({
      active: {total: 28, finite: 8, live: 20, criticalLive: 2, backgroundLive: 18},
      queued: {total: 2, finite: 1, live: 1, criticalLive: 1, backgroundLive: 0},
      oldestQueuedAgeMs: 7_000,
      oldestQueuedAgeMsByClass: {
        finite: 7_000,
        "critical-live": 6_000,
        "background-live": 0,
      },
      owners: [
        {
          owner: "community-core",
          activeSubscriptions: 20,
          activeFilters: 40,
          queuedSubscriptions: 1,
          queuedFilters: 2,
        },
      ],
    })
    monitor.inspect([saturated])

    expect(warn.mock.calls.map(([, warning]) => warning.kind)).toEqual([
      "saturation",
      "priority-queue",
      "live-growth",
    ])

    timestamp += 1_000
    monitor.inspect([saturated])
    expect(warn).toHaveBeenCalledTimes(3)

    timestamp += 30_000
    monitor.inspect([saturated])
    expect(warn.mock.calls.slice(3).map(([, warning]) => warning.kind)).toEqual([
      "saturation",
      "priority-queue",
    ])
  })

  it("bounds warnings emitted by one inspection", () => {
    const warn = vi.fn()
    const monitor = createRelayDiagnosticMonitor({
      enabled: true,
      warn,
      highPriorityQueueAgeMs: 1,
      maxWarningsPerInspection: 1,
    })
    const snapshot = makeSnapshot({
      active: {total: 28, finite: 10, live: 18, criticalLive: 0, backgroundLive: 18},
      queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
      oldestQueuedAgeMsByClass: {finite: 10, "critical-live": 0, "background-live": 0},
    })

    monitor.inspect([snapshot])

    expect(warn).toHaveBeenCalledTimes(1)
  })
})
