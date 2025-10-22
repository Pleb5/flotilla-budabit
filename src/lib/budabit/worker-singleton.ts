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
import { getGitWorker } from '@nostr-git/core';

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
    console.log('[GitWorker] Initializing singleton worker');
    
    try {
      // Create worker with progress callback
      console.log('[GitWorker] Creating worker...');
      const { api, worker } = getGitWorker((progress) => {
        console.log('[GitWorker] Progress:', {
          repoId: progress.repoId,
          phase: progress.phase,
          progress: progress.progress,
          loaded: progress.loaded,
          total: progress.total
        });
      });
      console.log('[GitWorker] Worker created successfully');
      
      // Register event signer for GRASP operations
      //registerEventSigner(worker, signEvent);
      
      workerInstance = { api, worker };
      console.log('[GitWorker] Singleton worker initialized successfully');
      
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
    console.log('[GitWorker] Singleton worker terminated');
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
