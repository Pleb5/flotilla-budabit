import {readFileSync} from "node:fs"
import {expect, test, type Page} from "@playwright/test"
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
  // A settled, absent grant in another section must not break Freelance access.
  ["content", "General"],
  ["k", "1"],
  ["a", `30000:${owner}:${communityId}-absent-general`],
  ["content", "Freelance"],
  ...[32765, 32766, 32767, 32768, 1986].map(kind => ["k", String(kind)]),
  ["a", `30000:${owner}:${communityId}-freelance`],
])
const curators = sign(30000, 1, [
  ["d", `${communityId}-curators`],
  ["p", owner],
])
const permissions = [
  "nostr:sign",
  "profiles:resolve",
  "ui:openProfile",
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
const receiveEvents = (page: Page, events: ReturnType<typeof sign>[]) =>
  page.evaluate(async events => {
    const moduleUrl = "/tests/e2e/fixtures/freelance-access-browser.ts"
    const fixture = await import(/* @vite-ignore */ moduleUrl)
    fixture.receiveFreelanceFixtureEvents(events)
  }, events)
const switchAccount = (page: Page, account: string) =>
  page.evaluate(async account => {
    const moduleUrl = "/tests/e2e/fixtures/freelance-access-browser.ts"
    const fixture = await import(/* @vite-ignore */ moduleUrl)
    fixture.switchFreelanceFixtureAccount(account)
  }, account)

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
        if (location.hostname === "freelance-widget.example") {
          // Hold a context notification to reproduce a delayed/stale handoff.
          window.addEventListener("message", event => {
            if (
              event.data?.action === "community:contextChanged" &&
              (window as any).__holdCommunityContext
            ) {
              ;(window as any).__heldCommunityContext = event.data.payload
              event.stopImmediatePropagation()
            }
          })
          return
        }
        if (location.hostname !== "localhost") return
        ;(window as any).__freelanceRequests = []
        window.addEventListener("message", event => {
          if (event.data?.type === "request")
            (window as any).__freelanceRequests.push(event.data.action)
        })
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
    // Exercise an upgraded install while relay/cache curation still advertises
    // the previous inline version. Returning to the window must not resurrect it.
    const curatedWidget = mobile
      ? sign(
          30033,
          1,
          widget.tags.map(tag =>
            tag[0] === "slot"
              ? ["slot", "community-home-after-quicklinks", "Freelance"]
              : tag[0] === "version"
                ? ["version", "0.3.0"]
                : tag,
          ),
          widget.content,
        )
      : widget
    const relay = new MockRelay({seedEvents: [definition, curators, curatedWidget, targeting]})
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
    // A browser-focus refresh must preserve the launcher node, not remove/reinsert it.
    const initialLauncher = await launcher.elementHandle()
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("focus"))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    expect(await initialLauncher!.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.locator('iframe[src*="freelance-widget.example"]')).toHaveCount(0)
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
    await expect(frame.getByRole("heading", {name: "No jobs yet", exact: true})).toBeVisible()
    await expect(frame.getByRole("button", {name: "Post a job", exact: true})).toHaveCount(0)
    await frame.getByRole("button", {name: "Check again", exact: true}).click()
    await expect(frame.getByText("Publishing access required", {exact: true})).toBeVisible()

    // Budabit hydrates the profile after the iframe has already started.
    const widgetFrame = page.frames().find(item => item.url().startsWith(appUrl))!
    const sockets = () =>
      widgetFrame.evaluate(() => [...(window as any).__mockRelayConnections.keys()])
    const originalSockets = await sockets()
    const profile = finalizeEvent(
      {
        kind: 0,
        created_at: 1,
        tags: [],
        content: JSON.stringify({display_name: "Ada Maker", name: "ada", picture: iconUrl}),
      },
      new Uint8Array(32).fill(24),
    )
    await receiveEvents(page, [profile])
    await expect(frame.getByLabel("Signing account")).toContainText("Ada Maker")
    await expect(frame.locator(".signing-account img")).toHaveJSProperty("naturalWidth", 38)
    expect(await sockets()).toEqual(originalSockets)

    // The empty state leads into both real creation forms after a grant arrives.
    const grant = (createdAt: number, allowed: boolean) =>
      sign(30000, createdAt, [
        ["d", `${communityId}-freelance`],
        ...(allowed ? [["p", viewer]] : []),
      ])
    await receiveEvents(page, [grant(2, true)])
    await expect(frame.getByRole("button", {name: "Post a job", exact: true})).toBeVisible()
    await frame.getByRole("heading", {name: "Freelance", exact: true}).scrollIntoViewIfNeeded()
    await dialog.screenshot({path: info.outputPath("freelance-create-job.png")})
    await frame.getByRole("button", {name: "Services", exact: true}).click()
    await expect(frame.getByRole("heading", {name: "No services yet", exact: true})).toBeVisible()
    await frame.getByRole("button", {name: "Offer a service", exact: true}).click()
    await expect(frame.getByRole("region", {name: "Offer a service", exact: true})).toBeVisible()
    await frame.getByRole("button", {name: "Cancel", exact: true}).click()
    await frame.getByRole("button", {name: "Jobs", exact: true}).click()
    await frame.getByRole("button", {name: "Post a job", exact: true}).click()
    await frame.getByLabel("Title", {exact: true}).fill("Keep my community draft")
    await frame
      .getByLabel("Description", {exact: true})
      .fill("Retain this text when access changes")

    // Model the host loader's pending -> settled transition with a draft open.
    await page.evaluate(async () => {
      const moduleUrl = "/tests/e2e/fixtures/freelance-access-browser.ts"
      const fixture = await import(/* @vite-ignore */ moduleUrl)
      fixture.setFreelanceFixtureAuthorityPending(true)
    })
    await expect(frame.getByText("Access check unavailable", {exact: true})).toBeVisible()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Keep my community draft")
    await page.evaluate(async () => {
      const moduleUrl = "/tests/e2e/fixtures/freelance-access-browser.ts"
      const fixture = await import(/* @vite-ignore */ moduleUrl)
      fixture.setFreelanceFixtureAuthorityPending(false)
    })
    await expect(frame.getByRole("button", {name: "Publish", exact: true})).toBeEnabled()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Keep my community draft")

    // Revocation arrives after opening the composer. No stale capability may sign.
    await widgetFrame.evaluate(() => {
      ;(window as any).__holdCommunityContext = true
    })
    await receiveEvents(page, [grant(3, false)])
    await expect
      .poll(() => widgetFrame.evaluate(() => Boolean((window as any).__heldCommunityContext)))
      .toBe(true)
    await frame.getByRole("button", {name: "Publish", exact: true}).click()
    await expect(frame.getByText("Access check unavailable", {exact: true})).toBeVisible()
    await expect(frame.getByRole("button", {name: "Access options", exact: true})).toBeVisible()
    await frame.getByRole("button", {name: "Check again", exact: true}).click()
    await expect(frame.getByText("Publishing access required", {exact: true})).toBeVisible()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Keep my community draft")
    await expect(frame.getByRole("button", {name: "Publish", exact: true})).toHaveCount(0)
    await expect(
      frame.getByText("Community permissions changed. Refresh before publishing.", {exact: true}),
    ).toHaveCount(0)
    await dialog.screenshot({path: info.outputPath("freelance-revoked-draft.png")})
    await widgetFrame.evaluate(() => {
      ;(window as any).__holdCommunityContext = false
    })
    await receiveEvents(page, [grant(4, true)])
    await expect(frame.getByRole("button", {name: "Publish", exact: true})).toBeEnabled()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Keep my community draft")
    // No autosave delay: switching tabs must preserve the last keystroke.
    await frame.getByLabel("Title", {exact: true}).evaluate((element: HTMLInputElement) => {
      element.value = "Immediate tab-switch draft"
      element.dispatchEvent(new Event("input", {bubbles: true}))
    })
    await frame
      .getByRole("button", {name: "Services", exact: true})
      .evaluate(element => element.click())
    await frame.getByRole("button", {name: "Jobs", exact: true}).click()
    await frame.getByRole("button", {name: "Post a job", exact: true}).click()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Immediate tab-switch draft")
    await frame.getByRole("button", {name: "Cancel", exact: true}).click()
    await frame.getByLabel("Search freelance listings").fill("nothing here")
    await expect(
      frame.getByRole("heading", {name: "No matching listings", exact: true}),
    ).toBeVisible()
    await frame.getByRole("button", {name: "Clear filters", exact: true}).click()
    await expect(frame.getByLabel("Search freelance listings")).toHaveValue("")

    // Account changes invalidate the profile/grant without remounting the iframe.
    await switchAccount(page, owner)
    await expect(frame.getByLabel("Signing account")).not.toContainText("Ada Maker")
    await expect(frame.getByLabel("Signing account")).toHaveAttribute(
      "title",
      nip19.npubEncode(owner),
    )
    await expect(frame.locator(".signing-account img")).toHaveCount(0)
    await switchAccount(page, viewer)
    await expect(frame.getByLabel("Signing account")).toContainText("Ada Maker")
    await receiveEvents(page, [grant(5, false)])
    // Malformed and broken pictures fall back locally without hiding the name.
    await receiveEvents(page, [
      finalizeEvent(
        {
          ...profile,
          created_at: 2,
          content: JSON.stringify({name: "ada", picture: "javascript:alert(1)"}),
        },
        new Uint8Array(32).fill(24),
      ),
    ])
    await expect(frame.getByLabel("Signing account")).toContainText("ada")
    await expect(frame.locator(".signing-account img")).toHaveCount(0)
    await receiveEvents(page, [
      finalizeEvent(
        {
          ...profile,
          created_at: 3,
          content: JSON.stringify({
            display_name: "Ada Maker",
            picture: "https://freelance-widget.example/missing.png",
          }),
        },
        new Uint8Array(32).fill(24),
      ),
    ])
    await expect(frame.getByLabel("Signing account")).toContainText("Ada Maker")
    await expect(frame.locator(".signing-account img")).toHaveCount(0)
    await receiveEvents(page, [
      finalizeEvent({...profile, created_at: 4}, new Uint8Array(32).fill(24)),
    ])
    await expect(frame.locator(".signing-account img")).toHaveJSProperty("naturalWidth", 38)
    await switchAccount(page, "")
    await expect(
      frame.getByRole("button", {name: "Open community to sign in", exact: true}),
    ).toBeVisible()
    await expect(frame.getByLabel("Signing account")).toHaveCount(0)
    await switchAccount(page, viewer)
    await expect(frame.getByLabel("Signing account")).toContainText("Ada Maker")
    await expect(frame.getByText("Publishing access required", {exact: true})).toBeVisible()
    await frame.getByRole("button", {name: "Refresh community activity", exact: true}).click()
    await expect(frame.getByText("Publishing access required", {exact: true})).toBeVisible()
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
    await frame.getByRole("button", {name: "Access options", exact: true}).scrollIntoViewIfNeeded()
    await dialog.screenshot({path: info.outputPath("freelance-access-actions.png")})

    await dialog.getByRole("button", {name: "Close widget", exact: true}).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.locator('iframe[src*="freelance-widget.example"]')).toHaveCount(0)
    await expect(launcher).toBeVisible()
    const closedLauncher = await launcher.elementHandle()
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    expect(await closedLauncher!.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.locator('iframe[src*="freelance-widget.example"]')).toHaveCount(0)
    expect(bundleRequests).toBe(1)
    await launcher.click()
    await expect(frame.getByRole("button", {name: "Access options", exact: true})).toBeVisible()
    // The real host removes the iframe on dismissal. Its synchronous local journal
    // must preserve a just-entered value even before a host storage reply arrives.
    await receiveEvents(page, [grant(6, true)])
    await frame.getByRole("button", {name: "Post a job", exact: true}).click()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue("Immediate tab-switch draft")
    await frame.getByLabel("Title", {exact: true}).evaluate((element: HTMLInputElement) => {
      element.value = "Immediate host-dismissal draft"
      element.dispatchEvent(new Event("input", {bubbles: true}))
    })
    await dialog
      .getByRole("button", {name: "Close widget", exact: true})
      .evaluate(element => element.click())
    await expect(iframe).toHaveCount(0)
    await launcher.click()
    await frame.getByRole("button", {name: "Post a job", exact: true}).click()
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue(
      "Immediate host-dismissal draft",
    )
    await frame.getByRole("button", {name: "Cancel", exact: true}).click()
    await receiveEvents(page, [grant(7, false)])
    await frame.getByRole("button", {name: "Access options", exact: true}).click()
    await expect(page).toHaveURL(/\/access\?section=Freelance&kind=32767$/)
    await expect(page.getByRole("region", {name: "Freelance publishing access"})).toContainText(
      "No application form is currently available for this section.",
    )
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(relay.getPublishedEvents()).toEqual([])
    const requests = await page.evaluate(() => (window as any).__freelanceRequests as string[])
    expect(requests).not.toContain("nostr:sign")
    expect(requests).not.toContain("community:queryEvents")
    expect(requests).toContain("profiles:resolve")
    expect(errors).toEqual([])
  })

  test(`Freelance resolves profiles through the existing host resolver (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(90000)
    if (mobile) await page.setViewportSize({width: 390, height: 844})
    await page.emulateMedia({colorScheme: mobile ? "dark" : "light"})
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    const keys = [26, 27, 28, 29].map(value => new Uint8Array(32).fill(value))
    const [communityAuthor, indexerAuthor, missingAuthor, cachedAuthor] = keys.map(getPublicKey)
    const signed = (
      index: number,
      kind: number,
      tags: string[][],
      content: string,
      created_at = 10,
    ) => finalizeEvent({kind, tags, content, created_at}, keys[index])
    const metadata = (index: number, name: string, picture = iconUrl, created_at = 10) =>
      signed(index, 0, [], JSON.stringify({display_name: name, picture}), created_at)
    const scoped = [
      ["h", communityId],
      ["a", address, relayUrl, "community"],
    ]
    const serviceAddress = `32765:${communityAuthor}:community-service`
    const orderAddress = `32766:${missingAuthor}:order`
    const jobAddress = `32767:${indexerAuthor}:profile-job`
    const bidAddress = `32768:${communityAuthor}:bid`
    const service = (index: number, id: string, title: string, extra: string[][] = []) =>
      signed(
        index,
        32765,
        [
          ["d", id],
          ["title", title],
          ["s", "1"],
          ["amount", "10000"],
          ["pricing", "0"],
          ...scoped,
          ...extra,
        ],
        "Profile rendering fixture",
      )
    const events = [
      service(0, "community-service", "Community profile service", [["a", orderAddress, "10"]]),
      service(1, "indexer-service", "Indexer profile service"),
      service(2, "missing-service", "Missing profile service"),
      service(3, "cached-service", "Cached profile service"),
      signed(
        2,
        32766,
        [
          ["d", "order"],
          ["a", serviceAddress],
          ["s", "1"],
          ["amount", "10000"],
          ["pricing", "0"],
          ...scoped,
        ],
        "Completed order",
      ),
      signed(
        0,
        1986,
        [
          ["L", "qts/freelancing"],
          ["l", "client", "qts/freelancing"],
          ["rating", "1", "thumb"],
          ["rating", "1", "communication"],
          ["a", orderAddress],
          ["engagement", orderAddress],
          ...scoped,
        ],
        "Review from the freelancer",
      ),
      signed(
        2,
        1986,
        [
          ["L", "qts/freelancing"],
          ["l", "freelancer", "qts/freelancing"],
          ["rating", "1", "success"],
          ["rating", "1", "expertise"],
          ["rating", "1", "communication"],
          ["a", serviceAddress],
          ["engagement", orderAddress],
          ...scoped,
        ],
        "Review from the client",
      ),
      signed(
        1,
        32767,
        [
          ["d", "profile-job"],
          ["title", "Profile job"],
          ["s", "2"],
          ["a", bidAddress, "10"],
          ...scoped,
        ],
        "Concluded job",
      ),
      signed(
        0,
        32768,
        [["d", "bid"], ["a", jobAddress], ["amount", "10000"], ["pricing", "0"], ...scoped],
        "Accepted proposal",
      ),
    ]
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
    const indexer = "wss://purplepag.es/"
    const relay = new MockRelay({
      seedEvents: [definition, curators, widget, targeting, ...events],
      seedEventsByRelay: {
        [relayUrl]: [metadata(0, "Community Maker")],
        [indexer]: [metadata(1, "Indexer Maker")],
      },
      responseLatencyByKind: {0: 350},
    })
    await relay.setup(page)
    await context.route(/^https:\/\//, route => {
      const url = new URL(route.request().url())
      if (url.origin + url.pathname === appUrl)
        return route.fulfill({status: 200, contentType: "text/html", body: bundle})
      if (url.origin + url.pathname === iconUrl)
        return route.fulfill({status: 200, contentType: "image/svg+xml", body: icon})
      return route.fulfill({status: 503, body: "External service blocked by fixture"})
    })
    await page.goto(homePath)
    const launcher = page
      .locator('[data-perf="community-home"]')
      .getByRole("button", {name: "Freelance", exact: true})
    await expect(launcher).toBeVisible({timeout: 15000})
    // This profile exists only in Budabit's shared cache, never on a fixture relay.
    await receiveEvents(page, [metadata(3, "Cached Maker")])
    await launcher.click()
    const dialog = page.getByRole("dialog", {name: "Freelance", exact: true})
    const frame = page.frameLocator('iframe[title="Community Freelance · SatShoot"]')
    await frame.getByRole("button", {name: "Services", exact: true}).click()
    const card = (title: string) =>
      frame
        .locator(".listing-card")
        .filter({has: frame.getByRole("heading", {name: title, exact: true})})
    await expect(card("Community profile service")).toContainText("Community Maker", {
      timeout: 10000,
    })
    await expect(card("Indexer profile service")).toContainText("Indexer Maker", {timeout: 10000})
    await expect(card("Cached profile service")).toContainText("Cached Maker")
    const npub = nip19.npubEncode(missingAuthor)
    await expect(card("Missing profile service")).toContainText(
      `${npub.slice(0, 8)}…${npub.slice(-4)}`,
      {timeout: 10000},
    )
    await expect(
      card("Community profile service").locator(".card-footer .identity-avatar"),
    ).toHaveJSProperty("naturalWidth", 38)
    const telemetry = await relay.getTelemetry()
    const profileReads = telemetry.filter(
      entry => entry.type === "req" && entry.filters?.some(filter => filter.kinds?.includes(0)),
    )
    expect(
      profileReads.some(
        entry =>
          entry.relayUrl.replace(/\/$/, "") === relayUrl &&
          entry.filters?.some(filter => filter.authors?.includes(communityAuthor)),
      ),
    ).toBe(true)
    expect(
      profileReads.some(
        entry =>
          entry.relayUrl.replace(/\/$/, "") === indexer.replace(/\/$/, "") &&
          entry.filters?.some(filter => filter.authors?.includes(indexerAuthor)),
      ),
    ).toBe(true)
    expect(
      profileReads.some(entry =>
        entry.filters?.some(filter => filter.authors?.includes(cachedAuthor)),
      ),
    ).toBe(false)
    await card("Community profile service").screenshot({
      path: info.outputPath("freelance-community-profile-card.png"),
    })
    await card("Indexer profile service").screenshot({
      path: info.outputPath("freelance-indexer-profile-card.png"),
    })
    // Identity clicks use the real host modal stack, without activating the card.
    const iframeElement = await page
      .locator('iframe[title="Community Freelance · SatShoot"]')
      .elementHandle()
    const originalUrl = page.url()
    const profileDialog = page.getByRole("dialog", {name: "Profile", exact: true})
    const identity = card("Community profile service").getByRole("button", {
      name: "Open profile for Community Maker",
      exact: true,
    })
    await identity.locator("img").click()
    await expect(profileDialog).toBeVisible()
    await expect(profileDialog).toContainText("Community Maker")
    await expect(dialog).toBeHidden()
    expect(await iframeElement!.evaluate(element => element.isConnected)).toBe(true)
    await profileDialog.screenshot({path: info.outputPath("freelance-host-profile-modal.png")})
    await page.keyboard.press("Escape")
    await expect(dialog).toBeVisible()
    await expect(card("Community profile service")).toBeVisible()
    await expect(frame.locator(".detail")).toHaveCount(0)
    expect(page.url()).toBe(originalUrl)

    // Keyboard activation followed by browser Back removes only the top modal.
    await identity.focus()
    await identity.press("Enter")
    await expect(profileDialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toBeVisible()
    await expect(card("Community profile service")).toBeVisible()

    // The full-profile link opens a separate tab with no opener. The fixture only
    // intercepts that destination; this page still runs the real modal/bridge.
    await identity.locator(".identity-name").click()
    await expect(profileDialog).toBeVisible()
    const fullProfile = profileDialog.getByRole("link", {name: "View full profile", exact: false})
    await expect(fullProfile).toHaveAttribute("target", "_blank")
    const profileHref = await fullProfile.getAttribute("href")
    const destination = new URL(profileHref!, page.url()).href
    await context.route(destination, route =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Full profile destination</h1>",
      }),
    )
    const popupPromise = context.waitForEvent("page")
    await fullProfile.click()
    const popup = await popupPromise
    await expect(popup.getByRole("heading", {name: "Full profile destination"})).toBeVisible()
    expect(popup.url()).toBe(destination)
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    await popup.close()
    await expect(profileDialog).toBeVisible()
    expect(await iframeElement!.evaluate(element => element.isConnected)).toBe(true)
    if (mobile) {
      await page
        .getByRole("button", {name: "Close dialog", exact: true})
        .click({position: {x: 5, y: 5}})
    } else {
      await profileDialog.getByRole("button", {name: "Go back", exact: true}).click()
    }
    await expect(dialog).toBeVisible()
    await expect(card("Community profile service")).toBeVisible()

    // The same mounted draft and its category chips survive profile dismissal.
    await switchAccount(page, owner)
    await frame.getByRole("button", {name: "Offer a service", exact: true}).click()
    await frame.getByLabel("Title", {exact: true}).fill("Keep this draft through profile viewing")
    await frame.getByLabel("Add category", {exact: true}).fill("Keep category")
    await frame.getByLabel("Add category", {exact: true}).press("Enter")
    const draftElement = await frame.getByLabel("Title", {exact: true}).elementHandle()
    await frame.getByLabel("Signing account").getByRole("button").click()
    await expect(profileDialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(frame.getByLabel("Title", {exact: true})).toHaveValue(
      "Keep this draft through profile viewing",
    )
    await expect(frame.getByRole("list", {name: "Selected categories"})).toContainText(
      "keep category",
    )
    expect(await draftElement!.evaluate(element => element.isConnected)).toBe(true)
    expect(await iframeElement!.evaluate(element => element.isConnected)).toBe(true)
    await frame.getByRole("button", {name: "Cancel", exact: true}).click()
    await switchAccount(page, viewer)
    await frame.getByRole("button", {name: "Services", exact: true}).click()

    // A late profile updates the fallback through the shared store watch, without a refresh.
    await frame.getByLabel("Search freelance listings").fill("Late Client")
    await expect(frame.locator(".listing-card")).toHaveCount(0)
    await receiveEvents(page, [metadata(2, "Late Client")])
    await expect(card("Missing profile service")).toContainText("Late Client")
    await expect(frame.locator(".listing-card")).toHaveCount(1)
    await frame.getByLabel("Search freelance listings").fill("")
    await card("Community profile service").click()
    await expect(frame.locator(".detail > .section-heading .account-label")).toContainText(
      "Community Maker",
    )
    await expect(frame.locator(".offer > .section-heading .account-label")).toContainText(
      "Late Client",
    )
    await expect(frame.locator(".engagement-meta")).toContainText("Community Maker")
    await expect(frame.locator(".engagement-meta")).toContainText("Late Client")
    await expect(frame.locator(".reviews")).toContainText("Community Maker")
    await expect(frame.locator(".reviews")).toContainText("Late Client")
    await receiveEvents(page, [
      metadata(0, "Updated Maker", "https://freelance-widget.example/broken.png", 11),
    ])
    await expect(frame.locator(".detail > .section-heading .account-label")).toContainText(
      "Updated Maker",
    )
    await expect(frame.locator(".detail > .section-heading .account-label img")).toHaveCount(0)
    await receiveEvents(page, [metadata(0, "Updated Maker", iconUrl, 12)])
    await expect(frame.locator(".detail > .section-heading .account-label img")).toHaveJSProperty(
      "naturalWidth",
      38,
    )
    await frame.locator(".offer").scrollIntoViewIfNeeded()
    await dialog.screenshot({path: info.outputPath("freelance-profile-detail.png")})
    await frame.getByRole("button", {name: "Jobs", exact: true}).click()
    await frame.getByLabel("Filter by status").selectOption("all")
    await card("Profile job").click()
    await expect(frame.locator(".detail > .section-heading .account-label")).toContainText(
      "Indexer Maker",
    )
    await expect(frame.locator(".offer > .section-heading .account-label")).toContainText(
      "Updated Maker",
    )
    const widgetFrame = page.frames().find(item => item.url().startsWith(appUrl))!
    const widgetReads = await widgetFrame.evaluate(
      () =>
        (window as any).__mockRelayTelemetry as {
          type: string
          relayUrl: string
          filters?: {kinds?: number[]}[]
        }[],
    )
    expect(
      widgetReads
        .filter(entry => entry.type === "req")
        .every(
          entry =>
            entry.relayUrl.replace(/\/$/, "") === relayUrl &&
            !entry.filters?.some(filter => filter.kinds?.includes(0)),
        ),
    ).toBe(true)
    await expect
      .poll(() =>
        frame.locator("html").evaluate(element => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)
    // Community listing alerts remain separate from personal workflow attention.
    // Both update on the existing subscription and receipts survive remount.
    await expect(frame.getByRole("button", {name: "My work", exact: true})).not.toHaveClass(
      /attention/,
    )
    await switchAccount(page, communityAuthor)
    await expect(
      frame.getByRole("button", {name: "Notifications, 6 unread", exact: true}),
    ).toHaveClass(/attention/)
    await expect(frame.getByRole("button", {name: "Jobs, 1 unread", exact: true})).toHaveClass(
      /attention/,
    )
    await expect(frame.getByRole("button", {name: "Services, 5 unread", exact: true})).toHaveClass(
      /attention/,
    )
    await expect(frame.getByRole("button", {name: "My work, 3 unread", exact: true})).toHaveClass(
      /attention/,
    )
    await frame.getByRole("button", {name: "Notifications, 6 unread", exact: true}).click()
    await expect(frame.locator(".notification-item")).toHaveCount(6)
    const liveOrder = signed(
      3,
      32766,
      [
        ["d", "new-notification-order"],
        ["published_at", "20"],
        ["a", serviceAddress],
        ["s", "0"],
        ["amount", "10000"],
        ["pricing", "0"],
        ...scoped,
      ],
      "New order for your service",
      20,
    )
    await relay.injectEvents([liveOrder], widgetFrame)
    await expect(
      frame.getByRole("button", {name: "Notifications, 7 unread", exact: true}),
    ).toHaveClass(/attention/)
    await expect(frame.locator(".notification-item").first()).toContainText("New order")
    await expect(frame.getByRole("button", {name: "My work, 4 unread", exact: true})).toHaveClass(
      /attention/,
    )
    await frame
      .getByRole("button", {name: "Mark read: New order · Community profile service", exact: true})
      .click()
    await expect(
      frame.getByRole("button", {name: "Notifications, 6 unread", exact: true}),
    ).toBeVisible()
    await dialog.screenshot({path: info.outputPath("freelance-notifications.png")})
    await frame.getByRole("button", {name: "Mark all read", exact: true}).click()
    await expect(frame.getByRole("button", {name: "Notifications", exact: true})).not.toHaveClass(
      /attention/,
    )
    await expect(frame.locator(".notification-item.unread")).toHaveCount(0)
    await dialog.getByRole("button", {name: "Close widget", exact: true}).click()
    await expect(page.locator('iframe[title="Community Freelance · SatShoot"]')).toHaveCount(0)
    await launcher.click()
    await frame.getByRole("button", {name: "Notifications", exact: true}).click()
    await expect(frame.locator(".notification-item")).toHaveCount(6)
    await expect(frame.locator(".notification-item.unread")).toHaveCount(0)
    await expect(frame.getByRole("button", {name: "Mark all read", exact: true})).toBeDisabled()
    await switchAccount(page, missingAuthor)
    await expect(
      frame.getByRole("button", {name: "Notifications, 3 unread", exact: true}),
    ).toBeVisible()
    await frame.getByRole("button", {name: "Notifications, 3 unread", exact: true}).click()
    await expect(frame.locator(".notification-item")).toHaveCount(3)
    await frame
      .locator(".notification-item")
      .filter({hasText: "New review from your counterparty"})
      .locator(".notification-open")
      .click()
    await expect(frame.locator(".detail h2")).toHaveText("Community profile service")
    await expect(frame.getByRole("button", {name: "My work", exact: true})).not.toHaveClass(
      /attention/,
    )
    await switchAccount(page, "")
    await frame.getByRole("button", {name: "Notifications", exact: true}).click()
    await expect(
      frame.getByRole("heading", {name: "Sign in to see your notifications", exact: true}),
    ).toBeVisible()
    await expect
      .poll(() =>
        frame.locator("html").evaluate(element => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)
    await dialog.getByRole("button", {name: "Close widget", exact: true}).click()
    // Ordinary host profile modals keep their existing same-tab navigation.
    await page.evaluate(async pubkey => {
      const moduleUrl = "/tests/e2e/fixtures/profile-identity-browser.ts"
      const fixture = await import(/* @vite-ignore */ moduleUrl)
      fixture.openFixtureProfileModal(pubkey)
    }, communityAuthor)
    await expect(page.getByRole("link", {name: "View full profile", exact: true})).toHaveAttribute(
      "target",
      "",
    )
    await page
      .getByRole("button", {name: "Close dialog", exact: true})
      .click({position: {x: 5, y: 5}})
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })
}
