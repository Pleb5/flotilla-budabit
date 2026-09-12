import {expect, test, type Locator, type Page} from "@playwright/test"
import {finalizeEvent} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const authorSecret = new Uint8Array(32).fill(7)
const createdAt = Math.floor(Date.now() / 1000)
const mentions = Array.from({length: 30}, (_, index) =>
  finalizeEvent(
    {
      kind: 1111,
      created_at: createdAt - index,
      content:
        index === 0
          ? "Notification fixture 01 — distinctive kestrel"
          : `Notification fixture ${String(index + 1).padStart(2, "0")}`,
      tags: [
        ["p", DEV_PUBKEY],
        ["K", "1621"],
      ],
    },
    authorSecret,
  ),
)
const authorProfile = finalizeEvent(
  {
    kind: 0,
    created_at: createdAt,
    content: JSON.stringify({name: "Notification test author"}),
    tags: [],
  },
  authorSecret,
)

const notifications = (page: Page) => page.getByRole("dialog", {name: "Notifications", exact: true})

const openNotifications = async (page: Page) => {
  await page.getByRole("button", {name: "Notifications", exact: true}).click()
  await expect(notifications(page).getByRole("button", {name: "Close notifications"})).toBeFocused()
  await expect(
    page.getByTestId("notification-list").getByText("Notification fixture 01"),
  ).toBeVisible()
  await notifications(page).click({trial: true})
}

// Native touch input verifies list scrolling and that header pulls no longer move the modal.
const swipe = async (
  page: Page,
  target: Locator,
  dy: number,
  {
    position,
    steps = 8,
    durationMs,
    whileHeld,
  }: {
    position?: {x: number; y: number}
    steps?: number
    durationMs?: number
    whileHeld?: () => Promise<void>
  } = {},
) => {
  await target.click({trial: true, position})
  const box = await target.boundingBox()
  if (!box) throw new Error("Swipe target is not visible")
  const x = box.x + (position?.x ?? box.width / 2)
  const y = box.y + (position?.y ?? box.height / 2)
  const endTime = Date.now() / 1000
  const timestamp = (progress: number) =>
    durationMs === undefined ? undefined : endTime - (durationMs / 1000) * (1 - progress)
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{x, y}],
      timestamp: timestamp(0),
    })
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{x, y: y + (dy * step) / steps}],
        timestamp: timestamp(step / steps),
      })
    }
    await whileHeld?.()
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp: timestamp(1),
    })
  } finally {
    await cdp.detach()
  }
}

test.beforeEach(async ({page}) => {
  await seedDevSession(page)
  await new MockRelay({seedEvents: [authorProfile, ...mentions]}).setup(page)
  await page.goto("/home")
  await openNotifications(page)
})

