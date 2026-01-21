/**
 * NIP-34 Patch Event Fixtures
 * Kind 1617: Patch Event
 * Kind 1618: Pull Request
 * Kind 1619: Pull Request Update
 */

import {
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  getRepoAddress,
  type UnsignedEvent,
} from './repo';

// Test event IDs (64-char hex strings)
export const TEST_EVENT_IDS = {
  patch1: 'e1'.padEnd(64, '0'),
  patch2: 'e2'.padEnd(64, '0'),
  pr1: 'e3'.padEnd(64, '0'),
  pr2: 'e4'.padEnd(64, '0'),
  prUpdate1: 'e5'.padEnd(64, '0'),
} as const;

/**
 * Committer information for patch events
 */
export interface Committer {
  name: string;
  email: string;
  timestamp: string;
  tzOffset: string;
}

/**
 * Options for creating a Patch event (kind 1617)
 */
export interface PatchOptions {
  /** Git format-patch content (diff) - required */
  content: string;
  /** Repository address (a tag) - required */
  repoAddress: string;
  /** Commit hash this patch creates */
  commit?: string;
  /** Parent commit hash */
  parentCommit?: string;
  /** Earliest unique commit (r tag) */
  earliestUniqueCommit?: string;
  /** Committer information */
  committer?: Committer;
  /** PGP signature for commit */
  pgpSig?: string;
  /** Recipient pubkeys (p tags) */
  recipients?: string[];
  /** Subject/title of the patch */
  subject?: string;
  /** Labels/hashtags */
  labels?: string[];
  /** Stack identifier (for stacked patches) */
  stack?: string;
  /** Dependencies (other patch event IDs) */
  depends?: string[];
  /** Revision number */
  revision?: string;
  /** Event ID this supersedes */
  supersedes?: string;
  /** In-reply-to (for patch series) */
  inReplyTo?: string;
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
  /** Whether this is a root patch (first in a series). Defaults to true */
  isRoot?: boolean;
}

/**
 * Creates a Patch event (kind 1617)
 *
 * NIP-34 specifies this event contains git patch content.
 * Required tags: a (repo reference)
 * Content: git format-patch output
 */
export function createPatch(opts: PatchOptions): UnsignedEvent {
  const tags: string[][] = [
    ['a', opts.repoAddress],
  ];

  if (opts.earliestUniqueCommit) {
    tags.push(['r', opts.earliestUniqueCommit]);
  }

  if (opts.commit) {
    tags.push(['commit', opts.commit]);
  }

  if (opts.parentCommit) {
    tags.push(['parent-commit', opts.parentCommit]);
  }

  if (opts.committer) {
    tags.push([
      'committer',
      opts.committer.name,
      opts.committer.email,
      opts.committer.timestamp,
      opts.committer.tzOffset,
    ]);
  }

  if (opts.pgpSig) {
    tags.push(['commit-pgp-sig', opts.pgpSig]);
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(['p', p]);
    }
  }

  if (opts.subject) {
    tags.push(['subject', opts.subject]);
  }

  if (opts.labels) {
    for (const label of opts.labels) {
      tags.push(['t', label]);
    }
  }

  if (opts.stack) {
    tags.push(['stack', opts.stack]);
  }

  if (opts.depends) {
    for (const dep of opts.depends) {
      tags.push(['depends', dep]);
    }
  }

  if (opts.revision) {
    tags.push(['rev', opts.revision]);
  }

  if (opts.supersedes) {
    tags.push(['supersedes', opts.supersedes]);
  }

  if (opts.inReplyTo) {
    tags.push(['in-reply-to', opts.inReplyTo]);
  }

  // Add 'root' tag for root patches (default to true unless explicitly set to false)
  // This is required by the patches page which filters for root patches only
  if (opts.isRoot !== false) {
    tags.push(['t', 'root']);
  }

  return {
    kind: 1617,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content,
    pubkey: opts.pubkey ?? TEST_PUBKEYS.bob,
  };
}

/**
 * Options for creating a Pull Request event (kind 1618)
 */
export interface PullRequestOptions {
  /** PR description/body */
  content: string;
  /** Repository address (a tag) - required */
  repoAddress: string;
  /** Subject/title of the PR */
  subject?: string;
  /** Recipient pubkeys (maintainers to review) */
  recipients?: string[];
  /** Labels/hashtags */
  labels?: string[];
  /** Commit hashes included in PR */
  commits?: string[];
  /** Clone URLs for the source repo/branch */
  clone?: string[];
  /** Branch name for the PR */
  branchName?: string;
  /** Merge base commit */
  mergeBase?: string;
  /** Earliest unique commit (r tag) */
  earliestUniqueCommit?: string;
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Pull Request event (kind 1618)
 *
 * NIP-34 specifies this event proposes merging changes.
 * Required tags: a (repo reference)
 */
export function createPullRequest(opts: PullRequestOptions): UnsignedEvent {
  const tags: string[][] = [
    ['a', opts.repoAddress],
  ];

  if (opts.earliestUniqueCommit) {
    tags.push(['r', opts.earliestUniqueCommit]);
  }

  if (opts.subject) {
    tags.push(['subject', opts.subject]);
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(['p', p]);
    }
  }

  if (opts.labels) {
    for (const label of opts.labels) {
      tags.push(['t', label]);
    }
  }

  if (opts.commits) {
    for (const c of opts.commits) {
      tags.push(['c', c]);
    }
  }

  if (opts.clone && opts.clone.length > 0) {
    tags.push(['clone', ...opts.clone]);
  }

  if (opts.branchName) {
    tags.push(['branch-name', opts.branchName]);
  }

  if (opts.mergeBase) {
    tags.push(['merge-base', opts.mergeBase]);
  }

