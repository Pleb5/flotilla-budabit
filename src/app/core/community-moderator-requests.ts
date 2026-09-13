import {DELETE, type EventContent, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  deleteMatchesCommunity,
  makeCommunityAuthorityTags,
  makeCommunityDeleteTags,
  makeCommunityProfileListIdentifier,
  getCommunitySectionPurpose,
  normalizeCommunityRelay,
  parseCommunityAuthority,
  parseOwnerPubkey,
  updateCommunityDefinition,
  type CommunityDefinition,
  type CommunityPointer,
  type CommunityDefinitionProfileListRef,
  type CommunityDefinitionSection,
} from "@app/core/community"

export const MODERATOR_REQUEST_REACTION_KIND = 7
export const MODERATOR_REQUEST_ROLE = "moderator-request"

export type ParsedModeratorRequestEvent = {
  event: TrustedEvent
  pubkey: string
  identifier: string
  address: string
  community: CommunityPointer
  sectionName: string
}

export type ModeratorPromotionRequest = {
  requesterPubkey: string
  identifier: string
  community: CommunityPointer
  sectionName: string
  profileList: ParsedModeratorRequestEvent
  profileListRef: CommunityDefinitionProfileListRef
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

const getSingletonValue = (event: TrustedEvent, name: string) => {
  const tags = event.tags.filter(tag => tag[0] === name)
  return tags.length === 1 && tags[0].length === 2 ? tags[0][1] : undefined
}

const parseProfileListAddress = (address: string) => {
  const [kind, pubkeyValue, ...identifierParts] = address.split(":")
  const pubkey = parseOwnerPubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")
  if (kind !== String(PROFILE_LIST_KIND) || !pubkey || !identifier) return undefined
  return {pubkey, identifier, address: `${PROFILE_LIST_KIND}:${pubkey}:${identifier}`}
}

const makeEventAddress = (event: TrustedEvent) => {
  const identifier = getSingletonValue(event, "d")
  const pubkey = parseOwnerPubkey(event.pubkey || "")
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
  community,
  sectionName,
}: {
  community: CommunityPointer
  sectionName: string
}) => {
  const purpose = getCommunitySectionPurpose(community.communityId, {
    name: sectionName,
    profileLists: [],
  })
  const identifier = purpose
    ? makeCommunityProfileListIdentifier(community.communityId, purpose)
    : undefined
  if (!identifier) throw new Error("Invalid moderator request identifier.")
  return identifier
}

export const makeModeratorRequestRefs = ({
  community,
  requesterPubkey,
  sectionName,
  relays = [],
}: {
  community: CommunityPointer
  requesterPubkey: string
  sectionName: string
  relays?: string[]
}) => {
  const pubkey = parseOwnerPubkey(requesterPubkey)
  if (!pubkey) throw new Error("Invalid moderator requester pubkey.")
  const identifier = makeModeratorRequestIdentifier({community, sectionName})
  const relay = relays.map(normalizeCommunityRelay).find(Boolean)
  const profileList: CommunityDefinitionProfileListRef = {
    address: `${PROFILE_LIST_KIND}:${pubkey}:${identifier}`,
    ...(relay ? {relay} : {}),
  }
  return {identifier, profileList}
}

