import {page} from "$app/stores"
import {derived, get, writable} from "svelte/store"
import {on} from "@welshman/lib"
import {
  pubkey,
  signer,
  userMessagingRelayList,
  messagingRelayListsByPubkey,
  forceLoadUserMessagingRelayList,
  loadMessagingRelayList,
  loadUserRelayList,
} from "@welshman/app"
import {
  AuthStatus,
  AuthStateEvent,
  Pool,
  SocketEvent,
  SocketStatus,
  request,
  type Socket,
} from "@welshman/net"
import {getDmRelayUrls, getMessagingRelayHints} from "./dm"
import {createDmHistory, DM_INBOX, makeDmHistoryFilters, type DmHistorySnapshot} from "./dm-history"
import {requestFiniteRelay} from "./finite-relay-request"
import {
  getRelayPolicy,
  RELAY_AUTH_SIGN_TIMEOUT,
  RELAY_AUTH_ACK_TIMEOUT,
  RELAY_REQUEST_PRIORITY,
} from "./relay-policy"

export const dmHistoryState = writable(new Map<string, DmHistorySnapshot>())
let history: ReturnType<typeof createDmHistory> | undefined
let retryLive: (() => void) | undefined
export const retryDmHistory = (key = DM_INBOX) => {
  history?.retry(key)
  retryLive?.()
}
export const loadOlderDmHistory = (key: string) => history?.loadOlder(key)
export const loadDmHistoryEvent = (key: string, id: string) => history?.loadEvent(key, id)

export const isChatPath = (pathname: string) =>
  pathname === "/chat" || pathname.startsWith("/chat/")

