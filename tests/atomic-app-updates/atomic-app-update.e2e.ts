import {expect, test, type Page} from "@playwright/test"

const getBuildId = (page: Page) =>
  page.evaluate(() => (window as any).budabitBuildId as string).catch(() => "")

const getCacheNames = (page: Page) => page.evaluate(() => caches.keys()).catch(() => [])

const getBuildAndWorkerState = async (page: Page) => ({
  build: await getBuildId(page),
  worker: await page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return {
        active: registration?.active?.state || "",
        installing: registration?.installing?.state || "",
        waiting: registration?.waiting?.state || "",
        controller: navigator.serviceWorker.controller?.state || "",
      }
    })
    .catch(() => null),
})

const updateRegistration = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    await registration.update()
  })

test("moves every tab between complete app builds", async ({browser, request}) => {
  await request.post("/__atomic/reset")
  const context = await browser.newContext()
  const first = await context.newPage()
  const pageErrors: string[] = []
  first.on("pageerror", error => pageErrors.push(error.message))

  await first.goto("/settings/about")
  await expect.poll(() => getBuildId(first)).toBe("atomic-a")
  await expect.poll(() => getCacheNames(first)).toContain("budabit-app-atomic-a")
  await expect
    .poll(() => first.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)

  await request.post("/__atomic/stage-b")
  await updateRegistration(first)
  await expect
    .poll(async () => {
      const state = await (await request.get("/__atomic/state")).json()
      return state.workerMarkerReads["atomic-b:atomic-a"] || 0
    })
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      first.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return registration?.installing ? registration.installing.state : "settled"
      }),
    )
    .toBe("settled")
  await expect.poll(() => getCacheNames(first)).not.toContain("budabit-app-atomic-b")
  await expect(first.getByRole("alert")).toHaveCount(0)

  await request.post("/__atomic/fail-b-asset")
  await request.post("/__atomic/publish-b")
  await first.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect
    .poll(async () => {
      const state = await (await request.get("/__atomic/state")).json()
      return state.failedAssetRequests
    })
    .toBeGreaterThan(0)
  await expect(first.getByText("App update ready", {exact: true})).toHaveCount(0)
  await expect.poll(() => getBuildId(first)).toBe("atomic-a")
  await expect.poll(() => getCacheNames(first)).not.toContain("budabit-app-atomic-b")

  await request.post("/__atomic/allow-b-asset")
  await first.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(first.getByText("App update ready", {exact: true})).toBeVisible()

  const second = await context.newPage()
  second.on("pageerror", error => pageErrors.push(error.message))
  await second.goto("/settings/about")
  await expect.poll(() => getBuildId(second)).toBe("atomic-a")
  await first.evaluate(async () => {
    const abandoned = await caches.open("budabit-app-atomic-c")
    await abandoned.put("/__partial__", new Response("partial"))
  })

  await first.getByRole("button", {name: "Reload"}).click()
  await expect
    .poll(() => getBuildAndWorkerState(first))
    .toEqual({
      build: "atomic-b",
      worker: {active: "activated", installing: "", waiting: "", controller: "activated"},
    })
  await expect.poll(() => getBuildId(second)).toBe("atomic-b")
  await expect
    .poll(() => getCacheNames(first))
    .toEqual(expect.arrayContaining(["budabit-app-atomic-a", "budabit-app-atomic-b"]))
  await expect.poll(() => getCacheNames(first)).not.toContain("budabit-app-atomic-c")

  await context.setOffline(true)
  await first.reload()
  await expect.poll(() => getBuildId(first)).toBe("atomic-b")
  await context.setOffline(false)

  expect(pageErrors).toEqual([])
  await context.close()
})

test("rechecks an open tab after observing the deployment sentinel", async ({browser, request}) => {
  await request.post("/__atomic/reset")
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/settings/about")
  await expect.poll(() => getBuildId(page)).toBe("atomic-a")
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)

  await request.post("/__atomic/start-b-deploy")
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect
    .poll(async () => {
      const state = await (await request.get("/__atomic/state")).json()
      return state.clientMarkerReads.deploying || 0
    })
    .toBeGreaterThan(0)

  await request.post("/__atomic/publish-b")
  await expect(page.getByText("App update ready", {exact: true})).toBeVisible()
  await expect.poll(() => getBuildId(page)).toBe("atomic-a")
  await context.close()
})

test("repairs registration after the worker is briefly missing", async ({browser, request}) => {
  await request.post("/__atomic/reset")
  await request.post("/__atomic/start-b-deploy")
  await request.post("/__atomic/hide-worker")
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/settings/about")
  await expect.poll(() => getBuildId(page)).toBe("atomic-b")
  await expect
    .poll(async () => {
      const state = await (await request.get("/__atomic/state")).json()
      return state.clientMarkerReads.deploying || 0
    })
    .toBeGreaterThan(0)

  await request.post("/__atomic/publish-b")
  await expect.poll(() => getCacheNames(page)).toContain("budabit-app-atomic-b")
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await expect(page.getByRole("alert")).toHaveCount(0)
  await context.close()
})

test("keeps monitoring activation instead of reporting a timeout failure", async ({
  browser,
  request,
}) => {
  await request.post("/__atomic/reset")
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/settings/about")
  await expect.poll(() => getBuildId(page)).toBe("atomic-a")
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)

  await request.post("/__atomic/delay-activation")
  await request.post("/__atomic/stage-b")
  await request.post("/__atomic/publish-b")
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(page.getByText("App update ready", {exact: true})).toBeVisible()

  await page.getByRole("button", {name: "Reload"}).click()
  await expect(page.getByText("App update is still activating", {exact: true})).toBeVisible({
    timeout: 38_000,
  })
  await expect(page.getByText(/could not|did not activate/i)).toHaveCount(0)
  await expect.poll(() => getBuildId(page), {timeout: 30_000}).toBe("atomic-b")
  await context.close()
})

test("keeps recovery controls legible in the dark theme", async ({browser, request}) => {
  await request.post("/__atomic/reset")
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto("/settings/about")
  await expect.poll(() => getBuildId(page)).toBe("atomic-a")
  await page.evaluate(() => sessionStorage.setItem("appExpectedBuildId", "missing-build"))
  await page.reload()
  await expect(page.getByText("App update did not finish.", {exact: false})).toBeVisible()
  await page.evaluate(() => document.body.setAttribute("data-theme", "dark"))

  const contrast = await page.locator("section[role=alert]").evaluate(element => {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext("2d", {willReadFrequently: true})
    if (!context) return 0

    const parse = (value: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }
    const luminance = (value: string) => {
      const channels = parse(value).map(channel => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4)
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const style = getComputedStyle(element)
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })

  expect(contrast).toBeGreaterThanOrEqual(4.5)
  await expect(page.getByRole("button", {name: "Retry"})).toBeVisible()
  await expect(page.getByRole("button", {name: "Reset cache"})).toBeVisible()
  await context.close()
})
