import {readFileSync} from "node:fs"
import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

// Real host/bridge and built widget; local fixture transport and view-only account.
const bundle = readFileSync(
  process.env.FREELANCE_WIDGET_BUNDLE || "../budabit-satshoot-widget/dist/index.html",
  "utf8",
)
const icon = readFileSync(
  process.env.FREELANCE_WIDGET_ICON || "../budabit-satshoot-widget/public/icon.svg",
  "utf8",
)
const secret = new Uint8Array(32).fill(23)
const owner = getPublicKey(secret)
const viewer = getPublicKey(new Uint8Array(32).fill(24))
const communityId = getPublicKey(new Uint8Array(32).fill(25))
const address = `32222:${owner}:${communityId}`
const relayUrl = "wss://freelance-quicklink.example"
const appUrl = "https://freelance-widget.example/index.html"
const iconUrl = "https://freelance-widget.example/icon.svg"
const widgetId = `30033:${owner}:community-freelance`
const sign = (kind: number, created_at: number, tags: string[][], content = "") =>
  finalizeEvent({kind, created_at, tags, content}, secret)
const definition = sign(32222, 1, [
  ["d", communityId],
  ["name", "Freelance Quicklink Community"],
  ["r", relayUrl],
  ["content", "Widget-curator"],
  ["k", "30033"],
  ["a", `30000:${owner}:${communityId}-curators`],
  ["content", "Freelance"],
  ...[32765, 32766, 32767, 32768, 1986].map(kind => ["k", String(kind)]),
])
const curators = sign(30000, 1, [
  ["d", `${communityId}-curators`],
  ["p", owner],
])
const permissions = [
  "nostr:sign",
  "community:checkWriteCapabilities",
  "storage:get",
  "storage:set",
  "ui:resize",
  "ui:navigate",
]
const widget = {
  ...sign(
    30033,
    2,
    [
      ["d", "community-freelance"],
      ["l", "tool"],
      ["image", iconUrl],
      ["icon", iconUrl],
      ["button", "Open Freelance", "app", appUrl],
      ["version", "0.4.0"],
      ["slot", "community-home-quicklinks", "Freelance"],
      ...permissions.map(permission => ["permission", permission]),
    ],
    "Community Freelance · SatShoot",
  ),
  identifier: "community-freelance",
  widgetType: "tool",
  permissions,
  appUrl,
  appUrls: [appUrl],
  iconUrl,
  imageUrl: iconUrl,
  version: "0.4.0",
  buttons: [{index: 1, label: "Open Freelance", type: "app", url: appUrl}],
  slot: {type: "community-home-quicklinks", label: "Freelance"},
}
const targeting = sign(30222, 3, [
  ["d", "freelance-target"],
  ["a", widgetId, relayUrl],
  ["k", "30033"],
  ["h", communityId],
  ["a", address, relayUrl],
])
const homePath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relayUrl]})}`

test.afterEach(async ({page}, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({path: info.outputPath("failure.png")})
    await info.attach("page-content", {
      body: await page.locator("body").innerText(),
      contentType: "text/plain",
    })
  }
})

for (const mobile of [false, true]) {
  test(`Freelance quicklink loads its workspace only on click (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    context,
  }, info) => {
    if (mobile) await page.setViewportSize({width: 390, height: 844})
    await page.emulateMedia({colorScheme: mobile ? "dark" : "light"})
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(
      ({viewer, widgetId, widget}) => {
        if (location.hostname !== "localhost") return
        localStorage.setItem("pubkey", JSON.stringify(viewer))
        localStorage.setItem(
          "sessions",
          JSON.stringify({[viewer]: {method: "pubkey", pubkey: viewer}}),
        )
        localStorage.setItem(
          "flotilla/extensions",
          JSON.stringify({
            enabled: [widgetId],
            disabledDefaultIds: [],
            installed: {widget: {[widgetId]: widget}},
            widgetInstallSources: {[widgetId]: {relays: ["wss://freelance-quicklink.example"]}},
          }),
        )
      },
      {viewer, widgetId, widget},
    )
    const relay = new MockRelay({seedEvents: [definition, curators, widget, targeting]})
    await relay.setup(page)
    let bundleRequests = 0
    await context.route(/^https:\/\//, route => {
      const url = new URL(route.request().url())
      if (url.origin + url.pathname === appUrl) {
        bundleRequests += 1
        return route.fulfill({status: 200, contentType: "text/html", body: bundle})
      }
      if (url.origin + url.pathname === iconUrl)
        return route.fulfill({status: 200, contentType: "image/svg+xml", body: icon})
      return route.fulfill({status: 503, body: "External service blocked by fixture"})
    })
    await page.goto(homePath)
    const home = page.locator('[data-perf="community-home"]')
    await expect(home).toHaveAttribute("data-perf-extensions-ready", "true", {timeout: 15000})
    const launcher = home.getByRole("button", {name: "Freelance", exact: true})
    await expect(launcher).toBeVisible()
    await expect(launcher.locator("img")).toHaveJSProperty("naturalWidth", 38)
    await expect(page.locator('iframe[src*="freelance-widget.example"]')).toHaveCount(0)
    expect(bundleRequests).toBe(0)
    await expect
      .poll(() => launcher.evaluate(element => element.getBoundingClientRect().height))
      .toBeLessThan(70)
    await page.screenshot({path: info.outputPath("home-quicklink.png")})

    await launcher.click()
    const dialog = page.getByRole("dialog", {name: "Freelance", exact: true})
    const iframe = dialog.locator("iframe")
    const frame = page.frameLocator('iframe[title="Community Freelance · SatShoot"]')
    await expect(frame.getByRole("navigation", {name: "Freelance workspace"})).toBeVisible()
    await expect(frame.getByText("Community relay connection ready", {exact: true})).toBeVisible()
    await expect(
      frame.getByText("You need Freelance publishing access to post a job.", {exact: false}),
    ).toBeVisible()
    await expect(frame.locator(".brand-mark svg")).toHaveAttribute("viewBox", "0 0 38 38")
    await expect(frame.locator("main")).toHaveAttribute("data-theme", mobile ? "dark" : "light")
    await expect(iframe).toHaveCount(1)
    expect(bundleRequests).toBe(1)
    if (!mobile)
      await expect
        .poll(() => iframe.evaluate(element => element.getBoundingClientRect().width))
        .toBeGreaterThan(700)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await expect
      .poll(() =>
        frame.locator("html").evaluate(element => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)
    await dialog.screenshot({path: info.outputPath("freelance-workspace.png")})

    await dialog.getByRole("button", {name: "Close widget", exact: true}).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.locator('iframe[src*="freelance-widget.example"]')).toHaveCount(0)
    await expect(launcher).toBeVisible()
    await launcher.click()
    await expect(frame.getByRole("button", {name: "Access options", exact: true})).toBeVisible()
    await frame.getByRole("button", {name: "Access options", exact: true}).click()
    await expect(page).toHaveURL(/\/access\?section=Freelance&kind=32767$/)
    await expect(page.getByRole("region", {name: "Freelance publishing access"})).toContainText(
      "No application form is currently available for this section.",
    )
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })
}
