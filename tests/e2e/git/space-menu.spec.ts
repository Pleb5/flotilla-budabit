import {expect, test, type Page} from "@playwright/test"
import {ROOM_META} from "@welshman/util"
import {signTestEvent, TEST_PUBKEYS, BASE_TIMESTAMP} from "../fixtures/events"
import {createIsolatedContext, useCleanState} from "../helpers"

const PLATFORM_RELAY = "wss://budabit.nostr1.com/"
const ENCODED_RELAY = encodeURIComponent(PLATFORM_RELAY.replace(/^wss:\/\//, "").replace(/\/$/, ""))
const ARCHIVED_ROOM_NAME = "Archive Library"

useCleanState(test)
test.use({viewport: {width: 390, height: 844}})

const makeRoomMetaEvent = ({
  room,
  name,
  archived = false,
  created_at,
}: {
  room: string
  name: string
  archived?: boolean
  created_at: number
}) =>
  signTestEvent({
    kind: ROOM_META,
    pubkey: TEST_PUBKEYS.devUser,
    created_at,
    tags: [["d", room], ["name", name], ...(archived ? [["archived", "true"]] : [])],
    content: "",
  })

const dismissWelcomeDialog = async (page: Page) => {
  const closeDialog = page.getByRole("button", {name: "Close dialog"})

  if (await closeDialog.isVisible().catch(() => false)) {
    await closeDialog.click()
  }
}

test("mobile menu opens archived rooms and navigates to read-only room", async ({page}) => {
  await createIsolatedContext(page, {
    relayUrl: PLATFORM_RELAY,
    seedEvents: [
      makeRoomMetaEvent({room: "general", name: "General", created_at: BASE_TIMESTAMP}),
      makeRoomMetaEvent({
        room: "archive-library",
        name: ARCHIVED_ROOM_NAME,
        archived: true,
        created_at: BASE_TIMESTAMP + 1,
      }),
    ],
  })

  await page.goto(`/spaces/${ENCODED_RELAY}/`)
  await page.waitForLoadState("networkidle")
  await dismissWelcomeDialog(page)

  await expect(page.getByRole("button", {name: "Open space menu"})).toBeVisible()
  await page.getByRole("button", {name: "Open space menu"}).click()

  const archivedToggle = page.getByRole("button", {name: /Archived Rooms/i})
  await expect(archivedToggle).toBeVisible()
  await archivedToggle.click()

  await page.getByRole("link", {name: /Archive Library/i}).click()

  await expect(page).toHaveURL(`/spaces/${ENCODED_RELAY}/${encodeURIComponent(ARCHIVED_ROOM_NAME)}`)
  await expect(
    page.getByText(
      "This room stays available for reference, but posting and interactions are disabled.",
    ),
  ).toBeVisible()
  await expect(
    page.getByText(
      "This room is read-only. Posting, replies, reactions, and moderation actions are disabled.",
    ),
  ).toBeVisible()
})
