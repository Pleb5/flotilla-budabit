import {page} from "$app/stores"
import type {Unsubscriber} from "svelte/store"
import {derived} from "svelte/store"
import {partition, call, sortBy, assoc, sleep, identity, WEEK, ago} from "@welshman/lib"
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
  tracker,
  repository,
  hasNegentropy,
  userRelayList,
  userMessagingRelayList,
  loadUserRelayList,
  forceLoadUserMessagingRelayList,
  loadUserBlossomServerList,
  loadUserFollowList,
  loadUserMuteList,
} from "@welshman/app"
import {INDEXER_RELAYS, loadSettings} from "@app/core/state"
import {GIT_RELAYS} from "@app/core/git-state"
import {DM_KIND, getMessagingRelayHints} from "@app/core/dm"
import {loadAlerts, loadAlertStatuses} from "@app/core/requests"
import {
  loadGraspServers,
  loadRepositories,
  loadTokens,
  loadExtensionSettings,
  setupGraspServersSync,
  setupTokensSync,
  setupExtensionSettingsSync,
  clearSyncedGitAuthTokens,
} from "@app/core/git-requests"
import {applyRemoteExtensionSettings} from "@app/extensions/settings"
import {loadRepoWatch} from "@app/core/repo-watch"
import {loadBudabitProfile} from "@app/core/profile-resolver"

// Utils

type PullOpts = {
  relays: string[]
  filters: Filter[]
  signal: AbortSignal
}

