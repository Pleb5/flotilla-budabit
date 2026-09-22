import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const secret = new Uint8Array(32).fill(41)
const owner = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(42))
const address = `32222:${owner}:${communityId}`
const relayUrl = "wss://widget-visibility.example"
const appUrl = "https://visibility-widget.example/index.html"
const iconUrl = "https://visibility-widget.example/icon.svg"
const sign = (kind: number, tags: string[][], content = "", created_at = 1) =>
  finalizeEvent({kind, tags, content, created_at}, secret)
const definition = sign(32222, [
  ["d", communityId],
  ["name", "Widget Visibility"],
  ["r", relayUrl],
  ["content", "Widgets"],
  ["k", "30033"],
  ["a", `30000:${owner}:${communityId}-curators`],
])
const curators = sign(30000, [
  ["d", `${communityId}-curators`],
  ["p", owner],
])
const homePath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relayUrl]})}`
const widgetId = `30033:${owner}:visibility-fixture`
const targeting = sign(30222, [
  ["d", "visibility-target"],
  ["a", widgetId, relayUrl],
  ["k", "30033"],
  ["h", communityId],
  ["a", address, relayUrl],
])
const fixture = `<!doctype html><style>body{margin:0}</style><h2>Widget content</h2><script>
window.requests = []; window.context = null;
let id = 0;
window.request = (action, payload) => new Promise(resolve => {
  const key = 'fixture-' + (++id);
  const listener = e => { if (e.data?.id === key && e.data.type === 'response') {
    removeEventListener('message', listener); window.requests.push(e.data); resolve(e.data.payload);
  }};
  addEventListener('message', listener);
  parent.postMessage({type:'request', id:key, action, payload}, '*');
});
window.report = (visibility, version) => request('ui:setVisibility', {
  visibility, contextSessionId:context.contextSessionId,
  contextVersion:version ?? context.contextVersion
});
addEventListener('message', e => {
  if(e.data?.action === 'widget:init') {
    window.context = e.data.payload.communityContext;
    window.capabilities = e.data.payload.capabilities;
  }
  if(e.data?.action === 'community:contextChanged') window.context = e.data.payload.communityContext;
});
parent.postMessage({type:'event', action:'widget:ready'}, '*');
</script>`

const setup = async (page: Page, slot: string, visibility: "host" | "widget") => {
  const event = sign(
    30033,
    [
      ["d", "visibility-fixture"],
      ["l", "tool"],
      ["image", iconUrl],
      ["button", "Open", "app", appUrl],
      ["slot", slot, "Visibility fixture"],
      ["visibility", visibility],
    ],
    "Visibility fixture",
  )
  const widget = {
    ...event,
    identifier: "visibility-fixture",
    widgetType: "tool",
    appUrl,
    appUrls: [appUrl],
    buttons: [],
    slot: {type: slot, label: "Visibility fixture"},
    visibility,
  }
  await page.addInitScript(
    ({widget, widgetId}) => {
      if (location.hostname !== "localhost") return
      localStorage.setItem(
        "flotilla/extensions",
        JSON.stringify({
          enabled: [widgetId],
          disabledDefaultIds: [],
          installed: {widget: {[widgetId]: widget}},
          widgetInstallSources: {},
        }),
      )
    },
    {widget, widgetId},
  )
  const relay = new MockRelay({seedEvents: [definition, curators, event, targeting]})
  await relay.setup(page)
  let requests = 0
  await page.context().route(/^https:\/\//, route => {
    if (route.request().url() === appUrl) {
      requests += 1
      return route.fulfill({contentType: "text/html", body: fixture})
    }
    return route.fulfill({status: 503, body: "Blocked by fixture"})
  })
  await page.goto(homePath)
  await expect(page.locator('[data-perf="community-home"]')).toHaveAttribute(
    "data-perf-extensions-ready",
    "true",
    {timeout: 15_000},
  )
  return {relay, requests: () => requests}
}

for (const width of [390, 1100]) {
  test(`deferred visibility reserves no space until a current positive decision (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({width, height: 844})
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    const {relay} = await setup(page, "community-home-before-quicklinks", "widget")
    const iframe = page.locator('iframe[title="Visibility fixture"]')
    await expect(iframe).toHaveCount(1)
    const frame = page.frames().find(frame => frame.url() === appUrl)!
    await frame.waitForFunction(() => Boolean((window as any).context))
    const surface = page.locator("[data-widget-visibility]")
    await expect(surface).toHaveAttribute("data-widget-visibility", "pending")
    await expect(surface).toHaveCSS("height", "0px")
    await expect(page.locator('[data-widget-slot="community-home-before-quicklinks"]')).toHaveCSS(
      "position",
      "absolute",
    )
    await expect(page.getByRole("status", {name: "Loading Visibility fixture"})).toHaveCount(0)
    await frame.evaluate(() => (window as any).request("ui:resize", {height: 140}))
    await expect(surface).toHaveCSS("height", "0px")
    expect(await frame.evaluate(() => (window as any).report("visible", -1))).toMatchObject({
      code: "STALE_WIDGET_CONTEXT",
    })
    await expect(surface).toHaveCSS("height", "0px")
    await frame.evaluate(() => (window as any).report("hidden"))
    await expect(surface).toHaveAttribute("data-widget-visibility", "hidden")
    await frame.evaluate(() => (window as any).report("visible"))
    await expect(page.getByRole("status", {name: "Loading Visibility fixture"})).toBeVisible()
    await expect(surface).toHaveCSS("min-height", "220px")
    await frame.evaluate(() => (window as any).request("ui:resize", {height: 140}))
    await expect(surface).toHaveAttribute("data-widget-state", "ready")
    await expect(iframe).toBeVisible()
    await expect(surface).toHaveCSS("height", "140px")
    await page.screenshot({path: info.outputPath(`visible-${width}.png`)})
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(surface).toHaveCSS("height", "140px")
    const reloaded = frame.waitForNavigation()
    await frame.evaluate(() => location.reload())
    await reloaded
    await frame.waitForFunction(() => Boolean((window as any).context))
    await expect(surface).toHaveAttribute("data-widget-visibility", "pending")
    await expect(surface).toHaveCSS("height", "0px")
    await frame.evaluate(() => (window as any).report("hidden"))
    await expect(surface).toHaveCSS("height", "0px")
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })
}

