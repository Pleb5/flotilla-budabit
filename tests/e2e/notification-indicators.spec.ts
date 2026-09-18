import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {seedDevSession, DEV_PUBKEY, DEV_SECRET} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const modulePath = "/tests/e2e/fixtures/notification-indicators-browser.ts"
const secret = Buffer.from(DEV_SECRET, "hex")
const relayUrl = "wss://notification-indicators.example"
const communityId = getPublicKey(new Uint8Array(32).fill(29))
const communityNaddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relayUrl],
})
const communityPath = `/c/${communityNaddr}`
const createdAt = Math.floor(Date.now() / 1000) - 100
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Notification UI Community"],
      ["r", relayUrl],
      ["content", "Room-creator"],
      ["k", "11", "room"],
      ["k", "9", "room-message"],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
    ],
  },
  secret,
)
const roomName = "A very long community room name with unread activity"
const room = finalizeEvent(
  {
    kind: 11,
    created_at: createdAt + 1,
    content: "",
    tags: [["h", communityId], ["room"], ["title", roomName]],
  },
  secret,
)
const repo = finalizeEvent(
  {
    kind: 30617,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", "indicator-test"],
      ["name", "Indicator test repository"],
      ["relays", relayUrl],
    ],
  },
  secret,
)
const repoNaddr = nip19.naddrEncode({kind: 30617, pubkey: DEV_PUBKEY, identifier: "indicator-test"})
const star = finalizeEvent(
  {
    kind: 7,
    created_at: createdAt + 1,
    content: "+",
    tags: [
      ["a", `30617:${DEV_PUBKEY}:indicator-test`, relayUrl],
      ["e", repo.id],
      ["p", DEV_PUBKEY],
      ["k", "30617"],
      ["r", relayUrl],
    ],
  },
  secret,
)

const showPaths = (page: Page, paths: string[]) =>
  page.evaluate(
    async ({modulePath, paths}) => {
      const fixture = await import(/* @vite-ignore */ modulePath)
      fixture.showRouteNotifications(paths)
    },
    {modulePath, paths},
  )

