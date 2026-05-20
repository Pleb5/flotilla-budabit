import {get} from "svelte/store"
import {localStorageProvider, synced} from "@welshman/store"

export const BLOSSOM_SETTINGS_STORAGE_KEY = "budabit/blossom/settings:v1"
export const BLOSSOM_DASHBOARD_STORAGE_KEY = "budabit/blossom/dashboard:v1"

export const MAX_BLOSSOM_UPLOAD_RECORDS = 100

export type BlossomOptimizationMode = "auto" | "server" | "client" | "original"

export type BlossomMirrorMode = "ask" | "server-side-only" | "always-selected" | "never"

export type BlossomBrowserMirrorConsent = "ask" | "allow" | "deny"
export type BlossomMirrorTargetGroup =
  | "current-community"
  | "personal"
  | "member-community"
  | "last-resort"
  | "manual"

export type BlossomServerSource = BlossomMirrorTargetGroup | "optimizer"

export type BlossomCapabilityStatus =
  | "unknown"
  | "supported"
  | "unsupported"
  | "unavailable"
  | "disabled"
  | "too-large"
  | "auth-failed"
  | "cors-blocked"
  | "error"

export type BlossomUploadStage =
  | "idle"
  | "preparing"
  | "checking-servers"
  | "uploading"
  | "optimizing"
  | "saving-canonical"
  | "ready"
  | "failed"

export type BlossomMirrorJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "paused"
  | "skipped"

export type BlossomMirrorMethod = "server-mirror" | "browser-upload"

export type BlossomUploadContextType =
  | "community"
  | "personal"
  | "profile"
  | "badge"
  | "generic"

export type BlossomSettings = {
  version: 1
  optimizationMode: BlossomOptimizationMode
  mirrorMode: BlossomMirrorMode
  browserMirrorConsent: BlossomBrowserMirrorConsent
  preferServerSideMirroring: boolean
  autoMirrorTargetGroups: BlossomMirrorTargetGroup[]
  publicEncryptionEnabled: false
}

export type BlossomServerCapability = {
  url: string
  checkedAt: number
  source?: BlossomServerSource
  upload: BlossomCapabilityStatus
  media: BlossomCapabilityStatus
  mirror: BlossomCapabilityStatus
  reason?: string
}

export type BlossomBlobDescriptor = {
  url: string
  sha256: string
  size?: number
  type?: string
}

export type BlossomUploadContext = {
  type: BlossomUploadContextType
  communityPubkey?: string
  communityName?: string
  label?: string
}

export type BlossomMirrorJob = {
  id: string
  targetUrl: string
  targetLabel?: string
  targetGroup: BlossomMirrorTargetGroup
  method: BlossomMirrorMethod
  status: BlossomMirrorJobStatus
  attempts: number
  createdAt: number
  updatedAt: number
  lastError?: string
  resultUrl?: string
}

export type BlossomUploadRecord = {
  id: string
  createdAt: number
  updatedAt: number
  context: BlossomUploadContext
  canonical: BlossomBlobDescriptor
  original?: {
    name?: string
    size?: number
    type?: string
    sha256?: string
  }
  optimizationMode: BlossomOptimizationMode
  mirrorMode: BlossomMirrorMode
  mirrorJobs: BlossomMirrorJob[]
}

export type BlossomDashboardState = {
  version: 1
  uploads: BlossomUploadRecord[]
  capabilities: Record<string, BlossomServerCapability>
}

export const defaultBlossomSettings: BlossomSettings = {
  version: 1,
  optimizationMode: "auto",
  mirrorMode: "ask",
  browserMirrorConsent: "ask",
  preferServerSideMirroring: true,
  autoMirrorTargetGroups: [],
  publicEncryptionEnabled: false,
}

export const defaultBlossomDashboardState: BlossomDashboardState = {
  version: 1,
  uploads: [],
  capabilities: {},
}

const optimizationModes = new Set<BlossomOptimizationMode>([
  "auto",
  "server",
  "client",
  "original",
])
const mirrorModes = new Set<BlossomMirrorMode>([
  "ask",
  "server-side-only",
  "always-selected",
  "never",
])
const browserMirrorConsents = new Set<BlossomBrowserMirrorConsent>(["ask", "allow", "deny"])
const mirrorTargetGroups = new Set<BlossomMirrorTargetGroup>([
  "current-community",
  "personal",
  "member-community",
  "last-resort",
  "manual",
])
const capabilityStatuses = new Set<BlossomCapabilityStatus>([
  "unknown",
  "supported",
  "unsupported",
  "unavailable",
  "disabled",
  "too-large",
  "auth-failed",
  "cors-blocked",
  "error",
])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

const normalizeStringArray = <T extends string>(values: unknown, allowed: Set<T>): T[] => {
  if (!Array.isArray(values)) return []

  return Array.from(new Set(values.filter((value): value is T => allowed.has(value as T))))
}

