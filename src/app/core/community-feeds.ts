import type {Filter, TrustedEvent} from "@welshman/util"
import {COMMENT, EVENT_TIME, MESSAGE, REACTION, THREAD, ZAP_GOAL, getTag, getTagValue} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND,
  TARGETED_PUBLICATION_KINDS,
  normalizePubkey,
  parseTargetedPublication,
} from "@app/core/community"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"

export const GIT_PERMALINK_KIND = 1623
export const SMART_WIDGET_KIND = 30033

export const COMMUNITY_EXCLUSIVE_KINDS = [THREAD, MESSAGE, COMMENT, REACTION, 1985, 5, 1984]
export const COMMUNITY_TARGETABLE_KINDS = [
  EVENT_TIME,
  ZAP_GOAL,
  GIT_REPO_ANNOUNCEMENT,
  GIT_PERMALINK_KIND,
  SMART_WIDGET_KIND,
] as const

export const makeCommunityExclusiveFilter = (
  communityPubkey: string,
  kinds: number[] = COMMUNITY_EXCLUSIVE_KINDS,
  extra: Filter = {},
): Filter => ({
  kinds,
  "#h": [communityPubkey],
  ...extra,
})

export const makeCommunityRoomRootsFilter = (communityPubkey: string, extra: Filter = {}): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [THREAD], extra)

export const makeCommunityForumThreadsFilter = (communityPubkey: string, extra: Filter = {}): Filter =>
  makeCommunityExclusiveFilter(communityPubkey, [THREAD], extra)

export const makeCommunityRoomMessagesFilter = (
  communityPubkey: string,
  roomRootId: string,
  extra: Filter = {},
): Filter => makeCommunityExclusiveFilter(communityPubkey, [MESSAGE], {"#E": [roomRootId], ...extra})

export const makeCommunityTargetingFilter = (
  communityPubkey: string,
  originalKinds: readonly number[] = TARGETED_PUBLICATION_KINDS,
  extra: Filter = {},
): Filter => ({
  kinds: [TARGETED_PUBLICATION_KIND],
  "#p": [communityPubkey],
  "#k": originalKinds.map(String),
  ...extra,
})

export const eventTargetsCommunity = (event: TrustedEvent, communityPubkey: string) =>
  getTagValue("h", event.tags) === normalizePubkey(communityPubkey)

export const isRoomRoot = (event: TrustedEvent, communityPubkey?: string) => {
  if (event.kind !== THREAD) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false

  return Boolean(getTag("room", event.tags))
}

export const isForumThreadRoot = (event: TrustedEvent, communityPubkey?: string) => {
  if (event.kind !== THREAD) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false

  return !getTag("room", event.tags)
}

export const filterRoomRoots = (events: TrustedEvent[], communityPubkey?: string) =>
  events.filter(event => isRoomRoot(event, communityPubkey))

export const filterForumThreadRoots = (events: TrustedEvent[], communityPubkey?: string) =>
  events.filter(event => isForumThreadRoot(event, communityPubkey))

export const getRoomRootIdForMessage = (event: TrustedEvent) => {
  if (event.kind !== MESSAGE) return ""

  return getTagValue("E", event.tags) || ""
}

export const isRoomMessage = (event: TrustedEvent, communityPubkey?: string, roomRootId?: string) => {
  if (event.kind !== MESSAGE) return false
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return false
  if (roomRootId && getRoomRootIdForMessage(event) !== roomRootId) return false

  return Boolean(getRoomRootIdForMessage(event))
}

export const makeTargetedPublicationOriginalFilters = (targetingEvents: TrustedEvent[]): Filter[] => {
  const filters: Filter[] = []

  for (const event of targetingEvents) {
    const targeting = parseTargetedPublication(event)
    if (!targeting?.ref) continue

    if (targeting.ref.type === "e") {
      filters.push({kinds: [targeting.kind], ids: [targeting.ref.value]})
      continue
    }

    const [kindValue, author, ...identifierParts] = targeting.ref.value.split(":")
    const kind = Number.parseInt(kindValue || "", 10)
    const identifier = identifierParts.join(":")

    if (!Number.isInteger(kind) || !author || !identifier) continue

    filters.push({kinds: [kind], authors: [author], "#d": [identifier]})
  }

  return filters
}
