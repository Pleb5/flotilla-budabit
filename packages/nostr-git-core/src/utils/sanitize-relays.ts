// Read-time protection: validate and sanitize relay URLs coming from events or params
const isValidNostrRelayUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    if (!(u.protocol === "ws:" || u.protocol === "wss:")) return false
    if (isLikelyGitRemotePath(u.pathname)) return false
    const host = u.hostname.toLowerCase()
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true
    if (host === "container") return false
    if (isKnownGitPlatformHost(host)) return false
    return host.includes(".")
  } catch {
    return false
  }
}

function isKnownGitPlatformHost(host: string): boolean {
  const normalized = String(host || "").toLowerCase()
  return normalized === "github.com" || normalized === "gitlab.com" || normalized === "bitbucket.org"
}

function isLikelyGitRemotePath(pathname: string): boolean {
  const segments = String(pathname || "").split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1] || ""
  return segments.length >= 2 && /\.git$/i.test(lastSegment)
}

function isLikelyNonRelayInput(input: string): boolean {
  const raw = String(input || "").trim()
  if (!raw) return false

  let parsed: URL
  try {
    parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase()
  if (isLikelyGitRemotePath(parsed.pathname)) return true
  return isKnownGitPlatformHost(host)
}

function isOnionHost(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.toLowerCase()
  return h.endsWith(".onion") || h.includes(".onion:")
}

function pickPrefix(input: string, host: string | null): "ws://" | "wss://" {
  if (/^wss:\/\//i.test(input)) return "wss://"
  if (/^ws:\/\//i.test(input)) return "ws://"
  return isOnionHost(host) ? "ws://" : "wss://"
}

function collapsePathSlashes(pathname: string): string {
  // Keep leading slash, collapse duplicates elsewhere
  if (!pathname) return ""
  // Ensure leading slash if pathname exists and doesn't start with it
  const withLeading = pathname.startsWith("/") ? pathname : `/${pathname}`
  return withLeading.replace(/\/{2,}/g, "/")
}

export function normalizeRelayUrl(input: string): string {
  if (!input) return ""

  // Trim whitespace early
  const raw = input.trim()

  // For parsing via URL(), ensure we have a scheme. Use http as a temporary base.
  // We'll enforce ws/wss later.
  let tempForParse = raw
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(tempForParse)) {
    // If host looks like .onion, prefer ws as base to avoid defaulting to https
    tempForParse = (isOnionHost(tempForParse) ? "ws://" : "https://") + tempForParse
  }

  let u: URL
  try {
    u = new URL(tempForParse)
  } catch {
    // As a last resort, try with https:// prefix
    try {
      u = new URL("https://" + raw)
    } catch {
      return ""
    }
  }

  // Decide final ws/wss prefix
  const prefix = pickPrefix(raw, u.hostname)

  // Lowercase host
  const host = u.hostname.toLowerCase()

  // Preserve userinfo (welshman keeps authentication)
  const userinfo =
    u.username || u.password
      ? `${encodeURIComponent(u.username)}${u.password ? ":" + encodeURIComponent(u.password) : ""}@`
      : ""

  // Normalize port: remove default ports (80 for ws, 443 for wss)
  const isSecure = prefix === "wss://"
  const port =
    u.port && !((!isSecure && u.port === "80") || (isSecure && u.port === "443"))
      ? `:${u.port}`
      : ""

  // Normalize pathname: collapse duplicate slashes and remove trailing slashes
  // - If no pathname or just "/" -> empty string (no trailing slash)
  // - If pathname exists -> keep as-is (collapsed), remove trailing slash
  let pathname = collapsePathSlashes(u.pathname || "")
  if (pathname === "" || pathname === "/") {
    pathname = ""
  } else if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1)
  }

  // Strip hash, keep query
  const query = u.search || ""

  // Rebuild without original scheme
  // Note: For IPv6 hosts, URL preserves brackets in hostname internally; just use host as parsed (no brackets).
  // userinfo@host:port/path?query
  const authority = `${userinfo}${host}${port}`
  const out = `${prefix}${authority}${pathname}${query}`

  // Final small cleanup: no double slashes after authority (already handled by collapsePathSlashes)
  return out
}

export const sanitizeRelays = (urls: string[]): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const url of urls || []) {
    try {
      const raw = String(url || "").trim()
      if (isLikelyNonRelayInput(raw)) continue
      const normalized = normalizeRelayUrl(raw)
      if (isLikelyNonRelayInput(normalized)) continue
      if (!isValidNostrRelayUrl(normalized)) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      out.push(normalized)
    } catch {
      // skip
    }
  }
  return out
}
