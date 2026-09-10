import {expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"
import {TEST_PUBKEYS} from "./fixtures/events"

for (const mode of ["unchanged", "before", "during"] as const) {
  test(`New Repo preserves the approved owner with account change: ${mode}`, async ({page}) => {
    const mock = new MockRelay()
    await mock.setup(page)
    await page.route("https://**", route =>
      route.fulfill({status: 503, body: "Fixture: external services blocked"}),
    )
    await page.goto("/git")
    await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()
    await page.evaluate(async () => {
      const path = "/tests/e2e/fixtures/new-repo-publication-browser.ts"
      ;(await import(/* @vite-ignore */ path)).installNewRepoPublicationFixture()
    })
    await page.getByRole("button", {name: "New Repo", exact: true}).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    const result = await page.evaluate(async mode => {
      const path = "/tests/e2e/fixtures/new-repo-publication-browser.ts"
      return (await import(/* @vite-ignore */ path)).submitNewRepoPublicationFixture(mode)
    }, mode)
    const delivered = mock.getPublishedEvents().filter(event => [30617, 30618].includes(event.kind))
    if (mode === "unchanged") {
      expect(result.error).toBe("")
      expect(result.signed).toEqual(
        [30617, 30618].map(() => ({pubkey: TEST_PUBKEYS.alice, storedLocally: true})),
      )
      expect(delivered.map(event => event.pubkey)).toEqual([TEST_PUBKEYS.alice, TEST_PUBKEYS.alice])
      expect(delivered.map(event => event.tags.find(tag => tag[0] === "d")?.[1])).toEqual([
        "approved-new-repo",
        "approved-new-repo",
      ])
    } else {
      expect(result.error).toMatch(/account changed/i)
      expect(result.signed).toEqual(
        mode === "before" ? [] : [{pubkey: TEST_PUBKEYS.alice, storedLocally: false}],
      )
      expect(delivered).toEqual([])
    }
  })
}