test("a host-visible widget without a resize retains a usable retry area", async ({page}, info) => {
  await setup(page, "community-home-after-quicklinks", "host")
  const surface = page.locator("[data-widget-visibility]")
  await expect(page.getByRole("status", {name: "Loading Visibility fixture"})).toBeVisible()
  await expect(surface).toHaveAttribute("data-widget-state", "error", {timeout: 20_000})
  await expect(surface).toHaveCSS("min-height", "220px")
  const retry = page.getByRole("button", {name: "Retry widget"})
  await expect(retry).toBeVisible()
  await page.screenshot({path: info.outputPath("resize-timeout.png")})
  await retry.click()
  await expect(surface).toHaveAttribute("data-widget-state", "loading")
})

test("an eligible quicklink appears as a usable button without preloading its iframe", async ({
  page,
}) => {
  const {requests} = await setup(page, "community-home-quicklinks", "host")
  const button = page.getByRole("button", {name: "Visibility fixture", exact: true})
  await expect(button).toBeVisible()
  expect(requests()).toBe(0)
  await expect(page.locator("iframe")).toHaveCount(0)
  await expect(page.locator('[data-perf="community-home"]')).toHaveAttribute(
    "data-perf-widgets-terminal",
    "true",
  )
  await button.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.locator("iframe")).toHaveCount(1)
  expect(requests()).toBe(1)
})

test("an account switch invalidates visibility and rejects the previous context", async ({
  page,
}) => {
  await setup(page, "community-home-before-quicklinks", "widget")
  const iframe = page.locator('iframe[title="Visibility fixture"]')
  await expect(iframe).toHaveCount(1)
  let frame = page.frames().find(frame => frame.url() === appUrl)!
  await frame.waitForFunction(() => Boolean((window as any).context))
  const previousContext = await frame.evaluate(() => (window as any).context)
  await frame.evaluate(() => (window as any).report("visible"))
  await frame.evaluate(() => (window as any).request("ui:resize", {height: 140}))
  await expect(iframe).toBeVisible()
  await page.evaluate(async owner => {
    const moduleUrl = "/tests/e2e/fixtures/freelance-access-browser.ts"
    const fixture = await import(/* @vite-ignore */ moduleUrl)
    fixture.switchFreelanceFixtureAccount(owner)
  }, owner)
  const surface = page.locator("[data-widget-visibility]")
  await expect(surface).toHaveAttribute("data-widget-visibility", "pending")
  await expect(surface).toHaveCSS("height", "0px")
  frame = page.frames().find(frame => frame.url() === appUrl)!
  await frame.waitForFunction(() => Boolean((window as any).context))
  const result = await frame.evaluate(
    previous =>
      (window as any).request("ui:setVisibility", {
        visibility: "visible",
        contextSessionId: previous.contextSessionId,
        contextVersion: previous.contextVersion,
      }),
    previousContext,
  )
  expect(result).toMatchObject({code: "STALE_WIDGET_CONTEXT"})
  await expect(surface).toHaveCSS("height", "0px")
})
