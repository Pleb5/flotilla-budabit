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

// Real Chromium touch input exercises touch-action, pointer capture, and native list scrolling.
const swipe = async (
  page: Page,
  target: Locator,
  dy: number,
  cancel = false,
  whileHeld?: () => Promise<void>,
  {
    position,
    steps = 8,
    durationMs,
    dx = 0,
    afterMove,
  }: {
    position?: {x: number; y: number}
    steps?: number
    durationMs?: number
    dx?: number
    afterMove?: (distance: number) => Promise<void>
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
        touchPoints: [{x: x + (dx * step) / steps, y: y + (dy * step) / steps}],
        timestamp: timestamp(step / steps),
      })
      await afterMove?.((dy * step) / steps)
    }
    await whileHeld?.()
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
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

test.describe("mobile notification sheet", () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})

  test("settings can be tapped without dragging", async ({page}) => {
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
    await expect(modal).toHaveCSS("translate", "0px")
    await swipe(page, list, 100)
    await expect(modal).toBeVisible()
    await expect(modal).toHaveCSS("translate", "0px")
    await page.screenshot({path: testInfo.outputPath("notification-sheet-mobile.png")})
  })

  for (const area of ["handle", "header"] as const) {
    test(`pulling the ${area} down dismisses and clears modal history`, async ({page}) => {
      const modal = notifications(page)
      const target =
        area === "handle"
          ? page.getByTestId("modal-drag-handle")
          : modal.getByRole("heading", {name: "Notifications", exact: true})
      await swipe(page, target, 160, false, async () => {
        await expect(modal).toHaveCSS("translate", "0px 160px")
      })
      await expect(page.getByTestId("modal-root")).toBeEmpty()
      expect(new URL(page.url()).hash).toBe("")
      await expect(page.getByRole("button", {name: "Notifications", exact: true})).toBeFocused()
      await openNotifications(page)
      await expect(notifications(page)).toHaveCSS("translate", "0px")
    })
  }

  for (const area of ["top edge", "grip gutter", "header gap", "header gutter"] as const) {
    test(`starts a drag from the ${area}, not just the grip or title`, async ({page}) => {
      const modal = notifications(page)
      const panel = (await modal.boundingBox())!
      const grip = (await page.getByTestId("modal-drag-handle").boundingBox())!
      const header = (await modal.locator("header").boundingBox())!
      const close = (await modal.getByRole("button", {name: "Close notifications"}).boundingBox())!
      const title = (await modal.getByRole("heading", {name: "Notifications"}).boundingBox())!
      const position = {
        x:
          area === "top edge"
            ? panel.width / 2
            : area === "header gap"
              ? (close.x + close.width + title.x) / 2 - panel.x
              : 4,
        y:
          area === "top edge"
            ? 3
            : area === "grip gutter"
              ? grip.y + grip.height / 2 - panel.y
              : header.y + header.height / 2 - panel.y,
      }
      await swipe(page, modal, 160, false, undefined, {position})
      await expect(page.getByTestId("modal-root")).toBeEmpty()
    })
  }

  test("tracks each input frame without a trailing CSS transition", async ({page}) => {
    const modal = notifications(page)
    const grip = page.getByTestId("modal-drag-handle")
    await grip.click({trial: true})
    const top = (await modal.boundingBox())!.y
    expect((await grip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(modal).toHaveCSS("will-change", "translate")
    const frames = await modal.evaluateHandle(node => {
      const frames: {distance: number; top: number; duration: string}[] = []
      let startY = 0
      node.addEventListener("pointerdown", event => (startY = (event as PointerEvent).clientY))
      node.addEventListener("pointermove", event => {
        const distance = (event as PointerEvent).clientY - startY
        requestAnimationFrame(() => {
          frames.push({
            distance,
            top: node.getBoundingClientRect().top,
            duration: getComputedStyle(node).transitionDuration,
          })
        })
      })
      return frames
    })
    await swipe(page, grip, 160, false, undefined, {
      afterMove: async distance => {
        // CDP acknowledgement is not event delivery. Check a snapshot taken on the
        // first animation frame after the actual pointermove, not after the tool call.
        await expect.poll(async () => (await frames.jsonValue()).at(-1)?.distance).toBe(distance)
        const frame = (await frames.jsonValue()).at(-1)!
        expect(frame.duration).toBe("0s")
        expect(frame.top - top).toBeCloseTo(frame.distance, 0)
      },
    })
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    await frames.dispose()
  })

  test("a quick flick dismisses without losing the pointer or reloading the page", async ({
    page,
  }) => {
    const modal = notifications(page)
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    const cancellations = await modal.evaluateHandle(node => {
      const events: string[] = []
      node.addEventListener("pointercancel", () => events.push("pointercancel"))
      return events
    })
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none")
    await swipe(page, page.getByTestId("modal-drag-handle"), 64, false, undefined, {
      steps: 2,
      durationMs: 80,
    })
    await expect(page.getByTestId("modal-root")).toBeEmpty()
    expect(await cancellations.jsonValue()).toEqual([])
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "auto")
    await cancellations.dispose()
  })

  test("contains overscroll even when the list is empty", async ({page}) => {
    const modal = notifications(page)
    await modal.getByPlaceholder("Search notifications").fill("no matching fixture")
    await expect(modal.getByText("No notifications found")).toBeVisible()
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    await swipe(page, page.getByTestId("notification-list"), 140)
    await expect(modal).toHaveCSS("translate", "0px")
    await expect(page.locator("html")).toHaveCSS("overscroll-behavior-y", "none")
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  })

  test("a pull on the backdrop cannot refresh and leaves tap-to-close usable", async ({page}) => {
    const backdrop = page.getByRole("button", {name: "Close dialog", exact: true})
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    const position = {x: 195, y: 10}
    await swipe(page, backdrop, 50, false, undefined, {position})
    await expect(notifications(page)).toBeVisible()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    await backdrop.tap({position})
    await expect(page.getByTestId("modal-root")).toBeEmpty()
  })

  for (const direction of ["up", "sideways"] as const) {
    test(`moving ${direction} on the header does not dismiss or break the next pull`, async ({
      page,
    }) => {
      const modal = notifications(page)
      const title = modal.getByRole("heading", {name: "Notifications", exact: true})
      await swipe(page, title, direction === "up" ? -80 : 15, false, undefined, {
        dx: direction === "sideways" ? 100 : 0,
      })
      await expect(modal).toHaveCSS("translate", "0px")
      await swipe(page, title, 160)
      await expect(page.getByTestId("modal-root")).toBeEmpty()
    })
  }

  for (const gesture of ["short", "cancelled", "button"] as const) {
    test(`${gesture} pulls leave the modal open and settings usable`, async ({page}) => {
      const modal = notifications(page)
      const gear = modal.getByRole("button", {name: "Notification settings"})
      const target = gesture === "button" ? gear : page.getByTestId("modal-drag-handle")
      await swipe(page, target, gesture === "short" ? 40 : 160, gesture === "cancelled")
      await expect(modal).toBeVisible()
      await expect(modal).toHaveCSS("translate", "0px")
      await gear.tap()
      await expect(page).toHaveURL(/\/settings\/notifications$/)
      await expect(page.getByTestId("modal-root")).toBeEmpty()
    })
  }

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
    await swipe(page, page.getByTestId("modal-drag-handle"), 140)
    await expect(page.getByTestId("modal-root")).toBeEmpty()
  })
})

test.describe("desktop notification modal", () => {
  test("ignores mouse drags and supports close, Escape, backdrop, and browser back", async ({
    page,
  }) => {
    const modal = notifications(page)
    const handle = page.getByTestId("modal-drag-handle")
    await handle.hover()
    const box = (await handle.boundingBox())!
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 180, {steps: 8})
    await page.mouse.up()
    await expect(modal).toHaveCSS("translate", "0px")

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
