import * as nip19 from "nostr-tools/nip19"
import type {EventContent, Filter, TrustedEvent} from "@welshman/util"

export const COMMUNITY_DEFINITION_KIND = 32222
export const TARGETED_PUBLICATION_KIND = 30222
export const MAX_TARGET_COMMUNITIES = 12

declare const communityIdBrand: unique symbol
declare const ownerPubkeyBrand: unique symbol

export type CommunityId = string & {[communityIdBrand]: true}
export type OwnerPubkey = string & {[ownerPubkeyBrand]: true}

export type CommunityPointer = {
  kind: typeof COMMUNITY_DEFINITION_KIND
  ownerPubkey: OwnerPubkey
  communityId: CommunityId
  address: string
  cacheKey: string
  naddr: string
  relayHints: string[]
}

export type CommunityDefinitionMetadata = {
  name: string
  description?: string
  picture?: string
  banner?: string
  website?: string
  location?: string
  geohash?: string
}

export type CommunityDefinitionSectionKind = {kind: number; subtype?: string}
export type CommunityDefinitionProfileListRef = {address: string; relay?: string}
export type CommunityDefinitionBadgeRef = {address: string; relay?: string}
export type CommunityDefinitionRetentionPolicy = {
  kind: number
  value: number
  type: "time" | "count"
}
export type CommunityDefinitionMint = {url: string; type?: string}
export type CommunityDefinitionTerms = {reference: string; relay?: string}
export type CommunityDefinitionService = {
  name: string
  pubkey: OwnerPubkey
  requestRelay: string
  handlerAddress: string
  handlerRelay: string
}

export type CommunityDefinitionSection = {
  name: string
  kinds: CommunityDefinitionSectionKind[]
  profileLists: CommunityDefinitionProfileListRef[]
  badges: CommunityDefinitionBadgeRef[]
  retention: CommunityDefinitionRetentionPolicy[]
}

export type CommunityDefinitionSectionInput = {
  name: string
  kinds: CommunityDefinitionSectionKind[]
  profileLists: CommunityDefinitionProfileListRef[]
  badges?: CommunityDefinitionBadgeRef[]
  retention?: CommunityDefinitionRetentionPolicy[]
}

export type CommunityDefinition = {
  readAccess?: "members"
  event: TrustedEvent
  pointer: CommunityPointer
  communityId: CommunityId
  ownerPubkey: OwnerPubkey
  metadata: CommunityDefinitionMetadata
  relays: string[]
  blossomServers: string[]
  graspServers: string[]
  mints: CommunityDefinitionMint[]
  terms?: CommunityDefinitionTerms
  services: CommunityDefinitionService[]
  sections: CommunityDefinitionSection[]
  sourceTags: string[][]
}

export type BuildCommunityDefinitionParams = Omit<CommunityDefinitionMetadata, "name"> & {
  readAccess?: "members"
  communityId: string
  name: string
  relays: string[]
  blossomServers?: string[]
  graspServers?: string[]
  mints?: Array<{url: string; type?: string}>
  terms?: {reference: string; relay?: string}
  services?: Array<{
    name: string
    pubkey: string
    requestRelay: string
    handlerAddress: string
    handlerRelay: string
  }>
  sections: CommunityDefinitionSectionInput[]
}

export type TargetedPublicationSource =
  | {type: "a"; value: string; relay?: string}
  | {type: "e"; value: string; relay?: string; pubkey?: string}

export type TargetedPublication = {
  id: string
  kind: number
  source?: TargetedPublicationSource
  communities: CommunityPointer[]
}

export type TargetedPublicationTemplate = EventContent & {
  kind: typeof TARGETED_PUBLICATION_KIND
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const GEOHASH = /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/
const CHILD_PURPOSE = /^[a-z][a-z0-9-]{0,31}$/
const SECTION_PURPOSE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SECTION_SHARD = /^(?:[2-9]|[1-9][0-9]+)$/
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
const MINT_TYPE = /^[\x21-\x7e]{1,32}$/
const utf8Length = (value: string) => new TextEncoder().encode(value).length
export const parseCommunityId = (value: string): CommunityId | undefined =>
  LOWER_HEX_64.test(value) ? (value as CommunityId) : undefined

export const parseOwnerPubkey = (value: string): OwnerPubkey | undefined =>
  LOWER_HEX_64.test(value) ? (value as OwnerPubkey) : undefined

const normalizeUrl = (
  value: string | undefined,
  schemes: readonly string[],
): string | undefined => {
  if (!value || value !== value.trim() || utf8Length(value) > 2048) return undefined

  try {
    const url = new URL(value)
    if (
      !schemes.includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return undefined
    }

    let normalized = url.toString()
    if (url.pathname === "/" && !url.search) normalized = normalized.slice(0, -1)

    return normalized
  } catch {
    return undefined
  }
}

// Community definitions have a shipped slashless-root wire format. Transport
// consumers canonicalize these values after parsing.
export const normalizeCommunityRelay = (value?: string) => normalizeUrl(value, ["wss:"])

const normalizeHttpsUrl = (value?: string) => normalizeUrl(value, ["https:"])
const normalizeWebsite = (value?: string) => normalizeUrl(value, ["http:", "https:"])

const normalizeRelayList = (values: string[], maximum: number) => {
  const result: string[] = []

  for (const value of values) {
    const relay = normalizeCommunityRelay(value)
    if (!relay || result.includes(relay)) continue
    result.push(relay)
    if (result.length === maximum) break
  }

  return result
}

export const makeCommunityPointer = ({
  ownerPubkey,
  communityId,
  relayHints = [],
}: {
  ownerPubkey: string
  communityId: string
  relayHints?: string[]
}): CommunityPointer | undefined => {
  const owner = parseOwnerPubkey(ownerPubkey)
  const id = parseCommunityId(communityId)
  if (!owner || !id) return undefined

  const address = `${COMMUNITY_DEFINITION_KIND}:${owner}:${id}`
  const relays = normalizeRelayList(relayHints, 3)

  return {
    kind: COMMUNITY_DEFINITION_KIND,
    ownerPubkey: owner,
    communityId: id,
    address,
    cacheKey: address,
    naddr: nip19.naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: owner,
      identifier: id,
      relays,
    }),
    relayHints: relays,
  }
}

export const parseCommunityDefinitionAddress = (value: string) => {
  const [kind, ownerPubkey, communityId, ...extra] = value.split(":")
  if (kind !== String(COMMUNITY_DEFINITION_KIND) || extra.length > 0) return undefined

  return makeCommunityPointer({ownerPubkey, communityId})
}

