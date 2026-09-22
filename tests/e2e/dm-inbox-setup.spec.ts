import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const viewerKey = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
const ownerKey = new Uint8Array(32).fill(23)
const owner = getPublicKey(ownerKey)
const communityId = getPublicKey(new Uint8Array(32).fill(24))
const recipientKey = new Uint8Array(32).fill(25)
const recipient = getPublicKey(recipientKey)
const primary = "wss://relay.budabit.club"
const legacy = "wss://budabit.nostr1.com"
const address = `32222:${owner}:${communityId}`
const sign = (key: Uint8Array, kind: number, tags: string[][], content = "") =>
  finalizeEvent({kind, tags, created_at: 1, content}, key)

const definition = sign(ownerKey, 32222, [
  ["d", communityId],
  ["name", "DM Setup Community"],
  ["r", primary],
  ["content", "General"],
  ["k", "1"],
  ["a", `30000:${owner}:${communityId}-members`],
])
const starred = sign(
  viewerKey,
  7,
  [
    ["h", communityId],
    ["a", address, primary, "community"],
    ["k", "32222"],
  ],
  "+",
)

async function setup(
  page: Page,
  options: {
    selfReady?: boolean
    recipientReady?: boolean
    reject?: () => boolean
    stallInbox?: boolean
  } = {},
) {
  await seedDevSession(page)
  const relay = new MockRelay({
    seedEvents: [
      definition,
      starred,
      sign(ownerKey, 10050, [["relay", legacy]]),
      ...(options.selfReady ? [sign(viewerKey, 10050, [["relay", primary]])] : []),
      ...(options.recipientReady ? [sign(recipientKey, 10050, [["relay", primary]])] : []),
    ],
    getPublishResponse: event =>
      event.kind === 10050 && options.reject?.()
        ? {outcome: "reject", message: "Fixture rejection", retain: false}
        : {outcome: "accept"},
    getSubscriptionOutcome: filters =>
      options.stallInbox && filters.some(filter => filter.kinds?.includes(10050))
        ? "stall"
        : "eose",
  })
  await relay.setup(page)
  await page
    .context()
    .route(/^https:\/\//, route =>
      route.fulfill({status: 503, body: "External service blocked by fixture"}),
    )
  await page.goto(`/chat/${recipient}`)
  return relay
}

test("missing own inbox opens setup, can dismiss/reopen, and settings expands and scrolls to messaging", async ({
  page,
}, info) => {
  const relay = await setup(page, {recipientReady: true})
  const dialog = page.getByRole("dialog", {name: "Set up your DM inbox"})
  await expect(dialog).toBeVisible({timeout: 15000})
  await expect(dialog.getByRole("button", {name: "Use for DMs"}).first()).toBeVisible()
  await expect(
    dialog.locator(".font-medium").filter({hasText: "relay.budabit.club"}).first(),
  ).toBeVisible()
  await page.screenshot({path: info.outputPath("dm-setup-desktop.png")})
  await dialog.getByRole("button", {name: "Not now", exact: true}).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole("button", {name: "Set up DM inbox", exact: true}).click()
  await dialog.getByRole("button", {name: "Open messaging relay settings"}).click()
  await expect(page).toHaveURL(/\/settings\/relays\?section=messaging$/)
  const section = page.locator("#messaging-relays")
  await expect(section.locator('[role="button"]').first()).toHaveAttribute("aria-expanded", "true")
  await expect(section.getByRole("button", {name: "Add another relay"})).toBeVisible()
  await expect(section.getByRole("heading", {name: "Direct Message Relays"})).toBeInViewport()
  await expect(dialog).toHaveCount(0)
  await page.screenshot({path: info.outputPath("dm-settings-desktop.png"), animations: "disabled"})
  expect(relay.getPublishedEvents().filter(event => event.kind === 10050)).toHaveLength(0)
})

test("mobile inline choice stays blocked on rejection and enables chat only after an ACK", async ({
  page,
}, info) => {
  await page.setViewportSize({width: 390, height: 844})
  let reject = true
  const relay = await setup(page, {recipientReady: true, reject: () => reject})
  const dialog = page.getByRole("dialog", {name: "Set up your DM inbox"})
  await expect(dialog).toBeVisible({timeout: 15000})
  const choose = dialog.getByRole("button", {name: "Use for DMs"}).first()
  await expect(choose).toBeEnabled()
  await page.screenshot({path: info.outputPath("dm-setup-mobile.png")})
  await choose.click()
  await expect(dialog.getByRole("alert")).toContainText("No relay confirmed", {timeout: 15000})
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toHaveCount(0)
  reject = false
  await choose.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toBeVisible()
  const published = relay.getPublishedEvents().filter(event => event.kind === 10050)
  expect(published.length).toBeGreaterThan(0)
  expect(
    published.every(
      event =>
        event.pubkey === DEV_PUBKEY &&
        event.tags.some(tag => tag[0] === "relay" && tag[1] === `${primary}/`),
    ),
  ).toBe(true)
})

test("recipient-only missing inbox blocks with an explanation and no setup modal or relay toast", async ({
  page,
}) => {
  await setup(page, {selfReady: true})
  await expect(page.locator(".chat__compose")).toContainText(
    "Recipient must configure a DM inbox relay",
    {timeout: 15000},
  )
  await expect(page.getByRole("dialog", {name: "Set up your DM inbox"})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Set up DM inbox", exact: true})).toHaveCount(0)
  await expect(
    page.getByText("Recipient must have a DM inbox relay configured to receive messages.", {
      exact: true,
    }),
  ).toHaveCount(0)
})

test("when both inboxes are missing, configuring self still leaves the recipient block", async ({
  page,
}) => {
  await setup(page)
  const dialog = page.getByRole("dialog", {name: "Set up your DM inbox"})
  await expect(dialog).toBeVisible({timeout: 15000})
  await dialog.getByRole("button", {name: "Use for DMs"}).first().click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(".chat__compose")).toContainText(
    "Recipient must configure a DM inbox relay",
  )
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toHaveCount(0)
})

test("configured participants can compose immediately without a setup prompt", async ({page}) => {
  await setup(page, {selfReady: true, recipientReady: true})
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole("dialog", {name: "Set up your DM inbox"})).toHaveCount(0)
  await expect(page.getByText("DM inbox relay required.", {exact: true})).toHaveCount(0)
})

test("unanswered relay checks show retry instead of claiming the user's inbox is missing", async ({
  page,
}) => {
  await setup(page, {stallInbox: true})
  await expect(page.getByRole("button", {name: "Retry relay checks"})).toBeVisible({timeout: 15000})
  await expect(page.getByRole("dialog", {name: "Set up your DM inbox"})).toHaveCount(0)
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toHaveCount(0)
})
