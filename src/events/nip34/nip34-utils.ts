import {
  type Nip34Event,
  type RepoAnnouncementEvent,
  type RepoStateEvent,
  type IssueEvent,
  type CoverLetterEvent,
  type StatusEvent,
  type PullRequestEvent,
  type PullRequestUpdateEvent,
  type UserGraspListEvent,
  type NostrTag,
  type RepoAnnouncementTag,
  type RepoStateTag,
  type IssueTag,
  type CoverLetterTag,
  type StatusTag,
  type PullRequestTag,
  type PullRequestUpdateTag,
  type UserGraspListTag,
  type StackTag,
  type MergeMetadataTag,
  type ConflictMetadataTag,
  type StackEvent,
  type MergeMetadataEvent,
  type ConflictMetadataEvent,
  GIT_REPO_ANNOUNCEMENT,
  GIT_COVER_LETTER,
  GIT_STACK,
  GIT_MERGE_METADATA,
  GIT_CONFLICT_METADATA,
} from "./nip34.js"
import type {CommentEvent} from "../nip22/nip22.js"
import {sanitizeRelays} from "../../utils/sanitize-relays.js"
import {toHexPubkey} from "../../utils/nostr-pubkey.js"

// Stronger typing for tag helpers: map known tag names to their tuple types
// (imports of specific tag types are declared at the top of file)

type KnownTags =
  | RepoAnnouncementTag
  | RepoStateTag
  | IssueTag
  | CoverLetterTag
  | StatusTag
  | PullRequestTag
  | PullRequestUpdateTag
  | UserGraspListTag
  | StackTag
  | MergeMetadataTag
  | ConflictMetadataTag

// For a given tag name T, resolve to the precise tuple type if known; otherwise fallback to a generic [T, ...string[]]
export type TagFor<T extends string> =
  Extract<KnownTags, [T, ...string[]]> extends never
    ? [T, ...string[]]
    : Extract<KnownTags, [T, ...string[]]>

// For value extraction: the first value after tag name, or undefined if not present
type FirstValueOf<T extends string> =
  TagFor<T> extends [any, infer V extends string, ...any[]] ? V : undefined

export const REPO_COMMUNITY_TAG = "h"

export interface RepoCommunityBinding {
  pubkey: string
  relay?: string
}

const normalizeRepoCommunityPubkey = (value?: string): string | undefined => {
  if (!value) return undefined
  try {
    return toHexPubkey(value)
  } catch {
    return undefined
  }
}

const isTagArray = (
  eventOrTags: {tags?: readonly string[][]} | readonly string[][],
): eventOrTags is readonly string[][] => Array.isArray(eventOrTags)

export function parseRepoCommunityBinding(
  eventOrTags: {tags?: readonly string[][]} | readonly string[][],
): RepoCommunityBinding | undefined {
  const tags = isTagArray(eventOrTags) ? eventOrTags : (eventOrTags.tags ?? [])

  for (const tag of tags) {
    if (tag[0] !== REPO_COMMUNITY_TAG) continue
    const pubkey = normalizeRepoCommunityPubkey(tag[1])
    if (!pubkey) continue
    const relay = tag[2] ? sanitizeRelays([tag[2]])[0] : undefined
    return relay ? {pubkey, relay} : {pubkey}
  }

  return undefined
}

export function withRepoCommunityBinding<T extends {tags?: string[][]}>(
  event: T,
  community?: RepoCommunityBinding,
): T {
  const tags = (event.tags || []).filter(tag => tag[0] !== REPO_COMMUNITY_TAG)
  const pubkey = normalizeRepoCommunityPubkey(community?.pubkey)

  if (pubkey) {
    const relay = community?.relay ? sanitizeRelays([community.relay])[0] : undefined
    tags.push(relay ? [REPO_COMMUNITY_TAG, pubkey, relay] : [REPO_COMMUNITY_TAG, pubkey])
  }

  return {...event, tags}
}

/**
 * Type guard for RepoAnnouncementEvent (kind: 30617)
 */
export function isRepoAnnouncementEvent(event: Nip34Event): event is RepoAnnouncementEvent {
  return event.kind === 30617
}

// -------------------
// Stacking/Metadata Builders
// -------------------

