import WebSocket from "isomorphic-ws"
import EventEmitter from "events"
import {TaskQueue, call} from "@welshman/lib"
import {type RelayMessage, type ClientMessage, isRelayClosed, isRelayOk} from "./message.js"
import {AuthState} from "./auth.js"
import {type Unsubscriber} from "./util.js"

export enum SocketStatus {
  Open = "open",
  Opening = "opening",
  Closing = "closing",
  Closed = "closed",
  Error = "error",
}

export enum SocketEvent {
  Cleanup = "cleanup",
  Error = "error",
  Status = "status",
  Send = "send",
  Sending = "sending",
  Receive = "receive",
  Receiving = "receiving",
}

export type SocketEvents = {
  [SocketEvent.Error]: (error: string, url: string) => void
  [SocketEvent.Status]: (status: SocketStatus, url: string) => void
  [SocketEvent.Send]: (message: ClientMessage, url: string) => void
  [SocketEvent.Sending]: (message: ClientMessage, url: string) => void
  [SocketEvent.Receive]: (message: RelayMessage, url: string) => void
  [SocketEvent.Receiving]: (message: RelayMessage, url: string) => void
}

export type SocketPolicy = (socket: Socket) => Unsubscriber

export class Socket extends EventEmitter {
  static batchSize = 20
  static batchDelay = 100

  auth: AuthState
  status = SocketStatus.Closed
  unsubscribers: Unsubscriber[]

  _ws?: WebSocket
  _sendQueue: TaskQueue<ClientMessage>
  _recvQueue: TaskQueue<RelayMessage>
  _generation = 0
  _sendGenerations = new WeakMap<ClientMessage, number>()
  _sendGuards = new WeakMap<ClientMessage, () => boolean>()
  _recvGenerations = new WeakMap<RelayMessage, number>()
  _pendingTerminal = new Set<RelayMessage>()
  _disposed = false

  constructor(
    readonly url: string,
    readonly policies: SocketPolicy[] = [],
  ) {
    super()

    this.auth = new AuthState(this)

    this._sendQueue = new TaskQueue<ClientMessage>({
      batchSize: Socket.batchSize,
      batchDelay: Socket.batchDelay,
      processItem: (message: ClientMessage) => {
        if (
          this._disposed ||
          this.status !== SocketStatus.Open ||
          this._sendGenerations.get(message) !== this._generation
        )
          return
        if (this._sendGuards.has(message) && !this._sendGuards.get(message)!()) return
        this._ws?.send(JSON.stringify(message))
        this.emit(SocketEvent.Send, message, this.url)
      },
    })

    this._recvQueue = new TaskQueue<RelayMessage>({
      batchSize: Socket.batchSize,
      // Relay terminal frames must not sit behind seconds of EVENT batches.
      batchDelay: 0,
      processItem: (message: RelayMessage) => {
        this._pendingTerminal.delete(message)
        const generation = this._recvGenerations.get(message)
        if (this._disposed || (generation !== undefined && generation !== this._generation)) return
        this.emit(SocketEvent.Receive, message, this.url)
      },
    })

    this.on(SocketEvent.Status, (status: SocketStatus) => {
      this.status = status
    })

    this._sendQueue.stop()
    this.setMaxListeners(1000)
    this.unsubscribers = policies.map(p => p(this))
  }

  open = () => {
    if (this._disposed) return
    if (this._ws) {
      throw new Error("Attempted to open a websocket that has not been closed")
    }

    try {
      this._ws = new WebSocket(this.url)
      const ws = this._ws
      this.emit(SocketEvent.Status, SocketStatus.Opening, this.url)

      this._ws.onopen = () => {
        if (this._ws !== ws) return
        this.emit(SocketEvent.Status, SocketStatus.Open, this.url)
        this._sendQueue.start()
      }

      this._ws.onerror = () => {
        if (this._ws !== ws) return
        this.flushPendingTerminal()
        if (this._ws !== ws) return // A terminal handler may dispose or replace the transport.
        this.resetTransport()
        this.emit(SocketEvent.Status, SocketStatus.Error, this.url)
      }

      this._ws.onclose = () => {
        if (this._ws !== ws) return
        this.flushPendingTerminal()
        if (this._ws !== ws) return
        this.resetTransport()

        if (this.status !== SocketStatus.Error) {
          this.emit(SocketEvent.Status, SocketStatus.Closed, this.url)
        }
      }

      this._ws.onmessage = (event: any) => {
        if (this._ws !== ws) return
        const data = event.data as string

        try {
          const message = JSON.parse(data)

          if (Array.isArray(message)) {
            this._recvGenerations.set(message as RelayMessage, this._generation)
            this._recvQueue.push(message as RelayMessage)
            this.emit(SocketEvent.Receiving, message, this.url)
            // Respect policies that remove auth-required CLOSED for REQ replay.
            if (
              (isRelayClosed(message) || isRelayOk(message)) &&
              this._recvQueue.items.includes(message)
            ) {
              this._pendingTerminal.add(message)
            }
          } else {
            this.emit(SocketEvent.Error, "Invalid message received", this.url)
          }
        } catch (e) {
          this.emit(SocketEvent.Error, "Invalid message received", this.url)
        }
      }
    } catch (e) {
      this.emit(SocketEvent.Status, SocketStatus.Error, this.url)
    }
  }

  attemptToOpen = () => {
    if (!this._ws) {
      this.open()
    }
  }

  close = () => {
    const ws = this._ws
    this.resetTransport()
    this.emit(SocketEvent.Status, SocketStatus.Closed, this.url)
    ws?.close()
  }

  resetTransport = () => {
    this._ws = undefined
    this._generation++
    this._sendQueue.stop()
    this._sendQueue.clear()
    this._recvQueue.clear()
    this._pendingTerminal.clear()
  }

  private flushPendingTerminal = () => {
    const generation = this._generation
    // A peer may send CLOSED/OK and disconnect before the receive batch runs.
    // Preserve terminal reasons and ACKs (including those in a popped batch)
    // so publishers and their capability observers see the actual outcome.
    // Never flush EVENT/EOSE or carry frames across transport generations.
    for (const message of this._pendingTerminal) {
      if (this._disposed || this._generation !== generation) break
      this._recvQueue.remove(message)
      try {
        this._recvQueue.options.processItem(message)
      } catch (error) {
        // Match TaskQueue's per-message isolation so teardown still completes.
        console.error(error)
      }
    }
  }

  cleanup = () => {
    if (this._disposed) return
    this._disposed = true
    this.emit(SocketEvent.Cleanup)
    this.unsubscribers.forEach(call)
    this.close()
    this.auth.cleanup()
    this._recvQueue.clear()
    this._sendQueue.clear()
    this.removeAllListeners()
  }

  send = (message: ClientMessage) => {
    if (this._disposed) return
    this._sendGenerations.set(message, this._generation)
    this._sendQueue.push(message)
    this.emit(SocketEvent.Sending, message, this.url)
  }
}
