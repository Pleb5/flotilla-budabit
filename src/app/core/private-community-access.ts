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
import {verifyEvent, getAddress, type TrustedEvent} from "@welshman/util"
import {canWriteCommunitySection, getCommunityWriteTargetSections} from "./community-permissions"
import {eventTargetsCommunity} from "./community-feeds"
import {getEffectiveCommunityReportState, getCommunityCensorReason} from "./community-reports"
import {authenticateRelay, cancelRelayAuthentication} from "./relay-auth-coordinator"
import {recordRelayAuthRequired} from "./relay-policy"
import {allowRelayAuthentication, requireExplicitRelayAuthConsent} from "./relay-auth-consent"
import {selectCurrentCommunityDefinitions, type CommunityDefinition} from "./community-protocol"
import type {PrivateCommunityScope} from "./private-community-scope"
import {markPrivateEvent} from "./private-community-policy"
import {loadPrivateRelayProfiles, privateRelayReadLimit} from "./private-relay-profile"
import {publishPrivateCommunityEvent} from "./private-community-publish"
import {pubkey, signer} from "@welshman/app"
import {buildCommunityDefinition, parseCommunityDefinition} from "./community-protocol"
import {get} from "svelte/store"
import {prep} from "@welshman/util"

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
  profiles: loadPrivateRelayProfiles,
}

// Only this explicitly supported, exact-branch text subset reaches the shell.
// Whole-relay read membership and storage acceptance are not author admission.
export const selectPrivateCommunityTextEvents = (
  definition: CommunityDefinition,
  retained: TrustedEvent[],
) => {
  const reportState = getEffectiveCommunityReportState({
    definition,
    profileListEvents: retained,
    reportEvents: retained.filter(event => event.kind === 1984),
    targetEvents: retained,
  })
  const section = getCommunityWriteTargetSections(definition, {kind: 1, sectionName: ""})[0]
  if (!section) return []
  return retained.filter(event => {
    const branches = event.tags.filter(tag => tag[0] === "a" && tag[1]?.startsWith("32222:"))
    return (
      event.kind === 1 &&
      eventTargetsCommunity(event, definition.communityId) &&
      branches.length === 1 &&
      branches[0][1] === definition.pointer.address &&
      canWriteCommunitySection({
        definition,
        profileListEvents: retained,
        userPubkey: event.pubkey,
        sectionName: section.name,
        kind: 1,
        reportState,
      }) &&
      !getCommunityCensorReason({
        reportState,
        eventId: event.id,
        eventAddress: getAddress(event),
        pubkey: event.pubkey,
        sectionName: section.name,
      })
    )
  })
}

