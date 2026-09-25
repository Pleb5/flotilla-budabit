import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {beginCashuDiagnostic, traceCashu, type CashuDiagnosticDetail} from "./cashu-diagnostics"
import {
  clearDebugDiagnostics,
  getDebugDiagnosticsSnapshot,
  setDebugDiagnosticCategoryEnabled,
  startDebugDiagnosticsCapture,
} from "./debug-diagnostics"
import {
  activePerformanceDiagnosticsRun,
  beginPerformanceDiagnosticsRun,
  clearPerformanceDiagnostics,
  getPerformanceDiagnosticsSnapshot,
} from "./performance-diagnostics"

const gates = vi.hoisted(() => ({DIAGNOSTICS_ENABLED: true, PERFORMANCE_DIAGNOSTICS_ENABLED: true}))
vi.mock("./feature-flags", () => gates)
beforeEach(() => {
  gates.DIAGNOSTICS_ENABLED = true
  gates.PERFORMANCE_DIAGNOSTICS_ENABLED = true
  clearDebugDiagnostics()
  clearPerformanceDiagnostics()
  setDebugDiagnosticCategoryEnabled("cashu-wallet", false)
})
afterEach(() => {
  clearDebugDiagnostics()
  clearPerformanceDiagnostics()
})
const capture = () => {
  setDebugDiagnosticCategoryEnabled("cashu-wallet", true)
  startDebugDiagnosticsCapture()
  const id = beginPerformanceDiagnosticsRun({route: "/settings/wallet"})
  activePerformanceDiagnosticsRun.set({
    id,
    route: "/settings/wallet",
    preset: "custom",
    automatic: false,
  })
}
describe("wallet diagnostic artifacts", () => {
  it("requires build gates and active captures", () => {
    expect(beginCashuDiagnostic("initialize")).toBeUndefined()
    capture()
    gates.DIAGNOSTICS_ENABLED = false
    gates.PERFORMANCE_DIAGNOSTICS_ENABLED = false
    expect(beginCashuDiagnostic("initialize")).toBeUndefined()
    expect(getDebugDiagnosticsSnapshot().records).toEqual([])
    expect(getPerformanceDiagnosticsSnapshot().runs[0].records).toEqual([])
  })

  it("records budgets, delays, outcomes and operations in both existing artifact formats", async () => {
    capture()
    beginCashuDiagnostic("reconcile", {source: "explicit", priority: "background"})?.({
      rows: 1000,
      queueMs: 12,
      outcome: "budget-exhausted",
    })
    const operation = traceCashu("invoice-pay", async () => ({
      state: "pending",
      invoice: "private invoice",
    }))
    await operation()
    const debug = getDebugDiagnosticsSnapshot().records
    expect(debug).toContainEqual(
      expect.objectContaining({
        category: "cashu-wallet",
        type: "reconcile:finish",
        detail: expect.objectContaining({
          rows: 1000,
          queueMs: 12,
          durationMs: expect.any(Number),
          outcome: "budget-exhausted",
        }),
      }),
    )
    expect(debug).toContainEqual(
      expect.objectContaining({
        type: "invoice-pay:finish",
        detail: expect.objectContaining({state: "pending"}),
      }),
    )
    expect(getPerformanceDiagnosticsSnapshot().runs[0].records).toHaveLength(4)
  })

  it("never serializes arguments, SDK results, errors or unexpected detail fields", async () => {
    capture()
    const marker = "synthetic-private-wallet-payload"
    const op = traceCashu("receive", async (_token: string) => {
      throw new Error(marker)
    })
    await expect(op(marker)).rejects.toThrow(marker)
    beginCashuDiagnostic("lookup", {
      source: marker,
      event: marker,
      state: marker,
      proofs: [marker],
      token: marker,
      mintUrl: marker,
      amount: 42,
      rows: 2,
      count: NaN,
    } as unknown as CashuDiagnosticDetail)?.()
    const serialized = JSON.stringify([
      getDebugDiagnosticsSnapshot(),
      getPerformanceDiagnosticsSnapshot(),
    ])
    expect(serialized).not.toContain(marker)
    expect(serialized).not.toContain('"amount"')
    expect(getDebugDiagnosticsSnapshot().records[1]).toMatchObject({
      type: "receive:finish",
      detail: {outcome: "error"},
    })
  })
})
