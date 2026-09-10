const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"])

// Explicit deployment redirects, not substring/suffix matches against arbitrary hosts.
const BLOSSOM_REDIRECT_ORIGINS = new Set(["https://r2a.primal.net"])
export const isAllowedExtensionOrigin = (entrypointOrigin: string, origin: string): boolean =>
  origin === entrypointOrigin ||
  (entrypointOrigin === "https://blossom.primal.net" && BLOSSOM_REDIRECT_ORIGINS.has(origin))

// No top navigation, popup sandbox escape, camera or microphone delegation.
export const REPO_TAB_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"

export const SECURE_EMBED_URL_REQUIREMENT = "Use HTTPS, or localhost HTTP for development."

export const isLocalHttpUrl = (url: URL): boolean => LOCAL_HTTP_HOSTS.has(url.hostname)

export const isSecureEmbeddableUrl = (value: string | null | undefined): value is string => {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && isLocalHttpUrl(url))
  } catch {
    return false
  }
}

export const assertSecureEmbeddableUrl = (value: string, label: string): void => {
  if (!isSecureEmbeddableUrl(value)) {
    throw new Error(`${label} must use a secure URL. ${SECURE_EMBED_URL_REQUIREMENT}`)
  }
}
