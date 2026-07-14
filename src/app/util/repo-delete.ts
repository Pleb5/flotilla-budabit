import {
  getAddress,
  getTagValue,
  isReplaceable,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {nip19} from "nostr-tools"
import {
  GIT_CONFLICT_METADATA,
  GIT_ISSUE,
  GIT_MERGE_METADATA,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_STACK,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@nostr-git/core/events"
import {parseGraspRepoHttpUrl} from "@nostr-git/core/utils"

export type GraspRepoDeleteTarget = {
  relay: string
  ownerNpub: string
  identifier: string
}

export type GraspRepoDeleteRequest = {
  createdAt: number
  coordinate: string
  tags: string[][]
}

const MAX_FUTURE_EVENT_SKEW_SECONDS = 5 * 60

export const getGraspRepoDeleteTarget = ({
  cloneUrl,
  ownerPubkey,
  identifier,
  relayHints = [],
}: {
  cloneUrl: string
  ownerPubkey: string
  identifier: string
  relayHints?: string[]
}): GraspRepoDeleteTarget | null => {
  let parsed: ReturnType<typeof parseGraspRepoHttpUrl>
  try {
    parsed = parseGraspRepoHttpUrl(cloneUrl)
  } catch {
    return null
  }
  if (!parsed || !ownerPubkey || !identifier) return null

  let ownerNpub = ""
  try {
    ownerNpub = nip19.npubEncode(ownerPubkey)
  } catch {
    return null
  }

  if (parsed.ownerNpub !== ownerNpub || parsed.identifier !== identifier) return null

  const cloneBase = normalizeGraspBase(parsed.httpBase)
  if (!cloneBase) return null
  const matchedRelay = relayHints
    .map(normalizeGraspBase)
    .find(candidate => candidate?.http === cloneBase.http)
  if (relayHints.length > 0 && !matchedRelay) return null

  return {relay: matchedRelay?.ws || cloneBase.ws, ownerNpub, identifier}
}

const normalizeGraspBase = (value: string): {http: string; ws: string} | null => {
  try {
    const url = new URL(value)
    const secure = url.protocol === "https:" || url.protocol === "wss:"
    if (!secure && url.protocol !== "http:" && url.protocol !== "ws:") return null
    const path = url.pathname.replace(/\/+$/, "")
    return {
      http: `${secure ? "https" : "http"}://${url.host}${path}`,
      ws: `${secure ? "wss" : "ws"}://${url.host}${path}`,
    }
  } catch {
    return null
  }
}

export const buildGraspRepoDeleteRequest = ({
  event,
  ownerPubkey,
  now = Math.floor(Date.now() / 1000),
}: {
  event: {kind: number; pubkey: string; created_at: number; tags: string[][]}
  ownerPubkey: string
  now?: number
}): GraspRepoDeleteRequest => {
  if (event.kind !== GIT_REPO_ANNOUNCEMENT) {
    throw new Error("GRASP repository deletion requires a repository announcement")
  }
  if (!ownerPubkey || event.pubkey !== ownerPubkey) {
    throw new Error("Only the repository announcement author can delete this GRASP repository")
  }

  const identifier = getTagValue("d", event.tags)
  if (!identifier) throw new Error("Repository announcement is missing its identifier")
  if (event.created_at > now + MAX_FUTURE_EVENT_SKEW_SECONDS) {
    throw new Error("Repository announcement timestamp is too far in the future")
  }

  const coordinate = `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${identifier}`
  return {
    createdAt: Math.max(now, event.created_at),
    coordinate,
    tags: [
      ["a", coordinate],
      ["k", String(GIT_REPO_ANNOUNCEMENT)],
      ["repo", coordinate],
    ],
  }
}

export const buildRepoDeleteTags = (events: TrustedEvent[]): string[][] => {
  const tags: string[][] = []
  for (const event of events) {
    if (isReplaceable(event)) tags.push(["a", getAddress(event)])
    else tags.push(["e", event.id])
  }
  return tags
}

export const getMetadataDeleteRelays = ({
  relays,
  remoteTargets,
}: {
  relays: string[]
  remoteTargets: Array<{vendor: string; url: string; graspRelay?: string}>
}): string[] => {
  const graspRelayKeys = new Set(
    remoteTargets
      .map(target => target.graspRelay?.replace(/\/+$/, ""))
      .filter((relay): relay is string => Boolean(relay)),
  )
  const graspHosts = new Set(
    remoteTargets
      .filter(target => target.vendor === "grasp" || target.vendor === "grasp-rest")
      .map(target => {
        try {
          return new URL(target.url).host.toLowerCase()
        } catch {
          return ""
        }
      })
      .filter(Boolean),
  )

  return relays.filter(relay => {
    if (graspRelayKeys.has(relay.replace(/\/+$/, ""))) return false
    try {
      return !graspHosts.has(new URL(relay).host.toLowerCase())
    } catch {
      return false
    }
  })
}

export const canDeleteLocalRepoAfterRemoteResults = ({
  inventoryError,
  metadataDeliveriesAttempted,
  metadataDeliveriesAccepted,
  selectedRemoteIds,
  remoteResults,
}: {
  inventoryError?: string
  metadataDeliveriesAttempted: number
  metadataDeliveriesAccepted: number
  selectedRemoteIds: Set<string>
  remoteResults: Array<{id: string; status: string}>
}): boolean =>
  !inventoryError &&
  metadataDeliveriesAccepted === metadataDeliveriesAttempted &&
  remoteResults.every(
    result =>
      !selectedRemoteIds.has(result.id) ||
      result.status === "accepted" ||
      result.status === "deleted",
  )

export const getRepoDeleteAddresses = (
  repoAddresses: Iterable<string> = [],
  fallbackAddress = "",
) => Array.from(new Set([...repoAddresses, fallbackAddress].filter(Boolean)))

export const matchesRepoDeleteEvent = (
  event: {tags?: string[][]} | null | undefined,
  repoAddresses: Iterable<string> = [],
  fallbackAddress = "",
) => {
  const repoTag = getTagValue("repo", event?.tags || [])

  return !!repoTag && getRepoDeleteAddresses(repoAddresses, fallbackAddress).includes(repoTag)
}

export const buildRepoOwnedDeleteFilters = ({
  pubkey,
  repoName,
  repoAddresses,
}: {
  pubkey: string
  repoName: string
  repoAddresses: Iterable<string>
}) => {
  const filters: Filter[] = [
    {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [pubkey], "#d": [repoName]},
    {kinds: [GIT_REPO_STATE], authors: [pubkey], "#d": [repoName]},
  ]

  const addresses = getRepoDeleteAddresses(repoAddresses)

  if (addresses.length > 0) {
    filters.push({
      kinds: [
        GIT_STACK,
        GIT_MERGE_METADATA,
        GIT_CONFLICT_METADATA,
        GIT_ISSUE,
        GIT_PULL_REQUEST,
        GIT_PULL_REQUEST_UPDATE,
        GIT_STATUS_OPEN,
        GIT_STATUS_APPLIED,
        GIT_STATUS_CLOSED,
        GIT_STATUS_DRAFT,
      ],
      authors: [pubkey],
      "#a": addresses,
    })
  }

  return filters
}
