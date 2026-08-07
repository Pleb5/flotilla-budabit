import {expect, test} from "@playwright/test"
import {finalizeEvent} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://community-room-publishing.example/"
const communitySecret = Uint8Array.from(
  DEV_SECRET.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [],
)

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
    content: "Publishing regression room",
    tags: [["h", DEV_PUBKEY], ["room"], ["title", "Publishing Room"]],
  },
  communitySecret,
)

const communityInput = `ncommunity://${DEV_PUBKEY}?relay=${encodeURIComponent(relayUrl)}`
const roomPath = `/c/${encodeURIComponent(communityInput)}/rooms/${room.id}`

const openRoom = async (page: Parameters<typeof seedDevSession>[0], mockRelay: MockRelay) => {
  await seedDevSession(page)
  await mockRelay.setup(page)
  await page.goto(roomPath)
  await expect(
    page.locator('[data-component="PageBar"]').getByText("Publishing Room", {exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(page.locator('.chat__compose [contenteditable="true"]')).toBeVisible()
}

test("shows a room message before relay acknowledgement and keeps it after success", async ({
  page,
}) => {
  const messageText = "Optimistic message before acknowledgement"
  const mockRelay = new MockRelay({
    seedEvents: [definition, room],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "accept", latency: 2_000},
    },
  })

  await openRoom(page, mockRelay)
  await page.locator('.chat__compose [contenteditable="true"]').fill(messageText)
  await page.getByRole("button", {name: "Send message"}).click()

  const message = page.locator("[data-event]").filter({hasText: messageText})
  await expect(message).toBeVisible({timeout: 1_000})
  await expect(message).toHaveCount(1)

  await mockRelay.waitForEvent(9)
  await page.waitForTimeout(2_100)

  await expect(message).toBeVisible()
  await expect(message).toHaveCount(1)
  await expect(message.getByText("Failed to send!", {exact: true})).toHaveCount(0)
})

test("keeps a failed room message visible with its retry action", async ({page}) => {
  const messageText = "Retryable failed room message"
  const mockRelay = new MockRelay({
    seedEvents: [definition, room],
    publishResponsesByRelay: {
      [relayUrl]: {outcome: "reject", latency: 500, message: "rejected for test"},
    },
  })

  await openRoom(page, mockRelay)
  await page.locator('.chat__compose [contenteditable="true"]').fill(messageText)
  await page.getByRole("button", {name: "Send message"}).click()

  const message = page.locator("[data-event]").filter({hasText: messageText})
  const failure = message.getByText("Failed to send!", {exact: true})
  await expect(message).toBeVisible({timeout: 1_000})
  await expect(failure).toBeVisible({timeout: 5_000})
  await failure.hover()

  const retry = page.getByRole("button", {name: "Retry", exact: true})
  await expect(retry).toBeVisible()
  await retry.click()
  await expect
    .poll(() => mockRelay.getPublishedEvents().filter(event => event.kind === 9).length)
    .toBe(2)
  await expect(message).toHaveCount(1)
})
