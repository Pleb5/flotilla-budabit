import {get, writable} from "svelte/store"
import {ago, MINUTE} from "@welshman/lib"
import {repository} from "@welshman/app"
import {
  COMMENT,
  DELETE,
  MESSAGE,
  uniqTags,
  type EventContent,
  type TrustedEvent,
} from "@welshman/util"

export const EDIT_WINDOW_MINUTES = 5

export const editedTargetIds = writable<Set<string>>(new Set())

const MESSAGE_CONTEXT_TAGS = new Set(["h", "E", "K", "q"])
const REPLY_CONTEXT_TAGS = new Set([
  "h",
  "A",
  "E",
  "I",
  "K",
  "P",
  "R",
  "a",
  "e",
  "i",
  "k",
  "p",
  "r",
  "q",
  "f",
  "c",
  "line",
  "l",
  "repo",
])

const sanitizeEditorTags = (tags: string[][] = []) => tags.filter(tag => tag[0] !== "-")

const preserveTags = (event: Pick<TrustedEvent, "tags">, tagNames: Set<string>) =>
  (event.tags || []).filter(tag => tagNames.has(tag[0]))

export const canEditRecentOwnEvent = ({
  event,
  pubkey,
  canPublish = true,
  kind,
}: {
  event?: Pick<TrustedEvent, "kind" | "pubkey" | "created_at">
  pubkey?: string | null
  canPublish?: boolean
  kind?: number
}) =>
  Boolean(
    event &&
    canPublish &&
    pubkey &&
    event.pubkey === pubkey &&
    (kind === undefined || event.kind === kind) &&
    event.created_at >= ago(EDIT_WINDOW_MINUTES, MINUTE),
  )

export const canEditReplyEvent = (
  event: TrustedEvent | undefined,
  pubkey?: string | null,
  canPublish = true,
) => canEditRecentOwnEvent({event, pubkey, canPublish, kind: COMMENT})

export const canEditMessageEvent = (
  event: TrustedEvent | undefined,
  pubkey?: string | null,
  canPublish = true,
) => canEditRecentOwnEvent({event, pubkey, canPublish, kind: MESSAGE})

export const suppressEventAfterEdit = (event: Pick<TrustedEvent, "id"> | string | undefined) => {
  const id = typeof event === "string" ? event : event?.id
  if (!id) return

  editedTargetIds.update(ids => {
    if (ids.has(id)) return ids
    const next = new Set(ids)
    next.add(id)
    return next
  })
}

export const isSuppressedAfterEdit = (
  event: Pick<TrustedEvent, "id"> | undefined,
  suppressedIds: Set<string> = get(editedTargetIds),
) => Boolean(event?.id && suppressedIds.has(event.id))

export const isDeletedInRepository = (event: TrustedEvent | undefined) =>
  Boolean(event && (repository as any).isDeleted?.(event))

export const isVisibleAfterDeletesAndEdits = (
  event: TrustedEvent,
  suppressedIds: Set<string> = get(editedTargetIds),
) => !isSuppressedAfterEdit(event, suppressedIds) && !isDeletedInRepository(event)

export const filterVisibleAfterDeletesAndEdits = <T extends TrustedEvent>(
  events: T[] | undefined | null,
  suppressedIds: Set<string> = get(editedTargetIds),
) => (events || []).filter(event => isVisibleAfterDeletesAndEdits(event, suppressedIds)) as T[]

export const deleteEventDeletesTarget = (deleteEvent: TrustedEvent, targetEvent: TrustedEvent) =>
  deleteEvent.kind === DELETE &&
  deleteEvent.pubkey === targetEvent.pubkey &&
  (deleteEvent.tags || []).some(tag => tag[0] === "e" && tag[1] === targetEvent.id)

export const deleteEventsDeleteTarget = (deleteEvents: TrustedEvent[], targetEvent: TrustedEvent) =>
  deleteEvents.some(deleteEvent => deleteEventDeletesTarget(deleteEvent, targetEvent))

export const makeEditedMessageTemplate = (
  event: TrustedEvent,
  {content, tags = []}: EventContent,
): EventContent & {created_at: number} => ({
  content,
  tags: uniqTags([...preserveTags(event, MESSAGE_CONTEXT_TAGS), ...sanitizeEditorTags(tags)]),
  created_at: event.created_at,
})

export const makeEditedReplyTemplate = (
  event: TrustedEvent,
  {content, tags = []}: EventContent,
): EventContent & {created_at: number} => ({
  content,
  tags: uniqTags([...preserveTags(event, REPLY_CONTEXT_TAGS), ...sanitizeEditorTags(tags)]),
  created_at: event.created_at,
})
