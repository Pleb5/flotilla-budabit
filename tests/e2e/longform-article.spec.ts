import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"
import {
  article,
  articleAddress,
  articleNevent,
  articleProfile,
  articleRelay,
  draft,
} from "./fixtures/longform-article"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  signTestEvent,
  createIssue,
  createRepoAnnouncement,
  getRepoAddress,
  encodeRepoNaddr,
} from "./fixtures/events"

test.beforeEach(async ({page}) => {
  await new MockRelay({seedEvents: [article, articleProfile, draft]}).setup(page)
})

for (const [type, reference] of [
  ["naddr", articleAddress],
  ["nevent", articleNevent],
]) {
  test(`renders full article Markdown from a ${type} link`, async ({page}) => {
    await page.goto(`/${reference}`)
    const card = page.locator("[data-longform-article]").first()
    const body = card.locator("[data-article-body]")
    await expect(body.getByRole("heading", {name: "Build in the open", exact: true})).toBeVisible()
    await expect(body.locator("strong").first()).toHaveText("collaboration")
    await expect(body.locator("li")).toHaveCount(3)
    await expect(body.locator("table")).toContainText("Detailed explanations")
    await expect(body.locator("pre code")).toContainText('const message = "hello, Nostr";')
    await expect(body.getByRole("heading", {name: "Beyond the preview", exact: true})).toBeVisible()
    await expect(card.locator("[data-article-cover]").first()).toBeVisible()
    await expect(card.locator("time").first()).toHaveAttribute(
      "datetime",
      new Date((BASE_TIMESTAMP - 86400) * 1000).toISOString(),
    )
    await expect(card.getByRole("button", {name: "Show more", exact: true})).toHaveCount(0)
    await expect(card).not.toContainText("Budabit is showing a basic view")
    await expect(body.locator("script, [onclick], [href^='javascript:']")).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__longformXss)).toBeUndefined()
    // A self-reference renders a compact card, never a recursively nested body.
    await expect(page.locator("[data-longform-article]")).toHaveCount(2)
    await expect(page.locator("[data-article-body]")).toHaveCount(1)
    await expect(page).toHaveURL(`/${reference}`)
    await page.setViewportSize({width: 390, height: 844})
    expect(
      await card.evaluate(
        el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth,
      ),
    ).toBe(true)
  })
}

test("renders drafts with sensible missing-metadata defaults", async ({page}) => {
  await page.goto(`/${nip19.neventEncode({id: draft.id, relays: [articleRelay]})}`)
  const card = page.locator("[data-longform-article]")
  await expect(card.getByRole("heading", {name: "Untitled draft", exact: true})).toBeVisible()
  await expect(card).toContainText("Draft saved")
  await expect(card.locator("[data-article-body] strong")).toHaveText("work in progress")
  await expect(card.locator("[data-article-cover]")).toHaveCount(0)
})

test("keeps the full body, cover, and summary hidden behind a content warning", async ({page}) => {
  const sensitive = signTestEvent({
    kind: 30023,
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP,
    content: "## Sensitive heading",
    tags: [["d", "sensitive"], ["title", "Sensitive title"], ["content-warning"]],
  })
  const mock = new MockRelay({seedEvents: [sensitive]})
  // Use a fresh page so the per-page WebSocket mock is installed only once.
  const fresh = await page.context().newPage()
  await mock.setup(fresh)
  await fresh.goto(`/${nip19.neventEncode({id: sensitive.id, relays: [articleRelay]})}`)
  const card = fresh.locator("[data-longform-article]")
  await expect(card).toContainText("Content warning")
  await expect(card.locator("[data-article-content], details")).toHaveCount(0)
  await card.getByRole("button", {name: "Show anyway", exact: true}).click()
  await expect(card.getByRole("heading", {name: "Sensitive heading", exact: true})).toBeVisible()
  await fresh.close()
})

test("renders articles through the older Content and minimal-preview paths", async ({page}) => {
  await page.goto("/nevent1invalid")
  await expect(page.locator('[data-event-resolution="invalid"]')).toBeVisible()
  await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/longform-article-browser.ts"
    const fixture = await import(/* @vite-ignore */ path)
    fixture.mountArticleFixture("content")
    fixture.mountArticleFixture("minimal")
  })
  const full = page.locator('[data-longform-fixture="content"]')
  await expect(full.getByRole("heading", {name: "Build in the open", exact: true})).toBeVisible()
  await expect(full).not.toContainText("event kind 30023 by")
  const minimal = page.locator('[data-longform-fixture="minimal"]')
  await expect(minimal).toContainText("Building useful things together")
  await expect(minimal).toContainText("A practical guide")
  await expect(minimal.locator(".markdown, img")).toHaveCount(0)
})

test("respects disabled media while retaining formatted text", async ({page}) => {
  await page.goto("/nevent1invalid")
  await expect(page.locator('[data-event-resolution="invalid"]')).toBeVisible()
  await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/longform-article-browser.ts"
    const fixture = await import(/* @vite-ignore */ path)
    fixture.mountArticleFixture("card", false)
  })
  const card = page.locator('[data-longform-fixture="card"]')
  await expect(card.getByRole("heading", {name: "Build in the open", exact: true})).toBeVisible()
  await expect(card.locator("[data-article-cover], [data-article-body] img")).toHaveCount(0)
  await expect(card.locator("pre code")).toContainText("console.log(message)")
})

test("quotes an article compactly and opens the full internal article", async ({page}) => {
  const identifier = "longform-quotes"
  const repo = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Article quotes",
      relays: [articleRelay],
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress: getRepoAddress(TEST_PUBKEYS.alice, identifier),
      subject: "Article reference",
      content: `nostr:${articleAddress}`,
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const fresh = await page.context().newPage()
  const mock = new MockRelay({seedEvents: [repo, issue, article, articleProfile]})
  await mock.setup(fresh)
  await fresh.goto(
    `/git/${encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [articleRelay])}/issues/${issue.id}`,
  )
  const quote = fresh.locator("[data-longform-article]")
  await expect(quote).toContainText("Building useful things together")
  await expect(quote).toContainText("A practical guide")
  await expect(quote.locator("[data-article-body], .markdown")).toHaveCount(0)
  await quote.getByRole("link", {name: "Read article", exact: true}).click()
  await expect(fresh).toHaveURL(/\/naddr1/)
  await expect(
    fresh
      .locator("[data-article-body]")
      .getByRole("heading", {name: "Build in the open", exact: true}),
  ).toBeVisible()
  expect(mock.getPublishedEvents()).toHaveLength(0)
  await fresh.close()
})
