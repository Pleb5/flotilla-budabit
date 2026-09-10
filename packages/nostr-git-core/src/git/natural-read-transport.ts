import {resolveCorsProxyForUrl} from "../utils/grasp-url.js"
import type {GitNaturalInfoRefs} from "./natural-read-cache.js"
import {assertGitRemoteUrlEnabled} from "./vendor-providers.js"

export type GitNaturalReadErrorCode =
  | "feature-disabled"
  | "auth-required"
  | "http-error"
  | "network-error"
  | "cors-proxy-failure"
  | "transient-network-failure"
  | "cancellation-unconfirmed"
  | "protocol-error"
  | "missing-capability"
  | "missing-filter-capability"
  | "ref-not-found"
  | "object-not-found"

export class GitNaturalReadError extends Error {
  readonly code: GitNaturalReadErrorCode
  readonly remoteUrl?: string
  readonly effectiveUrl?: string
  readonly status?: number
  readonly capability?: string
  readonly filter?: string
  readonly depth?: number
  readonly parserFailureClass?: string

  constructor(
    code: GitNaturalReadErrorCode,
    message: string,
    details: {
      remoteUrl?: string
      effectiveUrl?: string
      status?: number
      capability?: string
      filter?: string
      depth?: number
      parserFailureClass?: string
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = "GitNaturalReadError"
    this.code = code
    this.remoteUrl = details.remoteUrl
    this.effectiveUrl = details.effectiveUrl
    this.status = details.status
    this.capability = details.capability
    this.filter = details.filter
    this.depth = details.depth
    this.parserFailureClass = details.parserFailureClass
    if (details.cause !== undefined) {
      ;(this as Error & {cause?: unknown}).cause = details.cause
    }
  }
}

export interface SerializedGitNaturalReadError {
  name: "GitNaturalReadError"
  message: string
  code: GitNaturalReadErrorCode
  remoteUrl?: string
  effectiveUrl?: string
  status?: number
  capability?: string
  filter?: string
  depth?: number
  parserFailureClass?: string
}

const gitNaturalReadErrorCodes = new Set<GitNaturalReadErrorCode>([
  "feature-disabled",
  "auth-required",
  "http-error",
  "network-error",
  "cors-proxy-failure",
  "transient-network-failure",
  "cancellation-unconfirmed",
  "protocol-error",
  "missing-capability",
  "missing-filter-capability",
  "ref-not-found",
  "object-not-found",
])

export function serializeGitNaturalReadError(
  error: unknown,
): SerializedGitNaturalReadError | undefined {
  const value = error as Partial<GitNaturalReadError>
  if (!gitNaturalReadErrorCodes.has(value?.code as GitNaturalReadErrorCode)) return undefined

  return {
    name: "GitNaturalReadError",
    message: error instanceof Error ? error.message : String(error),
    code: value.code as GitNaturalReadErrorCode,
    remoteUrl: value.remoteUrl,
    effectiveUrl: value.effectiveUrl,
    status: value.status,
    capability: value.capability,
    filter: value.filter,
    depth: value.depth,
    parserFailureClass: value.parserFailureClass,
  }
}

export function deserializeGitNaturalReadError(
  error: SerializedGitNaturalReadError,
): GitNaturalReadError {
  return new GitNaturalReadError(error.code, error.message, {
    remoteUrl: error.remoteUrl,
    effectiveUrl: error.effectiveUrl,
    status: error.status,
    capability: error.capability,
    filter: error.filter,
    depth: error.depth,
    parserFailureClass: error.parserFailureClass,
  })
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean
  status: number
  statusText?: string
  body?: {cancel: () => Promise<void>} | null
  text?: () => Promise<string>
  arrayBuffer: () => Promise<ArrayBuffer>
}>

export interface GitNaturalTransport {
  remoteUrl: string
  effectiveUrl: string
  usesProxy: boolean
  corsProxy?: string
}

export interface FetchInfoRefsResult {
  infoRefs: GitNaturalInfoRefs
  remoteUrl: string
  effectiveUrl: string
  usesProxy: boolean
  elapsedMs: number
}

export function buildInfoRefsUrl(url: string): string {
  return `${trimTrailingSlashes(url)}/info/refs?service=git-upload-pack`
}

export function buildUploadPackUrl(url: string): string {
  return `${trimTrailingSlashes(url)}/git-upload-pack`
}

export function resolveNaturalReadTransport(
  remoteUrl: string,
  corsProxy?: string | null,
): GitNaturalTransport {
  assertGitRemoteUrlEnabled(remoteUrl, "Git natural read")
  const proxy = resolveCorsProxyForUrl(remoteUrl, corsProxy)
  if (!proxy) {
    return {
      remoteUrl,
      effectiveUrl: remoteUrl,
      usesProxy: false,
    }
  }

  return {
    remoteUrl,
    effectiveUrl: `${proxy.replace(/\/+$/, "")}/${remoteUrl.replace(/^https?:\/\//i, "")}`,
    usesProxy: true,
    corsProxy: proxy,
  }
}

export function resolveNaturalReadFallbackTransport(
  remoteUrl: string,
  corsProxy: string | null | undefined,
  primary: GitNaturalTransport,
): GitNaturalTransport | undefined {
  if (primary.usesProxy || !corsProxy) return undefined

  const proxy = corsProxy.replace(/\/+$/, "")
  return {
    remoteUrl,
    effectiveUrl: `${proxy}/${remoteUrl.replace(/^https?:\/\//i, "")}`,
    usesProxy: true,
    corsProxy: proxy,
  }
}

function trimTrailingSlashes(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
}
