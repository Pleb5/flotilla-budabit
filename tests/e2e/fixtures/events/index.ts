/**
 * NIP-34 Git Event Fixtures for E2E Testing
 *
 * This module provides comprehensive fixtures for all NIP-34 git-related
 * Nostr events, including repository announcements, patches, issues,
 * status events, and NIP-32 labels.
 *
 * Usage:
 * ```typescript
 * import {
 *   createRepoAnnouncement,
 *   createPatch,
 *   createIssue,
 *   createStatusEvent,
 *   createLabel,
 *   TEST_PUBKEYS,
 *   FULL_REPO_ANNOUNCEMENT,
 * } from './fixtures/events';
 * ```
 */

// ============================================================================
// Repository Events (Kind 30617, 30618)
// ============================================================================
export {
  // Factory functions
  createRepoAnnouncement,
  createRepoState,
  getRepoAddress,

  // Types
  type UnsignedEvent,
  type RepoAnnouncementOptions,
  type RepoStateOptions,
  type RepoRef,

  // Pre-built fixtures
  MINIMAL_REPO_ANNOUNCEMENT,
  FULL_REPO_ANNOUNCEMENT,
  FORK_REPO_ANNOUNCEMENT,
  MINIMAL_REPO_STATE,
  SINGLE_BRANCH_REPO_STATE,
  FULL_REPO_STATE,
  REPO_STATE_WITH_ANCESTRY,
  TEST_REPO,

  // Test constants
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
} from './repo';

// ============================================================================
// Patch Events (Kind 1617, 1618, 1619)
// ============================================================================
export {
  // Factory functions
  createPatch,
  createPullRequest,
  createPullRequestUpdate,

  // Types
  type PatchOptions,
  type PullRequestOptions,
  type PullRequestUpdateOptions,
  type Committer,

  // Pre-built fixtures
  MINIMAL_PATCH,
  FULL_PATCH,
  STACKED_PATCH,
  SUPERSEDING_PATCH,
  MINIMAL_PULL_REQUEST,
  FULL_PULL_REQUEST,
  PULL_REQUEST_UPDATE,
  MINIMAL_PR_UPDATE,

  // Sample content
  SAMPLE_PATCH_CONTENT,
  SAMPLE_BUGFIX_PATCH,

  // Test constants
  TEST_EVENT_IDS,
} from './patch';

// ============================================================================
// Issue Events (Kind 1621)
// ============================================================================
export {
  // Factory function
  createIssue,

  // Types
  type IssueOptions,

  // Pre-built fixtures
  MINIMAL_ISSUE,
  BUG_REPORT_ISSUE,
  FEATURE_REQUEST_ISSUE,
  DOCS_ISSUE,
  ISSUE_WITH_REFERENCES,
  SECURITY_ISSUE,
  QUESTION_ISSUE,
  ASSIGNED_ISSUE,

  // Test constants
  TEST_ISSUE_IDS,
} from './issue';

// ============================================================================
// Status Events (Kind 1630-1633)
// ============================================================================
export {
  // Factory functions
  createStatusEvent,
  createOpenStatus,
  createAppliedStatus,
  createClosedStatus,
  createDraftStatus,

  // Types
  type StatusOptions,
  type StatusKind,

  // Constants
  STATUS_KINDS,

  // Pre-built fixtures
  ISSUE_OPEN_STATUS,
  PR_OPEN_STATUS,
  PR_MERGED_STATUS,
  PATCH_APPLIED_STATUS,
  ISSUE_RESOLVED_STATUS,
  ISSUE_WONTFIX_STATUS,
  PR_REJECTED_STATUS,
  PR_DRAFT_STATUS,
  PATCH_DRAFT_STATUS,
  ISSUE_REOPENED_STATUS,
  MINIMAL_STATUS,
  STATUS_LIFECYCLE,
} from './status';

// ============================================================================
// Label Events (Kind 1985 - NIP-32)
// ============================================================================
export {
  // Factory functions
  createLabel,
  createAssigneeLabel,
  createReviewerLabel,
  createReviewStatusLabel,
  createPriorityLabel,
  createTypeLabel,

  // Types
  type LabelOptions,
  type LabelTargets,
  type LabelDefinition,

  // Constants
  LABEL_KIND,
  LABEL_NAMESPACES,

  // Pre-built fixtures
  ISSUE_ASSIGNEE_LABEL,
  ISSUE_MULTI_ASSIGNEE_LABEL,
  PR_REVIEWER_LABEL,
  PR_MULTI_REVIEWER_LABEL,
  PR_APPROVED_LABEL,
  PR_CHANGES_REQUESTED_LABEL,
  CRITICAL_PRIORITY_LABEL,
  BUG_TYPE_LABEL,
  FEATURE_TYPE_LABEL,
  SECURITY_LABEL,
  REPO_LABEL,
  COMBINED_LABELS,
  MINIMAL_LABEL,
  BATCH_LABEL,
} from './labels';

// ============================================================================
// Event Kind Constants
// ============================================================================

/**
 * NIP-34 Git Event Kinds
 */
export const GIT_EVENT_KINDS = {
  // Repository events
  REPO_ANNOUNCEMENT: 30617,
  REPO_STATE: 30618,

  // Patch events
  PATCH: 1617,
  PULL_REQUEST: 1618,
  PULL_REQUEST_UPDATE: 1619,

  // Issue events
  ISSUE: 1621,

  // Status events
  STATUS_OPEN: 1630,
  STATUS_APPLIED: 1631,
  STATUS_CLOSED: 1632,
  STATUS_DRAFT: 1633,

  // Label events (NIP-32)
  LABEL: 1985,
} as const;

/**
 * Type for all git event kinds
 */
export type GitEventKind = typeof GIT_EVENT_KINDS[keyof typeof GIT_EVENT_KINDS];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random 64-character hex event ID for testing
 */
export function generateTestEventId(prefix = 'test'): string {
  const random = Math.random().toString(16).slice(2);
  return (prefix + random).padEnd(64, '0').slice(0, 64);
}

/**
 * Generate a random 40-character hex commit hash for testing
 */
export function generateTestCommitHash(prefix = ''): string {
  const random = Math.random().toString(16).slice(2);
  return (prefix + random).padEnd(40, '0').slice(0, 40);
}

/**
 * Create a timestamp offset from BASE_TIMESTAMP
 * @param offsetSeconds - Seconds to add to BASE_TIMESTAMP
 */
export function timestampOffset(offsetSeconds: number): number {
  return BASE_TIMESTAMP + offsetSeconds;
}

/**
 * Time constants for convenience
 */
export const TIME = {
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  WEEK: 604800,
  MONTH: 2592000,
} as const;
