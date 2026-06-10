import {resolveCorsProxyForUrl} from "../utils/grasp-url.js"
import type {GitNaturalInfoRefs} from "./natural-read-cache.js"
import {GitNaturalObjectCache} from "./natural-read-cache.js"

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

  constructor(
    code: GitNaturalReadErrorCode,
    message: string,
    details: {
      remoteUrl?: string
      effectiveUrl?: string
      status?: number
      capability?: string
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

export interface FetchUploadPackResult extends GitNaturalTransport {
  packfile: Uint8Array
  rawResponse: Uint8Array
  elapsedMs: number
}

export interface GitNaturalReadClientConfig {
  cache?: GitNaturalObjectCache
  fetcher?: FetchLike
  corsProxy?: string | null
  now?: () => number
}

export const defaultUploadPackCapabilities = ["ofs-delta", "no-progress"]
export const necessaryUploadPackCapabilities = ["multi_ack_detailed", "side-band-64k"]
export const requiredUploadPackCapabilities = ["shallow", "object-format=sha1"]

const textDecoder = new TextDecoder("utf-8")

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

export function parseInfoRefsAdvertisement(text: string): GitNaturalInfoRefs {
  const refs: Record<string, string> = {}
  const capabilities: string[] = []
  const symrefs: Record<string, string> = {}

  for (const packet of parsePktLineText(text)) {
    if (!packet || packet.startsWith("# service=")) continue

    const [record, capabilitySegment = ""] = packet.split("\0", 2)
    const trimmedRecord = record.replace(/\n$/, "")
    const separator = trimmedRecord.indexOf(" ")
    if (separator <= 0) continue

    const oid = trimmedRecord.slice(0, separator)
    const ref = trimmedRecord.slice(separator + 1).trim()
    if (!oid || !ref) continue

    refs[ref] = oid

    if (capabilitySegment) {
      for (const capability of capabilitySegment.trim().split(/\s+/).filter(Boolean)) {
        capabilities.push(capability)
        if (!capability.startsWith("symref=")) continue
        const mapping = capability.slice("symref=".length)
        const mappingSeparator = mapping.indexOf(":")
        if (mappingSeparator <= 0) continue
        symrefs[mapping.slice(0, mappingSeparator)] = mapping.slice(mappingSeparator + 1)
      }
    }
  }

  const headRef = symrefs.HEAD
  const headCommit = headRef ? refs[headRef] : refs.HEAD

  return {
    refs,
    capabilities,
    symrefs,
    ...(headRef ? {headRef} : {}),
    ...(headCommit ? {headCommit} : {}),
  }
}

export function encodePktLine(payload: string): string {
  if (payload.length === 0) return "0000"
  return (payload.length + 4).toString(16).padStart(4, "0") + payload
}

export function createUploadPackWantRequest(params: {
  commitHash: string
  capabilities: string[]
  deepen?: number
  filter?: string
}): string {
  const commitHash = String(params.commitHash || "").trim()
  if (!/^[a-f0-9]{40}$/i.test(commitHash)) {
    throw new GitNaturalReadError(
      "ref-not-found",
      `Invalid commit hash '${params.commitHash}', expected 40 hex characters`,
    )
  }

  const packets = [
    `want ${commitHash} ${params.capabilities.join(" ")} agent=budabit/1.0.0\n`,
  ]
  if (params.deepen !== undefined) packets.push(`deepen ${params.deepen}\n`)
  if (params.filter) packets.push(`filter ${params.filter}\n`)
  packets.push("")
  packets.push("done\n")

  return packets.map(encodePktLine).join("")
}

export function selectUploadPackCapabilities(
  serverCapabilities: string[],
  options: {requireFilter?: boolean} = {},
): string[] {
  const selected: string[] = []

  for (const capability of defaultUploadPackCapabilities) {
    if (serverCapabilities.includes(capability)) selected.push(capability)
  }
  for (const capability of necessaryUploadPackCapabilities) {
    if (!serverCapabilities.includes(capability)) {
      throw new GitNaturalReadError(
        "missing-capability",
        `Git server missing required capability: ${capability}`,
        {capability},
      )
    }
    selected.push(capability)
  }
  for (const capability of requiredUploadPackCapabilities) {
    if (!serverCapabilities.includes(capability)) {
      throw new GitNaturalReadError(
        "missing-capability",
        `Git server missing required capability: ${capability}`,
        {capability},
      )
    }
  }
  if (options.requireFilter) {
    if (!serverCapabilities.includes("filter")) {
      throw new GitNaturalReadError(
        "missing-filter-capability",
        "Git server missing required capability: filter",
        {capability: "filter"},
      )
    }
    selected.push("filter")
  }

  return selected
}

export function extractPackfileFromUploadPackResponse(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0

  while (offset + 4 <= data.length) {
    const length = parsePktLength(data, offset)
    offset += 4
    if (length === 0) continue
    if (length < 4 || offset + length - 4 > data.length) {
      throw new GitNaturalReadError("protocol-error", "Invalid git-upload-pack pkt-line length")
    }

    const payload = data.subarray(offset, offset + length - 4)
    offset += length - 4

    const text = textDecoder.decode(payload)
    if (text === "NAK\n" || text.startsWith("ACK ")) continue
    if (text.startsWith("ERR ")) {
      throw new GitNaturalReadError("protocol-error", text.trim())
    }

    const channel = payload[0]
    if (channel === 1) {
      chunks.push(payload.subarray(1))
    } else if (channel === 2) {
      continue
    } else if (channel === 3) {
      throw new GitNaturalReadError("protocol-error", textDecoder.decode(payload.subarray(1)))
    } else if (payload.length > 0) {
      chunks.push(payload)
    }
  }

  return concatUint8Arrays(chunks)
}

export class GitNaturalReadClient {
  private readonly cache: GitNaturalObjectCache
  private readonly fetcher: FetchLike
  private readonly corsProxy?: string | null
  private readonly now: () => number
  private readonly inFlightInfoRefs = new Map<string, Promise<FetchInfoRefsResult>>()

  constructor(config: GitNaturalReadClientConfig = {}) {
    this.cache = config.cache ?? new GitNaturalObjectCache({now: config.now})
    this.fetcher = config.fetcher ?? globalThis.fetch.bind(globalThis)
    this.corsProxy = config.corsProxy
    this.now = config.now ?? (() => Date.now())
  }

  async fetchInfoRefs(params: {
    url: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchInfoRefsResult> {
    const remoteUrl = trimTrailingSlashes(params.url)
    const corsProxy = params.corsProxy ?? this.corsProxy
    const inFlightKey = `${remoteUrl}\0${corsProxy ?? ""}`
    const existing = this.inFlightInfoRefs.get(inFlightKey)
    if (existing) return existing

    const startedAt = this.now()
    const promise = (async (): Promise<FetchInfoRefsResult> => {
      const transport = resolveNaturalReadTransport(remoteUrl, corsProxy)
      const cached = this.cache.getInfoRefs(remoteUrl)
      if (cached) {
        return {
          infoRefs: cached,
          remoteUrl,
          effectiveUrl: buildInfoRefsUrl(transport.effectiveUrl),
          usesProxy: transport.usesProxy,
          elapsedMs: Math.max(0, this.now() - startedAt),
        }
      }

      const effectiveUrl = buildInfoRefsUrl(transport.effectiveUrl)
      const text = await this.fetchText(effectiveUrl, remoteUrl, params.signal)
      const infoRefs = parseInfoRefsAdvertisement(text)
      if (Object.keys(infoRefs.refs).length === 0 && infoRefs.capabilities.length === 0) {
        throw new GitNaturalReadError(
          "protocol-error",
          `No git advertised refs returned from ${remoteUrl}`,
          {remoteUrl, effectiveUrl},
        )
      }

      this.cache.putInfoRefs(remoteUrl, infoRefs)

      return {
        infoRefs,
        remoteUrl,
        effectiveUrl,
        usesProxy: transport.usesProxy,
        elapsedMs: Math.max(0, this.now() - startedAt),
      }
    })()

    this.inFlightInfoRefs.set(inFlightKey, promise)
    void promise.then(
      () => this.inFlightInfoRefs.delete(inFlightKey),
      () => this.inFlightInfoRefs.delete(inFlightKey),
    )
    return promise
  }

  async fetchUploadPack(params: {
    url: string
    want: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchUploadPackResult> {
    const startedAt = this.now()
    const remoteUrl = trimTrailingSlashes(params.url)
    const transport = resolveNaturalReadTransport(remoteUrl, params.corsProxy ?? this.corsProxy)
    const effectiveUrl = buildUploadPackUrl(transport.effectiveUrl)

    const response = await this.fetchResponse(effectiveUrl, remoteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-git-upload-pack-request",
        Accept: "application/x-git-upload-pack-result",
      },
      body: params.want,
      signal: params.signal,
    })
    const rawResponse = new Uint8Array(await response.arrayBuffer())
    const packfile = extractPackfileFromUploadPackResponse(rawResponse)

    return {
      ...transport,
      effectiveUrl,
      rawResponse,
      packfile,
      elapsedMs: Math.max(0, this.now() - startedAt),
    }
  }

  async fetchObjectPackfile(params: {
    url: string
    objectHash: string
    serverCapabilities: string[]
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchUploadPackResult> {
    const capabilities = selectUploadPackCapabilities(params.serverCapabilities)
    return this.fetchUploadPack({
      url: params.url,
      corsProxy: params.corsProxy,
      signal: params.signal,
      want: createUploadPackWantRequest({
        commitHash: params.objectHash,
        capabilities,
        deepen: 1,
      }),
    })
  }

  async fetchBlobNonePackfile(params: {
    url: string
    commitHash: string
    serverCapabilities: string[]
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchUploadPackResult> {
    const capabilities = selectUploadPackCapabilities(params.serverCapabilities, {requireFilter: true})
    return this.fetchUploadPack({
      url: params.url,
      corsProxy: params.corsProxy,
      signal: params.signal,
      want: createUploadPackWantRequest({
        commitHash: params.commitHash,
        capabilities,
        deepen: 1,
        filter: "blob:none",
      }),
    })
  }

  async fetchTreeZeroPackfile(params: {
    url: string
    commitHash: string
    serverCapabilities: string[]
    maxCommits?: number
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchUploadPackResult> {
    const capabilities = selectUploadPackCapabilities(params.serverCapabilities, {requireFilter: true})
    return this.fetchUploadPack({
      url: params.url,
      corsProxy: params.corsProxy,
      signal: params.signal,
      want: createUploadPackWantRequest({
        commitHash: params.commitHash,
        capabilities,
        deepen: params.maxCommits,
        filter: "tree:0",
      }),
    })
  }

  private async fetchText(
    effectiveUrl: string,
    remoteUrl: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.fetchResponse(effectiveUrl, remoteUrl, {
      method: "GET",
      headers: {Accept: "application/x-git-upload-pack-advertisement"},
      signal,
    })
    if (typeof response.text === "function") return response.text()
    return textDecoder.decode(new Uint8Array(await response.arrayBuffer()))
  }

  private async fetchResponse(
    effectiveUrl: string,
    remoteUrl: string,
    init: RequestInit,
  ): Promise<Awaited<ReturnType<FetchLike>>> {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetcher(effectiveUrl, init)
    } catch (error) {
      const code = classifyFetchFailure(error, effectiveUrl, remoteUrl)
      throw new GitNaturalReadError(
        code,
        `Git natural request failed for ${remoteUrl}: ${error instanceof Error ? error.message : String(error)}`,
        {remoteUrl, effectiveUrl, cause: error},
      )
    }

    if (!response.ok) {
      const status = response.status
      const code = status === 401 || status === 403 ? "auth-required" : "http-error"
      throw new GitNaturalReadError(
        code,
        `Git natural request failed for ${remoteUrl} (HTTP ${status})`,
        {remoteUrl, effectiveUrl, status},
      )
    }

    return response
  }
}

function parsePktLineText(text: string): string[] {
  const packets: string[] = []
  let offset = 0

  while (offset + 4 <= text.length) {
    const length = Number.parseInt(text.slice(offset, offset + 4), 16)
    if (Number.isNaN(length)) break
    offset += 4
    if (length === 0) continue
    if (length < 4 || offset + length - 4 > text.length) break
    packets.push(text.slice(offset, offset + length - 4))
    offset += length - 4
  }

  return packets
}

function parsePktLength(data: Uint8Array, offset: number): number {
  const value = textDecoder.decode(data.subarray(offset, offset + 4))
  const length = Number.parseInt(value, 16)
  if (Number.isNaN(length)) {
    throw new GitNaturalReadError("protocol-error", `Invalid pkt-line length '${value}'`)
  }
  return length
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function classifyFetchFailure(
  error: unknown,
  effectiveUrl: string,
  remoteUrl: string,
): GitNaturalReadErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const directRequest = effectiveUrl.startsWith(`${trimTrailingSlashes(remoteUrl)}/`)
  if (!directRequest || /cors|failed to fetch|networkerror|load failed/i.test(message)) {
    return "cors-proxy-failure"
  }
  return "transient-network-failure"
}

function trimTrailingSlashes(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "")
}
