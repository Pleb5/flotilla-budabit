export const ssr = false

import {
  Address,
  COMMENT,
  GIT_ISSUE,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "@welshman/util"
import {isCommentEvent, type CommentEvent, type IssueEvent} from "@nostr-git/shared-types"
import {derived} from "svelte/store"
import type { PageLoad } from "./$types"

export const load: PageLoad = async ({ parent }) => {
  const {repoClass} = await parent()
  const {deriveEvents} = await import("@welshman/store")
  const {repository} = await import("@welshman/app")

  const statusEventFilter = {
    kinds: [
      GIT_STATUS_OPEN,
      GIT_STATUS_COMPLETE,
      GIT_STATUS_CLOSED,
      GIT_STATUS_DRAFT,
    ],
    "#e": [...repoClass.issues.map((issue: IssueEvent) => issue.id)],
  }

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  const comments = derived(
    deriveEvents(repository, {
      filters: [{
        kinds: [COMMENT],
        "#E": [...repoClass.issues.map((issue: IssueEvent) => issue.id)],
      }],
    }),
    events => events.filter(isCommentEvent) as CommentEvent[],
  )

  // Group status events by root ID for easier lookup (reactive, loads as events arrive)
  const localStatusEventsByRoot = derived(statusEvents, events => {
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

  return {
    comments,
    statusEvents,
    statusEventsByRoot: localStatusEventsByRoot, // Reactive store that loads as events arrive
    repoRelays: repoClass.relays,
  }
}
