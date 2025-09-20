<script lang="ts">
  import "@src/app.css"
  import "@capacitor-community/safe-area"
  import {onMount} from "svelte"
  import * as nip19 from "nostr-tools/nip19"
  import {get, derived} from "svelte/store"
  import {App} from "@capacitor/app"
  import {dev} from "$app/environment"
  import {goto} from "$app/navigation"
  import {identity, memoize, sleep, defer, ago, WEEK, TaskQueue} from "@welshman/lib"
  import type {TrustedEvent, StampedEvent} from "@welshman/util"
  import {
    WRAP,
    ALERT_STATUS,
    ALERT_EMAIL,
    ALERT_WEB,
    ALERT_IOS,
    ALERT_ANDROID,
    EVENT_TIME,
    APP_DATA,
    THREAD,
    MESSAGE,
    INBOX_RELAYS,
    DIRECT_MESSAGE,
    DIRECT_MESSAGE_FILE,
    MUTES,
    FOLLOWS,
    PROFILE,
    RELAYS,
    BLOSSOM_SERVERS,
    getRelaysFromList,
  } from "@welshman/util"
  import {Nip46Broker, makeSecret} from "@welshman/signer"
  import type {Socket, RelayMessage, ClientMessage} from "@welshman/net"
  import {
    request,
    defaultSocketPolicies,
    makeSocketPolicyAuth,
    SocketEvent,
    isRelayEvent,
    isRelayOk,
    isRelayClosed,
    isClientReq,
    isClientEvent,
    isClientClose,
  } from "@welshman/net"
  import {
    loadRelay,
    db,
    initStorage,
    repository,
    pubkey,
    defaultStorageAdapters,
    session,
    signer,
    dropSession,
    userInboxRelaySelections,
    loginWithNip01,
    loginWithNip46,
    EventsStorageAdapter,
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
  import {setupTracking} from "@app/tracking"
  import {setupAnalytics} from "@app/analytics"
  import {nsecDecode} from "@lib/util"
  import {preferencesStorageProvider} from "@lib/storage"
  import {
    INDEXER_RELAYS,
    userMembership,
    userSettingsValues,
    relaysPendingTrust,
    ensureUnwrapped,
    canDecrypt,
    getSetting,
    relaysMostlyRestricted,
    userInboxRelays,
  } from "@app/core/state"
  import {loadUserData, listenForNotifications} from "@app/core/requests"
  import {theme} from "@app/util/theme"
  import {initializePushNotifications} from "@app/push"
  import * as commands from "@app/core/commands"
  import * as requests from "@app/core/requests"
  import * as notifications from "@app/util/notifications"
  import * as appState from "@app/core/state"

  import {signer as gitSigner} from "@nostr-git/ui"

  // Migration: old nostrtalk instance used different sessions
  if ($session && !$signer) {
    dropSession($session.pubkey)
  }

  // Initialize push notification handler asap
  initializePushNotifications()

  const {children} = $props()

  const ready = $state(defer<void>())

  onMount(async () => {
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

    // migrate from localStorage to capacitor Preferences storage if needed
    const runMigration = async () => {
      const isSome = (item: any) => {
        return item !== undefined && item !== null && item !== ""
      }

      const localStoragePubKey = localStorage.getItem("pubkey")
      if (isSome(localStoragePubKey)) {
        await preferencesStorageProvider.set("pubkey", localStoragePubKey)
        localStorage.removeItem("pubkey")
      }

      const localStorageSessions = localStorage.getItem("sessions")
      if (isSome(localStorageSessions)) {
        await preferencesStorageProvider.set("sessions", localStorageSessions)
        localStorage.removeItem("sessions")
      }

      const localStorageCanDecrypt = localStorage.getItem("canDecrypt")
      if (isSome(localStorageCanDecrypt)) {
        await preferencesStorageProvider.set("canDecrypt", localStorageCanDecrypt)
        localStorage.removeItem("canDecrypt")
      }

      const localStorageChecked = localStorage.getItem("checked")
      if (isSome(localStorageChecked)) {
        await preferencesStorageProvider.set("checked", localStorageChecked)
        localStorage.removeItem("checked")
      }

      const localStorageTheme = localStorage.getItem("theme")
      if (isSome(localStorageTheme)) {
        await preferencesStorageProvider.set("theme", localStorageTheme)
        localStorage.removeItem("theme")
      }
    }
    await runMigration()

    // Listen for navigation messages from service worker
    navigator.serviceWorker?.addEventListener("message", event => {
      if (event.data && event.data.type === "NAVIGATE") {
        goto(event.data.url)
      }
    })

    // Nstart login
    if (window.location.hash?.startsWith("#nostr-login")) {
      const params = new URLSearchParams(window.location.hash.slice(1))
      const login = params.get("nostr-login")

      let success = false

      try {
        if (login?.startsWith("bunker://")) {
          const clientSecret = makeSecret()
          const {signerPubkey, connectSecret, relays} = Nip46Broker.parseBunkerUrl(login)
          const broker = new Nip46Broker({relays, clientSecret, signerPubkey})
          const result = await broker.connect(connectSecret, appState.NIP46_PERMS)
          const pubkey = await broker.getPublicKey()

          // TODO: remove ack result
          if (pubkey && ["ack", connectSecret].includes(result)) {
            await loadUserData(pubkey)

            loginWithNip46(pubkey, clientSecret, signerPubkey, relays)
            broker.cleanup()
            success = true
          }
        } else if (login) {
          loginWithNip01(nsecDecode(login))
          success = true
        }
      } catch (e) {
        console.error(e)
      }

      if (success) {
        goto("/home")
      }
    }

    // Sync theme
    theme.subscribe(t => {
      document.body.setAttribute("data-theme", t as any)
    })

    // Sync font size
    userSettingsValues.subscribe($userSettingsValues => {
      // @ts-ignore
      document.documentElement.style["font-size"] = `${$userSettingsValues.font_size}rem`
    })

    if (!db) {
      setupTracking()
      setupAnalytics()

      App.addListener("backButton", () => {
        if (window.history.length > 1) {
          window.history.back()
        } else {
          App.exitApp()
        }
      })

      // Unwrap gift wraps as they come in, but throttled
      const unwrapper = new TaskQueue<TrustedEvent>({batchSize: 10, processItem: ensureUnwrapped})

      repository.on("update", ({added}) => {
        if (!$canDecrypt) {
          return
        }

        for (const event of added) {
          if (event.kind === WRAP) {
            unwrapper.push(event)
          }
        }
      })

      await initStorage("flotilla", 8, {
        ...defaultStorageAdapters,
        events: new EventsStorageAdapter({
          name: "events",
          limit: 10_000,
          repository,
          rankEvent: (e: TrustedEvent) => {
            if ([PROFILE, FOLLOWS, MUTES, RELAYS, BLOSSOM_SERVERS, INBOX_RELAYS].includes(e.kind)) {
              return 1
            }

            if (
              [EVENT_TIME, THREAD, MESSAGE, DIRECT_MESSAGE, DIRECT_MESSAGE_FILE].includes(e.kind)
            ) {
              return 0.9
            }

            return 0
          },
        }),
      })

      sleep(300).then(() => ready.resolve())

      defaultSocketPolicies.push(
        makeSocketPolicyAuth({
          sign: (event: StampedEvent) => signer.get()?.sign(event),
          shouldAuth: (socket: Socket) => true,
        }),
        (socket: Socket) => {
          const buffer: RelayMessage[] = []

          const unsubscribers = [
            // When the socket goes from untrusted to trusted, receive all buffered messages
            userSettingsValues.subscribe($settings => {
              if ($settings.trusted_relays.includes(socket.url)) {
                for (const message of buffer.splice(0)) {
                  socket._recvQueue.push(message)
                }
              }
            }),
            // When we get an event with no signature from an untrusted relay, remove it from
            // the receive queue. If trust status is undefined, buffer it for later.
            lib.on(socket, SocketEvent.Receiving, (message: RelayMessage) => {
              if (isRelayEvent(message) && !message[2]?.sig) {
                const isTrusted = getSetting<string[]>("trusted_relays").includes(socket.url)

                if (!isTrusted) {
                  socket._recvQueue.remove(message)
                  buffer.push(message)

                  if (!$relaysPendingTrust.includes(socket.url)) {
                    relaysPendingTrust.update($r => [...$r, socket.url])
                  }
                }
              }
            }),
          ]

          return () => {
            unsubscribers.forEach(lib.call)
          }
        },
        function monitorRestrictedResponses(socket: Socket) {
          let total = 0
          let restricted = 0
          let error = ""

          const pending = new Set<string>()

          const updateStatus = () =>
            relaysMostlyRestricted.update(
              restricted > total / 2 ? lib.assoc(socket.url, error) : lib.dissoc(socket.url),
            )

          const unsubscribers = [
            lib.on(socket, SocketEvent.Receive, (message: RelayMessage) => {
              if (isRelayOk(message)) {
                const [_, id, ok, details = ""] = message

                if (pending.has(id)) {
                  pending.delete(id)

                  if (!ok && details.startsWith("restricted: ")) {
                    restricted++
                    error = details
                    updateStatus()
                  }
                }
              }

              if (isRelayClosed(message)) {
                const [_, id, details = ""] = message

                if (pending.has(id)) {
                  pending.delete(id)

                  if (details.startsWith("restricted: ")) {
                    restricted++
                    error = details
                    updateStatus()
                  }
                }
              }
            }),
            lib.on(socket, SocketEvent.Send, (message: ClientMessage) => {
              if (isClientReq(message)) {
                total++
                pending.add(message[1])
                updateStatus()
              }

              if (isClientEvent(message)) {
                total++
                pending.add(message[1].id)
                updateStatus()
              }

              if (isClientClose(message)) {
                pending.delete(message[1])
              }
            }),
          ]

          return () => {
            unsubscribers.forEach(lib.call)
          }
        },
      )

      // Load relay info
      for (const url of INDEXER_RELAYS) {
        loadRelay(url)
      }

      // Load user data
      if ($pubkey) {
        await loadUserData($pubkey)
      }

      gitSigner.set($signer)

      // Initialize git token store at app level where signer is available
      // This replicates the logic from GitAuth component but at app level
      if ($pubkey) {
        const {tokens} = await import("@nostr-git/ui")
        const {loadTokensFromStorage} = await import("$lib/utils/tokenLoader")

        // Use the same token key pattern as GitAuth component in settings
        const tokenKey = "gh_tokens"

        try {
          // Load tokens directly (same as GitAuth onMount logic)
          const loadedTokens = await loadTokensFromStorage(tokenKey)
          tokens.clear()
          loadedTokens.forEach(token => tokens.push(token))
        } catch (error) {
          console.warn("🔐 Failed to initialize git tokens at app level:", error)
        }
      }

      // Listen for space data, populate space-based notifications
      let unsubSpaces: any

      userMembership.subscribe(
        memoize($membership => {
          unsubSpaces?.()
          unsubSpaces = listenForNotifications()
        }),
      )

      // Listen for chats, populate chat-based notifications
      let controller: AbortController

      {
        let lastSig = ""
        derived([pubkey, canDecrypt, userInboxRelaySelections], identity).subscribe(
          ([$pubkey, $canDecrypt, $userInboxRelaySelections]) => {
            // Build a minimal, stable signature to detect real changes
            const relays = getRelaysFromList($userInboxRelaySelections)
            const sig = `${$pubkey || ""}|${$canDecrypt ? "1" : "0"}|${relays.join(",")}`

            if (sig === lastSig) return
            lastSig = sig

            controller?.abort()
            controller = new AbortController()

            if ($pubkey && $canDecrypt) {
              request({
                signal: controller.signal,
                filters: [
                  {kinds: [WRAP], "#p": [$pubkey], since: ago(WEEK, 2)},
                  {kinds: [WRAP], "#p": [$pubkey], limit: 100},
                ],
                relays,
              })
            }
          },
        )
      }
    }
  })
</script>

<svelte:head>
  {#if !dev}
    <link rel="manifest" href="/manifest.webmanifest" />
  {/if}
</svelte:head>

{#await ready}
  <div></div>
{:then}
  <div>
    <AppContainer>
      {@render children()}
    </AppContainer>
    <ModalContainer />
    <div class="tippy-target"></div>
  </div>
{/await}
