import {type EventContent, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  PROFILE_LIST_STATUS_DECLINED,
  buildCommunityDefinition,
  findCommunitySection,
  type CommunityDefinition,
  type CommunityProfileListRef,
  type CommunityDefinitionSectionInput,
  getCommunitySectionDisplayName,
  getProfileListStatus,
  getProfileListPubkeys,
  isProfileListDeclined,
  makeAddress,
  makeCommunitySetupSection,
  normalizePubkey,
  normalizeRelays,
} from "@app/core/community"

export type CommunityBootstrapGrantRole = "member" | "moderator"

export type CommunityBootstrapGrantDraft = {
  pubkey: string
  role: CommunityBootstrapGrantRole
  sectionNames: string[]
}

export type CommunityProfileListDraftUpdate = {
  profileList: CommunityProfileListRef
  pubkeys: string[]
}

export type PendingCommunityModeratorInvite = {
  sectionName: string
  displayName: string
  profileList: CommunityProfileListRef
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

export const findCommunityProfileListEvent = (
  profileListRef: CommunityProfileListRef | undefined,
  events: TrustedEvent[],
) => {
  if (!profileListRef) return undefined

  let selected: TrustedEvent | undefined

  for (const event of events) {
    if (event.kind !== profileListRef.kind) continue
    if (getAddress(event) !== profileListRef.address) continue
    if (isPreferredEvent(event, selected)) selected = event
  }

  return selected
}

export const isActiveCommunityProfileListEvent = (event: TrustedEvent | undefined) =>
  Boolean(event && !isProfileListDeclined(event))

export const isActiveCommunityProfileListRef = (
  ref: CommunityProfileListRef | undefined,
  profileListEvents: TrustedEvent[] | undefined,
) => {
  if (!ref) return false
  if (!profileListEvents) return true

  return isActiveCommunityProfileListEvent(findCommunityProfileListEvent(ref, profileListEvents))
}

export const makeManualModeratorProfileListRef = ({
  moderatorPubkey,
  sectionName,
  relays = [],
}: {
  moderatorPubkey: string
  sectionName: string
  relays?: string[]
}): CommunityProfileListRef => {
  const pubkey = normalizePubkey(moderatorPubkey)
  const identifier = sectionName.trim()
  const relay = normalizeRelays(relays)[0]

  return {
    kind: PROFILE_LIST_KIND,
    pubkey,
    identifier,
    address: makeAddress(PROFILE_LIST_KIND, pubkey, identifier),
    relay,
  }
}

export const makeModeratorInviteResponseProfileList = ({
  profileList,
  declined = false,
}: {
  profileList: CommunityProfileListRef
  declined?: boolean
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => ({
  kind: PROFILE_LIST_KIND,
  content: "",
  tags: [
    ["d", profileList.identifier],
    ...(declined ? [["status", PROFILE_LIST_STATUS_DECLINED]] : []),
  ],
})

export const isDeclinedModeratorInviteProfileList = (event: TrustedEvent | undefined) =>
  getProfileListStatus(event) === PROFILE_LIST_STATUS_DECLINED

export const getOwnerMembershipGrantProfileList = ({
  definition,
  sectionName,
  relays = [],
}: {
  definition: CommunityDefinition
  sectionName: string
  relays?: string[]
}): {
  profileList?: CommunityProfileListRef
  definitionUpdate?: EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND}
} => {
  const section = findCommunitySection(definition, sectionName)
  const owner = normalizePubkey(definition.pubkey)
  if (!section || !owner) return {}

  const existing = section.profileLists.find(ref => normalizePubkey(ref.pubkey) === owner)
  if (existing) return {profileList: existing}

  const profileList = makeCommunitySetupSection({
    communityPubkey: owner,
    profileListPubkey: owner,
    relays,
    name: section.name,
    kinds: section.kinds,
  }).profileList
  const sections: CommunityDefinitionSectionInput[] = definition.sections.map(currentSection => ({
    name: currentSection.name,
    kinds: currentSection.kinds,
    profileLists:
      currentSection.name === section.name
        ? [...currentSection.profileLists, profileList]
        : currentSection.profileLists,
    badges: currentSection.badges,
    retention: currentSection.retention,
  }))

  return {
    profileList,
    definitionUpdate: buildCommunityDefinition({
      relays: definition.relays,
      sections,
      description: definition.description,
      blossomServers: definition.blossomServers,
      mints: definition.mints,
      tos: definition.tos,
      location: definition.location,
      geohash: definition.geohash,
    }),
  }
}

export const getPendingCommunityModeratorInvites = ({
  definition,
  moderatorPubkey,
  profileListEvents = [],
}: {
  definition: CommunityDefinition | undefined
  moderatorPubkey: string | undefined
  profileListEvents?: TrustedEvent[]
}): PendingCommunityModeratorInvite[] => {
  const pubkey = normalizePubkey(moderatorPubkey || "")
  if (!definition || !pubkey || pubkey === normalizePubkey(definition.pubkey)) return []

  return definition.sections.flatMap(section => {
    const displayName = getCommunitySectionDisplayName(section)

    return section.profileLists.flatMap(profileList => {
      if (normalizePubkey(profileList.pubkey) !== pubkey) return []

      const event = findCommunityProfileListEvent(profileList, profileListEvents)
      if (event || isDeclinedModeratorInviteProfileList(event)) return []

      return [{sectionName: section.name, displayName, profileList}]
    })
  })
}

const uniquePubkeys = (pubkeys: string[]) =>
  Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

const addGrantBySection = (
  grantsBySection: Map<string, string[]>,
  sectionName: string,
  pubkey: string,
) => {
  grantsBySection.set(
    sectionName,
    uniquePubkeys([...(grantsBySection.get(sectionName) || []), pubkey]),
  )
}

export const applyCommunityBootstrapGrants = ({
  sections,
  communityPubkey,
  relays = [],
  profileListEvents = [],
  grants = [],
}: {
  sections: CommunityDefinitionSectionInput[]
  communityPubkey: string
  relays?: string[]
  profileListEvents?: TrustedEvent[]
  grants?: CommunityBootstrapGrantDraft[]
}): {
  sections: CommunityDefinitionSectionInput[]
  profileListUpdates: CommunityProfileListDraftUpdate[]
} => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const normalizedRelays = normalizeRelays(relays)
  const memberGrantsBySection = new Map<string, string[]>()
  const moderatorGrantsBySection = new Map<string, string[]>()
  const profileListUpdates = new Map<string, CommunityProfileListDraftUpdate>()

  for (const grant of grants) {
    const pubkey = normalizePubkey(grant.pubkey)
    if (!pubkey) continue

    for (const sectionName of grant.sectionNames) {
      const trimmedSectionName = sectionName.trim()
      if (!trimmedSectionName) continue

      addGrantBySection(
        grant.role === "moderator" ? moderatorGrantsBySection : memberGrantsBySection,
        trimmedSectionName,
        pubkey,
      )
    }
  }

  const nextSections = sections.map(section => {
    let profileLists = [...(section.profileLists || [])]
    const memberPubkeys = memberGrantsBySection.get(section.name) || []
    const moderatorPubkeys = moderatorGrantsBySection.get(section.name) || []

    if (memberPubkeys.length > 0 && normalizedCommunityPubkey) {
      let profileList = profileLists.find(
        ref => normalizePubkey(ref.pubkey) === normalizedCommunityPubkey,
      )

      if (!profileList) {
        profileList = makeCommunitySetupSection({
          communityPubkey: normalizedCommunityPubkey,
          profileListPubkey: normalizedCommunityPubkey,
          relays: normalizedRelays,
          name: section.name,
          kinds: section.kinds,
        }).profileList
        profileLists = [...profileLists, profileList]
      }

      const profileListEvent = findCommunityProfileListEvent(profileList, profileListEvents)
      const existingPubkeys = getProfileListPubkeys(profileListEvent)
      const basePubkeys = existingPubkeys.length > 0 ? existingPubkeys : [normalizedCommunityPubkey]

      profileListUpdates.set(profileList.address, {
        profileList,
        pubkeys: uniquePubkeys([...basePubkeys, ...memberPubkeys]),
      })
    }

    for (const moderatorPubkey of moderatorPubkeys) {
      const profileList = makeManualModeratorProfileListRef({
        moderatorPubkey,
        sectionName: section.name,
        relays: normalizedRelays,
      })

      if (profileList.pubkey && !profileLists.some(ref => ref.address === profileList.address)) {
        profileLists = [...profileLists, profileList]
      }
    }

    return {...section, profileLists}
  })

  return {sections: nextSections, profileListUpdates: Array.from(profileListUpdates.values())}
}

export const makeCommunityProfileList = ({
  profileList,
  pubkeys,
}: {
  profileList: CommunityProfileListRef
  pubkeys: string[]
}): EventContent & {kind: typeof PROFILE_LIST_KIND} => ({
  kind: PROFILE_LIST_KIND,
  content: "",
  tags: [
    ["d", profileList.identifier],
    ...Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean))).map(pubkey => [
      "p",
      pubkey,
    ]),
  ],
})

export const addPubkeyToCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => makeCommunityProfileList({profileList, pubkeys: [...getProfileListPubkeys(event), pubkey]})

export const removePubkeyFromCommunityProfileList = ({
  profileList,
  event,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  event?: TrustedEvent
  pubkey: string
}) => {
  const normalized = normalizePubkey(pubkey)

  return makeCommunityProfileList({
    profileList,
    pubkeys: getProfileListPubkeys(event).filter(existing => existing !== normalized),
  })
}

export const makeCommunityGrantEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => addPubkeyToCommunityProfileList({profileList, event: profileListEvent, pubkey})

export const makeCommunityRevokeEvent = ({
  profileList,
  profileListEvent,
  pubkey,
}: {
  profileList: CommunityProfileListRef
  profileListEvent?: TrustedEvent
  pubkey: string
}) => removePubkeyFromCommunityProfileList({profileList, event: profileListEvent, pubkey})
