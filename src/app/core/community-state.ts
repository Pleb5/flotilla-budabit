import {browser} from "$app/environment"
import {derived, get, writable, type Readable} from "svelte/store"
import {deriveProfile, pubkey, repository, tracker} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {sortBy} from "@welshman/lib"
import {load} from "@welshman/net"
import {Router} from "@welshman/router"
import type {Filter, TrustedEvent} from "@welshman/util"
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
import {
  makeCommunityStarDeleteFilter,
  makeCommunityStarReactionFilter,
  makeRecentCommunityStarDeleteFilter,
  selectActiveCommunityStars,
  type CommunityStarRef,
} from "@app/util/community-stars"

export const COMMUNITY_SESSION_STORAGE_KEY = "budabit/community-session"

const fromCsv = (value?: string) =>
  String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)

export const DEFAULT_COMMUNITY_INPUT = import.meta.env.VITE_DEFAULT_COMMUNITY || ""
export const COMMUNITY_DISCOVERY_RELAYS = normalizeRelays(
  fromCsv(import.meta.env.VITE_INDEXER_RELAYS),
)

export type CommunitySession = {
  communityPubkey: string
  communityRelayHints: string[]
  communityDefinitionId?: string
}

export type CommunityBootstrap = {
  definition?: CommunityDefinition
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
      communityRelayHints:
        parsed.relays.length || !sameCommunity ? parsed.relays : current.communityRelayHints,
      communityDefinitionId: sameCommunity ? current.communityDefinitionId : undefined,
    }

    return session
  })

  return session
}

export const setActiveCommunityDefinition = (definition: CommunityDefinition) => {
  repository.publish(definition.event)

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
}

export const activeCommunityPubkey: Readable<string | undefined> = derived(
  activeCommunitySession,
  session => session?.communityPubkey,
)

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

export const activeCommunityDefinition: Readable<CommunityDefinition | undefined> = derived(
  activeCommunitySession,
  ($activeCommunitySession, set) => {
    const communityPubkey = $activeCommunitySession?.communityPubkey
    if (!communityPubkey) {
      set(undefined)
      return
    }

    return deriveEventsAsc(
      deriveEventsById({repository, filters: [makeCommunityDefinitionFilter(communityPubkey)]}),
    ).subscribe(events => {
      set(selectLatestCommunityDefinition(events, communityPubkey))
    })
  },
)

export const activeCommunityProfile: Readable<CommunityProfile | undefined> = derived(
  [activeCommunitySession, activeCommunityDefinition],
  ([$activeCommunitySession, $activeCommunityDefinition], set) => {
    const communityPubkey = $activeCommunitySession?.communityPubkey
    if (!communityPubkey) {
      set(undefined)
      return
    }

    const relays = normalizeRelays([
      ...($activeCommunitySession?.communityRelayHints || []),
      ...($activeCommunityDefinition?.pubkey === communityPubkey
        ? $activeCommunityDefinition.relays
        : []),
    ])

    return deriveProfile(communityPubkey, relays).subscribe(set)
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

export const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls() || []
  } catch {
    return []
  }
}

export const getCommunityBootstrapRelays = (relayHints: string[] = []) =>
  normalizeRelays([...relayHints, ...getUserOutboxRelays(), ...COMMUNITY_DISCOVERY_RELAYS])

export const getCommunityDefinitionRelayHints = (
  definition?: CommunityDefinition,
  fallbackRelays: string[] = [],
) => {
  const sourceRelays = definition ? Array.from(tracker.getRelays(definition.event.id)) : []

  return normalizeRelays(sourceRelays.length > 0 ? sourceRelays : fallbackRelays)
}

const COMMUNITY_RELAY_LOAD_TIMEOUT = 5000
const COMMUNITY_STAR_LOAD_TIMEOUT = 1500
const COMMUNITY_STAR_HYDRATION_TTL = 30_000

