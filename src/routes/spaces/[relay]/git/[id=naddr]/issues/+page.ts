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
  const {load} = await import("@welshman/net")

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.issues.map((issue: IssueEvent) => issue.id)],
  }

  const statusEventFilter = {
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [...repoClass.issues.map((issue: IssueEvent) => issue.id)],
  }

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(repoClass.repoEvent!).toString()],
  }

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  const comments = derived(
    deriveEvents(repository, {filters: [commentFilter]}),
    events => events.filter(isCommentEvent) as CommentEvent[],
  )

  await load({
    relays: repoClass.relays,
    filters: [commentFilter, statusEventFilter, issueFilter],
  })

  return {
    comments,
    statusEvents,
    issueFilter,
    commentFilter,
    statusEventFilter,
    repoRelays: repoClass.relays,
  }
}
