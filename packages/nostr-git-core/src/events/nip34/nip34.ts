// NIP-34: Git Collaboration Event Types for Nostr
// https://github.com/nostr-protocol/nips/blob/master/34.md
import type {Event as NostrEvent} from "nostr-tools"
import {nip19} from "nostr-tools"

/**
 * Generic Nostr tag: [tagName, ...values]
 */
export type NostrTag = [string, ...string[]]

// -------------------
// Kind Number Constants
// -------------------

// Repository events
export const GIT_REPO_ANNOUNCEMENT = 30617
export const GIT_REPO_STATE = 30618

// Stacking & merge metadata events
export const GIT_STACK = 30410
export const GIT_MERGE_METADATA = 30411
export const GIT_CONFLICT_METADATA = 30412

// Issue events
export const GIT_ISSUE = 1621
export const GIT_COVER_LETTER = 1624

// Pull Request events
export const GIT_PULL_REQUEST = 1618
export const GIT_PULL_REQUEST_UPDATE = 1619

// User grasp lists
export const GIT_USER_GRASP_LIST = 10317

// Status events
export const GIT_STATUS_OPEN = 1630
export const GIT_STATUS_APPLIED = 1631
export const GIT_STATUS_CLOSED = 1632
export const GIT_STATUS_DRAFT = 1633

// -------------------
// Repository Announcement (kind: 30617)
// -------------------
export type RepoAnnouncementTag =
  | ["d", string] // repo-id
  | ["h", string]
  | ["h", string, string]
  | ["name", string]
  | ["description", string]
  | ["web", ...string[]]
  | ["clone", ...string[]]
  | ["relays", ...string[]]
  | ["r", string, "euc"]
  | ["maintainers", ...string[]]
  | ["t", string]
  | ["deleted"]
  | ["deleted", string]

export interface RepoAnnouncementEvent extends NostrEvent {
  kind: typeof GIT_REPO_ANNOUNCEMENT
  tags: RepoAnnouncementTag[]
}

// -------------------
// Repository State Announcement (kind: 30618)
// -------------------
export type RepoStateTag =
  | ["d", string]
  | [`refs/heads/${string}` | `refs/tags/${string}`, string, ...string[]]
  | ["HEAD", `ref: refs/heads/${string}`]
  | ["deleted"]
  | ["deleted", string]

export interface RepoStateEvent extends NostrEvent {
  kind: typeof GIT_REPO_STATE
  tags: RepoStateTag[]
}

// -------------------
// Stack (kind: 30410)
// -------------------
export type StackTag =
  | ["a", string] // repo address
  | ["stack", string] // stack id/name
  | ["member", string] // event id or commit id
  | ["order", ...string[]] // optional explicit order of members

export interface StackEvent extends NostrEvent {
  kind: typeof GIT_STACK
  content: string // optional human description or JSON payload
  tags: StackTag[]
}

// -------------------
// Merge Analysis Metadata (kind: 30411)
// -------------------
export type MergeMetadataTag =
  | ["a", string] // repo address
  | ["e", string, "", "root"] // target PR/event id
  | ["base-branch", string]
  | ["target-branch", string]
  | ["result", "clean" | "ff" | "conflict"]
  | ["merge-commit", string]

export interface MergeMetadataEvent extends NostrEvent {
  kind: typeof GIT_MERGE_METADATA
  content: string // JSON summary of analysis
  tags: MergeMetadataTag[]
}

// -------------------
// Conflict Details Metadata (kind: 30412)
// -------------------
export type ConflictMetadataTag =
  | ["a", string] // repo address
  | ["e", string, "", "root"] // target PR/event id
  | ["file", string] // conflicted file path (repeatable)

export interface ConflictMetadataEvent extends NostrEvent {
  kind: typeof GIT_CONFLICT_METADATA
  content: string // JSON with per-file conflict markers/segments
  tags: ConflictMetadataTag[]
}

// -------------------
// Issue (kind: 1621)
// -------------------
export type IssueTag =
  | ["a", string]
  | ["p", string]
  | ["subject", string]
  | ["t", string]
  | ["e", string]

export interface IssueEvent extends NostrEvent {
  id: string
  kind: typeof GIT_ISSUE
  content: string // markdown text
  tags: IssueTag[]
}