// Dedicated sockets and repository: never register these with Pool or global
// relay diagnostics, trackers, notification/search stores, or persistence.
export class PrivateCommunityAccess {
  view = writable<PrivateAccessView>({access: "consent", relays: {}, events: []})
  repository = new Repository({deletionAwareReplaceables: true})
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
    readonly transport: Omit<typeof deps, "profiles"> & {
      profiles?: typeof loadPrivateRelayProfiles
    } = deps,
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
    // Incomplete intake cannot establish absence of bans/deletions or current
    // admission. Retain it privately for retry but do not expose posts yet.
    const events =
      access === "ready" && definition ? selectPrivateCommunityTextEvents(definition, retained) : []
    this.view.set({access, relays: {...this.relayStates}, definition, events})
  }

  async start() {
    if (this.disposed || !this.identity || this.scope.error || !this.scope.relays.length) return
    const generation = ++this.generation
    this.controller.abort()
    this.controller = new AbortController()
    this.off.splice(0).forEach(off => off())
    this.repository.clear()
    const signal = this.controller.signal
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      !signal.aborted &&
      pubkey.get() === this.identity
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
            this.repository.clear()
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
          let effectiveLimit: number | undefined
          try {
            const profiles = await (this.transport.profiles || deps.profiles)([relay], signal)
            effectiveLimit = privateRelayReadLimit(profiles.get(relay))
          } catch {
            /* Unknown capability/limit keeps authority incomplete. */
          }
          if (!current()) return
          // Keep this full-history subscription alive after EOSE to detect revoke
          // and receive changes. No global repository or verification shortcuts.
          let count = 0,
            bytes = 0,
            completed = false,
            invalid = false
          const maxEvents = effectiveLimit ?? 200
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
              markPrivateEvent(event, this.scope.relays)
              this.repository.publish(event)
              this.update()
            },
            onEose: () => {
              completed = true
              clearTimeout(timer)
              state(invalid || !effectiveLimit || count >= maxEvents ? "partial" : "ready")
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
    this.repository.clear()
    this.view.set({access: "cancelled", relays: {}, events: []})
  }

  async publishText(content: string, bootstrapName?: string) {
    const signal = this.controller.signal
    const view = get(this.view),
      activeSigner = signer.get()
    if (!activeSigner || pubkey.get() !== this.identity || (!content.trim() && !bootstrapName))
      throw Error("Connect the publishing signer and enter text")
    let definition = view.definition
    const bootstrap =
      !definition && bootstrapName && this.identity === this.scope.pointer.ownerPubkey
    if (
      bootstrap &&
      (!Object.values(this.relayStates).length ||
        !Object.values(this.relayStates).every(state => state === "ready"))
    )
      throw Error("Complete private authority is required before bootstrap")
    if (!bootstrap && (view.access !== "ready" || !definition))
      throw Error("Complete private authority is required before posting")
    const retained = this.repository.query([{}])
    if (definition) {
      const reportState = getEffectiveCommunityReportState({
        definition,
        profileListEvents: retained,
        reportEvents: retained.filter(event => event.kind === 1984),
        targetEvents: retained,
      })
      if (
        !getCommunityWriteTargetSections(definition, {kind: 1, sectionName: ""}).some(section =>
          canWriteCommunitySection({
            definition: definition!,
            profileListEvents: retained,
            userPubkey: this.identity,
            sectionName: section.name,
            kind: 1,
            reportState,
          }),
        )
      )
        throw Error("Your role does not allow text posts in this community")
    }
    const profiles = await loadPrivateRelayProfiles(this.scope.relays, signal)
    const event = bootstrap
      ? buildCommunityDefinition({
          communityId: this.scope.pointer.communityId,
          name: bootstrapName,
          readAccess: "members",
          relays: this.scope.relays.map(relay => relay.replace(/\/$/, "")),
          sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
        })
      : {
          kind: 1,
          tags: [
            ["h", this.scope.pointer.communityId],
            ["a", this.scope.pointer.address],
          ],
          content,
        }
    if (bootstrap) definition = parseCommunityDefinition(prep(event, this.identity) as TrustedEvent)
    if (!definition) throw Error("Private definition is unavailable")
    const result = await publishPrivateCommunityEvent({
      definition,
      event,
      relays: this.scope.relays,
      profiles,
      sockets: this.sockets,
      identity: this.identity,
      currentIdentity: () => pubkey.get(),
      signal,
      sign: event => activeSigner.sign(event, {signal}),
      validateAuthority: () => {
        const current = get(this.view)
        if (bootstrap) {
          if (
            current.definition ||
            !Object.values(this.relayStates).every(state => state === "ready")
          )
            throw Error("Private bootstrap authority changed; retry access")
        } else {
          if (current.access !== "ready" || current.definition?.event.id !== definition!.event.id)
            throw Error("Private authority changed; retry access before posting")
          // Re-evaluate grants/reports even when the definition itself is stable.
          const candidate = prep(event, this.identity) as TrustedEvent
          if (
            !selectPrivateCommunityTextEvents(current.definition!, [
              ...this.repository.query([{}]),
              candidate,
            ]).some(item => item.id === candidate.id)
          )
            throw Error("Your current role does not allow this private text post")
        }
      },
    })
    // Only relay intake installs data; an ACK does not establish reader authority.
    return result
  }

  dispose() {
    this.cancel()
    this.disposed = true
    for (const socket of this.sockets.values()) socket.cleanup()
    this.sockets.clear()
  }
}
