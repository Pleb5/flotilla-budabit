import {expect, test, type Page} from "@playwright/test"
import {GitHubPage, RepoDetailPage} from "../pages"
import {TestSeeder, useCleanState} from "../helpers"
import {BASE_TIMESTAMP, TEST_PUBKEYS, signTestEvent} from "../fixtures/events"

const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

useCleanState(test)

const pushSeededEvents = (seeder: TestSeeder, ...events: any[]) => {
  ;(seeder as any).seededEvents.push(...events)
}

const gotoRepoFeed = async (page: Page, repoNaddr: string) => {
  await page.goto(`/spaces/${ENCODED_RELAY}/git/${repoNaddr}/feed`)
  await page.waitForLoadState("networkidle")
}

const openRepoFeedFromList = async (page: Page, repoName: string) => {
  const gitHub = new GitHubPage(page, ENCODED_RELAY)
  await gitHub.goto()
  await gitHub.waitForLoad()
  await gitHub.clickRepoByName(repoName)
  await page.waitForURL(/\/git\/.*naddr.*/, {timeout: 15000})

  const naddr = page.url().match(/\/git\/([^/]+)/)?.[1]
  if (!naddr) {
    throw new Error("Could not determine repo naddr from URL")
  }

  const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
  await repoDetail.goToFeed()
}

const typeFeedMessage = async (page: Page, message: string) => {
  const editor = page.locator(".chat__compose [contenteditable='true']").last()
  await editor.click()
  await page.keyboard.type(message)
  await page.locator(".chat__compose button").last().click()
}

test.describe("Repository Feed", () => {
  test("loads canonical repo community messages and ignores legacy naddr scope after reload", async ({
    page,
  }) => {
    const seeder = new TestSeeder()
    const repo = seeder.seedRepo({name: "repo-feed-scope", withIssues: 1})

    pushSeededEvents(
      seeder,
      signTestEvent({
        kind: 9,
        pubkey: TEST_PUBKEYS.alice,
        created_at: BASE_TIMESTAMP + 50,
        tags: [["h", repo.address]],
        content: "canonical repo feed message",
      }),
      signTestEvent({
        kind: 9,
        pubkey: TEST_PUBKEYS.bob,
        created_at: BASE_TIMESTAMP + 51,
        tags: [["h", repo.naddr]],
        content: "legacy naddr scoped message",
      }),
    )

    await seeder.setup(page)
    await gotoRepoFeed(page, repo.naddr)

    await expect(page.getByText("canonical repo feed message")).toBeVisible()
    await expect(page.getByText("legacy naddr scoped message")).toHaveCount(0)

    await page.reload()
    await page.waitForLoadState("domcontentloaded")

    await expect(page.getByText("canonical repo feed message")).toBeVisible()
    await expect(page.getByText("legacy naddr scoped message")).toHaveCount(0)
  })

  test("publishes repo feed messages with canonical scope and without protected tags", async ({
    page,
  }) => {
    const seeder = new TestSeeder()
    const repo = seeder.seedRepo({name: "repo-feed-publish"})

    await seeder.setup(page)
    await gotoRepoFeed(page, repo.naddr)

    const message = "repo feed publish smoke test"
    const mockRelay = (seeder as any).mockRelay

    await typeFeedMessage(page, message)

    const [published] = await mockRelay.waitForEvents(
      (event: any) => event.kind === 9 && event.content.includes(message),
      1,
      15000,
    )

    expect(published.tags).toContainEqual(["h", repo.address])
    expect(published.tags.some((tag: string[]) => tag[0] === "-")).toBe(false)
  })

  test("feed reactions on git items honor the repo community h scope", async ({page}) => {
    const seeder = new TestSeeder()
    const repo = seeder.seedRepo({name: "repo-feed-reactions"})
    const issue = seeder.seedIssue({
      repoAddress: repo.address,
      title: "Scoped issue",
      status: "open",
    })

    pushSeededEvents(
      seeder,
      signTestEvent({
        kind: 7,
        pubkey: TEST_PUBKEYS.bob,
        created_at: BASE_TIMESTAMP + 80,
        tags: [
          ["e", issue.eventId],
          ["p", TEST_PUBKEYS.alice],
          ["h", repo.address],
        ],
        content: "🔥",
      }),
      signTestEvent({
        kind: 7,
        pubkey: TEST_PUBKEYS.charlie,
        created_at: BASE_TIMESTAMP + 81,
        tags: [
          ["e", issue.eventId],
          ["p", TEST_PUBKEYS.alice],
        ],
        content: "👍",
      }),
    )

    await seeder.setup(page)
    await gotoRepoFeed(page, repo.naddr)

    await expect(page.getByRole("heading", {name: "Scoped issue"}).first()).toBeVisible()
    await expect(page.getByText("🔥")).toBeVisible()
    await expect(page.getByText("👍")).toHaveCount(0)
  })

  test("repo feed excludes repo-scoped comments and standalone status rows", async ({page}) => {
    const seeder = new TestSeeder()
    const repo = seeder.seedRepo({name: "repo-feed-scope-separation", withIssues: 3})

    seeder.seedIssue({
      repoAddress: repo.address,
      title: "Scope separation issue",
      status: "open",
      withComments: 1,
    })

    await seeder.setup(page)
    await gotoRepoFeed(page, repo.naddr)

    await expect(page.getByRole("heading", {name: "Scope separation issue"})).toBeVisible()
    await expect(page.getByText("Comment 1 on this issue.")).toHaveCount(0)
    await expect(page.getByText("closed this")).toHaveCount(0)
  })
})

