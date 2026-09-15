import {normalizeRelayUrl, type EventTemplate, type Filter, type TrustedEvent} from "@welshman/util"
import type {CommunityDefinition, CommunityPointer} from "./community-protocol"
import {nip19} from "nostr-tools"

type EventLike = Pick<EventTemplate, "kind" | "tags" | "content"> & {id?: string; pubkey?: string}
type Scope = {pointer: CommunityPointer; relays: string[]}
const scopes = new Map<string, Scope>()
const privateIds = new Map<string, string[]>()
const approvedPublications = new WeakMap<object, string[]>()
const privateReferenceObservers = new Set<() => void>()
export const onPrivateReferencesChanged = (observer: () => void) => {
  privateReferenceObservers.add(observer)
  return () => {
    privateReferenceObservers.delete(observer)
  }
}
const normalize = (url: string) => {
  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}
export const registerPrivateCommunity = (pointer: CommunityPointer, relays: string[]) => {
  scopes.set(pointer.address, {
    pointer,
    relays: [...new Set(relays.map(normalize).filter(Boolean))],
  })
  privateReferenceObservers.forEach(observer => observer())
}
export const markPrivateEvent = (event: TrustedEvent, relays: string[] = []) => {
  const known = privateIds.has(event.id)
  privateIds.set(event.id, relays.map(normalize))
  if (!known) privateReferenceObservers.forEach(observer => observer())
}
export const hasPrivateIntent = (definition: Pick<CommunityDefinition, "event">) =>
  Boolean(definition.event?.tags.some(tag => tag[0] === "read-access"))
export const isPrivateRelay = (relay: string) =>
  [...scopes.values()].some(scope => scope.relays.includes(normalize(relay)))
export const assertPublicCommunityReferences = (values: string[]) => {
  if (values.some(isPrivateReference)) throw new PrivatePublicationError()
}
export const isPrivateReference = (value: string) =>
  typeof value === "string" &&
  (privateIds.has(value) ||
    [...scopes.values()].some(
      ({pointer}) =>
        value === pointer.communityId ||
        value === pointer.address ||
        value.startsWith(`${pointer.communityId}-`) ||
        value.includes(`:${pointer.communityId}-`),
    ))
// Context may contain URLs, percent-encoded coordinates or bech32 pointers rather
// than a bare tag value. Decode before checking, and never expand relay scope.
export const containsPrivateContext = (value: string): boolean => {
  if (typeof value !== "string") return false
  let decoded = value
  for (let i = 0; i < 2; i++) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      break
    }
  }
  if (/[?&]read-access=/.test(decoded)) return true
  for (const id of privateIds.keys()) if (decoded.includes(id)) return true
  for (const {pointer, relays} of scopes.values()) {
    if (decoded.includes(pointer.communityId) || decoded.includes(pointer.address)) return true
    // Diagnostics often truncate endpoint paths. Treat the private host as
    // private context too, not only its exact websocket URL.
    for (const relay of relays) {
      try {
        if (decoded.includes(new URL(relay).host)) return true
      } catch {
        /* invalid hints ignored */
      }
    }
  }
  for (const match of decoded.matchAll(
    /\b(?:naddr|nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+/gi,
  )) {
    try {
      const pointer = nip19.decode(match[0])
      if (
        pointer.type === "naddr" &&
        isPrivateReference(`${pointer.data.kind}:${pointer.data.pubkey}:${pointer.data.identifier}`)
      )
        return true
      if (pointer.type === "nevent" && isPrivateReference(pointer.data.id)) return true
      if (pointer.type === "note" && isPrivateReference(pointer.data)) return true
    } catch {
      /* malformed public locators are not private evidence */
    }
  }
  return false
}
export const isPrivateEvent = (event: EventLike) =>
  Boolean(event.id && privateIds.has(event.id)) ||
  containsPrivateContext(event.content) ||
  (event.tags || []).some(
    tag =>
      tag[0] === "read-access" ||
      tag.slice(1).some(value => isPrivateReference(value) || containsPrivateContext(value)),
  )

