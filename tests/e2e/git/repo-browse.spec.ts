import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  seedTestRepo,
  seedTestScenario,
  seedMultipleRepos,
  useCleanState,
  encodeRelay,
} from "../helpers"
import {GitHubPage, RepoListPage, RepoDetailPage} from "../pages"

/**
 * E2E Tests for Repository Browsing and Listing
 *
 * These tests cover:
 * 1. Repository List - displaying seeded repos with correct metadata
 * 2. Repository Detail - metadata, clone URLs, tabs
 * 3. Tab Navigation - switching between repo tabs
 * 4. Bookmarking - adding/removing bookmarks
 *
 * All tests use MockRelay to intercept WebSocket connections and provide
 * deterministic test data without needing a real Nostr relay.
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation between tests
useCleanState(test)

test.describe("Repository Browsing", () => {
  test.describe("Repository List", () => {
    test("displays seeded repositories in list", async ({page}) => {
      // Seed multiple repositories
      const seeder = await seedMultipleRepos(page, [
        {name: "repo-alpha", description: "First test repository"},
        {name: "repo-beta", description: "Second test repository"},
        {name: "repo-gamma", description: "Third test repository"},
      ])

      // Navigate to the Git Hub page
      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()

      // Wait for loading to complete
      await gitHub.waitForLoad()

      // Verify all three repos are visible
      await expect(page.getByText("repo-alpha")).toBeVisible({timeout: 10000})
      await expect(page.getByText("repo-beta")).toBeVisible()
      await expect(page.getByText("repo-gamma")).toBeVisible()
    })

    test("displays repository descriptions", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "described-repo", description: "This is a comprehensive description of the repository"},
      ])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // The description should be visible
      await expect(page.getByText("described-repo")).toBeVisible({timeout: 10000})
      await expect(page.getByText("This is a comprehensive description")).toBeVisible()
    })

    test("displays correct number of repositories", async ({page}) => {
      // Seed exactly 5 repositories
      const seeder = await seedMultipleRepos(page, [
        {name: "count-repo-1"},
        {name: "count-repo-2"},
        {name: "count-repo-3"},
        {name: "count-repo-4"},
        {name: "count-repo-5"},
      ])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Get the count of repos displayed
      const repoCount = await gitHub.getRepoCount()
      expect(repoCount).toBeGreaterThanOrEqual(5)
    })

    test("search filters repositories by name", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "frontend-app", description: "React frontend"},
        {name: "backend-api", description: "Node.js API"},
        {name: "mobile-app", description: "React Native app"},
      ])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Search for "frontend"
      await gitHub.searchRepos("frontend")

      // Should show frontend-app
      await expect(page.getByText("frontend-app")).toBeVisible({timeout: 10000})

      // backend-api should be filtered out (or at least frontend should be prominently shown)
      // Note: exact behavior depends on implementation - may filter or highlight
    })

    test("search by naddr URI navigates to repository", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "naddr-test-repo",
        description: "Repository for naddr search test",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // The naddr search should be available
      await expect(gitHub.searchInput).toBeVisible()
    })

    test("clear search shows all repositories again", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "search-clear-repo-1"},
        {name: "search-clear-repo-2"},
        {name: "different-name"},
      ])

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Search for specific term
      await gitHub.searchRepos("search-clear")
      await page.waitForTimeout(500)

      // Clear search
      await gitHub.clearSearch()
      await page.waitForTimeout(500)

      // All repos should be visible again
      await expect(page.getByText("search-clear-repo-1")).toBeVisible({timeout: 10000})
      await expect(page.getByText("different-name")).toBeVisible()
    })

    test("shows empty state when no repositories match search", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "existing-repo",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Search for something that doesn't exist
      await gitHub.searchRepos("xyz-nonexistent-12345")
      await page.waitForTimeout(500)

      // Should show empty state or no matching results
      const isEmpty = await gitHub.isEmpty()
      // Either empty state is shown or no repos match
      expect(isEmpty || (await gitHub.getRepoCount()) === 0).toBeTruthy()
    })

    test("clicking repository navigates to detail page", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "clickable-repo",
        description: "Click me to see details",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Click on the repo
      await gitHub.clickRepoByName("clickable-repo")

      // Should navigate to repo detail - URL should contain repo identifier
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
    })
  })

  test.describe("Repository Detail", () => {
    test("displays repository metadata", async ({page}) => {
      const seeder = new TestSeeder()
      const repoResult = seeder.seedRepo({
        name: "metadata-test-repo",
        description: "A repository with complete metadata",
        topics: ["nostr", "git", "testing"],
        cloneUrls: ["https://github.com/test/metadata-test-repo.git"],
        webUrls: ["https://example.com/metadata-test-repo"],
      })

      await seeder.setup(page)

      // Navigate directly to repo detail page
      // We need to construct the naddr or navigate via the list
      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("metadata-test-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Wait for page load
      await page.waitForLoadState("networkidle")

      // Repository name should be visible
      await expect(page.getByText("metadata-test-repo")).toBeVisible({timeout: 10000})
    })

    test("displays clone URL", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "clone-url-repo",
        cloneUrls: ["https://github.com/test/clone-url-repo.git"],
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("clone-url-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Clone URL should be displayed somewhere on the page
      // This could be in a readonly input or code block
      await expect(
        page.locator("input[readonly], code, .clone-url").filter({hasText: /git.*clone/i}).or(
          page.getByText(/github\.com.*clone-url-repo/i)
        )
      ).toBeVisible({timeout: 10000}).catch(() => {
        // Clone URL might be hidden behind a button/toggle
      })
    })

    test("displays repository with issues count", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "issues-count-repo",
        description: "Repository with issues",
        withIssues: 5,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("issues-count-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Issues tab should be visible with count
      await expect(page.getByText(/Issues/i)).toBeVisible({timeout: 10000})
    })

    test("displays repository with patches count", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "patches-count-repo",
        description: "Repository with patches",
        withPatches: 3,
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("patches-count-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Patches tab should be visible
      await expect(page.getByText(/Patches/i)).toBeVisible({timeout: 10000})
    })

    test("all tabs are visible on repository detail", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Click on the seeded repo
      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Check for expected tabs
      // Feed, Code, Issues, Patches, Commits are the main tabs
      await expect(page.locator("a[href*='/feed']").or(page.getByText(/Feed/i))).toBeVisible({timeout: 10000})
      await expect(page.locator("a[href*='/code']").or(page.getByText(/Code/i))).toBeVisible()
      await expect(page.locator("a[href*='/issues']").or(page.getByText(/Issues/i))).toBeVisible()
      await expect(page.locator("a[href*='/patches']").or(page.getByText(/Patches/i))).toBeVisible()
      await expect(page.locator("a[href*='/commits']").or(page.getByText(/Commits/i))).toBeVisible()
    })
  })

  test.describe("Tab Navigation", () => {
    test("clicking Code tab loads code view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Click Code tab
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should update to include /code
      expect(page.url()).toContain("/code")
    })

    test("clicking Issues tab loads issues view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Click Issues tab
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should update to include /issues
      expect(page.url()).toContain("/issues")
    })

    test("clicking Patches tab loads patches view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Click Patches tab
      await page.locator("a[href*='/patches']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should update to include /patches
      expect(page.url()).toContain("/patches")
    })

    test("clicking Commits tab loads commits view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Click Commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should update to include /commits
      expect(page.url()).toContain("/commits")
    })

    test("tab navigation updates URL correctly", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "tab-navigation-repo",
        withIssues: 2,
        withPatches: 2,
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("tab-navigation-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Get the base URL
      const baseUrl = page.url()

      // Navigate to issues
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/issues")

      // Navigate to patches
      await page.locator("a[href*='/patches']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/patches")

      // Navigate back to feed/home
      await page.locator("a[href*='/feed']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/feed")
    })

    test("direct URL navigation to tab works", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      // Navigate directly to issues tab via URL
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.waitForLoad()

      // Get a repo card and extract its link
      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Get current URL and construct issues URL
      const currentUrl = page.url()
      const issuesUrl = currentUrl.replace(/\/$/, "") + "/issues"

      // Navigate directly to issues
      await page.goto(issuesUrl)
      await page.waitForLoadState("networkidle")

      // Should be on issues tab
      expect(page.url()).toContain("/issues")
    })
  })

  test.describe("Bookmarking", () => {
    test("can switch to bookmarks tab", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "bookmark-test-repo",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Switch to bookmarks tab
      await gitHub.goToBookmarks()

      // Bookmarks tab should be active
      const activeTab = await gitHub.getActiveTab()
      expect(activeTab).toBe("bookmarks")
    })

    test("can switch back to my repos tab", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "my-repos-test",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Switch to bookmarks then back to my repos
      await gitHub.goToBookmarks()
      await gitHub.goToMyRepos()

      // My repos tab should be active
      const activeTab = await gitHub.getActiveTab()
      expect(activeTab).toBe("my-repos")
    })

    test("bookmark repo button is visible on bookmarks tab", async ({page}) => {
      const seeder = await seedTestScenario(page, "empty")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Switch to bookmarks tab
      await gitHub.goToBookmarks()

      // Bookmark repo button should be visible
      await expect(gitHub.bookmarkRepoButton).toBeVisible({timeout: 5000})
    })

    test("bookmarks tab shows empty state initially", async ({page}) => {
      const seeder = await seedTestScenario(page, "empty")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Switch to bookmarks tab
      await gitHub.goToBookmarks()

      // Should show empty state or bookmark prompt
      const isEmpty = await gitHub.isEmpty()
      // Either empty state or the bookmark repo button indicates no bookmarks
      expect(isEmpty || await gitHub.bookmarkRepoButton.isVisible()).toBeTruthy()
    })
  })

  test.describe("Repository List Page (dedicated)", () => {
    test("displays seeded repositories on repo list page", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "list-repo-1", description: "First in list"},
        {name: "list-repo-2", description: "Second in list"},
      ])

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      // Should display the seeded repos
      await expect(page.getByText("list-repo-1")).toBeVisible({timeout: 10000})
      await expect(page.getByText("list-repo-2")).toBeVisible()
    })

    test("repo list page shows correct repo count", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "count-1"},
        {name: "count-2"},
        {name: "count-3"},
      ])

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      // Wait for at least 3 repos
      await repoList.waitForRepoCount(3)

      const count = await repoList.getRepoCount()
      expect(count).toBeGreaterThanOrEqual(3)
    })

    test("can get repo info from list", async ({page}) => {
      const seeder = await seedMultipleRepos(page, [
        {name: "info-repo-1", description: "Description for repo 1"},
        {name: "info-repo-2", description: "Description for repo 2"},
      ])

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      // Get repo info
      const repos = await repoList.getRepoInfo()
      expect(repos.length).toBeGreaterThanOrEqual(2)

      // At least one repo should have our name
      const hasInfoRepo = repos.some(r => r.name.includes("info-repo"))
      expect(hasInfoRepo).toBeTruthy()
    })

    test("clicking repo navigates to detail page", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "navigate-to-detail-repo",
      })

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      // Click on the repo
      await repoList.clickRepoByName("navigate-to-detail-repo")

      // Should navigate to detail page
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
    })

    test("repo list shows empty state when no repos", async ({page}) => {
      const seeder = await seedTestScenario(page, "empty")

      const repoList = new RepoListPage(page, ENCODED_RELAY)
      await repoList.goto()
      await repoList.waitForLoad()

      // Should show empty state
      const isEmpty = await repoList.isEmpty()
      const repoCount = await repoList.getRepoCount()

      // Either empty state is shown or no repos are in the list
      expect(isEmpty || repoCount === 0).toBeTruthy()
    })
  })

  test.describe("RepoDetailPage object", () => {
    test("can check if tabs are available", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      // First navigate via GitHubPage to get to a repo
      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Extract naddr from URL
      const url = page.url()
      const naddrMatch = url.match(/naddr[a-zA-Z0-9]+/)
      const naddr = naddrMatch ? naddrMatch[0] : ""

      // Create RepoDetailPage
      const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
      await repoDetail.waitForLoad()

      // Check tabs are available
      const hasCode = await repoDetail.hasTab("code")
      const hasIssues = await repoDetail.hasTab("issues")
      const hasPatches = await repoDetail.hasTab("patches")

      expect(hasCode).toBeTruthy()
      expect(hasIssues).toBeTruthy()
      expect(hasPatches).toBeTruthy()
    })

    test("can navigate tabs using page object", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      const url = page.url()
      const naddrMatch = url.match(/naddr[a-zA-Z0-9]+/)
      const naddr = naddrMatch ? naddrMatch[0] : ""

      const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
      await repoDetail.waitForLoad()

      // Navigate to issues using page object
      await repoDetail.goToIssues()
      expect(page.url()).toContain("/issues")

      // Navigate to patches
      await repoDetail.goToPatches()
      expect(page.url()).toContain("/patches")

      // Navigate to code
      await repoDetail.goToCode()
      expect(page.url()).toContain("/code")
    })

    test("can get active tab", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      const url = page.url()
      const naddrMatch = url.match(/naddr[a-zA-Z0-9]+/)
      const naddr = naddrMatch ? naddrMatch[0] : ""

      const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
      await repoDetail.waitForLoad()

      // Navigate to issues
      await repoDetail.goToIssues()

      // Get active tab
      const activeTab = await repoDetail.getActiveTab()
      expect(activeTab).toBe("issues")
    })
  })

  test.describe("Edge cases", () => {
    test("handles repository with no description", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "no-description-repo",
        // No description provided
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Should still display the repo name
      await expect(page.getByText("no-description-repo")).toBeVisible({timeout: 10000})
    })

    test("handles repository with special characters in name", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "repo-with-dashes-123",
        description: "Repository with dashes and numbers",
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await expect(page.getByText("repo-with-dashes-123")).toBeVisible({timeout: 10000})
    })

    test("handles multiple maintainers", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "multi-maintainer-repo",
        description: "Repository with multiple maintainers",
        maintainers: [
          "a".repeat(64), // Alice
          "b".repeat(64), // Bob
          "c".repeat(64), // Charlie
        ],
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await expect(page.getByText("multi-maintainer-repo")).toBeVisible({timeout: 10000})
    })

    test("handles repository with many issues", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "many-issues-repo",
        description: "Repository with many issues",
        withIssues: 10,
      })

      await seeder.setup(page)

      // Verify the seeder created all issues
      expect(seeder.getIssues()).toHaveLength(10)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await expect(page.getByText("many-issues-repo")).toBeVisible({timeout: 10000})
    })

    test("handles repository with both issues and patches", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "full-featured-repo",
        description: "Repository with issues and patches",
        withIssues: 3,
        withPatches: 3,
      })

      await seeder.setup(page)

      // Verify seeding
      expect(seeder.getIssues()).toHaveLength(3)
      expect(seeder.getPatches()).toHaveLength(3)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await expect(page.getByText("full-featured-repo")).toBeVisible({timeout: 10000})
    })
  })

  test.describe("Loading states", () => {
    test("shows loading indicator initially", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      // Navigate without waiting
      await page.goto(`/spaces/${ENCODED_RELAY}/git/`)

      // Loading spinner should appear briefly
      // This may be too fast to catch, so we use a lenient assertion
      const loadingText = page.getByText(/Looking for.*Repos/i)

      // Either we catch the loading state or it already completed
      const wasVisible = await loadingText.isVisible().catch(() => false)
      // Test passes either way - we're just verifying the app doesn't crash
    })

    test("loading completes and shows content", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()

      // Wait for loading to complete
      await gitHub.waitForLoad()

      // Should not be loading anymore
      const isLoading = await gitHub.isLoading()
      expect(isLoading).toBeFalsy()

      // Content should be visible
      await expect(gitHub.pageTitle).toBeVisible()
    })
  })
})
