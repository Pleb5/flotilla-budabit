/**
 * E2E Test Helpers
 *
 * Centralized exports for all E2E test helper functions.
 * Import from this file for convenient access to all helpers.
 *
 * These helpers provide standalone utility functions for common test operations.
 *
 * @example
 * ```typescript
 * import {
 *   login,
 *   loginAndAssertIdentity,
 *   STORAGE_STATE,
 * } from "./helpers"
 *
 * // Shared helpers are grouped here for smoke, identity, and widget tests.
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

// Storage state path for tests that need authenticated state
// Must match playwright.config.ts and auth.setup.ts
export const STORAGE_STATE = "./test-results/.auth/user.json"

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
  type StatusOptions,
} from "./mock-relay"

// Event assertion helpers for NIP-34 events
export {
  // Kind constants
  KIND_REPO_ANNOUNCEMENT,
  KIND_REPO_STATE,
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
  assertValidIssue,
  assertValidStatusEvent,
  assertValidLabel,
  // Composite assertions
  assertStatusReferencesIssue,
  assertReferencesRepo,
  assertLabelTargetsEvent,
} from "./event-assertions"

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
  // Types
  type IsolatedTestContext,
  type TestIsolationConfig,
} from "./test-isolation"
