/**
 * E2E Test Helpers
 *
 * Centralized exports for all E2E test helper functions.
 * Import from this file for convenient access to all helpers.
 *
 * These helpers provide standalone utility functions for common test operations.
 * For a more object-oriented approach, use the Page Objects in ../pages/
 *
 * @example
 * ```typescript
 * // Standalone helpers approach
 * import {
 *   login,
 *   loginAndAssertIdentity,
 *   navigateToGitHub,
 *   getRepoCards,
 *   STORAGE_STATE,
 * } from "./helpers"
 *
 * // Page Object approach (recommended for complex tests)
 * import { GitHubPage, RepoDetailPage } from "./pages"
 * ```
 */

// Authentication helpers
export {
  login,
  loginAndAssertIdentity,
  PHASE_A_LOGIN_SCREEN,
  PHASE_B_LOGIN_SUBMIT,
  PHASE_C_IDENTITY_VISIBLE,
  type LoginPhaseHooks,
  type LoginStrategy,
} from "./auth"

// Git navigation and interaction helpers
export {
  // URL encoding
  encodeRelay,
  // Navigation
  navigateToGitHub,
  navigateToRepoList,
  navigateToRepo,
  navigateToRepoTab,
  // Loading states
  waitForGitLoad,
  waitForGitWorker,
  waitForGitLoadComplete,
  isGitLoading,
  // Repository cards
  getRepoCards,
  getRepoCardByName,
  getRepoName,
  getRepoDescription,
  clickRepoCard,
  waitForRepoList,
  // UI interactions
  openNewRepoWizard,
  switchGitTab,
  searchRepos,
  clearRepoSearch,
  // Assertions
  getGitPageTitle,
  assertGitPageLoaded,
} from "./git"

// Re-export storage state path for tests that need authenticated state
export {STORAGE_STATE} from "../auth.setup"

// Mock relay for intercepting Nostr connections
export {
  // Core class
  MockRelay,
  // Types
  type NostrEvent,
  type NostrFilter,
  type MockRelayOptions,
  // NIP-34 event kinds
  NIP34_KINDS,
  // Event creation helpers
  createEvent,
  createRepoAnnouncement,
  createIssue,
  createIssueReply,
  createPatch,
  createStatus,
  // Utility functions
  randomHex,
  nowSeconds,
  // Scenario builder
  TestScenarioBuilder,
  scenario,
  // Pre-built fixtures
  TEST_USERS,
  createTestRepo,
  createFullTestScenario,
  // Option types
  type RepoAnnouncementOptions,
  type IssueOptions,
  type IssueReplyOptions,
  type PatchOptions,
  type StatusOptions,
} from "./mock-relay"

// Event assertion helpers for NIP-34 events
export {
  // Kind constants
  KIND_REPO_ANNOUNCEMENT,
  KIND_REPO_STATE,
  KIND_PATCH,
  KIND_ISSUE,
  KIND_PULL_REQUEST,
  KIND_STATUS_OPEN,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_DRAFT,
  KIND_LABEL,
  STATUS_KINDS,
  // Tag helpers
  getTagValue,
  getTagValues,
  getTag,
  getTags,
  hasTag,
  // Basic assertions
  assertValidEvent,
  assertEventKind,
  assertHasTag,
  assertRepoReference,
  assertEventReference,
  assertDTag,
  // NIP-34 specific assertions
  assertValidRepoAnnouncement,
  assertValidRepoState,
  assertValidPatch,
  assertValidIssue,
  assertValidStatusEvent,
  assertValidLabel,
  // Composite assertions
  assertStatusReferencesIssue,
  assertStatusReferencesPatch,
  assertReferencesRepo,
  assertLabelTargetsEvent,
} from "./event-assertions"

// Test data seeding helpers
export {
  // Main seeding class
  TestSeeder,
  // Convenience functions
  seedTestRepo,
  seedTestScenario,
  seedMultipleRepos,
  // Types
  type SeedRepoOptions,
  type SeedIssueOptions,
  type SeedPatchOptions,
  type SeedRepoResult,
  type SeedIssueResult,
  type SeedPatchResult,
  type TestSeederOptions,
  type TestScenario,
} from "./seed"

// Test isolation utilities
export {
  // Storage and cookie clearing
  clearBrowserStorage,
  clearCookies,
  // Mock relay utilities
  resetMockRelay,
  createFreshMockRelay,
  // Test ID generation
  generateTestId,
  // Clean state hooks
  useCleanState,
  // Isolated context creation
  createIsolatedContext,
  useIsolatedContext,
  // Isolated seeder
  IsolatedSeeder,
  createIsolatedSeeder,
  // Playwright fixture
  testIsolationFixture,
  // Types
  type IsolatedTestContext,
  type TestIsolationConfig,
} from "./test-isolation"
