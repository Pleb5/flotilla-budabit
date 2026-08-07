import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://community-room-recovery.example/"
const communitySecret = Uint8Array.from({length: 32}, (_, index) => index + 1)
const communityPubkey = getPublicKey(communitySecret)

const definition = finalizeEvent(
  {
    kind: 10222,
    created_at: 1,
    content: "",
    tags: [
      ["alt", "BudaBit community definition"],
      ["r", relayUrl],
      ["content", "rooms"],
      ["k", "11", "room"],
      ["content", "general"],
      ["k", "9", "room-message"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
    ],
  },
  communitySecret,
)

const room = finalizeEvent(
  {
    kind: 11,
    created_at: 2,
    content: "Recovered after an incomplete lookup",
    tags: [["h", communityPubkey], ["room"], ["title", "Recovered Room"]],
  },
  communitySecret,
)

const message = finalizeEvent(
  {
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    content: "Delayed room history",
    tags: [
      ["h", communityPubkey],
      ["E", room.id, relayUrl, communityPubkey],
      ["K", "11"],
    ],
  },
  communitySecret,
)

const communityInput = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(relayUrl)}`
const roomPath = `/c/${encodeURIComponent(communityInput)}/rooms/${room.id}`

test("recovers a slow room lookup in the background without duplicate errors", async ({page}) => {
  test.setTimeout(45_000)
  let roomLookupSubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [definition, message],
    responseLatencyByKind: {11: 12_000},
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter.kinds?.includes(11) && filter.ids?.includes(room.id))) {
        roomLookupSubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  await page.goto(roomPath)
  await page.evaluate(() => {
    document.body.dataset.roomRecoveryDocument = "original"
  })

  await expect.poll(() => roomLookupSubscriptions, {timeout: 15_000}).toBeGreaterThan(0)
  await expect.poll(() => roomLookupSubscriptions, {timeout: 25_000}).toBeGreaterThan(1)
  const status = page.locator('[data-component="PageContent"] > p')
  await expect(status).toHaveCount(1)
  await expect(status).toContainText(/loading room/i)
  await expect(page.getByText("Room lookup is incomplete or temporarily unavailable.")).toBeHidden()
  await expect(page.getByRole("button", {name: "Retry", exact: true})).toHaveCount(0)
  await expect(page.getByText("Checking room access")).toHaveCount(0)
  await expect(page.getByText("Room unavailable")).toHaveCount(0)

  await mockRelay.injectEvents([room])

  await expect(
    page.locator('[data-component="PageBar"]').getByText("Recovered Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(status).not.toContainText(/loading room/i)
  await expect(page.locator("body")).toHaveAttribute("data-room-recovery-document", "original")

  const latestMessage = page.locator(`[data-event="${message.id}"]`)
  const composer = page.locator(".chat__compose")
  await expect(latestMessage).toBeVisible({timeout: 10_000})
  await expect(composer).toBeVisible()
  await expect
    .poll(async () => {
      const [messageBounds, composerBounds] = await Promise.all([
        latestMessage.boundingBox(),
        composer.boundingBox(),
      ])

      return Boolean(
        messageBounds &&
        composerBounds &&
        messageBounds.y + messageBounds.height <= composerBounds.y + 1,
      )
    })
    .toBe(true)
})

test("prioritizes delayed room history before broad community discovery", async ({page}) => {
  let broadHistorySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [definition, room, message],
    responseLatencyByKind: {9: 6_000},
    onSubscribe: (_subscriptionId, filters) => {
      if (
        filters.some(
          filter =>
            filter.kinds?.includes(9) &&
            typeof filter.since === "number" &&
            !(Array.isArray(filter["#E"]) && filter["#E"].some(value => value === room.id)),
        )
      ) {
        broadHistorySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  await page.goto(roomPath)

  await expect(
    page.locator('[data-component="PageBar"]').getByText("Recovered Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await page.waitForTimeout(3_500)

  await expect(
    page.getByText("Message history is incomplete or temporarily unavailable."),
  ).toBeHidden()
  await expect(page.getByText("Checking room access")).toHaveCount(0)
  expect(broadHistorySubscriptions).toBe(0)

  await expect(page.getByText("Delayed room history", {exact: true})).toBeVisible({timeout: 10_000})
  await expect.poll(() => broadHistorySubscriptions, {timeout: 5_000}).toBeGreaterThan(0)
  await expect(
    page.getByText("Message history is incomplete or temporarily unavailable."),
  ).toBeHidden()
})
