/**
 * NostrGitProvider Factory
 *
 * Factory for creating NostrGitProvider instances with proper configuration.
 * Handles provider selection logic and dependency injection.
 *
 * Based on ngit's client.rs factory patterns and configuration management.
 */

import type {EventIO} from "../../types/index.js"
import type {NostrEvent} from "nostr-tools"
import {loadConfig} from "../../git/config.js"
import {createGitProvider} from "../../git/factory.js"
import {createNip98HttpClient} from "../../git/nip98-http-client.js"
import httpWeb from "isomorphic-git/http/web"
import {isGraspRepoHttpUrl} from "../../utils/grasp-url.js"

import {NostrGitProvider, type NostrGitConfig} from "./nostr-git-provider.js"
import {GraspApi, type GraspApiConfig} from "./grasp-api.js"

/**
 * Factory configuration options
 */
export interface NostrGitFactoryOptions {
  /** Clean Event I/O interface - no more signer passing! */
  eventIO: EventIO
  /** Default relay URLs */
  defaultRelays?: string[]
  /** Fallback relay URLs */
  fallbackRelays?: string[]
  /** GRASP relay URLs */
  graspRelays?: string[]
  /** Whether to enable GRASP integration */
  enableGrasp?: boolean
  /** Whether to publish repo state by default */
  publishRepoState?: boolean
  /** Whether to publish repo announcements by default */
  publishRepoAnnouncements?: boolean
  /** CORS proxy URL for HTTP operations */
  corsProxy?: string
  /** Default timeout for operations */
  timeoutMs?: number
}

/**
 * Default relay configuration
 * Based on ngit's default relay sets
 */
export const DEFAULT_RELAYS = {
  default: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
  fallback: ["wss://purplerelay.com", "wss://purplepages.es", "wss://relayable.org"],
  grasp: ["wss://relay.ngit.dev", "wss://gitnostr.com"],
}

/**
 * Create a NostrGitProvider instance
 *
 * This factory method creates a properly configured NostrGitProvider
 * with GRASP integration and multi-relay support.
 */
export function createNostrGitProvider(options: NostrGitFactoryOptions): NostrGitProvider {
  const {
    eventIO,
    defaultRelays = DEFAULT_RELAYS.default,
    fallbackRelays = DEFAULT_RELAYS.fallback,
    graspRelays = DEFAULT_RELAYS.grasp,
    enableGrasp = true,
    publishRepoState = true,
    publishRepoAnnouncements = false,
    corsProxy,
    timeoutMs = 10000,
  } = options

  // Create GRASP API if enabled
  let graspApi
  if (enableGrasp) {
    const graspConfig: GraspApiConfig = {
      relays: graspRelays,
      timeoutMs,
      publishEvent: (event: NostrEvent) => {
        return eventIO.publishEvent(event)
      },
    }
    graspApi = new GraspApi(graspConfig)
  }

  // Create NIP-98 aware HTTP client for GRASP authentication
  const nip98Http = createNip98HttpClient(httpWeb, eventIO)

  // Create a GitProvider with NIP-98 HTTP client (skip singleton to get isolated instance)
  const gitProvider = createGitProvider({
    http: nip98Http,
    skipSingleton: true,
    defaultCorsProxy: corsProxy ?? null, // Disable CORS proxy for GRASP URLs
  })

  // Create NostrGitProvider configuration
  const config: NostrGitConfig = {
    eventIO,
    grasp: graspApi,
    defaultRelays,
    fallbackRelays,
    graspRelays,
    publishRepoState,
    publishRepoAnnouncements,
    httpOverrides: corsProxy ? {corsProxy} : undefined,
    gitProvider, // Use the NIP-98 aware GitProvider
  }

  return new NostrGitProvider(config)
}

/**
 * Create a NostrGitProvider with environment-based configuration
 *
 * Reads configuration from environment variables and git config.
 * Mirrors ngit's configuration loading behavior.
 */
