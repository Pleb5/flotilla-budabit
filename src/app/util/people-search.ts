import * as nip19 from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {
  getProfileListPubkeys,
  normalizePubkey,
  parseCommunityDefinition,
  PROFILE_LIST_KIND,
} from "@app/core/community"
import type {TrustAssessment} from "@app/core/trust-assessment"

export type PeopleSearchProfile = {
  display_name?: string
  name?: string
  nip05?: string
  about?: string
}

export type PeopleSearchBucketKey =
  | "identity"
  | "recent_conversation"
  | "community"
  | "direct_follow"
  | "known_profile"

export type PeopleSearchResult = {
  pubkey: string
  bucket: PeopleSearchBucketKey
  label: string
  evidenceLabels: string[]
  profile?: PeopleSearchProfile | null
  score: number
  textScore: number
}

export type BuildPeopleSearchResultsOptions = {
  query: string
  recentConversationPubkeys?: string[]
  communityPubkeys?: string[]
  directFollowPubkeys?: string[]
  knownPubkeys?: string[]
  profileMatches?: string[]
  excludePubkeys?: string[]
  communityAssessments?: Map<string, TrustAssessment>
  getProfile?: (pubkey: string) => PeopleSearchProfile | null | undefined
  limit?: number
}

type Candidate = {
  pubkey: string
  identity: boolean
  recentConversation: boolean
  community: boolean
  directFollow: boolean
  knownProfile: boolean
}

const PEOPLE_SEARCH_BUCKET_PRIORITY: Record<PeopleSearchBucketKey, number> = {
  identity: 5000,
  recent_conversation: 4000,
  community: 3000,
  direct_follow: 2000,
  known_profile: 1000,
}

const normalizeSearchValue = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()

const uniquePubkeys = (pubkeys: Array<string | undefined | null>) =>
  Array.from(new Set(pubkeys.map(pubkey => normalizePubkey(pubkey || "")).filter(Boolean)))

export const decodePeopleSearchPubkey = (query: string) => {
  const normalized = normalizePubkey(query)
  if (normalized) return normalized

  try {
    const decoded = nip19.decode(query.trim())

    if (decoded.type === "nprofile") {
      return normalizePubkey(decoded.data.pubkey)
    }
  } catch {
    return ""
  }

  return ""
}

export const getCommunityPeoplePubkeys = ({
  definitionEvents = [],
  profileListEvents = [],
}: {
  definitionEvents?: TrustedEvent[]
  profileListEvents?: TrustedEvent[]
}) => {
  const pubkeys = new Set<string>()

  for (const event of definitionEvents) {
    const definition = parseCommunityDefinition(event)
    if (definition?.pubkey) pubkeys.add(definition.pubkey)
  }

  for (const event of profileListEvents) {
    if (event.kind !== PROFILE_LIST_KIND) continue

    const listOwner = normalizePubkey(event.pubkey)
    if (listOwner) pubkeys.add(listOwner)

    for (const member of getProfileListPubkeys(event)) {
      pubkeys.add(member)
    }
  }

  return Array.from(pubkeys)
}

const encodeNpub = (pubkey: string) => {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return ""
  }
}

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

export const getPeopleSearchTextScore = ({
  pubkey,
  profile,
  query,
}: {
  pubkey: string
  profile?: PeopleSearchProfile | null
  query: string
}) => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return 0

  let score = 0

  score += scoreSearchField(profile?.display_name, normalizedQuery, {
    exact: 1200,
    prefix: 1000,
    wordPrefix: 900,
    contains: 700,
  })
  score += scoreSearchField(profile?.name, normalizedQuery, {
    exact: 1100,
    prefix: 950,
    wordPrefix: 850,
    contains: 650,
  })
  score += scoreSearchField(profile?.nip05, normalizedQuery, {
    exact: 1000,
    prefix: 850,
    wordPrefix: 750,
    contains: 550,
  })
  score += scoreSearchField(pubkey, normalizedQuery, {
    exact: 900,
    prefix: 700,
    wordPrefix: 0,
    contains: 250,
  })
  score += scoreSearchField(encodeNpub(pubkey), normalizedQuery, {
    exact: 900,
    prefix: 700,
    wordPrefix: 0,
    contains: 250,
  })
  score += scoreSearchField(profile?.about, normalizedQuery, {
    exact: 200,
    prefix: 160,
    wordPrefix: 120,
    contains: 80,
  })

  return score
}

