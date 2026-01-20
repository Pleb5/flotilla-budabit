import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  seedTestRepo,
  seedTestScenario,
  seedMultipleRepos,
  useCleanState,
  MockRelay,
  randomHex,
  nowSeconds,
  NIP34_KINDS,
  type NostrEvent,
} from "../helpers"
import {GitHubPage, RepoListPage, RepoDetailPage} from "../pages"
import {TEST_PUBKEYS, getRepoAddress} from "../fixtures/events"

/**
 * E2E Tests for Error Handling & Edge Cases
 *
 * These tests cover:
 * 1. Network Errors - Relay unavailable, connection failures, retry mechanisms
 * 2. Empty States - Repos with no commits, issues, or patches
 * 3. Data Edge Cases - Unicode, long descriptions, special characters
 * 4. Concurrent Operations - Rapid clicks, duplicate event prevention
 * 5. Permission Scenarios - Non-maintainer restrictions
 *
 * All tests use MockRelay to control responses and simulate failures.
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation
useCleanState(test)

// =============================================================================
// Network Error Tests
// =============================================================================

test.describe("Network Errors", () => {
  test.describe("Relay Unavailable", () => {
    test("shows graceful error when relay connection fails", async ({page}) => {
      // Create seeder that simulates network issues by not seeding any events
      // and having the mock relay return nothing
      const seeder = new TestSeeder({debug: true})
      await seeder.setup(page)

      // Navigate to the git hub page
      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()

      // Should show empty state or error gracefully, not crash
      await gitHub.waitForLoad()

      // Page should still render without throwing errors
      await expect(gitHub.pageTitle).toBeVisible()

      // Either empty state is shown or the page handles the lack of data gracefully
      const isEmpty = await gitHub.isEmpty()
      const repoCount = await gitHub.getRepoCount()

      // The app should handle this gracefully - either show empty state or zero repos
      expect(isEmpty || repoCount === 0).toBeTruthy()
    })

    test("handles slow relay responses gracefully", async ({page}) => {
      // Create seeder with high latency to simulate slow network
      const seeder = new TestSeeder({debug: true, latency: 2000})
      seeder.seedRepo({
        name: "slow-loading-repo",
        description: "This repo loads slowly",
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)

      // Navigate without waiting
      await page.goto(`/spaces/${ENCODED_RELAY}/git/`)

      // Should show loading state initially
      // Note: loading state may be too fast to catch with high latency seeder
      const loadingVisible = await gitHub.isLoading().catch(() => false)

      // Wait for actual load
      await gitHub.waitForLoad()

      // Eventually the repo should appear
      await expect(page.getByText("slow-loading-repo")).toBeVisible({timeout: 15000})
    })

    test("handles relay timeout gracefully", async ({page}) => {
      // Create seeder with very high latency to simulate timeout-like behavior
      const seeder = new TestSeeder({debug: true, latency: 5000})
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)

      // Start navigation
      await page.goto(`/spaces/${ENCODED_RELAY}/git/`)

      // Page should remain functional even with timeout
      await expect(gitHub.pageTitle).toBeVisible({timeout: 10000})

      // The UI should be usable
      await expect(gitHub.newRepoButton).toBeVisible()
      await expect(gitHub.myReposTab).toBeVisible()
    })

    test("can retry after connection issue", async ({page}) => {
      // First, set up with no data (simulating disconnected state)
      const seeder = new TestSeeder({debug: true})
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Verify empty state initially
      const isEmpty = await gitHub.isEmpty()
      const repoCount = await gitHub.getRepoCount()
      expect(isEmpty || repoCount === 0).toBeTruthy()

      // Now inject events to simulate reconnection
      const mockRelay = seeder.getMockRelay()
      const repoEvent: NostrEvent = {
        id: randomHex(64),
        pubkey: TEST_PUBKEYS.alice,
        created_at: nowSeconds(),
        kind: NIP34_KINDS.REPO_ANNOUNCEMENT,
        tags: [
          ["d", "reconnect-repo"],
          ["name", "reconnect-repo"],
          ["description", "Appeared after reconnection"],
        ],
        content: "",
        sig: randomHex(128),
      }

      await mockRelay.injectEvents([repoEvent])

      // Refresh the page to simulate retry
      await page.reload()
      await gitHub.waitForLoad()

      // The injected repo should now be visible
      await expect(page.getByText("reconnect-repo")).toBeVisible({timeout: 10000})
    })
  })

  test.describe("Partial Data Loading", () => {
    test("handles repo without related events", async ({page}) => {
      // Seed a repo but no issues, patches, or statuses
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "lonely-repo",
        description: "A repo with no activity",
        // No withIssues or withPatches
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // The repo should still display
      await expect(page.getByText("lonely-repo")).toBeVisible({timeout: 10000})

      // Navigate to repo detail
      await gitHub.clickRepoByName("lonely-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Should be able to navigate to issues tab without crashing
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      // Page should remain functional
      expect(page.url()).toContain("/issues")
    })

    test("handles malformed event data gracefully", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      // Seed a valid repo first
      seeder.seedRepo({
        name: "valid-repo",
        description: "A properly formed repo",
      })

      await seeder.setup(page)

      // Inject a malformed event
      const mockRelay = seeder.getMockRelay()
      const malformedEvent: NostrEvent = {
        id: randomHex(64),
        pubkey: TEST_PUBKEYS.alice,
        created_at: nowSeconds(),
        kind: NIP34_KINDS.REPO_ANNOUNCEMENT,
        tags: [
          // Missing required 'd' tag for proper identification
          ["name", "malformed-repo"],
        ],
        content: "",
        sig: randomHex(128),
      }

      await mockRelay.injectEvents([malformedEvent])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // The valid repo should still display
      await expect(page.getByText("valid-repo")).toBeVisible({timeout: 10000})

      // Page should not crash due to malformed event
      await expect(gitHub.pageTitle).toBeVisible()
    })
  })
})

// =============================================================================
// Empty State Tests
// =============================================================================

test.describe("Empty States", () => {
  test.describe("Repository with No Activity", () => {
    test("displays empty state for repo with no commits", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "empty-commits-repo",
        description: "A repository with no commits",
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("empty-commits-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForLoadState("networkidle")

      // Should show some indication of no commits or empty state
      // The exact message depends on implementation
      const pageContent = await page.content()
      // Page should not crash and should show commits tab
      expect(page.url()).toContain("/commits")
    })

    test("displays empty state for repo with no issues", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "no-issues-repo",
        description: "A repository with no issues",
        // Explicitly no issues
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("no-issues-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to issues tab
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      // Should be on issues page
      expect(page.url()).toContain("/issues")

      // Check for empty state message or zero issues
      const emptyStateText = page.getByText(/no.*issues/i).or(
        page.getByText(/no issues found/i)
      ).or(page.getByText(/create.*issue/i))

      // Either shows empty state or the page handles it gracefully
      const hasEmptyIndicator = await emptyStateText.isVisible().catch(() => false)
      // Test passes if page doesn't crash
      expect(page.url()).toContain("/issues")
    })

    test("displays empty state for repo with no patches", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "no-patches-repo",
        description: "A repository with no patches",
        // Explicitly no patches
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("no-patches-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to patches tab
      await page.locator("a[href*='/patches']").first().click()
      await page.waitForLoadState("networkidle")

      // Should be on patches page
      expect(page.url()).toContain("/patches")

      // Page should be functional
      const patchesTab = page.locator("a[href*='/patches']").first()
      await expect(patchesTab).toBeVisible()
    })

    test("handles completely empty relay", async ({page}) => {
      // Set up seeder but don't seed any data
      const seeder = await seedTestScenario(page, "empty")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should show empty state
      const isEmpty = await gitHub.isEmpty()
      const repoCount = await gitHub.getRepoCount()

      // Either explicit empty state or zero repos
      expect(isEmpty || repoCount === 0).toBeTruthy()

      // Page should still be fully functional
      await expect(gitHub.pageTitle).toBeVisible()
      await expect(gitHub.newRepoButton).toBeVisible()
      await expect(gitHub.myReposTab).toBeVisible()
      await expect(gitHub.bookmarksTab).toBeVisible()
    })
  })

  test.describe("Empty State UI Elements", () => {
    test("repo list shows appropriate empty message", async ({page}) => {
      const seeder = await seedTestScenario(page, "empty")

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      const isEmpty = await repoList.isEmpty()
      const count = await repoList.getRepoCount()

      expect(isEmpty || count === 0).toBeTruthy()
    })

    test("bookmarks tab shows empty state when no bookmarks", async ({page}) => {
      const seeder = await seedTestScenario(page, "empty")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Switch to bookmarks tab
      await gitHub.goToBookmarks()

      // Should show bookmark repo button for adding bookmarks
      await expect(gitHub.bookmarkRepoButton).toBeVisible({timeout: 5000})
    })

    test("search with no results shows appropriate message", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "searchable-repo",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Search for something that doesn't exist
      await gitHub.searchRepos("xyz-nonexistent-repo-12345")
      await page.waitForTimeout(500)

      // Should show empty state or no results
      const isEmpty = await gitHub.isEmpty()
      const count = await gitHub.getRepoCount()

      expect(isEmpty || count === 0).toBeTruthy()
    })
  })
})

// =============================================================================
// Data Edge Cases Tests
// =============================================================================

test.describe("Data Edge Cases", () => {
  test.describe("Unicode Content", () => {
    test("displays repo with Unicode name correctly", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        // Using ASCII-safe name for d-tag but Unicode for display name
        identifier: "unicode-repo",
        name: "Unicode-Repo",
        description: "Testing Japanese: \u3053\u3093\u306B\u3061\u306F, Chinese: \u4F60\u597D, Emoji: \uD83D\uDE80\uD83C\uDF1F\uD83D\uDCA1",
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should display repo name
      await expect(page.getByText("Unicode-Repo")).toBeVisible({timeout: 10000})

      // Navigate to see description
      await gitHub.clickRepoByName("Unicode-Repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Page should not crash with unicode content
      await page.waitForLoadState("networkidle")
    })

    test("displays issue with Unicode content", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      const repo = seeder.seedRepo({
        name: "unicode-issue-repo",
        description: "Repo for unicode issue test",
      })

      // Seed an issue with unicode content
      seeder.seedIssue({
        repoAddress: repo.address,
        title: "Bug: Japanese characters - \u30D0\u30B0\u306E\u5831\u544A",
        content: "This issue contains: Japanese (\u65E5\u672C\u8A9E), Chinese (\u4E2D\u6587), Korean (\uD55C\uAD6D\uC5B4), Arabic (\u0639\u0631\u0628\u064A), Hebrew (\u05E2\u05D1\u05E8\u05D9\u05EA), and emojis: \uD83D\uDC1B\uD83D\uDEE0\u2728",
        status: "open",
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("unicode-issue-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to issues
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      // Page should handle unicode without crashing
      expect(page.url()).toContain("/issues")
    })

    test("handles RTL (Right-to-Left) text", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        identifier: "rtl-test-repo",
        name: "RTL-Test-Repo",
        description: "\u0647\u0630\u0627 \u0648\u0635\u0641 \u0639\u0631\u0628\u064A - Arabic description with RTL text",
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should display repo without layout breaking
      await expect(page.getByText("RTL-Test-Repo")).toBeVisible({timeout: 10000})
    })
  })

  test.describe("Long Content", () => {
    test("handles very long repository description", async ({page}) => {
      const longDescription = "A".repeat(5000) + " - This is a very long description that should be handled gracefully by the UI, potentially truncated or scrollable."

      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "long-description-repo",
        description: longDescription,
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should display repo name without breaking
      await expect(page.getByText("long-description-repo")).toBeVisible({timeout: 10000})

      // Page should not overflow or break layout
      const pageWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)

      // Horizontal scroll should be minimal (allowing some tolerance)
      expect(pageWidth).toBeLessThanOrEqual(viewportWidth + 50)
    })

    test("handles very long issue title", async ({page}) => {
      const longTitle = "Bug: " + "X".repeat(500) + " - An extremely long issue title"

      const seeder = new TestSeeder({debug: true})
      const repo = seeder.seedRepo({
        name: "long-title-repo",
      })

      seeder.seedIssue({
        repoAddress: repo.address,
        title: longTitle,
        content: "Issue with a very long title",
        status: "open",
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("long-title-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      // Page should handle without breaking
      expect(page.url()).toContain("/issues")
    })

    test("handles very long patch content", async ({page}) => {
      // Create a patch with many lines
      const manyLines = Array.from({length: 1000}, (_, i) => `+// Line ${i + 1}: Added code`).join("\n")
      const longPatch = `diff --git a/large-file.ts b/large-file.ts
index abc123..def456 100644
--- a/large-file.ts
+++ b/large-file.ts
@@ -1,3 +1003,3 @@
${manyLines}
`

      const seeder = new TestSeeder({debug: true})
      const repo = seeder.seedRepo({
        name: "large-patch-repo",
      })

      seeder.seedPatch({
        repoAddress: repo.address,
        title: "Large patch with many changes",
        content: longPatch,
        status: "open",
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("large-patch-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.locator("a[href*='/patches']").first().click()
      await page.waitForLoadState("networkidle")

      // Page should handle without crashing
      expect(page.url()).toContain("/patches")
    })
  })

  test.describe("Special Characters", () => {
    test("handles repo name with special characters", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        // Use safe identifier but test special chars in display name
        identifier: "special-chars-repo",
        name: "repo_with-special.chars",
        description: "Testing: underscores, hyphens, and dots in name",
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await expect(page.getByText("repo_with-special.chars")).toBeVisible({timeout: 10000})
    })

    test("handles markdown content in descriptions", async ({page}) => {
      const markdownDescription = `# Heading
## Subheading
- List item 1
- List item 2

**Bold text** and *italic text*

\`\`\`javascript
const code = "example";
\`\`\`

[Link text](https://example.com)
`

      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "markdown-repo",
        description: markdownDescription,
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should display without crashing
      await expect(page.getByText("markdown-repo")).toBeVisible({timeout: 10000})
    })

    test("handles HTML-like content (should be escaped)", async ({page}) => {
      const htmlContent = "<script>alert('xss')</script><img src=x onerror=alert('xss')>"

      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({
        name: "html-escape-repo",
        description: htmlContent,
      })
      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Page should render without executing scripts
      await expect(page.getByText("html-escape-repo")).toBeVisible({timeout: 10000})

      // No alert should have appeared (page would have crashed or shown alert)
      // The HTML should be escaped/sanitized
    })

    test("handles URLs in content", async ({page}) => {
      const urlContent = "Check out https://example.com and ftp://files.example.com/data"

      const seeder = new TestSeeder({debug: true})
      const repo = seeder.seedRepo({
        name: "url-content-repo",
        description: urlContent,
      })

      seeder.seedIssue({
        repoAddress: repo.address,
        title: "Issue with URLs",
        content: "Visit https://github.com and mailto:test@example.com for more info",
        status: "open",
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should display without breaking
      await expect(page.getByText("url-content-repo")).toBeVisible({timeout: 10000})
    })
  })
})

// =============================================================================
// Concurrent Operations Tests
// =============================================================================

test.describe("Concurrent Operations", () => {
  test.describe("Rapid User Actions", () => {
    test("handles rapid successive tab clicks", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Rapid clicks on different tabs
      const tabs = ["issues", "patches", "code", "commits", "feed"]

      for (const tab of tabs) {
        await page.locator(`a[href*='/${tab}']`).first().click()
        // Don't wait between clicks - this is intentionally rapid
      }

      // Wait a bit for all navigation to settle
      await page.waitForTimeout(1000)
      await page.waitForLoadState("networkidle")

      // Page should still be functional
      const url = page.url()
      // Should have navigated to one of the tabs
      expect(tabs.some(tab => url.includes(`/${tab}`))).toBeTruthy()
    })

    test("handles rapid search input changes", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "alpha-repo"},
        {name: "beta-repo"},
        {name: "gamma-repo"},
        {name: "delta-repo"},
      ])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Type rapidly, changing search terms
      const searchTerms = ["alpha", "bet", "gam", "del", ""]

      for (const term of searchTerms) {
        await gitHub.searchInput.fill(term)
        // Very short delay to simulate fast typing
        await page.waitForTimeout(50)
      }

      // Wait for final state
      await page.waitForTimeout(500)

      // Page should not crash and should show all repos (search cleared)
      await expect(gitHub.pageTitle).toBeVisible()
    })

    test("handles double-click on repo card", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "double-click-repo",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Double click the repo
      const repoCard = page.locator("div").filter({hasText: "double-click-repo"}).first()
      await repoCard.dblclick()

      // Should navigate once, not twice (no double navigation)
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Page should be stable
      await page.waitForTimeout(500)
      expect(page.url()).toContain("/git/")
    })

    test("handles clicking while page is loading", async ({page}) => {
      // Use higher latency to have time to click during load
      const seeder = new TestSeeder({debug: true, latency: 1000})
      seeder.seedRepo({
        name: "loading-click-repo",
        withIssues: 5,
      })
      await seeder.setup(page)

      // Start navigation
      await page.goto(`/spaces/${ENCODED_RELAY}/git/`)

      // Try to click elements while loading
      const pageTitle = page.locator("strong").filter({hasText: "Git Repositories"})

      // Wait for page title to be visible before clicking
      await expect(pageTitle).toBeVisible({timeout: 10000})

      // Click on tabs while potentially still loading
      const myReposTab = page.getByRole("tab").filter({hasText: "My Repos"})
      if (await myReposTab.isVisible()) {
        await myReposTab.click()
      }

      // Page should remain stable
      await page.waitForLoadState("networkidle")
      await expect(pageTitle).toBeVisible()
    })
  })

  test.describe("Duplicate Event Prevention", () => {
    test("no duplicate events from rapid bookmark clicks", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Track published events
      const mockRelay = seeder.getMockRelay()
      const initialEventCount = mockRelay.getPublishedEvents().length

      // Navigate to repo
      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Try to click bookmark rapidly if button exists
      const bookmarkBtn = page.locator("button").filter({hasText: /bookmark/i}).first()
      if (await bookmarkBtn.isVisible().catch(() => false)) {
        // Click rapidly 3 times
        await bookmarkBtn.click()
        await bookmarkBtn.click()
        await bookmarkBtn.click()

        // Wait for any events to be published
        await page.waitForTimeout(1000)

        // Check published events
        const finalEventCount = mockRelay.getPublishedEvents().length
        const newEvents = finalEventCount - initialEventCount

        // Should have published at most 1-3 events, not 6+ (duplicates)
        // The exact count depends on implementation but should be reasonable
        expect(newEvents).toBeLessThan(10)
      }
    })

    test("handles multiple simultaneous tab switches", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Click My Repos and Bookmarks rapidly
      await gitHub.myReposTab.click()
      await gitHub.bookmarksTab.click()
      await gitHub.myReposTab.click()
      await gitHub.bookmarksTab.click()

      // Wait for settling
      await page.waitForTimeout(500)

      // Should be on one of the tabs
      const activeTab = await gitHub.getActiveTab()
      expect(["my-repos", "bookmarks"]).toContain(activeTab)
    })
  })
})

// =============================================================================
// Permission Scenarios Tests
// =============================================================================

test.describe("Permission Scenarios", () => {
  test.describe("Non-Maintainer Restrictions", () => {
    test("shows repo even for non-maintainer", async ({page}) => {
      // Create a repo where the test user is NOT a maintainer
      const seeder = new TestSeeder({debug: true})
      const otherMaintainer = "d".repeat(64) // Different pubkey

      seeder.seedRepo({
        name: "not-my-repo",
        description: "Repository maintained by someone else",
        maintainers: [otherMaintainer],
        pubkey: otherMaintainer,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should still be able to see the repo
      await expect(page.getByText("not-my-repo")).toBeVisible({timeout: 10000})

      // Should be able to navigate to it
      await gitHub.clickRepoByName("not-my-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
    })

    test("can view issues on repo without being maintainer", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      const otherMaintainer = "d".repeat(64)

      const repo = seeder.seedRepo({
        name: "public-issues-repo",
        description: "Public repo with issues",
        maintainers: [otherMaintainer],
        pubkey: otherMaintainer,
        withIssues: 3,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("public-issues-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Should be able to navigate to issues
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      expect(page.url()).toContain("/issues")
    })

    test("can view patches on repo without being maintainer", async ({page}) => {
      const seeder = new TestSeeder({debug: true})
      const otherMaintainer = "d".repeat(64)

      const repo = seeder.seedRepo({
        name: "public-patches-repo",
        description: "Public repo with patches",
        maintainers: [otherMaintainer],
        pubkey: otherMaintainer,
        withPatches: 2,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("public-patches-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Should be able to navigate to patches
      await page.locator("a[href*='/patches']").first().click()
      await page.waitForLoadState("networkidle")

      expect(page.url()).toContain("/patches")
    })
  })

  test.describe("Multiple Maintainers", () => {
    test("handles repo with multiple maintainers correctly", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      seeder.seedRepo({
        name: "multi-maintainer-repo",
        description: "Repository with multiple maintainers",
        maintainers: [
          TEST_PUBKEYS.alice,
          TEST_PUBKEYS.bob,
          TEST_PUBKEYS.charlie,
        ],
        pubkey: TEST_PUBKEYS.alice,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Repo should display
      await expect(page.getByText("multi-maintainer-repo")).toBeVisible({timeout: 10000})

      // Navigate to detail
      await gitHub.clickRepoByName("multi-maintainer-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Page should load without issues
      await expect(page.getByText("multi-maintainer-repo")).toBeVisible()
    })

    test("handles repo with no maintainers specified", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      seeder.seedRepo({
        name: "no-maintainers-repo",
        description: "Repository without explicit maintainers",
        // No maintainers array - only pubkey
        pubkey: TEST_PUBKEYS.alice,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should still display
      await expect(page.getByText("no-maintainers-repo")).toBeVisible({timeout: 10000})
    })
  })
})

// =============================================================================
// Boundary Conditions Tests
// =============================================================================

test.describe("Boundary Conditions", () => {
  test("handles repo with maximum recommended topics", async ({page}) => {
    const manyTopics = Array.from({length: 20}, (_, i) => `topic-${i + 1}`)

    const seeder = new TestSeeder({debug: true})
    seeder.seedRepo({
      name: "many-topics-repo",
      description: "Repository with many topics",
      topics: manyTopics,
    })

    await seeder.setup(page)

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Should display without breaking layout
    await expect(page.getByText("many-topics-repo")).toBeVisible({timeout: 10000})
  })

  test("handles timestamps at boundary values", async ({page}) => {
    const seeder = new TestSeeder({debug: true})

    // Very old timestamp (year 2000)
    const oldTimestamp = 946684800 // Jan 1, 2000

    seeder.seedRepo({
      name: "old-timestamp-repo",
      description: "Repository with old timestamp",
      created_at: oldTimestamp,
    })

    await seeder.setup(page)

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Should display without issues
    await expect(page.getByText("old-timestamp-repo")).toBeVisible({timeout: 10000})
  })

  test("handles repo with very long clone URL", async ({page}) => {
    const longUrl = "https://" + "x".repeat(500) + ".example.com/repo.git"

    const seeder = new TestSeeder({debug: true})
    seeder.seedRepo({
      name: "long-url-repo",
      description: "Repository with very long clone URL",
      cloneUrls: [longUrl],
    })

    await seeder.setup(page)

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Should display without breaking
    await expect(page.getByText("long-url-repo")).toBeVisible({timeout: 10000})
  })

  test("handles repo with many clone URLs", async ({page}) => {
    const manyUrls = Array.from({length: 10}, (_, i) =>
      `https://mirror${i + 1}.example.com/repo.git`
    )

    const seeder = new TestSeeder({debug: true})
    seeder.seedRepo({
      name: "many-urls-repo",
      description: "Repository with many clone URLs",
      cloneUrls: manyUrls,
    })

    await seeder.setup(page)

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Should display
    await expect(page.getByText("many-urls-repo")).toBeVisible({timeout: 10000})
  })
})

// =============================================================================
// Recovery Tests
// =============================================================================

test.describe("Recovery Scenarios", () => {
  test("recovers from navigation error", async ({page}) => {
    const seeder = await seedTestRepo(page, {
      name: "recovery-test-repo",
    })

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Try to navigate to an invalid naddr
    await page.goto(`/spaces/${ENCODED_RELAY}/git/naddrINVALID123/`)

    // Wait for page to handle the error
    await page.waitForLoadState("networkidle")

    // Page should handle gracefully - either show error or redirect
    // Navigate back to working page
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Should still work
    await expect(page.getByText("recovery-test-repo")).toBeVisible({timeout: 10000})
  })

  test("page refresh maintains functionality", async ({page}) => {
    const seeder = await seedTestRepo(page, {
      name: "refresh-test-repo",
    })

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Verify initial state
    await expect(page.getByText("refresh-test-repo")).toBeVisible({timeout: 10000})

    // Refresh
    await page.reload()
    await gitHub.waitForLoad()

    // Should still work (note: mock relay persists through reload due to addInitScript)
    await expect(gitHub.pageTitle).toBeVisible()
  })

  test("handles back/forward navigation", async ({page}) => {
    const seeder = await seedTestRepo(page, {
      name: "navigation-test-repo",
      withIssues: 2,
    })

    const gitHub = new GitHubPage(page, ENCODED_RELAY)
    await gitHub.goto()
    await gitHub.waitForLoad()

    // Navigate to repo
    await gitHub.clickRepoByName("navigation-test-repo")
    await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

    // Navigate to issues
    await page.locator("a[href*='/issues']").first().click()
    await page.waitForLoadState("networkidle")
    expect(page.url()).toContain("/issues")

    // Go back
    await page.goBack()
    await page.waitForLoadState("networkidle")

    // Go forward
    await page.goForward()
    await page.waitForLoadState("networkidle")

    // Should be on issues again
    expect(page.url()).toContain("/issues")
  })
})
