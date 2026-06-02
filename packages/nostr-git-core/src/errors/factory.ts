/**
 * Error Factory
 *
 * Provides helper functions to create typed Git errors with consistent formatting.
 */

import {
  GitErrorCode,
  GitErrorContext,
  UserActionableError,
  RetriableError,
  FatalError,
  type GitError,
} from './types.js';

/**
 * Create an authentication required error.
 */
export function createAuthRequiredError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Authentication required to access this repository',
    GitErrorCode.AUTH_REQUIRED,
    {
      hint: 'Please provide valid credentials or access token',
      context,
      cause,
    }
  );
}

/**
 * Create an authentication expired error.
 */
export function createAuthExpiredError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Authentication credentials have expired',
    GitErrorCode.AUTH_EXPIRED,
    {
      hint: 'Please re-authenticate or refresh your access token',
      context,
      cause,
    }
  );
}

/**
 * Create an invalid authentication error.
 */
export function createAuthInvalidError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Authentication credentials are invalid',
    GitErrorCode.AUTH_INVALID,
    {
      hint: 'Please check your credentials and try again',
      context,
      cause,
    }
  );
}

/**
 * Create a not-fast-forward error (push rejected).
 */
export function createNotFastForwardError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Push rejected: not a fast-forward',
    GitErrorCode.NOT_FAST_FORWARD,
    {
      hint: 'Pull the latest changes and merge before pushing, or use force push if appropriate',
      context,
      cause,
    }
  );
}

/**
 * Create a merge conflict error.
 */
export function createMergeConflictError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Merge conflict detected',
    GitErrorCode.MERGE_CONFLICT,
    {
      hint: 'Resolve conflicts manually and commit the result',
      context,
      cause,
    }
  );
}

/**
 * Create a repository not found error.
 */
export function createRepoNotFoundError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Repository not found',
    GitErrorCode.REPO_NOT_FOUND,
    {
      hint: 'Check the repository identifier and ensure you have access',
      context,
      cause,
    }
  );
}

/**
 * Create a repository already exists error.
 */
export function createRepoAlreadyExistsError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Repository already exists',
    GitErrorCode.REPO_ALREADY_EXISTS,
    {
      hint: 'Choose a different repository name or delete the existing repository',
      context,
      cause,
    }
  );
}

/**
 * Create a quota exceeded error.
 */
export function createQuotaExceededError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Storage quota exceeded',
    GitErrorCode.QUOTA_EXCEEDED,
    {
      hint: 'Free up space or upgrade your plan',
      context,
      cause,
    }
  );
}

/**
 * Create a permission denied error.
 */
export function createPermissionDeniedError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Permission denied',
    GitErrorCode.PERMISSION_DENIED,
    {
      hint: 'You do not have permission to perform this operation',
      context,
      cause,
    }
  );
}

/**
 * Create a ref locked error.
 */
export function createRefLockedError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Reference is locked by another operation',
    GitErrorCode.REF_LOCKED,
    {
      hint: 'Wait for the other operation to complete or force unlock if necessary',
      context,
      cause,
    }
  );
}

/**
 * Create an invalid refspec error.
 */
export function createInvalidRefspecError(context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    'Invalid refspec',
    GitErrorCode.INVALID_REFSPEC,
    {
      hint: 'Check the branch or tag name format',
      context,
      cause,
    }
  );
}

/**
 * Create an invalid input error.
 */
export function createInvalidInputError(message: string, context?: GitErrorContext, cause?: Error): GitError {
  return new UserActionableError(
    message,
    GitErrorCode.INVALID_INPUT,
    {
      hint: 'Check the input parameters and try again',
      context,
      cause,
    }
  );
}

/**
 * Create a network error (retriable).
 */
export function createNetworkError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'Network error occurred',
    GitErrorCode.NETWORK_ERROR,
    {
      hint: 'Check your internet connection and try again',
      context,
      cause,
    }
  );
}

/**
 * Create a timeout error (retriable).
 */
export function createTimeoutError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'Operation timed out',
    GitErrorCode.TIMEOUT,
    {
      hint: 'The operation took too long. Try again or check your connection',
      context,
      cause,
    }
  );
}

/**
 * Create a relay timeout error (retriable).
 */
export function createRelayTimeoutError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'Relay connection timed out',
    GitErrorCode.RELAY_TIMEOUT,
    {
      hint: 'The relay did not respond in time. Try again or use a different relay',
      context,
      cause,
    }
  );
}

/**
 * Create a relay error (retriable).
 */
export function createRelayError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'Relay error occurred',
    GitErrorCode.RELAY_ERROR,
    {
      hint: 'The relay encountered an error. Try again or use a different relay',
      context,
      cause,
    }
  );
}

/**
 * Create a GRASP 5xx error (retriable).
 */
