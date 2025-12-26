import { GIT_REPO_BOOKMARK_SET, GRASP_SET_KIND, GIT_REPO_BOOKMARK_DTAG, DEFAULT_GRASP_SET_ID } from "@nostr-git/shared-types"
import { loadTokensFromStorage, tokens, type Token, bookmarksStore } from "@nostr-git/ui"
import { graspServersStore } from "@nostr-git/ui"
import { repository } from "@welshman/app"
import { load } from "@welshman/net"
import { deriveEventsAsc, deriveEventsById } from "@welshman/store"
import { NAMED_BOOKMARKS, getAddressTags, normalizeRelayUrl } from "@welshman/util"
import { validateGraspServerUrl } from "@nostr-git/shared-types"


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

export const loadTokens = async (pubkey: string, relays: string[] = []) => {
    const tokenKey = "gh_tokens"

    try {
      const loadedTokens = await loadTokensFromStorage(tokenKey)
      tokens.clear()
      loadedTokens.forEach((token: Token) => tokens.push(token))
    } catch (error) {
      console.warn("🔐 Failed to initialize git tokens", error)
    }
}

// --- Bookmarks sync (centralized) ---
let bookmarksUnsub: (() => void) | undefined

export function setupBookmarksSync(pubkey: string, relays: string[] = []) {
  try { bookmarksUnsub?.() } catch {}

  const filter = { kinds: [NAMED_BOOKMARKS], authors: [pubkey], "#d": [GIT_REPO_BOOKMARK_DTAG] }
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  bookmarksUnsub = store.subscribe((events: any[]) => {
    if (!events || events.length === 0) return

    // Take most recent event
    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))
    const aTags = getAddressTags(latest.tags)
    const mapped = aTags.map(([_, address, relayHint]: string[]) => ({
      address,
      event: null,
      relayHint: relayHint ? normalizeRelayUrl(relayHint) : "",
    }))
    bookmarksStore.set(mapped)
  })

  // Ensure we fetch initial data
  load({ relays, filters: [filter] })

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
    const tags = latest.tags || []

    for (const t of tags) {
      if ((t[0] === "relay" || t[0] === "r") && t[1]) {
        const normalized = normalizeRelayUrl(t[1])
        if (validateGraspServerUrl(normalized)) urls.add(normalized)
      }
    }

    graspServersStore.set(Array.from(urls))
  })

  load({ relays, filters: [filter] })

  return graspUnsub
}