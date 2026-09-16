import {get, writable} from "svelte/store"
import {pubkey, userRelayList, userMessagingRelayList} from "@welshman/app"
import {getRelaysFromList, normalizeRelayUrl} from "@welshman/util"
import {userSettingsValues, INDEXER_RELAYS, SIGNER_RELAYS} from "@app/core/state"
import {activeExactCommunityRelays} from "@app/core/community-state"
import {isSignerPolicyRelay} from "@app/core/relay-policy"
import {isEmailDigestAuthRelay} from "@app/core/email-digest-auth"
// UI-owned GRASP configuration is supplied by the root adapter, avoiding a
// core/auth -> Svelte component package dependency during bootstrap/tests.
export const extraRelayAuthRelays = writable<string[]>([])

const normalize = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}
// Authentication consent does not add unsigned-event trust. Private invitation
// scopes request consent before authenticating pooled sockets.
const explicitOnly = new Set<string>()
const consent = new Set<string>()
export const relayAuthConsentVersion = writable(0)
const notify = () => relayAuthConsentVersion.update(n => n + 1)
export const requireExplicitRelayAuthConsent = (relays: string[]) => {
  const size = explicitOnly.size
  for (const relay of relays) explicitOnly.add(normalize(relay))
  if (explicitOnly.size !== size) notify()
}
export const allowRelayAuthentication = (relay: string, identity = pubkey.get()) => {
  if (identity) consent.add(`${identity}:${normalize(relay)}`)
  notify()
}
export const isUserOwnedRelay = (url: string) => {
  const normalized = normalize(url)
  if (!normalized) return false
  if (consent.has(`${pubkey.get()}:${normalized}`)) return true
  if (explicitOnly.has(normalized)) return false
  if (isEmailDigestAuthRelay(url) || isSignerPolicyRelay(url)) return true
  const candidates = [
    ...INDEXER_RELAYS,
    ...SIGNER_RELAYS,
    ...getRelaysFromList(get(userRelayList)),
    ...getRelaysFromList(get(userMessagingRelayList)),
    ...(get(userSettingsValues).trusted_relays || []),
    ...get(activeExactCommunityRelays),
    ...get(extraRelayAuthRelays),
  ]
  return candidates.some(relay => normalize(relay) === normalized)
}

export const subscribeRelayAuthConsent = (callback: () => void) => {
  const unsubscribers = [
    userRelayList,
    userMessagingRelayList,
    userSettingsValues,
    activeExactCommunityRelays,
    extraRelayAuthRelays,
    relayAuthConsentVersion,
  ].map(store => store.subscribe(callback))
  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
