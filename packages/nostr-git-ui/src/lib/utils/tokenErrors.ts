/**
 * Token-related error types for better error handling and debugging
 */

/**
 * Base error class for token-related errors
 */
export class TokenError extends Error {
  constructor(message: string, public readonly hostname?: string) {
    super(message);
    this.name = 'TokenError';
    Object.setPrototypeOf(this, TokenError.prototype);
  }
}

/**
 * Error thrown when all tokens for a host have been tried and failed
 */
export class AllTokensFailedError extends TokenError {
  public readonly errors: Error[];

  constructor(
    hostname: string,
    errors: Error[],
    operation?: string
  ) {
    const errorMessages = errors.map((e, i) => `Token ${i + 1}: ${e.message}`).join('; ');
    const message = operation
      ? `All tokens failed for ${operation} on ${hostname}. Errors: ${errorMessages}`
      : `All tokens failed for host ${hostname}. Errors: ${errorMessages}`;
    
    super(message, hostname);
    this.name = 'AllTokensFailedError';
    this.errors = errors;
    Object.setPrototypeOf(this, AllTokensFailedError.prototype);
  }
}

/**
 * Error thrown when no tokens are found for a host
 */
export class TokenNotFoundError extends TokenError {
  constructor(hostname: string, operation?: string) {
    const message = operation
      ? `No tokens found for ${operation} on ${hostname}`
      : `No tokens found for host ${hostname}`;
    
    super(message, hostname);
    this.name = 'TokenNotFoundError';
    Object.setPrototypeOf(this, TokenNotFoundError.prototype);
  }
}

