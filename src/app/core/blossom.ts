import {get} from "svelte/store"
import {localStorageProvider, synced} from "@welshman/store"
import {normalizeUrl} from "@welshman/lib"
import type {TrustedEvent} from "@welshman/util"
import {
  type CommunityDefinition,
  normalizePubkey,
  parseCommunityDefinition,
} from "@app/core/community"
import {getCommunityPublishCapabilityMap} from "@app/core/community-permissions"

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

export const getBlossomUploadStageMessage = (stage: BlossomUploadStage = "idle") => {
  switch (stage) {
    case "preparing":
      return "Preparing file..."
    case "checking-servers":
      return "Checking Blossom servers..."
    case "uploading":
      return "Uploading to Blossom..."
    case "optimizing":
      return "Optimizing media on Blossom..."
    case "saving-canonical":
      return "Saving optimized media to the canonical server..."
    case "ready":
      return "Ready to publish."
    case "failed":
      return "Upload failed."
    case "idle":
    default:
      return ""
  }
}

export type BlossomMirrorJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "paused"
  | "skipped"

export type BlossomMirrorMethod = "server-mirror" | "browser-upload"
export type BlossomProbeEndpoint = "upload" | "media" | "mirror"
export type BlossomProbeAuthAction = "upload" | "media"

export type BlossomUploadContextType = "community" | "personal" | "profile" | "badge" | "generic"

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

export type BlossomProbeFile = {
  size?: number
  type?: string
  sha256?: string
}

export type BlossomProbeOptions = {
  server: string
  file?: BlossomProbeFile
  source?: BlossomServerSource
  fetcher?: typeof fetch
  persist?: boolean
  makeAuthHeader?: (action: BlossomProbeAuthAction, server: string) => Promise<string | undefined>
  now?: () => number
}

export type BlossomUploadPlanFile = {
  type?: string
  size?: number
}

export type BlossomInitialUploadMethod = "media" | "upload"

export type BlossomInitialUploadPlan =
  | {
      status: "ready"
      method: BlossomInitialUploadMethod
      canonical: BlossomServerTarget
      optimizer?: BlossomServerTarget
      mirrorOptimizedToCanonical: boolean
      useClientCompression: boolean
      reason: string
    }
  | {
      status: "blocked"
      reason: string
    }

