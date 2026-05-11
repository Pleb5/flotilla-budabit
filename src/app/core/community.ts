import * as nip19 from "nostr-tools/nip19"
import type {EventContent, TrustedEvent} from "@welshman/util"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {randomId} from "@welshman/lib"

export const COMMUNITY_DEFINITION_KIND = 10222
export const TARGETED_PUBLICATION_KIND = 30222
export const PROFILE_LIST_KIND = 30000
export const BADGE_DEFINITION_KIND = 30009
export const BADGE_AWARD_KIND = 8
export const FORM_TEMPLATE_KIND = 30168
export const FORM_RESPONSE_KIND = 1069
export const MAX_TARGET_COMMUNITIES = 12

export const COMMUNITY_SECTION_GENERAL = "General"
export const COMMUNITY_SECTION_ROOMS = "Rooms"
export const COMMUNITY_SECTION_FORUM = "Forum"
export const COMMUNITY_SECTION_CALENDAR = "Calendar"
export const COMMUNITY_SECTION_FUNDRAISERS = "Fundraisers"
export const COMMUNITY_SECTION_REPOSITORIES = "Repositories"
export const COMMUNITY_SECTION_PERMALINKS = "Permalinks"
export const COMMUNITY_SECTION_WIDGETS = "Widgets"

export const COMMUNITY_SUBTYPE_ROOM = "room"
export const COMMUNITY_SUBTYPE_FORUM = "forum"
export const COMMUNITY_SUBTYPE_ROOM_MESSAGE = "room-message"

export const TARGETED_PUBLICATION_KINDS = [31922, 9041, 30617, 1623, 30033] as const

export type CommunityInputSource = "hex" | "npub" | "ncommunity"

export type ParsedCommunityInput = {
  pubkey: string
  relays: string[]
  source: CommunityInputSource
}

export type AddressRef = {
  kind: number
  pubkey: string
  identifier: string
  address: string
}

export type CommunitySectionKind = {
  kind: number
  subtype?: string
}

export type CommunityProfileListRef = AddressRef & {
  relay?: string
}

export type CommunityBadgeRef = AddressRef

export type CommunityRetentionPolicy = {
  kind: number
  value: number
  type: "time" | "count"
}

export type CommunitySection = {
  name: string
  kinds: CommunitySectionKind[]
  profileLists: CommunityProfileListRef[]
  badges: CommunityBadgeRef[]
  retention: CommunityRetentionPolicy[]
}

export type CommunityMint = {
  url: string
  type?: string
}

export type CommunityTos = {
  ref: string
  relay?: string
}

export type CommunityDefinition = {
  event: TrustedEvent
  pubkey: string
  relays: string[]
  blossomServers: string[]
  mints: CommunityMint[]
  sections: CommunitySection[]
  tos?: CommunityTos
  location?: string
  geohash?: string
  description?: string
}

export type CommunityTarget = {
  pubkey: string
  relay?: string
}

export type TargetedPublicationRef =
  | {type: "e"; value: string; relay?: string; pubkey?: string}
  | {type: "a"; value: string; relay?: string}

export type TargetedPublication = {
  id: string
  kind: number
  ref?: TargetedPublicationRef
  communities: CommunityTarget[]
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

export const isHexPubkey = (value: string) => HEX_PUBKEY_RE.test(value)

export const normalizePubkey = (value: string) => {
  const trimmed = value.trim()
  if (isHexPubkey(trimmed)) return trimmed.toLowerCase()

  if (trimmed.startsWith("npub")) {
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase()
      }
    } catch {
      return ""
    }
  }

  return ""
}

