/**
 * Git Worker Singleton
 * 
 * Provides a single, globally-shared Git worker instance that's automatically
 * initialized with EventIO on first use. This ensures:
 * - Only one worker is created across the entire app
 * - EventIO is configured once
 * - Worker is reused for all Git operations
 * - No manual initialization needed
 */
import { getGitWorker, configureWorkerEventIO } from '@nostr-git/core/worker';
// @ts-ignore - Vite ?url import for correct worker URL resolution
import gitWorkerUrl from '@nostr-git/core/worker/worker.js?url';
import { createEventIO } from './event-io';

interface GitWorkerInstance {
  api: any;
  worker: Worker;
}

let workerInstance: GitWorkerInstance | null = null;
let initPromise: Promise<GitWorkerInstance> | null = null;

/**
 * Get the initialized Git worker instance.
 * 
 * This function:
 * - Returns immediately if worker is already initialized
 * - Waits if initialization is in progress
 * - Initializes worker on first call
 * - Configures EventIO automatically
 * - Registers event signer automatically
 * 
 * @returns Promise resolving to worker instance with api and worker
 * 
 * @example
 * ```typescript
 * const { api } = await getInitializedGitWorker();
 * const result = await api.clone({ url, dir, ... });
 * ```
 */
export async function getInitializedGitWorker(): Promise<GitWorkerInstance> {
  // If already initialized, return immediately
  if (workerInstance) {
    return workerInstance;
  }
  
  // If initialization in progress, wait for it
  if (initPromise) {
    return await initPromise;
  }
  
  // Start initialization
  initPromise = (async () => {
    try {
      // Create worker using the git-worker package's getGitWorker function
      // Use injected worker URL to ensure Vite resolves it correctly
      const { api, worker } = getGitWorker({
        workerUrl: gitWorkerUrl,
        onError: (ev: ErrorEvent | MessageEvent) => {
          console.error('[GitWorker] Worker load error:', ev);
        },
      });

      // Ping the worker to verify it's alive (fast failure detection)
      const pingTimeout = 5000;
      const pingPromise = api.ping();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Worker ping timed out")), pingTimeout);
      });
      
      const pingResult = await Promise.race([pingPromise, timeoutPromise]);
      console.log('[GitWorker] Worker ping successful:', pingResult);
      
      // Configure EventIO for GRASP/Nostr operations
      try {
        const eventIO = createEventIO();
        await configureWorkerEventIO(api, eventIO);
        console.log('[GitWorker] EventIO configured successfully');
      } catch (err) {
        console.warn('[GitWorker] Failed to configure EventIO:', err);
        // Continue without EventIO - GRASP operations won't work but basic git will
      }
      
      workerInstance = { api, worker };
      
      return workerInstance;
    } catch (error) {
      console.error('[GitWorker] Failed to initialize worker:', error);
      // Reset the promise so we can try again
      initPromise = null;
      throw error;
    }
  })();
  
  return await initPromise;
}

/**
 * Terminate the Git worker and clean up resources.
 * 
 * This should be called when the app is closing or when you need to
 * reset the worker state. After calling this, the next call to
 * getInitializedGitWorker() will create a new worker.
 * 
 * @example
 * ```typescript
 * // In app cleanup
 * terminateGitWorker();
 * ```
 */
export function terminateGitWorker(): void {
  if (workerInstance) {
    workerInstance.worker.terminate();
    workerInstance = null;
    initPromise = null;
  }
}

/**
 * Check if the Git worker is currently initialized.
 * 
 * @returns true if worker is initialized, false otherwise
 */
export function isGitWorkerInitialized(): boolean {
  return workerInstance !== null;
}
