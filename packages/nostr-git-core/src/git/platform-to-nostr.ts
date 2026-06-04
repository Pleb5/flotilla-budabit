/**
 * Platform to Nostr Event Conversion
 *
 * Converts Git platform data (issues, comments, PRs) to Nostr events
 * with proper tagging, dating, and threading support.
 */

import type {Issue, Comment, PullRequest, RepoMetadata} from "../api/api.js"
import type {NostrEvent} from "nostr-tools"
import {finalizeEvent} from "nostr-tools"
import {hexToBytes} from "nostr-tools/utils"
import {
  createIssueEvent,
  createPullRequestEvent,
  createStatusEvent,
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  createCommentEvent,
  GIT_STATUS_OPEN,
  GIT_STATUS_CLOSED,
} from "../events/index.js"

/**
 * User profile mapping: platform:username -> {privkey, pubkey}
 */
export type UserProfileMap = Map<string, {privkey: string; pubkey: string}>

/**
 * Comment event mapping: platform comment ID -> Nostr event ID
 * Used for preserving comment threading
 */
export type CommentEventMap = Map<number, string>

/**
 * Convert repository metadata to Nostr RepoAnnouncementEvent
 *
 * @param repo - Repository metadata
 * @param relays - List of relay URLs for the repo
 * @param userPubkey - Public key (hex) of the importing user
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @returns Unsigned RepoAnnouncementEvent
 */
export function convertRepoToNostrEvent(
  repo: RepoMetadata,
  relays: string[],
  userPubkey: string,
  importTimestamp: number,
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const repoName = repo.fullName.split("/").pop() || repo.name
  const hashtags: string[] = []

  const event = createRepoAnnouncementEvent({
    repoId: repoName,
    name: repo.name,
    description: repo.description,
    web: [repo.htmlUrl],
    clone: [repo.cloneUrl],
    relays,
    maintainers: [userPubkey],
    hashtags,
    created_at: importTimestamp,
  })

  const tags: string[][] = [...event.tags, ["imported", ""]]

  return {
    ...event,
    tags,
  }
}

/**
 * Convert repository metadata to Nostr RepoStateEvent
 *
 * @param repo - Repository metadata
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @returns Unsigned RepoStateEvent
 */
export function convertRepoToStateEvent(
  repo: RepoMetadata,
  importTimestamp: number,
  refs?: Array<{type: "heads" | "tags"; name: string; commit: string}>,
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const repoName = repo.fullName.split("/").pop() || repo.name

  const event = createRepoStateEvent({
    repoId: repoName,
    head: repo.defaultBranch,
    refs,
    created_at: importTimestamp,
  })

  const tags: string[][] = [...event.tags, ["imported", ""]]

  return {
    ...event,
    tags,
  }
}

/**
 * Convert platform issues to Nostr IssueEvent array
 *
 * Creates issue events with proper tagging, dating, and signing.
 * Events are created with fake timestamps starting from startTimestamp
 * to ensure chronological ordering.
 *
 * @param issues - Array of platform issues
 * @param repoAddr - Repository address (e.g., "30617:pubkey:repo")
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @returns Array of unsigned IssueEvent objects ready to be signed
 */
