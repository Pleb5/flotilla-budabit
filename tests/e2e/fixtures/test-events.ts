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
  createPatch,
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
 * Build the repo reference for linking issues/patches
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
// Patch Fixtures
// =============================================================================

/**
 * A patch fixing the bug
 */
export const PATCH_BUG_FIX = createPatch({
  pubkey: PUBKEYS.bob,
  title: "Fix null pointer exception on startup",
  diff: `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,9 @@ export function initialize() {
   const config = loadConfig();
-  const value = config.foo.bar;
+  const value = config?.foo?.bar ?? 'default';
   return value;
 }`,
  repoRef: repoRef(REPO_SIMPLE),
  commitId: "abc123def456",
  parentCommit: "111222333444",
})

/**
 * A patch adding a feature
 */
export const PATCH_FEATURE = createPatch({
  pubkey: PUBKEYS.charlie,
  title: "Add dark mode toggle to settings",
  diff: `diff --git a/src/settings.ts b/src/settings.ts
index 111222..333444 100644
--- a/src/settings.ts
+++ b/src/settings.ts
@@ -5,6 +5,7 @@ export interface Settings {
   language: string;
+  darkMode: boolean;
 }

@@ -12,6 +13,7 @@ export const defaultSettings: Settings = {
   language: 'en',
+  darkMode: false,
 };`,
  repoRef: repoRef(REPO_SIMPLE),
  commitId: "555666777888",
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

/**
 * Status marking the patch as applied/merged
 */
export const STATUS_PATCH_MERGED = createStatus({
  pubkey: PUBKEYS.alice,
  statusKind: 1631, // Applied/Merged
  targetId: PATCH_BUG_FIX.id,
  repoRef: repoRef(REPO_SIMPLE),
  content: "Merged! Thanks for the fix!",
})

// =============================================================================
// Composite Fixtures (ready-to-use collections)
// =============================================================================

/**
 * Collection: Just repositories (no issues or patches)
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
 * Collection: Repository with issues and patches
 */
export const REPO_WITH_ISSUES_AND_PATCHES: NostrEvent[] = [
  REPO_SIMPLE,
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,
  PATCH_BUG_FIX,
  PATCH_FEATURE,
]

/**
 * Collection: Complete scenario with closed issues and merged patches
 */
export const COMPLETE_SCENARIO: NostrEvent[] = [
  REPO_SIMPLE,
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,
  PATCH_BUG_FIX,
  PATCH_FEATURE,
  STATUS_ISSUE_CLOSED,
  STATUS_PATCH_MERGED,
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

  // Individual patches
  PATCH_BUG_FIX,
  PATCH_FEATURE,

  // Individual statuses
  STATUS_ISSUE_CLOSED,
  STATUS_PATCH_MERGED,

  // Collections
  REPOS_ONLY,
  REPO_WITH_OPEN_ISSUES,
  REPO_WITH_ISSUES_AND_PATCHES,
  COMPLETE_SCENARIO,

  // Test users
  PUBKEYS,
} as const
