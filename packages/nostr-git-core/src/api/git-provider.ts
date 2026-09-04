import type {GitProvider} from "../git/provider.js"
import {createGitProvider as getBaseGitProvider} from "../git/factory.js"
import {MultiVendorGitProvider} from "../git/multi-vendor-git-provider.js"
import {NostrGitProvider} from "./providers/nostr-git-provider.js"
import {createNostrGitProviderFromEnv} from "./providers/nostr-git-factory.js"
import type {EventIO} from "../types/index.js"
import {isGraspRepoHttpUrl} from "../utils/grasp-url.js"
import {
  ENABLE_DIRECT_NOSTR_GIT_PROVIDER,
  assertDirectNostrGitProviderEnabled,
} from "../git/provider-policy.js"

// Create the multi-vendor GitProvider instance using git-wrapper factory
let gitProvider: GitProvider = new MultiVendorGitProvider({
  baseProvider: getBaseGitProvider(),
})

// NostrGitProvider instance for Nostr-based operations
let nostrGitProvider: NostrGitProvider | null = null
let nostrGitProviderGeneration = 0

/**
 * Set a custom GitProvider instance
 */
export function setGitProvider(provider: GitProvider) {
  gitProvider = provider
}

/**
 * Get the current GitProvider instance
 */
export function getGitProvider(): GitProvider {
  return gitProvider
}

/**
 * Get the multi-vendor GitProvider instance (with vendor-specific methods)
 * Use this when you need access to vendor-specific operations like getRepoMetadata, forkRemoteRepo, etc.
 */
export function getMultiVendorGitProvider(): MultiVendorGitProvider {
  if (gitProvider instanceof MultiVendorGitProvider) {
    return gitProvider
  }
  throw new Error("Current GitProvider is not a MultiVendorGitProvider instance")
}

/**
 * Configure authentication tokens for the multi-vendor GitProvider
 */
export function setGitTokens(tokens: Array<{host: string; token: string}>) {
  const multiVendorProvider = getMultiVendorGitProvider()
  multiVendorProvider.setTokens(tokens)
}

/**
 * Initialize NostrGitProvider with EventIO - CLEAN VERSION
 *
 * This sets up the NostrGitProvider for Nostr-based Git operations.
 * Must be called before using any Nostr-specific functionality.
 */
export async function initializeNostrGitProvider(options: {
  eventIO: EventIO
}): Promise<NostrGitProvider> {
  assertDirectNostrGitProviderEnabled("initialization")
  const generation = ++nostrGitProviderGeneration
  nostrGitProvider = null
  const provider = await createNostrGitProviderFromEnv(options)
  if (generation === nostrGitProviderGeneration) nostrGitProvider = provider
  return provider
}

/**
 * Get the NostrGitProvider instance
 *
 * Returns the configured NostrGitProvider or throws an error if not initialized.
 */
export function getNostrGitProvider(): NostrGitProvider {
  assertDirectNostrGitProviderEnabled("provider access")
  if (!nostrGitProvider) {
    throw new Error("NostrGitProvider not initialized. Call initializeNostrGitProvider() first.")
  }
  return nostrGitProvider
}

/**
 * Check if NostrGitProvider is available
 */
export function hasNostrGitProvider(): boolean {
  return ENABLE_DIRECT_NOSTR_GIT_PROVIDER && nostrGitProvider !== null
}

/**
 * Get the appropriate GitProvider based on URL
 *
 * Automatically selects between traditional Git providers and NostrGitProvider
 * based on the repository URL.
 */
export function getProviderForUrl(url: string): GitProvider {
  const isNostrUrl = /^nostr:(?:\/\/)?/i.test(url)
  if (isNostrUrl) {
    assertDirectNostrGitProviderEnabled("Nostr URL routing")
  }

  // GRASP Smart HTTP uses the ordinary Git provider while the direct provider is disabled.
  if (isGraspRepoHttpUrl(url) && !ENABLE_DIRECT_NOSTR_GIT_PROVIDER) {
    return gitProvider
  }

  if (isNostrUrl || isGraspRepoHttpUrl(url)) {
    if (!nostrGitProvider) {
      throw new Error("NostrGitProvider not initialized for Nostr-based repository")
    }
    // Return the underlying GitProvider from NostrGitProvider
    return nostrGitProvider.getGitProvider()
  }

  // Use traditional provider for other URLs
  return gitProvider
}
