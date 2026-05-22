import {
  GIT_REPO_BOOKMARK_SET,
  GRASP_SET_KIND,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_BOOKMARK_DTAG,
  DEFAULT_GRASP_SET_ID,
  validateGraspServerUrl,
  type BookmarkAddress,
} from "@nostr-git/core/events"
import {tokens, type Token, bookmarksStore} from "@nostr-git/ui"
import {DEFAULT_GRASP_SERVER_URL, graspServersStore} from "@nostr-git/ui"
import {repository, ensurePlaintext, signer, pubkey, publishThunk} from "@welshman/app"
import {load, PublishStatus} from "@welshman/net"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {get} from "svelte/store"
import {
  NAMED_BOOKMARKS,
  APP_DATA,
  getAddressTags,
  makeEvent,
  normalizeRelayUrl,
  type TrustedEvent,
} from "@welshman/util"

const safeNormalizeRelayUrl = (u: string): string => {
  try {
    return normalizeRelayUrl(u)
  } catch {
    return ""
  }
}

// D-tag for git authentication tokens (intentionally not obvious)
export const GIT_AUTH_DTAG = "app/budabit/tokens"

const GIT_AUTH_PERSIST_TIMEOUT_MS = 15000
const GIT_AUTH_FALLBACK_RELAYS = String(import.meta.env.VITE_GIT_RELAYS || "")
  .split(",")
  .map(url => url.trim())
  .filter(Boolean)

export type PersistGitAuthTokensResult = {
  relayPersisted: boolean
  acceptedRelays: string[]
}

const normalizeGitAuthTokens = (entries: Token[] = []): Token[] =>
  entries
    .map(entry => ({
      host: String(entry?.host || "").trim(),
      token: String(entry?.token || "").trim(),
    }))
    .filter(entry => entry.host && entry.token)