  return {
    kind: 1618,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content,
    pubkey: opts.pubkey ?? TEST_PUBKEYS.bob,
  };
}

/**
 * Options for creating a Pull Request Update event (kind 1619)
 */
export interface PullRequestUpdateOptions {
  /** Repository address (a tag) - required */
  repoAddress: string;
  /** Reference to original PR event (e tag) */
  prEventId?: string;
  /** Updated commit hashes */
  commits?: string[];
  /** Clone URLs */
  clone?: string[];
  /** Updated merge base commit */
  mergeBase?: string;
  /** Recipient pubkeys */
  recipients?: string[];
  /** Update message/description */
  content?: string;
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Pull Request Update event (kind 1619)
 *
 * NIP-34 specifies this event updates an existing PR with new commits.
 */
export function createPullRequestUpdate(opts: PullRequestUpdateOptions): UnsignedEvent {
  const tags: string[][] = [
    ['a', opts.repoAddress],
  ];

  if (opts.prEventId) {
    tags.push(['e', opts.prEventId, '', 'root']);
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(['p', p]);
    }
  }

  if (opts.commits) {
    for (const c of opts.commits) {
      tags.push(['c', c]);
    }
  }

  if (opts.clone && opts.clone.length > 0) {
    tags.push(['clone', ...opts.clone]);
  }

  if (opts.mergeBase) {
    tags.push(['merge-base', opts.mergeBase]);
  }

  return {
    kind: 1619,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content ?? '',
    pubkey: opts.pubkey ?? TEST_PUBKEYS.bob,
  };
}

// ============================================================================
// Sample Diff Content
// ============================================================================

/**
 * Sample git format-patch content for testing
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
`;

/**
 * Sample bug fix patch content
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
`;

// ============================================================================
// Pre-built Fixtures
// ============================================================================

const DEFAULT_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, 'test-repo');

/**
 * Minimal patch with required fields only
 */
export const MINIMAL_PATCH = createPatch({
  content: SAMPLE_PATCH_CONTENT,
  repoAddress: DEFAULT_REPO_ADDRESS,
});

/**
 * Full patch with all optional fields
 */
export const FULL_PATCH = createPatch({
  content: SAMPLE_PATCH_CONTENT,
  repoAddress: getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit'),
  commit: TEST_COMMITS.second,
  parentCommit: TEST_COMMITS.initial,
  earliestUniqueCommit: TEST_COMMITS.initial,
  committer: {
    name: 'Bob Developer',
    email: 'bob@example.com',
    timestamp: String(BASE_TIMESTAMP),
    tzOffset: '+0000',
  },
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  subject: 'Add new feature for NIP-34 support',
  labels: ['enhancement', 'nip-34'],
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
});

/**
 * Patch in a stack (stacked patches workflow)
 */
export const STACKED_PATCH = createPatch({
  content: SAMPLE_BUGFIX_PATCH,
  repoAddress: DEFAULT_REPO_ADDRESS,
  commit: TEST_COMMITS.third,
  parentCommit: TEST_COMMITS.second,
  stack: 'feature-branch',
  depends: [TEST_EVENT_IDS.patch1],
  revision: '2',
  subject: 'Part 2: Fix edge cases',
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 3600,
});

/**
 * Superseding patch (replaces a previous version)
 */
export const SUPERSEDING_PATCH = createPatch({
  content: SAMPLE_PATCH_CONTENT,
  repoAddress: DEFAULT_REPO_ADDRESS,
  commit: TEST_COMMITS.feature,
  parentCommit: TEST_COMMITS.initial,
  supersedes: TEST_EVENT_IDS.patch1,
  revision: '2',
  subject: 'Add new feature (v2)',
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 7200,
});

/**
 * Minimal pull request
 */
export const MINIMAL_PULL_REQUEST = createPullRequest({
  content: 'This PR adds a new feature.',
  repoAddress: DEFAULT_REPO_ADDRESS,
});

/**
 * Full pull request with all fields
 */
export const FULL_PULL_REQUEST = createPullRequest({
  content: `## Summary
This pull request adds NIP-34 support to the project.

## Changes
- Add repository announcement handling
- Add patch event parsing
- Add status event support

## Testing
- [x] Unit tests pass
- [x] E2E tests pass
- [x] Manual testing complete`,
  repoAddress: getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit'),
  subject: 'Add NIP-34 git collaboration support',
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  labels: ['enhancement', 'nip-34', 'ready-for-review'],
  commits: [TEST_COMMITS.second, TEST_COMMITS.third],
  clone: ['https://github.com/bob/flotilla-budabit.git'],
  branchName: 'feature/nip34-support',
  mergeBase: TEST_COMMITS.initial,
  earliestUniqueCommit: TEST_COMMITS.initial,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
});

/**
 * Pull request update (force push / new commits)
 */
export const PULL_REQUEST_UPDATE = createPullRequestUpdate({
  repoAddress: getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit'),
  prEventId: TEST_EVENT_IDS.pr1,
  commits: [TEST_COMMITS.second, TEST_COMMITS.third, TEST_COMMITS.feature],
  clone: ['https://github.com/bob/flotilla-budabit.git'],
  mergeBase: TEST_COMMITS.initial,
  recipients: [TEST_PUBKEYS.alice],
  content: 'Added requested changes and rebased on latest main',
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 86400,
});

/**
 * Minimal pull request update
 */
export const MINIMAL_PR_UPDATE = createPullRequestUpdate({
  repoAddress: DEFAULT_REPO_ADDRESS,
  commits: [TEST_COMMITS.feature],
});

// Re-export for convenience
export { TEST_PUBKEYS, TEST_COMMITS, BASE_TIMESTAMP, getRepoAddress };