export function createStackEvent(opts: {
  repoAddr: string
  stackId: string
  members?: string[]
  order?: string[]
  content?: string
  created_at?: number
}): StackEvent {
  const tags: any[] = [
    ["a", opts.repoAddr],
    ["stack", opts.stackId],
  ]
  if (opts.members) opts.members.forEach(m => tags.push(["member", m]))
  if (opts.order && opts.order.length) tags.push(["order", ...opts.order])
  return {
    kind: GIT_STACK,
    content: opts.content ?? "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as StackEvent
}

export function createMergeMetadataEvent(opts: {
  repoAddr: string
  rootId: string
  baseBranch?: string
  targetBranch?: string
  result?: "clean" | "ff" | "conflict"
  mergeCommit?: string
  content?: string // JSON
  created_at?: number
}): MergeMetadataEvent {
  const tags: any[] = [
    ["a", opts.repoAddr],
    ["e", opts.rootId, "", "root"],
  ]
  if (opts.baseBranch) tags.push(["base-branch", opts.baseBranch])
  if (opts.targetBranch) tags.push(["target-branch", opts.targetBranch])
  if (opts.result) tags.push(["result", opts.result])
  if (opts.mergeCommit) tags.push(["merge-commit", opts.mergeCommit])
  return {
    kind: GIT_MERGE_METADATA,
    content: opts.content ?? "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as MergeMetadataEvent
}

export function createConflictMetadataEvent(opts: {
  repoAddr: string
  rootId: string
  files?: string[]
  content?: string // JSON with markers
  created_at?: number
}): ConflictMetadataEvent {
  const tags: any[] = [
    ["a", opts.repoAddr],
    ["e", opts.rootId, "", "root"],
  ]
  if (opts.files) opts.files.forEach(f => tags.push(["file", f]))
  return {
    kind: GIT_CONFLICT_METADATA,
    content: opts.content ?? "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as ConflictMetadataEvent
}

/**
 * Type guard for RepoStateEvent (kind: 30618)
 */
export function isRepoStateEvent(event: Nip34Event): event is RepoStateEvent {
  return event.kind === 30618
}

/**
 * Type guard for IssueEvent (kind: 1621)
 */
export function isIssueEvent(event: Nip34Event): event is IssueEvent {
  return event.kind === 1621
}

/**
 * Type guard for CoverLetterEvent (kind: 1624)
 */
export function isCoverLetterEvent(event: Nip34Event): event is CoverLetterEvent {
  return event.kind === 1624
}

/**
 * Type guard for StatusEvent (kinds: 1630, 1631, 1632, 1633)
 */
export function isStatusEvent(event: Nip34Event): event is StatusEvent {
  return event.kind === 1630 || event.kind === 1631 || event.kind === 1632 || event.kind === 1633
}

/**
 * Type guard for PullRequestEvent (kind: 1618)
 */
export function isPullRequestEvent(event: Nip34Event): event is PullRequestEvent {
  return event.kind === 1618
}

/**
 * Type guard for PullRequestUpdateEvent (kind: 1619)
 */
export function isPullRequestUpdateEvent(event: Nip34Event): event is PullRequestUpdateEvent {
  return event.kind === 1619
}

/**
 * Type guard for UserGraspListEvent (kind: 10317)
 */
export function isUserGraspListEvent(event: Nip34Event): event is UserGraspListEvent {
  return event.kind === 10317
}

/**
 * Get a human-readable label for a NIP-34 or NIP-22 event kind
 */
export function getNostrKindLabel(kind: number): string {
  switch (kind) {
    case 30617:
      return "Repository Announcement"
    case 30618:
      return "Repository State"
    case 1621:
      return "Issue"
    case 1624:
      return "Cover Letter"
    case 1618:
      return "Pull Request"
    case 1619:
      return "Pull Request Update"
    case 1630:
      return "Status: Open"
    case 1631:
      return "Status: Merged/Resolved"
    case 1632:
      return "Status: Closed"
    case 1633:
      return "Status: Draft"
    case 1111:
      return "Comment"
    case 10317:
      return "User Grasp List"
    case 30410:
      return "Stack"
    case 30411:
      return "Merge Metadata"
    case 30412:
      return "Conflict Metadata"
    default:
      return "Unknown"
  }
}

/**
 * Type guard for Comment Event (kind: 1111)
 */
export function isCommentEvent(event: {kind: number}): event is CommentEvent {
  return event.kind === 1111
}

const getRepoAddressTags = (repoAddr?: string, repoAddrs: string[] = []) => {
  const addresses = Array.from(new Set([repoAddr, ...repoAddrs].map(value => String(value || "").trim()).filter(Boolean)))
  return addresses.map(address => ["a", address] as ["a", string])
}

/** Type guard for StackEvent (kind: 30410) */
export function isStackEvent(event: Nip34Event): event is StackEvent {
  return event.kind === 30410
}

/** Type guard for MergeMetadataEvent (kind: 30411) */
export function isMergeMetadataEvent(event: Nip34Event): event is MergeMetadataEvent {
  return event.kind === 30411
}

/** Type guard for ConflictMetadataEvent (kind: 30412) */
export function isConflictMetadataEvent(event: Nip34Event): event is ConflictMetadataEvent {
  return event.kind === 30412
}

/**
 * Get the first tag tuple of a given type from an event's `tags`.
 * Preserves precise tuple typing for known tag names.
 */
export function getTag<T extends string>(
  event: {tags: NostrTag[]},
  tagType: T,
): TagFor<T> | undefined {
  return event.tags.find((tag): tag is TagFor<T> => tag[0] === tagType)
}

/**
 * Get all tag tuples of a given type from an event's `tags`.
 * Returns an array preserving precise tuple typing for known tag names.
 */
export function getTags<T extends string>(event: {tags: NostrTag[]}, tagType: T): TagFor<T>[] {
  return event.tags.filter((tag): tag is TagFor<T> => tag[0] === tagType)
}

/**
 * Get the first value (second tuple element) for the first occurrence of a tag type.
 * Returns `undefined` if the tag is not present.
 */
export function getTagValue<T extends string>(
  event: {tags: NostrTag[]},
  tagType: T,
): FirstValueOf<T> | undefined {
  const tag = getTag(event, tagType)
  return tag?.[1] as FirstValueOf<T> | undefined
}

// -------------------
// Event Creation Helpers
// -------------------

// Helper: extract repository name from canonical repoId formats
// Accepts formats like:
// - "owner/name"
// - "owner:name"
// - "name"
// Returns just the repository name segment.
function extractRepoName(repoId: string): string {
  // Prefer last segment after '/' first, then after ':'
  if (repoId.includes("/")) {
    const parts = repoId.split("/")
    return parts[parts.length - 1] || repoId
  }
  if (repoId.includes(":")) {
    const parts = repoId.split(":")
    return parts[parts.length - 1] || repoId
  }
  return repoId
}

/**
 * Create a repo announcement event (kind 30617)
 */
export function createRepoAnnouncementEvent(opts: {
  repoId: string
  community?: RepoCommunityBinding
  name?: string
  description?: string
  web?: string[]
  clone?: string[]
  relays?: string[]
  maintainers?: string[]
  hashtags?: string[]
  earliestUniqueCommit?: string
  created_at?: number
}): RepoAnnouncementEvent {
  const tags: RepoAnnouncementTag[] = [
    // NIP-34: use only the repository name for the identifier (d tag)
    ["d", extractRepoName(opts.repoId)],
  ]
  if (opts.name) tags.push(["name", opts.name])
  if (opts.community) {
    const pubkey = normalizeRepoCommunityPubkey(opts.community.pubkey)
    if (pubkey) {
      const relay = opts.community.relay ? sanitizeRelays([opts.community.relay])[0] : undefined
      tags.push(relay ? [REPO_COMMUNITY_TAG, pubkey, relay] : [REPO_COMMUNITY_TAG, pubkey])
    }
  }
  if (opts.description) tags.push(["description", opts.description])
  // NIP-34: web, clone, relays, maintainers tags can include multiple values in a single tag
  if (opts.web && opts.web.length > 0) tags.push(["web", ...opts.web])
  if (opts.clone && opts.clone.length > 0) tags.push(["clone", ...opts.clone])
  if (opts.relays && opts.relays.length > 0) tags.push(["relays", ...sanitizeRelays(opts.relays)])
  if (opts.maintainers && opts.maintainers.length > 0)
    tags.push(["maintainers", ...opts.maintainers])
  if (opts.hashtags) opts.hashtags.forEach(t => tags.push(["t", t]))
  if (opts.earliestUniqueCommit) tags.push(["r", opts.earliestUniqueCommit, "euc"])
  return {
    kind: 30617,
    content: "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as RepoAnnouncementEvent
}

/**
 * Create a repo state event (kind 30618) - NIP-34 compliant
 * Repository state events only contain refs and HEAD according to NIP-34
 */
export function createRepoStateEvent(opts: {
  repoId: string
  refs?: Array<{type: "heads" | "tags"; name: string; commit: string; ancestry?: string[]}>
  head?: string
  created_at?: number
}): RepoStateEvent {
  const tags: RepoStateTag[] = [["d", extractRepoName(opts.repoId)]]

  // Add refs (branches and tags) according to NIP-34
  if (opts.refs) {
    for (const ref of opts.refs) {
      if (ref.ancestry && ref.ancestry.length > 0) {
        // Extended format with ancestry
        tags.push([`refs/${ref.type}/${ref.name}`, ref.commit, ...ref.ancestry])
      } else {
        // Basic format
        tags.push([`refs/${ref.type}/${ref.name}`, ref.commit])
      }
    }
  }

  // Add HEAD reference according to NIP-34
  if (opts.head) {
    tags.push(["HEAD", `ref: refs/heads/${opts.head}`])
  }

  return {
    kind: 30618,
    tags,
    content: "",
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as RepoStateEvent
}

/**
 * Create a repository state event for a cloned repository
 * This is a simple wrapper around createRepoStateEvent for backward compatibility
 */
export function createClonedRepoStateEvent(
  repoId: string,
  cloneUrl: string,
  branches: string[] = [],
  tags: string[] = [],
  maintainers: string[] = [],
): RepoStateEvent {
  // Convert branches and tags to refs format
  const refs = [
    ...branches.map(branch => ({
      type: "heads" as const,
      name: branch,
      commit: "", // Will be filled by the actual implementation
    })),
    ...tags.map(tag => ({
      type: "tags" as const,
      name: tag,
      commit: "", // Will be filled by the actual implementation
    })),
  ]

  return createRepoStateEvent({
    repoId,
    refs,
    head: branches.length > 0 ? branches[0] : undefined,
  })
}

/**
 * Create an issue event (kind 1621)
 */
export function createIssueEvent(opts: {
  content: string
  repoAddr: string
  repoAddrs?: string[]
  recipients?: string[]
  subject?: string
  labels?: string[]
  tags?: IssueTag[]
  created_at?: number
}): IssueEvent {
  const tags: IssueTag[] = getRepoAddressTags(opts.repoAddr, opts.repoAddrs) as IssueTag[]
  if (opts.recipients) opts.recipients.forEach(p => tags.push(["p", p]))
  if (opts.subject) tags.push(["subject", opts.subject])
  if (opts.labels) opts.labels.forEach(l => tags.push(["t", l]))
  if (opts.tags) tags.push(...opts.tags)
  return {
    kind: 1621,
    content: opts.content,
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as IssueEvent
}

/**
 * Create a cover letter / issue body update event (kind 1624)
 */
export function createCoverLetterEvent(opts: {
  content: string
  rootId: string
  repoAddr?: string
  references?: Array<{eventId: string; relay?: string; pubkey?: string}>
  recipients?: string[]
  tags?: CoverLetterTag[]
  created_at?: number
}): CoverLetterEvent {
  const tags: CoverLetterTag[] = [["e", opts.rootId]]
  if (opts.repoAddr) tags.push(["a", opts.repoAddr])
  if (opts.references) {
    for (const ref of opts.references) {
      if (!ref?.eventId) continue
      if (ref.relay && ref.pubkey) tags.push(["q", ref.eventId, ref.relay, ref.pubkey])
      else if (ref.relay) tags.push(["q", ref.eventId, ref.relay])
      else tags.push(["q", ref.eventId])
    }
  }
  if (opts.recipients) opts.recipients.forEach(p => tags.push(["p", p]))
  if (opts.tags) tags.push(...opts.tags)
  return {
    kind: GIT_COVER_LETTER,
    content: opts.content,
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as CoverLetterEvent
}

/**
 * Create a pull request event (kind 1618)
 */
export function createPullRequestEvent(opts: {
  content: string
  repoAddr: string
  repoAddrs?: string[]
  recipients?: string[]
  subject?: string
  labels?: string[]
  tipCommitOid: string
  clone?: string[]
  /** branchName = target branch (merge-into) per NIP-34. Source is identified by tip commit (c tag). */
  branchName?: string
  mergeBase?: string
  tags?: PullRequestTag[]
  created_at?: number
}): PullRequestEvent {
  const tags: PullRequestTag[] = getRepoAddressTags(opts.repoAddr, opts.repoAddrs) as PullRequestTag[]
  if (opts.recipients) opts.recipients.forEach(p => tags.push(["p", p]))
  if (opts.subject) tags.push(["subject", opts.subject])
  if (opts.labels) opts.labels.forEach(l => tags.push(["t", l]))
  tags.push(["c", opts.tipCommitOid])
  if (opts.clone && opts.clone.length > 0) tags.push(["clone", ...opts.clone])
  if (opts.branchName) tags.push(["branch-name", opts.branchName])
  if (opts.mergeBase) tags.push(["merge-base", opts.mergeBase])
  if (opts.tags) tags.push(...opts.tags)
  return {
    kind: 1618,
    content: opts.content,
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as PullRequestEvent
}

/**
 * Create a pull request update event (kind 1619).
 * NIP-22: E and P tags reference the PR being updated.
 */
export function createPullRequestUpdateEvent(opts: {
  repoAddr: string
  repoAddrs?: string[]
  pullRequestEventId: string
  pullRequestAuthorPubkey: string
  recipients?: string[]
  tipCommitOid: string
  clone?: string[]
  mergeBase?: string
  tags?: PullRequestUpdateTag[]
  created_at?: number
}): PullRequestUpdateEvent {
  const tags: PullRequestUpdateTag[] = getRepoAddressTags(opts.repoAddr, opts.repoAddrs) as PullRequestUpdateTag[]
  tags.push(["E", opts.pullRequestEventId])
  tags.push(["P", opts.pullRequestAuthorPubkey])
  if (opts.recipients) opts.recipients.forEach(p => tags.push(["p", p]))
  tags.push(["c", opts.tipCommitOid])
  if (opts.clone && opts.clone.length > 0) tags.push(["clone", ...opts.clone])
  if (opts.mergeBase) tags.push(["merge-base", opts.mergeBase])
  if (opts.tags) tags.push(...opts.tags)
  return {
    kind: 1619,
    content: "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as PullRequestUpdateEvent
}

/**
 * Create a user grasp list event (kind 10317)
 */
export function createUserGraspListEvent(opts: {
  services: string[]
  created_at?: number
}): UserGraspListEvent {
  const tags: UserGraspListTag[] = opts.services.map(s => ["g", s])
  return {
    kind: 10317,
    content: "",
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as UserGraspListEvent
}

/**
 * Create a status event (kinds 1630-1633)
 */
export function createStatusEvent(opts: {
  kind: 1630 | 1631 | 1632 | 1633
  content: string
  rootId: string
  replyId?: string
  recipients?: string[]
  repoAddr?: string
  repoAddrs?: string[]
  relays?: string[]
  appliedCommits?: string[]
  mergedCommit?: string
  tags?: StatusTag[]
  created_at?: number
}): StatusEvent {
  const tags: StatusTag[] = [["e", opts.rootId, "", "root"]]
  if (opts.replyId) tags.push(["e", opts.replyId, "", "reply"])
  if (opts.recipients) opts.recipients.forEach(p => tags.push(["p", p]))
  tags.push(...(getRepoAddressTags(opts.repoAddr, opts.repoAddrs) as StatusTag[]))
  if (opts.relays && opts.relays.length) tags.push(["r", opts.relays[0]])
  if (opts.mergedCommit) tags.push(["merge-commit", opts.mergedCommit])
  if (opts.appliedCommits && opts.appliedCommits.length > 0)
    tags.push(["applied-as-commits", ...opts.appliedCommits])
  if (opts.tags) tags.push(...opts.tags)
  return {
    kind: opts.kind,
    content: opts.content,
    tags,
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
  } as StatusEvent
}

// -------------------
// Tag Mutation Utilities (immutable)
// -------------------

/**
 * Add a tag (does not replace existing tags of the same type)
 */
export function addTag<E extends {tags: NostrTag[]}>(event: E, tag: NostrTag): E {
  return {...event, tags: [...event.tags, tag]}
}

/**
 * Set (add or replace) a tag by type (removes all existing tags of that type, then adds the new one)
 */
export function setTag<E extends {tags: NostrTag[]}>(event: E, tag: NostrTag): E {
  const tags = event.tags.filter(t => t[0] !== tag[0])
  return {...event, tags: [...tags, tag]}
}

/**
 * Remove all tags of a given type
 */
export function removeTag<E extends {tags: NostrTag[]}>(event: E, tagType: string): E {
  return {...event, tags: event.tags.filter(t => t[0] !== tagType)}
}

// -------------------
// Parsing Utilities for NIP-34 & NIP-22 Events
// -------------------

export interface Issue {
  id: string
  repoId: string
  subject: string
  content: string
  author: {pubkey: string}
  labels: string[]
  createdAt: string
  raw: IssueEvent
}

export function parseIssueEvent(event: IssueEvent): Issue {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1]
  const getAllTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1])
  return {
    id: event.id,
    repoId: getTag("a") || "",
    subject: getTag("subject") || "",
    content: event.content,
    author: {pubkey: event.pubkey},
    labels: getAllTags("t"),
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface CoverLetter {
  id: string
  rootId: string
  repoAddr?: string
  references: Array<{eventId: string; relay?: string; pubkey?: string}>
  recipients: string[]
  content: string
  author: {pubkey: string}
  createdAt: string
  raw: CoverLetterEvent
}

export function parseCoverLetterEvent(event: CoverLetterEvent): CoverLetter {
  const rootId = event.tags.find(t => t[0] === "e")?.[1] || ""
  const repoAddr = event.tags.find(t => t[0] === "a")?.[1]
  const references = event.tags
    .filter(t => t[0] === "q")
    .map(t => ({
      eventId: t[1],
      relay: t[2],
      pubkey: t[3],
    }))
    .filter(ref => Boolean(ref.eventId))
  const recipients = event.tags
    .filter(t => t[0] === "p")
    .map(t => t[1])
    .filter(Boolean)
  return {
    id: event.id,
    rootId,
    repoAddr,
    references,
    recipients,
    content: event.content,
    author: {pubkey: event.pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface PullRequest {
  id: string
  repoId: string
  subject: string
  content: string
  author: {pubkey: string}
  labels: string[]
  tipCommitOid: string
  tipCandidates: string[]
  tipError?: "missing-tip" | "ambiguous-tip"
  /** Target branch (merge-into) per NIP-34 */
  branchName?: string
  mergeBase?: string
  createdAt: string
  raw: PullRequestEvent
}

function parseTipFromCTags(tags: string[]): {
  tipCommitOid: string
  tipCandidates: string[]
  tipError?: "missing-tip" | "ambiguous-tip"
} {
  if (tags.length === 1) {
    return {tipCommitOid: tags[0], tipCandidates: tags}
  }
  if (tags.length === 0) {
    return {tipCommitOid: "", tipCandidates: [], tipError: "missing-tip"}
  }
  return {tipCommitOid: "", tipCandidates: tags, tipError: "ambiguous-tip"}
}

export function parsePullRequestEvent(event: PullRequestEvent): PullRequest {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1]
  const getAllTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1])
  const tip = parseTipFromCTags(getAllTags("c"))
  return {
    id: event.id,
    repoId: getTag("a") || "",
    subject: getTag("subject") || "",
    content: event.content,
    author: {pubkey: event.pubkey},
    labels: getAllTags("t"),
    tipCommitOid: tip.tipCommitOid,
    tipCandidates: tip.tipCandidates,
    tipError: tip.tipError,
    branchName: getTag("branch-name"),
    mergeBase: getTag("merge-base"),
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface PullRequestUpdate {
  id: string
  repoId: string
  pullRequestEventId: string
  pullRequestAuthorPubkey: string
  tipCommitOid: string
  tipCandidates: string[]
  tipError?: "missing-tip" | "ambiguous-tip"
  mergeBase?: string
  author: {pubkey: string}
  createdAt: string
  raw: PullRequestUpdateEvent
}

export function parsePullRequestUpdateEvent(event: PullRequestUpdateEvent): PullRequestUpdate {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1]
  const getAllTags = (name: string) => event.tags.filter(t => t[0] === name).map(t => t[1])
  const tip = parseTipFromCTags(getAllTags("c"))
  return {
    id: event.id,
    repoId: getTag("a") || "",
    pullRequestEventId: getTag("E") || "",
    pullRequestAuthorPubkey: getTag("P") || "",
    tipCommitOid: tip.tipCommitOid,
    tipCandidates: tip.tipCandidates,
    tipError: tip.tipError,
    mergeBase: getTag("merge-base"),
    author: {pubkey: event.pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface UserGraspList {
  id: string
  services: string[]
  author: {pubkey: string}
  createdAt: string
  raw: UserGraspListEvent
}

export function parseUserGraspListEvent(event: UserGraspListEvent): UserGraspList {
  const services = event.tags.filter(t => t[0] === "g").map(t => t[1])
  return {
    id: event.id,
    services,
    author: {pubkey: event.pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface RepoAnnouncement {
  id: string
  repoId: string
  address: string
  name?: string
  owner: string
  community?: RepoCommunityBinding
  description?: string
  web?: string[]
  clone?: string[]
  relays?: string[]
  maintainers?: string[]
  hashtags?: string[]
  earliestUniqueCommit?: string // NIP-34 r tag with 'euc' marker
  deleted?: boolean
  createdAt: string
  raw: RepoAnnouncementEvent
}

export function isDeletedRepoAnnouncement(event: RepoAnnouncementEvent): boolean {
  return (event.tags || []).some(t => t[0] === "deleted")
}

export function parseRepoAnnouncementEvent(event: RepoAnnouncementEvent): RepoAnnouncement {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1]
  const getAllTags = (name: string) =>
    event.tags
      .filter(t => t[0] === name)
      .map(t => t[1])
      .filter((value): value is string => value !== undefined)
  const getMultiTag = (name: string) =>
    event.tags.filter(t => t[0] === name).flatMap(t => t.slice(1))
  const relaysTag = () => {
    const raw = getMultiTag("relays")
    return raw.length > 0 ? sanitizeRelays(raw) : []
  }
  const deleted = isDeletedRepoAnnouncement(event)
  // Extract earliest unique commit from r tag with 'euc' marker
  const eucTag = event.tags.find(t => t[0] === "r" && t[2] === "euc")
  const earliestUniqueCommit = eucTag?.[1]

  return {
    id: event.id,
    repoId: getTag("d") || "",
    address: `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${getTag("d")}`,
    name: getTag("name"),
    owner: event.pubkey,
    community: parseRepoCommunityBinding(event),
    description: getTag("description"),
    web: getMultiTag("web"),
    clone: getMultiTag("clone"),
    relays: relaysTag(),
    maintainers: getMultiTag("maintainers"),
    hashtags: getAllTags("t"),
    earliestUniqueCommit,
    deleted,
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface RepoState {
  id: string
  repoId: string
  refs: Array<{ref: string; commit: string; lineage?: string[]}>
  head?: string
  createdAt: string
  raw: RepoStateEvent
}

export function parseRepoStateEvent(event: RepoStateEvent): RepoState {
  const getTag = (name: string) => event.tags.find(t => t[0] === name)?.[1]
  const isRefTag = (
    tag: RepoStateTag,
  ): tag is Extract<
    RepoStateTag,
    [`refs/heads/${string}` | `refs/tags/${string}`, string, ...string[]]
  > => tag[0].startsWith("refs/") && tag[1] != null && typeof tag[1] === "string"
  const refs = event.tags.filter(isRefTag).map(tag => ({
    ref: tag[0],
    commit: tag[1]!,
    lineage:
      tag.length > 2 ? tag.slice(2).filter((s): s is string => typeof s === "string") : undefined,
  }))
  const head = getTag("HEAD")
  return {
    id: event.id,
    repoId: getTag("d") || "",
    refs,
    head,
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export interface Status {
  id: string
  status: "open" | "applied" | "closed" | "draft" | "resolved"
  relatedIds: string[]
  mergedCommit?: string
  appliedCommits: string[]
  author: {pubkey: string}
  createdAt: string
  raw: StatusEvent
}

export function parseStatusEvent(event: StatusEvent): Status {
  let status: Status["status"] = "open"
  if (event.kind === 1631) status = "applied"
  else if (event.kind === 1632) status = "closed"
  else if (event.kind === 1633) status = "draft"
  const relatedIds = event.tags.filter(t => t[0] === "e").map(t => t[1])
  const mergedCommit = event.tags.find(t => t[0] === "merge-commit")?.[1]
  const appliedCommits = event.tags
    .filter(t => t[0] === "applied-as-commits")
    .flatMap(t => t.slice(1))
    .filter((commit): commit is string => Boolean(commit))
  return {
    id: event.id,
    status,
    relatedIds,
    mergedCommit,
    appliedCommits,
    author: {pubkey: event.pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}
