/**
 * NIP-34 Status Event Fixtures
 * Kind 1630: Open
 * Kind 1631: Applied/Merged
 * Kind 1632: Closed
 * Kind 1633: Draft
 */

import {
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  getRepoAddress,
  type UnsignedEvent,
} from './repo';
import { TEST_EVENT_IDS } from './patch';
import { TEST_ISSUE_IDS } from './issue';

/**
 * Status kind constants
 */
export const STATUS_KINDS = {
  OPEN: 1630,
  APPLIED: 1631,
  CLOSED: 1632,
  DRAFT: 1633,
} as const;

export type StatusKind = typeof STATUS_KINDS[keyof typeof STATUS_KINDS];

/**
 * Options for creating a Status event (kinds 1630-1633)
 */
export interface StatusOptions {
  /** Status kind - required */
  kind: StatusKind;
  /** Target event ID (e tag with "root" marker) - required */
  targetEventId: string;
  /** Optional status message/reason */
  content?: string;
  /** Reply to event ID (e tag with "reply" marker) */
  replyId?: string;
  /** Recipient pubkeys (original author, maintainers) */
  recipients?: string[];
  /** Repository address (a tag) */
  repoAddress?: string;
  /** Relay URL hint */
  relay?: string;
  /** Merge commit hash (for applied/merged status) */
  mergeCommit?: string;
  /** Applied as commits (for applied status on patches) */
  appliedAsCommits?: string[];
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates a Status event (kinds 1630-1633)
 *
 * NIP-34 status events indicate the state of issues, patches, and PRs:
 * - 1630: Open
 * - 1631: Applied/Merged/Resolved
 * - 1632: Closed (rejected/won't fix)
 * - 1633: Draft
 *
 * Required tags: e (root reference to target event)
 */
export function createStatusEvent(opts: StatusOptions): UnsignedEvent {
  const tags: string[][] = [
    ['e', opts.targetEventId, '', 'root'],
  ];

  if (opts.replyId) {
    tags.push(['e', opts.replyId, '', 'reply']);
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(['p', p]);
    }
  }

  if (opts.repoAddress) {
    tags.push(['a', opts.repoAddress]);
  }

  if (opts.relay) {
    tags.push(['r', opts.relay]);
  }

  if (opts.mergeCommit) {
    tags.push(['merge-commit', opts.mergeCommit]);
  }

  if (opts.appliedAsCommits && opts.appliedAsCommits.length > 0) {
    tags.push(['applied-as-commits', ...opts.appliedAsCommits]);
  }

  return {
    kind: opts.kind,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content ?? '',
    pubkey: opts.pubkey ?? TEST_PUBKEYS.alice,
  };
}

/**
 * Convenience function to create an Open status event (kind 1630)
 */
export function createOpenStatus(
  targetEventId: string,
  opts?: Omit<StatusOptions, 'kind' | 'targetEventId'>
): UnsignedEvent {
  return createStatusEvent({
    kind: STATUS_KINDS.OPEN,
    targetEventId,
    ...opts,
  });
}

/**
 * Convenience function to create an Applied/Merged status event (kind 1631)
 */
export function createAppliedStatus(
  targetEventId: string,
  opts?: Omit<StatusOptions, 'kind' | 'targetEventId'>
): UnsignedEvent {
  return createStatusEvent({
    kind: STATUS_KINDS.APPLIED,
    targetEventId,
    ...opts,
  });
}

/**
 * Convenience function to create a Closed status event (kind 1632)
 */
export function createClosedStatus(
  targetEventId: string,
  opts?: Omit<StatusOptions, 'kind' | 'targetEventId'>
): UnsignedEvent {
  return createStatusEvent({
    kind: STATUS_KINDS.CLOSED,
    targetEventId,
    ...opts,
  });
}

/**
 * Convenience function to create a Draft status event (kind 1633)
 */
export function createDraftStatus(
  targetEventId: string,
  opts?: Omit<StatusOptions, 'kind' | 'targetEventId'>
): UnsignedEvent {
  return createStatusEvent({
    kind: STATUS_KINDS.DRAFT,
    targetEventId,
    ...opts,
  });
}

// ============================================================================
// Pre-built Fixtures
// ============================================================================

const FLOTILLA_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit');

/**
 * Open status for an issue
 */
export const ISSUE_OPEN_STATUS = createOpenStatus(TEST_ISSUE_IDS.issue1, {
  content: 'Issue opened',
  recipients: [TEST_PUBKEYS.charlie],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP,
});

/**
 * Open status for a PR
 */
export const PR_OPEN_STATUS = createOpenStatus(TEST_EVENT_IDS.pr1, {
  content: 'Pull request opened for review',
  recipients: [TEST_PUBKEYS.bob, TEST_PUBKEYS.alice],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
});

/**
 * Applied/Merged status for a PR
 */
export const PR_MERGED_STATUS = createAppliedStatus(TEST_EVENT_IDS.pr1, {
  content: 'Merged! Thanks for the contribution.',
  recipients: [TEST_PUBKEYS.bob],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  mergeCommit: TEST_COMMITS.merge,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 86400,
});

/**
 * Applied status for a patch
 */
export const PATCH_APPLIED_STATUS = createAppliedStatus(TEST_EVENT_IDS.patch1, {
  content: 'Patch applied successfully',
  recipients: [TEST_PUBKEYS.bob],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  mergeCommit: TEST_COMMITS.feature,
  appliedAsCommits: [TEST_COMMITS.second, TEST_COMMITS.third],
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 86400,
});

/**
 * Closed status for an issue (resolved)
 */
export const ISSUE_RESOLVED_STATUS = createAppliedStatus(TEST_ISSUE_IDS.bugReport, {
  content: 'Fixed in commit ' + TEST_COMMITS.third.slice(0, 7),
  recipients: [TEST_PUBKEYS.charlie],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 172800,
});

/**
 * Closed status for an issue (won't fix)
 */
export const ISSUE_WONTFIX_STATUS = createClosedStatus(TEST_ISSUE_IDS.featureRequest, {
  content: 'Closing as out of scope for this project.',
  recipients: [TEST_PUBKEYS.bob],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 259200,
});

/**
 * Closed status for a PR (rejected)
 */
export const PR_REJECTED_STATUS = createClosedStatus(TEST_EVENT_IDS.pr2, {
  content: 'Closing - this approach conflicts with the project architecture. Please see discussion for alternative suggestions.',
  recipients: [TEST_PUBKEYS.charlie],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.maintainer,
  created_at: BASE_TIMESTAMP + 345600,
});

/**
 * Draft status for a PR
 */
export const PR_DRAFT_STATUS = createDraftStatus(TEST_EVENT_IDS.pr1, {
  content: 'Converting to draft - need to address review feedback',
  recipients: [TEST_PUBKEYS.alice],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 43200,
});

/**
 * Draft status for a patch
 */
export const PATCH_DRAFT_STATUS = createDraftStatus(TEST_EVENT_IDS.patch1, {
  content: 'Work in progress',
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
});

/**
 * Status with reply chain (re-opening after close)
 */
export const ISSUE_REOPENED_STATUS = createOpenStatus(TEST_ISSUE_IDS.issue1, {
  content: 'Reopening - issue still persists in latest version',
  replyId: ISSUE_WONTFIX_STATUS.tags.find(t => t[0] === 'e')?.[1] ?? '',
  recipients: [TEST_PUBKEYS.alice],
  repoAddress: FLOTILLA_REPO_ADDRESS,
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP + 432000,
});

/**
 * Minimal status event
 */
export const MINIMAL_STATUS = createStatusEvent({
  kind: STATUS_KINDS.OPEN,
  targetEventId: TEST_ISSUE_IDS.issue1,
});

/**
 * Status lifecycle for testing state transitions
 */
export const STATUS_LIFECYCLE = {
  /** Initial open state */
  opened: createOpenStatus(TEST_EVENT_IDS.pr1, {
    content: 'PR opened',
    repoAddress: FLOTILLA_REPO_ADDRESS,
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP,
  }),
  /** Converted to draft */
  draft: createDraftStatus(TEST_EVENT_IDS.pr1, {
    content: 'Converting to draft for more work',
    repoAddress: FLOTILLA_REPO_ADDRESS,
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP + 3600,
  }),
  /** Ready for review again */
  readyForReview: createOpenStatus(TEST_EVENT_IDS.pr1, {
    content: 'Ready for review',
    repoAddress: FLOTILLA_REPO_ADDRESS,
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP + 7200,
  }),
  /** Merged */
  merged: createAppliedStatus(TEST_EVENT_IDS.pr1, {
    content: 'LGTM, merging!',
    repoAddress: FLOTILLA_REPO_ADDRESS,
    mergeCommit: TEST_COMMITS.merge,
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP + 86400,
  }),
};

// Re-export for convenience
export { TEST_PUBKEYS, TEST_COMMITS, BASE_TIMESTAMP, getRepoAddress };
export { TEST_EVENT_IDS } from './patch';
export { TEST_ISSUE_IDS } from './issue';
