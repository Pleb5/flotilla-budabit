import {nip19} from "nostr-tools"

export interface ParsedGraspRepoHttpUrl {
  ownerNpub: string
  identifier: string
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

export function parseGraspRepoHttpUrl(rawUrl: string): ParsedGraspRepoHttpUrl | null {
  if (!rawUrl) return null

  const url = parseUrl(rawUrl)
  if (!url) return null

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(part => decodeURIComponent(part))
  if (segments.length < 2) return null

  const repoSegment = segments[segments.length - 1]
  const ownerSegment = segments[segments.length - 2]

  if (!repoSegment.endsWith(".git")) return null

  const identifier = repoSegment.slice(0, -4)
  if (!identifier) return null

  if (!isValidNpub(ownerSegment)) return null

  return {
    ownerNpub: ownerSegment,
    identifier,
  }
}

export function isGraspRepoHttpUrl(rawUrl: string): boolean {
  return parseGraspRepoHttpUrl(rawUrl) !== null
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
