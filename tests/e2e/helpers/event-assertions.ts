/**
 * Event Assertion Helpers for NIP-34 Events
 *
 * Provides Playwright-compatible assertion functions for validating Nostr events
 * according to NIP-34 (Git Collaboration) specification.
 *
 * @example
 * ```typescript
 * import { assertValidEvent, assertValidRepoAnnouncement, getTagValue } from './event-assertions'
 *
 * test('validate repo announcement', () => {
 *   assertValidEvent(event)
 *   assertValidRepoAnnouncement(event)
 *   const name = getTagValue(event, 'name')
 *   expect(name).toBe('my-repo')
 * })
 * ```
 */

import {expect} from "@playwright/test"

// ---------------------------------------------------------------------------
// NIP-34 Kind Constants
// ---------------------------------------------------------------------------

/** Repository Announcement (addressable, kind 30617) */
export const KIND_REPO_ANNOUNCEMENT = 30617

/** Repository State (addressable, kind 30618) */
export const KIND_REPO_STATE = 30618

/** Patch event (kind 1617) */
export const KIND_PATCH = 1617

/** Issue event (kind 1621) */
export const KIND_ISSUE = 1621

/** Pull Request event (kind 1618) */
export const KIND_PULL_REQUEST = 1618

/** Status: Open (kind 1630) */
export const KIND_STATUS_OPEN = 1630

/** Status: Applied/Merged (kind 1631) */
export const KIND_STATUS_APPLIED = 1631

/** Status: Closed (kind 1632) */
export const KIND_STATUS_CLOSED = 1632

/** Status: Draft (kind 1633) */
export const KIND_STATUS_DRAFT = 1633

/** Label event (NIP-32, kind 1985) */
export const KIND_LABEL = 1985

/** All valid status kinds */
export const STATUS_KINDS = [
  KIND_STATUS_OPEN,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_DRAFT,
] as const

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * Nostr event type compatible with nostr-tools Event interface.
 * Mirrors the structure used in nostr-git-core.
 */
export interface NostrEvent {
  id?: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig?: string
}

// ---------------------------------------------------------------------------
// Tag Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get the first value for a given tag name.
 *
 * @param event - The Nostr event to search
 * @param tagName - The tag name (first element of tag array)
 * @returns The tag value (second element) or undefined if not found
 *
 * @example
 * ```typescript
 * const name = getTagValue(event, 'name') // returns 'my-repo' for ['name', 'my-repo']
 * const dTag = getTagValue(event, 'd')
 * ```
 */
export function getTagValue(event: NostrEvent, tagName: string): string | undefined {
  const tag = event.tags.find(t => t[0] === tagName)
  return tag?.[1]
}

/**
 * Get all values for a given tag name (for tags that appear multiple times).
 *
 * @param event - The Nostr event to search
 * @param tagName - The tag name to find
 * @returns Array of tag values (second elements)
 *
 * @example
 * ```typescript
 * const maintainers = getTagValues(event, 'p') // returns ['pubkey1', 'pubkey2']
 * const topics = getTagValues(event, 't')
 * ```
 */
export function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter(t => t[0] === tagName).map(t => t[1]).filter(Boolean)
}

/**
 * Get the full tag array for a given tag name.
 *
 * @param event - The Nostr event to search
 * @param tagName - The tag name to find
 * @returns The full tag array or undefined
 *
 * @example
 * ```typescript
 * const eTag = getTag(event, 'e') // returns ['e', 'eventid', '', 'root']
 * ```
 */
export function getTag(event: NostrEvent, tagName: string): string[] | undefined {
  return event.tags.find(t => t[0] === tagName)
}

/**
 * Get all tag arrays for a given tag name.
 *
 * @param event - The Nostr event to search
 * @param tagName - The tag name to find
 * @returns Array of full tag arrays
 */
export function getTags(event: NostrEvent, tagName: string): string[][] {
  return event.tags.filter(t => t[0] === tagName)
}

