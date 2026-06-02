/**
 * NIP-05 resolution utilities
 * Mirrors ngit's NIP-05 handling for resolving usernames to public keys
 */

export interface Nip05Response {
  names: Record<string, string>
  relays?: Record<string, string[]>
}

/**
 * Resolve a NIP-05 identifier to a public key
 * @param identifier - The NIP-05 identifier (e.g., "alice@example.com")
 * @returns Promise resolving to the public key hex string
 */
export async function resolveNip05(identifier: string): Promise<string> {
  if (!identifier.includes("@")) {
    throw new Error("NIP-05 identifier must contain @ symbol")
  }

  const [localPart, domain] = identifier.split("@")
  const wellKnownUrl = `https://${domain}/.well-known/nostr.json`

  try {
    const response = await fetch(wellKnownUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data: Nip05Response = await response.json()
    
    if (!data.names || typeof data.names !== "object") {
      throw new Error("Invalid NIP-05 response: missing names object")
    }

    const publicKey = data.names[localPart]
    if (!publicKey) {
      throw new Error(`No public key found for ${identifier}`)
    }

    return publicKey
  } catch (error) {
    throw new Error(`Failed to resolve NIP-05 identifier ${identifier}: ${(error as Error).message}`)
  }
}

/**
 * Cache for NIP-05 resolutions to avoid repeated lookups
 */
class Nip05Cache {
  private cache = new Map<string, {publicKey: string; timestamp: number}>()
  private readonly TTL = 24 * 60 * 60 * 1000 // 24 hours

  get(identifier: string): string | null {
    const cached = this.cache.get(identifier)
    if (!cached) return null
    
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(identifier)
      return null
    }
    
    return cached.publicKey
  }

  set(identifier: string, publicKey: string): void {
    this.cache.set(identifier, {
      publicKey,
      timestamp: Date.now()
    })
  }
}

export const nip05Cache = new Nip05Cache()

/**
 * Resolve NIP-05 with caching
 */
export async function resolveNip05Cached(identifier: string): Promise<string> {
  const cached = nip05Cache.get(identifier)
  if (cached) return cached

  const publicKey = await resolveNip05(identifier)
  nip05Cache.set(identifier, publicKey)
  return publicKey
}