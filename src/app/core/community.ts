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

export type CommunitySetupSection = {
  name: string
  kinds: CommunitySectionKind[]
  profileList: CommunityProfileListRef
  badge: CommunityBadgeRef
}

export type CommunitySetupRefs = {
  communityPubkey: string
  relays: string[]
  sections: CommunitySetupSection[]
}

export type BuildCommunityDefinitionParams = {
  relays: string[]
  sections: CommunitySetupSection[]
  description?: string
  blossomServers?: string[]
  mints?: CommunityMint[]
  tos?: CommunityTos
  location?: string
  geohash?: string
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i
const GEOHASH_RE = /^[0123456789bcdefghjkmnpqrstuvwxyz]+$/i

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

export const normalizeGeohash = (value?: string) => {
  const normalized = value?.trim().replace(/^geo:/i, "").toLowerCase() || ""

  return normalized && GEOHASH_RE.test(normalized) ? normalized : ""
}

const slugifyCommunityValue = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section"

export const makeCommunityScopedIdentifier = (communityPubkey: string, value: string) =>
  `budabit-${normalizePubkey(communityPubkey).slice(0, 16)}-${slugifyCommunityValue(value)}`

export const getDefaultCommunitySectionKinds = (name: string): CommunitySectionKind[] => {
  switch (name) {
    case COMMUNITY_SECTION_GENERAL:
      return [
        {kind: 9, subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE},
        {kind: 1111},
        {kind: 7},
        {kind: 1985},
      ]
    case COMMUNITY_SECTION_ROOMS:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM}]
    case COMMUNITY_SECTION_FORUM:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_FORUM}]
    case COMMUNITY_SECTION_CALENDAR:
      return [{kind: 31922}]
    case COMMUNITY_SECTION_FUNDRAISERS:
      return [{kind: 9041}]
    case COMMUNITY_SECTION_REPOSITORIES:
      return [{kind: 30617}]
    case COMMUNITY_SECTION_PERMALINKS:
      return [{kind: 1623}]
    case COMMUNITY_SECTION_WIDGETS:
      return [{kind: 30033}]
    default:
      return []
  }
}

export const DEFAULT_COMMUNITY_SECTION_NAMES = [
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_FORUM,
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_FUNDRAISERS,
  COMMUNITY_SECTION_REPOSITORIES,
  COMMUNITY_SECTION_PERMALINKS,
  COMMUNITY_SECTION_WIDGETS,
] as const

export const makeAddress = (kind: number, pubkey: string, identifier: string) =>
  `${kind}:${normalizePubkey(pubkey)}:${identifier}`

export const makeCommunitySetupRefs = ({
  communityPubkey,
  profileListPubkey,
  badgeIssuerPubkey,
  relays,
  sectionNames = DEFAULT_COMMUNITY_SECTION_NAMES,
}: {
  communityPubkey: string
  profileListPubkey: string
  badgeIssuerPubkey: string
  relays: string[]
  sectionNames?: readonly string[]
}): CommunitySetupRefs => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const normalizedProfileListPubkey = normalizePubkey(profileListPubkey)
  const normalizedBadgeIssuerPubkey = normalizePubkey(badgeIssuerPubkey)
  const normalizedRelays = normalizeRelays(relays)

  return {
    communityPubkey: normalizedCommunityPubkey,
    relays: normalizedRelays,
    sections: sectionNames.map(name => {
      const identifier = makeCommunityScopedIdentifier(normalizedCommunityPubkey, name)
      const profileListAddress = makeAddress(
        PROFILE_LIST_KIND,
        normalizedProfileListPubkey,
        identifier,
      )
      const badgeAddress = makeAddress(
        BADGE_DEFINITION_KIND,
        normalizedBadgeIssuerPubkey,
        identifier,
      )

      return {
        name,
        kinds: getDefaultCommunitySectionKinds(name),
        profileList: {
          kind: PROFILE_LIST_KIND,
          pubkey: normalizedProfileListPubkey,
          identifier,
          address: profileListAddress,
          relay: normalizedRelays[0],
        },
        badge: {
          kind: BADGE_DEFINITION_KIND,
          pubkey: normalizedBadgeIssuerPubkey,
          identifier,
          address: badgeAddress,
        },
      }
    }),
  }
}

export const buildCommunityDefinition = ({
  relays,
  sections,
  description,
  blossomServers = [],
  mints = [],
  tos,
  location,
  geohash,
}: BuildCommunityDefinitionParams): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const tags: string[][] = [["alt", "BudaBit community definition"]]

  if (description?.trim()) tags.push(["description", description.trim()])
  for (const relay of normalizeRelays(relays)) tags.push(["r", relay])
  for (const server of blossomServers.map(server => server.trim()).filter(Boolean)) {
    tags.push(["blossom", server])
  }
  for (const mint of mints.filter(mint => mint.url.trim())) {
    tags.push(appendDefined(["mint", mint.url.trim()], mint.type?.trim()))
  }
  if (tos?.ref.trim())
    tags.push(appendDefined(["tos", tos.ref.trim()], normalizeRelay(tos.relay) || undefined))
  if (location?.trim()) tags.push(["location", location.trim()])
  const normalizedGeohash = normalizeGeohash(geohash)
  if (normalizedGeohash) tags.push(["g", normalizedGeohash])

  for (const section of sections) {
    tags.push(["content", section.name])
    for (const sectionKind of section.kinds) {
      tags.push(appendDefined(["k", String(sectionKind.kind)], sectionKind.subtype))
    }
    tags.push(appendDefined(["a", section.profileList.address], section.profileList.relay))
    tags.push(["badge", section.badge.address])
  }

  return {kind: COMMUNITY_DEFINITION_KIND, content: "", tags}
}

export const makeCommunityBadgeDefinition = ({
  badge,
  name,
  description,
  image,
}: {
  badge: CommunityBadgeRef
  name?: string
  description?: string
  image?: string
}): EventContent & {kind: typeof BADGE_DEFINITION_KIND} => ({
  kind: BADGE_DEFINITION_KIND,
  content: "",
  tags: [
    ["d", badge.identifier],
    ["name", name?.trim() || badge.identifier],
    ...(description?.trim() ? [["description", description.trim()]] : []),
    ...(image?.trim() ? [["image", image.trim()]] : []),
  ],
})

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
      geohash = normalizeGeohash(tag[1]) || undefined
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

export const findCommunitySection = (definition: CommunityDefinition, name: string) =>
  definition.sections.find(section => section.name === name)

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
