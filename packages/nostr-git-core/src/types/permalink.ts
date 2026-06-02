// Permalink (kind 1623) types for referencing immutable file ranges in a repo

export const GIT_PERMALINK = 1623 as const

// Raw nostr event for permalink publishing
export type PermalinkEvent = {
  kind: typeof GIT_PERMALINK
  content: string
  tags: string[][]
  pubkey: string
  created_at: number
  id: string
  sig: string
}

// Optional friendly shape if clients want to construct before serializing to tags
export type Permalink = {
  // repo identification
  repoAddress?: string // e.g. "30617:<repo-owner-pubkey>:<repo-id>" (use Repo.address)
  repoUrl?: string // explicit URL (optional but recommended)

  // ref / commit
  ref?: { type: "heads" | "tags"; name: string; commit: string }
  commit: string

  // file + selection
  file: string // fully-qualified file path
  lines?: { start: number; end?: number }

  // display metadata
  language?: string
  description?: string

  // content to embed (excerpt)
  content?: string
}