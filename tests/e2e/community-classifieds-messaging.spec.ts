import {readFileSync} from "node:fs"
import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

// Real host, signer, shared DM stores and production widget; all relay/asset traffic is mocked.
const bundle = readFileSync("../budabit-classifieds-widget/dist/index.html", "utf8")
const ownerKey = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)))
const sellerKey = generateSecretKey(),
  seller = getPublicKey(sellerKey)
const communityId = getPublicKey(generateSecretKey())
const relayUrl = "wss://classifieds-messaging.example"
const appUrl = "https://classifieds-widget.example/index.html"
const iconUrl = "https://classifieds-widget.example/icon.svg"
const address = `32222:${DEV_PUBKEY}:${communityId}`
const widgetId = `30033:${DEV_PUBKEY}:community-classifieds`
const sign = (kind: number, tags: string[][], content = "", key = ownerKey) =>
  finalizeEvent({kind, tags, content, created_at: 1}, key)
const permissions = [
  "nostr:sign",
  "community:queryEvents",
  "community:checkWriteCapabilities",
  "profiles:resolve",
  "ui:openProfile",
  "storage:get",
  "storage:set",
  "ui:navigate",
  "messaging:check",
  "messaging:useCommunityRelay",
]
const widget = {
  ...sign(
    30033,
    [
      ["d", "community-classifieds"],
      ["l", "tool"],
      ["image", iconUrl],
      ["icon", iconUrl],
      ["button", "Open Classifieds", "app", appUrl],
      ["version", "0.1.0"],
      ["slot", "community-home-quicklinks", "Classifieds"],
      ...permissions.map(p => ["permission", p]),
      ...[30402, 5, 22242, 24242].map(kind => ["nostrKinds", String(kind)]),
    ],
    "Community Classifieds · Budabit",
  ),
  identifier: "community-classifieds",
  widgetType: "tool",
  permissions,
  appUrl,
  appUrls: [appUrl],
  imageUrl: iconUrl,
  iconUrl,
  version: "0.1.0",
  buttons: [{index: 1, label: "Open Classifieds", type: "app", url: appUrl}],
  slot: {type: "community-home-quicklinks", label: "Classifieds"},
}
const definition = sign(32222, [
  ["d", communityId],
  ["name", "Classifieds Messaging Test"],
  ["r", relayUrl],
  ["content", "Widget-curator"],
  ["k", "30033"],
  ["a", `30000:${DEV_PUBKEY}:${communityId}-curators`],
  ["content", "Marketplace"],
  ["k", "30402"],
  ["a", `30000:${DEV_PUBKEY}:${communityId}-sellers`],
])
const curators = sign(30000, [
  ["d", `${communityId}-curators`],
  ["p", DEV_PUBKEY],
])
const sellers = sign(30000, [
  ["d", `${communityId}-sellers`],
  ["p", DEV_PUBKEY],
  ["p", seller],
])
const targeting = sign(30222, [
  ["d", "classifieds-target"],
  ["a", widgetId, relayUrl],
  ["k", "30033"],
  ["h", communityId],
  ["a", address, relayUrl],
])
const item = sign(
  30402,
  [
    ["d", "lamp"],
    ["title", "Seller lamp"],
    ["price", "25", "SATS"],
    ["type", "simple", "physical"],
    ["h", communityId],
    ["a", address, relayUrl, "community"],
  ],
  "An item offered by another seller.",
  sellerKey,
)
const sellerDm = sign(10050, [["relay", relayUrl]], "", sellerKey)
const homePath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: DEV_PUBKEY, identifier: communityId, relays: [relayUrl]})}`

async function openWidget(
  page: Page,
  options: {sellerReady?: boolean; rejectDm?: () => boolean} = {},
) {
  await seedDevSession(page)
  await page.addInitScript(
    ({widgetId, widget, relayUrl}) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            ;(window as any).__copiedText = text
          },
        },
      })
      if (location.hostname !== "localhost") return
      localStorage.setItem(
        "flotilla/extensions",
        JSON.stringify({
          enabled: [widgetId],
          disabledDefaultIds: [],
          installed: {widget: {[widgetId]: widget}},
          widgetInstallSources: {[widgetId]: {relays: [relayUrl]}},
        }),
      )
      ;(window as any).__classifiedsRequests = []
      window.addEventListener("message", event => {
        if (event.data?.type === "request")
          (window as any).__classifiedsRequests.push(event.data.action)
      })
    },
    {widgetId, widget, relayUrl},
  )
  const relay = new MockRelay({
    seedEvents: [
      definition,
      curators,
      sellers,
      widget,
      targeting,
      item,
      ...(options.sellerReady ? [sellerDm] : []),
    ],
    getPublishResponse: event =>
      event.kind === 10050 && options.rejectDm?.()
        ? {outcome: "reject", message: "Fixture DM setup rejection", retain: false}
        : {outcome: "accept"},
  })
  await relay.setup(page)
  await page
    .context()
    .route(/^https:\/\//, route =>
      route.fulfill(
        route.request().url() === appUrl
          ? {status: 200, contentType: "text/html", body: bundle}
          : route.request().url() === iconUrl
            ? {
                status: 200,
                contentType: "image/svg+xml",
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
              }
            : {status: 503, body: "External service blocked by fixture"},
      ),
    )
  await page.goto(homePath)
  const launcher = page
    .locator('[data-perf="community-home"]')
    .getByRole("button", {name: "Classifieds", exact: true})
  await expect(launcher).toBeVisible({timeout: 15000})
  await launcher.click()
  const frame = page.frameLocator(`iframe[src="${appUrl}"]`)
  await expect(frame.getByRole("button", {name: "+ Post an item"})).toBeEnabled({timeout: 15000})
  return {frame, relay, launcher}
}

test("publishing preloads DM settings, opens the messaging accordion, and resumes only after inline setup succeeds", async ({
  page,
}, info) => {
  let rejectDm = true
  const {frame, relay} = await openWidget(page, {rejectDm: () => rejectDm})
  await frame.getByRole("button", {name: "+ Post an item"}).click()
  await frame.getByLabel("Title", {exact: true}).fill("Contactable giveaway")
  await frame.getByLabel("Description", {exact: true}).fill("Collect at the community meetup.")
  await frame.getByRole("checkbox", {name: "Give it away for free"}).check()
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__classifiedsRequests.includes("messaging:check")),
    )
    .toBe(true)
  await frame.getByRole("button", {name: "Publish listing", exact: true}).click()
  await frame.getByRole("button", {name: "Publish without a photo", exact: true}).click()
  await expect(frame.getByRole("heading", {name: "Set up direct messages"})).toBeVisible()
  expect(relay.getPublishedEvents().filter(event => event.kind === 30402)).toHaveLength(0)
  await frame.getByRole("button", {name: "Open messaging settings"}).click()
  await expect(page).toHaveURL(/\/settings\/relays\?section=messaging$/)
  await expect(page.locator(`iframe[src="${appUrl}"]`)).toHaveCount(0)
  const accordion = page.locator("#messaging-relays")
  await expect(accordion.locator('[role="button"]').first()).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  await expect(accordion.getByRole("button", {name: "Add another relay"})).toBeVisible()
  await expect(accordion.locator('[role="button"]').first()).toBeInViewport()
  await page.screenshot({path: info.outputPath("messaging-settings.png"), animations: "disabled"})
  await page.goto(homePath)
  await page
    .locator('[data-perf="community-home"]')
    .getByRole("button", {name: "Classifieds", exact: true})
    .click()
  await frame.getByRole("button", {name: "+ Post an item"}).click()
  await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Contactable giveaway")
  await frame.getByRole("button", {name: "Publish listing", exact: true}).click()
  await frame.getByRole("button", {name: "Publish without a photo", exact: true}).click()
  await expect(frame.getByRole("heading", {name: "Set up direct messages"})).toBeVisible()
  await page.screenshot({path: info.outputPath("dm-setup.png")})
  await frame.getByRole("button", {name: "Use community relay for DMs"}).click()
  await expect(frame.getByRole("alert")).toContainText("No relay confirmed", {timeout: 15000})
  expect(relay.getPublishedEvents().filter(event => event.kind === 30402)).toHaveLength(0)
  rejectDm = false
  await frame.getByRole("button", {name: "Use community relay for DMs"}).click()
  await expect(frame.getByRole("heading", {name: "Contactable giveaway", exact: true})).toBeVisible(
    {timeout: 15000},
  )
  const publications = relay.getPublishedEvents()
  const dm = publications.find(event => event.kind === 10050)!
  expect(dm.pubkey).toBe(DEV_PUBKEY)
  expect(dm.tags).toContainEqual(["relay", `${relayUrl}/`])
  expect(
    publications.some(
      event =>
        event.kind === 30402 &&
        event.tags.some(tag => tag[0] === "title" && tag[1] === "Contactable giveaway"),
    ),
  ).toBe(true)
})

test("contact seller configures the buyer inline and opens a ready chat", async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844})
  const {frame, relay} = await openWidget(page, {sellerReady: true})
  await frame.getByRole("button", {name: "View Seller lamp"}).click()
  await frame.getByRole("button", {name: "Contact seller", exact: true}).click()
  await expect(frame.getByRole("heading", {name: "Set up direct messages"})).toBeVisible()
  await page.screenshot({path: info.outputPath("buyer-dm-setup-mobile.png")})
  await frame.getByRole("button", {name: "Use community relay for DMs"}).click()
  await expect(page).toHaveURL(`/chat/${seller}`)
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByText("DM inbox relay required.", {exact: true})).toHaveCount(0)
  expect(
    relay.getPublishedEvents().some(event => event.kind === 10050 && event.pubkey === DEV_PUBKEY),
  ).toBe(true)
  expect(relay.getPublishedEvents().some(event => [4, 14, 1059].includes(event.kind))).toBe(false)
})

test("an older seller without DM relays stays on the listing with a helpful prompt", async ({
  page,
}) => {
  const {frame, relay} = await openWidget(page)
  await frame.getByRole("button", {name: "View Seller lamp"}).click()
  await frame.getByRole("button", {name: "Copy message", exact: true}).click()
  await expect(frame.getByRole("status")).toContainText("Message and listing link copied.")
  const copiedMessage = await frame.locator("body").evaluate(() => (window as any).__copiedText)
  expect(copiedMessage).toMatch(/^Hi, is “Seller lamp” still available\?\nnostr:naddr1/)
  await frame.getByRole("button", {name: "Copy Nostr link", exact: true}).click()
  await expect(frame.getByRole("status")).toContainText("Nostr link copied.")
  const copiedLink = await frame.locator("body").evaluate(() => (window as any).__copiedText)
  expect(copiedLink).toBe(copiedMessage.split("\n")[1])
  expect(nip19.decode(copiedLink.slice(6))).toMatchObject({
    type: "naddr",
    data: {kind: 30402, pubkey: seller, identifier: "lamp"},
  })
  await frame.getByRole("button", {name: "Contact seller", exact: true}).click()
  await expect(
    frame.getByRole("heading", {name: "This seller isn’t ready for DMs yet"}),
  ).toBeVisible()
  await expect(frame.getByRole("button", {name: "Use community relay for DMs"})).toHaveCount(0)
  await expect(page).toHaveURL(url => url.pathname === homePath)
  await frame.getByRole("button", {name: "Back to listing", exact: true}).click()
  await expect(frame.getByRole("heading", {name: "Seller lamp", exact: true})).toBeVisible()
  expect(relay.getPublishedEvents().filter(event => event.kind === 10050)).toHaveLength(0)
})
