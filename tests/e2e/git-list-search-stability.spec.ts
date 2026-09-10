import {expect, test, type Page} from "@playwright/test"
import {nip19} from "nostr-tools"
import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createRepoAnnouncement,
  signTestEvent,
} from "./fixtures/events"
import {DEV_SECRET} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-list-search-stability.test"

const observePaginationLayout = async (page: Page, expectedCount: number) => {
  await page
    .getByRole("button", {name: "Show more repositories", exact: true})
    .evaluate((button, expectedCount) => {
      const footer = button.parentElement!
      const scroller = button.closest<HTMLElement>('[data-component="PageContent"]')!
      const state = {
        footerRemovedBeforeResults: false,
        initialHeight: scroller.scrollHeight,
        minimumHeight: scroller.scrollHeight,
        initialScrollTop: scroller.scrollTop,
        minimumScrollTop: scroller.scrollTop,
      }
      const sample = () => {
        if (scroller.querySelectorAll('[data-testid="repo-card"]').length < expectedCount) {
          state.footerRemovedBeforeResults ||= !footer.isConnected
        }
        state.minimumHeight = Math.min(state.minimumHeight, scroller.scrollHeight)
        state.minimumScrollTop = Math.min(state.minimumScrollTop, scroller.scrollTop)
      }
      const observer = new MutationObserver(sample)
      observer.observe(scroller, {childList: true, subtree: true})
      let frame: number
      const sampleFrame = () => {
        sample()
        frame = requestAnimationFrame(sampleFrame)
      }
      frame = requestAnimationFrame(sampleFrame)
      ;(window as any).__paginationLayout = {
        finish: () => {
          sample()
          observer.disconnect()
          cancelAnimationFrame(frame)
          return state
        },
      }
    }, expectedCount)
}

const expectStablePaginationLayout = async (page: Page) => {
  const layout = await page.evaluate(() => (window as any).__paginationLayout.finish())
  expect(layout.footerRemovedBeforeResults).toBe(false)
  expect(layout.minimumHeight).toBeGreaterThanOrEqual(layout.initialHeight)
  expect(layout.minimumScrollTop).toBeGreaterThanOrEqual(layout.initialScrollTop - 2)
}

test("keeps the repository grid and surviving card mounted while search updates", async ({
  page,
}) => {
  const alphaName = "Mounted search alpha"
  const betaName = "Mounted search beta"
  const announcements = [
    signTestEvent(
      createRepoAnnouncement({
        identifier: "mounted-search-alpha",
        name: alphaName,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + 1,
      }),
    ),
    signTestEvent(
      createRepoAnnouncement({
        identifier: "mounted-search-beta",
        name: betaName,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + 2,
      }),
    ),
  ]
  const mockRelay = new MockRelay({seedEvents: announcements})

  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.clear()
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    },
    {pubkey: TEST_PUBKEYS.devUser, secret: DEV_SECRET},
  )
  await mockRelay.setup(page)
  await page.goto("/git")

  await expect(page.getByText(alphaName, {exact: true})).toBeVisible({timeout: 10_000})
  await expect(page.getByText(betaName, {exact: true})).toBeVisible()
  await page.evaluate(name => {
    const grid = document.querySelector<HTMLElement>('[data-testid="repo-card-grid"]')
    const card = Array.from(
      grid?.querySelectorAll<HTMLElement>('[data-testid="repo-card"]') || [],
    ).find(candidate => candidate.textContent?.includes(name))
    if (!grid || !card) throw new Error("Repository grid fixture was not rendered")

    const state = {grid, card, disconnected: false}
    const observer = new MutationObserver(() => {
      if (!grid.isConnected || !card.isConnected) state.disconnected = true
    })
    observer.observe(document.body, {childList: true, subtree: true})
    ;(window as any).__repoSearchMountState = {state, observer}
  }, alphaName)

  await page.getByPlaceholder("Repo, owner, npub, or naddr").fill("mounted search alpha")
  await expect(page.getByText(betaName, {exact: true})).toHaveCount(0)
  await expect(page.getByText(alphaName, {exact: true})).toBeVisible()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const holder = (window as any).__repoSearchMountState
        const state = holder?.state
        const currentGrid = document.querySelector('[data-testid="repo-card-grid"]')
        return Boolean(
          state &&
          !state.disconnected &&
          state.grid === currentGrid &&
          state.grid.isConnected &&
          state.card.isConnected,
        )
      }),
    )
    .toBe(true)
})