const normalizeTimestamp = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const normalizeBlobDescriptor = (value: unknown): BlossomBlobDescriptor | undefined => {
  if (!isPlainObject(value)) return undefined
  const url = typeof value.url === "string" ? value.url : ""
  const sha256 = typeof value.sha256 === "string" ? value.sha256.toLowerCase() : ""
  if (!url || !/^[0-9a-f]{64}$/.test(sha256)) return undefined

  return {
    url,
    sha256,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
  }
}

export const normalizeBlossomSettings = (
  value?: Partial<BlossomSettings> | null,
): BlossomSettings => {
  const source = isPlainObject(value) ? value : {}
  const optimizationMode = source.optimizationMode
  const mirrorMode = source.mirrorMode
  const browserMirrorConsent = source.browserMirrorConsent

  return {
    version: 1,
    optimizationMode: optimizationModes.has(optimizationMode as BlossomOptimizationMode)
      ? (optimizationMode as BlossomOptimizationMode)
      : defaultBlossomSettings.optimizationMode,
    mirrorMode: mirrorModes.has(mirrorMode as BlossomMirrorMode)
      ? (mirrorMode as BlossomMirrorMode)
      : defaultBlossomSettings.mirrorMode,
    browserMirrorConsent: browserMirrorConsents.has(
      browserMirrorConsent as BlossomBrowserMirrorConsent,
    )
      ? (browserMirrorConsent as BlossomBrowserMirrorConsent)
      : defaultBlossomSettings.browserMirrorConsent,
    preferServerSideMirroring:
      typeof source.preferServerSideMirroring === "boolean"
        ? source.preferServerSideMirroring
        : defaultBlossomSettings.preferServerSideMirroring,
    autoMirrorTargetGroups: normalizeStringArray(
      source.autoMirrorTargetGroups,
      mirrorTargetGroups,
    ),
    publicEncryptionEnabled: false,
  }
}

const normalizeCapability = (value: unknown): BlossomServerCapability | undefined => {
  if (!isPlainObject(value)) return undefined
  const url = typeof value.url === "string" ? value.url : ""
  if (!url) return undefined

  const upload = capabilityStatuses.has(value.upload as BlossomCapabilityStatus)
    ? (value.upload as BlossomCapabilityStatus)
    : "unknown"
  const media = capabilityStatuses.has(value.media as BlossomCapabilityStatus)
    ? (value.media as BlossomCapabilityStatus)
    : "unknown"
  const mirror = capabilityStatuses.has(value.mirror as BlossomCapabilityStatus)
    ? (value.mirror as BlossomCapabilityStatus)
    : "unknown"

  return {
    url,
    checkedAt: normalizeTimestamp(value.checkedAt, 0),
    source: mirrorTargetGroups.has(value.source as BlossomMirrorTargetGroup)
      ? (value.source as BlossomServerSource)
      : value.source === "optimizer"
        ? "optimizer"
        : undefined,
    upload,
    media,
    mirror,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  }
}

const normalizeMirrorJob = (value: unknown): BlossomMirrorJob | undefined => {
  if (!isPlainObject(value)) return undefined
  const id = typeof value.id === "string" ? value.id : ""
  const targetUrl = typeof value.targetUrl === "string" ? value.targetUrl : ""
  if (!id || !targetUrl) return undefined

  const now = Date.now()
  const targetGroup = mirrorTargetGroups.has(value.targetGroup as BlossomMirrorTargetGroup)
    ? (value.targetGroup as BlossomMirrorTargetGroup)
    : "manual"
  const method = value.method === "browser-upload" ? "browser-upload" : "server-mirror"
  const status = ["queued", "running", "succeeded", "failed", "paused", "skipped"].includes(
    value.status as string,
  )
    ? (value.status as BlossomMirrorJobStatus)
    : "queued"

  return {
    id,
    targetUrl,
    targetLabel: typeof value.targetLabel === "string" ? value.targetLabel : undefined,
    targetGroup,
    method,
    status,
    attempts: typeof value.attempts === "number" && Number.isFinite(value.attempts)
      ? value.attempts
      : 0,
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    resultUrl: typeof value.resultUrl === "string" ? value.resultUrl : undefined,
  }
}

