import {
  MissingRef,
  fetchPackfile as fetchGitNaturalPackfile,
  getInfoRefs as getGitNaturalInfoRefs,
  loadTree as loadGitNaturalTree,
  parseCommit as parseGitNaturalApiCommit,
  parseTree as parseGitNaturalApiTree,
  type Commit as GitNaturalApiCommit,
  type InfoRefsUploadPackResponse,
  type ParsedObject,
  type Tree as GitNaturalApiTree,
  type TreeEntry as GitNaturalApiTreeEntry,
} from "@fiatjaf/git-natural-api"

import {
  GitNaturalReadError,
  buildInfoRefsUrl,
  buildUploadPackUrl,
  resolveNaturalReadTransport,
  type FetchInfoRefsResult,
  type FetchLike,
  type GitNaturalTransport,
} from "./natural-read-transport.js"
import {GitNaturalObjectCache, type GitNaturalInfoRefs} from "./natural-read-cache.js"

export interface GitNaturalApiAdapterConfig {
  cache?: GitNaturalObjectCache
  fetcher?: FetchLike
  corsProxy?: string | null
  now?: () => number
}

export type {GitNaturalApiCommit, GitNaturalApiTree, GitNaturalApiTreeEntry, ParsedObject as GitNaturalApiParsedObject}

export interface GitNaturalApiPackfileResult {
  version: number
  count: number
  objects: Map<string, ParsedObject>
}

export interface GitNaturalApiPackResult extends GitNaturalTransport {
  effectiveUrl: string
  pack: GitNaturalApiPackfileResult
  elapsedMs: number
}

export interface GitNaturalApiObjectResult extends GitNaturalApiPackResult {
  object: ParsedObject
}

export interface GitNaturalApiWantRequestParams {
  objectHash: string
  capabilities: string[]
  deepen?: number
  filter?: string
}

export const gitNaturalApiDefaultCapabilities = ["ofs-delta", "no-progress"] as const
export const gitNaturalApiNecessaryCapabilities = ["multi_ack_detailed", "side-band-64k"] as const
export const gitNaturalApiRequiredCapabilities = ["shallow", "object-format=sha1"] as const

export function createGitNaturalApiWantRequest(params: GitNaturalApiWantRequestParams): string {
  const objectHash = String(params.objectHash || "").trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(objectHash)) {
    throw new GitNaturalReadError(
      "ref-not-found",
      `Invalid object hash '${params.objectHash}', expected 40 hex characters`,
    )
  }

  const packets = [`want ${objectHash} ${params.capabilities.join(" ")} agent=budabit/1.0.0\n`]
  if (params.deepen !== undefined) packets.push(`deepen ${params.deepen}\n`)
  if (params.filter) packets.push(`filter ${params.filter}\n`)
  packets.push("")
  packets.push("done\n")

  return packets.map(encodePktLine).join("")
}

