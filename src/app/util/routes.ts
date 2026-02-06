import type {Page} from "@sveltejs/kit"
import {get} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {goto} from "$app/navigation"
import {nthEq, remove, sleep} from "@welshman/lib"
import type {TrustedEvent} from "@welshman/util"
import {pubkey, tracker, loadRelay} from "@welshman/app"
import {scrollToEvent} from "@lib/html"
import {identity} from "@welshman/lib"
import {
  getTagValue,
  DIRECT_MESSAGE,
  DIRECT_MESSAGE_FILE,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  EVENT_TIME,
  getPubkeyTagValues,
  Address,
} from "@welshman/util"
import {
  makeChatId,
  entityLink,
  decodeRelay,
  encodeRelay,
  userSpaceUrls,
  hasNip29,
  ROOM,
} from "@app/core/state"
import {
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_ISSUE,
  GIT_STATUS_OPEN,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
} from "@nostr-git/core/events"
import {COMMENT} from "@welshman/util"

// Repository event kinds (use Address directly)
const GIT_REPO_KINDS = [GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE]

// Collaboration event kinds (reference repository via 'a' tag)
const GIT_COLLABORATION_KINDS = [
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_ISSUE,
  COMMENT,
  GIT_STATUS_OPEN,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
]

// All Git event kinds handled by BudaBit
const GIT_EVENT_KINDS = [...GIT_REPO_KINDS, ...GIT_COLLABORATION_KINDS]
import {lastPageBySpaceUrl} from "@app/util/history"

export const makeSpacePath = (url: string, ...extra: (string | undefined)[]) => {
  let path = `/spaces/${encodeRelay(url)}`

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

export const goToSpace = async (url: string) => {
  const prevPath = lastPageBySpaceUrl.get(encodeRelay(url))

  if (prevPath) {
    goto(prevPath)
  } else if (hasNip29(await loadRelay(url))) {
    goto(makeSpacePath(url, "recent"))
  } else {
    goto(makeSpacePath(url, "chat"))
  }
}

export const makeChatPath = (pubkeys: string[]) => {
  const id = makeChatId(remove(pubkey.get()!, pubkeys))

  return `/chat/${id}`
}

export const makeRoomPath = (url: string, h: string) => `/spaces/${encodeRelay(url)}/${h}`

export const makeSpaceChatPath = (url: string) => makeRoomPath(url, "chat")

export const makeGoalPath = (url: string, eventId?: string) => makeSpacePath(url, "goals", eventId)

export const makeThreadPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "threads", eventId)

export const makeCalendarPath = (url: string, eventId?: string) =>
  makeSpacePath(url, "calendar", eventId)

export const getPrimaryNavItem = ($page: Page) => $page.route?.id?.split("/")[1]

export const getPrimaryNavItemIndex = ($page: Page) => {
  const urls = get(userSpaceUrls)

  switch (getPrimaryNavItem($page)) {
    case "discover":
      return urls.length + 2
    case "spaces": {
      const routeUrl = decodeRelay($page.params.relay || "")

      return urls.findIndex(url => url === routeUrl) + 1
    }
    case "settings":
      return urls.length + 3
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
  if (event.kind === DIRECT_MESSAGE || event.kind === DIRECT_MESSAGE_FILE) {
    return makeChatPath([event.pubkey, ...getPubkeyTagValues(event.tags)])
  }

  const h = getTagValue(ROOM, event.tags)

  // Handle Git-related events - route them to BudaBit's internal Git pages
  if (GIT_EVENT_KINDS.includes(event.kind)) {
    // For repository announcements (30617) and state (30618), use naddr
    if (GIT_REPO_KINDS.includes(event.kind)) {
      const address = Address.fromEvent(event)
      const naddr = address.toNaddr()
      const url = urls.length > 0 ? urls[0] : ""

      if (url) {
        return `/spaces/${encodeRelay(url)}/git/${naddr}`
      }
    }

    // For patches, pull requests, issues, comments, and status events
    // These reference a repository via 'a' tag
    if (GIT_COLLABORATION_KINDS.includes(event.kind)) {
      // Get the repository address from 'a' tag
      const repoAddress = getTagValue("a", event.tags)

      if (repoAddress) {
        try {
          // Parse the coordinate to get pubkey and identifier
          const [kind, pubkey, identifier] = repoAddress.split(":")

          if (pubkey && identifier) {
            // Create naddr for the repository
            const address = new Address(parseInt(kind), pubkey, identifier, urls)
            const naddr = address.toNaddr()
            const url = urls.length > 0 ? urls[0] : ""

            if (url) {
              // Route to specific sub-pages based on event kind
              if (
                event.kind === GIT_PATCH ||
                event.kind === GIT_PULL_REQUEST ||
                event.kind === GIT_PULL_REQUEST_UPDATE
              ) {
                return `/spaces/${encodeRelay(url)}/git/${naddr}/patches/${event.id}`
              }

              if (event.kind === GIT_ISSUE) {
                return `/spaces/${encodeRelay(url)}/git/${naddr}/issues/${event.id}`
              }

              // Comments and status events go to the feed view of the repository
              return `/spaces/${encodeRelay(url)}/git/${naddr}/feed`
            }
          }
        } catch (e) {
          // If parsing fails, fall through to default handling
          console.error("Failed to parse repository address for Git event:", e)
        }
      }
    }
  }

  if (urls.length > 0) {
    const url = urls[0]

    if (event.kind === ZAP_GOAL) {
      return makeGoalPath(url, event.id)
    }

    if (event.kind === THREAD) {
      return makeThreadPath(url, event.id)
    }

    if (event.kind === EVENT_TIME) {
      return makeCalendarPath(url, event.id)
    }

    if (event.kind === MESSAGE) {
      return h ? makeRoomPath(url, h) : makeSpacePath(url, "chat")
    }

    const kind = event.tags.find(nthEq(0, "K"))?.[1]
    const id = event.tags.find(nthEq(0, "E"))?.[1]

    if (id && kind) {
      if (parseInt(kind) === ZAP_GOAL) {
        return makeGoalPath(url, id)
      }

      if (parseInt(kind) === THREAD) {
        return makeThreadPath(url, id)
      }

      if (parseInt(kind) === EVENT_TIME) {
        return makeCalendarPath(url, id)
      }

      if (parseInt(kind) === MESSAGE) {
        return h ? makeRoomPath(url, h) : makeSpacePath(url, "chat")
      }
    }
  }

  return entityLink(nip19.neventEncode({id: event.id, relays: urls}))
}

export const getRoomItemPath = (url: string, event: TrustedEvent) => {
  switch (event.kind) {
    case THREAD:
      return makeThreadPath(url, event.id)
    case ZAP_GOAL:
      return makeGoalPath(url, event.id)
    case EVENT_TIME:
      return makeCalendarPath(url, event.id)
  }
}
