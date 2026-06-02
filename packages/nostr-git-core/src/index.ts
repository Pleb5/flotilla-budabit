/**
 * Root package barrel for the single-package npm distribution.
 *
 * - Namespaced exports: import * as events from "nostr-git"; events.createPullRequestEvent(...)
 * - Convenience exports: import { createRepoAnnouncementEvent } from "nostr-git"
 */

export * as events from "./events/index.js"
export * as git from "./git/index.js"
export * as types from "./types/index.js"
export * as api from "./api/index.js"
export * as worker from "./worker/index.js"
export * as blossom from "./blossom/index.js"
export * as errors from "./errors/index.js"

// Convenience top-level exports
export {createRepoStateEvent, createRepoAnnouncementEvent} from "./events/index.js"
export {getGitProvider} from "./api/git-provider.js"
export {initializeNostrGitProvider} from "./api/git-provider.js"
export {getGitWorker, configureWorkerEventIO} from "./worker/client.js"
export * from "./utils/sanitize-relays.js"
export * from "./utils/clone-url-fallback.js"
export * from "./utils/repo-relay-policy.js"

// Git import convenience exports
export {
  type ImportConfig,
  DEFAULT_IMPORT_CONFIG,
  createImportConfig,
  ImportAbortController,
  ImportAbortedError,
  RateLimiter,
  type RateLimitConfig,
  type RateLimitStatus,
  parseRepoUrl,
  validateTokenPermissions,
  checkRepoOwnership,
  generatePlatformUserProfile,
  getProfileMapKey,
  convertRepoToNostrEvent,
  convertRepoToStateEvent,
  convertIssuesToNostrEvents,
  convertIssueStatusToEvent,
  convertCommentsToNostrEvents,
  convertPullRequestsToNostrEvents,
  signEvent,
  type UserProfileMap,
  type CommentEventMap,
  type ConvertedComment,
} from "./git/index.js"

export {getGitServiceApi, getGitServiceApiFromUrl} from "./git/provider-factory.js"
export {DEFAULT_RELAYS} from "./api/providers/nostr-git-factory.js"

// API type exports
export type {
  GitServiceApi,
  Issue as GitIssue,
  Comment as GitComment,
  PullRequest as GitPullRequest,
  RepoMetadata,
  ListCommentsOptions,
} from "./api/api.js"

// IO and event type exports
export type {EventIO, NostrEvent, NostrFilter, PublishResult} from "./types/io-types.js"
export type {RepoAnnouncementEvent, RepoStateEvent} from "./events/index.js"
