import EventEmitter from "events"
import {on, call, randomId} from "@welshman/lib"
import {type SignedEvent, type StampedEvent, makeRelayAuth, verifyEvent} from "@welshman/util"
import {isRelayAuth, isRelayOk, type RelayMessage, type ClientMessage} from "./message.js"
import {type Socket, SocketStatus, SocketEvent} from "./socket.js"
import {type Unsubscriber} from "./util.js"

export enum AuthStatus {
  None = "none",
  Requested = "requested",
  PendingSignature = "pending_signature",
  DeniedSignature = "denied_signature",
  PendingResponse = "pending_response",
  Forbidden = "forbidden",
  Ok = "ok",
}

export type AuthResult = {ok: boolean; reason?: string}
export enum AuthStateEvent {
  Status = "auth:event:status",
}
export type AuthStateEvents = {[AuthStateEvent.Status]: (status: AuthStatus) => void}
export type AuthOptions = {signal?: AbortSignal; signTimeout?: number; ackTimeout?: number}
export class AuthError extends Error {
  constructor(
    readonly reason:
      | "cancelled"
      | "timeout"
      | "disconnected"
      | "superseded"
      | "denied"
      | "forbidden"
      | "no-challenge",
  ) {
    super(`Relay authentication ${reason}`)
    this.name = "AuthError"
  }
}
type Sign = (event: StampedEvent) => Promise<SignedEvent>
const templateKey = (event: StampedEvent) =>
  JSON.stringify([event.kind, event.content, event.created_at, event.tags])
type Attempt = {
  generation: number
  challenge: string
  promise: Promise<void>
  finish: (error?: AuthError) => void
  message?: ClientMessage
}

export class AuthState extends EventEmitter {
  challenge: string | undefined
  request: string | undefined
  details: string | undefined
  status = AuthStatus.None
  generation = 0
  // Sticky evidence is useful when deciding whether to wait before reconnect replay.
  challenged = false
  _attempt?: Attempt
  _unsubscribers: Unsubscriber[] = []

  constructor(readonly socket: Socket) {
    super()
    this._unsubscribers.push(
      on(socket, SocketEvent.Receive, (message: RelayMessage) => {
        if (isRelayOk(message) && this._attempt && message[1] === this.request) {
          this.details = message[3]
          const attempt = this._attempt
          // Settle/clear before emitting terminal status; a listener may retry.
          attempt.finish(message[2] ? undefined : new AuthError("forbidden"))
          this.setStatus(message[2] ? AuthStatus.Ok : AuthStatus.Forbidden)
        }
      }),
      // Learn challenges at wire ingress, before read-replay sees an adjacent
      // auth-required CLOSED. Deferred Receive processing is too late. Do not
      // process AUTH again there: an older queued challenge could replace a
      // newer one. Matching ACKs still settle through the normal receive queue.
      on(socket, SocketEvent.Receiving, (message: RelayMessage) => {
        if (isRelayAuth(message) && message[1] !== this.challenge) {
          this.cancel(new AuthError("superseded"))
          this.challenged = true
          this.challenge = message[1]
          this.request = this.details = undefined
          this.setStatus(AuthStatus.Requested)
        }
      }),
      on(socket, SocketEvent.Status, (status: SocketStatus) => {
        if (status === SocketStatus.Closed || status === SocketStatus.Error) {
          this.generation++
          this.cancel(new AuthError("disconnected"))
          this.challenge = this.request = this.details = undefined
          this.setStatus(AuthStatus.None)
        }
      }),
    )
  }

  setStatus(status: AuthStatus) {
    this.status = status
    this.emit(AuthStateEvent.Status, status)
  }

  cancel(error = new AuthError("cancelled")) {
    const attempt = this._attempt
    if (!attempt) return
    attempt.finish(error)
    this.request = undefined
    this.details = error.reason
    // No old signature/ACK can change status after this point.
    if (error.reason === "cancelled" || error.reason === "timeout")
      this.setStatus(AuthStatus.DeniedSignature)
  }

