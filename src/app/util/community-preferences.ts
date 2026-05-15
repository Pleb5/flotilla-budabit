import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
  normalizePubkey,
  normalizeRelays,
  parseCommunityDefinition,
} from "@app/core/community"
import {parseAdmissionForm} from "@app/core/community-forms"
import {getGrantCapability} from "@app/core/community-permissions"
import type {CommunityStarRef} from "@app/util/community-stars"

export const COMMUNITY_PREFERENCE_SCORE = {
  star: 1,
  moderator: 2,
  admin: 4,
} as const

export const COMMUNITY_PREFERENCE_LIMIT = 200

export type PreferredCommunityRef = {
  communityPubkey: string
  relayHints: string[]
  score: number
  lastInteractedAt: number
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
  star?: CommunityStarRef
}

type PreferenceInput = {
  stars?: CommunityStarRef[]
  adminDefinitionEvents?: TrustedEvent[]
  moderatorFormEvents?: TrustedEvent[]
  moderatorProfileListEvents?: TrustedEvent[]
  moderatorDefinitionEvents?: TrustedEvent[]
  author?: string
}

type MutablePreference = PreferredCommunityRef & {
  scoreParts: Set<keyof typeof COMMUNITY_PREFERENCE_SCORE>
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

export const makeCommunityAdminDefinitionFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {kinds: [COMMUNITY_DEFINITION_KIND], authors: [pubkey], limit: COMMUNITY_PREFERENCE_LIMIT}
}

export const makeCommunityModeratorFormFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {kinds: [FORM_TEMPLATE_KIND], authors: [pubkey], limit: COMMUNITY_PREFERENCE_LIMIT}
}

export const makeCommunityModeratorProfileListFilter = (author: string) => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {kinds: [PROFILE_LIST_KIND], authors: [pubkey], limit: COMMUNITY_PREFERENCE_LIMIT}
}

export const makeCommunityDefinitionProfileListRefFilters = (profileListEvents: TrustedEvent[]) => {
  const addresses = Array.from(
    new Set(
      profileListEvents
        .filter(event => event.kind === PROFILE_LIST_KIND)
        .map(getAddress)
        .filter(Boolean),
    ),
  )

  return addresses.map(address => ({
    kinds: [COMMUNITY_DEFINITION_KIND],
    "#a": [address],
    limit: COMMUNITY_PREFERENCE_LIMIT,
  }))
}

const addRole = (
  preferences: Map<string, MutablePreference>,
  communityPubkey: string,
  role: keyof typeof COMMUNITY_PREFERENCE_SCORE,
  options: {relayHints?: string[]; lastInteractedAt?: number; star?: CommunityStarRef} = {},
) => {
  const normalizedCommunity = normalizePubkey(communityPubkey)
  if (!normalizedCommunity) return

  const current = preferences.get(normalizedCommunity) || {
    communityPubkey: normalizedCommunity,
    relayHints: [],
    score: 0,
    lastInteractedAt: 0,
    isStarred: false,
    isModerator: false,
    isAdmin: false,
    scoreParts: new Set(),
  }

  current.scoreParts.add(role)
  current.score = Array.from(current.scoreParts).reduce(
    (sum, part) => sum + COMMUNITY_PREFERENCE_SCORE[part],
    0,
  )
  current.relayHints = normalizeRelays([...current.relayHints, ...(options.relayHints || [])])
  current.lastInteractedAt = Math.max(current.lastInteractedAt, options.lastInteractedAt || 0)
  current.isStarred = current.scoreParts.has("star")
  current.isModerator = current.scoreParts.has("moderator")
  current.isAdmin = current.scoreParts.has("admin")
  if (options.star) current.star = options.star

  preferences.set(normalizedCommunity, current)
}

