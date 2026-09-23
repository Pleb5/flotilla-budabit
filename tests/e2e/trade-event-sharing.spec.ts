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
import {tradeAuthorRelay, tradeEvents, tradeReference, tradeRelay} from "./fixtures/trade-events"

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
  await page.addInitScript(() => {
    // Record this fixture's copy requests without using the system clipboard.
    const copied: string[] = []
    ;(window as any).__tradeCopies = copied
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value)
        },
      },
    })
    const execCommand = document.execCommand.bind(document)
    document.execCommand = (command, ...args) => {
      if (command !== "copy") return execCommand(command, ...args)
      const input = document.activeElement
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing copy input")
      copied.push(input.value)
      return true
    }
  })
  const expectOriginalHints = (value: string, event: (typeof tradeEvents)[number]) => {
    const reference = /^https?:/.test(value)
      ? new URL(value).pathname.slice(1)
      : value.replace(/^nostr:/, "").replace(/^\//, "")
    expect(nip19.decode(reference)).toEqual(nip19.decode(tradeReference(event)))
  }
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
  await page.goto("/explore")
  await page.evaluate(
    async issuePath => {
      const path = "/tests/e2e/fixtures/trade-events.ts"
      const fixture = await import(/* @vite-ignore */ path)
      await fixture.cacheTradeAuthorRelayList()
      const link = document.createElement("a")
      link.href = issuePath
      link.textContent = "Open trade quotes"
      document.body.append(link)
    },
    `/git/${encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [tradeRelay])}/issues/${issue.id}`,
  )
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/tests/e2e/fixtures/trade-events.ts"
        const fixture = await import(/* @vite-ignore */ path)
        return fixture.getTradeAuthorRelayHints()
      }),
    )
    .toEqual([tradeAuthorRelay])
  await page.getByRole("link", {name: "Open trade quotes", exact: true}).click()
  const quotes = page.locator("[data-trade-event]")
  await expect(quotes).toHaveCount(5)
  let copies = 0
  for (const [index, title] of [
    "Oak workbench",
    "Community website design",
    "Design our meetup poster",
    "Job proposal",
    "Service order",
  ].entries()) {
    await expect(quotes.nth(index).getByRole("heading", {name: title, exact: true})).toBeVisible()
    await expect(quotes.nth(index)).not.toContainText("basic view")
    // Lookup relays include router/author fallbacks. Opening or re-sharing a
    // quote must retain just the original listing reference's relay hints.
    const card = quotes.nth(index)
    expectOriginalHints(
      (await card.getByRole("link", {name: "View listing", exact: true}).getAttribute("href"))!,
      tradeEvents[index],
    )
    for (const button of [
      card.getByRole("button", {name: /^Share /}),
      card.getByRole("button", {name: "Copy link", exact: true}),
    ]) {
      await button.click()
      await expect
        .poll(() => page.evaluate(() => (window as any).__tradeCopies.length))
        .toBe(++copies)
      expectOriginalHints(
        await page.evaluate(() => (window as any).__tradeCopies.at(-1)),
        tradeEvents[index],
      )
    }
  }
  await expect(quotes.nth(0)).toContainText("25,000 SATS")
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
  const fullCard = page.locator("[data-trade-event]")
  await fullCard.locator("summary").click()
  await expect(fullCard.locator("dd").last()).toHaveText(tradeRelay)
  await fullCard.getByRole("button", {name: "Copy Nostr reference", exact: true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).__tradeCopies.length)).toBe(++copies)
  expectOriginalHints(
    await page.evaluate(() => (window as any).__tradeCopies.at(-1)),
    tradeEvents[3],
  )
  expectOriginalHints(
    (await fullCard.getByRole("link", {name: "View job", exact: true}).getAttribute("href"))!,
    tradeEvents[2],
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
