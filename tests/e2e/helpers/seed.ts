/**
 * Test Data Seeding Helpers for E2E Testing
 *
 * Provides high-level seeding functions that leverage the existing MockRelay
 * and event fixtures to create comprehensive test scenarios.
 *
 * The TestSeeder class wraps MockRelay and provides convenient methods for
 * seeding repositories, issues, and patches with proper event relationships.
 *
 * @example
 * ```typescript
 * import {test, expect} from "@playwright/test"
 * import {TestSeeder, seedTestRepo, seedTestScenario} from "../helpers/seed"
 *
 * test("displays seeded repository with issues", async ({page}) => {
 *   // Option 1: Quick convenience function
 *   const seeder = await seedTestRepo(page, {
 *     name: "test-repo",
 *     withIssues: 3,
 *     withPatches: 2,
 *   })
 *
 *   await page.goto("/spaces/ws%3A%2F%2Flocalhost%3A7000/git")
 *   await expect(page.getByText("test-repo")).toBeVisible()
 *
 *   // Option 2: Pre-built scenario
 *   const seeder2 = await seedTestScenario(page, "full")
 *
 *   // Option 3: Full control with TestSeeder
 *   const seeder3 = new TestSeeder({debug: true})
 *   seeder3.seedRepo({name: "my-repo", withIssues: 5})
 *   await seeder3.setup(page)
 * })
 * ```
 */
import type {Page} from "@playwright/test"
import {MockRelay, type NostrEvent, randomHex, nowSeconds, NIP34_KINDS} from "./mock-relay"
import {
  createRepoAnnouncement as createRepoAnnouncementFixture,
  createIssue as createIssueFixture,
  createPatch as createPatchFixture,
  createStatusEvent,
  createOpenStatus,
  createClosedStatus,
  createAppliedStatus,
  createDraftStatus,
  getRepoAddress,
  encodeRepoNaddr,
  addressToNaddr,
  signTestEvent,
  TEST_PUBKEYS,
  BASE_TIMESTAMP,
  STATUS_KINDS,
  type UnsignedEvent,
} from "../fixtures/events"

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Options for seeding a repository
 */
export interface SeedRepoOptions {
  /** Repository name (defaults to random) */
  name?: string
  /** Repository description */
  description?: string
  /** Repository identifier (d tag, defaults to slugified name) */
  identifier?: string
  /** Maintainer pubkeys */
  maintainers?: string[]
  /** Clone URLs */
  cloneUrls?: string[]
  /** Web URLs */
  webUrls?: string[]
  /** Repository topics/tags */
  topics?: string[]
  /** Author pubkey (defaults to alice) */
  pubkey?: string
  /** Number of issues to create for this repo */
  withIssues?: number
  /** Number of patches to create for this repo */
  withPatches?: number
  /** Event timestamp */
  created_at?: number
}

/**
 * Options for seeding an issue
 */
export interface SeedIssueOptions {
  /** Repository naddr or address string */
  repoAddress: string
  /** Issue title/subject */
  title?: string
  /** Issue content/body */
  content?: string
  /** Issue status */
  status?: "open" | "closed" | "draft" | "resolved"
  /** Issue labels */
  labels?: string[]
  /** Author pubkey (defaults to random test user) */
  pubkey?: string
  /** Number of comments/replies to create */
  withComments?: number
  /** Recipient pubkeys (maintainers, assignees) */
  recipients?: string[]
  /** Event timestamp */
  created_at?: number
}

/**
 * Options for seeding a patch
 */
export interface SeedPatchOptions {
  /** Repository naddr or address string */
  repoAddress: string
  /** Patch title/subject */
  title?: string
  /** Patch content (diff) */
  content?: string
  /** Patch status */
  status?: "open" | "applied" | "closed" | "draft"
  /** Patch labels */
  labels?: string[]
  /** Author pubkey (defaults to random test user) */
  pubkey?: string
  /** Number of reviews/comments to create */
  withReviews?: number
  /** Commit hash */
  commit?: string
  /** Parent commit hash */
  parentCommit?: string
  /** Recipient pubkeys */
  recipients?: string[]
  /** Event timestamp */
  created_at?: number
}