const normalizeUploadRecord = (value: unknown): BlossomUploadRecord | undefined => {
  if (!isPlainObject(value)) return undefined
  const id = typeof value.id === "string" ? value.id : ""
  const canonical = normalizeBlobDescriptor(value.canonical)
  if (!id || !canonical) return undefined

  const now = Date.now()
  const context = isPlainObject(value.context) ? value.context : {}
  const contextType = ["community", "personal", "profile", "badge", "generic"].includes(
    context.type as string,
  )
    ? (context.type as BlossomUploadContextType)
    : "generic"
  const original = isPlainObject(value.original) ? value.original : undefined
  const optimizationMode = optimizationModes.has(value.optimizationMode as BlossomOptimizationMode)
    ? (value.optimizationMode as BlossomOptimizationMode)
    : defaultBlossomSettings.optimizationMode
  const mirrorMode = mirrorModes.has(value.mirrorMode as BlossomMirrorMode)
    ? (value.mirrorMode as BlossomMirrorMode)
    : defaultBlossomSettings.mirrorMode

  return {
    id,
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
    context: {
      type: contextType,
      communityPubkey:
        typeof context.communityPubkey === "string" ? context.communityPubkey : undefined,
      communityName: typeof context.communityName === "string" ? context.communityName : undefined,
      label: typeof context.label === "string" ? context.label : undefined,
    },
    canonical,
    original: original
      ? {
          name: typeof original.name === "string" ? original.name : undefined,
          size: typeof original.size === "number" && Number.isFinite(original.size)
            ? original.size
            : undefined,
          type: typeof original.type === "string" ? original.type : undefined,
          sha256: typeof original.sha256 === "string" ? original.sha256.toLowerCase() : undefined,
        }
      : undefined,
    optimizationMode,
    mirrorMode,
    mirrorJobs: Array.isArray(value.mirrorJobs)
      ? value.mirrorJobs.flatMap(job => {
          const normalized = normalizeMirrorJob(job)
          return normalized ? [normalized] : []
        })
      : [],
  }
}

export const normalizeBlossomDashboardState = (
  value?: Partial<BlossomDashboardState> | null,
): BlossomDashboardState => {
  const source = isPlainObject(value) ? value : {}
  const uploads = Array.isArray(source.uploads)
    ? source.uploads
        .flatMap(upload => {
          const normalized = normalizeUploadRecord(upload)
          return normalized ? [normalized] : []
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_BLOSSOM_UPLOAD_RECORDS)
    : []
  const capabilities = isPlainObject(source.capabilities)
    ? Object.fromEntries(
        Object.values(source.capabilities).flatMap(capability => {
          const normalized = normalizeCapability(capability)
          return normalized ? [[normalized.url, normalized]] : []
        }),
      )
    : {}

  return {version: 1, uploads, capabilities}
}

export const blossomSettings = synced<BlossomSettings>({
  key: BLOSSOM_SETTINGS_STORAGE_KEY,
  defaultValue: defaultBlossomSettings,
  storage: localStorageProvider,
})

export const blossomDashboardState = synced<BlossomDashboardState>({
  key: BLOSSOM_DASHBOARD_STORAGE_KEY,
  defaultValue: defaultBlossomDashboardState,
  storage: localStorageProvider,
})

void blossomSettings.ready.then(() => {
  blossomSettings.update(normalizeBlossomSettings)
})

void blossomDashboardState.ready.then(() => {
  blossomDashboardState.update(normalizeBlossomDashboardState)
})

export const getBlossomSettings = () => get(blossomSettings)
export const getBlossomDashboardState = () => get(blossomDashboardState)

export const updateBlossomSettings = (values: Partial<BlossomSettings>) => {
  blossomSettings.update(current => normalizeBlossomSettings({...current, ...values}))
}

export const rememberBlossomUpload = (upload: BlossomUploadRecord) => {
  blossomDashboardState.update(current => {
    const normalizedCurrent = normalizeBlossomDashboardState(current)
    const normalizedUpload = normalizeUploadRecord(upload)
    if (!normalizedUpload) return normalizedCurrent

    return normalizeBlossomDashboardState({
      ...normalizedCurrent,
      uploads: [
        normalizedUpload,
        ...normalizedCurrent.uploads.filter(existing => existing.id !== normalizedUpload.id),
      ],
    })
  })
}

export const updateBlossomUploadRecord = (
  id: string,
  update: (record: BlossomUploadRecord) => BlossomUploadRecord,
) => {
  blossomDashboardState.update(current => {
    const normalizedCurrent = normalizeBlossomDashboardState(current)

    return normalizeBlossomDashboardState({
      ...normalizedCurrent,
      uploads: normalizedCurrent.uploads.map(record => (record.id === id ? update(record) : record)),
    })
  })
}

export const rememberBlossomCapability = (capability: BlossomServerCapability) => {
  blossomDashboardState.update(current => {
    const normalizedCurrent = normalizeBlossomDashboardState(current)
    const normalizedCapability = normalizeCapability(capability)
    if (!normalizedCapability) return normalizedCurrent

    return normalizeBlossomDashboardState({
      ...normalizedCurrent,
      capabilities: {
        ...normalizedCurrent.capabilities,
        [normalizedCapability.url]: normalizedCapability,
      },
    })
  })
}
