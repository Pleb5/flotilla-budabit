/**
 * Test Isolation Utilities for E2E Tests
 *
 * Provides utilities to ensure test isolation:
 * - Each test starts with a clean state
 * - Tests don't pollute each other
 * - Mock relay state is reset between tests
 *
 * Works in conjunction with TestSeeder from ./seed.ts for data seeding.
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
import type {TestType, Page, BrowserContext} from "@playwright/test"
import {MockRelay, type NostrEvent} from "./mock-relay"
import {TestSeeder} from "./seed"

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
  await page.evaluate((preserveAuthKeys) => {
    // Auth keys to preserve when preserveAuth is true
    const authKeys = [
      'nostr-key',
      'nostr:key',
      'nsec',
      'npub',
      'pubkey',
      'privateKey',
      'secretKey',
      'loginMethod',
      'identity',
      'auth',
      'session',
      'user',
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
          const isAuthDb = preserveAuthKeys && authKeys.some(authKey =>
            db.name!.toLowerCase().includes(authKey.toLowerCase())
          )
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
  options?: {debug?: boolean}
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
export function useCleanState(
  testInstance: TestType<{page: Page; context: BrowserContext}, unknown>,
  config?: Partial<TestIsolationConfig>
): void {
  const finalConfig = {...DEFAULT_CONFIG, ...config}

  testInstance.beforeEach(async ({page}) => {
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

  testInstance.afterEach(async ({page}) => {
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
 *   await page.goto(`/spaces/${ctx.encodedRelayUrl}/git`)
 *   await expect(page.getByText("test-repo")).toBeVisible()
 * })
 * ```
 */
export async function createIsolatedContext(
  page: Page,
  options?: {
    seedEvents?: NostrEvent[]
    relayUrl?: string
    debug?: boolean
  }
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
 *   await page.goto(`/spaces/${isolatedContext.encodedRelayUrl}/git`)
 * })
 * ```
 */
export function useIsolatedContext<T extends {page: Page; context: BrowserContext}>(
  testInstance: TestType<T, unknown>,
  config?: Partial<TestIsolationConfig>
): TestType<T & {isolatedContext: IsolatedTestContext}, unknown> {
  const finalConfig = {...DEFAULT_CONFIG, ...config}

  return testInstance.extend<{isolatedContext: IsolatedTestContext}>({
    isolatedContext: async ({page}, use) => {
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

/**
 * IsolatedSeeder - Wrapper around TestSeeder that ensures isolation
 *
 * Creates a fresh TestSeeder for each test with automatic cleanup.
 * Provides the same API as TestSeeder but with isolation guarantees.
 *
 * @example
 * ```typescript
 * import {test, expect} from "@playwright/test"
 * import {IsolatedSeeder} from "./helpers/test-isolation"
 *
 * test.describe("isolated tests", () => {
 *   test("test 1", async ({page}) => {
 *     const seeder = new IsolatedSeeder({debug: true})
 *     seeder.seedRepo({name: "test-repo", withIssues: 3})
 *     await seeder.setup(page)
 *
 *     await page.goto("/spaces/ws%3A%2F%2Flocalhost%3A7000/git")
 *     // test-repo is visible
 *   })
 *
 *   test("test 2", async ({page}) => {
 *     // Starts fresh - test 1's data is not present
 *     const seeder = new IsolatedSeeder()
 *     seeder.seedRepo({name: "different-repo"})
 *     await seeder.setup(page)
 *     // Only different-repo is visible
 *   })
 * })
 * ```
 */
export class IsolatedSeeder extends TestSeeder {
  private relayUrl: string
  private isolatedMockRelay?: MockRelay

  constructor(options?: {
    debug?: boolean
    latency?: number
    interceptUrls?: string[]
    relayUrl?: string
  }) {
    super(options)
    this.relayUrl = options?.relayUrl ?? DEFAULT_CONFIG.relayUrl
  }

  /**
   * Get the relay URL for this seeder
   */
  getRelayUrl(): string {
    return this.relayUrl
  }

  /**
   * Get the encoded relay URL for use in routes
   */
  getEncodedRelayUrl(): string {
    return encodeURIComponent(this.relayUrl)
  }

  /**
   * Override setup to track the mock relay for cleanup
   */
  async setup(page: Page): Promise<void> {
    await super.setup(page)
    this.isolatedMockRelay = this.getMockRelay()
  }

  /**
   * Clean up the seeder - call this in afterEach if needed
   */
  cleanup(): void {
    if (this.isolatedMockRelay) {
      resetMockRelay(this.isolatedMockRelay)
    }
    this.clear()
  }
}

/**
 * Create an isolated seeder for a single test
 *
 * Convenience function that creates an IsolatedSeeder, seeds the requested
 * data, and sets it up on the page.
 *
 * @example
 * ```typescript
 * import {test, expect} from "@playwright/test"
 * import {createIsolatedSeeder} from "./helpers/test-isolation"
 *
 * test("displays seeded repos", async ({page}) => {
 *   const seeder = await createIsolatedSeeder(page, (s) => {
 *     s.seedRepo({name: "repo-1", withIssues: 2})
 *     s.seedRepo({name: "repo-2", withPatches: 1})
 *   })
 *
 *   await page.goto(`/spaces/${seeder.getEncodedRelayUrl()}/git`)
 *   await expect(page.getByText("repo-1")).toBeVisible()
 * })
 * ```
 */
export async function createIsolatedSeeder(
  page: Page,
  seedFn: (seeder: IsolatedSeeder) => void,
  options?: {debug?: boolean; relayUrl?: string}
): Promise<IsolatedSeeder> {
  const seeder = new IsolatedSeeder(options)
  seedFn(seeder)
  await seeder.setup(page)
  return seeder
}

/**
 * Test isolation fixture for Playwright's test.extend()
 *
 * Provides automatic isolation with a fresh IsolatedSeeder for each test.
 *
 * @example
 * ```typescript
 * import {test as base, expect} from "@playwright/test"
 * import {testIsolationFixture} from "./helpers/test-isolation"
 *
 * const test = base.extend(testIsolationFixture)
 *
 * test("isolated test with seeder", async ({page, seeder}) => {
 *   seeder.seedRepo({name: "test-repo", withIssues: 5})
 *   await seeder.setup(page)
 *
 *   await page.goto(`/spaces/${seeder.getEncodedRelayUrl()}/git`)
 *   await expect(page.getByText("test-repo")).toBeVisible()
 * })
 * ```
 */
export const testIsolationFixture = {
  seeder: async ({}: {}, use: (seeder: IsolatedSeeder) => Promise<void>) => {
    const seeder = new IsolatedSeeder()
    await use(seeder)
    seeder.cleanup()
  },
}
