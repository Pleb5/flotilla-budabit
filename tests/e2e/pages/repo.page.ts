import {expect, type Locator, type Page} from "@playwright/test"

/**
 * Page object for a repository detail page (/spaces/[relay]/git/[id=naddr]/...)
 *
 * Uses role-based and text selectors for resilience across Svelte compilations.
 */
export class RepoPage {
  readonly page: Page
  readonly relay: string
  readonly repoPath: string

  constructor(page: Page, relay: string, repoPath: string) {
    this.page = page
    this.relay = relay
    this.repoPath = repoPath
  }

  get encodedRelay(): string {
    return encodeURIComponent(this.relay)
  }

  get baseUrl(): string {
    return `/spaces/${this.encodedRelay}/git/${this.repoPath}`
  }

  get repoName(): Locator {
    return this.page.getByTestId("repo-name")
  }

  private tabNav(): Locator {
    return this.page.locator("nav").filter({has: this.page.getByRole("link", {name: "Issues"})})
  }

  get issuesTab(): Locator {
    return this.tabNav().getByRole("link", {name: "Issues", exact: true})
  }

  get prsTab(): Locator {
    return this.tabNav().getByRole("link", {name: "PRs", exact: true})
  }

  get codeTab(): Locator {
    return this.tabNav().getByRole("link", {name: "Code", exact: true})
  }

  get commitsTab(): Locator {
    return this.tabNav().getByRole("link", {name: "Commits", exact: true})
  }

  get issuesContent(): Locator {
    return this.page.getByRole("heading", {name: "Issues", exact: true})
  }

  get prsContent(): Locator {
    return this.page.getByRole("heading", {name: "PRs", exact: true})
  }

  get codeContent(): Locator {
    return this.page.getByTestId("code-browser")
  }

  get commitsContent(): Locator {
    return this.page.locator(
      '[data-testid="commits-list"], [data-testid="empty-state"]',
    )
  }

  async goto(): Promise<void> {
    await this.page.goto(this.baseUrl)
  }

  async gotoTab(tab: "issues" | "prs" | "code" | "commits"): Promise<void> {
    const tabLocator =
      tab === "issues"
        ? this.issuesTab
        : tab === "prs"
          ? this.prsTab
          : tab === "code"
            ? this.codeTab
            : this.commitsTab
    await tabLocator.click()
  }

  async waitForTabContent(tab: "issues" | "prs" | "code" | "commits"): Promise<void> {
    const content =
      tab === "issues"
        ? this.issuesContent
        : tab === "prs"
          ? this.prsContent
          : tab === "code"
            ? this.codeContent
            : this.commitsContent
    await expect(content).toBeVisible({timeout: 15000})
  }
}