/**
 * Result from seeding a repository
 */
export interface SeedRepoResult {
  /** The naddr-style address for the repo (kind:pubkey:identifier) */
  address: string
  /** The bech32-encoded naddr for URL routing */
  naddr: string
  /** The repo identifier (d tag) */
  identifier: string
  /** The pubkey of the repo owner */
  pubkey: string
  /** The repo announcement event */
  announcement: UnsignedEvent
  /** All events created for this repo (including issues and patches) */
  events: UnsignedEvent[]
}

/**
 * Result from seeding an issue
 */
export interface SeedIssueResult {
  /** The generated event ID */
  eventId: string
  /** The issue event */
  issue: UnsignedEvent
  /** All events created (issue + status + comments) */
  events: UnsignedEvent[]
}

/**
 * Result from seeding a patch
 */
export interface SeedPatchResult {
  /** The generated event ID */
  eventId: string
  /** The patch event */
  patch: UnsignedEvent
  /** All events created (patch + status + reviews) */
  events: UnsignedEvent[]
}

/**
 * Options for the TestSeeder constructor
 */
export interface TestSeederOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Simulated network latency in ms */
  latency?: number
  /** Relay URLs to intercept */
  interceptUrls?: string[]
}

/**
 * Pre-defined test scenarios
 */
export type TestScenario = "empty" | "single-repo" | "with-issues" | "with-patches" | "full"

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Slugify a string for use as an identifier
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Pick a random test user pubkey
 */
function randomTestPubkey(): string {
  const users = [TEST_PUBKEYS.alice, TEST_PUBKEYS.bob, TEST_PUBKEYS.charlie]
  return users[Math.floor(Math.random() * users.length)]
}

/**
 * Generate a random issue title
 */
function generateIssueTitle(index: number): string {
  const titles = [
    "Bug: Application crashes on startup",
    "Feature: Add dark mode support",
    "Bug: Form validation not working",
    "Enhancement: Improve loading performance",
    "Bug: Memory leak in event handler",
    "Feature: Add keyboard shortcuts",
    "Documentation: Update README",
    "Bug: CSS styling broken on mobile",
    "Enhancement: Add search functionality",
    "Feature: Export data to CSV",
  ]
  return titles[index % titles.length]
}

/**
 * Generate a random issue body
 */
function generateIssueContent(title: string): string {
  return `## Description
${title.replace(/^(Bug|Feature|Enhancement|Documentation): /, "")}

## Steps to Reproduce
1. Open the application
2. Navigate to the affected area
3. Observe the issue

## Expected Behavior
The application should work correctly.

## Environment
- Browser: Chrome latest
- OS: macOS`
}

/**
 * Generate a random patch title
 */
function generatePatchTitle(index: number): string {
  const titles = [
    "Fix null pointer exception",
    "Add new utility function",
    "Refactor authentication module",
    "Update dependencies",
    "Fix CSS layout issues",
    "Add unit tests",
    "Improve error handling",
    "Optimize database queries",
    "Add input validation",
    "Fix memory leak",
  ]
  return titles[index % titles.length]
}

/**
 * Generate sample diff content
 */
function generatePatchContent(title: string): string {
  return `From abc123 Mon Sep 17 00:00:00 2001
From: Test User <test@example.com>
Date: Mon, 15 Jan 2024 12:00:00 +0000
Subject: [PATCH] ${title}

This patch implements the requested changes.

---
 src/app.ts | 5 ++++-
 1 file changed, 4 insertions(+), 1 deletion(-)

diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,10 @@ export function main() {
   // Main application code
-  const value = getData();
+  const value = getData();
+  if (!value) {
+    return null;
+  }
   return process(value);
 }
--
2.34.1
`
}