export function selectGitNaturalApiCapabilities(
  serverCapabilities: string[],
  options: {requireFilter?: boolean} = {},
): string[] {
  const selected: string[] = []

  for (const capability of gitNaturalApiDefaultCapabilities) {
    if (serverCapabilities.includes(capability)) selected.push(capability)
  }
  for (const capability of gitNaturalApiNecessaryCapabilities) {
    if (!serverCapabilities.includes(capability)) {
      throw new GitNaturalReadError(
        "missing-capability",
        `Git server missing required capability: ${capability}`,
        {capability},
      )
    }
    selected.push(capability)
  }
  for (const capability of gitNaturalApiRequiredCapabilities) {
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

export function toGitNaturalInfoRefs(infoRefs: InfoRefsUploadPackResponse): GitNaturalInfoRefs {
  const refs = {...infoRefs.refs}
  const symrefs = {...infoRefs.symrefs}
  const headRef = symrefs.HEAD
  const headCommit = headRef ? refs[headRef] : refs.HEAD

  return {
    refs,
    capabilities: [...infoRefs.capabilities],
    symrefs,
    ...(headRef ? {headRef} : {}),
    ...(headCommit ? {headCommit} : {}),
  }
}

export class GitNaturalApiAdapter {
  private readonly cache: GitNaturalObjectCache
  private readonly fetcher?: FetchLike
  private readonly corsProxy?: string | null
  private readonly now: () => number
  private readonly inFlightInfoRefs = new Map<string, Promise<FetchInfoRefsResult>>()

  constructor(config: GitNaturalApiAdapterConfig = {}) {
    this.cache = config.cache ?? new GitNaturalObjectCache({now: config.now})
    this.fetcher = config.fetcher
    this.corsProxy = config.corsProxy
    this.now = config.now ?? (() => Date.now())
  }

  async fetchInfoRefs(params: {
    url: string
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<FetchInfoRefsResult> {
    const startedAt = this.now()
    const remoteUrl = trimTrailingSlashes(params.url)
    const corsProxy = resolveCorsProxyOverride(params.corsProxy, this.corsProxy)
    const inFlightKey = `${remoteUrl}\0${corsProxy ?? ""}`
    const existing = this.inFlightInfoRefs.get(inFlightKey)
    if (existing) return existing

    const promise = (async (): Promise<FetchInfoRefsResult> => {
      throwIfAborted(params.signal)
      const transport = resolveNaturalReadTransport(remoteUrl, corsProxy)
      const effectiveUrl = buildInfoRefsUrl(transport.effectiveUrl)
      const cached = this.cache.getInfoRefs(remoteUrl)
      if (cached) {
        return {
          infoRefs: cached,
          remoteUrl,
          effectiveUrl,
          usesProxy: transport.usesProxy,
          elapsedMs: Math.max(0, this.now() - startedAt),
        }
      }

      try {
        const infoRefs = toGitNaturalInfoRefs(
          await this.runWithFetch(() => getGitNaturalInfoRefs(transport.effectiveUrl)),
        )
        if (Object.keys(infoRefs.refs).length === 0 && infoRefs.capabilities.length === 0) {
          throw new GitNaturalReadError(
            "protocol-error",
            `No git advertised refs returned from ${remoteUrl}`,
            {remoteUrl, effectiveUrl},
          )
        }
        throwIfAborted(params.signal)
        this.cache.putInfoRefs(remoteUrl, infoRefs)

        return {
          infoRefs,
          remoteUrl,
          effectiveUrl,
          usesProxy: transport.usesProxy,
          elapsedMs: Math.max(0, this.now() - startedAt),
        }
      } catch (error) {
        throw toGitNaturalReadError(error, {
          code: "protocol-error",
          message: `Git natural API info/refs failed for ${remoteUrl}`,
          remoteUrl,
          effectiveUrl,
        })
      }
    })()

    this.inFlightInfoRefs.set(inFlightKey, promise)
    void promise.then(
      () => this.inFlightInfoRefs.delete(inFlightKey),
      () => this.inFlightInfoRefs.delete(inFlightKey),
    )
    return promise
  }

  async fetchObjectByHash(params: {
    url: string
    objectHash: string
    serverCapabilities: string[]
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalApiObjectResult> {
    const objectHash = params.objectHash.toLowerCase()
    const result = await this.fetchPackObjects({
      url: params.url,
      objectHash,
      serverCapabilities: params.serverCapabilities,
      deepen: 1,
      corsProxy: params.corsProxy,
      signal: params.signal,
    })
    const object = result.pack.objects.get(objectHash)
    if (!object) {
      throw new GitNaturalReadError(
        "object-not-found",
        `Git object not found in library-backed packfile: ${objectHash}`,
        {remoteUrl: params.url, effectiveUrl: result.effectiveUrl},
      )
    }

    return {...result, object}
  }

  async fetchBlobNoneObjects(params: {
    url: string
    commitHash: string
    serverCapabilities: string[]
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalApiPackResult> {
    return this.fetchPackObjects({
      url: params.url,
      objectHash: params.commitHash,
      serverCapabilities: params.serverCapabilities,
      deepen: 1,
      filter: "blob:none",
      requireFilter: true,
      corsProxy: params.corsProxy,
      signal: params.signal,
    })
  }

  async fetchTreeZeroObjects(params: {
    url: string
    commitHash: string
    serverCapabilities: string[]
    maxCommits?: number
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalApiPackResult> {
    return this.fetchPackObjects({
      url: params.url,
      objectHash: params.commitHash,
      serverCapabilities: params.serverCapabilities,
      deepen: params.maxCommits,
      filter: "tree:0",
      requireFilter: true,
      corsProxy: params.corsProxy,
      signal: params.signal,
    })
  }

  loadTree(
    treeObject: ParsedObject,
    objects: {get(hash: string): ParsedObject | undefined},
    depth?: number,
  ): GitNaturalApiTree {
    return loadGitNaturalTree(treeObject, objects, depth)
  }

  parseCommit(data: Uint8Array, hash: string): GitNaturalApiCommit {
    return parseGitNaturalApiCommit(data, hash)
  }

  parseTree(data: Uint8Array): GitNaturalApiTreeEntry[] {
    return parseGitNaturalApiTree(data)
  }

  private async fetchPackObjects(params: {
    url: string
    objectHash: string
    serverCapabilities: string[]
    deepen?: number
    filter?: string
    requireFilter?: boolean
    corsProxy?: string | null
    signal?: AbortSignal
  }): Promise<GitNaturalApiPackResult> {
    const startedAt = this.now()
    const remoteUrl = trimTrailingSlashes(params.url)
    const transport = resolveNaturalReadTransport(
      remoteUrl,
      resolveCorsProxyOverride(params.corsProxy, this.corsProxy),
    )
    const effectiveUrl = buildUploadPackUrl(transport.effectiveUrl)
    const capabilities = selectGitNaturalApiCapabilities(params.serverCapabilities, {
      requireFilter: params.requireFilter,
    })
    const want = createGitNaturalApiWantRequest({
      objectHash: params.objectHash,
      capabilities,
      deepen: params.deepen,
      filter: params.filter,
    })

    try {
      throwIfAborted(params.signal)
      const pack = await this.runWithFetch(() => fetchGitNaturalPackfile(transport.effectiveUrl, want))
      throwIfAborted(params.signal)
      return {
        ...transport,
        effectiveUrl,
        pack,
        elapsedMs: Math.max(0, this.now() - startedAt),
      }
    } catch (error) {
      if (error instanceof MissingRef) {
        throw new GitNaturalReadError(
          "object-not-found",
          `Git object not found: ${params.objectHash}${formatPackFailureDiagnostics({
            remoteUrl,
            effectiveUrl,
            filter: params.filter,
            depth: params.deepen,
            parserFailureClass: "missing-ref",
          })}`,
          {
            remoteUrl,
            effectiveUrl,
            filter: params.filter,
            depth: params.deepen,
            parserFailureClass: "missing-ref",
            cause: error,
          },
        )
      }

      const parserFailureClass = classifyPackParserFailure(error)
      throw toGitNaturalReadError(error, {
        code: "protocol-error",
        message: `Git natural API upload-pack failed for ${redactUrlForDiagnostics(remoteUrl)}`,
        remoteUrl,
        effectiveUrl,
        filter: params.filter,
        depth: params.deepen,
        parserFailureClass,
      })
    }
  }

  private runWithFetch<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.fetcher) return operation()
    return withTemporaryGlobalFetch(createFetchOverride(this.fetcher), operation)
  }
}

let temporaryFetchLock: Promise<void> = Promise.resolve()

async function withTemporaryGlobalFetch<T>(fetcher: typeof fetch, operation: () => Promise<T>): Promise<T> {
  const previousLock = temporaryFetchLock
  let releaseLock: () => void = () => {}
  temporaryFetchLock = new Promise(resolve => {
    releaseLock = resolve
  })
  await previousLock

  const previousFetch = globalThis.fetch
  globalThis.fetch = fetcher
  try {
    return await operation()
  } finally {
    globalThis.fetch = previousFetch
    releaseLock()
  }
}

function createFetchOverride(fetcher: FetchLike): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetcher(String(input), init ?? {method: "GET"})
    const responseWithBytes = response as Awaited<ReturnType<FetchLike>> & {
      bytes?: () => Promise<Uint8Array>
    }
    return {
      ...responseWithBytes,
      text:
        response.text ??
        (async () => textDecoder.decode(new Uint8Array(await response.arrayBuffer()))),
      bytes: responseWithBytes.bytes ?? (async () => new Uint8Array(await response.arrayBuffer())),
    } as Response
  }) as typeof fetch
}

const textDecoder = new TextDecoder("utf-8")

function encodePktLine(payload: string): string {
  if (payload.length === 0) return "0000"
  return (payload.length + 4).toString(16).padStart(4, "0") + payload
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException("Aborted", "AbortError")
}

function toGitNaturalReadError(
  error: unknown,
  fallback: {
    code: "protocol-error" | "http-error" | "object-not-found"
    message: string
    remoteUrl: string
    effectiveUrl: string
    filter?: string
    depth?: number
    parserFailureClass?: string
  },
): GitNaturalReadError {
  if (error instanceof GitNaturalReadError) return error
  if (isAbortError(error)) throw error
  return new GitNaturalReadError(
    fallback.code,
    `${fallback.message}${formatPackFailureDiagnostics(fallback)}: ${error instanceof Error ? error.message : String(error)}`,
    {
      remoteUrl: fallback.remoteUrl,
      effectiveUrl: fallback.effectiveUrl,
      filter: fallback.filter,
      depth: fallback.depth,
      parserFailureClass: fallback.parserFailureClass,
      cause: error,
    },
  )
}

function formatPackFailureDiagnostics(params: {
  remoteUrl: string
  effectiveUrl: string
  filter?: string
  depth?: number
  parserFailureClass?: string
}): string {
  if (params.filter === undefined && params.depth === undefined && params.parserFailureClass === undefined) {
    return ""
  }

  const fields = [
    `remote=${redactUrlForDiagnostics(params.remoteUrl)}`,
    `effective=${redactUrlForDiagnostics(params.effectiveUrl)}`,
    `filter=${params.filter || "none"}`,
    `depth=${params.depth ?? "none"}`,
    `parser=${params.parserFailureClass || "unknown"}`,
  ]
  return ` (${fields.join(", ")})`
}

function classifyPackParserFailure(error: unknown): string {
  const seen = new Set<unknown>()
  let current: unknown = error
  let fallbackName = "unknown"

  while (current && !seen.has(current)) {
    seen.add(current)
    const asAny = current as {name?: string; message?: string; cause?: unknown; constructor?: {name?: string}}
    const name = asAny.name || asAny.constructor?.name || ""
    const message = current instanceof Error ? current.message : String(current)
    const text = `${name} ${message}`

    if (name && fallbackName === "unknown") fallbackName = name
    if (name === "BigBatchError" || /decompress too much data|too much data at the same time/i.test(text)) {
      return "big-batch"
    }
    if (/pkt-line|packet line|side-?band/i.test(text)) return "pkt-line"
    if (/zlib|inflate|deflate|decompress/i.test(text)) return "zlib"
    if (/checksum|crc|sha-?1/i.test(text)) return "checksum"
    if (/packfile|pack file|invalid pack/i.test(text)) return "pack-parser"

    current = asAny.cause
  }

  return fallbackName
}

function redactUrlForDiagnostics(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) url.username = "redacted"
    if (url.password) url.password = ""
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|access_token|auth|password|secret|key/i.test(key)) {
        url.searchParams.set(key, "redacted")
      }
    }
    return url.toString()
  } catch {
    return String(value || "").replace(/\/\/([^/@\s]+)@/g, "//redacted@")
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function trimTrailingSlashes(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "")
}

function resolveCorsProxyOverride(
  override: string | null | undefined,
  fallback: string | null | undefined,
): string | null | undefined {
  return override !== undefined ? override : fallback
}
