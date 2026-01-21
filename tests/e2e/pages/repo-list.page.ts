import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Page object for the Repository List page (/spaces/[relay]/git/repos/)
 *
 * This page displays:
 * - A list of git repositories available on the relay
 * - Repository cards with metadata (name, description, maintainers)
 * - Navigation to individual repository detail pages
 */
export class RepoListPage {
  readonly page: Page
  readonly relay: string

  // Page elements
  readonly pageBar: Locator
  readonly pageTitle: Locator
  readonly repoList: Locator
  readonly loadingSpinner: Locator
  readonly emptyState: Locator

  constructor(page: Page, relay: string) {
    this.page = page
    this.relay = relay

    // Page structure elements
    this.pageBar = page.locator("[class*='PageBar']").or(page.locator("header").first())
    this.pageTitle = page.locator("strong").filter({hasText: "Git Repos"})

    // Content area - repos are displayed in a flex column with GitItem components
    this.repoList = page.locator(".flex.flex-col.gap-2").first()
    this.loadingSpinner = page.getByText("Looking for Git Repos...")
    this.emptyState = page.getByText("No Git Repos found.")
  }

  /**
   * Navigate to the repo list page for the specified relay
   */
  async goto(): Promise<void> {
    await this.page.goto(`/spaces/${this.relay}/git/repos/`)
    await this.waitForLoad()
  }

  /**
   * Wait for the page to finish loading
   */
  async waitForLoad(): Promise<void> {
    // Give the page more time to load
    await expect(this.pageTitle).toBeVisible({timeout: 15000})
    // Wait for loading state to resolve
    await this.page.waitForFunction(() => {
      const text = document.body.textContent
      return !text?.includes("Looking for Git Repos...")
    }, {timeout: 30000}).catch(() => {
      // Loading may have already completed
    })
  }

  /**
   * Get all repository card elements
   */
  async getRepoCards(): Promise<Locator[]> {
    // GitItem components are wrapped in divs within the flex container
    const cards = this.repoList.locator("> div")
    const count = await cards.count()
    const result: Locator[] = []
    for (let i = 0; i < count; i++) {
      result.push(cards.nth(i))
    }
    return result
  }

  /**
   * Get the count of repository cards displayed
   */
  async getRepoCount(): Promise<number> {
    const cards = await this.getRepoCards()
    return cards.length
  }

  /**
   * Get repository information from cards
   */
  async getRepoInfo(): Promise<Array<{name: string; description?: string}>> {
    const cards = await this.getRepoCards()
    const repos: Array<{name: string; description?: string}> = []

    for (const card of cards) {
      // Extract repo name (typically in a heading or strong element)
      const nameElement = card.locator("h3, h4, strong, [class*='font-semibold']").first()
      const name = await nameElement.textContent() || ""

      // Extract description if present
      const descElement = card.locator("p, [class*='text-muted']").first()
      const description = await descElement.textContent().catch(() => undefined)

      repos.push({name: name.trim(), description: description?.trim()})
    }

    return repos
  }

  /**
   * Search/filter repositories by text
   * Note: This page may use a different search mechanism than the hub page
   */
  async searchRepos(query: string): Promise<void> {
    const searchInput = this.page.locator('input[type="search"], input[placeholder*="search" i]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill(query)
      await this.page.waitForTimeout(300)
    }
  }

  /**
   * Click on a repository card to navigate to its detail page
   */
  async clickRepo(identifier: string | number): Promise<void> {
    if (typeof identifier === "number") {
      await this.clickRepoByIndex(identifier)
    } else {
      await this.clickRepoByName(identifier)
    }
  }

  /**
   * Click on a repository card by index
   */
  async clickRepoByIndex(index: number): Promise<void> {
    const cards = await this.getRepoCards()
    if (index >= cards.length) {
      throw new Error(`Repo index ${index} out of bounds (${cards.length} cards)`)
    }
    // Click on the link or interactive element within the card
    const clickable = cards[index].locator("a, [role='link'], [onclick]").first()
    if (await clickable.isVisible()) {
      await clickable.click()
    } else {
      await cards[index].click()
    }
  }

  /**
   * Click on a repository card by name
   */
  async clickRepoByName(name: string): Promise<void> {
    const card = this.repoList.locator("> div").filter({hasText: name}).first()
    await expect(card).toBeVisible()
    const clickable = card.locator("a, [role='link']").first()
    if (await clickable.isVisible()) {
      await clickable.click()
    } else {
      await card.click()
    }
  }

  /**
   * Check if a repository with the given name exists
   */
  async hasRepo(name: string): Promise<boolean> {
    const card = this.repoList.locator("> div").filter({hasText: name})
    return (await card.count()) > 0
  }

  /**
   * Check if the page shows an empty state
   */
  async isEmpty(): Promise<boolean> {
    return await this.emptyState.isVisible()
  }

  /**
   * Check if the page is currently loading
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingSpinner.isVisible()
  }

  /**
   * Get the naddr for a specific repository by name
   */
  async getRepoNaddr(name: string): Promise<string | null> {
    const card = this.repoList.locator("> div").filter({hasText: name}).first()
    if (!(await card.isVisible())) {
      return null
    }
    // Try to find an anchor with naddr in the href
    const link = card.locator("a[href*='naddr']").first()
    if (await link.isVisible()) {
      const href = await link.getAttribute("href")
      // Extract naddr from the URL path
      const match = href?.match(/naddr[a-zA-Z0-9]+/)
      return match ? match[0] : null
    }
    return null
  }

  /**
   * Get the page URL
   */
  getUrl(): string {
    return `/spaces/${this.relay}/git/repos/`
  }

  /**
   * Wait for a specific number of repositories to load
   */
  async waitForRepoCount(count: number, timeout = 10000): Promise<void> {
    await expect(async () => {
      const current = await this.getRepoCount()
      expect(current).toBeGreaterThanOrEqual(count)
    }).toPass({timeout})
  }
}
