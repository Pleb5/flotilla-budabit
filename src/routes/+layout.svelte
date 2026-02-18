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
  import {registerSW} from "virtual:pwa-register"
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
  import AppContainer from "@app/components/AppContainer.svelte"
  import ModalContainer from "@app/components/ModalContainer.svelte"
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

  const {children} = $props()

  const policies = [authPolicy, trustPolicy, mostlyRestrictedPolicy]
  const PWA_UPDATE_INTERVAL = 2 * 60 * 1000
  let swUpdateInterval: number | null = null
  let swUpdateOnFocus: (() => void) | null = null
  let swUpdateOnVisibilityChange: (() => void) | null = null
  let updateToastShown = false
  let waitingWorker: ServiceWorker | null = null

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

  const requestAppReload = () => {
    if (!waitingWorker) {
      window.location.reload()
      return
    }

    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
    waitingWorker.postMessage({type: "SKIP_WAITING"})
  }

  const notifyUpdateReady = (worker: ServiceWorker | null) => {
    if (updateToastShown) return

    updateToastShown = true
    waitingWorker = worker
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
    if (!browser || dev || !("serviceWorker" in navigator)) return

    registerSW({
      immediate: true,
      onRegisterError: (error: unknown) => {
        console.error("Service worker registration failed", error)
      },
    })

    const registration = await navigator.serviceWorker.ready

    const checkForWaitingWorker = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        notifyUpdateReady(registration.waiting)
      }
    }

    const checkForUpdate = async () => {
      try {
        await registration.update()
      } finally {
        checkForWaitingWorker()
      }
    }

    checkForWaitingWorker()

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing

      if (!installing) return

      installing.addEventListener("statechange", () => {
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
  <div>
    <ExtensionProvider />
    <AppContainer>
      {@render children()}
    </AppContainer>
    <ModalContainer />
    <div class="tippy-target"></div>
    <NewNotificationSound />
  </div>
{/await}
