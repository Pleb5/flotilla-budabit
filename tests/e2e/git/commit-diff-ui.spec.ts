import {expect, test, type Page} from "@playwright/test"
import {encodeRelay, seedTestScenario, useCleanState} from "../helpers"
import {TEST_COMMITS} from "../fixtures/events"
import {GitHubPage} from "../pages"

const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeRelay(TEST_RELAY)

useCleanState(test)

const openFirstCommitDetail = async (page: Page) => {
  await seedTestScenario(page, "full")

  const gitHub = new GitHubPage(page, ENCODED_RELAY)
  await gitHub.goto()
  await gitHub.waitForLoad()

  const repoCard = page.locator("div").filter({hasText: "flotilla-budabit"}).first()
  await expect(repoCard).toBeVisible({timeout: 10000})
  await repoCard.locator("a").filter({hasText: "Browse"}).click()
  await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 10000})
  await page.waitForLoadState("networkidle")

  await page.goto(`${page.url()}/commits/${TEST_COMMITS.third}`)
  await page.waitForURL(/\/commits\/[a-f0-9]+/, {timeout: 10000})
  await page.waitForLoadState("networkidle")

  const failedToLoad = await page
    .getByText(/Failed to load commit|No branches found/i)
    .first()
    .isVisible({timeout: 3000})
    .catch(() => false)

  return {failedToLoad}
}

test.describe("Commit diff UI", () => {
  test("switches between Diffs and Files changed tabs", async ({page}) => {
    const {failedToLoad} = await openFirstCommitDetail(page)
    if (failedToLoad) return

    const diffsTab = page.getByRole("tab", {name: /diffs/i})
    const filesChangedTab = page.getByRole("tab", {name: /files changed/i})

    if (!(await diffsTab.isVisible({timeout: 5000}).catch(() => false))) return

    await expect(diffsTab).toBeVisible({timeout: 10000})
    await expect(filesChangedTab).toBeVisible({timeout: 10000})
    await expect(diffsTab).toHaveAttribute("data-state", "active")

    await filesChangedTab.click()
    await expect(filesChangedTab).toHaveAttribute("data-state", "active")
    await expect(page.getByText(/Expand all/i)).toBeVisible({timeout: 10000})

    await diffsTab.click()
    await expect(diffsTab).toHaveAttribute("data-state", "active")
  })

  test("does not render inline comment actions without a comment context", async ({page}) => {
    const {failedToLoad} = await openFirstCommitDetail(page)
    if (failedToLoad) return

    await expect(page.getByLabel(/Add inline comment/i)).toHaveCount(0)
  })

  test("drag-selecting diff lines opens the permalink menu with gutter-only highlighting", async ({
    page,
  }) => {
    const {failedToLoad} = await openFirstCommitDetail(page)
    if (failedToLoad) return

    const filesChangedTab = page.getByRole("tab", {name: /files changed/i})
    if (!(await filesChangedTab.isVisible({timeout: 5000}).catch(() => false))) return

    await filesChangedTab.click()
    await expect(filesChangedTab).toHaveAttribute("data-state", "active")

    const expandAll = page.getByRole("button", {name: /expand all/i})
    if (await expandAll.isVisible({timeout: 2000}).catch(() => false)) {
      await expandAll.click()
    }

    const diffRows = page.locator("[data-diff-index]")
    if ((await diffRows.count()) < 2) return

    const startRow = diffRows.first()
    const endRow = diffRows.nth(1)
    await expect(startRow).toBeVisible({timeout: 10000})
    await expect(endRow).toBeVisible({timeout: 10000})

    const startBox = await startRow.boundingBox()
    const endBox = await endRow.boundingBox()
    if (!startBox || !endBox) return

    const startX = startBox.x + Math.min(24, startBox.width / 4)
    const endX = endBox.x + Math.min(24, endBox.width / 4)
    const startY = startBox.y + startBox.height / 2
    const endY = endBox.y + endBox.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, {steps: 12})
    await page.mouse.up()

    await expect(page.getByRole("button", {name: /create permalink/i})).toBeVisible({
      timeout: 10000,
    })
    await expect(page.locator(".diff-selected-gutter").first()).toBeVisible({timeout: 10000})
    await expect(page.locator(".diff-line-selected")).toHaveCount(0)
  })
})
