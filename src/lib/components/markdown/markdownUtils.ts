/**
 * Utility functions for markdown processing
 */

/**
 * Shortens a URL for display purposes
 */
export function shortenUrl(url: string, text?: string): string {
  if (text && text !== url) {
    return text
  }

  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.replace("www.", "")
    const pathname = urlObj.pathname

    if (pathname && pathname !== "/") {
      const pathParts = pathname.split("/").filter(Boolean)
      if (pathParts.length > 0) {
        const firstPath = pathParts[0]
        if (firstPath.length > 20) {
          return `${domain}/${firstPath.substring(0, 15)}...`
        }
        return `${domain}/${firstPath}${pathParts.length > 1 ? "/..." : ""}`
      }
    }
    return domain
  } catch (e) {
    return url.length > 40 ? `${url.substring(0, 20)}...${url.substring(url.length - 15)}` : url
  }
}

/**
 * Shortens a Nostr URI for display purposes
 */
export function shortenNostrUri(tagType: string, content: string): string {
  const fullUri = `${tagType}${content}`
  return `${fullUri.slice(0, 8)}:${fullUri.slice(-8)}`
}

/**
 * Resolves a NIP-05 identifier to a pubkey
 */
export async function resolveNip05(identifier: string): Promise<string | null> {
  if (!identifier.includes("@")) {
    return null
  }

  try {
    const {nip05} = await import("nostr-tools")
    const profile = await nip05.queryProfile(identifier)
    return profile?.pubkey || null
  } catch (e) {
    console.error(`Failed to resolve NIP-05 ${identifier}:`, e)
    return null
  }
}

/**
 * Checks if a URL is a media URL
 */
export function isMediaUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico|mov|webm|mp4)(\?.*)?$/i.test(url)
}

/**
 * Checks if a link is a standalone URL (text matches URL)
 */
export function isStandaloneUrl(text: string | undefined, href: string): boolean {
  return !text || text === href || text.trim() === href.trim()
}

