import {test, expect} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"
import {
  buildCommunityDefinition,
  parseCommunityDefinition,
} from "../../src/app/core/community-protocol"

const appOrigin = new URL(process.env.PRIVATE_TEST_BASE_URL || "http://localhost:1847").origin

const key = new Uint8Array(32).fill(27)
const pubkey = getPublicKey(key)
const community = "d".repeat(64)
const relay = "wss://private-browser.test/"
const naddr = nip19.naddrEncode({pubkey, kind: 32222, identifier: community, relays: [relay]})
const invite = `/c/${naddr}?read-access=members`
const definition = finalizeEvent(
  {
    ...buildCommunityDefinition({
      communityId: community,
      name: "Member relay fixture",
      readAccess: "members",
      relays: [relay],
      sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
    }),
    created_at: Math.floor(Date.now() / 1000),
  },
  key,
)

test("invitation authenticates a pooled connection; normal routes and persistent cache stay available", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  expect(parseCommunityDefinition(definition)).toBeDefined()
  const errors: string[] = []
  const signed: number[] = []
  // Reused Vite stacks may serve timestamped module URLs after HMR. Import the
  // application's actual instance rather than create a second unversioned store.
  const moduleUrls = new Map<string, string>()
  page.on("response", response => {
    const url = new URL(response.url())
    if (url.pathname.startsWith("/src/app/core/")) moduleUrls.set(url.pathname, response.url())
  })
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
  await expect(page.locator("strong").filter({hasText: /^Community Admin$/})).toBeVisible()
  // Revoke an already-live connection with cached authority. The former 5.5s
  // component timer must not recreate that read after a terminal membership denial.
  expect(errors).toEqual([])
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({pubkey, community, relay, moduleUrl}) => {
            const {communityLiveOwnership, isCommunityLiveOwned} = await import(
              /* @vite-ignore */ moduleUrl
            )
            let owned = false
            communityLiveOwnership.subscribe(value => {
              owned = isCommunityLiveOwned(value, `32222:${pubkey}:${community}`, relay)
            })()
            return owned
          },
          {pubkey, community, relay, moduleUrl: moduleUrls.get("/src/app/core/community-live.ts")!},
        ),
      {timeout: 10000},
    )
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(
        ({relay, community}) => {
          const sockets = [...(window as any).__mockRelayConnections.values()] as any[]
          return sockets.some(
            socket =>
              socket.url === relay &&
              [...socket.subscriptions.values()].some((filters: any) =>
                filters.some(
                  (filter: any) =>
                    filter.limit === 0 &&
                    filter.kinds?.includes(32222) &&
                    filter["#d"]?.includes(community),
                ),
              ),
          )
        },
        {relay, community},
      ),
    )
    .toBe(true)
  granted = false
  await page.evaluate(relay => {
    for (const socket of (window as any).__mockRelayConnections.values()) {
      if (socket.url !== relay) continue
      for (const sub of [...socket.subscriptions.keys()])
        socket.sendMessage(["CLOSED", sub, "restricted: revoked"])
      socket.close()
    }
  }, relay)
  await expect
    .poll(() =>
      page.evaluate(
        async ({pubkey, community, relay, moduleUrl}) => {
          const {communityReadRecovery} = await import(/* @vite-ignore */ moduleUrl)
          return communityReadRecovery(`32222:${pubkey}:${community}`, pubkey).blocked(relay)
        },
        {
          pubkey,
          community,
          relay,
          moduleUrl: moduleUrls.get("/src/app/core/community-read-recovery.ts")!,
        },
      ),
    )
    .toBe(true)
  const liveRequests = async () =>
    (await mock.getTelemetry()).filter(
      entry =>
        entry.type === "req" &&
        entry.relayUrl === relay &&
        entry.filters?.some(
          filter =>
            filter.limit === 0 &&
            filter.kinds?.includes(32222) &&
            filter["#d"]?.includes(community),
        ) &&
        // The community-core reader includes targeting events. Background
        // notification authority reads also include the definition but are an
        // independent reader on the shared connection.
        entry.filters?.some(
          filter =>
            filter.limit === 0 &&
            filter.kinds?.includes(30222) &&
            filter["#h"]?.includes(community),
        ),
    ).length
  const requestsAfterRevocation = await liveRequests()
  expect(requestsAfterRevocation).toBeGreaterThan(0)
  // A silence assertion needs an observation window spanning multiple old retries.
  // This is a shared socket: unrelated application queries may still use it.
  await page.waitForTimeout(12_000)
  expect(await liveRequests()).toBe(requestsAfterRevocation)
  await expect(page.locator("strong").filter({hasText: /^Community Admin$/})).toBeVisible()
  await page.evaluate(relay => {
    for (const socket of (window as any).__mockRelayConnections.values())
      if (socket.url === relay) socket.close()
  }, relay)
  const signCountBeforeRetry = signed.length
  granted = true
  await access.getByRole("button", {name: "Authenticate and retry", exact: true}).click()
  await expect.poll(() => signed.length).toBe(signCountBeforeRetry + 1)
  await expect
    .poll(() =>
      page.evaluate(
        async ({pubkey, community, relay, moduleUrl}) => {
          const {communityReadRecovery} = await import(/* @vite-ignore */ moduleUrl)
          return communityReadRecovery(`32222:${pubkey}:${community}`, pubkey).blocked(relay)
        },
        {
          pubkey,
          community,
          relay,
          moduleUrl: moduleUrls.get("/src/app/core/community-read-recovery.ts")!,
        },
      ),
    )
    .toBe(false)
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
