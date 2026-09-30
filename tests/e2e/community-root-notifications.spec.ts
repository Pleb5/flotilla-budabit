import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerSecret = Buffer.from(DEV_SECRET, "hex")
const authorSecret = new Uint8Array(32).fill(13)
const author = getPublicKey(authorSecret)
const communityId = getPublicKey(new Uint8Array(32).fill(14))
const relayUrl = "wss://root-notifications.example"
const originalRelay = "wss://root-originals.example/"
const createdAt = Math.floor(Date.now() / 1000) - 100
const communityAddress = `32222:${DEV_PUBKEY}:${communityId}`
const listIdentifier = `${communityId}-writers`
const listAddress = `30000:${DEV_PUBKEY}:${listIdentifier}`
const communityPath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: DEV_PUBKEY, identifier: communityId, relays: [relayUrl]})}`
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Root Notifications Community"],
      ["r", relayUrl],
      ["content", "Thread-creator"],
      ["k", "11", "threads"],
      ["a", listAddress, relayUrl],
      ["content", "Calendar-event-creator"],
      ["k", "31922"],
      ["k", "31923"],
      ["a", listAddress, relayUrl],
      ["content", "Fundraiser-goals-creator"],
      ["k", "9041"],
      ["a", listAddress, relayUrl],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", listAddress, relayUrl],
    ],
  },
  ownerSecret,
)
const profileList = finalizeEvent(
  {
    kind: 30000,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", listIdentifier],
      ["p", DEV_PUBKEY],
      ["p", author],
    ],
  },
  ownerSecret,
)
const thread = (title: string, timestamp: number, secret = authorSecret) =>
  finalizeEvent(
    {
      kind: 11,
      created_at: timestamp,
      content: `${title} content`,
      tags: [
        ["h", communityId],
        ["title", title],
      ],
    },
    secret,
  )
const bell = (page: Page) => page.getByRole("button", {name: "Notifications", exact: true})
const indicator = (page: Page) => bell(page).locator("[data-notification-indicator]")
const sectionIndicator = (page: Page, section: string) =>
  page.locator(`a.btn[href$="/${section}"] [data-notification-indicator]`)
const dialog = (page: Page) => page.getByRole("dialog", {name: "Notifications", exact: true})
const pageErrors = new WeakMap<Page, string[]>()

test.afterEach(({page}) => {
  expect(pageErrors.get(page) || []).toEqual([])
})

test.beforeEach(async ({page}) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  await seedDevSession(page)
  await page.addInitScript(
    ({key, timestamp}) => {
      if (!localStorage.getItem("communityNotificationBaselines")) {
        localStorage.setItem(
          "communityNotificationBaselines",
          JSON.stringify({version: 2, byCommunityAddress: {[key]: timestamp}}),
        )
      }
    },
    {key: `${DEV_PUBKEY}:${communityAddress}`, timestamp: createdAt},
  )
})

test("incoming threads notify before opening the center and reading one preserves its unread sibling", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  const first = thread("First unread thread", createdAt + 10)
  const second = thread("Second unread thread", createdAt + 20)
  const own = thread("My own newest thread", createdAt + 30, ownerSecret)
  const relay = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, profileList, first, second, own],
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 20_000})
  await expect(indicator(page)).toBeVisible()
  await page.goto(`${communityPath}/threads/${second.id}`)
  await expect(page.getByRole("heading", {name: "Second unread thread", exact: true})).toBeVisible()
  await page.getByRole("button", {name: "Root Notifications Community", exact: true}).click()
  await expect(page).toHaveURL(communityPath)
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 15_000})
  await expect(indicator(page)).toBeVisible()
  await bell(page).click()
  await expect(dialog(page).getByText("started a thread", {exact: true})).toHaveCount(2)
  await expect(dialog(page).getByText("My own newest thread", {exact: true})).toHaveCount(0)
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await page.screenshot({
    path: info.outputPath("root-thread-notifications.png"),
    animations: "disabled",
  })
  await dialog(page).getByRole("button", {name: "Close notifications"}).click()
  await expect(sectionIndicator(page, "threads")).toHaveCount(0)
  await expect(indicator(page)).toHaveCount(0)
  await page.reload()
  await bell(page).click()
  await expect(dialog(page).getByText("started a thread", {exact: true})).toHaveCount(2, {
    timeout: 15_000,
  })
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toHaveCount(0)
  await dialog(page).getByRole("button", {name: "Close notifications"}).click()
  const later = thread("Live incoming thread", Math.floor(Date.now() / 1000))
  await relay.injectEvents([later])
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 15_000})
  await expect(indicator(page)).toBeVisible()
})

test("calendar and goal wrappers resolve delayed originals and notify with direct item links", async ({
  page,
}, info) => {
  const roots = [31922, 31923, 9041].map((kind, index) =>
    finalizeEvent(
      {
        kind,
        created_at: createdAt + 10 + index,
        content: kind === 9041 ? "New fundraiser" : "Root notification fixture",
        tags: [
          ["d", `root-${kind}`],
          ["title", kind === 9041 ? "New fundraiser" : `New calendar ${kind}`],
          ["start", kind === 31922 ? "2099-01-01" : "4070908800"],
          ["amount", "100000"],
        ],
      },
      authorSecret,
    ),
  )
  const wrappers = roots.map(root =>
    finalizeEvent(
      {
        kind: 30222,
        created_at: root.created_at + 1,
        content: "",
        tags: [
          ["d", `target-${root.kind}`],
          ["e", root.id, originalRelay.replace(/\/$/, ""), author],
          ["k", String(root.kind)],
          ["h", communityId],
          ["a", communityAddress, relayUrl],
        ],
      },
      authorSecret,
    ),
  )
  const relay = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, profileList, ...wrappers],
    seedEventsByRelay: {[originalRelay]: roots},
    responseLatencyByKind: {31922: 400, 31923: 400, 9041: 400},
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(sectionIndicator(page, "calendar")).toBeVisible({timeout: 20_000})
  await expect(sectionIndicator(page, "goals")).toBeVisible()
  await expect(indicator(page)).toBeVisible()
  await bell(page).click()
  await expect(dialog(page).getByText("created a calendar event", {exact: true})).toHaveCount(2)
  await expect(dialog(page).getByText("created a goal", {exact: true})).toHaveCount(1)
  await page.setViewportSize({width: 390, height: 844})
  await page.screenshot({
    path: info.outputPath("root-calendar-goal-notifications-mobile.png"),
    animations: "disabled",
  })
  await dialog(page).getByRole("button").filter({hasText: "created a goal"}).first().click()
  await expect(page).toHaveURL(new RegExp(`/goals/${roots[2].id}`))
  await expect(page.getByText("New fundraiser", {exact: true}).first()).toBeVisible()
})
