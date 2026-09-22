import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"
import {
  TEST_PUBKEYS,
  createIssue,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {tradeEvents, tradeReference, tradeRelay} from "./fixtures/trade-events"

test("opens an already cached listing without leaving an unavailable panel", async ({page}) => {
  await new MockRelay({seedEvents: []}).setup(page)
  await page.goto("/explore")
  await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/trade-events.ts"
    const fixture = await import(/* @vite-ignore */ path)
    await fixture.cacheTradeFixtures()
    const link = document.createElement("a")
    link.href = `/${fixture.tradeReference(fixture.tradeEvents[0])}`
    link.textContent = "Open cached listing"
    document.body.append(link)
  })
  await page.getByRole("link", {name: "Open cached listing", exact: true}).click()
  await expect(
    page.locator("[data-trade-event]").getByRole("heading", {name: "Oak workbench"}),
  ).toBeVisible()
  await expect(page.locator("[data-event-resolution]")).toHaveCount(0)
})

test("renders every shared trade kind as a rich quote and opens the native listing", async ({
  page,
}) => {
  const identifier = "trade-quotes"
  const repo = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Trade quote fixtures",
      relays: [tradeRelay],
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress: getRepoAddress(TEST_PUBKEYS.alice, identifier),
      subject: "Shared community listings",
      content: tradeEvents.map(event => `nostr:${tradeReference(event)}`).join("\n\n"),
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const mock = new MockRelay({seedEvents: [repo, issue, ...tradeEvents]})
  await mock.setup(page)
  await page.route("https://trade-preview.example/workbench.svg", route =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#bb9966"/></svg>',
    }),
  )
  await page.goto(
    `/git/${encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [tradeRelay])}/issues/${issue.id}`,
  )
  const quotes = page.locator("[data-trade-event]")
  await expect(quotes).toHaveCount(5)
  for (const [index, title] of [
    "Oak workbench",
    "Community website design",
    "Design our meetup poster",
    "Job proposal",
    "Service order",
  ].entries()) {
    await expect(quotes.nth(index).getByRole("heading", {name: title, exact: true})).toBeVisible()
    await expect(quotes.nth(index)).not.toContainText("basic view")
  }
  await expect(quotes.nth(0)).toContainText("25000 SATS")
  await expect(quotes.nth(1)).toContainText("5,000 sats / hour")
  await expect(quotes.nth(3).getByRole("link", {name: "View job", exact: true})).toBeVisible()
  await expect(quotes.nth(4)).toContainText("Fulfilled")
  await page.setViewportSize({width: 390, height: 844})
  for (const quote of await quotes.all())
    expect(await quote.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await quotes.nth(3).getByRole("link", {name: "View listing", exact: true}).click()
  await expect(page.locator("[data-trade-event] summary")).toHaveText("Event details")
  await expect(page.locator("[data-trade-event]")).toContainText(
    "I can deliver three poster concepts",
  )
  await page.getByRole("link", {name: "View job", exact: true}).click()
  await expect(
    page.locator("[data-trade-event]").getByRole("heading", {name: "Design our meetup poster"}),
  ).toBeVisible()
  expect(mock.getPublishedEvents()).toHaveLength(0)
})

test("supports exact nevent links and keeps listing media and details behind content warnings", async ({
  page,
}) => {
  const warned = signTestEvent({
    ...tradeEvents[0],
    tags: [...tradeEvents[0].tags, ["content-warning", "Test listing warning"]],
  })
  const mock = new MockRelay({seedEvents: [warned]})
  await mock.setup(page)
  await page.goto(
    `/${nip19.neventEncode({id: warned.id, author: warned.pubkey, kind: warned.kind, relays: [tradeRelay]})}`,
  )
  const card = page.locator("[data-trade-event]")
  await expect(card).toContainText("Test listing warning")
  await expect(card.locator("[data-trade-content], img, details")).toHaveCount(0)
  await card.getByRole("button", {name: "Show anyway", exact: true}).click()
  await expect(card.getByRole("heading", {name: "Oak workbench", exact: true})).toBeVisible()
  expect(mock.getPublishedEvents()).toHaveLength(0)
})
