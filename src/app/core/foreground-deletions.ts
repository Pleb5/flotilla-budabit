import {repository, tracker} from "@welshman/app"
import {on} from "@welshman/lib"
import {
  AuthStatus,
  AuthStateEvent,
  Pool,
  SocketEvent,
  SocketStatus,
  type Socket,
} from "@welshman/net"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {requestFiniteRelay} from "./finite-relay-request"
import {createDeletionHydration, type DeletionDemand} from "./deletion-hydration"
import {createDeletionCache, createDeletionStorage} from "./deletion-cache"
import {getRelayPolicy, RELAY_AUTH_SIGN_TIMEOUT, RELAY_AUTH_ACK_TIMEOUT} from "./relay-policy"

const storage = createDeletionStorage()
const cache = createDeletionCache({
  storage,
  restore: records => repository.restoreDeletions(records),
})
const remember = (event: TrustedEvent) => {
  if (event.kind !== DELETE) return
  for (const tag of event.tags) {
    if (tag[0] !== "e" && tag[0] !== "a") continue
    const target = repository.getEvent(tag[1])
    if (target) cache.remember(event, target)
  }
}
const coordinator = createDeletionHydration({
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
  getPageLimit: relay => getRelayPolicy(relay).maxLimit || 200,
  receive(event, relay) {
    tracker.addRelay(event.id, relay)
    repository.publish(event)
    remember(event)
  },
})

let consumers = 0
let cleanup: (() => void) | undefined
const start = () => {
  const updateVisibility = () =>
    coordinator.setActive(
      typeof document === "undefined" ||
        (document.visibilityState !== "hidden" && navigator.onLine),
    )
  updateVisibility()
  const sockets = new Map<Socket, () => void>()
  const attach = (socket: Socket) => {
    if (sockets.has(socket)) return
    let opened = socket.status === SocketStatus.Open
    const offStatus = on(socket, SocketEvent.Status, (status: SocketStatus) => {
      if (status !== SocketStatus.Open) return
      if (opened) coordinator.refresh(socket.url)
      opened = true
    })
    const offCleanup = on(socket, SocketEvent.Cleanup, () => {
      sockets.get(socket)?.()
      sockets.delete(socket)
    })
    sockets.set(socket, () => {
      offStatus()
      offCleanup()
    })
  }
  const unsubscribePool = Pool.get().subscribe(attach)
  for (const socket of Pool.get()._data.values()) attach(socket)
  const unsubscribeRepository = repository.onRoutedUpdate(
    {name: "foreground-delete-cache"},
    {kinds: [DELETE]},
    ({added}) => added.forEach(remember),
  )
  if (typeof window !== "undefined") {
    window.addEventListener("online", updateVisibility)
    window.addEventListener("offline", updateVisibility)
    document.addEventListener("visibilitychange", updateVisibility)
  }
  return () => {
    unsubscribePool()
    unsubscribeRepository()
    sockets.forEach(off => off())
    coordinator.setActive(false)
    if (typeof window !== "undefined") {
      window.removeEventListener("online", updateVisibility)
      window.removeEventListener("offline", updateVisibility)
      document.removeEventListener("visibilitychange", updateVisibility)
    }
  }
}

export const registerForegroundDeletions = (initial: DeletionDemand) => {
  if (consumers++ === 0) cleanup = start()
  const registration = coordinator.register(initial)
  let released = false
  let hydrationController = new AbortController()
  let hydrationScope = initial.scope
  let hydrationNavigation = initial.navigation
  const hydrate = (demand: DeletionDemand) => {
    if (demand.scope !== hydrationScope || demand.navigation !== hydrationNavigation) {
      hydrationController.abort()
      hydrationController = new AbortController()
      hydrationScope = demand.scope
      hydrationNavigation = demand.navigation
    }
    if (demand.targets?.length) void cache.hydrate(demand.targets, hydrationController.signal)
  }
  hydrate(initial)
  return {
    update(demand: DeletionDemand) {
      if (released) return
      registration.update(demand)
      hydrate(demand)
    },
    release() {
      if (released) return
      released = true
      hydrationController.abort()
      registration.release()
      if (--consumers === 0) {
        cleanup?.()
        cleanup = undefined
      }
    },
  }
}

export const clearDeletionCache = async () => {
  cleanup?.()
  cleanup = undefined
  coordinator.setActive(false)
  cache.reset()
  await storage.clear()
}

export const refreshForegroundDeletions = () => coordinator.refresh()
