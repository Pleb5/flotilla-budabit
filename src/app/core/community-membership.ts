import type {TrustedEvent} from "@welshman/util"
import {
  PROFILE_LIST_KIND,
  getCommunitySectionDisplayName,
  getProfileListPubkeys,
  normalizePubkey,
  parseCommunityDefinition,
  type CommunityDefinition,
  type CommunityProfileListRef,
} from "@app/core/community"
import {
  isCommunityPersonBanned,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"

export type ActiveUserCommunityRole = "admin" | "moderator" | "member"

export type ActiveUserCommunityRef = {
  communityPubkey: string
  definition: CommunityDefinition
  relayHints: string[]
  roles: ActiveUserCommunityRole[]
  writableSections: string[]
}

export type UserCommunityReportStates =
  | Map<string, EffectiveCommunityReportState | undefined>
  | Record<string, EffectiveCommunityReportState | undefined>

export type CommunityMemberSectionRef = {
  sectionName: string
  displayName: string
  profileListAddresses: string[]
}

export type CommunityMemberListItem = {
  pubkey: string
  isOwner: boolean
  isAdmin: boolean
  isModerator: boolean
  moderatorSections: CommunityMemberSectionRef[]
  sectionGrants: CommunityMemberSectionRef[]
  moderatorSectionCount: number
  grantCount: number
}

export type SelectUserCommunityRefsOptions = {
  author?: string
  definitions?: CommunityDefinition[]
  definitionEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
}

const roleOrder: ActiveUserCommunityRole[] = ["admin", "moderator", "member"]

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

const getLatestDefinitionsByPubkey = (definitions: CommunityDefinition[]) => {
  const latest = new Map<string, CommunityDefinition>()

  for (const definition of definitions) {
    const current = latest.get(definition.pubkey)
    if (!current || definition.event.created_at > current.event.created_at) {
      latest.set(definition.pubkey, definition)
    }
  }

  return Array.from(latest.values())
}

const getLatestProfileListEventsByAddress = (events: TrustedEvent[]) => {
  const latest = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== PROFILE_LIST_KIND) continue

    const address = getAddress(event)
    if (!address) continue

    const current = latest.get(address)
    if (isPreferredEvent(event, current)) latest.set(address, event)
  }

  return latest
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

const hasValidatedModeratorRef = (
  ref: CommunityProfileListRef,
  userPubkey: string,
  profileListsByAddress: Map<string, TrustedEvent>,
) => {
  if (ref.pubkey !== userPubkey) return false

  const event = profileListsByAddress.get(ref.address)

  return Boolean(event && event.pubkey === userPubkey)
}

const hasMemberRef = (
  ref: CommunityProfileListRef,
  userPubkey: string,
  profileListsByAddress: Map<string, TrustedEvent>,
) => getProfileListPubkeys(profileListsByAddress.get(ref.address)).includes(userPubkey)

const upsertSectionRef = (
  refs: CommunityMemberSectionRef[],
  sectionRef: CommunityMemberSectionRef,
) => {
  const existing = refs.find(ref => ref.sectionName === sectionRef.sectionName)

  if (!existing) {
    refs.push(sectionRef)
    return
  }

  existing.profileListAddresses = Array.from(
    new Set([...existing.profileListAddresses, ...sectionRef.profileListAddresses]),
  ).sort((a, b) => a.localeCompare(b))
}

