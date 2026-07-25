import {expect, test, type Page} from "@playwright/test"

const getBuildId = (page: Page) =>
  page.evaluate(() => (window as any).budabitBuildId as string).catch(() => "")

const getCacheNames = (page: Page) => page.evaluate(() => caches.keys()).catch(() => [])

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
  await expect(first.getByText("A complete app update is ready.")).toHaveCount(0)
  await expect.poll(() => getBuildId(first)).toBe("atomic-a")
  await expect.poll(() => getCacheNames(first)).not.toContain("budabit-app-atomic-b")

  await request.post("/__atomic/allow-b-asset")
  await first.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(first.getByText("A complete app update is ready.")).toBeVisible()

  const second = await context.newPage()
  second.on("pageerror", error => pageErrors.push(error.message))
  await second.goto("/settings/about")
  await expect.poll(() => getBuildId(second)).toBe("atomic-a")
  await first.evaluate(async () => {
    const abandoned = await caches.open("budabit-app-atomic-c")
    await abandoned.put("/__partial__", new Response("partial"))
  })

  await first.getByRole("button", {name: "Reload"}).click()
  await expect.poll(() => getBuildId(first)).toBe("atomic-b")
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

test("supports the legacy unversioned activation during rollout", async ({browser, request}) => {
  await request.post("/__atomic/reset")
  const context = await browser.newContext()
  const legacy = await context.newPage()
  const current = await context.newPage()

  await legacy.goto("/__atomic/legacy-window")
  await expect.poll(() => getCacheNames(legacy)).toContain("budabit-app-atomic-a")
  await expect
    .poll(() => legacy.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await current.goto("/settings/about")
  await expect.poll(() => getBuildId(current)).toBe("atomic-a")

  await request.post("/__atomic/stage-b")
  await request.post("/__atomic/publish-b")
  await current.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(current.getByText("A complete app update is ready.")).toBeVisible()

  const postedToWaitingWorker = await current.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration?.waiting) return false
    registration.waiting.postMessage({type: "SKIP_WAITING"})
    return true
  })
  expect(postedToWaitingWorker).toBe(true)

  await expect.poll(() => getBuildId(current)).toBe("atomic-b")
  await expect.poll(() => getBuildId(legacy)).toBe("atomic-b")
  await context.close()
})
