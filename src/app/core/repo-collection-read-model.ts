import {DELETE, type TrustedEvent} from "@welshman/util"
import {parseTargetedPublication} from "@app/core/community"
import {getPublicationTargetingId} from "@app/core/community-targeting"
import {parseRepoStarReaction, type RepoStarRef} from "@app/util/repo-stars"

export type RepoCollectionCommunityOption = {
  ownerPubkey: string
  address: string
  communityId: string
  label?: string
  relay?: string
  relays?: string[]
}

export type RepoCollectionCommunityStar = {
  targetEvent: TrustedEvent
  star: RepoStarRef
  community: RepoCollectionCommunityOption
}

export type RepoCollectionReadState = {
  personalStars: RepoStarRef[]
  communityOptions: RepoCollectionCommunityOption[]
  communityStars: RepoCollectionCommunityStar[]
  communityHistoryComplete: boolean
}

export type RepoCollectionStatus = "collected" | "uncollected" | "indeterminate" | "unavailable"

export const getRepoCollectionStatus = (
  collected: boolean,
  communityHistoryComplete: boolean,
  loadingTimedOut = false,
): RepoCollectionStatus => {
  if (collected) return "collected"
  if (communityHistoryComplete) return "uncollected"
  return loadingTimedOut ? "unavailable" : "indeterminate"
}

export const getDeletedRepoCollectionTargetIds = (
  targetEvents: TrustedEvent[],
  deleteEvents: TrustedEvent[],
) => {
  const targetsById = new Map(targetEvents.map(event => [event.id, event]))
  const deletedIds = new Set<string>()

  for (const event of deleteEvents) {
    if (event.kind !== DELETE) continue

    for (const tag of event.tags) {
      if (tag[0] !== "e" || !tag[1]) continue
      const target = targetsById.get(tag[1])
      if (target?.pubkey === event.pubkey) deletedIds.add(tag[1])
    }
  }

  return deletedIds
}

export const buildRepoCommunityStarCollections = ({
  viewerPubkey,
  communityOptions,
  targetEvents,
  targetDeleteEvents,
  reactionEvents,
}: {
  viewerPubkey: string
  communityOptions: RepoCollectionCommunityOption[]
  targetEvents: TrustedEvent[]
  targetDeleteEvents: TrustedEvent[]
  reactionEvents: TrustedEvent[]
}): RepoCollectionCommunityStar[] => {
  if (!viewerPubkey || communityOptions.length === 0) return []

  const deletedTargetIds = getDeletedRepoCollectionTargetIds(targetEvents, targetDeleteEvents)
  const communitiesByAddress = new Map(
    communityOptions.filter(option => option.address).map(option => [option.address, option]),
  )
  const targetsByTargetingId = new Map<
    string,
    Array<{targetEvent: TrustedEvent; community: RepoCollectionCommunityOption}>
  >()
  const targetsByOriginalEventId = new Map<
    string,
    Array<{targetEvent: TrustedEvent; community: RepoCollectionCommunityOption}>
  >()
  const targetsByOriginalAddress = new Map<
    string,
    Array<{targetEvent: TrustedEvent; community: RepoCollectionCommunityOption}>
  >()

  const addTarget = (
    map: Map<string, Array<{targetEvent: TrustedEvent; community: RepoCollectionCommunityOption}>>,
    key: string,
    target: {targetEvent: TrustedEvent; community: RepoCollectionCommunityOption},
  ) => {
    if (!key) return
    const current = map.get(key) || []
    current.push(target)
    map.set(key, current)
  }

  for (const event of targetEvents) {
    if (event.pubkey !== viewerPubkey || deletedTargetIds.has(event.id)) continue
    const targeting = parseTargetedPublication(event)
    if (!targeting) continue

    for (const communityRef of targeting.communities) {
      const community = communitiesByAddress.get(communityRef.address)
      if (!community) continue

      const target = {targetEvent: event, community}
      if (!targeting.source) {
        addTarget(targetsByTargetingId, targeting.id, target)
      } else if (targeting.source.type === "e") {
        addTarget(targetsByOriginalEventId, targeting.source.value, target)
      } else if (targeting.source.type === "a") {
        addTarget(targetsByOriginalAddress, targeting.source.value, target)
      }
    }
  }

  const collectionsByKey = new Map<string, RepoCollectionCommunityStar>()

  for (const event of reactionEvents) {
    const star = parseRepoStarReaction(event)
    if (!star) continue
    const identifier = event.tags.find(tag => tag[0] === "d")?.[1] || ""
    const address = identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""

    const targets = [
      ...(targetsByTargetingId.get(getPublicationTargetingId(event)) || []).filter(
        target => target.targetEvent.pubkey === event.pubkey,
      ),
      ...(targetsByOriginalEventId.get(event.id) || []),
      ...(targetsByOriginalAddress.get(address) || []),
    ]

    for (const target of targets) {
      const key = `${target.targetEvent.id}:${target.community.address}:${star.reaction.id}`
      collectionsByKey.set(key, {...target, star})
    }
  }

  return Array.from(collectionsByKey.values())
}
