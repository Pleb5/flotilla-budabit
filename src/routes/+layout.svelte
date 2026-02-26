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
  import {resetAppCache} from "@app/util/cache-reset"
  import NewNotificationSound from "@src/app/components/NewNotificationSound.svelte"
  import {syncBudabitApplicationData, syncBudabitData} from "@lib/budabit/sync"
  import {setupBudabitNotifications} from "@lib/budabit/notifications"
  import {ExtensionProvider} from "@src/app/extensions"

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
  const PWA_UPDATE_INTERVAL = 2 * 60 * 1000
  const PWA_RELOAD_QUERY_KEY = "pwaReload"
  const PWA_RELOAD_TIMEOUT = 4_000
  const PWA_LOG_PREFIX = "[PWA]"
  const logPwa = (...args: unknown[]) => console.info(PWA_LOG_PREFIX, ...args)
  const logPwaWarn = (...args: unknown[]) => console.warn(PWA_LOG_PREFIX, ...args)
  const logPwaError = (...args: unknown[]) => console.error(PWA_LOG_PREFIX, ...args)
  let swUpdateInterval: number | null = null
  let swUpdateOnFocus: (() => void) | null = null
  let swUpdateOnVisibilityChange: (() => void) | null = null
  let updateToastShown = false
  let waitingWorker: ServiceWorker | null = null
  let swRegistration: ServiceWorkerRegistration | null = null
  let reloadWarningShown = false

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

  const clearReloadQuery = () => {
    const url = new URL(window.location.href)

    if (!url.searchParams.has(PWA_RELOAD_QUERY_KEY)) return

    url.searchParams.delete(PWA_RELOAD_QUERY_KEY)
    const state = window.history.state ?? {}
    window.history.replaceState(state, "", url.toString())
    logPwa("Cleared reload query parameter")
  }

  const buildReloadUrl = () => {
    const url = new URL(window.location.href)

    url.searchParams.set(PWA_RELOAD_QUERY_KEY, `${Date.now()}`)
    return url.toString()
  }

  const forceReload = () => {
    logPwa("Forcing reload", window.location.pathname)
    window.location.replace(buildReloadUrl())
  }

  const getServiceWorkerBaseUrl = () =>
    new URL(import.meta.env.BASE_URL || "/", window.location.origin)

  const getServiceWorkerUrl = () => new URL("sw.js", getServiceWorkerBaseUrl()).toString()

  const getServiceWorkerScope = () => {
    const basePath = getServiceWorkerBaseUrl().pathname
    return basePath.endsWith("/") ? basePath : `${basePath}/`
  }

  const registerServiceWorker = async () => {
    try {
      const swUrl = getServiceWorkerUrl()
      const swScope = getServiceWorkerScope()
      logPwa("Registering service worker", {swUrl, swScope})
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: getServiceWorkerScope(),
      })
      logPwa("Service worker registered", {scope: registration.scope})
      return registration
    } catch (error) {
      logPwaError("Service worker registration failed", error)
      return null
    }
  }

  const requestAppReload = () => {
    if (!browser) return

    logPwa("Reload requested", {
      waitingWorkerState: waitingWorker?.state,
      registrationWaitingState: swRegistration?.waiting?.state,
    })

    if (!("serviceWorker" in navigator)) {
      forceReload()
      return
    }

    let reloadScheduled = false

    const scheduleReload = (reason: string) => {
      if (reloadScheduled) return
      reloadScheduled = true
      logPwa("Scheduling reload", reason)
      forceReload()
    }

    const scheduleResetReload = async () => {
      if (reloadScheduled) return
      reloadScheduled = true
      logPwaWarn("Activation timeout: resetting caches and reloading")
      try {
        await resetAppCache()
        logPwa("Cache reset complete")
      } catch (error) {
        logPwaError("Cache reset failed", error)
      } finally {
        forceReload()
      }
    }

    const showReloadWarning = () => {
      if (reloadWarningShown) return
      reloadWarningShown = true
      pushToast({
        theme: "warning",
        timeout: 10_000,
        message: "Update is still installing. Trying a full refresh to apply it.",
      })
    }

    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      scheduleReload("controllerchange")
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    const activationTimer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      showReloadWarning()
      void scheduleResetReload()
    }, PWA_RELOAD_TIMEOUT)

    const clearActivationTimer = () => {
      clearTimeout(activationTimer)
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
    }

    const handleWorker = (worker: ServiceWorker) => {
      if (worker.state === "activated") {
        clearActivationTimer()
        scheduleReload("already-activated")
        return
      }

      const onStateChange = () => {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", onStateChange)
          clearActivationTimer()
          scheduleReload("activated")
        }
      }

      worker.addEventListener("statechange", onStateChange)

      logPwa("Sending skip waiting", {state: worker.state})
      worker.postMessage({type: "SKIP_WAITING"})
    }

    const registration = swRegistration
    const activeWorker = registration?.waiting || registration?.installing || waitingWorker

    if (activeWorker) {
      handleWorker(activeWorker)
      return
    }

    navigator.serviceWorker.getRegistration().then(latest => {
      const latestWorker = latest?.waiting || latest?.installing

      if (latestWorker) {
        handleWorker(latestWorker)
      } else {
        clearActivationTimer()
        scheduleReload("no-waiting-worker")
      }
    })
  }

  const notifyUpdateReady = (worker: ServiceWorker | null) => {
    if (updateToastShown) return

    updateToastShown = true
    waitingWorker = worker
    logPwa("Update ready", {state: worker?.state})
    pushToast({
      message: "New app version is available",
      timeout: 0,
      action: {
        message: "Reload",
        onclick: requestAppReload,
      },
    })
  }

  const setupServiceWorkerUpdates = async () => {
    if (!browser) return

    clearReloadQuery()

    if (dev || !("serviceWorker" in navigator)) return

    logPwa("Starting service worker update checks")

    const registration = await registerServiceWorker()
    if (!registration) return

    await navigator.serviceWorker.ready
    swRegistration = registration
    logPwa("Service worker ready", {
      controller: !!navigator.serviceWorker.controller,
    })

    const checkForWaitingWorker = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        logPwa("Waiting worker detected", {state: registration.waiting.state})
        notifyUpdateReady(registration.waiting)
      }
    }

    const checkForUpdate = async () => {
      logPwa("Checking for update")
      try {
        await registration.update()
      } finally {
        checkForWaitingWorker()
        logPwa("Update check complete")
      }
    }

    checkForWaitingWorker()

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing

      if (!installing) return

      logPwa("Update found", {state: installing.state})

      installing.addEventListener("statechange", () => {
        logPwa("Worker state change", {state: installing.state})
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          notifyUpdateReady(registration.waiting || installing)
        }
      })
    })

    void checkForUpdate()

    swUpdateInterval = window.setInterval(() => {
      void checkForUpdate()
    }, PWA_UPDATE_INTERVAL)

    swUpdateOnFocus = () => void checkForUpdate()
    window.addEventListener("focus", swUpdateOnFocus)

    swUpdateOnVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate()
      }
    }
    document.addEventListener("visibilitychange", swUpdateOnVisibilityChange)
  }

  setupServiceWorkerUpdates()

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

    // Wait until data storage is initialized before syncing other stuff
    await db.connect()

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

    if (swUpdateInterval) {
      clearInterval(swUpdateInterval)
      swUpdateInterval = null
    }

    if (swUpdateOnFocus) {
      window.removeEventListener("focus", swUpdateOnFocus)
      swUpdateOnFocus = null
    }

    if (swUpdateOnVisibilityChange) {
      document.removeEventListener("visibilitychange", swUpdateOnVisibilityChange)
      swUpdateOnVisibilityChange = null
    }
  })
</script>

<svelte:head>
  {#if !dev}
    <link rel="manifest" href="/manifest.webmanifest" />
  {/if}
</svelte:head>

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
