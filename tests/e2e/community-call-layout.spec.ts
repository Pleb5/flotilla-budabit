import {readFileSync, writeFileSync} from "node:fs"
import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

// The real Community Home, WidgetFrame, bridge, and production widget bundle;
// only relay data and the hosted artifact transport are fixtures. No signer is
// installed in the browser and nothing can reach a public relay/call service.
const secret = new Uint8Array(32).fill(21)
const owner = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(22))
const address = `32222:${owner}:${communityId}`
const relayUrl = "wss://community-call-layout.example"
const appUrl = "https://call-widget.example/community-call.html"
const hostOrigin = process.env.COMMUNITY_CALL_HOST_URL || "http://localhost:1847"
const bundlePath = process.env.COMMUNITY_CALL_BUNDLE || "../budabit-community-call/dist/index.html"
const bundle = readFileSync(bundlePath, "utf8")
const sign = (kind: number, created_at: number, tags: string[][], content = "") =>
  finalizeEvent({kind, created_at, tags, content}, secret)
const definition = sign(32222, 1, [
  ["d", communityId],
  ["name", "Call Layout Community"],
  ["r", relayUrl],
  ["content", "Rooms"],
  ["k", "11", "room"],
  ["a", `30000:${owner}:${communityId}-members`],
])
const members = sign(30000, 2, [
  ["d", `${communityId}-members`],
  ["p", owner],
])
const rooms = [
  "Design",
  "Engineering",
  "Operations",
  "Introduction",
  "Onboarding",
  "Development",
].map((name, index) => sign(11, 3 + index, [["h", communityId], ["room"], ["title", name]], name))
const sharedConfig = sign(
  30078,
  10,
  [
    ["d", `budabit-community-config:${address}:budabit-community-call:active-call`],
    ["a", address],
    ["namespace", "budabit-community-call"],
    ["key", "active-call"],
    ["descriptor", "11", "room"],
  ],
  JSON.stringify({status: "ended"}),
)
const permissions = [
  "community:checkWriteCapabilities",
  "community:querySharedConfig",
  "community:publishSharedConfig",
  "ui:resize",
  "ui:toast",
  "media:camera",
  "media:microphone",
  "media:display-capture",
]
const widget = {
  ...sign(
    30033,
    11,
    [
      ["d", "community-call"],
      ["l", "tool"],
      ["button", "Open", "app", appUrl],
      ["shared-config", "budabit-community-call", "active-call"],
      ["slot", "community-home-before-quicklinks", "Community call"],
      ...permissions.map(permission => ["permission", permission]),
    ],
    "Community Call",
  ),
  identifier: "community-call",
  widgetType: "tool",
  permissions,
  appUrl,
  appUrls: [appUrl],
  buttons: [{label: "Open", type: "app", url: appUrl}],
  slot: {type: "community-home-before-quicklinks", label: "Community call"},
}
const widgetId = `30033:${owner}:community-call`
const peerId = `30033:${owner}:peer-widget`
const peerUrl = "https://call-widget.example/peer.html"
const peerWidget = {
  ...widget,
  ...sign(
    30033,
    12,
    [
      ["d", "peer-widget"],
      ["l", "tool"],
      ["button", "Open", "app", peerUrl],
      ["shared-config", "budabit-community-call", "active-call"],
      ["slot", "community-home-before-quicklinks", "Peer widget"],
      ["permission", "community:querySharedConfig"],
      ["permission", "ui:resize"],
    ],
    "Peer widget",
  ),
  identifier: "peer-widget",
  appUrl: peerUrl,
  appUrls: [peerUrl],
  slot: {type: "community-home-before-quicklinks", label: "Peer widget"},
}
const peerBundle = `<!doctype html><style>body{margin:0}</style><p>Same-origin resize fixture</p><script>
let n = 0;
function resize() { parent.postMessage({type:'request', action:'ui:resize', id:'peer-'+(++n), payload:{height:n%2 ? 43 : 91}}, '*') }
addEventListener('message', e => { if(e.data?.action === 'widget:init') { resize(); setInterval(resize, 1000) } });
parent.postMessage({type:'event',action:'widget:ready'}, '*');
</script>`
const homePath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relayUrl]})}`
type LayoutRecord = {
  ms: number
  height: number
  viewport: number
  heading: string
  loading: boolean
}
type DebugWindow = typeof window & {
  __callLayouts: LayoutRecord[]
  __callMessages: Array<{
    ms: number
    type: string
    action: string
    height?: number
    version?: number
  }>
}
const callFrame = (page: Page) => page.frameLocator('iframe[title="Community Call"]')

for (const scenario of ["polls and form expansion", "offscreen width changes"]) {
  test(`real home: ${scenario}`, async ({page, context}, testInfo) => {
    const errors: string[] = []
    const originalViewport = page.viewportSize()!
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(
      ({owner, widgetId, widget, hostOrigin, peerId, peerWidget}) => {
        // A view-only fixture owner, not an imported personal account.
        if (location.origin === hostOrigin) {
          localStorage.setItem("pubkey", JSON.stringify(owner))
          localStorage.setItem(
            "sessions",
            JSON.stringify({[owner]: {method: "pubkey", pubkey: owner}}),
          )
          localStorage.setItem(
            "flotilla/extensions",
            JSON.stringify({
              enabled: [widgetId, peerId],
              disabledDefaultIds: [],
              installed: {widget: {[widgetId]: widget, [peerId]: peerWidget}},
              widgetInstallSources: {},
            }),
          )
        }
        const target = window as DebugWindow
        target.__callLayouts = []
        target.__callMessages = []
        window.addEventListener("message", event => {
          const message = event.data
          if (!message || typeof message.action !== "string") return
          if (
            ![
              "ui:resize",
              "community:querySharedConfig",
              "community:contextChanged",
              "widget:init",
            ].includes(message.action)
          )
            return
          target.__callMessages.push({
            ms: performance.now(),
            type: message.type,
            action: message.action,
            height: message.action === "ui:resize" ? message.payload?.height : undefined,
            version: message.payload?.communityContext?.contextVersion,
          })
        })
        if (location.hostname !== "call-widget.example") return
        let last = ""
        const sample = () => {
          const main = document.querySelector("main")
          if (main) {
            const state = {
              height: Math.ceil(main.getBoundingClientRect().height),
              viewport: innerHeight,
              heading: main.querySelector("h2")?.textContent || "",
              loading: main.textContent?.includes("Checking community call availability") || false,
            }
            const key = JSON.stringify(state)
            if (key !== last) target.__callLayouts.push({ms: performance.now(), ...state})
            last = key
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },
      {owner, widgetId, widget, hostOrigin, peerId, peerWidget},
    )
    const relay = new MockRelay({
      seedEvents: [definition, members, ...rooms, sharedConfig, widget, peerWidget],
    })
    await relay.setup(page)
    await context.route(/^https:\/\//, route =>
      new URL(route.request().url()).origin === hostOrigin && route.request().method() === "GET"
        ? route.continue()
        : route.request().url() === peerUrl
          ? route.fulfill({status: 200, contentType: "text/html", body: peerBundle})
          : route.request().url() === appUrl
            ? route.fulfill({status: 200, contentType: "text/html", body: bundle})
            : route.fulfill({status: 503, body: "External service blocked by fixture"}),
    )
    await page.goto(homePath)
    const host = page.locator('[data-perf="community-home"]')
    await expect(host).toHaveAttribute("data-perf-extensions-ready", "true")
    const iframe = page.locator('iframe[title="Community Call"]')
    const idle = callFrame(page).getByRole("heading", {name: "No call in progress"})
    try {
      await expect(idle).toBeVisible()
      const frame = page.frames().find(frame => frame.url() === appUrl)!
      const fitted = async () => {
        const layout = await frame.evaluate(() => ({
          height: Math.ceil(document.querySelector("main")!.getBoundingClientRect().height),
          viewport: innerHeight,
          verticalOverflow: document.documentElement.scrollHeight - innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        }))
        return Math.max(
          Math.abs(layout.height - layout.viewport),
          layout.verticalOverflow,
          layout.horizontalOverflow,
        )
      }
      await expect.poll(fitted).toBeLessThanOrEqual(1)
      await expect(page.locator('iframe[title="Peer widget"]')).toHaveCount(1)
      if (scenario === "offscreen width changes") {
        await page.setViewportSize({width: 1100, height: 200})
        await expect
          .poll(() => iframe.evaluate(el => el.getBoundingClientRect().top > innerHeight))
          .toBe(true)
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
        await page.setViewportSize({width: 320, height: 200})
        await expect.poll(fitted).toBeLessThanOrEqual(1)
        await page.setViewportSize({width: 1100, height: 200})
        await expect.poll(fitted).toBeLessThanOrEqual(1)
        expect(relay.getPublishedEvents()).toEqual([])
        expect(errors).toEqual([])
        return
      }
      const startCount = await page.evaluate(
        () =>
          (window as DebugWindow).__callMessages.filter(
            message => message.action === "community:querySharedConfig",
          ).length,
      )
      await frame.evaluate(() => {
        ;(window as DebugWindow).__callLayouts = []
      })
      // Observe real 15-second polls, rather than advancing fake clocks past the
      // paints and postMessage/load ordering that can expose the regression.
      await page.waitForFunction(
        count =>
          (window as DebugWindow).__callMessages.filter(
            message => message.action === "community:querySharedConfig",
          ).length >=
          count + 2,
        startCount,
        {timeout: 40_000},
      )
      await expect(idle).toBeVisible()
      await expect.poll(fitted).toBeLessThanOrEqual(1)
      expect(
        await frame.evaluate(() =>
          (window as DebugWindow).__callLayouts.filter(
            layout => layout.loading || layout.heading !== "No call in progress",
          ),
        ),
      ).toEqual([])
      expect(
        await frame.evaluate(() =>
          (window as DebugWindow).__callLayouts.filter(
            layout => Math.abs(layout.height - layout.viewport) > 1,
          ),
        ),
      ).toEqual([])
      await callFrame(page).getByRole("button", {name: "Start community call"}).click()
      await expect(
        callFrame(page).getByRole("heading", {name: "Start a call", exact: true}),
      ).toBeVisible()
      await expect.poll(fitted).toBeLessThanOrEqual(1)
      for (const width of [320, 390, 620, 768, 1100]) {
        await page.setViewportSize({width, height: 360})
        await expect.poll(fitted).toBeLessThanOrEqual(1)
      }
      await callFrame(page).getByRole("button", {name: "Cancel", exact: true}).click()
      await expect(idle).toBeVisible()
      await expect.poll(fitted).toBeLessThanOrEqual(1)
      expect(relay.getPublishedEvents()).toEqual([])
      expect(errors).toEqual([])
    } finally {
      const frame = page.frames().find(frame => frame.url() === appUrl)
      const diagnostic = {
        errors,
        urls: page.frames().map(frame => frame.url()),
        host: await page.evaluate(() => (window as DebugWindow).__callMessages),
        widget: frame
          ? await frame.evaluate(() => ({
              layouts: (window as DebugWindow).__callLayouts,
              messages: (window as DebugWindow).__callMessages,
              current: {
                width: innerWidth,
                viewport: innerHeight,
                content: document.querySelector("main")?.getBoundingClientRect().height,
                scroll: document.documentElement.scrollHeight,
              },
            }))
          : null,
        frame: await iframe
          .evaluate(el => ({
            height: el.getBoundingClientRect().height,
            parent: el.parentElement?.getAttribute("style"),
          }))
          .catch(() => null),
      }
      writeFileSync(testInfo.outputPath("call-layout.json"), JSON.stringify(diagnostic, null, 2))
      await testInfo.attach("call-layout", {
        path: testInfo.outputPath("call-layout.json"),
        contentType: "application/json",
      })
      await page.setViewportSize(originalViewport)
      await iframe.scrollIntoViewIfNeeded().catch(() => undefined)
      await page.screenshot({path: testInfo.outputPath("community-call.png")})
    }
  })
}