/**
 * Check if event has a specific tag (optionally with a specific value).
 *
 * @param event - The Nostr event to check
 * @param tagName - The tag name to look for
 * @param value - Optional value the tag must have
 * @returns true if tag exists (and matches value if provided)
 */
export function hasTag(event: NostrEvent, tagName: string, value?: string): boolean {
  if (value === undefined) {
    return event.tags.some(t => t[0] === tagName)
  }
  return event.tags.some(t => t[0] === tagName && t[1] === value)
}

// ---------------------------------------------------------------------------
// Basic Event Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that an event has the correct basic Nostr event structure.
 * Validates required fields: pubkey, created_at, kind, tags, content.
 *
 * @param event - The event to validate
 * @throws AssertionError if event structure is invalid
 */
export function assertValidEvent(event: NostrEvent): void {
  expect(event, "Event should be defined").toBeDefined()
  expect(typeof event, "Event should be an object").toBe("object")

  // Required fields
  expect(event.pubkey, "Event must have pubkey").toBeDefined()
  expect(typeof event.pubkey, "pubkey must be a string").toBe("string")
  expect(event.pubkey.length, "pubkey must be 64 hex characters").toBe(64)

  expect(event.created_at, "Event must have created_at").toBeDefined()
  expect(typeof event.created_at, "created_at must be a number").toBe("number")
  expect(event.created_at, "created_at must be positive").toBeGreaterThan(0)

  expect(event.kind, "Event must have kind").toBeDefined()
  expect(typeof event.kind, "kind must be a number").toBe("number")
  expect(event.kind, "kind must be non-negative").toBeGreaterThanOrEqual(0)

  expect(event.tags, "Event must have tags array").toBeDefined()
  expect(Array.isArray(event.tags), "tags must be an array").toBe(true)

  expect(event.content, "Event must have content").toBeDefined()
  expect(typeof event.content, "content must be a string").toBe("string")

  // Validate each tag is an array of strings
  for (const tag of event.tags) {
    expect(Array.isArray(tag), "Each tag must be an array").toBe(true)
    expect(tag.length, "Tag must have at least one element").toBeGreaterThanOrEqual(1)
    for (const element of tag) {
      expect(typeof element, "Tag elements must be strings").toBe("string")
    }
  }

  // Optional fields validation
  if (event.id !== undefined) {
    expect(typeof event.id, "id must be a string").toBe("string")
    expect(event.id.length, "id must be 64 hex characters").toBe(64)
  }

  if (event.sig !== undefined) {
    expect(typeof event.sig, "sig must be a string").toBe("string")
    expect(event.sig.length, "sig must be 128 hex characters").toBe(128)
  }
}

/**
 * Assert that an event is of the expected kind.
 *
 * @param event - The event to check
 * @param expectedKind - The expected event kind number
 * @throws AssertionError if kind does not match
 */
export function assertEventKind(event: NostrEvent, expectedKind: number): void {
  expect(event.kind, `Event kind should be ${expectedKind}`).toBe(expectedKind)
}

/**
 * Assert that an event has a required tag.
 *
 * @param event - The event to check
 * @param tagName - The tag name that must exist
 * @param value - Optional: specific value the tag must have
 * @throws AssertionError if tag is missing or value doesn't match
 */
export function assertHasTag(event: NostrEvent, tagName: string, value?: string): void {
  const tag = event.tags.find(t => t[0] === tagName)
  expect(tag, `Event must have '${tagName}' tag`).toBeDefined()

  if (value !== undefined) {
    expect(tag![1], `Tag '${tagName}' must have value '${value}'`).toBe(value)
  }
}

/**
 * Assert that an event has an 'a' tag referencing a repository (NIP-34).
 * The 'a' tag format is: ["a", "30617:<pubkey>:<identifier>", "<relay>?"]
 *
 * @param event - The event to check
 * @param expectedNaddr - Optional: expected naddr value to match
 * @throws AssertionError if repo reference is missing or invalid
 */
