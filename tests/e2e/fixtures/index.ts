/**
 * E2E Test Fixtures
 *
 * Centralized exports for all E2E test fixtures.
 * This module provides mock data and test utilities for end-to-end testing.
 *
 * @example
 * ```typescript
 * import {
 *   createRepoAnnouncement,
 *   createPatch,
 *   TEST_PUBKEYS,
 *   FULL_REPO_ANNOUNCEMENT,
 * } from './fixtures'
 * ```
 */

// Repository event fixtures (kind 30617, 30618)
export {
  // Test data
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  // Types
  type UnsignedEvent,
  type RepoAnnouncementOptions,
  type RepoRef,
  type RepoStateOptions,
  // Factory functions
  createRepoAnnouncement,
  createRepoState,
  getRepoAddress,
  // Pre-built fixtures
  MINIMAL_REPO_ANNOUNCEMENT,
  FULL_REPO_ANNOUNCEMENT,
  FORK_REPO_ANNOUNCEMENT,
  MINIMAL_REPO_STATE,
  SINGLE_BRANCH_REPO_STATE,
  FULL_REPO_STATE,
  REPO_STATE_WITH_ANCESTRY,
  TEST_REPO,
} from "./events/repo"

// Patch and Pull Request fixtures (kind 1617, 1618, 1619)
export {
  // Test data
  TEST_EVENT_IDS,
  // Types
  type Committer,
  type PatchOptions,
  type PullRequestOptions,
  type PullRequestUpdateOptions,
  // Factory functions
  createPatch,
  createPullRequest,
  createPullRequestUpdate,
  // Sample content
  SAMPLE_PATCH_CONTENT,
  SAMPLE_BUGFIX_PATCH,
  // Pre-built fixtures
  MINIMAL_PATCH,
  FULL_PATCH,
  STACKED_PATCH,
  SUPERSEDING_PATCH,
  MINIMAL_PULL_REQUEST,
  FULL_PULL_REQUEST,
  PULL_REQUEST_UPDATE,
  MINIMAL_PR_UPDATE,
} from "./events/patch"

// Issue fixtures (kind 1621)
export {
  // Test data
  TEST_ISSUE_IDS,
  // Types
  type IssueOptions,
  // Factory functions
  createIssue,
  // Pre-built fixtures
  MINIMAL_ISSUE,
  BUG_REPORT_ISSUE,
  FEATURE_REQUEST_ISSUE,
  DOCS_ISSUE,
  ISSUE_WITH_REFERENCES,
  SECURITY_ISSUE,
  QUESTION_ISSUE,
  ASSIGNED_ISSUE,
} from "./events/issue"

// Mock relay test scenarios (combined event collections)
export {
  // User pubkeys
  PUBKEYS,
  // Individual events
  REPO_SIMPLE,
  REPO_NOSTR_TOOLS,
  REPO_MULTI_MAINTAINER,
  ISSUE_BUG,
  ISSUE_FEATURE,
  ISSUE_BUG_REPLY,
  PATCH_BUG_FIX,
  PATCH_FEATURE,
  STATUS_ISSUE_CLOSED,
  STATUS_PATCH_MERGED,
  // Pre-built collections for MockRelay
  REPOS_ONLY,
  REPO_WITH_OPEN_ISSUES,
  REPO_WITH_ISSUES_AND_PATCHES,
  COMPLETE_SCENARIO,
  // All fixtures object
  FIXTURES,
} from "./test-events"
