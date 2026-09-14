import {pubkey, signer} from "@welshman/app"
import {Nip01Signer} from "@welshman/signer"
import {on} from "@welshman/lib"
import {
  AuthError,
  AuthStatus,
  AuthStateEvent,
  Pool,
  SocketEvent,
  SocketStatus,
  type Socket,
  type RelayMessage,
  isRelayClosed,
  isRelayOk,
} from "@welshman/net"
import {
  getRelayPolicy,
  RelayAuthenticationError,
  RELAY_AUTH_SIGN_TIMEOUT,
  RELAY_AUTH_ACK_TIMEOUT,
  recordRelayAuthRequired,
} from "./relay-policy"
import {isUserOwnedRelay, subscribeRelayAuthConsent} from "./relay-auth-consent"
import {isOperationScopedProviderAuthSocket} from "./provider-relay-auth"

export type RelayAuthOptions = {
  signal?: AbortSignal
  signTimeout?: number
  ackTimeout?: number
  retry?: boolean
}
let guest: Nip01Signer | undefined
type Entry = {
  identity: string
  controller: AbortController
  promise?: Promise<void>
  cleanup: () => void
}
const entries = new WeakMap<Socket, Entry>()

// Individual loader cancellation detaches that waiter, not another concurrent
// loader's signer request. Explicit cancelRelayAuthentication cancels the owner.
const wait = (promise: Promise<void>, signal?: AbortSignal): Promise<void> => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new AuthError("cancelled"))
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new AuthError("cancelled"))
    }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, {once: true})
    promise.then(
      () => {
        cleanup()
        resolve()
      },
      error => {
        cleanup()
        reject(error)
      },
    )
  })
}
const entryFor = (socket: Socket) => {
  let entry = entries.get(socket)
  if (entry) return entry
  entry = {identity: pubkey.get() || "", controller: new AbortController(), cleanup: () => {}}
  entries.set(socket, entry)
  const current = entry
  const unsubscribe = pubkey.subscribe(identity => {
    if ((identity || "") === current.identity) return
    current.controller.abort()
    socket.auth.cancel()
    current.cleanup()
    entries.delete(socket)
    // Do not retain any authenticated identities or pending private reads.
    if (Pool.get()._data.get(socket.url) === socket) Pool.get().remove(socket.url)
    else socket.cleanup()
  })
  const offCleanup = on(socket, SocketEvent.Cleanup, () => {
    current.controller.abort()
    current.cleanup()
    entries.delete(socket)
  })
  current.cleanup = () => {
    unsubscribe()
    offCleanup()
  }
  return entry
}

export const cancelRelayAuthentication = (socket: Socket) => {
  const entry = entries.get(socket)
  entry?.controller.abort()
  socket.auth.cancel()
}

