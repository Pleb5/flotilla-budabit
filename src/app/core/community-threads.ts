import type {EventContent, TrustedEvent} from "@welshman/util"
import {COMMENT, THREAD, getTag, getTagValue} from "@welshman/util"
import {normalizePubkey} from "@app/core/community"
import {eventTargetsCommunity} from "@app/core/community-feeds"

export type CommunityThread = {
  id: string
  communityPubkey: string
  title: string
  content: string
  event: TrustedEvent
  creatorPubkey: string
}

export type CommunityThreadReplyParent = {
  id: string
  pubkey: string
  kind?: number
  relay?: string
}

export const makeCommunityThread = ({
  communityPubkey,
  title,
  content,
  tags = [],
}: {
  communityPubkey: string
  title: string
  content: string
  tags?: string[][]
}): EventContent => ({
  content,
  tags: [["h", normalizePubkey(communityPubkey)], ["title", title], ...tags],
})

export const readCommunityThread = (
  event: TrustedEvent,
  communityPubkey?: string,
): CommunityThread | undefined => {
  if (event.kind !== THREAD) return undefined
  if (getTag("room", event.tags)) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined

  const scopedCommunity = normalizePubkey(getTagValue("h", event.tags) || "")
  const title = getTagValue("title", event.tags) || "Untitled"
  if (!scopedCommunity) return undefined

  return {
    id: event.id,
    communityPubkey: scopedCommunity,
    title,
    content: event.content || "",
    event,
    creatorPubkey: event.pubkey,
  }
}

export const readCommunityThreads = (events: TrustedEvent[], communityPubkey?: string) =>
  events
    .map(event => readCommunityThread(event, communityPubkey))
    .filter((thread): thread is CommunityThread => Boolean(thread))

export const makeCommunityThreadReply = ({
  communityPubkey,
  thread,
  content,
  relay,
  parent,
  tags = [],
}: {
  communityPubkey: string
  thread: Pick<CommunityThread, "id" | "creatorPubkey">
  content: string
  relay?: string
  parent?: CommunityThreadReplyParent
  tags?: string[][]
}): EventContent => {
  const eventTags = [
    ["h", normalizePubkey(communityPubkey)],
    ["E", thread.id, relay || "", thread.creatorPubkey],
    ["K", String(THREAD)],
    ["P", thread.creatorPubkey, relay || ""],
  ]

  if (parent) {
    const parentRelay = parent.relay || relay || ""

    eventTags.push(
      ["e", parent.id, parentRelay, parent.pubkey],
      ["k", String(parent.kind || COMMENT)],
      ["p", parent.pubkey, parentRelay],
    )
  }

  return {content, tags: [...eventTags, ...tags]}
}

export const readCommunityThreadReply = (
  event: TrustedEvent,
  communityPubkey?: string,
  threadId?: string,
) => {
  if (event.kind !== COMMENT) return undefined
  if (communityPubkey && !eventTargetsCommunity(event, communityPubkey)) return undefined
  const rootId = getTagValue("E", event.tags) || ""
  const parentId = getTagValue("e", event.tags) || ""
  if (!rootId) return undefined
  if (threadId && rootId !== threadId) return undefined
  if (getTagValue("K", event.tags) !== String(THREAD)) return undefined

  return {
    id: event.id,
    event,
    communityPubkey: getTagValue("h", event.tags) || "",
    threadId: rootId,
    parentReplyId: parentId && parentId !== rootId ? parentId : "",
  }
}
