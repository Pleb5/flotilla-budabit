import {
  GIT_REPO_ANNOUNCEMENT,
  parseRepoAnnouncementEvent,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {Address} from "@welshman/util"
import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"

export type LoadedRepoSearchItem = {
  address: string
  event: RepoAnnouncementEvent
  relayHint: string
}

export type RepoDiscoveryProgress = {
  phase: "idle" | "preparing" | "fetching_profiles" | "fetching_repos" | "complete"
  currentBucketKey: RepoDiscoveryPriorityKey | null
  currentBucketLabel: string
  currentBucketIndex: number
  totalBuckets: number
  currentBucketProcessedAuthors: number
  currentBucketTotalAuthors: number
  searchedAuthors: number
  totalAuthors: number
  fetchedProfileAuthors: number
  fetchedRepoAuthors: number
  foundRepos: number
  matchedRepos: number
  timedOut: boolean
}

export type RepoOwnerProfile = {
  display_name?: string
  name?: string
  nip05?: string
  picture?: string
}

export type RepoDiscoveryPriorityKey =
  | "profile_matches"
  | "viewer"
  | "starred_owners"
  | "direct_follows"
  | "trust_network"
  | "known_repo_owners"

export type RepoDiscoveryPrioritySetting = {
  key: RepoDiscoveryPriorityKey
  label: string
  description: string
  enabled: boolean
}

export type RepoDiscoveryBucket = {
  key: RepoDiscoveryPriorityKey
  label: string
  description: string
  pubkeys: string[]
}

export const REPO_DISCOVERY_TIMEOUT_MS = 30000
export const REPO_DISCOVERY_SETTINGS_STORAGE_KEY = "budabit:git:repo-discovery-settings:v1"

const SEARCH_AUTHOR_CHUNK_SIZE = 24

const REPO_DISCOVERY_PRIORITY_METADATA: Record<
  RepoDiscoveryPriorityKey,
  Omit<RepoDiscoveryPrioritySetting, "enabled">
> = {
  profile_matches: {
    key: "profile_matches",
    label: "Owner profile matches",
    description: "Owners whose loaded profile text already matches the current search.",
  },
  viewer: {
    key: "viewer",
    label: "My account",
    description: "Your own published repositories.",
  },
  starred_owners: {
    key: "starred_owners",
    label: "Starred owners",
    description: "People who own repositories you starred.",
  },
  direct_follows: {
    key: "direct_follows",
    label: "You follow",
    description: "Repository owners you directly follow.",
  },
  trust_network: {
    key: "trust_network",
    label: "Direct social overlay",
    description: "Bounded direct follow and mute ordering signals.",
  },
  known_repo_owners: {
    key: "known_repo_owners",
    label: "Known repo owners",
    description: "Owners already seen from loaded repositories in this session.",
  },
}

const REPO_DISCOVERY_PRIORITY_KEYS = Object.keys(
  REPO_DISCOVERY_PRIORITY_METADATA,
) as RepoDiscoveryPriorityKey[]

const DEFAULT_REPO_DISCOVERY_PRIORITY_KEYS: RepoDiscoveryPriorityKey[] = [
  "profile_matches",
  "viewer",
  "starred_owners",
  "direct_follows",
  "known_repo_owners",
]

const normalizeSearchValue = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()

const getOwnerSearchValues = (
  pubkey: string,
  profile?: {display_name?: string; name?: string; nip05?: string} | null,
) =>
  [profile?.display_name, profile?.name, profile?.nip05, pubkey]
    .map(normalizeSearchValue)
    .filter(Boolean)

const getRepoSearchEvent = (
  repo: LoadedRepoSearchItem | {event: RepoAnnouncementEvent} | RepoAnnouncementEvent,
) =>
  (repo as LoadedRepoSearchItem)?.event ||
  (repo as {event: RepoAnnouncementEvent})?.event ||
  (repo as RepoAnnouncementEvent)

const scoreSearchField = (
  value: unknown,
  query: string,
  {
    exact,
    prefix,
    wordPrefix,
    contains,
  }: {exact: number; prefix: number; wordPrefix: number; contains: number},
) => {
  const normalizedValue = normalizeSearchValue(value)
  if (!normalizedValue) return 0
  if (normalizedValue === query) return exact
  if (normalizedValue.startsWith(query)) return prefix
  if (normalizedValue.split(/[^a-z0-9]+/i).some(token => token.startsWith(query))) return wordPrefix
  if (normalizedValue.includes(query)) return contains
  return 0
}

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export const getRepoAddressFromEvent = (event: RepoAnnouncementEvent): string => {
  try {
    return Address.fromEvent(event).toString()
  } catch {
    const dTag = (event.tags || []).find((tag: string[]) => tag[0] === "d")?.[1] || ""
    return dTag && event.pubkey && event.kind ? `${event.kind}:${event.pubkey}:${dTag}` : ""
  }
}

export const toLoadedRepoSearchItem = (
  event: RepoAnnouncementEvent,
  relayHint = "",
): LoadedRepoSearchItem | null => {
  const address = getRepoAddressFromEvent(event)
  if (!address) return null

  return {address, event, relayHint}
}

export const mergeLoadedRepoSearchItems = (
  primary: LoadedRepoSearchItem[],
  secondary: LoadedRepoSearchItem[],
): LoadedRepoSearchItem[] => {
  const items: LoadedRepoSearchItem[] = []
  const seen = new Set<string>()

  for (const item of [...primary, ...secondary]) {
    if (!item?.address || seen.has(item.address)) continue
    seen.add(item.address)
    items.push(item)
  }

  return items
}

export const getRepoSearchRelevanceScore = ({
  repo,
  query,
  viewerPubkey,
  starredOwners = [],
  starredAddresses = [],
  profile,
}: {
  repo: LoadedRepoSearchItem | {event: RepoAnnouncementEvent} | RepoAnnouncementEvent
  query: string
  viewerPubkey?: string | null
  starredOwners?: string[]
  starredAddresses?: string[]
  profile?: {display_name?: string; name?: string; nip05?: string} | null
}) => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return 0

  const event = getRepoSearchEvent(repo)
  if (!event) return 0

  try {
    const parsed = parseRepoAnnouncementEvent(event)
    const address =
      (repo as LoadedRepoSearchItem)?.address ||
      (repo as {address?: string})?.address ||
      getRepoAddressFromEvent(event)
    let score = 0

    score += scoreSearchField(parsed?.name, normalizedQuery, {
      exact: 1200,
      prefix: 1100,
      wordPrefix: 1000,
      contains: 900,
    })
    score += scoreSearchField(parsed?.repoId, normalizedQuery, {
      exact: 1100,
      prefix: 1000,
      wordPrefix: 925,
      contains: 825,
    })
    score += scoreSearchField(parsed?.description, normalizedQuery, {
      exact: 450,
      prefix: 375,
      wordPrefix: 325,
      contains: 250,
    })

    for (const ownerValue of getOwnerSearchValues(event.pubkey, profile)) {
      score += scoreSearchField(ownerValue, normalizedQuery, {
        exact: 220,
        prefix: 180,
        wordPrefix: 140,
        contains: 100,
      })
    }

    if (viewerPubkey && event.pubkey === viewerPubkey) score += 500
    if (starredOwners.includes(event.pubkey)) score += 150
    if (address && starredAddresses.includes(address)) score += 175

    return score
  } catch {
    return 0
  }
}