export const authenticateRelay = (
  socket: Socket,
  options: RelayAuthOptions = {},
): Promise<void> => {
  if (options.signal?.aborted) return Promise.reject(new AuthError("cancelled"))
  if (isOperationScopedProviderAuthSocket(socket)) return Promise.resolve()
  const required = getRelayPolicy(socket.url).auth === "required"
  const activePubkey = pubkey.get(),
    activeSigner = signer.get()
  if (!isUserOwnedRelay(socket.url))
    return Promise.reject(new RelayAuthenticationError(socket.url, "consent-required"))
  if ((!activePubkey || !activeSigner) && (required || activePubkey))
    return Promise.reject(
      new RelayAuthenticationError(socket.url, activePubkey ? "signer-required" : "login-required"),
    )
  const selected = activeSigner && activePubkey ? activeSigner : (guest ||= Nip01Signer.ephemeral())
  const entry = entryFor(socket)
  if (entry.promise) return wait(entry.promise, options.signal)
  if (socket.auth.status === AuthStatus.Ok) return Promise.resolve()
  if (socket.auth.status === AuthStatus.Forbidden) return Promise.reject(new AuthError("forbidden"))
  if (socket.auth.status === AuthStatus.DeniedSignature && !options.retry)
    return Promise.reject(new AuthError("denied"))
  if (entry.controller.signal.aborted) entry.controller = new AbortController()
  const signal = entry.controller.signal
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  entry.promise = promise // install before any synchronous status callbacks
  const run = async () => {
    if (signal.aborted) throw new AuthError("cancelled")
    if (!socket.auth.challenge) {
      // Required relays may challenge only after a REQ. Probe empty IDs, not a
      // private coordinate, and never route the probe through public discovery.
      const id = `auth-probe-${socket.auth.generation}`
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
          clearTimeout(timer)
          offAuth()
          offStatus()
          signal.removeEventListener("abort", abort)
          for (const message of socket._sendQueue.items)
            if (message[0] === "REQ" && message[1] === id) socket._sendQueue.remove(message)
          if (socket.status === SocketStatus.Open) socket.send(["CLOSE", id])
        }
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          cleanup()
          if (error) reject(error)
          else resolve()
        }
        const abort = () => finish(new AuthError("cancelled"))
        const offAuth = on(socket.auth, AuthStateEvent.Status, () => {
          if (socket.auth.challenge) finish()
        })
        const offStatus = on(socket, SocketEvent.Status, status => {
          if ([SocketStatus.Closed, SocketStatus.Error].includes(status))
            finish(new AuthError("disconnected"))
        })
        const timer = setTimeout(() => finish(new AuthError("timeout")), 5000)
        signal.addEventListener("abort", abort, {once: true})
        socket.attemptToOpen()
        socket.send(["REQ", id, {ids: ["0".repeat(64)], limit: 0}])
      })
    }
    const sign = async (event: Parameters<typeof selected.sign>[0]) => {
      if (signal.aborted || pubkey.get() !== activePubkey || signer.get() !== activeSigner)
        throw new AuthError("cancelled")
      const signed = await selected.sign(event)
      if (signal.aborted || pubkey.get() !== activePubkey || signer.get() !== activeSigner)
        throw new AuthError("cancelled")
      return signed
    }
    if (options.retry && socket.auth.status === AuthStatus.DeniedSignature) {
      await socket.auth.retryAuth(sign, {
        signal,
        signTimeout: options.signTimeout ?? RELAY_AUTH_SIGN_TIMEOUT,
        ackTimeout: options.ackTimeout ?? RELAY_AUTH_ACK_TIMEOUT,
      })
    } else {
      await socket.auth.authenticate(sign, {
        signal,
        signTimeout: options.signTimeout ?? RELAY_AUTH_SIGN_TIMEOUT,
        ackTimeout: options.ackTimeout ?? RELAY_AUTH_ACK_TIMEOUT,
      })
    }
  }
  void run().then(
    () => {
      if (entry.promise === promise) entry.promise = undefined
      resolve()
    },
    error => {
      if (entry.promise === promise) entry.promise = undefined
      reject(error)
    },
  )
  return wait(promise, options.signal)
}

export const coordinatedAuthPolicy = (socket: Socket) => {
  const attempt = () => {
    if (socket.auth.status === AuthStatus.Requested && getRelayPolicy(socket.url).auth !== "none")
      void authenticateRelay(socket).catch(error => {
        if (
          !socket._disposed &&
          error instanceof AuthError &&
          ["superseded", "disconnected"].includes(error.reason)
        )
          attempt()
      })
  }
  const unsubscribers = [
    on(socket.auth, AuthStateEvent.Status, attempt),
    signer.subscribe(attempt),
    pubkey.subscribe(attempt),
    subscribeRelayAuthConsent(attempt),
  ]
  const runtimeRequired = (message: RelayMessage) => {
    const reason = isRelayClosed(message)
      ? message[2]
      : isRelayOk(message) && !message[2]
        ? message[3]
        : ""
    if (reason?.startsWith("auth-required:")) {
      recordRelayAuthRequired(socket.url)
      attempt()
    }
  }
  // Update policy/start consented authentication before the shared replay owner
  // decides whether this CLOSED is terminal or awaiting one AUTH-confirmed retry.
  socket.prependListener(SocketEvent.Receiving, runtimeRequired)
  return () => {
    socket.off(SocketEvent.Receiving, runtimeRequired)
    unsubscribers.forEach(unsubscribe => unsubscribe())
    const entry = entries.get(socket)
    entry?.controller.abort()
    entry?.cleanup()
    entries.delete(socket)
  }
}
