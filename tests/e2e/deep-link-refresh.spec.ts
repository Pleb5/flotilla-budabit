import {expect, test} from "@playwright/test"

const deepLinks = [
  "/settings/about",
  "/settings/git",
  "/chat/testchat",
  "/chat/414790019b8ecd4d28f0d8178068dff3472814fb75430964ae15adcb77584934",
]

test.describe("deep link refresh", () => {
  for (const path of deepLinks) {
    test(`preserves ${path} after reload`, async ({page}) => {
      await page.goto(path, {waitUntil: "load"})
      await page.waitForTimeout(1200)
      await expect(page).toHaveURL(new RegExp(`${path}$`))

      await page.reload({waitUntil: "load"})
      await page.waitForTimeout(1200)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    })
  }
})
