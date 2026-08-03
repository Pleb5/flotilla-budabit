import {nip19} from "nostr-tools"

export interface ParsedGraspRepoHttpUrl {
  ownerNpub: string
  identifier: string
  httpBase: string
}

export interface GraspRepoCloneTarget {
  relayUrl: string
  ownerPubkey: string
  identifier: string
  httpBaseAliases?: readonly string[]
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

function isValidNpub(value: string): boolean {
  try {
    const decoded = nip19.decode(value)
    return decoded.type === "npub" && typeof decoded.data === "string"
  } catch {
    return false
  }
}

function normalizePubkey(value: string): string {
  const trimmed = String(value || "").trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  try {
    const decoded = nip19.decode(trimmed)
    return decoded.type === "npub" && typeof decoded.data === "string"
      ? decoded.data.toLowerCase()
      : ""
  } catch {
    return ""
  }
}

export function normalizeGraspServiceHttpBase(rawUrl: string): string {
  const url = parseUrl(rawUrl)
  if (!url) return ""
  if (url.protocol === "ws:") url.protocol = "http:"
  else if (url.protocol === "wss:") url.protocol = "https:"
  else if (url.protocol !== "http:" && url.protocol !== "https:") return ""
  if (url.username || url.password || url.search || url.hash) return ""
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${path}`
}

export function normalizeGraspServiceRelayUrl(rawUrl: string): string {
  const url = parseUrl(rawUrl)
  if (!url) return ""
  if (url.protocol === "http:") url.protocol = "ws:"
  else if (url.protocol === "https:") url.protocol = "wss:"
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") return ""
  if (url.username || url.password || url.search || url.hash) return ""
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host}${path}`
}

export function parseGraspRepoHttpUrl(rawUrl: string): ParsedGraspRepoHttpUrl | null {
  if (!rawUrl) return null

  const url = parseUrl(rawUrl)
  if (!url) return null

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null
  }
  if (url.search || url.hash) return null

  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return null

  const repoSegment = segments[segments.length - 1]
  const ownerSegment = segments[segments.length - 2]

  if (!repoSegment.endsWith(".git")) return null

  if (!isValidNpub(ownerSegment)) return null

  let identifier: string
  try {
    identifier = decodeURIComponent(repoSegment.slice(0, -4))
  } catch {
    return null
  }
  if (
    !identifier ||
    identifier === "." ||
    identifier === ".." ||
    identifier.includes("/") ||
    identifier.includes("\\") ||
    identifier.includes("\0")
  ) {
    return null
  }

  const prefix = segments.slice(0, -2).join("/")
  const httpBase = `${url.origin}${prefix ? `/${prefix}` : ""}`

  return {
    ownerNpub: ownerSegment,
    identifier,
    httpBase,
  }
}

export function isGraspRepoHttpUrl(rawUrl: string): boolean {
  return parseGraspRepoHttpUrl(rawUrl) !== null
}

export function findMatchingGraspRepoCloneUrl(
  cloneUrls: readonly string[],
  target: GraspRepoCloneTarget,
): {url: string; parsed: ParsedGraspRepoHttpUrl} | null {
  const ownerPubkey = normalizePubkey(target.ownerPubkey)
  if (!ownerPubkey || !target.identifier) return null

  const httpBases = new Set(
    [target.relayUrl, ...(target.httpBaseAliases || [])]
      .map(normalizeGraspServiceHttpBase)
      .filter(Boolean),
  )
  if (httpBases.size === 0) return null

  for (const rawUrl of cloneUrls) {
    const parsed = parseGraspRepoHttpUrl(rawUrl)
    if (!parsed) continue
    if (parsed.identifier !== target.identifier) continue
    if (normalizePubkey(parsed.ownerNpub) !== ownerPubkey) continue
    if (!httpBases.has(normalizeGraspServiceHttpBase(parsed.httpBase))) continue
    return {url: rawUrl, parsed}
  }

  return null
}

export function hasMatchingGraspRepoCloneUrl(
  cloneUrls: readonly string[],
  target: GraspRepoCloneTarget,
): boolean {
  return findMatchingGraspRepoCloneUrl(cloneUrls, target) !== null
}

export function isGraspRelayUrl(rawUrl: string): boolean {
  if (!rawUrl) return false
  const url = parseUrl(rawUrl)
  if (!url) return false

  return (
    (url.protocol === "ws:" || url.protocol === "wss:") &&
    (url.pathname === "" || url.pathname === "/")
  )
}

export function resolveCorsProxyForUrl(
  rawUrl: string,
  fallback?: string | null,
): string | null | undefined {
  if (isGraspRepoHttpUrl(rawUrl)) {
    return null
  }

  return fallback
}
