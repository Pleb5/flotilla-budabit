import * as nip19 from "nostr-tools/nip19"
import type {EventContent, TrustedEvent} from "@welshman/util"
import {BADGE_DEFINITION, isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {randomId} from "@welshman/lib"

export const COMMUNITY_DEFINITION_KIND = 10222
export const TARGETED_PUBLICATION_KIND = 30222
export const PROFILE_LIST_KIND = 30000
export const FORM_TEMPLATE_KIND = 30168
export const FORM_RESPONSE_KIND = 1069
export const MAX_TARGET_COMMUNITIES = 12

export const COMMUNITY_SECTION_GENERAL = "General"
export const COMMUNITY_SECTION_ROOMS = "Rooms"
export const COMMUNITY_SECTION_THREADS = "Threads"
export const COMMUNITY_SECTION_CALENDAR = "Calendar"
export const COMMUNITY_SECTION_GOALS = "Goals"
export const COMMUNITY_SECTION_REPOSITORIES = "Repositories"
export const COMMUNITY_SECTION_PERMALINKS = "Permalinks"
export const COMMUNITY_SECTION_WIDGETS = "Widgets"

export const COMMUNITY_SUBTYPE_ROOM = "room"
export const COMMUNITY_SUBTYPE_THREADS = "threads"
export const COMMUNITY_SUBTYPE_ROOM_MESSAGE = "room-message"

const LEGACY_COMMUNITY_SECTION_FORUM = "Forum"
const LEGACY_COMMUNITY_SUBTYPE_FORUM = "forum"

export const normalizeCommunitySectionName = (name: string) => {
  const trimmed = name.trim()

  return trimmed === LEGACY_COMMUNITY_SECTION_FORUM ? COMMUNITY_SECTION_THREADS : trimmed
}

export const normalizeCommunitySectionSubtype = (subtype?: string) => {
  const trimmed = subtype?.trim()
  if (!trimmed) return undefined

  return trimmed === LEGACY_COMMUNITY_SUBTYPE_FORUM ? COMMUNITY_SUBTYPE_THREADS : trimmed
}

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

export const normalizeCommunitySectionKind = (
  sectionKind: CommunitySectionKind,
): CommunitySectionKind => {
  const subtype = normalizeCommunitySectionSubtype(sectionKind.subtype)

  return subtype ? {kind: sectionKind.kind, subtype} : {kind: sectionKind.kind}
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
  profileLists?: CommunityProfileListRef[]
  retention?: CommunityRetentionPolicy[]
}

export type CommunitySetupRefs = {
  communityPubkey: string
  relays: string[]
  sections: CommunitySetupSection[]
}

export type CommunityDefinitionSectionInput = {
  name: string
  kinds: CommunitySectionKind[]
  profileList?: CommunityProfileListRef
  badge?: CommunityBadgeRef
  profileLists?: CommunityProfileListRef[]
  badges?: CommunityBadgeRef[]
  retention?: CommunityRetentionPolicy[]
}

export type BuildCommunityDefinitionParams = {
  relays: string[]
  sections: CommunityDefinitionSectionInput[]
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

export const makeCommunityNcommunity = ({
  pubkey,
  relayHints = [],
}: {
  pubkey: string
  relayHints?: string[]
}) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return ""

  const relays = normalizeRelays(relayHints)
  const params = new URLSearchParams()

  for (const relay of relays) params.append("relay", relay)

  const query = params.toString()

  return `ncommunity://${normalizedPubkey}${query ? `?${query}` : ""}`
}

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
  switch (normalizeCommunitySectionName(name)) {
    case COMMUNITY_SECTION_GENERAL:
      return [
        {kind: 9, subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE},
        {kind: 1111},
        {kind: 7},
        {kind: 1984},
        {kind: 1985},
      ]
    case COMMUNITY_SECTION_ROOMS:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM}]
    case COMMUNITY_SECTION_THREADS:
      return [{kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}]
    case COMMUNITY_SECTION_CALENDAR:
      return [{kind: 31922}]
    case COMMUNITY_SECTION_GOALS:
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
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SECTION_CALENDAR,
  COMMUNITY_SECTION_GOALS,
  COMMUNITY_SECTION_REPOSITORIES,
  COMMUNITY_SECTION_PERMALINKS,
  COMMUNITY_SECTION_WIDGETS,
] as const

export const makeAddress = (kind: number, pubkey: string, identifier: string) =>
  `${kind}:${normalizePubkey(pubkey)}:${identifier}`

