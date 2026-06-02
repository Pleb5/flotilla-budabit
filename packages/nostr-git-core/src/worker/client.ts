import { proxy, wrap } from 'comlink';
import type { EventIO } from '../types/index.js';

export interface CloneProgressEvent {
  type: 'clone-progress';
  repoId: string;
  phase: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

export interface GitWorkerInit {
  /** Custom worker URL (for Vite ?url imports) */
  workerUrl?: string | URL;
  /** Custom worker factory function */
  workerFactory?: () => Worker;
  /** Progress callback for clone/merge events */
  onProgress?: (event: MessageEvent | CloneProgressEvent) => void;
  /** Error callback for worker load failures */
  onError?: (ev: ErrorEvent | MessageEvent) => void;
}

/**
 * Get a Git worker instance with Comlink API wrapper.
 * 
 * @param init Configuration options (or legacy onProgress callback)
 * @returns Object with worker instance and Comlink API
 */
export function getGitWorker(init?: GitWorkerInit | ((event: MessageEvent | CloneProgressEvent) => void)) {
  // Support legacy signature: getGitWorker(onProgress)
  const config: GitWorkerInit = typeof init === 'function' ? { onProgress: init } : (init ?? {});
  
  const worker =
    config.workerFactory?.() ??
    new Worker(config.workerUrl ?? new URL('./worker.js', import.meta.url), { type: 'module' });

  // Add error listener to surface worker load failures
  if (config.onError) {
    worker.addEventListener('error', (ev: ErrorEvent) => {
      config.onError!(ev);
    });
    worker.addEventListener('messageerror', (ev: MessageEvent) => {
      config.onError!(ev);
    });
  }

  if (config.onProgress) {
    worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type === 'clone-progress' || data.type === 'merge-progress') {
        config.onProgress!(event);
      }
    });
  }

  const api = wrap<any>(worker);
  return {
    api,
    worker,
    terminate: () => {
      worker.terminate();
    }
  };
}

/**
 * Configure EventIO for a git worker.
 * This must be called before performing any GRASP operations.
 * 
 * @param api The Comlink-wrapped worker API
 * @param io The EventIO instance to use for Nostr operations
 */
export async function configureWorkerEventIO(api: any, io: EventIO): Promise<void> {
  await api.setEventIO(proxy(io));
}