test.describe("mobile notification modal", () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})

  test("settings can be tapped", async ({page}) => {
    await notifications(page).getByRole("button", {name: "Notification settings"}).tap()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
  })

  test("separates close and settings, with a fixed header and scrollable content", async ({
    page,
  }, testInfo) => {
    const modal = notifications(page)
    const close = await modal.getByRole("button", {name: "Close notifications"}).boundingBox()
    const settings = await modal.getByRole("button", {name: "Notification settings"}).boundingBox()
    expect(close!.width).toBeGreaterThanOrEqual(44)
    expect(settings!.width).toBeGreaterThanOrEqual(44)
    expect(settings!.x - (close!.x + close!.width)).toBeGreaterThan(200)

    const header = modal.locator("header")
    const headerTop = (await header.boundingBox())!.y
    const list = page.getByTestId("notification-list")
    await swipe(page, list, -180)
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    expect((await header.boundingBox())!.y).toBeCloseTo(headerTop, 0)
    await expect(modal).toHaveCSS("translate", "none")
    await swipe(page, list, 100)
    await expect(modal).toBeVisible()
    await expect(modal).toHaveCSS("translate", "none")
    await page.screenshot({path: testInfo.outputPath("notification-modal-mobile.png")})
  })

  for (const gesture of ["pull", "quick flick"] as const) {
    test(`a header ${gesture} leaves the modal still; the X button closes it`, async ({page}) => {
      const modal = notifications(page)
      const title = modal.getByRole("heading", {name: "Notifications", exact: true})
      const top = (await modal.boundingBox())!.y
      const timeOrigin = await page.evaluate(() => performance.timeOrigin)
      await expect(page.getByTestId("modal-drag-handle")).toHaveCount(0)
      await expect(modal.locator("[data-swipe-dismiss-handle]")).toHaveCount(0)
      await expect(modal).toHaveCSS("will-change", "auto")
      await expect(title).toHaveCSS("touch-action", "auto")
      await swipe(page, title, gesture === "pull" ? 160 : 64, {
        steps: gesture === "pull" ? 8 : 2,
        durationMs: gesture === "pull" ? 500 : 80,
        whileHeld: async () => {
          await expect(modal).toHaveCSS("translate", "none")
          expect((await modal.boundingBox())!.y).toBeCloseTo(top, 0)
        },
      })
      await expect(modal).toBeVisible()
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      await modal.getByRole("button", {name: "Close notifications"}).tap()
      await expect(page.getByTestId("modal-root")).toBeEmpty()
      expect(new URL(page.url()).hash).toBe("")
      await expect(page.getByRole("button", {name: "Notifications", exact: true})).toBeFocused()
      await openNotifications(page)
      await expect(notifications(page)).toHaveCSS("translate", "none")
    })
  }

  test("contains overscroll even when the list is empty", async ({page}) => {
    const modal = notifications(page)
    await modal.getByPlaceholder("Search notifications").fill("no matching fixture")
    await expect(modal.getByText("No notifications found")).toBeVisible()
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await swipe(page, page.getByTestId("notification-list"), 140)
    await expect(modal).toHaveCSS("translate", "none")
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none")
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  })

  test("a pull on the backdrop cannot refresh and leaves tap-to-close usable", async ({page}) => {
    const backdrop = page.getByRole("button", {name: "Close dialog", exact: true})
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    const position = {x: 195, y: 10}
    await swipe(page, backdrop, 50, {position})
    await expect(notifications(page)).toBeVisible()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    await backdrop.tap({position})
    await expect(page.getByTestId("modal-root")).toBeEmpty()
  })

  test("retains notification state when a stacked profile is closed", async ({page}) => {
    const modal = notifications(page)
    const search = modal.getByPlaceholder("Search notifications")
    await search.fill("kestrel")
    const profile = modal.getByRole("button", {name: "View profile", exact: true})
    await expect(profile).toHaveCount(1)
    await profile.click()
    await expect(modal).toBeHidden()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none")
    await page.keyboard.press("Escape")
    await expect(modal).toBeVisible()
    await expect(search).toHaveValue("kestrel")
    await expect(profile).toBeFocused()
    await modal.getByRole("button", {name: "Close notifications"}).tap()
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "auto")
  })

  test("fits short viewports and respects reduced motion", async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"})
    await page.setViewportSize({width: 360, height: 480})
    const modal = notifications(page)
    const box = await modal.boundingBox()
    expect(box!.y).toBeGreaterThan(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(480.5)
    await expect(modal).toHaveCSS("transition-duration", "0s")
    await expect(page.getByTestId("notification-list")).toBeVisible()
    await modal.getByRole("button", {name: "Close notifications"}).tap()
    await expect(page.getByTestId("modal-root")).toBeEmpty()
  })
})

test.describe("desktop notification modal", () => {
  test("ignores mouse drags and supports close, Escape, backdrop, and browser back", async ({
    page,
  }) => {
    const modal = notifications(page)
    const title = modal.getByRole("heading", {name: "Notifications", exact: true})
    await title.hover()
    const box = (await title.boundingBox())!
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 180, {steps: 8})
    await page.mouse.up()
    await expect(modal).toHaveCSS("translate", "none")

    await modal.getByRole("button", {name: "Close notifications"}).click()
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    await openNotifications(page)
    await modal.getByPlaceholder("Search notifications").focus()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("modal-root")).toBeEmpty()

    await openNotifications(page)
    await page
      .getByRole("button", {name: "Close dialog", exact: true})
      .click({position: {x: 5, y: 5}})
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    await openNotifications(page)
    await page.goBack()
    await expect(page.getByTestId("modal-root")).toBeEmpty()
  })

  test("keeps keyboard focus inside the modal", async ({page}, testInfo) => {
    const modal = notifications(page)
    const close = modal.getByRole("button", {name: "Close notifications"})
    await expect(close).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(close).not.toBeFocused()
    expect(await modal.evaluate(node => node.contains(document.activeElement))).toBe(true)
    await page.keyboard.press("Tab")
    await expect(close).toBeFocused()
    await page.screenshot({path: testInfo.outputPath("notification-modal-desktop.png")})
  })
})
