import {on, always, call, ago, now} from "@welshman/lib"
import {type StampedEvent, type SignedEvent} from "@welshman/util"
import {
  type ClientMessage,
  isClientClose,
  isClientEvent,
  isClientReq,
  isClientNegOpen,
  isClientNegClose,
  type RelayMessage,
  isRelayOk,
  isRelayClosed,
} from "./message.js"
import {type Socket, SocketStatus, SocketEvent, type SocketPolicy} from "./socket.js"
import {AuthStatus, AuthStateEvent} from "./auth.js"
import {retainReadReplay} from "./read-replay.js"

/**
 * Sends a ping message every so often to ensure connection health
 * @param socket - a Socket object
 * @return a cleanup function
 */
export const socketPolicyPing = (socket: Socket) => {
  let lastActivity = 0

  const unsubscribers = [
    on(socket, SocketEvent.Send, (message: ClientMessage) => {
      lastActivity = Date.now()
    }),
    on(socket, SocketEvent.Receive, (message: ClientMessage) => {
      lastActivity = Date.now()
    }),
  ]

  const interval = setInterval(() => {
    if (socket.status === SocketStatus.Open && lastActivity < Date.now() - 30_000) {
      socket._ws?.send('["PING"]')
    }
  }, 30_000)

  return () => {
    unsubscribers.forEach(call)
    clearInterval(interval)
  }
}

/**
 * Handles auth-related message management:
 * - Defers sending messages when a challenge is pending
 * - Replays only still-active REQs once if rejected due to auth-required
 * @param socket - a Socket object
 * @return a cleanup function
 */
export const socketPolicyAuthBuffer = (socket: Socket) => {
  return retainReadReplay(socket)
}

/**
 * Auto-connects a closed socket when a message is sent unless there was a recent error
 * @param socket - a Socket object
 * @return a cleanup function
 */
export const socketPolicyConnectOnSend = (socket: Socket) => {
  let lastError = 0

  const unsubscribers = [
    on(socket, SocketEvent.Status, (newStatus: SocketStatus) => {
      // Keep track of the most recent error
      if (newStatus === SocketStatus.Error) {
        lastError = now()
      }
    }),
    on(socket, SocketEvent.Sending, (message: ClientMessage) => {
      const isClosed = [SocketStatus.Closed, SocketStatus.Error].includes(socket.status)

      // When a new message is sent, make sure the socket is open (unless there was a recent error)
      if (isClosed && lastError < ago(5)) {
        socket.open()
      }
    }),
  ]

  return () => unsubscribers.forEach(call)
}

/**
 * Auto-closes inactive sockets, and re-opens sockets with pending messages
 * @param socket - a Socket object
 * @return a cleanup function
 */
export const socketPolicyCloseInactive = (socket: Socket) => {
  const pending = new Map<string, ClientMessage>()
  const releaseReplay = retainReadReplay(socket, true)
  let lastActivity = now()

  const unsubscribers = [
    on(socket, SocketEvent.Send, (message: ClientMessage) => {
      lastActivity = now()

      if (isClientEvent(message)) {
        pending.set(message[1].id, message)
      }

      if (isClientReq(message) || isClientNegOpen(message)) {
        pending.set(message[1], message)
      }

      if (isClientClose(message) || isClientNegClose(message)) {
        pending.delete(message[1])
      }
    }),
    // A CLOSE queued while disconnected must cancel reconnect replay before
    // the send queue starts again.
    on(socket, SocketEvent.Sending, (message: ClientMessage) => {
      if (isClientClose(message) || isClientNegClose(message)) {
        pending.delete(message[1])
      }
    }),
    on(socket, SocketEvent.Receive, (message: RelayMessage) => {
      lastActivity = now()

      if (isRelayClosed(message) || isRelayOk(message)) {
        pending.delete(message[1])
      }
    }),
  ]

  const interval = setInterval(() => {
    if (socket.status === SocketStatus.Open && lastActivity < ago(30) && pending.size === 0) {
      socket.close()
    }
  }, 3000)

  return () => {
    releaseReplay()
    unsubscribers.forEach(call)
    clearInterval(interval)
  }
}

export type SocketPolicyAuthOptions = {
  sign: (event: StampedEvent) => Promise<SignedEvent>
  shouldAuth?: (socket: Socket) => boolean
}

/**
 * Factory function for a policy which may authenticate the socket
 * @param options - SocketPolicyAuthOptions object
 * @return a socket policy
 */
export const makeSocketPolicyAuth = (options: SocketPolicyAuthOptions) => (socket: Socket) => {
  const shouldAuth = options.shouldAuth || always(true)

  const unsubscribers = [
    on(socket.auth, AuthStateEvent.Status, (status: AuthStatus) => {
      if (status === AuthStatus.Requested && shouldAuth(socket)) {
        void socket.auth.doAuth(options.sign).catch(() => undefined)
      }
    }),
  ]

  return () => {
    unsubscribers.forEach(call)
  }
}

export const defaultSocketPolicies: SocketPolicy[] = [
  socketPolicyPing,
  socketPolicyAuthBuffer,
  socketPolicyConnectOnSend,
  socketPolicyCloseInactive,
]
