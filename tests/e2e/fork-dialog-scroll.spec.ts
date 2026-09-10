import {expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`fork dialog opens at the top without losing keyboard focus (${viewport.width}px)`, async ({
    page,
  }) => {
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    await page.setViewportSize(viewport)
    await new MockRelay().setup(page)
    await page.goto("/git")
    await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()

    for (let opening = 0; opening < 2; opening++) {
      // Use the app's real modal host, including its opening transition. Mounting
      // ForkRepoDialog alone misses the transient layout that caused the jump.
      await page.evaluate(async () => {
        const fixture = await import(
          /* @vite-ignore */ "/tests/e2e/fixtures/fork-dialog-browser.ts"
        )
        fixture.openForkDialogFixture()
      })

      const dialog = page.getByRole("dialog", {name: "Fork Repository", exact: true})
      const name = dialog.getByRole("textbox", {name: "Repository identifier *", exact: true})
      const scrollBody = dialog.locator("#fork-form").locator("..")
      await expect(name).toHaveValue("scroll-regression")
      // Wait for actual modal layout, not a fixed sleep or unrelated relay traffic.
      await dialog.evaluate(async element => {
        const host = element.closest('[data-testid="modal-root"]')!
        await Promise.all(host.getAnimations({subtree: true}).map(animation => animation.finished))
      })
      await expect(name).toBeFocused()
      await expect(name).toBeInViewport()
      await expect.poll(() => scrollBody.evaluate(element => element.scrollTop)).toBe(0)
      expect(
        await scrollBody.evaluate(element => element.scrollHeight > element.clientHeight),
      ).toBe(true)

      // Normal keyboard navigation and intentional scrolling must still work.
      await page.keyboard.press("Tab")
      await expect(
        dialog.getByRole("button", {name: "Select all ready", exact: true}),
      ).toBeFocused()
      await scrollBody.hover()
      await page.mouse.wheel(0, 1000)
      await expect.poll(() => scrollBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

      await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(/\/git$/)
    }

    expect(pageErrors).toEqual([])
  })
}
