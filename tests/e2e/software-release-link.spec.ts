import {readFileSync} from "node:fs"
import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {MockRelay, type NostrEvent} from "./helpers/mock-relay"
import {createRepoAnnouncement, signTestEvent, TEST_PUBKEYS} from "./fixtures/events/repo"

const pubkey = TEST_PUBKEYS.alice
const relays = ["wss://software-release.test/"]
const sign = (kind: number, tags: string[][], content = "", created_at = 100) =>
  signTestEvent({kind, pubkey, tags, content, created_at})
const repo = signTestEvent(
  createRepoAnnouncement({identifier: "software", name: "Software repository", relays, pubkey}),
)
const app = sign(32267, [
  ["d", "club.fixture.app"],
  ["name", "Fixture App"],
  ["a", `30617:${pubkey}:software`],
])
const asset = sign(3063, [
  ["i", "club.fixture.app"],
  ["version", "1.0"],
  ["m", "application/octet-stream"],
  ["x", "a".repeat(64)],
  ["filename", "app.bin"],
])
const release = sign(
  30063,
  [
    ["d", "club.fixture.app@1.0"],
    ["i", "club.fixture.app"],
    ["version", "1.0"],
    ["e", asset.id],
  ],
  "Release details",
)
const repoPointer = nip19.naddrEncode({kind: 30617, pubkey, identifier: "software", relays})
const pointer = nip19.naddrEncode({kind: 30063, pubkey, identifier: "club.fixture.app@1.0", relays})
const path = `/git/${repoPointer}/releases/${pointer}`
const unavailable =
  "This release is unavailable under the current repository and application authority."

// The production check uses the deployed bundle with the same controlled signed relay graph.
if (process.env.BUDABIT_RELEASE_BASE_URL) test.use({baseURL: process.env.BUDABIT_RELEASE_BASE_URL})

const pageErrors = new WeakMap<object, string[]>()
test.beforeEach(async ({page, baseURL}) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  page.on("requestfailed", request =>
    errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`),
  )
  await page.route("https://**", route =>
    new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue()
      : route.fulfill({status: 503, body: "Isolated release fixture"}),
  )
})

test.afterEach(async ({page}, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({path: info.outputPath("release-failure.png"), fullPage: true})
    await info.attach("release-page", {
      body: await page.locator("body").innerText(),
      contentType: "text/plain",
    })
    await info.attach("release-errors", {
      body: (pageErrors.get(page) || []).join("\n"),
      contentType: "text/plain",
    })
  }
})

test("cold release route follows replacements and represents deleted or unknown records", async ({
  page,
}) => {
  const newer = sign(30063, release.tags, "Current release details", 101)
  const relay = new MockRelay({seedEvents: [repo, app, asset, release, newer]})
  await relay.setup(page)
  await page.goto(path)
  await expect(page.getByRole("heading", {name: "Fixture App 1.0", exact: true})).toBeVisible()
  await expect(page.getByText("Current release details", {exact: true})).toBeVisible()
  await expect(
    page.getByRole("list", {name: "Release assets"}).getByRole("link", {name: "app.bin"}),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByText("Current release details", {exact: true})).toBeVisible()
  await page.goto(
    `/git/${repoPointer}/releases/${nip19.naddrEncode({kind: 30063, pubkey, identifier: "unknown@1.0", relays})}`,
  )
  await expect(page.getByText(unavailable, {exact: true})).toBeVisible()
  expect(relay.getPublishedEvents()).toEqual([])
})

test("cold deleted release is a record-level unavailable state", async ({page}) => {
  const deletion = sign(5, [["a", `30063:${pubkey}:club.fixture.app@1.0`]], "", 102)
  const relay = new MockRelay({seedEvents: [repo, app, asset, release, deletion]})
  await relay.setup(page)
  await page.goto(path)
  await expect(page.getByRole("heading", {name: "Software release", exact: true})).toBeVisible()
  await expect(page.getByText(unavailable, {exact: true})).toBeVisible()
  await expect(page.getByRole("list", {name: "Release assets"})).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("exact native chooser URL opens the same signed graph in a cold browser", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.BUDABIT_RELEASE_FIXTURE,
    "Provide the native chooser fixture for cross-client verification",
  )
  const fixture = JSON.parse(readFileSync(process.env.BUDABIT_RELEASE_FIXTURE!, "utf8")) as {
    url: string
    events: NostrEvent[]
    releaseId: string
    assetId: string
    applicationName: string
  }
  const relay = new MockRelay({seedEvents: fixture.events})
  await relay.setup(page)
  // Only the origin changes to the checkout under verification; the exact shared path/query is retained.
  const url = new URL(fixture.url)
  await page.goto(url.pathname + url.search + url.hash)
  const event = fixture.events.find(e => e.id === fixture.releaseId)!
  await expect(
    page.getByRole("heading", {name: `${fixture.applicationName} 1.0`, exact: true}),
  ).toBeVisible()
  await expect(page.getByText(event.content, {exact: true})).toBeVisible()
  await expect(
    page.getByRole("list", {name: "Release assets"}).getByRole("link", {name: "app.apk"}),
  ).toHaveAttribute(
    "href",
    fixture.events.find(e => e.id === fixture.assetId)!.tags.find(t => t[0] === "url")![1],
  )
  await page.screenshot({
    path: testInfo.outputPath("native-release-cold-browser.png"),
    fullPage: true,
  })
  expect(relay.getPublishedEvents()).toEqual([])
})
