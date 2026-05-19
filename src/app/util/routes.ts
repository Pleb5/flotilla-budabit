import type {Page} from "@sveltejs/kit"
import * as nip19 from "nostr-tools/nip19"
import {goto} from "$app/navigation"
import {request} from "@welshman/net"
import {sleep} from "@welshman/lib"
import type {Filter, TrustedEvent} from "@welshman/util"
import {pubkey, repository} from "@welshman/app"
import {scrollToEvent} from "@lib/html"
import {identity} from "@welshman/lib"
import {
  COMMENT,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  getPubkeyTagValues,
  getTagValue,
} from "@welshman/util"
import {makeChatId, entityLink, DM_KIND} from "@app/core/state"
import {
  TARGETED_PUBLICATION_KIND,
  makeCommunityNcommunity,
  parseCommunityInput,
  parseTargetedPublication,
} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {getEventRelayHints, makeEventNevent} from "@app/util/event-links"

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
  const value = parsed
    ? parsed.relays.length > 0
      ? makeCommunityNcommunity({pubkey: parsed.pubkey, relayHints: parsed.relays})
      : nip19.npubEncode(parsed.pubkey)
    : community

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

const isRoomRootEvent = (event: TrustedEvent) => event.tags.some(tag => tag[0] === "room")

const getCommunityPubkeyForEvent = (event: TrustedEvent) => {
  const scopedCommunity = getTagValue("h", event.tags)

  return scopedCommunity ? parseCommunityInput(scopedCommunity)?.pubkey : undefined
}

const getEventRootId = (event: TrustedEvent) =>
  getTagValue("E", event.tags) || getTagValue("e", event.tags)

const TARGETED_PUBLICATION_ROUTE_KINDS = [EVENT_TIME, ZAP_GOAL, SMART_WIDGET_KIND]

const hasTargetedPublicationPath = (kind: number) => TARGETED_PUBLICATION_ROUTE_KINDS.includes(kind)

const makeTargetedPublicationPath = (communityPubkey: string, kind: number) => {
  switch (kind) {
    case EVENT_TIME:
      return makeCommunityCalendarPath(communityPubkey)
    case ZAP_GOAL:
      return makeCommunityGoalPath(communityPubkey)
    case SMART_WIDGET_KIND:
      return makeCommunityWidgetPath(communityPubkey)
    default:
      return undefined
  }
}

const getFirstTargetedPublicationCommunity = (events: TrustedEvent[]) => {
  for (const event of events) {
    const targeting = parseTargetedPublication(event)
    const communityPubkey = targeting?.communities[0]?.pubkey

    if (communityPubkey) return communityPubkey
  }

  return undefined
}

const getTargetedPublicationFiltersForOriginal = (event: TrustedEvent): Filter[] => {
  if (!hasTargetedPublicationPath(event.kind)) return []

  const filters: Filter[] = []
  const targetingId = getTagValue("h", event.tags)
  const identifier = getTagValue("d", event.tags)

  if (targetingId) {
    filters.push({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#d": [targetingId],
      "#k": [String(event.kind)],
    })
  }

  if (identifier) {
    filters.push({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#a": [`${event.kind}:${event.pubkey}:${identifier}`],
      "#k": [String(event.kind)],
    })
  }

  filters.push({
    kinds: [TARGETED_PUBLICATION_KIND],
    "#e": [event.id],
    "#k": [String(event.kind)],
  })

  return filters
}

const getTargetedPublicationCommunityForOriginal = (event: TrustedEvent) => {
  const filters = getTargetedPublicationFiltersForOriginal(event)

  return filters.length
    ? getFirstTargetedPublicationCommunity(repository.query(filters, {shouldSort: false}) as TrustedEvent[])
    : undefined
}

const getTargetedPublicationEventPath = (event: TrustedEvent) => {
  if (event.kind === TARGETED_PUBLICATION_KIND) {
    const targeting = parseTargetedPublication(event)
    const communityPubkey = targeting?.communities[0]?.pubkey

    return communityPubkey && targeting
      ? makeTargetedPublicationPath(communityPubkey, targeting.kind)
      : undefined
  }

  if (!hasTargetedPublicationPath(event.kind)) return undefined

  const directCommunityPubkey = getCommunityPubkeyForEvent(event)
  const communityPubkey = directCommunityPubkey || getTargetedPublicationCommunityForOriginal(event)

  return communityPubkey ? makeTargetedPublicationPath(communityPubkey, event.kind) : undefined
}

const loadTargetedPublicationEventPath = async (event: TrustedEvent, urls: string[]) => {
  const filters = getTargetedPublicationFiltersForOriginal(event)

  if (filters.length === 0 || urls.length === 0) return undefined

  await request({relays: urls, filters, autoClose: true}).catch(() => undefined)

  return getTargetedPublicationEventPath(event)
}

export const getCommunityEventPath = (event: TrustedEvent) => {
  const communityPubkey = getCommunityPubkeyForEvent(event)

  const targetedPublicationPath = getTargetedPublicationEventPath(event)

  if (targetedPublicationPath) return targetedPublicationPath

  if (!communityPubkey) return undefined

  if (event.kind === THREAD) {
    return isRoomRootEvent(event)
      ? makeCommunityRoomPath(communityPubkey, event.id)
      : makeCommunityThreadPath(communityPubkey, event.id)
  }

  if (event.kind === MESSAGE) {
    const roomId = getEventRootId(event)

    return roomId ? makeCommunityRoomPath(communityPubkey, roomId) : undefined
  }

  if (event.kind === COMMENT && getTagValue("K", event.tags) === String(THREAD)) {
    const threadId = getEventRootId(event)

    return threadId ? makeCommunityThreadPath(communityPubkey, threadId) : undefined
  }

  return undefined
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
  const urls = getEventRelayHints(event)
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
  const relayHints = getEventRelayHints(event, {relays: urls})

  if (event.kind === DM_KIND) {
    const selfPubkey = pubkey.get()
    const participants = Array.from(new Set([event.pubkey, ...getPubkeyTagValues(event.tags)]))
    const recipients = participants.filter(pk => pk !== selfPubkey)

    if (recipients.length !== 1) {
      return "/chat"
    }

    return makeChatPath(recipients[0])
  }

  const communityPath = getCommunityEventPath(event)

  if (communityPath) return communityPath

  const loadedCommunityPath = await loadTargetedPublicationEventPath(event, relayHints)

  if (loadedCommunityPath) return loadedCommunityPath

  return entityLink(makeEventNevent(event, {relays: relayHints}))
}
