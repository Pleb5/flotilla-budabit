import {get, writable} from "svelte/store"
import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
import {
  redactPrivateDiagnosticString,
  redactPrivateDiagnostics,
  privateDiagnosticsActive,
  onPrivateDiagnosticsContext,
  PRIVATE_DIAGNOSTICS_REDACTION,
} from "./diagnostics-privacy"

export const DEBUG_DIAGNOSTICS_SCHEMA_VERSION = 3
export const DEBUG_DIAGNOSTICS_SCHEMA = "budabit-debug-run-v3"
export const DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY = "budabit/debug-diagnostics/settings:v1"
export const DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY = "budabit/debug-diagnostics/capture:v1"
export const DEBUG_DIAGNOSTICS_DEFAULT_BLOSSOM = "https://blossom.budabit.club"
export const DEBUG_DIAGNOSTICS_DEFAULT_RELAY = "wss://relay.budabit.club"

export const DEBUG_DIAGNOSTIC_CATEGORIES = [
  "relay-normalization",
  "relay-scheduler",
  "publication-lifecycle",
  "app-update",
] as const

export const DEBUG_DIAGNOSTIC_PRESET_IDS = ["quick", "standard", "extended"] as const
export type DebugDiagnosticPreset = (typeof DEBUG_DIAGNOSTIC_PRESET_IDS)[number]
export const DEBUG_DIAGNOSTIC_PRESETS: Record<
  DebugDiagnosticPreset,
  {label: string; maxRecords: number; maxRecordsPerCategory: number}
> = {
  quick: {label: "Quick", maxRecords: 1_000, maxRecordsPerCategory: 500},
  standard: {label: "Standard", maxRecords: 5_000, maxRecordsPerCategory: 2_500},
  extended: {label: "Extended", maxRecords: 20_000, maxRecordsPerCategory: 10_000},
}

export type DebugDiagnosticCategory = (typeof DEBUG_DIAGNOSTIC_CATEGORIES)[number]
export type DebugDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | DebugDiagnosticValue[]
  | {[key: string]: DebugDiagnosticValue}

export type DebugDiagnosticRecord = {
  category: DebugDiagnosticCategory
  type: string
  at: number
  elapsedMs: number
  observations: number
  detail?: DebugDiagnosticValue
}

export type DebugDiagnosticsSettings = {
  version: 1
  preset: DebugDiagnosticPreset
  categories: Record<DebugDiagnosticCategory, boolean>
}

export type DebugDiagnosticsSnapshot = {
  schema: typeof DEBUG_DIAGNOSTICS_SCHEMA
  schemaVersion: typeof DEBUG_DIAGNOSTICS_SCHEMA_VERSION
  generatedAt: number
  build: {id: string; hash: string}
  environment: {
    origin: string
    pathname: string
    userAgent: string
    language: string
  }
  capture: {
    id: string
    startedAt: number
    finishedAt?: number
    active: boolean
    preset: DebugDiagnosticPreset
    limits: {maxRecords: number; maxRecordsPerCategory: number}
    enabledCategories: DebugDiagnosticCategory[]
    observationCounts: Record<DebugDiagnosticCategory, number>
  }
  records: DebugDiagnosticRecord[]
  privacy?: string
}

export type PreparedDebugDiagnosticsArtifact = {
  schemaVersion: 3
  filename: string
  encoding: "gzip" | "identity"
  contentType: "application/gzip" | "application/json"
  bytes: Uint8Array
  sha256: string
  uncompressedBytes: number
}

const MAX_DETAIL_DEPTH = 8
const MAX_STRING_LENGTH = 20_000
const SECRET_KEY_PATTERN =
  /^(authorization|cookie|private[-_]?key|secret|token|password|signer|sig|content|tags|bunker|nostrconnect|nsec)$/i
