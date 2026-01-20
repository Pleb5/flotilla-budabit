import {expect, test} from "@playwright/test"

test("app loads", async ({page}) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  // The app shows either the login screen (if not authenticated)
  // or the main nav (if authenticated). Either indicates successful load.
  const loginScreen = page.getByTestId("login-screen")
  const navElement = page.locator("nav, [class*='nav'], [class*='sidebar']").first()

  // Wait for either the login screen or nav to be visible
  await expect(loginScreen.or(navElement)).toBeVisible({timeout: 15000})
})