type DmPullOpts = PullOpts & {
  fullHistory?: boolean
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

const dmLoad = makeLoader({delay: 200, timeout: 3000, threshold: 0.5})
const DM_RECENT_BACKFILL_LIMIT = 100
const DM_BOOTSTRAP_BACKFILL_LIMIT = 200

const ALERTS_ENABLED = typeof __ALERTS__ !== "undefined" && __ALERTS__

const pullWithFallbackDm = ({relays, filters, signal, fullHistory = false}: DmPullOpts) => {
  const [smart, dumb] = partition(hasNegentropy, relays)
  const events = repository.query(filters, {shouldSort: false}).filter(isSignedEvent)
  const promises: Promise<TrustedEvent[]>[] = []

  if (smart.length > 0) {
    promises.push(pull({relays: smart, filters, signal, events}))
  }

  // For DMs, always run loader-based backfill. Even when relays support negentropy,
  // this protects us from false capability detection or partial negentropy failures.
  for (const url of [...smart, ...dumb]) {
    let relayFilters = filters
    const urlEvents = events.filter(e => tracker.getRelays(e.id).has(url))

    if (!fullHistory && urlEvents.length >= 100) {
      relayFilters = relayFilters.map(
        assoc("since", sortBy(e => -e.created_at, urlEvents)[10]!.created_at),
      )
    }

    promises.push(dmLoad({relays: [url], filters: relayFilters, signal}))
  }

  return Promise.all(promises)
}

const buildDmBootstrapFilters = (filters: Filter[]) =>
  filters.map(filter => {
    const bootstrapFilter = {...filter}

    delete bootstrapFilter.since
    delete bootstrapFilter.until

    return {...bootstrapFilter, limit: DM_BOOTSTRAP_BACKFILL_LIMIT}
  })

const loadDmBootstrap = ({relays, filters, signal}: PullOpts) =>
  Promise.all(relays.map(url => dmLoad({relays: [url], filters, signal})))

const pullAndListenDm = ({relays, filters, signal, fullHistory = false}: DmPullOpts) => {
  const backfillFilters = fullHistory
    ? filters
    : filters.map(f => ({limit: DM_RECENT_BACKFILL_LIMIT, ...f}))
  const liveFilters = unionFilters(filters).map(assoc("limit", 0))

  pullWithFallbackDm({
    relays,
    signal,
    filters: backfillFilters,
    fullHistory,
  })

  if (!fullHistory) {
    loadDmBootstrap({
      relays,
      signal,
      filters: buildDmBootstrapFilters(filters),
    })
  }

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
  for (const url of INDEXER_RELAYS) {
    loadRelay(url)
  }

  return () => {}
}

// User data

const syncUserData = () => {
  const unsubscribeRelayList = userRelayList.subscribe(($userRelayList: any) => {
    if ($userRelayList) {
      if (ALERTS_ENABLED) {
        loadAlerts($userRelayList.event.pubkey)
        loadAlertStatuses($userRelayList.event.pubkey)
      }
      loadUserBlossomServerList()
      loadUserFollowList()
      loadUserMuteList()
      loadBudabitProfile($userRelayList.event.pubkey)
      loadSettings($userRelayList.event.pubkey)
      loadRepoWatch($userRelayList.event.pubkey)
    }
  })

  return unsubscribeRelayList
}

// DMs

const buildDmFilters = (pubkey: string, extra: Filter = {}) => [
  {kinds: [DM_KIND], "#p": [pubkey], ...extra},
  {kinds: [DM_KIND], authors: [pubkey], ...extra},
]

export const shouldRefreshDmRelayListsForChat = (pathname = "") =>
  pathname === "/chat" || pathname.startsWith("/chat/")

export const buildDmSyncFilters = (pubkey: string, fullHistory = false) =>
  buildDmFilters(pubkey, fullHistory ? {} : {since: ago(WEEK, 2)})

const syncDMRelay = (url: string, pubkey: string, fullHistory = false) => {
  const controller = new AbortController()
  const filters = buildDmSyncFilters(pubkey, fullHistory)

  pullAndListenDm({
    relays: [url],
    signal: controller.signal,
    filters,
    fullHistory,
  })

  return () => controller.abort()
}

const backfillDMRelayHistory = (url: string, pubkey: string) => {
  const controller = new AbortController()

  pullWithFallbackDm({
    relays: [url],
    signal: controller.signal,
    filters: buildDmSyncFilters(pubkey, true),
    fullHistory: true,
  }).catch(error => {
    if (!controller.signal.aborted) {
      console.warn("[sync] Failed to backfill DM relay history", error)
    }
  })

  return () => controller.abort()
}

const syncDMs = () => {
  const unsubscribersByUrl = new Map<string, Unsubscriber>()
  const historyBackfillUnsubscribersByUrl = new Map<string, Unsubscriber>()

  let currentPubkey: string | undefined
  let currentFullHistory = false
  let hasRequestedChatRelayRefresh = false
  let hasObservedMessagingRelays = false
  let previousRelayUrls: string[] = []

  const unsubscribeAll = () => {
    for (const [url, unsubscribe] of unsubscribersByUrl.entries()) {
      unsubscribersByUrl.delete(url)
      unsubscribe()
    }

    for (const [url, unsubscribe] of historyBackfillUnsubscribersByUrl.entries()) {
      historyBackfillUnsubscribersByUrl.delete(url)
      unsubscribe()
    }
  }

  const subscribeAll = (pubkey: string, urls: string[], fullHistory = false) => {
    const sanitizedUrls = sanitizeRelayList(urls)
    const newRelayUrls = sanitizedUrls.filter(url => !previousRelayUrls.includes(url))
    const shouldBackfillFirstRelayHistory =
      hasObservedMessagingRelays && previousRelayUrls.length === 0 && sanitizedUrls.length > 0

    if (fullHistory !== currentFullHistory) {
      unsubscribeAll()
      currentFullHistory = fullHistory
    }

    if (sanitizedUrls.length === 0) {
      unsubscribeAll()
      previousRelayUrls = []
      hasObservedMessagingRelays = true
      return
    }

    // Start syncing newly added relays
    for (const url of sanitizedUrls) {
      if (!unsubscribersByUrl.has(url)) {
        unsubscribersByUrl.set(url, syncDMRelay(url, pubkey, fullHistory))
      }

      if (shouldBackfillFirstRelayHistory && newRelayUrls.includes(url)) {
        historyBackfillUnsubscribersByUrl.get(url)?.()
        historyBackfillUnsubscribersByUrl.set(url, backfillDMRelayHistory(url, pubkey))
      }
    }

    // Stop syncing removed relays
    for (const [url, unsubscribe] of unsubscribersByUrl.entries()) {
      if (!sanitizedUrls.includes(url)) {
        unsubscribersByUrl.delete(url)
        unsubscribe()
      }
    }

    for (const [url, unsubscribe] of historyBackfillUnsubscribersByUrl.entries()) {
      if (!sanitizedUrls.includes(url)) {
        historyBackfillUnsubscribersByUrl.delete(url)
        unsubscribe()
      }
    }

    previousRelayUrls = sanitizedUrls
    hasObservedMessagingRelays = true
  }

  // When pubkey changes, re-sync
  const unsubscribePubkey = pubkey.subscribe($pubkey => {
    if ($pubkey !== currentPubkey) {
      unsubscribeAll()
      currentFullHistory = false
      hasRequestedChatRelayRefresh = false
      hasObservedMessagingRelays = false
      previousRelayUrls = []
    }

    // Refresh relay lists whenever a user is active so DM sync works across sessions/tabs.
    if ($pubkey) {
      const relayHints = getMessagingRelayHints()
      loadUserRelayList()
      forceLoadUserMessagingRelayList(relayHints)
    }

    currentPubkey = $pubkey
  })

  // When user messaging relays change, update synchronization
  const unsubscribeList = derived([pubkey, userMessagingRelayList, page], identity).subscribe(
    ([$pubkey, $userMessagingRelayList, $page]) => {
      if ($pubkey) {
        if (
          !hasRequestedChatRelayRefresh &&
          shouldRefreshDmRelayListsForChat($page?.url?.pathname || "")
        ) {
          hasRequestedChatRelayRefresh = true
          const relayHints = getMessagingRelayHints()
          loadUserRelayList()
          forceLoadUserMessagingRelayList(relayHints)
        }

        const rawRelays = getRelayTagValues(getListTags($userMessagingRelayList))
        // Filter out any non-string values before sanitizing
        const stringRelays = Array.isArray(rawRelays)
          ? rawRelays.filter(r => typeof r === "string" && r.length > 0)
          : []
        const relayUrls = sanitizeRelayList(stringRelays)
        subscribeAll($pubkey, relayUrls)
      }
    },
  )

  return () => {
    unsubscribeAll()
    unsubscribePubkey()
    unsubscribeList()
  }
}

// Merge all synchronization functions

export const syncApplicationData = () => {
  const unsubscribers = [syncRelays(), syncUserData(), syncDMs()]

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

  // Subscribe to pubkey changes only - bookmarks and git data are public
  const unsubscribePubkey = pubkey.subscribe($pubkey => {
    console.log(
      "[syncUserGitData] Subscription fired - pubkey:",
      $pubkey,
      "currentPubkey:",
      currentPubkey,
    )

    if ($pubkey !== currentPubkey) {
      unsubscribeAll()
      clearSyncedGitAuthTokens()
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
      clearSyncedGitAuthTokens()
    }

    currentPubkey = $pubkey
  })

  return () => {
    unsubscribeAll()
    unsubscribePubkey()
    loadController?.abort()
  }
}

export const syncGitData = () => {
  const unsubscribers = [syncUserGitData()]

  return () => unsubscribers.forEach(call)
}
