import {page} from "$app/stores"
import type {Unsubscriber} from "svelte/store"
import {derived, get} from "svelte/store"
import {partition, call, sortBy, assoc, chunk, sleep, identity, WEEK, ago} from "@welshman/lib"
import {
  getListTags,
  getRelayTagValues,
  RELAY_ADD_MEMBER,
  RELAY_REMOVE_MEMBER,
  WRAP,
  ROOM_CREATE_PERMISSION,
  ROOM_ADD_MEMBER,
  ROOM_REMOVE_MEMBER,
  isSignedEvent,
  unionFilters,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import type {Filter, TrustedEvent} from "@welshman/util"
import {request, load, pull} from "@welshman/net"
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
  loadUserMessagingRelayList,
  loadUserBlossomServerList,
  loadUserFollowList,
  loadUserMuteList,
} from "@welshman/app"
import {
  REACTION_KINDS,
  MESSAGE_KINDS,
  CONTENT_KINDS,
  INDEXER_RELAYS,
  isPlatformRelay,
  loadSettings,
  loadGroupList,
  userSpaceUrls,
  userGroupList,
  bootstrapPubkeys,
  decodeRelay,
  getSpaceUrlsFromGroupList,
  getSpaceRoomsFromGroupList,
  makeCommentFilter,
} from "@app/core/state"
import {GIT_RELAYS} from "./state"
import {loadAlerts, loadAlertStatuses} from "@app/core/requests"
import {
  loadGraspServers,
  loadRepositories,
  loadTokens,
  setupBookmarksSync,
  setupGraspServersSync,
  setupTokensSync,
} from "./requests"

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

