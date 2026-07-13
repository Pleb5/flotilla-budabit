import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"

const community = nip19.npubEncode("a".repeat(64))
const firstRoomPath = `/c/${community}/rooms/first-room`
const secondRoomPath = `/c/${community}/rooms/second-room`

test("marks a room checked when navigating directly to another room", async ({page}) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto(firstRoomPath)
  await expect(page.getByText("Still looking for messages...")).toBeVisible()

  await page.evaluate(path => {
    document.body.dataset.clientNavigation = "ready"
    const link = document.createElement("a")
    link.href = path
    link.dataset.testid = "switch-room"
    link.textContent = "Switch room"
    document.body.appendChild(link)
  }, secondRoomPath)

  await page.getByTestId("switch-room").click()
  await expect(page).toHaveURL(secondRoomPath)
  await expect(page.locator("body")).toHaveAttribute("data-client-navigation", "ready")

  await expect
    .poll(() =>
      page.evaluate(path => {
        const checked = JSON.parse(localStorage.getItem("checked") || "{}")
        return checked[path] || 0
      }, firstRoomPath),
    )
    .toBeGreaterThan(0)

  const secondRoomChecked = await page.evaluate(path => {
    const checked = JSON.parse(localStorage.getItem("checked") || "{}")
    return checked[path]
  }, secondRoomPath)

  expect(secondRoomChecked).toBeUndefined()
})
