import {browser} from "$app/environment"
import {derived, get, writable, type Readable, type Writable} from "svelte/store"
import {forceLoadRelayList, pubkey, repository, sign, tracker} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {normalizeUrl, LRUCache} from "@welshman/lib"
import {
  AuthStateEvent,
  AuthStatus,
  makeLoader,
  Pool,
  SocketEvent,
  SocketStatus,
  type AuthState,
} from "@welshman/net"
import {Router} from "@welshman/router"
import {DELETE, PROFILE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
  type CommunityPointer,
  getProfileListPubkeys,
  normalizeRelay,
  normalizePubkey,
  normalizeRelays,
  makeCommunityPointer,
  parseCommunityDefinitionAddress,
  parseAddressRef,
  parseCommunityNaddr,
  parseCommunityDefinition,
  selectCurrentCommunityDefinitions,
} from "@app/core/community"
import {
  getCommunityModeratorRefPubkeys,
  getGrantCapableSectionModeratorPubkeys,
} from "@app/core/community-permissions"
import {findCommunityProfileListEvent} from "@app/core/community-admin"
import {
  type CommunityAdmissionForm,
  parseAdmissionForm,
  selectActiveAdmissionForm,
} from "@app/core/community-forms"
import {
  makeCommunityStarDeleteFilter,
  makeCommunityStarReactionFilter,
  makeRecentCommunityStarDeleteFilter,
  selectActiveCommunityStars,
  type CommunityStarRef,
} from "@app/util/community-stars"
import {
  COMMUNITY_PREFERENCE_LIMIT,
  makeCommunityAdminDefinitionFilter,
  makeCommunityDefinitionProfileListRefFilters,
  makeCommunityModeratorFormFilter,
  makeCommunityModeratorProfileListFilter,
  selectPreferredCommunities,
  type PreferredCommunityRef,
} from "@app/util/community-preferences"
import type {BlossomMemberCommunityRef} from "@app/core/blossom"
import {
  filterExcludedCommunityRefs,
  selectUserCommunityRefs,
  type ActiveUserCommunityRef,
} from "@app/core/community-membership"
import {userRenouncedCommunityAddresses} from "@app/core/community-renunciations"
import {
  MODERATOR_REQUEST_REACTION_KIND,
  getModeratorPromotionRequestStates,
  getModeratorPromotionRequests,
  type ModeratorPromotionRequest,
  type ModeratorPromotionRequestState,
} from "@app/core/community-moderator-requests"
import {
  COMMUNITY_REPORT_KIND,
  COMMUNITY_REPORT_REVIEW_LABEL_KIND,
  COMMUNITY_REPORT_REVIEW_NAMESPACE,
  getEffectiveCommunityReportState,
  type EffectiveCommunityReportState,
} from "@app/core/community-reports"
import {
  RELAY_REQUEST_PRIORITY,
  RelayAuthenticationError,
  getRelayPolicy,
} from "@app/core/relay-policy"
import {FINITE_RELAY_ADMISSION_TIMEOUT_MS} from "@app/core/finite-relay-request"
import {recoverActiveNip46Receiver} from "@app/util/nip46"

export const COMMUNITY_SESSION_STORAGE_KEY = "budabit/community-session"
export const EXACT_COMMUNITY_SESSION_VERSION = 2

export type ExactCommunitySession = {
  version: typeof EXACT_COMMUNITY_SESSION_VERSION
  definition: {
    kind: typeof COMMUNITY_DEFINITION_KIND
    ownerPubkey: string
    communityId: string
  }
  relayHints: string[]
  definitionEventId?: string
}

export const makeExactCommunitySession = (
  pointer: CommunityPointer,
  definitionEventId?: string,
): ExactCommunitySession => ({
  version: EXACT_COMMUNITY_SESSION_VERSION,
  definition: {
    kind: COMMUNITY_DEFINITION_KIND,
    ownerPubkey: pointer.ownerPubkey,
    communityId: pointer.communityId,
  },
  relayHints: [...pointer.relayHints],
  ...(definitionEventId ? {definitionEventId} : {}),
})

export const getExactCommunitySessionPointer = (session: ExactCommunitySession) =>
  makeCommunityPointer({
    ownerPubkey: session.definition.ownerPubkey,
    communityId: session.definition.communityId,
    relayHints: session.relayHints,
  })!

export const parseExactCommunitySession = (raw: string): ExactCommunitySession | undefined => {
  try {
    const value = JSON.parse(raw) as Partial<ExactCommunitySession>
    if (
      value.version !== EXACT_COMMUNITY_SESSION_VERSION ||
      value.definition?.kind !== COMMUNITY_DEFINITION_KIND ||
      !Array.isArray(value.relayHints) ||
      value.relayHints.some(relay => typeof relay !== "string") ||
      (value.definitionEventId !== undefined && typeof value.definitionEventId !== "string")
    ) {
      return undefined
    }
    const pointer = makeCommunityPointer({
      ownerPubkey: value.definition.ownerPubkey || "",
      communityId: value.definition.communityId || "",
      relayHints: value.relayHints,
    })
    if (!pointer) return undefined

    return makeExactCommunitySession(pointer, value.definitionEventId)
  } catch {
    return undefined
  }
}

type CommunitySessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const readExactCommunitySession = (
  storage: CommunitySessionStorage,
): ExactCommunitySession | undefined => {
  const raw = storage.getItem(COMMUNITY_SESSION_STORAGE_KEY)
  if (!raw) return undefined
  const session = parseExactCommunitySession(raw)
  if (!session) storage.removeItem(COMMUNITY_SESSION_STORAGE_KEY)
  return session
}

export const writeExactCommunitySession = (
  storage: CommunitySessionStorage,
  session?: ExactCommunitySession,
) => {
  if (!session) {
    storage.removeItem(COMMUNITY_SESSION_STORAGE_KEY)
    return
  }
  storage.setItem(COMMUNITY_SESSION_STORAGE_KEY, JSON.stringify(session))
}

export const makeExactCommunityDefinitionFilter = (pointer: CommunityPointer): Filter => ({
  kinds: [COMMUNITY_DEFINITION_KIND],
  authors: [pointer.ownerPubkey],
  "#d": [pointer.communityId],
})

export const selectExactCommunityDefinition = (
  events: TrustedEvent[],
  pointer: CommunityPointer,
): CommunityDefinition | undefined => selectCurrentCommunityDefinitions(events).get(pointer.address)

export const selectBoundedCommunityDefinitionDiscovery = (
  events: TrustedEvent[],
  loadComplete: boolean,
  limit: number,
) => {
  const saturated = events.length >= limit

  return {
    definitions: Array.from(selectCurrentCommunityDefinitions(events).values()),
    complete: loadComplete && !saturated,
    saturated,
  }
}

export const getExactCommunityBranchKey = (pointer: CommunityPointer, viewerPubkey = "") =>
  `${normalizePubkey(viewerPubkey)}:${pointer.address}`

type ResolveExactCommunityDefinitionOptions = {
  discoveryRelays?: string[]
  hydrateOwnerOutbox: (ownerPubkey: string, relayHints: string[]) => Promise<string[]>
  loadEvents: (relays: string[], filters: Filter[]) => Promise<TrustedEvent[]>
}

export const resolveExactCommunityDefinition = async (
  pointer: CommunityPointer,
  {discoveryRelays = [], hydrateOwnerOutbox, loadEvents}: ResolveExactCommunityDefinitionOptions,
) => {
  const filters: Filter[] = [
    makeExactCommunityDefinitionFilter(pointer),
    {kinds: [DELETE], authors: [pointer.ownerPubkey]},
  ]
  const initialRelays = Array.from(new Set([...pointer.relayHints, ...discoveryRelays]))
  const initialEvents = initialRelays.length > 0 ? await loadEvents(initialRelays, filters) : []
  const outboxRelays = await hydrateOwnerOutbox(pointer.ownerPubkey, pointer.relayHints)
  const additionalRelays = Array.from(
    new Set(outboxRelays.filter(relay => !initialRelays.includes(relay))),
  )
  const outboxEvents =
    additionalRelays.length > 0 ? await loadEvents(additionalRelays, filters) : []

  return selectExactCommunityDefinition([...initialEvents, ...outboxEvents], pointer)
}

const canUseLocalStorage = () => browser && typeof localStorage !== "undefined"

const getInitialExactCommunitySession = () => {
  if (!canUseLocalStorage()) return undefined
  return readExactCommunitySession(localStorage)
}

export const activeExactCommunitySession = writable<ExactCommunitySession | undefined>(
  getInitialExactCommunitySession(),
)

export const activeExactCommunityPointer: Readable<CommunityPointer | undefined> = derived(
  activeExactCommunitySession,
  session => (session ? getExactCommunitySessionPointer(session) : undefined),
)

export const setActiveExactCommunityPointer = (pointer: CommunityPointer) => {
  activeExactCommunitySession.update(current => {
    const currentPointer = current ? getExactCommunitySessionPointer(current) : undefined
    return makeExactCommunitySession(
      pointer,
      currentPointer?.address === pointer.address ? current?.definitionEventId : undefined,
    )
  })
}

export const setActiveExactCommunityDefinition = (definition: CommunityDefinition) => {
  repository.publish(definition.event)
  activeExactCommunitySession.set(
    makeExactCommunitySession(definition.pointer, definition.event.id),
  )
}

export const activeExactCommunityDefinition: Readable<CommunityDefinition | undefined> = derived(
  activeExactCommunityPointer,
  (pointer, set) => {
    if (!pointer) {
      set(undefined)
      return
    }
    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [
          makeExactCommunityDefinitionFilter(pointer),
          {kinds: [DELETE], authors: [pointer.ownerPubkey]},
        ],
      }),
    ).subscribe(events => set(selectExactCommunityDefinition(events, pointer)))
  },
)

export const activeExactCommunityRelays: Readable<string[]> = derived(
  [activeExactCommunityPointer, activeExactCommunityDefinition],
  ([pointer, definition]) => definition?.relays || pointer?.relayHints || [],
)

export const clearActiveExactCommunity = () => activeExactCommunitySession.set(undefined)

const fromCsv = (value?: string) =>
  String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)

export const DEFAULT_COMMUNITY_INPUT = import.meta.env.VITE_DEFAULT_COMMUNITY || ""
export const DEFAULT_COMMUNITY_POINTER = parseCommunityNaddr(DEFAULT_COMMUNITY_INPUT)
export const COMMUNITY_DISCOVERY_RELAYS = normalizeRelays(
  fromCsv(import.meta.env.VITE_INDEXER_RELAYS),
)

export type CommunityBootstrap = {
  definition?: CommunityDefinition
  profileListEvents: TrustedEvent[]
  admissionFormEvents: TrustedEvent[]
  reportEvents: TrustedEvent[]
  reportDeleteEvents: TrustedEvent[]
  reportReviewEvents: TrustedEvent[]
}

export type CommunityBootstrapStatus = {
  key: string
  loading: boolean
  loaded: boolean
  error?: string
}

export type CommunityPermissionStatus = {
  communityAddress: string
  key: string
  loading: boolean
  loaded: boolean
  complete: boolean
  hasCachedEvents: boolean
  error?: string
}

export type CommunityRelayLoadSettle = "all" | "first" | "first-non-empty"

export type CommunityRelayLoadResult = {
  events: TrustedEvent[]
  complete: boolean
  timedOutRelays: string[]
  failedRelays: string[]
}

export type CommunityRelayLoadOptions = {
  timeout?: number
  authTimeout?: number
  authenticate?: boolean
  priorityAuthRelays?: string[]
  settle?: CommunityRelayLoadSettle
  isSufficientResult?: (events: TrustedEvent[]) => boolean
  priority?: number
  signal?: AbortSignal
  onStart?: (relay: string) => void
  onProgress?: (result: CommunityRelayLoadResult, terminal: boolean) => void
  publishEvents?: boolean
}

export type CommunityHydrationStatus =
  | "idle"
  | "queued"
  | "loading"
  | "complete"
  | "incomplete"
  | "failed"

export type CommunityRelayAuthOptions = {
  timeout?: number
  priorityRelays?: string[]
}

export type CommunityDefinitionLookupOptions = CommunityRelayLoadOptions & {
  relayHints?: string[]
  onOutboxDefinition?: (definition: CommunityDefinition) => void
}

export const activeCommunityBootstrapStatus = writable<CommunityBootstrapStatus>({
  key: "",
  loading: false,
  loaded: false,
})
export const activeCommunityPermissionStatus = writable<CommunityPermissionStatus>({
  communityAddress: "",
  key: "",
  loading: false,
  loaded: false,
  complete: false,
  hasCachedEvents: false,
})
export const activeCommunityAdmissionFormStatus = writable<CommunityPermissionStatus>({
  communityAddress: "",
  key: "",
  loading: false,
  loaded: false,
  complete: false,
  hasCachedEvents: false,
})

const communityBootstrapPromises = new Map<string, Promise<CommunityBootstrap>>()
// Bounded LRU: bootstraps retain full event arrays, so old communities and
// stale relay-hint permutations must not accumulate for the app lifetime.
const completedCommunityBootstrap = new LRUCache<string, CommunityBootstrap>(24)
const completedCommunityHydrationKeys = new Set<string>()
const communityBootstrapPromiseGenerations = new Map<string, number>()
let communityBootstrapCacheVersion = 0
let communityBootstrapGeneration = 0

export const getCommunityBootstrapKey = (session: ExactCommunitySession, userPubkey = "") =>
  `${normalizePubkey(userPubkey)}:${getExactCommunitySessionPointer(session).address}`

export const hasCommunityHydrationCompleted = (key: string) =>
  Boolean(key && completedCommunityHydrationKeys.has(key))

