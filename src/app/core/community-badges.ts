import {
  BADGE_AWARD,
  BADGE_DEFINITION,
  BADGES,
  DELETE,
  type EventContent,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  makeAddress,
  normalizePubkey,
  type CommunityDefinition,
} from "@app/core/community"
import {getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"

export const PROFILE_BADGES_KIND = 10008
export const PROFILE_BADGES_DEPRECATED_IDENTIFIER = "profile_badges"

export type CommunityBadgeThumb = {
  url: string
  dimensions?: string
}

export type CommunityBadgeDefinition = {
  event: TrustedEvent
  address: string
  pubkey: string
  identifier: string
  name: string
  description?: string
  image?: string
  imageDimensions?: string
  thumbs: CommunityBadgeThumb[]
  deprecated: boolean
  communityAddress?: string
  communityPubkey?: string
}

export type CommunityBadgeAward = {
  event: TrustedEvent
  definitionAddress: string
  recipientPubkey: string
}

export type ProfileBadgePair = {
  definitionAddress: string
  definitionRelay?: string
  awardId: string
  awardRelay?: string
}

export type AcceptedCommunityBadge = {
  definition: CommunityBadgeDefinition
  award: CommunityBadgeAward
  profilePair: ProfileBadgePair
}

export type PendingCommunityBadgeAward = {
  definition: CommunityBadgeDefinition
  award: CommunityBadgeAward
}

const getTagValue = (event: TrustedEvent, tagName: string) =>
  event.tags.find(tag => tag[0] === tagName)?.[1]?.trim() || ""

const makeCommunityDefinitionAddress = (communityPubkey: string) => {
  const pubkey = normalizePubkey(communityPubkey)

  return pubkey ? `${COMMUNITY_DEFINITION_KIND}:${pubkey}:` : ""
}

const parseCommunityDefinitionAddress = (address: string) => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (kind !== COMMUNITY_DEFINITION_KIND || !pubkey || identifier) return undefined

  return {pubkey, address: `${COMMUNITY_DEFINITION_KIND}:${pubkey}:`}
}

const getEventAddress = (event: TrustedEvent) => {
  const identifier = getTagValue(event, "d")

  return identifier ? makeAddress(event.kind, event.pubkey, identifier) : ""
}

const parseBadgeDefinitionAddress = (address: string) => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (kind !== BADGE_DEFINITION || !pubkey || !identifier) return undefined

  return {kind, pubkey, identifier, address: `${BADGE_DEFINITION}:${pubkey}:${identifier}`}
}

const appendDefined = (base: string[], ...values: Array<string | undefined>) => {
  for (const value of values) {
    if (value) base.push(value)
  }

  return base
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const hasKindTag = (event: TrustedEvent, kind: number) => {
  const kindTags = event.tags.filter(tag => tag[0] === "k")

  return kindTags.length === 0 || kindTags.some(tag => tag[1] === String(kind))
}

export const makeCommunityBadgeIdentifier = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "badge"

const parseImageDimensions = (dimensions?: string) => {
  const match = dimensions?.match(/^(\d+)x(\d+)$/)
  if (!match) return undefined

  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)

  return Number.isFinite(width) && Number.isFinite(height) ? {width, height} : undefined
}

export const getCommunityBadgeImageUrl = (
  definition: Pick<CommunityBadgeDefinition, "image" | "thumbs">,
  preferredSize = 64,
) => {
  const thumbs = definition.thumbs
    .flatMap(thumb => {
      const dimensions = parseImageDimensions(thumb.dimensions)

      return dimensions
        ? [{url: thumb.url, size: Math.max(dimensions.width, dimensions.height)}]
        : []
    })
    .toSorted((a, b) => a.size - b.size)
  const largerThumb = thumbs.find(thumb => thumb.size >= preferredSize)

  return largerThumb?.url || thumbs.at(-1)?.url || definition.image || ""
}