test.describe("Repository Feed Mobile", () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true})

  test("mobile repo tabs stay sticky and git feed items open a modal without resetting tab scroll", async ({
    page,
  }) => {
    const seeder = new TestSeeder()
    seeder.seedRepo({name: "repo-feed-mobile", withIssues: 12})

    await seeder.setup(page)
    await openRepoFeedFromList(page, "repo-feed-mobile")

    const pageContent = page.locator("[data-component='PageContent']")
    const tabs = page.locator("[data-repo-tabs]").first()
    const tabRail = page.locator("[data-repo-tabs-scroll]").first()

    const initialY = (await tabs.boundingBox())?.y ?? 0

    const firstScrollTop = await pageContent.evaluate(element => {
      const scrollElement = element as HTMLElement
      scrollElement.scrollTo({top: 500})
      return scrollElement.scrollTop
    })
    await page.waitForTimeout(200)
    const stickyY = (await tabs.boundingBox())?.y ?? 0

    const secondScrollTop = await pageContent.evaluate(element => {
      const scrollElement = element as HTMLElement
      scrollElement.scrollTo({top: 1400})
      return scrollElement.scrollTop
    })
    await page.waitForTimeout(200)
    const stickyYAfterMoreScroll = (await tabs.boundingBox())?.y ?? 0

    expect(firstScrollTop).toBeGreaterThan(0)
    expect(secondScrollTop).toBeGreaterThan(firstScrollTop)
    expect(stickyY).toBeLessThan(initialY - 20)
    expect(Math.abs(stickyYAfterMoreScroll - stickyY)).toBeLessThan(3)

    const gitCard = page.locator("[data-event]").first()

    await expect(gitCard).toBeVisible()
    await gitCard.click()
    await expect(page.getByRole("button", {name: "Send Reply"})).toBeVisible()
    await expect(page.getByRole("button", {name: "Send Reaction"})).toBeVisible()
    await expect(page.getByRole("button", {name: "Open issue"})).toBeVisible()
    await page.goBack()

    await tabRail.evaluate(element => {
      const scrollElement = element as HTMLElement
      scrollElement.scrollLeft = scrollElement.scrollWidth
    })
    const scrollLeftBefore = await tabRail.evaluate(element => (element as HTMLElement).scrollLeft)

    const commitsTab = page.locator("[data-repo-tabs] a[href*='/commits']").first()
    await commitsTab.evaluate((element: HTMLElement) => element.click())
    await page.waitForURL(/\/commits/, {timeout: 10000})
    const scrollLeftAfter = await tabRail.evaluate(element => (element as HTMLElement).scrollLeft)

    const activeTab = page.locator("[data-repo-tabs] a[aria-current='page']").first()
    const railBox = await tabRail.boundingBox()
    const activeBox = await activeTab.boundingBox()

    expect(scrollLeftBefore).toBeGreaterThan(0)
    expect(scrollLeftAfter).toBeGreaterThan(0)
    expect(Math.abs(scrollLeftAfter - scrollLeftBefore)).toBeLessThan(40)
    expect(railBox).not.toBeNull()
    expect(activeBox).not.toBeNull()
    expect((activeBox?.x ?? 0) + 1).toBeGreaterThanOrEqual(railBox?.x ?? 0)
    expect((activeBox?.x ?? 0) + (activeBox?.width ?? 0) - 1).toBeLessThanOrEqual(
      (railBox?.x ?? 0) + (railBox?.width ?? 0),
    )
  })
})