export const markCommunityHydrationCompleted = (key: string) => {
  if (key) completedCommunityHydrationKeys.add(key)
}

export const getCommunityHydrationResultStatus = (
  result: CommunityRelayLoadResult,
): CommunityHydrationStatus => {
  if (result.complete) return "complete"
  if (result.failedRelays.length > 0) return "failed"

  return "incomplete"
}

export const clearCommunityBootstrapCache = (communityAddress?: string) => {
  const matchesCommunity = (key: string) =>
    !communityAddress || key.endsWith(`:${communityAddress}`)

  communityBootstrapCacheVersion += 1

  for (const key of [...completedCommunityBootstrap.map.keys()]) {
    if (matchesCommunity(key)) completedCommunityBootstrap.pop(key)
  }
  for (const key of completedCommunityHydrationKeys) {
    if (matchesCommunity(key)) completedCommunityHydrationKeys.delete(key)
  }
  for (const key of communityBootstrapPromises.keys()) {
    if (matchesCommunity(key)) {
      communityBootstrapPromises.delete(key)
      communityBootstrapPromiseGenerations.delete(key)
    }
  }
}

if (canUseLocalStorage()) {
  activeExactCommunitySession.subscribe(session =>
    writeExactCommunitySession(localStorage, session),
  )
}

export const clearActiveCommunityState = () => {
  clearActiveExactCommunity()
  startCommunityPermissionLoadContext()
  activeCommunityPermissionStatus.set({
    communityAddress: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  })
  activeCommunityAdmissionFormStatus.set({
    communityAddress: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  })
}

const normalizeCommunityBlossomServer = (server?: string) => {
  const value = server?.trim()
  if (!value || !/^https?:\/\//i.test(value)) return ""

  try {
    return normalizeUrl(value)
  } catch {
    return ""
  }
}

export const getCommunityBlossomServers = (definition?: CommunityDefinition) =>
  Array.from(
    new Set(
      (definition?.blossomServers || []).map(normalizeCommunityBlossomServer).filter(Boolean),
    ),
  )

export const activeCommunityBlossomServers: Readable<string[]> = derived(
  activeExactCommunityDefinition,
  getCommunityBlossomServers,
)

export const getActiveCommunityBlossomServers = () => get(activeCommunityBlossomServers)

export const getUserOutboxRelays = () => {
  try {
    return Router.get().FromUser().getUrls() || []
  } catch {
    return []
  }
}

export const getPubkeyOutboxRelays = (pubkeys: string[]) => {
  try {
    return Router.get().FromPubkeys(pubkeys.map(normalizePubkey).filter(Boolean)).getUrls() || []
  } catch {
    return []
  }
}

const COMMUNITY_OUTBOX_RELAY_LOAD_TIMEOUT = 3000
const COMMUNITY_DEFINITION_LOOKUP_TIMEOUT = 3000
const pubkeyOutboxRelayPromises = new Map<string, Promise<string[]>>()

const loadPubkeyOutboxRelays = async (normalizedPubkey: string, relayHints: string[] = []) => {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      forceLoadRelayList(normalizedPubkey, normalizeRelays(relayHints)),
      new Promise(resolve => {
        timeout = setTimeout(resolve, COMMUNITY_OUTBOX_RELAY_LOAD_TIMEOUT)
      }),
    ])
  } catch {
    // Missing or unreachable NIP-65 relay lists are expected for some owners.
  } finally {
    if (timeout) clearTimeout(timeout)
  }

  return normalizeRelays(getPubkeyOutboxRelays([normalizedPubkey]))
}

export const hydratePubkeyOutboxRelays = async (
  communityPubkey: string,
  relayHints: string[] = [],
) => {
  const normalizedPubkey = normalizePubkey(communityPubkey)
  if (!normalizedPubkey) return []

  const cachedRelays = normalizeRelays(getPubkeyOutboxRelays([normalizedPubkey]))
  const pending = pubkeyOutboxRelayPromises.get(normalizedPubkey)
  if (cachedRelays.length > 0) {
    if (!pending) void refreshPubkeyOutboxRelays(normalizedPubkey, relayHints)

    return cachedRelays
  }

  if (pending) return pending

  return refreshPubkeyOutboxRelays(normalizedPubkey, relayHints)
}

export const refreshPubkeyOutboxRelays = async (pubkey: string, relayHints: string[] = []) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return []

  const pending = pubkeyOutboxRelayPromises.get(normalizedPubkey)
  if (pending) return pending

  const promise = loadPubkeyOutboxRelays(normalizedPubkey, relayHints).finally(() => {
    if (pubkeyOutboxRelayPromises.get(normalizedPubkey) === promise) {
      pubkeyOutboxRelayPromises.delete(normalizedPubkey)
    }
  })

  pubkeyOutboxRelayPromises.set(normalizedPubkey, promise)

  return promise
}

export const getCommunityBootstrapRelays = (relayHints: string[] = []) =>
  normalizeRelays([...relayHints, ...getUserOutboxRelays(), ...COMMUNITY_DISCOVERY_RELAYS])

export const getCommunityBadgeRelays = (communityRelays: string[] = []) =>
  normalizeRelays([...communityRelays, ...getUserOutboxRelays(), ...COMMUNITY_DISCOVERY_RELAYS])

export const getCommunityBadgeReadRelays = ({
  communityRelays = [],
  pubkeys = [],
}: {
  communityRelays?: string[]
  pubkeys?: string[]
} = {}) =>
  normalizeRelays([
    ...communityRelays,
    ...getPubkeyOutboxRelays(pubkeys),
    ...getUserOutboxRelays(),
    ...COMMUNITY_DISCOVERY_RELAYS,
  ])

export const getCommunityDefinitionRelayHints = (
  definition?: CommunityDefinition,
  fallbackRelays: string[] = [],
) => {
  const sourceRelays = definition ? Array.from(tracker.getRelays(definition.event.id)) : []

  return normalizeRelays([
    ...(definition?.relays || []),
    ...(sourceRelays.length > 0 ? sourceRelays : fallbackRelays),
  ])
}

const COMMUNITY_RELAY_LOAD_TIMEOUT = 5000
const COMMUNITY_AUTHORITY_LOAD_TIMEOUT = 3000
const COMMUNITY_RELAY_AUTH_TIMEOUT = 2000
const COMMUNITY_RELAY_AUTH_RECOVERY_TIMEOUT = 31_000
export const COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT = 4500
const COMMUNITY_STAR_LOAD_TIMEOUT = 1500
const COMMUNITY_STAR_HYDRATION_TTL = 30_000
const COMMUNITY_PREFERENCE_FAST_LOAD_TIMEOUT = 800
const COMMUNITY_PREFERENCE_LOAD_TIMEOUT = 1500
const COMMUNITY_PREFERENCE_HYDRATION_TTL = 30_000
const COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT = 1500
const COMMUNITY_MODERATOR_REQUEST_HYDRATION_TTL = 30_000
const COMMUNITY_PROFILE_LOAD_TIMEOUT = 3000
const COMMUNITY_PROFILE_HYDRATION_TTL = 30_000
const COMMUNITY_REPORT_DELETE_HYDRATION_TTL = 30_000
const COMMUNITY_RELAY_BATCH_DELAY = 50

const communityStateLoaders = new Map<number, ReturnType<typeof makeLoader>>()

const getCommunityStateLoader = (requestedPriority?: number) => {
  const priority = Number.isFinite(requestedPriority)
    ? Number(requestedPriority)
    : RELAY_REQUEST_PRIORITY.community
  let loader = communityStateLoaders.get(priority)

  if (!loader) {
    loader = makeLoader({delay: COMMUNITY_RELAY_BATCH_DELAY, priority})
    communityStateLoaders.set(priority, loader)
  }

  return loader
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

const dedupeCommunityEvents = (events: TrustedEvent[]) =>
  Array.from(new Map(events.map(event => [event.id, event])).values())

const publishCommunityEvents = (events: TrustedEvent[]) => {
  for (const event of events) {
    repository.publish(event)
  }
}

const makeCompleteEmptyCommunityLoadResult = (): CommunityRelayLoadResult => ({
  events: [],
  complete: true,
  timedOutRelays: [],
  failedRelays: [],
})

const getCommunityLoadFailure = (results: CommunityRelayLoadResult[]) => {
  const failedRelays = Array.from(new Set(results.flatMap(result => result.failedRelays)))

  return failedRelays.length > 0
    ? new Error(`Community relay reads failed: ${failedRelays.join(", ")}`)
    : undefined
}

// Missing profile lists can be pending moderator invitations. Existing list
// evidence is enough for a safe partial projection; absent lists stay inactive.
const hasCachedCommunityEventsForFilters = (filters: Filter[]) =>
  filters.length === 0 || filters.some(filter => repository.query([filter]).length > 0)

type CommunityPermissionLoadContext = {
  viewerPubkey: string
  generation: number
}

type CommunityPermissionLoadAttempt = CommunityPermissionLoadContext & {
  key: string
  filters: Filter[]
  status: Writable<CommunityPermissionStatus>
}

let communityPermissionLoadGeneration = 0
let latestCommunityPermissionLoadGeneration = 0

const startCommunityPermissionLoadContext = (
  viewerPubkey = normalizePubkey(pubkey.get() || ""),
): CommunityPermissionLoadContext => {
  const generation = ++communityPermissionLoadGeneration

  latestCommunityPermissionLoadGeneration = generation

  return {
    viewerPubkey,
    generation,
  }
}

const makeCommunityPermissionStatusKey = (
  definition: CommunityDefinition,
  relays: string[],
  {viewerPubkey, generation}: CommunityPermissionLoadContext,
) => `${viewerPubkey}:${definition.event.id}:${normalizeRelays(relays).join(",")}:${generation}`

export const getCommunityPermissionStatusKeyPrefix = (
  definition: CommunityDefinition,
  relays: string[],
  viewerPubkey: string,
) => `${normalizePubkey(viewerPubkey)}:${definition.event.id}:${normalizeRelays(relays).join(",")}:`

export type CommunityPermissionReadiness = "loading" | "ready" | "unavailable"

export const getCommunityPermissionReadiness = ({
  status,
  communityAddress,
  expectedKeyPrefix,
}: {
  status: CommunityPermissionStatus
  communityAddress: string
  expectedKeyPrefix: string
}): CommunityPermissionReadiness => {
  const matchesCurrentAuthority = Boolean(
    communityAddress &&
    expectedKeyPrefix &&
    status.communityAddress === communityAddress &&
    status.key.startsWith(expectedKeyPrefix),
  )

  if (!matchesCurrentAuthority) return "loading"
  if (status.hasCachedEvents || (status.loaded && status.complete)) return "ready"
  if (status.loading || !status.loaded) return "loading"

  return "unavailable"
}

export type ActiveCommunityPermissionReadiness = {
  communityAddress: string
  key: string
  state: CommunityPermissionReadiness
}

const deriveActiveCommunityPermissionReadiness = (
  status: Readable<CommunityPermissionStatus>,
): Readable<ActiveCommunityPermissionReadiness> =>
  derived(
    [activeExactCommunityDefinition, activeExactCommunityRelays, pubkey, status],
    ([$definition, $relays, $pubkey, $status]) => {
      if (!$definition) {
        return {
          communityAddress: "",
          key: "",
          state: "loading" as CommunityPermissionReadiness,
        }
      }

      const expectedKeyPrefix = getCommunityPermissionStatusKeyPrefix(
        $definition,
        $relays,
        $pubkey || "",
      )

      return {
        communityAddress: $definition.pointer.address,
        key: $status.key,
        state: getCommunityPermissionReadiness({
          status: $status,
          communityAddress: $definition.pointer.address,
          expectedKeyPrefix,
        }),
      }
    },
  )

export const activeCommunityAuthorityReadiness = deriveActiveCommunityPermissionReadiness(
  activeCommunityPermissionStatus,
)
export const activeCommunityAdmissionFormReadiness = deriveActiveCommunityPermissionReadiness(
  activeCommunityAdmissionFormStatus,
)

export type ActiveCommunityDescriptor = {
  community: CommunityPointer
  definition?: CommunityDefinition
  relays: string[]
  authorityReadiness: ActiveCommunityPermissionReadiness
  admissionFormReadiness: ActiveCommunityPermissionReadiness
}

export const isCommunityDescriptorReady = (
  descriptor: ActiveCommunityDescriptor | undefined,
  communityAddress: string,
) =>
  Boolean(
    descriptor &&
    descriptor.community.address === communityAddress &&
    descriptor.definition?.pointer.address === communityAddress &&
    descriptor.authorityReadiness.communityAddress === communityAddress &&
    descriptor.authorityReadiness.state === "ready",
  )

const getDescriptorReadiness = (
  readiness: ActiveCommunityPermissionReadiness,
  communityAddress: string,
  expectedKeyPrefix: string,
): ActiveCommunityPermissionReadiness =>
  readiness.communityAddress === communityAddress &&
  expectedKeyPrefix &&
  readiness.key.startsWith(expectedKeyPrefix)
    ? readiness
    : {communityAddress, key: "", state: "loading"}

export const activeCommunityDescriptor: Readable<ActiveCommunityDescriptor | undefined> = derived(
  [
    activeExactCommunityPointer,
    activeExactCommunityDefinition,
    activeCommunityAuthorityReadiness,
    activeCommunityAdmissionFormReadiness,
    pubkey,
  ],
  ([community, definition, authorityReadiness, admissionFormReadiness, viewerPubkey]) => {
    if (!community) return undefined

    const exactDefinition =
      definition?.pointer.address === community.address ? definition : undefined
    const relays = exactDefinition?.relays || community.relayHints
    const expectedKeyPrefix = exactDefinition
      ? getCommunityPermissionStatusKeyPrefix(exactDefinition, relays, viewerPubkey || "")
      : ""

    return {
      community,
      definition: exactDefinition,
      relays,
      authorityReadiness: getDescriptorReadiness(
        authorityReadiness,
        community.address,
        expectedKeyPrefix,
      ),
      admissionFormReadiness: getDescriptorReadiness(
        admissionFormReadiness,
        community.address,
        expectedKeyPrefix,
      ),
    }
  },
)

const startCommunityPermissionLoadStatus = ({
  definition,
  relays,
  filters,
  context,
  status = activeCommunityPermissionStatus,
}: {
  definition: CommunityDefinition
  relays: string[]
  filters: Filter[]
  context: CommunityPermissionLoadContext
  status?: Writable<CommunityPermissionStatus>
}): CommunityPermissionLoadAttempt => {
  const key = makeCommunityPermissionStatusKey(definition, relays, context)
  const hasCachedEvents = hasCachedCommunityEventsForFilters(filters)
  const hasFilters = filters.length > 0

  if (context.generation === latestCommunityPermissionLoadGeneration) {
    status.set({
      communityAddress: definition.pointer.address,
      key,
      loading: hasFilters,
      loaded: !hasFilters,
      complete: !hasFilters,
      hasCachedEvents,
    })
  }

  return {...context, key, filters, status}
}

const updateCommunityPermissionLoadStatus = (
  attempt: CommunityPermissionLoadAttempt,
  {result, terminal, error}: {result: CommunityRelayLoadResult; terminal: boolean; error?: unknown},
) => {
  if (!attempt.key) return

  attempt.status.update(current => {
    if (current.key !== attempt.key) return current

    const hasCachedEvents = hasCachedCommunityEventsForFilters(attempt.filters)

    return {
      ...current,
      loading: !terminal,
      loaded: terminal || hasCachedEvents,
      complete: result.complete,
      hasCachedEvents,
      ...(terminal && error ? {error: error instanceof Error ? error.message : String(error)} : {}),
    }
  })
}

export const getDefaultCommunityRelayHints = () => DEFAULT_COMMUNITY_POINTER?.relayHints || []

export const getCommunityAuthWarmupRelays = (
  session?: ExactCommunitySession,
  activeRelays: string[] = [],
) =>
  normalizeRelays([
    ...activeRelays,
    ...(session?.relayHints || []),
    ...getDefaultCommunityRelayHints(),
  ])

export const orderCommunityAuthRelays = (relays: string[], priorityRelays: string[] = []) => {
  const normalizedRelays = normalizeRelays(relays)
  const prioritySet = new Set(normalizeRelays(priorityRelays))

  if (prioritySet.size === 0) return normalizedRelays

  return normalizeRelays([
    ...normalizedRelays.filter(relay => prioritySet.has(relay)),
    ...normalizedRelays.filter(relay => !prioritySet.has(relay)),
  ])
}

const communityRelayAuthPromises = new WeakMap<object, Promise<void>>()
const COMMUNITY_RELAY_AUTH_TERMINAL_STATUSES = [
  AuthStatus.Ok,
  AuthStatus.Forbidden,
  AuthStatus.DeniedSignature,
]

export class RelayAuthenticationTimeoutError extends Error {
  readonly name = "RelayAuthenticationTimeoutError"

  constructor(
    readonly relay: string,
    readonly timeout: number,
  ) {
    super(`Authentication timed out for ${relay} after ${timeout}ms`)
  }
}

export const waitForCommunityRelayAuth = (auth: AuthState, timeout: number) => {
  if (COMMUNITY_RELAY_AUTH_TERMINAL_STATUSES.includes(auth.status)) {
    return Promise.resolve(auth.status)
  }

  return new Promise<AuthStatus>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      auth.off(AuthStateEvent.Status, handleAuthStatus)
      auth.socket.off(SocketEvent.Status, handleSocketStatus)
      auth.socket.off(SocketEvent.Error, handleSocketError)
    }
    const finish = (status: AuthStatus) => {
      cleanup()
      resolve(status)
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    const handleAuthStatus = (status: AuthStatus) => {
      if (COMMUNITY_RELAY_AUTH_TERMINAL_STATUSES.includes(status)) finish(status)
    }
    const handleSocketStatus = (status: SocketStatus) => {
      if ([SocketStatus.Closed, SocketStatus.Error].includes(status)) {
        fail(new RelayAuthenticationError(auth.socket.url, status))
      }
    }
    const handleSocketError = (error: string) => {
      fail(new RelayAuthenticationError(auth.socket.url, error || SocketStatus.Error))
    }
    const timer = setTimeout(
      () => fail(new RelayAuthenticationTimeoutError(auth.socket.url, timeout)),
      timeout,
    )

    auth.on(AuthStateEvent.Status, handleAuthStatus)
    auth.socket.on(SocketEvent.Status, handleSocketStatus)
    auth.socket.on(SocketEvent.Error, handleSocketError)
  })
}