export const getCommunityBadgeCreatorPubkeys = ({
  definition,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) =>
  unique([
    normalizePubkey(definition.pubkey),
    ...definition.sections.flatMap(section =>
      getGrantCapableSectionModeratorPubkeys({
        definition,
        sectionName: section.name,
        profileListEvents,
        reportState,
      }),
    ),
  ])

export const canCreateCommunityBadge = ({
  definition,
  pubkey,
  profileListEvents,
  reportState,
}: {
  definition: CommunityDefinition
  pubkey: string
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}) => {
  const normalized = normalizePubkey(pubkey)

  return Boolean(
    normalized &&
      getCommunityBadgeCreatorPubkeys({definition, profileListEvents, reportState}).includes(
        normalized,
      ),
  )
}

export const makeCommunityBadgeDefinitionEvent = ({
  communityPubkey,
  identifier,
  name,
  description,
  image,
  imageDimensions,
  thumbs = [],
  deprecated = false,
}: {
  communityPubkey: string
  identifier: string
  name?: string
  description?: string
  image?: string
  imageDimensions?: string
  thumbs?: CommunityBadgeThumb[]
  deprecated?: boolean
}): EventContent & {kind: typeof BADGE_DEFINITION} => {
  const communityAddress = makeCommunityDefinitionAddress(communityPubkey)
  const id = identifier.trim()
  const tags: string[][] = [
    ["d", id],
    ["name", name?.trim() || id],
    ["a", communityAddress],
    ["h", normalizePubkey(communityPubkey)],
  ]

  if (description?.trim()) tags.push(["description", description.trim()])
  if (image?.trim()) tags.push(appendDefined(["image", image.trim()], imageDimensions?.trim()))
  for (const thumb of thumbs) {
    if (thumb.url.trim()) tags.push(appendDefined(["thumb", thumb.url.trim()], thumb.dimensions))
  }
  if (deprecated) tags.push(["deprecated"])

  return {kind: BADGE_DEFINITION, content: "", tags}
}

export const makeCommunityBadgeAwardDelete = ({
  awardId,
}: {
  awardId: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: "Deleted community badge award",
  tags: [
    ["e", awardId],
    ["k", String(BADGE_AWARD)],
  ],
})

export const makeCommunityBadgeAwardEvent = ({
  definitionAddress,
  recipientPubkey,
}: {
  definitionAddress: string
  recipientPubkey: string
}): EventContent & {kind: typeof BADGE_AWARD} => {
  const pubkey = normalizePubkey(recipientPubkey)

  return {
    kind: BADGE_AWARD,
    content: "",
    tags: [["a", definitionAddress], ...(pubkey ? [["p", pubkey]] : [])],
  }
}

export const makeProfileBadgesEvent = ({
  pairs,
  extraTags = [],
}: {
  pairs: ProfileBadgePair[]
  extraTags?: string[][]
}): EventContent & {kind: typeof PROFILE_BADGES_KIND} => ({
  kind: PROFILE_BADGES_KIND,
  content: "",
  tags: [
    ...pairs.flatMap(pair => [
      appendDefined(["a", pair.definitionAddress], pair.definitionRelay),
      appendDefined(["e", pair.awardId], pair.awardRelay),
    ]),
    ...extraTags,
  ],
})

export const parseCommunityBadgeDefinition = (
  event: TrustedEvent,
  communityPubkey?: string,
): CommunityBadgeDefinition | undefined => {
  if (event.kind !== BADGE_DEFINITION) return undefined

  const pubkey = normalizePubkey(event.pubkey || "")
  const identifier = getTagValue(event, "d")
  if (!pubkey || !identifier) return undefined

  const address = getEventAddress(event)
  const communityAddress = event.tags
    .filter(tag => tag[0] === "a")
    .map(tag => parseCommunityDefinitionAddress(tag[1] || ""))
    .find(Boolean)
  const scopedCommunityPubkey = normalizePubkey(getTagValue(event, "h")) || communityAddress?.pubkey
  const expectedCommunityPubkey = normalizePubkey(communityPubkey || "")

  if (expectedCommunityPubkey && scopedCommunityPubkey !== expectedCommunityPubkey) return undefined

  const imageTag = event.tags.find(tag => tag[0] === "image")

  return {
    event,
    address,
    pubkey,
    identifier,
    name: getTagValue(event, "name") || identifier,
    description: getTagValue(event, "description") || undefined,
    image: imageTag?.[1]?.trim() || undefined,
    imageDimensions: imageTag?.[2]?.trim() || undefined,
    thumbs: event.tags
      .filter(tag => tag[0] === "thumb" && tag[1]?.trim())
      .map(tag => ({url: tag[1].trim(), dimensions: tag[2]?.trim() || undefined})),
    deprecated: event.tags.some(tag => tag[0] === "deprecated"),
    communityAddress: communityAddress?.address,
    communityPubkey: scopedCommunityPubkey || undefined,
  }
}

export const parseCommunityBadgeAward = (event: TrustedEvent): CommunityBadgeAward | undefined => {
  if (event.kind !== BADGE_AWARD) return undefined

  const definitionAddress = event.tags.find(tag => tag[0] === "a")?.[1] || ""
  const parsedDefinition = parseBadgeDefinitionAddress(definitionAddress)
  if (!parsedDefinition) return undefined

  const recipientPubkeys = unique(
    event.tags.filter(tag => tag[0] === "p").map(tag => normalizePubkey(tag[1] || "")),
  )
  if (recipientPubkeys.length !== 1) return undefined

  return {event, definitionAddress: parsedDefinition.address, recipientPubkey: recipientPubkeys[0]}
}

export const isCommunityBadgeAwardDeleted = (award: TrustedEvent, deleteEvents: TrustedEvent[]) =>
  deleteEvents.some(event => {
    if (event.kind !== DELETE) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(award.pubkey || "")) return false
    if (!event.tags.some(tag => tag[0] === "e" && tag[1] === award.id)) return false

    return hasKindTag(event, BADGE_AWARD)
  })

