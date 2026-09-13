import {subscribePublicationLifecycle} from "@welshman/app"
import type {PublishResultsByRelay} from "@welshman/net"
import type {Readable} from "svelte/store"
import {classifyRelayPublishOutcome} from "./relay-publish-outcomes"
import {
  debugDiagnosticsSettings,
  recordDebugDiagnostic,
  type DebugDiagnosticsSettings,
} from "@app/core/debug-diagnostics"

type PublicationOperationDiagnostic = {
  operationId: string
  event: {kind: number}
  phase: string
  attempt: number
  stage?: string
  results: PublishResultsByRelay
}

export const recordPublicationOperationDiagnostic = (
  type: string,
  operation: PublicationOperationDiagnostic,
  transition: Record<string, unknown> = {},
) => {
  try {
    return recordDebugDiagnostic("publication-lifecycle", type, {
      operationId: operation.operationId,
      eventKind: operation.event.kind,
      phase: operation.phase,
      attempt: operation.attempt,
      ...(operation.stage ? {stage: operation.stage} : {}),
      results: Object.entries(operation.results).map(([relay, result]) => ({
        relay,
        status: result.status,
        // Classified reason only: arbitrary relay text can contain private data.
        reason: classifyRelayPublishOutcome(relay, result).reason,
      })),
      ...transition,
    })
  } catch {
    return false
  }
}

export const installPublicationDebugDiagnostics = ({
  enabled,
  settings = debugDiagnosticsSettings,
  record = recordDebugDiagnostic,
  subscribe = subscribePublicationLifecycle,
}: {
  enabled: boolean
  settings?: Readable<DebugDiagnosticsSettings>
  record?: typeof recordDebugDiagnostic
  subscribe?: typeof subscribePublicationLifecycle
}) => {
  if (!enabled) return () => {}

  let unsubscribeLifecycle: (() => void) | undefined
  const stop = () => {
    unsubscribeLifecycle?.()
    unsubscribeLifecycle = undefined
  }
  const unsubscribeSettings = settings.subscribe(current => {
    if (current.categories["publication-lifecycle"] && !unsubscribeLifecycle) {
      unsubscribeLifecycle = subscribe(event => {
        try {
          record("publication-lifecycle", event.type, event)
        } catch {
          // Diagnostics must never affect publication.
        }
      })
    } else if (!current.categories["publication-lifecycle"]) {
      stop()
    }
  })

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    unsubscribeSettings()
    stop()
  }
}
