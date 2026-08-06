import {nip19} from "nostr-tools"

import {parseGraspRepoHttpUrl} from "./grasp-url.js"
import {sanitizeRelays, shareableRelays} from "./sanitize-relays.js"
import {validateRepoAnnouncementEvent} from "./validation.js"

const GIT_REPO_ANNOUNCEMENT = 30617
const GIT_REPO_STATE = 30618

const toStringArray = (values: unknown): string[] => {
  if (!Array.isArray(values)) return []
  return values.map(value => String(value || "").trim()).filter(Boolean)
}

const getRepoIdentifier = (event: any): string => {
  const tags = Array.isArray(event?.tags) ? event.tags : []
  const dTag = tags.find((tag: any[]) => Array.isArray(tag) && tag[0] === "d")
  const nameTag = tags.find((tag: any[]) => Array.isArray(tag) && tag[0] === "name")
  return String(dTag?.[1] || nameTag?.[1] || "").trim()
}

export interface RepoActivityRelayCoordinate {
  pubkey?: string
  identifier?: string
}

export const getRepoActivityRelays = (
  announcement: any,
  expected: RepoActivityRelayCoordinate = {},
): string[] => {
  if (!validateRepoAnnouncementEvent(announcement).success) return []

  const pubkey = String(announcement.pubkey || "")
    .trim()
    .toLowerCase()
  const dTags = announcement.tags.filter((tag: string[]) => tag[0] === "d")
  const identifier = String(dTags[0]?.[1] || "")
  const expectedPubkey = String(expected.pubkey || "")
    .trim()
    .toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(pubkey) || dTags.length !== 1 || !identifier.trim()) return []
  if (announcement.tags.some((tag: string[]) => tag[0] === "deleted")) return []
  if (expectedPubkey && pubkey !== expectedPubkey) return []
  if (expected.identifier !== undefined && identifier !== expected.identifier) return []

  return getTaggedRelaysFromRepoEvent(announcement)
}

export const getTaggedRelaysFromRepoEvent = (event: any): string[] => {
  const tags = Array.isArray(event?.tags) ? event.tags : []
  const relays = tags
    .filter((tag: any[]) => Array.isArray(tag) && tag[0] === "relays")
    .flatMap((tag: any[]) => tag.slice(1))
  return sanitizeRelays(toStringArray(relays))
}

export const getCloneUrlsFromRepoEvent = (event: any): string[] => {
  const tags = Array.isArray(event?.tags) ? event.tags : []
  const cloneUrls = tags
    .filter((tag: any[]) => Array.isArray(tag) && tag[0] === "clone")
    .flatMap((tag: any[]) => tag.slice(1))
  return toStringArray(cloneUrls)
}

export const isLikelyGraspRepoEvent = (event: any): boolean => {
  const kind = Number(event?.kind)
  if (kind !== GIT_REPO_ANNOUNCEMENT && kind !== GIT_REPO_STATE) {
    return false
  }

  const cloneUrls = getCloneUrlsFromRepoEvent(event)
  if (cloneUrls.some(url => Boolean(parseGraspRepoHttpUrl(url)))) {
    return true
  }

  if (kind === GIT_REPO_STATE) {
    return getTaggedRelaysFromRepoEvent(event).length > 0
  }

  return false
}

export interface RepoRelayPolicyInput {
  event: any
  fallbackRepoRelays?: string[]
}

export interface RepoRelayPolicyResult {
  repoRelays: string[]
  activityRelays: string[]
  naddrRelays: string[]
  taggedRelays: string[]
  isGrasp: boolean
}

export const resolveRepoRelayPolicy = ({
  event,
  fallbackRepoRelays = [],
}: RepoRelayPolicyInput): RepoRelayPolicyResult => {
  const taggedRelays = getTaggedRelaysFromRepoEvent(event)
  const fallbackRelays = sanitizeRelays(toStringArray(fallbackRepoRelays))

  const isGrasp = isLikelyGraspRepoEvent(event)
  const repoRelays = isGrasp
    ? sanitizeRelays(taggedRelays)
    : sanitizeRelays([...taggedRelays, ...fallbackRelays])

  // Relay hints embedded in shared entities (naddr) must reflect where the
  // repo's events canonically live: the announcement's relays tag. This is
  // the same for GRASP and non-GRASP repos; user outbox relays and indexer
  // defaults are publish concerns and must never leak into hints. Only when
  // the announcement declares no relays do we fall back to caller-provided
  // repo relays (e.g. relays the announcement was actually seen on).
  const naddrRelays = shareableRelays(taggedRelays.length > 0 ? taggedRelays : fallbackRelays)

  return {
    repoRelays,
    activityRelays: getRepoActivityRelays(event),
    naddrRelays,
    taggedRelays,
    isGrasp,
  }
}

export interface BuildRepoNaddrInput {
  event: any
  fallbackPubkey?: string
  fallbackRepoRelays?: string[]
}

export const buildRepoNaddrFromEvent = ({
  event,
  fallbackPubkey = "",
  fallbackRepoRelays = [],
}: BuildRepoNaddrInput): string | undefined => {
  const kind = Number(event?.kind)
  if (kind !== GIT_REPO_ANNOUNCEMENT && kind !== GIT_REPO_STATE) {
    return undefined
  }

  const identifier = getRepoIdentifier(event)
  const pubkey = String(event?.pubkey || fallbackPubkey || "").trim()

  if (!identifier || !pubkey) {
    return undefined
  }

  const {naddrRelays} = resolveRepoRelayPolicy({
    event,
    fallbackRepoRelays,
  })

  return nip19.naddrEncode({
    kind,
    pubkey,
    identifier,
    relays: naddrRelays.length > 0 ? naddrRelays : undefined,
  })
}
