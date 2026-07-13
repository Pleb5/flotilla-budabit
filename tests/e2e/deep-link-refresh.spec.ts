import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"

const community = nip19.npubEncode("a".repeat(64))
const profile = nip19.npubEncode(DEV_PUBKEY)

const deepLinks: Array<{path: string; expectedText?: string; component?: string}> = [
  {path: "/explore", expectedText: "Explore Communities"},
  {path: "/settings/about", expectedText: "Thanks for using BudaBit!"},
  {path: "/settings/relays", expectedText: "Messaging Relays"},
  {path: "/git", expectedText: "Git Repositories"},
  {path: `/people/${profile}`, component: "PageBar"},
  {path: `/c/${community}`, component: "PageBar"},
  {path: `/c/${community}/threads`, expectedText: "Threads"},
  {path: `/c/${community}/calendar`, expectedText: "Calendar"},
  {path: `/c/${community}/goals`, expectedText: "Goals"},
  {path: `/c/${community}/badges`, expectedText: "Community Badges"},
  {path: `/c/${community}/widgets`, expectedText: "Widgets"},
]

test.describe("deep link refresh", () => {
  test.beforeEach(async ({page}) => {
    await seedDevSession(page)
  })

  for (const {path, expectedText, component} of deepLinks) {
    test(`renders ${path} after reload`, async ({page}) => {
      const assertRoute = async () => {
        expect(new URL(page.url()).pathname).toBe(path)

        if (expectedText) {
          await expect(page.getByText(expectedText, {exact: true}).first()).toBeVisible({
            timeout: 15_000,
          })
        }

        if (component) {
          await expect(page.locator(`[data-component="${component}"]`).first()).toBeVisible({
            timeout: 15_000,
          })
        }
      }

      await page.goto(path, {waitUntil: "load"})
      await assertRoute()

      await page.reload({waitUntil: "load"})
      await assertRoute()
    })
  }
})
