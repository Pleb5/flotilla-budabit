import {expect, type Page, type Locator} from "@playwright/test"

/**
 * Git E2E Test Helpers
 *
 * Helper functions for navigating and interacting with git-related pages
 * in the flotilla-budabit application.
 */

// Default relay for testing - uses platform relays from env or falls back to localhost
const DEFAULT_TEST_RELAY = "ws://localhost:7000"

/**
 * Encodes a relay URL for use in route paths
 * Matches the encoding used by the app's router
 */
export function encodeRelay(url: string): string {
  return encodeURIComponent(url)
}

/**
 * Navigates to the main git landing page for a specific relay
 *
 * @param page - Playwright page object
 * @param relay - WebSocket relay URL (defaults to test relay)
 */
export async function navigateToGitHub(
  page: Page,
  relay: string = DEFAULT_TEST_RELAY,
): Promise<void> {
  const encodedRelay = encodeRelay(relay)
  await page.goto(`/spaces/${encodedRelay}/git`)
  await waitForGitLoad(page)
}

/**
 * Navigates to the repository list page for a specific relay
 *
 * @param page - Playwright page object
 * @param relay - WebSocket relay URL (defaults to test relay)
 */
export async function navigateToRepoList(
  page: Page,
  relay: string = DEFAULT_TEST_RELAY,
): Promise<void> {
  const encodedRelay = encodeRelay(relay)
  await page.goto(`/spaces/${encodedRelay}/git/repos`)
  await waitForGitLoad(page)
}

/**
 * Navigates to a specific repository page
 *
 * @param page - Playwright page object
 * @param relay - WebSocket relay URL
 * @param naddr - Nostr address (naddr1...) of the repository
 */
export async function navigateToRepo(
  page: Page,
  relay: string,
  naddr: string,
): Promise<void> {
  const encodedRelay = encodeRelay(relay)
  await page.goto(`/spaces/${encodedRelay}/git/${naddr}`)
  await waitForGitLoad(page)
}

/**
 * Navigates to a specific tab within a repository
 *
 * @param page - Playwright page object
 * @param relay - WebSocket relay URL
 * @param naddr - Nostr address of the repository
 * @param tab - Tab name (code, commits, issues, patches, feed, cicd, workbench)
 */
export async function navigateToRepoTab(
  page: Page,
  relay: string,
  naddr: string,
  tab: "code" | "commits" | "issues" | "patches" | "feed" | "cicd" | "workbench",
): Promise<void> {
  const encodedRelay = encodeRelay(relay)
  await page.goto(`/spaces/${encodedRelay}/git/${naddr}/${tab}`)
  await waitForGitLoad(page)
}

/**
 * Waits for the git page content to fully load
 *
 * This includes:
 * - Page navigation complete
 * - Web worker initialization (if applicable)
 * - Initial content rendered
 *
 * @param page - Playwright page object
 * @param options - Wait options
 */
export async function waitForGitLoad(
  page: Page,
  options: {
    timeout?: number
    waitForWorker?: boolean
  } = {},
): Promise<void> {
  const {timeout = 30000, waitForWorker = false} = options

  // Wait for the page to be in a stable state
  await page.waitForLoadState("domcontentloaded", {timeout})

  // Wait for any loading spinners to disappear
  const spinner = page.locator(".animate-spin, [data-testid='spinner']")
  if ((await spinner.count()) > 0) {
    await expect(spinner.first()).toBeHidden({timeout})
  }

  // If we need to wait for the git worker to be ready
  if (waitForWorker) {
    await waitForGitWorker(page, {timeout})
  }
}

/**
 * Waits for the git web worker to be initialized and ready
 *
 * @param page - Playwright page object
 * @param options - Wait options
 */
export async function waitForGitWorker(
  page: Page,
  options: {timeout?: number} = {},
): Promise<void> {
  const {timeout = 30000} = options

  // Wait for worker initialization by checking for a known side effect
  // The worker logs "[+page.svelte] Worker API initialized successfully" when ready
  await page.waitForFunction(
    () => {
      // Check if the worker has been initialized by looking for window state
      // or by checking if git operations are possible
      return (window as any).__gitWorkerReady === true
    },
    {timeout},
  ).catch(() => {
    // Worker ready flag might not be set, continue anyway
    console.log("Git worker ready check timed out, continuing...")
  })
}

/**
 * Gets all repository card elements on the current page
 *
 * @param page - Playwright page object
 * @returns Locator for repository card elements
 */
export function getRepoCards(page: Page): Locator {
  // Repository cards are rendered in a grid with specific structure
  // They contain GitItem components inside card containers
  return page.locator(".grid > div.rounded-md.border")
}

/**
 * Gets a specific repository card by its name
 *
 * @param page - Playwright page object
 * @param name - Repository name to search for
 * @returns Locator for the matching repository card
 */
