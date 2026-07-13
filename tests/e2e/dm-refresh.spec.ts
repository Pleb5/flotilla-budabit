import {expect, test} from "@playwright/test"
import {seedDevSession} from "./helpers/dev-session"

const conversationPath = "/chat/414790019b8ecd4d28f0d8178068dff3472814fb75430964ae15adcb77584934"

test.beforeEach(async ({page}) => {
  await seedDevSession(page)
})

test("renders a direct message conversation after a hard refresh", async ({page}) => {
  const pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))

  await page.goto(conversationPath)
  await expect(page.locator('[data-component="PageBar"]')).toBeVisible({timeout: 30_000})

  await page.reload()
  await expect(page.locator('[data-component="PageBar"]')).toBeVisible({timeout: 30_000})
  expect(pageErrors).toEqual([])
})