test("expands personal repository scope only through show more", async ({page}) => {
  const announcements = Array.from({length: 40}, (_, index) =>
    signTestEvent(
      createRepoAnnouncement({
        identifier: `rendered-page-${index + 1}`,
        name: `Rendered page repository ${index + 1}`,
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.devUser,
        created_at: BASE_TIMESTAMP + index + 1,
      }),
    ),
  )
  const announcementRequests: Array<{authors?: string[]; limit?: number}> = []
  const mockRelay = new MockRelay({
    seedEvents: announcements,
    onSubscribe: (_subscriptionId, filters) => {
      for (const filter of filters) {
        if (filter.kinds?.includes(30617)) {
          announcementRequests.push({authors: filter.authors, limit: filter.limit})
        }
      }
    },
  })

  await page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.clear()
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    },
    {pubkey: TEST_PUBKEYS.devUser, secret: DEV_SECRET},
  )
  await mockRelay.setup(page)
  await page.goto("/git")

  await expect(page.locator('[data-testid="repo-card"]')).toHaveCount(18, {timeout: 10_000})
  expect(announcementRequests).toContainEqual({
    authors: [TEST_PUBKEYS.devUser],
    limit: 18,
  })
  expect(
    announcementRequests.every(request => request.authors?.includes(TEST_PUBKEYS.devUser)),
  ).toBe(true)

  const showMore = page.getByRole("button", {name: "Show more repositories"})
  await showMore.scrollIntoViewIfNeeded()
  await observePaginationLayout(page, 36)
  await showMore.click()

  await expect(page.locator('[data-testid="repo-card"]')).toHaveCount(36, {timeout: 10_000})
  await expect.poll(() => announcementRequests.some(request => request.limit === 36)).toBe(true)
  await expectStablePaginationLayout(page)
})

