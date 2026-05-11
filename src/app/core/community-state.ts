import {browser} from "$app/environment"
import {derived, writable, type Readable} from "svelte/store"
import {sortBy} from "@welshman/lib"
import {load} from "@welshman/net"
import {PROFILE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
  type ParsedCommunityInput,
  normalizeRelays,
  parseCommunityDefinition,
  parseCommunityInput,
} from "@app/core/community"

export const COMMUNITY_SESSION_STORAGE_KEY = "budabit/community-session"

const fromCsv = (value?: string) =>
  String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)

export const DEFAULT_COMMUNITY_INPUT = import.meta.env.VITE_DEFAULT_COMMUNITY || ""
export const BOOTSTRAP_RELAYS = normalizeRelays(fromCsv(import.meta.env.VITE_BOOTSTRAP_RELAYS))

export type CommunitySession = {
  communityPubkey: string
  communityRelayHints: string[]
  communityDefinitionId?: string
}

export type CommunityBootstrap = {
  definition?: CommunityDefinition
  profileEvents: TrustedEvent[]
  profileListEvents: TrustedEvent[]
  badgeDefinitionEvents: TrustedEvent[]
}

const canUseLocalStorage = () => browser && typeof localStorage !== "undefined"

const readStoredSession = (): CommunitySession | undefined => {
  if (!canUseLocalStorage()) return undefined

  try {
    const raw = localStorage.getItem(COMMUNITY_SESSION_STORAGE_KEY)
    if (!raw) return undefined

    const value = JSON.parse(raw) as CommunitySession
    const parsed = parseCommunityInput(value.communityPubkey)
    if (!parsed) return undefined

    return {
      communityPubkey: parsed.pubkey,
      communityRelayHints: normalizeRelays(value.communityRelayHints || []),
      communityDefinitionId: value.communityDefinitionId,
    }
  } catch {
    return undefined
  }
}

const writeStoredSession = (session?: CommunitySession) => {
  if (!canUseLocalStorage()) return

  if (!session) {
    localStorage.removeItem(COMMUNITY_SESSION_STORAGE_KEY)
    return
  }

  localStorage.setItem(COMMUNITY_SESSION_STORAGE_KEY, JSON.stringify(session))
}

export const makeCommunitySession = (
  parsed: ParsedCommunityInput,
  definition?: CommunityDefinition,
): CommunitySession => ({
  communityPubkey: parsed.pubkey,
  communityRelayHints: parsed.relays,
  communityDefinitionId: definition?.event.id,
})

const getInitialSession = () => {
  const stored = readStoredSession()
  if (stored) return stored

  const parsedDefault = parseCommunityInput(DEFAULT_COMMUNITY_INPUT)
  return parsedDefault ? makeCommunitySession(parsedDefault) : undefined
}

export const activeCommunitySession = writable<CommunitySession | undefined>(getInitialSession())

if (canUseLocalStorage()) {
  activeCommunitySession.subscribe(writeStoredSession)
}

export const setActiveCommunityInput = (input: string) => {
  const parsed = parseCommunityInput(input)
  if (!parsed) return undefined

  const session = makeCommunitySession(parsed)
  activeCommunitySession.set(session)

  return session
}

export const setActiveCommunityDefinition = (definition: CommunityDefinition) => {
  activeCommunitySession.update(session => {
    const next = {
      communityPubkey: definition.pubkey,
      communityRelayHints: session?.communityRelayHints || [],
      communityDefinitionId: definition.event.id,
    }

    return next
  })
}

export const clearActiveCommunity = () => activeCommunitySession.set(undefined)

export const activeCommunityPubkey: Readable<string | undefined> = derived(
  activeCommunitySession,
  session => session?.communityPubkey,
)

export const activeCommunityRelayHints: Readable<string[]> = derived(
  activeCommunitySession,
  session => session?.communityRelayHints || [],
)

export const getCommunityBootstrapRelays = (relayHints: string[] = []) =>
  normalizeRelays([...relayHints, ...BOOTSTRAP_RELAYS])

export const makeCommunityDefinitionFilter = (pubkey: string): Filter => ({
  kinds: [COMMUNITY_DEFINITION_KIND],
  authors: [pubkey],
  limit: 1,
})

export const selectLatestCommunityDefinition = (
  events: TrustedEvent[],
  pubkey: string,
): CommunityDefinition | undefined =>
  sortBy(
    definition => -definition.event.created_at,
    events
      .map(parseCommunityDefinition)
      .filter((definition): definition is CommunityDefinition => Boolean(definition))
      .filter(definition => definition.pubkey === pubkey),
  )[0]

export const getProfileListRefs = (definition: CommunityDefinition) =>
  definition.sections.flatMap(section => section.profileLists)

export const getBadgeDefinitionRefs = (definition: CommunityDefinition) =>
  definition.sections.flatMap(section => section.badges)

const makeAddressRefFilter = ({kind, pubkey, identifier}: {kind: number; pubkey: string; identifier: string}) => ({
  kinds: [kind],
  authors: [pubkey],
  "#d": [identifier],
  limit: 1,
})

export const makeCommunityProfileFilter = (pubkey: string): Filter => ({
  kinds: [PROFILE],
  authors: [pubkey],
  limit: 1,
})

export const makeCommunityProfileListFilters = (definition: CommunityDefinition): Filter[] =>
  getProfileListRefs(definition).map(ref => makeAddressRefFilter(ref))

export const makeCommunityBadgeDefinitionFilters = (definition: CommunityDefinition): Filter[] =>
  getBadgeDefinitionRefs(definition).map(ref => makeAddressRefFilter(ref))

export const loadCommunityBootstrap = async (
  session: CommunitySession,
): Promise<CommunityBootstrap> => {
  const relays = getCommunityBootstrapRelays(session.communityRelayHints)
  const definitionEvents = await load({
    relays,
    filters: [makeCommunityDefinitionFilter(session.communityPubkey)],
  })
  const definition = selectLatestCommunityDefinition(definitionEvents, session.communityPubkey)
  const communityRelays = definition?.relays.length ? definition.relays : relays
  const filters: Filter[] = [makeCommunityProfileFilter(session.communityPubkey)]

  if (definition) {
    filters.push(...makeCommunityProfileListFilters(definition))
    filters.push(...makeCommunityBadgeDefinitionFilters(definition))
  }

  const relatedEvents = await load({relays: communityRelays, filters})

  if (definition) {
    setActiveCommunityDefinition(definition)
  }

  return {
    definition,
    profileEvents: relatedEvents.filter(event => event.kind === PROFILE),
    profileListEvents: relatedEvents.filter(event => event.kind === PROFILE_LIST_KIND),
    badgeDefinitionEvents: relatedEvents.filter(event => event.kind === BADGE_DEFINITION_KIND),
  }
}
