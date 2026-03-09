<script lang="ts">
  import "@src/app.css"
  import "@capacitor-community/safe-area"
  import "@src/lib/crypto-polyfill"
  import {throttle} from "throttle-debounce"
  import * as nip19 from "nostr-tools/nip19"
  import type {Unsubscriber} from "svelte/store"
  import {get} from "svelte/store"
  import {App, type URLOpenListenerEvent} from "@capacitor/app"
  import {browser, dev} from "$app/environment"
  import {beforeNavigate, goto} from "$app/navigation"
  import {sync} from "@welshman/store"
  import {call, spec} from "@welshman/lib"
  import {authPolicy, trustPolicy, mostlyRestrictedPolicy} from "@app/util/policies"
  import {defaultSocketPolicies} from "@welshman/net"
  import {
    pubkey,
    sessions,
    signerLog,
    shouldUnwrap,
    SignerLogEntryStatus,
  } from "@welshman/app"
  import * as lib from "@welshman/lib"
  import * as util from "@welshman/util"
  import * as feeds from "@welshman/feeds"
  import * as router from "@welshman/router"
  import * as welshmanSigner from "@welshman/signer"
  import * as net from "@welshman/net"
  import * as app from "@welshman/app"
  import {ConfigProvider, AvatarImage} from "@nostr-git/ui"
  import AppContainer from "@app/components/AppContainer.svelte"
  import ModalContainer from "@app/components/ModalContainer.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import NostrGitProfileComponent from "@app/components/NostrGitProfileComponent.svelte"
  import NostrGitProfileLink from "@app/components/NostrGitProfileLink.svelte"
  import {setupHistory} from "@app/util/history"
  import {setupTracking} from "@app/util/tracking"
  import {setupAnalytics} from "@app/util/analytics"
  import {setupGitCorsProxy} from "@app/util/git-cors-proxy"
  import {makeSpacePath} from "@app/util/routes"
  import {
    userSettingsValues,
  } from "@app/core/state"
  import {db, kv} from "@app/core/storage"
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
  import {syncBudabitApplicationData, syncBudabitData} from "@lib/budabit/sync"
  import {setupBudabitNotifications} from "@lib/budabit/notifications"
  import {ExtensionProvider} from "@src/app/extensions"
  import {installBuiltinExtensions} from "@app/extensions/builtin"
  import {initializeCashuWallet} from "@lib/budabit/cashu"
  import {registerCashuBridgeHandlers} from "@lib/budabit/cashu-bridge"
  import CashuPayConfirm from "@lib/budabit/components/CashuPayConfirm.svelte"

  const {children} = $props()
  const nostrGitProviderProps = /** @type {any} */ ({
    components: {
      AvatarImage,
      ProfileComponent: NostrGitProfileComponent,
      ProfileLink: NostrGitProfileLink,
      EventActions,
      ReactionSummary,
      Markdown,
    },
  })

  const policies = [authPolicy, trustPolicy, mostlyRestrictedPolicy]
  const APP_UPDATE_INTERVAL = 2 * 60 * 1000
  const APP_RELOAD_QUERY_KEY = "v"
  const APP_VERSION_STORAGE_KEY = "appVersion"
  const APP_SW_CLEANUP_KEY = "appSwCleanupDone"
  let updateCheckInterval: number | null = null
  let updateCheckOnFocus: (() => void) | null = null
  let updateCheckOnVisibilityChange: (() => void) | null = null
  let updateToastShown = false

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
  })

  // Initialize push notification handler asap
  initializePushNotifications()

  setupBudabitNotifications()
  
  // Auto-install and enable built-in extensions
  if (browser) {
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

  const getServiceWorkerUrl = () => new URL("service-worker.js", getAppBaseUrl()).toString()

  const buildReloadUrl = () => {
    const url = new URL(window.location.href)

    url.searchParams.set(APP_RELOAD_QUERY_KEY, `${Date.now()}`)
    return url.toString()
  }

  const forceReload = () => {
    window.location.replace(buildReloadUrl())
  }

  const getStoredVersion = () => {
    if (typeof localStorage === "undefined") return ""
    return localStorage.getItem(APP_VERSION_STORAGE_KEY) || ""
  }

  const setStoredVersion = (version: string) => {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(APP_VERSION_STORAGE_KEY, version)
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

  const requestAppReload = () => {
    if (!browser) return
    forceReload()
  }

  const notifyUpdateReady = () => {
    if (updateToastShown) return

    updateToastShown = true
    pushToast({
      message: "New app version is available",
      timeout: 0,
      action: {
        message: "Reload",
        onclick: requestAppReload,
      },
    })
  }

  const checkForAppUpdate = async () => {
    const version = await fetchAppVersion()
    if (!version) return
    const storedVersion = getStoredVersion()
    if (!storedVersion) {
      setStoredVersion(version)
      return
    }
    if (storedVersion !== version) {
      setStoredVersion(version)
      notifyUpdateReady()
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

  const registerAppServiceWorker = async () => {
    if (!browser) return
    if (!("serviceWorker" in navigator)) return

    try {
      await navigator.serviceWorker.register(getServiceWorkerUrl(), {
        type: "module",
        scope: getAppBaseUrl().pathname,
      })
    } catch (error) {
      console.warn("Service worker registration failed", error)
    }
  }

  const getRegistrationScriptUrl = (registration: ServiceWorkerRegistration) =>
    registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || ""

  const isLegacyServiceWorker = (scriptUrl: string) => {
    try {
      return new URL(scriptUrl).pathname.endsWith("/sw.js")
    } catch {
      return false
    }
  }

  const cleanupLegacyServiceWorkers = async () => {
    if (!browser) return
    if (!("serviceWorker" in navigator)) return
    if (typeof localStorage === "undefined") return
    if (localStorage.getItem(APP_SW_CLEANUP_KEY) === "1") return

    const registrations = await navigator.serviceWorker.getRegistrations()
    const legacyRegistrations = registrations.filter(registration =>
      isLegacyServiceWorker(getRegistrationScriptUrl(registration)),
    )

    if (legacyRegistrations.length === 0) {
      localStorage.setItem(APP_SW_CLEANUP_KEY, "1")
      return
    }

    localStorage.setItem(APP_SW_CLEANUP_KEY, "1")
    await Promise.all(legacyRegistrations.map(registration => registration.unregister()))

    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }

    forceReload()
  }

  const initAppUpdates = async () => {
    await cleanupLegacyServiceWorkers()
    setupAppUpdatePolling()
    void registerAppServiceWorker()
  }

  void initAppUpdates()

  // Listen for navigation messages from service worker
  navigator.serviceWorker?.addEventListener("message", event => {
    if (event.data && event.data.type === "NAVIGATE") {
      goto(event.data.url)
    }
  })

  beforeNavigate(nav => {
    if (!nav.to) return

    if (nav.to.url.pathname === "/home" && appState.PLATFORM_RELAYS.length > 0) {
      nav.cancel()
      goto(makeSpacePath(appState.PLATFORM_RELAYS[0]))
    }
  })

  // Listen for deep link events
  App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    const url = new URL(event.url)
    const target = `${url.pathname}${url.search}${url.hash}`
    goto(target, {replaceState: false, noScroll: false})
  })

  // Handle back button on mobile
  App.addListener("backButton", () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      App.exitApp()
    }
  })

  // Cleanup on page close
  window.addEventListener("beforeunload", () => db.close())

  const unsubscribe = call(async () => {
    const unsubscribers: Unsubscriber[] = []

    // Sync stuff to localstorage
    await Promise.all([
      sync({
        key: "pubkey",
        store: pubkey,
        storage: kv,
      }),
      sync({
        key: "sessions",
        store: sessions,
        storage: kv,
      }),
      sync({
        key: "shouldUnwrap",
        store: shouldUnwrap,
        storage: kv,
      }),
    ])

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
      const sanitizedTags = event.tags.map((tag: any) => {
        if (!Array.isArray(tag) || tag[0] !== 'r') return tag
        
        // Ensure the relay URL (tag[1]) is a valid string
        if (typeof tag[1] !== 'string' || tag[1].length === 0) {
          console.warn('[+layout] Filtered invalid relay tag:', tag)
          modified = true
          return null
        }
        
        return tag
      }).filter(Boolean)
      
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
        console.log('[+layout] Sanitizing relay list event:', event.id)
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

    // Add our extra policies now that we're set up
    defaultSocketPolicies.push(...policies)

    // Remove policies when we're done
    unsubscribers.push(() => defaultSocketPolicies.splice(-policies.length))

    // History, navigation, bug tracking, application data
    unsubscribers.push(
      setupHistory(),
      setupAnalytics(),
      setupTracking(),
      setupGitCorsProxy(),
      syncBudabitApplicationData(),
      syncBudabitData(),
    )

    // Initialize Cashu wallet eagerly so balance is available immediately.
    // After init, cashuNeedsBackup will be true if backup hasn't been confirmed yet —
    // the $effect below will open the seed backup modal automatically.
    void initializeCashuWallet()

    // Subscribe to badge count for changes
    unsubscribers.push(notifications.badgeCount.subscribe(notifications.handleBadgeCountChanges))

    // Initialize keyboard state tracking
    unsubscribers.push(syncKeyboard())

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
                onclick: () => goto("/settings/profile"),
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
    App.removeAllListeners()
    unsubscribe.then(call)

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
