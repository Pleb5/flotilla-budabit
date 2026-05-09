/**
 * NIP-34 Pull Request Event Fixtures
 * Kind 1618: Pull Request
 * Kind 1619: Pull Request Update
 */

import {
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  getRepoAddress,
  type UnsignedEvent,
} from "./repo"

// Test event IDs (64-char hex strings)
export const TEST_EVENT_IDS = {
  pr1: "e3".padEnd(64, "0"),
  pr2: "e4".padEnd(64, "0"),
  prUpdate1: "e5".padEnd(64, "0"),
} as const

/**
 * Options for creating a Pull Request event (kind 1618)
 */
export interface PullRequestOptions {
  /** PR description/body */
  content: string
  /** Repository address (a tag) - required */
  repoAddress: string
  /** Subject/title of the PR */
  subject?: string
  /** Recipient pubkeys (maintainers to review) */
  recipients?: string[]
  /** Labels/hashtags */
  labels?: string[]
  /** Tip commit hash for the PR source branch */
  tipCommitOid: string
  /** Clone URLs for the source repo/branch */
  clone?: string[]
  /** Branch name for the PR */
  branchName?: string
  /** Merge base commit */
  mergeBase?: string
  /** Earliest unique commit (r tag) */
  earliestUniqueCommit?: string
  /** Event pubkey (author) */
  pubkey?: string
  /** Event timestamp (seconds) */
  created_at?: number
}

/**
 * Creates a Pull Request event (kind 1618)
 *
 * NIP-34 specifies this event proposes merging changes.
 * Required tags: a (repo reference)
 */
export function createPullRequest(opts: PullRequestOptions): UnsignedEvent {
  const tags: string[][] = [["a", opts.repoAddress]]

  if (opts.earliestUniqueCommit) {
    tags.push(["r", opts.earliestUniqueCommit])
  }

  if (opts.subject) {
    tags.push(["subject", opts.subject])
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(["p", p])
    }
  }

  if (opts.labels) {
    for (const label of opts.labels) {
      tags.push(["t", label])
    }
  }

  tags.push(["c", opts.tipCommitOid])

  if (opts.clone && opts.clone.length > 0) {
    tags.push(["clone", ...opts.clone])
  }

  if (opts.branchName) {
    tags.push(["branch-name", opts.branchName])
  }

  if (opts.mergeBase) {
    tags.push(["merge-base", opts.mergeBase])
  }

  return {
    kind: 1618,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content,
    pubkey: opts.pubkey ?? TEST_PUBKEYS.bob,
  }
}

/**
 * Options for creating a Pull Request Update event (kind 1619)
 */
export interface PullRequestUpdateOptions {
  /** Repository address (a tag) - required */
  repoAddress: string
  /** Reference to original PR event (e tag) */
  prEventId?: string
  /** Updated tip commit hash */
  tipCommitOid: string
  /** Clone URLs */
  clone?: string[]
  /** Updated merge base commit */
  mergeBase?: string
  /** Recipient pubkeys */
  recipients?: string[]
  /** Update message/description */
  content?: string
  /** Event pubkey (author) */
  pubkey?: string
  /** Event timestamp (seconds) */
  created_at?: number
}

/**
 * Creates a Pull Request Update event (kind 1619)
 *
 * NIP-34 specifies this event updates an existing PR with new commits.
 */
export function createPullRequestUpdate(opts: PullRequestUpdateOptions): UnsignedEvent {
  const tags: string[][] = [["a", opts.repoAddress]]

  if (opts.prEventId) {
    tags.push(["e", opts.prEventId, "", "root"])
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(["p", p])
    }
  }

  tags.push(["c", opts.tipCommitOid])

  if (opts.clone && opts.clone.length > 0) {
    tags.push(["clone", ...opts.clone])
  }

  if (opts.mergeBase) {
    tags.push(["merge-base", opts.mergeBase])
  }

  return {
    kind: 1619,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content ?? "",
    pubkey: opts.pubkey ?? TEST_PUBKEYS.bob,
  }
}

