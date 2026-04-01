import type {
  CommentEvent,
  IssueEvent,
  RepoAnnouncementEvent,
  StatusEvent,
  RepoStateEvent,
  GraspSetEvent,
} from "@nostr-git/core/events"
import {buildRoleLabelEvent} from "./labels"
import {abortThunk, publishThunk, repository} from "@welshman/app"
import {load} from "@welshman/net"
import {GIT_RELAYS} from "./state"
import {Router} from "@welshman/router"
import {publishDelete} from "@app/core/commands"
import {
  COMMENT,
  GIT_PATCH,
  GIT_STATUS_OPEN,
  GIT_STATUS_DRAFT,
  GIT_STATUS_CLOSED,
  GIT_STATUS_COMPLETE,
  isRelayUrl,
  normalizeRelayUrl,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE} from "@nostr-git/core/events"
import type {Event as NostrEvent} from "nostr-tools"

// Helper to safely get user relay URLs, filtering out invalid values
const getUserRelayUrls = (): string[] => {
  try {
    const urls = Router.get().FromUser().getUrls()
    // Ensure we have an array of strings only
    if (!Array.isArray(urls)) return []
    return urls.filter(url => typeof url === "string" && url.length > 0)
  } catch {
    return []
  }
}

const getScopedRelayUrls = (relays: string[] = []) =>
  Array.from(
    new Set(
      relays
        .map(relay => {
          try {
            return normalizeRelayUrl(relay)
          } catch {
            return ""
          }
        })
        .filter(isRelayUrl),
    ),
  )

export const publishEvent = <T extends NostrEvent>(event: T, relays?: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: event,
  })
}

export const postComment = (comment: CommentEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: comment,
  })
}

export const postIssue = (issue: IssueEvent, relays: string[]) => {
  return publishThunk({
    event: issue,
    relays: getScopedRelayUrls(relays),
  })
}

export const postStatus = (status: StatusEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: status,
  })
}

export const postRepoAnnouncement = (repo: RepoAnnouncementEvent, relays: string[]) => {
  const merged = Array.from(new Set([...(relays || []), ...getUserRelayUrls(), ...GIT_RELAYS]))
  return publishThunk({
    relays: merged,
    event: repo,
  })
}

export const postRepoStateEvent = (repoEvent: RepoStateEvent, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: repoEvent,
  })
}

// Publish a NIP-32 label event (kind 1985)
export const postLabel = (labelEvent: any, relays: string[]) => {
  return publishThunk({
    relays: getScopedRelayUrls(relays),
    event: labelEvent,
  })
}

export const postPermalink = (permalink: NostrEvent, relays: string[]) => {
  return publishThunk({
    event: permalink,
    relays: getScopedRelayUrls(relays),
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
  return publishThunk({
    relays: getScopedRelayUrls(relays),
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

export type DeleteProgress = {
  label: string
  completed: number
  total: number
  current?: string
}

type DeleteCallbacks = {
  signal?: AbortSignal
  onProgress?: (progress: DeleteProgress) => void
}

const createAbortError = () => new DOMException("Delete operation cancelled", "AbortError")

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const awaitWithAbort = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> => {
  throwIfAborted(signal)

  if (!signal) {
    return await promise
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.()
      reject(createAbortError())
    }

    signal.addEventListener("abort", abort, {once: true})

    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort)
    })
  })
}

const reportDeleteProgress = (
  onProgress: DeleteCallbacks["onProgress"],
  progress: DeleteProgress,
) => {
  onProgress?.(progress)
}

const waitForDeletePublish = async (
  thunk: {complete?: Promise<unknown>} | undefined,
  signal?: AbortSignal,
) => {
  if (!thunk?.complete) return

  await awaitWithAbort(thunk.complete, signal, () => abortThunk(thunk as any))
}

const getDeleteTargetLabel = (event: TrustedEvent, root: TrustedEvent) => {
  if (event.id === root.id) {
    return root.kind === GIT_PULL_REQUEST
      ? "pull request"
      : root.kind === GIT_PATCH
        ? "patch"
        : "issue"
  }

  if (event.kind === GIT_PULL_REQUEST_UPDATE) return "pull request update"
  if (event.kind === COMMENT) return "comment"
  if (event.kind === 1985) return "label"
  if (
    [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE].includes(event.kind)
  ) {
    return "status"
  }
  if (event.kind === GIT_PATCH) return "related patch"
  return "event"
}

