import type {EventContent, TrustedEvent} from "@welshman/util"
import {THREAD, getTag, getTagValue} from "@welshman/util"
import {COMMUNITY_SUBTYPE_ROOM, normalizePubkey} from "@app/core/community"
import {eventTargetsCommunity} from "@app/core/community-feeds"

export const COMMUNITY_ROOM_LABEL_KIND = 1985
export const COMMUNITY_ROOM_LABEL_NAMESPACE = "budabit:room"
export const COMMUNITY_ROOM_LABEL_ARCHIVED = "archived"
export const COMMUNITY_ROOM_LABEL_ACTIVE = "active"

export type CommunityRoomRoot = {
  id: string
  communityPubkey: string
  name: string
  about: string
  event: TrustedEvent
  creatorPubkey: string
}

export const makeCommunityRoomRoot = ({
  communityPubkey,
  name,
  about = "",
  tags = [],
}: {
  communityPubkey: string
  name: string
  about?: string
  tags?: string[][]
}): EventContent => ({
  content: about,
  tags: [["h", normalizePubkey(communityPubkey)], [COMMUNITY_SUBTYPE_ROOM], ["title", name], ...tags],
})

export const readCommunityRoomRoot = (
  event: TrustedEvent,
  communityPubkey?: string,
): CommunityRoomRoot | undefined => {
  if (event.kind !== THREAD) return undefined
  if (!getTag(COMMUNITY_SUBTYPE_ROOM, event.tags)) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined

  const scopedCommunity = getTagValue("h", event.tags)
  const normalizedCommunity = normalizePubkey(scopedCommunity || "")
  const name = getTagValue("title", event.tags) || "Room"

  if (!normalizedCommunity) return undefined

  return {
    id: event.id,
    communityPubkey: normalizedCommunity,
    name,
    about: event.content || "",
    event,
    creatorPubkey: event.pubkey,
  }
}

export const readCommunityRoomRoots = (events: TrustedEvent[], communityPubkey?: string) =>
  events
    .map(event => readCommunityRoomRoot(event, communityPubkey))
    .filter((room): room is CommunityRoomRoot => Boolean(room))

export const makeCommunityRoomArchiveLabel = ({
  communityPubkey,
  room,
  archived,
  relay,
}: {
  communityPubkey: string
  room: Pick<CommunityRoomRoot, "id" | "creatorPubkey">
  archived: boolean
  relay?: string
}): EventContent => ({
  content: "",
  tags: [
    ["h", normalizePubkey(communityPubkey)],
    ["E", room.id, relay || "", room.creatorPubkey],
    ["K", String(THREAD)],
    ["L", COMMUNITY_ROOM_LABEL_NAMESPACE],
    [
      "l",
      archived ? COMMUNITY_ROOM_LABEL_ARCHIVED : COMMUNITY_ROOM_LABEL_ACTIVE,
      COMMUNITY_ROOM_LABEL_NAMESPACE,
    ],
  ],
})

export const getCommunityRoomArchiveLabelValue = (event: TrustedEvent, roomId: string) => {
  if (event.kind !== COMMUNITY_ROOM_LABEL_KIND) return undefined
  if (getTagValue("E", event.tags) !== roomId) return undefined
  if (!event.tags.some(tag => tag[0] === "L" && tag[1] === COMMUNITY_ROOM_LABEL_NAMESPACE)) {
    return undefined
  }

  const label = event.tags.find(
    tag => tag[0] === "l" && tag[2] === COMMUNITY_ROOM_LABEL_NAMESPACE,
  )?.[1]

  if (label !== COMMUNITY_ROOM_LABEL_ARCHIVED && label !== COMMUNITY_ROOM_LABEL_ACTIVE) {
    return undefined
  }

  return label
}

export const isCommunityRoomArchived = ({
  roomId,
  labels,
  authoritativePubkeys,
}: {
  roomId: string
  labels: TrustedEvent[]
  authoritativePubkeys?: string[]
}) => {
  const authoritative = new Set((authoritativePubkeys || []).map(normalizePubkey).filter(Boolean))
  const latest = labels
    .filter(label => !authoritative.size || authoritative.has(normalizePubkey(label.pubkey)))
    .filter(label => getCommunityRoomArchiveLabelValue(label, roomId))
    .sort((a, b) => b.created_at - a.created_at)[0]

  return getCommunityRoomArchiveLabelValue(latest, roomId) === COMMUNITY_ROOM_LABEL_ARCHIVED
}
