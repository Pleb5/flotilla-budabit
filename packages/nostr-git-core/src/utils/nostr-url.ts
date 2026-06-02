/**
 * Nostr URL parsing and resolution utilities
 * Mirrors ngit's nostr_url.rs functionality for nostr:// URI support
 */

import { nip19 } from "nostr-tools"
import { resolveNip05Cached } from "./nip05.js"

export interface NostrUrlDecoded {
  originalString: string
  coordinate: {
    kind: number
    publicKey: string
    identifier: string
    relays?: string[]
  }
  protocol?: ServerProtocol
  user?: string
  nip05?: string
}

export enum ServerProtocol {
  SSH = "ssh",
  HTTPS = "https", 
  HTTP = "http",
  GIT = "git",
  FTP = "ftp",
  FILESYSTEM = "filesystem",
  UNSPECIFIED = "unspecified",
  UNAUTH_HTTPS = "https (unauthenticated)",
  UNAUTH_HTTP = "http (unauthenticated)",
}

export interface CloneUrl {
  url: string
  protocol: ServerProtocol
  user?: string
}

/**
 * Parse and resolve a nostr:// URL
 * Supports formats like:
 * - nostr://npub1.../repo-name
 * - nostr://ssh/npub1.../relay.damus.io/repo-name  
 * - nostr://https/npub1.../repo-name
 * - nostr://naddr1... (naddr format)
 */
export async function parseAndResolveNostrUrl(
  url: string,
  gitRepo?: any
): Promise<NostrUrlDecoded> {
  if (!url.startsWith("nostr://")) {
    throw new Error("nostr git url must start with nostr://")
  }

  const urlObj = new URL(url)
  const queryParams = new URLSearchParams(urlObj.search)
  
  // Parse query parameters
  let protocol: ServerProtocol | undefined
  let user: string | undefined
  let relays: string[] = []
  let nip05: string | undefined

  queryParams.forEach((value, name) => {
    if (name.includes("relay")) {
      let decoded = decodeURIComponent(value)
      if (!decoded.startsWith("ws://") && !decoded.startsWith("wss://")) {
        decoded = `wss://${decoded}`
      }
      relays.push(decoded)
    } else if (name === "protocol") {
      protocol = parseServerProtocol(value)
    } else if (name === "user") {
      user = value
    }
  })

  // Parse path components
  const pathParts = urlObj.pathname.split("/").filter(Boolean)
  
  // Extract protocol from path if not in query params
  if (!protocol && pathParts.length > 0) {
    const firstPart = pathParts[0]
    if (firstPart.includes(".")) {
      // This is likely a domain, not a protocol
    } else if (firstPart.includes("@")) {
      const atIndex = firstPart.indexOf("@")
      user = firstPart.substring(0, atIndex)
      const protocolStr = firstPart.substring(atIndex + 1)
      protocol = parseServerProtocol(protocolStr)
      pathParts.shift()
    } else {
      protocol = parseServerProtocol(firstPart)
      if (protocol) {
        pathParts.shift()
      }
    }
  }

  // Parse coordinate (naddr or npub/identifier)
  if (pathParts.length === 0) {
    throw new Error("incorrect nostr git url format. try nostr://naddr123 or nostr://npub123/my-repo")
  }

  const firstPart = pathParts[0]
  let coordinate: NostrUrlDecoded["coordinate"]

  try {
    // Try parsing as naddr first
    const decoded = nip19.decode(firstPart)
    if (decoded.type === "naddr" && decoded.data.kind === 30617) {
      coordinate = {
        kind: decoded.data.kind,
        publicKey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays
      }
    } else {
      throw new Error("naddr doesn't point to a git repository announcement")
    }
  } catch {
    // Parse as npub/identifier format
    const npubOrNip05 = firstPart
    pathParts.shift()
    
    if (pathParts.length === 0) {
      throw new Error("nostr url must have an identifier eg. nostr://npub123/repo-identifier")
    }
    
    const identifier = pathParts.pop()!
    
    // Parse relays from remaining path parts
    for (const relay of pathParts) {
      let decoded = decodeURIComponent(relay)
      if (!decoded.startsWith("ws://") && !decoded.startsWith("wss://")) {
        decoded = `wss://${decoded}`
      }
      relays.push(decoded)
    }

    let publicKey: string
    try {
      const decoded = nip19.decode(npubOrNip05)
      if (decoded.type === "npub") {
        publicKey = decoded.data as string
      } else {
        throw new Error("Invalid npub format")
      }
    } catch {
      // Handle NIP-05
      nip05 = npubOrNip05
      try {
        publicKey = await resolveNip05Cached(npubOrNip05)
      } catch (err) {
        throw new Error(`Failed to resolve NIP-05 identifier ${npubOrNip05}: ${(err as Error).message}`)
      }
    }

    coordinate = {
      kind: 30617, // GitRepoAnnouncement
      publicKey,
      identifier,
      relays: relays.length > 0 ? relays : undefined
    }
  }

  return {
    originalString: url,
    coordinate,
    protocol,
    user,
    nip05
  }
}

/**
 * Format a NostrUrlDecoded as a specific protocol URL
 */
export function formatAsProtocol(
  decoded: NostrUrlDecoded,
  protocol: ServerProtocol,
  user?: string
): string {
  const { coordinate } = decoded
  
  // For now, we'll use a simple format
  // In a full implementation, this would query the repository announcement
  // to get the actual clone URLs and format them according to the protocol
  
  if (protocol === ServerProtocol.SSH) {
    return `ssh://${user || "git"}@relay.example.com/${coordinate.publicKey}/${coordinate.identifier}.git`
  } else if (protocol === ServerProtocol.HTTPS) {
    return `https://relay.example.com/${coordinate.publicKey}/${coordinate.identifier}.git`
  } else if (protocol === ServerProtocol.HTTP) {
    return `http://relay.example.com/${coordinate.publicKey}/${coordinate.identifier}.git`
  } else {
    return `https://relay.example.com/${coordinate.publicKey}/${coordinate.identifier}.git`
  }
}

/**
 * Convert a clone URL to HTTPS format
 */
export function convertCloneUrlToHttps(url: string): string {
  if (url.startsWith("ssh://")) {
    return url.replace("ssh://", "https://").replace(/@.*?\./, ".")
  } else if (url.startsWith("git@")) {
    return url.replace("git@", "https://").replace(":", "/").replace(/\.git$/, ".git")
  }
  return url
}

/**
 * Get domain from a NostrUrlDecoded
 */
export function getDomain(decoded: NostrUrlDecoded): string {
  if (decoded.nip05) {
    const parts = decoded.nip05.split("@")
    return parts.length === 2 ? parts[1] : parts[0]
  }
  return "relay.example.com" // Default fallback
}

/**
 * Get short name from a NostrUrlDecoded
 */
export function getShortName(decoded: NostrUrlDecoded): string {
  return decoded.coordinate.identifier
}

function parseServerProtocol(protocolStr: string): ServerProtocol | undefined {
  switch (protocolStr.toLowerCase()) {
    case "ssh": return ServerProtocol.SSH
    case "https": return ServerProtocol.HTTPS
    case "http": return ServerProtocol.HTTP
    case "git": return ServerProtocol.GIT
    case "ftp": return ServerProtocol.FTP
    case "filesystem": return ServerProtocol.FILESYSTEM
    case "https (unauthenticated)": return ServerProtocol.UNAUTH_HTTPS
    case "http (unauthenticated)": return ServerProtocol.UNAUTH_HTTP
    default: return undefined
  }
}