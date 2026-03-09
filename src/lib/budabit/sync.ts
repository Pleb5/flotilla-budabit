import type {Unsubscriber} from "svelte/store"
import {derived, get} from "svelte/store"
import {partition, call, sortBy, assoc, chunk, sleep, identity, WEEK, ago} from "@welshman/lib"
import {
  getListTags,
  getRelayTagValues,
  isSignedEvent,
  unionFilters,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import type {Filter, TrustedEvent} from "@welshman/util"
import {request, load, pull, makeLoader} from "@welshman/net"
import {Router} from "@welshman/router"
import {
  pubkey,
  loadRelay,
  loadProfile,
  tracker,
  repository,
  hasNegentropy,
  shouldUnwrap,
  userRelayList,
  userFollowList,
  userMessagingRelayList,
  loadUserRelayList,
  forceLoadUserMessagingRelayList,
  loadUserBlossomServerList,
  loadUserFollowList,
  loadUserMuteList,
} from "@welshman/app"
import {
  REACTION_KINDS,
  MESSAGE_KINDS,
  CONTENT_KINDS,
  INDEXER_RELAYS,
  PLATFORM_RELAYS,
  isPlatformRelay,
  loadSettings,
  bootstrapPubkeys,
  makeCommentFilter,
} from "@app/core/state"
import {GIT_RELAYS} from "./state"
import {DM_KIND, getMessagingRelayHints} from "@lib/budabit/dm"
import {loadAlerts, loadAlertStatuses} from "@app/core/requests"
import {
  loadGraspServers,
  loadRepositories,
  loadTokens,
  loadExtensionSettings,
  setupBookmarksSync,
  setupGraspServersSync,
  setupTokensSync,
  setupExtensionSettingsSync,
} from "./requests"
import {applyRemoteExtensionSettings, startExtensionSettingsAutoSync} from "@app/extensions/settings"
import {loadRepoWatch} from "./repo-watch"

// Utils

type PullOpts = {
  relays: string[]
  filters: Filter[]
  signal: AbortSignal
}

const pullWithFallback = ({relays, filters, signal}: PullOpts) => {
  const [smart, dumb] = partition(hasNegentropy, relays)
  const events = repository.query(filters, {shouldSort: false}).filter(isSignedEvent)
  const promises: Promise<TrustedEvent[]>[] = [pull({relays: smart, filters, signal, events})]

  // Since pulling from relays without negentropy is expensive, limit how many
  // duplicates we repeatedly download
  for (const url of dumb) {
    const urlEvents = events.filter(e => tracker.getRelays(e.id).has(url))

    if (urlEvents.length >= 100) {
      filters = filters.map(assoc("since", sortBy(e => -e.created_at, urlEvents)[10]!.created_at))
    }

    promises.push(load({relays: [url], filters, signal}))
  }

  return Promise.all(promises)
}

const dmLoad = makeLoader({delay: 200, threshold: 0.5})

const pullWithFallbackDm = ({relays, filters, signal}: PullOpts) => {
  const [smart, dumb] = partition(hasNegentropy, relays)
  const events = repository.query(filters, {shouldSort: false}).filter(isSignedEvent)
  const promises: Promise<TrustedEvent[]>[] = []

  if (smart.length > 0) {
    promises.push(pull({relays: smart, filters, signal, events}))
  }

  // For DMs, always run loader-based backfill. Even when relays support negentropy,
  // this protects us from false capability detection or partial negentropy failures.
  for (const url of [...smart, ...dumb]) {
    const urlEvents = events.filter(e => tracker.getRelays(e.id).has(url))

    if (urlEvents.length >= 100) {
      filters = filters.map(assoc("since", sortBy(e => -e.created_at, urlEvents)[10]!.created_at))
    }

    promises.push(dmLoad({relays: [url], filters, signal}))
  }

  return Promise.all(promises)
}

const pullAndListen = ({relays, filters, signal}: PullOpts) => {
  pullWithFallback({
    relays,
    signal,
    filters: filters.map(f => ({limit: 100, ...f})),
  })

  request({
    relays,
    signal,
    filters: unionFilters(filters).map(assoc("limit", 0)),
  })
}

const pullAndListenDm = ({relays, filters, signal}: PullOpts) => {
  const backfillFilters = filters.map(f => ({limit: 100, ...f}))
  const liveFilters = unionFilters(filters).map(assoc("limit", 0))

  pullWithFallbackDm({
    relays,
    signal,
    filters: backfillFilters,
  })

  request({
    relays,
    signal,
    filters: liveFilters,
  })
}

const sanitizeRelayList = (relays: unknown) => {
  const out: string[] = []
  const seen = new Set<string>()

  // Ensure relays is an array
  const relayArray = Array.isArray(relays) ? relays : []

  for (const url of relayArray) {
    // Skip non-string values
    if (typeof url !== "string") {
      continue
    }

    let normalized = ""
    try {
      normalized = normalizeRelayUrl(url)
    } catch {
      normalized = ""
    }

    if (!normalized || !isRelayUrl(normalized) || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    out.push(normalized)
  }

  return out
}

// Relays

const syncRelays = () => {
  const platformRelays = sanitizeRelayList(PLATFORM_RELAYS)

  for (const url of INDEXER_RELAYS) {
    loadRelay(url)
  }

  for (const url of platformRelays) {
    loadRelay(url)
  }

  if (platformRelays.length === 0) {
    return () => {}
  }

  const retryInterval = setInterval(() => {
    for (const url of platformRelays) {
      loadRelay(url)
    }
  }, 15_000)

  return () => clearInterval(retryInterval)
}

// User data

const syncUserData = () => {
  const unsubscribeRelayList = userRelayList.subscribe(($userRelayList: any) => {
    if ($userRelayList) {
      loadAlerts($userRelayList.event.pubkey)
      loadAlertStatuses($userRelayList.event.pubkey)
      loadUserBlossomServerList($userRelayList.event.pubkey)
      loadUserFollowList($userRelayList.event.pubkey)
      loadUserMuteList($userRelayList.event.pubkey)
      loadProfile($userRelayList.event.pubkey)
      loadSettings($userRelayList.event.pubkey)
      loadRepoWatch($userRelayList.event.pubkey)
    }
  })

  const unsubscribeFollows = userFollowList.subscribe(async (_$userFollowList: any) => {
    for (const pubkeys of chunk(10, get(bootstrapPubkeys))) {
      // This isn't urgent, avoid clogging other stuff up
      await sleep(1000)

      await Promise.all(
        pubkeys.map(async pk => {
          await loadUserRelayList(pk)
          await loadProfile(pk)
          await loadUserFollowList(pk)
          await loadUserMuteList(pk)
        }),
      )
    }
  })

  return () => {
    unsubscribeRelayList()
    unsubscribeFollows()
  }
}

// Spaces

const syncBudabitSpace = (url: string) => {
  const controller = new AbortController()
  const includeRooms = isPlatformRelay(url)
  const messageKinds = includeRooms ? MESSAGE_KINDS : CONTENT_KINDS

  const filters: Filter[] = [
    ...messageKinds.map(kind => ({kinds: [kind]})),
    makeCommentFilter(CONTENT_KINDS),
    {kinds: REACTION_KINDS, limit: 0},
  ]

  pullAndListen({
    relays: [url],
    signal: controller.signal,
    filters,
  })

  return () => controller.abort()
}

const syncBudabitSpaces = () => {
  const unsubscribersByUrl = new Map<string, Unsubscriber>()

  for (const url of sanitizeRelayList(PLATFORM_RELAYS)) {
    if (!unsubscribersByUrl.has(url)) {
      unsubscribersByUrl.set(url, syncBudabitSpace(url))
    }
  }

  return () => {
    for (const unsubscriber of unsubscribersByUrl.values()) {
      unsubscriber()
    }
  }
}

// DMs

const buildDmFilters = (pubkey: string, extra: Filter = {}) => [
  {kinds: [DM_KIND], "#p": [pubkey], ...extra},
  {kinds: [DM_KIND], authors: [pubkey], ...extra},
]

const syncDMRelay = (url: string, pubkey: string) => {
  const controller = new AbortController()

  const filters = buildDmFilters(pubkey, {since: ago(WEEK, 2)})

  pullAndListenDm({
    relays: [url],
    signal: controller.signal,
    filters,
  })

  return () => controller.abort()
}

const syncDMs = () => {
  const unsubscribersByUrl = new Map<string, Unsubscriber>()

  let currentPubkey: string | undefined

  const unsubscribeAll = () => {
    for (const [url, unsubscribe] of unsubscribersByUrl.entries()) {
      unsubscribersByUrl.delete(url)
      unsubscribe()
    }
  }

  const subscribeAll = (pubkey: string, urls: string[]) => {
    const sanitizedUrls = sanitizeRelayList(urls)

    if (sanitizedUrls.length === 0) {
      unsubscribeAll()
      return
    }
    // Start syncing newly added relays
    for (const url of sanitizedUrls) {
      if (!unsubscribersByUrl.has(url)) {
        unsubscribersByUrl.set(url, syncDMRelay(url, pubkey))
      }
    }

    // Stop syncing removed spaces
    for (const [url, unsubscribe] of unsubscribersByUrl.entries()) {
      if (!sanitizedUrls.includes(url)) {
        unsubscribersByUrl.delete(url)
        unsubscribe()
      }
    }
  }

  // When pubkey changes, re-sync
  const unsubscribePubkey = pubkey.subscribe($pubkey => {
      if ($pubkey !== currentPubkey) {
        unsubscribeAll()
      }

      // Refresh relay lists whenever a user is active so DM sync works across sessions/tabs.
      if ($pubkey) {
        const relayHints = getMessagingRelayHints()
        loadUserRelayList($pubkey)
        forceLoadUserMessagingRelayList(relayHints)
      }

      currentPubkey = $pubkey
    })

  // When user messaging relays change, update synchronization
  const unsubscribeList = derived(
    [pubkey, userMessagingRelayList],
    identity,
  ).subscribe(([$pubkey, $userMessagingRelayList]) => {
    if ($pubkey) {
      const rawRelays = getRelayTagValues(getListTags($userMessagingRelayList))
      // Filter out any non-string values before sanitizing
      const stringRelays = Array.isArray(rawRelays)
        ? rawRelays.filter(r => typeof r === "string" && r.length > 0)
        : []
      const relayUrls = sanitizeRelayList(stringRelays)
      subscribeAll($pubkey, relayUrls)
    }
  })

  return () => {
    unsubscribeAll()
    unsubscribePubkey()
    unsubscribeList()
  }
}

// Merge all synchronization functions

export const syncBudabitApplicationData = () => {
  const unsubscribers = [syncRelays(), syncUserData(), syncBudabitSpaces(), syncDMs()]

  return () => unsubscribers.forEach(call)
}

// Helper to compare relay arrays
const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

const syncUserGitData = () => {
  const unsubscribersByKey = new Map<string, Unsubscriber>()

  let currentPubkey: string | undefined
  let loadController: AbortController | undefined
  const router = Router.get()

  const unsubscribeAll = () => {
    for (const [key, unsubscribe] of unsubscribersByKey.entries()) {
      unsubscribersByKey.delete(key)
      unsubscribe()
    }
  }

  const subscribeAll = (pk: string, relays: string[]) => {
    const fallbackRelays = sanitizeRelayList(GIT_RELAYS)
    const mergedRelays = sanitizeRelayList(relays.length > 0 ? relays : fallbackRelays)
    console.log(
      "[syncUserGitData] subscribeAll called with pk:",
      pk,
      "relays:",
      relays,
      "mergedRelays:",
      mergedRelays,
    )

    if (!unsubscribersByKey.has("bookmarks")) {
      console.log("[syncUserGitData] Setting up bookmarks sync...")
      const unsub = setupBookmarksSync(pk, mergedRelays)
      if (unsub) unsubscribersByKey.set("bookmarks", unsub)
      console.log("[syncUserGitData] Bookmarks sync setup complete")
    }

    if (!unsubscribersByKey.has("grasp")) {
      const unsub = setupGraspServersSync(pk, mergedRelays)
      if (unsub) unsubscribersByKey.set("grasp", unsub)
    }

    if (!unsubscribersByKey.has("tokens")) {
      console.log("[syncUserGitData] Setting up tokens sync...")
      const unsub = setupTokensSync(pk, mergedRelays)
      if (unsub) unsubscribersByKey.set("tokens", unsub)
      console.log("[syncUserGitData] Tokens sync setup complete")
    }

    if (!unsubscribersByKey.has("extensions")) {
      console.log("[syncUserGitData] Setting up extension settings sync...")
      const unsub = setupExtensionSettingsSync(pk, mergedRelays, applyRemoteExtensionSettings)
      if (unsub) unsubscribersByKey.set("extensions", unsub)
      // Also start auto-sync to publish local changes
      const autoSyncUnsub = startExtensionSettingsAutoSync()
      unsubscribersByKey.set("extensions-autosync", autoSyncUnsub)
      console.log("[syncUserGitData] Extension settings sync setup complete")
    }

    loadRepositories(pk, mergedRelays)
    loadGraspServers(pk, mergedRelays)
    loadTokens(pk, mergedRelays)
    loadExtensionSettings(pk, mergedRelays)
  }

  const ensureNotAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }
  }

  const resolveUserRelays = async (signal: AbortSignal) => {
    const baseRelays = () => {
      const urls = router.FromUser().getUrls()
      // Ensure urls is an array, not a string or other type
      const urlsArray = Array.isArray(urls) ? urls : []
      return sanitizeRelayList(urlsArray)
    }

    let userRelays = baseRelays()

    if (userRelays.length === 0) {
      for (let i = 0; i < 20; i++) {
        await sleep(100)
        ensureNotAborted(signal)
        userRelays = baseRelays()
        if (userRelays.length > 0) {
          break
        }
      }
    }

    return userRelays
  }

  // Subscribe to pubkey changes only - bookmarks and git data are public, don't need shouldUnwrap
  const unsubscribePubkey = pubkey.subscribe($pubkey => {
    console.log(
      "[syncUserGitData] Subscription fired - pubkey:",
      $pubkey,
      "currentPubkey:",
      currentPubkey,
    )

    if ($pubkey !== currentPubkey) {
      unsubscribeAll()
    }

    loadController?.abort()

    if ($pubkey) {
      const controller = new AbortController()
      loadController = controller

      // Immediately set up subscriptions and load with fallback relays
      // This ensures data is available as soon as possible
      console.log("[syncUserGitData] Setting up subscriptions immediately with GIT_RELAYS fallback")
      subscribeAll($pubkey, sanitizeRelayList(GIT_RELAYS))

      // Then also try to resolve user relays and reload if different
      void (async () => {
        try {
          ensureNotAborted(controller.signal)
          console.log("[syncUserGitData] Resolving user relays...")
          const resolvedRelays = await resolveUserRelays(controller.signal)
          console.log("[syncUserGitData] Resolved relays:", resolvedRelays)
          ensureNotAborted(controller.signal)

          // Only reload if user relays are different from GIT_RELAYS
          const fallbackRelays = sanitizeRelayList(GIT_RELAYS)
          if (resolvedRelays.length > 0 && !arraysEqual(resolvedRelays, fallbackRelays)) {
            console.log("[syncUserGitData] Reloading with user relays")
            loadRepositories($pubkey, resolvedRelays)
            loadGraspServers($pubkey, resolvedRelays)
            loadTokens($pubkey, resolvedRelays)
            loadExtensionSettings($pubkey, resolvedRelays)
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }

          console.warn("Failed to load user git data:", error)
        }
      })()
    } else {
      console.log("[syncUserGitData] Skipping sync - no pubkey")
    }

    currentPubkey = $pubkey
  })

  return () => {
    unsubscribeAll()
    unsubscribePubkey()
    loadController?.abort()
  }
}

export const syncBudabitData = () => {
  const unsubscribers = [syncUserGitData()]

  return () => unsubscribers.forEach(call)
}