// ============================================================================
// Sample Diff Content
// ============================================================================

/**
 * Sample git diff content for testing pull request bodies
 */
export const SAMPLE_PATCH_CONTENT = `From ${TEST_COMMITS.second} Mon Sep 17 00:00:00 2001
From: Bob <bob@example.com>
Date: Mon, 15 Jan 2024 12:00:00 +0000
Subject: [PATCH] Add new feature

This patch adds a new feature to the project.

---
 src/feature.ts | 10 ++++++++++
 1 file changed, 10 insertions(+)
 create mode 100644 src/feature.ts

diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,10 @@
+export function newFeature(): string {
+  return 'Hello, World!';
+}
+
+export function anotherFunction(): number {
+  return 42;
+}
+
+// This is a new feature
+export default newFeature;
--
2.34.1
`

/**
 * Sample bug fix diff content
 */
export const SAMPLE_BUGFIX_PATCH = `From ${TEST_COMMITS.third} Mon Sep 17 00:00:00 2001
From: Charlie <charlie@example.com>
Date: Mon, 15 Jan 2024 13:00:00 +0000
Subject: [PATCH] Fix null pointer exception

Fixes a bug where null values caused crashes.

---
 src/utils.ts | 4 +++-
 1 file changed, 3 insertions(+), 1 deletion(-)

diff --git a/src/utils.ts b/src/utils.ts
index abcdef0..1234567 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,7 @@
 export function processValue(value: unknown): string {
-  return value.toString();
+  if (value === null || value === undefined) {
+    return '';
+  }
+  return String(value);
 }
--
2.34.1
`

// ============================================================================
// Pre-built Fixtures
// ============================================================================

const DEFAULT_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, "test-repo")

/**
 * Minimal pull request
 */
export const MINIMAL_PULL_REQUEST = createPullRequest({
  content: "This PR adds a new feature.",
  repoAddress: DEFAULT_REPO_ADDRESS,
  tipCommitOid: TEST_COMMITS.feature,
})

/**
 * Full pull request with all fields
 */
export const FULL_PULL_REQUEST = createPullRequest({
  content: `## Summary
This pull request adds NIP-34 support to the project.

## Changes
- Add repository announcement handling
- Add pull request event parsing
- Add status event support

## Testing
- [x] Unit tests pass
- [x] E2E tests pass
- [x] Manual testing complete`,
  repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "flotilla-budabit"),
  subject: "Add NIP-34 git collaboration support",
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  labels: ["enhancement", "nip-34", "ready-for-review"],
  tipCommitOid: TEST_COMMITS.third,
  clone: ["https://github.com/bob/flotilla-budabit.git"],
  branchName: "feature/nip34-support",
  mergeBase: TEST_COMMITS.initial,
  earliestUniqueCommit: TEST_COMMITS.initial,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
})

/**
 * Pull request update (force push / new commits)
 */
export const PULL_REQUEST_UPDATE = createPullRequestUpdate({
  repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "flotilla-budabit"),
  prEventId: TEST_EVENT_IDS.pr1,
  tipCommitOid: TEST_COMMITS.feature,
  clone: ["https://github.com/bob/flotilla-budabit.git"],
  mergeBase: TEST_COMMITS.initial,
  recipients: [TEST_PUBKEYS.alice],
  content: "Added requested changes and rebased on latest main",
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 86400,
})

/**
 * Minimal pull request update
 */
export const MINIMAL_PR_UPDATE = createPullRequestUpdate({
  repoAddress: DEFAULT_REPO_ADDRESS,
  tipCommitOid: TEST_COMMITS.feature,
})

// Re-export for convenience
export {TEST_PUBKEYS, TEST_COMMITS, BASE_TIMESTAMP, getRepoAddress}
