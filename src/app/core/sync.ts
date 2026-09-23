import type {Unsubscriber} from "svelte/store"
import {derived} from "svelte/store"
import {call, sleep, WEEK, ago} from "@welshman/lib"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {Router} from "@welshman/router"
import {
  pubkey,
  signer,
  loadRelay,
  userRelayList,
  loadUserBlossomServerList,
  loadUserFollowList,
  loadUserMuteList,
} from "@welshman/app"
import {INDEXER_RELAYS, loadSettings} from "@app/core/state"
import {GIT_RELAYS} from "@app/core/git-state"
import {makeDmHistoryFilters} from "@app/core/dm-history"
import {startDmSync, isChatPath} from "@app/core/dm-sync"
import {
  loadGraspServers,
  loadTokens,
  loadExtensionSettings,
  setupGraspServersSync,
  setupTokensSync,
  setupExtensionSettingsSync,
  clearSyncedGitAuthTokens,
} from "@app/core/git-requests"
import {applyRemoteExtensionSettings} from "@app/extensions/settings"
import {loadRepoWatch} from "@app/core/repo-watch"
import {hydrateEmailDigestSettings} from "@app/core/email-digest-state"
import {hydrateCommunityAlertSettings} from "@app/core/community-alerts-state"
import {loadBudabitProfile} from "@app/core/profile-resolver"

// Utils

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
      loadUserBlossomServerList()
      loadUserFollowList()
      loadUserMuteList()
      loadBudabitProfile($userRelayList.event.pubkey)
      loadSettings($userRelayList.event.pubkey)
      loadRepoWatch($userRelayList.event.pubkey)
      void hydrateEmailDigestSettings($userRelayList.event.pubkey).catch(error => {
        console.warn("[email-digest] Failed to hydrate encrypted settings", error)
      })
    }
  })
  const unsubscribeCommunityAlerts = derived(
    [userRelayList, signer],
    ([$userRelayList, $signer]) => ({userRelayList: $userRelayList, signer: $signer}),
  ).subscribe(({userRelayList: $userRelayList, signer: $signer}) => {
    if (!$userRelayList || !$signer) return

    void hydrateCommunityAlertSettings($userRelayList.event.pubkey).catch(error => {
      console.warn("[community-alerts] Failed to hydrate encrypted settings", error)
    })
  })

  return () => {
    unsubscribeRelayList()
    unsubscribeCommunityAlerts()
  }
}

// DMs

export const shouldRefreshDmRelayListsForChat = isChatPath

export const buildDmSyncFilters = (pubkey: string, fullHistory = false) =>
  makeDmHistoryFilters(pubkey).map(filter => ({
    ...filter,
    ...(fullHistory ? {} : {since: ago(WEEK, 2)}),
  }))

// Merge all synchronization functions

export const syncApplicationData = () => {
  const unsubscribers = [syncRelays(), syncUserData(), startDmSync()]

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
