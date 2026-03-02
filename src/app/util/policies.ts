import {on, call, dissoc, assoc, uniq} from "@welshman/lib"
import type {Socket, RelayMessage, ClientMessage} from "@welshman/net"
import {
  AuthStateEvent,
  AuthStatus,
  SocketEvent,
  isRelayEvent,
  isRelayOk,
  isRelayClosed,
  isRelayNegErr,
  isClientReq,
  isClientEvent,
  isClientClose,
  isClientNegOpen,
  isClientNegClose,
} from "@welshman/net"
import {signer} from "@welshman/app"
import {
  userSettingsValues,
  getSetting,
  relaysPendingTrust,
  relaysMostlyRestricted,
} from "@app/core/state"

export const authPolicy = (socket: Socket) => {
  let inFlight = false

  const attemptAuth = async () => {
    if (inFlight) return
    const $signer = signer.get()
    if (!$signer) return
    if (socket.auth.status !== AuthStatus.Requested) return
    inFlight = true
    try {
      await socket.auth.doAuth(event => $signer.sign(event))
    } finally {
      inFlight = false
    }
  }

  const unsubscribers = [
    on(socket.auth, AuthStateEvent.Status, status => {
      if (status === AuthStatus.Requested) {
        attemptAuth()
      }
    }),
    signer.subscribe(() => {
      attemptAuth()
    }),
  ]

  return () => {
    unsubscribers.forEach(call)
  }
}

export const trustPolicy = (socket: Socket) => {
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
    on(socket, SocketEvent.Receiving, (message: RelayMessage) => {
      if (isRelayEvent(message) && !message[2]?.sig) {
        const isTrusted = getSetting<string[]>("trusted_relays").includes(socket.url)

        if (!isTrusted) {
          buffer.push(message)
          socket._recvQueue.remove(message)
          relaysPendingTrust.update($r => uniq([...$r, socket.url]))
        }
      }
    }),
  ]

  return () => {
    unsubscribers.forEach(call)
  }
}

export const mostlyRestrictedPolicy = (socket: Socket) => {
  let total = 0
  let restricted = 0

  const pending = new Set<string>()

  const updateStatus = (error?: string) => {
    if (restricted > total / 2) {
      if (error) {
        return relaysMostlyRestricted.update(assoc(socket.url, error))
      }
    } else {
      relaysMostlyRestricted.update(dissoc(socket.url))
    }
  }

  const unsubscribers = [
    on(socket, SocketEvent.Receive, (message: RelayMessage) => {
      if (isRelayOk(message)) {
        const [_, id, ok, details = ""] = message

        if (pending.has(id)) {
          pending.delete(id)

          if (!ok) {
            if (details.startsWith("auth-required: ")) {
              total--
              updateStatus()
            }

            if (details.startsWith("restricted: ")) {
              restricted++
              updateStatus(details)
            }
          }
        }
      }

      if (isRelayClosed(message) || isRelayNegErr(message)) {
        const [_, id, details = ""] = message

        if (pending.has(id)) {
          pending.delete(id)

          if (details.startsWith("auth-required: ")) {
            total--
            updateStatus()
          }

          if (details.startsWith("restricted: ")) {
            restricted++
            updateStatus(details)
          }
        }
      }
    }),
    on(socket, SocketEvent.Send, (message: ClientMessage) => {
      if (isClientReq(message) || isClientNegOpen(message)) {
        if (!pending.has(message[1])) {
          total++
          pending.add(message[1])
          updateStatus()
        }
      }

      if (isClientEvent(message)) {
        total++
        pending.add(message[1].id)
        updateStatus()
      }

      if (isClientClose(message) || isClientNegClose(message)) {
        pending.delete(message[1])
      }
    }),
  ]

  return () => {
    unsubscribers.forEach(call)
  }
}
