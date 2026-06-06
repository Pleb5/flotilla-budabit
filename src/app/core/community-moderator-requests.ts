import {DELETE, type EventContent, type TrustedEvent} from "@welshman/util"
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
  type CommunityDefinition,
  type CommunityDefinitionSectionInput,
  type CommunityProfileListRef,
} from "@app/core/community"

export const MODERATOR_REQUEST_REACTION_KIND = 7

export type ParsedModeratorRequestEvent = {
  event: TrustedEvent
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
  profileListRef: CommunityProfileListRef
}

export type ModeratorPromotionRequestStatus = "pending" | "accepted" | "rejected"

export type ModeratorPromotionRequestState = ModeratorPromotionRequest & {
  status: ModeratorPromotionRequestStatus
  statusChangedAt: number
  statusEvent?: TrustedEvent
  acceptanceReactions: TrustedEvent[]
  rejectionReactions: TrustedEvent[]
  derivedFromGrant?: boolean
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

  return {identifier, profileList}
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

export const parseModeratorRequestEvent = (
  event: TrustedEvent,
  communityPubkey?: string,
): ParsedModeratorRequestEvent | undefined => {
  if (event.kind !== PROFILE_LIST_KIND) return undefined

  const pubkey = normalizePubkey(event.pubkey || "")
  const identifier = getDTag(event)
  const address = makeEventAddress(event)
  const community = getCommunityAddress(event)
  const sectionName = getSectionName(event)

  if (!pubkey || !identifier || !address || !community || !sectionName) return undefined
  if (communityPubkey && community.pubkey !== normalizePubkey(communityPubkey)) return undefined

  return {
    event,
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
  communityPubkey,
}: {
  profileListEvents: TrustedEvent[]
  communityPubkey: string
}): ModeratorPromotionRequest[] => {
  const lists = selectLatestParsedRequestEvents(
    profileListEvents
      .map(event => parseModeratorRequestEvent(event, communityPubkey))
      .filter((event): event is ParsedModeratorRequestEvent => Boolean(event)),
  )

  return lists.map(profileList => ({
    requesterPubkey: profileList.pubkey,
    identifier: profileList.identifier,
    communityAddress: profileList.communityAddress,
    communityPubkey: profileList.communityPubkey,
    sectionName: profileList.sectionName,
    profileList,
    profileListRef: {
      kind: PROFILE_LIST_KIND,
      pubkey: profileList.pubkey,
      identifier: profileList.identifier,
      address: profileList.address,
      relay: normalizeRelay(profileList.event.tags.find(tag => tag[0] === "a")?.[2]),
    },
  }))
}

const hasSectionRef = (definition: CommunityDefinition, request: ModeratorPromotionRequest) => {
  const section = findCommunitySection(definition, request.sectionName)

  return Boolean(
    section?.profileLists.some(ref => ref.address === request.profileListRef.address),
  )
}

const makeGrantDerivedRequestEvent = ({
  definition,
  sectionName,
  ref,
}: {
  definition: CommunityDefinition
  sectionName: string
  ref: CommunityProfileListRef
}): ParsedModeratorRequestEvent => {
  const communityAddress = makeCommunityDefinitionAddress(definition.pubkey)
  const relay = normalizeRelay(ref.relay)
  const event = {
    ...definition.event,
    id: `grant:${ref.address}`,
    pubkey: ref.pubkey,
    kind: ref.kind,
    content: "",
    tags: [
      ["d", ref.identifier],
      relay ? ["a", communityAddress, relay] : ["a", communityAddress],
      ["content", sectionName],
    ],
  } as TrustedEvent

  return {
    event,
    pubkey: normalizePubkey(ref.pubkey),
    identifier: ref.identifier,
    address: ref.address,
    communityAddress,
    communityPubkey: normalizePubkey(definition.pubkey),
    sectionName,
  }
}

const getGrantDerivedModeratorRequestStates = (
  definition: CommunityDefinition,
  requestStates: ModeratorPromotionRequestState[],
): ModeratorPromotionRequestState[] => {
  const communityOwner = normalizePubkey(definition.pubkey)
  const acceptedKeys = new Set(
    requestStates
      .filter(request => request.status === "accepted")
      .map(request => `${request.requesterPubkey}:${request.sectionName}`),
  )
  const states: ModeratorPromotionRequestState[] = []

  for (const section of definition.sections) {
    const profileListsByPubkey = new Map<string, CommunityProfileListRef[]>()

    for (const ref of section.profileLists) {
      const pubkey = normalizePubkey(ref.pubkey)
      if (!pubkey || pubkey === communityOwner) continue

      profileListsByPubkey.set(pubkey, [...(profileListsByPubkey.get(pubkey) || []), ref])
    }

    for (const [requesterPubkey, profileLists] of profileListsByPubkey) {
      const profileListRef = profileLists[0]
      if (!profileListRef) continue
      if (acceptedKeys.has(`${requesterPubkey}:${section.name}`)) continue

      const profileList = makeGrantDerivedRequestEvent({
        definition,
        sectionName: section.name,
        ref: profileListRef,
      })

      states.push({
        requesterPubkey,
        identifier: profileListRef.identifier,
        communityAddress: profileList.communityAddress,
        communityPubkey: profileList.communityPubkey,
        sectionName: section.name,
        profileList,
        profileListRef,
        status: "accepted",
        statusChangedAt: definition.event.created_at,
        statusEvent: definition.event,
        acceptanceReactions: [],
        rejectionReactions: [],
        derivedFromGrant: true,
      })
    }
  }

  return states
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
  includeGranted = false,
}: {
  definition: CommunityDefinition
  requests: ModeratorPromotionRequest[]
  reactionEvents?: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  includeGranted?: boolean
}): ModeratorPromotionRequestState[] => {
  const requestStates: ModeratorPromotionRequestState[] = requests.map(request => {
    const acceptedListReactions = getActiveTargetReactions({
      targetEventId: request.profileList.event.id,
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
    const acceptanceReactions = acceptedListReactions
    const rejectionReactions = rejectedListReactions
    const accepted = hasSectionRef(definition, request)
    const rejected = rejectedListReactions.length > 0
    const statusEvent = accepted
      ? getLatestEvent(acceptedListReactions) || definition.event
      : rejected
        ? getLatestEvent(rejectedListReactions)
        : request.profileList.event

    return {
      ...request,
      acceptanceReactions,
      rejectionReactions,
      status: accepted ? "accepted" : rejected ? "rejected" : "pending",
      statusChangedAt: statusEvent?.created_at || 0,
      statusEvent,
    }
  })

  return includeGranted
    ? [...requestStates, ...getGrantDerivedModeratorRequestStates(definition, requestStates)]
    : requestStates
}

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

    return {
      name: section.name,
      kinds: section.kinds,
      profileLists,
      badges: section.badges,
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
      badges: section.badges,
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
