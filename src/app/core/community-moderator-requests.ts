import {BADGE_DEFINITION, DELETE, type EventContent, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  findCommunitySection,
  makeAddress,
  makeCommunityScopedIdentifier,
  normalizePubkey,
  normalizeRelay,
  normalizeRelays,
  type CommunityBadgeRef,
  type CommunityDefinition,
  type CommunityDefinitionSectionInput,
  type CommunityProfileListRef,
} from "@app/core/community"

export const MODERATOR_REQUEST_REACTION_KIND = 7

export type ModeratorRequestTarget = "profile-list" | "badge"

export type ParsedModeratorRequestEvent = {
  event: TrustedEvent
  target: ModeratorRequestTarget
  pubkey: string
  identifier: string
  address: string
  communityAddress: string
  communityPubkey: string
  sectionName: string
}

export type ModeratorPromotionRequest = {
  requesterPubkey: string
  identifier: string
  communityAddress: string
  communityPubkey: string
  sectionName: string
  profileList: ParsedModeratorRequestEvent
  badge: ParsedModeratorRequestEvent
  profileListRef: CommunityProfileListRef
  badgeRef: CommunityBadgeRef
}

export type ModeratorPromotionRequestStatus = "pending" | "accepted" | "rejected"

export type ModeratorPromotionRequestState = ModeratorPromotionRequest & {
  status: ModeratorPromotionRequestStatus
  statusChangedAt: number
  statusEvent?: TrustedEvent
  acceptanceReactions: TrustedEvent[]
  rejectionReactions: TrustedEvent[]
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const parseCommunityDefinitionAddress = (address: string) => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (kind !== COMMUNITY_DEFINITION_KIND || !pubkey || identifier) return undefined

  return {kind, pubkey, address: `${COMMUNITY_DEFINITION_KIND}:${pubkey}:`}
}

const getCommunityAddress = (event: TrustedEvent) =>
  event.tags
    .filter(tag => tag[0] === "a")
    .map(tag => parseCommunityDefinitionAddress(tag[1] || ""))
    .find(Boolean)

const getSectionName = (event: TrustedEvent) =>
  event.tags.find(tag => tag[0] === "content")?.[1]?.trim() || ""

const makeEventAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)
  const pubkey = normalizePubkey(event.pubkey || "")

  return identifier && pubkey ? `${event.kind}:${pubkey}:${identifier}` : ""
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

const selectLatestParsedRequestEvents = (events: ParsedModeratorRequestEvent[]) => {
  const latest = new Map<string, ParsedModeratorRequestEvent>()

  for (const event of events) {
    const current = latest.get(event.address)
    if (isPreferredEvent(event.event, current?.event)) latest.set(event.address, event)
  }

  return Array.from(latest.values())
}

export const makeModeratorRequestIdentifier = ({
  communityPubkey,
  sectionName,
}: {
  communityPubkey: string
  sectionName: string
}) => makeCommunityScopedIdentifier(communityPubkey, `${sectionName}-moderator`)

export const makeCommunityDefinitionAddress = (communityPubkey: string) => {
  const pubkey = normalizePubkey(communityPubkey)

  return pubkey ? `${COMMUNITY_DEFINITION_KIND}:${pubkey}:` : ""
}

export const makeModeratorRequestRefs = ({
  communityPubkey,
  requesterPubkey,
  sectionName,
  relays = [],
}: {
  communityPubkey: string
  requesterPubkey: string
  sectionName: string
  relays?: string[]
}) => {
  const pubkey = normalizePubkey(requesterPubkey)
  const identifier = makeModeratorRequestIdentifier({communityPubkey, sectionName})
  const normalizedRelays = normalizeRelays(relays)
  const profileList: CommunityProfileListRef = {
    kind: PROFILE_LIST_KIND,
    pubkey,
    identifier,
    address: makeAddress(PROFILE_LIST_KIND, pubkey, identifier),
    relay: normalizedRelays[0],
  }
  const badge: CommunityBadgeRef = {
    kind: BADGE_DEFINITION,
    pubkey,
    identifier,
    address: makeAddress(BADGE_DEFINITION, pubkey, identifier),
  }

  return {identifier, profileList, badge}
}