for (const {name, viewport, reducedMotion, delayed} of [
  {
    name: "desktop",
    viewport: {width: 1280, height: 800},
    reducedMotion: "no-preference",
    delayed: false,
  },
  {
    name: "mobile",
    viewport: {width: 390, height: 844},
    reducedMotion: "no-preference",
    delayed: false,
  },
  {
    name: "mobile with reduced motion",
    viewport: {width: 390, height: 844},
    reducedMotion: "reduce",
    delayed: false,
  },
  {
    name: "desktop with delayed relays",
    viewport: {width: 1280, height: 800},
    reducedMotion: "no-preference",
    delayed: true,
  },
  {
    name: "mobile with delayed relays",
    viewport: {width: 390, height: 844},
    reducedMotion: "no-preference",
    delayed: true,
  },
] as const) {
  test(`preserves npub search cards and scroll position through show more on ${name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({reducedMotion})
    const announcements = Array.from({length: 40}, (_, index) =>
      signTestEvent(
        createRepoAnnouncement({
          identifier: `account-page-${index + 1}`,
          name: `Account page repository ${index + 1}`,
          relays: [relayUrl],
          pubkey: TEST_PUBKEYS.alice,
          created_at: BASE_TIMESTAMP + 40 - index,
        }),
      ),
    )
    const otherAccountRepo = signTestEvent(
      createRepoAnnouncement({
        identifier: "other-account-repository",
        name: "Other account repository",
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.bob,
      }),
    )
    const pageResponses = new Map(
      [36, 54].map(limit => {
        let release!: (outcome: "eose") => void
        const promise = new Promise<"eose">(resolve => (release = resolve))
        return [limit, {promise, release: () => release("eose")}] as const
      }),
    )
    const requestedLimits = new Set<number>()
    const mockRelay = new MockRelay({
      seedEvents: [...(delayed ? announcements.slice(0, 18) : announcements), otherAccountRepo],
      onSubscribe: (_id, filters) => {
        for (const filter of filters) {
          if (filter.kinds?.includes(30617) && filter.authors?.includes(TEST_PUBKEYS.alice)) {
            requestedLimits.add(filter.limit || 0)
          }
        }
      },
      getSubscriptionOutcome: filters => {
        if (!delayed) return
        const filter = filters.find(
          filter => filter.kinds?.includes(30617) && filter.authors?.includes(TEST_PUBKEYS.alice),
        )
        return pageResponses.get(filter?.limit || 0)?.promise
      },
    })

    await page.addInitScript(() => {
      localStorage.clear()
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    })
    await mockRelay.setup(page)
    await page.goto("/git")

    const search = page.getByPlaceholder("Repo, owner, npub, or naddr")
    await search.fill(nip19.npubEncode(TEST_PUBKEYS.alice))

    const grid = page.getByTestId("repo-card-grid")
    const cards = grid.getByTestId("repo-card")
    const scroller = page.locator('[data-component="PageContent"][data-perf="git-root"]')
    const showMore = page.getByRole("button", {name: "Show more repositories", exact: true})
    await expect(cards).toHaveCount(18, {timeout: 10_000})
    const initialGrid = await grid.elementHandle()
    if (!initialGrid) throw new Error("Account search grid was not rendered")

    const finishCardAnimations = () =>
      cards.evaluateAll(async elements => {
        await Promise.all(
          elements.flatMap(element => element.getAnimations().map(animation => animation.finished)),
        )
      })
    await finishCardAnimations()
    await grid.evaluate(element => {
      const animatedKeys: string[] = []
      element.addEventListener("animationstart", event => {
        const target = event.target
        if (target instanceof HTMLElement && target.dataset.repoKey) {
          animatedKeys.push(target.dataset.repoKey)
        }
      })
      ;(window as any).__repoCardIntroKeys = animatedKeys
    })

    for (const [expectedCount, requestedLimit] of [
      [36, 36],
      [40, 54],
    ]) {
      const previousCards = await cards.elementHandles()
      const previousKeys = await cards.evaluateAll(elements =>
        elements.map(element => element.getAttribute("data-repo-key")),
      )
      await page.evaluate(() => ((window as any).__repoCardIntroKeys.length = 0))
      await showMore.scrollIntoViewIfNeeded()
      const scrollTop = await scroller.evaluate(element => element.scrollTop)
      expect(scrollTop).toBeGreaterThan(100)
      await observePaginationLayout(page, expectedCount)

      await showMore.click()

      if (delayed) {
        await expect.poll(() => requestedLimits.has(requestedLimit)).toBe(true)
        await expect(showMore).toBeVisible()
        await expect(showMore).toBeDisabled()
        await expect(cards).toHaveCount(previousCards.length)
        if (previousCards.length === 18) {
          await testInfo.attach("pending-npub-search", {
            body: await page.screenshot({path: testInfo.outputPath("pending-npub-search.png")}),
            contentType: "image/png",
          })
        }
        await mockRelay.injectEvents(announcements.slice(previousCards.length, expectedCount))
      }
      await expect(cards).toHaveCount(expectedCount, {timeout: 10_000})
      pageResponses.get(requestedLimit)!.release()
      await finishCardAnimations()
      await expectStablePaginationLayout(page)
      const currentKeys = await cards.evaluateAll(elements =>
        elements.map(element => element.getAttribute("data-repo-key")),
      )
      const newKeys = currentKeys.filter(key => !previousKeys.includes(key))
      const animatedKeys = await page.evaluate(() => (window as any).__repoCardIntroKeys)
      expect(animatedKeys.sort()).toEqual(reducedMotion === "reduce" ? [] : newKeys.sort())
      const updatedScrollTop = await scroller.evaluate(element => element.scrollTop)
      expect(Math.abs(updatedScrollTop - scrollTop)).toBeLessThanOrEqual(2)
      expect(await initialGrid.evaluate(element => element.isConnected)).toBe(true)
      for (const card of previousCards) {
        expect(await card.evaluate(element => element.isConnected)).toBe(true)
      }
    }
    await expect(showMore).toHaveCount(0)
    await testInfo.attach("expanded-npub-search", {
      body: await page.screenshot({path: testInfo.outputPath("expanded-npub-search.png")}),
      contentType: "image/png",
    })

    // A different account must still clear old results and reset pagination.
    await search.fill(nip19.npubEncode(TEST_PUBKEYS.bob))
    await expect(cards).toHaveCount(1)
    await expect(cards).toContainText("Other account repository")
    await expect(showMore).toHaveCount(0)
    await search.fill(nip19.npubEncode(TEST_PUBKEYS.alice))
    await expect(cards).toHaveCount(18)
  })
}