const withPersistTimeout = async <T>(operation: Promise<T>, label: string): Promise<T> =>
  await Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after 15 seconds`)), GIT_AUTH_PERSIST_TIMEOUT_MS)
    }),
  ])

function replaceGitAuthTokens(entries: Token[]) {
  tokens.clear()
  normalizeGitAuthTokens(entries).forEach(token => tokens.push(token))
}

function getGitAuthPublishRelays(relays: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const relay of [...relays, ...GIT_AUTH_FALLBACK_RELAYS]) {
    const normalized = safeNormalizeRelayUrl(relay)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }

  return out
}

async function publishGitAuthTokensToRelays(encrypted: string, relays: string[]) {
  if (relays.length === 0) {
    throw new Error("No relays are available to persist Git tokens")
  }

  const event = makeEvent(APP_DATA, {
    content: encrypted,
    tags: [["d", GIT_AUTH_DTAG]],
  })
  const thunk = publishThunk({event, relays}) as any
  const complete = thunk?.complete
  if (complete && typeof complete.then === "function") {
    await withPersistTimeout(complete, "Git token relay publish")
  } else if (thunk && typeof thunk.then === "function") {
    await withPersistTimeout(thunk, "Git token relay publish")
  }

  const results = Object.values((thunk?.results || {}) as Record<string, any>)
  const acceptedRelays = results
    .filter(result => result?.status === PublishStatus.Success)
    .map(result => String(result.relay || ""))
    .filter(Boolean)

  if (acceptedRelays.length === 0) {
    const details = results
      .map(result => `${result?.relay || "relay"}: ${result?.detail || result?.status || "failed"}`)
      .join("; ")
    throw new Error(details ? `No relay accepted Git token backup: ${details}` : "No relay accepted Git token backup")
  }

  return acceptedRelays
}

export async function persistGitAuthTokens(
  entries: Token[],
  relays: string[] = [],
): Promise<PersistGitAuthTokensResult> {
  const activeSigner = get(signer)
  const activePubkey = get(pubkey)

  if (!activeSigner?.nip44?.encrypt || !activePubkey) {
    throw new Error("Signer with NIP-44 support is required to persist Git tokens")
  }

  const cleanTokens = normalizeGitAuthTokens(entries)
  const plaintext = JSON.stringify(cleanTokens)
  const encrypted = await withPersistTimeout(
    activeSigner.nip44.encrypt(activePubkey, plaintext),
    "Git token encrypt",
  )
  const publishRelays = getGitAuthPublishRelays(relays)
  const acceptedRelays = await publishGitAuthTokensToRelays(encrypted, publishRelays)

  replaceGitAuthTokens(cleanTokens)

  return {
    relayPersisted: true,
    acceptedRelays,
  }
}

export function clearSyncedGitAuthTokens() {
  tokens.clear()
}

// D-tag for extension settings
export const EXTENSION_SETTINGS_DTAG = "app/budabit/extensions"

export const loadRepositories = async (pubkey: string, relays: string[] = []) => {
  // Load both the named bookmark list and any legacy/set variants
  load({
    relays,
    filters: [
      {kinds: [NAMED_BOOKMARKS], authors: [pubkey], "#d": [GIT_REPO_BOOKMARK_DTAG]},
      {kinds: [GIT_REPO_BOOKMARK_SET], authors: [pubkey]},
      {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [pubkey]},
    ],
  })
}

const getDTag = (tags: string[][] = []) => tags.find(tag => tag[0] === "d")?.[1] || ""

const getRepoAddressParts = (address: string) => {
  const parts = String(address || "").split(":")
  const [kind, author, ...identifierParts] = parts
  const identifier = identifierParts.join(":")

  if (kind !== String(GIT_REPO_ANNOUNCEMENT) || !author || !identifier) return null

  return {author, identifier}
}

const isDefined = <T>(value: T | null | undefined): value is T => Boolean(value)

const mapRepoBookmarkAddresses = (event: {tags?: string[][]}): BookmarkAddress[] =>
  getAddressTags(event.tags || [])
    .map(([_, address, relayHint]: string[]) => {
      const parts = getRepoAddressParts(address)
      if (!parts) return null

      return {
        address,
        relayHint: relayHint ? safeNormalizeRelayUrl(relayHint) : "",
        author: parts.author,
        identifier: parts.identifier,
      }
    })
    .filter(isDefined)

export const getGitRepoBookmarkAddressesFromEvents = (events: any[]) => {
  const candidates = events
    .filter(Boolean)
    .map(event => ({
      event,
      bookmarks: mapRepoBookmarkAddresses(event),
    }))
    .sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0))

  const canonical = candidates.find(
    ({event}) => getDTag(event.tags || []) === GIT_REPO_BOOKMARK_DTAG,
  )
  if (canonical) return canonical.bookmarks

  return candidates.find(({bookmarks}) => bookmarks.length > 0)?.bookmarks || []
}

export const loadGraspServers = async (pubkey: string, relays: string[] = []) => {
  load({
    relays,
    filters: [{kinds: [GRASP_SET_KIND], authors: [pubkey], "#d": [DEFAULT_GRASP_SET_ID]}],
  })
}

export const loadTokens = async (pk: string, relays: string[] = []) => {
  // Load encrypted git tokens from relays
  load({
    relays,
    filters: [{kinds: [APP_DATA], authors: [pk], "#d": [GIT_AUTH_DTAG]}],
  })
}

export const loadExtensionSettings = async (pk: string, relays: string[] = []) => {
  // Load encrypted extension settings from relays
  load({
    relays,
    filters: [{kinds: [APP_DATA], authors: [pk], "#d": [EXTENSION_SETTINGS_DTAG]}],
  })
}

// --- Bookmarks sync (centralized) ---
let bookmarksUnsub: (() => void) | undefined

export function setupBookmarksSync(pubkey: string, relays: string[] = []) {
  try {
    bookmarksUnsub?.()
  } catch {
    // Existing subscriptions are best-effort cleanup before replacing them.
  }

  // Query for both new format (with d-tag) and legacy format (without d-tag)
  const filters: any[] = [
    {kinds: [NAMED_BOOKMARKS], authors: [pubkey], "#d": [GIT_REPO_BOOKMARK_DTAG]},
    {kinds: [GIT_REPO_BOOKMARK_SET], authors: [pubkey]},
  ]

  const store = deriveEventsAsc(deriveEventsById({repository, filters}))

  bookmarksUnsub = store.subscribe((events: any[]) => {
    if (!events || events.length === 0) {
      console.log("[setupBookmarksSync] No events found")
      return
    }

    bookmarksStore.set(getGitRepoBookmarkAddressesFromEvents(events))
  })

  // Ensure we fetch initial data for both formats
  load({relays, filters})

  return bookmarksUnsub
}

// --- GRASP servers sync (centralized) ---
let graspUnsub: (() => void) | undefined

export function setupGraspServersSync(pubkey: string, relays: string[] = []) {
  try {
    graspUnsub?.()
  } catch {
    // Existing subscriptions are best-effort cleanup before replacing them.
  }

  const filter = {kinds: [GRASP_SET_KIND], authors: [pubkey], "#d": [DEFAULT_GRASP_SET_ID]}
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  graspUnsub = store.subscribe((events: any[]) => {
    if (!events || events.length === 0) {
      graspServersStore.set([DEFAULT_GRASP_SERVER_URL])
      return
    }

    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))
    const urls = new Set<string>()

    // Parse URLs from content JSON (format: { urls: [...] })
    try {
      if (latest.content) {
        const parsed = JSON.parse(latest.content)
        const contentUrls = Array.isArray(parsed?.urls) ? parsed.urls : []
        for (const url of contentUrls) {
          const normalized = safeNormalizeRelayUrl(url)
          if (normalized && validateGraspServerUrl(normalized)) urls.add(normalized)
        }
      }
    } catch {
      // Fallback: try parsing from tags for backwards compatibility
      const tags = latest.tags || []
      for (const t of tags) {
        if ((t[0] === "relay" || t[0] === "r") && t[1]) {
          const normalized = safeNormalizeRelayUrl(t[1])
          if (validateGraspServerUrl(normalized)) urls.add(normalized)
        }
      }
    }

    graspServersStore.set(Array.from(urls))
  })

  load({relays, filters: [filter]})

  return graspUnsub
}

// --- Git tokens sync (centralized, encrypted) ---
let tokensUnsub: (() => void) | undefined

export function setupTokensSync(pk: string, relays: string[] = []) {
  try {
    tokensUnsub?.()
  } catch {
    // Existing subscriptions are best-effort cleanup before replacing them.
  }

  replaceGitAuthTokens([])

  const filter = {kinds: [APP_DATA], authors: [pk], "#d": [GIT_AUTH_DTAG]}
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  tokensUnsub = store.subscribe(async (events: TrustedEvent[]) => {
    if (!events || events.length === 0) {
      console.log("[setupTokensSync] No token events found")
      return
    }

    // Take most recent event
    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))

    try {
      // Decrypt the content using NIP-44
      const plaintext = await ensurePlaintext(latest)
      if (!plaintext) {
        console.warn("[setupTokensSync] Failed to decrypt token event")
        return
      }

      const loadedTokens = JSON.parse(plaintext) as Token[]

      // Validate token format (no previews logged to avoid leaking secrets)
      if (import.meta.env.DEV) {
        loadedTokens.forEach((t: Token, i: number) => {
          const isValidFormat =
            t.token && t.token.length >= 20 && !t.token.includes("\n") && !t.token.includes(" ")
          if (!isValidFormat) {
            console.warn(`[setupTokensSync] Token ${i + 1} may be invalid format`)
          }
        })
      }

      replaceGitAuthTokens(loadedTokens)
    } catch (error) {
      console.error("[setupTokensSync] Failed to parse token event:", error)
    }
  })

  load({relays, filters: [filter]})

  return tokensUnsub
}

// --- Extension settings sync (centralized, encrypted) ---
let extensionSettingsUnsub: (() => void) | undefined

export function setupExtensionSettingsSync(
  pk: string,
  relays: string[] = [],
  onSettingsLoaded: (settings: any) => void,
) {
  try {
    extensionSettingsUnsub?.()
  } catch {
    // Existing subscriptions are best-effort cleanup before replacing them.
  }

  const filter = {kinds: [APP_DATA], authors: [pk], "#d": [EXTENSION_SETTINGS_DTAG]}
  const store = deriveEventsAsc(deriveEventsById({repository, filters: [filter]}))

  extensionSettingsUnsub = store.subscribe(async (events: TrustedEvent[]) => {
    if (!events || events.length === 0) {
      console.log("[setupExtensionSettingsSync] No extension settings events found")
      return
    }

    // Take most recent event
    const latest = events.reduce((acc, cur) => (cur.created_at > acc.created_at ? cur : acc))

    try {
      // Decrypt the content using NIP-44
      const plaintext = await ensurePlaintext(latest)
      if (!plaintext) {
        console.warn("[setupExtensionSettingsSync] Failed to decrypt extension settings event")
        return
      }

      const loadedSettings = JSON.parse(plaintext)
      console.log("[setupExtensionSettingsSync] Loaded extension settings from relay")
      onSettingsLoaded(loadedSettings)
    } catch (error) {
      console.error("[setupExtensionSettingsSync] Failed to parse extension settings event:", error)
    }
  })

  load({relays, filters: [filter]})

  return extensionSettingsUnsub
}