export const sortRepoSearchResults = <
  T extends LoadedRepoSearchItem | {event: RepoAnnouncementEvent},
>({
  items,
  query,
  viewerPubkey,
  starredOwners = [],
  starredAddresses = [],
  getProfile,
}: {
  items: T[]
  query: string
  viewerPubkey?: string | null
  starredOwners?: string[]
  starredAddresses?: string[]
  getProfile?: (pubkey: string) => {display_name?: string; name?: string; nip05?: string} | null
}): T[] => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return items

  return items
    .map((item, index) => {
      const event = getRepoSearchEvent(item)
      return {
        item,
        index,
        createdAt: event?.created_at || 0,
        score: getRepoSearchRelevanceScore({
          repo: item,
          query: normalizedQuery,
          viewerPubkey,
          starredOwners,
          starredAddresses,
          profile: event ? getProfile?.(event.pubkey) : null,
        }),
      }
    })
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt || a.index - b.index)
    .map(({item}) => item)
}

export const getDefaultRepoDiscoveryPrioritySettings = (): RepoDiscoveryPrioritySetting[] =>
  DEFAULT_REPO_DISCOVERY_PRIORITY_KEYS.map(key => ({
    ...REPO_DISCOVERY_PRIORITY_METADATA[key],
    enabled: true,
  }))

