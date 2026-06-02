import type {
  VendorProvider,
  GitVendor,
  CreateRepoOptions,
  UpdateRepoOptions,
} from "./vendor-providers.js"
import {detectVendorFromUrl, extractHostname} from "./vendor-providers.js"
import type {GitForkOptions, RepoMetadata} from "../api/api.js"
import {normalizeHttpOrigin} from "../api/providers/grasp-capabilities.js"
import {getGitServiceApi} from "./provider-factory.js"
import {toNpub} from "../utils/nostr-pubkey.js"

// Registry of vendor providers
const providerRegistry = new Map<string, VendorProvider>()

// Provider overrides for custom hostnames (useful for testing/enterprise)
const providerOverrides = new Map<string, GitVendor>()

class RestVendorProvider implements VendorProvider {
  readonly vendor: GitVendor
  readonly hostname: string
  private readonly originalUrl: string

  constructor(vendor: GitVendor, url: string) {
    this.vendor = vendor
    this.originalUrl = url
    const host = extractHostname(url)
    this.hostname = host ? host.toLowerCase() : url
  }

  private baseUrl(): string | undefined {
    switch (this.vendor) {
      case "github":
        return this.hostname === "github.com" ? undefined : `https://${this.hostname}/api/v3`
      case "gitlab":
        return `https://${this.hostname}/api/v4`
      case "gitea":
        return `https://${this.hostname}/api/v1`
      case "bitbucket":
        return this.hostname === "bitbucket.org" ? undefined : `https://${this.hostname}/api/2.0`
      case "grasp":
        return this.originalUrl.startsWith("ws") ? this.originalUrl : `wss://${this.hostname}`
      case "grasp-rest":
        return normalizeHttpOrigin(this.originalUrl)
      default:
        return undefined
    }
  }

  private createApi(token: string = "") {
    const baseUrl = this.baseUrl()
    return getGitServiceApi(this.vendor, token, baseUrl)
  }

  getRepoMetadata(owner: string, repo: string, token?: string): Promise<RepoMetadata> {
    return this.createApi(token).getRepo(owner, repo)
  }

  createRepo(name: string, options: CreateRepoOptions, token: string): Promise<RepoMetadata> {
    const api = this.createApi(token)
    return api.createRepo({
      name,
      description: options.description,
      private: options.isPrivate,
      autoInit: options.autoInit,
    })
  }

  updateRepo(
    owner: string,
    repo: string,
    options: UpdateRepoOptions,
    token: string,
  ): Promise<RepoMetadata> {
    const api = this.createApi(token)
    return api.updateRepo(owner, repo, {
      name: options.name,
      description: options.description,
      private: options.isPrivate,
    })
  }

  deleteRepo(owner: string, repo: string, token: string): Promise<void> {
    const api = this.createApi(token)
    return api.deleteRepo(owner, repo)
  }

  forkRepo(owner: string, repo: string, forkName: string, token: string): Promise<RepoMetadata> {
    const api = this.createApi(token)
    const forkOptions: GitForkOptions = forkName ? {name: forkName} : {}
    return api.forkRepo(owner, repo, forkOptions)
  }

  getCloneUrl(owner: string, repo: string): string {
    if (this.vendor === "grasp" || this.vendor === "grasp-rest") {
      const base = normalizeHttpOrigin(this.originalUrl).replace(/\/$/, "")
      const ownerSegment = (() => {
        try {
          return toNpub(owner)
        } catch {
          return owner
        }
      })()
      return `${base}/${ownerSegment}/${repo}.git`
    }
    return `https://${this.hostname}/${owner}/${repo}.git`
  }

  getApiUrl(path: string): string {
    const base = this.baseUrl()
    if (!base) {
      switch (this.vendor) {
        case "github":
          return `https://api.github.com${path}`
        case "bitbucket":
          return `https://api.bitbucket.org/2.0${path}`
        default:
          return `https://${this.hostname}${path}`
      }
    }
    return `${base.replace(/\/$/, "")}${path}`
  }

  parseRepoUrl(url: string): {owner: string; repo: string} | null {
    const parsed = this.toUrl(url)
    if (!parsed) return null
    let pathname = parsed.pathname.replace(/^\/+/, "")
    if (!pathname) return null
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const repoRaw = parts.pop()!
    const owner =
      this.vendor === "gitlab" || this.vendor === "gitea" ? parts.join("/") : parts.pop()!
    const repo = repoRaw.replace(/\.git$/, "")
    return {owner, repo}
  }

  getTokenKey(): string {
    return `${this.vendor}:${this.hostname}`
  }

  getAuthHeaders(token: string): Record<string, string> {
    switch (this.vendor) {
      case "github":
        return {Authorization: `token ${token}`}
      case "gitlab":
      case "gitea":
        return {Authorization: `Bearer ${token}`}
      case "bitbucket":
        return {Authorization: `Bearer ${token}`}
      default:
        return token ? {Authorization: token} : {}
    }
  }

  private toUrl(value: string): URL | null {
    try {
      return new URL(value)
    } catch {
      if (value.startsWith("git@")) {
        const normalized = value.replace(/^git@([^:]+):(.+)$/, "ssh://$1/$2")
        try {
          return new URL(normalized)
        } catch {
          return null
        }
      }
      if (!value.includes("://")) {
        try {
          return new URL(`https://${value}`)
        } catch {
          return null
        }
      }
      return null
    }
  }
}

/**
 * Register a custom provider override for a hostname
 * Useful for enterprise installations or testing
 */
export function registerProviderOverride(hostname: string, vendor: GitVendor): void {
  providerOverrides.set(hostname.toLowerCase(), vendor)
}

/**
 * Clear all provider overrides
 */
export function clearProviderOverrides(): void {
  providerOverrides.clear()
}

/**
 * Get or create a vendor provider for the given URL
 */
export function resolveVendorProvider(url: string): VendorProvider {
  const hostname = extractHostname(url).toLowerCase()

  // Check if we already have a provider for this hostname
  if (providerRegistry.has(hostname)) {
    return providerRegistry.get(hostname)!
  }

  // Check for provider overrides first
  const overrideVendor = providerOverrides.get(hostname)
  const vendor = overrideVendor || detectVendorFromUrl(url)

  const provider = new RestVendorProvider(vendor, url)

  // Cache the provider
  providerRegistry.set(hostname, provider)

  return provider
}

/**
 * Get vendor provider for a specific vendor type and hostname
 */
export function getVendorProvider(vendor: GitVendor, hostname: string): VendorProvider {
  const key = `${vendor}:${hostname.toLowerCase()}`

  if (providerRegistry.has(key)) {
    return providerRegistry.get(key)!
  }

  const defaultUrl =
    vendor === "grasp" || vendor === "grasp-rest" ? `wss://${hostname}` : `https://${hostname}`
  const provider = new RestVendorProvider(vendor, defaultUrl)

  providerRegistry.set(key, provider)
  return provider
}

/**
 * Parse repository information from URL using the appropriate vendor provider
 */
export function parseRepoFromUrl(url: string): {
  provider: VendorProvider
  owner: string
  repo: string
} | null {
  const provider = resolveVendorProvider(url)
  const parsed = provider.parseRepoUrl(url)

  if (!parsed) {
    return null
  }

  return {
    provider,
    owner: parsed.owner,
    repo: parsed.repo,
  }
}

/**
 * Clear the provider registry (useful for testing)
 */
export function clearProviderRegistry(): void {
  providerRegistry.clear()
}
