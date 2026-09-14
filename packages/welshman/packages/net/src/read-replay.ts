import {on, call} from "@welshman/lib"
import {type Filter} from "@welshman/util"
import {AuthStatus, AuthStateEvent} from "./auth.js"
import {Socket, SocketEvent, SocketStatus} from "./socket.js"
import {
  type ClientMessage,
  type RelayMessage,
  isClientReq,
  isClientClose,
  isRelayClosed,
} from "./message.js"

type Read = {
  message: ClientMessage
  waiting: boolean
  replayed?: string
  closed?: RelayMessage
  guard?: () => boolean
}
const owners = new WeakMap<Socket, ReadReplay>()
const pendingAuth = (socket: Socket) =>
  [AuthStatus.PendingSignature, AuthStatus.PendingResponse].includes(socket.auth.status)

// The auth buffer and reconnect policy share this owner. Only REQ is idempotent:
// EVENT/NEG are never replayed and their failures must reach the caller.
class ReadReplay {
  users = 0
  reconnectUsers = 0
  reads = new Map<string, Read>()
  replaying = false
  reconnecting = false
  openingAt = 0
  lastOpen = Date.now()
  timer?: ReturnType<typeof setTimeout>
  challengeTimer?: ReturnType<typeof setTimeout>
  unsubscribers: (() => void)[]

  constructor(readonly socket: Socket) {
    this.unsubscribers = [
      on(socket, SocketEvent.Sending, (message: ClientMessage) => {
        if (isClientClose(message)) {
          const read = this.reads.get(message[1])
          if (read) socket._sendQueue.remove(read.message)
          this.reads.delete(message[1])
        }
        if (!isClientReq(message) || this.replaying) return
        const previous = this.reads.get(message[1])
        if (previous) socket._sendQueue.remove(previous.message)
        const waiting = pendingAuth(socket) || (this.reconnecting && socket.auth.challenged)
        const guard = socket._sendGuards.get(message)
        this.reads.set(message[1], {message, waiting, guard})
        socket._sendGuards.set(
          message,
          () => this.reads.get(message[1])?.message === message && (!guard || guard()),
        )
        if (waiting) socket._sendQueue.remove(message)
      }),
      on(socket, SocketEvent.Receiving, (message: RelayMessage) => {
        if (!isRelayClosed(message)) return
        const read = this.reads.get(message[1])
        if (!read) return
        const token = `${socket.auth.generation}:${socket.auth.challenge}`
        if (
          message[2]?.startsWith("auth-required:") &&
          pendingAuth(socket) &&
          read.replayed !== token
        ) {
          read.waiting = true
          read.closed = message
          socket._recvQueue.remove(message)
        } else this.reads.delete(message[1])
      }),
      on(socket.auth, AuthStateEvent.Status, (status: AuthStatus) => {
        if (status === AuthStatus.Ok) this.flush()
        if ([AuthStatus.DeniedSignature, AuthStatus.Forbidden].includes(status)) {
          for (const [id, read] of this.reads) {
            if (!read.waiting) continue
            this.reads.delete(id)
            socket._recvQueue.push(
              read.closed || [
                "CLOSED",
                id,
                `auth-required: authentication ${socket.auth.details || status}`,
              ],
            )
          }
          this.reconnecting = false
        }
      }),
      on(socket, SocketEvent.Status, (status: SocketStatus) => {
        if (status === SocketStatus.Open) {
          this.lastOpen = this.openingAt = Date.now()
          if (!this.reconnecting) return
          if (!socket.auth.challenged) this.flush()
          else
            this.challengeTimer = setTimeout(() => {
              // No signature consent: optional relays may still serve public data.
              if (!pendingAuth(socket)) this.flush()
            }, 800)
        }
        if (status === SocketStatus.Closed || status === SocketStatus.Error) {
          clearTimeout(this.timer)
          clearTimeout(this.challengeTimer)
          if (!this.reconnectUsers || !this.reads.size) return
          this.reconnecting = true
          for (const read of this.reads.values()) {
            read.waiting = true
            read.replayed = undefined
            read.message = [
              "REQ",
              read.message[1],
              ...(read.message.slice(2) as Filter[]).map(filter => {
                // An interrupted historical read must not be narrowed to since=now.
                const copy = {...filter}
                if (copy.limit === 0) delete copy.limit
                return copy
              }),
            ]
          }
          this.timer = setTimeout(
            () => {
              if (this.reads.size) socket.attemptToOpen()
            },
            Math.max(0, 5000 - (Date.now() - this.lastOpen)),
          )
        }
      }),
    ]
  }

  flush() {
    const {socket} = this
    this.reconnecting = false
    for (const read of this.reads.values()) {
      if (!read.waiting) continue
      read.waiting = false
      read.closed = undefined
      read.replayed = `${socket.auth.generation}:${socket.auth.challenge}`
      const message = read.message
      socket._sendGuards.set(
        message,
        () => this.reads.get(message[1])?.message === message && (!read.guard || read.guard()),
      )
      this.replaying = true
      try {
        socket.send(read.message)
      } finally {
        this.replaying = false
      }
    }
  }

  cleanup() {
    clearTimeout(this.timer)
    clearTimeout(this.challengeTimer)
    this.unsubscribers.forEach(call)
    this.reads.clear()
    owners.delete(this.socket)
  }
}

export const retainReadReplay = (socket: Socket, reconnect = false) => {
  let owner = owners.get(socket)
  if (!owner) owners.set(socket, (owner = new ReadReplay(socket)))
  owner.users++
  if (reconnect) owner.reconnectUsers++
  return () => {
    if (reconnect) owner.reconnectUsers--
    if (--owner.users === 0) owner.cleanup()
  }
}