const authenticateCommunityRelay = async (
  relay: string,
  timeout: number,
  retryDeniedSignature = false,
): Promise<void> => {
  const authPolicy = getRelayPolicy(relay).auth
  if (authPolicy === "none" || (authPolicy !== "required" && !retryDeniedSignature)) return

  const socket = Pool.get().get(relay)
  const auth = socket.auth
  const hasRecoverableChallenge = Boolean(retryDeniedSignature && auth.challenge)

  if (authPolicy !== "required" && !hasRecoverableChallenge) return

  if (auth.status === AuthStatus.Ok) return
  if (auth.status === AuthStatus.Forbidden) {
    throw new RelayAuthenticationError(relay, auth.status)
  }
  if (retryDeniedSignature && auth.status === AuthStatus.DeniedSignature && !auth.challenge) {
    throw new RelayAuthenticationError(relay, auth.status)
  }

  const pending = communityRelayAuthPromises.get(socket)
  if (pending) {
    if (retryDeniedSignature && auth.status === AuthStatus.DeniedSignature && auth.challenge) {
      await pending.catch(() => undefined)
      return authenticateCommunityRelay(relay, timeout, true)
    }

    return pending
  }

  const promise = (async () => {
    const initialAuthStatus = auth.status
    const signAuthEvent: typeof sign = async event => {
      try {
        return await sign(event)
      } catch (error) {
        if (auth.status === AuthStatus.PendingSignature) {
          auth.setStatus(AuthStatus.DeniedSignature)
        }

        throw error
      }
    }
    let authOperation: Promise<void> | undefined

    if (
      (retryDeniedSignature && auth.status === AuthStatus.DeniedSignature) ||
      [AuthStatus.None, AuthStatus.Requested].includes(auth.status)
    ) {
      authOperation = (async () => {
        let attemptedChallenge = auth.challenge
        let retryDenied = retryDeniedSignature && auth.status === AuthStatus.DeniedSignature

        do {
          await (retryDenied ? auth.retryAuth(signAuthEvent) : auth.attemptAuth(signAuthEvent))
          retryDenied = false

          if (COMMUNITY_RELAY_AUTH_TERMINAL_STATUSES.includes(auth.status)) return
          if (auth.status !== AuthStatus.Requested || auth.challenge === attemptedChallenge) return

          attemptedChallenge = auth.challenge
        } while (auth.status === AuthStatus.Requested)
      })()
    }

    void authOperation?.catch(() => {
      if (auth.status === AuthStatus.PendingSignature) {
        auth.setStatus(AuthStatus.DeniedSignature)
      }
    })

    let status = await waitForCommunityRelayAuth(auth, timeout)

    if (
      status === AuthStatus.DeniedSignature &&
      retryDeniedSignature &&
      auth.challenge &&
      [AuthStatus.PendingSignature, AuthStatus.PendingResponse].includes(initialAuthStatus)
    ) {
      const retry = auth.retryAuth(signAuthEvent)
      const terminalStatus = waitForCommunityRelayAuth(auth, timeout)
      void retry.catch(() => undefined)
      status = await terminalStatus
    }

    if (status !== AuthStatus.Ok) {
      throw new RelayAuthenticationError(relay, status)
    }
  })().finally(() => {
    if (communityRelayAuthPromises.get(socket) === promise) {
      communityRelayAuthPromises.delete(socket)
    }
  })

  communityRelayAuthPromises.set(socket, promise)

  return promise
}

export const recoverCommunityRelayAuth = async (
  relay: string,
  options: {timeout?: number} = {},
) => {
  if (!get(pubkey)) return

  const normalizedRelay = normalizeRelay(relay)
  if (!normalizedRelay) return

  return authenticateCommunityRelay(
    normalizedRelay,
    options.timeout ?? COMMUNITY_RELAY_AUTH_RECOVERY_TIMEOUT,
    true,
  )
}

export const authenticateCommunityRelays = async (
  relays: string[],
  options: CommunityRelayAuthOptions = {},
) => {
  if (!get(pubkey)) return []

  const timeout = options.timeout ?? COMMUNITY_RELAY_AUTH_TIMEOUT
  const orderedRelays = orderCommunityAuthRelays(relays, options.priorityRelays)
  const prioritySet = new Set(normalizeRelays(options.priorityRelays || []))
  const priorityRelays = orderedRelays.filter(relay => prioritySet.has(relay))
  const fallbackRelays = orderedRelays.filter(relay => !prioritySet.has(relay))
  const failedRelays: string[] = []

  for (const relay of priorityRelays) {
    try {
      await authenticateCommunityRelay(relay, timeout)
    } catch {
      failedRelays.push(relay)
    }
  }

  const fallbackResults = await Promise.allSettled(
    fallbackRelays.map(relay => authenticateCommunityRelay(relay, timeout)),
  )

  fallbackResults.forEach((result, index) => {
    if (result.status === "rejected") failedRelays.push(fallbackRelays[index])
  })

  return failedRelays
}

export const loadCommunityEventsWithStatus = async (
  relays: string[],
  filters: Filter[],
  options: CommunityRelayLoadOptions = {},
): Promise<CommunityRelayLoadResult> => {
  const timeoutMs = options.timeout ?? COMMUNITY_RELAY_LOAD_TIMEOUT
  const settle = options.settle ?? "all"
  const normalizedRelays = normalizeRelays(relays)
  let authFailedRelays: string[] = []

  if (filters.length === 0) {
    const result = {events: [], complete: true, timedOutRelays: [], failedRelays: []}
    options.onProgress?.(result, true)
    return result
  }
  if (normalizedRelays.length === 0) {
    const result = {events: [], complete: false, timedOutRelays: [], failedRelays: []}
    options.onProgress?.(result, true)
    return result
  }

  if (options.authenticate) {
    authFailedRelays = await authenticateCommunityRelays(normalizedRelays, {
      priorityRelays: options.priorityAuthRelays,
      timeout: options.authTimeout,
    })
  }

  const readableRelays = normalizedRelays.filter(relay => !authFailedRelays.includes(relay))
  if (readableRelays.length === 0) {
    const result = {
      events: [],
      complete: false,
      timedOutRelays: [],
      failedRelays: authFailedRelays,
    }
    options.onProgress?.(result, true)
    return result
  }

  const loadRelay = async (relay: string) => {
    const controller = new AbortController()
    const receivedEvents: TrustedEvent[] = []
    let disconnected = false
    let rejected = false
    let aborted = false
    let started = false
    let terminated = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let resolveTermination:
      | ((outcome: {status: "timeout" | "aborted"; events: TrustedEvent[]}) => void)
      | undefined
    const termination = new Promise<{status: "timeout" | "aborted"; events: TrustedEvent[]}>(
      resolve => {
        resolveTermination = resolve
      },
    )
    const startTimeout = (delay: number) => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => terminate("timeout"), delay)
    }
    const terminate = (status: "timeout" | "aborted") => {
      if (terminated) return
      terminated = true
      resolveTermination?.({status, events: []})
      controller.abort()
    }
    const handleAbort = () => {
      aborted = true
      terminate("aborted")
    }

    try {
      if (options.signal?.aborted) {
        return {
          relay,
          events: [],
          complete: false,
          timedOut: false,
          failed: false,
        }
      }

      options.signal?.addEventListener("abort", handleAbort, {once: true})
      startTimeout(Math.max(FINITE_RELAY_ADMISSION_TIMEOUT_MS, timeoutMs))
      const outcome = await Promise.race([
        getCommunityStateLoader(options.priority)({
          relays: [relay],
          filters,
          signal: controller.signal,
          priority: options.priority,
          onStart: url => {
            if (terminated) return
            if (!started) {
              started = true
              startTimeout(timeoutMs)
            }
            options.onStart?.(url)
          },
          onEvent: (event, url) => {
            tracker.addRelay(event.id, url)
            receivedEvents.push(event)
            if (options.publishEvents !== false) repository.publish(event)
          },
          onDisconnect: () => {
            disconnected = true
          },
          onClosed: () => {
            rejected = true
          },
        })
          .then(events => ({status: "complete" as const, events}))
          .catch(() => ({status: "failed" as const, events: [] as TrustedEvent[]})),
        termination,
      ])
      const events = dedupeCommunityEvents([...receivedEvents, ...outcome.events])
      if (options.publishEvents !== false) publishCommunityEvents(events)

      return {
        relay,
        events,
        complete: outcome.status === "complete" && !disconnected && !rejected && !aborted,
        timedOut: outcome.status === "timeout",
        failed: !aborted && (outcome.status === "failed" || disconnected || rejected),
      }
    } catch {
      return {
        relay,
        events: dedupeCommunityEvents(receivedEvents),
        complete: false,
        timedOut: false,
        failed: true,
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener("abort", handleAbort)
    }
  }

  type RelayResult = Awaited<ReturnType<typeof loadRelay>>
  const summarize = (results: RelayResult[]): CommunityRelayLoadResult => ({
    events: dedupeCommunityEvents(results.flatMap(result => result.events)),
    complete:
      authFailedRelays.length === 0 &&
      results.length === readableRelays.length &&
      results.every(result => result.complete),
    timedOutRelays: results.filter(result => result.timedOut).map(result => result.relay),
    failedRelays: Array.from(
      new Set([
        ...authFailedRelays,
        ...results.filter(result => result.failed).map(result => result.relay),
      ]),
    ),
  })
  const relayPromises = readableRelays.map(loadRelay)

  if (settle === "all") {
    const results = await Promise.all(relayPromises)
    const result = summarize(results)

    options.onProgress?.(result, true)
    return result
  }

  return new Promise(resolve => {
    let settled = 0
    let resolved = false
    const collectedResults: RelayResult[] = []

    const resolveOnce = (results: RelayResult[]) => {
      if (resolved) return
      resolved = true
      resolve(summarize(results))
    }

    for (const promise of relayPromises) {
      promise.then(result => {
        settled += 1
        collectedResults.push(result)
        const terminal = settled === relayPromises.length

        options.onProgress?.(summarize(collectedResults), terminal)

        if (settle === "first") {
          resolveOnce([result])
        } else if (
          result.events.length > 0 &&
          (options.isSufficientResult?.(result.events) ?? true)
        ) {
          resolveOnce([result])
        }

        if (terminal) {
          resolveOnce(collectedResults)
        }
      })
    }
  })
}

