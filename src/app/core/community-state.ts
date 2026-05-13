import {browser} from "$app/environment"
import {derived, writable, type Readable} from "svelte/store"
import {sortBy} from "@welshman/lib"
import {load} from "@welshman/net"
import {PROFILE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  BADGE_DEFINITION_KIND,
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
  type ParsedCommunityInput,
  normalizeRelays,
  parseCommunityDefinition,
  parseCommunityInput,
} from "@app/core/community"
import {getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"
import {
  type CommunityAdmissionForm,
  makeCommunityDefinitionAddress,
  selectActiveAdmissionForm,
} from "@app/core/community-forms"

export const COMMUNITY_SESSION_STORAGE_KEY = "budabit/community-session"

const fromCsv = (value?: string) =>
  String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)

export const DEFAULT_COMMUNITY_INPUT = import.meta.env.VITE_DEFAULT_COMMUNITY || ""
export const COMMUNITY_DISCOVERY_RELAYS = normalizeRelays(fromCsv(import.meta.env.VITE_INDEXER_RELAYS))

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
  admissionFormEvents: TrustedEvent[]
}

export type CommunityProfile = {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  website?: string
  nip05?: string
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
export const activeCommunityDefinition = writable<CommunityDefinition | undefined>(undefined)
export const activeCommunityProfileEvents = writable<TrustedEvent[]>([])
export const activeCommunityProfileListEvents = writable<TrustedEvent[]>([])
export const activeCommunityBadgeDefinitionEvents = writable<TrustedEvent[]>([])
export const activeCommunityAdmissionFormEvents = writable<TrustedEvent[]>([])

if (canUseLocalStorage()) {
  activeCommunitySession.subscribe(writeStoredSession)
}

export const setActiveCommunityInput = (input: string) => {
  const parsed = parseCommunityInput(input)
  if (!parsed) return undefined

  let session: CommunitySession | undefined

  activeCommunitySession.update(current => {
    const sameCommunity = current?.communityPubkey === parsed.pubkey

    session = {
      communityPubkey: parsed.pubkey,
      communityRelayHints: parsed.relays.length || !sameCommunity ? parsed.relays : current.communityRelayHints,
      communityDefinitionId: sameCommunity ? current.communityDefinitionId : undefined,
    }

    return session
  })

  return session
}

export const setActiveCommunityDefinition = (definition: CommunityDefinition) => {
  activeCommunityDefinition.set(definition)

  activeCommunitySession.update(session => {
    const next = {
      communityPubkey: definition.pubkey,
      communityRelayHints: session?.communityRelayHints || [],
      communityDefinitionId: definition.event.id,
    }

    return next
  })
}

export const clearActiveCommunity = () => {
  activeCommunitySession.set(undefined)
  activeCommunityDefinition.set(undefined)
  activeCommunityProfileEvents.set([])
  activeCommunityProfileListEvents.set([])
  activeCommunityBadgeDefinitionEvents.set([])
  activeCommunityAdmissionFormEvents.set([])
}
export const clearActiveCommunityDefinition = () => activeCommunityDefinition.set(undefined)

export const activeCommunityPubkey: Readable<string | undefined> = derived(
  activeCommunitySession,
  session => session?.communityPubkey,
)

export const parseCommunityProfile = (event: TrustedEvent): CommunityProfile | undefined => {
  try {
    const parsed = JSON.parse(event.content || "{}")
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

export const activeCommunityProfile: Readable<CommunityProfile | undefined> = derived(
  [activeCommunitySession, activeCommunityProfileEvents],
  ([$activeCommunitySession, $activeCommunityProfileEvents]) => {
    const communityPubkey = $activeCommunitySession?.communityPubkey
    if (!communityPubkey) return undefined

    const latest = sortBy(
      event => -event.created_at,
      $activeCommunityProfileEvents.filter(event => event.pubkey === communityPubkey),
    )[0]

    return latest ? parseCommunityProfile(latest) : undefined
  },
)

export const activeCommunityRelayHints: Readable<string[]> = derived(
  activeCommunitySession,
  session => session?.communityRelayHints || [],
)

export const activeCommunityRelays: Readable<string[]> = derived(
  [activeCommunityDefinition, activeCommunityRelayHints],
  ([$activeCommunityDefinition, $activeCommunityRelayHints]) =>
    $activeCommunityDefinition?.relays.length
      ? $activeCommunityDefinition.relays
      : getCommunityBootstrapRelays($activeCommunityRelayHints),
)

export const getCommunityBootstrapRelays = (relayHints: string[] = []) =>
  normalizeRelays([...relayHints, ...COMMUNITY_DISCOVERY_RELAYS])

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

export const getAdmissionFormModeratorPubkeys = (definition: CommunityDefinition) =>
  Array.from(
    new Set(
      definition.sections.flatMap(section =>
        getGrantCapableSectionModeratorPubkeys({definition, sectionName: section.name}),
      ),
    ),
  )

export const makeCommunityAdmissionFormFilters = (definition: CommunityDefinition): Filter[] => {
  const authors = getAdmissionFormModeratorPubkeys(definition)
  const communityAddress = makeCommunityDefinitionAddress(definition.pubkey)

  return authors.length && communityAddress
    ? [{kinds: [FORM_TEMPLATE_KIND], authors, "#a": [communityAddress]}]
    : []
}

export const selectCommunityAdmissionForms = (
  definition: CommunityDefinition,
  events: TrustedEvent[],
): Record<string, CommunityAdmissionForm> =>
  Object.fromEntries(
    definition.sections
      .map(section => {
        const form = selectActiveAdmissionForm({
          events,
          communityPubkey: definition.pubkey,
          sectionName: section.name,
          moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({definition, sectionName: section.name}),
        })

        return form ? [section.name, form] : undefined
      })
      .filter(Boolean) as Array<[string, CommunityAdmissionForm]>,
  )

export const activeCommunityAdmissionForms: Readable<Record<string, CommunityAdmissionForm>> = derived(
  [activeCommunityDefinition, activeCommunityAdmissionFormEvents],
  ([$activeCommunityDefinition, $activeCommunityAdmissionFormEvents]) =>
    $activeCommunityDefinition
      ? selectCommunityAdmissionForms($activeCommunityDefinition, $activeCommunityAdmissionFormEvents)
      : {},
)

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
  const profileRelays = normalizeRelays([...communityRelays, ...relays])
  const profileFilter = makeCommunityProfileFilter(session.communityPubkey)
  const authorityFilters: Filter[] = []
  const admissionFormFilters: Filter[] = []

  if (definition) {
    setActiveCommunityDefinition(definition)
    authorityFilters.push(...makeCommunityProfileListFilters(definition))
    authorityFilters.push(...makeCommunityBadgeDefinitionFilters(definition))
    admissionFormFilters.push(...makeCommunityAdmissionFormFilters(definition))
  }

  const [profileEvents, authorityEvents, admissionFormEvents] = await Promise.all([
    load({relays: profileRelays, filters: [profileFilter]}),
    authorityFilters.length > 0 ? load({relays: communityRelays, filters: authorityFilters}) : [],
    admissionFormFilters.length > 0 ? load({relays: communityRelays, filters: admissionFormFilters}) : [],
  ])

  const bootstrap = {
    definition,
    profileEvents: profileEvents.filter(event => event.kind === PROFILE),
    profileListEvents: authorityEvents.filter(event => event.kind === PROFILE_LIST_KIND),
    badgeDefinitionEvents: authorityEvents.filter(event => event.kind === BADGE_DEFINITION_KIND),
    admissionFormEvents: admissionFormEvents.filter(event => event.kind === FORM_TEMPLATE_KIND),
  }

  activeCommunityProfileEvents.set(bootstrap.profileEvents)
  activeCommunityProfileListEvents.set(bootstrap.profileListEvents)
  activeCommunityBadgeDefinitionEvents.set(bootstrap.badgeDefinitionEvents)
  activeCommunityAdmissionFormEvents.set(bootstrap.admissionFormEvents)

  return bootstrap
}