export function assertRepoReference(event: NostrEvent, expectedNaddr?: string): void {
  const aTag = event.tags.find(t => t[0] === "a")
  expect(aTag, "Event must have 'a' tag for repo reference").toBeDefined()

  const aValue = aTag![1]
  expect(aValue, "'a' tag must have a value").toBeDefined()

  // Validate format: "30617:<pubkey>:<identifier>"
  const parts = aValue.split(":")
  expect(parts.length, "'a' tag should have format kind:pubkey:identifier").toBeGreaterThanOrEqual(3)
  expect(parts[0], "'a' tag must reference kind 30617 (repo announcement)").toBe("30617")
  expect(parts[1].length, "'a' tag pubkey must be 64 hex characters").toBe(64)

  if (expectedNaddr !== undefined) {
    expect(aValue, `'a' tag should match expected naddr`).toBe(expectedNaddr)
  }
}

/**
 * Assert that an event has an 'e' tag referencing another event.
 *
 * @param event - The event to check
 * @param expectedEventId - Optional: specific event ID to match
 * @throws AssertionError if event reference is missing
 */
export function assertEventReference(event: NostrEvent, expectedEventId?: string): void {
  const eTag = event.tags.find(t => t[0] === "e")
  expect(eTag, "Event must have 'e' tag for event reference").toBeDefined()

  const eventId = eTag![1]
  expect(eventId, "'e' tag must have a value").toBeDefined()
  expect(eventId.length, "'e' tag event ID must be 64 hex characters").toBe(64)

  if (expectedEventId !== undefined) {
    expect(eventId, `'e' tag should reference event ${expectedEventId}`).toBe(expectedEventId)
  }
}

/**
 * Assert that an event has a 'd' tag (for parameterized replaceable events).
 * Required for addressable events like repo announcements and repo state.
 *
 * @param event - The event to check
 * @param expectedValue - Optional: expected 'd' tag value
 * @throws AssertionError if 'd' tag is missing
 */
export function assertDTag(event: NostrEvent, expectedValue?: string): void {
  const dTag = event.tags.find(t => t[0] === "d")
  expect(dTag, "Event must have 'd' tag (identifier)").toBeDefined()

  if (expectedValue !== undefined) {
    expect(dTag![1], `'d' tag should have value '${expectedValue}'`).toBe(expectedValue)
  }
}

// ---------------------------------------------------------------------------
// NIP-34 Specific Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that an event is a valid Repository Announcement (kind 30617).
 *
 * Required tags:
 * - d: repository identifier
 *
 * Common optional tags:
 * - name: human-readable name
 * - description: repository description
 * - clone: clone URLs
 * - web: web URLs
 * - relays: preferred relays
 * - maintainers: pubkeys of maintainers
 * - r (with "euc"): early unique commit
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid repo announcement
 */
export function assertValidRepoAnnouncement(event: NostrEvent): void {
  assertValidEvent(event)
  assertEventKind(event, KIND_REPO_ANNOUNCEMENT)
  assertDTag(event)

  // The 'd' tag value should be non-empty (repo identifier)
  const dValue = getTagValue(event, "d")
  expect(dValue, "'d' tag must have a non-empty value").toBeTruthy()
}

/**
 * Assert that an event is a valid Repository State (kind 30618).
 *
 * Required tags:
 * - d: repository identifier (must match corresponding announcement)
 *
 * Expected tags:
 * - refs/heads/<branch>: branch refs pointing to commit SHAs
 * - HEAD: current head reference
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid repo state
 */
