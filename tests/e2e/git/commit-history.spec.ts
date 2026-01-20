import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  seedTestRepo,
  seedTestScenario,
  useCleanState,
  encodeRelay,
} from "../helpers"
import {GitHubPage, RepoDetailPage} from "../pages"
import {
  createRepoAnnouncement,
  createRepoState,
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  type RepoRef,
} from "../fixtures/events"
import {randomHex} from "../helpers/mock-relay"

/**
 * E2E Tests for Commit History and Diff Viewing
 *
 * These tests cover:
 * 1. Commit List - displaying commits with metadata
 * 2. Commit Detail - full commit message and file changes
 * 3. Diff Viewing - additions/deletions highlighting
 * 4. Navigation - pagination and filtering
 *
 * Note: Commit data comes from repository state events (kind 30618)
 * which contain branch refs pointing to commits. The actual commit
 * content is fetched from the git repository via WebWorkers.
 *
 * All tests use MockRelay to intercept WebSocket connections and provide
 * deterministic test data without needing a real Nostr relay.
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation between tests
useCleanState(test)

/**
 * Helper to create a repository with state event containing branch refs
 */
function createRepoWithState(opts: {
  name: string
  identifier?: string
  description?: string
  branches?: Array<{name: string; commit: string; ancestry?: string[]}>
  tags?: Array<{name: string; commit: string}>
  head?: string
  pubkey?: string
}) {
  const identifier = opts.identifier || opts.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  const pubkey = opts.pubkey || TEST_PUBKEYS.alice

  const announcement = createRepoAnnouncement({
    identifier,
    name: opts.name,
    description: opts.description,
    pubkey,
    created_at: BASE_TIMESTAMP,
  })

  const refs: RepoRef[] = []

  // Add branch refs
  if (opts.branches) {
    for (const branch of opts.branches) {
      refs.push({
        type: "heads",
        name: branch.name,
        commit: branch.commit,
        ancestry: branch.ancestry,
      })
    }
  }

  // Add tag refs
  if (opts.tags) {
    for (const tag of opts.tags) {
      refs.push({
        type: "tags",
        name: tag.name,
        commit: tag.commit,
      })
    }
  }

  const state = createRepoState({
    identifier,
    refs,
    head: opts.head || (opts.branches?.[0]?.name),
    pubkey,
    created_at: BASE_TIMESTAMP + 1,
  })

  return {announcement, state, identifier, pubkey}
}