const upsertCandidate = (
  candidates: Map<string, Candidate>,
  pubkey: string,
  source: Partial<Omit<Candidate, "pubkey">>,
) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return

  const candidate = candidates.get(normalizedPubkey) || {
    pubkey: normalizedPubkey,
    identity: false,
    recentConversation: false,
    community: false,
    directFollow: false,
    knownProfile: false,
  }

  candidates.set(normalizedPubkey, {...candidate, ...source})
}

const hasCommunityEvidence = (assessment: TrustAssessment | undefined) =>
  Boolean(assessment && !assessment.suppressed && assessment.score > 0)

const getCommunityEvidenceLabels = (assessment: TrustAssessment | undefined) =>
  assessment?.displayLabels?.length ? assessment.displayLabels : ["Community match"]

const getBucket = (
  candidate: Candidate,
  assessment: TrustAssessment | undefined,
): PeopleSearchBucketKey => {
  if (candidate.identity) return "identity"
  if (candidate.recentConversation) return "recent_conversation"
  if (hasCommunityEvidence(assessment)) return "community"
  if (candidate.directFollow) return "direct_follow"
  return "known_profile"
}

const getEvidenceLabels = (
  bucket: PeopleSearchBucketKey,
  assessment: TrustAssessment | undefined,
) => {
  if (bucket === "identity") return ["Exact match"]
  if (bucket === "recent_conversation") return ["Recent conversation"]
  if (bucket === "community") return getCommunityEvidenceLabels(assessment)
  if (bucket === "direct_follow") return ["You follow"]
  return ["Known profile"]
}

export const buildPeopleSearchResults = ({
  query,
  recentConversationPubkeys = [],
  communityPubkeys = [],
  directFollowPubkeys = [],
  knownPubkeys = [],
  profileMatches = [],
  excludePubkeys = [],
  communityAssessments = new Map(),
  getProfile,
  limit = 20,
}: BuildPeopleSearchResultsOptions): PeopleSearchResult[] => {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return []

  const candidates = new Map<string, Candidate>()
  const excluded = new Set(uniquePubkeys(excludePubkeys))
  const normalizedProfileMatches = uniquePubkeys(profileMatches)
  const identityPubkey = decodePeopleSearchPubkey(query)

  if (identityPubkey) upsertCandidate(candidates, identityPubkey, {identity: true})
  for (const pubkey of uniquePubkeys(recentConversationPubkeys)) {
    upsertCandidate(candidates, pubkey, {recentConversation: true})
  }
  for (const pubkey of uniquePubkeys(communityPubkeys)) {
    upsertCandidate(candidates, pubkey, {community: true})
  }
  for (const pubkey of uniquePubkeys(directFollowPubkeys)) {
    upsertCandidate(candidates, pubkey, {directFollow: true})
  }
  for (const pubkey of uniquePubkeys([...knownPubkeys, ...normalizedProfileMatches])) {
    upsertCandidate(candidates, pubkey, {knownProfile: true})
  }

  return Array.from(candidates.values())
    .flatMap(candidate => {
      if (excluded.has(candidate.pubkey)) return []

      const profile = getProfile?.(candidate.pubkey) || null
      const textScore = getPeopleSearchTextScore({pubkey: candidate.pubkey, profile, query})
      const isProfileMatch = normalizedProfileMatches.includes(candidate.pubkey)

      if (!candidate.identity && textScore === 0 && !isProfileMatch) return []

      const assessment = communityAssessments.get(candidate.pubkey)
      const bucket = getBucket(candidate, assessment)
      const evidenceLabels = getEvidenceLabels(bucket, assessment)
      const score =
        PEOPLE_SEARCH_BUCKET_PRIORITY[bucket] +
        textScore +
        (bucket === "community" ? assessment?.score || 0 : 0)

      return [
        {
          pubkey: candidate.pubkey,
          bucket,
          label: evidenceLabels[0] || "Known profile",
          evidenceLabels,
          profile,
          score,
          textScore,
        },
      ]
    })
    .sort((a, b) => b.score - a.score || a.pubkey.localeCompare(b.pubkey))
    .slice(0, limit)
}
