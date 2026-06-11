import {resolveCorsProxyForUrl} from "../utils/grasp-url.js"
import type {GitNaturalInfoRefs} from "./natural-read-cache.js"

export type GitNaturalReadErrorCode =
  | "feature-disabled"
  | "auth-required"
  | "http-error"
  | "network-error"
  | "cors-proxy-failure"
  | "transient-network-failure"
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

export type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean
  status: number
  statusText?: string
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

function trimTrailingSlashes(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "")
}
