import type {
  CommentEvent,
  IssueEvent,
  RepoAnnouncementEvent,
  StatusEvent,
  RepoStateEvent,
  GraspSetEvent,
} from "@nostr-git/core/events"
import {buildRoleLabelEvent} from "./labels"
import {publishThunk, repository} from "@welshman/app"
import {load} from "@welshman/net"
import {GIT_RELAYS} from "./state"
import {Router} from "@welshman/router"
import {publishDelete} from "@src/app/core/commands"
import type {TrustedEvent} from "@welshman/util"
import type {Event as NostrEvent} from "nostr-tools"

// Helper to safely get user relay URLs, filtering out invalid values
const getUserRelayUrls = (): string[] => {
  try {
    const urls = Router.get().FromUser().getUrls()
    // Ensure we have an array of strings only
    if (!Array.isArray(urls)) return []
    return urls.filter(url => typeof url === 'string' && url.length > 0)
  } catch {
    return []
  }
}

export const publishEvent = <T extends NostrEvent>(event: T, relays?: string[]) => {
  const merged = Array.from(
    new Set([...(relays ?? []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: event,
  })
}

export const postComment = (comment: CommentEvent, relays: string[]) => {
  return publishThunk({
    relays: relays ?? [...GIT_RELAYS, ...getUserRelayUrls()],
    event: comment,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    event: issue,
    relays: merged,
  })
}

export const postStatus = (status: StatusEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: status,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: repo,
  })
}

export const postRepoStateEvent = (repoEvent: RepoStateEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: repoEvent,
  })
}

// Publish a NIP-32 label event (kind 1985)
export const postLabel = (labelEvent: any, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: labelEvent,
  })
}

export const postPermalink = (permalink: NostrEvent, relays: string[]) => {
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    event: permalink,
    relays: merged,
  })
}

export const postGraspServersList = (graspServersList: GraspSetEvent) => {
  const merged = Array.from(new Set([...getUserRelayUrls(), ...GIT_RELAYS]))
  return publishThunk({
    event: graspServersList,
    relays: merged,
  })
}

export const postExtensionSettings = (event: Parameters<typeof publishThunk>[0]["event"]) => {
  const merged = Array.from(new Set([...getUserRelayUrls(), ...GIT_RELAYS]))
  return publishThunk({
    event,
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
  const {rootId, role, pubkeys, repoAddr, relays, created_at} = params
  const event = buildRoleLabelEvent({
    rootId,
    role,
    pubkeys,
    repoAddr,
    created_at,
  })
  const merged = Array.from(
    new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )
  return publishThunk({
    relays: merged,
    event: event,
  })
}

export const deleteRoleLabelEvent = ({
  relays,
  event,
  protect = false,
}: {
  relays: string[]
  event: TrustedEvent
  protect?: boolean
}) => publishDelete({event, relays, protect})

export const deleteIssueWithLabels = async ({
  issue,
  relays = [],
  protect = false,
}: {
  issue: TrustedEvent
  relays?: string[]
  protect?: boolean
}): Promise<{labelsDeleted: number}> => {
  if (!issue) return {labelsDeleted: 0}
  if (issue.kind !== 1621) return {labelsDeleted: 0}

  const merged = Array.from(
    new Set([...(relays ?? []), ...getUserRelayUrls(), ...GIT_RELAYS]),
  )

  publishDelete({event: issue, relays: merged, protect})

  if (!issue.id || !issue.pubkey || merged.length === 0) {
    return {labelsDeleted: 0}
  }

  try {
    await load({
      relays: merged,
      filters: [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
    })
  } catch {
    // ignore label load errors; deletion can still proceed
  }

  const labelEvents = repository.query(
    [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
    {shouldSort: false},
  ) as TrustedEvent[]

  for (const labelEvent of labelEvents) {
    publishDelete({event: labelEvent, relays: merged, protect: false})
  }

  return {labelsDeleted: labelEvents.length}
}
