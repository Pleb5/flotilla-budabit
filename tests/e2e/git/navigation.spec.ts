import {test, expect, type Page} from "@playwright/test"
import {GitHubPage} from "../pages/git-hub.page"
import {RepoPage} from "../pages/repo.page"

/**
 * Git feature navigation tests.
 *
 * These tests verify that git-related routes load correctly
 * when the user is authenticated. They depend on the auth.setup.ts
 * project which provides the authenticated storage state.
 *
 * Extended timeouts are configured in playwright.config.ts:
 * - 60s action timeout for git operations
 * - 120s test timeout overall
 *
 * Performance thresholds:
 * - Tab switch: TEST_PERF_TIMEOUT env (default 3000ms)
 * - Repo load: TEST_PERF_TIMEOUT env (default 5000ms)
 */

// Test relay for git pages - using localhost for local development
const TEST_RELAY = "localhost:7777"

const TAB_SWITCH_THRESHOLD_MS = parseInt(
  process.env.TEST_PERF_TIMEOUT || "3000",
  10,
)
const REPO_LOAD_THRESHOLD_MS = parseInt(
  process.env.TEST_PERF_REPO_LOAD || process.env.TEST_PERF_TIMEOUT || "5000",
  10,
)

const getRepoPageFromFirstCard = async (page: Page): Promise<RepoPage> => {
  const gitHubPage = new GitHubPage(page, TEST_RELAY)
  await gitHubPage.goto()

  const repoCount = await gitHubPage.getRepoCount()
  if (repoCount === 0) {
    test.skip(true, "No repos available for performance test")
  }

  await gitHubPage.clickRepoByIndex(0)
  await page.waitForURL(/\/git\/[^/]+/)

  const url = new URL(page.url())
  const pathParts = url.pathname.split("/")
  const gitIdx = pathParts.indexOf("git")
  const repoPath = gitIdx >= 0 ? pathParts[gitIdx + 1] ?? "" : ""
  if (!repoPath) {
    test.skip(true, "Could not extract repo path")
  }

  return new RepoPage(page, TEST_RELAY, repoPath)
}

test.describe("git navigation", () => {
  test("navigates to git hub page and verifies page loads", async ({page}) => {
    // The storage state is automatically loaded from auth.setup.ts
    // via the storageState configuration in playwright.config.ts

    // Navigate to the home page first to verify auth state is restored
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Verify the user is authenticated by checking for nav element
    // (Landing page is shown when not authenticated, nav is shown when authenticated)
    const navElement = page.locator("nav, [class*='nav'], [class*='sidebar']").first()
    await expect(navElement).toBeVisible({timeout: 10000})

    // Navigate to git hub page using the page object
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Verify the page has loaded
    await expect(gitHubPage.pageTitle).toBeVisible()
    await expect(page).toHaveTitle(/git|repositories/i)
  })

  test("git hub page loads with tab navigation", async ({page}) => {
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Verify tab navigation is present
    await expect(gitHubPage.myReposTab).toBeVisible()
    await expect(gitHubPage.bookmarksTab).toBeVisible()

    // Verify page bar elements
    await expect(gitHubPage.pageTitle).toBeVisible()
    await expect(gitHubPage.newRepoButton).toBeVisible()
  })

  test("maintains auth state across git navigation", async ({page}) => {
    // Start at home
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Verify authenticated by checking for nav element
    const navElement = page.locator("nav, [class*='nav'], [class*='sidebar']").first()
    await expect(navElement).toBeVisible({timeout: 10000})

    // Navigate to git hub page
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Verify nav persists (auth state maintained)
    await expect(navElement).toBeVisible()

    // Navigate back to home
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Verify auth state still persists
    await expect(navElement).toBeVisible()
  })

  test("can switch between My Repos and Bookmarks tabs", async ({page}) => {
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Start on My Repos tab
    await gitHubPage.goToMyRepos()
    expect(await gitHubPage.getActiveTab()).toBe("my-repos")

    // Switch to Bookmarks tab
    await gitHubPage.goToBookmarks()
    expect(await gitHubPage.getActiveTab()).toBe("bookmarks")

    // Switch back to My Repos
    await gitHubPage.goToMyRepos()
    expect(await gitHubPage.getActiveTab()).toBe("my-repos")
  })
})

test.describe("git navigation performance", () => {
  test("repo tab switch to Issues completes within threshold", async ({page}) => {
    const repoPage = await getRepoPageFromFirstCard(page)

    const start = Date.now()
    await repoPage.gotoTab("issues")
    await repoPage.waitForTabContent("issues")
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(TAB_SWITCH_THRESHOLD_MS)
  })

  test("repo tab switch to Patches completes within threshold", async ({page}) => {
    const repoPage = await getRepoPageFromFirstCard(page)

    const start = Date.now()
    await repoPage.gotoTab("patches")
    await repoPage.waitForTabContent("patches")
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(TAB_SWITCH_THRESHOLD_MS)
  })

  test("repo tab switch to Code completes within threshold", async ({page}) => {
    const repoPage = await getRepoPageFromFirstCard(page)

    const start = Date.now()
    await repoPage.gotoTab("code")
    await repoPage.waitForTabContent("code")
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(TAB_SWITCH_THRESHOLD_MS)
  })

  test("repo tab switch to Commits completes within threshold", async ({page}) => {
    const repoPage = await getRepoPageFromFirstCard(page)

    const start = Date.now()
    await repoPage.gotoTab("commits")
    await repoPage.waitForTabContent("commits")
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(TAB_SWITCH_THRESHOLD_MS)
  })

  test("repo page loads repo metadata within threshold", async ({page}) => {
    const repoPage = await getRepoPageFromFirstCard(page)

    const start = Date.now()
    await repoPage.goto()
    await expect(repoPage.issuesTab).toBeVisible({timeout: 15000})
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(REPO_LOAD_THRESHOLD_MS)
  })
})
