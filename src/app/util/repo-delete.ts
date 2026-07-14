import {getTagValue, type Filter} from "@welshman/util"
import {nip19} from "nostr-tools"
import {normalizeWsOrigin} from "@nostr-git/core/api"
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

export const getGraspRepoDeleteTarget = ({
  cloneUrl,
  ownerPubkey,
  identifier,
}: {
  cloneUrl: string
  ownerPubkey: string
  identifier: string
}): GraspRepoDeleteTarget | null => {
  const parsed = parseGraspRepoHttpUrl(cloneUrl)
  if (!parsed || !ownerPubkey || !identifier) return null

  let ownerNpub = ""
  try {
    ownerNpub = nip19.npubEncode(ownerPubkey)
  } catch {
    return null
  }

  if (parsed.ownerNpub !== ownerNpub || parsed.identifier !== identifier) return null

  const relay = normalizeWsOrigin(cloneUrl)
  if (!relay.startsWith("ws://") && !relay.startsWith("wss://")) return null

  return {relay, ownerNpub, identifier}
}

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