const contrastMetrics = (page: Page, selector: string, text = false) =>
  page.evaluate(
    async ({modulePath, selector, text}) => {
      const fixture = await import(/* @vite-ignore */ modulePath)
      return fixture.measureNotificationContrast(selector, text) as Array<{
        text: string
        contrast: number
        width: number
        height: number
      }>
    },
    {modulePath, selector, text},
  )

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    {name: "desktop", width: 1280, height: 960},
    {name: "tablet", width: 768, height: 1024},
    {name: "mobile", width: 390, height: 844},
    {name: "small-mobile", width: 320, height: 740},
  ]) {
    test.describe(`${theme} ${viewport.name}`, () => {
      test.use({viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768})
      test("notification dots and counts remain visible, contained, and readable", async ({
        page,
      }, info) => {
        const errors: string[] = []
        page.on("pageerror", error => errors.push(error.message))
        await page.emulateMedia({colorScheme: theme})
        await new MockRelay().setup(page)
        await page.goto("/explore")
        await expect(page.getByRole("button", {name: "Notifications", exact: true})).toBeVisible()
        await page.evaluate(
          async ({modulePath, theme}) => {
            const fixture = await import(/* @vite-ignore */ modulePath)
            fixture.showNotificationIndicators(theme)
          },
          {modulePath, theme},
        )
        const root = page.getByTestId("notification-indicators")
        await expect(
          root.getByTestId("repo-card-indicator").locator("[data-notification-indicator]"),
        ).toBeVisible()
        await expect(
          root.getByTestId("chat-indicator").locator("[data-notification-indicator]"),
        ).toBeVisible()
        await expect(
          root
            .getByRole("button", {name: "Read bell", exact: true})
            .locator("[data-notification-indicator]"),
        ).toHaveCount(0)

        const dots = await contrastMetrics(
          page,
          '[data-testid="notification-indicators"] [data-notification-indicator]',
        )
        expect(dots).toHaveLength(10)
        for (const dot of dots) {
          expect(dot.contrast, JSON.stringify(dot)).toBeGreaterThanOrEqual(3)
          expect(Math.abs(dot.width - dot.height)).toBeLessThan(0.5)
          expect(dot.width).toBeGreaterThanOrEqual(8)
        }
        const counts = await contrastMetrics(page, '[data-testid="filter-indicators"] .badge', true)
        expect(counts).toHaveLength(3)
        for (const count of counts)
          expect(count.contrast, JSON.stringify(count)).toBeGreaterThanOrEqual(4.5)
        const sidebar = await page.getByTestId("sidebar-indicators").evaluate(element =>
          Array.from(element.querySelectorAll("a,button"))
            .filter(row => row.querySelector("[data-notification-indicator]"))
            .map(row => {
              const label = row.querySelector(".ellipsize")!.getBoundingClientRect()
              const dot = row
                .querySelector("[data-notification-indicator]")!
                .getBoundingClientRect()
              const box = row.getBoundingClientRect()
              return {gap: dot.left - label.right, inset: box.right - dot.right}
            }),
        )
        for (const row of sidebar) {
          expect(row.gap).toBeGreaterThan(0)
          expect(row.inset).toBeGreaterThan(1)
        }
        expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        )
        expect(errors).toEqual([])
        await page.screenshot({
          path: info.outputPath("notification-indicators.png"),
          fullPage: true,
          animations: "disabled",
        })
      })

      if (viewport.name === "desktop" || viewport.name === "small-mobile") {
        test("community quicklinks use consistent contrast and the drawer protects long labels", async ({
          page,
        }, info) => {
          await page.emulateMedia({colorScheme: theme})
          await seedDevSession(page)
          await new MockRelay({seedEvents: [definition, room]}).setup(page)
          await page.goto(communityPath)
          await expect(page.getByRole("heading", {name: "Notification UI Community"})).toBeVisible()
          await expect(page.locator("a.btn").filter({hasText: roomName})).toBeVisible({
            timeout: 15_000,
          })
          await showPaths(page, [
            "/git/fixture/issues",
            ...["threads", "calendar", "goals", `rooms/${room.id}`, "admin", "access"].map(
              suffix => `${communityPath}/${suffix}`,
            ),
          ])
          const links = page
            .locator("a.btn")
            .filter({has: page.locator("[data-notification-indicator]")})
          await expect(links).toHaveCount(5)
          for (const name of ["Git", "Threads", "Calendar", "Goals"]) {
            const dot = page
              .getByRole("link", {name, exact: true})
              .and(page.locator("a.btn"))
              .locator("[data-notification-indicator]")
            await expect(dot).toHaveCSS("background-color", "rgb(255, 255, 255)")
          }
          for (const dot of await contrastMetrics(page, "a.btn [data-notification-indicator]"))
            expect(dot.contrast, JSON.stringify(dot)).toBeGreaterThanOrEqual(3)
          const geometry = await links.evaluateAll(links =>
            links.map(link => {
              const button = link.getBoundingClientRect()
              const dot = link
                .querySelector("[data-notification-indicator]")!
                .getBoundingClientRect()
              return (
                dot.left >= button.left &&
                dot.right <= button.right &&
                dot.top >= button.top &&
                dot.bottom <= button.bottom
              )
            }),
          )
          expect(geometry.every(Boolean)).toBe(true)
          await page.screenshot({
            path: info.outputPath("community-quicklinks.png"),
            animations: "disabled",
          })
          if (viewport.width < 768)
            await page.getByRole("button", {name: "Open community menu", exact: true}).click()
          const row = page
            .getByRole("link", {name: roomName, exact: true})
            .filter({has: page.locator("[data-notification-indicator]")})
            .last()
          await expect(row).toBeVisible()
          await expect
            .poll(() =>
              row.evaluate(element => {
                const rect = element.getBoundingClientRect()
                return rect.left >= 0 && rect.right <= window.innerWidth
              }),
            )
            .toBe(true)
          const gap = await row.evaluate(
            element =>
              element.querySelector("[data-notification-indicator]")!.getBoundingClientRect().left -
              element.querySelector(".ellipsize")!.getBoundingClientRect().right,
          )
          expect(gap).toBeGreaterThan(0)
          await page.screenshot({
            path: info.outputPath("community-menu.png"),
            animations: "disabled",
          })
        })

        test("Starred keeps its dot visible when selected", async ({page}, info) => {
          await page.emulateMedia({colorScheme: theme})
          await seedDevSession(page)
          await new MockRelay({seedEvents: [repo, star]}).setup(page)
          await page.goto("/git?entry=personal")
          const tab = page.getByRole("tab", {name: "Starred", exact: true})
          await expect(tab).toBeVisible()
          await tab.click()
          await expect(page.getByText("Indicator test repository", {exact: true})).toBeVisible({
            timeout: 15_000,
          })
          await showPaths(page, [`/git/${repoNaddr}/issues`])
          await expect(tab.locator("[data-notification-indicator]")).toBeVisible()
          expect(
            await tab
              .locator(".truncate")
              .evaluate(element => element.scrollWidth <= element.clientWidth),
          ).toBe(true)
          for (const dot of await contrastMetrics(
            page,
            '[role="tab"][data-state="active"] [data-notification-indicator]',
          ))
            expect(dot.contrast, JSON.stringify(dot)).toBeGreaterThanOrEqual(3)
          await page.screenshot({
            path: info.outputPath("starred-selected.png"),
            animations: "disabled",
          })
          await page.getByRole("tab", {name: "Repos", exact: true}).click()
          await expect(tab.locator("[data-notification-indicator]")).toBeVisible()
          await expect
            .poll(async () => {
              const metrics = await contrastMetrics(
                page,
                '[role="tab"] [data-notification-indicator]',
              )
              return metrics.length === 1 ? metrics[0].contrast : 0
            })
            .toBeGreaterThanOrEqual(3)
        })
      }
    })
  }
}
