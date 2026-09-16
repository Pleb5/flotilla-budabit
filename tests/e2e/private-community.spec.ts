import {test, expect} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const appOrigin = new URL(process.env.PRIVATE_TEST_BASE_URL || "http://localhost:1847").origin

const key = new Uint8Array(32).fill(27)
const pubkey = getPublicKey(key)
const community = "d".repeat(64)
const relay = "wss://private-browser.test/"
const naddr = nip19.naddrEncode({pubkey, kind: 32222, identifier: community, relays: [relay]})
const invite = `/c/${naddr}?read-access=members`
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["d", community],
      ["name", "Member relay fixture"],
      ["r", relay],
      ["read-access", "members"],
      ["content", "General"],
      ["k", "1"],
    ],
  },
  key,
)

test("invitation authenticates a pooled connection; normal routes and persistent cache stay available", async ({
  page,
}, info) => {
  const errors: string[] = []
  const signed: number[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", route =>
    new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort(),
  )
  // No Budabit capability extension is required by the client anymore.
  await page.route("https://private-browser.test/**", route =>
    route.fulfill({
      json: {supported_nips: [1, 42], limitation: {auth_required: true, max_limit: 200}},
    }),
  )
  let granted = false
  const mock = new MockRelay({
    authRequiredRelays: [relay],
    seedEventsByRelay: {[relay]: [definition]},
    getSubscriptionOutcome: (_filters, url) => (url === relay && !granted ? "denied" : "eose"),
  })
  await mock.setup(page)
  await page.exposeFunction("__invitationSign", (event: Parameters<typeof finalizeEvent>[0]) => {
    if (event.kind !== 22242 || !event.tags.some(tag => tag[0] === "relay" && tag[1] === relay))
      throw Error("Fixture signer only permits AUTH to the controlled relay")
    signed.push(event.kind)
    return finalizeEvent(event, key)
  })
  await page.addInitScript(
    ({pubkey}) => {
      Object.defineProperty(window, "nostr", {
        configurable: true,
        value: {
          getPublicKey: async () => pubkey,
          signEvent: (event: unknown) => (window as any).__invitationSign(event),
        },
      })
    },
    {pubkey},
  )
  await page.goto(invite)
  const access = page.getByTestId("community-relay-access")
  await expect(access.getByRole("button", {name: "Sign in", exact: true})).toBeVisible()
  expect(signed).toEqual([])
  await access.getByRole("button", {name: "Sign in", exact: true}).click()
  await page.getByRole("button", {name: "Log in with Extension", exact: true}).click()
  await access.getByRole("button", {name: "Authenticate and retry", exact: true}).click()
  await expect(access).toContainText("Access denied")
  expect(signed).toEqual([22242])
  granted = true
  // The mock models the real relay's post-denial disconnect.
  await page.evaluate(relay => {
    for (const socket of (window as any).__mockRelayConnections.values())
      if (socket.url === relay) socket.close()
  }, relay)
  await access.getByRole("button", {name: "Authenticate and retry", exact: true}).click()
  await expect(access).toContainText("Connected")
  await expect
    .poll(() =>
      page.evaluate(async id => {
        const app = await import(/* @vite-ignore */ "/packages/welshman/packages/app/src/index.ts")
        return Boolean(app.repository.getEvent(id))
      }, definition.id),
    )
    .toBe(true)
  expect(signed).toEqual([22242, 22242])
  await expect
    .poll(
      () =>
        page.evaluate(async id => {
          const databases = await indexedDB.databases()
          for (const {name} of databases) {
            if (!name) continue
            const found = await new Promise<boolean>((resolve, reject) => {
              const request = indexedDB.open(name)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                const db = request.result
                if (!db.objectStoreNames.contains("events")) {
                  db.close()
                  resolve(false)
                  return
                }
                const transaction = db.transaction("events")
                const result = transaction.objectStore("events").get(id)
                result.onsuccess = () => {
                  resolve(Boolean(result.result))
                  db.close()
                }
                result.onerror = () => {
                  reject(result.error)
                  db.close()
                }
              }
            })
            if (found) return true
          }
          return false
        }, definition.id),
      {timeout: 20000},
    )
    .toBe(true)
  // Normal child routes mount; no restricted private archive/shell remains.
  await page.getByRole("link", {name: "Admin", exact: true}).click()
  await expect(page.getByText("Community Admin", {exact: true})).toBeVisible()
  await expect(page.getByTestId("private-community-access")).toHaveCount(0)
  await expect(
    page.getByText("Previously received data remains cached on this device.", {exact: false}),
  ).toBeVisible()
  await page.reload()
  await expect
    .poll(() =>
      page.evaluate(async id => {
        const app = await import(/* @vite-ignore */ "/packages/welshman/packages/app/src/index.ts")
        return Boolean(app.repository.getEvent(id))
      }, definition.id),
    )
    .toBe(true)
  await page.evaluate(async () => {
    const app = await import(/* @vite-ignore */ "/packages/welshman/packages/app/src/index.ts")
    app.pubkey.set(undefined)
  })
  await expect
    .poll(() =>
      page.evaluate(async id => {
        const app = await import(/* @vite-ignore */ "/packages/welshman/packages/app/src/index.ts")
        return Boolean(app.repository.getEvent(id))
      }, definition.id),
    )
    .toBe(true)
  await access.screenshot({path: info.outputPath("cached-after-logout.png")})
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: 800})
    await expect
      .poll(() =>
        page.evaluate(() => {
          const panel = document
            .querySelector('[data-testid="community-relay-access"]')!
            .getBoundingClientRect()
          const bar = document.querySelector('[data-component="PageBar"]')!.getBoundingClientRect()
          return panel.right <= window.innerWidth && panel.bottom <= bar.top
        }),
      )
      .toBe(true)
    await page.screenshot({path: info.outputPath(`cached-${width}.png`)})
  }
  expect(errors).toEqual([])
})

test("malformed invitation is rejected before mounting loaders", async ({page}) => {
  await page.route("**/*", route =>
    new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort(),
  )
  const mock = new MockRelay()
  await mock.setup(page)
  await page.goto("/c/not-an-address?read-access=members")
  await expect(page.getByRole("alert")).toContainText("Invalid private invitation")
})