export const parseCommunityNaddr = (value: string): CommunityPointer | undefined => {
  try {
    const decoded = nip19.decode(value)
    if (decoded.type !== "naddr" || decoded.data.kind !== COMMUNITY_DEFINITION_KIND) {
      return undefined
    }

    return makeCommunityPointer({
      ownerPubkey: decoded.data.pubkey,
      communityId: decoded.data.identifier,
      relayHints: decoded.data.relays,
    })
  } catch {
    return undefined
  }
}

export const communityPointersEqual = (
  first: Pick<CommunityPointer, "address"> | undefined,
  second: Pick<CommunityPointer, "address"> | undefined,
) => Boolean(first && second && first.address === second.address)

export const makeCommunityScopeTags = (communityIdValue: string, tags: string[][] = []) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId) throw new Error("Invalid community ID.")
  if (tags.some(tag => tag[0] === "h")) {
    throw new Error("Conflicting community scope tag.")
  }

  return [["h", communityId], ...tags.map(tag => [...tag])]
}

export const makeCommunityAuthorityTags = (
  community: CommunityPointer,
  relay?: string,
  tags: string[][] = [],
) => {
  const pointer = makeCommunityPointer({
    ownerPubkey: community.ownerPubkey,
    communityId: community.communityId,
    relayHints: community.relayHints,
  })
  const normalizedRelay = relay ? normalizeCommunityRelay(relay) : undefined
  if (!pointer || pointer.address !== community.address || (relay && !normalizedRelay)) {
    throw new Error("Invalid community authority.")
  }
  if (tags.some(tag => tag[0] === "a" && tag[3] === "community")) {
    throw new Error("Conflicting community authority tag.")
  }

  return makeCommunityScopeTags(pointer.communityId, [
    ["a", pointer.address, normalizedRelay || "", "community"],
    ...tags,
  ])
}

/**
 * Tags for a community-scoped `kind:5` deletion request.
 *
 * Deletions carry only the stable `h=<communityId>` scope plus the caller's
 * `e`/`k` references. They MUST NOT carry the marked community `a` used by
 * other authority-sensitive events: NIP-09 defines every `a` tag on a `kind:5`
 * as a deletion target, so relays either reject the event when the address
 * pubkey differs from the signer or, for the owner, tombstone the community
 * definition itself. The deleted event already pins the exact branch.
 */
export const makeCommunityDeleteTags = (community: CommunityPointer, tags: string[][] = []) => {
  if (tags.some(tag => tag[0] === "a")) {
    throw new Error("Community deletion requests must not carry a tags.")
  }

  return makeCommunityScopeTags(community.communityId, tags)
}

/**
 * Whether a `kind:5` is scoped to the given community.
 *
 * Accepts the current shape (exactly one `h`, no marked community `a`) and the
 * legacy shape that also carried a marked community `a`; a legacy `a` must
 * still name the exact branch. Same-author and exact target checks are the
 * caller's responsibility.
 */
export const deleteMatchesCommunity = (
  event: Pick<TrustedEvent, "kind" | "tags">,
  community: Pick<CommunityPointer, "communityId" | "address">,
) => {
  if (event.kind !== 5) return false
  const hTags = event.tags.filter(tag => tag[0] === "h")
  if (hTags.length !== 1 || !exactTag(hTags[0], 2) || hTags[0][1] !== community.communityId) {
    return false
  }
  const marked = event.tags.filter(tag => tag[0] === "a" && tag[3] === "community")
  if (marked.length === 0) return true

  return parseCommunityAuthority(event)?.address === community.address
}

export const parseCommunityAuthority = (
  event: Pick<TrustedEvent, "tags">,
): CommunityPointer | undefined => {
  const hTags = event.tags.filter(tag => tag[0] === "h")
  const authorityTags = event.tags.filter(tag => tag[0] === "a" && tag[3] === "community")
  if (
    hTags.length !== 1 ||
    !exactTag(hTags[0], 2) ||
    authorityTags.length !== 1 ||
    !exactTag(authorityTags[0], 4)
  ) {
    return undefined
  }

  const communityId = parseCommunityId(hTags[0][1] || "")
  const addressPointer = parseCommunityDefinitionAddress(authorityTags[0][1] || "")
  const relay = authorityTags[0][2] ? normalizeCommunityRelay(authorityTags[0][2]) : undefined
  if (
    !communityId ||
    !addressPointer ||
    addressPointer.communityId !== communityId ||
    (authorityTags[0][2] && relay !== authorityTags[0][2])
  ) {
    return undefined
  }

  return makeCommunityPointer({
    ownerPubkey: addressPointer.ownerPubkey,
    communityId,
    relayHints: relay ? [relay] : [],
  })
}

const makeCommunityChildSlug = (value: string, fallback: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "") || fallback

export const makeCommunityChildIdentifier = (
  communityIdValue: string,
  purpose: string,
  value: string,
) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !CHILD_PURPOSE.test(purpose)) return undefined
  const slug = makeCommunityChildSlug(value, purpose)
  const identifier = `budabit-${communityId}-${slug}`

  return utf8Length(identifier) <= 200 ? identifier : undefined
}

export const makeCommunityProfileListIdentifier = (communityIdValue: string, value: string) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !SECTION_PURPOSE.test(value)) return undefined
  const identifier = `${communityId}-${value}`
  return utf8Length(identifier) <= 200 ? identifier : undefined
}

export const parseCommunityProfileListIdentifier = (
  communityIdValue: string,
  identifier: string,
) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !identifier.startsWith(`${communityId}-`) || utf8Length(identifier) > 200) {
    return undefined
  }
  const suffix = identifier.slice(communityId.length + 1)
  const [purpose, shard, ...extra] = suffix.split(".")
  if (!SECTION_PURPOSE.test(purpose) || extra.length > 0 || (shard && !SECTION_SHARD.test(shard))) {
    return undefined
  }
  return {purpose, ...(shard ? {shard: Number(shard)} : {})}
}

export const getCommunitySectionPurpose = (
  communityIdValue: string,
  section: Pick<CommunityDefinitionSection, "name" | "profileLists">,
) => {
  for (const ref of section.profileLists) {
    const identifier = ref.address.split(":").slice(2).join(":")
    const parsed = parseCommunityProfileListIdentifier(communityIdValue, identifier)
    if (parsed) return parsed.purpose
  }

  const purpose = makeCommunityChildSlug(section.name, "section")
  return SECTION_PURPOSE.test(purpose) ? purpose : undefined
}

