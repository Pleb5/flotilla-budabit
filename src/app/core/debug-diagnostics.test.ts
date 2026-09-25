import {get} from "svelte/store"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY,
  createDebugDiagnosticsRecorder,
  clearDebugDiagnostics,
  defaultDebugDiagnosticsSettings,
  normalizeDebugDiagnosticsSettings,
  prepareDebugDiagnosticsArtifact,
  refreshDebugDiagnosticsSettings,
  debugDiagnosticsSettings,
  ensureAppUpdateDebugDiagnosticsCapture,
  getDebugDiagnosticsSnapshot,
  recordDebugDiagnostic,
  restoreDebugDiagnosticsCapture,
  registerDebugDiagnosticsFinalizer,
  sanitizeDebugDiagnosticValue,
  serializeDebugDiagnostics,
  setDebugDiagnosticCategoryEnabled,
  setDebugDiagnosticsPreset,
  startDebugDiagnosticsCapture,
  stopDebugDiagnosticsCapture,
} from "./debug-diagnostics"

describe("debug diagnostics", () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    const session = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => session.get(key) ?? null,
      removeItem: (key: string) => session.delete(key),
      setItem: (key: string, value: string) => session.set(key, value),
    })
    clearDebugDiagnostics()
    refreshDebugDiagnosticsSettings()
  })

  it("defaults every category off and fails malformed settings closed", () => {
    expect(defaultDebugDiagnosticsSettings().preset).toBe("standard")
    expect(defaultDebugDiagnosticsSettings().categories).toEqual({
      "relay-normalization": false,
      "relay-scheduler": false,
      "publication-lifecycle": false,
      "app-update": false,
      "cashu-wallet": false,
    })
    expect(normalizeDebugDiagnosticsSettings({version: 2, categories: {}})).toEqual(
      defaultDebugDiagnosticsSettings(),
    )
    expect(
      normalizeDebugDiagnosticsSettings({
        version: 1,
        categories: {"relay-normalization": true, unknown: true},
      }),
    ).toMatchObject({
      preset: "standard",
      categories: {
        "relay-normalization": true,
        "relay-scheduler": false,
        "publication-lifecycle": false,
        "app-update": false,
        "cashu-wallet": false,
      },
    })
  })

  it("sanitizes capture IDs independently of community context", () => {
    const recorder = createDebugDiagnosticsRecorder()
    recorder.setCategoryEnabled("app-update", true)
    recorder.start("bunker://fixture-secret")
    const snapshot = recorder.snapshot()
    expect(snapshot.capture.id).toBe("[redacted]")
    const restored = createDebugDiagnosticsRecorder()
    expect(
      restored.restore({
        ...snapshot,
        capture: {...snapshot.capture, id: "bunker://restored-secret"},
      }),
    ).toBe(true)
    expect(restored.snapshot().capture.id).toBe("[redacted]")
  })

  it("persists category selections but no records", () => {
    setDebugDiagnosticCategoryEnabled("relay-normalization", true)

    expect(get(debugDiagnosticsSettings).categories["relay-normalization"]).toBe(true)
    expect(JSON.parse(localStorage.getItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      preset: "standard",
      categories: {
        "relay-normalization": true,
        "relay-scheduler": false,
        "publication-lifecycle": false,
        "app-update": false,
        "cashu-wallet": false,
      },
    })
  })

  it("keeps storage failures isolated from settings and bootstrap", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError")
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError")
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError")
      },
    })

    expect(() => refreshDebugDiagnosticsSettings()).not.toThrow()
    expect(() => setDebugDiagnosticCategoryEnabled("relay-normalization", true)).not.toThrow()
    expect(() => setDebugDiagnosticsPreset("quick")).not.toThrow()
    expect(get(debugDiagnosticsSettings)).toMatchObject({
      preset: "quick",
      categories: {"relay-normalization": true},
    })
  })

  it("persists presets and applies changed limits to the next capture", () => {
    setDebugDiagnosticsPreset("extended")
    expect(get(debugDiagnosticsSettings).preset).toBe("extended")
    expect(JSON.parse(localStorage.getItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY)!).preset).toBe(
      "extended",
    )

    const recorder = createDebugDiagnosticsRecorder()
    recorder.setPreset("standard")
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.start("preset-bounds")
    for (let index = 0; index < 501; index += 1) {
      recorder.record("relay-normalization", `record-${index}`)
    }
    expect(recorder.overview()).toMatchObject({
      preset: "standard",
      recordCount: 501,
      limits: {maxRecords: 5_000, maxRecordsPerCategory: 2_500},
    })

    recorder.setPreset("quick")
    expect(recorder.snapshot()).toMatchObject({
      capture: {
        preset: "standard",
        limits: {maxRecords: 5_000, maxRecordsPerCategory: 2_500},
      },
    })
    expect(recorder.snapshot().records).toHaveLength(501)

    recorder.start("next-capture")
    expect(recorder.snapshot()).toMatchObject({
      capture: {
        preset: "quick",
        limits: {maxRecords: 1_000, maxRecordsPerCategory: 500},
      },
    })
  })

  it("records only while active and enabled", () => {
    let now = 100
    const recorder = createDebugDiagnosticsRecorder({now: () => now})
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.start("capture")

    now = 125
    expect(recorder.record("relay-normalization", "normalized", {valid: true})).toBe(true)
    recorder.stop()
    expect(recorder.record("relay-normalization", "ignored-after-stop")).toBe(false)

    expect(recorder.snapshot()).toMatchObject({
      capture: {id: "capture", startedAt: 100, finishedAt: 125, active: false},
      records: [{category: "relay-normalization", type: "normalized", elapsedMs: 25}],
    })
  })

  it("restores an active app-update capture across a tab reload", () => {
    setDebugDiagnosticCategoryEnabled("app-update", true)
    expect(ensureAppUpdateDebugDiagnosticsCapture()).toBe(true)
    const captureId = getDebugDiagnosticsSnapshot().capture.id
    expect(captureId).toMatch(/^debug-/)
    expect(
      recordDebugDiagnostic("app-update", "skip-waiting-posted", {runningBuildId: "build-a"}),
    ).toBe(true)
    const persisted = sessionStorage.getItem("budabit/debug-diagnostics/capture:v1")
    expect(persisted).toContain("skip-waiting-posted")

    clearDebugDiagnostics()
    sessionStorage.setItem("budabit/debug-diagnostics/capture:v1", persisted!)
    expect(restoreDebugDiagnosticsCapture()).toBe(true)
    expect(getDebugDiagnosticsSnapshot()).toMatchObject({
      capture: {id: captureId, active: true, enabledCategories: ["app-update"]},
      records: [
        {
          category: "app-update",
          type: "skip-waiting-posted",
          detail: {runningBuildId: "build-a"},
        },
      ],
    })
  })

  it("keeps capture categories immutable until the next capture", () => {
    const recorder = createDebugDiagnosticsRecorder()
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.start("first")
    recorder.setCategoryEnabled("relay-normalization", false)
    recorder.setCategoryEnabled("relay-scheduler", true)

    expect(recorder.record("relay-normalization", "retained")).toBe(true)
    expect(recorder.record("relay-scheduler", "next-only")).toBe(false)
    recorder.stop()
    expect(recorder.snapshot().capture.enabledCategories).toEqual(["relay-normalization"])

    recorder.start("second")
    expect(recorder.snapshot().capture.enabledCategories).toEqual(["relay-scheduler"])
  })

  it("enforces global and per-category bounds", () => {
    let now = 0
    const recorder = createDebugDiagnosticsRecorder({
      now: () => ++now,
      maxRecords: 3,
      maxRecordsPerCategory: 2,
    })
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.setCategoryEnabled("relay-scheduler", true)
    recorder.start("bounded")
    recorder.record("relay-normalization", "one", undefined, 10)
    recorder.record("relay-normalization", "two", undefined, 20)
    recorder.record("relay-normalization", "three", undefined, 30)
    recorder.record("relay-scheduler", "four")
    recorder.record("relay-scheduler", "five")

    expect(recorder.snapshot().records.map(record => record.type)).toEqual([
      "three",
      "four",
      "five",
    ])
    expect(recorder.overview()).toMatchObject({
      recordCount: 3,
      counts: {"relay-normalization": 1, "relay-scheduler": 2},
      observationCounts: {"relay-normalization": 60, "relay-scheduler": 2},
    })
    expect(recorder.snapshot().capture.observationCounts["relay-normalization"]).toBe(60)
  })

  it("awaits finalizers before stopping the shared recorder", async () => {
    setDebugDiagnosticCategoryEnabled("relay-normalization", true)
    startDebugDiagnosticsCapture("tail-flush")
    const unregister = registerDebugDiagnosticsFinalizer(async () => {
      await Promise.resolve()
      recordDebugDiagnostic("relay-normalization", "tail", undefined, 7)
    })

    await expect(stopDebugDiagnosticsCapture()).resolves.toBe(true)

    expect(getDebugDiagnosticsSnapshot()).toMatchObject({
      capture: {
        active: false,
        observationCounts: {"relay-normalization": 7},
      },
      records: [{type: "tail", observations: 7}],
    })
    unregister()
    clearDebugDiagnostics()
  })

  it("redacts secret keys, secret values, credentials, and URL queries", () => {
    expect(
      sanitizeDebugDiagnosticValue({
        token: "plain-secret",
        content: "private event body",
        message: "Authorization: Bearer abc123 nsec1qqqqqqqqqqqqqqqqqqqqqqqq",
        relay: "wss://user:pass@relay.example/Path?token=AbC#fragment",
      }),
    ).toEqual({
      token: "[redacted]",
      content: "[redacted]",
      message: "[redacted] [redacted]",
      relay: "wss://relay.example",
    })
  })

  it("serializes a stable, sanitized debug run contract", () => {
    const recorder = createDebugDiagnosticsRecorder({now: () => 100})
    recorder.setCategoryEnabled("relay-normalization", true)
    recorder.start("run-1")
    recorder.record("relay-normalization", "normalized", {
      token: "secret",
      relay: "wss://user:pass@relay.example/path?auth=secret",
    })

    const parsed = JSON.parse(serializeDebugDiagnostics(recorder.snapshot()))
    expect(parsed).toMatchObject({
      schema: "budabit-debug-run-v3",
      schemaVersion: 3,
      capture: {id: "run-1", enabledCategories: ["relay-normalization"]},
      records: [
        {
          detail: {token: "[redacted]", relay: "wss://relay.example"},
        },
      ],
    })
    expect(parsed).toHaveProperty("build")
    expect(parsed).toHaveProperty("environment")
    expect(JSON.stringify(parsed)).not.toContain("/path")
  })

  it("prepares deterministic identity and gzip artifacts", async () => {
    const recorder = createDebugDiagnosticsRecorder({now: () => 100})
    recorder.start("run/unsafe")
    const snapshot = recorder.snapshot()
    const hash = vi.fn(async bytes => `hash-${bytes.length}`)

    const identity = await prepareDebugDiagnosticsArtifact(snapshot, {
      compress: async () => undefined,
      hash,
    })
    expect(identity).toMatchObject({
      schemaVersion: 3,
      filename: "budabit-debug-run-unsafe.json",
      encoding: "identity",
      contentType: "application/json",
      sha256: `hash-${identity.bytes.length}`,
    })
    expect(new TextDecoder().decode(identity.bytes)).toBe(serializeDebugDiagnostics(snapshot))

    const gzip = await prepareDebugDiagnosticsArtifact(snapshot, {
      compress: async () => new Uint8Array([1, 2, 3]),
      hash: async () => "a".repeat(64),
    })
    expect(gzip).toMatchObject({
      filename: "budabit-debug-run-unsafe.json.gz",
      encoding: "gzip",
      contentType: "application/gzip",
      sha256: "a".repeat(64),
    })
    expect(gzip.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})
