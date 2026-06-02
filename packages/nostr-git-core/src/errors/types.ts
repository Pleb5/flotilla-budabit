/**
 * Git Error Taxonomy
 *
 * This module defines a structured error hierarchy for Git operations.
 * Errors are categorized to enable appropriate handling:
 * - USER_ACTIONABLE: Requires user intervention (auth, conflicts, etc.)
 * - RETRIABLE: Transient failures that can be retried
 * - FATAL: Permanent failures that cannot be recovered
 */

/**
 * Error category determines how the error should be handled.
 */
export enum GitErrorCategory {
  /**
   * User must take action to resolve (e.g., provide auth, resolve conflict).
   * These errors should NOT be retried automatically.
   */
  USER_ACTIONABLE = 'USER_ACTIONABLE',

  /**
   * Transient failures that may succeed on retry (e.g., network timeout).
   * These errors SHOULD be retried with backoff.
   */
  RETRIABLE = 'RETRIABLE',

  /**
   * Permanent failures that cannot be recovered (e.g., corrupt data).
   * These errors should NOT be retried (or retry once for FS issues).
   */
  FATAL = 'FATAL',
}

/**
 * Standard error codes for Git operations.
 */
export enum GitErrorCode {
  // USER_ACTIONABLE errors
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_INVALID = 'AUTH_INVALID',
  NOT_FAST_FORWARD = 'NOT_FAST_FORWARD',
  MERGE_CONFLICT = 'MERGE_CONFLICT',
  REPO_NOT_FOUND = 'REPO_NOT_FOUND',
  REPO_ALREADY_EXISTS = 'REPO_ALREADY_EXISTS',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  REF_LOCKED = 'REF_LOCKED',
  INVALID_REFSPEC = 'INVALID_REFSPEC',
  INVALID_INPUT = 'INVALID_INPUT',

  // RETRIABLE errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  RELAY_TIMEOUT = 'RELAY_TIMEOUT',
  RELAY_ERROR = 'RELAY_ERROR',
  GRASP_5XX = 'GRASP_5XX',
  TEMPORARY_FAILURE = 'TEMPORARY_FAILURE',
  RATE_LIMITED = 'RATE_LIMITED',

  // FATAL errors
  CORRUPT_PACK = 'CORRUPT_PACK',
  CORRUPT_OBJECT = 'CORRUPT_OBJECT',
  FS_ERROR = 'FS_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  OPERATION_ABORTED = 'OPERATION_ABORTED',
}

/**
 * Context information attached to errors.
 */
export interface GitErrorContext {
  /** Repository naddr (canonical internal key) */
  naddr?: string;
  /** Remote URL */
  remote?: string;
  /** Git ref (branch, tag, commit) */
  ref?: string;
  /** HTTP status code (if applicable) */
  statusCode?: number;
  /** Relay URL (for Nostr operations) */
  relay?: string;
  /** Operation that failed */
  operation?: string;
  /** Additional context */
  [key: string]: any;
}

/**
 * Base interface for all Git errors.
 */
export interface GitError extends Error {
  /** Error code for programmatic handling */
  code: GitErrorCode;
  /** Error category for retry/handling logic */
  category: GitErrorCategory;
  /** User-friendly hint for resolution */
  hint?: string;
  /** Structured context about the error */
  context?: GitErrorContext;
  /** Original error that caused this (if wrapped) */
  cause?: Error;
}

/**
 * Base class for Git errors with common functionality.
 */
abstract class BaseGitError extends Error implements GitError {
  public readonly code: GitErrorCode;
  public readonly category: GitErrorCategory;
  public readonly hint?: string;
  public readonly context?: GitErrorContext;
  public readonly cause?: Error;

  constructor(
    message: string,
    code: GitErrorCode,
    category: GitErrorCategory,
    options?: {
      hint?: string;
      context?: GitErrorContext;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.category = category;
    this.hint = options?.hint;
    this.context = options?.context;
    this.cause = options?.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/serialization.
   */
  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      hint: this.hint,
      context: this.context,
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
      } : undefined,
    };
  }
}

/**
 * Error requiring user action to resolve.
 * Should NOT be retried automatically.
 */
export class UserActionableError extends BaseGitError {
  constructor(
    message: string,
    code: GitErrorCode,
    options?: {
      hint?: string;
      context?: GitErrorContext;
      cause?: Error;
    }
  ) {
    super(message, code, GitErrorCategory.USER_ACTIONABLE, options);
  }
}

/**
 * Transient error that may succeed on retry.
 * Should be retried with exponential backoff.
 */
export class RetriableError extends BaseGitError {
  constructor(
    message: string,
    code: GitErrorCode,
    options?: {
      hint?: string;
      context?: GitErrorContext;
      cause?: Error;
    }
  ) {
    super(message, code, GitErrorCategory.RETRIABLE, options);
  }
}

/**
 * Permanent error that cannot be recovered.
 * Should NOT be retried (except once for FS issues).
 */
export class FatalError extends BaseGitError {
  constructor(
    message: string,
    code: GitErrorCode,
    options?: {
      hint?: string;
      context?: GitErrorContext;
      cause?: Error;
    }
  ) {
    super(message, code, GitErrorCategory.FATAL, options);
  }
}

/**
 * Type guard to check if an error is a GitError.
 */
export function isGitError(error: unknown): error is GitError {
  return (
    error instanceof Error &&
    'code' in error &&
    'category' in error &&
    typeof (error as any).code === 'string' &&
    typeof (error as any).category === 'string'
  );
}

/**
 * Type guard to check if an error is user-actionable.
 */
export function isUserActionableError(error: unknown): error is UserActionableError {
  return isGitError(error) && error.category === GitErrorCategory.USER_ACTIONABLE;
}

/**
 * Type guard to check if an error is retriable.
 */
export function isRetriableError(error: unknown): error is RetriableError {
  return isGitError(error) && error.category === GitErrorCategory.RETRIABLE;
}

/**
 * Type guard to check if an error is fatal.
 */
export function isFatalError(error: unknown): error is FatalError {
  return isGitError(error) && error.category === GitErrorCategory.FATAL;
}