const parseCanonicalKind = (value: string | undefined) => {
  if (!value || !CANONICAL_UINT.test(value)) return undefined
  const kind = Number(value)
  return Number.isInteger(kind) && kind <= 65535 ? kind : undefined
}

const parseAddress = (value: string, requiredKind?: number) => {
  const [kindValue, pubkeyValue, ...identifierParts] = value.split(":")
  const kind = parseCanonicalKind(kindValue)
  const pubkey = parseOwnerPubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")
  if (
    kind === undefined ||
    kind < 30000 ||
    kind >= 40000 ||
    (requiredKind !== undefined && kind !== requiredKind)
  ) {
    return undefined
  }
  if (!pubkey || !identifier || utf8Length(identifier) > 200) return undefined

  return {kind, pubkey, identifier, address: `${kind}:${pubkey}:${identifier}`}
}

export const isCommunityDefinitionReference = (value: string) =>
  LOWER_HEX_64.test(value) || Boolean(parseAddress(value))

const parseReference = isCommunityDefinitionReference

const exactTag = (tag: string[], size: number) => tag.length === size
const getTags = (tags: string[][], name: string) => tags.filter(tag => tag[0] === name)
const getSingleton = (tags: string[][], name: string, sizes: number[]) => {
  const matches = getTags(tags, name)
  if (matches.length > 1) return null
  if (matches.length === 0) return undefined
  return sizes.includes(matches[0].length) ? matches[0] : null
}

const parseBoundedText = (value: string | undefined, minimum: number, maximum: number) => {
  if (value === undefined || value !== value.trim()) return undefined
  const size = utf8Length(value)
  return size >= minimum && size <= maximum ? value : undefined
}

const parseSection = (
  tags: string[][],
  communityId: string,
): CommunityDefinitionSection | undefined => {
  const content = tags[0]
  const name = exactTag(content, 2) ? parseBoundedText(content[1], 1, 100) : undefined
  if (!name) return undefined

  const kinds: CommunityDefinitionSectionKind[] = []
  const profileLists: CommunityDefinitionProfileListRef[] = []
  const badges: CommunityDefinitionBadgeRef[] = []
  const retention: CommunityDefinitionRetentionPolicy[] = []

  for (const tag of tags.slice(1)) {
    if (tag[0] === "k") {
      if (![2, 3].includes(tag.length)) return undefined
      const kind = parseCanonicalKind(tag[1])
      const subtype = tag.length === 3 ? parseBoundedText(tag[2], 1, 64) : undefined
      if (kind === undefined || (tag.length === 3 && !subtype)) return undefined
      kinds.push(subtype ? {kind, subtype} : {kind})
    } else if (tag[0] === "a" || tag[0] === "badge") {
      if (![2, 3].includes(tag.length)) return undefined
      const ref = parseAddress(tag[1] || "", tag[0] === "a" ? 30000 : 30009)
      const relay = tag[2] ? normalizeCommunityRelay(tag[2]) : undefined
      if (!ref || (tag[2] && !relay)) return undefined
      if (tag[0] === "a" && !parseCommunityProfileListIdentifier(communityId, ref.identifier)) {
        return undefined
      }
      const item = relay ? {address: ref.address, relay} : {address: ref.address}
      if (tag[0] === "a") profileLists.push(item)
      else badges.push(item)
    } else if (tag[0] === "retention") {
      if (!exactTag(tag, 4)) return undefined
      const kind = parseCanonicalKind(tag[1])
      const value = CANONICAL_UINT.test(tag[2] || "") ? Number(tag[2]) : 0
      const type = tag[3]
      if (
        kind === undefined ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        (type !== "time" && type !== "count")
      ) {
        return undefined
      }
      retention.push({kind, value, type})
    }
  }

  if (kinds.length === 0) return undefined
  return {name, kinds, profileLists, badges, retention}
}

const parseOptionalUrlTag = (
  tags: string[][],
  name: string,
  normalizer: (value?: string) => string | undefined,
) => {
  const tag = getSingleton(tags, name, [2])
  if (tag === null) return null
  if (!tag) return undefined
  return normalizer(tag[1]) || null
}

const parseOptionalTextTag = (tags: string[][], name: string, maximum: number) => {
  const tag = getSingleton(tags, name, [2])
  if (tag === null) return null
  if (!tag) return undefined
  return parseBoundedText(tag[1], 1, maximum) || null
}

const SECTION_TAGS = new Set(["k", "a", "badge", "retention"])
const TOP_LEVEL_TAGS = new Set([
  "d",
  "name",
  "description",
  "picture",
  "banner",
  "website",
  "r",
  "blossom",
  "grasp",
  "mint",
  "location",
  "g",
  "tos",
  "service",
])

