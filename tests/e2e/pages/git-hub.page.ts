import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Page object for the main Git Hub landing page (/spaces/[relay]/git/)
 *
 * This page displays:
 * - Tab navigation between "My Repos" and "Bookmarks"
 * - Search functionality (including naddr URI search)
 * - New repo creation button
 * - Grid of repository cards
 */
export class GitHubPage {
  readonly page: Page
  readonly relay: string

  // Page elements
  readonly pageTitle: Locator
  readonly newRepoButton: Locator
  readonly searchInput: Locator
  readonly myReposTab: Locator
  readonly bookmarksTab: Locator
  readonly bookmarkRepoButton: Locator
  readonly repoGrid: Locator
  readonly loadingSpinner: Locator
  readonly emptyState: Locator

  constructor(page: Page, relay: string) {
    this.page = page
    this.relay = relay

    // Page bar elements
    this.pageTitle = page.locator("strong").filter({hasText: "Git Repositories"})
    this.newRepoButton = page.locator("button").filter({hasText: "New Repo"})

    // Tab navigation
    this.myReposTab = page.getByRole("tab").filter({hasText: "My Repos"})
    this.bookmarksTab = page.getByRole("tab").filter({hasText: "Bookmarks"})

    // Search
    this.searchInput = page.locator('input[placeholder*="naddr"]')

    // Bookmark action
    this.bookmarkRepoButton = page.locator("button").filter({hasText: "Bookmark a Repo"})

    // Content area
    this.repoGrid = page.locator(".grid.gap-3")
    this.loadingSpinner = page.getByText("Looking for Your Git Repos...")
    this.emptyState = page.locator("p").filter({hasText: /No.*found/})
  }

  /**
   * Navigate to the Git Hub page for the specified relay
   */
  async goto(): Promise<void> {
    await this.page.goto(`/spaces/${this.relay}/git/`)
    await this.waitForLoad()
  }

  /**
   * Wait for the page to finish loading
   */
  async waitForLoad(): Promise<void> {
    // Give the page more time to load, especially on slower CI runners
    await expect(this.pageTitle).toBeVisible({timeout: 15000})
    // Wait for loading spinner to disappear (if present)
    await this.page.waitForFunction(() => {
      const spinner = document.body.textContent
      return !spinner?.includes("Looking for Your Git Repos...")
    }, {timeout: 30000}).catch(() => {
      // Spinner may have already disappeared or never appeared
    })
  }

  /**
   * Get all repository cards on the page
   */
  async getRepoCards(): Promise<Locator[]> {
    const cards = this.repoGrid.locator("> div")
    const count = await cards.count()
    const result: Locator[] = []
    for (let i = 0; i < count; i++) {
      result.push(cards.nth(i))
    }
    return result
  }

  /**
   * Get the number of repository cards displayed
   */
  async getRepoCount(): Promise<number> {
    const cards = await this.getRepoCards()
    return cards.length
  }

  /**
   * Click the "New Repo" button to open the new repository wizard
   */
  async clickNewRepo(): Promise<void> {
    await expect(this.newRepoButton).toBeVisible()
    await this.newRepoButton.click()
  }

  /**
   * Switch to the "My Repos" tab
   */
  async goToMyRepos(): Promise<void> {
    await this.myReposTab.click()
    await this.waitForTabContent()
  }

  /**
   * Switch to the "Bookmarks" tab
   */
  async goToBookmarks(): Promise<void> {
    await this.bookmarksTab.click()
    await this.waitForTabContent()
  }

  /**
   * Get the currently active tab
   */
  async getActiveTab(): Promise<"my-repos" | "bookmarks"> {
    const myReposSelected = await this.myReposTab.getAttribute("data-state")
    if (myReposSelected === "active") {
      return "my-repos"
    }
    return "bookmarks"
  }

  /**
   * Wait for tab content to load after switching tabs
   */
  private async waitForTabContent(): Promise<void> {
    // Give the UI time to re-render
    await this.page.waitForTimeout(500)
  }

  /**
   * Search for repositories by name or description
   */
  async searchRepos(query: string): Promise<void> {
    await expect(this.searchInput).toBeVisible()
    await this.searchInput.fill(query)
    // Allow debounce/filtering to complete
    await this.page.waitForTimeout(300)
  }

  /**
   * Search for a repository by naddr URI
   */
  async searchByNaddr(naddr: string): Promise<void> {
    await this.searchRepos(naddr)
    // naddr lookups may take longer
    await this.page.waitForTimeout(1000)
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear()
    await this.page.waitForTimeout(300)
  }

  /**
   * Click the "Bookmark a Repo" button (only visible on Bookmarks tab)
   */
  async clickBookmarkRepo(): Promise<void> {
    await expect(this.bookmarkRepoButton).toBeVisible()
    await this.bookmarkRepoButton.click()
  }

  /**
   * Click on a specific repository card by index
   */
  async clickRepoByIndex(index: number): Promise<void> {
    const cards = await this.getRepoCards()
    if (index >= cards.length) {
      throw new Error(`Repo index ${index} out of bounds (${cards.length} cards)`)
    }
    await cards[index].click()
  }

  /**
   * Click on a repository card by name to navigate to its detail page.
   * Clicks the "Browse" link within the repo card which handles navigation.
   */
  async clickRepoByName(name: string): Promise<void> {
    const repoCard = this.repoGrid.locator("> div").filter({hasText: name}).first()
    await expect(repoCard).toBeVisible()
    // Click the "Browse" link inside the card to navigate to repo detail
    const browseLink = repoCard.locator('a:has-text("Browse")')
    await expect(browseLink).toBeVisible()
    await browseLink.click()
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
   * Get repository names from all visible cards
   */
  async getRepoNames(): Promise<string[]> {
    const cards = await this.getRepoCards()
    const names: string[] = []
    for (const card of cards) {
      // GitItem typically displays the repo name in a prominent text element
      const nameElement = card.locator("h3, h4, [class*='font-semibold']").first()
      if (await nameElement.isVisible()) {
        names.push(await nameElement.textContent() || "")
      }
    }
    return names.filter(Boolean)
  }

  /**
   * Get the page URL
   */
  getUrl(): string {
    return `/spaces/${this.relay}/git/`
  }
}