export type ChooseBlossomInitialUploadPlanOptions = {
  targets: BlossomServerTarget[]
  capabilities?: Record<string, BlossomServerCapability | undefined>
  settings?: BlossomSettings
  file?: BlossomUploadPlanFile
  encrypted?: boolean
  publicContext?: boolean
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

export type BlossomMemberCommunityRef = {
  communityPubkey: string
  communityName?: string
  relayHints: string[]
  blossomServers: string[]
  writableSections: string[]
}

export type BlossomServerTarget = {
  url: string
  source: BlossomServerSource
  group: BlossomMirrorTargetGroup
  priority: number
  label: string
  communityPubkey?: string
  communityName?: string
}

export type BlossomServerGroups = {
  currentCommunity: BlossomServerTarget[]
  personal: BlossomServerTarget[]
  memberCommunities: BlossomServerTarget[]
  lastResort: BlossomServerTarget[]
}

export type BuildBlossomServerGroupsOptions = {
  currentCommunity?: {
    servers?: string[]
    communityPubkey?: string
    communityName?: string
  }
  personalServers?: string[]
  memberCommunities?: BlossomMemberCommunityRef[]
  lastResortServers?: string[]
}

export type CreateBlossomMirrorJobsOptions = {
  targets: BlossomServerTarget[]
  capabilities?: Record<string, BlossomServerCapability | undefined>
  settings?: BlossomSettings
  exactBytesAvailable?: boolean
  now?: () => number
  makeId?: (target: BlossomServerTarget, index: number) => string
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

const optimizationModes = new Set<BlossomOptimizationMode>(["auto", "server", "client", "original"])
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

export const normalizeBlossomServerUrl = (url: string | undefined | null) => {
  const value = url?.trim()
  if (!value || !/^https?:\/\//i.test(value)) return ""

  try {
    return new URL(normalizeUrl(value)).origin
  } catch {
    return ""
  }
}

const normalizeBlossomServers = (servers: Array<string | undefined | null>) =>
  Array.from(new Set(servers.map(normalizeBlossomServerUrl).filter(Boolean)))

const getLatestDefinitionsByPubkey = (definitions: CommunityDefinition[]) => {
  const latest = new Map<string, CommunityDefinition>()

  for (const definition of definitions) {
    const current = latest.get(definition.pubkey)
    if (!current || definition.event.created_at > current.event.created_at) {
      latest.set(definition.pubkey, definition)
    }
  }

  return Array.from(latest.values())
}

export const selectMemberCommunityBlossomRefs = ({
  author,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
}: {
  author?: string
  definitions?: CommunityDefinition[]
  definitionEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
}): BlossomMemberCommunityRef[] => {
  const normalizedAuthor = normalizePubkey(author || "")
  if (!normalizedAuthor) return []

  const parsedDefinitions = definitionEvents.flatMap(event => {
    const definition = parseCommunityDefinition(event)
    return definition ? [definition] : []
  })

  return getLatestDefinitionsByPubkey([...definitions, ...parsedDefinitions])
    .flatMap(definition => {
      const capabilities = Object.values(
        getCommunityPublishCapabilityMap({
          definition,
          profileListEvents,
          userPubkey: normalizedAuthor,
        }),
      ).filter(capability => capability.canWrite)

      if (capabilities.length === 0) return []

      const blossomServers = normalizeBlossomServers(definition.blossomServers)
      if (blossomServers.length === 0) return []

      return [
        {
          communityPubkey: definition.pubkey,
          relayHints: definition.relays,
          blossomServers,
          writableSections: Array.from(
            new Set(capabilities.map(capability => capability.sectionName)),
          ),
        } satisfies BlossomMemberCommunityRef,
      ]
    })
    .sort((a, b) => a.communityPubkey.localeCompare(b.communityPubkey))
}

export const buildBlossomServerGroups = ({
  currentCommunity,
  personalServers = [],
  memberCommunities = [],
  lastResortServers = [],
}: BuildBlossomServerGroupsOptions): BlossomServerGroups => {
  const seen = new Set<string>()
  const groups: BlossomServerGroups = {
    currentCommunity: [],
    personal: [],
    memberCommunities: [],
    lastResort: [],
  }

  const addTarget = (
    group: keyof BlossomServerGroups,
    url: string,
    target: Omit<BlossomServerTarget, "url" | "priority">,
  ) => {
    const normalized = normalizeBlossomServerUrl(url)
    if (!normalized || seen.has(normalized)) return

    seen.add(normalized)
    groups[group].push({...target, url: normalized, priority: seen.size})
  }

  for (const server of currentCommunity?.servers || []) {
    addTarget("currentCommunity", server, {
      source: "current-community",
      group: "current-community",
      label: currentCommunity?.communityName || "Current community",
      communityPubkey: currentCommunity?.communityPubkey,
      communityName: currentCommunity?.communityName,
    })
  }

  for (const server of personalServers) {
    addTarget("personal", server, {
      source: "personal",
      group: "personal",
      label: "Your personal servers",
    })
  }

  for (const community of memberCommunities) {
    for (const server of community.blossomServers) {
      addTarget("memberCommunities", server, {
        source: "member-community",
        group: "member-community",
        label: community.communityName || `Community ${community.communityPubkey.slice(0, 8)}`,
        communityPubkey: community.communityPubkey,
        communityName: community.communityName,
      })
    }
  }

  for (const server of lastResortServers) {
    addTarget("lastResort", server, {
      source: "last-resort",
      group: "last-resort",
      label: "Last-resort servers",
    })
  }

  return groups
}

export const flattenBlossomServerGroups = (groups: BlossomServerGroups) => [
  ...groups.currentCommunity,
  ...groups.personal,
  ...groups.memberCommunities,
  ...groups.lastResort,
]

const getResponseReason = (response: Response) =>
  response.headers.get("x-reason") || response.statusText || `HTTP ${response.status}`

export const classifyBlossomProbeResponse = (
  response: Response,
  endpoint: BlossomProbeEndpoint,
): BlossomCapabilityStatus => {
  if (response.ok) return "supported"
  if (endpoint === "mirror" && response.status === 405) {
    const allow = response.headers.get("allow") || ""
    return allow.toUpperCase().includes("PUT") ? "supported" : "unsupported"
  }
  if (response.status === 401 || response.status === 403) {
    const reason = getResponseReason(response).toLowerCase()
    return reason.includes("disabled") ? "disabled" : "auth-failed"
  }
  if (response.status === 404 || response.status === 405) return "unsupported"
  if (response.status === 413) return "too-large"
  if (response.status === 415) return "unsupported"
  if (response.status === 503 || response.status === 502 || response.status === 504) {
    return "unavailable"
  }

  return "error"
}

export const classifyBlossomProbeError = (error: unknown): BlossomCapabilityStatus => {
  const message = error instanceof Error ? error.message : String(error)

  return /failed to fetch|networkerror|cors/i.test(message) ? "cors-blocked" : "unavailable"
}

const makeProbeHeaders = async ({
  action,
  file,
  makeAuthHeader,
  server,
}: {
  action: BlossomProbeAuthAction
  file?: BlossomProbeFile
  makeAuthHeader?: BlossomProbeOptions["makeAuthHeader"]
  server: string
}) => {
  const headers: Record<string, string> = {
    "X-Content-Length": String(file?.size ?? 0),
    "X-Content-Type": file?.type || "application/octet-stream",
  }

  if (file?.sha256) headers["X-SHA-256"] = file.sha256.toLowerCase()

  const authorization = await makeAuthHeader?.(action, server)
  if (authorization) headers.Authorization = authorization

  return headers
}

const probeHeadEndpoint = async ({
  action,
  endpoint,
  fetcher,
  file,
  makeAuthHeader,
  origin,
  server,
}: {
  action: BlossomProbeAuthAction
  endpoint: "upload" | "media"
  fetcher: typeof fetch
  file?: BlossomProbeFile
  makeAuthHeader?: BlossomProbeOptions["makeAuthHeader"]
  origin: string
  server: string
}) => {
  try {
    const headers = await makeProbeHeaders({action, file, makeAuthHeader, server})
    const response = await fetcher(`${origin}/${endpoint}`, {method: "HEAD", headers})

    return classifyBlossomProbeResponse(response, endpoint)
  } catch (error) {
    return classifyBlossomProbeError(error)
  }
}

const probeMirrorEndpoint = async ({fetcher, origin}: {fetcher: typeof fetch; origin: string}) => {
  try {
    const response = await fetcher(`${origin}/mirror`, {method: "OPTIONS"})

    return classifyBlossomProbeResponse(response, "mirror")
  } catch (error) {
    return classifyBlossomProbeError(error)
  }
}

export const probeBlossomServerCapabilities = async ({
  server,
  file,
  source,
  fetcher = fetch,
  persist = true,
  makeAuthHeader,
  now = Date.now,
}: BlossomProbeOptions): Promise<BlossomServerCapability> => {
  const normalized = normalizeBlossomServerUrl(server)
  if (!normalized) {
    return {
      url: server,
      checkedAt: now(),
      source,
      upload: "unavailable",
      media: "unavailable",
      mirror: "unavailable",
      reason: "Invalid Blossom server URL",
    }
  }

  const origin = new URL(normalized).origin
  const [upload, media, mirror] = await Promise.all([
    probeHeadEndpoint({
      action: "upload",
      endpoint: "upload",
      fetcher,
      file,
      makeAuthHeader,
      origin,
      server: normalized,
    }),
    probeHeadEndpoint({
      action: "media",
      endpoint: "media",
      fetcher,
      file,
      makeAuthHeader,
      origin,
      server: normalized,
    }),
    probeMirrorEndpoint({fetcher, origin}),
  ])
  const capability: BlossomServerCapability = {
    url: normalized,
    checkedAt: now(),
    source,
    upload,
    media,
    mirror,
  }

  if (persist) rememberBlossomCapability(capability)

  return capability
}

const canTryUpload = (capability: BlossomServerCapability | undefined) =>
  !capability || ["unknown", "supported", "auth-failed"].includes(capability.upload)

const canTryMedia = (capability: BlossomServerCapability | undefined) =>
  Boolean(capability && ["supported", "auth-failed"].includes(capability.media))

const canServerMirror = (capability: BlossomServerCapability | undefined) =>
  Boolean(capability && ["supported", "auth-failed"].includes(capability.mirror))

const canTryServerMirror = (capability: BlossomServerCapability | undefined) =>
  !capability || ["unknown", "supported", "auth-failed"].includes(capability.mirror)

const isMediaFile = (file?: BlossomUploadPlanFile) =>
  Boolean(file?.type && /^(image|video)\//.test(file.type))

const isClientCompressibleImage = (file?: BlossomUploadPlanFile) =>
  Boolean(
    file?.type && /^image\//.test(file.type) && !/^image\/(webp|gif|svg\+xml|svg)$/.test(file.type),
  )

export const chooseBlossomInitialUploadPlan = ({
  targets,
  capabilities = {},
  settings = defaultBlossomSettings,
  file,
  encrypted = false,
  publicContext = true,
}: ChooseBlossomInitialUploadPlanOptions): BlossomInitialUploadPlan => {
  if (encrypted && publicContext) return {status: "blocked", reason: "public-encryption-disabled"}

  const canonical = targets.find(target => canTryUpload(capabilities[target.url]))
  if (!canonical) return {status: "blocked", reason: "no-upload-target"}

  const normalizedSettings = normalizeBlossomSettings(settings)
  const mediaEligible =
    !encrypted &&
    isMediaFile(file) &&
    (normalizedSettings.optimizationMode === "auto" ||
      normalizedSettings.optimizationMode === "server")

  if (mediaEligible && canTryMedia(capabilities[canonical.url])) {
    return {
      status: "ready",
      method: "media",
      canonical,
      mirrorOptimizedToCanonical: false,
      useClientCompression: false,
      reason: "canonical-media",
    }
  }

  if (mediaEligible && canServerMirror(capabilities[canonical.url])) {
    const optimizer = targets.find(
      target => target.url !== canonical.url && canTryMedia(capabilities[target.url]),
    )

    if (optimizer) {
      return {
        status: "ready",
        method: "media",
        canonical,
        optimizer,
        mirrorOptimizedToCanonical: true,
        useClientCompression: false,
        reason: "safe-external-optimizer",
      }
    }
  }

  return {
    status: "ready",
    method: "upload",
    canonical,
    mirrorOptimizedToCanonical: false,
    useClientCompression:
      isClientCompressibleImage(file) &&
      (normalizedSettings.optimizationMode === "client" ||
        normalizedSettings.optimizationMode === "auto"),
    reason: mediaEligible ? "media-unavailable-upload-fallback" : "regular-upload",
  }
}

export const createBlossomMirrorJobs = ({
  targets,
  capabilities = {},
  settings = defaultBlossomSettings,
  exactBytesAvailable = false,
  now = Date.now,
  makeId,
}: CreateBlossomMirrorJobsOptions): BlossomMirrorJob[] => {
  const normalizedSettings = normalizeBlossomSettings(settings)
  if (normalizedSettings.mirrorMode === "never") return []

  const createdAt = now()
  const seen = new Set<string>()

  return targets.flatMap((target, index) => {
    if (seen.has(target.url)) return []
    seen.add(target.url)

    const capability = capabilities[target.url]
    const canMirror = normalizedSettings.preferServerSideMirroring && canTryServerMirror(capability)
    const canBrowserUpload =
      exactBytesAvailable &&
      normalizedSettings.browserMirrorConsent === "allow" &&
      normalizedSettings.mirrorMode !== "server-side-only" &&
      canTryUpload(capability)
    const method: BlossomMirrorMethod = canMirror ? "server-mirror" : "browser-upload"
    const canQueue = canMirror || canBrowserUpload

    return [
      {
        id: makeId?.(target, index) || `${createdAt}-${index}-${target.url}`,
        targetUrl: target.url,
        targetLabel: target.label,
        targetGroup: target.group,
        method,
        status: canQueue ? "queued" : "skipped",
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
        lastError: canQueue
          ? undefined
          : "Server-side mirroring unavailable; browser-assisted mirroring requires consent.",
      } satisfies BlossomMirrorJob,
    ]
  })
}

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
    autoMirrorTargetGroups: normalizeStringArray(source.autoMirrorTargetGroups, mirrorTargetGroups),
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
    attempts:
      typeof value.attempts === "number" && Number.isFinite(value.attempts) ? value.attempts : 0,
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
          size:
            typeof original.size === "number" && Number.isFinite(original.size)
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
      uploads: normalizedCurrent.uploads.map(record =>
        record.id === id ? update(record) : record,
      ),
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