// -------------------
// Cover Letter / Issue Edit Body (kind: 1624)
// -------------------
export type CoverLetterTag =
  | ["e", string]
  | ["a", string]
  | ["q", string]
  | ["q", string, string]
  | ["q", string, string, string]
  | ["p", string]

export interface CoverLetterEvent extends NostrEvent {
  kind: typeof GIT_COVER_LETTER
  content: string // markdown text
  tags: CoverLetterTag[]
}

// -------------------
// Pull Request (kind: 1618)
// -------------------
export type PullRequestTag =
  | ["a", string]
  | ["r", string]
  | ["p", string]
  | ["subject", string]
  | ["t", string]
  | ["c", string]
  | ["clone", ...string[]]
  | ["branch-name", string]
  | ["e", string]
  | ["merge-base", string]

export interface PullRequestEvent extends NostrEvent {
  kind: typeof GIT_PULL_REQUEST
  content: string
  tags: PullRequestTag[]
}

// -------------------
// Pull Request Update (kind: 1619)
// NIP-22: E = pull-request-event-id, P = pull-request-author
// -------------------
export type PullRequestUpdateTag =
  | ["a", string]
  | ["r", string]
  | ["E", string]
  | ["P", string]
  | ["p", string]
  | ["c", string]
  | ["clone", ...string[]]
  | ["merge-base", string]

export interface PullRequestUpdateEvent extends NostrEvent {
  kind: typeof GIT_PULL_REQUEST_UPDATE
  content: string
  tags: PullRequestUpdateTag[]
}

// -------------------
// User Grasp List (kind: 10317)
// -------------------
export type UserGraspListTag = ["g", string]

export interface UserGraspListEvent extends NostrEvent {
  kind: typeof GIT_USER_GRASP_LIST
  content: string
  tags: UserGraspListTag[]
}

// -------------------
// Status (kinds: 1630, 1631, 1632, 1633)
// -------------------
export type StatusTag =
  | ["e", string, "", "root"]
  | ["e", string, "", "reply"]
  | ["p", string]
  | ["a", string, ...string[]]
  | ["r", string]
  | ["e", string, "", "mention"]
  | ["merge-commit", string]
  | ["applied-as-commits", ...string[]]

export interface StatusEvent extends NostrEvent {
  kind:
    | typeof GIT_STATUS_OPEN
    | typeof GIT_STATUS_CLOSED
    | typeof GIT_STATUS_APPLIED
    | typeof GIT_STATUS_DRAFT
  content: string
  tags: StatusTag[]
}

// -------------------
// Union type for all NIP-34 events
// -------------------
export type Nip34Event =
  | RepoAnnouncementEvent
  | RepoStateEvent
  | IssueEvent
  | CoverLetterEvent
  | PullRequestEvent
  | PullRequestUpdateEvent
  | UserGraspListEvent
  | StatusEvent
  | StackEvent
  | MergeMetadataEvent
  | ConflictMetadataEvent

// -------------------
// Profile Type for Avatars and User Metadata
// -------------------

export type TrustedEvent = NostrEvent

export type Profile = {
  pubkey: string
  name?: string
  nip05?: string
  lud06?: string
  lud16?: string
  lnurl?: string
  about?: string
  banner?: string
  picture?: string
  website?: string
  display_name?: string
  event?: TrustedEvent
}
export type Nip34EventByKind<K extends Nip34Event["kind"]> = Extract<Nip34Event, {kind: K}>

// -------------------
// Additional helpers
// -------------------

// Repo address pointer using 30617 (NIP-34 repo announcement kind)
export type RepoAddressA = `30617:${string}:${string}`

// Extract r:euc (Encoded URL Component) tag value
export function parseEucTag(tags: string[][]): string | undefined {
  const r = tags.find(t => t[0] === "r" && t[2] === "euc")
  return r ? r[1] : undefined
}

// Build repo key: `${npub}/${name}` if name provided, otherwise `${npub}`
export function buildRepoKey(pubkey: string, name?: string): string {
  const cleanName = (name ?? "").trim()
  try {
    const npub = nip19.npubEncode(pubkey)
    return cleanName.length > 0 ? `${npub}/${cleanName}` : npub
  } catch (_e) {
    // Fallback to raw pubkey if encoding fails
    return cleanName.length > 0 ? `${pubkey}/${cleanName}` : pubkey
  }
}

export enum GitIssueStatus {
  OPEN = "Open",
  CLOSED = "Closed",
  RESOLVED = "Resolved",
  DRAFT = "Draft",
}