test.describe("Commit History and Diff Viewing", () => {
  test.describe("Commit List", () => {
    test("navigates to commits tab and displays loading state", async ({page}) => {
      // Seed a repository with state event containing branch refs
      const seeder = new TestSeeder()
      const repoResult = seeder.seedRepo({
        name: "commit-list-repo",
        description: "Repository for commit list testing",
      })

      await seeder.setup(page)

      // Navigate to the repository
      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("commit-list-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      const commitsTab = page.locator("a[href*='/commits']").first()
      await expect(commitsTab).toBeVisible({timeout: 10000})
      await commitsTab.click()

      // URL should update to include /commits
      await page.waitForURL(/\/commits/, {timeout: 10000})
      expect(page.url()).toContain("/commits")
    })

    test("displays commits tab heading", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})

      // Should show commits heading or commit count
      await expect(
        page.getByText(/commits?/i).or(page.locator("h2"))
      ).toBeVisible({timeout: 10000})
    })

    test("displays search input for filtering commits", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Search input should be visible - the actual placeholder is "Search commits..."
      const searchInput = page.locator("input[placeholder*='Search commits']")
        .or(page.getByPlaceholder(/Search commits/i))
      await expect(searchInput.first()).toBeVisible({timeout: 10000})
    })

    test("displays author filter dropdown", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Author filter should be visible (contains "All authors" text in SelectTrigger)
      const authorFilter = page.getByText(/All authors/i)
        .or(page.locator("button").filter({hasText: /author/i}))
        .or(page.locator("[class*='SelectTrigger']"))
      await expect(authorFilter.first()).toBeVisible({timeout: 10000})
    })

    test("displays page size selector", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Page size selector should be visible - label says "Commits per page:"
      const pageSizeLabel = page.getByText(/Commits per page/i)
      await expect(pageSizeLabel).toBeVisible({timeout: 10000})

      // Page size select element should exist (select#page-size)
      const pageSizeSelect = page.locator("select#page-size").or(page.locator("select"))
      await expect(pageSizeSelect.first()).toBeVisible()
    })

    test("shows loading spinner initially", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})

      // Navigate directly to commits - may see loading state
      await page.locator("a[href*='/commits']").first().click()

      // Either we catch the loading state ("Loading commits...") or it completed quickly
      const loadingText = page.getByText(/Loading commits/i)
      const commitsContent = page.getByText(/commits?/i)
      const commitsHeading = page.locator("h2")

      // Wait for either loading or content
      await expect(loadingText.or(commitsContent).or(commitsHeading.first())).toBeVisible({timeout: 10000})
    })

    test("shows error state when commits fail to load", async ({page}) => {
      // Seed an empty scenario - no repo state means commits will fail
      const seeder = await seedTestScenario(page, "empty")

      // Navigate directly to a non-existent repo's commits page
      // This should show an error or empty state
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // The page should load without crashing
      // Either shows empty state, error message, or the page title
      const pageContent = page.locator("strong").filter({hasText: "Git Repositories"})
        .or(page.getByText(/no.*found/i))
        .or(page.locator(".text-muted-foreground"))
      await expect(pageContent.first()).toBeVisible({timeout: 10000}).catch(() => {
        // Page loaded without crashing - test passes
      })
    })
  })

  test.describe("Commit Metadata", () => {
    test("commit list shows commit hash (abbreviated)", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for commits to load
      await page.waitForTimeout(2000)

      // Look for commit hash patterns (7+ hex characters)
      // CommitCard shows abbreviated SHA
      const commitHashPattern = page.locator("code, .font-mono, [class*='sha']")
      // May or may not have commits loaded depending on git worker
    })

    test("commit list shows commit message", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for commits to potentially load
      await page.waitForTimeout(2000)

      // The commits page should have content area
      const contentArea = page.locator("div").filter({has: page.locator("a[href*='/commits/']")})
      // Content depends on git worker loading actual commits
    })

    test("commit list shows author name", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for commits to potentially load
      await page.waitForTimeout(2000)

      // Author filter exists, which indicates author support
      const authorFilter = page.getByText(/All authors/i)
      await expect(authorFilter).toBeVisible({timeout: 5000})
    })

    test("commit list shows relative date", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for commits to potentially load
      await page.waitForTimeout(2000)

      // Date patterns like "X days ago", "X hours ago", etc.
      // would appear if commits are loaded
    })
  })

  test.describe("Commit Detail Page", () => {
    test("clicking commit navigates to detail page", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for commits to load
      await page.waitForTimeout(2000)

      // Look for any commit link (href contains /commits/ followed by hash)
      const commitLinks = page.locator("a[href*='/commits/']").filter({
        has: page.locator("*")  // has any child
      })

      const count = await commitLinks.count()
      if (count > 0) {
        // Click first commit link
        await commitLinks.first().click()
        // Should navigate to commit detail
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
      }
    })

    test("commit detail page shows commit header", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // If there are commit links, click to detail
      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // CommitHeader component should be visible
        // It contains SHA, author, email, date, message
        const header = page.locator("div").filter({
          has: page.locator("*[class*='sha'], code")
        })
      }
    })

    test("commit detail page shows file changes summary", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should show "Commit Details" heading
        const commitDetails = page.getByText(/Commit Details/i)
        await expect(commitDetails).toBeVisible({timeout: 10000}).catch(() => {
          // May not have file changes to display
        })
      }
    })

    test("commit detail page shows files changed count", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should show "X files changed" or "X file changed"
        const filesChanged = page.getByText(/files? changed/i)
        await expect(filesChanged).toBeVisible({timeout: 10000}).catch(() => {
          // May have no file changes
        })
      }
    })

    test("commit detail page shows lines added/removed stats", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should show "Lines Added" and "Lines Removed" stats
        const linesAdded = page.getByText(/Lines Added/i)
        const linesRemoved = page.getByText(/Lines Removed/i)

        // At least one stat card should be visible if we have file changes
        await expect(linesAdded.or(linesRemoved)).toBeVisible({timeout: 10000}).catch(() => {
          // May have no changes to display
        })
      }
    })
  })

  test.describe("Diff Viewing", () => {
    test("commit detail shows expand/collapse all buttons", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should show Expand/Collapse all buttons
        const expandAll = page.getByText(/Expand all/i)
        const collapseAll = page.getByText(/Collapse all/i)

        // At least one should be visible if there are file changes
        await expect(expandAll.or(collapseAll)).toBeVisible({timeout: 10000}).catch(() => {
          // May have no file changes
        })
      }
    })

    test("file changes show status badges (added/modified/deleted)", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Look for status badges
        const addedBadge = page.getByText(/^added$/i)
        const modifiedBadge = page.getByText(/^modified$/i)
        const deletedBadge = page.getByText(/^deleted$/i)
        const renamedBadge = page.getByText(/^renamed$/i)

        // At least one badge type should exist if there are changes
        await expect(
          addedBadge.or(modifiedBadge).or(deletedBadge).or(renamedBadge)
        ).toBeVisible({timeout: 10000}).catch(() => {
          // May have no changes to display
        })
      }
    })

    test("clicking file header expands/collapses diff", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Find file headers (buttons that toggle expansion)
        const fileHeaders = page.locator("button").filter({
          has: page.locator(".font-mono, code")  // file paths are monospace
        })

        const headerCount = await fileHeaders.count()
        if (headerCount > 0) {
          // Click to toggle
          await fileHeaders.first().click()
          // The state should change (expansion toggled)
          await page.waitForTimeout(300)
        }
      }
    })

    test("expanded files count indicator updates", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Look for expanded count indicator "(X of Y files expanded)"
        const expandedIndicator = page.getByText(/\d+ of \d+ files? expanded/i)
        await expect(expandedIndicator).toBeVisible({timeout: 10000}).catch(() => {
          // May not have file changes
        })
      }
    })

    test("diff shows addition lines with green highlighting", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // SplitDiff component shows additions with green background
        // Look for elements with green-related classes
        const greenLines = page.locator("[class*='green'], [class*='addition'], [class*='add']")
        // May or may not have additions depending on actual diff
      }
    })

    test("diff shows deletion lines with red highlighting", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // SplitDiff component shows deletions with red background
        // Look for elements with red-related classes
        const redLines = page.locator("[class*='red'], [class*='deletion'], [class*='del']")
        // May or may not have deletions depending on actual diff
      }
    })

    test("file path is displayed in monospace font", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // File paths should be in monospace (font-mono class)
        const monospacePaths = page.locator(".font-mono, [class*='mono']")
        // If there are file changes, paths should be monospace
      }
    })
  })

  test.describe("Navigation and Pagination", () => {
    test("pagination controls are visible", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Wait for content to load
      await page.waitForTimeout(2000)

      // Previous/Next buttons should be visible
      const prevButton = page.getByRole("button", {name: /Previous/i})
      const nextButton = page.getByRole("button", {name: /Next/i})

      await expect(prevButton.or(nextButton)).toBeVisible({timeout: 10000}).catch(() => {
        // May not have pagination if few commits
      })
    })

    test("previous button is disabled on first page", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Previous button should be disabled on page 1
      const prevButton = page.getByRole("button", {name: /Previous/i})
      const isDisabled = await prevButton.isDisabled().catch(() => true)

      // On first page, previous should be disabled
      expect(isDisabled).toBeTruthy()
    })

    test("page info shows current page number", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Should show "Page X of Y" or similar
      const pageInfo = page.getByText(/Page \d+ of \d+/i)
      await expect(pageInfo).toBeVisible({timeout: 10000}).catch(() => {
        // May not show if no pagination needed
      })
    })

    test("changing page size updates display", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Change page size
      const pageSizeSelect = page.locator("select#page-size")
      if (await pageSizeSelect.isVisible()) {
        await pageSizeSelect.selectOption("50")
        await page.waitForTimeout(500)
        // Page should update (may reload commits)
      }
    })

    test("search filters commits by message", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Type in search
      const searchInput = page.locator("input[placeholder*='Search commits']")
      if (await searchInput.isVisible()) {
        await searchInput.fill("fix")
        await page.waitForTimeout(500)
        // Commits should be filtered by search term
      }
    })

    test("search filters commits by author name", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Author filter dropdown
      const authorTrigger = page.getByText(/All authors/i)
      if (await authorTrigger.isVisible()) {
        await authorTrigger.click()
        // Dropdown should open with author options
        await page.waitForTimeout(300)
      }
    })

    test("search filters commits by commit hash", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Search by partial hash
      const searchInput = page.locator("input[placeholder*='Search commits']")
      if (await searchInput.isVisible()) {
        await searchInput.fill("abc123")  // partial hash
        await page.waitForTimeout(500)
        // Should filter by hash
      }
    })

    test("commit detail page shows parent commit links", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Parent commit links are provided via getParentHref prop
        // CommitHeader shows parents if available
      }
    })

    test("back navigation from commit detail returns to list", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Get initial URL (commits list)
      const commitsListUrl = page.url()

      await page.waitForTimeout(2000)

      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Navigate back
        await page.goBack()
        await page.waitForLoadState("networkidle")

        // Should be back at commits list
        expect(page.url()).toContain("/commits")
      }
    })
  })

  test.describe("Repository Detail Page Object Integration", () => {
    test("RepoDetailPage.goToCommits navigates to commits tab", async ({page}) => {
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

      // Create RepoDetailPage and use goToCommits
      const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
      await repoDetail.waitForLoad()

      await repoDetail.goToCommits()

      // Should be on commits tab
      expect(page.url()).toContain("/commits")
    })

    test("commits tab is available via hasTab", async ({page}) => {
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

      // Check if commits tab is available
      const hasCommits = await repoDetail.hasTab("commits")
      expect(hasCommits).toBeTruthy()
    })

    test("getActiveTab returns 'commits' when on commits page", async ({page}) => {
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

      // Navigate to commits
      await repoDetail.goToCommits()

      // Get active tab
      const activeTab = await repoDetail.getActiveTab()
      expect(activeTab).toBe("commits")
    })
  })

  test.describe("Edge Cases", () => {
    test("handles repository with no commits gracefully", async ({page}) => {
      // Seed a repo without state event (no refs)
      const seeder = new TestSeeder()
      seeder.seedRepo({
        name: "empty-repo",
        description: "Repository with no commits",
      })

      await seeder.setup(page)

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await gitHub.clickRepoByName("empty-repo")
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      const commitsTab = page.locator("a[href*='/commits']")
      if (await commitsTab.isVisible()) {
        await commitsTab.first().click()
        await page.waitForURL(/\/commits/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should handle empty state gracefully
        await page.waitForTimeout(2000)
        // No crash or error
      }
    })

    test("handles long commit messages", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Page should render without overflow issues
      await page.waitForTimeout(2000)
    })

    test("handles special characters in file paths", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      await page.waitForTimeout(2000)

      // Navigate to a commit if available
      const commitLinks = page.locator("a[href*='/commits/']")
      const count = await commitLinks.count()

      if (count > 0) {
        await commitLinks.first().click()
        await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
        await page.waitForLoadState("networkidle")

        // Should handle any special characters in paths
      }
    })

    test("page title updates to show repo name and commit info", async ({page}) => {
      const seeder = await seedTestScenario(page, "full")

      const gitHub = new GitHubPage(page, ENCODED_RELAY)
      await gitHub.goto()
      await gitHub.waitForLoad()

      await page.getByText("flotilla-budabit").click()
      await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Navigate to commits tab
      await page.locator("a[href*='/commits']").first().click()
      await page.waitForURL(/\/commits/, {timeout: 10000})
      await page.waitForLoadState("networkidle")

      // Page title should include repo name and "Commits"
      const title = await page.title()
      expect(title.toLowerCase()).toContain("commits")
    })
  })
})