  authenticate(sign: Sign, options: AuthOptions = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new AuthError("cancelled"))
    if (this.status === AuthStatus.Ok) return Promise.resolve()
    if (this._attempt) return this._attempt.promise
    if (!this.challenge) return Promise.reject(new AuthError("no-challenge"))
    if (this.status !== AuthStatus.Requested)
      return Promise.reject(
        new AuthError(this.status === AuthStatus.Forbidden ? "forbidden" : "denied"),
      )

    let resolve!: () => void, reject!: (error: AuthError) => void
    const promise = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    let timer: ReturnType<typeof setTimeout>
    const abort = () => this.cancel()
    const attempt: Attempt = {
      generation: this.generation,
      challenge: this.challenge,
      promise,
      finish: error => {
        if (this._attempt !== attempt) return
        this._attempt = undefined
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", abort)
        if (attempt.message) this.socket._sendQueue.remove(attempt.message)
        if (error) reject(error)
        else resolve()
      },
    }
    this._attempt = attempt
    const current = () =>
      this._attempt === attempt &&
      this.generation === attempt.generation &&
      this.challenge === attempt.challenge
    const fail = (reason: "timeout" | "denied") => {
      if (!current()) return
      attempt.finish(new AuthError(reason))
      this.request = undefined
      this.details = reason
      this.setStatus(AuthStatus.DeniedSignature)
    }
    options.signal?.addEventListener("abort", abort, {once: true})
    timer = setTimeout(() => fail("timeout"), options.signTimeout ?? 90_000)
    this.setStatus(AuthStatus.PendingSignature)
    let expectedTemplate: string
    Promise.resolve()
      .then(() => {
        if (current()) {
          const template = makeRelayAuth(this.socket.url, attempt.challenge)
          // Retrying within one timestamp second must produce a different id so
          // a delayed ACK for the previous attempt cannot confirm this one.
          template.tags.push(["nonce", randomId()])
          // Capture before handing mutable input to an external signer.
          expectedTemplate = templateKey(template)
          return sign(template)
        }
      })
      .then(
        event => {
          if (!current()) return
          if (!event) return fail("denied")
          try {
            // Own the wire proof, omit signer-provided verification caches, and
            // recompute its ID/signature. A signer may mutate its input/result.
            event = {
              kind: event.kind,
              content: event.content,
              created_at: event.created_at,
              tags: event.tags.map(tag => [...tag]),
              pubkey: event.pubkey,
              id: event.id,
              sig: event.sig,
            }
            if (templateKey(event) !== expectedTemplate || !verifyEvent(event))
              return fail("denied")
          } catch {
            return fail("denied")
          }
          this.request = event.id
          clearTimeout(timer)
          timer = setTimeout(() => fail("timeout"), options.ackTimeout ?? 10_000)
          this.setStatus(AuthStatus.PendingResponse)
          if (!current()) return
          attempt.message = ["AUTH", event]
          // TaskQueue can already have popped a batch when cancellation occurs;
          // removing its queued item is not sufficient without this final check.
          this.socket._sendGuards.set(attempt.message, current)
          this.socket.send(attempt.message)
        },
        () => fail("denied"),
      )
    return promise
  }

  doAuth(sign: Sign, options?: AuthOptions) {
    return this.authenticate(sign, options)
  }

  // Compatibility wrapper: public callers don't wait if no challenge was issued.
  async attemptAuth(sign: Sign, options?: AuthOptions) {
    this.socket.attemptToOpen()
    if (this.challenge) await this.authenticate(sign, options)
  }

  retryAuth(sign: Sign, options?: AuthOptions) {
    if (!this._attempt && this.challenge && this.status !== AuthStatus.Ok) {
      this.request = this.details = undefined
      this.setStatus(AuthStatus.Requested)
    }
    return this.attemptAuth(sign, options)
  }

  cleanup() {
    this.cancel(new AuthError("disconnected"))
    this.removeAllListeners()
    this._unsubscribers.forEach(call)
  }
}