export const makeModeratorProfileListRequest = ({
  communityPubkey,
  requesterPubkey,
  sectionName,
  relays = [],
}: {
  communityPubkey: string
  requesterPubkey: string
  sectionName: string
  relays?: string[]
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => {
  const {identifier} = makeModeratorRequestRefs({
    communityPubkey,
    requesterPubkey,
    sectionName,
    relays,
  })
  const communityAddress = makeCommunityDefinitionAddress(communityPubkey)
  const relay = normalizeRelay(relays[0])

  return {
    kind: PROFILE_LIST_KIND,
    content: "",
    tags: [
      ["d", identifier],
      relay ? ["a", communityAddress, relay] : ["a", communityAddress],
      ["content", sectionName],
    ],
  }
}

export const makeModeratorBadgeRequest = ({
  communityPubkey,
  requesterPubkey,
  sectionName,
  relays = [],
}: {
  communityPubkey: string
  requesterPubkey: string
  sectionName: string
  relays?: string[]
}): EventContent & {kind: typeof BADGE_DEFINITION} => {
  const {identifier} = makeModeratorRequestRefs({
    communityPubkey,
    requesterPubkey,
    sectionName,
    relays,
  })
  const communityAddress = makeCommunityDefinitionAddress(communityPubkey)
  const relay = normalizeRelay(relays[0])

  return {
    kind: BADGE_DEFINITION,
    content: "",
    tags: [
      ["d", identifier],
      relay ? ["a", communityAddress, relay] : ["a", communityAddress],
      ["content", sectionName],
      ["name", `${sectionName} moderator`],
      ["description", `Can moderate access for the ${sectionName} section.`],
    ],
  }
}

export const parseModeratorRequestEvent = (
  event: TrustedEvent,
  communityPubkey?: string,
): ParsedModeratorRequestEvent | undefined => {
  if (event.kind !== PROFILE_LIST_KIND && event.kind !== BADGE_DEFINITION) return undefined

  const pubkey = normalizePubkey(event.pubkey || "")
  const identifier = getDTag(event)
  const address = makeEventAddress(event)
  const community = getCommunityAddress(event)
  const sectionName = getSectionName(event)

  if (!pubkey || !identifier || !address || !community || !sectionName) return undefined
  if (communityPubkey && community.pubkey !== normalizePubkey(communityPubkey)) return undefined

  return {
    event,
    target: event.kind === PROFILE_LIST_KIND ? "profile-list" : "badge",
    pubkey,
    identifier,
    address,
    communityAddress: community.address,
    communityPubkey: community.pubkey,
    sectionName,
  }
}

export const getModeratorPromotionRequests = ({
  profileListEvents,
  badgeEvents,
  communityPubkey,
}: {
  profileListEvents: TrustedEvent[]
  badgeEvents: TrustedEvent[]
  communityPubkey: string
}): ModeratorPromotionRequest[] => {
  const lists = selectLatestParsedRequestEvents(
    profileListEvents
      .map(event => parseModeratorRequestEvent(event, communityPubkey))
      .filter((event): event is ParsedModeratorRequestEvent => Boolean(event))
      .filter(event => event.target === "profile-list"),
  )
  const badges = selectLatestParsedRequestEvents(
    badgeEvents
      .map(event => parseModeratorRequestEvent(event, communityPubkey))
      .filter((event): event is ParsedModeratorRequestEvent => Boolean(event))
      .filter(event => event.target === "badge"),
  )
  const badgesByKey = new Map(
    badges.map(badge => [`${badge.pubkey}:${badge.sectionName}:${badge.identifier}`, badge]),
  )
  const requests: ModeratorPromotionRequest[] = []

  for (const profileList of lists) {
    const badge = badgesByKey.get(
      `${profileList.pubkey}:${profileList.sectionName}:${profileList.identifier}`,
    )
    if (!badge) continue

    requests.push({
      requesterPubkey: profileList.pubkey,
      identifier: profileList.identifier,
      communityAddress: profileList.communityAddress,
      communityPubkey: profileList.communityPubkey,
      sectionName: profileList.sectionName,
      profileList,
      badge,
      profileListRef: {
        kind: PROFILE_LIST_KIND,
        pubkey: profileList.pubkey,
        identifier: profileList.identifier,
        address: profileList.address,
        relay: normalizeRelay(profileList.event.tags.find(tag => tag[0] === "a")?.[2]),
      },
      badgeRef: {
        kind: BADGE_DEFINITION,
        pubkey: badge.pubkey,
        identifier: badge.identifier,
        address: badge.address,
      },
    })
  }

  return requests
}

const hasSectionRef = (definition: CommunityDefinition, request: ModeratorPromotionRequest) => {
  const section = findCommunitySection(definition, request.sectionName)

  return Boolean(
    section?.profileLists.some(ref => ref.address === request.profileListRef.address) &&
    section.badges.some(ref => ref.address === request.badgeRef.address),
  )
}

const isReactionDeleted = (reaction: TrustedEvent, deleteEvents: TrustedEvent[]) =>
  deleteEvents.some(event => {
    if (event.kind !== DELETE) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(reaction.pubkey || "")) return false
    if (!event.tags.some(tag => tag[0] === "e" && tag[1] === reaction.id)) return false

    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return kindTags.length === 0 || kindTags.some(tag => tag[1] === String(reaction.kind))
  })

const getActiveTargetReactions = ({
  targetEventId,
  communityPubkey,
  content,
  reactionEvents,
  deleteEvents,
}: {
  targetEventId: string
  communityPubkey: string
  content: "+" | "-"
  reactionEvents: TrustedEvent[]
  deleteEvents: TrustedEvent[]
}) =>
  reactionEvents.filter(
    event =>
      event.kind === MODERATOR_REQUEST_REACTION_KIND &&
      event.content === content &&
      normalizePubkey(event.pubkey || "") === normalizePubkey(communityPubkey) &&
      event.tags.some(tag => tag[0] === "e" && tag[1] === targetEventId) &&
      !isReactionDeleted(event, deleteEvents),
  )

const getLatestEvent = (events: TrustedEvent[]) => {
  let latest: TrustedEvent | undefined

  for (const event of events) {
    if (!latest || isPreferredEvent(event, latest)) latest = event
  }

  return latest
}

export const getModeratorPromotionRequestStates = ({
  definition,
  requests,
  reactionEvents = [],
  deleteEvents = [],
}: {
  definition: CommunityDefinition
  requests: ModeratorPromotionRequest[]
  reactionEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
}): ModeratorPromotionRequestState[] =>
  requests.map(request => {
    const acceptedListReactions = getActiveTargetReactions({
      targetEventId: request.profileList.event.id,
      communityPubkey: definition.pubkey,
      content: "+",
      reactionEvents,
      deleteEvents,
    })
    const acceptedBadgeReactions = getActiveTargetReactions({
      targetEventId: request.badge.event.id,
      communityPubkey: definition.pubkey,
      content: "+",
      reactionEvents,
      deleteEvents,
    })
    const rejectedListReactions = getActiveTargetReactions({
      targetEventId: request.profileList.event.id,
      communityPubkey: definition.pubkey,
      content: "-",
      reactionEvents,
      deleteEvents,
    })
    const rejectedBadgeReactions = getActiveTargetReactions({
      targetEventId: request.badge.event.id,
      communityPubkey: definition.pubkey,
      content: "-",
      reactionEvents,
      deleteEvents,
    })
    const acceptanceReactions = [...acceptedListReactions, ...acceptedBadgeReactions]
    const rejectionReactions = [...rejectedListReactions, ...rejectedBadgeReactions]
    const accepted = hasSectionRef(definition, request)
    const rejected = rejectedListReactions.length > 0 && rejectedBadgeReactions.length > 0
    const statusEvent = accepted
      ? definition.event
      : rejected
        ? getLatestEvent([...rejectedListReactions, ...rejectedBadgeReactions])
        : getLatestEvent([request.profileList.event, request.badge.event])

    return {
      ...request,
      acceptanceReactions,
      rejectionReactions,
      status: accepted ? "accepted" : rejected ? "rejected" : "pending",
      statusChangedAt: statusEvent?.created_at || 0,
      statusEvent,
    }
  })

export const makeModeratorRequestReaction = ({
  request,
  target,
  content,
}: {
  request: ModeratorPromotionRequest
  target: ParsedModeratorRequestEvent
  content: "+" | "-"
}): EventContent & {kind: typeof MODERATOR_REQUEST_REACTION_KIND} => ({
  kind: MODERATOR_REQUEST_REACTION_KIND,
  content,
  tags: [
    ["e", target.event.id],
    ["p", request.requesterPubkey],
    ["k", String(target.event.kind)],
    ["a", request.communityAddress],
    ["content", request.sectionName],
  ],
})

export const makeModeratorRequestReactionDelete = ({
  reactionId,
}: {
  reactionId: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: "Deleted moderator request review",
  tags: [
    ["e", reactionId],
    ["k", String(MODERATOR_REQUEST_REACTION_KIND)],
  ],
})

export const makeModeratorPromotionDefinitionUpdate = ({
  definition,
  request,
}: {
  definition: CommunityDefinition
  request: ModeratorPromotionRequest
}): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const sections: CommunityDefinitionSectionInput[] = definition.sections.map(section => {
    if (section.name !== request.sectionName) {
      return {
        name: section.name,
        kinds: section.kinds,
        profileLists: section.profileLists,
        badges: section.badges,
        retention: section.retention,
      }
    }

    const profileLists = section.profileLists.some(
      ref => ref.address === request.profileListRef.address,
    )
      ? section.profileLists
      : [...section.profileLists, request.profileListRef]
    const badges = section.badges.some(ref => ref.address === request.badgeRef.address)
      ? section.badges
      : [...section.badges, request.badgeRef]

    return {
      name: section.name,
      kinds: section.kinds,
      profileLists,
      badges,
      retention: section.retention,
    }
  })

  return buildCommunityDefinition({
    relays: definition.relays,
    sections,
    description: definition.description,
    blossomServers: definition.blossomServers,
    mints: definition.mints,
    tos: definition.tos,
    location: definition.location,
    geohash: definition.geohash,
  })
}

export const makeModeratorGrantRevokeDefinitionUpdate = ({
  definition,
  sectionName,
  moderatorPubkey,
}: {
  definition: CommunityDefinition
  sectionName: string
  moderatorPubkey: string
}): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const pubkey = normalizePubkey(moderatorPubkey)
  const sections: CommunityDefinitionSectionInput[] = definition.sections.map(section => {
    if (section.name !== sectionName || !pubkey) {
      return {
        name: section.name,
        kinds: section.kinds,
        profileLists: section.profileLists,
        badges: section.badges,
        retention: section.retention,
      }
    }

    return {
      name: section.name,
      kinds: section.kinds,
      profileLists: section.profileLists.filter(ref => normalizePubkey(ref.pubkey) !== pubkey),
      badges: section.badges.filter(ref => normalizePubkey(ref.pubkey) !== pubkey),
      retention: section.retention,
    }
  })

  return buildCommunityDefinition({
    relays: definition.relays,
    sections,
    description: definition.description,
    blossomServers: definition.blossomServers,
    mints: definition.mints,
    tos: definition.tos,
    location: definition.location,
    geohash: definition.geohash,
  })
}
