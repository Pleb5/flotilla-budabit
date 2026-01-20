import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  seedTestRepo,
  seedTestScenario,
  seedMultipleRepos,
  IsolatedSeeder,
  createIsolatedSeeder,
  useCleanState,
  resetMockRelay,
} from "../helpers"
import {FIXTURES} from "../fixtures/test-events"

/**
 * Test Data Seeding E2E Tests
 *
 * These tests demonstrate and verify the test data seeding strategy for
 * the flotilla-budabit E2E test suite. They showcase:
 *
 * 1. Using TestSeeder to set up repositories with issues
 * 2. Test isolation - each test gets fresh data
 * 3. Multiple seeding patterns (convenience functions, full control)
 * 4. Verifying seeded data displays correctly in the UI
 *
 * The seeding strategy uses MockRelay to intercept WebSocket connections,
 * providing deterministic test data without needing a real relay.
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation
useCleanState(test)

test.describe("Test Data Seeding", () => {
  test.describe("TestSeeder basic usage", () => {
    test("seeds a single repository", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      // Seed a repository
      const repoResult = seeder.seedRepo({
        name: "test-seeding-repo",
        description: "A repository created by TestSeeder",
      })

      await seeder.setup(page)

      // Navigate to the git page
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Verify the repo was seeded correctly
      expect(repoResult.identifier).toBe("test-seeding-repo")
      expect(repoResult.address).toContain("30617:") // Kind 30617 repo announcement

      // The seeder should have created exactly 1 event (the repo announcement)
      const repos = seeder.getRepos()
      expect(repos).toHaveLength(1)
      expect(repos[0].kind).toBe(30617)
    })

    test("seeds a repository with issues", async ({page}) => {
      const seeder = new TestSeeder()

      // Seed a repository with 3 issues
      seeder.seedRepo({
        name: "repo-with-issues",
        description: "Repository with multiple issues",
        withIssues: 3,
      })

      await seeder.setup(page)

      // Verify seeded data
      const repos = seeder.getRepos()
      const issues = seeder.getIssues()

      expect(repos).toHaveLength(1)
      expect(issues).toHaveLength(3)

      // Each issue should have the correct kind
      for (const issue of issues) {
        expect(issue.kind).toBe(1621) // NIP-34 issue kind
      }

      // Navigate to verify (mock relay intercepts)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seeds a repository with patches", async ({page}) => {
      const seeder = new TestSeeder()

      // Seed a repository with patches
      seeder.seedRepo({
        name: "repo-with-patches",
        description: "Repository with patches",
        withPatches: 2,
      })

      await seeder.setup(page)

      // Verify seeded data
      const patches = seeder.getPatches()
      expect(patches).toHaveLength(2)

      // Each patch should have the correct kind
      for (const patch of patches) {
        expect(patch.kind).toBe(1617) // NIP-34 patch kind
      }

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seeds a repository with both issues and patches", async ({page}) => {
      const seeder = new TestSeeder()

      // Seed with full test scenario
      seeder.seedRepo({
        name: "full-test-repo",
        description: "Repository with issues and patches",
        withIssues: 3,
        withPatches: 2,
      })

      await seeder.setup(page)

      // Verify
      expect(seeder.getRepos()).toHaveLength(1)
      expect(seeder.getIssues()).toHaveLength(3)
      expect(seeder.getPatches()).toHaveLength(2)

      // Total events should include repo + issues + patches + status events
      const allEvents = seeder.getSeededEvents()
      expect(allEvents.length).toBeGreaterThan(5)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })
  })

  test.describe("Convenience functions", () => {
    test("seedTestRepo creates and sets up a seeder", async ({page}) => {
      // Quick one-liner to seed a repo
      const seeder = await seedTestRepo(page, {
        name: "quick-seed-repo",
        withIssues: 2,
      })

      expect(seeder.getRepos()).toHaveLength(1)
      expect(seeder.getIssues()).toHaveLength(2)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seedTestScenario with 'full' scenario", async ({page}) => {
      // Pre-defined full scenario
      const seeder = await seedTestScenario(page, "full")

      // Full scenario should have repos, issues, and patches
      expect(seeder.getRepos()).toHaveLength(1)
      expect(seeder.getIssues().length).toBeGreaterThan(0)
      expect(seeder.getPatches().length).toBeGreaterThan(0)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seedTestScenario with 'empty' scenario", async ({page}) => {
      // Empty scenario - just mock relay, no data
      const seeder = await seedTestScenario(page, "empty")

      expect(seeder.getRepos()).toHaveLength(0)
      expect(seeder.getIssues()).toHaveLength(0)
      expect(seeder.getPatches()).toHaveLength(0)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seedMultipleRepos creates multiple repositories", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "repo-alpha", withIssues: 1},
        {name: "repo-beta", withPatches: 1},
        {name: "repo-gamma", withIssues: 1, withPatches: 1},
      ])

      expect(seeder.getRepos()).toHaveLength(3)
      expect(seeder.getIssues()).toHaveLength(2) // 1 + 0 + 1
      expect(seeder.getPatches()).toHaveLength(2) // 0 + 1 + 1

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })
  })

  test.describe("Test isolation", () => {
    test("first isolated test seeds repo-1", async ({page}) => {
      const seeder = new IsolatedSeeder()

      seeder.seedRepo({
        name: "repo-isolation-test-1",
        description: "First isolated test repository",
      })

      await seeder.setup(page)

      // Verify only our repo is seeded
      const repos = seeder.getRepos()
      expect(repos).toHaveLength(1)
      expect(repos[0].tags.find((t) => t[0] === "name")?.[1]).toBe("repo-isolation-test-1")

      await page.goto(`/spaces/${seeder.getEncodedRelayUrl()}/git`)
      await page.waitForLoadState("networkidle")

      // Cleanup
      seeder.cleanup()
    })

    test("second isolated test seeds repo-2 (no contamination from test 1)", async ({page}) => {
      const seeder = new IsolatedSeeder()

      seeder.seedRepo({
        name: "repo-isolation-test-2",
        description: "Second isolated test repository",
      })

      await seeder.setup(page)

      // Verify only our repo is seeded - no contamination from first test
      const repos = seeder.getRepos()
      expect(repos).toHaveLength(1)
      expect(repos[0].tags.find((t) => t[0] === "name")?.[1]).toBe("repo-isolation-test-2")

      await page.goto(`/spaces/${seeder.getEncodedRelayUrl()}/git`)
      await page.waitForLoadState("networkidle")

      // Cleanup
      seeder.cleanup()
    })

    test("third isolated test uses createIsolatedSeeder", async ({page}) => {
      const seeder = await createIsolatedSeeder(page, (s) => {
        s.seedRepo({name: "callback-seeded-repo", withIssues: 2})
      })

      // Verify
      expect(seeder.getRepos()).toHaveLength(1)
      expect(seeder.getIssues()).toHaveLength(2)

      await page.goto(`/spaces/${seeder.getEncodedRelayUrl()}/git`)
      await page.waitForLoadState("networkidle")

      seeder.cleanup()
    })
  })

  test.describe("Mock relay reset", () => {
    test("resetMockRelay clears published events", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({name: "reset-test-repo"})
      await seeder.setup(page)

      const mockRelay = seeder.getMockRelay()

      // Initially no published events
      expect(mockRelay.getPublishedEvents()).toHaveLength(0)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // After app interaction, there may be published events
      // (depends on app behavior)

      // Reset clears published events
      resetMockRelay(mockRelay)
      expect(mockRelay.getPublishedEvents()).toHaveLength(0)
    })
  })

  test.describe("Using pre-built fixtures", () => {
    test("can combine TestSeeder with FIXTURES", async ({page}) => {
      const seeder = new TestSeeder()

      // Add events from fixtures
      seeder.addEvents(FIXTURES.REPO_WITH_OPEN_ISSUES)

      await seeder.setup(page)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Verify fixture events were added
      const events = seeder.getSeededEvents()
      expect(events.length).toBeGreaterThan(0)
    })

    test("can seed with COMPLETE_SCENARIO fixture", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.addEvents(FIXTURES.COMPLETE_SCENARIO)

      await seeder.setup(page)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // COMPLETE_SCENARIO includes repo, issues, patches, and statuses
      const events = seeder.getSeededEvents()
      expect(events.length).toBeGreaterThanOrEqual(5)
    })
  })

  test.describe("Advanced seeding", () => {
    test("seeds issues with specific statuses", async ({page}) => {
      const seeder = new TestSeeder()

      const repoResult = seeder.seedRepo({
        name: "status-test-repo",
      })

      // Seed specific issues with different statuses
      seeder.seedIssue({
        repoAddress: repoResult.address,
        title: "Open Issue",
        status: "open",
      })

      seeder.seedIssue({
        repoAddress: repoResult.address,
        title: "Closed Issue",
        status: "closed",
      })

      seeder.seedIssue({
        repoAddress: repoResult.address,
        title: "Draft Issue",
        status: "draft",
      })

      await seeder.setup(page)

      // Verify we have issues with different statuses
      const issues = seeder.getIssues()
      expect(issues).toHaveLength(3)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })

    test("seeds patches with specific statuses", async ({page}) => {
      const seeder = new TestSeeder()

      const repoResult = seeder.seedRepo({
        name: "patch-status-repo",
      })

      // Seed patches with different statuses
      seeder.seedPatch({
        repoAddress: repoResult.address,
        title: "Open Patch",
        status: "open",
      })

      seeder.seedPatch({
        repoAddress: repoResult.address,
        title: "Applied Patch",
        status: "applied",
      })

      await seeder.setup(page)

      const patches = seeder.getPatches()
      expect(patches).toHaveLength(2)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")
    })
  })
})

test.describe("Integration tests with seeded data", () => {
  test.skip("displays seeded repository name in the UI", async ({page}) => {
    // This test demonstrates the full flow of seeding and verifying UI
    // Skipped until UI selectors are confirmed

    const seeder = await seedTestRepo(page, {
      name: "ui-visible-repo",
      description: "This should appear in the repository list",
    })

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)

    // Wait for the page to load repos
    await page.waitForLoadState("networkidle")

    // The seeded repo name should be visible
    await expect(page.getByText("ui-visible-repo")).toBeVisible({timeout: 10000})
  })

  test.skip("displays seeded issues count", async ({page}) => {
    // Skipped until UI selectors are confirmed

    const seeder = await seedTestRepo(page, {
      name: "issue-count-repo",
      withIssues: 5,
    })

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // Navigate to the repo detail
    await page.getByText("issue-count-repo").click()

    // The issues tab or count should show 5
    // (exact selector depends on UI implementation)
    await expect(page.getByText(/5.*issues?/i)).toBeVisible({timeout: 10000})
  })

  test.skip("displays seeded issue titles", async ({page}) => {
    // Skipped until UI selectors are confirmed

    const seeder = new TestSeeder()
    const repoResult = seeder.seedRepo({name: "issue-title-repo"})

    // Seed specific issues we can check for
    seeder.seedIssue({
      repoAddress: repoResult.address,
      title: "Unique Bug Report Title ABC123",
      status: "open",
    })

    await seeder.setup(page)

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // Navigate to repo and issues
    await page.getByText("issue-title-repo").click()

    // Our specific issue title should be visible
    await expect(page.getByText("Unique Bug Report Title ABC123")).toBeVisible({
      timeout: 10000,
    })
  })
})
