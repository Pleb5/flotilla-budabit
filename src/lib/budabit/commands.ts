import type { CommentEvent, IssueEvent, RepoAnnouncementEvent, StatusEvent, PermalinkEvent, RepoStateEvent, GraspSetEvent } from "@nostr-git/shared-types"
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
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: repo,
  })
}

export const postRepoStateEvent = (repoEvent: RepoStateEvent, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: repoEvent,
  })
}

// Publish a NIP-32 label event (kind 1985)
export const postLabel = (labelEvent: any, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: labelEvent,
  })
}

export const postPermalink = (permalink: PermalinkEvent, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    event: permalink,
    relays: merged,
  })
}

export const postGraspServersList = (graspServersList: GraspSetEvent) => {
  const merged = Array.from(new Set([...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  const result = publishThunk({
    event: graspServersList,
    relays: merged,
  })
  console.log("📡 Published GRASP servers list:", result)
}