export function getRepoCardByName(page: Page, name: string): Locator {
  return page.locator(".grid > div.rounded-md.border").filter({
    hasText: name,
  })
}

/**
 * Gets the repository name from a card element
 *
 * @param card - Locator for a repository card
 * @returns The repository name text
 */
export async function getRepoName(card: Locator): Promise<string> {
  const nameElement = card.locator("p.text-xl").first()
  return nameElement.innerText()
}

/**
 * Gets the repository description from a card element
 *
 * @param card - Locator for a repository card
 * @returns The repository description text
 */
export async function getRepoDescription(card: Locator): Promise<string> {
  const descElement = card.locator("p.text-lg").first()
  return descElement.innerText()
}

/**
 * Clicks on a repository card to navigate to it
 *
 * @param card - Locator for the repository card to click
 */
export async function clickRepoCard(card: Locator): Promise<void> {
  // Find the clickable link/button within the card
  const link = card.locator("a").first()
  await link.click()
}

/**
 * Waits for the repository list to load with at least the expected number of repos
 *
 * @param page - Playwright page object
 * @param minCount - Minimum number of repositories expected
 * @param timeout - Maximum time to wait
 */
export async function waitForRepoList(
  page: Page,
  minCount: number = 1,
  timeout: number = 30000,
): Promise<void> {
  await expect(getRepoCards(page)).toHaveCount(minCount, {timeout})
}

/**
 * Checks if the git page is showing a loading state
 *
 * @param page - Playwright page object
 * @returns True if loading indicators are visible
 */
export async function isGitLoading(page: Page): Promise<boolean> {
  const loadingIndicators = page.locator(
    ".animate-spin, [data-testid='spinner'], .animate-pulse",
  )
  return (await loadingIndicators.count()) > 0
}

/**
 * Waits for git page to stop loading
 *
 * @param page - Playwright page object
 * @param timeout - Maximum time to wait
 */
export async function waitForGitLoadComplete(
  page: Page,
  timeout: number = 30000,
): Promise<void> {
  // Wait for loading spinners to disappear
  await page.waitForFunction(
    () => {
      const spinners = document.querySelectorAll(
        ".animate-spin, [data-testid='spinner']",
      )
      return spinners.length === 0
    },
    {timeout},
  )
}

/**
 * Opens the "New Repo" wizard modal
 *
 * @param page - Playwright page object
 */
export async function openNewRepoWizard(page: Page): Promise<void> {
  const newRepoButton = page.getByRole("button", {name: /new repo/i})
  await expect(newRepoButton).toBeVisible()
  await newRepoButton.click()

  // Wait for the modal to appear
  // The wizard is rendered in a fullscreen modal
  await page.waitForSelector('[data-testid="new-repo-wizard"], .modal', {
    timeout: 10000,
  })
}

/**
 * Switches between "My Repos" and "Bookmarks" tabs on the git landing page
 *
 * @param page - Playwright page object
 * @param tab - Tab to switch to
 */
export async function switchGitTab(
  page: Page,
  tab: "my-repos" | "bookmarks",
): Promise<void> {
  const tabLabel = tab === "my-repos" ? "My Repos" : "Bookmarks"
  const tabButton = page.getByRole("tab", {name: new RegExp(tabLabel, "i")})
  await expect(tabButton).toBeVisible()
  await tabButton.click()

  // Wait for tab content to update
  await page.waitForTimeout(300)
}

/**
 * Searches for repositories using the search input
 *
 * @param page - Playwright page object
 * @param query - Search query (can be text or naddr)
 */
export async function searchRepos(page: Page, query: string): Promise<void> {
  const searchInput = page.getByPlaceholder(/paste naddr or search/i)
  await expect(searchInput).toBeVisible()
  await searchInput.fill(query)

  // Wait for search results to update
  await page.waitForTimeout(500)
}

/**
 * Clears the repository search input
 *
 * @param page - Playwright page object
 */
export async function clearRepoSearch(page: Page): Promise<void> {
  const searchInput = page.getByPlaceholder(/paste naddr or search/i)
  await searchInput.clear()
  await page.waitForTimeout(300)
}

/**
 * Gets the current page title from the PageBar component
 *
 * @param page - Playwright page object
 * @returns The page title text
 */
export async function getGitPageTitle(page: Page): Promise<string> {
  const title = page.locator("strong").first()
  return title.innerText()
}

/**
 * Asserts that the git repositories page is visible and loaded
 *
 * @param page - Playwright page object
 */
export async function assertGitPageLoaded(page: Page): Promise<void> {
  // Check for the page title
  await expect(page.locator("strong").first()).toContainText(/git/i)

  // Check that main content area exists
  await expect(page.locator(".flex.flex-col.gap-3")).toBeVisible()
}
