import {expect, test} from "@playwright/test"

import {MockRelay} from "./helpers/mock-relay"

test("commit metadata wraps without clipping at intermediate widths", async ({page}) => {
  const pageErrors: Error[] = []
  page.on("pageerror", error => pageErrors.push(error))
  await new MockRelay().setup(page)
  await page.goto("/git")
  await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()

  // Mount the built component with the app's real styles, without depending on live Git data.
  await page.evaluate(async () => {
    const runtimeUrl = performance
      .getEntriesByType("resource")
      .map(entry => entry.name)
      .find(url => new URL(url).pathname.endsWith("/svelte.js"))
    if (!runtimeUrl) throw new Error("Loaded Svelte runtime was not found")

    const componentUrl = "/packages/nostr-git-ui/dist/components/git/CommitHeader.svelte"
    const [{mount}, {default: CommitHeader}] = await Promise.all([
      import(runtimeUrl),
      import(componentUrl),
    ])
    const target = document.createElement("div")
    target.dataset.testid = "commit-header-fixture"
    target.style.cssText = "position: fixed; inset: 0; z-index: 100; padding: 8px; overflow: auto"
    document.body.append(target)
    mount(CommitHeader, {
      target,
      props: {
        sha: "e7117e4480321fd4958350ae43cfcc3db6b15e96",
        author: "five",
        email: "co22rkn@protonmail.com",
        date: Date.now(),
        message: "perf: compact large diff rendering",
        parents: ["c122664".padEnd(40, "0")],
        avatarUrl:
          "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        getParentHref: (sha: string) => `#${sha}`,
      },
    })
  })

  const header = page.getByTestId("commit-header-fixture")
  const author = header.locator('span[title="five"]')
  const email = header.locator('span[title="co22rkn@protonmail.com"]')
  const date = header.getByText("committed today", {exact: true})
  const parent = header.getByRole("link", {name: "c122664", exact: true})
  const copy = header.getByRole("button", {name: "Copy", exact: true})
  await expect(copy).toBeVisible()

  for (const width of [320, 443, 639, 640, 691, 767, 768, 820, 1024, 1440]) {
    await test.step(`${width}px viewport`, async () => {
      await page.setViewportSize({width, height: 768})
      await expect
        .poll(() =>
          header.evaluate(element => {
            const card = element.firstElementChild as HTMLElement
            return card.scrollWidth <= card.clientWidth + 1
          }),
        )
        .toBe(true)

      for (const item of [date, parent, copy, ...(width >= 443 ? [author, email] : [])]) {
        const bounds = await item.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(8)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 8)
        expect(await item.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(
          true,
        )
      }

      const dateIsOneLine = await date.evaluate(
        element =>
          element.getBoundingClientRect().height <=
          Number.parseFloat(getComputedStyle(element).lineHeight) + 1,
      )
      expect(dateIsOneLine).toBe(true)

      const authorBounds = (await author.boundingBox())!
      const copyBounds = (await copy.boundingBox())!
      if (width === 691) expect(copyBounds.y).toBeGreaterThan(authorBounds.y + authorBounds.height)
      if (width === 1440) {
        expect(
          Math.abs(copyBounds.y + copyBounds.height / 2 - authorBounds.y - authorBounds.height / 2),
        ).toBeLessThan(1)
      }
    })
  }

  expect(pageErrors).toEqual([])
})