const getLatestDefinitionsByPubkey = (events: TrustedEvent[]) => {
  const definitions = new Map<string, CommunityDefinition>()

  for (const event of events) {
    const definition = parseCommunityDefinition(event)
    if (!definition) continue

    const current = definitions.get(definition.pubkey)
    if (!current || definition.event.created_at > current.event.created_at) {
      definitions.set(definition.pubkey, definition)
    }
  }

  return definitions
}

export const getModeratorProfileListEventMap = (events: TrustedEvent[], author?: string) => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const profileLists = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== PROFILE_LIST_KIND) continue
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue

    const address = getAddress(event)
    if (!address) continue

    const current = profileLists.get(address)
    if (!current || event.created_at > current.created_at) profileLists.set(address, event)
  }

  return profileLists
}

const getModeratorEvidence = ({
  definition,
  moderatorProfileListEvents,
  author,
}: {
  definition: CommunityDefinition
  moderatorProfileListEvents: Map<string, TrustedEvent>
  author: string
}) => {
  let latestAt = 0

  for (const section of definition.sections) {
    const capability = getGrantCapability({
      definition,
      userPubkey: author,
      sectionName: section.name,
    })
    if (!capability.canGrant) continue

    for (const profileList of section.profileLists) {
      const event = moderatorProfileListEvents.get(profileList.address)
      if (event) latestAt = Math.max(latestAt, event.created_at)
    }
  }

  return latestAt
}

export const selectPreferredCommunities = ({
  stars = [],
  adminDefinitionEvents = [],
  moderatorFormEvents = [],
  moderatorProfileListEvents = [],
  moderatorDefinitionEvents = [],
  author,
}: PreferenceInput): PreferredCommunityRef[] => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const preferences = new Map<string, MutablePreference>()
  const definitions = getLatestDefinitionsByPubkey([
    ...adminDefinitionEvents,
    ...moderatorDefinitionEvents,
  ])
  const moderatorProfileListEventMap = getModeratorProfileListEventMap(
    moderatorProfileListEvents,
    normalizedAuthor,
  )

  for (const star of stars) {
    addRole(preferences, star.communityPubkey, "star", {
      relayHints: star.relayHints,
      lastInteractedAt: star.reaction.created_at,
      star,
    })
  }

  for (const event of adminDefinitionEvents) {
    const definition = parseCommunityDefinition(event)
    if (!definition) continue
    if (normalizedAuthor && definition.pubkey !== normalizedAuthor) continue

    addRole(preferences, definition.pubkey, "admin", {
      relayHints: definition.relays,
      lastInteractedAt: definition.event.created_at,
    })
  }

  for (const event of moderatorFormEvents) {
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue

    const form = parseAdmissionForm(event)
    if (!form?.communityPubkey) continue

    const definition = definitions.get(form.communityPubkey)
    const hasCapability = definition
      ? definition.sections.some(
          section =>
            getGrantCapability({
              definition,
              userPubkey: normalizedAuthor,
              sectionName: section.name,
            }).canGrant,
        )
      : true

    if (!hasCapability) continue

    addRole(preferences, form.communityPubkey, "moderator", {
      relayHints: normalizeRelays([...(form.relays || []), ...(definition?.relays || [])]),
      lastInteractedAt: form.event.created_at,
    })
  }

  for (const definition of definitions.values()) {
    if (definition.pubkey === normalizedAuthor) continue

    const latestAt = getModeratorEvidence({
      definition,
      moderatorProfileListEvents: moderatorProfileListEventMap,
      author: normalizedAuthor,
    })

    if (!latestAt) continue

    addRole(preferences, definition.pubkey, "moderator", {
      relayHints: definition.relays,
      lastInteractedAt: latestAt,
    })
  }

  return Array.from(preferences.values())
    .map(({scoreParts, ...preference}) => preference)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.lastInteractedAt !== a.lastInteractedAt) return b.lastInteractedAt - a.lastInteractedAt

      return a.communityPubkey.localeCompare(b.communityPubkey)
    })
}