export const loadCommunityEvents = async (
  relays: string[],
  filters: Filter[],
  options: CommunityRelayLoadOptions = {},
): Promise<TrustedEvent[]> => (await loadCommunityEventsWithStatus(relays, filters, options)).events

export const hydrateCommunityEventsWithStatus = async ({
  key,
  relays,
  filters,
  onStatus,
  ...options
}: CommunityRelayLoadOptions & {
  key: string
  relays: string[]
  filters: Filter[]
  onStatus?: (status: CommunityHydrationStatus) => void
}): Promise<CommunityRelayLoadResult> => {
  if (hasCommunityHydrationCompleted(key)) {
    const result = {
      events: filters.length > 0 ? repository.query(filters) : [],
      complete: true,
      timedOutRelays: [],
      failedRelays: [],
    }

    onStatus?.("complete")
    return result
  }

  onStatus?.("queued")

  try {
    const result = await loadCommunityEventsWithStatus(relays, filters, {
      ...options,
      onStart: relay => {
        options.onStart?.(relay)
        if (!options.signal?.aborted) onStatus?.("loading")
      },
    })
    const status = getCommunityHydrationResultStatus(result)

    if (status === "complete") markCommunityHydrationCompleted(key)
    if (!options.signal?.aborted) onStatus?.(status)

    return result
  } catch {
    const result = {
      events: [] as TrustedEvent[],
      complete: false,
      timedOutRelays: [],
      failedRelays: normalizeRelays(relays),
    }

    if (!options.signal?.aborted) onStatus?.("failed")
    return result
  }
}

export const loadCommunityDefinitionFromRelays = async (
  pointer: CommunityPointer,
  relays: string[],
  options: CommunityRelayLoadOptions = {},
) => {
  const result = await loadCommunityEventsWithStatus(
    normalizeRelays(relays),
    [makeExactCommunityDefinitionFilter(pointer)],
    {
      settle: "first-non-empty",
      isSufficientResult: events => Boolean(selectExactCommunityDefinition(events, pointer)),
      ...options,
    },
  )
  const definitionEvents = result.events

  const definition = selectExactCommunityDefinition(definitionEvents, pointer)
  if (definition) return definition

  if (!result.complete && (result.failedRelays.length > 0 || result.timedOutRelays.length > 0)) {
    const unavailableRelays = [...result.failedRelays, ...result.timedOutRelays]
    throw new CommunityDefinitionRelayError(
      `Community definition relay lookup did not complete (${Array.from(new Set(unavailableRelays)).join(", ")}).`,
    )
  }

  return undefined
}

export class CommunityDefinitionRelayError extends Error {}

export const loadCommunityDefinitionWithOutboxFallback = async (
  pointer: CommunityPointer,
  {relayHints = [], onOutboxDefinition, ...loadOptions}: CommunityDefinitionLookupOptions = {},
) => {
  const definitionLoadOptions = {
    ...loadOptions,
    timeout: loadOptions.timeout ?? COMMUNITY_DEFINITION_LOOKUP_TIMEOUT,
  }
  const discoveryRelays = normalizeRelays([...relayHints, ...COMMUNITY_DISCOVERY_RELAYS])
  let relayError: CommunityDefinitionRelayError | undefined
  const tolerateLookupFailure = async (promise: Promise<CommunityDefinition | undefined>) =>
    promise.catch(error => {
      if (error instanceof CommunityDefinitionRelayError) relayError ||= error
      return undefined
    })

  // Kick off the indexer lookup and the outbox lookup in parallel so cold
  // cases resolve in max(indexer, outbox) wall time rather than indexer +
  // outbox. Whichever returns first (and has a definition) is used; the
  // slower one still runs to give the caller a chance to see a newer
  // version via `onOutboxDefinition`.
  const indexerPromise = tolerateLookupFailure(
    loadCommunityDefinitionFromRelays(pointer, discoveryRelays, definitionLoadOptions),
  )
  const outboxRelaysPromise = hydratePubkeyOutboxRelays(pointer.ownerPubkey, discoveryRelays)
  const outboxPromise = (async () => {
    const outboxRelays = await outboxRelaysPromise
    if (!outboxRelays?.length) return undefined
    const outboxDefinition = await tolerateLookupFailure(
      loadCommunityDefinitionFromRelays(pointer, outboxRelays, definitionLoadOptions),
    )

    if (outboxDefinition) onOutboxDefinition?.(outboxDefinition)

    return outboxDefinition
  })()

  // Race for the first non-empty result; if both return undefined we still
  // resolve so the caller can fall back to cached repository data.
  const firstDefinition = await Promise.race<CommunityDefinition | undefined>([
    indexerPromise.then(def => def ?? new Promise<undefined>(() => undefined)),
    outboxPromise.then(def => def ?? new Promise<undefined>(() => undefined)),
    Promise.all([indexerPromise, outboxPromise]).then(([a, b]) => a ?? b),
  ])

  if (firstDefinition) {
    // Let the slower path finish in the background so a newer version can
    // still land in the repository via onOutboxDefinition/publish.
    void Promise.allSettled([indexerPromise, outboxPromise])
    return firstDefinition
  }

  // Both returned undefined; return the settled result (still undefined).
  const [indexerResult, outboxResult] = await Promise.all([indexerPromise, outboxPromise])
  if (!indexerResult && !outboxResult && relayError) throw relayError
  return indexerResult ?? outboxResult
}

const profileHydratedAt = new Map<string, number>()
const profileHydrationPromises = new Map<string, Promise<TrustedEvent[]>>()

export const hydratePubkeyProfiles = async ({
  pubkeys,
  relayHints = [],
  force = false,
  signal,
  timeout = COMMUNITY_PROFILE_LOAD_TIMEOUT,
}: {
  pubkeys: string[]
  relayHints?: string[]
  force?: boolean
  signal?: AbortSignal
  timeout?: number
}) => {
  const authors = Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))
  const relays = normalizeRelays(relayHints)
  const key = `${authors.join(",")}:${relays.slice().sort().join(",")}`

  if (authors.length === 0 || relays.length === 0 || !key) return []
  if (!force && (profileHydratedAt.get(key) || 0) > Date.now() - COMMUNITY_PROFILE_HYDRATION_TTL) {
    return []
  }

  const pending = profileHydrationPromises.get(key)
  if (pending) return pending

  const promise = loadCommunityEvents(
    relays,
    [{kinds: [PROFILE], authors, limit: authors.length}],
    {timeout, authenticate: true, signal},
  )
    .then(events => {
      if (events.length > 0) profileHydratedAt.set(key, Date.now())

      return events
    })
    .finally(() => {
      if (profileHydrationPromises.get(key) === promise) profileHydrationPromises.delete(key)
    })

  profileHydrationPromises.set(key, promise)

  return promise
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

export const activeCommunityStarByAddress: Readable<Map<string, CommunityStarRef>> = derived(
  activeCommunityStars,
  $activeCommunityStars =>
    new Map($activeCommunityStars.map(star => [star.community.address, star])),
)

