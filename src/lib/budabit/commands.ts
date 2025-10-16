import type { CommentEvent, IssueEvent, RepoAnnouncementEvent, StatusEvent, PermalinkEvent, RepoStateEvent, GraspSetEvent, NostrEvent } from "@nostr-git/shared-types"
import { buildRoleLabelEvent } from "./labels"
import { publishThunk } from "@welshman/app"
import { INDEXER_RELAYS } from "@app/core/state"
import { Router } from "@welshman/router"

export const publishEvent = <T extends NostrEvent>(event: T, relays?: string[]) => {
  const merged = Array.from(new Set([...(relays ?? []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: event,
  })
}

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
  return publishThunk({
    event: graspServersList,
    relays: merged,
  })
}

// Publish a NIP-32 role label event (kind 1985) for assignees/reviewers
export const postRoleLabel = (params: {
  rootId: string
  role: "assignee" | "reviewer"
  pubkeys: string[]
  repoAddr?: string
  relays: string[]
  created_at?: number
}) => {
  const { rootId, role, pubkeys, repoAddr, relays, created_at } = params
  const event = buildRoleLabelEvent({
    rootId,
    role,
    pubkeys,
    repoAddr,
    created_at
  })
  const merged = Array.from(new Set([...(relays || []), ...Router.get().FromUser().getUrls(), ...INDEXER_RELAYS]))
  return publishThunk({
    relays: merged,
    event: event,
  })
}