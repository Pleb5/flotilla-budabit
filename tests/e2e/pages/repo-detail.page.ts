import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Valid tab values for the repository detail page
 */
export type RepoTab = "feed" | "code" | "issues" | "patches" | "commits" | "cicd" | "workbench"

/**
 * Page object for the Repository Detail page (/spaces/[relay]/git/[naddr]/)
 *
 * This page displays:
 * - Repository header with name, description, and actions
 * - Tab navigation (Feed, Code, Issues, Patches, Commits, etc.)
 * - Clone URL and repository metadata
 * - Content area that changes based on active tab
 */
export class RepoDetailPage {
  readonly page: Page
  readonly relay: string
  readonly naddr: string

  // Page elements
  readonly backButton: Locator
  readonly pageContent: Locator
  readonly repoHeader: Locator
  readonly loadingState: Locator
  readonly notFoundState: Locator

  // Header actions
  readonly refreshButton: Locator
  readonly forkButton: Locator
  readonly settingsButton: Locator
  readonly bookmarkButton: Locator

  // Tab navigation
  readonly feedTab: Locator
  readonly codeTab: Locator
  readonly issuesTab: Locator
  readonly patchesTab: Locator
  readonly commitsTab: Locator

  constructor(page: Page, relay: string, naddr: string) {
    this.page = page
    this.relay = relay
    this.naddr = naddr

    // Navigation
    this.backButton = page.locator("button").filter({hasText: "Go back"})

    // Main content
    this.pageContent = page.locator("[class*='PageContent']").or(page.locator("main")).first()

    // Loading states
    this.loadingState = page.getByText("Loading repository...")
    this.notFoundState = page.getByText("Repository not found.")

    // RepoHeader component
    this.repoHeader = page.locator("[class*='RepoHeader']").or(
      page.locator("div").filter({has: page.locator("[class*='repo-header']")})
    ).first()

    // Action buttons (typically in RepoHeader)
    this.refreshButton = page.locator("button[title*='Refresh'], button[aria-label*='refresh' i]").first()
    this.forkButton = page.locator("button").filter({hasText: /fork/i}).first()
    this.settingsButton = page.locator("button[title*='Settings'], button[aria-label*='settings' i]").first()
    this.bookmarkButton = page.locator("button").filter({hasText: /bookmark/i}).first()

    // Tab navigation (using RepoTab components with links inside RepoHeader nav)
    // Use nav selector to target only the tab navigation bar, not repo card action buttons
    const tabNav = page.locator("nav")
    this.feedTab = tabNav.locator("a[href*='/feed']").filter({hasText: "Feed"})
    this.codeTab = tabNav.locator("a[href*='/code']").filter({hasText: "Code"})
    this.issuesTab = tabNav.locator("a[href*='/issues']").filter({hasText: "Issues"})
    this.patchesTab = tabNav.locator("a[href*='/patches']").filter({hasText: "Patches"})
    this.commitsTab = tabNav.locator("a[href*='/commits']").filter({hasText: "Commits"})
  }

  /**
   * Navigate to the repository detail page
   */
  async goto(): Promise<void> {
    await this.page.goto(`/spaces/${this.relay}/git/${this.naddr}/`)
    await this.waitForLoad()
  }

  /**
   * Wait for the page to finish loading
   */
  async waitForLoad(): Promise<void> {
    // Wait for loading state to resolve
    await this.page.waitForFunction(() => {
      const text = document.body.textContent
      return !text?.includes("Loading repository...")
    }, {timeout: 30000}).catch(() => {
      // May have already loaded
    })

    // Wait for tabs to be rendered (indicates RepoHeader is ready)
    // Target tabs within the nav element to ensure we're on the repo detail page, not the repo list
    try {
      await this.page.waitForSelector(
        "nav a[href*='/feed'], nav a[href*='/code'], nav a[href*='/issues'], nav a[href*='/patches'], nav a[href*='/commits']",
        {state: "visible", timeout: 15000}
      )
    } catch {
      // If tabs don't appear, the page may have a different structure
      // Continue anyway and let subsequent operations fail with more specific errors
    }
  }