export async function createNostrGitProviderFromEnv(options: {
  eventIO: EventIO
}): Promise<NostrGitProvider> {
  const {eventIO} = options

  const gitConfig = loadConfig()

  // Read configuration from environment variables (browser-safe)
  const env = typeof process !== "undefined" && process.env ? process.env : {}
  const defaultRelays = env.NOSTR_DEFAULT_RELAYS?.split(";") || DEFAULT_RELAYS.default
  const fallbackRelays = env.NOSTR_FALLBACK_RELAYS?.split(";") || DEFAULT_RELAYS.fallback
  const graspRelays = env.NOSTR_GRASP_RELAYS?.split(";") || DEFAULT_RELAYS.grasp
  const enableGrasp = env.NOSTR_ENABLE_GRASP !== "false"
  const publishRepoState = env.NOSTR_PUBLISH_REPO_STATE !== "false"
  const publishRepoAnnouncements = env.NOSTR_PUBLISH_REPO_ANNOUNCEMENTS === "true"
  const corsProxy = gitConfig.defaultCorsProxy ?? undefined

  return createNostrGitProvider({
    eventIO,
    defaultRelays,
    fallbackRelays,
    graspRelays,
    enableGrasp,
    publishRepoState,
    publishRepoAnnouncements,
    corsProxy,
  })
}

/**
 * Create a NostrGitProvider with git config integration
 *
 * Reads configuration from git config settings.
 * Based on ngit's git config integration.
 */
export async function createNostrGitProviderFromGitConfig(options: {
  eventIO: EventIO
  gitDir?: string
}): Promise<NostrGitProvider> {
  const {eventIO, gitDir} = options

  const gitConfig = loadConfig()

  // Default configuration
  let config = {
    defaultRelays: DEFAULT_RELAYS.default,
    fallbackRelays: DEFAULT_RELAYS.fallback,
    graspRelays: DEFAULT_RELAYS.grasp,
    enableGrasp: true,
    publishRepoState: true,
    publishRepoAnnouncements: false,
    corsProxy: gitConfig.defaultCorsProxy ?? undefined,
  }

  // Try to read from git config if available
  try {
    // Note: In a real implementation, this would use git config commands
    // For now, we'll use environment variables as fallback
    const gitConfigRelays = process.env.GIT_CONFIG_NOSTR_RELAYS?.split(";")
    if (gitConfigRelays && gitConfigRelays.length > 0) {
      config.defaultRelays = gitConfigRelays
    }

    const gitConfigGrasp = process.env.GIT_CONFIG_NOSTR_GRASP
    if (gitConfigGrasp !== undefined) {
      config.enableGrasp = gitConfigGrasp === "true"
    }

    const gitConfigPublishState = process.env.GIT_CONFIG_NOSTR_PUBLISH_STATE
    if (gitConfigPublishState !== undefined) {
      config.publishRepoState = gitConfigPublishState === "true"
    }
  } catch (error) {
    console.warn("Failed to read git config, using defaults:", error)
  }

  return createNostrGitProvider({
    eventIO,
    ...config,
  })
}

/**
 * Provider selection logic
 *
 * Determines which provider to use based on repository URL and configuration.
 * Supports both traditional Git providers and Nostr-based providers.
 */
export function selectProvider(
  url: string,
  options: {
    preferNostr?: boolean
    enableGrasp?: boolean
  } = {},
): "nostr" | "traditional" {
  const {preferNostr = false, enableGrasp = true} = options

  // Check if URL is a nostr:// URL
  if (url.startsWith("nostr://")) {
    return "nostr"
  }

  // Check if URL matches GRASP Smart HTTP path shape
  if (enableGrasp && isGraspRepoHttpUrl(url)) {
    return "nostr"
  }

  // Use preference or default to traditional
  return preferNostr ? "nostr" : "traditional"
}

/**
 * Create provider based on URL analysis
 *
 * Automatically selects and creates the appropriate provider
 * based on the repository URL.
 */
export function createProviderForUrl(
  url: string,
  options: {
    eventIO: EventIO
    preferNostr?: boolean
    enableGrasp?: boolean
  },
): NostrGitProvider | null {
  const providerType = selectProvider(url, {
    preferNostr: options.preferNostr,
    enableGrasp: options.enableGrasp,
  })

  if (providerType === "nostr") {
    return createNostrGitProvider({
      eventIO: options.eventIO,
      enableGrasp: options.enableGrasp ?? true,
    })
  }

  return null
}
