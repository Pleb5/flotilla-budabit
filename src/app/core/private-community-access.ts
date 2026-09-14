import {writable} from "svelte/store"
import {on} from "@welshman/lib"
import {
  AuthError,
  AuthStatus,
  AuthStateEvent,
  Repository,
  Socket,
  SocketAdapter,
  requestOne,
  socketPolicyAuthBuffer,
  socketPolicyConnectOnSend,
} from "@welshman/net"
import {verifyEvent, type TrustedEvent} from "@welshman/util"
import {authenticateRelay, cancelRelayAuthentication} from "./relay-auth-coordinator"
import {recordRelayAuthRequired} from "./relay-policy"
import {allowRelayAuthentication, requireExplicitRelayAuthConsent} from "./relay-auth-consent"
import {selectCurrentCommunityDefinitions, type CommunityDefinition} from "./community-protocol"
import type {PrivateCommunityScope} from "./private-community-scope"

export type PrivateAccessState =
  | "consent"
  | "signing"
  | "awaiting-ack"
  | "checking"
  | "ready"
  | "denied"
  | "unavailable"
  | "partial"
  | "revoked"
  | "cancelled"
export type PrivateAccessView = {
  access: PrivateAccessState
  relays: Record<string, PrivateAccessState>
  definition?: CommunityDefinition
  events: TrustedEvent[]
}
export const privateAccessHeading = (
  identity: string | undefined,
  hasSigner: boolean,
  access: PrivateAccessState,
) => {
  if (!identity) return "Sign in to this private community"
  if (!hasSigner) return "Connect a signer to continue"
  return {
    consent: "Authenticate to the invitation relays",
    signing: "Waiting for your signer",
    "awaiting-ack": "Waiting for relay confirmation",
    checking: "Checking community access",
    ready: "Private community",
    denied: "Access denied",
    unavailable: "Community read policy unavailable",
    partial: "Community data is incomplete",
    revoked: "Access interrupted or revoked",
    cancelled: "Authentication cancelled",
  }[access]
}

const deps = {
  socket: (url: string) => new Socket(url, [socketPolicyAuthBuffer, socketPolicyConnectOnSend]),
  authenticate: authenticateRelay,
  request: requestOne,
}

// Dedicated sockets and repository: never register these with Pool or global
// relay diagnostics, trackers, notification/search stores, or persistence.
export class PrivateCommunityAccess {
  view = writable<PrivateAccessView>({access: "consent", relays: {}, events: []})
  repository = new Repository()
  sockets = new Map<string, Socket>()
  private generation = 0
  private disposed = false
  private controller = new AbortController()
  private off: (() => void)[] = []
  private relayStates: Record<string, PrivateAccessState> = {}
  private everReady = false

  constructor(
    readonly scope: PrivateCommunityScope,
    readonly identity: string,
    readonly transport = deps,
  ) {
    requireExplicitRelayAuthConsent(scope.relays)
  }

  private update() {
    const states = Object.values(this.relayStates)
    const retained = this.repository.query([{}])
    const definition = selectCurrentCommunityDefinitions(retained).get(this.scope.pointer.address)
    let access: PrivateAccessState = "checking"
    if (states.includes("signing")) access = "signing"
    else if (states.includes("awaiting-ack")) access = "awaiting-ack"
    else if (states.includes("checking")) access = "checking"
    else if (states.includes("revoked")) access = "revoked"
    else if (states.includes("ready") || states.includes("partial"))
      access = states.every(state => state === "ready") && definition ? "ready" : "partial"
    else if (states.every(state => state === "denied")) access = "denied"
    else if (states.includes("cancelled")) access = "cancelled"
    else access = "unavailable"
    if (access === "ready") this.everReady = true
    this.view.set({access, relays: {...this.relayStates}, definition, events: retained})
  }

  async start() {
    if (this.disposed || !this.identity || this.scope.error || !this.scope.relays.length) return
    const generation = ++this.generation
    this.controller.abort()
    this.controller = new AbortController()
    this.off.splice(0).forEach(off => off())
    this.repository = new Repository()
    const signal = this.controller.signal
    const current = () => !this.disposed && generation === this.generation && !signal.aborted
    this.relayStates = Object.fromEntries(this.scope.relays.map(relay => [relay, "checking"]))
    this.update()
    await Promise.all(
      this.scope.relays.map(async relay => {
        allowRelayAuthentication(relay, this.identity)
        recordRelayAuthRequired(relay)
        let socket = this.sockets.get(relay)
        if (!socket || socket._disposed) {
          socket = this.transport.socket(relay)
          this.sockets.set(relay, socket)
        }
        const state = (value: PrivateAccessState) => {
          if (!current()) return
          this.relayStates[relay] = value
          if (value === "denied" || value === "revoked") {
            // Do not let another relay or an already-popped callback refill the
            // private repository after a confirmed denial/revocation.
            this.generation++
            this.controller.abort()
            this.off.splice(0).forEach(off => off())
            this.repository = new Repository()
            this.view.set({access: value, relays: {...this.relayStates}, events: []})
            return
          }
          this.update()
        }
        this.off.push(
          on(socket.auth, AuthStateEvent.Status, (status: AuthStatus) => {
            if (status === AuthStatus.PendingSignature) state("signing")
            if (status === AuthStatus.PendingResponse) state("awaiting-ack")
            if (status === AuthStatus.Ok) state("checking")
          }),
        )
        try {
          await this.transport.authenticate(socket, {signal, retry: true})
          if (!current()) return
          state("checking")
          // Keep this full-history subscription alive after EOSE to detect revoke
          // and receive changes. No global repository or verification shortcuts.
          let count = 0,
            bytes = 0,
            completed = false,
            invalid = false
          const maxEvents = 200
          const timer = setTimeout(() => {
            if (!completed) state("unavailable")
          }, 15_000)
          this.off.push(() => clearTimeout(timer))
          this.transport.request({
            relay,
            filters: [{limit: maxEvents}],
            signal,
            autoClose: false,
            context: {getAdapter: () => new SocketAdapter(socket!)},
            isEventValid: event => Boolean(event.sig && verifyEvent(event)),
            isEventDeleted: () => false,
            onInvalid: () => {
              invalid = true
              if (completed) state("partial")
            },
            onEvent: event => {
              if (!current()) return
              bytes += JSON.stringify(event).length
              if (++count > 5000 || bytes > 8 * 1024 * 1024) {
                invalid = true
                state("partial")
                socket!.close()
                return
              }
              this.repository.publish(event)
              this.update()
            },
            onEose: () => {
              completed = true
              clearTimeout(timer)
              state(invalid || count >= maxEvents ? "partial" : "ready")
            },
            onClosed: reason => {
              completed = true
              clearTimeout(timer)
              state(reason.startsWith("restricted:") ? "denied" : "unavailable")
            },
            onDisconnect: () => {
              completed = true
              clearTimeout(timer)
              state(this.everReady ? "revoked" : "unavailable")
            },
          })
        } catch (error) {
          if (!current()) return
          state(
            error instanceof AuthError && ["cancelled", "denied"].includes(error.reason)
              ? "cancelled"
              : "unavailable",
          )
        }
      }),
    )
  }

  cancel() {
    this.generation++
    this.controller.abort()
    this.off.splice(0).forEach(off => off())
    for (const socket of this.sockets.values()) cancelRelayAuthentication(socket)
    this.repository = new Repository()
    this.view.set({access: "cancelled", relays: {}, events: []})
  }

  dispose() {
    this.cancel()
    this.disposed = true
    for (const socket of this.sockets.values()) socket.cleanup()
    this.sockets.clear()
  }
}
