import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const watcher = getPublicKey(new Uint8Array(32).fill(7))
const communityId = "a".repeat(64)
const relayUrl = "wss://ci-community.example"
const watcherTag = ["ci-repo-watcher", watcher, "wss://watcher.example"]
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: Math.floor(Date.now() / 1000) - 60,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "CI watcher community"],
      ["r", relayUrl],
      watcherTag,
      ["content", "General"],
      ["k", "1111"],
    ],
  },
  Uint8Array.from(Buffer.from(DEV_SECRET, "hex")),
)
const communityPath = `/c/${nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relayUrl],
})}`
const watcherPanel = (page: Page) => page.getByRole("region", {name: "CI repository watchers"})

async function openEditor(page: Page, edit = false) {
  await seedDevSession(page)
  // All WebSockets are intercepted; signing uses only the disposable fixture identity.
  const relay = new MockRelay({
    seedEvents: edit ? [definition] : [],
    publishResponsesByRelay: {[relayUrl]: {outcome: "accept", retain: true}},
  })
  await relay.setup(page)
  await page.goto(edit ? `${communityPath}/admin` : "/explore/create-community")
  await expect(watcherPanel(page).getByRole("button", {name: "Add CI watcher"})).toBeEnabled()
  return relay
}

test("creates a community with canonical watcher advertisements and rejects invalid drafts", async ({
  page,
}) => {
  const relay = await openEditor(page)
  await page.locator("#community-name").fill("CI watcher creation")
  await page.locator("#community-primaryRelay").fill(relayUrl)
  const panel = watcherPanel(page)
  await panel.getByRole("button", {name: "Add CI watcher"}).click()
  await panel.getByRole("textbox", {name: "Watcher public key"}).fill("not-a-pubkey")
  await panel.getByRole("textbox", {name: "Watcher relays"}).fill("https://wrong.example")
  await page.getByRole("button", {name: "Create", exact: true}).click()
  await expect(panel.getByRole("textbox", {name: "Watcher public key"})).toBeFocused()
  await expect(panel.getByRole("alert")).toHaveCount(2)
  expect(relay.getPublishedEventsByKind(32222)).toEqual([])

  await panel.getByRole("textbox", {name: "Watcher public key"}).fill(nip19.npubEncode(watcher))
  await panel
    .getByRole("textbox", {name: "Watcher relays"})
    .fill("wss://watcher.example/\nwss://backup.example/\nwss://watcher.example")
  await page.getByRole("button", {name: "Create", exact: true}).click()
  await expect(page).toHaveURL(/\/c\/naddr1[^/]+$/)
  const event = relay.getPublishedEventsByKind(32222).at(-1)!
  expect(event.pubkey).toBe(DEV_PUBKEY)
  expect(event.tags.filter(tag => tag[0] === "ci-repo-watcher")).toEqual([
    ["ci-repo-watcher", watcher, "wss://watcher.example", "wss://backup.example"],
  ])
  expect(event.tags.findIndex(tag => tag[0] === "ci-repo-watcher")).toBeLessThan(
    event.tags.findIndex(tag => tag[0] === "content"),
  )
})

test("loads and resets watcher drafts and preserves them when publishing other settings", async ({
  page,
}) => {
  const relay = await openEditor(page, true)
  const panel = watcherPanel(page)
  await expect(panel.getByRole("textbox", {name: "Watcher public key"})).toHaveValue(watcher)
  await expect(panel.getByRole("textbox", {name: "Watcher relays"})).toHaveValue(watcherTag[2])
  await panel.getByRole("textbox", {name: "Watcher relays"}).fill("wss://changed.example")
  await panel.getByRole("button", {name: "Add CI watcher"}).click()
  await page.getByRole("button", {name: "Reset changes"}).last().click()
  await expect(panel.getByRole("textbox", {name: "Watcher public key"})).toHaveCount(1)
  await expect(panel.getByRole("textbox", {name: "Watcher relays"})).toHaveValue(watcherTag[2])
  await page.locator("#community-description").fill("Metadata edit preserves infrastructure")
  await page.getByRole("button", {name: "Update", exact: true}).click()
  await expect(page).toHaveURL(/\/c\/naddr1[^/]+$/)
  expect(relay.getPublishedEventsByKind(32222).at(-1)?.tags).toContainEqual(watcherTag)
})

test("removes the last watcher advertisement in community settings on mobile", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  const relay = await openEditor(page, true)
  const panel = watcherPanel(page)
  await panel.scrollIntoViewIfNeeded()
  expect(
    await panel.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return [...element.querySelectorAll("input, textarea, button")].every(control => {
        const rect = control.getBoundingClientRect()
        return rect.left >= bounds.left && rect.right <= bounds.right
      })
    }),
  ).toBe(true)
  await page.screenshot({path: test.info().outputPath("ci-watchers-mobile.png")})
  await panel.getByRole("button", {name: "Remove CI watcher 1", exact: true}).click()
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await page.getByRole("button", {name: "Update", exact: true}).click()
  await expect(page).toHaveURL(/\/c\/naddr1[^/]+$/)
  expect(
    relay
      .getPublishedEventsByKind(32222)
      .at(-1)
      ?.tags.filter(tag => tag[0] === "ci-repo-watcher"),
  ).toEqual([])
})
