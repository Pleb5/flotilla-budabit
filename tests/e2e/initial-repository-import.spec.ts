import {test, expect} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

for (const reload of [false, true])
  test(`initial import review, partial result and exact recovery${reload ? " after reload" : ""}`, async ({
    page,
  }) => {
    const relay = new MockRelay()
    await relay.setup(page)
    await page.goto("/git")
    await page.evaluate(async () => {
      const fixture = await import(
        /* @vite-ignore */ "/tests/e2e/fixtures/initial-import-browser.ts"
      )
      ;(window as any).__initialImportFixture = await fixture.mountInitialImportFixture()
    })
    const dialog = page.getByRole("region", {name: "Import a new repository"})
    await dialog.getByLabel("Public GitHub repository").fill("https://github.com/fixture/project")
    const name = `fixture-${Date.now()}`
    await dialog.getByLabel("New repository name").fill(name)
    await dialog.getByLabel("GRASP service (one destination)").fill("wss://grasp.test")
    await dialog.getByLabel("Issues and current status", {exact: true}).check()
    await dialog.getByLabel("Issue conversation comments", {exact: true}).check()
    await dialog.getByRole("button", {name: "Review import", exact: true}).click()
    await expect(dialog.getByRole("heading", {name: "Review before publishing"})).toBeVisible()
    const create = dialog.getByRole("button", {name: "Create public repository", exact: true})
    await expect(create).toBeDisabled()
    await dialog.getByRole("checkbox").check()
    await create.click()
    await expect(
      dialog.getByRole("heading", {name: "Repository created", exact: true}),
    ).toBeVisible()
    await expect(dialog.getByText("One exact signed event is saved", {exact: false})).toBeVisible()
    if (reload) {
      const relayState = await page.evaluate(() =>
        (window as any).__initialImportFixture.relayState(),
      )
      await page.reload()
      await page.evaluate(async restored => {
        const fixture = await import(
          /* @vite-ignore */ "/tests/e2e/fixtures/initial-import-browser.ts"
        )
        ;(window as any).__initialImportFixture = await fixture.mountInitialImportFixture(
          false,
          restored,
        )
      }, relayState)
      await dialog.getByRole("button", {name: new RegExp(name)}).click()
      await expect(
        dialog.getByText("One exact signed event is saved", {exact: false}),
      ).toBeVisible()
    }
    await dialog.getByRole("button", {name: "Resume saved import"}).click()
    await expect(
      dialog.getByText("Selected initial history complete.", {exact: true}),
    ).toBeVisible()
    await expect(
      dialog.getByText("Confirmed: 1 issues · 1 status events · 1 comments", {exact: true}),
    ).toBeVisible()
    const evidence = await page.evaluate(() => (window as any).__initialImportFixture.evidence())
    expect(evidence.pushes).toBe(1)
    expect(evidence.events.filter((e: any) => e.kind === 1621)).toEqual([
      {id: evidence.attemptedIssueId, kind: 1621},
    ])
    await page.setViewportSize({width: 390, height: 844})
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await dialog.getByRole("button", {name: "Close", exact: true}).click()
    await expect(dialog).not.toBeVisible()
  })

test("initial history releases page bodies and retries without retained-heap growth", async ({
  page,
}) => {
  test.setTimeout(120_000)
  // Isolate retention from unrelated application hydration and relay caches.
  await page.goto("/tests/e2e/fixtures/initial-import.html")
  await page.evaluate(async () => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/initial-import-retention.ts"
    )
    ;(window as any).__importRetention = await fixture.createImportRetentionFixture()
  })
  await page.evaluate(() => (window as any).__importRetention.run(20))
  const cdp = await page.context().newCDPSession(page) // This test's own isolated Chromium page
  await cdp.send("HeapProfiler.collectGarbage")
  const before = await cdp.send("Runtime.getHeapUsage")
  const streamed = await page.evaluate(() => (window as any).__importRetention.run(250))
  expect(streamed.events, streamed.message).toBe(500)
  expect(streamed.bytes).toBeGreaterThan(5 * 1024 * 1024)
  const firstFailure = await page.evaluate(() => (window as any).__importRetention.run(251, true))
  for (let retry = 0; retry < 25; retry++) {
    const result = await page.evaluate(() => (window as any).__importRetention.run(251, true))
    expect(result.pendingId).toBe(firstFailure.pendingId)
    expect(result.events).toBe(500)
    expect(result.journalBytes).toBeLessThan(40 * 1024)
  }
  await cdp.send("HeapProfiler.collectGarbage")
  const after = await cdp.send("Runtime.getHeapUsage")
  const delta = after.usedSize - before.usedSize
  console.info(
    `Real IndexedDB retained heap: 250 issue pages / 500 events / 25 retries; delta ${delta} bytes`,
  )
  expect(delta).toBeLessThan(3 * 1024 * 1024)
  await cdp.detach()
})
