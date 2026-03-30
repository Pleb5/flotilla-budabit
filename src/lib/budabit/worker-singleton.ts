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
import {getGitWorker, configureWorkerEventIO} from "@nostr-git/core/worker"
// @ts-ignore - Vite ?url import for correct worker URL resolution
import gitWorkerUrl from "@nostr-git/core/worker/worker.js?url"
import {createEventIO} from "./event-io"

interface GitWorkerInstance {
  api: any
  worker: Worker
}

type GitWorkerConfig = {
  defaultCorsProxy?: string | null
}

const WORKER_SINGLETON_BUILD_ID = new Date().toISOString()

if (import.meta.env.DEV) {
  console.info(`[GitWorker] singleton module loaded: ${WORKER_SINGLETON_BUILD_ID}`)
}

const FALLBACK_GIT_CORS_PROXY = "https://corsproxy.budabit.club"
const GIT_CORS_PROXY_STORAGE_KEY = "budabit/git/corsProxy"

const normalizeCorsProxy = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, "")
}

const ENV_DEFAULT_GIT_CORS_PROXY = normalizeCorsProxy(
  import.meta.env.VITE_GIT_DEFAULT_CORS_PROXY || "",
)
const DEFAULT_GIT_CORS_PROXY = ENV_DEFAULT_GIT_CORS_PROXY || FALLBACK_GIT_CORS_PROXY

const resolveStoredCorsProxy = (): string => {
  if (typeof localStorage === "undefined") return DEFAULT_GIT_CORS_PROXY
  const raw = localStorage.getItem(GIT_CORS_PROXY_STORAGE_KEY) ?? ""
  const normalized = normalizeCorsProxy(raw)
  const effective = normalized || DEFAULT_GIT_CORS_PROXY

  if (!normalized) {
    try {
      localStorage.setItem(GIT_CORS_PROXY_STORAGE_KEY, effective)
    } catch {
      // ignore storage write failures
    }
  }

  return effective
}

let workerInstance: GitWorkerInstance | null = null
let initPromise: Promise<GitWorkerInstance> | null = null
let pendingGitConfig: GitWorkerConfig | null = {defaultCorsProxy: resolveStoredCorsProxy()}

export function setGitWorkerConfig(config: GitWorkerConfig): void {
  pendingGitConfig = {...pendingGitConfig, ...config}
  if (workerInstance?.api && typeof workerInstance.api.setGitConfig === "function") {
    void workerInstance.api.setGitConfig(pendingGitConfig).catch((err: unknown) =>
      console.warn("[GitWorker] Failed to update git settings:", err),
    )
  }
}

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
    return workerInstance
  }

  // If initialization in progress, wait for it
  if (initPromise) {
    return await initPromise
  }

  // Start initialization
  initPromise = (async () => {
    try {
      // Create worker using the git-worker package's getGitWorker function
      // Use injected worker URL to ensure Vite resolves it correctly
      const {api, worker} = getGitWorker({
        workerUrl: gitWorkerUrl,
        onError: (ev: ErrorEvent | MessageEvent) => {
          console.error("[GitWorker] Worker load error:", ev)
        },
      })

      // Ping the worker to verify it's alive (fast failure detection)
      const pingTimeout = 5000
      const pingPromise = api.ping()
      let pingTimer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise((_, reject) => {
        pingTimer = setTimeout(() => reject(new Error("Worker ping timed out")), pingTimeout)
      })

      const pingResult = await Promise.race([pingPromise, timeoutPromise])
      clearTimeout(pingTimer)
      console.log("[GitWorker] Worker ping successful:", pingResult)

      // Configure EventIO for GRASP/Nostr operations
      try {
        const eventIO = createEventIO()
        await configureWorkerEventIO(api, eventIO)
        console.log("[GitWorker] EventIO configured successfully")
      } catch (err) {
        console.warn("[GitWorker] Failed to configure EventIO:", err)
        // Continue without EventIO - GRASP operations won't work but basic git will
      }

      if (pendingGitConfig && typeof api.setGitConfig === "function") {
        try {
          await api.setGitConfig(pendingGitConfig)
        } catch (err) {
          console.warn("[GitWorker] Failed to configure git settings:", err)
        }
      }

      workerInstance = {api, worker}

      return workerInstance
    } catch (error) {
      console.error("[GitWorker] Failed to initialize worker:", error)
      // Reset the promise so we can try again
      initPromise = null
      throw error
    }
  })()

  return await initPromise
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
    workerInstance.worker.terminate()
    workerInstance = null
    initPromise = null
  }
}

/**
 * Check if the Git worker is currently initialized.
 *
 * @returns true if worker is initialized, false otherwise
 */
export function isGitWorkerInitialized(): boolean {
  return workerInstance !== null
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    terminateGitWorker()
  })
}
