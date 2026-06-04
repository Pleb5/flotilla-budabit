/**
 * Abort Controller for Long-Running Import Operations
 *
 * Provides graceful abort mechanism for repository import operations
 * that may take a long time to complete.
 */

/**
 * Abort controller for import operations
 * Provides a simple mechanism to signal and check for abort requests
 */
export class ImportAbortController {
  private aborted = false
  private reason?: string
  private controller = new AbortController()

  /**
   * Signal that the operation should be aborted
   *
   * @param reason - Optional reason for abort (for logging/debugging)
   */
  abort(reason?: string): void {
    this.aborted = true
    this.reason = reason
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason)
    }
  }

  /**
   * Check if the operation has been aborted
   *
   * @returns true if aborted, false otherwise
   */
  isAborted(): boolean {
    return this.aborted
  }

  /**
   * Get the abort reason, if any
   *
   * @returns reason string or undefined
   */
  getReason(): string | undefined {
    return this.reason
  }

  /**
   * Native AbortSignal for APIs that support signal-based cancellation.
   */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /**
   * Returns a promise that rejects when abort is requested.
   */
  waitForAbort(): Promise<never> {
    if (this.aborted || this.controller.signal.aborted) {
      const message = this.reason
        ? `Import operation aborted: ${this.reason}`
        : "Import operation aborted"
      return Promise.reject(new ImportAbortedError(message))
    }

    return new Promise((_, reject) => {
      const onAbort = () => {
        this.controller.signal.removeEventListener("abort", onAbort)
        const message = this.reason
          ? `Import operation aborted: ${this.reason}`
          : "Import operation aborted"
        reject(new ImportAbortedError(message))
      }

      this.controller.signal.addEventListener("abort", onAbort, {once: true})
    })
  }

  /**
   * Throw an error if the operation has been aborted
   * Useful for checking at safe points during long-running operations
   *
   * @throws {Error} if aborted
   */
  throwIfAborted(): void {
    if (this.aborted) {
      const message = this.reason
        ? `Import operation aborted: ${this.reason}`
        : "Import operation aborted"
      throw new ImportAbortedError(message)
    }
  }

  /**
   * Reset the abort state (useful for retrying)
   */
  reset(): void {
    this.aborted = false
    this.reason = undefined
    this.controller = new AbortController()
  }
}

/**
 * Error thrown when an import operation is aborted
 */
export class ImportAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImportAbortedError"
  }
}
