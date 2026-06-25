import {publishThunk, repository} from "@welshman/app"
import {makeEvent, normalizeRelayUrl, isRelayUrl, type TrustedEvent} from "@welshman/util"
import {randomId} from "@welshman/lib"
import {GIT_PERMALINK, type PermalinkEvent} from "@nostr-git/core/types"
import type {RepoCommunityOption} from "@nostr-git/ui"
import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
import {
  makeEventPublicationRef,
  makeTargetedPublicationForCommunity,
  withPublicationTargetingId,
} from "@app/core/community-targeting"

export type PublicationDestinationSelection = {
  personal: boolean
  communityPubkeys: string[]
}

const normalizeRelay = (relay?: string) => {
  if (!relay) return ""

  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

const withoutTargetingTags = (tags: string[][] = []) => tags.filter(tag => tag[0] !== "h")

const clonePermalink = (permalink: PermalinkEvent, createdAt: number): PermalinkEvent => ({
  ...permalink,
  id: "",
  sig: "",
  pubkey: "",
  created_at: createdAt,
  tags: withoutTargetingTags(permalink.tags || []),
})

const getCommunityLabel = (community: RepoCommunityOption) => community.label || community.pubkey

const getDeclaredCommunityRelays = (community: RepoCommunityOption) =>
  normalizeRelays([community.relay || "", ...(community.relays || [])])

const getCommunityRelays = (community: RepoCommunityOption, baseRelays: string[]) => {
  const communityRelays = getDeclaredCommunityRelays(community)

  if (communityRelays.length === 0) {
    throw new Error(`${getCommunityLabel(community)} must declare relays before publishing.`)
  }

  return normalizeRelays([...communityRelays, ...baseRelays])
}

export const publishPermalinkToDestinations = ({
  permalink,
  relays,
  communityOptions,
  selection,
  createdAt = Math.floor(Date.now() / 1000),
}: {
  permalink: PermalinkEvent
  relays: string[]
  communityOptions: RepoCommunityOption[]
  selection: PublicationDestinationSelection
  createdAt?: number
}): TrustedEvent | undefined => {
  const baseRelays = normalizeRelays(relays)
  let firstPublishedEvent: TrustedEvent | undefined

  if (selection.personal) {
    const personalThunk = publishThunk({
      event: clonePermalink(permalink, createdAt) as any,
      relays: baseRelays,
    })
    if (personalThunk?.event) {
      const event = personalThunk.event as TrustedEvent
      repository.publish(event)
      firstPublishedEvent ||= event
    }
  }

  for (const [index, communityPubkey] of selection.communityPubkeys.entries()) {
    const community = communityOptions.find(option => option.pubkey === communityPubkey)
    if (!community) continue

    const targetingId = randomId()
    const communityRelays = getCommunityRelays(community, baseRelays)
    const declaredCommunityRelays = getDeclaredCommunityRelays(community)
    const permalinkEvent = withPublicationTargetingId(
      clonePermalink(permalink, createdAt + 1 + index * 2),
      targetingId,
    )
    const permalinkThunk = publishThunk({event: permalinkEvent as any, relays: communityRelays})
    const publishedPermalink = permalinkThunk?.event as TrustedEvent | undefined
    if (publishedPermalink) {
      repository.publish(publishedPermalink)
      firstPublishedEvent ||= publishedPermalink
    }

    const targetingEvent = makeEvent(TARGETED_PUBLICATION_KIND, {
      ...makeTargetedPublicationForCommunity({
        targetingId,
        originalKind: GIT_PERMALINK,
        originalRef: publishedPermalink?.id
          ? makeEventPublicationRef({
              id: publishedPermalink.id,
              relay: communityRelays[0],
              pubkey: publishedPermalink.pubkey,
            })
          : undefined,
        communityPubkey: community.pubkey,
        communityRelay: declaredCommunityRelays[0],
      }),
      created_at: createdAt + 2 + index * 2,
    })
    const targetingThunk = publishThunk({event: targetingEvent, relays: communityRelays})
    if (targetingThunk?.event) repository.publish(targetingThunk.event as TrustedEvent)
  }

  return firstPublishedEvent
}