export function convertIssuesToNostrEvents(
  issues: Issue[],
  repoAddr: string,
  platform: string,
  userProfiles: UserProfileMap,
  importTimestamp: number,
  startTimestamp: number,
): Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> {
  const result: Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> = []
  let currentTimestamp = startTimestamp

  for (const issue of issues) {
    const profileKey = `${platform}:${issue.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(
        `No profile found for user ${issue.author.login}, skipping issue ${issue.number}`,
      )
      continue
    }

    const labels = issue.labels.map(label => label.name)
    const originalDate = Math.floor(Date.parse(issue.createdAt) / 1000)

    const baseEvent = createIssueEvent({
      content: issue.body || "",
      repoAddr,
      subject: issue.title,
      labels,
      created_at: currentTimestamp,
      tags: [],
    })

    const tags: string[][] = [
      ...baseEvent.tags,
      ["imported", ""],
      ["original_date", originalDate.toString()],
    ]

    const issueEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags,
    }

    currentTimestamp += 1

    result.push({
      event: issueEvent,
      privkey: profile.privkey,
    })
  }

  return result
}

// todo: review this function and make sure it's correct
/**
 * Convert issue status to Nostr StatusEvent
 *
 * Creates status events for the current status only (no history).
 *
 * @param issueEventId - Nostr event ID of the issue event
 * @param issueState - Current issue state ('open' | 'closed')
 * @param originalDate - Original date of the issue (ISO 8601); stored in tag as Unix timestamp (seconds)
 * @param repoAddr - Repository address
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @returns Unsigned StatusEvent object ready to be signed
 */
export function convertIssueStatusToEvent(
  issueEventId: string,
  issueState: "open" | "closed",
  originalDate: string,
  repoAddr: string,
  startTimestamp: number,
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const statusKind = issueState === "closed" ? GIT_STATUS_CLOSED : GIT_STATUS_OPEN
  const statusContent = issueState === "closed" ? "closed" : "open"

  const parsed = Date.parse(originalDate)
  const originalDateUnixSeconds = Number.isNaN(parsed) ? startTimestamp : Math.floor(parsed / 1000)

  const baseEvent = createStatusEvent({
    kind: statusKind,
    content: statusContent,
    rootId: issueEventId,
    repoAddr,
    created_at: startTimestamp,
    tags: [],
  })

  const tags: string[][] = [
    ...baseEvent.tags,
    ["imported", ""],
    ["original_date", originalDateUnixSeconds.toString()],
  ]

  const statusEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
    ...baseEvent,
    tags,
  }

  return statusEvent
}

/**
 * Result of converting comments to Nostr events
 */
export interface ConvertedComment {
  /**
   * Unsigned comment event
   */
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">

  /**
   * Private key for signing the event
   */
  privkey: string

  /**
   * Original platform comment ID (for mapping after signing)
   */
  platformCommentId: number
}

/**
 * Convert platform comments to Nostr CommentEvent array
 *
 * Converts comments with full threading support (preserves parent references).
 * Comments are sorted chronologically and assigned fake timestamps to ensure
 * proper ordering and avoid duplicate timestamps.
 *
 * @param comments - Array of platform comments (will be sorted chronologically)
 * @param rootEventId - Nostr event ID of the root issue/PR event
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param commentEventMap - Map to track platform comment ID -> Nostr event ID (updated after signing)
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @returns Array of converted comments with platform IDs for mapping after signing
 */
export function convertCommentsToNostrEvents(
  comments: Comment[],
  rootEventId: string,
  platform: string,
  userProfiles: UserProfileMap,
  commentEventMap: CommentEventMap,
  importTimestamp: number,
  startTimestamp: number,
): ConvertedComment[] {
  const result: ConvertedComment[] = []
  let currentTimestamp = startTimestamp

  const sortedComments = [...comments].sort((a, b) => {
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  })

  for (const comment of sortedComments) {
    const profileKey = `${platform}:${comment.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(
        `No profile found for user ${comment.author.login}, skipping comment ${comment.id}`,
      )
      continue
    }

    const originalDate = Math.floor(Date.parse(comment.createdAt) / 1000)

    let parentRef:
      | {type: "e"; value: string; kind: string; pubkey?: string; relay?: string}
      | undefined

    if (comment.inReplyToId) {
      const parentEventId = commentEventMap.get(comment.inReplyToId)
      if (parentEventId) {
        parentRef = {
          type: "e",
          value: parentEventId,
          kind: "1111",
        }
      }
    }

    const baseEvent = createCommentEvent({
      content: comment.body || "",
      root: {
        type: "E",
        value: rootEventId,
        kind: "1621",
      },
      parent: parentRef,
      authorPubkey: profile.pubkey,
      created_at: currentTimestamp,
      extraTags: [],
    })

    const tags: string[][] = [
      ...baseEvent.tags,
      ["imported", ""],
      ["original_date", originalDate.toString()],
    ]

    const commentEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags,
    }

    currentTimestamp += 1

    result.push({
      event: commentEvent,
      privkey: profile.privkey,
      platformCommentId: comment.id,
    })
  }

  return result
}

/**
 * Convert platform pull requests to Nostr PullRequestEvent array
 *
 * Uses PR title, body, head branch, base branch, and optionally commit SHAs
 * when provided via prCommits (e.g. from listPullRequestCommits).
 *
 * @param prs - Array of platform pull requests
 * @param repoAddr - Repository address (e.g., "30617:pubkey:repo")
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @param prCommits - Optional map of PR number -> commit SHAs (from listPullRequestCommits)
 * @returns Array of unsigned PullRequestEvent objects ready to be signed
 */
export function convertPullRequestsToNostrEvents(
  prs: PullRequest[],
  repoAddr: string,
  platform: string,
  userProfiles: UserProfileMap,
  importTimestamp: number,
  startTimestamp: number,
  prCommits?: Map<number, string[]>,
): Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> {
  const result: Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> = []
  let currentTimestamp = startTimestamp

  for (const pr of prs) {
    const profileKey = `${platform}:${pr.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(`No profile found for user ${pr.author.login}, skipping PR ${pr.number}`)
      continue
    }

    const labels: string[] = []
    const originalDate = Math.floor(Date.parse(pr.createdAt) / 1000)
    const commits = prCommits?.get(pr.number)
    const tipCommitOid = commits && commits.length > 0 ? commits[commits.length - 1] : undefined

    const baseEvent = createPullRequestEvent({
      content: pr.body || "",
      repoAddr,
      subject: pr.title,
      labels,
      branchName: pr.base.ref,
      mergeBase: pr.base.ref,
      tipCommitOid: tipCommitOid || pr.head.sha,
      created_at: currentTimestamp,
      tags: [],
    })

    const tags: string[][] = [
      ...baseEvent.tags,
      ["imported", ""],
      ["original_date", originalDate.toString()],
    ]

    const prEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags,
    }

    currentTimestamp += 1

    result.push({
      event: prEvent,
      privkey: profile.privkey,
    })
  }

  return result
}

/**
 * Sign an unsigned event with a private key
 *
 * @param unsignedEvent - Event template without id, sig, pubkey
 * @param privkey - Private key (hex string) for signing
 * @returns Signed Nostr event
 */
export function signEvent(
  unsignedEvent: Omit<NostrEvent, "id" | "sig" | "pubkey">,
  privkey: string,
): NostrEvent {
  if (!/^[0-9a-fA-F]{64}$/.test(privkey)) {
    throw new Error(`Invalid private key format: expected 64 hex characters, got ${privkey.length}`)
  }
  const privkeyBytes = hexToBytes(privkey)

  return finalizeEvent(unsignedEvent, privkeyBytes)
}
