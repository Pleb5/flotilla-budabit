import {on, call, dissoc, assoc, uniq} from "@welshman/lib"
import {get} from "svelte/store"
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
import {pubkey, signer, userRelayList, userMessagingRelayList} from "@welshman/app"
import {getRelaysFromList, normalizeRelayUrl} from "@welshman/util"
import {Nip01Signer} from "@welshman/signer"
import {
  userSettingsValues,
  getSetting,
  relaysPendingTrust,
  relaysMostlyRestricted,
  INDEXER_RELAYS,
  SIGNER_RELAYS,
  NOTIFIER_RELAY,
} from "@app/core/state"
import {activeCommunityRelays} from "@app/core/community-state"
import {graspServersStore} from "@nostr-git/ui"

let guestRelaySigner: Nip01Signer | undefined

const safeNormalizeUrl = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}

// Relays we always allow the real signer to authenticate to. These are
// operational relays the app needs regardless of the user's own relay list.
const buildAlwaysAllowedRelays = () => {
  const urls = new Set<string>()
  for (const url of INDEXER_RELAYS) urls.add(safeNormalizeUrl(url))
  for (const url of SIGNER_RELAYS) urls.add(safeNormalizeUrl(url))
  if (NOTIFIER_RELAY) urls.add(safeNormalizeUrl(NOTIFIER_RELAY))
  urls.delete("")
  return urls
}

const alwaysAllowedRelays = buildAlwaysAllowedRelays()

// A relay is "user-owned" if it's in the user's kind:10002 or the
// messaging relay list (kind:10050), if the user has explicitly trusted
// it, or if it's a community relay for the currently-active community.
const isUserOwnedRelay = (url: string) => {
  const normalized = safeNormalizeUrl(url)
  if (!normalized) return false
  if (alwaysAllowedRelays.has(normalized)) return true

  const userRelays = getRelaysFromList(get(userRelayList))
  if (userRelays.some(r => safeNormalizeUrl(r) === normalized)) return true

  const messagingRelays = getRelaysFromList(get(userMessagingRelayList))
  if (messagingRelays.some(r => safeNormalizeUrl(r) === normalized)) return true

  const trusted = get(userSettingsValues).trusted_relays || []
  if (trusted.some(r => safeNormalizeUrl(r) === normalized)) return true

  const communityRelays = get(activeCommunityRelays)
  if (communityRelays.some(r => safeNormalizeUrl(r) === normalized)) return true

  const graspRelays = get(graspServersStore)
  if (graspRelays.some(r => safeNormalizeUrl(r) === normalized)) return true

  return false
}

const getRelayAuthSigner = (socketUrl: string) => {
  const activeSigner = signer.get()
  const activePubkey = pubkey.get()

  if (activeSigner && activePubkey) {
    // Only authenticate the real user against relays we've decided are
    // "ours". Random relays that send AUTH challenge (e.g. via a subscription
    // to a relay hint from an event) are ignored to avoid unnecessary
    // bunker roundtrips.
    if (!isUserOwnedRelay(socketUrl)) return undefined

    return {signer: activeSigner, isGuest: false}
  }

  if (activePubkey) return undefined

  // Use a throwaway key only for NIP-42 relay auth so public reads work for guests.
  guestRelaySigner ||= Nip01Signer.ephemeral()

  return {signer: guestRelaySigner, isGuest: true}
}

export const authPolicy = (socket: Socket) => {
  let inFlight = false
  let authenticatedWithGuest = false
  let authenticatedPubkey = ""

  const retryActiveSignerAuth = async (
    activeSigner: NonNullable<ReturnType<typeof signer.get>>,
  ) => {
    // Only retry with the real signer when this relay is one we'd auth to
    // in the first place. Prevents surprise bunker roundtrips against
    // random relays when the user logs in.
    if (!isUserOwnedRelay(socket.url)) return

    inFlight = true
    try {
      await socket.auth.retryAuth(event => activeSigner.sign(event))
      authenticatedWithGuest = false
      authenticatedPubkey = pubkey.get() || ""
    } finally {
      inFlight = false
    }
  }

  const attemptAuth = async () => {
    if (inFlight) return
    const activeSigner = signer.get()
    const activePubkey = pubkey.get() || ""
    const hasCompletedAuth = [
      AuthStatus.Ok,
      AuthStatus.Forbidden,
      AuthStatus.DeniedSignature,
    ].includes(socket.auth.status)

    if (authenticatedWithGuest && activeSigner && hasCompletedAuth) {
      await retryActiveSignerAuth(activeSigner)
      return
    }

    if (
      activeSigner &&
      activePubkey &&
      authenticatedPubkey &&
      authenticatedPubkey !== activePubkey &&
      hasCompletedAuth
    ) {
      await retryActiveSignerAuth(activeSigner)
      return
    }

    if (socket.auth.status !== AuthStatus.Requested) return
    const relayAuthSigner = getRelayAuthSigner(socket.url)
    if (!relayAuthSigner) return
    inFlight = true
    try {
      await socket.auth.doAuth(event => relayAuthSigner.signer.sign(event))
      authenticatedWithGuest = relayAuthSigner.isGuest
      authenticatedPubkey = relayAuthSigner.isGuest ? "" : activePubkey
    } finally {
      inFlight = false
      if (authenticatedWithGuest && signer.get()) attemptAuth()
    }
  }

  const unsubscribers = [
    on(socket.auth, AuthStateEvent.Status, () => {
      attemptAuth()
    }),
    signer.subscribe(() => {
      attemptAuth()
    }),
    pubkey.subscribe(() => {
      attemptAuth()
    }),
    // Re-evaluate when the user's relay list or community relays change so
    // a relay that just became "ours" gets authed and one that dropped off
    // no longer receives auth attempts.
    userRelayList.subscribe(() => {
      attemptAuth()
    }),
    userMessagingRelayList.subscribe(() => {
      attemptAuth()
    }),
    activeCommunityRelays.subscribe(() => {
      attemptAuth()
    }),
    graspServersStore.subscribe(() => {
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
