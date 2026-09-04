import type {GitVendor} from "./vendor-providers.js"

/** Static provider policy. Change these constants to re-enable retained implementations. */
export const ENABLE_BITBUCKET_PROVIDER = false
export const ENABLE_DIRECT_NOSTR_GIT_PROVIDER = false

export function isGitVendorEnabled(provider: GitVendor): boolean {
  if (provider === "bitbucket") return ENABLE_BITBUCKET_PROVIDER
  return true
}

export function assertGitVendorEnabled(provider: GitVendor, operation?: string): void {
  if (isGitVendorEnabled(provider)) return

  const operationSuffix = operation ? ` for ${operation}` : ""
  throw new Error(`Bitbucket provider is disabled${operationSuffix}`)
}

export function assertDirectNostrGitProviderEnabled(operation?: string): void {
  if (ENABLE_DIRECT_NOSTR_GIT_PROVIDER) return

  const operationSuffix = operation ? ` for ${operation}` : ""
  throw new Error(`Direct NostrGitProvider is disabled${operationSuffix}`)
}