  /**
   * Check if the repository was found
   */
  async isRepoFound(): Promise<boolean> {
    const notFound = await this.notFoundState.isVisible()
    return !notFound
  }

  /**
   * Get the repository name from the page title or header
   */
  async getRepoName(): Promise<string> {
    // Try to get name from page title first
    const title = await this.page.title()
    if (title && title !== "undefined" && !title.includes("flotilla")) {
      return title.trim()
    }

    // Fallback to header element
    const nameElement = this.pageContent.locator("h1, h2, [class*='repo-name']").first()
    if (await nameElement.isVisible()) {
      return (await nameElement.textContent() || "").trim()
    }

    return ""
  }

  /**
   * Get the clone URL for the repository
   */
  async getCloneUrl(): Promise<string | null> {
    // Clone URLs are typically displayed in input fields or code blocks
    const cloneInput = this.page.locator(
      "input[readonly][value*='git'], " +
      "input[value*='clone'], " +
      "[data-testid='clone-url'], " +
      "code:has-text('git clone')"
    ).first()

    if (await cloneInput.isVisible()) {
      const value = await cloneInput.getAttribute("value")
      if (value) return value

      const text = await cloneInput.textContent()
      // Extract URL from "git clone <url>" pattern
      const match = text?.match(/git clone\s+(\S+)/)
      return match ? match[1] : text?.trim() || null
    }

    return null
  }

  /**
   * Get the currently active tab
   *
   * Determines the active tab primarily by URL path, with fallback to DOM attributes.
   * URL is the most reliable source since the app's tab components may not use
   * standard accessibility attributes.
   */
  async getActiveTab(): Promise<RepoTab | null> {
    // Primary method: determine from URL (most reliable)
    const url = this.page.url()

    // Check URL in order of specificity (longer paths first to avoid false matches)
    if (url.includes("/commits")) return "commits"
    if (url.includes("/patches")) return "patches"
    if (url.includes("/issues")) return "issues"
    if (url.includes("/workbench")) return "workbench"
    if (url.includes("/cicd")) return "cicd"
    if (url.includes("/code")) return "code"
    if (url.includes("/feed")) return "feed"

    // Fallback: check DOM attributes
    const tabs: Array<{locator: Locator; name: RepoTab}> = [
      {locator: this.feedTab, name: "feed"},
      {locator: this.codeTab, name: "code"},
      {locator: this.issuesTab, name: "issues"},
      {locator: this.patchesTab, name: "patches"},
      {locator: this.commitsTab, name: "commits"},
    ]

    for (const {locator, name} of tabs) {
      // Check for active state via data-state, aria-selected, or class
      const dataState = await locator.getAttribute("data-state")
      const ariaSelected = await locator.getAttribute("aria-selected")
      const className = await locator.getAttribute("class")

      if (
        dataState === "active" ||
        ariaSelected === "true" ||
        className?.includes("active") ||
        className?.includes("selected")
      ) {
        return name
      }
    }

    return null
  }

  /**
   * Click a specific tab
   */
  async clickTab(tab: RepoTab): Promise<void> {
    const tabLocators: Record<RepoTab, Locator> = {
      feed: this.feedTab,
      code: this.codeTab,
      issues: this.issuesTab,
      patches: this.patchesTab,
      commits: this.commitsTab,
      cicd: this.page.locator("a[href*='/cicd']").filter({hasText: /ci/i}),
      workbench: this.page.locator("a[href*='/workbench']").filter({hasText: /workbench/i}),
    }

    const tabLocator = tabLocators[tab]
    await expect(tabLocator).toBeVisible()
    await tabLocator.click()
    await this.waitForTabContent()
  }

  /**
   * Navigate to the Feed tab
   */
  async goToFeed(): Promise<void> {
    await this.clickTab("feed")
  }

  /**
   * Navigate to the Code tab
   */
  async goToCode(): Promise<void> {
    await this.clickTab("code")
  }