export function assertValidRepoState(event: NostrEvent): void {
  assertValidEvent(event)
  assertEventKind(event, KIND_REPO_STATE)
  assertDTag(event)

  // Should have at least one refs/ tag or HEAD tag
  const hasRefs = event.tags.some(t => t[0].startsWith("refs/"))
  const hasHead = event.tags.some(t => t[0] === "HEAD")
  expect(
    hasRefs || hasHead,
    "Repo state should have at least one refs/ tag or HEAD tag"
  ).toBe(true)
}

/**
 * Assert that an event is a valid Patch (kind 1617).
 *
 * Required tags:
 * - a: repository address reference
 *
 * Common tags:
 * - p: pubkey of patch author or target maintainer
 * - commit: commit SHA
 * - parent-commit: parent commit SHA
 * - t: with value "root" for root patch in a series
 *
 * Content should contain git format-patch output.
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid patch
 */
export function assertValidPatch(event: NostrEvent): void {
  assertValidEvent(event)
  assertEventKind(event, KIND_PATCH)
  assertRepoReference(event)

  // Patch content should not be empty (contains git format-patch output)
  expect(event.content.length, "Patch content should not be empty").toBeGreaterThan(0)

  // Should typically have commit tag
  const commitTag = getTag(event, "commit")
  if (commitTag) {
    expect(commitTag[1].length, "commit tag should be a valid SHA").toBeGreaterThanOrEqual(7)
  }
}

/**
 * Assert that an event is a valid Issue (kind 1621).
 *
 * Required tags:
 * - a: repository address reference
 *
 * Common tags:
 * - subject: issue title
 * - p: pubkeys of mentioned users or assignees
 * - t: topic/label tags
 *
 * Content contains the issue body in markdown.
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid issue
 */
export function assertValidIssue(event: NostrEvent): void {
  assertValidEvent(event)
  assertEventKind(event, KIND_ISSUE)
  assertRepoReference(event)

  // Issues typically have a subject tag
  const subject = getTagValue(event, "subject")
  if (subject !== undefined) {
    expect(subject.length, "Issue subject should not be empty").toBeGreaterThan(0)
  }
}

/**
 * Assert that an event is a valid Status event (kinds 1630-1633).
 *
 * Status events indicate the state of issues, patches, or PRs:
 * - 1630: Open
 * - 1631: Applied/Merged
 * - 1632: Closed
 * - 1633: Draft
 *
 * Required tags:
 * - e: reference to the target event (issue, patch, or PR)
 * - p: pubkeys of participants
 *
 * Optional tags:
 * - a: repository address
 * - merge-commit: SHA of merge commit (for applied status)
 * - applied-as-commits: commit SHAs (for applied patches)
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid status event
 */
export function assertValidStatusEvent(event: NostrEvent): void {
  assertValidEvent(event)

  // Kind must be one of the status kinds
  expect(
    STATUS_KINDS.includes(event.kind as typeof STATUS_KINDS[number]),
    `Status event kind must be one of ${STATUS_KINDS.join(", ")}`
  ).toBe(true)

  // Must have an 'e' tag referencing the target event
  assertEventReference(event)

  // Should have at least one 'p' tag (except for draft status which is private)
  const pTags = getTags(event, "p")
  if (event.kind !== KIND_STATUS_DRAFT) {
    expect(pTags.length, "Status event should have at least one 'p' tag").toBeGreaterThanOrEqual(1)
  }

  // For applied status, check for merge-related tags
  if (event.kind === KIND_STATUS_APPLIED) {
    const hasMergeCommit = hasTag(event, "merge-commit")
    const hasAppliedCommits = hasTag(event, "applied-as-commits")
    // At least one of these is expected for patches, but not strictly required
    if (hasMergeCommit) {
      const mergeCommit = getTagValue(event, "merge-commit")
      expect(mergeCommit!.length, "merge-commit should be a valid SHA").toBeGreaterThanOrEqual(7)
    }
    if (hasAppliedCommits) {
      const commits = getTagValues(event, "applied-as-commits")
      expect(commits.length, "applied-as-commits should have at least one commit").toBeGreaterThanOrEqual(1)
    }
  }
}

