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
import {DELETE, getAddress, isReplaceable, type TrustedEvent} from "@welshman/util"
import {requestFiniteRelay} from "./finite-relay-request"
import {createDeletionHydration, type DeletionDemand} from "./deletion-hydration"
import {createDeletionCache, createDeletionStorage} from "./deletion-cache"
import {getRelayPolicy, RELAY_AUTH_SIGN_TIMEOUT, RELAY_AUTH_ACK_TIMEOUT} from "./relay-policy"

const storage = createDeletionStorage()
const cache = createDeletionCache({
  storage,
  restore: records => repository.restoreDeletions(records),
})
const targetKey = (target: TrustedEvent) => (isReplaceable(target) ? getAddress(target) : target.id)
// Only active foreground consumers retain these references. Isolated discovery
// bodies need not be imported into the main repository to verify a tombstone.
const demandedTargets = new Map<string, Map<symbol, TrustedEvent[]>>()
const getKnownTargets = (key: string) => {
  const targets = new Map<string, TrustedEvent>()
  const cached = repository.getEvent(key)
  if (cached) targets.set(cached.id, cached)
  for (const group of demandedTargets.get(key)?.values() || []) {
    for (const target of group) targets.set(target.id, target)
  }
  return targets.values()
}
const rememberKnown = (target: TrustedEvent) => {
  if (target.kind === DELETE) return
  const key = targetKey(target)
  // Indexed evidence lookup, never a scan/replay of the deletion archive.
  for (const evidence of repository.deletes.get(key) || []) cache.rememberKnown(target, evidence)
}
const remember = (event: TrustedEvent) => {
  if (event.kind !== DELETE) return
  for (const tag of event.tags) {
    if (tag[0] !== "e" && tag[0] !== "a") continue
    for (const target of getKnownTargets(tag[1])) cache.remember(event, target)
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
  const unsubscribeRepository = repository.onDeletionEvidence(key => {
    for (const target of getKnownTargets(key)) rememberKnown(target)
  })
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
  const consumer = Symbol()
  let targetKeys = new Set<string>()
  const trackTargets = (targets: TrustedEvent[] = []) => {
    const unique = new Map(
      targets.filter(target => target.kind !== DELETE).map(target => [target.id, target]),
    )
    const groups = new Map<string, TrustedEvent[]>()
    for (const target of unique.values()) {
      const key = targetKey(target)
      const group = groups.get(key) || []
      group.push(target)
      groups.set(key, group)
    }
    for (const key of targetKeys) {
      const owners = demandedTargets.get(key)
      // An earlier evidence subscriber may already be removing its hidden card.
      // Capture verified evidence before relinquishing its last body reference.
      for (const target of owners?.get(consumer) || []) {
        if (!unique.has(target.id)) rememberKnown(target)
      }
      owners?.delete(consumer)
      if (!owners?.size) demandedTargets.delete(key)
    }
    for (const [key, group] of groups) {
      const owners = demandedTargets.get(key) || new Map<symbol, TrustedEvent[]>()
      owners.set(consumer, group)
      demandedTargets.set(key, owners)
    }
    targetKeys = new Set(groups.keys())
  }
  if (consumers++ === 0) cleanup = start()
  const registration = coordinator.register(initial)
  let released = false
  let hydrationController = new AbortController()
  let hydrationScope = initial.scope
  let hydrationNavigation = initial.navigation
  const hydrate = (demand: DeletionDemand) => {
    trackTargets(demand.targets)
    if (demand.scope !== hydrationScope || demand.navigation !== hydrationNavigation) {
      hydrationController.abort()
      hydrationController = new AbortController()
      hydrationScope = demand.scope
      hydrationNavigation = demand.navigation
    }
    if (demand.targets?.length) {
      demand.targets.forEach(rememberKnown)
      void cache.hydrate(demand.targets, hydrationController.signal)
    }
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
      trackTargets()
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
  demandedTargets.clear()
  cache.reset()
  await storage.clear()
}

export const refreshForegroundDeletions = () => coordinator.refresh()