export const makeModeratorProfileListRequest = ({
  community,
  requesterPubkey,
  sectionName,
  relays = [],
}: {
  community: CommunityPointer
  requesterPubkey: string
  sectionName: string
  relays?: string[]
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => {
  const {identifier} = makeModeratorRequestRefs({
    community,
    requesterPubkey,
    sectionName,
    relays,
  })
  const relay = relays.map(normalizeCommunityRelay).find(Boolean)
  return {
    kind: PROFILE_LIST_KIND,
    content: "",
    tags: [
      ["d", identifier],
      ...makeCommunityAuthorityTags(community, relay, [
        ["role", MODERATOR_REQUEST_ROLE],
        ["content", sectionName.trim()],
      ]),
    ],
  }
}

export const parseModeratorRequestEvent = (
  event: TrustedEvent,
  community?: CommunityPointer,
): ParsedModeratorRequestEvent | undefined => {
  if (event.kind !== PROFILE_LIST_KIND || event.content !== "") return undefined
  const pubkey = parseOwnerPubkey(event.pubkey || "")
  const identifier = getSingletonValue(event, "d")
  const address = makeEventAddress(event)
  const authority = parseCommunityAuthority(event)
  const sectionName = getSingletonValue(event, "content")
  const role = getSingletonValue(event, "role")
  if (
    !pubkey ||
    !identifier ||
    !address ||
    !authority ||
    !sectionName ||
    sectionName !== sectionName.trim() ||
    role !== MODERATOR_REQUEST_ROLE ||
    identifier !== makeModeratorRequestIdentifier({community: authority, sectionName}) ||
    (community && authority.address !== community.address)
  ) {
    return undefined
  }
  return {event, pubkey, identifier, address, community: authority, sectionName}
}

export const getModeratorPromotionRequests = ({
  profileListEvents,
  community,
}: {
  profileListEvents: TrustedEvent[]
  community: CommunityPointer
}): ModeratorPromotionRequest[] =>
  selectLatestParsedRequestEvents(
    profileListEvents
      .map(event => parseModeratorRequestEvent(event, community))
      .filter((event): event is ParsedModeratorRequestEvent => Boolean(event)),
  ).map(profileList => ({
    requesterPubkey: profileList.pubkey,
    identifier: profileList.identifier,
    community: profileList.community,
    sectionName: profileList.sectionName,
    profileList,
    profileListRef: {
      address: profileList.address,
      ...(profileList.community.relayHints[0] ? {relay: profileList.community.relayHints[0]} : {}),
    },
  }))

const findSection = (definition: CommunityDefinition, name: string) =>
  definition.sections.find(section => section.name === name)

const hasSectionRef = (definition: CommunityDefinition, request: ModeratorPromotionRequest) =>
  Boolean(
    findSection(definition, request.sectionName)?.profileLists.some(
      ref => ref.address === request.profileListRef.address,
    ),
  )

const makeGrantDerivedRequestEvent = ({
  definition,
  sectionName,
  ref,
}: {
  definition: CommunityDefinition
  sectionName: string
  ref: CommunityDefinitionProfileListRef
}): ParsedModeratorRequestEvent | undefined => {
  const parsedRef = parseProfileListAddress(ref.address)
  if (!parsedRef) return undefined
  const event = {
    ...definition.event,
    id: `grant:${ref.address}`,
    pubkey: parsedRef.pubkey,
    kind: PROFILE_LIST_KIND,
    content: "",
    tags: [
      ["d", parsedRef.identifier],
      ...makeCommunityAuthorityTags(definition.pointer, ref.relay, [
        ["role", MODERATOR_REQUEST_ROLE],
        ["content", sectionName],
      ]),
    ],
  } as TrustedEvent
  return {
    event,
    pubkey: parsedRef.pubkey,
    identifier: parsedRef.identifier,
    address: parsedRef.address,
    community: definition.pointer,
    sectionName,
  }
}

const getGrantDerivedModeratorRequestStates = (
  definition: CommunityDefinition,
  requestStates: ModeratorPromotionRequestState[],
) => {
  const acceptedKeys = new Set(
    requestStates
      .filter(request => request.status === "accepted")
      .map(request => `${request.requesterPubkey}:${request.sectionName}`),
  )
  const states: ModeratorPromotionRequestState[] = []
  for (const section of definition.sections) {
    const profileListsByPubkey = new Map<string, CommunityDefinitionProfileListRef[]>()
    for (const ref of section.profileLists) {
      const parsed = parseProfileListAddress(ref.address)
      if (!parsed || parsed.pubkey === definition.ownerPubkey) continue
      profileListsByPubkey.set(parsed.pubkey, [
        ...(profileListsByPubkey.get(parsed.pubkey) || []),
        ref,
      ])
    }
    for (const [requesterPubkey, profileLists] of profileListsByPubkey) {
      const profileListRef = profileLists[0]
      if (!profileListRef || acceptedKeys.has(`${requesterPubkey}:${section.name}`)) continue
      const profileList = makeGrantDerivedRequestEvent({
        definition,
        sectionName: section.name,
        ref: profileListRef,
      })
      if (!profileList) continue
      states.push({
        requesterPubkey,
        identifier: profileList.identifier,
        community: definition.pointer,
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

const hasExactAuthority = (event: TrustedEvent, community: CommunityPointer) =>
  parseCommunityAuthority(event)?.address === community.address

const isReactionDeleted = (
  reaction: TrustedEvent,
  community: CommunityPointer,
  deleteEvents: TrustedEvent[],
) =>
  deleteEvents.some(event => {
    if (
      event.kind !== DELETE ||
      event.pubkey !== reaction.pubkey ||
      !deleteMatchesCommunity(event, community) ||
      !event.tags.some(tag => tag[0] === "e" && tag[1] === reaction.id)
    )
      return false
    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return (
      kindTags.length === 1 && kindTags[0].length === 2 && kindTags[0][1] === String(reaction.kind)
    )
  })

const getActiveTargetReactions = ({
  targetEventId,
  community,
  content,
  reactionEvents,
  deleteEvents,
}: {
  targetEventId: string
  community: CommunityPointer
  content: "+" | "-"
  reactionEvents: TrustedEvent[]
  deleteEvents: TrustedEvent[]
}) =>
  reactionEvents.filter(
    event =>
      event.kind === MODERATOR_REQUEST_REACTION_KIND &&
      event.content === content &&
      event.pubkey === community.ownerPubkey &&
      hasExactAuthority(event, community) &&
      event.tags.some(tag => tag[0] === "e" && tag[1] === targetEventId) &&
      !isReactionDeleted(event, community, deleteEvents),
  )

const getLatestEvent = (events: TrustedEvent[]) => {
  let latest: TrustedEvent | undefined
  for (const event of events) if (!latest || isPreferredEvent(event, latest)) latest = event
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
  const requestStates = requests.map(request => {
    const acceptanceReactions = getActiveTargetReactions({
      targetEventId: request.profileList.event.id,
      community: definition.pointer,
      content: "+",
      reactionEvents,
      deleteEvents,
    })
    const rejectionReactions = getActiveTargetReactions({
      targetEventId: request.profileList.event.id,
      community: definition.pointer,
      content: "-",
      reactionEvents,
      deleteEvents,
    })
    const accepted = hasSectionRef(definition, request)
    const rejected = rejectionReactions.length > 0
    const statusEvent = accepted
      ? getLatestEvent(acceptanceReactions) || definition.event
      : rejected
        ? getLatestEvent(rejectionReactions)
        : request.profileList.event
    return {
      ...request,
      acceptanceReactions,
      rejectionReactions,
      status: accepted
        ? ("accepted" as const)
        : rejected
          ? ("rejected" as const)
          : ("pending" as const),
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
  tags: makeCommunityAuthorityTags(request.community, undefined, [
    ["e", target.event.id],
    ["p", request.requesterPubkey],
    ["k", String(target.event.kind)],
    ["content", request.sectionName],
  ]),
})

export const makeModeratorRequestReactionDelete = ({
  community,
  reactionId,
}: {
  community: CommunityPointer
  reactionId: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: "Deleted moderator request review",
  tags: makeCommunityDeleteTags(community, [
    ["e", reactionId],
    ["k", String(MODERATOR_REQUEST_REACTION_KIND)],
  ]),
})

const updateDefinitionSections = (
  definition: CommunityDefinition,
  sections: CommunityDefinitionSection[],
): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND} => {
  const base = updateCommunityDefinition(definition, {})
  const replacements = new Map(sections.map(section => [section.name, section.profileLists]))
  const tags: string[][] = []
  let sectionName: string | undefined
  let insertedRefs = false
  const insertRefs = () => {
    if (!sectionName || insertedRefs) return
    for (const ref of replacements.get(sectionName) || []) {
      tags.push(ref.relay ? ["a", ref.address, ref.relay] : ["a", ref.address])
    }
    insertedRefs = true
  }
  for (const tag of base.tags) {
    if (tag[0] === "content") {
      insertRefs()
      sectionName = tag[1]
      insertedRefs = false
      tags.push([...tag])
    } else if (sectionName && tag[0] === "a") {
      insertRefs()
    } else {
      tags.push([...tag])
    }
  }
  insertRefs()
  return {...base, tags}
}

export const makeModeratorPromotionDefinitionUpdate = ({
  definition,
  request,
}: {
  definition: CommunityDefinition
  request: ModeratorPromotionRequest
}) =>
  updateDefinitionSections(
    definition,
    definition.sections.map(section =>
      section.name !== request.sectionName ||
      section.profileLists.some(ref => ref.address === request.profileListRef.address)
        ? section
        : {...section, profileLists: [...section.profileLists, request.profileListRef]},
    ),
  )

const makeManualModeratorProfileListRef = ({
  community,
  moderatorPubkey,
  sectionName,
  relays = [],
}: {
  community: CommunityPointer
  moderatorPubkey: string
  sectionName: string
  relays?: string[]
}): CommunityDefinitionProfileListRef => {
  const pubkey = parseOwnerPubkey(moderatorPubkey)
  const purpose = getCommunitySectionPurpose(community.communityId, {
    name: sectionName,
    profileLists: [],
  })
  const identifier = purpose
    ? makeCommunityProfileListIdentifier(community.communityId, purpose)
    : undefined
  if (!pubkey || !identifier) throw new Error("Invalid moderator profile-list reference.")
  const relay = relays.map(normalizeCommunityRelay).find(Boolean)
  return {
    address: `${PROFILE_LIST_KIND}:${pubkey}:${identifier}`,
    ...(relay ? {relay} : {}),
  }
}

export const makeModeratorGrantEditDefinitionUpdate = ({
  definition,
  moderatorPubkey,
  sectionNames,
  relays = definition.relays,
}: {
  definition: CommunityDefinition
  moderatorPubkey: string
  sectionNames: string[]
  relays?: string[]
}) => {
  const pubkey = parseOwnerPubkey(moderatorPubkey)
  if (!pubkey) throw new Error("Invalid moderator pubkey.")
  const selected = new Set(sectionNames.map(name => name.trim()).filter(Boolean))
  return updateDefinitionSections(
    definition,
    definition.sections.map(section => {
      const withoutModerator = section.profileLists.filter(
        ref => parseProfileListAddress(ref.address)?.pubkey !== pubkey,
      )
      if (!selected.has(section.name)) return {...section, profileLists: withoutModerator}
      const existing = section.profileLists.find(
        ref => parseProfileListAddress(ref.address)?.pubkey === pubkey,
      )
      return {
        ...section,
        profileLists: [
          ...withoutModerator,
          existing ||
            makeManualModeratorProfileListRef({
              community: definition.pointer,
              moderatorPubkey: pubkey,
              sectionName: section.name,
              relays,
            }),
        ],
      }
    }),
  )
}

export const makeModeratorGrantRevokeDefinitionUpdate = ({
  definition,
  sectionName,
  moderatorPubkey,
}: {
  definition: CommunityDefinition
  sectionName: string
  moderatorPubkey: string
}) => {
  const pubkey = parseOwnerPubkey(moderatorPubkey)
  if (!pubkey) throw new Error("Invalid moderator pubkey.")
  return updateDefinitionSections(
    definition,
    definition.sections.map(section =>
      section.name === sectionName
        ? {
            ...section,
            profileLists: section.profileLists.filter(
              ref => parseProfileListAddress(ref.address)?.pubkey !== pubkey,
            ),
          }
        : section,
    ),
  )
}
