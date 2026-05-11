/**
 * Test Isolation Utilities for E2E Tests
 *
 * Provides utilities to ensure test isolation:
 * - Each test starts with a clean state
 * - Tests don't pollute each other
 * - Mock relay state is reset between tests
 *
 * @example
 * ```typescript
 * import {test} from "@playwright/test"
 * import {useCleanState, createIsolatedContext} from "./helpers/test-isolation"
 *
 * // Apply clean state to all tests in this file
 * useCleanState(test)
 *
 * test("my isolated test", async ({page}) => {
 *   // Test runs with fresh state
 * })
 * ```
 */
import type {Page, BrowserContext} from "@playwright/test"
import {MockRelay, type NostrEvent} from "./mock-relay"

/**
 * Test context with isolation utilities
 */
export interface IsolatedTestContext {
  /** Fresh mock relay instance for this test */
  mockRelay: MockRelay
  /** Events seeded for this specific test */
  seedEvents: NostrEvent[]
  /** Test-specific relay URL */
  relayUrl: string
  /** Encoded relay URL for use in routes */
  encodedRelayUrl: string
}

/**
 * Configuration for test isolation
 */
export interface TestIsolationConfig {
  /** Whether to clear browser storage before each test (default: true) */
  clearStorage?: boolean
  /** Whether to create a fresh mock relay for each test (default: true) */
  freshMockRelay?: boolean
  /** Base relay URL to use (default: ws://localhost:7000) */
  relayUrl?: string
  /** Enable debug logging for mock relay (default: false) */
  debug?: boolean
}

const DEFAULT_CONFIG: Required<TestIsolationConfig> = {
  clearStorage: true,
  freshMockRelay: true,
  relayUrl: "ws://localhost:7000",
  debug: false,
}

/**
 * Clear browser storage (localStorage, sessionStorage, IndexedDB)
 * Ensures each test starts with a clean slate
 *
 * Preserves auth-related keys that are needed for authenticated tests
 */
export async function clearBrowserStorage(page: Page, preserveAuth: boolean = true): Promise<void> {
  await page.evaluate(preserveAuthKeys => {
    // Auth keys to preserve when preserveAuth is true
    const authKeys = [
      "nostr-key",
      "nostr:key",
      "nsec",
      "npub",
      "pubkey",
      "privateKey",
      "secretKey",
      "loginMethod",
      "identity",
      "auth",
      "session",
      "user",
    ]

    // Clear localStorage (preserving auth keys if needed)
    if (preserveAuthKeys) {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && !authKeys.some(authKey => key.toLowerCase().includes(authKey.toLowerCase()))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } else {
      localStorage.clear()
    }

    // Clear sessionStorage
    sessionStorage.clear()

    // Clear IndexedDB databases (but preserve auth-related ones)
    const databases = indexedDB.databases ? indexedDB.databases() : Promise.resolve([])
    databases.then((dbs: Array<{name?: string}>) => {
      dbs.forEach((db: {name?: string}) => {
        if (db.name) {
          const isAuthDb =
            preserveAuthKeys &&
            authKeys.some(authKey => db.name!.toLowerCase().includes(authKey.toLowerCase()))
          if (!isAuthDb) {
            indexedDB.deleteDatabase(db.name)
          }
        }
      })
    })
  }, preserveAuth)
}

/**
 * Clear cookies for the current context
 */
export async function clearCookies(context: BrowserContext): Promise<void> {
  await context.clearCookies()
}

/**
 * Reset mock relay state between tests
 * Clears all published events and resets any accumulated state
 */
export function resetMockRelay(mockRelay: MockRelay): void {
  mockRelay.clear()
}

/**
 * Create a fresh mock relay instance with optional seed events
 */
export function createFreshMockRelay(
  seedEvents?: NostrEvent[],
  options?: {debug?: boolean},
): MockRelay {
  return new MockRelay({
    seedEvents,
    debug: options?.debug ?? false,
  })
}

/**
 * Generate a unique test ID for isolation purposes
 */
export function generateTestId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `test-${timestamp}-${random}`
}

