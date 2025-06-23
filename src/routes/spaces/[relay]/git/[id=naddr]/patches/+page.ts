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

export const load = async ({parent}) => {
  const {repoClass} = await parent()
  const {deriveEvents} = await import("@welshman/store")
  const {repository} = await import("@welshman/app")
  const {load} = await import("@welshman/net")

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const statusEventFilter = {
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }

  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    "#t": ["root"],
  }

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  const comments = derived(
    deriveEvents(repository, {filters: [commentFilter]}),
    events => events.filter(isCommentEvent) as CommentEvent[],
  )

  const uniqueAuthors = new Set(repoClass.patches.map((patch: PatchEvent) => patch.pubkey))

  await load({
    relays: repoClass.relays,
    filters: [commentFilter, statusEventFilter, patchFilter],
  })

  return {
    comments,
    statusEvents,
    patchFilter,
    uniqueAuthors,
  }
}
