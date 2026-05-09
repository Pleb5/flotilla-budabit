/**
 * Pre-built Test Event Fixtures
 *
 * Ready-to-use Nostr events for E2E tests.
 * These fixtures provide consistent test data that can be seeded into the MockRelay.
 *
 * @example
 * ```typescript
 * import {test, expect} from "@playwright/test"
 * import {MockRelay} from "../helpers"
 * import {FIXTURES} from "../fixtures/test-events"
 *
 * test("shows seeded repos", async ({page}) => {
 *   const mockRelay = new MockRelay({seedEvents: FIXTURES.REPOS_WITH_ISSUES})
 *   await mockRelay.setup(page)
 *   await page.goto("/spaces/ws%3A%2F%2Flocalhost%3A7000/git")
 *   await expect(page.getByText("nostr-tools")).toBeVisible()
 * })
 * ```
 */
import {
  createRepoAnnouncement,
  createIssue,
  createIssueReply,
  createStatus,
  NIP34_KINDS,
  TEST_USERS,
  type NostrEvent,
} from "../helpers/mock-relay"

// =============================================================================
// Test Users
// =============================================================================

/**
 * Well-known test pubkeys for consistent testing
 */
export const PUBKEYS = {
  /** Alice - typically the repo owner */
  alice: TEST_USERS.alice.pubkey,
  /** Bob - typically a contributor */
  bob: TEST_USERS.bob.pubkey,
  /** Charlie - typically a reviewer */
  charlie: TEST_USERS.charlie.pubkey,
} as const

// =============================================================================
// Repository Fixtures
// =============================================================================

/**
 * A simple repository announcement
 */
export const REPO_SIMPLE = createRepoAnnouncement({
  pubkey: PUBKEYS.alice,
  name: "simple-project",
  description: "A simple test project",
  cloneUrls: ["https://github.com/test/simple-project.git"],
  maintainers: [PUBKEYS.alice],
  license: "MIT",
})

/**
 * A repository mimicking nostr-tools
 */
export const REPO_NOSTR_TOOLS = createRepoAnnouncement({
  pubkey: PUBKEYS.alice,
  name: "nostr-tools",
  description: "Tools for working with Nostr protocol",
  cloneUrls: ["https://github.com/nbd-wtf/nostr-tools.git"],
  webUrl: "https://github.com/nbd-wtf/nostr-tools",
  maintainers: [PUBKEYS.alice, PUBKEYS.bob],
  license: "MIT",
  topics: ["nostr", "typescript", "javascript"],
})

/**
 * A repository with multiple maintainers
 */
export const REPO_MULTI_MAINTAINER = createRepoAnnouncement({
  pubkey: PUBKEYS.alice,
  name: "team-project",
  description: "A project with multiple maintainers",
  cloneUrls: ["https://github.com/team/project.git"],
  maintainers: [PUBKEYS.alice, PUBKEYS.bob, PUBKEYS.charlie],
  topics: ["collaboration", "team"],
})

// =============================================================================
// Issue Fixtures
// =============================================================================

/**
 * Build the repo reference for linking issues/PRs
 */
function repoRef(repo: NostrEvent): string {
  const dTag = repo.tags.find((t) => t[0] === "d")?.[1] || ""
  return `${NIP34_KINDS.REPO_ANNOUNCEMENT}:${repo.pubkey}:${dTag}`
}

/**
 * A bug report issue
 */
export const ISSUE_BUG = createIssue({
  pubkey: PUBKEYS.bob,
  title: "Bug: Application crashes on startup",
  body: `## Description
The application crashes immediately when trying to start.

## Steps to Reproduce
1. Run \`npm start\`
2. Wait for the application to load
3. Observe the crash

## Expected Behavior
Application should start normally.

## Actual Behavior
Crash with error: "Cannot read property 'foo' of undefined"`,
  repoRef: repoRef(REPO_SIMPLE),
  labels: ["bug", "critical"],
})

/**
 * A feature request issue
 */
export const ISSUE_FEATURE = createIssue({
  pubkey: PUBKEYS.charlie,
  title: "Feature: Add dark mode support",
  body: `## Description
It would be great to have a dark mode option for the UI.

## Motivation
Many users prefer dark mode, especially when working at night.

## Proposed Solution
Add a toggle in settings that switches between light and dark themes.`,
  repoRef: repoRef(REPO_SIMPLE),
  labels: ["enhancement", "ui"],
})

/**
 * A reply to the bug issue
 */
export const ISSUE_BUG_REPLY = createIssueReply({
  pubkey: PUBKEYS.alice,
  content: "Thanks for reporting this! I can reproduce the issue. Working on a fix now.",
  issueId: ISSUE_BUG.id,
})

// =============================================================================
// Status Fixtures
// =============================================================================

/**
 * Status marking the bug issue as closed
 */
export const STATUS_ISSUE_CLOSED = createStatus({
  pubkey: PUBKEYS.alice,
  statusKind: 1632, // Closed
  targetId: ISSUE_BUG.id,
  repoRef: repoRef(REPO_SIMPLE),
  content: "Fixed in commit abc123",
})

// =============================================================================
// Composite Fixtures (ready-to-use collections)
// =============================================================================

/**
 * Collection: Just repositories (no issues)
 */
export const REPOS_ONLY: NostrEvent[] = [
  REPO_SIMPLE,
  REPO_NOSTR_TOOLS,
  REPO_MULTI_MAINTAINER,
]

/**
 * Collection: Repository with open issues
 */
export const REPO_WITH_OPEN_ISSUES: NostrEvent[] = [
  REPO_SIMPLE,
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,
]

/**
 * Collection: Complete scenario with issues and statuses
 */
export const COMPLETE_SCENARIO: NostrEvent[] = [
  REPO_SIMPLE,
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,
  STATUS_ISSUE_CLOSED,
]

/**
 * All fixtures organized by category
 */
export const FIXTURES = {
  // Individual repos
  REPO_SIMPLE,
  REPO_NOSTR_TOOLS,
  REPO_MULTI_MAINTAINER,

  // Individual issues
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,

  // Individual statuses
  STATUS_ISSUE_CLOSED,

  // Collections
  REPOS_ONLY,
  REPO_WITH_OPEN_ISSUES,
  COMPLETE_SCENARIO,

  // Test users
  PUBKEYS,
} as const