export function createGrasp5xxError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'GRASP server error (5xx)',
    GitErrorCode.GRASP_5XX,
    {
      hint: 'The GRASP server encountered an error. Try again later',
      context,
      cause,
    }
  );
}

/**
 * Create a temporary failure error (retriable).
 */
export function createTemporaryFailureError(message: string, context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    message,
    GitErrorCode.TEMPORARY_FAILURE,
    {
      hint: 'This is a temporary issue. Try again in a moment',
      context,
      cause,
    }
  );
}

/**
 * Create a rate limited error (retriable).
 */
export function createRateLimitedError(context?: GitErrorContext, cause?: Error): GitError {
  return new RetriableError(
    'Rate limit exceeded',
    GitErrorCode.RATE_LIMITED,
    {
      hint: 'You have made too many requests. Wait a moment and try again',
      context,
      cause,
    }
  );
}

/**
 * Create a corrupt pack error (fatal).
 */
export function createCorruptPackError(context?: GitErrorContext, cause?: Error): GitError {
  return new FatalError(
    'Corrupt pack file detected',
    GitErrorCode.CORRUPT_PACK,
    {
      hint: 'The repository data is corrupted. Try re-cloning the repository',
      context,
      cause,
    }
  );
}

/**
 * Create a corrupt object error (fatal).
 */
export function createCorruptObjectError(context?: GitErrorContext, cause?: Error): GitError {
  return new FatalError(
    'Corrupt Git object detected',
    GitErrorCode.CORRUPT_OBJECT,
    {
      hint: 'The repository data is corrupted. Try re-cloning the repository',
      context,
      cause,
    }
  );
}

/**
 * Create a filesystem error (fatal).
 */
export function createFsError(message: string, context?: GitErrorContext, cause?: Error): GitError {
  return new FatalError(
    message,
    GitErrorCode.FS_ERROR,
    {
      hint: 'A filesystem error occurred. Check available storage and permissions',
      context,
      cause,
    }
  );
}

/**
 * Create an operation aborted error (fatal).
 */
export function createOperationAbortedError(context?: GitErrorContext, cause?: Error): GitError {
  return new FatalError(
    'Operation was aborted',
    GitErrorCode.OPERATION_ABORTED,
    {
      hint: 'The operation was cancelled',
      context,
      cause,
    }
  );
}

/**
 * Create an unknown error (fatal).
 */
export function createUnknownError(message: string, context?: GitErrorContext, cause?: Error): GitError {
  return new FatalError(
    message || 'An unknown error occurred',
    GitErrorCode.UNKNOWN_ERROR,
    {
      hint: 'An unexpected error occurred. Please report this issue',
      context,
      cause,
    }
  );
}

/**
 * Wrap an unknown error into a typed GitError.
 * Attempts to categorize based on error message/properties.
 */
export function wrapError(error: unknown, context?: GitErrorContext): GitError {
  // Already a GitError
  if (error && typeof error === 'object' && 'code' in error && 'category' in error) {
    return error as GitError;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  // Try to categorize based on message patterns
  const lowerMessage = message.toLowerCase();

  // Authentication errors
  if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
    return createAuthRequiredError(context, cause);
  }
  if (lowerMessage.includes('forbidden') || lowerMessage.includes('403')) {
    return createPermissionDeniedError(context, cause);
  }

  // Push/merge errors
  if (lowerMessage.includes('not a fast-forward') || lowerMessage.includes('non-fast-forward')) {
    return createNotFastForwardError(context, cause);
  }
  if (lowerMessage.includes('conflict')) {
    return createMergeConflictError(context, cause);
  }

  // Not found errors
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return createRepoNotFoundError(context, cause);
  }

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('connection') || lowerMessage.includes('econnrefused')) {
    return createNetworkError(context, cause);
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return createTimeoutError(context, cause);
  }

  // Server errors
  if (lowerMessage.includes('500') || lowerMessage.includes('502') || lowerMessage.includes('503')) {
    return createGrasp5xxError(context, cause);
  }

  // Rate limiting
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return createRateLimitedError(context, cause);
  }

  // Corruption errors
  if (lowerMessage.includes('corrupt') || lowerMessage.includes('invalid pack') || lowerMessage.includes('bad object')) {
    return createCorruptPackError(context, cause);
  }

  // Filesystem errors
  if (lowerMessage.includes('enospc') || lowerMessage.includes('quota') || lowerMessage.includes('disk full')) {
    return createQuotaExceededError(context, cause);
  }
  if (lowerMessage.includes('enoent') || lowerMessage.includes('eacces') || lowerMessage.includes('eperm')) {
    return createFsError(message, context, cause);
  }

  // Abort errors
  if (lowerMessage.includes('abort')) {
    return createOperationAbortedError(context, cause);
  }

  // Default to unknown error
  return createUnknownError(message, context, cause);
}
