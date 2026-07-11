<script lang="ts">
  /* global __ALERTS__ */
  import "@src/app.css"
  import "@src/lib/crypto-polyfill"
  import {throttle} from "throttle-debounce"
  import * as nip19 from "nostr-tools/nip19"
  import type {Unsubscriber} from "svelte/store"
  import {get} from "svelte/store"
  import {browser, dev} from "$app/environment"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {sync} from "@welshman/store"
  import {call, spec} from "@welshman/lib"
  import {authPolicy, trustPolicy, mostlyRestrictedPolicy} from "@app/util/policies"
  import {Pool, SocketStatus, defaultSocketPolicies} from "@welshman/net"
  import {
    pubkey,
    loadUserRelayList,
    sessions,
    signerLog,
    shouldUnwrap,
    SignerLogEntryStatus,
    userRelayList,
  } from "@welshman/app"
  import * as lib from "@welshman/lib"
  import * as util from "@welshman/util"
  import * as feeds from "@welshman/feeds"
  import * as router from "@welshman/router"
  import * as welshmanSigner from "@welshman/signer"
  import * as net from "@welshman/net"
  import * as app from "@welshman/app"
  import {ConfigProvider} from "@nostr-git/ui"
  import AppContainer from "@app/components/AppContainer.svelte"
  import ModalContainer from "@app/components/ModalContainer.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import RepoRichCommentComposer from "@app/components/RepoRichCommentComposer.svelte"
  import RepoRichDescriptionEditor from "@app/components/RepoRichDescriptionEditor.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import NostrGitProfileComponent from "@app/components/NostrGitProfileComponent.svelte"
  import NostrGitProfileLink from "@app/components/NostrGitProfileLink.svelte"
  import AvatarImage from "@app/components/SafeAvatarImage.svelte"
  import {setupHistory} from "@app/util/history"
  import {setupGitCorsProxy} from "@app/util/git-cors-proxy"
  import {makeProfilePath} from "@app/util/routes"
  import {userSettingsValues} from "@app/core/state"
  import {db} from "@app/core/storage"
  import {pubkeyStorage, sessionsStorage} from "@app/core/session-storage"
  import {theme} from "@app/util/theme"
  import {initializePushNotifications} from "@app/push"
  import {toast, pushToast} from "@app/util/toast"
  import * as commands from "@app/core/commands"
  import * as requests from "@app/core/requests"
  import * as appState from "@app/core/state"
  import * as notifications from "@app/util/notifications"
  import * as storage from "@app/util/storage"
  import {syncKeyboard} from "@app/util/keyboard"
  import NewNotificationSound from "@src/app/components/NewNotificationSound.svelte"
  import {setupSignerNudgeWatcher} from "@app/util/signer-nudge"
  import {syncApplicationData, syncGitData} from "@app/core/sync"
  import {setupChiiDevInjection} from "@app/util/chii-dev"
  import {setupBudabitNotifications} from "@app/util/notifications"
  import {setupRepoWatchNotifications} from "@app/util/repo-watch-notifications"
  import {ExtensionProvider} from "@src/app/extensions"
  import {installBuiltinExtensions} from "@app/extensions/builtin"
  import {setupWidgetUpdateNotifications} from "@app/extensions/widget-update-notifications"
  import {initializeCashuWallet} from "@app/core/cashu"
  import {registerCashuBridgeHandlers} from "@app/core/cashu-bridge"
  import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
  import CashuPayConfirm from "@app/components/CashuPayConfirm.svelte"
  import {
    activePreferredCommunities,
    activeCommunityDefinition,
    activeCommunityRelays,
    activeCommunitySession,
    clearCommunityBootstrapCache,
    communityPreferencesLoading,
    ensureCommunityBootstrap,
    getCommunityBootstrapKey,
    hydrateCommunityPreferences,
    hydratePreferredCommunities,
    hydratePreferredCommunityList,
    hydratePubkeyProfiles,
    hydrateActiveCommunityUserModeratorRequests,
  } from "@app/core/community-state"

  const {children} = $props()
  const nostrGitProviderProps = /** @type {any} */ ({
    components: {
      AvatarImage,
      ProfileComponent: NostrGitProfileComponent,
      ProfileLink: NostrGitProfileLink,
      CommentStatus: ThunkStatusOrDeleted,
      EventActions,
      ReactionSummary,
      Markdown,
      RichCommentComposer: RepoRichCommentComposer,
      RichInlineCommentComposer: RepoRichCommentComposer,
      RichDescriptionEditor: RepoRichDescriptionEditor,
    },
  })

  const policies = [authPolicy, trustPolicy, mostlyRestrictedPolicy]
  let socketPoliciesInstalled = false

  const installSocketPolicies = () => {
    if (socketPoliciesInstalled) return

    defaultSocketPolicies.push(...policies)
    socketPoliciesInstalled = true
  }

  const uninstallSocketPolicies = () => {
    if (!socketPoliciesInstalled) return

    for (const policy of policies) {
      const index = defaultSocketPolicies.lastIndexOf(policy)

      if (index >= 0) defaultSocketPolicies.splice(index, 1)
    }

    socketPoliciesInstalled = false
  }

  installSocketPolicies()

  const APP_UPDATE_INTERVAL = 2 * 60 * 1000
  const APP_RELOAD_QUERY_KEY = "v"
  const APP_SW_CLEANUP_KEY = "appSwCleanupDone"
  const APP_CACHE_PREFIX = "budabit-app-"
  const APP_EXPECTED_BUILD_STORAGE_KEY = "appExpectedBuildId"
  const APP_RELOAD_RECOVERY_ATTEMPT_KEY = "appReloadRecoveryAttempt"
  const APP_IMPORT_RECOVERY_KEY = "appImportRecoveryBuildId"
  const APP_SERVICE_WORKER_UPDATE_TIMEOUT = 5000
  // Android freezes WebSockets within ~3s of backgrounding a Chromium tab,
  // so the "safe to reuse" window is much shorter than on desktop. Use a
  // shorter idle threshold when we can detect Android, otherwise keep the
  // desktop value that avoids alt-tab false positives.
  const isAndroidUserAgent =
    browser &&
    typeof navigator !== "undefined" &&
    /android/i.test(navigator.userAgent || "")
  const RELAY_RESUME_IDLE_MS = isAndroidUserAgent ? 3_000 : 30_000
  const RELAY_RESUME_THROTTLE_MS = 5_000
  const EXPLORE_NOTIFICATION_STARTUP_DELAY_MS = 4_000
  let updateCheckInterval: number | null = null
  let updateCheckOnFocus: (() => void) | null = null
  let updateCheckOnVisibilityChange: (() => void) | null = null
  let serviceWorkerMessageHandler: ((event: MessageEvent) => void) | null = null
  let appShellErrorHandler: ((event: ErrorEvent | Event) => void) | null = null
  let appShellRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null
  let serviceWorkerReloadInFlight = false
  let updateToastShown = false
  let readyAppUpdateBuildId = ""
  let loadedUserModeratorRequestsKey = ""
  let loadingUserModeratorRequestsKey = ""
  let loadedUserProfileKey = ""
  let loadingUserProfileKey = ""
  let loadedCommunityPreferencesKey = ""
  let loadingCommunityPreferencesKey = ""
  let notificationStartupDelayKey = ""
  let notificationPreferenceLoadingSeenKey = ""
  let notificationStartupTimer: ReturnType<typeof setTimeout> | null = null
  let notificationBackgroundStarted = false
  let notificationBackgroundUnsubscribers: Array<() => void> = []
  let relayResumeHiddenAt = browser && document.visibilityState === "hidden" ? Date.now() : 0
  let relayResumeLastResetAt = 0

  // Add stuff to window for convenience
  Object.assign(window, {
    get,
    nip19,
    theme,
    ...lib,
    ...welshmanSigner,
    ...router,
    ...util,
    ...feeds,
    ...net,
    ...app,
    ...appState,
    ...commands,
    ...requests,
    ...notifications,
    budabitBuildHash: APP_BUILD_HASH,
    budabitBuildId: APP_BUILD_ID,
  })

  // Initialize the external push handler only when email/push alerts are enabled.
  if (__ALERTS__) {
    initializePushNotifications()
  }

  // Keep unwrap enabled globally so wrapped relay traffic does not throw noisily.
  shouldUnwrap.set(true)

  const clearNotificationStartupTimer = () => {
    if (!notificationStartupTimer) return

    clearTimeout(notificationStartupTimer)
    notificationStartupTimer = null
  }

  const startNotificationBackground = () => {
    if (notificationBackgroundStarted) return

    clearNotificationStartupTimer()
    notificationBackgroundStarted = true
    notificationBackgroundUnsubscribers = [
      setupBudabitNotifications(),
      setupRepoWatchNotifications(),
      setupWidgetUpdateNotifications(),
      notifications.badgeCount.subscribe(notifications.handleBadgeCountChanges),
    ]
  }

  const stopNotificationBackground = () => {
    clearNotificationStartupTimer()
    notificationBackgroundUnsubscribers.forEach(call)
    notificationBackgroundUnsubscribers = []
    notificationBackgroundStarted = false
    notificationStartupDelayKey = ""
    notificationPreferenceLoadingSeenKey = ""
  }

  $effect(() => {
    if (!browser || notificationBackgroundStarted) return

    const routeId = $page.route.id || ""
    const user = $pubkey || ""
    const isExploreRoute = routeId === "/explore"

    if (!isExploreRoute) {
      startNotificationBackground()
      return
    }

    if (!user) {
      clearNotificationStartupTimer()
      notificationStartupDelayKey = ""
      notificationPreferenceLoadingSeenKey = ""
      return
    }

    const key = `${routeId}:${user}`
    if ($communityPreferencesLoading) notificationPreferenceLoadingSeenKey = key

    const preferredCommunitiesReady = $activePreferredCommunities.length > 0
    const preferencesSettled =
      notificationPreferenceLoadingSeenKey === key && !$communityPreferencesLoading

    if (preferredCommunitiesReady || preferencesSettled) {
      startNotificationBackground()
      return
    }

    if (notificationStartupDelayKey === key && notificationStartupTimer) return

    clearNotificationStartupTimer()
    notificationStartupDelayKey = key
    notificationStartupTimer = setTimeout(() => {
      startNotificationBackground()
    }, EXPLORE_NOTIFICATION_STARTUP_DELAY_MS)
  })

  $effect(() => {
    const session = $activeCommunitySession
    const inCommunityRoute = $page.route.id?.startsWith("/c/[community]")
    const key = session ? getCommunityBootstrapKey(session, $pubkey || "") : ""

    if (!browser || inCommunityRoute || !session || !key) return

    ensureCommunityBootstrap(session, {key, updateStatus: false}).catch(error => {
      console.warn("[community] Failed to load active community metadata", error)
    })
  })

  $effect(() => {
    const user = $pubkey || ""
    const relayHints = $activeCommunityRelays
    const relayListKey = $userRelayList?.event?.id || ""
    const inExploreRoute = $page.route.id?.startsWith("/explore")
    const key = user ? `${user}:${relayHints.join(",")}:${relayListKey}` : ""

    if (
      !browser ||
      inExploreRoute ||
      !user ||
      !key ||
      loadedCommunityPreferencesKey === key ||
      loadingCommunityPreferencesKey === key
    ) {
      return
    }

    loadingCommunityPreferencesKey = key
    hydrateCommunityPreferences({relayHints})
      .then(() => {
        loadedCommunityPreferencesKey = key
      })
      .catch(error => {
        console.warn("[community] Failed to load community preferences", error)
      })
      .finally(() => {
        if (loadingCommunityPreferencesKey === key) loadingCommunityPreferencesKey = ""
      })
  })

  $effect(() => {
    const definition = $activeCommunityDefinition
    const relays = $activeCommunityRelays
    const key =
      definition && $pubkey && relays.length
        ? `${definition.event.id}:${$pubkey}:${relays.join(",")}`
        : ""

    if (
      !browser ||
      !definition ||
      !key ||
      loadedUserModeratorRequestsKey === key ||
      loadingUserModeratorRequestsKey === key
    )
      return

    loadingUserModeratorRequestsKey = key
    hydrateActiveCommunityUserModeratorRequests({definition, relays})
      .then(() => {
        loadedUserModeratorRequestsKey = key
      })
      .catch(error => {
        console.warn("[community] Failed to load active moderator request status", error)
      })
      .finally(() => {
        if (loadingUserModeratorRequestsKey === key) loadingUserModeratorRequestsKey = ""
      })
  })

  $effect(() => {
    const user = $pubkey || ""
    const relayHints = $activeCommunityRelays
    const key = user ? `${user}:${relayHints.join(",")}` : ""

    if (
      !browser ||
      !user ||
      !key ||
      loadedUserProfileKey === key ||
      loadingUserProfileKey === key
    ) {
      return
    }

    loadingUserProfileKey = key
    hydratePubkeyProfiles({pubkeys: [user], relayHints})
      .then(events => {
        if (events.length > 0) loadedUserProfileKey = key
      })
      .catch(error => {
        console.warn("[profile] Failed to load active user profile", error)
      })
      .finally(() => {
        if (loadingUserProfileKey === key) loadingUserProfileKey = ""
      })
  })

  // Auto-install and enable built-in extensions
  if (browser) {
    setupChiiDevInjection()
    installBuiltinExtensions()
    registerCashuBridgeHandlers(CashuPayConfirm)
  }

  const clearReloadQuery = () => {
    const url = new URL(window.location.href)

    if (!url.searchParams.has(APP_RELOAD_QUERY_KEY)) return

    url.searchParams.delete(APP_RELOAD_QUERY_KEY)
    const state = window.history.state ?? {}
    window.history.replaceState(state, "", url.toString())
  }

  const getAppBaseUrl = () => new URL(import.meta.env.BASE_URL || "/", window.location.origin)

  const getVersionUrl = () => new URL("_app/version.json", getAppBaseUrl()).toString()

  const buildReloadUrl = () => {
    const url = new URL(window.location.href)

    url.searchParams.set(APP_RELOAD_QUERY_KEY, `${Date.now()}`)
    return url.toString()
  }

  const forceReload = () => {
    window.location.replace(buildReloadUrl())
  }

  const getAppServiceWorkerRegistration = async () => {
    if (!browser) return null
    if (dev) return null
    if (!("serviceWorker" in navigator)) return null

    try {
      await navigator.serviceWorker.ready
    } catch {
      // pass
    }

    try {
      const scopePath = getAppBaseUrl().pathname

      return (
        (await navigator.serviceWorker.getRegistration(scopePath)) ||
        (await navigator.serviceWorker.getRegistration())
      )
    } catch {
      return null
    }
  }

  const postSkipWaiting = (registration: ServiceWorkerRegistration) => {
    if (!registration.waiting) return false

    registration.waiting.postMessage({type: "SKIP_WAITING"})
    return true
  }

  const getAppCacheName = (buildId: string) => `${APP_CACHE_PREFIX}${buildId}`

  const hasAppCacheForBuild = async (buildId: string) => {
    if (!buildId) return false
    if (!("caches" in window)) return false

    const keys = await caches.keys()
    return keys.includes(getAppCacheName(buildId))
  }

  const waitForAppCache = async (buildId: string) => {
    const startedAt = Date.now()

    while (Date.now() - startedAt < APP_SERVICE_WORKER_UPDATE_TIMEOUT) {
      if (await hasAppCacheForBuild(buildId)) return true
      await new Promise(resolve => window.setTimeout(resolve, 100))
    }

    return await hasAppCacheForBuild(buildId)
  }

  const waitForInstallingServiceWorker = async (registration: ServiceWorkerRegistration) => {
    if (!registration.installing) return null

    const installingWorker = registration.installing

    if (["installed", "activated"].includes(installingWorker.state)) {
      return registration.waiting || installingWorker
    }

    if (installingWorker.state === "redundant") return null

    return await new Promise<ServiceWorker | null>(resolve => {
      const cleanup = () => {
        clearTimeout(timeout)
        installingWorker.removeEventListener("statechange", onStateChange)
      }

      const onStateChange = () => {
        if (["installed", "activated"].includes(installingWorker.state)) {
          cleanup()
          resolve(registration.waiting || installingWorker)
        }

        if (installingWorker.state === "redundant") {
          cleanup()
          resolve(null)
        }
      }

      const timeout = window.setTimeout(() => {
        cleanup()
        resolve(registration.waiting || null)
      }, APP_SERVICE_WORKER_UPDATE_TIMEOUT)

      installingWorker.addEventListener("statechange", onStateChange)
    })
  }

  const waitForServiceWorkerUpdate = async (registration: ServiceWorkerRegistration) => {
    if (registration.waiting) return registration.waiting
    if (registration.installing) return await waitForInstallingServiceWorker(registration)

    return await new Promise<ServiceWorker | null>(resolve => {
      let settled = false

      const cleanup = () => {
        clearTimeout(timeout)
        registration.removeEventListener("updatefound", onUpdateFound)
      }

      const finish = (worker: ServiceWorker | null) => {
        if (settled) return

        settled = true
        cleanup()
        resolve(worker)
      }

      const onUpdateFound = () => {
        void waitForInstallingServiceWorker(registration).then(finish)
      }

      const timeout = window.setTimeout(() => {
        finish(registration.waiting || null)
      }, APP_SERVICE_WORKER_UPDATE_TIMEOUT)

      registration.addEventListener("updatefound", onUpdateFound)
    })
  }

  const prepareAppUpdate = async (buildId: string) => {
    const registration = await getAppServiceWorkerRegistration()

    if (!registration) return false
    if (registration.waiting && (await waitForAppCache(buildId))) return true

    const updateReady = waitForServiceWorkerUpdate(registration)
    await registration.update()

    const readyWorker = registration.waiting || (await updateReady)
    if (!readyWorker) return false

    return await waitForAppCache(buildId)
  }

  const activateReadyServiceWorker = async () => {
    const registration = await getAppServiceWorkerRegistration()

    if (!registration) return false
    if (postSkipWaiting(registration)) return true

    await waitForInstallingServiceWorker(registration)

    return postSkipWaiting(registration)
  }

  const fetchAppVersion = async () => {
    try {
      const response = await fetch(getVersionUrl(), {
        cache: "no-store",
        headers: {
          pragma: "no-cache",
          "cache-control": "no-cache",
        },
      })
      if (!response.ok) return ""
      const data = await response.json()
      return typeof data?.version === "string" ? data.version : ""
    } catch {
      return ""
    }
  }

  const setExpectedBuildForReload = (buildId: string) => {
    if (!buildId) return
    if (typeof sessionStorage === "undefined") return

    sessionStorage.setItem(APP_EXPECTED_BUILD_STORAGE_KEY, buildId)
    sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
  }

  const requestAppReload = async (expectedBuildId = readyAppUpdateBuildId) => {
    if (!browser) return

    setExpectedBuildForReload(expectedBuildId)

    if (!("serviceWorker" in navigator)) {
      forceReload()
      return
    }

    if (serviceWorkerReloadInFlight) return
    serviceWorkerReloadInFlight = true

    let fallbackTimer: number | null = null

    const cleanup = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }

      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
      serviceWorkerReloadInFlight = false
    }

    const finalizeReload = () => {
      cleanup()
      forceReload()
    }

    const handleControllerChange = () => {
      finalizeReload()
    }

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)
    fallbackTimer = window.setTimeout(finalizeReload, APP_SERVICE_WORKER_UPDATE_TIMEOUT)

    try {
      const activated = await activateReadyServiceWorker()

      if (!activated) {
        finalizeReload()
      }
    } catch {
      finalizeReload()
    }
  }

  const notifyUpdateReady = (buildId: string) => {
    if (!buildId || buildId === APP_BUILD_ID) return

    readyAppUpdateBuildId = buildId

    if (updateToastShown) return

    updateToastShown = true
    pushToast({
      message: "New app version is ready",
      timeout: 0,
      action: {
        message: "Reload",
        onclick: () => void requestAppReload(readyAppUpdateBuildId || buildId),
      },
    })
  }

  const checkForAppUpdate = async () => {
    const version = await fetchAppVersion()
    if (!version) return
    if (version === APP_BUILD_ID) return
    if (version === readyAppUpdateBuildId) return

    try {
      if (await prepareAppUpdate(version)) {
        notifyUpdateReady(version)
      }
    } catch (error) {
      console.warn("[app-update] Failed to prepare app update", error)
    }
  }

  const setupAppUpdatePolling = () => {
    if (!browser) return

    clearReloadQuery()

    if (dev) return

    void checkForAppUpdate()

    updateCheckInterval = window.setInterval(() => {
      void checkForAppUpdate()
    }, APP_UPDATE_INTERVAL)

    updateCheckOnFocus = () => void checkForAppUpdate()
    window.addEventListener("focus", updateCheckOnFocus)

    updateCheckOnVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForAppUpdate()
      }
    }
    document.addEventListener("visibilitychange", updateCheckOnVisibilityChange)
  }

  const resetRelayHydrationKeys = () => {
    loadedCommunityPreferencesKey = ""
    loadingCommunityPreferencesKey = ""
    loadedUserModeratorRequestsKey = ""
    loadingUserModeratorRequestsKey = ""
    loadedUserProfileKey = ""
    loadingUserProfileKey = ""
  }

  const refreshRelaySockets = () => {
    // Selectively refresh sockets instead of clearing the entire Pool. A
    // full clear:
    //   - tears down all EventEmitter listeners (many components subscribe
    //     via deriveSocket/deriveSocketStatus)
    //   - forces NIP-42 auth to fire again for every relay (a thundering
    //     herd on the bunker when NIP-46 is active)
    //   - drops in-flight subscription streams
    //
    // The `Socket` implementation from `@welshman/net` will already reopen
    // the underlying WebSocket on the next `.send()` via
    // `socketPolicyConnectOnSend`, so we only need to remove sockets that
    // are terminally broken.
    for (const url of Array.from(Pool.get()._data.keys())) {
      const socket = Pool.get()._data.get(url)
      if (!socket) continue
      const status = socket.status
      // Remove sockets whose connection is truly gone. Anything else can
      // stay - the reconnect timer + socketPolicyConnectOnSend will
      // recover it lazily when a subscription needs it.
      if (status === SocketStatus.Closed || status === SocketStatus.Error) {
        Pool.get().remove(url)
      }
    }
  }

  const recoverRelayConnections = (reason: string, force = false) => {
    if (!browser) return

    const now = Date.now()
    const hiddenFor = relayResumeHiddenAt ? now - relayResumeHiddenAt : 0
    if (!force && hiddenFor < RELAY_RESUME_IDLE_MS) return
    if (now - relayResumeLastResetAt < RELAY_RESUME_THROTTLE_MS) return

    relayResumeLastResetAt = now
    relayResumeHiddenAt = 0
    refreshRelaySockets()
    // We intentionally do NOT call clearCommunityBootstrapCache() here.
    // The cache prevents redundant loads; the below re-hydration calls
    // pass `force: true` where a refresh is genuinely wanted. Wiping the
    // whole cache made every mobile foreground event re-fetch every
    // community definition even when the definition was fine.
    resetRelayHydrationKeys()

    const user = pubkey.get() || ""
    const relayHints = get(activeCommunityRelays)
    const session = get(activeCommunitySession)

    if (user) {
      loadUserRelayList(user).catch(error => {
        console.warn("[relay-resume] Failed to refresh user relay list", error)
      })
      // Use the fast preferred-list hydration: no relay auth, so a slow
      // bunker cannot stall the resume path.
      hydratePreferredCommunityList({relayHints, force: true}).catch(error => {
        console.warn("[relay-resume] Failed to refresh preferred communities", error)
      })
      hydratePubkeyProfiles({pubkeys: [user], relayHints, force: true}).catch(error => {
        console.warn("[relay-resume] Failed to refresh active user profile", error)
      })
    }

    if (session) {
      ensureCommunityBootstrap(session, {
        key: getCommunityBootstrapKey(session, user),
        updateStatus: false,
      }).catch(error => {
        console.warn("[relay-resume] Failed to refresh active community metadata", error)
      })
    }

    window.dispatchEvent(new CustomEvent("budabit:relay-resume", {detail: {reason}}))
  }

  const setupRelayResumeRecovery = () => {
    if (!browser) return () => {}

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        relayResumeHiddenAt = Date.now()
        return
      }

      recoverRelayConnections("visible")
    }
    const onFocus = () => recoverRelayConnections("focus")
    const onOnline = () => recoverRelayConnections("online", true)

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onFocus)
    window.addEventListener("online", onOnline)

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("online", onOnline)
    }
  }

  const getRegistrationScriptUrl = (registration: ServiceWorkerRegistration) =>
    registration.active?.scriptURL ||
    registration.waiting?.scriptURL ||
    registration.installing?.scriptURL ||
    ""

  const isLegacyServiceWorker = (scriptUrl: string) => {
    try {
      return new URL(scriptUrl).pathname.endsWith("/sw.js")
    } catch {
      return false
    }
  }

  const getLegacyServiceWorkerRegistrations = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()

    return registrations.filter(registration =>
      isLegacyServiceWorker(getRegistrationScriptUrl(registration)),
    )
  }

  const unregisterLegacyServiceWorkers = async () => {
    const legacyRegistrations = await getLegacyServiceWorkerRegistrations()
    await Promise.all(legacyRegistrations.map(registration => registration.unregister()))
  }

  const deleteCachesExcept = async (cacheNameToKeep: string) => {
    if (!("caches" in window)) return

    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key !== cacheNameToKeep).map(key => caches.delete(key)))
  }

  const recoverExpectedBuildReload = async (expectedBuildId: string) => {
    if ("serviceWorker" in navigator) {
      await unregisterLegacyServiceWorkers()
    }

    await deleteCachesExcept(getAppCacheName(expectedBuildId))
    forceReload()
  }

  const resetAppCacheAndReload = async () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(APP_EXPECTED_BUILD_STORAGE_KEY)
      sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(registration => registration.unregister()))
    }

    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }

    forceReload()
  }

  const showAppReloadRecoveryToast = (expectedBuildId: string) => {
    pushToast({
      message: `App update did not finish. Expected ${expectedBuildId}, still running ${APP_BUILD_ID}.`,
      timeout: 0,
      action: {
        message: "Reset cache",
        onclick: () => void resetAppCacheAndReload(),
      },
    })
  }

  const verifyExpectedBuildAfterReload = async () => {
    if (!browser) return true
    if (dev) return true
    if (typeof sessionStorage === "undefined") return true

    const expectedBuildId = sessionStorage.getItem(APP_EXPECTED_BUILD_STORAGE_KEY) || ""
    if (!expectedBuildId) return true

    if (expectedBuildId === APP_BUILD_ID) {
      sessionStorage.removeItem(APP_EXPECTED_BUILD_STORAGE_KEY)
      sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
      return true
    }

    if (sessionStorage.getItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY) !== "1") {
      sessionStorage.setItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY, "1")
      await recoverExpectedBuildReload(expectedBuildId)
      return false
    }

    showAppReloadRecoveryToast(expectedBuildId)
    return false
  }

  const cleanupLegacyServiceWorkers = async () => {
    if (!browser) return
    if (dev) return
    if (!("serviceWorker" in navigator)) return
    if (typeof localStorage === "undefined") return
    if (localStorage.getItem(APP_SW_CLEANUP_KEY) === "1") return

    const legacyRegistrations = await getLegacyServiceWorkerRegistrations()

    if (legacyRegistrations.length === 0) {
      localStorage.setItem(APP_SW_CLEANUP_KEY, "1")
      return
    }

    localStorage.setItem(APP_SW_CLEANUP_KEY, "1")
    await Promise.all(legacyRegistrations.map(registration => registration.unregister()))

    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter(key => !key.startsWith(APP_CACHE_PREFIX)).map(key => caches.delete(key)),
      )
    }

    forceReload()
  }

  const getEventTargetUrl = (event: Event) => {
    const target = event.target

    if (target instanceof HTMLScriptElement) return target.src
    if (target instanceof HTMLLinkElement) return target.href

    return ""
  }

  const getErrorText = (value: unknown): string => {
    if (value instanceof Error) return `${value.message}\n${value.stack || ""}`
    if (typeof value === "string") return value

    try {
      return JSON.stringify(value) || ""
    } catch {
      return String(value)
    }
  }

  const isAppShellAssetReference = (text: string) => text.includes("/_app/immutable/")

  const isDynamicModuleFailure = (text: string) =>
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
      text,
    )

  const isAppShellLoadFailureEvent = (event: ErrorEvent | Event) => {
    const targetUrl = getEventTargetUrl(event)
    if (targetUrl && isAppShellAssetReference(targetUrl)) return true

    if (!(event instanceof ErrorEvent)) return false

    const text = [event.message, event.filename, getErrorText(event.error)].join("\n")
    return isAppShellAssetReference(text) && isDynamicModuleFailure(text)
  }

  const isAppShellLoadFailureReason = (reason: unknown) => {
    const text = getErrorText(reason)
    return isAppShellAssetReference(text) && isDynamicModuleFailure(text)
  }

  const recoverFromAppShellLoadFailure = () => {
    if (!browser) return
    if (typeof sessionStorage === "undefined") return
    if (sessionStorage.getItem(APP_IMPORT_RECOVERY_KEY) === APP_BUILD_ID) return

    sessionStorage.setItem(APP_IMPORT_RECOVERY_KEY, APP_BUILD_ID)
    forceReload()
  }

  const setupAppShellFailureRecovery = () => {
    if (!browser) return
    if (appShellErrorHandler || appShellRejectionHandler) return

    appShellErrorHandler = event => {
      if (!isAppShellLoadFailureEvent(event)) return

      event.preventDefault()
      recoverFromAppShellLoadFailure()
    }

    appShellRejectionHandler = event => {
      if (!isAppShellLoadFailureReason(event.reason)) return

      event.preventDefault()
      recoverFromAppShellLoadFailure()
    }

    window.addEventListener("error", appShellErrorHandler, true)
    window.addEventListener("unhandledrejection", appShellRejectionHandler)
  }

  const initAppUpdates = async () => {
    setupAppShellFailureRecovery()
    await cleanupLegacyServiceWorkers()

    if (!(await verifyExpectedBuildAfterReload())) return

    setupAppUpdatePolling()
  }

  // Listen for navigation messages from service worker
  serviceWorkerMessageHandler = event => {
    const data = event.data

    if (!data || typeof data !== "object") return

    if (data.type === "NAVIGATE") {
      goto(data.url)
      return
    }

    if (data.type === "APP_CACHE_READY" && typeof data.version === "string") {
      notifyUpdateReady(data.version)
    }
  }

  navigator.serviceWorker?.addEventListener("message", serviceWorkerMessageHandler)

  void initAppUpdates()

  // Cleanup on page close
  window.addEventListener("beforeunload", () => db.close())

  const unsubscribe = call(async () => {
    const unsubscribers: Unsubscriber[] = []

    // Sync stuff to localstorage
    await Promise.all([
      sync({
        key: "pubkey",
        store: pubkey,
        storage: pubkeyStorage,
      }),
      sync({
        key: "sessions",
        store: sessions,
        storage: sessionsStorage,
      }),
    ])

    // Eagerly warm up a restored NIP-46 bunker session so the first sign
    // operation doesn't have to open the receiver subscription and do the
    // initial handshake in-band. `signer.getPubkey()` is a cheap no-op call
    // to the bunker (also cached), but it triggers `receiver.start()` which
    // opens the relay subscription to SIGNER_RELAYS. If the bunker is
    // unreachable this simply resolves later and we've paid nothing.
    const currentSession = get(sessions)
    const nip46SessionActive =
      currentSession &&
      Object.values(currentSession).some(
        session => (session as {method?: string})?.method === "nip46",
      )
    if (nip46SessionActive) {
      // Give the derived `signer` store a tick to recompute after `sessions`
      // was populated, then fire the warm-up. Don't await it.
      queueMicrotask(() => {
        const activeSigner = app.signer.get()
        if (!activeSigner) return
        activeSigner
          .getPubkey()
          .catch(error => console.warn("[+layout] Bunker warm-up failed", error))
      })
    }

    // Set up our storage adapters
    db.adapters = storage.adapters

    // Wait until data storage is initialized
    await db.connect()

    // Sanitize malformed relay list events that are already in storage
    // This fixes the "Invalid relay url 0/6/c" errors caused by malformed relay tags
    const sanitizeRelayListEvent = (event: any) => {
      // Only process relay list events (kind 10002 for relay lists, 10050 for messaging relays)
      if (event.kind !== 10002 && event.kind !== 10050) return event

      if (!event.tags || !Array.isArray(event.tags)) return event

      let modified = false
      // Filter and fix relay tags
      const sanitizedTags = event.tags
        .map((tag: any) => {
          if (!Array.isArray(tag) || tag[0] !== "r") return tag

          // Ensure the relay URL (tag[1]) is a valid string
          if (typeof tag[1] !== "string" || tag[1].length === 0) {
            console.warn("[+layout] Filtered invalid relay tag:", tag)
            modified = true
            return null
          }

          let normalized = ""
          try {
            normalized = util.normalizeRelayUrl(tag[1])
          } catch {
            normalized = ""
          }

          if (!normalized || !util.isRelayUrl(normalized)) {
            console.warn("[+layout] Filtered invalid relay tag:", tag)
            modified = true
            return null
          }

          if (normalized !== tag[1]) {
            modified = true
            return [tag[0], normalized, ...tag.slice(2)]
          }

          return tag
        })
        .filter(Boolean)

      if (modified) {
        return {...event, tags: sanitizedTags}
      }
      return event
    }

    // Clean up malformed relay list events from the repository
    const existingRelayLists = app.repository.query([{kinds: [10002, 10050]}])
    for (const event of existingRelayLists) {
      const sanitized = sanitizeRelayListEvent(event)
      if (sanitized !== event) {
        console.log("[+layout] Sanitizing relay list event:", event.id)
        // Remove the old event and add the sanitized version
        app.repository.removeEvent(event.id)
        app.repository.publish(sanitized)
      }
    }

    // Intercept events before they're stored in the repository
    const originalPublish = app.repository.publish.bind(app.repository)
    app.repository.publish = (event: any, options?: any) => {
      const sanitized = sanitizeRelayListEvent(event)
      return originalPublish(sanitized, options)
    }

    // Close the database connection on reload
    unsubscribers.push(() => db.close())

    // Remove policies when we're done
    unsubscribers.push(uninstallSocketPolicies)

    // History, navigation, and application data
    unsubscribers.push(
      setupHistory(),
      setupGitCorsProxy(),
      setupRelayResumeRecovery(),
      syncApplicationData(),
      syncGitData(),
    )
    unsubscribers.push(stopNotificationBackground)

    // Initialize an existing Cashu wallet eagerly so balance is available immediately.
    // If no seed exists, setup remains explicit until the user creates or restores a wallet.
    void initializeCashuWallet()

    // Initialize keyboard state tracking
    unsubscribers.push(syncKeyboard())

    // Show a gentle nudge toast when any signer op has been pending too long,
    // which surfaces bunker slowness before it turns into a chain of failures.
    unsubscribers.push(setupSignerNudgeWatcher())

    // Listen for signer errors, report to user via toast
    unsubscribers.push(
      signerLog.subscribe(
        throttle(10_000, $log => {
          const recent = $log.slice(-10)
          const success = recent.filter(spec({status: SignerLogEntryStatus.Success}))
          const failure = recent.filter(spec({status: SignerLogEntryStatus.Failure}))

          if (!get(toast) && failure.length > 5 && success.length === 0) {
            pushToast({
              theme: "error",
              timeout: 60_000,
              message: "Your signer appears to be unresponsive.",
              action: {
                message: "Details",
                onclick: () => goto(get(pubkey) ? makeProfilePath(get(pubkey)!) : "/settings"),
              },
            })
          }
        }),
      ),
    )

    // Sync theme and font size
    unsubscribers.push(
      theme.subscribe($theme => {
        document.body.setAttribute("data-theme", $theme)
      }),
      userSettingsValues.subscribe($userSettingsValues => {
        // @ts-ignore
        document.documentElement.style["font-size"] = `${$userSettingsValues.font_size}rem`
      }),
    )

    return () => unsubscribers.forEach(call)
  })

  // Cleanup on hot reload
  import.meta.hot?.dispose(() => {
    unsubscribe.then(call)
    uninstallSocketPolicies()

    if (updateCheckInterval) {
      clearInterval(updateCheckInterval)
      updateCheckInterval = null
    }

    if (updateCheckOnFocus) {
      window.removeEventListener("focus", updateCheckOnFocus)
      updateCheckOnFocus = null
    }

    if (updateCheckOnVisibilityChange) {
      document.removeEventListener("visibilitychange", updateCheckOnVisibilityChange)
      updateCheckOnVisibilityChange = null
    }

    if (serviceWorkerMessageHandler) {
      navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessageHandler)
      serviceWorkerMessageHandler = null
    }

    if (appShellErrorHandler) {
      window.removeEventListener("error", appShellErrorHandler, true)
      appShellErrorHandler = null
    }

    if (appShellRejectionHandler) {
      window.removeEventListener("unhandledrejection", appShellRejectionHandler)
      appShellRejectionHandler = null
    }
  })
</script>

{#await unsubscribe}
  <!-- pass -->
{:then}
  <ConfigProvider {...nostrGitProviderProps}>
    <div>
      <ExtensionProvider />
      <AppContainer>
        {@render children()}
      </AppContainer>
      <ModalContainer />
      <div class="tippy-target"></div>
      <NewNotificationSound />
    </div>
  </ConfigProvider>
{/await}
