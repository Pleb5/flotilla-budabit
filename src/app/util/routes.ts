import type {Page} from "@sveltejs/kit"
import * as nip19 from "nostr-tools/nip19"
import {goto} from "$app/navigation"
import {sleep} from "@welshman/lib"
import type {TrustedEvent} from "@welshman/util"
import {pubkey, tracker} from "@welshman/app"
import {scrollToEvent} from "@lib/html"
import {identity} from "@welshman/lib"
import {getPubkeyTagValues, getTagValue} from "@welshman/util"
import {makeChatId, entityLink, DM_KIND} from "@app/core/state"
import {parseCommunityInput} from "@app/core/community"

export const parseCommunityRouteParam = (community: string | undefined) => {
  if (!community) return undefined

  try {
    return parseCommunityInput(decodeURIComponent(community))
  } catch {
    return parseCommunityInput(community)
  }
}

export const encodeCommunityRouteParam = (community: string) => {
  const parsed = parseCommunityInput(community)
  const value = parsed ? nip19.npubEncode(parsed.pubkey) : community

  return encodeURIComponent(value)
}

export const makeCommunityPath = (community: string, ...extra: (string | undefined)[]) => {
  let path = `/c/${encodeCommunityRouteParam(community)}`

  if (extra.length > 0) {
    path +=
      "/" +
      extra
        .filter(identity)
        .map(s => encodeURIComponent(s as string))
        .join("/")
  }

  return path
}

export const makeCommunityRoomPath = (community: string, roomId: string) =>
  makeCommunityPath(community, "rooms", roomId)

export const makeCommunityThreadPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "threads", eventId)

export const makeCommunityCalendarPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "calendar", eventId)

export const makeCommunityGoalPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "goals", eventId)

export const makeCommunityGitPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "git", eventId)

export const makeGitPath = (_url?: string, eventId?: string) =>
  `/git${eventId ? `/${encodeURIComponent(eventId)}` : ""}`

export const makeGitIssuePath = (url?: string, eventId?: string) =>
  `${makeGitPath(url, eventId)}/issues`

export const makeCommunityPermalinkPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "permalinks", eventId)

export const makeCommunityWidgetPath = (community: string, eventId?: string) =>
  makeCommunityPath(community, "widgets", eventId)

export const makeSpacePath = (community: string, ...extra: (string | undefined)[]) =>
  makeCommunityPath(community, ...extra)

export const makeRoomPath = (community: string, roomId?: string) =>
  makeCommunityPath(community, "rooms", roomId)

export const makeThreadPath = (community: string, eventId?: string) =>
  makeCommunityThreadPath(community, eventId)

export const makeCalendarPath = (community: string, eventId?: string) =>
  makeCommunityCalendarPath(community, eventId)

export const makeGoalPath = (community: string, eventId?: string) =>
  makeCommunityGoalPath(community, eventId)

export const getRoomItemPath = (community: string, event: TrustedEvent) => {
  const roomId = getTagValue("E", event.tags) || getTagValue("e", event.tags) || event.id

  return makeCommunityPath(community, "rooms", roomId)
}

export const goToSpace = (community: string, options: Record<string, any> = {}) =>
  goto(makeSpacePath(community), options)

export const makeChatPath = (recipient: string) => {
  const id = makeChatId(recipient)

  return `/chat/${id}`
}

export const getPrimaryNavItem = ($page: Page) => $page.route?.id?.split("/")[1]

export const getPrimaryNavItemIndex = ($page: Page) => {
  switch (getPrimaryNavItem($page)) {
    case "settings":
      return 3
    default:
      return 0
  }
}

export const goToEvent = async (event: TrustedEvent, options: Record<string, any> = {}) => {
  const urls = Array.from(tracker.getRelays(event.id))
  const path = await getEventPath(event, urls)

  if (path.includes("://")) {
    window.open(path)
  } else {
    goto(path, options)

    await sleep(300)
    await scrollToEvent(event.id)
  }
}

export const getEventPath = async (event: TrustedEvent, urls: string[]) => {
  if (event.kind === DM_KIND) {
    const selfPubkey = pubkey.get()
    const participants = Array.from(new Set([event.pubkey, ...getPubkeyTagValues(event.tags)]))
    const recipients = participants.filter(pk => pk !== selfPubkey)

    if (recipients.length !== 1) {
      return "/chat"
    }

    return makeChatPath(recipients[0])
  }

  return entityLink(nip19.neventEncode({id: event.id, relays: urls}))
}
