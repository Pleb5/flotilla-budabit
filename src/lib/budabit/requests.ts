import { GIT_REPO_BOOKMARK_SET, GRASP_SET_KIND, GIT_REPO_BOOKMARK_DTAG, DEFAULT_GRASP_SET_ID, validateGraspServerUrl } from "@nostr-git/core/events"
import { tokens, type Token, bookmarksStore } from "@nostr-git/ui"
import { graspServersStore } from "@nostr-git/ui"
import { repository, pubkey, signer, ensurePlaintext } from "@welshman/app"
import { load } from "@welshman/net"
import { deriveEventsAsc, deriveEventsById } from "@welshman/store"
import { NAMED_BOOKMARKS, APP_DATA, getAddressTags, normalizeRelayUrl, type TrustedEvent } from "@welshman/util"
import { get } from "svelte/store"

// D-tag for git authentication tokens (intentionally not obvious)
export const GIT_AUTH_DTAG = "app/budabit/tokens"


export const loadRepositories = async (pubkey: string, relays: string[] = []) => {
    // Load both the named bookmark list and any legacy/set variants
    load({
        relays,
        filters: [
          { kinds: [NAMED_BOOKMARKS], authors: [pubkey], "#d": [GIT_REPO_BOOKMARK_DTAG] },
          { kinds: [GIT_REPO_BOOKMARK_SET], authors: [pubkey] },
        ]
    })
}

export const loadGraspServers = async (pubkey: string, relays: string[] = []) => {
    load({
        relays,
        filters: [{ kinds: [GRASP_SET_KIND], authors: [pubkey], "#d": [DEFAULT_GRASP_SET_ID] }]
    })
}

export const loadTokens = async (pk: string, relays: string[] = []) => {
    // Load encrypted git tokens from relays
    load({
        relays,
        filters: [{ kinds: [APP_DATA], authors: [pk], "#d": [GIT_AUTH_DTAG] }]
    })
}

// --- Bookmarks sync (centralized) ---
let bookmarksUnsub: (() => void) | undefined

export function setupBookmarksSync(pubkey: string, relays: string[] = []) {
  try { bookmarksUnsub?.() } catch {}

  console.log("[setupBookmarksSync] Setting up for pubkey:", pubkey, "relays:", relays)

  // Query for both new format (with d-tag) and legacy format (without d-tag)
  const filters: any[] = [
    { kinds: [NAMED_BOOKMARKS], authors: [pubkey], "#d": [GIT_REPO_BOOKMARK_DTAG] },
    { kinds: [GIT_REPO_BOOKMARK_SET], authors: [pubkey] },
  ]
  console.log("[setupBookmarksSync] Filters:", JSON.stringify(filters))
  
  const store = deriveEventsAsc(deriveEventsById({repository, filters}))

  bookmarksUnsub = store.subscribe((events: any[]) => {
    console.log("[setupBookmarksSync] Store subscription fired, events count:", events?.length || 0)
    
    if (!events || events.length === 0) {
      console.log("[setupBookmarksSync] No events found")
      return
    }

    // Take most recent event (could be either format)
    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))
    console.log("[setupBookmarksSync] Latest event:", latest.id, "kind:", latest.kind, "tags:", latest.tags)
    
    const aTags = getAddressTags(latest.tags)
    console.log("[setupBookmarksSync] Address tags found:", aTags.length, aTags)
    
    const mapped = aTags.map(([_, address, relayHint]: string[]) => ({
      address,
      event: null,
      relayHint: relayHint ? normalizeRelayUrl(relayHint) : "",
      author: latest.pubkey,
      identifier: GIT_REPO_BOOKMARK_DTAG,
    }))
    console.log("[setupBookmarksSync] Setting bookmarksStore with:", mapped)
    bookmarksStore.set(mapped)
  })

  // Ensure we fetch initial data for both formats
  console.log("[setupBookmarksSync] Loading from relays:", relays)
  load({ relays, filters })

  return bookmarksUnsub
}

// --- GRASP servers sync (centralized) ---
let graspUnsub: (() => void) | undefined

export function setupGraspServersSync(pubkey: string, relays: string[] = []) {
  try { graspUnsub?.() } catch {}

  const filter = { kinds: [GRASP_SET_KIND], authors: [pubkey], "#d": [DEFAULT_GRASP_SET_ID] }
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  graspUnsub = store.subscribe((events: any[]) => {
    if (!events || events.length === 0) return

    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))
    const urls = new Set<string>()

    // Parse URLs from content JSON (format: { urls: [...] })
    try {
      if (latest.content) {
        const parsed = JSON.parse(latest.content)
        const contentUrls = Array.isArray(parsed?.urls) ? parsed.urls : []
        for (const url of contentUrls) {
          const normalized = normalizeRelayUrl(url)
          if (validateGraspServerUrl(normalized)) urls.add(normalized)
        }
      }
    } catch {
      // Fallback: try parsing from tags for backwards compatibility
      const tags = latest.tags || []
      for (const t of tags) {
        if ((t[0] === "relay" || t[0] === "r") && t[1]) {
          const normalized = normalizeRelayUrl(t[1])
          if (validateGraspServerUrl(normalized)) urls.add(normalized)
        }
      }
    }

    graspServersStore.set(Array.from(urls))
  })

  load({ relays, filters: [filter] })

  return graspUnsub
}

// --- Git tokens sync (centralized, encrypted) ---
let tokensUnsub: (() => void) | undefined

export function setupTokensSync(pk: string, relays: string[] = []) {
  try { tokensUnsub?.() } catch {}

  console.log("[setupTokensSync] Setting up for pubkey:", pk, "relays:", relays)

  const filter = { kinds: [APP_DATA], authors: [pk], "#d": [GIT_AUTH_DTAG] }
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  tokensUnsub = store.subscribe(async (events: TrustedEvent[]) => {
    console.log("[setupTokensSync] Store subscription fired, events count:", events?.length || 0)
    
    if (!events || events.length === 0) {
      console.log("[setupTokensSync] No token events found")
      return
    }

    // Take most recent event
    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))
    console.log("[setupTokensSync] Latest event:", latest.id, "created_at:", latest.created_at)

    try {
      // Decrypt the content using NIP-44
      const plaintext = await ensurePlaintext(latest)
      if (!plaintext) {
        console.warn("[setupTokensSync] Failed to decrypt token event")
        return
      }

      const loadedTokens = JSON.parse(plaintext) as Token[]
      console.log("[setupTokensSync] Decrypted", loadedTokens.length, "tokens")

      // Validate and log token info for debugging (without exposing full token)
      loadedTokens.forEach((t: Token, i: number) => {
        const tokenPreview = t.token ? `${t.token.substring(0, 4)}...${t.token.substring(t.token.length - 4)}` : 'empty'
        const isValidFormat = t.token && t.token.length >= 20 && !t.token.includes('\n') && !t.token.includes(' ')
        console.log(`[setupTokensSync] Token ${i + 1}: host="${t.host}", token=${tokenPreview}, length=${t.token?.length || 0}, validFormat=${isValidFormat}`)
        if (!isValidFormat) {
          console.warn(`[setupTokensSync] Token ${i + 1} may be invalid - check for whitespace, newlines, or incorrect format`)
        }
      })

      tokens.clear()
      loadedTokens.forEach((token: Token) => tokens.push(token))
    } catch (error) {
      console.error("[setupTokensSync] Failed to parse token event:", error)
    }
  })

  load({ relays, filters: [filter] })

  return tokensUnsub
}