export const loadCommunityEvents = async (
  relays: string[],
  filters: Filter[],
  options: {timeout?: number} = {},
): Promise<TrustedEvent[]> => {
  const timeoutMs = options.timeout ?? COMMUNITY_RELAY_LOAD_TIMEOUT

  const results = await Promise.all(
    normalizeRelays(relays).map(relay => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      return load({
        relays: [relay],
        filters,
        signal: controller.signal,
        onEvent: (event, url) => tracker.addRelay(event.id, url),
      })
        .catch(() => [])
        .finally(() => clearTimeout(timeout))
    }),
  )

  const events = Array.from(new Map(results.flat().map(event => [event.id, event])).values())

  for (const event of events) {
    repository.publish(event)
  }

  return events
}

const withTimeout = async <T>(promise: Promise<T>, timeout: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>(resolve => {
      timeoutId = setTimeout(() => resolve(fallback), timeout)
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

export const getCommunityStarRelays = (relayHints: string[] = []) => {
  return normalizeRelays([...relayHints, ...getUserOutboxRelays(), ...COMMUNITY_DISCOVERY_RELAYS])
}

export const communityStarsLoading = writable(false)

export const communityStarReactionEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const filter = $pubkey ? makeCommunityStarReactionFilter($pubkey) : undefined

    if (!filter) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters: [filter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityStarDeleteEvents: Readable<TrustedEvent[]> = derived(
  [pubkey, communityStarReactionEvents],
  ([$pubkey, $communityStarReactionEvents], set) => {
    const deleteFilter = $pubkey
      ? makeCommunityStarDeleteFilter($pubkey, $communityStarReactionEvents)
      : undefined

    if (!deleteFilter) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters: [deleteFilter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityStars: Readable<CommunityStarRef[]> = derived(
  [pubkey, communityStarReactionEvents, communityStarDeleteEvents],
  ([$pubkey, $communityStarReactionEvents, $communityStarDeleteEvents]) =>
    selectActiveCommunityStars({
      reactions: $communityStarReactionEvents,
      deleteEvents: $communityStarDeleteEvents,
      author: $pubkey || undefined,
    }),
  [] as CommunityStarRef[],
)

export const activeCommunityStarByCommunity: Readable<Map<string, CommunityStarRef>> = derived(
  activeCommunityStars,
  $activeCommunityStars => new Map($activeCommunityStars.map(star => [star.communityPubkey, star])),
)

let communityStarHydrationKey = ""
let communityStarHydrationRequestId = 0
let communityStarHydratedAt = 0

export const hydrateCommunityStars = async ({
  relayHints = [],
  communityAddress = "",
  force = false,
}: {
  relayHints?: string[]
  communityAddress?: string
  force?: boolean
} = {}) => {
  const user = pubkey.get()
  const reactionFilter = user ? makeCommunityStarReactionFilter(user) : undefined
  const relays = getCommunityStarRelays(relayHints)
  const key = `${user || ""}:${communityAddress || "*"}:${relays.slice().sort().join(",")}`

  if (!user || !reactionFilter || relays.length === 0) {
    communityStarsLoading.set(false)
    communityStarHydrationKey = ""
    communityStarHydratedAt = 0
    return
  }
  if (
    !force &&
    communityStarHydrationKey === key &&
    Date.now() - communityStarHydratedAt < COMMUNITY_STAR_HYDRATION_TTL
  )
    return

  const requestId = ++communityStarHydrationRequestId
  communityStarHydrationKey = key
  communityStarHydratedAt = Date.now()
  communityStarsLoading.set(true)

  try {
    const scopedReactionFilter = communityAddress
      ? {...reactionFilter, "#a": [communityAddress]}
      : reactionFilter

    await withTimeout(
      loadCommunityEvents(relays, [scopedReactionFilter], {timeout: COMMUNITY_STAR_LOAD_TIMEOUT}),
      COMMUNITY_STAR_LOAD_TIMEOUT + 500,
      [],
    )

    if (requestId !== communityStarHydrationRequestId) return

    const cachedReactions = get(communityStarReactionEvents)
    const deleteFilters = [
      makeCommunityStarDeleteFilter(user, cachedReactions),
      makeRecentCommunityStarDeleteFilter(user),
    ].filter(Boolean) as Filter[]

    if (deleteFilters.length > 0) {
      await withTimeout(
        loadCommunityEvents(relays, deleteFilters, {timeout: COMMUNITY_STAR_LOAD_TIMEOUT}),
        COMMUNITY_STAR_LOAD_TIMEOUT + 500,
        [],
      )
    }
  } finally {
    if (requestId === communityStarHydrationRequestId) communityStarsLoading.set(false)
  }
}

export const getProfileListRefs = (definition: CommunityDefinition) =>
  definition.sections.flatMap(section => section.profileLists)

export const getBadgeDefinitionRefs = (definition: CommunityDefinition) =>
  definition.sections.flatMap(section => section.badges)

const makeAddressRefFilter = ({
  kind,
  pubkey,
  identifier,
}: {
  kind: number
  pubkey: string
  identifier: string
}) => ({
  kinds: [kind],
  authors: [pubkey],
  "#d": [identifier],
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

const deriveActiveCommunityEvents = (
  makeFilters: (definition: CommunityDefinition) => Filter[],
): Readable<TrustedEvent[]> =>
  derived(
    activeCommunityDefinition,
    ($activeCommunityDefinition, set) => {
      if (!$activeCommunityDefinition) {
        set([])
        return
      }

      const filters = makeFilters($activeCommunityDefinition)
      if (filters.length === 0) {
        set([])
        return
      }

      return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
    },
    [] as TrustedEvent[],
  )

export const activeCommunityProfileListEvents: Readable<TrustedEvent[]> =
  deriveActiveCommunityEvents(makeCommunityProfileListFilters)

export const activeCommunityBadgeDefinitionEvents: Readable<TrustedEvent[]> =
  deriveActiveCommunityEvents(makeCommunityBadgeDefinitionFilters)

export const activeCommunityAdmissionFormEvents: Readable<TrustedEvent[]> =
  deriveActiveCommunityEvents(makeCommunityAdmissionFormFilters)

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
          moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
            definition,
            sectionName: section.name,
          }),
        })

        return form ? [section.name, form] : undefined
      })
      .filter(Boolean) as Array<[string, CommunityAdmissionForm]>,
  )

export const activeCommunityAdmissionForms: Readable<Record<string, CommunityAdmissionForm>> =
  derived(
    [activeCommunityDefinition, activeCommunityAdmissionFormEvents],
    ([$activeCommunityDefinition, $activeCommunityAdmissionFormEvents]) =>
      $activeCommunityDefinition
        ? selectCommunityAdmissionForms(
            $activeCommunityDefinition,
            $activeCommunityAdmissionFormEvents,
          )
        : {},
  )

export const loadCommunityBootstrap = async (
  session: CommunitySession,
): Promise<CommunityBootstrap> => {
  const relays = getCommunityBootstrapRelays(session.communityRelayHints)
  const definitionEvents = await loadCommunityEvents(relays, [
    makeCommunityDefinitionFilter(session.communityPubkey),
  ])
  const definition = selectLatestCommunityDefinition(definitionEvents, session.communityPubkey)
  const communityRelays = definition?.relays.length ? definition.relays : relays
  const authorityFilters: Filter[] = []
  const admissionFormFilters: Filter[] = []

  if (definition) {
    setActiveCommunityDefinition(definition)
    authorityFilters.push(...makeCommunityProfileListFilters(definition))
    authorityFilters.push(...makeCommunityBadgeDefinitionFilters(definition))
    admissionFormFilters.push(...makeCommunityAdmissionFormFilters(definition))
  }

  const [authorityEvents, admissionFormEvents] = await Promise.all([
    authorityFilters.length > 0 ? loadCommunityEvents(communityRelays, authorityFilters) : [],
    admissionFormFilters.length > 0
      ? loadCommunityEvents(communityRelays, admissionFormFilters)
      : [],
  ])

  const bootstrap = {
    definition,
    profileListEvents: authorityEvents.filter(event => event.kind === PROFILE_LIST_KIND),
    badgeDefinitionEvents: authorityEvents.filter(event => event.kind === BADGE_DEFINITION_KIND),
    admissionFormEvents: admissionFormEvents.filter(event => event.kind === FORM_TEMPLATE_KIND),
  }

  return bootstrap
}
