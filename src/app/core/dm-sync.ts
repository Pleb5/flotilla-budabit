import {page} from "$app/stores"
import {derived, get, writable} from "svelte/store"
import {on} from "@welshman/lib"
import type {Filter} from "@welshman/util"
import {
  pubkey,
  signer,
  userMessagingRelayList,
  messagingRelayListsByPubkey,
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
import {checkDmInboxRelayList, getDmRelayUrls, messagingRelayHints} from "./dm"
import {createDmHistory, DM_INBOX, makeDmHistoryFilters, type DmHistorySnapshot} from "./dm-history"
import {requestFiniteRelay} from "./finite-relay-request"
import {refreshForegroundDeletions} from "./foreground-deletions"
import {
  getRelayPolicy,
  RELAY_AUTH_SIGN_TIMEOUT,
  RELAY_AUTH_ACK_TIMEOUT,
  RELAY_REQUEST_PRIORITY,
} from "./relay-policy"

const LIVE_RETRY_BASE_MS = 1_000
const LIVE_RETRY_MAX_MS = 30_000

type LiveSpec = {
  relay: string
  signature: string
  filters: Filter[]
}

type LiveEntry = {
  relay: string
  signature: string
  controller: AbortController
  ended: boolean
  interrupted: boolean
  retryable: boolean
  retryTimer?: ReturnType<typeof setTimeout>
}

export const dmHistoryState = writable(new Map<string, DmHistorySnapshot>())
let history: ReturnType<typeof createDmHistory> | undefined
let retryLive: (() => void) | undefined
export const retryDmHistory = (key = DM_INBOX) => {
  refreshForegroundDeletions()
  history?.retry(key)
  retryLive?.()
}
export const loadOlderDmHistory = (key: string) => history?.loadOlder(key)
export const loadDmHistoryEvent = (key: string, id: string) => history?.loadEvent(key, id)

export const isChatPath = (pathname: string) =>
  pathname === "/chat" || pathname.startsWith("/chat/")

const isNonRetryableLiveClose = (relay: string, reason?: string) => {
  if (!reason) return false
  if (/^restricted:/i.test(reason)) return true
  if (/^auth-required:/i.test(reason)) {
    const status = Pool.get()._data.get(relay)?.auth.status
    return (
      status !== undefined &&
      [
        AuthStatus.Requested,
        AuthStatus.PendingSignature,
        AuthStatus.PendingResponse,
        AuthStatus.DeniedSignature,
        AuthStatus.Forbidden,
      ].includes(status)
    )
  }
  return false
}

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
  const live = new Map<string, LiveEntry>()
  const desiredLive = new Map<string, LiveSpec>()
  const liveFailures = new Map<string, number>()
  const interruptedLiveRelays = new Set<string>()
  const socketCleanups = new Map<Socket, () => void>()
  const relayRefreshAt = new Map<string, number>()
  let account: string | undefined
  let previousPath = ""
  let previousSigner: unknown
  let previousHints = ""
  let previousAvailable = true
  let isAvailable = true
  let relevantRelays = new Set<string>()
  let stopped = false

  const clearEntry = (entry?: LiveEntry) => {
    if (!entry) return
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer)
      entry.retryTimer = undefined
    }
    entry.controller.abort()
  }

  const stopLive = () => {
    for (const entry of live.values()) clearEntry(entry)
    live.clear()
    desiredLive.clear()
    liveFailures.clear()
    interruptedLiveRelays.clear()
  }

  const clearRetryTimers = () => {
    for (const entry of live.values()) {
      if (entry.retryTimer) {
        clearTimeout(entry.retryTimer)
        entry.retryTimer = undefined
      }
    }
  }

  const ensureLive = (relay: string) => {
    const spec = desiredLive.get(relay)
    if (stopped || !account || !get(signer) || !isAvailable || !spec) return
    const existing = live.get(relay)
    if (existing && existing.signature === spec.signature && !existing.ended) return
    clearEntry(existing)
    const entry: LiveEntry = {
      relay,
      signature: spec.signature,
      controller: new AbortController(),
      ended: false,
      interrupted: false,
      retryable: true,
    }
    live.set(relay, entry)
    void request({
      relays: [relay],
      filters: spec.filters,
      signal: entry.controller.signal,
      lifetime: "live",
      priority: RELAY_REQUEST_PRIORITY.live,
      owner: "dm-live",
      onEose: () => {
        if (live.get(relay) !== entry || entry.controller.signal.aborted) return
        liveFailures.delete(relay)
        if (interruptedLiveRelays.delete(relay)) coordinator.recover(relay, true)
      },
      onClosed: reason => {
        if (live.get(relay) !== entry) return
        entry.ended = true
        entry.interrupted = true
        if (isNonRetryableLiveClose(relay, reason)) entry.retryable = false
        // Abort remaining chunks so a partial closure cannot leave a half-open tail.
        entry.controller.abort()
      },
      onDisconnect: () => {
        if (live.get(relay) !== entry) return
        entry.ended = true
        entry.interrupted = true
      },
      onClose: () => {
        if (live.get(relay) !== entry) return
        entry.ended = true
      },
    })
      .catch(() => {
        if (live.get(relay) !== entry) return
        entry.ended = true
        entry.interrupted = true
      })
      .finally(() => {
        if (live.get(relay) !== entry) return
        entry.ended = true
        if (stopped || desiredLive.get(relay)?.signature !== entry.signature) return
        if (entry.controller.signal.aborted && !entry.interrupted) return
        interruptedLiveRelays.add(relay)
        if (!isAvailable || !entry.retryable) return
        const failures = liveFailures.get(relay) || 0
        liveFailures.set(relay, failures + 1)
        const delay = Math.min(LIVE_RETRY_MAX_MS, LIVE_RETRY_BASE_MS * 2 ** Math.min(failures, 5))
        entry.retryTimer = setTimeout(() => {
          if (live.get(relay) !== entry) return
          entry.retryTimer = undefined
          ensureLive(relay)
        }, delay)
      })
  }
  retryLive = () => {
    for (const relay of desiredLive.keys()) {
      liveFailures.delete(relay)
      const existing = live.get(relay)
      if (existing?.retryTimer) {
        clearTimeout(existing.retryTimer)
        existing.retryTimer = undefined
      }
      ensureLive(relay)
    }
  }
  const attachSocket = (socket: Socket) => {
    if (socketCleanups.has(socket)) return
    const recover = (refreshRecent: boolean) => {
      if (!relevantRelays.has(socket.url) || stopped) return
      coordinator.recover(socket.url, refreshRecent)
      if (desiredLive.has(socket.url)) {
        liveFailures.delete(socket.url)
        ensureLive(socket.url)
      }
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
    [
      pubkey,
      signer,
      userMessagingRelayList,
      messagingRelayListsByPubkey,
      page,
      environment,
      messagingRelayHints,
    ],
    values => values,
  ).subscribe(([self, activeSigner, relayList, lists, route, available, hints]) => {
    const pathname = route?.url?.pathname || ""
    const active = isChatPath(pathname)
    const rawPartner = active ? pathname.split("/")[2] : undefined
    const partner =
      rawPartner && /^[0-9a-f]{64}$/i.test(rawPartner) ? rawPartner.toLowerCase() : undefined
    const changedAccount = self !== account
    const hintKey = [...hints].sort().join("|")
    const changedHints = hintKey !== previousHints
    previousHints = hintKey
    if (changedHints) relayRefreshAt.clear()
    if (changedAccount) {
      stopLive()
      relayRefreshAt.clear()
      if (self) void loadUserRelayList().catch(() => undefined)
    }
    account = self
    const becameAvailable = available && !previousAvailable
    isAvailable = available
    previousAvailable = available
    if (!available) clearRetryTimers()
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

    desiredLive.clear()
    if (self && activeSigner) {
      const inboxFilters = makeDmHistoryFilters(self).map(filter => ({...filter, limit: 0}))
      for (const relay of relays) {
        desiredLive.set(relay, {relay, signature: `inbox:${self}`, filters: inboxFilters})
      }
      if (active && partner) {
        const partnerFilters = makeDmHistoryFilters(self, partner).map(filter => ({
          ...filter,
          limit: 0,
        }))
        for (const relay of partnerRelays) {
          if (!desiredLive.has(relay)) {
            desiredLive.set(relay, {
              relay,
              signature: `partner:${self}:${partner}`,
              filters: partnerFilters,
            })
          }
        }
      }
    }

    for (const [relay, entry] of live) {
      const spec = desiredLive.get(relay)
      if (!spec || spec.signature !== entry.signature) {
        clearEntry(entry)
        live.delete(relay)
        liveFailures.delete(relay)
        interruptedLiveRelays.delete(relay)
      }
    }
    const entered = active && pathname !== previousPath
    const signerChanged = activeSigner !== previousSigner
    previousPath = pathname
    previousSigner = activeSigner
    if (available) {
      for (const relay of desiredLive.keys()) {
        if (!live.has(relay) || live.get(relay)?.ended || entered || signerChanged || becameAvailable) {
          if (becameAvailable || entered || signerChanged) liveFailures.delete(relay)
          ensureLive(relay)
        }
      }
    }
    if (self && (changedAccount || entered || changedHints)) {
      const now = Date.now()
      // Refresh metadata separately from reads, and coalesce navigation bursts.
      if (now - (relayRefreshAt.get(self) || 0) > 30_000) {
        relayRefreshAt.set(self, now)
        void checkDmInboxRelayList(self, hints).catch(() => undefined)
      }
      if (partner && now - (relayRefreshAt.get(partner) || 0) > 30_000) {
        relayRefreshAt.set(partner, now)
        void checkDmInboxRelayList(partner, hints).catch(() => undefined)
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
