<script lang="ts">
  import {onDestroy} from "svelte"
  import "@src/app.css"
  import "@src/lib/crypto-polyfill"
  import {throttle} from "throttle-debounce"
  import type {Unsubscriber} from "svelte/store"
  import {get} from "svelte/store"
  import {browser, dev} from "$app/environment"
  import {goto, onNavigate} from "$app/navigation"
  import {page} from "$app/stores"
  import {sync} from "@welshman/store"
  import {call} from "@welshman/lib"
  import {authPolicy, trustPolicy, mostlyRestrictedPolicy} from "@app/util/policies"
  import {installRelayRequestPolicy, relayPolicyRefreshPolicy} from "@app/core/relay-policy"
  import {installRelayWriteCapabilityPolicy} from "@app/core/relay-write-capabilities"
  import {installRelayDebugDiagnostics, installRelayDiagnostics} from "@app/core/relay-diagnostics"
  import {defaultSocketPolicies} from "@welshman/net"
  import {pubkey, sessions, signerLog, shouldUnwrap, userRelayList} from "@welshman/app"
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
  import {setupRepositoryCache} from "@app/core/repo-cache"
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
  import {setupNotificationUnreadHints} from "@app/util/notification-center"
  import {setupRepoWatchNotifications} from "@app/util/repo-watch-notifications"
  import {ExtensionProvider} from "@src/app/extensions"
  import {installBuiltinExtensions} from "@app/extensions/builtin"
  import {setupWidgetUpdateNotifications} from "@app/extensions/widget-update-notifications"
  import {cancelQueuedNotificationEvents} from "@app/util/notification-events"
  import {
    scheduleNotificationBackgroundAdmission,
    scheduleNotificationBackgroundStages,
    setNotificationBackgroundEnabled,
  } from "@app/util/notification-background"
  import {
    APP_UPDATE_MODE,
    CASHU_WALLET_ENABLED,
    DIAGNOSTICS_ENABLED,
    PERFORMANCE_DIAGNOSTICS_ENABLED,
  } from "@app/core/feature-flags"
  import {hasStoredBroadcastPreparation} from "@app/extensions/community-media-state"
  import {
    ensureAppUpdateDebugDiagnosticsCapture,
    isAppUpdateDebugDiagnosticsActive,
    recordAppUpdateDebugDiagnostic as writeAppUpdateDebugDiagnostic,
    refreshDebugDiagnosticsSettings,
    restoreDebugDiagnosticsCapture,
  } from "@app/core/debug-diagnostics"
  import {installPublicationDebugDiagnostics} from "@app/core/publication-diagnostics"
  import {
    activePerformanceDiagnosticsRun,
    consumeArmedPerformanceDiagnosticsCapture,
    measurePerformanceDiagnosticsWork,
    stopPerformanceDiagnosticsCapture,
  } from "@app/core/performance-diagnostics"
  import {startCashuWalletInBackground} from "@app/core/cashu"
  import {registerCashuBridgeHandlers} from "@app/core/cashu-bridge"
  import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
  import {
    getErrorText,
    getExpectedBuildAction,
    getPreparedBuildBlocker,
    getStartupUpdateBlocker,
    isDynamicAppShellFailure,
    shouldPrepareAppUpdate,
  } from "@app/core/app-update"
  import CashuPayConfirm from "@app/components/CashuPayConfirm.svelte"
  import {
    activePreferredCommunities,
    activeExactCommunityDefinition,
    activeExactCommunityRelays,
    activeExactCommunitySession,
    activeUserCommunityRefs,
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
  import {getProfileCommunityRelaysFromRefs} from "@app/core/community-relays"
  import {resolvePrivateCommunityScope} from "@app/core/private-community-scope"

  const {children} = $props()

  // Startup auto-update gate (APP_UPDATE_MODE=auto): any user input in this document, including
  // assistive-technology activation (click/focus) and IME composition, keeps the running build.
  let appUserInputSeen = false
  const APP_USER_INPUT_EVENTS = [
    "pointerdown",
    "mousedown",
    "touchstart",
    "keydown",
    "compositionstart",
    "beforeinput",
    "input",
    "click",
    "focusin",
    "paste",
    "drop",
    "contextmenu",
  ]
  if (browser && APP_UPDATE_MODE === "auto") {
    const markUserInput = (event: Event) => {
      // Browsers focus <body> when page content gains focus (e.g. after an address-bar
      // navigation). Only focus landing on a real element counts as interaction.
      if (event.type === "focusin") {
        const target = event.target
        if (
          !(target instanceof Element) ||
          target === document.body ||
          target === document.documentElement
        ) {
          return
        }
      }
      appUserInputSeen = true
      for (const type of APP_USER_INPUT_EVENTS) {
        window.removeEventListener(type, markUserInput, true)
      }
    }
    for (const type of APP_USER_INPUT_EVENTS) {
      window.addEventListener(type, markUserInput, {capture: true, passive: true})
    }
  }

  if (browser) {
    resolvePrivateCommunityScope(new URL(window.location.href))
  }
  if (browser && PERFORMANCE_DIAGNOSTICS_ENABLED) {
    consumeArmedPerformanceDiagnosticsCapture(window.location.pathname)
  }
  if (browser && DIAGNOSTICS_ENABLED) {
    refreshDebugDiagnosticsSettings()
    restoreDebugDiagnosticsCapture()
    ensureAppUpdateDebugDiagnosticsCapture()
  }
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
  const uninstallRelayWriteCapabilityPolicy = browser
    ? installRelayWriteCapabilityPolicy()
    : () => {}
  onDestroy(uninstallRelayWriteCapabilityPolicy)
  const uninstallRelayDiagnostics = installRelayDiagnostics({enabled: browser && dev})
  const uninstallRelayDebugDiagnostics = installRelayDebugDiagnostics({
    enabled: browser && DIAGNOSTICS_ENABLED,
  })
  const uninstallPublicationDebugDiagnostics = installPublicationDebugDiagnostics({
    enabled: browser && DIAGNOSTICS_ENABLED,
  })
  onDestroy(uninstallRelayDebugDiagnostics)
  onDestroy(uninstallPublicationDebugDiagnostics)
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
  // Auto mode: no update check runs before the startup gate has finished (prompt mode: always).
  let autoUpdateStartupGateDone = APP_UPDATE_MODE !== "auto"
  // Auto mode: status shown while this document is held unrendered for an activation.
  let startupHoldMessage = $state("")
  let startupHoldSlow = $state(false)
  let loadedUserModeratorRequestsKey = ""
  let loadingUserModeratorRequestsKey = ""
  let userProfileHydrationIdentity = ""
  let userProfileHydrationAttempted = false
  let userProfileHydrationController: AbortController | null = null
  let loadedCommunityPreferencesKey = ""
  let loadingCommunityPreferencesKey = ""
  let notificationStartupDelayKey = ""
  let notificationPreferenceLoadingSeenKey = ""
  let notificationStartupTimer: ReturnType<typeof setTimeout> | null = null
  let cancelNotificationAdmission: (() => void) | null = null
  let cancelNotificationStages: (() => void) | null = null
  let notificationAdmissionKey = ""
  let notificationBackgroundStarted = false
  let notificationBackgroundUnsubscribers: Array<() => void> = []
  let notificationRootReady = $state(false)
  let notificationNavigationGeneration = $state(0)
  let communityAuthWarmupKey = ""
  let builtinExtensionInstallFrame: number | null = null
  let builtinExtensionInstallCancelled = false
  let appUpdateActivationRequestSequence = 0
  const trackedAppUpdateWorkers = new WeakSet<ServiceWorker>()

  const recordAppUpdateDebugDiagnostic = (type: string, detail?: unknown) => {
    if (!DIAGNOSTICS_ENABLED) return false
    return writeAppUpdateDebugDiagnostic(type, detail)
  }

  const describeAppUpdateWorker = (worker?: ServiceWorker | null) => {
    if (!worker) return null
    let scriptPath = ""
    try {
      scriptPath = new URL(worker.scriptURL).pathname
    } catch {
      scriptPath = worker.scriptURL
    }
    return {state: worker.state, scriptPath}
  }

  const describeAppUpdateRegistration = (registration?: ServiceWorkerRegistration | null) =>
    registration
      ? {
          scopePath: new URL(registration.scope).pathname,
          active: describeAppUpdateWorker(registration.active),
          waiting: describeAppUpdateWorker(registration.waiting),
          installing: describeAppUpdateWorker(registration.installing),
          controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
        }
      : null

  const trackAppUpdateWorker = (worker?: ServiceWorker | null, role = "worker") => {
    if (!DIAGNOSTICS_ENABLED || !worker || trackedAppUpdateWorkers.has(worker)) return
    trackedAppUpdateWorkers.add(worker)
    worker.addEventListener("statechange", () => {
      recordAppUpdateDebugDiagnostic("worker-state-change", {
        role,
        worker: describeAppUpdateWorker(worker),
      })
    })
  }

  const configureAppUpdateFetchDiagnostics = (worker?: ServiceWorker | null) => {
    if (!DIAGNOSTICS_ENABLED || !worker || !isAppUpdateDebugDiagnosticsActive()) return
    try {
      worker.postMessage({type: "APP_CACHE_SET_FETCH_DIAGNOSTICS", enabled: true})
    } catch (error) {
      recordAppUpdateDebugDiagnostic("fetch-diagnostics-config-error", {error})
    }
  }

  if (browser && DIAGNOSTICS_ENABLED) {
    recordAppUpdateDebugDiagnostic("layout-loaded", {
      visibilityState: document.visibilityState,
      expectedBuildId: sessionStorage.getItem(APP_EXPECTED_BUILD_STORAGE_KEY) || "",
      recoveryAttempted: sessionStorage.getItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY) === "1",
      controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
    })
  }

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
    const relayHints = getCommunityAuthWarmupRelays(
      $activeExactCommunitySession,
      $activeExactCommunityRelays,
    )
    const priorityRelays = $activeExactCommunityDefinition?.relays || []
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

  const clearNotificationAdmission = () => {
    cancelNotificationAdmission?.()
    cancelNotificationAdmission = null
    notificationAdmissionKey = ""
  }

  const startNotificationBackground = () => {
    if (notificationBackgroundStarted) return

    clearNotificationStartupTimer()
    clearNotificationAdmission()
    notificationBackgroundStarted = true
    const startStage = (phase: string, setup: () => () => void) => () => {
      if (!notificationBackgroundStarted) return
      const unsubscribe = measurePerformanceDiagnosticsWork(
        {owner: "notification-background", phase, recordAll: true},
        setup,
      )
      notificationBackgroundUnsubscribers.push(unsubscribe)
    }
    cancelNotificationStages = scheduleNotificationBackgroundStages([
      startStage("budabit-sources", () => {
        const unsubscribe = setupBudabitNotifications()
        setNotificationBackgroundEnabled(true)
        return unsubscribe
      }),
      startStage("center-unread", setupNotificationUnreadHints),
      startStage("repo-watch", setupRepoWatchNotifications),
      startStage("widget-updates", setupWidgetUpdateNotifications),
      startStage("badge-projection", () => badgeCount.subscribe(handleBadgeCountChanges)),
    ])
  }

  const scheduleNotificationBackground = (key: string) => {
    if (notificationBackgroundStarted) return
    if (notificationAdmissionKey === key && cancelNotificationAdmission) return
    clearNotificationAdmission()
    notificationAdmissionKey = key
    cancelNotificationAdmission = scheduleNotificationBackgroundAdmission(() => {
      cancelNotificationAdmission = null
      startNotificationBackground()
    })
  }

  const stopNotificationBackground = () => {
    clearNotificationStartupTimer()
    clearNotificationAdmission()
    cancelNotificationStages?.()
    cancelNotificationStages = null
    setNotificationBackgroundEnabled(false)
    cancelQueuedNotificationEvents()
    notificationBackgroundUnsubscribers.forEach(call)
    notificationBackgroundUnsubscribers = []
    notificationBackgroundStarted = false
    notificationStartupDelayKey = ""
    notificationPreferenceLoadingSeenKey = ""
  }

  if (browser) {
    onNavigate(navigation => {
      if (navigation.from?.url.pathname === navigation.to?.url.pathname) return
      const activePerformanceRun = get(activePerformanceDiagnosticsRun)
      if (activePerformanceRun?.route === navigation.from?.url.pathname) {
        stopPerformanceDiagnosticsCapture("cancelled")
      }
      stopNotificationBackground()
      return () => {
        notificationNavigationGeneration += 1
      }
    })
  }

  $effect(() => {
    void notificationNavigationGeneration
    if (!browser || !notificationRootReady || notificationBackgroundStarted) return

    const routeId = $page.route.id || ""
    const user = $pubkey || ""
    const isExploreRoute = routeId === "/explore"

    if (!isExploreRoute) {
      scheduleNotificationBackground(`${routeId}:${user}`)
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
      scheduleNotificationBackground(key)
      return
    }

    if (notificationStartupDelayKey === key && notificationStartupTimer) return

    clearNotificationStartupTimer()
    notificationStartupDelayKey = key
    notificationStartupTimer = setTimeout(() => {
      scheduleNotificationBackground(key)
    }, EXPLORE_NOTIFICATION_STARTUP_DELAY_MS)
  })

  $effect(() => {
    const session = $activeExactCommunitySession
    const inCommunityRoute = $page.route.id?.startsWith("/c/[community]")
    const key = session ? getCommunityBootstrapKey(session, $pubkey || "") : ""

    if (!browser || inCommunityRoute || !session || !key) return

    ensureCommunityBootstrap(session, {key, updateStatus: false}).catch(error => {
      console.warn("[community] Failed to load active community metadata", error)
    })
  })

  $effect(() => {
    const user = $pubkey || ""
    const suppressFullCommunityPreferences = ["/explore", "/git"].includes($page.route.id || "")
    const relayHints = $activeExactCommunityRelays
    const relayListKey = $userRelayList?.event?.id || ""
    const key = user ? `${user}:${relayHints.join(",")}:${relayListKey}` : ""

    if (
      !browser ||
      suppressFullCommunityPreferences ||
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
    const definition = $activeExactCommunityDefinition
    const relays = $activeExactCommunityRelays
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
    const communityRefs = $activeUserCommunityRefs

    if (userProfileHydrationIdentity !== user) {
      userProfileHydrationController?.abort()
      userProfileHydrationController = null
      userProfileHydrationIdentity = user
      userProfileHydrationAttempted = false
    }

    if (!browser || !user || userProfileHydrationAttempted || communityRefs.length === 0) return

    userProfileHydrationAttempted = true
    const relayHints = getProfileCommunityRelaysFromRefs(communityRefs)
    if (relayHints.length === 0) return

    const controller = new AbortController()
    userProfileHydrationController = controller
    void hydratePubkeyProfiles({
      pubkeys: [user],
      relayHints,
      signal: controller.signal,
      timeout: 3000,
    })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn("[profile] Failed to load active user profile", error)
        }
      })
      .finally(() => {
        if (userProfileHydrationController === controller) {
          userProfileHydrationController = null
        }
      })
  })

  onDestroy(() => userProfileHydrationController?.abort())

  // Browser integrations that do not depend on persisted startup state.
  if (browser) {
    setupChiiDevInjection()
    if (CASHU_WALLET_ENABLED) registerCashuBridgeHandlers(CashuPayConfirm)
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
    recordAppUpdateDebugDiagnostic("reload-navigation", {
      pathname: window.location.pathname,
      controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
    })
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
      if (registration) {
        trackAppUpdateWorker(registration.active, "active")
        trackAppUpdateWorker(registration.waiting, "waiting")
        trackAppUpdateWorker(registration.installing, "installing")
        configureAppUpdateFetchDiagnostics(registration.active)
        recordAppUpdateDebugDiagnostic("registration-found", {
          registerIfMissing,
          registration: describeAppUpdateRegistration(registration),
        })
        return registration
      }

      if (registerIfMissing) {
        const workerUrl = new URL("service-worker.js", getAppBaseUrl()).toString()
        const registered = await navigator.serviceWorker.register(workerUrl, {
          scope: scopePath,
          updateViaCache: "none",
        })
        trackAppUpdateWorker(registered.active, "active")
        trackAppUpdateWorker(registered.waiting, "waiting")
        trackAppUpdateWorker(registered.installing, "installing")
        recordAppUpdateDebugDiagnostic("registration-created", {
          registration: describeAppUpdateRegistration(registered),
        })
        return registered
      }

      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve =>
          window.setTimeout(() => resolve(null), APP_SERVICE_WORKER_UPDATE_TIMEOUT),
        ),
      ])
      recordAppUpdateDebugDiagnostic("registration-ready-result", {
        registration: describeAppUpdateRegistration(ready),
      })
      return ready
    } catch (error) {
      recordAppUpdateDebugDiagnostic("registration-error", {registerIfMissing, error})
      return null
    }
  }

  const getServiceWorkerVersion = async (worker?: ServiceWorker | null, role = "unspecified") => {
    if (!worker) return ""
    trackAppUpdateWorker(worker, role)

    return await new Promise<string>(resolve => {
      const channel = new MessageChannel()
      let settled = false
      const startedAt = performance.now()
      const finish = (buildId = "", outcome = "response") => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        channel.port1.close()
        recordAppUpdateDebugDiagnostic("worker-version-result", {
          role,
          outcome,
          buildId,
          durationMs: Math.max(0, performance.now() - startedAt),
          worker: describeAppUpdateWorker(worker),
        })
        resolve(buildId)
      }
      const timeout = window.setTimeout(() => finish("", "timeout"), 2_000)

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
      } catch (error) {
        recordAppUpdateDebugDiagnostic("worker-version-post-error", {role, error})
        finish("", "post-error")
      }
    })
  }

  const getServiceWorkerFetchActivity = async (
    worker: ServiceWorker | null | undefined,
    requestId: string,
    phase = "before-skip",
  ) => {
    if (!DIAGNOSTICS_ENABLED || !worker || !isAppUpdateDebugDiagnosticsActive()) return null

    return await new Promise<unknown>(resolve => {
      const channel = new MessageChannel()
      let settled = false
      const finish = (activity: unknown, outcome = "response") => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        channel.port1.close()
        recordAppUpdateDebugDiagnostic("active-worker-fetch-activity", {
          requestId,
          phase,
          outcome,
          activity,
          worker: describeAppUpdateWorker(worker),
        })
        resolve(activity)
      }
      const timeout = window.setTimeout(() => finish(null, "timeout"), 2_000)

      channel.port1.onmessage = event => {
        const data = event.data
        finish(data?.type === "APP_CACHE_FETCH_ACTIVITY" ? data : null)
      }

      try {
        worker.postMessage({type: "APP_CACHE_GET_FETCH_ACTIVITY", requestId}, [channel.port2])
      } catch (error) {
        recordAppUpdateDebugDiagnostic("fetch-activity-post-error", {requestId, error})
        finish(null, "post-error")
      }
    })
  }

  const waitForInstallingServiceWorker = async (registration: ServiceWorkerRegistration) => {
    if (!registration.installing) return null

    const installingWorker = registration.installing
    trackAppUpdateWorker(installingWorker, "installing")
    recordAppUpdateDebugDiagnostic("installation-observed", {
      registration: describeAppUpdateRegistration(registration),
    })

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
          recordAppUpdateDebugDiagnostic("installation-finished", {
            registration: describeAppUpdateRegistration(registration),
          })
          resolve(registration.waiting || installingWorker)
        }

        if (installingWorker.state === "redundant") {
          cleanup()
          recordAppUpdateDebugDiagnostic("installation-redundant", {
            registration: describeAppUpdateRegistration(registration),
          })
          resolve(null)
        }
      }

      const timeout = window.setTimeout(() => {
        cleanup()
        recordAppUpdateDebugDiagnostic("installation-timeout", {
          timeoutMs: APP_SERVICE_WORKER_UPDATE_TIMEOUT,
          registration: describeAppUpdateRegistration(registration),
        })
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
        trackAppUpdateWorker(registration.installing, "installing")
        recordAppUpdateDebugDiagnostic("registration-update-found", {
          registration: describeAppUpdateRegistration(registration),
        })
        void waitForInstallingServiceWorker(registration).then(finish)
      }

      const timeout = window.setTimeout(() => {
        recordAppUpdateDebugDiagnostic("registration-update-timeout", {
          timeoutMs: APP_SERVICE_WORKER_UPDATE_TIMEOUT,
          registration: describeAppUpdateRegistration(registration),
        })
        finish(registration.waiting || null)
      }, APP_SERVICE_WORKER_UPDATE_TIMEOUT)

      registration.addEventListener("updatefound", onUpdateFound)
    })
  }

  const prepareAppUpdate = async (buildId: string): Promise<"active" | "ready" | null> => {
    recordAppUpdateDebugDiagnostic("prepare-started", {expectedBuildId: buildId})
    const registration = await getAppServiceWorkerRegistration(true)

    if (!registration) {
      recordAppUpdateDebugDiagnostic("prepare-finished", {expectedBuildId: buildId, result: null})
      return null
    }
    if ((await getServiceWorkerVersion(registration.active, "active")) === buildId) {
      recordAppUpdateDebugDiagnostic("prepare-finished", {
        expectedBuildId: buildId,
        result: "active",
      })
      return "active"
    }
    if ((await getServiceWorkerVersion(registration.waiting, "waiting")) === buildId) {
      recordAppUpdateDebugDiagnostic("prepare-finished", {
        expectedBuildId: buildId,
        result: "ready",
      })
      return "ready"
    }

    const updateReady = waitForServiceWorkerUpdate(registration)
    recordAppUpdateDebugDiagnostic("registration-update-requested", {
      expectedBuildId: buildId,
      registration: describeAppUpdateRegistration(registration),
    })
    await registration.update()

    const candidate = registration.waiting || (await updateReady)
    trackAppUpdateWorker(candidate, "candidate")
    if ((await getServiceWorkerVersion(registration.active, "active")) === buildId) {
      recordAppUpdateDebugDiagnostic("prepare-finished", {
        expectedBuildId: buildId,
        result: "active",
      })
      return "active"
    }
    if (!candidate || (await getServiceWorkerVersion(candidate, "candidate")) !== buildId) {
      recordAppUpdateDebugDiagnostic("prepare-finished", {
        expectedBuildId: buildId,
        result: null,
        registration: describeAppUpdateRegistration(registration),
      })
      return null
    }

    recordAppUpdateDebugDiagnostic("prepare-finished", {expectedBuildId: buildId, result: "ready"})
    return "ready"
  }

  const activateReadyServiceWorker = async (buildId: string) => {
    recordAppUpdateDebugDiagnostic("activation-attempt-started", {expectedBuildId: buildId})
    const registration = await getAppServiceWorkerRegistration()

    if (!registration) {
      recordAppUpdateDebugDiagnostic("activation-attempt-finished", {
        expectedBuildId: buildId,
        result: "registration-missing",
      })
      return false
    }
    if ((await getServiceWorkerVersion(registration.waiting, "waiting")) !== buildId) {
      const prepared = await prepareAppUpdate(buildId)
      if (prepared === "active") {
        recordAppUpdateDebugDiagnostic("activation-attempt-finished", {
          expectedBuildId: buildId,
          result: "already-active",
        })
        return true
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const worker = registration.waiting
      if (!worker || (await getServiceWorkerVersion(worker, "waiting")) !== buildId) {
        recordAppUpdateDebugDiagnostic("activation-attempt-finished", {
          expectedBuildId: buildId,
          result: "waiting-worker-mismatch",
          attempt,
          registration: describeAppUpdateRegistration(registration),
        })
        return false
      }
      if (registration.waiting !== worker) continue

      trackAppUpdateWorker(worker, "activation-target")
      appUpdateActivationRequestSequence += 1
      const requestId = `${APP_BUILD_ID}:${Date.now()}:${appUpdateActivationRequestSequence}`
      await getServiceWorkerFetchActivity(navigator.serviceWorker.controller, requestId)
      recordAppUpdateDebugDiagnostic("skip-waiting-posted", {
        requestId,
        expectedBuildId: buildId,
        attempt,
        registration: describeAppUpdateRegistration(registration),
      })
      worker.postMessage({
        type: "SKIP_WAITING",
        requestId,
        diagnostics: DIAGNOSTICS_ENABLED && isAppUpdateDebugDiagnosticsActive(),
      })
      return true
    }

    recordAppUpdateDebugDiagnostic("activation-attempt-finished", {
      expectedBuildId: buildId,
      result: "waiting-worker-raced",
      registration: describeAppUpdateRegistration(registration),
    })
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
      if (!response.ok) {
        recordAppUpdateDebugDiagnostic("published-version-result", {
          status: response.status,
          version: "",
          retry: true,
        })
        return {version: "", retry: true}
      }
      const data = await response.json()
      const version = typeof data?.version === "string" ? data.version : ""
      const retry = !version || data?.status === "deploying"
      recordAppUpdateDebugDiagnostic("published-version-result", {
        status: response.status,
        version,
        deploymentStatus: typeof data?.status === "string" ? data.status : "",
        retry,
      })
      return {version, retry}
    } catch (error) {
      recordAppUpdateDebugDiagnostic("published-version-error", {error})
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
    if (!buildId || buildId === APP_BUILD_ID || serviceWorkerReloadInFlight) {
      recordAppUpdateDebugDiagnostic("reload-into-build-skipped", {
        targetBuildId: buildId,
        reloadInFlight: serviceWorkerReloadInFlight,
      })
      return
    }

    serviceWorkerReloadInFlight = true
    recordAppUpdateDebugDiagnostic("reload-into-build", {targetBuildId: buildId})
    setExpectedBuildForReload(buildId)
    forceReload()
  }

  const waitForControllerBuild = async (buildId: string) => {
    recordAppUpdateDebugDiagnostic("controller-wait-started", {
      expectedBuildId: buildId,
      controller: describeAppUpdateWorker(navigator.serviceWorker.controller),
    })

    return await new Promise<boolean>(resolve => {
      let settled = false

      const finish = (activated: boolean) => {
        if (settled) return

        settled = true
        window.clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener("controllerchange", inspectController)
        recordAppUpdateDebugDiagnostic("controller-wait-finished", {
          expectedBuildId: buildId,
          result: activated ? "controlled" : "timeout",
          registration: null,
          controller: describeAppUpdateWorker(navigator.serviceWorker.controller),
        })
        resolve(activated)
      }
      const inspectController = () => {
        recordAppUpdateDebugDiagnostic("controller-wait-change", {
          expectedBuildId: buildId,
          controller: describeAppUpdateWorker(navigator.serviceWorker.controller),
        })
        void getServiceWorkerVersion(navigator.serviceWorker.controller, "controller").then(
          controllerBuildId => {
            if (controllerBuildId === buildId) finish(true)
          },
        )
      }
      const timeout = window.setTimeout(() => {
        void getServiceWorkerFetchActivity(
          navigator.serviceWorker.controller,
          `${buildId}:controller-timeout`,
          "controller-timeout",
        ).finally(() => {
          void getServiceWorkerVersion(
            navigator.serviceWorker.controller,
            "controller-timeout",
          ).then(controllerBuildId => finish(controllerBuildId === buildId))
        })
      }, APP_SERVICE_WORKER_ACTIVATION_TIMEOUT)

      navigator.serviceWorker.addEventListener("controllerchange", inspectController)
    })
  }

  const requestAppReload = async (expectedBuildId = readyAppUpdateBuildId) => {
    if (!browser || !expectedBuildId || appUpdateReloading) return

    recordAppUpdateDebugDiagnostic("reload-requested", {
      expectedBuildId,
      controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
    })

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
        recordAppUpdateDebugDiagnostic("activation-delayed", {expectedBuildId})
        console.warn(`[app-update] Build ${expectedBuildId} is still activating`)
        void activateReadyServiceWorker(expectedBuildId).catch(error =>
          console.warn("[app-update] Failed to retry delayed activation", error),
        )
        return
      }

      appUpdateRecoveryMessage =
        "The app update could not start. The current version is still available."
      recordAppUpdateDebugDiagnostic("activation-not-started", {expectedBuildId})
    } catch (error) {
      console.warn("[app-update] Failed to activate app update", error)
      appUpdateRecoveryMessage =
        "The app update could not be activated. The current version is still available."
      recordAppUpdateDebugDiagnostic("activation-error", {expectedBuildId, error})
    } finally {
      if (!serviceWorkerReloadInFlight) appUpdateReloading = false
    }
  }

  const notifyUpdateReady = (buildId: string) => {
    if (!buildId || buildId === APP_BUILD_ID) return

    if (APP_UPDATE_MODE === "auto") {
      // No prompt: the prepared build waits and is applied before the app renders at a later
      // startup (applyPreparedUpdateAtStartup), or by the browser once no window remains.
      recordAppUpdateDebugDiagnostic("update-prepared-for-startup", {expectedBuildId: buildId})
      return
    }

    readyAppUpdateBuildId = buildId
    appUpdateRecoveryMessage = ""
    appUpdateActivationDelayed = false
    recordAppUpdateDebugDiagnostic("update-ready", {expectedBuildId: buildId})
  }

  const APP_AUTO_UPDATE_ATTEMPT_KEY = "appAutoUpdateAttemptBuildId"
  // The worker decides (window count, published marker with a 3 s timeout, window recheck)
  // before this deadline and refuses after it, so a missed reply cannot activate later.
  const APP_STARTUP_ACTIVATION_DECISION_WINDOW = 6_000
  const APP_STARTUP_ACTIVATION_REPLY_MARGIN = 1_500
  const APP_STARTUP_ACTIVATION_TIMEOUT = 10_000
  const APP_STARTUP_REGISTRATION_TIMEOUT = 3_000
  const APP_STARTUP_HOLD_RECHECK_INTERVAL = 5_000
  const APP_STARTUP_HOLD_SLOW_AFTER = 30_000
  const APP_STARTUP_ACTIVATION_REQUEST_PASSES = 3

  type StartupUpdateOutcome = "continue" | "reloading" | "hold"
  type StartupHoldReason = "pending" | "activating" | "uncertain"
  type WorkerHandshake = {
    answered: boolean
    version: string
    startupActivation: boolean
    activationPending: boolean
  }
  type StartupActivationReply = {
    answered: boolean
    accepted: boolean
    reason: string
    version: string
    activationPending: boolean
  }
  type StartupInspection =
    | {hold: StartupHoldReason}
    | {
        hold: null
        registration: ServiceWorkerRegistration | null
        waiting: ServiceWorker | null
        handshake: WorkerHandshake | null
        // Build of a controller that already switched away from this document's build.
        reloadInto?: string
      }

  const STARTUP_HOLD_MESSAGES: Record<StartupHoldReason, string> = {
    pending: "Finishing the app update. This tab reloads automatically.",
    activating: "Finishing the app update. This tab reloads automatically.",
    uncertain: "Checking the app update…",
  }

  const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

  async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
    return await Promise.race([promise, sleep(ms).then(() => "timeout" as const)])
  }

  // Version handshake that also reports startup-activation support and a pending activation.
  const getWorkerHandshake = async (worker: ServiceWorker) =>
    await new Promise<WorkerHandshake>(resolve => {
      const unanswered: WorkerHandshake = {
        answered: false,
        version: "",
        startupActivation: false,
        activationPending: false,
      }
      const channel = new MessageChannel()
      let settled = false
      const finish = (handshake: WorkerHandshake) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        channel.port1.close()
        resolve(handshake)
      }
      const timeout = window.setTimeout(() => finish(unanswered), 2_000)
      channel.port1.onmessage = event => {
        const data = event.data
        finish(
          data?.type === "APP_CACHE_VERSION" && typeof data.version === "string"
            ? {
                answered: true,
                version: data.version,
                startupActivation: data.startupActivation === true,
                activationPending: data.activationPending === true,
              }
            : unanswered,
        )
      }
      try {
        worker.postMessage({type: "APP_CACHE_GET_VERSION"}, [channel.port2])
      } catch {
        finish(unanswered)
      }
    })

  const requestStartupActivation = async (worker: ServiceWorker) =>
    await new Promise<StartupActivationReply>(resolve => {
      const deadline = Date.now() + APP_STARTUP_ACTIVATION_DECISION_WINDOW
      const channel = new MessageChannel()
      let settled = false
      const finish = (reply: StartupActivationReply) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        channel.port1.close()
        resolve(reply)
      }
      const timeout = window.setTimeout(
        () =>
          finish({
            answered: false,
            accepted: false,
            reason: "no-reply",
            version: "",
            activationPending: false,
          }),
        APP_STARTUP_ACTIVATION_DECISION_WINDOW + APP_STARTUP_ACTIVATION_REPLY_MARGIN,
      )
      channel.port1.onmessage = event => {
        const data = event.data
        finish(
          data?.type === "APP_CACHE_ACTIVATE_IF_SOLE_CLIENT_RESULT"
            ? {
                answered: true,
                accepted: data.accepted === true,
                reason: typeof data.reason === "string" ? data.reason : "",
                version: typeof data.version === "string" ? data.version : "",
                activationPending: data.activationPending === true,
              }
            : {
                answered: true,
                accepted: false,
                reason: "unexpected-reply",
                version: "",
                activationPending: false,
              },
        )
      }
      try {
        worker.postMessage({type: "APP_CACHE_ACTIVATE_IF_SOLE_CLIENT", deadline}, [channel.port2])
      } catch {
        finish({
          answered: true,
          accepted: false,
          reason: "post-error",
          version: "",
          activationPending: false,
        })
      }
    })

  // True when a worker other than this page's controller is (becoming) active: its controller
  // switch or claim will reload this page.
  const isActivationInProgress = (registration: ServiceWorkerRegistration) => {
    const active = registration.active
    if (!active) return false
    const controller = navigator.serviceWorker.controller
    if (controller) return active !== controller
    return active.state === "activating"
  }

  /**
   * Whether an activation could still reload this document if it rendered now. Every auto-mode
   * document runs this before any local blocker (attempted build, expected-build reload, input,
   * visibility), because a pending activation reloads documents regardless of those. Shared
   * state comes from the browser registration and the waiting worker's durable pending record,
   * so it also covers documents started after another document's activation was accepted.
   */
  const inspectStartupUpdate = async (checkController = false): Promise<StartupInspection> => {
    const registration = await withTimeout(
      navigator.serviceWorker.getRegistration(getAppBaseUrl().pathname),
      APP_STARTUP_REGISTRATION_TIMEOUT,
    )
    // getRegistration() can stall while a registration activates: not knowing means hold.
    if (registration === "timeout") return {hold: "uncertain"}
    if (!registration) return {hold: null, registration: null, waiting: null, handshake: null}

    if (isActivationInProgress(registration) && registration.active) {
      const active = await getWorkerHandshake(registration.active)
      // The same build taking control does not reload this document (reloadIntoBuild skips it).
      if (!active.answered || active.version !== APP_BUILD_ID) return {hold: "activating"}
    }

    const waiting = registration.waiting
    let handshake: WorkerHandshake | null = null
    if (waiting) {
      handshake = await getWorkerHandshake(waiting)
      if (!handshake.answered) return {hold: "uncertain"}
      if (handshake.activationPending) return {hold: "pending"}
    }

    // Only before this document requests anything, and only with nothing pending or running
    // (so an old controller that an activation waits on is never messaged): if the controller
    // switched to another build before this document could observe controllerchange, this
    // build's lazy chunks will not load from it. Reload into that build before rendering.
    const controller = navigator.serviceWorker.controller
    if (checkController && controller) {
      const controlling = await getWorkerHandshake(controller)
      if (controlling.answered && controlling.version && controlling.version !== APP_BUILD_ID) {
        return {hold: null, registration, waiting, handshake, reloadInto: controlling.version}
      }
    }

    return {hold: null, registration, waiting, handshake}
  }

  /**
   * Keep this document unrendered while an activation may still reload it. The global
   * controllerchange/APP_CACHE_ACTIVATED handlers reload it into the new build. It re-inspects
   * periodically and returns "recheck" only once nothing is pending or activating, so stale
   * records, replaced workers and unanswered requests cannot hold it indefinitely. The notice
   * states what is known; its only action reloads this tab, never other windows.
   */
  const holdUntilSettled = async (reason: StartupHoldReason, quietMs = 0) => {
    const startedAt = Date.now()
    let current = reason
    recordAppUpdateDebugDiagnostic("startup-update-hold", {reason})
    while (true) {
      const elapsed = Date.now() - startedAt
      if (elapsed >= quietMs) {
        const slow = elapsed >= APP_STARTUP_HOLD_SLOW_AFTER
        startupHoldMessage = slow
          ? `${STARTUP_HOLD_MESSAGES[current]} This is taking longer than usual.`
          : STARTUP_HOLD_MESSAGES[current]
        startupHoldSlow = slow
      }
      await sleep(APP_STARTUP_HOLD_RECHECK_INTERVAL)
      if (serviceWorkerReloadInFlight) continue
      let inspection: StartupInspection
      try {
        inspection = await inspectStartupUpdate()
      } catch {
        inspection = {hold: "uncertain"}
      }
      if (serviceWorkerReloadInFlight) continue
      if (inspection.hold) {
        current = inspection.hold
        continue
      }
      startupHoldMessage = ""
      startupHoldSlow = false
      recordAppUpdateDebugDiagnostic("startup-update-hold-settled", {reason: current})
      return "recheck" as const
    }
  }

  const runStartupUpdatePass = async (
    mayRequestActivation: boolean,
  ): Promise<StartupUpdateOutcome | "recheck"> => {
    let acceptedBuildId = ""
    try {
      const inspection = await inspectStartupUpdate(true)
      if (inspection.hold) return await holdUntilSettled(inspection.hold)
      if (inspection.reloadInto) {
        reloadIntoBuild(inspection.reloadInto)
        return await holdUntilSettled("activating", APP_STARTUP_ACTIVATION_TIMEOUT)
      }
      const {registration, waiting, handshake} = inspection
      if (!mayRequestActivation || !registration || !waiting || !handshake) return "continue"

      // Local reasons not to apply the prepared build, checked only after the pending and
      // activating checks above: they never allow rendering while an activation is pending.
      const readLocalBlocker = () =>
        getStartupUpdateBlocker({
          autoUpdate: true,
          visible: document.visibilityState === "visible",
          userInputSeen: appUserInputSeen,
          reloadInProgress:
            serviceWorkerReloadInFlight ||
            Boolean(sessionStorage.getItem(APP_EXPECTED_BUILD_STORAGE_KEY)),
          broadcastPrepared: hasStoredBroadcastPreparation(),
        })
      const localBlocker = readLocalBlocker()
      if (localBlocker) {
        recordAppUpdateDebugDiagnostic("startup-update-skipped", {reason: localBlocker})
        return "continue"
      }
      const buildBlocker = getPreparedBuildBlocker({
        runningBuildId: APP_BUILD_ID,
        waitingBuildId: handshake.version,
        attemptedBuildId: sessionStorage.getItem(APP_AUTO_UPDATE_ATTEMPT_KEY) || "",
        startupActivation: handshake.startupActivation,
      })
      if (buildBlocker) {
        recordAppUpdateDebugDiagnostic("startup-update-skipped", {
          reason: buildBlocker,
          waitingBuildId: handshake.version,
        })
        return "continue"
      }

      // Recheck local state immediately before asking; the worker checks the published marker
      // and other windows itself, and refuses after its deadline.
      if (readLocalBlocker() || registration.waiting !== waiting) return "continue"
      const activation = await requestStartupActivation(waiting)
      recordAppUpdateDebugDiagnostic("startup-update-activation", {
        ...activation,
        waitingBuildId: handshake.version,
      })

      // No reply: the worker may have accepted. The hold re-inspects its pending record and
      // renders once it is known that nothing was accepted.
      if (!activation.answered) return await holdUntilSettled("uncertain")
      if (!activation.accepted) {
        if (activation.activationPending) return await holdUntilSettled("pending")
        if (isActivationInProgress(registration)) return await holdUntilSettled("activating")
        return "continue"
      }

      // Accepted means skipWaiting() already ran: from here on this document never renders.
      acceptedBuildId = activation.version || handshake.version
      try {
        // Only an accepted activation counts as an attempt: a refusal leaves the build
        // eligible at this tab's next startup.
        sessionStorage.setItem(APP_AUTO_UPDATE_ATTEMPT_KEY, acceptedBuildId)
      } catch {
        // Storage failure must not render the running build after acceptance.
      }

      const controlled = await Promise.race([
        waitForControllerBuild(acceptedBuildId),
        sleep(APP_STARTUP_ACTIVATION_TIMEOUT).then(() => false),
      ])
      if (controlled) {
        reloadIntoBuild(acceptedBuildId)
        // The reload waits while the new worker finishes activating: show the hold if slow.
        return await holdUntilSettled("activating", APP_STARTUP_ACTIVATION_TIMEOUT)
      }
      return await holdUntilSettled("pending")
    } catch (error) {
      console.warn("[app-update] Startup update check failed", error)
      if (acceptedBuildId) return await holdUntilSettled("pending")
      return "continue"
    }
  }

  /**
   * Auto-update mode only. Runs before the app renders: no page, widget iframe, wallet, signer
   * or session has started in this document. If a newer build is already prepared (waiting)
   * and still published, it replaces the running build with one reload. Otherwise the running
   * build continues and the prepared build waits for a later startup.
   *
   * While any activation is pending or running (accepted by this or another document), this
   * document never renders the running build: that activation would reload it and discard
   * anything typed. It holds instead, and renders only once nothing is pending.
   */
  const applyPreparedUpdateAtStartup = async (): Promise<StartupUpdateOutcome> => {
    if (!browser || dev || APP_UPDATE_MODE !== "auto") return "continue"
    if (!("serviceWorker" in navigator)) return "continue"
    for (let pass = 1; ; pass++) {
      const outcome = await runStartupUpdatePass(pass <= APP_STARTUP_ACTIVATION_REQUEST_PASSES)
      if (outcome !== "recheck") return outcome
    }
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
    if (appUpdateReloading) return

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
    if (!expectedBuildId) {
      recordAppUpdateDebugDiagnostic("reload-verification", {result: "not-expected"})
      return true
    }

    if (expectedBuildId === APP_BUILD_ID) {
      sessionStorage.removeItem(APP_EXPECTED_BUILD_STORAGE_KEY)
      sessionStorage.removeItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY)
      readyAppUpdateBuildId = ""
      appUpdateRecoveryMessage = ""
      recordAppUpdateDebugDiagnostic("reload-verification", {
        expectedBuildId,
        result: "expected-build-running",
        controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
      })
      return true
    }

    const controllerBuildId = await getServiceWorkerVersion(
      navigator.serviceWorker?.controller,
      "reload-verification-controller",
    )
    const action = getExpectedBuildAction({
      expectedBuildId,
      runningBuildId: APP_BUILD_ID,
      controllerBuildId,
      recoveryAttempted: sessionStorage.getItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY) === "1",
    })

    if (action === "reload") {
      recordAppUpdateDebugDiagnostic("reload-verification", {
        expectedBuildId,
        controllerBuildId,
        result: "cache-busted-reload",
      })
      sessionStorage.setItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY, "1")
      forceReload()
      return false
    }

    readyAppUpdateBuildId = expectedBuildId
    appUpdateRecoveryMessage = "App update did not finish. The current version is still available."
    console.warn(
      `[app-update] Expected build ${expectedBuildId}, but build ${APP_BUILD_ID} is still running`,
    )
    recordAppUpdateDebugDiagnostic("reload-verification", {
      expectedBuildId,
      controllerBuildId,
      result: "recovery-ui",
      recoveryAttempted: sessionStorage.getItem(APP_RELOAD_RECOVERY_ATTEMPT_KEY) === "1",
    })
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

  /**
   * Auto mode replacement for initAppUpdates, awaited before the app renders. The same steps
   * run in order; update polling (version checks through the controller, preparation messages)
   * starts only after the startup gate has finished without activating. Returns false when this
   * document must stay unrendered (reloading, or holding for an activation).
   */
  const initAutoModeUpdatesBeforeRender = async () => {
    setupAppShellFailureRecovery()
    // getRegistrations() can stall while a registration activates. Legacy sw.js workers never
    // exist on nsite origins, so this cleanup must not delay the startup gate.
    await withTimeout(
      cleanupLegacyServiceWorkers().catch(error =>
        console.warn("[app-update] Legacy service-worker cleanup failed", error),
      ),
      APP_STARTUP_REGISTRATION_TIMEOUT,
    )

    try {
      if (!(await verifyExpectedBuildAfterReload())) return false
    } catch (error) {
      console.warn("[app-update] Expected-build verification failed", error)
    }

    if ((await applyPreparedUpdateAtStartup()) !== "continue") return false

    autoUpdateStartupGateDone = true
    setupAppUpdatePolling()
    return true
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
      recordAppUpdateDebugDiagnostic("worker-message", {
        messageType: data.type,
        workerBuildId: data.version,
        controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
      })
      // Auto mode: never start an update check while the startup gate may be activating.
      if (autoUpdateStartupGateDone) void checkForAppUpdate()
      return
    }

    if (
      [
        "APP_CACHE_ACTIVATION_REQUESTED",
        "APP_CACHE_SKIP_WAITING_RECEIVED",
        "APP_CACHE_SKIP_WAITING_RESOLVED",
        "APP_CACHE_SKIP_WAITING_REJECTED",
      ].includes(data.type) &&
      typeof data.version === "string"
    ) {
      recordAppUpdateDebugDiagnostic("worker-message", {
        messageType: data.type,
        workerBuildId: data.version,
        requestId: typeof data.requestId === "string" ? data.requestId : "",
        durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
        errorName: typeof data.errorName === "string" ? data.errorName : "",
        errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : "",
        workerRegistration:
          data.registration && typeof data.registration === "object" ? data.registration : null,
        controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
      })
      return
    }

    if (data.type === "APP_CACHE_ACTIVATED" && typeof data.version === "string") {
      recordAppUpdateDebugDiagnostic("worker-message", {
        messageType: data.type,
        workerBuildId: data.version,
        controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
      })
      reloadIntoBuild(data.version)
    }
  }

  navigator.serviceWorker?.addEventListener("message", serviceWorkerMessageHandler)

  serviceWorkerControllerChangeHandler = () => {
    recordAppUpdateDebugDiagnostic("controller-change", {
      controller: describeAppUpdateWorker(navigator.serviceWorker?.controller),
    })
    window.setTimeout(() => {
      void getServiceWorkerVersion(navigator.serviceWorker?.controller, "controller-change").then(
        reloadIntoBuild,
      )
    }, 0)
  }
  navigator.serviceWorker?.addEventListener(
    "controllerchange",
    serviceWorkerControllerChangeHandler,
  )

  // Auto mode runs these steps before rendering instead (initAutoModeUpdatesBeforeRender).
  if (APP_UPDATE_MODE !== "auto") void initAppUpdates()

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

    // Auto mode: settle update state before sessions, storage, wallet or any page/widget
    // starts. A document that is reloading or holding for an activation never renders.
    if (APP_UPDATE_MODE === "auto" && !(await initAutoModeUpdatesBeforeRender())) {
      await new Promise<never>(() => {})
    }

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
    const stopRepositoryCache = setupRepositoryCache()

    // Close the database connection on reload
    unsubscribers.push(() => db.close(), stopRepositoryCache)

    // Remove policies when we're done
    unsubscribers.push(
      uninstallSocketPolicies,
      uninstallRelayRequestPolicy,
      uninstallRelayDiagnostics,
    )

    // History, navigation, and application data
    unsubscribers.push(setupHistory(), setupGitCorsProxy(), syncApplicationData(), syncGitData())
    unsubscribers.push(stopNotificationBackground)

    if (CASHU_WALLET_ENABLED) {
      // Initialize an existing wallet eagerly so its balance is immediately available.
      void startCashuWalletInBackground().catch(() => {})
    }

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
      notificationRootReady = true
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
    uninstallRelayWriteCapabilityPolicy()
    uninstallRelayDiagnostics()
    uninstallRelayDebugDiagnostics()
    uninstallPublicationDebugDiagnostics()

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
  holdMessage={startupHoldMessage}
  holdSlow={startupHoldSlow}
  tabReloadOnly={APP_UPDATE_MODE === "auto"}
  onReload={() => void requestAppReload()}
  onRetry={retryAppUpdate}
  onReset={() => void resetAppCacheAndReload()}
  onReloadTab={() => window.location.reload()} />

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
