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
      ["k", "9", "room"],
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

const communityInput = `ncommunity://${communityPubkey}?relay=${encodeURIComponent(relayUrl)}`
const roomPath = `/c/${encodeURIComponent(communityInput)}/rooms/${room.id}`

test("recovers an incomplete room lookup without reloading the page", async ({page}) => {
  let roomLookupSubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [definition],
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

  const warning = page.getByText("Room lookup is incomplete or temporarily unavailable.")
  await expect(warning).toBeVisible({timeout: 15_000})
  const subscriptionsBeforeRetry = roomLookupSubscriptions
  expect(subscriptionsBeforeRetry).toBeGreaterThan(0)

  await page.getByRole("button", {name: "Retry", exact: true}).first().click()
  await expect.poll(() => roomLookupSubscriptions).toBeGreaterThan(subscriptionsBeforeRetry)
  await mockRelay.injectEvents([room])

  await expect(
    page.locator('[data-component="PageBar"]').getByText("Recovered Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(warning).toBeHidden()
  await expect(page.locator("body")).toHaveAttribute("data-room-recovery-document", "original")
})