export const makeCommunitySetupSection = ({
  communityPubkey,
  profileListPubkey,
  relays,
  name,
  kinds = getDefaultCommunitySectionKinds(name),
}: {
  communityPubkey: string
  profileListPubkey: string
  relays: string[]
  name: string
  kinds?: CommunitySectionKind[]
}): CommunitySetupSection => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const normalizedProfileListPubkey = normalizePubkey(profileListPubkey)
  const normalizedRelays = normalizeRelays(relays)
  const normalizedName = normalizeCommunitySectionName(name)
  const normalizedKinds = kinds.map(normalizeCommunitySectionKind)
  const identifier = makeCommunityScopedIdentifier(normalizedCommunityPubkey, normalizedName)
  const profileListAddress = makeAddress(PROFILE_LIST_KIND, normalizedProfileListPubkey, identifier)
  const profileList = {
    kind: PROFILE_LIST_KIND,
    pubkey: normalizedProfileListPubkey,
    identifier,
    address: profileListAddress,
    relay: normalizedRelays[0],
  }

  return {
    name: normalizedName,
    kinds: normalizedKinds,
    profileList,
    profileLists: [profileList],
  }
}

export const makeCommunitySetupRefs = ({
  communityPubkey,
  profileListPubkey,
  relays,
  sectionNames = DEFAULT_COMMUNITY_SECTION_NAMES,
}: {
  communityPubkey: string
  profileListPubkey: string
  relays: string[]
  sectionNames?: readonly string[]
}): CommunitySetupRefs => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const normalizedProfileListPubkey = normalizePubkey(profileListPubkey)
  const normalizedRelays = normalizeRelays(relays)

  return {
    communityPubkey: normalizedCommunityPubkey,
    relays: normalizedRelays,
    sections: sectionNames.map(name =>
      makeCommunitySetupSection({
        communityPubkey: normalizedCommunityPubkey,
        profileListPubkey: normalizedProfileListPubkey,
        relays: normalizedRelays,
        name,
      }),
    ),
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
    tags.push(["content", normalizeCommunitySectionName(section.name)])
    for (const sectionKind of section.kinds) {
      const normalizedKind = normalizeCommunitySectionKind(sectionKind)

      tags.push(appendDefined(["k", String(normalizedKind.kind)], normalizedKind.subtype))
    }
    for (const profileList of section.profileLists ||
      (section.profileList ? [section.profileList] : [])) {
      tags.push(appendDefined(["a", profileList.address], profileList.relay))
    }
    for (const retention of section.retention || []) {
      tags.push(["retention", String(retention.kind), String(retention.value), retention.type])
    }
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
}): EventContent & {kind: typeof BADGE_DEFINITION} => ({
  kind: BADGE_DEFINITION,
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

  return {kind, subtype: normalizeCommunitySectionSubtype(tag[2])}
}

const parseProfileListRef = (tag: string[]): CommunityProfileListRef | undefined => {
  const ref = parseAddressRef(tag[1] || "")
  if (!ref || ref.kind !== PROFILE_LIST_KIND) return undefined

  return {...ref, relay: normalizeRelay(tag[2]) || undefined}
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
      currentSection = makeSection(normalizeCommunitySectionName(tag[1]))
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

export const findCommunitySection = (definition: CommunityDefinition, name: string) => {
  const normalizedName = normalizeCommunitySectionName(name)
  const exactSection = definition.sections.find(
    section => normalizeCommunitySectionName(section.name) === normalizedName,
  )
  if (exactSection) return exactSection

  if (normalizedName === COMMUNITY_SECTION_THREADS) {
    return definition.sections.find(section =>
      sectionSupportsKind(section, 11, COMMUNITY_SUBTYPE_THREADS),
    )
  }

  if (normalizedName === COMMUNITY_SECTION_GOALS) {
    return definition.sections.find(section =>
      section.kinds.some(sectionKind => sectionKind.kind === 9041),
    )
  }
}

export const sectionSupportsKind = (
  section: CommunitySection | undefined,
  kind: number,
  subtype?: string,
) => {
  const normalizedSubtype = normalizeCommunitySectionSubtype(subtype)

  return Boolean(
    section?.kinds.some(
      sectionKind =>
        sectionKind.kind === kind &&
        (!normalizedSubtype ||
          normalizeCommunitySectionSubtype(sectionKind.subtype) === normalizedSubtype),
    ),
  )
}

export const getCommunitySectionDisplayName = (section: CommunitySection) =>
  sectionSupportsKind(section, 9041)
    ? COMMUNITY_SECTION_GOALS
    : normalizeCommunitySectionName(section.name)

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
