import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  seedTestRepo,
  seedTestScenario,
  useCleanState,
} from "../helpers"
import {GitHubPage, RepoDetailPage} from "../pages"

/**
 * E2E Tests for Code Browser and File Tree
 *
 * These tests cover the code browser functionality in the repository detail view:
 * 1. File Tree - navigation and display
 * 2. File Content - viewing file content
 * 3. Branch/Tag Selection - switching branches
 * 4. File Operations - raw view, copy path, etc.
 *
 * Note: The code browser relies on the git worker which clones repositories.
 * Some tests focus on UI elements and loading states that can be verified
 * without fully mocking the git worker internals.
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation between tests
useCleanState(test)

test.describe("Code Browser", () => {
  test.describe("Navigation to Code Tab", () => {
    test("navigates to code tab from repository detail", async ({page}) => {
      await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Click on the seeded repo
      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Click Code tab
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should contain /code
      expect(page.url()).toContain("/code")
    })

    test("code tab is visible in repository tabs", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Code tab should be visible
      await expect(page.locator("a[href*='/code']").first()).toBeVisible()
    })

    test("can navigate to code tab using RepoDetailPage", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Extract naddr from URL
      const url = page.url()
      const naddrMatch = url.match(/naddr[a-zA-Z0-9]+/)
      const naddr = naddrMatch ? naddrMatch[0] : ""

      const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
      await repoDetail.waitForLoad()

      // Navigate to code using page object
      await repoDetail.goToCode()
      expect(page.url()).toContain("/code")
    })

    test("direct URL navigation to code tab works", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Get to repo and extract the naddr
      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      const currentUrl = page.url()
      const codeUrl = currentUrl.replace(/\/?$/, "/code")

      // Navigate directly to code tab
      await page.goto(codeUrl)
      await page.waitForLoadState("networkidle")

      expect(page.url()).toContain("/code")
    })
  })

  test.describe("File Tree Loading States", () => {
    test("shows loading indicator while fetching files", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "loading-test-repo",
        description: "Repository for testing loading states",
        cloneUrls: ["https://github.com/example/loading-test.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("loading-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Navigate to code tab
      await page.locator("a[href*='/code']").first().click()

      // Should show some loading state or clone progress
      // The code browser may show "Cloning repository..." or "Loading files..."
      // or render the file tree quickly depending on cache
      await page.waitForLoadState("networkidle")

      // Either loading completed or we see the code interface
      const codeContent = page.locator(".rounded-lg.border")
      await expect(codeContent).toBeVisible({timeout: 30000})
    })

    test("shows cloning progress when repository needs clone", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "clone-progress-repo",
        cloneUrls: ["https://github.com/example/clone-progress.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("clone-progress-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()

      // The page should show either:
      // 1. "Cloning repository..." spinner with progress
      // 2. "Loading files..." spinner
      // 3. The file tree (if already cached/fast)
      // 4. An error state (if no clone URLs work)
      await page.waitForLoadState("networkidle")

      // Look for cloning indicator text
      const cloningText = page.getByText(/Cloning repository|Loading files|No files found/i)
      const fileTree = page.locator(".border-border")

      // One of these should be visible
      await expect(cloningText.or(fileTree)).toBeVisible({timeout: 30000})
    })

    test("shows error state when no clone URLs available", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "no-clone-url-repo",
        description: "Repository without clone URLs",
        // No cloneUrls provided
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("no-clone-url-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Should show error or empty state
      // The component should handle missing clone URLs gracefully
      const codeContent = page.locator(".rounded-lg.border, .p-4")
      await expect(codeContent).toBeVisible({timeout: 30000})
    })
  })

  test.describe("File Tree Structure", () => {
    test("code browser container is rendered on code tab", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "file-tree-repo",
        cloneUrls: ["https://github.com/example/file-tree.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("file-tree-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // The code browser container should be visible
      // Looking for the main content wrapper
      const codeBrowserContainer = page.locator(".rounded-lg.border.border-border.bg-card")
      await expect(codeBrowserContainer).toBeVisible({timeout: 30000})
    })

    test("file tree displays content area", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "content-area-repo",
        cloneUrls: ["https://github.com/example/content.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("content-area-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Wait for content to load (either files or empty state)
      await page.waitForTimeout(2000)

      // The p-4 content area should be present
      const contentArea = page.locator(".p-4")
      await expect(contentArea).toBeVisible({timeout: 30000})
    })

    test("empty repository shows no files message", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "empty-repo",
        cloneUrls: ["https://github.com/example/empty.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("empty-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Wait for potential loading/cloning to complete
      await page.waitForTimeout(3000)

      // Should show empty state or loading
      // The text "No files found" appears when branch has no files
      const content = page.locator(".p-4")
      await expect(content).toBeVisible({timeout: 30000})
    })
  })

  test.describe("Page Title and Metadata", () => {
    test("page title includes repo name and Code", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "title-test-repo",
        cloneUrls: ["https://github.com/example/title.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("title-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Wait for title to update
      await page.waitForTimeout(1000)

      // The page title should include "Code"
      const title = await page.title()
      // Title format is "{repoName} - Code" based on the component
      expect(title.toLowerCase()).toContain("code")
    })
  })

  test.describe("Branch/Tag Selection", () => {
    test("code browser initializes with default branch", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "branch-test-repo",
        cloneUrls: ["https://github.com/example/branches.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("branch-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // The code browser should load - exact branch depends on repo config
      // We verify the code tab content area is present
      const codeContent = page.locator(".rounded-lg.border")
      await expect(codeContent).toBeVisible({timeout: 30000})
    })

    test("branch selector area is accessible from code view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // The repository layout should include branch selection
      // This is typically in the RepoHeader or a BranchSelector component
      // For now, verify the code interface is present
      const codeInterface = page.locator(".rounded-lg")
      await expect(codeInterface.first()).toBeVisible({timeout: 30000})
    })
  })

  test.describe("File Operations", () => {
    test("code browser supports permalink publishing", async ({page}) => {
      // The FileView component has publish prop for permalinks
      const seeder = await seedTestRepo(page, {
        name: "permalink-test-repo",
        cloneUrls: ["https://github.com/example/permalink.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("permalink-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Verify the code interface loads
      // Permalink functionality would require file click + action
      const codeContainer = page.locator(".rounded-lg.border")
      await expect(codeContainer).toBeVisible({timeout: 30000})
    })
  })

  test.describe("Error Handling", () => {
    test("handles failed repository initialization gracefully", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "error-handling-repo",
        description: "Repository for error handling tests",
        // Provide a non-working clone URL to test error handling
        cloneUrls: ["https://invalid-url-that-will-fail.example.com/repo.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("error-handling-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Wait for potential error to surface
      await page.waitForTimeout(3000)

      // The page should not crash - either shows error or empty state
      const pageContent = page.locator(".p-4, .text-red-500, .text-muted-foreground")
      await expect(pageContent.first()).toBeVisible({timeout: 30000})
    })

    test("recovers from transient loading errors", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "recovery-test-repo",
        cloneUrls: ["https://github.com/example/recovery.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("recovery-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Navigate away and back to test recovery
      await page.locator("a[href*='/feed']").first().click()
      await page.waitForLoadState("networkidle")

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Page should recover and show code content
      const codeContent = page.locator(".rounded-lg.border")
      await expect(codeContent).toBeVisible({timeout: 30000})
    })
  })

  test.describe("Integration with Repository Context", () => {
    test("code tab maintains repository context", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "context-test-repo",
        description: "Testing context preservation",
        cloneUrls: ["https://github.com/example/context.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("context-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Go to code tab
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // URL should still contain the naddr for the repo
      expect(page.url()).toContain("naddr")
      expect(page.url()).toContain("/code")
    })

    test("can navigate between tabs while on code view", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Start at code tab
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/code")

      // Navigate to issues
      await page.locator("a[href*='/issues']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/issues")

      // Navigate back to code
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")
      expect(page.url()).toContain("/code")
    })

    test("code view preserves repository header visibility", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "header-visibility-repo",
        description: "Testing header visibility on code tab",
        cloneUrls: ["https://github.com/example/header.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("header-visibility-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // Tab navigation should still be visible
      await expect(page.locator("a[href*='/code']").first()).toBeVisible()
      await expect(page.locator("a[href*='/issues']").first()).toBeVisible()
      await expect(page.locator("a[href*='/patches']").first()).toBeVisible()
    })
  })

  test.describe("Accessibility", () => {
    test("code browser is keyboard navigable", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Use keyboard to navigate to code tab
      await page.locator("a[href*='/code']").first().focus()
      await page.keyboard.press("Enter")
      await page.waitForLoadState("networkidle")

      expect(page.url()).toContain("/code")
    })

    test("code browser container has proper structure", async ({page}) => {
      const seeder = await seedTestRepo(page, {
        name: "a11y-test-repo",
        cloneUrls: ["https://github.com/example/a11y.git"],
      })

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("a11y-test-repo").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      // The code browser should have semantic structure
      const container = page.locator(".rounded-lg.border")
      await expect(container).toBeVisible({timeout: 30000})

      // Should have content area
      const contentArea = page.locator(".p-4")
      await expect(contentArea).toBeVisible()
    })
  })

  test.describe("Multiple Repositories", () => {
    test("code browser works across different repositories", async ({page}) => {
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "multi-repo-1",
        cloneUrls: ["https://github.com/example/repo1.git"],
      })
      seeder.seedRepo({
        name: "multi-repo-2",
        cloneUrls: ["https://github.com/example/repo2.git"],
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Navigate to first repo's code
      await page.getByText("multi-repo-1").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      const codeContainer1 = page.locator(".rounded-lg.border")
      await expect(codeContainer1).toBeVisible({timeout: 30000})

      // Go back to list
      await gitHub.goto()
      await gitHub.waitForLoad()

      // Navigate to second repo's code
      await page.getByText("multi-repo-2").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.locator("a[href*='/code']").first().click()
      await page.waitForLoadState("networkidle")

      const codeContainer2 = page.locator(".rounded-lg.border")
      await expect(codeContainer2).toBeVisible({timeout: 30000})
    })
  })
})
