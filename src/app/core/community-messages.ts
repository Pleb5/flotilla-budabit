import type {EventContent, TrustedEvent} from "@welshman/util"
import {MESSAGE, THREAD, getTagValue} from "@welshman/util"
import {normalizePubkey} from "@app/core/community"
import type {CommunityRoomRoot} from "@app/core/community-rooms"
import {eventTargetsCommunity, getRoomRootIdForMessage} from "@app/core/community-feeds"

export type CommunityRoomMessageParent = {
  id: string
  pubkey: string
  relay?: string
}

export const makeCommunityRoomMessage = ({
  communityPubkey,
  room,
  content,
  relay,
  parent,
  tags = [],
}: {
  communityPubkey: string
  room: Pick<CommunityRoomRoot, "id" | "creatorPubkey">
  content: string
  relay?: string
  parent?: CommunityRoomMessageParent
  tags?: string[][]
}): EventContent => {
  const eventTags = [
    ["h", normalizePubkey(communityPubkey)],
    ["E", room.id, relay || "", room.creatorPubkey],
    ["K", String(THREAD)],
    ...tags,
  ]

  if (parent) {
    eventTags.push(["q", parent.id, parent.relay || "", parent.pubkey])
  }

  return {content, tags: eventTags}
}

export const getCommunityRoomMessageParentId = (event: TrustedEvent) =>
  event.kind === MESSAGE ? getTagValue("q", event.tags) || "" : ""

export const readCommunityRoomMessage = (
  event: TrustedEvent,
  communityPubkey?: string,
  roomRootId?: string,
) => {
  if (event.kind !== MESSAGE) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined
  const roomId = getRoomRootIdForMessage(event)
  if (!roomId) return undefined
  if (roomRootId && roomId !== roomRootId) return undefined

  return {
    id: event.id,
    event,
    communityPubkey: getTagValue("h", event.tags) || "",
    roomRootId: roomId,
    parentMessageId: getCommunityRoomMessageParentId(event),
  }
}

export const readCommunityRoomMessages = (
  events: TrustedEvent[],
  communityPubkey?: string,
  roomRootId?: string,
) =>
  events
    .map(event => readCommunityRoomMessage(event, communityPubkey, roomRootId))
    .filter((message): message is NonNullable<ReturnType<typeof readCommunityRoomMessage>> =>
      Boolean(message),
    )