const SECRET_VALUE_PATTERNS = [
  /nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /ncryptsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}/gi,
  /bunker:\/\/[^\s"']+/gi,
  /nostrconnect:\/\/[^\s"']+/gi,
  /Authorization:\s*(?:Nostr|Bearer)\s+[^\s"']+/gi,
]
const RELAY_ENDPOINT_KEY_PATTERN = /^(relay|relayUrl|inputEndpoint|canonicalEndpoint)$/i

export const defaultDebugDiagnosticsSettings = (): DebugDiagnosticsSettings => ({
  version: 1,
  preset: "standard",
  categories: {
    "relay-normalization": false,
    "relay-scheduler": false,
    "publication-lifecycle": false,
    "app-update": false,
  },
})

const redactUrlSecrets = (value: string) =>
  value.replace(/\b(wss?:\/\/)([^\s/]+)([^\s]*)/gi, (_match, protocol, authority, suffix) => {
    let host = authority
    try {
      host = new URL(`${protocol}${authority}`).host
    } catch {
      host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority
    }
    const safeSuffix = String(suffix)
      .replace(/\?.*?(?=[\s"']|$)/, "?[redacted]")
      .replace(/#.*$/, "")
    return `${protocol}${host}${safeSuffix}`
  })

const sanitizeString = (value: string) => {
  let next = redactUrlSecrets(redactPrivateDiagnosticString(value).slice(0, MAX_STRING_LENGTH))
  for (const pattern of SECRET_VALUE_PATTERNS) next = next.replace(pattern, "[redacted]")
  return next
}

const sanitizeRelayEndpoint = (value: unknown) => {
  if (typeof value !== "string") return "[invalid-relay]"
  if (redactPrivateDiagnosticString(value) !== value) return PRIVATE_DIAGNOSTICS_REDACTION
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return sanitizeString(value)
  }
}

export const sanitizeDebugDiagnosticValue = (value: unknown, depth = 0): DebugDiagnosticValue => {
  if (depth >= MAX_DETAIL_DEPTH) return "[max-depth]"
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "string") return sanitizeString(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[undefined]"
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`
  if (typeof value === "symbol") return value.toString()
  if (value instanceof Error) {
    return {name: value.name, message: sanitizeString(value.message)}
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => sanitizeDebugDiagnosticValue(item, depth + 1))
  }
  if (typeof value === "object") {
    const result: {[key: string]: DebugDiagnosticValue} = {}
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      result[redactPrivateDiagnosticString(key)] = SECRET_KEY_PATTERN.test(key)
        ? "[redacted]"
        : RELAY_ENDPOINT_KEY_PATTERN.test(key)
          ? sanitizeRelayEndpoint(item)
          : sanitizeDebugDiagnosticValue(item, depth + 1)
    }
    return result
  }
  return sanitizeString(String(value))
}

const sortDebugDiagnosticValue = (value: DebugDiagnosticValue): DebugDiagnosticValue => {
  if (Array.isArray(value)) return value.map(sortDebugDiagnosticValue)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortDebugDiagnosticValue(item)]),
  )
}

export const serializeDebugDiagnostics = (snapshot: DebugDiagnosticsSnapshot) =>
  JSON.stringify(sortDebugDiagnosticValue(sanitizeDebugDiagnosticValue(snapshot)))

const getDebugDiagnosticsEnvironment = (): DebugDiagnosticsSnapshot["environment"] => {
  if (typeof window === "undefined") {
    return {origin: "", pathname: "", userAgent: "", language: ""}
  }

  return {
    origin: window.location.origin,
    pathname: redactPrivateDiagnosticString(window.location.pathname),
    userAgent: navigator.userAgent,
    language: navigator.language,
  }
}

export const normalizeDebugDiagnosticsSettings = (value: unknown): DebugDiagnosticsSettings => {
  const defaults = defaultDebugDiagnosticsSettings()
  if (!value || typeof value !== "object" || (value as {version?: unknown}).version !== 1) {
    return defaults
  }
  const categories = (value as {categories?: unknown}).categories
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) return defaults

  return {
    version: 1,
    preset: DEBUG_DIAGNOSTIC_PRESET_IDS.includes(
      (value as {preset?: DebugDiagnosticPreset}).preset as DebugDiagnosticPreset,
    )
      ? (value as {preset: DebugDiagnosticPreset}).preset
      : defaults.preset,
    categories: Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        (categories as Record<string, unknown>)[category] === true,
      ]),
    ) as Record<DebugDiagnosticCategory, boolean>,
  }
}

type RecorderOptions = {
  now?: () => number
  maxRecords?: number
  maxRecordsPerCategory?: number
}

export const createDebugDiagnosticsRecorder = ({
  now = Date.now,
  maxRecords,
  maxRecordsPerCategory,
}: RecorderOptions = {}) => {
  const settings = writable(defaultDebugDiagnosticsSettings())
  const active = writable(false)
  const revision = writable(0)
  let captureId = ""
  let privateCapture = false
  let startedAt = 0
  let finishedAt: number | undefined
  let records: DebugDiagnosticRecord[] = []
  let capturePreset: DebugDiagnosticPreset = "standard"
  let captureCategories = {...defaultDebugDiagnosticsSettings().categories}
  let captureLimits = {
    maxRecords: maxRecords ?? DEBUG_DIAGNOSTIC_PRESETS.standard.maxRecords,
    maxRecordsPerCategory:
      maxRecordsPerCategory ?? DEBUG_DIAGNOSTIC_PRESETS.standard.maxRecordsPerCategory,
  }
  let counts = Object.fromEntries(
    DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
  ) as Record<DebugDiagnosticCategory, number>
  let observationCounts = Object.fromEntries(
    DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
  ) as Record<DebugDiagnosticCategory, number>

  const notify = () => revision.update(value => value + 1)
  const getLimits = () => {
    if (captureId) return captureLimits
    const preset = DEBUG_DIAGNOSTIC_PRESETS[get(settings).preset]
    return {
      maxRecords: maxRecords ?? preset.maxRecords,
      maxRecordsPerCategory: maxRecordsPerCategory ?? preset.maxRecordsPerCategory,
    }
  }
  const trimRecords = () => {
    const limits = getLimits()
    for (const category of DEBUG_DIAGNOSTIC_CATEGORIES) {
      let excess =
        records.filter(record => record.category === category).length - limits.maxRecordsPerCategory
      if (excess <= 0) continue
      records = records.filter(record => {
        if (record.category !== category || excess <= 0) return true
        excess -= 1
        return false
      })
    }
    if (records.length > limits.maxRecords) records = records.slice(-limits.maxRecords)
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        records.filter(record => record.category === category).length,
      ]),
    ) as Record<DebugDiagnosticCategory, number>
  }
  const setSettings = (value: unknown) => {
    const normalized = normalizeDebugDiagnosticsSettings(value)
    settings.set(normalized)
    trimRecords()
    notify()
    return normalized
  }
  const setCategoryEnabled = (category: DebugDiagnosticCategory, enabled: boolean) => {
    settings.update(current => ({
      ...current,
      categories: {...current.categories, [category]: enabled},
    }))
  }
  const setPreset = (preset: DebugDiagnosticPreset) => {
    settings.update(current => ({...current, preset}))
    trimRecords()
    notify()
  }
  const isCategoryEnabled = (category: DebugDiagnosticCategory) =>
    captureId ? captureCategories[category] : get(settings).categories[category]
  const start = (id = `debug-${now().toString(36)}`) => {
    privateCapture = privateDiagnosticsActive()
    const currentSettings = get(settings)
    const presetLimits = DEBUG_DIAGNOSTIC_PRESETS[currentSettings.preset]
    records = []
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    observationCounts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    captureId = sanitizeString(id)
    capturePreset = currentSettings.preset
    captureCategories = {...currentSettings.categories}
    captureLimits = {
      maxRecords: maxRecords ?? presetLimits.maxRecords,
      maxRecordsPerCategory: maxRecordsPerCategory ?? presetLimits.maxRecordsPerCategory,
    }
    startedAt = now()
    finishedAt = undefined
    active.set(true)
    notify()
    return id
  }
  const stop = () => {
    if (!get(active)) return false
    finishedAt = now()
    active.set(false)
    notify()
    return true
  }
  const clear = () => {
    privateCapture = false
    records = []
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    observationCounts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, 0]),
    ) as Record<DebugDiagnosticCategory, number>
    captureId = ""
    capturePreset = "standard"
    captureCategories = {...defaultDebugDiagnosticsSettings().categories}
    startedAt = 0
    finishedAt = undefined
    active.set(false)
    notify()
  }
  const restore = (value: unknown) => {
    if (!value || typeof value !== "object") return false
    const snapshot = value as Partial<DebugDiagnosticsSnapshot>
    const capture = snapshot.capture
    if (
      snapshot.schema !== DEBUG_DIAGNOSTICS_SCHEMA ||
      snapshot.schemaVersion !== DEBUG_DIAGNOSTICS_SCHEMA_VERSION ||
      !capture?.active ||
      typeof capture.id !== "string" ||
      !capture.id ||
      typeof capture.startedAt !== "number" ||
      !Number.isFinite(capture.startedAt) ||
      !DEBUG_DIAGNOSTIC_PRESET_IDS.includes(capture.preset as DebugDiagnosticPreset) ||
      !Array.isArray(capture.enabledCategories) ||
      !Array.isArray(snapshot.records)
    ) {
      return false
    }

    const enabledCategories = new Set(
      capture.enabledCategories.filter((category): category is DebugDiagnosticCategory =>
        DEBUG_DIAGNOSTIC_CATEGORIES.includes(category as DebugDiagnosticCategory),
      ),
    )
    if (!enabledCategories.has("app-update")) return false

    privateCapture = Boolean(snapshot.privacy) || privateDiagnosticsActive()
    captureId = sanitizeString(capture.id)
    startedAt = capture.startedAt
    finishedAt = undefined
    capturePreset = capture.preset
    captureCategories = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [category, enabledCategories.has(category)]),
    ) as Record<DebugDiagnosticCategory, boolean>
    const presetLimits = DEBUG_DIAGNOSTIC_PRESETS[capturePreset]
    captureLimits = {
      maxRecords: maxRecords ?? presetLimits.maxRecords,
      maxRecordsPerCategory: maxRecordsPerCategory ?? presetLimits.maxRecordsPerCategory,
    }
    records = snapshot.records
      .filter((record): record is DebugDiagnosticRecord =>
        Boolean(
          record &&
          typeof record === "object" &&
          DEBUG_DIAGNOSTIC_CATEGORIES.includes(record.category) &&
          typeof record.type === "string" &&
          typeof record.at === "number" &&
          Number.isFinite(record.at) &&
          typeof record.elapsedMs === "number" &&
          Number.isFinite(record.elapsedMs) &&
          typeof record.observations === "number" &&
          Number.isFinite(record.observations),
        ),
      )
      .map(record => ({
        category: record.category,
        type: sanitizeString(record.type),
        at: record.at,
        elapsedMs: Math.max(0, record.elapsedMs),
        observations: Math.max(0, Math.floor(record.observations)),
        ...(record.detail === undefined
          ? {}
          : {detail: sanitizeDebugDiagnosticValue(record.detail)}),
      }))
    counts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        records.filter(record => record.category === category).length,
      ]),
    ) as Record<DebugDiagnosticCategory, number>
    observationCounts = Object.fromEntries(
      DEBUG_DIAGNOSTIC_CATEGORIES.map(category => [
        category,
        records
          .filter(record => record.category === category)
          .reduce((total, record) => total + record.observations, 0),
      ]),
    ) as Record<DebugDiagnosticCategory, number>
    trimRecords()
    active.set(true)
    notify()
    return true
  }
  const record = (
    category: DebugDiagnosticCategory,
    type: string,
    detail?: unknown,
    observations = 1,
  ) => {
    if (!get(active) || !isCategoryEnabled(category)) return false
    privateCapture ||= privateDiagnosticsActive()
    const at = now()
    const representedObservations = Number.isFinite(observations)
      ? Math.max(0, Math.floor(observations))
      : 0
    const record: DebugDiagnosticRecord = {
      category,
      type: sanitizeString(type),
      at,
      elapsedMs: Math.max(0, at - startedAt),
      observations: representedObservations,
      ...(privateDiagnosticsActive()
        ? {detail: PRIVATE_DIAGNOSTICS_REDACTION}
        : detail === undefined
          ? {}
          : {detail: sanitizeDebugDiagnosticValue(detail)}),
    }
    records.push(record)
    counts[category] += 1
    observationCounts[category] += representedObservations
    const limits = getLimits()
    if (counts[category] > limits.maxRecordsPerCategory) {
      const oldestCategoryRecord = records.findIndex(candidate => candidate.category === category)
      if (oldestCategoryRecord >= 0) records.splice(oldestCategoryRecord, 1)
      counts[category] -= 1
    }
    if (records.length > limits.maxRecords) {
      const removed = records.shift()
      if (removed) counts[removed.category] -= 1
    }
    notify()
    return true
  }
  const snapshot = (): DebugDiagnosticsSnapshot => {
    const currentSettings = get(settings)
    const limits = getLimits()
    return redactPrivateDiagnostics(
      structuredClone({
        schema: DEBUG_DIAGNOSTICS_SCHEMA,
        schemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
        generatedAt: now(),
        build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
        environment: getDebugDiagnosticsEnvironment(),
        capture: {
          id: captureId,
          startedAt,
          ...(finishedAt === undefined ? {} : {finishedAt}),
          active: get(active),
          preset: captureId ? capturePreset : currentSettings.preset,
          limits,
          enabledCategories: DEBUG_DIAGNOSTIC_CATEGORIES.filter(category =>
            captureId ? captureCategories[category] : currentSettings.categories[category],
          ),
          observationCounts,
        },
        records,
        ...(privateCapture ? {privacy: PRIVATE_DIAGNOSTICS_REDACTION} : {}),
      }),
    )
  }
  const overview = () => {
    const currentSettings = get(settings)
    return {
      captureId,
      active: get(active),
      startedAt,
      finishedAt,
      recordCount: records.length,
      preset: captureId ? capturePreset : currentSettings.preset,
      limits: getLimits(),
      counts: {...counts},
      observationCounts: {...observationCounts},
    }
  }

  return {
    settings,
    active,
    revision,
    setSettings,
    setCategoryEnabled,
    setPreset,
    isCategoryEnabled,
    start,
    stop,
    clear,
    restore,
    record,
    snapshot,
    overview,
    markPrivate: () => {
      if (get(active)) {
        privateCapture = true
        notify()
      }
    },
  }
}

const recorder = createDebugDiagnosticsRecorder()

type DebugDiagnosticsFinalizer = () => void | Promise<void>
const debugDiagnosticsFinalizers = new Set<DebugDiagnosticsFinalizer>()
let stopPromise: Promise<boolean> | undefined

export const registerDebugDiagnosticsFinalizer = (finalizer: DebugDiagnosticsFinalizer) => {
  debugDiagnosticsFinalizers.add(finalizer)
  return () => debugDiagnosticsFinalizers.delete(finalizer)
}

export const debugDiagnosticsSettings = recorder.settings
export const debugDiagnosticsActive = recorder.active
export const debugDiagnosticsRevision = recorder.revision
const removePersistedDebugDiagnosticsCapture = () => {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.removeItem(DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY)
  } catch {
    // Tab-scoped persistence is optional when browser storage is blocked.
  }
}

const persistDebugDiagnosticsCapture = () => {
  if (typeof sessionStorage === "undefined") return
  const snapshot = recorder.snapshot()
  if (!snapshot.capture.active || !snapshot.capture.enabledCategories.includes("app-update")) return
  try {
    sessionStorage.setItem(
      DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY,
      JSON.stringify({
        ...snapshot,
        records: snapshot.records.filter(record => record.category === "app-update"),
      }),
    )
  } catch {
    // Continue recording in memory when browser storage is unavailable or full.
  }
}
onPrivateDiagnosticsContext(() => {
  recorder.markPrivate()
  persistDebugDiagnosticsCapture()
})

export const restoreDebugDiagnosticsCapture = () => {
  if (typeof sessionStorage === "undefined") return false
  try {
    const value = JSON.parse(
      sessionStorage.getItem(DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY) || "null",
    )
    const restored = recorder.restore(value)
    if (!restored) removePersistedDebugDiagnosticsCapture()
    return restored
  } catch {
    removePersistedDebugDiagnosticsCapture()
    return false
  }
}

export const startDebugDiagnosticsCapture = (id?: string) => {
  const captureId = recorder.start(id)
  persistDebugDiagnosticsCapture()
  return captureId
}
export const ensureAppUpdateDebugDiagnosticsCapture = () => {
  if (!get(debugDiagnosticsSettings).categories["app-update"]) return false
  if (!get(debugDiagnosticsActive)) startDebugDiagnosticsCapture()
  return true
}
export const stopDebugDiagnosticsCapture = () => {
  if (stopPromise) return stopPromise
  if (!get(debugDiagnosticsActive)) return Promise.resolve(false)

  stopPromise = (async () => {
    await Promise.allSettled(Array.from(debugDiagnosticsFinalizers, finalizer => finalizer()))
    const stopped = recorder.stop()
    removePersistedDebugDiagnosticsCapture()
    return stopped
  })().finally(() => {
    stopPromise = undefined
  })
  return stopPromise
}
export const clearDebugDiagnostics = () => {
  recorder.clear()
  removePersistedDebugDiagnosticsCapture()
}
export const recordDebugDiagnostic = (
  category: DebugDiagnosticCategory,
  type: string,
  detail?: unknown,
  observations = 1,
) => {
  const recorded = recorder.record(category, type, detail, observations)
  if (recorded && category === "app-update") persistDebugDiagnosticsCapture()
  return recorded
}
export const recordAppUpdateDebugDiagnostic = (type: string, detail?: unknown) =>
  recordDebugDiagnostic("app-update", type, {
    runningBuildId: APP_BUILD_ID,
    runningBuildHash: APP_BUILD_HASH,
    ...(detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {detail}),
  })
export const isAppUpdateDebugDiagnosticsActive = () =>
  get(debugDiagnosticsActive) && recorder.isCategoryEnabled("app-update")
export const getDebugDiagnosticsSnapshot = recorder.snapshot
export const getDebugDiagnosticsOverview = recorder.overview
export const isDebugDiagnosticCategoryEnabled = recorder.isCategoryEnabled

export const refreshDebugDiagnosticsSettings = () => {
  if (typeof localStorage === "undefined") return get(debugDiagnosticsSettings)
  try {
    return recorder.setSettings(
      JSON.parse(localStorage.getItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY) || "null"),
    )
  } catch {
    try {
      localStorage.removeItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY)
    } catch {
      // Storage is optional and may be blocked even when the API exists.
    }
    return recorder.setSettings(null)
  }
}

const persistDebugDiagnosticsSettings = (settings: DebugDiagnosticsSettings) => {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(DEBUG_DIAGNOSTICS_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Keep the in-memory selection when storage is unavailable or full.
  }
}

export const setDebugDiagnosticCategoryEnabled = (
  category: DebugDiagnosticCategory,
  enabled: boolean,
) => {
  recorder.setCategoryEnabled(category, enabled)
  const settings = get(debugDiagnosticsSettings)
  persistDebugDiagnosticsSettings(settings)
  return settings
}

export const setDebugDiagnosticsPreset = (preset: DebugDiagnosticPreset) => {
  recorder.setPreset(preset)
  const settings = get(debugDiagnosticsSettings)
  persistDebugDiagnosticsSettings(settings)
  return settings
}

const defaultCompress = async (bytes: Uint8Array) => {
  if (typeof CompressionStream === "undefined") return
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const defaultHash = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("")
}

export const prepareDebugDiagnosticsArtifact = async (
  snapshot: DebugDiagnosticsSnapshot,
  {
    compress = defaultCompress,
    hash = defaultHash,
    runId,
  }: {
    compress?: (bytes: Uint8Array) => Promise<Uint8Array | undefined>
    hash?: (bytes: Uint8Array) => Promise<string>
    runId?: string
  } = {},
): Promise<PreparedDebugDiagnosticsArtifact> => {
  const serialized = serializeDebugDiagnostics(snapshot)
  const sourceBytes = new TextEncoder().encode(serialized)
  const compressed = await compress(sourceBytes)
  const bytes = compressed?.length ? compressed : sourceBytes
  const encoding = compressed?.length ? "gzip" : "identity"
  const artifactId = (runId || snapshot.capture.id || String(snapshot.generatedAt)).replace(
    /[^a-z0-9._-]/gi,
    "-",
  )

  return {
    schemaVersion: DEBUG_DIAGNOSTICS_SCHEMA_VERSION,
    filename: `budabit-debug-${artifactId}.json${encoding === "gzip" ? ".gz" : ""}`,
    encoding,
    contentType: encoding === "gzip" ? "application/gzip" : "application/json",
    bytes,
    sha256: await hash(bytes),
    uncompressedBytes: sourceBytes.length,
  }
}
