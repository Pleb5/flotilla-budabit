import type {EventContent, TrustedEvent} from "@welshman/util"
import {COMMENT, EVENT_DATE, EVENT_TIME, getTagValue} from "@welshman/util"
import {normalizePubkey} from "@app/core/community"
import {eventTargetsCommunity} from "@app/core/community-feeds"

export type CommunityCalendarReplyParent = {
  id: string
  pubkey: string
  kind?: number
  relay?: string
}

const CALENDAR_EVENT_KINDS = [EVENT_DATE, EVENT_TIME]

export const getCalendarEventAddress = (event: Pick<TrustedEvent, "kind" | "pubkey" | "tags">) => {
  const identifier = getTagValue("d", event.tags)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

export const makeCommunityCalendarEventReply = ({
  communityPubkey,
  calendarEvent,
  content,
  relay,
  parent,
  tags = [],
}: {
  communityPubkey: string
  calendarEvent: Pick<TrustedEvent, "id" | "pubkey" | "kind" | "tags">
  content: string
  relay?: string
  parent?: CommunityCalendarReplyParent
  tags?: string[][]
}): EventContent => {
  const relayHint = relay || ""
  const calendarAddress = getCalendarEventAddress(calendarEvent)
  const calendarKind = CALENDAR_EVENT_KINDS.includes(calendarEvent.kind)
    ? calendarEvent.kind
    : EVENT_TIME
  const eventTags: string[][] = [
    ["h", normalizePubkey(communityPubkey)],
    ["E", calendarEvent.id, relayHint, calendarEvent.pubkey],
    ["K", String(calendarKind)],
    ["P", calendarEvent.pubkey, relayHint],
  ]

  if (calendarAddress) {
    eventTags.push(["A", calendarAddress, relayHint, calendarEvent.pubkey])
  }

  if (parent) {
    const parentRelay = parent.relay || relayHint

    eventTags.push(
      ["e", parent.id, parentRelay, parent.pubkey],
      ["k", String(parent.kind || COMMENT)],
      ["p", parent.pubkey, parentRelay],
    )
  } else {
    eventTags.push(
      ["e", calendarEvent.id, relayHint, calendarEvent.pubkey],
      ["k", String(calendarKind)],
      ["p", calendarEvent.pubkey, relayHint],
    )

    if (calendarAddress) {
      eventTags.push(["a", calendarAddress, relayHint, calendarEvent.pubkey])
    }
  }

  return {content, tags: [...eventTags, ...tags]}
}

export const readCommunityCalendarEventReply = (
  event: TrustedEvent,
  communityPubkey?: string,
  calendarEventId?: string,
  calendarAddress?: string,
) => {
  if (event.kind !== COMMENT) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined
  const rootKind = getTagValue("K", event.tags) || ""
  if (!CALENDAR_EVENT_KINDS.map(String).includes(rootKind)) return undefined

  const rootId = getTagValue("E", event.tags) || ""
  const rootAddress = getTagValue("A", event.tags) || getTagValue("a", event.tags) || ""

  if (!rootId && !rootAddress) return undefined
  if (calendarEventId || calendarAddress) {
    const matchesId = Boolean(calendarEventId && rootId === calendarEventId)
    const matchesAddress = Boolean(calendarAddress && rootAddress === calendarAddress)

    if (!matchesId && !matchesAddress) return undefined
  }

  const parentId = getTagValue("e", event.tags) || ""
  const parentKind = getTagValue("k", event.tags) || ""

  return {
    id: event.id,
    event,
    communityPubkey: getTagValue("h", event.tags) || "",
    calendarEventId: rootId,
    calendarAddress: rootAddress,
    parentReplyId: parentId && parentId !== rootId && parentKind !== rootKind ? parentId : "",
  }
}
