import {test, expect} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

test("initial import review, partial result and exact same-job recovery", async ({page}) => {
  const relay = new MockRelay()
  await relay.setup(page)
  await page.goto("/git")
  await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ "/tests/e2e/fixtures/initial-import-browser.ts")
    ;(window as any).__initialImportFixture = await fixture.mountInitialImportFixture()
  })
  const dialog = page.getByRole("region", {name: "Import a new repository"})
  await dialog.getByLabel("Public GitHub repository").fill("https://github.com/fixture/project")
  await dialog.getByLabel("New repository name").fill(`fixture-${Date.now()}`)
  await dialog.getByLabel("GRASP service (one destination)").fill("wss://grasp.test")
  await dialog.getByLabel("Issues and current status", {exact: true}).check()
  await dialog.getByLabel("Issue conversation comments", {exact: true}).check()
  await dialog.getByRole("button", {name: "Review import", exact: true}).click()
  await expect(dialog.getByRole("heading", {name: "Review before publishing"})).toBeVisible()
  const create = dialog.getByRole("button", {name: "Create public repository", exact: true})
  await expect(create).toBeDisabled()
  await dialog.getByRole("checkbox").check()
  await create.click()
  await expect(dialog.getByRole("heading", {name: "Repository created", exact: true})).toBeVisible()
  await expect(dialog.getByText("One exact signed event is saved", {exact: false})).toBeVisible()
  await dialog.getByRole("button", {name: "Resume saved import"}).click()
  await expect(dialog.getByText("Selected initial history complete.", {exact: true})).toBeVisible()
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
