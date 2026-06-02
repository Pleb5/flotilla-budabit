import type { CommentEvent, CommentTag } from "./nip22.js"

export interface Comment {
  id: string
  content: string
  author: {pubkey: string}
  tags: CommentTag[]
  createdAt: string
  raw: CommentEvent
}

/**
 * Parse a NIP-22 CommentEvent into a developer-friendly Comment object
 */
export function parseCommentEvent(event: CommentEvent): Comment {
  return {
    id: (event as any).id ?? "",
    content: event.content,
    author: {pubkey: (event as any).pubkey ?? ""},
    tags: event.tags,
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}