export const coerceRepoDiscoveryPrioritySettings = (
  value: unknown,
): RepoDiscoveryPrioritySetting[] => {
  const byKey = new Map(
    REPO_DISCOVERY_PRIORITY_KEYS.map(key => [
      key,
      {...REPO_DISCOVERY_PRIORITY_METADATA[key], enabled: true},
    ]),
  )
  const normalized: RepoDiscoveryPrioritySetting[] = []
  const seen = new Set<RepoDiscoveryPriorityKey>()

  const normalizeKey = (key: unknown): RepoDiscoveryPriorityKey | null => {
    if (key === "bookmarked_owners") return "starred_owners"
    if (typeof key === "string" && byKey.has(key as RepoDiscoveryPriorityKey)) {
      return key as RepoDiscoveryPriorityKey
    }
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const key = normalizeKey((item as {key?: unknown})?.key)
      if (!key || seen.has(key)) continue
      seen.add(key)
      normalized.push({
        ...byKey.get(key)!,
        enabled: (item as {enabled?: boolean})?.enabled !== false,
      })
    }
  }

  for (const key of DEFAULT_REPO_DISCOVERY_PRIORITY_KEYS) {
    if (!seen.has(key)) {
      normalized.push(byKey.get(key)!)
    }
  }

  return normalized
}

const uniquePubkeys = (pubkeys: Array<string | null | undefined>) =>
  Array.from(new Set(pubkeys.filter(Boolean) as string[]))

export const buildRepoDiscoveryBuckets = ({
  settings = getDefaultRepoDiscoveryPrioritySettings(),
  viewerPubkey,
  starredOwners = [],
  followPubkeys = [],
  knownOwners = [],
  profileMatches = [],
  trustScores,
}: {
  settings?: RepoDiscoveryPrioritySetting[]
  viewerPubkey?: string | null
  starredOwners?: string[]
  followPubkeys?: string[]
  knownOwners?: string[]
  profileMatches?: string[]
  trustScores: Map<string, number>
}): RepoDiscoveryBucket[] => {
  const normalizedSettings = coerceRepoDiscoveryPrioritySettings(settings)
  const trustPubkeys = Array.from(trustScores.entries())
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([pubkey]) => pubkey)

  const sources: Record<RepoDiscoveryPriorityKey, string[]> = {
    profile_matches: uniquePubkeys(profileMatches),
    viewer: uniquePubkeys(viewerPubkey ? [viewerPubkey] : []),
    starred_owners: uniquePubkeys(starredOwners),
    direct_follows: uniquePubkeys(followPubkeys),
    trust_network: uniquePubkeys(trustPubkeys),
    known_repo_owners: uniquePubkeys(knownOwners),
  }

  return normalizedSettings
    .filter(setting => setting.enabled)
    .map(setting => ({
      key: setting.key,
      label: setting.label,
      description: setting.description,
      pubkeys: sources[setting.key] || [],
    }))
}

export const dedupeRepoDiscoveryBuckets = (
  buckets: RepoDiscoveryBucket[],
): RepoDiscoveryBucket[] => {
  const seen = new Set<string>()

  return buckets
    .map(bucket => ({
      ...bucket,
      pubkeys: bucket.pubkeys.filter(pubkey => {
        if (!pubkey || seen.has(pubkey)) return false
        seen.add(pubkey)
        return true
      }),
    }))
    .filter(bucket => bucket.pubkeys.length > 0)
}

export const repoMatchesSearchQuery = ({
  repo,
  query,
  profile,
}: {
  repo: LoadedRepoSearchItem | {event: RepoAnnouncementEvent} | RepoAnnouncementEvent
  query: string
  profile?: {display_name?: string; name?: string; nip05?: string} | null
}) => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  const event = getRepoSearchEvent(repo)
  if (!event) return false

  try {
    const parsed = parseRepoAnnouncementEvent(event)
    const haystack = [
      parsed?.name,
      parsed?.description,
      parsed?.repoId,
      ...getOwnerSearchValues(event.pubkey, profile),
    ]
      .map(normalizeSearchValue)
      .filter(Boolean)
      .join(" ")

    return haystack.includes(normalizedQuery)
  } catch {
    return false
  }
}

