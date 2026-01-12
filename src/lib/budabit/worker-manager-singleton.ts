/**
 * WorkerManager Singleton
 * 
 * Provides a single, globally-shared WorkerManager instance that's automatically
 * initialized with the correct worker URL on first use. This ensures:
 * - Only one worker is created across the entire app
 * - Worker is reused for all Git operations (Repo instances, direct API calls, etc.)
 * - No duplicate workers competing for resources
 */
import { WorkerManager } from '@nostr-git/ui';
// @ts-ignore - Vite ?url import for correct worker URL resolution
import gitWorkerUrl from '@nostr-git/core/worker/worker.js?url';

let sharedWorkerManager: WorkerManager | null = null;

/**
 * Get the shared WorkerManager instance.
 * 
 * This function:
 * - Returns immediately if WorkerManager is already created
 * - Creates a new WorkerManager with the correct worker URL on first call
 * - The WorkerManager handles its own initialization lazily
 * 
 * @returns The shared WorkerManager instance
 * 
 * @example
 * ```typescript
 * const workerManager = getSharedWorkerManager();
 * // Pass to Repo constructor
 * const repo = new Repo({ ..., workerManager });
 * ```
 */
export function getSharedWorkerManager(): WorkerManager {
  if (!sharedWorkerManager) {
    console.log('[WorkerManagerSingleton] Creating shared WorkerManager with URL:', gitWorkerUrl);
    sharedWorkerManager = new WorkerManager(
      undefined, // progress callback - will be set by Repo instances
      { workerUrl: gitWorkerUrl }
    );
  }
  return sharedWorkerManager;
}

/**
 * Terminate the shared WorkerManager and clean up resources.
 * 
 * This should be called when the app is closing or when you need to
 * reset the worker state. After calling this, the next call to
 * getSharedWorkerManager() will create a new WorkerManager.
 */
export function terminateSharedWorkerManager(): void {
  if (sharedWorkerManager) {
    sharedWorkerManager.dispose();
    sharedWorkerManager = null;
  }
}

/**
 * Check if the shared WorkerManager is currently created.
 * 
 * @returns true if WorkerManager exists, false otherwise
 */
export function isSharedWorkerManagerCreated(): boolean {
  return sharedWorkerManager !== null;
}