  /**
   * Navigate to the Issues tab
   */
  async goToIssues(): Promise<void> {
    await this.clickTab("issues")
  }

  /**
   * Navigate to the Patches tab
   */
  async goToPatches(): Promise<void> {
    await this.clickTab("patches")
  }

  /**
   * Navigate to the Commits tab
   */
  async goToCommits(): Promise<void> {
    await this.clickTab("commits")
  }

  /**
   * Wait for tab content to load after switching
   */
  private async waitForTabContent(): Promise<void> {
    // Wait for navigation to complete
    await this.page.waitForLoadState("networkidle")
    await this.page.waitForTimeout(500)
  }

  /**
   * Go back to the previous page
   */
  async goBack(): Promise<void> {
    await this.backButton.click()
  }

  /**
   * Refresh the repository data
   */
  async refreshRepo(): Promise<void> {
    if (await this.refreshButton.isVisible()) {
      await this.refreshButton.click()
      await this.waitForLoad()
    }
  }

  /**
   * Click the fork button
   */
  async clickFork(): Promise<void> {
    await expect(this.forkButton).toBeVisible()
    await this.forkButton.click()
  }

  /**
   * Click the settings button
   */
  async clickSettings(): Promise<void> {
    await expect(this.settingsButton).toBeVisible()
    await this.settingsButton.click()
  }

  /**
   * Toggle the bookmark status
   */
  async toggleBookmark(): Promise<void> {
    await expect(this.bookmarkButton).toBeVisible()
    await this.bookmarkButton.click()
  }

  /**
   * Get the list of available tabs
   */
  async getAvailableTabs(): Promise<string[]> {
    const tabLinks = this.pageContent.locator("a[href*='/git/']").filter({
      has: this.page.locator("span")
    })
    const count = await tabLinks.count()
    const tabs: string[] = []

    for (let i = 0; i < count; i++) {
      const text = await tabLinks.nth(i).textContent()
      if (text) {
        tabs.push(text.trim())
      }
    }

    return tabs
  }

  /**
   * Check if a specific tab is visible/available
   */
  async hasTab(tab: RepoTab): Promise<boolean> {
    const tabLocators: Record<RepoTab, Locator> = {
      feed: this.feedTab,
      code: this.codeTab,
      issues: this.issuesTab,
      patches: this.patchesTab,
      commits: this.commitsTab,
      cicd: this.page.locator("a[href*='/cicd']"),
      workbench: this.page.locator("a[href*='/workbench']"),
    }

    return await tabLocators[tab].isVisible()
  }

  /**
   * Get the base path for this repository
   */
  getBasePath(): string {
    return `/spaces/${this.relay}/git/${this.naddr}`
  }

  /**
   * Get the full URL for a specific tab
   */
  getTabUrl(tab: RepoTab): string {
    return `${this.getBasePath()}/${tab}`
  }

  /**
   * Wait for the repository header to be visible
   */
  async waitForHeader(): Promise<void> {
    // Wait for either the repo header or the repo name to be visible
    await this.page.waitForSelector(
      "[class*='RepoHeader'], h1, h2",
      {state: "visible", timeout: 10000}
    )
  }

  /**
   * Check if the page is in a loading state
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingState.isVisible()
  }

  /**
   * Get repository description if available
   */
  async getRepoDescription(): Promise<string | null> {
    const descElement = this.pageContent.locator(
      "[class*='description'], p[class*='text-muted'], [data-testid='repo-description']"
    ).first()

    if (await descElement.isVisible()) {
      return (await descElement.textContent())?.trim() || null
    }

    return null
  }

  /**
   * Get maintainer count or list
   */
  async getMaintainerCount(): Promise<number> {
    const maintainerText = this.pageContent.locator("span").filter({hasText: /maintainer/i})
    if (await maintainerText.isVisible()) {
      const text = await maintainerText.textContent()
      const match = text?.match(/(\d+)\s*maintainer/)
      return match ? parseInt(match[1], 10) : 0
    }
    return 0
  }
}
