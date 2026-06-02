import {nip19} from "nostr-tools"

import {parseGraspRepoHttpUrl} from "./grasp-url.js"
import {sanitizeRelays} from "./sanitize-relays.js"

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
  userOutboxRelays?: string[]
  gitRelays?: string[]
}

export interface RepoRelayPolicyResult {
  repoRelays: string[]
  publishRelays: string[]
  naddrRelays: string[]
  taggedRelays: string[]
  isGrasp: boolean
}

export const resolveRepoRelayPolicy = ({
  event,
  fallbackRepoRelays = [],
  userOutboxRelays = [],
  gitRelays = [],
}: RepoRelayPolicyInput): RepoRelayPolicyResult => {
  const taggedRelays = getTaggedRelaysFromRepoEvent(event)
  const fallbackRelays = sanitizeRelays(toStringArray(fallbackRepoRelays))
  const outboxRelays = sanitizeRelays(toStringArray(userOutboxRelays))
  const normalizedGitRelays = sanitizeRelays(toStringArray(gitRelays))

  const isGrasp = isLikelyGraspRepoEvent(event)
  const repoRelays = isGrasp
    ? sanitizeRelays(taggedRelays)
    : sanitizeRelays([...taggedRelays, ...fallbackRelays])
  const nonGraspRelays = sanitizeRelays([...repoRelays, ...outboxRelays, ...normalizedGitRelays])
  const publishRelays = isGrasp ? repoRelays : nonGraspRelays

  return {
    repoRelays,
    publishRelays,
    naddrRelays: publishRelays,
    taggedRelays,
    isGrasp,
  }
}

export interface BuildRepoNaddrInput {
  event: any
  fallbackPubkey?: string
  fallbackRepoRelays?: string[]
  userOutboxRelays?: string[]
  gitRelays?: string[]
}

export const buildRepoNaddrFromEvent = ({
  event,
  fallbackPubkey = "",
  fallbackRepoRelays = [],
  userOutboxRelays = [],
  gitRelays = [],
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
    userOutboxRelays,
    gitRelays,
  })

  return nip19.naddrEncode({
    kind,
    pubkey,
    identifier,
    relays: naddrRelays.length > 0 ? naddrRelays : undefined,
  })
}