export const communityAdminDefinitionEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const filter = $pubkey ? makeCommunityAdminDefinitionFilter($pubkey) : undefined

    if (!filter) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters: [filter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityModeratorFormEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const filter = $pubkey ? makeCommunityModeratorFormFilter($pubkey) : undefined

    if (!filter) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters: [filter]})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityModeratorProfileListEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const filter = $pubkey ? makeCommunityModeratorProfileListFilter($pubkey) : undefined

    if (!filter) {
      set([])
      return
    }

    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [filter],
      }),
    ).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityModeratorDefinitionEvents: Readable<TrustedEvent[]> = derived(
  [communityModeratorProfileListEvents, communityModeratorFormEvents],
  ([$communityModeratorProfileListEvents, $communityModeratorFormEvents], set) => {
    const profileListCommunityRefs = getCommunityDefinitionRefsFromEvents(
      $communityModeratorProfileListEvents,
    )
    const formCommunities = Array.from(
      new Map(
        $communityModeratorFormEvents.flatMap(event => {
          const community = parseAdmissionForm(event)?.community
          return community ? [[community.address, community] as const] : []
        }),
      ).values(),
    )
    const filters = [
      ...makeCommunityDefinitionProfileListRefFilters($communityModeratorProfileListEvents),
      ...profileListCommunityRefs.map(makeExactCommunityDefinitionFilter),
      ...formCommunities.map(makeExactCommunityDefinitionFilter),
    ]

    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityMemberProfileListEvents: Readable<TrustedEvent[]> = derived(
  pubkey,
  ($pubkey, set) => {
    const normalizedPubkey = normalizePubkey($pubkey || "")

    if (!normalizedPubkey) {
      set([])
      return
    }

    return deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [
          {
            kinds: [PROFILE_LIST_KIND],
            "#p": [normalizedPubkey],
            limit: COMMUNITY_PREFERENCE_LIMIT,
          },
        ],
      }),
    ).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityMemberDefinitionEvents: Readable<TrustedEvent[]> = derived(
  communityMemberProfileListEvents,
  ($communityMemberProfileListEvents, set) => {
    const filters = makeCommunityDefinitionProfileListRefFilters($communityMemberProfileListEvents)

    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

const dedupeTrustedEvents = (events: TrustedEvent[]) =>
  Array.from(
    new Map(events.filter(event => event.id).map(event => [event.id, event])).values(),
  ).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))

const getCommunityDefinitionRefsFromEvents = (events: TrustedEvent[]) =>
  Array.from(
    new Map(
      events.flatMap(event =>
        event.tags.flatMap(tag => {
          if (tag[0] !== "a") return []

          const ref = parseCommunityDefinitionAddress(tag[1] || "")
          if (!ref) return []

          return [[ref.address, {...ref, relayHints: normalizeRelays([tag[2] || ""])}] as const]
        }),
      ),
    ).values(),
  )

const selectLatestDefinitionsByAddress = (events: TrustedEvent[]) => {
  return Array.from(selectCurrentCommunityDefinitions(events).values())
}

const makeCommunityDefinitionDiscoveryFilter = (): Filter => ({
  kinds: [COMMUNITY_DEFINITION_KIND],
  limit: COMMUNITY_PREFERENCE_LIMIT,
})

const selectModeratorDiscoveryDefinitionEvents = (events: TrustedEvent[], author: string) => {
  const normalizedAuthor = normalizePubkey(author)
  if (!normalizedAuthor) return []

  return events.filter(event => {
    const definition = parseCommunityDefinition(event)

    return definition?.sections.some(section =>
      section.profileLists.some(
        profileList =>
          normalizePubkey(profileList.address.split(":")[1] || "") === normalizedAuthor,
      ),
    )
  })
}

const loadDiscoveredMemberProfileLists = async (
  definitions: CommunityDefinition[],
  memberPubkey: string,
) => {
  const filtersByRelay = new Map<string, Map<string, Filter>>()

  for (const definition of definitions) {
    for (const profileList of getProfileListRefs(definition)) {
      const address = parseAddressRef(profileList.address)
      if (!address) continue
      const filter: Filter = {...makeAddressRefFilter(profileList), "#p": [memberPubkey]}
      const relays = normalizeRelays([
        ...definition.relays,
        ...(profileList.relay ? [profileList.relay] : []),
      ])

      for (const relay of relays) {
        const relayFilters = filtersByRelay.get(relay) || new Map<string, Filter>()
        relayFilters.set(profileList.address, filter)
        relayFilters.set(`${profileList.address}:delete`, {
          kinds: [DELETE],
          "#a": [profileList.address],
          limit: 200,
        })
        filtersByRelay.set(relay, relayFilters)
      }
    }
  }

  const profileListEvents = await Promise.all(
    Array.from(filtersByRelay, ([relay, filters]) =>
      withTimeout(
        loadCommunityEvents([relay], Array.from(filters.values()), {
          timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
          authenticate: true,
        }),
        COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
        [] as TrustedEvent[],
      ),
    ),
  )

  return dedupeTrustedEvents(profileListEvents.flat())
}

const selectMemberDiscoveryDefinitionEvents = (
  definitions: CommunityDefinition[],
  profileListEvents: TrustedEvent[],
  memberPubkey: string,
) => {
  const currentProfileListEvents = selectCurrentDefinitionProfileListEvents(
    definitions,
    profileListEvents,
  )
  const profileListAddresses = new Set(
    currentProfileListEvents.flatMap(event => {
      if (!getProfileListPubkeys(event).includes(memberPubkey)) return []

      const identifier = event.tags.find(tag => tag[0] === "d")?.[1]

      return identifier ? [`${event.kind}:${event.pubkey}:${identifier}`] : []
    }),
  )

  return definitions
    .filter(definition =>
      getProfileListRefs(definition).some(profileList =>
        profileListAddresses.has(profileList.address),
      ),
    )
    .map(definition => definition.event)
}

const activeUserCommunityDefinitionEvents: Readable<TrustedEvent[]> = derived(
  [
    communityMemberDefinitionEvents,
    communityAdminDefinitionEvents,
    communityModeratorDefinitionEvents,
  ],
  ([
    $communityMemberDefinitionEvents,
    $communityAdminDefinitionEvents,
    $communityModeratorDefinitionEvents,
  ]) =>
    dedupeTrustedEvents([
      ...$communityMemberDefinitionEvents,
      ...$communityAdminDefinitionEvents,
      ...$communityModeratorDefinitionEvents,
    ]),
  [] as TrustedEvent[],
)

export const communityMemberReportEvents: Readable<TrustedEvent[]> = derived(
  activeUserCommunityDefinitionEvents,
  ($activeUserCommunityDefinitionEvents, set) => {
    const filters = selectLatestDefinitionsByAddress($activeUserCommunityDefinitionEvents).flatMap(
      definition => makeCommunityReportFilters(definition.pointer),
    )

    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityMemberReportDeleteEvents: Readable<TrustedEvent[]> = derived(
  communityMemberReportEvents,
  ($communityMemberReportEvents, set) => {
    const filters = makeCommunityReportDeleteFilters($communityMemberReportEvents)

    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const communityMemberReportStates: Readable<Map<string, EffectiveCommunityReportState>> =
  derived(
    [
      activeUserCommunityDefinitionEvents,
      communityMemberProfileListEvents,
      communityModeratorProfileListEvents,
      communityMemberReportEvents,
      communityMemberReportDeleteEvents,
    ],
    ([
      $activeUserCommunityDefinitionEvents,
      $communityMemberProfileListEvents,
      $communityModeratorProfileListEvents,
      $communityMemberReportEvents,
      $communityMemberReportDeleteEvents,
    ]) => {
      const states = new Map<string, EffectiveCommunityReportState>()

      for (const definition of selectLatestDefinitionsByAddress(
        $activeUserCommunityDefinitionEvents,
      )) {
        states.set(
          definition.pointer.address,
          getEffectiveCommunityReportState({
            community: definition.pointer,
            definition,
            profileListEvents: dedupeTrustedEvents([
              ...$communityMemberProfileListEvents,
              ...$communityModeratorProfileListEvents,
            ]),
            reportEvents: $communityMemberReportEvents,
            deleteEvents: $communityMemberReportDeleteEvents,
          }),
        )
      }

      return states
    },
    new Map<string, EffectiveCommunityReportState>(),
  )

export const rawActiveUserCommunityRefs: Readable<ActiveUserCommunityRef[]> = derived(
  [
    pubkey,
    activeUserCommunityDefinitionEvents,
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    communityMemberReportStates,
  ],
  ([
    $pubkey,
    $activeUserCommunityDefinitionEvents,
    $communityMemberProfileListEvents,
    $communityModeratorProfileListEvents,
    $communityMemberReportStates,
  ]) =>
    selectUserCommunityRefs({
      author: $pubkey || undefined,
      definitionEvents: $activeUserCommunityDefinitionEvents,
      profileListEvents: dedupeTrustedEvents([
        ...$communityMemberProfileListEvents,
        ...$communityModeratorProfileListEvents,
      ]),
      reportStates: $communityMemberReportStates,
    }),
  [] as ActiveUserCommunityRef[],
)

export const activeUserCommunityRefs: Readable<ActiveUserCommunityRef[]> = derived(
  [rawActiveUserCommunityRefs, userRenouncedCommunityAddresses],
  ([$rawActiveUserCommunityRefs, $userRenouncedCommunityAddresses]) =>
    filterExcludedCommunityRefs($rawActiveUserCommunityRefs, $userRenouncedCommunityAddresses),
  [] as ActiveUserCommunityRef[],
)

export const activeUserCommunityBlossomRefs: Readable<BlossomMemberCommunityRef[]> = derived(
  activeUserCommunityRefs,
  $activeUserCommunityRefs =>
    $activeUserCommunityRefs.flatMap(ref => {
      const definition = ref.definition
      const blossomServers = definition.blossomServers
      if (blossomServers.length === 0) return []

      return [
        {
          communityAddress: definition.pointer.address,
          communityPubkey: ref.community.ownerPubkey,
          communityName: definition.metadata.name,
          relayHints: ref.relayHints,
          blossomServers,
          writableSections: ref.writableSections,
        } satisfies BlossomMemberCommunityRef,
      ]
    }),
  [] as BlossomMemberCommunityRef[],
)

export const activePreferredCommunities: Readable<PreferredCommunityRef[]> = derived(
  [
    pubkey,
    activeCommunityStars,
    activeUserCommunityRefs,
    userRenouncedCommunityAddresses,
    communityAdminDefinitionEvents,
    communityModeratorFormEvents,
    communityModeratorProfileListEvents,
    communityModeratorDefinitionEvents,
  ],
  ([
    $pubkey,
    $activeCommunityStars,
    $activeUserCommunityRefs,
    $userRenouncedCommunityAddresses,
    $communityAdminDefinitionEvents,
    $communityModeratorFormEvents,
    $communityModeratorProfileListEvents,
    $communityModeratorDefinitionEvents,
  ]) =>
    selectPreferredCommunities({
      stars: $activeCommunityStars,
      memberCommunityRefs: $activeUserCommunityRefs,
      excludedCommunityAddresses: $userRenouncedCommunityAddresses,
      adminDefinitionEvents: $communityAdminDefinitionEvents,
      moderatorFormEvents: $communityModeratorFormEvents,
      moderatorProfileListEvents: $communityModeratorProfileListEvents,
      moderatorDefinitionEvents: $communityModeratorDefinitionEvents,
      author: $pubkey || undefined,
    }),
  [] as PreferredCommunityRef[],
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
      loadCommunityEvents(relays, [scopedReactionFilter], {
        timeout: COMMUNITY_STAR_LOAD_TIMEOUT,
        authenticate: true,
      }),
      COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_STAR_LOAD_TIMEOUT + 500,
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
        loadCommunityEvents(relays, deleteFilters, {
          timeout: COMMUNITY_STAR_LOAD_TIMEOUT,
          authenticate: true,
        }),
        COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_STAR_LOAD_TIMEOUT + 500,
        [],
      )
    }
  } finally {
    if (requestId === communityStarHydrationRequestId) communityStarsLoading.set(false)
  }
}

export const communityPreferencesLoading = writable(false)

let communityPreferenceHydrationKey = ""
let communityPreferenceHydrationRequestId = 0
let communityPreferenceHydratedAt = 0
let preferredCommunityListHydrationKey = ""
let preferredCommunityListHydrationRequestId = 0
let preferredCommunityListHydratedAt = 0

export const hydratePreferredCommunityList = async ({
  relayHints = [],
  force = false,
}: {
  relayHints?: string[]
  force?: boolean
} = {}) => {
  const user = pubkey.get()
  const relays = getCommunityStarRelays(relayHints)
  const key = `${user || ""}:${relays.slice().sort().join(",")}`

  if (!user || relays.length === 0) {
    preferredCommunityListHydrationKey = ""
    preferredCommunityListHydratedAt = 0
    return
  }
  if (
    !force &&
    preferredCommunityListHydrationKey === key &&
    Date.now() - preferredCommunityListHydratedAt < COMMUNITY_PREFERENCE_HYDRATION_TTL
  )
    return

  const filters = [
    makeCommunityStarReactionFilter(user),
    makeRecentCommunityStarDeleteFilter(user),
    makeCommunityAdminDefinitionFilter(user),
    makeCommunityModeratorFormFilter(user),
    makeCommunityModeratorProfileListFilter(user),
    {kinds: [DELETE], authors: [user], limit: COMMUNITY_PREFERENCE_LIMIT},
    {
      kinds: [PROFILE_LIST_KIND],
      "#p": [user],
      limit: COMMUNITY_PREFERENCE_LIMIT,
    },
  ].filter(Boolean) as Filter[]

  if (filters.length === 0) return

  const requestId = ++preferredCommunityListHydrationRequestId
  preferredCommunityListHydrationKey = key
  preferredCommunityListHydratedAt = Date.now()

  const loadedEvents = await loadCommunityEvents(relays, filters, {
    timeout: COMMUNITY_PREFERENCE_FAST_LOAD_TIMEOUT,
  })

  if (requestId !== preferredCommunityListHydrationRequestId) return

  const profileListEvents = [
    ...loadedEvents,
    ...get(communityModeratorProfileListEvents),
    ...get(communityMemberProfileListEvents),
  ].filter(event => event.kind === PROFILE_LIST_KIND || event.kind === DELETE)
  const profileListCommunityRefs = getCommunityDefinitionRefsFromEvents(profileListEvents)
  const formCommunities = Array.from(
    new Map(
      [...loadedEvents, ...get(communityModeratorFormEvents)].flatMap(event => {
        const community = parseAdmissionForm(event)?.community
        return community ? [[community.address, community] as const] : []
      }),
    ).values(),
  )
  const definitionFilters = [
    ...makeCommunityDefinitionProfileListRefFilters(profileListEvents),
    ...profileListCommunityRefs.map(makeExactCommunityDefinitionFilter),
    ...formCommunities.map(makeExactCommunityDefinitionFilter),
  ]
  const definitionRelays = normalizeRelays([
    ...relays,
    ...profileListCommunityRefs.flatMap(ref => ref.relayHints),
  ])

  if (definitionFilters.length === 0 || definitionRelays.length === 0) return

  await loadCommunityEvents(definitionRelays, definitionFilters, {
    timeout: COMMUNITY_PREFERENCE_FAST_LOAD_TIMEOUT,
  })
}

export const hydrateCommunityPreferences = async ({
  relayHints = [],
  force = false,
}: {
  relayHints?: string[]
  force?: boolean
} = {}) => {
  const user = pubkey.get()
  const relays = getCommunityStarRelays(relayHints)
  const key = `${user || ""}:${relays.slice().sort().join(",")}`

  if (!user || relays.length === 0) {
    communityPreferencesLoading.set(false)
    communityPreferenceHydrationKey = ""
    communityPreferenceHydratedAt = 0
    return
  }
  if (
    !force &&
    communityPreferenceHydrationKey === key &&
    Date.now() - communityPreferenceHydratedAt < COMMUNITY_PREFERENCE_HYDRATION_TTL
  )
    return

  const filters = [
    makeCommunityAdminDefinitionFilter(user),
    makeCommunityModeratorFormFilter(user),
    makeCommunityModeratorProfileListFilter(user),
    {kinds: [DELETE], authors: [user], limit: COMMUNITY_PREFERENCE_LIMIT},
    {
      kinds: [PROFILE_LIST_KIND],
      "#p": [user],
      limit: COMMUNITY_PREFERENCE_LIMIT,
    },
  ].filter(Boolean) as Filter[]

  if (filters.length === 0) return

  const requestId = ++communityPreferenceHydrationRequestId
  communityPreferenceHydrationKey = key
  communityPreferenceHydratedAt = Date.now()
  communityPreferencesLoading.set(true)

  try {
    const [loadedEvents, definitionDiscoveryEvents] = await Promise.all([
      withTimeout(
        loadCommunityEvents(relays, filters, {
          timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
          authenticate: true,
        }),
        COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
        [] as TrustedEvent[],
      ),
      withTimeout(
        loadCommunityEvents(relays, [makeCommunityDefinitionDiscoveryFilter()], {
          timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
          authenticate: true,
        }),
        COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
        [] as TrustedEvent[],
      ),
    ])

    if (requestId !== communityPreferenceHydrationRequestId) return

    const profileListEvents = [
      ...loadedEvents,
      ...get(communityModeratorProfileListEvents),
      ...get(communityMemberProfileListEvents),
    ].filter(event => event.kind === PROFILE_LIST_KIND || event.kind === DELETE)
    const profileListCommunityRefs = getCommunityDefinitionRefsFromEvents(profileListEvents)
    const formCommunities = Array.from(
      new Map(
        [...loadedEvents, ...get(communityModeratorFormEvents)].flatMap(event => {
          const community = parseAdmissionForm(event)?.community
          return community ? [[community.address, community] as const] : []
        }),
      ).values(),
    )
    const discoveredModeratorDefinitionEvents = selectModeratorDiscoveryDefinitionEvents(
      definitionDiscoveryEvents,
      user,
    )
    const discoveredModeratorDefinitions = selectLatestDefinitionsByAddress(
      discoveredModeratorDefinitionEvents,
    )
    const discoveredDefinitions = selectLatestDefinitionsByAddress(definitionDiscoveryEvents)
    const definitionFilters = [
      ...makeCommunityDefinitionProfileListRefFilters(profileListEvents),
      ...profileListCommunityRefs.map(makeExactCommunityDefinitionFilter),
      ...formCommunities.map(makeExactCommunityDefinitionFilter),
      ...discoveredModeratorDefinitions.map(definition =>
        makeExactCommunityDefinitionFilter(definition.pointer),
      ),
    ]
    const definitionRelays = normalizeRelays([
      ...relays,
      ...profileListCommunityRefs.flatMap(ref => ref.relayHints),
      ...discoveredModeratorDefinitions.flatMap(definition => definition.relays),
    ])

    const [definitionEvents, discoveredMemberProfileListEvents] = await Promise.all([
      definitionFilters.length > 0
        ? withTimeout(
            loadCommunityEvents(definitionRelays, definitionFilters, {
              timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
              authenticate: true,
            }),
            COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
            [] as TrustedEvent[],
          )
        : [],
      loadDiscoveredMemberProfileLists(discoveredDefinitions, user),
    ])

    if (requestId !== communityPreferenceHydrationRequestId) return

    const discoveredMemberDefinitionEvents = selectMemberDiscoveryDefinitionEvents(
      discoveredDefinitions,
      discoveredMemberProfileListEvents,
      user,
    )

    const definitions = selectLatestDefinitionsByAddress(
      dedupeTrustedEvents([
        ...loadedEvents,
        ...definitionEvents,
        ...discoveredModeratorDefinitionEvents,
        ...discoveredMemberDefinitionEvents,
      ]),
    )
    const hasPreferenceEvidence = definitions.length > 0 || formCommunities.length > 0

    if (!hasPreferenceEvidence) {
      communityPreferenceHydratedAt = 0
      return
    }

    const communityRelays = normalizeRelays(definitions.flatMap(definition => definition.relays))

    if (communityRelays.length === 0) return

    const profileListFilters = definitions.flatMap(makeCommunityProfileListFilters)

    if (profileListFilters.length > 0) {
      await withTimeout(
        loadCommunityEvents(communityRelays, profileListFilters, {
          timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
          authenticate: true,
        }),
        COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
        [] as TrustedEvent[],
      )
    }

    if (requestId !== communityPreferenceHydrationRequestId) return

    const reportFilters = definitions.flatMap(definition =>
      makeCommunityReportFilters(definition.pointer),
    )

    if (reportFilters.length === 0) return

    const reportEvents = await withTimeout(
      loadCommunityEvents(communityRelays, reportFilters, {
        timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
        authenticate: true,
      }),
      COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
      [] as TrustedEvent[],
    )
    const reportDeleteFilters = makeCommunityReportDeleteFilters(reportEvents)

    if (reportDeleteFilters.length === 0) return

    await withTimeout(
      loadCommunityEvents(communityRelays, reportDeleteFilters, {
        timeout: COMMUNITY_PREFERENCE_LOAD_TIMEOUT,
        authenticate: true,
      }),
      COMMUNITY_RELAY_AUTH_TIMEOUT + COMMUNITY_PREFERENCE_LOAD_TIMEOUT + 500,
      [] as TrustedEvent[],
    )
  } finally {
    if (requestId === communityPreferenceHydrationRequestId) communityPreferencesLoading.set(false)
  }
}

export const hydratePreferredCommunities = async ({
  relayHints = [],
  force = false,
}: {
  relayHints?: string[]
  force?: boolean
} = {}) => {
  await Promise.all([
    hydrateCommunityStars({relayHints, force}),
    hydrateCommunityPreferences({relayHints, force}),
  ])
}

export const getProfileListRefs = (definition: CommunityDefinition) =>
  definition.sections.flatMap(section => section.profileLists)

export const selectCurrentDefinitionProfileListEvents = (
  definitions: CommunityDefinition[],
  events: TrustedEvent[],
) =>
  Array.from(
    new Map(
      definitions.flatMap(getProfileListRefs).flatMap(ref => {
        const event = findCommunityProfileListEvent(ref, events)
        return event ? [[ref.address, event] as const] : []
      }),
    ).values(),
  )

const makeAddressRefFilter = (ref: {address: string}): Filter => {
  const address = parseAddressRef(ref.address)
  if (!address) return {ids: []}

  return {
    kinds: [address.kind],
    "#d": [address.identifier],
    limit: 200,
  }
}

export const makeCommunityProfileListFilters = (definition: CommunityDefinition): Filter[] =>
  getProfileListRefs(definition).flatMap(ref => {
    const address = parseAddressRef(ref.address)
    if (!address) return []

    return [makeAddressRefFilter(ref), {kinds: [DELETE], "#a": [ref.address], limit: 200}]
  })

export const activeUserCommunityProfileListEvents: Readable<TrustedEvent[]> = derived(
  activeUserCommunityRefs,
  ($activeUserCommunityRefs, set) => {
    const filters = $activeUserCommunityRefs.flatMap(ref =>
      makeCommunityProfileListFilters(ref.definition),
    )

    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const getAdmissionFormModeratorPubkeys = (definition: CommunityDefinition) =>
  Array.from(new Set([definition.ownerPubkey, ...getCommunityModeratorRefPubkeys({definition})]))

export const makeCommunityAdmissionFormFilters = (definition: CommunityDefinition): Filter[] => {
  const authors = getAdmissionFormModeratorPubkeys(definition)

  return authors.length
    ? [{kinds: [FORM_TEMPLATE_KIND], authors, "#a": [definition.pointer.address]}]
    : []
}

export const makeCommunityModeratorRequestFilters = (
  definition: CommunityDefinition,
  options: {authors?: string[]; limit?: number} = {},
): Filter[] => {
  const authors = options.authors?.map(normalizePubkey).filter(Boolean)

  return [
    {
      kinds: [PROFILE_LIST_KIND],
      "#h": [definition.communityId],
      "#a": [definition.pointer.address],
      ...(authors?.length ? {authors} : {}),
      limit: options.limit ?? 200,
    },
  ]
}

export const makeCommunityModeratorRequestReactionFilters = (
  definition: CommunityDefinition,
  requests: ModeratorPromotionRequest[],
): Filter[] => {
  const eventIds = Array.from(
    new Set(requests.map(request => request.profileList.event.id).filter(Boolean)),
  )

  return eventIds.length
    ? [
        {
          kinds: [MODERATOR_REQUEST_REACTION_KIND],
          authors: [definition.ownerPubkey],
          "#h": [definition.communityId],
          "#a": [definition.pointer.address],
          "#e": eventIds,
        },
      ]
    : []
}

export const makeCommunityModeratorRequestDeleteFilters = (
  definition: CommunityDefinition,
  reactionEvents: TrustedEvent[],
): Filter[] => {
  const reactionIds = Array.from(new Set(reactionEvents.map(event => event.id).filter(Boolean)))

  return reactionIds.length
    ? [
        {
          kinds: [DELETE],
          authors: [definition.ownerPubkey],
          "#h": [definition.communityId],
          "#e": reactionIds,
        },
      ]
    : []
}

export const makeCommunityReportFilters = (community: CommunityPointer): Filter[] => [
  {
    kinds: [COMMUNITY_REPORT_KIND],
    "#h": [community.communityId],
    "#a": [community.address],
    limit: 500,
  },
]

export const makeCommunityReportDeleteFilters = (reportEvents: TrustedEvent[]): Filter[] => {
  const reportIds = Array.from(new Set(reportEvents.map(event => event.id).filter(Boolean)))

  return reportIds.length ? [{kinds: [DELETE], "#e": reportIds}] : []
}

export const makeCommunityReportReviewFilters = (
  community: CommunityPointer,
  reportEvents: TrustedEvent[],
): Filter[] => {
  const reportIds = Array.from(new Set(reportEvents.map(event => event.id).filter(Boolean)))

  return reportIds.length
    ? [
        {
          kinds: [COMMUNITY_REPORT_REVIEW_LABEL_KIND],
          "#h": [community.communityId],
          "#a": [community.address],
          "#e": reportIds,
          "#L": [COMMUNITY_REPORT_REVIEW_NAMESPACE],
          limit: 500,
        },
      ]
    : []
}

const communityReportDeleteHydratedAt = new Map<string, number>()
const communityReportDeleteHydrationPromises = new Map<string, Promise<TrustedEvent[]>>()

export const hydrateCommunityReportDeleteEvents = async ({
  relays,
  reportEvents,
  force = false,
}: {
  relays: string[]
  reportEvents: TrustedEvent[]
  force?: boolean
}) => {
  const normalizedRelays = normalizeRelays(relays)
  const reportIds = Array.from(new Set(reportEvents.map(event => event.id).filter(Boolean))).sort()
  const key = `${reportIds.join(",")}:${normalizedRelays.slice().sort().join(",")}`
  const filters = makeCommunityReportDeleteFilters(reportEvents)

  if (normalizedRelays.length === 0 || reportIds.length === 0 || filters.length === 0) return []
  if (
    !force &&
    (communityReportDeleteHydratedAt.get(key) || 0) >
      Date.now() - COMMUNITY_REPORT_DELETE_HYDRATION_TTL
  ) {
    return []
  }

  const pending = communityReportDeleteHydrationPromises.get(key)
  if (pending) return pending

  const promise = loadCommunityEvents(normalizedRelays, filters, {authenticate: true})
    .then(events => {
      communityReportDeleteHydratedAt.set(key, Date.now())

      return events
    })
    .finally(() => {
      if (communityReportDeleteHydrationPromises.get(key) === promise) {
        communityReportDeleteHydrationPromises.delete(key)
      }
    })

  communityReportDeleteHydrationPromises.set(key, promise)

  return promise
}

const deriveActiveCommunityEvents = (
  makeFilters: (definition: CommunityDefinition) => Filter[],
): Readable<TrustedEvent[]> =>
  derived(
    activeExactCommunityDefinition,
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

export const activeCommunityAdmissionFormEvents: Readable<TrustedEvent[]> = derived(
  activeExactCommunityDefinition,
  ($definition, set) => {
    if (!$definition) {
      set([])
      return
    }

    const filters = makeCommunityAdmissionFormFilters($definition)
    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityReportEvents: Readable<TrustedEvent[]> = derived(
  activeExactCommunityPointer,
  ($community, set) => {
    if (!$community) {
      set([])
      return
    }

    return deriveEventsAsc(
      deriveEventsById({repository, filters: makeCommunityReportFilters($community)}),
    ).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityReportDeleteEvents: Readable<TrustedEvent[]> = derived(
  [activeCommunityReportEvents, activeExactCommunityRelays],
  ([$activeCommunityReportEvents, $activeExactCommunityRelays], set) => {
    const filters = makeCommunityReportDeleteFilters($activeCommunityReportEvents)
    if (filters.length === 0) {
      set([])
      return
    }

    void hydrateCommunityReportDeleteEvents({
      relays: $activeExactCommunityRelays,
      reportEvents: $activeCommunityReportEvents,
    }).catch(error => {
      console.warn("[community] Failed to hydrate moderation report deletes", error)
    })

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityReportReviewEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityPointer, activeCommunityReportEvents],
  ([$community, $activeCommunityReportEvents], set) => {
    if (!$community) {
      set([])
      return
    }

    const filters = makeCommunityReportReviewFilters($community, $activeCommunityReportEvents)
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityReportState: Readable<EffectiveCommunityReportState> = derived(
  [
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportEvents,
    activeCommunityReportDeleteEvents,
  ],
  ([
    $activeCommunityDefinition,
    $activeCommunityProfileListEvents,
    $activeCommunityReportEvents,
    $activeCommunityReportDeleteEvents,
  ]) =>
    $activeCommunityDefinition
      ? getEffectiveCommunityReportState({
          community: $activeCommunityDefinition.pointer,
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportEvents: $activeCommunityReportEvents,
          deleteEvents: $activeCommunityReportDeleteEvents,
        })
      : {eventReports: [], personReports: []},
  {eventReports: [], personReports: []} as EffectiveCommunityReportState,
)

export const activeCommunityModeratorRequestEvents: Readable<TrustedEvent[]> = derived(
  activeExactCommunityDefinition,
  (definition, set) => {
    if (!definition) {
      set([])
      return
    }
    return deriveEventsAsc(
      deriveEventsById({repository, filters: makeCommunityModeratorRequestFilters(definition)}),
    ).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityModeratorRequests: Readable<ModeratorPromotionRequest[]> = derived(
  [activeExactCommunityDefinition, activeCommunityModeratorRequestEvents],
  ([$activeCommunityDefinition, $activeCommunityModeratorRequestEvents]) =>
    $activeCommunityDefinition
      ? getModeratorPromotionRequests({
          profileListEvents: $activeCommunityModeratorRequestEvents.filter(
            event => event.kind === PROFILE_LIST_KIND,
          ),
          community: $activeCommunityDefinition.pointer,
        })
      : [],
  [] as ModeratorPromotionRequest[],
)

export const activeCommunityModeratorRequestReactionEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityDefinition, activeCommunityModeratorRequests],
  ([$activeCommunityDefinition, $activeCommunityModeratorRequests], set) => {
    if (!$activeCommunityDefinition) {
      set([])
      return
    }

    const filters = makeCommunityModeratorRequestReactionFilters(
      $activeCommunityDefinition,
      $activeCommunityModeratorRequests,
    )
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityModeratorRequestDeleteEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityDefinition, activeCommunityModeratorRequestReactionEvents],
  ([$activeCommunityDefinition, $activeCommunityModeratorRequestReactionEvents], set) => {
    if (!$activeCommunityDefinition) {
      set([])
      return
    }

    const filters = makeCommunityModeratorRequestDeleteFilters(
      $activeCommunityDefinition,
      $activeCommunityModeratorRequestReactionEvents,
    )
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityModeratorRequestStates: Readable<ModeratorPromotionRequestState[]> =
  derived(
    [
      activeExactCommunityDefinition,
      activeCommunityModeratorRequests,
      activeCommunityModeratorRequestReactionEvents,
      activeCommunityModeratorRequestDeleteEvents,
    ],
    ([
      $activeCommunityDefinition,
      $activeCommunityModeratorRequests,
      $activeCommunityModeratorRequestReactionEvents,
      $activeCommunityModeratorRequestDeleteEvents,
    ]) =>
      $activeCommunityDefinition
        ? getModeratorPromotionRequestStates({
            definition: $activeCommunityDefinition,
            requests: $activeCommunityModeratorRequests,
            reactionEvents: $activeCommunityModeratorRequestReactionEvents,
            deleteEvents: $activeCommunityModeratorRequestDeleteEvents,
            includeGranted: true,
          })
        : [],
    [] as ModeratorPromotionRequestState[],
  )

export const activeCommunityPendingModeratorRequestCount: Readable<number> = derived(
  activeCommunityModeratorRequestStates,
  $activeCommunityModeratorRequestStates =>
    $activeCommunityModeratorRequestStates.filter(request => request.status === "pending").length,
  0,
)

export const activeCommunityUserModeratorRequestEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityDefinition, pubkey],
  ([$activeCommunityDefinition, $pubkey], set) => {
    if (!$activeCommunityDefinition || !$pubkey) {
      set([])
      return
    }

    const filters = makeCommunityModeratorRequestFilters($activeCommunityDefinition, {
      authors: [$pubkey],
      limit: 50,
    })
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityUserModeratorRequests: Readable<ModeratorPromotionRequest[]> = derived(
  [activeExactCommunityDefinition, activeCommunityUserModeratorRequestEvents],
  ([$activeCommunityDefinition, $activeCommunityUserModeratorRequestEvents]) =>
    $activeCommunityDefinition
      ? getModeratorPromotionRequests({
          profileListEvents: $activeCommunityUserModeratorRequestEvents.filter(
            event => event.kind === PROFILE_LIST_KIND,
          ),
          community: $activeCommunityDefinition.pointer,
        })
      : [],
  [] as ModeratorPromotionRequest[],
)

export const activeCommunityUserModeratorRequestReactionEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityDefinition, activeCommunityUserModeratorRequests],
  ([$activeCommunityDefinition, $activeCommunityUserModeratorRequests], set) => {
    if (!$activeCommunityDefinition) {
      set([])
      return
    }

    const filters = makeCommunityModeratorRequestReactionFilters(
      $activeCommunityDefinition,
      $activeCommunityUserModeratorRequests,
    )
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityUserModeratorRequestDeleteEvents: Readable<TrustedEvent[]> = derived(
  [activeExactCommunityDefinition, activeCommunityUserModeratorRequestReactionEvents],
  ([$activeCommunityDefinition, $activeCommunityUserModeratorRequestReactionEvents], set) => {
    if (!$activeCommunityDefinition) {
      set([])
      return
    }

    const filters = makeCommunityModeratorRequestDeleteFilters(
      $activeCommunityDefinition,
      $activeCommunityUserModeratorRequestReactionEvents,
    )
    if (filters.length === 0) {
      set([])
      return
    }

    return deriveEventsAsc(deriveEventsById({repository, filters})).subscribe(set)
  },
  [] as TrustedEvent[],
)

export const activeCommunityUserModeratorRequestStates: Readable<ModeratorPromotionRequestState[]> =
  derived(
    [
      activeExactCommunityDefinition,
      activeCommunityUserModeratorRequests,
      activeCommunityUserModeratorRequestReactionEvents,
      activeCommunityUserModeratorRequestDeleteEvents,
    ],
    ([
      $activeCommunityDefinition,
      $activeCommunityUserModeratorRequests,
      $activeCommunityUserModeratorRequestReactionEvents,
      $activeCommunityUserModeratorRequestDeleteEvents,
    ]) =>
      $activeCommunityDefinition
        ? getModeratorPromotionRequestStates({
            definition: $activeCommunityDefinition,
            requests: $activeCommunityUserModeratorRequests,
            reactionEvents: $activeCommunityUserModeratorRequestReactionEvents,
            deleteEvents: $activeCommunityUserModeratorRequestDeleteEvents,
          })
        : [],
    [] as ModeratorPromotionRequestState[],
  )

export const activeCommunityUserModeratorRequestsLoading = writable(false)

let userModeratorRequestHydrationKey = ""
let userModeratorRequestHydrationRequestId = 0
let userModeratorRequestHydratedAt = 0

export const hydrateActiveCommunityUserModeratorRequests = async ({
  definition = get(activeExactCommunityDefinition),
  relays = get(activeExactCommunityRelays),
  force = false,
}: {
  definition?: CommunityDefinition
  relays?: string[]
  force?: boolean
} = {}) => {
  const user = pubkey.get()
  const normalizedRelays = normalizeRelays(relays || [])
  const key = definition
    ? `${definition.event.id}:${user || ""}:${normalizedRelays.slice().sort().join(",")}`
    : ""

  if (!definition || !user || normalizedRelays.length === 0) {
    activeCommunityUserModeratorRequestsLoading.set(false)
    userModeratorRequestHydrationKey = ""
    userModeratorRequestHydratedAt = 0
    return
  }
  if (
    !force &&
    userModeratorRequestHydrationKey === key &&
    Date.now() - userModeratorRequestHydratedAt < COMMUNITY_MODERATOR_REQUEST_HYDRATION_TTL
  )
    return

  const requestFilters = makeCommunityModeratorRequestFilters(definition, {
    authors: [user],
    limit: 50,
  })
  if (requestFilters.length === 0) return

  const requestId = ++userModeratorRequestHydrationRequestId
  userModeratorRequestHydrationKey = key
  userModeratorRequestHydratedAt = Date.now()
  activeCommunityUserModeratorRequestsLoading.set(true)

  try {
    const loadedRequestEvents = await withTimeout(
      loadCommunityEvents(normalizedRelays, requestFilters, {
        timeout: COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT,
      }),
      COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT + 500,
      [] as TrustedEvent[],
    )

    if (requestId !== userModeratorRequestHydrationRequestId) return

    const requestEvents = [
      ...loadedRequestEvents,
      ...get(activeCommunityUserModeratorRequestEvents),
    ]
    const requests = getModeratorPromotionRequests({
      profileListEvents: requestEvents.filter(event => event.kind === PROFILE_LIST_KIND),
      community: definition.pointer,
    })
    const reactionFilters = makeCommunityModeratorRequestReactionFilters(definition, requests)
    const loadedReactionEvents = reactionFilters.length
      ? await withTimeout(
          loadCommunityEvents(normalizedRelays, reactionFilters, {
            timeout: COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT,
          }),
          COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT + 500,
          [] as TrustedEvent[],
        )
      : []

    if (requestId !== userModeratorRequestHydrationRequestId) return

    const reactionEvents = [
      ...loadedReactionEvents,
      ...get(activeCommunityUserModeratorRequestReactionEvents),
    ]
    const deleteFilters = makeCommunityModeratorRequestDeleteFilters(definition, reactionEvents)

    if (deleteFilters.length > 0) {
      await withTimeout(
        loadCommunityEvents(normalizedRelays, deleteFilters, {
          timeout: COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT,
        }),
        COMMUNITY_MODERATOR_REQUEST_LOAD_TIMEOUT + 500,
        [] as TrustedEvent[],
      )
    }
  } finally {
    if (requestId === userModeratorRequestHydrationRequestId) {
      activeCommunityUserModeratorRequestsLoading.set(false)
    }
  }
}

export const selectCommunityAdmissionForms = (
  community: CommunityPointer,
  definition: CommunityDefinition,
  events: TrustedEvent[],
  profileListEvents?: TrustedEvent[],
  reportState?: EffectiveCommunityReportState,
): Record<string, CommunityAdmissionForm> =>
  Object.fromEntries(
    definition.sections.flatMap(section => {
      const form = selectActiveAdmissionForm({
        events,
        community,
        sectionName: section.name,
        moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
          definition,
          sectionName: section.name,
          profileListEvents,
          reportState,
        }),
      })

      if (!form) return []

      return [[section.name, form]]
    }),
  )

export const activeCommunityAdmissionForms: Readable<Record<string, CommunityAdmissionForm>> =
  derived(
    [
      activeExactCommunityDefinition,
      activeCommunityAdmissionFormEvents,
      activeCommunityProfileListEvents,
      activeCommunityReportState,
    ],
    ([
      $activeCommunityDefinition,
      $activeCommunityAdmissionFormEvents,
      $activeCommunityProfileListEvents,
      $activeCommunityReportState,
    ]) =>
      $activeCommunityDefinition
        ? selectCommunityAdmissionForms(
            $activeCommunityDefinition.pointer,
            $activeCommunityDefinition,
            $activeCommunityAdmissionFormEvents,
            $activeCommunityProfileListEvents,
            $activeCommunityReportState,
          )
        : {},
  )

// Look up a community definition synchronously in the repository cache
// (IndexedDB warm-start populates this before any effect runs). Returns
// undefined if not cached.
const readCachedCommunityDefinition = (pointer: CommunityPointer) => {
  const cachedEvents = repository.query([makeExactCommunityDefinitionFilter(pointer)])
  return selectExactCommunityDefinition(cachedEvents, pointer)
}

const loadCommunityPermissionEvents = async ({
  definition,
  relays,
  context,
  loadAuthority = true,
  loadAdmissionForms = true,
}: {
  definition: CommunityDefinition
  relays: string[]
  context: CommunityPermissionLoadContext
  loadAuthority?: boolean
  loadAdmissionForms?: boolean
}) => {
  const authorityFilters = makeCommunityProfileListFilters(definition)
  const admissionFormFilters = makeCommunityAdmissionFormFilters(definition)
  const authorityAttempt = loadAuthority
    ? startCommunityPermissionLoadStatus({
        definition,
        relays,
        filters: authorityFilters,
        context,
      })
    : undefined
  const admissionFormAttempt = loadAdmissionForms
    ? startCommunityPermissionLoadStatus({
        definition,
        relays,
        filters: admissionFormFilters,
        context,
        status: activeCommunityAdmissionFormStatus,
      })
    : undefined

  try {
    const [authorityResult, admissionFormResult] = await Promise.all([
      loadAuthority && authorityFilters.length > 0
        ? loadCommunityEventsWithStatus(relays, authorityFilters, {
            timeout: COMMUNITY_AUTHORITY_LOAD_TIMEOUT,
            settle: "first-non-empty",
            authenticate: true,
            onProgress: (result, terminal) => {
              if (!authorityAttempt) return
              updateCommunityPermissionLoadStatus(authorityAttempt, {
                result,
                terminal,
                error: terminal ? getCommunityLoadFailure([result]) : undefined,
              })
            },
          })
        : makeCompleteEmptyCommunityLoadResult(),
      loadAdmissionForms && admissionFormFilters.length > 0
        ? loadCommunityEventsWithStatus(relays, admissionFormFilters, {
            authenticate: true,
            settle: "first",
            onProgress: (result, terminal) => {
              if (!admissionFormAttempt) return
              updateCommunityPermissionLoadStatus(admissionFormAttempt, {
                result,
                terminal,
                error: terminal ? getCommunityLoadFailure([result]) : undefined,
              })
            },
          })
        : makeCompleteEmptyCommunityLoadResult(),
    ])

    if (authorityAttempt && authorityFilters.length === 0) {
      updateCommunityPermissionLoadStatus(authorityAttempt, {
        result: authorityResult,
        terminal: true,
      })
    }
    if (admissionFormAttempt && admissionFormFilters.length === 0) {
      updateCommunityPermissionLoadStatus(admissionFormAttempt, {
        result: admissionFormResult,
        terminal: true,
      })
    }

    return {authorityFilters, admissionFormFilters, authorityResult, admissionFormResult}
  } catch (error) {
    const result = {
      events: [],
      complete: false,
      timedOutRelays: [],
      failedRelays: normalizeRelays(relays),
    }
    if (authorityAttempt) {
      updateCommunityPermissionLoadStatus(authorityAttempt, {result, terminal: true, error})
    }
    if (admissionFormAttempt) {
      updateCommunityPermissionLoadStatus(admissionFormAttempt, {result, terminal: true, error})
    }
    throw error
  }
}

export const loadCommunityBootstrap = async (
  session: ExactCommunitySession,
): Promise<CommunityBootstrap> => {
  const bootstrapViewerPubkey = normalizePubkey(pubkey.get() || "")
  const pointer = getExactCommunitySessionPointer(session)
  const mayClaimUnownedCommunity = !get(activeExactCommunitySession)
  const definitionFilter = makeExactCommunityDefinitionFilter(pointer)

  // Do not block on relay auth before we know the community definition. Once
  // definition relays are known below, they get a bounded auth head start
  // before route feeds are allowed to settle empty.

  // Cache-first: if the repository already has a definition (warm-start from
  // IndexedDB, a prior visit, or a parallel path), use it immediately and
  // fire the network refresh in the background. This is the biggest win
  // for perceived speed: warm cache paths never wait on a round-trip.
  let definition = readCachedCommunityDefinition(pointer)
  const cacheHit = Boolean(definition)
  let refreshedDefinitionId = definition?.event.id || ""

  const hydrateRefreshedDefinition = (refreshed: CommunityDefinition | undefined) => {
    if (!refreshed) return

    const latest = readCachedCommunityDefinition(pointer) || refreshed
    if (latest.event.id === refreshedDefinitionId) return

    refreshedDefinitionId = latest.event.id
    const currentSession = get(activeExactCommunitySession)
    const currentPointer = currentSession
      ? getExactCommunitySessionPointer(currentSession)
      : undefined
    if (
      currentPointer?.address === pointer.address ||
      (!currentSession && mayClaimUnownedCommunity)
    ) {
      setActiveExactCommunityDefinition(latest)
    } else {
      repository.publish(latest.event)
      return
    }

    const refreshedRelays = latest.relays.length
      ? latest.relays
      : getCommunityBootstrapRelays(session.relayHints)
    const context = startCommunityPermissionLoadContext()
    void loadCommunityPermissionEvents({
      definition: latest,
      relays: refreshedRelays,
      context,
    }).catch(() => undefined)
  }

  if (cacheHit) {
    // Background refresh - non-awaited. The repository will emit updates
    // when a newer definition arrives, and reactive stores will pick it up.
    void loadCommunityDefinitionWithOutboxFallback(pointer, {
      relayHints: session.relayHints,
    })
      .then(hydrateRefreshedDefinition)
      .catch(() => undefined)
  } else {
    definition = await loadCommunityDefinitionWithOutboxFallback(pointer, {
      relayHints: session.relayHints,
    })

    if (!definition) {
      // Final chance: the network fetch may have populated the cache during
      // its await (e.g. via the outbox path emitting to the repository).
      definition = readCachedCommunityDefinition(pointer)

      if (!definition) throw new Error("Community definition unavailable")
    }
  }

  if (!definition) throw new Error("Community definition unavailable")

  const definitionEvents = [definition.event]
  let communityRelays = definition.relays
  const ownsActiveBootstrap = () => {
    const currentSession = get(activeExactCommunitySession)
    const currentPointer = currentSession
      ? getExactCommunitySessionPointer(currentSession)
      : undefined

    return (
      (currentPointer?.address === pointer.address ||
        (!currentSession && mayClaimUnownedCommunity)) &&
      normalizePubkey(pubkey.get() || "") === bootstrapViewerPubkey
    )
  }

  if (definition.relays.length && ownsActiveBootstrap()) {
    // Give community-declared relays a bounded auth head start before pages
    // begin their own feeds. Without this, warm-cache boot can mark bootstrap
    // complete and let feed requests settle empty while NIP-42 is still signing.
    await authenticateCommunityRelays(communityRelays, {
      priorityRelays: normalizeRelays([...session.relayHints, ...getDefaultCommunityRelayHints()]),
      timeout: COMMUNITY_PRIORITY_RELAY_AUTH_TIMEOUT,
    })

    if (cacheHit) {
      // We already have a valid definition. Refresh from the community's own
      // relays in the background - do not block bootstrap on it.
      void loadCommunityEvents(communityRelays, [definitionFilter], {
        settle: "first-non-empty",
      })
        .then(events => hydrateRefreshedDefinition(selectExactCommunityDefinition(events, pointer)))
        .catch(() => undefined)
    } else {
      const relayDefinitionEvents = await loadCommunityEvents(communityRelays, [definitionFilter], {
        settle: "first-non-empty",
      })
      const communityRelayDefinition = selectExactCommunityDefinition(
        [...definitionEvents, ...relayDefinitionEvents],
        pointer,
      )

      if (communityRelayDefinition) {
        definition = communityRelayDefinition
        communityRelays = definition.relays.length ? definition.relays : communityRelays
      }
    }
  }

  const latestCachedDefinition = readCachedCommunityDefinition(pointer)
  if (latestCachedDefinition && latestCachedDefinition.event.id !== definition.event.id) {
    hydrateRefreshedDefinition(latestCachedDefinition)
    definition = latestCachedDefinition
    communityRelays = definition.relays.length
      ? definition.relays
      : getCommunityBootstrapRelays(session.relayHints)
  }

  const authorityFilters: Filter[] = []
  const admissionFormFilters: Filter[] = []
  const reportFilters: Filter[] = []

  if (definition) {
    const currentSession = get(activeExactCommunitySession)
    const currentPointer = currentSession
      ? getExactCommunitySessionPointer(currentSession)
      : undefined

    if (
      currentPointer?.address === pointer.address ||
      (!currentSession && mayClaimUnownedCommunity)
    ) {
      setActiveExactCommunityDefinition(definition)
    } else {
      repository.publish(definition.event)
    }
    const exactDefinition = get(activeExactCommunityDefinition)
    if (exactDefinition?.pointer.address === pointer.address) {
      authorityFilters.push(...makeCommunityProfileListFilters(exactDefinition))
      admissionFormFilters.push(...makeCommunityAdmissionFormFilters(exactDefinition))
    }
    const community = get(activeExactCommunityPointer)
    if (community) {
      reportFilters.push(...makeCommunityReportFilters(community))
    }
  }

  const tracksActivePermissionStatus = ownsActiveBootstrap()
  const permissionLoadContext = tracksActivePermissionStatus
    ? startCommunityPermissionLoadContext(bootstrapViewerPubkey)
    : {viewerPubkey: bootstrapViewerPubkey, generation: -1}

  // Cache-first for the authority/admission/report events too. When the
  // definition is a cache hit we already have those events in the
  // repository as well (they came from the same warm-start). Read them
  // synchronously and refresh in the background so `communityBootstrapReady`
  // fires immediately.
  const readFromRepository = (filters: Filter[]) =>
    filters.length > 0 ? repository.query(filters) : []

  let authorityEvents: TrustedEvent[]
  let admissionFormEvents: TrustedEvent[]
  let reportEvents: TrustedEvent[]

  if (cacheHit || !tracksActivePermissionStatus) {
    authorityEvents = readFromRepository(authorityFilters)
    admissionFormEvents = readFromRepository(admissionFormFilters)
    reportEvents = readFromRepository(reportFilters)

    // Background refresh - non-awaited, results land in the repository and
    // the reactive stores emit updates naturally.
    if (tracksActivePermissionStatus) {
      void loadCommunityPermissionEvents({
        definition,
        relays: communityRelays,
        context: permissionLoadContext,
      }).catch(() => undefined)
    }
    if (tracksActivePermissionStatus && reportFilters.length > 0) {
      void loadCommunityEvents(communityRelays, reportFilters, {
        authenticate: true,
        settle: "first",
      })
        .then(freshReports => {
          void hydrateCommunityReportDeleteEvents({
            relays: communityRelays,
            reportEvents: freshReports,
          }).catch(() => undefined)
        })
        .catch(() => undefined)
    }
  } else {
    const [permissionResult, loadedReportEvents] = await Promise.all([
      loadCommunityPermissionEvents({
        definition,
        relays: communityRelays,
        context: permissionLoadContext,
      }),
      reportFilters.length > 0
        ? loadCommunityEvents(communityRelays, reportFilters, {
            authenticate: true,
            settle: "first",
          })
        : [],
    ])
    authorityEvents = permissionResult.authorityResult.events
    admissionFormEvents = permissionResult.admissionFormResult.events
    reportEvents = loadedReportEvents

    void hydrateCommunityReportDeleteEvents({relays: communityRelays, reportEvents}).catch(
      error => {
        console.warn("[community] Failed to hydrate moderation report deletes", error)
      },
    )
  }

  const community = get(activeExactCommunityPointer)
  const reportReviewFilters = community
    ? makeCommunityReportReviewFilters(community, reportEvents)
    : []

  let reportReviewEvents: TrustedEvent[]
  if (cacheHit || !tracksActivePermissionStatus) {
    reportReviewEvents = readFromRepository(reportReviewFilters)
    if (tracksActivePermissionStatus && reportReviewFilters.length > 0) {
      void loadCommunityEvents(communityRelays, reportReviewFilters, {
        authenticate: true,
        settle: "first",
      }).catch(() => undefined)
    }
  } else {
    reportReviewEvents =
      reportReviewFilters.length > 0
        ? await loadCommunityEvents(communityRelays, reportReviewFilters, {
            authenticate: true,
            settle: "first",
          })
        : []
  }

  const bootstrap = {
    definition,
    profileListEvents: authorityEvents.filter(
      event => event.kind === PROFILE_LIST_KIND || event.kind === DELETE,
    ),
    admissionFormEvents: admissionFormEvents.filter(event => event.kind === FORM_TEMPLATE_KIND),
    reportEvents: reportEvents.filter(event => event.kind === COMMUNITY_REPORT_KIND),
    reportDeleteEvents: [],
    reportReviewEvents: reportReviewEvents.filter(
      event => event.kind === COMMUNITY_REPORT_REVIEW_LABEL_KIND,
    ),
  }

  return bootstrap
}

const ensureCompletedCommunityPermissionHydration = (
  session: ExactCommunitySession,
  bootstrap: CommunityBootstrap,
) => {
  const definition = bootstrap.definition
  if (!definition) return

  const relays = definition.relays.length
    ? definition.relays
    : getCommunityBootstrapRelays(session.relayHints)
  const viewerPubkey = normalizePubkey(pubkey.get() || "")
  const keyPrefix = getCommunityPermissionStatusKeyPrefix(definition, relays, viewerPubkey)
  const authorityStatus = get(activeCommunityPermissionStatus)
  const admissionFormStatus = get(activeCommunityAdmissionFormStatus)
  const statusMatches = (status: CommunityPermissionStatus) =>
    status.communityAddress === definition.pointer.address && status.key.startsWith(keyPrefix)
  const loadAuthority =
    !statusMatches(authorityStatus) || (!authorityStatus.loading && !authorityStatus.complete)
  const loadAdmissionForms =
    !statusMatches(admissionFormStatus) ||
    (!admissionFormStatus.loading && !admissionFormStatus.complete)
  if (!loadAuthority && !loadAdmissionForms) return

  const context = startCommunityPermissionLoadContext()

  void loadCommunityPermissionEvents({
    definition,
    relays,
    context,
    loadAuthority,
    loadAdmissionForms,
  }).catch(() => undefined)
}

export const ensureCommunityBootstrap = async (
  session: ExactCommunitySession,
  options: {key?: string; updateStatus?: boolean} = {},
): Promise<CommunityBootstrap> => {
  const key = options.key || getCommunityBootstrapKey(session, pubkey.get() || "")
  const updateStatus = options.updateStatus ?? true
  const completed = completedCommunityBootstrap.get(key)

  if (completed) {
    ensureCompletedCommunityPermissionHydration(session, completed)

    if (updateStatus) {
      // Always overwrite the status when we hit a completed cache entry so a
      // ghost `error` from a previous failed attempt cannot linger and
      // trigger the "Community unavailable" banner.
      activeCommunityBootstrapStatus.set({key, loading: false, loaded: true})
    }
    return completed
  }

  const existing = communityBootstrapPromises.get(key)
  if (existing) {
    const generation = communityBootstrapPromiseGenerations.get(key)

    if (!updateStatus) return existing

    // Reset the error field when we start following an existing in-flight
    // bootstrap for this key.
    activeCommunityBootstrapStatus.set({key, loading: true, loaded: false})

    return existing
      .then(bootstrap => {
        if (
          communityBootstrapPromiseGenerations.get(key) === generation &&
          get(activeCommunityBootstrapStatus).key === key
        ) {
          activeCommunityBootstrapStatus.set({key, loading: false, loaded: true})
        }

        return bootstrap
      })
      .catch(error => {
        if (
          communityBootstrapPromiseGenerations.get(key) === generation &&
          get(activeCommunityBootstrapStatus).key === key
        ) {
          activeCommunityBootstrapStatus.set({
            key,
            loading: false,
            loaded: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        throw error
      })
  }

  const generation = ++communityBootstrapGeneration
  communityBootstrapPromiseGenerations.set(key, generation)

  if (updateStatus) {
    // Clear any prior error from a different key before we start a fresh
    // bootstrap for this one. Without this, navigating from a failed
    // community to a healthy one can leave the error visible until the new
    // load completes.
    activeCommunityBootstrapStatus.set({key, loading: true, loaded: false})
  }

  const cacheVersion = communityBootstrapCacheVersion
  const promise = loadCommunityBootstrap(session)
    .then(bootstrap => {
      if (cacheVersion === communityBootstrapCacheVersion) {
        completedCommunityBootstrap.set(key, bootstrap)
      }
      if (
        updateStatus &&
        communityBootstrapPromiseGenerations.get(key) === generation &&
        get(activeCommunityBootstrapStatus).key === key
      ) {
        activeCommunityBootstrapStatus.set({key, loading: false, loaded: true})
      }

      return bootstrap
    })
    .catch(error => {
      if (
        updateStatus &&
        communityBootstrapPromiseGenerations.get(key) === generation &&
        get(activeCommunityBootstrapStatus).key === key
      ) {
        activeCommunityBootstrapStatus.set({
          key,
          loading: false,
          loaded: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      throw error
    })
    .finally(() => {
      if (communityBootstrapPromises.get(key) === promise) communityBootstrapPromises.delete(key)
    })

  communityBootstrapPromises.set(key, promise)

  return promise
}

export const recoverCommunityBootstrap = async (
  session: ExactCommunitySession,
  options: {
    recoverAuth?: boolean
    authTimeout?: number
    updateStatus?: boolean
  } = {},
) => {
  const viewerPubkey = normalizePubkey(pubkey.get() || "")
  const pointer = getExactCommunitySessionPointer(session)
  const isCurrentRecovery = () =>
    get(activeExactCommunityPointer)?.address === pointer.address &&
    normalizePubkey(pubkey.get() || "") === viewerPubkey

  if (!isCurrentRecovery()) throw new Error("Community recovery was superseded")

  clearCommunityBootstrapCache(pointer.address)
  startCommunityPermissionLoadContext()

  if (options.recoverAuth && get(pubkey)) {
    await recoverActiveNip46Receiver().catch(() => false)
    const definition = readCachedCommunityDefinition(pointer)
    const relays = normalizeRelays([...(definition?.relays || []), ...session.relayHints])

    await Promise.allSettled(
      relays.map(relay => recoverCommunityRelayAuth(relay, {timeout: options.authTimeout})),
    )
  }

  if (!isCurrentRecovery()) throw new Error("Community recovery was superseded")

  return ensureCommunityBootstrap(session, {
    key: getCommunityBootstrapKey(session, pubkey.get() || ""),
    updateStatus: options.updateStatus,
  })
}