const parseMintTags = (tags: string[][]): CommunityDefinitionMint[] | undefined => {
  const mintTags = getTags(tags, "mint")
  if (mintTags.length > 20) return undefined
  const result: CommunityDefinitionMint[] = []
  const seen = new Set<string>()
  for (const tag of mintTags) {
    if (![2, 3].includes(tag.length)) return undefined
    const url = normalizeHttpsUrl(tag[1])
    const type = tag[2]
    if (!url || url !== tag[1] || (type && !MINT_TYPE.test(type))) return undefined
    const key = `${url}\u0000${type || ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(type ? {url, type} : {url})
  }
  return result
}

const parseTermsTag = (tags: string[][]): CommunityDefinitionTerms | null | undefined => {
  const tag = getSingleton(tags, "tos", [2, 3])
  if (tag === null) return null
  if (!tag) return undefined
  const relay = tag[2] ? normalizeCommunityRelay(tag[2]) : undefined
  if (!parseReference(tag[1]) || (tag[2] && (!relay || relay !== tag[2]))) return null
  return relay ? {reference: tag[1], relay} : {reference: tag[1]}
}

const parseServiceTags = (tags: string[][]): CommunityDefinitionService[] | undefined => {
  const serviceTags = getTags(tags, "service")
  if (serviceTags.length > 50) return undefined
  const result: CommunityDefinitionService[] = []
  const seen = new Set<string>()
  for (const tag of serviceTags) {
    if (!exactTag(tag, 6) || !SERVICE_NAME.test(tag[1])) return undefined
    const pubkey = parseOwnerPubkey(tag[2])
    const requestRelay = normalizeCommunityRelay(tag[3])
    const handler = parseAddress(tag[4])
    const handlerRelay = normalizeCommunityRelay(tag[5])
    if (
      !pubkey ||
      !requestRelay ||
      requestRelay !== tag[3] ||
      !handler ||
      !handlerRelay ||
      handlerRelay !== tag[5]
    ) {
      return undefined
    }
    const key = tag.join("\u0000")
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: tag[1],
      pubkey,
      requestRelay,
      handlerAddress: handler.address,
      handlerRelay,
    })
  }
  return result
}

export const getCommunityDefinitionValidationFailure = (event: TrustedEvent) => {
  if (parseCommunityDefinition(event)) return undefined

  const hasInvalidService = getTags(event.tags || [], "service").some(tag => {
    if (!exactTag(tag, 6) || !SERVICE_NAME.test(tag[1])) return true
    const requestRelay = normalizeCommunityRelay(tag[3])
    const handlerRelay = normalizeCommunityRelay(tag[5])

    return (
      !parseOwnerPubkey(tag[2]) ||
      !requestRelay ||
      requestRelay !== tag[3] ||
      !parseAddress(tag[4]) ||
      !handlerRelay ||
      handlerRelay !== tag[5]
    )
  })

  return {
    eventId: event.id || "unknown",
    category: hasInvalidService ? "service declaration" : "protocol fields",
  }
}

export const parseCommunityDefinition = (event: TrustedEvent): CommunityDefinition | undefined => {
  if (event.kind !== COMMUNITY_DEFINITION_KIND || event.content !== "") return undefined
  const ownerPubkey = parseOwnerPubkey(event.pubkey)
  if (!ownerPubkey) return undefined

  const tags = event.tags || []
  // Optional read metadata does not invalidate the base definition or impose a
  // client routing policy. Unknown/malformed values remain preserved extensions.
  const contentIndex = tags.findIndex(tag => tag[0] === "content")
  const readAccessTags = tags
    .slice(0, contentIndex < 0 ? tags.length : contentIndex)
    .filter(tag => tag[0] === "read-access")
  const readAccess =
    readAccessTags.length === 1 &&
    readAccessTags[0].length === 2 &&
    readAccessTags[0][1] === "members"
      ? ("members" as const)
      : undefined
  const dTags = getTags(tags, "d")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2)) return undefined
  const communityId = parseCommunityId(dTags[0][1] || "")
  if (!communityId || getTags(tags, "h").length > 0) return undefined

  const nameTag = getSingleton(tags, "name", [2])
  const name = nameTag && nameTag !== null ? parseBoundedText(nameTag[1], 1, 100) : undefined
  if (!name) return undefined

  const relayTags = getTags(tags, "r")
  if (relayTags.length < 1 || relayTags.length > 20) return undefined
  const relays: string[] = []
  for (const tag of relayTags) {
    if (!exactTag(tag, 2)) return undefined
    const relay = normalizeCommunityRelay(tag[1])
    if (!relay || relay !== tag[1]) return undefined
    if (!relays.includes(relay)) relays.push(relay)
  }

  const description = parseOptionalTextTag(tags, "description", 4096)
  const location = parseOptionalTextTag(tags, "location", 256)
  const picture = parseOptionalUrlTag(tags, "picture", normalizeHttpsUrl)
  const banner = parseOptionalUrlTag(tags, "banner", normalizeHttpsUrl)
  const website = parseOptionalUrlTag(tags, "website", normalizeWebsite)
  const geohashTag = getSingleton(tags, "g", [2])
  const geohash =
    geohashTag && geohashTag !== null && GEOHASH.test(geohashTag[1])
      ? geohashTag[1]
      : geohashTag
        ? null
        : undefined
  if ([description, location, picture, banner, website, geohash].includes(null)) return undefined

  const blossomTags = getTags(tags, "blossom")
  const graspTags = getTags(tags, "grasp")
  if (blossomTags.length > 20 || graspTags.length > 20) return undefined
  const blossomServers: string[] = []
  const graspServers: string[] = []
  for (const [items, normalizer, output] of [
    [blossomTags, normalizeHttpsUrl, blossomServers],
    [graspTags, normalizeCommunityRelay, graspServers],
  ] as const) {
    for (const tag of items) {
      if (!exactTag(tag, 2)) return undefined
      const value = normalizer(tag[1])
      if (!value || value !== tag[1]) return undefined
      if (!output.includes(value)) output.push(value)
    }
  }

  const mints = parseMintTags(tags)
  const terms = parseTermsTag(tags)
  const services = parseServiceTags(tags)
  if (!mints || terms === null || !services) return undefined

  const rawSections: string[][][] = []
  let currentSection: string[][] | undefined
  for (const tag of tags) {
    if (tag[0] === "content") {
      currentSection = [tag]
      rawSections.push(currentSection)
    } else if (currentSection) {
      if (TOP_LEVEL_TAGS.has(tag[0])) return undefined
      currentSection.push(tag)
    } else if (SECTION_TAGS.has(tag[0])) {
      return undefined
    }
  }
  if (rawSections.length === 0) return undefined
  const sections = rawSections.map(tags => parseSection(tags, communityId))
  if (sections.some(section => !section)) return undefined
  const parsedSections = sections as CommunityDefinitionSection[]
  const sectionNames = new Set<string>()
  const sectionKinds = new Set<string>()
  for (const section of parsedSections) {
    const nameKey = section.name.replace(/[A-Z]/g, value => value.toLowerCase())
    if (sectionNames.has(nameKey)) return undefined
    sectionNames.add(nameKey)
    for (const item of section.kinds) {
      const key = `${item.kind}:${item.subtype || ""}`
      if (sectionKinds.has(key)) return undefined
      sectionKinds.add(key)
    }
  }

  const pointer = makeCommunityPointer({ownerPubkey, communityId, relayHints: relays})
  if (!pointer) return undefined

  return {
    event,
    ...(readAccess ? {readAccess} : {}),
    pointer,
    communityId,
    ownerPubkey,
    metadata: {
      name,
      ...(description ? {description} : {}),
      ...(picture ? {picture} : {}),
      ...(banner ? {banner} : {}),
      ...(website ? {website} : {}),
      ...(location ? {location} : {}),
      ...(geohash ? {geohash} : {}),
    },
    relays,
    blossomServers,
    graspServers,
    mints,
    ...(terms ? {terms} : {}),
    services,
    sections: parsedSections,
    sourceTags: tags.map(tag => [...tag]),
  }
}

const requireText = (value: string, minimum: number, maximum: number, label: string) => {
  const parsed = parseBoundedText(value, minimum, maximum)
  if (!parsed) throw new Error(`Invalid ${label}.`)
  return parsed
}

const makeCommunityDefinitionServiceTag = (
  service: NonNullable<BuildCommunityDefinitionParams["services"]>[number],
) => {
  const pubkey = parseOwnerPubkey(service.pubkey)
  const requestRelay = normalizeCommunityRelay(service.requestRelay)
  const handler = parseAddress(service.handlerAddress)
  const handlerRelay = normalizeCommunityRelay(service.handlerRelay)
  if (!SERVICE_NAME.test(service.name) || !pubkey || !requestRelay || !handler || !handlerRelay) {
    throw new Error("Invalid service declaration.")
  }

  return ["service", service.name, pubkey, requestRelay, handler.address, handlerRelay]
}

const makeSectionTags = (
  section: CommunityDefinitionSectionInput,
  communityId: string,
): string[][] => {
  const tags: string[][] = [["content", requireText(section.name, 1, 100, "section name")]]
  if (section.kinds.length === 0) throw new Error("Community sections require kinds.")

  for (const item of section.kinds) {
    if (!Number.isInteger(item.kind) || item.kind < 0 || item.kind > 65535) {
      throw new Error("Invalid section kind.")
    }
    const subtype = item.subtype !== undefined ? parseBoundedText(item.subtype, 1, 64) : undefined
    if (item.subtype !== undefined && !subtype) throw new Error("Invalid section subtype.")
    tags.push(subtype ? ["k", String(item.kind), subtype] : ["k", String(item.kind)])
  }
  for (const item of section.profileLists) {
    const ref = parseAddress(item.address, 30000)
    if (!ref || !parseCommunityProfileListIdentifier(communityId, ref.identifier)) {
      throw new Error("Invalid profile-list address.")
    }
    const relay = item.relay ? normalizeCommunityRelay(item.relay) : undefined
    if (item.relay && !relay) throw new Error("Invalid profile-list relay.")
    tags.push(relay ? ["a", ref.address, relay] : ["a", ref.address])
  }
  for (const item of section.badges || []) {
    const ref = parseAddress(item.address, 30009)
    if (!ref) throw new Error("Invalid badge address.")
    const relay = item.relay ? normalizeCommunityRelay(item.relay) : undefined
    if (item.relay && !relay) throw new Error("Invalid badge relay.")
    tags.push(relay ? ["badge", ref.address, relay] : ["badge", ref.address])
  }
  for (const item of section.retention || []) {
    if (
      !Number.isInteger(item.kind) ||
      item.kind < 0 ||
      item.kind > 65535 ||
      !Number.isSafeInteger(item.value) ||
      item.value <= 0 ||
      (item.type !== "time" && item.type !== "count")
    ) {
      throw new Error("Invalid retention policy.")
    }
    tags.push(["retention", String(item.kind), String(item.value), item.type])
  }
  return tags
}

export const buildCommunityDefinition = (
  params: BuildCommunityDefinitionParams,
): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const communityId = parseCommunityId(params.communityId)
  if (!communityId) throw new Error("Invalid community ID.")
  if (params.relays.length > 20) throw new Error("Too many community relays.")
  const relays = normalizeRelayList(params.relays, 20)
  if (relays.length === 0 || params.relays.some(value => !normalizeCommunityRelay(value))) {
    throw new Error("A valid community relay URL is required.")
  }
  if (params.sections.length === 0) throw new Error("A community section is required.")

  const tags: string[][] = [
    ["d", communityId],
    ["name", requireText(params.name, 1, 100, "community name")],
  ]
  if (params.readAccess === "members") tags.push(["read-access", "members"])
  if (params.description) {
    tags.push(["description", requireText(params.description, 1, 4096, "description")])
  }
  for (const [name, value, normalizer] of [
    ["picture", params.picture, normalizeHttpsUrl],
    ["banner", params.banner, normalizeHttpsUrl],
    ["website", params.website, normalizeWebsite],
  ] as const) {
    if (!value) continue
    const normalized = normalizer(value)
    if (!normalized) throw new Error(`Invalid ${name}.`)
    tags.push([name, normalized])
  }
  if (params.location) {
    tags.push(["location", requireText(params.location, 1, 256, "location")])
  }
  if (params.geohash) {
    if (!GEOHASH.test(params.geohash)) throw new Error("Invalid geohash.")
    tags.push(["g", params.geohash])
  }
  for (const relay of relays) tags.push(["r", relay])
  if ((params.blossomServers?.length || 0) > 20) throw new Error("Too many Blossom URLs.")
  const blossomServers = new Set<string>()
  for (const value of params.blossomServers || []) {
    const normalized = normalizeHttpsUrl(value)
    if (!normalized || normalized !== value) throw new Error("Invalid Blossom URL.")
    if (blossomServers.has(normalized)) continue
    blossomServers.add(normalized)
    tags.push(["blossom", normalized])
  }
  if ((params.graspServers?.length || 0) > 20) throw new Error("Too many GRASP URLs.")
  const graspServers = new Set<string>()
  for (const value of params.graspServers || []) {
    const normalized = normalizeCommunityRelay(value)
    if (!normalized) throw new Error("Invalid GRASP URL.")
    if (graspServers.has(normalized)) continue
    graspServers.add(normalized)
    tags.push(["grasp", normalized])
  }
  if ((params.mints?.length || 0) > 20) throw new Error("Too many mint declarations.")
  const mintKeys = new Set<string>()
  for (const mint of params.mints || []) {
    const url = normalizeHttpsUrl(mint.url)
    if (!url || url !== mint.url || (mint.type && !MINT_TYPE.test(mint.type))) {
      throw new Error("Invalid mint declaration.")
    }
    const key = `${url}\u0000${mint.type || ""}`
    if (mintKeys.has(key)) continue
    mintKeys.add(key)
    tags.push(mint.type ? ["mint", url, mint.type] : ["mint", url])
  }
  if (params.terms) {
    const relay = params.terms.relay ? normalizeCommunityRelay(params.terms.relay) : undefined
    if (!parseReference(params.terms.reference) || (params.terms.relay && !relay)) {
      throw new Error("Invalid terms reference.")
    }
    tags.push(relay ? ["tos", params.terms.reference, relay] : ["tos", params.terms.reference])
  }
  if ((params.services?.length || 0) > 50) throw new Error("Too many service declarations.")
  const serviceKeys = new Set<string>()
  for (const service of params.services || []) {
    const tag = makeCommunityDefinitionServiceTag(service)
    const key = tag.join("\u0000")
    if (serviceKeys.has(key)) continue
    serviceKeys.add(key)
    tags.push(tag)
  }
  const sectionNames = new Set<string>()
  const sectionKinds = new Set<string>()
  for (const item of params.sections) {
    const name = requireText(item.name, 1, 100, "section name")
    const nameKey = name.replace(/[A-Z]/g, value => value.toLowerCase())
    if (sectionNames.has(nameKey)) throw new Error("Duplicate community section.")
    sectionNames.add(nameKey)
    for (const kind of item.kinds) {
      const key = `${kind.kind}:${kind.subtype || ""}`
      if (sectionKinds.has(key)) throw new Error("Duplicate community section kind.")
      sectionKinds.add(key)
    }
  }
  for (const item of params.sections) tags.push(...makeSectionTags(item, communityId))

  return {kind: COMMUNITY_DEFINITION_KIND, content: "", tags}
}

const EDITABLE_SINGLETONS = new Set([
  "name",
  "description",
  "picture",
  "banner",
  "website",
  "location",
  "g",
])

export const updateCommunityDefinition = (
  definition: CommunityDefinition,
  changes: Partial<CommunityDefinitionMetadata>,
  options: {
    replacement?: EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND}
    originalSectionNames?: Record<string, string>
  } = {},
): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const replacements = new Map<string, string[]>()
  const metadata = {...definition.metadata, ...changes}
  replacements.set("name", ["name", requireText(metadata.name, 1, 100, "community name")])
  for (const [name, value, normalizer] of [
    ["description", metadata.description, (item: string) => parseBoundedText(item, 1, 4096)],
    ["picture", metadata.picture, normalizeHttpsUrl],
    ["banner", metadata.banner, normalizeHttpsUrl],
    ["website", metadata.website, normalizeWebsite],
    ["location", metadata.location, (item: string) => parseBoundedText(item, 1, 256)],
    ["g", metadata.geohash, (item: string) => (GEOHASH.test(item) ? item : undefined)],
  ] as const) {
    if (!value) continue
    const normalized = normalizer(value)
    if (!normalized) throw new Error(`Invalid ${name}.`)
    replacements.set(name, [name, normalized])
  }

  const seen = new Set<string>()
  const tags: string[][] = []
  for (const tag of definition.sourceTags) {
    if (!EDITABLE_SINGLETONS.has(tag[0])) {
      tags.push([...tag])
      continue
    }
    if (seen.has(tag[0])) continue
    seen.add(tag[0])
    const replacement = replacements.get(tag[0])
    if (replacement) tags.push(replacement)
  }
  for (const [name, tag] of replacements) {
    if (!seen.has(name)) tags.splice(1, 0, tag)
  }

  if (!options.replacement) {
    return {kind: COMMUNITY_DEFINITION_KIND, content: "", tags}
  }

  const replacementCommunityIds = getTags(options.replacement.tags, "d")
  if (
    replacementCommunityIds.length !== 1 ||
    !exactTag(replacementCommunityIds[0], 2) ||
    replacementCommunityIds[0][1] !== definition.communityId
  ) {
    throw new Error("Community updates must preserve the exact definition address.")
  }

  const topLevelExtensions: string[][] = []
  const sectionExtensions = new Map<string, string[][]>()
  const replacementTags = options.replacement.tags
  const replacementContentIndex = replacementTags.findIndex(tag => tag[0] === "content")
  const replacesReadAccess = replacementTags
    .slice(0, replacementContentIndex < 0 ? replacementTags.length : replacementContentIndex)
    .some(tag => tag[0] === "read-access")
  let sourceSectionName = ""
  for (const tag of tags) {
    if (tag[0] === "content") {
      sourceSectionName = tag[1].toLowerCase()
      continue
    }
    if (TOP_LEVEL_TAGS.has(tag[0]) || SECTION_TAGS.has(tag[0])) continue
    // Preserve metadata through ordinary settings rebuilds. An explicit
    // replacement owns the new value; it is not a client disclosure gate.
    if (!sourceSectionName && tag[0] === "read-access" && replacesReadAccess) continue
    if (sourceSectionName) {
      sectionExtensions.set(sourceSectionName, [
        ...(sectionExtensions.get(sourceSectionName) || []),
        [...tag],
      ])
    } else {
      topLevelExtensions.push([...tag])
    }
  }

  const mergedTags: string[][] = []
  let extensionsInserted = false
  let replacementSectionName = ""
  const appendSectionExtensions = () => {
    if (!replacementSectionName) return
    const originalName =
      options.originalSectionNames?.[replacementSectionName] || replacementSectionName
    mergedTags.push(...(sectionExtensions.get(originalName) || []).map(tag => [...tag]))
  }

  for (const tag of options.replacement.tags) {
    if (tag[0] === "content") {
      appendSectionExtensions()
      if (!extensionsInserted) {
        mergedTags.push(...topLevelExtensions.map(item => [...item]))
        extensionsInserted = true
      }
      replacementSectionName = tag[1].toLowerCase()
    }
    mergedTags.push([...tag])
  }
  appendSectionExtensions()
  if (!extensionsInserted) mergedTags.push(...topLevelExtensions.map(item => [...item]))

  return {kind: COMMUNITY_DEFINITION_KIND, content: "", tags: mergedTags}
}

const getAddressableEventAddress = (event: TrustedEvent) => {
  const dTags = getTags(event.tags || [], "d")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2)) return undefined
  const pubkey = parseOwnerPubkey(event.pubkey)
  const identifier = dTags[0][1]
  if (!pubkey || !identifier) return undefined
  return `${event.kind}:${pubkey}:${identifier}`
}

export const selectCurrentAddressableEvent = (
  events: TrustedEvent[],
  address: string,
  isValid: (event: TrustedEvent) => boolean = () => true,
  isAddressTombstone: (event: TrustedEvent) => boolean = event =>
    event.tags.some(tag => exactTag(tag, 2) && tag[0] === "a" && tag[1] === address),
): TrustedEvent | undefined => {
  const parsedAddress = parseAddress(address)
  if (!parsedAddress) return undefined
  const tombstone = events
    .filter(
      event =>
        event.kind === 5 && event.pubkey === parsedAddress.pubkey && isAddressTombstone(event),
    )
    .sort(
      (first, second) => second.created_at - first.created_at || first.id.localeCompare(second.id),
    )[0]
  return events
    .filter(
      event =>
        getAddressableEventAddress(event) === address &&
        isValid(event) &&
        (!tombstone || event.created_at > tombstone.created_at),
    )
    .sort(
      (first, second) => second.created_at - first.created_at || first.id.localeCompare(second.id),
    )[0]
}

export const selectCurrentCommunityDefinition = (
  events: TrustedEvent[],
  definitionAddress: string,
) =>
  selectCurrentAddressableEvent(
    events,
    definitionAddress,
    event => Boolean(parseCommunityDefinition(event)),
    event => {
      const addresses = event.tags.filter(tag => tag[0] === "a")
      return (
        addresses.length === 1 && exactTag(addresses[0], 2) && addresses[0][1] === definitionAddress
      )
    },
  )

export const selectCurrentCommunityDefinitions = (events: TrustedEvent[]) => {
  const candidatesByAddress = new Map<
    string,
    Array<{event: TrustedEvent; definition: CommunityDefinition}>
  >()

  for (const event of events) {
    const definition = parseCommunityDefinition(event)
    if (!definition) continue
    const address = definition.pointer.address
    const candidates = candidatesByAddress.get(address) || []
    candidates.push({event, definition})
    candidatesByAddress.set(address, candidates)
  }

  const deletionCutoffByAddress = new Map<string, number>()
  const applyDeletion = (address: string, deletion: TrustedEvent) => {
    const parsedAddress = parseAddress(address)
    if (!parsedAddress || parsedAddress.pubkey !== deletion.pubkey) return
    const cutoff = deletionCutoffByAddress.get(address)
    if (cutoff === undefined || deletion.created_at > cutoff) {
      deletionCutoffByAddress.set(address, deletion.created_at)
    }
  }
  for (const event of events) {
    if (event.kind !== 5) continue
    const addressTags = event.tags.filter(tag => tag[0] === "a")
    if (addressTags.length === 1 && exactTag(addressTags[0], 2)) {
      const address = addressTags[0][1]
      if (candidatesByAddress.has(address)) applyDeletion(address, event)
    }
  }

  const definitions = new Map<string, CommunityDefinition>()
  for (const [address, candidates] of candidatesByAddress) {
    const cutoff = deletionCutoffByAddress.get(address)
    let current: (typeof candidates)[number] | undefined
    for (const candidate of candidates) {
      if (cutoff !== undefined && candidate.event.created_at <= cutoff) continue
      if (
        !current ||
        candidate.event.created_at > current.event.created_at ||
        (candidate.event.created_at === current.event.created_at &&
          candidate.event.id < current.event.id)
      ) {
        current = candidate
      }
    }
    if (current) definitions.set(address, current.definition)
  }

  return definitions
}

export const selectCurrentTargetedPublicationEvents = (events: TrustedEvent[]) => {
  const candidatesByAddress = new Map<string, TrustedEvent[]>()
  for (const event of events) {
    if (event.kind !== TARGETED_PUBLICATION_KIND) continue
    const address = getAddressableEventAddress(event)
    if (!address) continue
    const candidates = candidatesByAddress.get(address) || []
    candidates.push(event)
    candidatesByAddress.set(address, candidates)
  }

  const deletionCutoffByAddress = new Map<string, number>()
  const applyDeletion = (address: string, deletion: TrustedEvent) => {
    const parsedAddress = parseAddress(address)
    if (!parsedAddress || parsedAddress.pubkey !== deletion.pubkey) return
    const cutoff = deletionCutoffByAddress.get(address)
    if (cutoff === undefined || deletion.created_at > cutoff) {
      deletionCutoffByAddress.set(address, deletion.created_at)
    }
  }

  for (const event of events) {
    if (event.kind !== 5) continue
    for (const tag of event.tags) {
      if (!exactTag(tag, 2)) continue
      if (tag[0] === "a" && candidatesByAddress.has(tag[1])) {
        applyDeletion(tag[1], event)
      }
    }
  }

  const selected: TrustedEvent[] = []
  for (const [address, candidates] of candidatesByAddress) {
    const cutoff = deletionCutoffByAddress.get(address)
    let current: TrustedEvent | undefined
    for (const event of candidates) {
      if (
        (cutoff !== undefined && event.created_at <= cutoff) ||
        !parseTargetedPublication(event)
      ) {
        continue
      }
      if (
        !current ||
        event.created_at > current.created_at ||
        (event.created_at === current.created_at && event.id < current.id)
      ) {
        current = event
      }
    }
    if (current) selected.push(current)
  }

  return selected
}

export const MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES = 100

export const selectTargetedPublicationLifecycleCandidates = (events: TrustedEvent[]) => {
  const candidates = new Map<string, TrustedEvent>()
  for (const event of events) {
    if (event.kind !== TARGETED_PUBLICATION_KIND || !parseTargetedPublication(event)) continue
    const address = getAddressableEventAddress(event)
    if (!address) continue
    const current = candidates.get(address)
    if (!current || event.id < current.id) candidates.set(address, event)
  }
  return Array.from(candidates.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .slice(0, MAX_TARGETED_PUBLICATION_LIFECYCLE_COORDINATES)
    .map(([, event]) => event)
}

export const makeTargetedPublicationLifecycleFilters = (events: TrustedEvent[]): Filter[] => {
  const replacements: Filter[] = []
  const deletions: Filter[] = []

  for (const event of selectTargetedPublicationLifecycleCandidates(events)) {
    const address = getAddressableEventAddress(event)!
    const [, author, ...identifierParts] = address.split(":")
    replacements.push({
      kinds: [TARGETED_PUBLICATION_KIND],
      authors: [author],
      "#d": [identifierParts.join(":")],
      limit: 1,
    })
    deletions.push({kinds: [5], authors: [author], "#a": [address], limit: 1})
  }

  return [...replacements, ...deletions]
}

const makeSourceTag = (source: TargetedPublicationSource, kind: number) => {
  const relay = source.relay ? normalizeCommunityRelay(source.relay) : undefined
  if (source.relay && !relay) throw new Error("Invalid source relay.")
  if (source.type === "a") {
    if (!parseAddress(source.value, kind)) throw new Error("Invalid source address.")
    return relay ? ["a", source.value, relay] : ["a", source.value]
  }
  if (!LOWER_HEX_64.test(source.value)) throw new Error("Invalid source event ID.")
  if (source.pubkey && !parseOwnerPubkey(source.pubkey)) throw new Error("Invalid source author.")
  return source.pubkey
    ? ["e", source.value, relay || "", source.pubkey]
    : relay
      ? ["e", source.value, relay]
      : ["e", source.value]
}

const parseTargetingAddressTag = (tag: string[], role: "source" | "community") => {
  const marked = exactTag(tag, 4) && tag[3] === role
  if (!marked && !exactTag(tag, 2) && !exactTag(tag, 3)) return undefined

  const address = parseAddress(tag[1] || "")
  const relay = tag[2] ? normalizeCommunityRelay(tag[2]) : undefined
  if (!address || (tag[2] && (!relay || relay !== tag[2]))) return undefined

  return {address, ...(relay ? {relay} : {})}
}

const parseTargetingEventTag = (tag: string[]) => {
  const marked = exactTag(tag, 5) && tag[4] === "source"
  if (!marked && !exactTag(tag, 2) && !exactTag(tag, 3) && !exactTag(tag, 4)) {
    return undefined
  }
  if (!LOWER_HEX_64.test(tag[1] || "")) return undefined

  const relay = tag[2] ? normalizeCommunityRelay(tag[2]) : undefined
  const pubkey = tag[3] ? parseOwnerPubkey(tag[3]) : undefined
  if ((tag[2] && (!relay || relay !== tag[2])) || (tag[3] && !pubkey)) return undefined

  return {
    type: "e" as const,
    value: tag[1],
    ...(relay ? {relay} : {}),
    ...(pubkey ? {pubkey} : {}),
  }
}

export const normalizeTargetedPublicationTags = (tags: string[][]) =>
  tags.map(tag => {
    if (exactTag(tag, 4) && tag[0] === "a" && ["source", "community"].includes(tag[3])) {
      return tag[2] ? tag.slice(0, 3) : tag.slice(0, 2)
    }
    if (exactTag(tag, 5) && tag[0] === "e" && tag[4] === "source") {
      if (tag[3]) return tag.slice(0, 4)
      return tag[2] ? tag.slice(0, 3) : tag.slice(0, 2)
    }

    return [...tag]
  })

export const buildTargetedPublication = ({
  id,
  kind,
  source,
  communities,
}: TargetedPublication): TargetedPublicationTemplate => {
  if (!id || !Number.isInteger(kind) || kind < 0 || kind > 65535) {
    throw new Error("Invalid targeted publication.")
  }
  if (communities.length < 1 || communities.length > MAX_TARGET_COMMUNITIES) {
    throw new Error("A targeted publication requires 1 to 12 communities.")
  }

  const tags: string[][] = [["d", id]]
  if (source) tags.push(makeSourceTag(source, kind))
  tags.push(["k", String(kind)])
  const addresses = new Set<string>()
  for (const community of communities) {
    const pointer = makeCommunityPointer({
      ownerPubkey: community.ownerPubkey,
      communityId: community.communityId,
      relayHints: community.relayHints,
    })
    if (!pointer || pointer.address !== community.address || pointer.naddr !== community.naddr) {
      throw new Error("Incoherent community target.")
    }
    if (addresses.has(pointer.address)) throw new Error("Duplicate community target.")
    addresses.add(pointer.address)
    tags.push(["h", pointer.communityId])
    tags.push(
      pointer.relayHints[0]
        ? ["a", pointer.address, pointer.relayHints[0]]
        : ["a", pointer.address],
    )
  }
  return {kind: TARGETED_PUBLICATION_KIND, content: "", tags}
}

export const parseTargetedPublication = (event: TrustedEvent): TargetedPublication | undefined => {
  if (event.kind !== TARGETED_PUBLICATION_KIND || event.content !== "") return undefined
  const tags = event.tags || []
  if (
    tags.some(
      tag =>
        (tag[0] === "a" && tag[3] === "source" && !exactTag(tag, 4)) ||
        (tag[0] === "e" && tag[4] === "source" && !exactTag(tag, 5)) ||
        (tag[0] === "a" && tag[3] === "community" && !exactTag(tag, 4)),
    )
  ) {
    return undefined
  }
  const dTags = getTags(tags, "d")
  const kTags = getTags(tags, "k")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2) || !dTags[0][1]) return undefined
  if (kTags.length !== 1 || !exactTag(kTags[0], 2)) return undefined
  const kind = parseCanonicalKind(kTags[0][1])
  if (kind === undefined) return undefined

  const communities: CommunityPointer[] = []
  const addresses = new Set<string>()
  const communityAddressTagIndexes = new Set<number>()
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag[0] !== "h") continue
    if (!exactTag(tag, 2)) return undefined
    const next = tags[index + 1]
    if (!next || next[0] !== "a") return undefined
    const communityTag = parseTargetingAddressTag(next, "community")
    const id = parseCommunityId(tag[1] || "")
    const addressPointer = communityTag
      ? parseCommunityDefinitionAddress(communityTag.address.address)
      : undefined
    if (!id || !addressPointer || addressPointer.communityId !== id) {
      return undefined
    }
    if (addresses.has(addressPointer.address)) return undefined
    addresses.add(addressPointer.address)
    communities.push(
      makeCommunityPointer({
        ownerPubkey: addressPointer.ownerPubkey,
        communityId: id,
        relayHints: communityTag?.relay ? [communityTag.relay] : [],
      })!,
    )
    communityAddressTagIndexes.add(index + 1)
    index += 1
  }
  if (communities.length < 1 || communities.length > MAX_TARGET_COMMUNITIES) return undefined

  let source: TargetedPublicationSource | undefined
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag[0] === "h" || communityAddressTagIndexes.has(index)) continue
    if (tag[0] === "a") {
      if (source || tag[3] === "community") return undefined
      const sourceTag = parseTargetingAddressTag(tag, "source")
      if (!sourceTag || sourceTag.address.kind !== kind) return undefined
      source = {
        type: "a",
        value: sourceTag.address.address,
        ...(sourceTag.relay ? {relay: sourceTag.relay} : {}),
      }
    } else if (tag[0] === "e") {
      if (source) return undefined
      source = parseTargetingEventTag(tag)
      if (!source) return undefined
    }
  }

  return {id: dTags[0][1], kind, ...(source ? {source} : {}), communities}
}

export const removeTargetedCommunity = (event: TrustedEvent, definitionAddress: string) => {
  const parsed = parseTargetedPublication(event)
  if (!parsed) return undefined
  if (parsed.communities.length === 1) return undefined
  const tags = normalizeTargetedPublicationTags(event.tags)
  const index = tags.findIndex(
    (tag, itemIndex) =>
      tag[0] === "h" &&
      tags[itemIndex + 1]?.[0] === "a" &&
      tags[itemIndex + 1]?.[1] === definitionAddress,
  )
  if (index < 0) return undefined
  tags.splice(index, 2)

  return {kind: TARGETED_PUBLICATION_KIND, content: event.content, tags}
}
