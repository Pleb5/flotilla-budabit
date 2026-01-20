import {test, expect} from "@playwright/test"
import {GitHubPage} from "../pages/git-hub.page"

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
 */

// Test relay for git pages - using localhost for local development
const TEST_RELAY = "localhost:7777"

test.describe("git navigation", () => {
  test("navigates to git hub page and verifies page loads", async ({page}) => {
    // The storage state is automatically loaded from auth.setup.ts
    // via the storageState configuration in playwright.config.ts

    // Navigate to the home page first to verify auth state is restored
    await page.goto("/")

    // Verify the user is authenticated (identity should be visible)
    const identityStatus = page.getByTestId("identity-status")
    await expect(identityStatus).toBeVisible()
    await expect(identityStatus).toContainText("npub")

    // Navigate to git hub page using the page object
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Verify the page has loaded
    await expect(gitHubPage.pageTitle).toBeVisible()
    await expect(page).toHaveTitle(/flotilla/i)
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

    // Verify authenticated
    const identityStatus = page.getByTestId("identity-status")
    await expect(identityStatus).toBeVisible()
    const identityText = await identityStatus.innerText()
    expect(identityText).toContain("npub")

    // Navigate to git hub page
    const gitHubPage = new GitHubPage(page, TEST_RELAY)
    await gitHubPage.goto()

    // Verify identity persists
    await expect(identityStatus).toBeVisible()
    await expect(identityStatus).toContainText(identityText.trim())

    // Navigate back to home
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Verify identity still persists
    await expect(identityStatus).toBeVisible()
    await expect(identityStatus).toContainText(identityText.trim())
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