export const selectCommunityMemberList = ({
  definition,
  profileListEvents = [],
  reportState,
}: {
  definition?: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
}): CommunityMemberListItem[] => {
  if (!definition) return []

  const ownerPubkey = normalizePubkey(definition.pubkey)
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const people = new Map<string, CommunityMemberListItem>()
  const getPerson = (pubkey: string) => {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return undefined
    if (normalized !== ownerPubkey && isCommunityPersonBanned(reportState, normalized))
      return undefined

    const existing = people.get(normalized)
    if (existing) return existing

    const person = {
      pubkey: normalized,
      isOwner: normalized === ownerPubkey,
      isAdmin: normalized === ownerPubkey,
      isModerator: false,
      moderatorSections: [],
      sectionGrants: [],
      moderatorSectionCount: 0,
      grantCount: 0,
    } satisfies CommunityMemberListItem

    people.set(normalized, person)

    return person
  }

  getPerson(ownerPubkey)

  for (const section of definition.sections) {
    const sectionRef = {
      sectionName: section.name,
      displayName: getCommunitySectionDisplayName(section),
    }

    for (const profileList of section.profileLists) {
      const moderator = getPerson(profileList.pubkey)

      if (moderator && !moderator.isOwner) {
        moderator.isModerator = true
        upsertSectionRef(moderator.moderatorSections, {
          ...sectionRef,
          profileListAddresses: [profileList.address],
        })
      }

      const event = profileListsByAddress.get(profileList.address)

      for (const memberPubkey of getProfileListPubkeys(event)) {
        const member = getPerson(memberPubkey)
        if (!member) continue

        upsertSectionRef(member.sectionGrants, {
          ...sectionRef,
          profileListAddresses: [profileList.address],
        })
      }
    }
  }

  return Array.from(people.values())
    .map(person => ({
      ...person,
      moderatorSections: person.moderatorSections.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
      sectionGrants: person.sectionGrants.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    }))
    .map(person => ({
      ...person,
      moderatorSectionCount: person.moderatorSections.length,
      grantCount: person.sectionGrants.length,
    }))
    .sort((a, b) => {
      const aGroup = a.isOwner ? 0 : a.isModerator ? 1 : 2
      const bGroup = b.isOwner ? 0 : b.isModerator ? 1 : 2

      if (aGroup !== bGroup) return aGroup - bGroup
      if (aGroup === 0) return a.pubkey.localeCompare(b.pubkey)
      if (a.grantCount !== b.grantCount) return b.grantCount - a.grantCount
      if (a.moderatorSectionCount !== b.moderatorSectionCount) {
        return b.moderatorSectionCount - a.moderatorSectionCount
      }

      return a.pubkey.localeCompare(b.pubkey)
    })
}

export const selectUserCommunityRefs = ({
  author,
  definitions = [],
  definitionEvents = [],
  profileListEvents = [],
  reportStates,
}: SelectUserCommunityRefsOptions): ActiveUserCommunityRef[] => {
  const normalizedAuthor = normalizePubkey(author || "")
  if (!normalizedAuthor) return []

  const parsedDefinitions = definitionEvents.flatMap(event => {
    const definition = parseCommunityDefinition(event)
    return definition ? [definition] : []
  })
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)

  return getLatestDefinitionsByPubkey([...definitions, ...parsedDefinitions])
    .flatMap(definition => {
      const isAdmin = definition.pubkey === normalizedAuthor
      const reportState = getReportState(reportStates, definition.pubkey)

      if (!isAdmin && isCommunityPersonBanned(reportState, normalizedAuthor)) return []

      const roles = new Set<ActiveUserCommunityRole>()
      const writableSections = new Set<string>()

      if (isAdmin) {
        roles.add("admin")
        for (const section of definition.sections) writableSections.add(section.name)
      }

      for (const section of definition.sections) {
        const isModerator = section.profileLists.some(ref =>
          hasValidatedModeratorRef(ref, normalizedAuthor, profileListsByAddress),
        )
        const isMember = section.profileLists.some(ref =>
          hasMemberRef(ref, normalizedAuthor, profileListsByAddress),
        )

        if (isModerator) roles.add("moderator")
        if (isMember) roles.add("member")
        if (isModerator || isMember) writableSections.add(section.name)
      }

      if (roles.size === 0) return []

      return [
        {
          communityPubkey: definition.pubkey,
          definition,
          relayHints: definition.relays,
          roles: roleOrder.filter(role => roles.has(role)),
          writableSections: Array.from(writableSections).sort((a, b) => a.localeCompare(b)),
        } satisfies ActiveUserCommunityRef,
      ]
    })
    .sort((a, b) => a.communityPubkey.localeCompare(b.communityPubkey))
}