const sanitizeRelayList = (relays: string[]) => {
  const out: string[] = []
  const seen = new Set<string>()

  for (const url of relays || []) {
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

  const unsubscribePage = page.subscribe($page => {
    if ($page.params.relay) {
      let url = ""
      try {
        url = decodeRelay($page.params.relay)
      } catch {
        url = ""
      }

      if (url) {
        loadRelay(url)
      }
    }
  })

  const unsubscribeSpaceUrls = userSpaceUrls.subscribe(urls => {
    for (const url of urls) {
      loadRelay(url)
    }
  })

  return () => {
    unsubscribePage()
    unsubscribeSpaceUrls()
  }
}

// User data

const syncUserSpaceMembership = (url: string) => {
  const $pubkey = pubkey.get()
  const controller = new AbortController()

  if ($pubkey) {
    pullAndListen({
      relays: [url],
      signal: controller.signal,
      filters: [
        {kinds: [RELAY_ADD_MEMBER], "#p": [$pubkey], limit: 1},
        {kinds: [RELAY_REMOVE_MEMBER], "#p": [$pubkey], limit: 1},
        {kinds: [ROOM_CREATE_PERMISSION], "#p": [$pubkey], limit: 1},
      ],
    })
  }

  return () => controller.abort()
}

const syncUserRoomMembership = (url: string, h: string) => {
  const $pubkey = pubkey.get()
  const controller = new AbortController()

  if ($pubkey) {
    pullAndListen({
      relays: [url],
      signal: controller.signal,
      filters: [
        {kinds: [ROOM_ADD_MEMBER], "#p": [$pubkey], "#h": [h], limit: 1},
        {kinds: [ROOM_REMOVE_MEMBER], "#p": [$pubkey], "#h": [h], limit: 1},
      ],
    })
  }

  return () => controller.abort()
}

const syncUserData = () => {
  const unsubscribersByKey = new Map<string, Unsubscriber>()

  const unsubscribeGroupList = userGroupList.subscribe($userGroupList => {
    if ($userGroupList) {
      const keys = new Set<string>()

      for (const url of getSpaceUrlsFromGroupList($userGroupList)) {
        if (!unsubscribersByKey.has(url)) {
          unsubscribersByKey.set(url, syncUserSpaceMembership(url))
        }

        keys.add(url)

        for (const h of getSpaceRoomsFromGroupList(url, $userGroupList)) {
          const key = `${url}'${h}`

          if (!unsubscribersByKey.has(key)) {
            unsubscribersByKey.set(key, syncUserRoomMembership(url, h))
          }

          keys.add(key)
        }
      }

      for (const [key, unsubscribe] of unsubscribersByKey.entries()) {
        if (!keys.has(key)) {
          unsubscribersByKey.delete(key)
          unsubscribe()
        }
      }
    }
  })

  const unsubscribeRelayList = userRelayList.subscribe(($userRelayList: any) => {
    if ($userRelayList) {
      loadAlerts($userRelayList.event.pubkey)
      loadAlertStatuses($userRelayList.event.pubkey)
      loadUserBlossomServerList($userRelayList.event.pubkey)
      loadUserFollowList($userRelayList.event.pubkey)
      loadGroupList($userRelayList.event.pubkey)
      loadUserMuteList($userRelayList.event.pubkey)
      loadProfile($userRelayList.event.pubkey)
      loadSettings($userRelayList.event.pubkey)
    }
  })

  const unsubscribeFollows = userFollowList.subscribe(async (_$userFollowList: any) => {
    for (const pubkeys of chunk(10, get(bootstrapPubkeys))) {
      // This isn't urgent, avoid clogging other stuff up
      await sleep(1000)

      await Promise.all(
        pubkeys.map(async pk => {
          await loadUserRelayList(pk)
          await loadGroupList(pk)
          await loadProfile(pk)
          await loadUserFollowList(pk)
          await loadUserMuteList(pk)
        }),
      )
    }
  })

  return () => {
    unsubscribersByKey.forEach(call)
    unsubscribeGroupList()
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
  const store = derived([userSpaceUrls, page], identity)
  const unsubscribersByUrl = new Map<string, Unsubscriber>()
  const unsubscribe = store.subscribe(([$userSpaceUrls, $page]) => {
    const urls = Array.from($userSpaceUrls)

    if ($page.params.relay) {
      let decoded = ""
      try {
        decoded = decodeRelay($page.params.relay)
      } catch {
        decoded = ""
      }

      if (decoded) {
        urls.push(decoded)
      }
    }

    const sanitizedUrls = sanitizeRelayList(urls)

    // stop syncing removed spaces
    for (const [url, unsubscribe] of unsubscribersByUrl.entries()) {
      if (!sanitizedUrls.includes(url)) {
        unsubscribersByUrl.delete(url)
        unsubscribe()
      }
    }

    // Start syncing newly added spaces
    for (const url of sanitizedUrls) {
      if (!unsubscribersByUrl.has(url)) {
        unsubscribersByUrl.set(url, syncBudabitSpace(url))
      }
    }
  })

  return () => {
    for (const unsubscriber of unsubscribersByUrl.values()) {
      unsubscriber()
    }

    unsubscribe()
  }
}

// DMs

const syncDMRelay = (url: string, pubkey: string) => {
  const controller = new AbortController()

  // Load historical data
  pullWithFallback({
    relays: [url],
    signal: controller.signal,
    filters: [{kinds: [WRAP], "#p": [pubkey], until: ago(WEEK, 2)}],
  })

  // Load new events
  request({
    relays: [url],
    signal: controller.signal,
    filters: [{kinds: [WRAP], "#p": [pubkey], since: ago(WEEK, 2)}],
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
  const unsubscribePubkey = derived([pubkey, shouldUnwrap], identity).subscribe(
    ([$pubkey, $shouldUnwrap]) => {
      if ($pubkey !== currentPubkey) {
        unsubscribeAll()
      }

      // If we have a pubkey, refresh our user's relay list then sync our subscriptions
      if ($pubkey && $shouldUnwrap) {
        loadUserRelayList($pubkey).then(() => loadUserMessagingRelayList($pubkey))
      }

      currentPubkey = $pubkey
    },
  )

  // When user messaging relays change, update synchronization
  const unsubscribeList = userMessagingRelayList.subscribe($userMessagingRelayList => {
    const $pubkey = pubkey.get()
    const $shouldUnwrap = shouldUnwrap.get()

    if ($pubkey && $shouldUnwrap) {
      const relayUrls = sanitizeRelayList(getRelayTagValues(getListTags($userMessagingRelayList)))
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

    loadRepositories(pk, mergedRelays)
    loadGraspServers(pk, mergedRelays)
    loadTokens(pk, mergedRelays)
  }

  const ensureNotAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }
  }

  const resolveUserRelays = async (signal: AbortSignal) => {
    const baseRelays = () => sanitizeRelayList(router.FromUser().getUrls())

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