export class PrivatePublicationError extends Error {
  constructor() {
    super(
      "Private community data requires the isolated private publisher and verified member-only definition relays. Public fanout and external exports are disabled.",
    )
    this.name = "PrivatePublicationError"
  }
}

export const assertPublicCommunityOperation = (event: EventLike) => {
  if (isPrivateEvent(event)) throw new PrivatePublicationError()
}
export const allowPrivatePublication = (event: object, relays: string[]) => {
  approvedPublications.set(event, relays.map(normalize))
  return () => approvedPublications.delete(event)
}
export const assertCommunityTransportPublication = (event: EventLike, relays: string[]) => {
  if (!isPrivateEvent(event)) return
  const approved = approvedPublications.get(event)
  if (!approved || !relays.length || relays.some(relay => !approved.includes(normalize(relay))))
    throw new PrivatePublicationError()
}

export const supportsMemberOnlyReads = (profile: unknown): boolean => {
  if (!profile || typeof profile !== "object") return false
  const info = profile as {
    limitation?: {auth_required?: unknown}
    budabit?: {read_control?: {version?: unknown; mode?: unknown; scope?: unknown}}
    read_policy?: {
      version?: unknown
      admission?: unknown
      consistency?: unknown
      recheck_seconds?: unknown
    }
  }
  const claim = info.budabit?.read_control
  return (
    info.limitation?.auth_required === true &&
    (claim?.version === 1 ||
      (claim?.version === 2 &&
        info.read_policy?.version === 1 &&
        info.read_policy.admission === "req" &&
        info.read_policy.consistency === "eventual" &&
        Number.isInteger(info.read_policy.recheck_seconds) &&
        Number(info.read_policy.recheck_seconds) >= 1 &&
        Number(info.read_policy.recheck_seconds) <= 300)) &&
    claim.mode === "members" &&
    claim.scope === "relay"
  )
}

export const assertPrivatePublicationDestinations = (
  definition: CommunityDefinition,
  relays: string[],
  profiles: Map<string, unknown>,
) => {
  const markers = definition.event.tags.filter(tag => tag[0] === "read-access")
  if (
    definition.readAccess !== "members" ||
    markers.length !== 1 ||
    markers[0].length !== 2 ||
    markers[0][1] !== "members"
  )
    throw new PrivatePublicationError()
  const declared = definition.relays.map(normalize)
  const targets = relays.map(normalize)
  if (
    !targets.length ||
    targets.some(
      relay => !relay || !declared.includes(relay) || !supportsMemberOnlyReads(profiles.get(relay)),
    )
  )
    throw new PrivatePublicationError()
  return [...new Set(targets)]
}
export const assertPrivateEventScope = (event: EventLike, definition: CommunityDefinition) => {
  for (const tag of event.tags || []) {
    if (tag[0] === "h" && tag[1] !== definition.communityId) throw new PrivatePublicationError()
    if (
      ["a", "A"].includes(tag[0]) &&
      tag[1]?.startsWith("32222:") &&
      tag[1] !== definition.pointer.address
    )
      throw new PrivatePublicationError()
  }
}

export const assertPrivateReadDestinations = (filters: Filter[], relays: string[]) => {
  const values = filters.flatMap(filter =>
    Object.values(filter).flatMap(value =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
    ),
  )
  for (const scope of scopes.values()) {
    if (
      !values.some(
        value =>
          value === scope.pointer.address ||
          value === scope.pointer.communityId ||
          value.includes(scope.pointer.communityId),
      )
    )
      continue
    if (!relays.length || relays.some(relay => !scope.relays.includes(normalize(relay))))
      throw new PrivatePublicationError()
  }
  for (const value of values)
    if (
      privateIds.has(value) &&
      (!relays.length || relays.some(relay => !privateIds.get(value)!.includes(normalize(relay))))
    )
      throw new PrivatePublicationError()
}
