export const ssr = false

import {
  Address,
  COMMENT,
  GIT_PATCH,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@welshman/util"
import {isCommentEvent, type CommentEvent, type PatchEvent} from "@nostr-git/shared-types"
import {derived} from "svelte/store"
import type { PageLoad } from "./$types"

export const load: PageLoad = async ({ parent }) => {
  const {repoClass} = await parent()
  const {deriveEvents} = await import("@welshman/store")
  const {repository} = await import("@welshman/app")
  const {load} = await import("@welshman/net")

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const statusEventFilter = {
    kinds: [
      GIT_STATUS_OPEN,
      GIT_STATUS_COMPLETE,
      GIT_STATUS_CLOSED,
      GIT_STATUS_DRAFT,
    ],
    "#e": [...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent!).toString()],
  }

  await load({
    relays: repoClass.relays,
    filters: [commentFilter, statusEventFilter, patchFilter],
  })

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  const comments = derived(
    deriveEvents(repository, {filters: [commentFilter]}),
    events => events.filter(isCommentEvent) as CommentEvent[],
  )

  // Group status events by root ID for easier lookup
  const statusEventsByRoot = derived(statusEvents, events => {
    const map = new Map<string, any[]>()
    for (const event of events) {
      const rootTag = event.tags.find((t: string[]) => t[0] === "e" && t[3] === "root")
      if (rootTag) {
        const rootId = rootTag[1]
        if (!map.has(rootId)) {
          map.set(rootId, [])
        }
        map.get(rootId)!.push(event)
      }
    }
    return map
  })

  const uniqueAuthors = new Set(repoClass.patches.map((patch: PatchEvent) => patch.pubkey))

  return {
    comments,
    statusEvents,
    statusEventsByRoot,
    patchFilter,
    uniqueAuthors,
  }
}
