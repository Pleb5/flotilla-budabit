import {prep, verifyEvent, type EventTemplate, type SignedEvent} from "@welshman/util"
import {AuthStatus, publish, PublishStatus, SocketAdapter, type Socket} from "@welshman/net"
import type {CommunityDefinition} from "./community-protocol"
import {
  allowPrivatePublication,
  assertPrivatePublicationDestinations,
  assertPrivateEventScope,
  markPrivateEvent,
  registerPrivateCommunity,
  isPrivateReference,
} from "./private-community-policy"

// No optimistic insertion, delivery-notice payload cache, outbox recovery or
// external destinations. The owner is responsible for retaining this session's
// operation/sockets; a late signature after identity change cannot publish.
export const publishPrivateCommunityEvent = async (options: {
  definition: CommunityDefinition
  event: EventTemplate
  relays: string[]
  profiles: Map<string, unknown>
  sockets: Map<string, Socket>
  identity: string
  currentIdentity: () => string | undefined
  signal: AbortSignal
  sign: (event: ReturnType<typeof prep>) => Promise<SignedEvent>
  validateAuthority?: () => void
}) => {
  const targets = assertPrivatePublicationDestinations(
    options.definition,
    options.relays,
    options.profiles,
  )
  assertPrivateEventScope(options.event, options.definition)
  const generations = new Map(
    targets.map(relay => [relay, options.sockets.get(relay)?._generation]),
  )
  const check = () => {
    options.validateAuthority?.()
    if (options.signal.aborted || options.currentIdentity() !== options.identity)
      throw Error("Private publication cancelled: identity changed")
    assertPrivatePublicationDestinations(options.definition, targets, options.profiles)
    for (const relay of targets)
      if (
        options.sockets.get(relay)?.auth.status !== AuthStatus.Ok ||
        options.sockets.get(relay)?._disposed ||
        options.sockets.get(relay)?._generation !== generations.get(relay)
      )
        throw Error("Authenticate to each private destination first")
  }
  check()
  if (!isPrivateReference(options.definition.pointer.address))
    registerPrivateCommunity(options.definition.pointer, options.definition.relays)
  const template = prep(options.event, options.identity)
  const expectedId = template.id
  const signingSignal = AbortSignal.any([options.signal, AbortSignal.timeout(90_000)])
  let stopWaiting: (() => void) | undefined
  const event = await Promise.race([
    options.sign(template),
    new Promise<never>((_, reject) => {
      const abort = () => reject(new Error("Private signing cancelled or timed out"))
      stopWaiting = () => signingSignal.removeEventListener("abort", abort)
      signingSignal.addEventListener("abort", abort, {once: true})
      if (signingSignal.aborted) abort()
    }),
  ]).finally(() => stopWaiting?.())
  check()
  if (event.id !== expectedId || event.pubkey !== options.identity || !verifyEvent(event))
    throw Error("Signer changed the private publication")
  markPrivateEvent(event, targets)
  const release = allowPrivatePublication(event, targets)
  let active = true
  try {
    const results = await publish({
      event,
      relays: targets,
      signal: options.signal,
      timeout: 12_000,
      context: {
        getAdapter: relay => {
          check()
          const socket = options.sockets.get(relay)
          if (!socket) throw Error("Private socket unavailable")
          const adapter = new SocketAdapter(socket)
          const send = adapter.send.bind(adapter)
          adapter.send = message => {
            if (message[0] === "EVENT")
              socket._sendGuards.set(message, () => {
                if (!active) return false
                try {
                  check()
                  return true
                } catch {
                  return false
                }
              })
            send(message)
          }
          return adapter
        },
      },
    })
    if (!Object.values(results).some(result => result.status === PublishStatus.Success))
      throw Error("No private relay acknowledged storage")
    return {event, results}
  } finally {
    active = false
    release()
  }
}
