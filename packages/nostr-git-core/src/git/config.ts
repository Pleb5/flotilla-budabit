export type CacheMode = "off" | "per-session" | "per-repo-batch"

export interface GitConfig {
  compatMode: boolean
  cacheMode: CacheMode
  cacheMaxAgeMs: number
  defaultCorsProxy?: string | null
}

const defaultConfig: GitConfig = {
  compatMode: false,
  cacheMode: "per-session",
  cacheMaxAgeMs: 60_000, // 60s idle TTL by default
}

let defaultCorsProxyOverride: string | null | undefined

export function setDefaultCorsProxyOverride(value?: string | null): void {
  defaultCorsProxyOverride = value
}

export function getDefaultCorsProxyOverride(): string | null | undefined {
  return defaultCorsProxyOverride
}

export function loadConfig(overrides?: Partial<GitConfig>): GitConfig {
  const env =
    typeof process !== "undefined" && (process as any).env ? (process as any).env : ({} as any)

  const compatMode = Boolean(
    overrides?.compatMode ?? (env.LIBGIT2_COMPAT === "true" || env.LIBGIT2_COMPAT === "1"),
  )

  const cacheMode =
    (overrides?.cacheMode ?? (env.GIT_CACHE_MODE as CacheMode)) || defaultConfig.cacheMode

  const cacheMaxAgeMs =
    overrides?.cacheMaxAgeMs ??
    (env.GIT_CACHE_TTL_MS ? Number(env.GIT_CACHE_TTL_MS) : defaultConfig.cacheMaxAgeMs)

  // New: read default CORS proxy configuration
  const hasDefaultCorsProxyOverride =
    overrides && Object.prototype.hasOwnProperty.call(overrides, "defaultCorsProxy")
  const overrideValue = hasDefaultCorsProxyOverride
    ? overrides!.defaultCorsProxy
    : defaultCorsProxyOverride
  let defaultCorsProxy: string | null | undefined
  if (overrideValue !== undefined) {
    defaultCorsProxy = overrideValue ?? null
  } else {
    const defaultCorsProxyEnv = env.GIT_DEFAULT_CORS_PROXY
    defaultCorsProxy =
      defaultCorsProxyEnv === "none"
        ? null
        : (defaultCorsProxyEnv ?? "https://cors.isomorphic-git.org")
  }

  return {compatMode, cacheMode, cacheMaxAgeMs, defaultCorsProxy}
}
