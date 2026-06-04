/**
 * Tests for error factory functions.
 */

import { describe, it, expect } from 'vitest';
import {
  createAuthRequiredError,
  createAuthExpiredError,
  createAuthInvalidError,
  createNotFastForwardError,
  createMergeConflictError,
  createRepoNotFoundError,
  createRepoAlreadyExistsError,
  createQuotaExceededError,
  createPermissionDeniedError,
  createRefLockedError,
  createInvalidRefspecError,
  createInvalidInputError,
  createNetworkError,
  createTimeoutError,
  createRelayTimeoutError,
  createRelayError,
  createGrasp5xxError,
  createTemporaryFailureError,
  createRateLimitedError,
  createCorruptPackError,
  createCorruptObjectError,
  createFsError,
  createOperationAbortedError,
  createUnknownError,
  wrapError,
} from '../../src/errors/factory.js';
import {
  GitErrorCode,
  GitErrorCategory,
  isUserActionableError,
  isRetriableError,
  isFatalError,
} from '../../src/errors/types.js';

describe('Error Factory', () => {
  describe('User Actionable Errors', () => {
    it('should create auth required error', () => {
      const error = createAuthRequiredError({ naddr: 'test-naddr' });
      
      expect(error.code).toBe(GitErrorCode.AUTH_REQUIRED);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('Authentication required');
      expect(error.hint).toContain('credentials');
      expect(error.context?.naddr).toBe('test-naddr');
      expect(isUserActionableError(error)).toBe(true);
    });

    it('should create auth expired error', () => {
      const error = createAuthExpiredError();
      
      expect(error.code).toBe(GitErrorCode.AUTH_EXPIRED);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('expired');
    });

    it('should create auth invalid error', () => {
      const error = createAuthInvalidError();
      
      expect(error.code).toBe(GitErrorCode.AUTH_INVALID);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('invalid');
    });

    it('should create not fast-forward error', () => {
      const error = createNotFastForwardError({ ref: 'main' });
      
      expect(error.code).toBe(GitErrorCode.NOT_FAST_FORWARD);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('not a fast-forward');
      expect(error.hint).toContain('Pull');
      expect(error.context?.ref).toBe('main');
    });

    it('should create merge conflict error', () => {
      const error = createMergeConflictError();
      
      expect(error.code).toBe(GitErrorCode.MERGE_CONFLICT);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('conflict');
      expect(error.hint).toContain('Resolve conflicts');
    });

    it('should create repo not found error', () => {
      const error = createRepoNotFoundError({ naddr: 'missing-repo' });
      
      expect(error.code).toBe(GitErrorCode.REPO_NOT_FOUND);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('not found');
      expect(error.context?.naddr).toBe('missing-repo');
    });

    it('should create repo already exists error', () => {
      const error = createRepoAlreadyExistsError();
      
      expect(error.code).toBe(GitErrorCode.REPO_ALREADY_EXISTS);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('already exists');
    });

    it('should create quota exceeded error', () => {
      const error = createQuotaExceededError();
      
      expect(error.code).toBe(GitErrorCode.QUOTA_EXCEEDED);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('quota');
      expect(error.hint).toContain('Free up space');
    });

    it('should create permission denied error', () => {
      const error = createPermissionDeniedError();
      
      expect(error.code).toBe(GitErrorCode.PERMISSION_DENIED);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('Permission denied');
    });

    it('should create ref locked error', () => {
      const error = createRefLockedError({ ref: 'main' });
      
      expect(error.code).toBe(GitErrorCode.REF_LOCKED);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('locked');
      expect(error.context?.ref).toBe('main');
    });

    it('should create invalid refspec error', () => {
      const error = createInvalidRefspecError();
      
      expect(error.code).toBe(GitErrorCode.INVALID_REFSPEC);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toContain('Invalid refspec');
    });

    it('should create invalid input error with custom message', () => {
      const error = createInvalidInputError('Custom validation failed');
      
      expect(error.code).toBe(GitErrorCode.INVALID_INPUT);
      expect(error.category).toBe(GitErrorCategory.USER_ACTIONABLE);
      expect(error.message).toBe('Custom validation failed');
    });
  });

  describe('Retriable Errors', () => {
    it('should create network error', () => {
      const error = createNetworkError({ remote: 'https://example.com' });
      
      expect(error.code).toBe(GitErrorCode.NETWORK_ERROR);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('Network error');
      expect(error.context?.remote).toBe('https://example.com');
      expect(isRetriableError(error)).toBe(true);
    });

    it('should create timeout error', () => {
      const error = createTimeoutError();
      
      expect(error.code).toBe(GitErrorCode.TIMEOUT);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('timed out');
    });

    it('should create relay timeout error', () => {
      const error = createRelayTimeoutError({ relay: 'wss://relay.example.com' });
      
      expect(error.code).toBe(GitErrorCode.RELAY_TIMEOUT);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('Relay');
      expect(error.context?.relay).toBe('wss://relay.example.com');
    });

    it('should create relay error', () => {
      const error = createRelayError();
      
      expect(error.code).toBe(GitErrorCode.RELAY_ERROR);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('Relay error');
    });

    it('should create GRASP 5xx error', () => {
      const error = createGrasp5xxError({ statusCode: 503 });
      
      expect(error.code).toBe(GitErrorCode.GRASP_5XX);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('5xx');
      expect(error.context?.statusCode).toBe(503);
    });

    it('should create temporary failure error with custom message', () => {
      const error = createTemporaryFailureError('Service temporarily unavailable');
      
      expect(error.code).toBe(GitErrorCode.TEMPORARY_FAILURE);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toBe('Service temporarily unavailable');
    });

    it('should create rate limited error', () => {
      const error = createRateLimitedError();
      
      expect(error.code).toBe(GitErrorCode.RATE_LIMITED);
      expect(error.category).toBe(GitErrorCategory.RETRIABLE);
      expect(error.message).toContain('Rate limit');
    });
  });

  describe('Fatal Errors', () => {
    it('should create corrupt pack error', () => {
      const error = createCorruptPackError();
      
      expect(error.code).toBe(GitErrorCode.CORRUPT_PACK);
      expect(error.category).toBe(GitErrorCategory.FATAL);
      expect(error.message).toContain('Corrupt pack');
      expect(isFatalError(error)).toBe(true);
    });

    it('should create corrupt object error', () => {
      const error = createCorruptObjectError();
      
      expect(error.code).toBe(GitErrorCode.CORRUPT_OBJECT);
      expect(error.category).toBe(GitErrorCategory.FATAL);
      expect(error.message).toContain('Corrupt');
    });

    it('should create filesystem error with custom message', () => {
      const error = createFsError('Disk full');
      
      expect(error.code).toBe(GitErrorCode.FS_ERROR);
      expect(error.category).toBe(GitErrorCategory.FATAL);
      expect(error.message).toBe('Disk full');
    });

    it('should create operation aborted error', () => {
      const error = createOperationAbortedError();
      
      expect(error.code).toBe(GitErrorCode.OPERATION_ABORTED);
      expect(error.category).toBe(GitErrorCategory.FATAL);
      expect(error.message).toContain('aborted');
    });

    it('should create unknown error with custom message', () => {
      const error = createUnknownError('Something went wrong');
      
      expect(error.code).toBe(GitErrorCode.UNKNOWN_ERROR);
      expect(error.category).toBe(GitErrorCategory.FATAL);
      expect(error.message).toBe('Something went wrong');
    });
  });

  describe('Error Context', () => {
    it('should attach context to errors', () => {
      const context = {
        naddr: 'test-naddr',
        remote: 'https://example.com',
        ref: 'main',
        operation: 'push',
      };
      
      const error = createNetworkError(context);
      
      expect(error.context).toEqual(context);
    });

    it('should attach cause to errors', () => {
      const cause = new Error('Original error');
      const error = createNetworkError(undefined, cause);
      
      expect(error.cause).toBe(cause);
    });

    it('should serialize to JSON', () => {
      const error = createNetworkError({ naddr: 'test' });
      const json = error.toJSON();
      
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('code');
      expect(json).toHaveProperty('category');
      expect(json).toHaveProperty('context');
    });
  });

  describe('wrapError', () => {
    it('should return GitError unchanged', () => {
      const original = createNetworkError();
      const wrapped = wrapError(original);
      
      expect(wrapped).toBe(original);
    });

    it('should categorize auth errors', () => {
      const error = new Error('401 unauthorized');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.AUTH_REQUIRED);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize permission errors', () => {
      const error = new Error('403 forbidden');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.PERMISSION_DENIED);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize not fast-forward errors', () => {
      const error = new Error('not a fast-forward');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.NOT_FAST_FORWARD);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize conflict errors', () => {
      const error = new Error('merge conflict detected');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.MERGE_CONFLICT);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize not found errors', () => {
      const error = new Error('404 not found');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.REPO_NOT_FOUND);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize network errors', () => {
      const error = new Error('ECONNREFUSED');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.NETWORK_ERROR);
      expect(wrapped.category).toBe(GitErrorCategory.RETRIABLE);
    });

    it('should categorize timeout errors', () => {
      const error = new Error('operation timed out');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.TIMEOUT);
      expect(wrapped.category).toBe(GitErrorCategory.RETRIABLE);
    });

    it('should categorize server errors', () => {
      const error = new Error('500 internal server error');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.GRASP_5XX);
      expect(wrapped.category).toBe(GitErrorCategory.RETRIABLE);
    });

    it('should categorize rate limit errors', () => {
      const error = new Error('429 rate limit exceeded');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.RATE_LIMITED);
      expect(wrapped.category).toBe(GitErrorCategory.RETRIABLE);
    });

    it('should categorize corruption errors', () => {
      const error = new Error('corrupt pack file');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.CORRUPT_PACK);
      expect(wrapped.category).toBe(GitErrorCategory.FATAL);
    });

    it('should categorize quota errors', () => {
      const error = new Error('ENOSPC: disk full');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.QUOTA_EXCEEDED);
      expect(wrapped.category).toBe(GitErrorCategory.USER_ACTIONABLE);
    });

    it('should categorize filesystem errors', () => {
      const error = new Error('ENOENT: no such file');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.FS_ERROR);
      expect(wrapped.category).toBe(GitErrorCategory.FATAL);
    });

    it('should categorize abort errors', () => {
      const error = new Error('operation aborted');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.OPERATION_ABORTED);
      expect(wrapped.category).toBe(GitErrorCategory.FATAL);
    });

    it('should default to unknown error', () => {
      const error = new Error('something weird happened');
      const wrapped = wrapError(error);
      
      expect(wrapped.code).toBe(GitErrorCode.UNKNOWN_ERROR);
      expect(wrapped.category).toBe(GitErrorCategory.FATAL);
    });

    it('should handle non-Error objects', () => {
      const wrapped = wrapError('string error');
      
      expect(wrapped.code).toBe(GitErrorCode.UNKNOWN_ERROR);
      expect(wrapped.message).toBe('string error');
    });

    it('should attach context when wrapping', () => {
      const error = new Error('test');
      const context = { naddr: 'test-naddr' };
      const wrapped = wrapError(error, context);
      
      expect(wrapped.context).toEqual(context);
    });

    it('should preserve original error as cause', () => {
      const original = new Error('original');
      const wrapped = wrapError(original);
      
      expect(wrapped.cause).toBe(original);
    });
  });
});