/**
 * Convert UnsignedEvent to NostrEvent by properly signing it.
 *
 * Uses the signTestEvent function which uses real cryptographic
 * signatures that will pass welshman's event validation.
 */
function toSignedEvent(event: UnsignedEvent): NostrEvent {
  // Sign the event with the appropriate test private key
  return signTestEvent(event) as NostrEvent
}

// =============================================================================
// TestSeeder Class
// =============================================================================

/**
 * Main seeding class that wraps MockRelay and provides high-level
 * seeding functions for E2E tests.
 */
export class TestSeeder {
  private mockRelay: MockRelay
  private seededEvents: NostrEvent[] = []
  private debug: boolean
  private options: TestSeederOptions
  private repoCounter = 0
  private issueCounter = 0
  private patchCounter = 0
  private timestampCounter = 0

  constructor(options?: TestSeederOptions) {
    this.options = options || {}
    this.debug = options?.debug || false
    this.mockRelay = new MockRelay({
      debug: this.debug,
      latency: options?.latency,
      interceptUrls: options?.interceptUrls,
    })
  }

  /**
   * Get the next timestamp (incrementing to ensure proper ordering)
   */
  private nextTimestamp(): number {
    return BASE_TIMESTAMP + this.timestampCounter++
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.log(`[TestSeeder] ${message}`, ...args)
    }
  }

  /**
   * Set up the mock relay with seeded data
   *
   * MUST be called before navigating to the app.
   */
  async setup(page: Page): Promise<void> {
    this.log(`Setting up with ${this.seededEvents.length} events`)

    // Add all seeded events to the mock relay
    this.mockRelay.seedEvents(this.seededEvents)

    // Set up the mock relay
    await this.mockRelay.setup(page, {
      debug: this.debug,
      latency: this.options.latency,
      interceptUrls: this.options.interceptUrls,
    })
  }

  /**
   * Seed a repository with optional issues and patches
   */
  seedRepo(options?: SeedRepoOptions): SeedRepoResult {
    const opts = options || {}
    const name = opts.name || `test-repo-${++this.repoCounter}`
    const identifier = opts.identifier || slugify(name)
    const pubkey = opts.pubkey || TEST_PUBKEYS.alice

    this.log(`Seeding repo: ${name} (${identifier})`)

    const events: UnsignedEvent[] = []

    // Create the repository announcement
    const announcement = createRepoAnnouncementFixture({
      identifier,
      name,
      description: opts.description,
      web: opts.webUrls,
      clone: opts.cloneUrls,
      maintainers: opts.maintainers,
      hashtags: opts.topics,
      pubkey,
      created_at: opts.created_at ?? this.nextTimestamp(),
    })

    events.push(announcement)

    // Sign and add the repo announcement
    this.seededEvents.push(toSignedEvent(announcement))

    // Calculate the repo address
    const address = getRepoAddress(pubkey, identifier)

    // Add issues if requested (seedIssue adds its own events to seededEvents)
    if (opts.withIssues && opts.withIssues > 0) {
      for (let i = 0; i < opts.withIssues; i++) {
        const issueResult = this.seedIssue({
          repoAddress: address,
          title: generateIssueTitle(i),
          status: i % 3 === 0 ? "closed" : "open", // Some closed issues
          created_at: this.nextTimestamp(),
        })
        events.push(...issueResult.events)
      }
    }

    // Add patches if requested (seedPatch adds its own events to seededEvents)
    if (opts.withPatches && opts.withPatches > 0) {
      for (let i = 0; i < opts.withPatches; i++) {
        const patchResult = this.seedPatch({
          repoAddress: address,
          title: generatePatchTitle(i),
          status: i % 3 === 0 ? "applied" : "open", // Some applied patches
          created_at: this.nextTimestamp(),
        })
        events.push(...patchResult.events)
      }
    }

    // Generate the naddr for URL routing
    const naddr = encodeRepoNaddr(pubkey, identifier)

    return {
      address,
      naddr,
      identifier,
      pubkey,
      announcement,
      events,
    }
  }

  /**
   * Seed an issue for a repository
   */
  seedIssue(options: SeedIssueOptions): SeedIssueResult {
    const title = options.title || generateIssueTitle(++this.issueCounter)
    const content = options.content || generateIssueContent(title)
    const pubkey = options.pubkey || randomTestPubkey()

    this.log(`Seeding issue: ${title}`)

    const events: UnsignedEvent[] = []

    // Create the issue event
    const issue = createIssueFixture({
      content,
      repoAddress: options.repoAddress,
      subject: title,
      labels: options.labels,
      recipients: options.recipients,
      pubkey,
      created_at: options.created_at ?? this.nextTimestamp(),
    })

    events.push(issue)

    // Sign the issue first to get its real event ID
    const signedIssue = toSignedEvent(issue)
    this.seededEvents.push(signedIssue)
    const eventId = signedIssue.id

    // Create status event based on requested status (now using real issue ID)
    if (options.status) {
      const statusTimestamp = this.nextTimestamp()
      let statusEvent: UnsignedEvent

      switch (options.status) {
        case "open":
          statusEvent = createOpenStatus(eventId, {
            content: "Issue opened",
            repoAddress: options.repoAddress,
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "closed":
          statusEvent = createClosedStatus(eventId, {
            content: "Issue closed",
            repoAddress: options.repoAddress,
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "resolved":
          statusEvent = createAppliedStatus(eventId, {
            content: "Issue resolved",
            repoAddress: options.repoAddress,
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "draft":
          statusEvent = createDraftStatus(eventId, {
            content: "Draft issue",
            repoAddress: options.repoAddress,
            pubkey,
            created_at: statusTimestamp,
          })
          break
      }

      events.push(statusEvent)
      this.seededEvents.push(toSignedEvent(statusEvent))
    }

    // Add comments if requested
    if (options.withComments && options.withComments > 0) {
      for (let i = 0; i < options.withComments; i++) {
        const commentPubkey = randomTestPubkey()
        // Create a simple reply event (kind 1111 or similar)
        // For now, we'll use a generic comment structure
        const comment: UnsignedEvent = {
          kind: 1111, // Generic reply kind
          created_at: this.nextTimestamp(),
          tags: [
            ["e", eventId, "", "root"],
            ["a", options.repoAddress],
          ],
          content: `Comment ${i + 1} on this issue.`,
          pubkey: commentPubkey,
        }
        events.push(comment)
        this.seededEvents.push(toSignedEvent(comment))
      }
    }

    return {
      eventId,
      issue,
      events,
    }
  }

  /**
   * Seed a patch for a repository
   */
  seedPatch(options: SeedPatchOptions): SeedPatchResult {
    const title = options.title || generatePatchTitle(++this.patchCounter)
    const content = options.content || generatePatchContent(title)
    const pubkey = options.pubkey || randomTestPubkey()
    const commit = options.commit || randomHex(40)
    const parentCommit = options.parentCommit || randomHex(40)

    this.log(`Seeding patch: ${title}`)

    const events: UnsignedEvent[] = []

    // Create the patch event
    const patch = createPatchFixture({
      content,
      repoAddress: options.repoAddress,
      subject: title,
      labels: options.labels,
      recipients: options.recipients,
      commit,
      parentCommit,
      pubkey,
      created_at: options.created_at ?? this.nextTimestamp(),
    })

    events.push(patch)

    // Sign the patch first to get its real event ID
    const signedPatch = toSignedEvent(patch)
    this.seededEvents.push(signedPatch)
    const eventId = signedPatch.id

    // Create status event based on requested status (now using real patch ID)
    if (options.status) {
      const statusTimestamp = this.nextTimestamp()
      let statusEvent: UnsignedEvent

      switch (options.status) {
        case "open":
          statusEvent = createOpenStatus(eventId, {
            content: "Patch submitted for review",
            repoAddress: options.repoAddress,
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "applied":
          statusEvent = createAppliedStatus(eventId, {
            content: "Patch applied successfully",
            repoAddress: options.repoAddress,
            mergeCommit: randomHex(40),
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "closed":
          statusEvent = createClosedStatus(eventId, {
            content: "Patch rejected",
            repoAddress: options.repoAddress,
            pubkey: TEST_PUBKEYS.alice,
            created_at: statusTimestamp,
          })
          break
        case "draft":
          statusEvent = createDraftStatus(eventId, {
            content: "Work in progress",
            repoAddress: options.repoAddress,
            pubkey,
            created_at: statusTimestamp,
          })
          break
      }

      events.push(statusEvent)
      this.seededEvents.push(toSignedEvent(statusEvent))
    }

    // Add reviews if requested
    if (options.withReviews && options.withReviews > 0) {
      for (let i = 0; i < options.withReviews; i++) {
        const reviewerPubkey = randomTestPubkey()
        // Create a review comment event
        const review: UnsignedEvent = {
          kind: 1111, // Generic reply kind
          created_at: this.nextTimestamp(),
          tags: [
            ["e", eventId, "", "root"],
            ["a", options.repoAddress],
          ],
          content: `Review comment ${i + 1}: Looks good to me!`,
          pubkey: reviewerPubkey,
        }
        events.push(review)
        this.seededEvents.push(toSignedEvent(review))
      }
    }

    return {
      eventId,
      patch,
      events,
    }
  }

  /**
   * Get all seeded events
   */
  getSeededEvents(): NostrEvent[] {
    return [...this.seededEvents]
  }

  /**
   * Clear all seeded data
   */
  clear(): void {
    this.seededEvents = []
    this.mockRelay.clear()
    this.repoCounter = 0
    this.issueCounter = 0
    this.patchCounter = 0
    this.timestampCounter = 0
    this.log("Cleared all seeded data")
  }

  /**
   * Get the underlying MockRelay for advanced operations and assertions
   */
  getMockRelay(): MockRelay {
    return this.mockRelay
  }

  /**
   * Add raw events directly (for advanced use cases)
   */
  addEvents(events: NostrEvent[]): void {
    this.seededEvents.push(...events)
  }

  /**
   * Get events filtered by kind
   */
  getEventsByKind(kind: number): NostrEvent[] {
    return this.seededEvents.filter((e) => e.kind === kind)
  }

  /**
   * Get all seeded repository announcements
   */
  getRepos(): NostrEvent[] {
    return this.getEventsByKind(NIP34_KINDS.REPO_ANNOUNCEMENT)
  }

  /**
   * Get all seeded issues
   */
  getIssues(): NostrEvent[] {
    return this.getEventsByKind(NIP34_KINDS.ISSUE)
  }

  /**
   * Get all seeded patches
   */
  getPatches(): NostrEvent[] {
    return this.getEventsByKind(NIP34_KINDS.PATCH)
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick convenience function to seed a test repository
 *
 * Creates a TestSeeder, seeds a repo with the given options,
 * sets up the mock relay, and returns the seeder for further use.
 *
 * @example
 * ```typescript
 * const seeder = await seedTestRepo(page, {
 *   name: "my-repo",
 *   withIssues: 5,
 *   withPatches: 3,
 * })
 * ```
 */
export async function seedTestRepo(page: Page, options?: SeedRepoOptions): Promise<TestSeeder> {
  const seeder = new TestSeeder()
  seeder.seedRepo(options)
  await seeder.setup(page)
  return seeder
}

/**
 * Seed a pre-defined test scenario
 *
 * Available scenarios:
 * - "empty": No data (just sets up mock relay)
 * - "single-repo": One repository with no issues or patches
 * - "with-issues": One repository with 5 issues (mix of open/closed)
 * - "with-patches": One repository with 5 patches (mix of open/applied)
 * - "full": One repository with 5 issues, 5 patches, and multiple statuses
 *
 * @example
 * ```typescript
 * // Quick full scenario
 * const seeder = await seedTestScenario(page, "full")
 *
 * // Empty relay for testing empty states
 * const seeder = await seedTestScenario(page, "empty")
 * ```
 */
export async function seedTestScenario(page: Page, scenario: TestScenario): Promise<TestSeeder> {
  const seeder = new TestSeeder()

  switch (scenario) {
    case "empty":
      // No data, just set up the mock relay
      break

    case "single-repo":
      seeder.seedRepo({
        name: "test-project",
        description: "A test project for E2E testing",
        maintainers: [TEST_PUBKEYS.alice],
        topics: ["test", "nostr"],
      })
      break

    case "with-issues":
      seeder.seedRepo({
        name: "test-project",
        description: "A test project with issues",
        maintainers: [TEST_PUBKEYS.alice],
        withIssues: 5,
      })
      break

    case "with-patches":
      seeder.seedRepo({
        name: "test-project",
        description: "A test project with patches",
        maintainers: [TEST_PUBKEYS.alice],
        withPatches: 5,
      })
      break

    case "full":
      seeder.seedRepo({
        name: "flotilla-budabit",
        description: "A Discord-like Nostr client with git collaboration",
        maintainers: [TEST_PUBKEYS.alice, TEST_PUBKEYS.bob],
        topics: ["nostr", "git", "collaboration", "svelte"],
        cloneUrls: ["https://github.com/example/flotilla-budabit.git"],
        webUrls: ["https://flotilla.dev"],
        withIssues: 5,
        withPatches: 5,
      })
      break
  }

  await seeder.setup(page)
  return seeder
}

/**
 * Create a seeder with multiple repositories
 *
 * @example
 * ```typescript
 * const seeder = await seedMultipleRepos(page, [
 *   {name: "repo-1", withIssues: 2},
 *   {name: "repo-2", withPatches: 3},
 *   {name: "repo-3", withIssues: 1, withPatches: 1},
 * ])
 * ```
 */
export async function seedMultipleRepos(
  page: Page,
  repos: SeedRepoOptions[],
): Promise<TestSeeder> {
  const seeder = new TestSeeder()

  for (const repoOptions of repos) {
    seeder.seedRepo(repoOptions)
  }

  await seeder.setup(page)
  return seeder
}

// =============================================================================
// URL Generation Helpers
// =============================================================================

/**
 * Default relay URL used in test URLs
 */
export const TEST_RELAY = "ws://localhost:7000"
export const TEST_RELAY_ENCODED = encodeURIComponent(TEST_RELAY)

/**
 * Generate a repository detail URL for testing
 */
export function getRepoUrl(naddr: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/`
}

/**
 * Generate a repository issues URL
 */
export function getRepoIssuesUrl(naddr: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/issues`
}

/**
 * Generate a repository patches URL
 */
export function getRepoPatchesUrl(naddr: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/patches`
}

/**
 * Generate a repository code URL
 */
export function getRepoCodeUrl(naddr: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/code`
}

/**
 * Generate a repository commits URL
 */
export function getRepoCommitsUrl(naddr: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/commits`
}

/**
 * Generate a specific issue detail URL
 */
export function getIssueDetailUrl(naddr: string, issueId: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/issues/${issueId}`
}

/**
 * Generate a specific patch detail URL
 */
export function getPatchDetailUrl(naddr: string, patchId: string, relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git/${naddr}/patches/${patchId}`
}

/**
 * Generate the git repos list URL
 */
export function getGitReposUrl(relay: string = TEST_RELAY): string {
  const encodedRelay = encodeURIComponent(relay)
  return `/spaces/${encodedRelay}/git`
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export {TEST_PUBKEYS, BASE_TIMESTAMP, encodeRepoNaddr, addressToNaddr} from "../fixtures/events"
export {NIP34_KINDS, type NostrEvent} from "./mock-relay"