export const normalizeRelay = (url?: string) => {
  if (!url) return ""

  try {
    const normalized = normalizeRelayUrl(url)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

const parseNcommunity = (value: string): ParsedCommunityInput | undefined => {
  if (!value.startsWith("ncommunity://")) return undefined

  try {
    const url = new URL(value)
    const rawPubkey = decodeURIComponent(url.hostname || url.pathname.replace(/^\//, ""))
    const pubkey = normalizePubkey(rawPubkey)
    if (!pubkey) return undefined

    return {
      pubkey,
      relays: normalizeRelays(url.searchParams.getAll("relay")),
      source: "ncommunity",
    }
  } catch {
    return undefined
  }
}

export const parseCommunityInput = (value: string): ParsedCommunityInput | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const ncommunity = parseNcommunity(trimmed)
  if (ncommunity) return ncommunity

  const pubkey = normalizePubkey(trimmed)
  if (!pubkey) return undefined

  return {pubkey, relays: [], source: trimmed.startsWith("npub") ? "npub" : "hex"}
}

export const parseAddressRef = (address: string): AddressRef | undefined => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue, 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (!Number.isInteger(kind) || !pubkey || !identifier) return undefined

  return {kind, pubkey, identifier, address: `${kind}:${pubkey}:${identifier}`}
}

const parseSectionKind = (tag: string[]): CommunitySectionKind | undefined => {
  const kind = Number.parseInt(tag[1] || "", 10)
  if (!Number.isInteger(kind)) return undefined

  return {kind, subtype: tag[2] || undefined}
}

const parseProfileListRef = (tag: string[]): CommunityProfileListRef | undefined => {
  const ref = parseAddressRef(tag[1] || "")
  if (!ref || ref.kind !== PROFILE_LIST_KIND) return undefined

  return {...ref, relay: normalizeRelay(tag[2]) || undefined}
}

const parseBadgeRef = (tag: string[]): CommunityBadgeRef | undefined => {
  const ref = parseAddressRef(tag[1] || "")
  if (!ref || ref.kind !== BADGE_DEFINITION_KIND) return undefined

  return ref
}

const parseRetentionPolicy = (tag: string[]): CommunityRetentionPolicy | undefined => {
  const kind = Number.parseInt(tag[1] || "", 10)
  const value = Number.parseInt(tag[2] || "", 10)
  const type = tag[3]

  if (!Number.isInteger(kind) || !Number.isInteger(value)) return undefined
  if (type !== "time" && type !== "count") return undefined

  return {kind, value, type}
}

const makeSection = (name: string): CommunitySection => ({
  name,
  kinds: [],
  profileLists: [],
  badges: [],
  retention: [],
})

export const parseCommunityDefinition = (event: TrustedEvent): CommunityDefinition | undefined => {
  if (event.kind !== COMMUNITY_DEFINITION_KIND) return undefined

  const pubkey = normalizePubkey(event.pubkey || "")
  if (!pubkey) return undefined

  const relays: string[] = []
  const blossomServers: string[] = []
  const mints: CommunityMint[] = []
  const sections: CommunitySection[] = []
  let currentSection: CommunitySection | undefined
  let tos: CommunityTos | undefined
  let location: string | undefined
  let geohash: string | undefined
  let description: string | undefined

  for (const tag of event.tags || []) {
    if (tag[0] === "content" && tag[1]) {
      currentSection = makeSection(tag[1])
      sections.push(currentSection)
      continue
    }

    if (tag[0] === "k" && currentSection) {
      const sectionKind = parseSectionKind(tag)
      if (sectionKind) currentSection.kinds.push(sectionKind)
      continue
    }

    if (tag[0] === "a" && currentSection) {
      const profileList = parseProfileListRef(tag)
      if (profileList) currentSection.profileLists.push(profileList)
      continue
    }

    if (tag[0] === "badge" && currentSection) {
      const badge = parseBadgeRef(tag)
      if (badge) currentSection.badges.push(badge)
      continue
    }

    if (tag[0] === "retention" && currentSection) {
      const retention = parseRetentionPolicy(tag)
      if (retention) currentSection.retention.push(retention)
      continue
    }

    if (tag[0] === "r") {
      const relay = normalizeRelay(tag[1])
      if (relay) relays.push(relay)
      continue
    }

    if (tag[0] === "blossom" && tag[1]) {
      blossomServers.push(tag[1])
      continue
    }

    if (tag[0] === "mint" && tag[1]) {
      mints.push({url: tag[1], type: tag[2] || undefined})
      continue
    }

    if (tag[0] === "tos" && tag[1]) {
      tos = {ref: tag[1], relay: normalizeRelay(tag[2]) || undefined}
      continue
    }

    if (tag[0] === "location") {
      location = tag[1] || undefined
      continue
    }

    if (tag[0] === "g") {
      geohash = tag[1] || undefined
      continue
    }

    if (tag[0] === "description") {
      description = tag[1] || undefined
    }
  }

  return {
    event,
    pubkey,
    relays: normalizeRelays(relays),
    blossomServers: Array.from(new Set(blossomServers.filter(Boolean))),
    mints,
    sections,
    tos,
    location,
    geohash,
    description,
  }
}

export const getCommunityMainRelay = (definition: CommunityDefinition) => definition.relays[0] || ""

export const findCommunitySection = (
  definition: CommunityDefinition,
  name: string,
) => definition.sections.find(section => section.name === name)

export const sectionSupportsKind = (
  section: CommunitySection | undefined,
  kind: number,
  subtype?: string,
) =>
  Boolean(
    section?.kinds.some(
      sectionKind => sectionKind.kind === kind && (!subtype || sectionKind.subtype === subtype),
    ),
  )

export const getProfileListPubkeys = (event: TrustedEvent | undefined) => {
  if (!event || event.kind !== PROFILE_LIST_KIND) return []

  return Array.from(
    new Set(
      (event.tags || [])
        .filter(tag => tag[0] === "p")
        .map(tag => normalizePubkey(tag[1] || ""))
        .filter(Boolean),
    ),
  )
}

export const canWriteFromProfileList = (profileList: TrustedEvent | undefined, pubkey: string) => {
  const normalized = normalizePubkey(pubkey)
  if (!normalized) return false

  return getProfileListPubkeys(profileList).includes(normalized)
}

export const userCanManageProfileList = (
  profileListRef: CommunityProfileListRef | undefined,
  pubkey: string,
) => Boolean(profileListRef && normalizePubkey(pubkey) === profileListRef.pubkey)

export const userCanIssueBadge = (badgeRef: CommunityBadgeRef | undefined, pubkey: string) =>
  Boolean(badgeRef && normalizePubkey(pubkey) === badgeRef.pubkey)

const appendDefined = (base: string[], ...values: Array<string | undefined>) => {
  for (const value of values) {
    if (value) base.push(value)
  }

  return base
}

export const buildTargetedPublication = ({
  id = randomId(),
  kind,
  ref,
  communities,
}: Partial<Pick<TargetedPublication, "id">> & Omit<TargetedPublication, "id">): EventContent => {
  const tags: string[][] = [["d", id]]

  if (ref?.type === "e") {
    tags.push(appendDefined(["e", ref.value], normalizeRelay(ref.relay) || undefined, ref.pubkey))
  } else if (ref?.type === "a") {
    tags.push(appendDefined(["a", ref.value], normalizeRelay(ref.relay) || undefined))
  }

  tags.push(["k", String(kind)])

  for (const community of communities.slice(0, MAX_TARGET_COMMUNITIES)) {
    const pubkey = normalizePubkey(community.pubkey)
    if (!pubkey) continue

    tags.push(["p", pubkey])
    if (community.relay) {
      const relay = normalizeRelay(community.relay)
      if (relay) tags.push(["r", relay])
    }
  }

  return {content: "", tags}
}

export const parseTargetedPublication = (event: TrustedEvent): TargetedPublication | undefined => {
  if (event.kind !== TARGETED_PUBLICATION_KIND) return undefined

  const id = (event.tags || []).find(tag => tag[0] === "d")?.[1]
  const kind = Number.parseInt((event.tags || []).find(tag => tag[0] === "k")?.[1] || "", 10)
  if (!id || !Number.isInteger(kind)) return undefined

  const eTag = (event.tags || []).find(tag => tag[0] === "e")
  const aTag = (event.tags || []).find(tag => tag[0] === "a")
  const ref: TargetedPublicationRef | undefined = eTag?.[1]
    ? {type: "e", value: eTag[1], relay: normalizeRelay(eTag[2]) || undefined, pubkey: eTag[3]}
    : aTag?.[1]
      ? {type: "a", value: aTag[1], relay: normalizeRelay(aTag[2]) || undefined}
      : undefined
  const communities: CommunityTarget[] = []
  let lastCommunity: CommunityTarget | undefined

  for (const tag of event.tags || []) {
    if (tag[0] === "p") {
      const pubkey = normalizePubkey(tag[1] || "")
      if (!pubkey) continue

      lastCommunity = {pubkey}
      communities.push(lastCommunity)
      continue
    }

    if (tag[0] === "r" && lastCommunity && !lastCommunity.relay) {
      lastCommunity.relay = normalizeRelay(tag[1]) || undefined
    }
  }

  return {id, kind, ref, communities: communities.slice(0, MAX_TARGET_COMMUNITIES)}
}