/** Account-scoped live tails and a single route-aware, bounded history coordinator. */
export const startDmSync = () => {
  const coordinator = createDmHistory({
    getRelayLimit: relay => getRelayPolicy(relay).maxLimit || 100,
    request: options =>
      requestFiniteRelay({
        ...options,
        authTimeoutMs: RELAY_AUTH_SIGN_TIMEOUT + RELAY_AUTH_ACK_TIMEOUT,
        subscribeAuth: listener => {
          const auth = Pool.get().get(options.relay).auth
          const update = () =>
            listener(
              [
                AuthStatus.Requested,
                AuthStatus.PendingSignature,
                AuthStatus.PendingResponse,
              ].includes(auth.status),
            )
          const unsubscribe = on(auth, AuthStateEvent.Status, update)
          update()
          return unsubscribe
        },
      }),
  })
  history = coordinator
  const unsubscribeState = coordinator.subscribe(dmHistoryState.set)
  const live = new Map<string, {controller: AbortController; ended: boolean}>()
  const socketCleanups = new Map<Socket, () => void>()
  const relayRefreshAt = new Map<string, number>()
  let account: string | undefined
  let previousPath = ""
  let previousSigner: unknown
  let relevantRelays = new Set<string>()
  let stopped = false

  const stopLive = () => {
    for (const entry of live.values()) entry.controller.abort()
    live.clear()
  }
  const ensureLive = (relay: string) => {
    if (!account || !get(signer) || live.get(relay)?.ended === false) return
    live.get(relay)?.controller.abort()
    const entry = {controller: new AbortController(), ended: false}
    live.set(relay, entry)
    void request({
      relays: [relay],
      filters: makeDmHistoryFilters(account).map(filter => ({...filter, limit: 0})),
      signal: entry.controller.signal,
      lifetime: "live",
      priority: RELAY_REQUEST_PRIORITY.live,
      owner: "dm-live",
      onClosed: () => {
        entry.ended = true
      },
    }).catch(() => {
      entry.ended = true
    })
  }
  retryLive = () => {
    for (const relay of live.keys()) ensureLive(relay)
  }
  const attachSocket = (socket: Socket) => {
    if (socketCleanups.has(socket)) return
    const recover = (refreshRecent: boolean) => {
      if (!relevantRelays.has(socket.url) || stopped) return
      coordinator.recover(socket.url, refreshRecent)
      if (live.has(socket.url)) ensureLive(socket.url)
    }
    const offAuth = on(socket.auth, AuthStateEvent.Status, (status: AuthStatus) => {
      if (status === AuthStatus.Ok) recover(false)
    })
    const offStatus = on(socket, SocketEvent.Status, (status: SocketStatus) => {
      if (status === SocketStatus.Open) recover(true)
    })
    const offCleanup = on(socket, SocketEvent.Cleanup, () => {
      socketCleanups.get(socket)?.()
      socketCleanups.delete(socket)
    })
    socketCleanups.set(socket, () => {
      offAuth()
      offStatus()
      offCleanup()
    })
  }
  const unsubscribePool = Pool.get().subscribe(attachSocket)
  for (const socket of Pool.get()._data.values()) attachSocket(socket)

  const environment = writable(true)
  const updateEnvironment = () =>
    environment.set(
      typeof document === "undefined" ||
        (document.visibilityState !== "hidden" && navigator.onLine),
    )
  updateEnvironment()
  if (typeof window !== "undefined") {
    window.addEventListener("online", updateEnvironment)
    window.addEventListener("offline", updateEnvironment)
    document.addEventListener("visibilitychange", updateEnvironment)
  }
  const unsubscribe = derived(
    [pubkey, signer, userMessagingRelayList, messagingRelayListsByPubkey, page, environment],
    values => values,
  ).subscribe(([self, activeSigner, relayList, lists, route, available]) => {
    const pathname = route?.url?.pathname || ""
    const active = isChatPath(pathname)
    const rawPartner = active ? pathname.split("/")[2] : undefined
    const partner =
      rawPartner && /^[0-9a-f]{64}$/i.test(rawPartner) ? rawPartner.toLowerCase() : undefined
    const changedAccount = self !== account
    if (changedAccount) {
      stopLive()
      relayRefreshAt.clear()
      if (self) void loadUserRelayList().catch(() => undefined)
    }
    account = self
    const relays =
      self && (!relayList?.event || relayList.event.pubkey === self)
        ? getDmRelayUrls(relayList)
        : []
    const partnerRelays = partner ? getDmRelayUrls(lists.get(partner)) : []
    relevantRelays = new Set([...relays, ...partnerRelays])
    coordinator.configure({
      pubkey: self,
      relays,
      partner,
      partnerRelays,
      active,
      available,
      signerReady: Boolean(activeSigner),
    })
    for (const [relay, entry] of live)
      if (!relays.includes(relay) || !activeSigner) {
        entry.controller.abort()
        live.delete(relay)
      }
    const entered = active && pathname !== previousPath
    const signerChanged = activeSigner !== previousSigner
    previousPath = pathname
    previousSigner = activeSigner
    for (const relay of relays) {
      if (!live.has(relay) || entered || signerChanged) ensureLive(relay)
    }
    if (self && (changedAccount || entered)) {
      const now = Date.now()
      // Refresh metadata separately from reads, and coalesce navigation bursts.
      if (now - (relayRefreshAt.get(self) || 0) > 30_000) {
        relayRefreshAt.set(self, now)
        void forceLoadUserMessagingRelayList(getMessagingRelayHints()).catch(() => undefined)
      }
      if (partner && now - (relayRefreshAt.get(partner) || 0) > 30_000) {
        relayRefreshAt.set(partner, now)
        void loadMessagingRelayList(partner, getMessagingRelayHints()).catch(() => undefined)
      }
    }
  })

  return () => {
    stopped = true
    unsubscribe()
    unsubscribeState()
    unsubscribePool()
    stopLive()
    for (const cleanup of socketCleanups.values()) cleanup()
    socketCleanups.clear()
    coordinator.destroy()
    if (history === coordinator) {
      history = undefined
      retryLive = undefined
      dmHistoryState.set(new Map())
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", updateEnvironment)
      window.removeEventListener("offline", updateEnvironment)
      document.removeEventListener("visibilitychange", updateEnvironment)
    }
  }
}