export const isProfileBadgesEvent = (event: TrustedEvent) =>
  event.kind === PROFILE_BADGES_KIND ||
  (event.kind === BADGES && getTagValue(event, "d") === PROFILE_BADGES_DEPRECATED_IDENTIFIER)

export const parseProfileBadgePairs = (event: TrustedEvent): ProfileBadgePair[] => {
  if (!isProfileBadgesEvent(event)) return []

  const pairs: ProfileBadgePair[] = []

  for (let index = 0; index < event.tags.length - 1; index += 1) {
    const definitionTag = event.tags[index]
    const awardTag = event.tags[index + 1]

    if (definitionTag[0] !== "a" || awardTag[0] !== "e") continue
    const parsedDefinition = parseBadgeDefinitionAddress(definitionTag[1] || "")
    if (!parsedDefinition || !awardTag[1]) continue

    pairs.push({
      definitionAddress: parsedDefinition.address,
      definitionRelay: definitionTag[2] || undefined,
      awardId: awardTag[1],
      awardRelay: awardTag[2] || undefined,
    })
    index += 1
  }

  return pairs
}

export const selectProfileBadgesEvent = (
  events: TrustedEvent[],
  profilePubkey: string,
): TrustedEvent | undefined => {
  const normalizedProfilePubkey = normalizePubkey(profilePubkey)

  return events
    .filter(isProfileBadgesEvent)
    .filter(event => normalizePubkey(event.pubkey || "") === normalizedProfilePubkey)
    .toSorted((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
}

const isPairTagIndex = (tags: string[][], index: number) => {
  const tag = tags[index]
  const nextTag = tags[index + 1]
  const previousTag = tags[index - 1]

  return Boolean(
    (tag[0] === "a" && nextTag?.[0] === "e") || (tag[0] === "e" && previousTag?.[0] === "a"),
  )
}

export const makeProfileBadgeAcceptanceEvent = ({
  currentEvent,
  pair,
}: {
  currentEvent?: TrustedEvent
  pair: ProfileBadgePair
}): EventContent & {kind: typeof PROFILE_BADGES_KIND} => {
  const pairs = currentEvent ? parseProfileBadgePairs(currentEvent) : []
  const alreadyAccepted = pairs.some(
    existing =>
      existing.definitionAddress === pair.definitionAddress && existing.awardId === pair.awardId,
  )
  const extraTags = (currentEvent?.tags || []).filter((tag, index, tags) => {
    if (tag[0] === "d" && tag[1] === PROFILE_BADGES_DEPRECATED_IDENTIFIER) return false

    return !isPairTagIndex(tags, index)
  })

  return makeProfileBadgesEvent({
    pairs: alreadyAccepted ? pairs : [...pairs, pair],
    extraTags,
  })
}

export const makeProfileBadgeRemovalEvent = ({
  currentEvent,
  pair,
}: {
  currentEvent?: TrustedEvent
  pair: ProfileBadgePair
}): EventContent & {kind: typeof PROFILE_BADGES_KIND} => {
  const pairs = currentEvent
    ? parseProfileBadgePairs(currentEvent).filter(
        existing =>
          existing.definitionAddress !== pair.definitionAddress ||
          existing.awardId !== pair.awardId,
      )
    : []
  const extraTags = (currentEvent?.tags || []).filter((tag, index, tags) => {
    if (tag[0] === "d" && tag[1] === PROFILE_BADGES_DEPRECATED_IDENTIFIER) return false

    return !isPairTagIndex(tags, index)
  })

  return makeProfileBadgesEvent({pairs, extraTags})
}

export const makeCommunityBadgeDefinitionFilters = ({
  definition,
  profileListEvents,
  reportState,
  limit = 200,
}: {
  definition: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  limit?: number
}): Filter[] => {
  const authors = getCommunityBadgeCreatorPubkeys({definition, profileListEvents, reportState})
  const communityAddress = makeCommunityDefinitionAddress(definition.pubkey)

  return authors.length && communityAddress
    ? [{kinds: [BADGE_DEFINITION], authors, "#a": [communityAddress], limit}]
    : []
}

export const makeCommunityBadgeAwardFilters = ({
  definitions,
  recipientPubkey,
  limit = 500,
}: {
  definitions: CommunityBadgeDefinition[]
  recipientPubkey?: string
  limit?: number
}): Filter[] => {
  const addresses = unique(definitions.map(definition => definition.address))
  const recipient = normalizePubkey(recipientPubkey || "")

  return addresses.length
    ? [
        {
          kinds: [BADGE_AWARD],
          "#a": addresses,
          ...(recipient ? {"#p": [recipient]} : {}),
          limit,
        },
      ]
    : []
}

export const makeCommunityBadgeAwardDeleteFilters = (awardEvents: TrustedEvent[]): Filter[] => {
  const awardIds = unique(awardEvents.map(event => event.id).filter(Boolean))

  return awardIds.length ? [{kinds: [DELETE], "#e": awardIds}] : []
}

export const makeProfileBadgeFilters = (profilePubkey: string): Filter[] => {
  const author = normalizePubkey(profilePubkey)
  if (!author) return []

  return [
    {kinds: [PROFILE_BADGES_KIND], authors: [author], limit: 1},
    {
      kinds: [BADGES],
      authors: [author],
      "#d": [PROFILE_BADGES_DEPRECATED_IDENTIFIER],
      limit: 1,
    },
  ]
}

const getTrustedDefinitionsByAddress = ({
  definition,
  badgeDefinitionEvents,
  profileListEvents,
  reportState,
  includeDeprecated = false,
}: {
  definition: CommunityDefinition
  badgeDefinitionEvents: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  includeDeprecated?: boolean
}) => {
  const creators = new Set(
    getCommunityBadgeCreatorPubkeys({definition, profileListEvents, reportState}),
  )
  const definitions = new Map<string, CommunityBadgeDefinition>()

  for (const event of badgeDefinitionEvents) {
    const badgeDefinition = parseCommunityBadgeDefinition(event, definition.pubkey)
    if (!badgeDefinition || !creators.has(badgeDefinition.pubkey)) continue

    const current = definitions.get(badgeDefinition.address)
    if (
      !current ||
      badgeDefinition.event.created_at > current.event.created_at ||
      (badgeDefinition.event.created_at === current.event.created_at &&
        badgeDefinition.event.id < current.event.id)
    ) {
      definitions.set(badgeDefinition.address, badgeDefinition)
    }
  }

  if (includeDeprecated) return definitions

  return new Map(
    Array.from(definitions.entries()).filter(([, badgeDefinition]) => !badgeDefinition.deprecated),
  )
}

export const selectCommunityBadgeDefinitions = ({
  definition,
  badgeDefinitionEvents,
  profileListEvents,
  reportState,
  includeDeprecated = false,
}: {
  definition: CommunityDefinition
  badgeDefinitionEvents: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  includeDeprecated?: boolean
}): CommunityBadgeDefinition[] =>
  Array.from(
    getTrustedDefinitionsByAddress({
      definition,
      badgeDefinitionEvents,
      profileListEvents,
      reportState,
      includeDeprecated,
    }).values(),
  ).toSorted((a, b) => b.event.created_at - a.event.created_at || a.name.localeCompare(b.name))

const getAwardsById = ({
  awards,
  definitionsByAddress,
  profilePubkey,
}: {
  awards: CommunityBadgeAward[]
  definitionsByAddress: Map<string, CommunityBadgeDefinition>
  profilePubkey?: string
}) => {
  const recipient = normalizePubkey(profilePubkey || "")
  const awardsById = new Map<string, CommunityBadgeAward>()

  for (const award of awards) {
    const badgeDefinition = definitionsByAddress.get(award.definitionAddress)
    if (!badgeDefinition) continue
    if (normalizePubkey(award.event.pubkey || "") !== badgeDefinition.pubkey) continue
    if (recipient && award.recipientPubkey !== recipient) continue

    awardsById.set(award.event.id, award)
  }

  return awardsById
}

export const getCommunityBadgeAward = ({
  definition,
  badgeAwardEvents,
  badgeAwardDeleteEvents = [],
  profilePubkey,
}: {
  definition: CommunityBadgeDefinition
  badgeAwardEvents: TrustedEvent[]
  badgeAwardDeleteEvents?: TrustedEvent[]
  profilePubkey: string
}): CommunityBadgeAward | undefined => {
  const recipient = normalizePubkey(profilePubkey)
  if (!recipient) return undefined

  return badgeAwardEvents
    .filter(event => !isCommunityBadgeAwardDeleted(event, badgeAwardDeleteEvents))
    .map(parseCommunityBadgeAward)
    .filter((award): award is CommunityBadgeAward => Boolean(award))
    .filter(
      award =>
        award.definitionAddress === definition.address &&
        award.recipientPubkey === recipient &&
        normalizePubkey(award.event.pubkey || "") === definition.pubkey,
    )
    .toSorted((a, b) => b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id))[0]
}

export const getAcceptedCommunityBadges = ({
  definition,
  badgeDefinitionEvents,
  profileListEvents,
  badgeAwardEvents,
  badgeAwardDeleteEvents = [],
  profileBadgeEvents,
  profilePubkey,
  reportState,
}: {
  definition: CommunityDefinition
  badgeDefinitionEvents: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  badgeAwardEvents: TrustedEvent[]
  badgeAwardDeleteEvents?: TrustedEvent[]
  profileBadgeEvents: TrustedEvent[]
  profilePubkey: string
  reportState?: EffectiveCommunityReportState
}): AcceptedCommunityBadge[] => {
  const profileBadgesEvent = selectProfileBadgesEvent(profileBadgeEvents, profilePubkey)
  if (!profileBadgesEvent) return []

  const definitionsByAddress = getTrustedDefinitionsByAddress({
    definition,
    badgeDefinitionEvents,
    profileListEvents,
    reportState,
  })
  const awards = badgeAwardEvents
    .filter(event => !isCommunityBadgeAwardDeleted(event, badgeAwardDeleteEvents))
    .map(parseCommunityBadgeAward)
    .filter((award): award is CommunityBadgeAward => Boolean(award))
  const awardsById = getAwardsById({awards, definitionsByAddress, profilePubkey})

  return parseProfileBadgePairs(profileBadgesEvent).flatMap(profilePair => {
    const badgeDefinition = definitionsByAddress.get(profilePair.definitionAddress)
    const award = awardsById.get(profilePair.awardId)

    return badgeDefinition && award && award.definitionAddress === badgeDefinition.address
      ? [{definition: badgeDefinition, award, profilePair}]
      : []
  })
}

export const getPendingCommunityBadgeAwards = ({
  definition,
  badgeDefinitionEvents,
  profileListEvents,
  badgeAwardEvents,
  badgeAwardDeleteEvents = [],
  profileBadgeEvents,
  profilePubkey,
  reportState,
}: {
  definition: CommunityDefinition
  badgeDefinitionEvents: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  badgeAwardEvents: TrustedEvent[]
  badgeAwardDeleteEvents?: TrustedEvent[]
  profileBadgeEvents: TrustedEvent[]
  profilePubkey: string
  reportState?: EffectiveCommunityReportState
}): PendingCommunityBadgeAward[] => {
  const definitionsByAddress = getTrustedDefinitionsByAddress({
    definition,
    badgeDefinitionEvents,
    profileListEvents,
    reportState,
  })
  const accepted = new Set(
    getAcceptedCommunityBadges({
      definition,
      badgeDefinitionEvents,
      profileListEvents,
      badgeAwardEvents,
      badgeAwardDeleteEvents,
      profileBadgeEvents,
      profilePubkey,
      reportState,
    }).map(badge => badge.award.event.id),
  )
  const awards = badgeAwardEvents
    .filter(event => !isCommunityBadgeAwardDeleted(event, badgeAwardDeleteEvents))
    .map(parseCommunityBadgeAward)
    .filter((award): award is CommunityBadgeAward => Boolean(award))
  const awardsById = getAwardsById({awards, definitionsByAddress, profilePubkey})

  return Array.from(awardsById.values())
    .filter(award => !accepted.has(award.event.id))
    .map(award => ({definition: definitionsByAddress.get(award.definitionAddress)!, award}))
    .toSorted(
      (a, b) =>
        b.award.event.created_at - a.award.event.created_at ||
        a.award.event.id.localeCompare(b.award.event.id),
    )
}
