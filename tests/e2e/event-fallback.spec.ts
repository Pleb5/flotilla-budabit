import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  signTestEvent,
  createRepoAnnouncement,
  createIssue,
  encodeRepoNaddr,
  getRepoAddress,
} from "./fixtures/events"
import {
  fallbackEvent,
  fallbackPath,
  fallbackReference,
  fallbackRelay,
  relatedNote,
} from "./fixtures/event-fallback"

test("renders unknown events safely and navigates between native event views", async ({page}) => {
  const mock = new MockRelay({seedEvents: [fallbackEvent, relatedNote]})
  await mock.setup(page)
  await page.goto(fallbackPath)
  const card = page.locator(`[data-generic-event][data-event="${fallbackEvent.id}"]`)
  await expect(
    card.getByRole("heading", {name: "A useful event without a dedicated view"}),
  ).toBeVisible()
  await expect(card).toContainText("<img src=x onerror=alert(1)>")
  await expect(card.locator('img[src="x"]')).toHaveCount(0)
  await expect(card.getByRole("button", {name: "Copy JSON", exact: true})).toHaveCount(0)
  await card.getByRole("button", {name: "Show more", exact: true}).click()
  await expect(card.getByRole("button", {name: "Show less", exact: true})).toBeVisible()
  await card.locator("summary").click()
  await expect(card.getByRole("button", {name: "Copy JSON", exact: true})).toBeVisible()
  await expect(card.locator("pre")).toContainText(fallbackEvent.id)

  await page.setViewportSize({width: 390, height: 844})
  expect(await card.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(
    true,
  )
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)

  await card.getByRole("link", {name: "Related event 1", exact: true}).click()
  const related = page.locator(`[data-generic-event][data-event="${relatedNote.id}"]`)
  await expect(related).toContainText(relatedNote.content)
  await expect(card).toHaveCount(0)
  await page.goBack()
  await expect(card).toBeVisible()
  expect(page.context().pages()).toHaveLength(1)
  expect(mock.getPublishedEvents()).toHaveLength(0)
})

test("resolves note and address references with structured and metadata-only bodies", async ({
  page,
}) => {
  const article = signTestEvent({
    kind: 30023,
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP,
    content: '{"message":"Structured content","items":[1,2]}',
    tags: [
      ["d", ""],
      ["title", "Structured article"],
    ],
  })
  const tagsOnly = signTestEvent({
    kind: 5432,
    pubkey: TEST_PUBKEYS.bob,
    created_at: BASE_TIMESTAMP,
    content: "",
    tags: [["topic", "Useful metadata"]],
  })
  await new MockRelay({seedEvents: [article, tagsOnly]}).setup(page)
  const naddr = nip19.naddrEncode({
    kind: article.kind,
    pubkey: article.pubkey,
    identifier: "",
    relays: [fallbackRelay],
  })
  await page.goto(`/${naddr}`)
  await expect(page.locator("[data-generic-event] pre")).toContainText(
    '"message": "Structured content"',
  )
  await expect(page).toHaveURL(`/${naddr}`)
  await page.goto(`/${nip19.noteEncode(tagsOnly.id)}`)
  await expect(page.locator("[data-generic-event]")).toContainText("Useful metadata")
  await expect(page.locator("[data-generic-event] dt")).toHaveText("topic")
})

test("keeps content warnings over previews and technical details until revealed", async ({
  page,
}) => {
  const warned = signTestEvent({
    kind: 5432,
    pubkey: TEST_PUBKEYS.alice,
    created_at: BASE_TIMESTAMP,
    content: "Sensitive fixture body",
    tags: [
      ["title", "Sensitive fixture title"],
      ["content-warning", "Test warning"],
    ],
  })
  await new MockRelay({seedEvents: [warned]}).setup(page)
  await page.goto(`/${nip19.neventEncode({id: warned.id, relays: [fallbackRelay]})}`)
  const card = page.locator("[data-generic-event]")
  await expect(card).toContainText("Test warning")
  await expect(card).not.toContainText("Sensitive fixture")
  await expect(card.locator("details")).toHaveCount(0)
  await card.getByRole("button", {name: "Show anyway", exact: true}).click()
  await expect(card).toContainText("Sensitive fixture body")
})

test("bounds stalled requests and retries in place without a Home or external redirect", async ({
  page,
}) => {
  let respond = false
  const mock = new MockRelay({
    seedEvents: [fallbackEvent],
    getSubscriptionOutcome: filters =>
      filters.some(filter => filter.ids?.includes(fallbackEvent.id)) && !respond ? "stall" : "eose",
  })
  await mock.setup(page)
  await page.goto(fallbackPath)
  await expect(page.locator('[data-event-resolution="unavailable"]')).toBeVisible({timeout: 12_000})
  await expect(page).toHaveURL(fallbackPath)
  respond = true
  await page.getByRole("button", {name: "Retry", exact: true}).click()
  await expect(page.locator(`[data-generic-event][data-event="${fallbackEvent.id}"]`)).toBeVisible()
  expect(page.context().pages()).toHaveLength(1)
})

test("keeps quoted unknown events internal while preserving dedicated issue navigation", async ({
  page,
}) => {
  const identifier = "native-event-quotes"
  const repo = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Native event quotes",
      relays: [fallbackRelay],
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress: getRepoAddress(TEST_PUBKEYS.alice, identifier),
      subject: "Native fallback quote",
      content: `nostr:${fallbackReference}`,
      pubkey: TEST_PUBKEYS.alice,
    }),
  )
  const mock = new MockRelay({seedEvents: [repo, issue, fallbackEvent]})
  await mock.setup(page)
  const issuePath = `/git/${encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [fallbackRelay])}/issues/${issue.id}`
  await page.goto(`/${nip19.neventEncode({id: issue.id, relays: [fallbackRelay]})}`)
  await expect(page).toHaveURL(`${issuePath}#event-${issue.id}`)
  const quote = page.locator(`[data-generic-event][data-event="${fallbackEvent.id}"]`)
  await expect(quote).toContainText("A useful event without a dedicated view")
  await expect(quote.getByRole("link", {name: "Open event", exact: true})).toHaveAttribute(
    "href",
    /^\/(?:nevent|naddr)1/,
  )
  await quote.getByRole("link", {name: "Open event", exact: true}).click()
  await expect(page.locator("[data-generic-event] summary")).toHaveText("Event details")
  await expect(page).toHaveURL(/\/(?:nevent|naddr)1/)
  expect(page.context().pages()).toHaveLength(1)
})
