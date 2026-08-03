<script lang="ts">
  import "@src/app.css"
  import "@src/lib/crypto-polyfill"
  import {throttle} from "throttle-debounce"
  import type {Unsubscriber} from "svelte/store"
  import {get} from "svelte/store"
  import {browser, dev} from "$app/environment"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {sync} from "@welshman/store"
  import {call} from "@welshman/lib"
  import {authPolicy, trustPolicy, mostlyRestrictedPolicy} from "@app/util/policies"
  import {installRelayRequestPolicy, relayPolicyRefreshPolicy} from "@app/core/relay-policy"
  import {installRelayDiagnostics} from "@app/core/relay-diagnostics"
  import {defaultSocketPolicies} from "@welshman/net"
  import {pubkey, repository, sessions, signerLog, shouldUnwrap, userRelayList} from "@welshman/app"
  import {normalizeRelayUrl, isRelayUrl} from "@welshman/util"
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
  import {toast, pushToast} from "@app/util/toast"
  import {badgeCount, handleBadgeCountChanges} from "@app/util/notifications"
  import {adapters as storageAdapters} from "@app/util/storage"
  import {syncKeyboard} from "@app/util/keyboard"
  import NewNotificationSound from "@src/app/components/NewNotificationSound.svelte"
  import AppUpdateNotice from "@app/components/AppUpdateNotice.svelte"
  import {syncApplicationData, syncGitData} from "@app/core/sync"
  import {setupChiiDevInjection} from "@app/util/chii-dev"
  import {setupActiveNip46ReceiverResumeRecovery} from "@app/util/nip46"
  import {setupBudabitNotifications} from "@app/util/notifications"
  import {setupRepoWatchNotifications} from "@app/util/repo-watch-notifications"
  import {ExtensionProvider} from "@src/app/extensions"
  import {installBuiltinExtensions} from "@app/extensions/builtin"
  import {setupWidgetUpdateNotifications} from "@app/extensions/widget-update-notifications"
  import {setNotificationBackgroundEnabled} from "@app/util/notification-background"
  import {initializeCashuWallet} from "@app/core/cashu"
  import {registerCashuBridgeHandlers} from "@app/core/cashu-bridge"
  import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
  import {
    getErrorText,
    getExpectedBuildAction,
    isDynamicAppShellFailure,
    shouldPrepareAppUpdate,
  } from "@app/core/app-update"
  import CashuPayConfirm from "@app/components/CashuPayConfirm.svelte"
  import {
    activePreferredCommunities,
    activeCommunityDefinition,
    activeCommunityRelays,
    activeCommunitySession,
    authenticateCommunityRelays,
    COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
    communityPreferencesLoading,
    ensureCommunityBootstrap,
    getCommunityAuthWarmupRelays,
    getCommunityBootstrapKey,
    hydrateCommunityPreferences,
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

  const policies = [relayPolicyRefreshPolicy, authPolicy, trustPolicy, mostlyRestrictedPolicy]
  const uninstallRelayRequestPolicy = installRelayRequestPolicy()
  const uninstallRelayDiagnostics = installRelayDiagnostics({enabled: browser && dev})
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

  const APP_UPDATE_INTERVAL = 30_000
  const APP_UPDATE_RETRY_INITIAL_DELAY = 2_000
  const APP_RELOAD_QUERY_KEY = "v"
  const APP_SW_CLEANUP_KEY = "appSwCleanupDone"
  const APP_CACHE_PREFIX = "budabit-app-"
  const APP_EXPECTED_BUILD_STORAGE_KEY = "appExpectedBuildId"
  const APP_RELOAD_RECOVERY_ATTEMPT_KEY = "appReloadRecoveryAttempt"
  const APP_IMPORT_RECOVERY_KEY = "appImportRecoveryBuildId"
  const APP_SERVICE_WORKER_UPDATE_TIMEOUT = 15_000
  const APP_SERVICE_WORKER_ACTIVATION_TIMEOUT = 30_000
  const DEV_SERVICE_WORKER_RESET_KEY = "devServiceWorkerReset"
  const EXPLORE_NOTIFICATION_STARTUP_DELAY_MS = 4_000
  let updateCheckInterval: number | null = null
  let updateCheckRetryTimer: number | null = null
  let updateCheckRetryDelay = APP_UPDATE_RETRY_INITIAL_DELAY
  let updateCheckOnFocus: (() => void) | null = null
  let updateCheckOnVisibilityChange: (() => void) | null = null
  let updateCheckOnOnline: (() => void) | null = null
  let serviceWorkerMessageHandler: ((event: MessageEvent) => void) | null = null
  let serviceWorkerControllerChangeHandler: (() => void) | null = null
  let appShellErrorHandler: ((event: ErrorEvent | Event) => void) | null = null
  let appShellRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null
  let serviceWorkerReloadInFlight = false
  let updateCheckInFlight: Promise<void> | null = null
  let updateCheckQueued = false
  let readyAppUpdateBuildId = $state("")
  let appUpdateRecoveryMessage = $state("")
  let appUpdateReloading = $state(false)
  let appUpdateActivationDelayed = $state(false)
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
  let communityAuthWarmupKey = ""
  let builtinExtensionInstallFrame: number | null = null
  let builtinExtensionInstallCancelled = false

  // Add stuff to window for convenience. Dev-only so production stays tree-shakeable.
  if (dev) {
    Promise.all([
      import("nostr-tools/nip19"),
      import("@welshman/lib"),
      import("@welshman/signer"),
      import("@welshman/router"),
      import("@welshman/util"),
      import("@welshman/feeds"),
      import("@welshman/net"),
      import("@welshman/app"),
      import("@app/core/state"),
      import("@app/core/commands"),
      import("@app/core/requests"),
      import("@app/util/notifications"),
    ]).then(([nip19, ...modules]) => {
      Object.assign(window, {get, nip19, theme}, ...modules)
    })
  }

  Object.assign(window, {
    budabitBuildHash: APP_BUILD_HASH,
    budabitBuildId: APP_BUILD_ID,
  })

  // Keep unwrap enabled globally so wrapped relay traffic does not throw noisily.
  shouldUnwrap.set(true)

  $effect(() => {
    const user = $pubkey || ""
    const relayHints = getCommunityAuthWarmupRelays($activeCommunitySession, $activeCommunityRelays)
    const priorityRelays = $activeCommunityDefinition?.relays || []
    const key = user ? `${user}:${relayHints.join(",")}` : ""

    if (!browser || !user || relayHints.length === 0) {
      communityAuthWarmupKey = ""
      return
    }

    if (communityAuthWarmupKey === key) return

    communityAuthWarmupKey = key
    authenticateCommunityRelays(relayHints, {
      priorityRelays,
      timeout: COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
    }).catch(error => {
      console.warn("[community] Failed to warm community relay auth", error)
    })
  })

  const clearNotificationStartupTimer = () => {
    if (!notificationStartupTimer) return

    clearTimeout(notificationStartupTimer)
    notificationStartupTimer = null
  }

  const startNotificationBackground = () => {
    if (notificationBackgroundStarted) return

    clearNotificationStartupTimer()
    notificationBackgroundStarted = true
    setNotificationBackgroundEnabled(true)
    notificationBackgroundUnsubscribers = [
      setupBudabitNotifications(),
      setupRepoWatchNotifications(),
      setupWidgetUpdateNotifications(),
      badgeCount.subscribe(handleBadgeCountChanges),
    ]
  }

  const stopNotificationBackground = () => {
    clearNotificationStartupTimer()
    setNotificationBackgroundEnabled(false)
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

  // Browser integrations that do not depend on persisted startup state.
  if (browser) {
    setupChiiDevInjection()
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

  const getAppServiceWorkerRegistration = async (registerIfMissing = false) => {
    if (!browser) return null
    if (dev) return null
    if (!("serviceWorker" in navigator)) return null

    try {
      const scopePath = getAppBaseUrl().pathname
      const registration =
        (await navigator.serviceWorker.getRegistration(scopePath)) ||
        (await navigator.serviceWorker.getRegistration())
      if (registration) return registration

      if (registerIfMissing) {
        const workerUrl = new URL("service-worker.js", getAppBaseUrl()).toString()
        return await navigator.serviceWorker.register(workerUrl, {
          scope: scopePath,
          updateViaCache: "none",
        })
      }

      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve =>
          window.setTimeout(() => resolve(null), APP_SERVICE_WORKER_UPDATE_TIMEOUT),
        ),
      ])
    } catch {
      return null
    }
  }

  const getServiceWorkerVersion = async (worker?: ServiceWorker | null) => {
    if (!worker) return ""

    return await new Promise<string>(resolve => {
      const channel = new MessageChannel()
      let settled = false
      const finish = (buildId = "") => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        channel.port1.close()
        resolve(buildId)
      }
      const timeout = window.setTimeout(() => finish(), 2_000)

      channel.port1.onmessage = event => {
        const data = event.data
        finish(
          data?.type === "APP_CACHE_VERSION" && typeof data.version === "string"
            ? data.version
            : "",
        )
      }

      try {
        worker.postMessage({type: "APP_CACHE_GET_VERSION"}, [channel.port2])
      } catch {
        finish()
      }
    })
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

  const prepareAppUpdate = async (buildId: string): Promise<"active" | "ready" | null> => {
    const registration = await getAppServiceWorkerRegistration(true)

    if (!registration) return null
    if ((await getServiceWorkerVersion(registration.active)) === buildId) return "active"
    if ((await getServiceWorkerVersion(registration.waiting)) === buildId) return "ready"

    const updateReady = waitForServiceWorkerUpdate(registration)
    await registration.update()

    const candidate = registration.waiting || (await updateReady)
    if ((await getServiceWorkerVersion(registration.active)) === buildId) return "active"
    if (!candidate || (await getServiceWorkerVersion(candidate)) !== buildId) return null

    return "ready"
  }

  const activateReadyServiceWorker = async (buildId: string) => {
    const registration = await getAppServiceWorkerRegistration()

    if (!registration) return false
    if ((await getServiceWorkerVersion(registration.waiting)) !== buildId) {
      const prepared = await prepareAppUpdate(buildId)
      if (prepared === "active") return true
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const worker = registration.waiting
      if (!worker || (await getServiceWorkerVersion(worker)) !== buildId) return false
      if (registration.waiting !== worker) continue

      worker.postMessage({type: "SKIP_WAITING"})
      return true
    }

    return false
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
      if (!response.ok) return {version: "", retry: true}
      const data = await response.json()
      const version = typeof data?.version === "string" ? data.version : ""
      return {version, retry: !version || data?.status === "deploying"}
    } catch {
      return {version: "", retry: true}
    }
  }

  const setExpectedBuildForReload = (buildId: string) => {
    if (!buildId) return
    if (typeof sessionStorage === "undefined") return

    sessionStorage.setItem(APP_EXPECTED_BUILD_STORAGE_KEY, buildId)
    sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
  }

  const reloadIntoBuild = (buildId: string) => {
    if (!buildId || buildId === APP_BUILD_ID || serviceWorkerReloadInFlight) return

    serviceWorkerReloadInFlight = true
    setExpectedBuildForReload(buildId)
    forceReload()
  }

  const waitForControllerBuild = async (buildId: string) => {
    if ((await getServiceWorkerVersion(navigator.serviceWorker.controller)) === buildId) return true

    return await new Promise<boolean>(resolve => {
      let settled = false

      const finish = (activated: boolean) => {
        if (settled) return

        settled = true
        window.clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener("controllerchange", inspectController)
        resolve(activated)
      }
      const inspectController = () => {
        void getServiceWorkerVersion(navigator.serviceWorker.controller).then(controllerBuildId => {
          if (controllerBuildId === buildId) finish(true)
        })
      }
      const timeout = window.setTimeout(() => {
        void getServiceWorkerVersion(navigator.serviceWorker.controller).then(controllerBuildId =>
          finish(controllerBuildId === buildId),
        )
      }, APP_SERVICE_WORKER_ACTIVATION_TIMEOUT)

      navigator.serviceWorker.addEventListener("controllerchange", inspectController)
    })
  }

  const requestAppReload = async (expectedBuildId = readyAppUpdateBuildId) => {
    if (!browser || !expectedBuildId || appUpdateReloading) return

    setExpectedBuildForReload(expectedBuildId)
    appUpdateRecoveryMessage = ""
    appUpdateActivationDelayed = false
    appUpdateReloading = true

    if (!("serviceWorker" in navigator)) {
      forceReload()
      return
    }

    try {
      const activationStarted = await activateReadyServiceWorker(expectedBuildId)
      if (activationStarted && (await waitForControllerBuild(expectedBuildId))) {
        reloadIntoBuild(expectedBuildId)
        return
      }

      if (activationStarted) {
        appUpdateActivationDelayed = true
        console.warn(`[app-update] Build ${expectedBuildId} is still activating`)
        void activateReadyServiceWorker(expectedBuildId).catch(error =>
          console.warn("[app-update] Failed to retry delayed activation", error),
        )
        return
      }

      appUpdateRecoveryMessage =
        "The app update could not start. The current version is still available."
    } catch (error) {
      console.warn("[app-update] Failed to activate app update", error)
      appUpdateRecoveryMessage =
        "The app update could not be activated. The current version is still available."
    } finally {
      if (!serviceWorkerReloadInFlight) appUpdateReloading = false
    }
  }

  const notifyUpdateReady = (buildId: string) => {
    if (!buildId || buildId === APP_BUILD_ID) return

    readyAppUpdateBuildId = buildId
    appUpdateRecoveryMessage = ""
    appUpdateActivationDelayed = false
  }

  const resetAppUpdateRetry = () => {
    if (updateCheckRetryTimer !== null) {
      window.clearTimeout(updateCheckRetryTimer)
      updateCheckRetryTimer = null
    }
    updateCheckRetryDelay = APP_UPDATE_RETRY_INITIAL_DELAY
  }

  const scheduleAppUpdateRetry = () => {
    if (updateCheckRetryTimer !== null) return

    const delay = updateCheckRetryDelay
    updateCheckRetryDelay = Math.min(updateCheckRetryDelay * 2, APP_UPDATE_INTERVAL)
    updateCheckRetryTimer = window.setTimeout(() => {
      updateCheckRetryTimer = null
      void checkForAppUpdate()
    }, delay)
  }

  const runAppUpdateCheck = async () => {
    const published = await fetchAppVersion()
    if (published.retry) {
      scheduleAppUpdateRetry()
      return
    }

    resetAppUpdateRetry()
    await getAppServiceWorkerRegistration(true)

    if (
      !shouldPrepareAppUpdate({
        remoteBuildId: published.version,
        runningBuildId: APP_BUILD_ID,
      })
    ) {
      return
    }

    try {
      const prepared = await prepareAppUpdate(published.version)
      if (prepared === "active") reloadIntoBuild(published.version)
      if (prepared === "ready") notifyUpdateReady(published.version)
    } catch (error) {
      console.warn("[app-update] Failed to prepare app update", error)
    }
  }

  const checkForAppUpdate = () => {
    if (updateCheckInFlight) {
      updateCheckQueued = true
      return updateCheckInFlight
    }

    updateCheckInFlight = (async () => {
      do {
        updateCheckQueued = false
        await runAppUpdateCheck()
      } while (updateCheckQueued)
    })().finally(() => {
      updateCheckInFlight = null
    })

    return updateCheckInFlight
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

    updateCheckOnOnline = () => void checkForAppUpdate()
    window.addEventListener("online", updateCheckOnOnline)
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

  const resetAppCacheAndReload = async () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(APP_EXPECTED_BUILD_STORAGE_KEY)
      sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
      sessionStorage.removeItem(APP_IMPORT_RECOVERY_KEY)
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const appBaseUrl = getAppBaseUrl()
      await Promise.all(
        registrations
          .filter(registration => {
            const scope = new URL(registration.scope)
            return scope.origin === appBaseUrl.origin && scope.pathname === appBaseUrl.pathname
          })
          .map(registration => registration.unregister()),
      )
    }

    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter(key => key.startsWith(APP_CACHE_PREFIX)).map(key => caches.delete(key)),
      )
    }

    forceReload()
  }

  const retryAppUpdate = () => {
    const expectedBuildId =
      readyAppUpdateBuildId || sessionStorage.getItem(APP_EXPECTED_BUILD_STORAGE_KEY) || ""
    if (expectedBuildId) {
      appUpdateActivationDelayed = false
      void requestAppReload(expectedBuildId)
    } else {
      appUpdateRecoveryMessage = ""
      void checkForAppUpdate()
    }
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
      readyAppUpdateBuildId = ""
      appUpdateRecoveryMessage = ""
      return true
    }

    const controllerBuildId = await getServiceWorkerVersion(navigator.serviceWorker?.controller)
    const action = getExpectedBuildAction({
      expectedBuildId,
      runningBuildId: APP_BUILD_ID,
      controllerBuildId,
      recoveryAttempted: sessionStorage.getItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY) === "1",
    })

    if (action === "reload") {
      sessionStorage.setItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY, "1")
      forceReload()
      return false
    }

    readyAppUpdateBuildId = expectedBuildId
    appUpdateRecoveryMessage = "App update did not finish. The current version is still available."
    console.warn(
      `[app-update] Expected build ${expectedBuildId}, but build ${APP_BUILD_ID} is still running`,
    )
    return true
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

    const unregisterResults = await Promise.all(
      legacyRegistrations.map(registration => registration.unregister()),
    )
    if (unregisterResults.some(result => !result)) return

    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter(key => !key.startsWith(APP_CACHE_PREFIX)).map(key => caches.delete(key)),
      )
    }

    localStorage.setItem(APP_SW_CLEANUP_KEY, "1")
    forceReload()
  }

  const getEventTargetUrl = (event: Event) => {
    const target = event.target

    if (target instanceof HTMLScriptElement) return target.src
    if (target instanceof HTMLLinkElement) return target.href

    return ""
  }

  const isAppShellAssetReference = (text: string) => text.includes("/_app/immutable/")

  const isAppShellLoadFailureEvent = (event: ErrorEvent | Event) => {
    const targetUrl = getEventTargetUrl(event)
    if (targetUrl && isAppShellAssetReference(targetUrl)) return true

    if (!(event instanceof ErrorEvent)) return false

    const text = [event.message, event.filename, getErrorText(event.error)].join("\n")
    return isDynamicAppShellFailure(text)
  }

  const isAppShellLoadFailureReason = (reason: unknown) => isDynamicAppShellFailure(reason)

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
    try {
      await cleanupLegacyServiceWorkers()
    } catch (error) {
      console.warn("[app-update] Legacy service-worker cleanup failed", error)
    }

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
      void checkForAppUpdate()
      return
    }

    if (data.type === "APP_CACHE_ACTIVATED" && typeof data.version === "string") {
      reloadIntoBuild(data.version)
    }
  }

  navigator.serviceWorker?.addEventListener("message", serviceWorkerMessageHandler)

  serviceWorkerControllerChangeHandler = () => {
    window.setTimeout(() => {
      void getServiceWorkerVersion(navigator.serviceWorker?.controller).then(reloadIntoBuild)
    }, 0)
  }
  navigator.serviceWorker?.addEventListener(
    "controllerchange",
    serviceWorkerControllerChangeHandler,
  )

  void initAppUpdates()

  // Cleanup on page close
  window.addEventListener("beforeunload", () => db.close())

  const prepareDevNavigation = async () => {
    if (!dev || !("serviceWorker" in navigator)) return

    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const cacheNames = "caches" in window ? await caches.keys() : []
      const appCacheNames = cacheNames.filter(name => name.startsWith(APP_CACHE_PREFIX))
      const hasController = Boolean(navigator.serviceWorker.controller)

      if (!hasController && registrations.length === 0 && appCacheNames.length === 0) {
        sessionStorage.removeItem(DEV_SERVICE_WORKER_RESET_KEY)
        return
      }

      await Promise.all(registrations.map(registration => registration.unregister()))
      await Promise.all(appCacheNames.map(name => caches.delete(name)))

      if (!hasController) {
        sessionStorage.removeItem(DEV_SERVICE_WORKER_RESET_KEY)
        return
      }

      if (sessionStorage.getItem(DEV_SERVICE_WORKER_RESET_KEY)) {
        sessionStorage.removeItem(DEV_SERVICE_WORKER_RESET_KEY)
        console.warn("[service-worker] Development worker still controls the page after reset")
        return
      }

      sessionStorage.setItem(DEV_SERVICE_WORKER_RESET_KEY, "1")
      window.location.reload()
      await new Promise<never>(() => {})
    } catch (error) {
      console.warn("[service-worker] Failed to reset development worker state", error)
    }
  }

  const unsubscribe = call(async () => {
    const unsubscribers: Unsubscriber[] = []

    await prepareDevNavigation()

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
    unsubscribers.push(setupActiveNip46ReceiverResumeRecovery())

    // Set up our storage adapters
    db.adapters = storageAdapters

    // A stale delete request or another open mobile/PWA context can block an
    // IndexedDB open indefinitely. Continue with in-memory state instead of
    // making the whole application wait forever; the pending connection can
    // still initialize the adapters if the blocker later disappears.
    await db.connectWithTimeout()

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
            normalized = normalizeRelayUrl(tag[1])
          } catch {
            normalized = ""
          }

          if (!normalized || !isRelayUrl(normalized)) {
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
    const existingRelayLists = repository.query([{kinds: [10002, 10050]}])
    for (const event of existingRelayLists) {
      const sanitized = sanitizeRelayListEvent(event)
      if (sanitized !== event) {
        console.log("[+layout] Sanitizing relay list event:", event.id)
        // Remove the old event and add the sanitized version
        repository.removeEvent(event.id)
        repository.publish(sanitized)
      }
    }

    // Intercept events before they're stored in the repository
    const originalPublish = repository.publish.bind(repository)
    repository.publish = (event: any, options?: any) => {
      const sanitized = sanitizeRelayListEvent(event)
      return originalPublish(sanitized, options)
    }

    // Close the database connection on reload
    unsubscribers.push(() => db.close())

    // Remove policies when we're done
    unsubscribers.push(
      uninstallSocketPolicies,
      uninstallRelayRequestPolicy,
      uninstallRelayDiagnostics,
    )

    // History, navigation, and application data
    unsubscribers.push(setupHistory(), setupGitCorsProxy(), syncApplicationData(), syncGitData())
    unsubscribers.push(stopNotificationBackground)

    // Initialize an existing Cashu wallet eagerly so balance is available immediately.
    // If no seed exists, setup remains explicit until the user creates or restores a wallet.
    void initializeCashuWallet()

    // Initialize keyboard state tracking
    unsubscribers.push(syncKeyboard())

    // Listen for signer errors, report to user via toast
    unsubscribers.push(
      signerLog.subscribe(
        throttle(10_000, $log => {
          const recent = $log.slice(-10)
          const success = recent.filter((entry: {ok?: boolean}) => entry.ok === true)
          const failure = recent.filter((entry: {ok?: boolean}) => entry.ok === false)

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

  if (browser) {
    void unsubscribe.then(() => {
      if (builtinExtensionInstallCancelled) return

      // Let the child route mount and begin its community bootstrap before
      // built-in widgets issue any background relay requests.
      builtinExtensionInstallFrame = requestAnimationFrame(() => {
        if (builtinExtensionInstallCancelled) return

        builtinExtensionInstallFrame = null
        installBuiltinExtensions()
      })
    })
  }

  // Cleanup on hot reload
  import.meta.hot?.dispose(() => {
    builtinExtensionInstallCancelled = true
    unsubscribe.then(call)

    if (builtinExtensionInstallFrame !== null) {
      cancelAnimationFrame(builtinExtensionInstallFrame)
      builtinExtensionInstallFrame = null
    }
    uninstallSocketPolicies()
    uninstallRelayRequestPolicy()
    uninstallRelayDiagnostics()

    if (updateCheckInterval) {
      clearInterval(updateCheckInterval)
      updateCheckInterval = null
    }

    if (updateCheckRetryTimer !== null) {
      clearTimeout(updateCheckRetryTimer)
      updateCheckRetryTimer = null
    }

    if (updateCheckOnFocus) {
      window.removeEventListener("focus", updateCheckOnFocus)
      updateCheckOnFocus = null
    }

    if (updateCheckOnVisibilityChange) {
      document.removeEventListener("visibilitychange", updateCheckOnVisibilityChange)
      updateCheckOnVisibilityChange = null
    }

    if (updateCheckOnOnline) {
      window.removeEventListener("online", updateCheckOnOnline)
      updateCheckOnOnline = null
    }

    if (serviceWorkerMessageHandler) {
      navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessageHandler)
      serviceWorkerMessageHandler = null
    }

    if (serviceWorkerControllerChangeHandler) {
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        serviceWorkerControllerChangeHandler,
      )
      serviceWorkerControllerChangeHandler = null
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

<AppUpdateNotice
  readyBuildId={readyAppUpdateBuildId}
  recoveryMessage={appUpdateRecoveryMessage}
  busy={appUpdateReloading}
  activationDelayed={appUpdateActivationDelayed}
  onReload={() => void requestAppReload()}
  onRetry={retryAppUpdate}
  onReset={() => void resetAppCacheAndReload()} />

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
