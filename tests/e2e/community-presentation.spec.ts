import {expect, test} from "@playwright/test"

test.beforeEach(async ({context}) => {
  await context.route("**/*", route => {
    const host = new URL(route.request().url()).hostname
    return ["localhost", "127.0.0.1"].includes(host) ? route.continue() : route.abort()
  })
})

test("nested stream starts muted and keeps the same playing video through fullscreen", async ({
  page,
}) => {
  await page.goto("/tests/player-host.html")
  const widget = page.frameLocator('iframe[title="Stream widget"]')
  const video = widget.locator("video")
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await video.evaluate(el => el.setAttribute("data-retained", "yes"))
  await widget.getByRole("button", {name: "Unmute stream", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(false)
  await widget.getByRole("button", {name: "Mute stream", exact: true}).click()
  await widget.getByRole("button", {name: "Full screen stream", exact: true}).click()
  await expect(widget.getByRole("button", {name: "Exit full screen", exact: true})).toBeVisible()
  await expect(video).toHaveAttribute("data-retained", "yes")
  const time = await video.evaluate(el => (el as HTMLVideoElement).currentTime)
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime))
    .toBeGreaterThan(time)
  await widget.getByRole("button", {name: "Exit full screen", exact: true}).click()
  await expect(video).toHaveAttribute("data-retained", "yes")
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
})

test("shared-screen tile can focus, restore, and go fullscreen without opening a menu", async ({
  page,
}) => {
  await page.goto("/tests/screen-share.html")
  const video = page.locator("video")
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await video.evaluate(el => el.setAttribute("data-retained", "yes"))
  await page.getByRole("button", {name: "Focus screen", exact: true}).click()
  await expect(page.locator(".Camera")).toHaveClass(/screen-share-focused/)
  await page.getByRole("button", {name: "Back to call", exact: true}).click()
  await expect(page.locator(".Camera")).not.toHaveClass(/screen-share-focused/)
  await page
    .getByRole("button", {name: "Full screen shared screen from Presenter", exact: true})
    .click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toContain("Camera")
  await expect(video).toHaveAttribute("data-retained", "yes")
  await page.getByRole("button", {name: "Back to call", exact: true}).click()
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  await expect(page.locator(".Camera")).not.toHaveClass(/screen-share-focused/)
  await expect(video).toHaveAttribute("data-retained", "yes")
})

test("denied stream fullscreen shows a recovery hint and retains the muted player", async ({
  page,
}) => {
  await page.goto("/tests/player.html")
  const video = page.locator("video")
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await page.locator(".player-shell").evaluate(el => {
    el.requestFullscreen = async () => {
      throw new Error("Denied by fixture")
    }
  })
  await video.evaluate(el => el.setAttribute("data-retained", "yes"))
  await page.getByRole("button", {name: "Full screen stream", exact: true}).click()
  await expect(page.getByRole("alert")).toContainText("Use Enlarge")
  await expect(video).toHaveAttribute("data-retained", "yes")
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
})

test("ordinary viewers, including moderators without local activity, start with sound", async ({
  page,
}) => {
  await page.goto("/tests/player-host.html?mode=viewer")
  const widget = page.frameLocator('iframe[title="Stream widget"]')
  const video = widget.locator("video")
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(false)
  await expect(widget.getByRole("button", {name: "Mute stream", exact: true})).toBeVisible()
})

test("joining mutes a viewer, leaving retains mute, and local broadcast preparation protects again", async ({
  page,
}) => {
  await page.goto("/tests/player.html?mode=viewer")
  const video = page.locator("video")
  await expect
    .poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
  if (await video.evaluate(el => (el as HTMLVideoElement).muted)) {
    await page.getByRole("button", {name: "Unmute stream", exact: true}).click()
  }
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(false)
  await page.getByRole("button", {name: "Join call", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await expect(page.getByRole("status")).toContainText("call is open")
  await page.getByRole("button", {name: "Leave call", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await page.getByRole("button", {name: "Unmute stream", exact: true}).click()
  await page.getByRole("button", {name: "Prepare broadcast", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await expect(page.getByRole("status")).toContainText("broadcasting was prepared")
  await page.getByRole("button", {name: "Clear broadcast protection", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
})

test("callers can explicitly unmute without refreshes undoing their choice", async ({page}) => {
  await page.goto("/tests/player.html?mode=caller")
  const video = page.locator("video")
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await page.getByRole("button", {name: "Unmute stream", exact: true}).click()
  await page.getByRole("button", {name: "Refresh participation", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(false)
})

test("unknown participation stays muted until an ordinary-viewer snapshot arrives", async ({
  page,
}) => {
  await page.goto("/tests/player.html?mode=unknown")
  const video = page.locator("video")
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await page.getByRole("button", {name: "Confirm participation", exact: true}).click()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(false)
})

test("blocked audible autoplay falls back to muted playback with a clear prompt", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      return !this.muted
        ? Promise.reject(new DOMException("Autoplay blocked by test", "NotAllowedError"))
        : original.call(this)
    }
  })
  await page.goto("/tests/player.html?mode=viewer")
  const video = page.locator("video")
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).muted)).toBe(true)
  await expect(page.getByRole("status").filter({hasText: "browser blocked"})).toBeVisible()
  await expect(page.getByRole("button", {name: "Unmute stream", exact: true})).toBeVisible()
})
