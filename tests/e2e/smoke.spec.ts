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

test.describe("narrow viewport", () => {
  test.use({viewport: {width: 320, height: 720}})

  test("long toast messages stay within the viewport", async ({page}) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const message = `Repository not found: https://grasp.budabit.club/${"a".repeat(240)}.git`
    await page.evaluate(async toastMessage => {
      const moduleUrl = performance
        .getEntriesByType("resource")
        .map(entry => entry.name)
        .find(url => url.includes("/src/app/util/toast.ts"))
      if (!moduleUrl) throw new Error("Loaded toast store module was not found")
      const {pushToast} = await import(moduleUrl)
      pushToast({message: toastMessage, timeout: 0})
    }, message)

    const alert = page.getByRole("alert")
    await expect(alert).toBeVisible()

    const alertBounds = await alert.boundingBox()
    expect(alertBounds).not.toBeNull()
    expect(alertBounds!.x).toBeGreaterThanOrEqual(0)
    expect(alertBounds!.x + alertBounds!.width).toBeLessThanOrEqual(320)

    const messageFits = await alert.locator("p").evaluate(element => {
      const node = element as HTMLElement
      return node.scrollWidth <= node.clientWidth + 1
    })
    expect(messageFits).toBe(true)

    const closeBounds = await alert.getByRole("button").last().boundingBox()
    expect(closeBounds).not.toBeNull()
    expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(320)
  })
})
