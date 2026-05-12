const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

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
