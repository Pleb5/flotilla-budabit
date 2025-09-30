import type { CommentEvent, IssueEvent, RepoAnnouncementEvent, StatusEvent } from "@nostr-git/shared-types"
import { publishThunk } from "@welshman/app"
import { INDEXER_RELAYS } from "@app/state"
import { Router } from "@welshman/router"

export const postComment = (comment: CommentEvent, relays: string[]) => {
  return publishThunk({
    relays: relays ?? [...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
    event: comment,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    event: issue,
    relays: merged,
  })
}

export const postStatus = (status: StatusEvent, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: status,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  return publishThunk({
    relays: relays ?? [...INDEXER_RELAYS, ...Router.get().FromUser().getUrls()],
    event: repo,
  })
}