export const buildRepoDiscoveryCandidatePubkeys = ({
  settings = getDefaultRepoDiscoveryPrioritySettings(),
  viewerPubkey,
  starredOwners = [],
  followPubkeys = [],
  knownOwners = [],
  profileMatches = [],
  trustScores,
}: {
  settings?: RepoDiscoveryPrioritySetting[]
  viewerPubkey?: string | null
  starredOwners?: string[]
  followPubkeys?: string[]
  knownOwners?: string[]
  profileMatches?: string[]
  trustScores: Map<string, number>
}) => {
  return dedupeRepoDiscoveryBuckets(
    buildRepoDiscoveryBuckets({
      settings,
      viewerPubkey,
      starredOwners,
      followPubkeys,
      knownOwners,
      profileMatches,
      trustScores,
    }),
  ).flatMap(bucket => bucket.pubkeys)
}

export async function discoverRepoAnnouncements({
  candidatePubkeys,
  getRelaysForAuthors,
  identifier,
  timeoutMs = REPO_DISCOVERY_TIMEOUT_MS,
  signal,
  onProgress,
}: {
  candidatePubkeys: string[]
  getRelaysForAuthors: (pubkeys: string[]) => string[]
  identifier?: string | null
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (progress: RepoDiscoveryProgress) => void
}): Promise<{events: RepoAnnouncementEvent[]; timedOut: boolean}> {
  const orderedPubkeys = Array.from(new Set(candidatePubkeys.filter(Boolean)))
  const totalAuthors = orderedPubkeys.length
  const startedAt = Date.now()
  const eventsByAddress = new Map<string, RepoAnnouncementEvent>()

  let searchedAuthors = 0
  let fetchedProfileAuthors = 0
  let fetchedRepoAuthors = 0
  let timedOut = false

  onProgress?.({
    phase: "preparing",
    currentBucketKey: null,
    currentBucketLabel: "",
    currentBucketIndex: 0,
    totalBuckets: 0,
    currentBucketProcessedAuthors: 0,
    currentBucketTotalAuthors: totalAuthors,
    searchedAuthors,
    totalAuthors,
    fetchedProfileAuthors,
    fetchedRepoAuthors,
    foundRepos: 0,
    matchedRepos: 0,
    timedOut,
  })

  for (const authors of chunkArray(orderedPubkeys, SEARCH_AUTHOR_CHUNK_SIZE)) {
    if (signal?.aborted) break

    const remainingMs = timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      timedOut = true
      break
    }

    const relays = Array.from(new Set(getRelaysForAuthors(authors).filter(Boolean)))
    if (relays.length > 0) {
      fetchedProfileAuthors += authors.length
      fetchedRepoAuthors += authors.length
      const filters = [
        {
          kinds: [GIT_REPO_ANNOUNCEMENT],
          authors,
          ...(identifier ? {"#d": [identifier]} : {}),
        },
      ]

      const events = await fetchRelayEventsWithTimeout<RepoAnnouncementEvent>({
        relays,
        filters,
        timeoutMs: Math.min(5000, remainingMs),
        signal,
      })

      for (const event of events) {
        const address = getRepoAddressFromEvent(event)
        if (!address) continue

        const existing = eventsByAddress.get(address)
        if (!existing || event.created_at > existing.created_at) {
          eventsByAddress.set(address, event)
        }
      }
    }

    searchedAuthors += authors.length
    onProgress?.({
      phase: "fetching_repos",
      currentBucketKey: null,
      currentBucketLabel: "",
      currentBucketIndex: 0,
      totalBuckets: 0,
      currentBucketProcessedAuthors: searchedAuthors,
      currentBucketTotalAuthors: totalAuthors,
      searchedAuthors,
      totalAuthors,
      fetchedProfileAuthors,
      fetchedRepoAuthors,
      foundRepos: eventsByAddress.size,
      matchedRepos: eventsByAddress.size,
      timedOut,
    })
  }

  if (!timedOut && Date.now() - startedAt >= timeoutMs) {
    timedOut = true
  }

  return {
    events: Array.from(eventsByAddress.values()).sort((a, b) => b.created_at - a.created_at),
    timedOut,
  }
}
