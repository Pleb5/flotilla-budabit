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
  type ClientMessage,
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
type Attempt = {
  controller: AbortController
  promise: Promise<void>
  consumers: number
}
type Entry = {
  identity: string
  attempt?: Attempt
  cleanup: () => void
}
const entries = new WeakMap<Socket, Entry>()

const cancelAttempt = (socket: Socket, entry: Entry) => {
  const attempt = entry.attempt
  if (!attempt) return
  // Invalidate synchronously: a new consumer must not adopt cancelled work.
  entry.attempt = undefined
  attempt.controller.abort()
  socket.auth.cancel()
}
// Each call owns interest until settlement/cancellation, including socket policy.
// Cancellation cannot withdraw a remote signer prompt, only reject its result.
const wait = (
  socket: Socket,
  entry: Entry,
  attempt: Attempt,
  signal?: AbortSignal,
): Promise<void> => {
  attempt.consumers++
  let detached = false
  const release = () => {
    if (detached) return
    detached = true
    if (--attempt.consumers === 0 && entry.attempt === attempt) cancelAttempt(socket, entry)
  }
  if (!signal) {
    void attempt.promise.then(release, release)
    return attempt.promise
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new AuthError("cancelled"))
    }
    const cleanup = () => {
      signal.removeEventListener("abort", abort)
      release()
    }
    signal.addEventListener("abort", abort, {once: true})
    attempt.promise.then(
      () => {
        cleanup()
        resolve()
      },
      error => {
        cleanup()
        reject(error)
      },
    )
    if (signal.aborted) abort()
  })
}
const entryFor = (socket: Socket) => {
  let entry = entries.get(socket)
  if (entry) return entry
  entry = {identity: pubkey.get() || "", cleanup: () => {}}
  entries.set(socket, entry)
  const current = entry
  const unsubscribe = pubkey.subscribe(identity => {
    if ((identity || "") === current.identity) return
    cancelAttempt(socket, current)
    socket.auth.cancel()
    current.cleanup()
    entries.delete(socket)
    // Do not retain any authenticated identities or pending private reads.
    if (Pool.get()._data.get(socket.url) === socket) Pool.get().remove(socket.url)
    else socket.cleanup()
  })
  const offCleanup = on(socket, SocketEvent.Cleanup, () => {
    cancelAttempt(socket, current)
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
  if (entry) cancelAttempt(socket, entry)
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
  if (entry.attempt) return wait(socket, entry, entry.attempt, options.signal)
  if (socket.auth.status === AuthStatus.Ok) return Promise.resolve()
  if (socket.auth.status === AuthStatus.Forbidden) return Promise.reject(new AuthError("forbidden"))
  const retry = options.retry || socket.auth.details === "cancelled"
  if (socket.auth.status === AuthStatus.DeniedSignature && !retry)
    return Promise.reject(new AuthError("denied"))
  const controller = new AbortController(),
    signal = controller.signal
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const attempt = {controller, promise, consumers: 0}
  entry.attempt = attempt // install/retain before any synchronous status callbacks
  const waiting = wait(socket, entry, attempt, options.signal)
  const run = async () => {
    if (signal.aborted) throw new AuthError("cancelled")
    if (!socket.auth.challenge) {
      // Required relays may challenge only after a REQ. Probe empty IDs, not a
      // private coordinate, and never route the probe through public discovery.
      const id = `auth-probe-${socket.auth.generation}`
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const probe: ClientMessage = ["REQ", id, {ids: ["0".repeat(64)], limit: 0}]
        const cleanup = () => {
          clearTimeout(timer)
          offAuth()
          offStatus()
          signal.removeEventListener("abort", abort)
          for (const message of socket._sendQueue.items)
            if (message[0] === "REQ" && message[1] === id) socket._sendQueue.remove(message)
          // Sending CLOSE also releases replay ownership before a future retry.
          const close: ClientMessage = ["CLOSE", id]
          if (socket.status === SocketStatus.Open) socket.send(close)
          else socket.emit(SocketEvent.Sending, close, socket.url)
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
        const generation = socket._generation
        socket._sendGuards.set(
          probe,
          () => !settled && !signal.aborted && generation === socket._generation,
        )
        socket.attemptToOpen()
        if (!settled && !signal.aborted) socket.send(probe)
      })
    }
    const sign = async (event: Parameters<typeof selected.sign>[0]) => {
      if (signal.aborted || pubkey.get() !== activePubkey || signer.get() !== activeSigner)
        throw new AuthError("cancelled")
      const expectedPubkey = activePubkey || (await selected.getPubkey())
      const signed = await selected.sign(event, {signal})
      if (signal.aborted || pubkey.get() !== activePubkey || signer.get() !== activeSigner)
        throw new AuthError("cancelled")
      if (!signed || signed.pubkey !== expectedPubkey) throw new AuthError("denied")
      return signed
    }
    if (retry && socket.auth.status === AuthStatus.DeniedSignature) {
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
      if (entry.attempt === attempt) entry.attempt = undefined
      resolve()
    },
    error => {
      if (entry.attempt === attempt) entry.attempt = undefined
      reject(error)
    },
  )
  return waiting
}

export const coordinatedAuthPolicy = (socket: Socket) => {
  const controller = new AbortController()
  let pending = false
  const attempt = () => {
    if (
      !pending &&
      !controller.signal.aborted &&
      [AuthStatus.Requested, AuthStatus.PendingSignature, AuthStatus.PendingResponse].includes(
        socket.auth.status,
      ) &&
      getRelayPolicy(socket.url).auth !== "none"
    ) {
      pending = true
      void authenticateRelay(socket, {signal: controller.signal}).then(
        () => {
          pending = false
        },
        error => {
          pending = false
          if (
            !socket._disposed &&
            error instanceof AuthError &&
            ["superseded", "disconnected"].includes(error.reason)
          )
            attempt()
        },
      )
    }
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
    controller.abort()
  }
}