/**
 * Apply clean state hook to all tests in a test file
 *
 * This sets up beforeEach/afterEach hooks to:
 * - Clear browser storage before each test
 * - Reset any accumulated state after each test
 *
 * @example
 * ```typescript
 * import {test} from "@playwright/test"
 * import {useCleanState} from "./helpers/test-isolation"
 *
 * useCleanState(test)
 *
 * test("isolated test 1", async ({page}) => {
 *   // Runs with clean storage
 * })
 *
 * test("isolated test 2", async ({page}) => {
 *   // Also runs with clean storage, not affected by test 1
 * })
 * ```
 */
export function useCleanState(testInstance: any, config?: Partial<TestIsolationConfig>): void {
  const finalConfig = {...DEFAULT_CONFIG, ...config}

  testInstance.beforeEach(async ({page}: {page: Page}) => {
    if (finalConfig.clearStorage) {
      // Navigate to the app first to get a proper origin for localStorage access
      // about:blank doesn't allow localStorage access due to security restrictions
      await page.goto("/")
      await page.waitForLoadState("domcontentloaded")
      // Clear browser storage but preserve auth-related keys and cookies
      // to maintain the authenticated state from the setup project
      await clearBrowserStorage(page, true)
      // DO NOT clear cookies - they contain authentication state loaded from storageState
    }
  })

  testInstance.afterEach(async ({page}: {page: Page}) => {
    // Clean up after test
    if (finalConfig.clearStorage) {
      try {
        // Only try to clear if we're on a valid page
        const url = page.url()
        if (url && !url.startsWith("about:")) {
          await clearBrowserStorage(page)
        }
      } catch {
        // Page may have been closed or on invalid origin, ignore
      }
    }
  })
}

/**
 * Create an isolated test context with its own mock relay
 *
 * Returns a context with a fresh mock relay instance and seeded data.
 *
 * @example
 * ```typescript
 * import {test, expect} from "@playwright/test"
 * import {createIsolatedContext} from "./helpers/test-isolation"
 * import {createRepoAnnouncement, TEST_USERS} from "./helpers/mock-relay"
 *
 * test("test with isolated context", async ({page}) => {
 *   const ctx = await createIsolatedContext(page, {
 *     seedEvents: [
 *       createRepoAnnouncement({
 *         pubkey: TEST_USERS.alice.pubkey,
 *         name: "test-repo",
 *       }),
 *     ],
 *   })
 *
 *   await page.goto("/")
 *   await expect(page.locator("body")).toBeVisible()
 * })
 * ```
 */
export async function createIsolatedContext(
  page: Page,
  options?: {
    seedEvents?: NostrEvent[]
    relayUrl?: string
    debug?: boolean
  },
): Promise<IsolatedTestContext> {
  const relayUrl = options?.relayUrl ?? DEFAULT_CONFIG.relayUrl
  const encodedRelayUrl = encodeURIComponent(relayUrl)
  const seedEvents = options?.seedEvents ?? []

  // Create fresh mock relay
  const mockRelay = createFreshMockRelay(seedEvents, {debug: options?.debug})

  // Set up the mock relay on the page
  await mockRelay.setup(page)

  return {
    mockRelay,
    seedEvents,
    relayUrl,
    encodedRelayUrl,
  }
}

/**
 * Apply isolated context to all tests using Playwright fixtures
 *
 * This creates an extended test instance that automatically provides
 * an isolated context with a fresh mock relay for each test.
 *
 * @example
 * ```typescript
 * import {test as base} from "@playwright/test"
 * import {useIsolatedContext} from "./helpers/test-isolation"
 *
 * const test = useIsolatedContext(base)
 *
 * test("isolated test", async ({page, isolatedContext}) => {
 *   await page.goto("/")
 * })
 * ```
 */
export function useIsolatedContext(testInstance: any, config?: Partial<TestIsolationConfig>): any {
  const finalConfig = {...DEFAULT_CONFIG, ...config}

  return testInstance.extend({
    isolatedContext: async (
      {page}: {page: Page},
      use: (ctx: IsolatedTestContext) => Promise<void>,
    ) => {
      // Create isolated context
      const ctx = await createIsolatedContext(page, {
        relayUrl: finalConfig.relayUrl,
        debug: finalConfig.debug,
      })

      // Provide to test
      await use(ctx)

      // Cleanup after test
      resetMockRelay(ctx.mockRelay)
    },
  })
}
