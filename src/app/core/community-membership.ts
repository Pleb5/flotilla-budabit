import type {TrustedEvent} from "@welshman/util"
import {
  PROFILE_LIST_KIND,
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