/**
 * Assert that an event is a valid Label event (NIP-32, kind 1985).
 *
 * Required tags:
 * - L: label namespace
 * - l: label value (with optional namespace in third element)
 *
 * Must have at least one target reference:
 * - e: event reference
 * - a: address reference
 * - p: pubkey reference
 *
 * @param event - The event to validate
 * @throws AssertionError if event is not a valid label event
 */
export function assertValidLabel(event: NostrEvent): void {
  assertValidEvent(event)
  assertEventKind(event, KIND_LABEL)

  // Must have at least one 'l' tag (label value)
  const lTags = getTags(event, "l")
  expect(lTags.length, "Label event must have at least one 'l' tag").toBeGreaterThanOrEqual(1)

  // Must have at least one 'L' tag (namespace) if labels are namespaced
  // Or at least one target reference
  const hasNamespace = hasTag(event, "L")
  const hasEventRef = hasTag(event, "e")
  const hasAddrRef = hasTag(event, "a")
  const hasPubkeyRef = hasTag(event, "p")

  expect(
    hasEventRef || hasAddrRef || hasPubkeyRef,
    "Label event must reference at least one target (e, a, or p tag)"
  ).toBe(true)

  // Validate 'l' tag structure
  for (const lTag of lTags) {
    expect(lTag[1], "'l' tag must have a value").toBeDefined()
    expect(lTag[1].length, "'l' tag value should not be empty").toBeGreaterThan(0)

    // If tag has a namespace (third element), it should match an 'L' tag
    if (lTag[2] && hasNamespace) {
      const namespaces = getTagValues(event, "L")
      expect(
        namespaces.includes(lTag[2]),
        `'l' tag namespace '${lTag[2]}' should be declared in 'L' tag`
      ).toBe(true)
    }
  }
}

// ---------------------------------------------------------------------------
// Composite Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that a status event correctly references an issue.
 *
 * @param statusEvent - The status event
 * @param issueEvent - The issue it should reference
 */
export function assertStatusReferencesIssue(statusEvent: NostrEvent, issueEvent: NostrEvent): void {
  assertValidStatusEvent(statusEvent)
  expect(issueEvent.id, "Issue must have an ID").toBeDefined()
  assertEventReference(statusEvent, issueEvent.id)
}

/**
 * Assert that a status event correctly references a patch.
 *
 * @param statusEvent - The status event
 * @param patchEvent - The patch it should reference
 */
export function assertStatusReferencesPatch(statusEvent: NostrEvent, patchEvent: NostrEvent): void {
  assertValidStatusEvent(statusEvent)
  expect(patchEvent.id, "Patch must have an ID").toBeDefined()
  assertEventReference(statusEvent, patchEvent.id)
}

/**
 * Assert that an event references a specific repository.
 *
 * @param event - The event to check (patch, issue, status, etc.)
 * @param repoEvent - The repository announcement it should reference
 */
export function assertReferencesRepo(event: NostrEvent, repoEvent: NostrEvent): void {
  const repoDTag = getTagValue(repoEvent, "d")
  expect(repoDTag, "Repo announcement must have 'd' tag").toBeDefined()

  const expectedAddr = `30617:${repoEvent.pubkey}:${repoDTag}`
  assertRepoReference(event, expectedAddr)
}

/**
 * Assert that a label targets a specific event.
 *
 * @param labelEvent - The label event
 * @param targetEvent - The event being labeled
 */
export function assertLabelTargetsEvent(labelEvent: NostrEvent, targetEvent: NostrEvent): void {
  assertValidLabel(labelEvent)
  expect(targetEvent.id, "Target event must have an ID").toBeDefined()

  const eRefs = getTagValues(labelEvent, "e")
  expect(
    eRefs.includes(targetEvent.id!),
    `Label should reference event ${targetEvent.id}`
  ).toBe(true)
}
