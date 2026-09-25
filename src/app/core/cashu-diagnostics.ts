import {get} from "svelte/store"
import {DIAGNOSTICS_ENABLED, PERFORMANCE_DIAGNOSTICS_ENABLED} from "./feature-flags"
import {
  debugDiagnosticsActive,
  isDebugDiagnosticCategoryEnabled,
  recordDebugDiagnostic,
} from "./debug-diagnostics"
import {
  activePerformanceDiagnosticsRun,
  recordPerformanceDiagnostics,
} from "./performance-diagnostics"

// Deliberately closed vocabulary: never pass SDK objects, IDs, mint URLs, amounts,
// invoices, or error messages to the general-purpose diagnostic serializers.
export type CashuDiagnosticOperation =
  | "startup"
  | "initialize"
  | "activity"
  | "lookup"
  | "reconcile"
  | "cache-open"
  | "cache-maintenance"
  | "index-write"
  | "mint-check"
  | "receive"
  | "send"
  | "invoice-prepare"
  | "invoice-pay"
  | "invoice-check"
  | "invoice-cancel"
  | "topup-quote"
  | "topup-claim"
  | "recover"
  | "restore"
  | "wallet-event"
export type CashuDiagnosticDetail = {
  event?:
    | "send:pending"
    | "send:finalized"
    | "send:rolled-back"
    | "receive-op:prepared"
    | "receive-op:finalized"
    | "receive-op:rolled-back"
    | "mint-op:pending"
    | "mint-op:finalized"
    | "mint-op:failed"
  state?:
    | "pending"
    | "paid"
    | "failed"
    | "complete"
    | "unpaid"
    | "expired"
    | "needs_preparation"
    | "recovery_required"
  source?: "startup" | "preview" | "history" | "explicit" | "event"
  priority?: "background" | "user-visible"
  outcome?:
    | "ok"
    | "error"
    | "cancelled"
    | "hit"
    | "miss"
    | "budget-exhausted"
    | "deferred"
    | "complete"
  rows?: number
  proofs?: number
  count?: number
  queueMs?: number
  durationMs?: number
}
const safeDetail = (detail: CashuDiagnosticDetail): CashuDiagnosticDetail => ({
  ...([
    "send:pending",
    "send:finalized",
    "send:rolled-back",
    "receive-op:prepared",
    "receive-op:finalized",
    "receive-op:rolled-back",
    "mint-op:pending",
    "mint-op:finalized",
    "mint-op:failed",
  ].includes(detail.event || "")
    ? {event: detail.event}
    : {}),
  ...([
    "pending",
    "paid",
    "failed",
    "complete",
    "unpaid",
    "expired",
    "needs_preparation",
    "recovery_required",
  ].includes(detail.state || "")
    ? {state: detail.state}
    : {}),
  ...(["startup", "preview", "history", "explicit", "event"].includes(detail.source || "")
    ? {source: detail.source}
    : {}),
  ...(["background", "user-visible"].includes(detail.priority || "")
    ? {priority: detail.priority}
    : {}),
  ...([
    "ok",
    "error",
    "cancelled",
    "hit",
    "miss",
    "budget-exhausted",
    "deferred",
    "complete",
  ].includes(detail.outcome || "")
    ? {outcome: detail.outcome}
    : {}),
  ...Object.fromEntries(
    ["rows", "proofs", "count", "queueMs", "durationMs"].flatMap(key => {
      const value = detail[key as keyof CashuDiagnosticDetail]
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [[key, value]] : []
    }),
  ),
})

export const beginCashuDiagnostic = (
  operation: CashuDiagnosticOperation,
  detail: CashuDiagnosticDetail = {},
) => {
  const debug =
    DIAGNOSTICS_ENABLED &&
    get(debugDiagnosticsActive) &&
    isDebugDiagnosticCategoryEnabled("cashu-wallet")
  const run = PERFORMANCE_DIAGNOSTICS_ENABLED ? get(activePerformanceDiagnosticsRun) : null
  if (!debug && !run) return undefined
  const started = performance.now()
  const emit = (phase: "start" | "finish", extra: CashuDiagnosticDetail = {}) => {
    const data = safeDetail({...detail, ...extra})
    if (debug) recordDebugDiagnostic("cashu-wallet", `${operation}:${phase}`, data)
    if (run) recordPerformanceDiagnostics(run.id, `cashu:${operation}:${phase}`, data)
  }
  emit("start")
  return (extra: CashuDiagnosticDetail = {}) =>
    emit("finish", {durationMs: performance.now() - started, outcome: "ok", ...extra})
}

export const traceCashu =
  <A extends unknown[], T>(operation: CashuDiagnosticOperation, fn: (...args: A) => Promise<T>) =>
  async (...args: A): Promise<T> => {
    const finish = beginCashuDiagnostic(operation)
    try {
      const value = await fn(...args)
      const state =
        value && typeof value === "object" && "state" in value && typeof value.state === "string"
          ? (value.state as CashuDiagnosticDetail["state"])
          : undefined
      finish?.({state})
      return value
    } catch (error) {
      finish?.({
        outcome: error instanceof Error && error.name === "AbortError" ? "cancelled" : "error",
      })
      throw error
    }
  }