const deleteEventsSequentially = async ({
  root,
  events,
  relays,
  protect,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  events: TrustedEvent[]
  relays: string[]
  protect: boolean
} & DeleteCallbacks) => {
  let deletedEvents = 0

  for (const event of events) {
    throwIfAborted(signal)

    reportDeleteProgress(onProgress, {
      label: "Waiting for relay acknowledgements...",
      completed: deletedEvents,
      total: events.length,
      current: getDeleteTargetLabel(event, root),
    })

    const thunk = publishDelete({
      event,
      relays,
      protect: event.id === root.id ? protect : false,
    })

    await waitForDeletePublish(thunk, signal)
    deletedEvents += 1

    reportDeleteProgress(onProgress, {
      label: "Delete requests acknowledged.",
      completed: deletedEvents,
      total: events.length,
      current: getDeleteTargetLabel(event, root),
    })
  }

  return deletedEvents
}

export const deleteIssueWithLabels = async ({
  issue,
  relays = [],
  protect = false,
  signal,
  onProgress,
}: {
  issue: TrustedEvent
  relays?: string[]
  protect?: boolean
} & DeleteCallbacks): Promise<{labelsDeleted: number}> => {
  if (!issue) return {labelsDeleted: 0}
  if (issue.kind !== 1621) return {labelsDeleted: 0}

  const merged = getScopedRelayUrls(relays)

  if (!issue.id || !issue.pubkey || merged.length === 0) {
    return {labelsDeleted: 0}
  }

  reportDeleteProgress(onProgress, {
    label: "Loading author labels...",
    completed: 0,
    total: 1,
    current: "issue",
  })

  throwIfAborted(signal)

  try {
    await awaitWithAbort(
      load({
        relays: merged,
        filters: [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
        signal,
      }),
      signal,
    )
  } catch {
    throwIfAborted(signal)
    // ignore label load errors; deletion can still proceed
  }

  const labelEvents = repository.query(
    [{kinds: [1985], "#e": [issue.id], authors: [issue.pubkey]}],
    {shouldSort: false},
  ) as TrustedEvent[]

  await deleteEventsSequentially({
    root: issue,
    events: [issue, ...labelEvents],
    relays: merged,
    protect,
    signal,
    onProgress,
  })

  return {labelsDeleted: labelEvents.length}
}

export const deletePatchOrPullRequestWithRelated = async ({
  root,
  relays = [],
  protect = false,
  signal,
  onProgress,
}: {
  root: TrustedEvent
  relays?: string[]
  protect?: boolean
} & DeleteCallbacks): Promise<{deletedEvents: number; relatedDeleted: number}> => {
  if (!root?.id) return {deletedEvents: 0, relatedDeleted: 0}
  if (![GIT_PATCH, GIT_PULL_REQUEST].includes(root.kind)) {
    return {deletedEvents: 0, relatedDeleted: 0}
  }

  const merged = getScopedRelayUrls(relays)

  if (merged.length === 0) {
    return {deletedEvents: 0, relatedDeleted: 0}
  }

  reportDeleteProgress(onProgress, {
    label: "Loading related events...",
    completed: 0,
    total: 1,
    current: root.kind === GIT_PULL_REQUEST ? "pull request" : "patch",
  })

  throwIfAborted(signal)

  const filters: Filter[] = [
    {
      kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
      "#e": [root.id],
    },
    {
      kinds: [1985],
      "#e": [root.id],
    },
    {
      kinds: [COMMENT],
      "#E": [root.id],
    },
    {
      kinds: [COMMENT],
      "#e": [root.id],
    },
  ]

  if (root.kind === GIT_PATCH) {
    filters.push({
      kinds: [GIT_PATCH],
      "#e": [root.id],
    })
    filters.push({
      kinds: [GIT_PATCH],
      "#E": [root.id],
    })
  }

  if (root.kind === GIT_PULL_REQUEST) {
    filters.push({
      kinds: [GIT_PULL_REQUEST_UPDATE],
      "#E": [root.id],
    })
    filters.push({
      kinds: [GIT_PULL_REQUEST_UPDATE],
      "#e": [root.id],
    })
  }

  try {
    await awaitWithAbort(load({relays: merged, filters, signal}), signal)
  } catch {
    throwIfAborted(signal)
    // pass
  }

  const relatedEvents = repository.query(filters, {shouldSort: false}) as TrustedEvent[]
  const eventsToDelete = new Map<string, TrustedEvent>()
  eventsToDelete.set(root.id, root)

  for (const event of relatedEvents) {
    if (!event?.id || event.id === root.id) continue
    if (event.pubkey !== root.pubkey) continue
    eventsToDelete.set(event.id, event)
  }

  const deletedEvents = await deleteEventsSequentially({
    root,
    events: Array.from(eventsToDelete.values()),
    relays: merged,
    protect,
    signal,
    onProgress,
  })

  return {
    deletedEvents,
    relatedDeleted: Math.max(0, deletedEvents - 1),
  }
}
