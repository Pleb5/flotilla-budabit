import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerSecret = Buffer.from(DEV_SECRET, "hex")
const authorSecret = new Uint8Array(32).fill(13)
const author = getPublicKey(authorSecret)
const communityId = getPublicKey(new Uint8Array(32).fill(14))
const relayUrl = "wss://root-notifications.example"
const originalRelay = "wss://root-originals.example/"
const createdAt = Math.floor(Date.now() / 1000) - 100
const communityAddress = `32222:${DEV_PUBKEY}:${communityId}`
const listIdentifier = `${communityId}-writers`
const listAddress = `30000:${DEV_PUBKEY}:${listIdentifier}`
const communityPath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: DEV_PUBKEY, identifier: communityId, relays: [relayUrl]})}`
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Root Notifications Community"],
      ["r", relayUrl],
      ["content", "Thread-creator"],
      ["k", "11", "threads"],
      ["a", listAddress, relayUrl],
      ["content", "Calendar-event-creator"],
      ["k", "31922"],
      ["k", "31923"],
      ["a", listAddress, relayUrl],
      ["content", "Fundraiser-goals-creator"],
      ["k", "9041"],
      ["a", listAddress, relayUrl],
      ["content", "General"],
      ["k", "1111"],
      ["k", "7"],
      ["k", "1984"],
      ["k", "1985"],
      ["a", listAddress, relayUrl],
    ],
  },
  ownerSecret,
)
const profileList = finalizeEvent(
  {
    kind: 30000,
    created_at: createdAt,
    content: "",
    tags: [
      ["d", listIdentifier],
      ["p", DEV_PUBKEY],
      ["p", author],
    ],
  },
  ownerSecret,
)
const thread = (title: string, timestamp: number, secret = authorSecret) =>
  finalizeEvent(
    {
      kind: 11,
      created_at: timestamp,
      content: `${title} content`,
      tags: [
        ["h", communityId],
        ["title", title],
      ],
    },
    secret,
  )
const bell = (page: Page) => page.getByRole("button", {name: "Notifications", exact: true})
const indicator = (page: Page) => bell(page).locator("[data-notification-indicator]")
const sectionIndicator = (page: Page, section: string) =>
  page.locator(`a.btn[href$="/${section}"] [data-notification-indicator]`)
const dialog = (page: Page) => page.getByRole("dialog", {name: "Notifications", exact: true})
const pageErrors = new WeakMap<Page, string[]>()

const browserFixture = "/tests/e2e/fixtures/root-notifications-browser.ts"
const observeBell = (page: Page) =>
  page.evaluate(async path => (await import(/* @vite-ignore */ path)).observeBell(), browserFixture)
const waitForUnreadTracking = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(async path => {
          const {snapshot} = await import(/* @vite-ignore */ path)
          const state = snapshot()
          return state.enabled && state.hints[state.account] !== undefined
        }, browserFixture),
      {timeout: 15_000},
    )
    .toBe(true)

const waitForLiveThreads = (page: Page) =>
  page.waitForFunction(id => {
    const connections = (window as any).__mockRelayConnections as Map<
      string,
      {subscriptions: Map<string, Array<{kinds?: number[]; "#h"?: string[]; limit?: number}>>}
    >
    return Array.from(connections.values()).some(connection =>
      Array.from(connection.subscriptions.values()).some(filters =>
        filters.some(
          filter => filter.limit === 0 && filter.kinds?.includes(11) && filter["#h"]?.includes(id),
        ),
      ),
    )
  }, communityId)

for (const {route, interruption} of [
  {route: "home", interruption: "none"},
  {route: "home", interruption: "closed"},
  {route: "home", interruption: "disconnect"},
  {route: "people", interruption: "closed"},
  {route: "people", interruption: "disconnect"},
]) {
  test(`successive closed-center threads notify on ${route} with ${interruption}`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const report = finalizeEvent(
      {
        kind: 1984,
        created_at: createdAt,
        content: "Unrelated reported thread",
        tags: [
          ["h", communityId],
          ["a", communityAddress],
          ["e", "f".repeat(64), "spam"],
          ["p", author],
          ["content", "Thread-creator"],
        ],
      },
      ownerSecret,
    )
    let reviewRequests = 0
    let rejectedRequests = 0
    const relay = new MockRelay({
      respectLimits: true,
      seedEvents: [definition, profileList, report],
      getSubscriptionOutcome: filters => {
        if (filters.some(filter => filter.kinds?.includes(1985))) reviewRequests += 1
        // The production relay rejects filters with more than three indexed tag keys.
        if (
          filters.some(filter => Object.keys(filter).filter(key => key.startsWith("#")).length > 3)
        ) {
          rejectedRequests += 1
          return "denied"
        }
        return "eose"
      },
    })
    await relay.setup(page)
    await page.goto(communityPath)
    if (route === "people") {
      await page.getByRole("link", {name: "Search", exact: true}).click()
      await expect(page).toHaveURL("/people")
    }
    await waitForUnreadTracking(page)
    await expect.poll(() => reviewRequests).toBeGreaterThan(0)
    expect(rejectedRequests).toBe(0)
    await waitForLiveThreads(page)
    const first = thread("First consecutive arrival", Math.floor(Date.now() / 1000))
    await relay.retainEvents([first])
    await relay.injectEvents([first])
    await expect(indicator(page)).toBeVisible({timeout: 15_000})
    await bell(page).click()
    await expect(dialog(page).getByText("First consecutive arrival", {exact: true})).toBeVisible()
    await dialog(page).getByRole("button", {name: "Close notifications"}).click()
    await expect(indicator(page)).toHaveCount(0)
    await waitForLiveThreads(page)
    if (interruption !== "none") {
      // Relays can terminate a subscription while leaving the socket connected.
      await page.evaluate(
        ({id, interruption}) => {
          for (const connection of (window as any).__mockRelayConnections.values()) {
            if (interruption === "disconnect") {
              if (connection.url.startsWith("wss://root-notifications.example"))
                connection.close(1006, "offline")
              continue
            }
            for (const [subId, filters] of connection.subscriptions) {
              if (
                !filters.some(
                  (filter: any) =>
                    filter.limit === 0 && filter.kinds?.includes(11) && filter["#h"]?.includes(id),
                )
              )
                continue
              connection.subscriptions.delete(subId)
              connection.sendMessage(["CLOSED", subId, "error: temporary relay restart"])
            }
          }
        },
        {id: communityId, interruption},
      )
    }
    const second = thread("Second consecutive arrival", Math.floor(Date.now() / 1000))
    await relay.retainEvents([second])
    if (interruption === "none") await relay.injectEvents([second])
    await expect(indicator(page)).toBeVisible({timeout: 15_000})
    await bell(page).click()
    await expect(dialog(page).getByText("Second consecutive arrival", {exact: true})).toBeVisible()
    await dialog(page).getByRole("button", {name: "Close notifications"}).click()
    await expect(indicator(page)).toHaveCount(0)
    await waitForLiveThreads(page)
    const third = thread("Third consecutive arrival", Math.floor(Date.now() / 1000))
    await relay.retainEvents([third])
    await relay.injectEvents([third])
    await expect(indicator(page)).toBeVisible({timeout: 15_000})
    await bell(page).click()
    await expect(dialog(page).getByText("Third consecutive arrival", {exact: true})).toBeVisible()
    expect(rejectedRequests).toBe(0)
  })
}

test.afterEach(async ({page}, info) => {
  if (info.status !== info.expectedStatus && page.url() !== "about:blank") {
    const state = await page.evaluate(async path => {
      const {snapshot, bellChanges} = await import(/* @vite-ignore */ path)
      return {...snapshot(), bellChanges}
    }, browserFixture)
    await info.attach("notification-state", {
      body: JSON.stringify(state, null, 2),
      contentType: "application/json",
    })
  }
  expect(pageErrors.get(page) || []).toEqual([])
})

test.beforeEach(async ({page}) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => {
    if (
      ["error", "warning"].includes(message.type()) &&
      /notifications|notification-sources/.test(message.text())
    )
      errors.push(message.text())
  })
  await seedDevSession(page)
  await page.addInitScript(
    ({key, timestamp}) => {
      if (!localStorage.getItem("communityNotificationBaselines")) {
        localStorage.setItem(
          "communityNotificationBaselines",
          JSON.stringify({version: 2, byCommunityAddress: {[key]: timestamp}}),
        )
      }
    },
    {key: `${DEV_PUBKEY}:${communityAddress}`, timestamp: createdAt},
  )
})

test("incoming threads notify before opening the center and reading one preserves its unread sibling", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  const first = thread("First unread thread", createdAt + 10)
  const second = thread("Second unread thread", createdAt + 20)
  const own = thread("My own newest thread", createdAt + 30, ownerSecret)
  const relay = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, profileList, first, second, own],
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 20_000})
  await expect(indicator(page)).toBeVisible()
  await page.goto(`${communityPath}/threads/${second.id}`)
  await expect(page.getByRole("heading", {name: "Second unread thread", exact: true})).toBeVisible()
  await page.getByRole("button", {name: "Root Notifications Community", exact: true}).click()
  await expect(page).toHaveURL(communityPath)
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 15_000})
  await expect(indicator(page)).toBeVisible()
  await bell(page).click()
  await expect(dialog(page).getByText("started a thread", {exact: true})).toHaveCount(2)
  await expect(dialog(page).getByText("My own newest thread", {exact: true})).toHaveCount(0)
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toBeVisible()
  await page.screenshot({
    path: info.outputPath("root-thread-notifications.png"),
    animations: "disabled",
  })
  await dialog(page).getByRole("button", {name: "Close notifications"}).click()
  await expect(sectionIndicator(page, "threads")).toHaveCount(0)
  await expect(indicator(page)).toHaveCount(0)
  await page.reload()
  await bell(page).click()
  await expect(dialog(page).getByText("started a thread", {exact: true})).toHaveCount(2, {
    timeout: 15_000,
  })
  await expect(dialog(page).getByRole("heading", {name: "New", exact: true})).toHaveCount(0)
  await dialog(page).getByRole("button", {name: "Close notifications"}).click()
  const later = thread("Live incoming thread", Math.floor(Date.now() / 1000))
  await relay.injectEvents([later])
  await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 15_000})
  await expect(indicator(page)).toBeVisible()
})

test("calendar and goal wrappers resolve delayed originals and notify with direct item links", async ({
  page,
}, info) => {
  const roots = [31922, 31923, 9041].map((kind, index) =>
    finalizeEvent(
      {
        kind,
        created_at: createdAt + 10 + index,
        content: kind === 9041 ? "New fundraiser" : "Root notification fixture",
        tags: [
          ["d", `root-${kind}`],
          ["title", kind === 9041 ? "New fundraiser" : `New calendar ${kind}`],
          ["start", kind === 31922 ? "2099-01-01" : "4070908800"],
          ["amount", "100000"],
        ],
      },
      authorSecret,
    ),
  )
  const wrappers = roots.map(root =>
    finalizeEvent(
      {
        kind: 30222,
        created_at: root.created_at + 1,
        content: "",
        tags: [
          ["d", `target-${root.kind}`],
          ["e", root.id, originalRelay.replace(/\/$/, ""), author],
          ["k", String(root.kind)],
          ["h", communityId],
          ["a", communityAddress, relayUrl],
        ],
      },
      authorSecret,
    ),
  )
  const relay = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, profileList, ...wrappers],
    seedEventsByRelay: {[originalRelay]: roots},
    responseLatencyByKind: {31922: 400, 31923: 400, 9041: 400},
  })
  await relay.setup(page)
  await page.goto(communityPath)
  await expect(sectionIndicator(page, "calendar")).toBeVisible({timeout: 20_000})
  await expect(sectionIndicator(page, "goals")).toBeVisible()
  await expect(indicator(page)).toBeVisible()
  await bell(page).click()
  await expect(dialog(page).getByText("created a calendar event", {exact: true})).toHaveCount(2)
  await expect(dialog(page).getByText("created a goal", {exact: true})).toHaveCount(1)
  await page.setViewportSize({width: 390, height: 844})
  await page.screenshot({
    path: info.outputPath("root-calendar-goal-notifications-mobile.png"),
    animations: "disabled",
  })
  await dialog(page).getByRole("button").filter({hasText: "created a goal"}).first().click()
  await expect(page).toHaveURL(new RegExp(`/goals/${roots[2].id}`))
  await expect(page.getByText("New fundraiser", {exact: true}).first()).toBeVisible()
})

test("live thread arrivals update the unopened center while ignoring a successful own publication", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  const relay = new MockRelay({respectLimits: true, seedEvents: [definition, profileList]})
  await relay.setup(page)
  await page.goto(`${communityPath}/threads/create`)
  await page.locator("form input[type=text]").fill("My newly published thread")
  await page.locator("form textarea").fill("Testing notification eligibility")
  await expect(page.getByRole("button", {name: "Create thread", exact: true})).toBeEnabled()
  await waitForUnreadTracking(page)
  await expect(indicator(page)).toHaveCount(0)
  await observeBell(page)
  await page.getByRole("button", {name: "Create thread", exact: true}).click()
  await expect(page).toHaveURL(`${communityPath}/threads`)
  await expect(page.getByText("My newly published thread", {exact: true})).toBeVisible()
  const published = await relay.waitForEvent(11)
  await expect
    .poll(() =>
      page.evaluate(
        async ({module, eventId}) =>
          (await import(/* @vite-ignore */ module)).publicationConfirmed(eventId),
        {module: browserFixture, eventId: published.id},
      ),
    )
    .toBe(true)
  await page.getByRole("button", {name: "Root Notifications Community", exact: true}).click()
  await expect(page).toHaveURL(communityPath)
  await waitForLiveThreads(page)
  const checkedAt = await page.evaluate(
    async ({module, path}) => (await import(/* @vite-ignore */ module)).getCheckedAt(path),
    {module: browserFixture, path: `${communityPath}/threads`},
  )
  const incoming = thread("Incoming with center never opened", checkedAt)
  const changes = await page.evaluate(
    async path => (await import(/* @vite-ignore */ path)).bellChanges,
    browserFixture,
  )
  await info.attach("bell-transitions", {
    body: JSON.stringify(changes, null, 2),
    contentType: "application/json",
  })
  expect(changes.map((change: {visible: boolean}) => change.visible)).not.toContain(true)
  await relay.injectEvents([incoming])
  await expect(indicator(page)).toBeVisible({timeout: 15_000})
  await expect(sectionIndicator(page, "threads")).toBeVisible()
  await bell(page).click()
  await expect(dialog(page).getByText(incoming.tags[1][1], {exact: true})).toBeVisible()
  await expect(dialog(page).getByText("My newly published thread", {exact: true})).toHaveCount(0)
})

test("unopened notification tracking cannot be starved by continuous input", async ({page}) => {
  const relay = new MockRelay({respectLimits: true, seedEvents: [definition, profileList]})
  await relay.setup(page)
  await page.addInitScript(() => {
    // Exercise active typing while the deferred background stages are starting.
    const timer = window.setInterval(
      () => window.dispatchEvent(new KeyboardEvent("keydown", {key: "Shift"})),
      100,
    )
    Object.assign(window, {rootNotificationInputTimer: timer})
  })
  await page.goto(communityPath)
  await expect(
    page.getByRole("button", {name: "Root Notifications Community", exact: true}),
  ).toBeVisible()
  await waitForLiveThreads(page)
  const incoming = thread("Incoming during input", Math.floor(Date.now() / 1000))
  await relay.injectEvents([incoming])
  await expect(indicator(page)).toBeVisible({timeout: 12_000})
  await page.evaluate(() => clearInterval((window as any).rootNotificationInputTimer))
  await expect(sectionIndicator(page, "threads")).toBeVisible()
})

for (const outcome of ["denied", "stall"] as const) {
  test(`root notifications recover after a ${outcome} authority load without reopening the center`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    let recover = false
    let failures = 0
    const incoming = thread("Thread after authority recovery", createdAt + 10)
    const relay = new MockRelay({
      respectLimits: true,
      seedEvents: [definition, profileList, incoming],
      getSubscriptionOutcome: filters => {
        if (
          !recover &&
          filters.some(filter => filter.kinds?.includes(1984) && filter.limit !== 0)
        ) {
          failures += 1
          return outcome
        }
        return "eose"
      },
    })
    await relay.setup(page)
    await page.goto(communityPath)
    await waitForUnreadTracking(page)
    await expect.poll(() => failures).toBeGreaterThan(0)
    await expect(sectionIndicator(page, "threads")).toHaveCount(0)
    recover = true
    await expect(sectionIndicator(page, "threads")).toBeVisible({timeout: 20_000})
    await expect(indicator(page)).toBeVisible()
    await bell(page).click()
    await expect(
      dialog(page).getByText("Thread after authority recovery", {exact: true}),
    ).toBeVisible()
  })
}

test("a receiving member gets live root badges on another page before ever opening the center", async ({
  context,
}) => {
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.addInitScript(
    ({pubkey, secret, address, profileId, baseline}) => {
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", pubkey, secret}}),
      )
      localStorage.setItem(
        "communityNotificationBaselines",
        JSON.stringify({version: 2, byCommunityAddress: {[`${pubkey}:${address}`]: baseline}}),
      )
      localStorage.setItem(
        "notificationCenter.readState",
        JSON.stringify({
          version: 3,
          readRowIdsByPubkey: {[pubkey]: [`community-membership:${address}:${profileId}`]},
        }),
      )
    },
    {
      pubkey: author,
      secret: Buffer.from(authorSecret).toString("hex"),
      address: communityAddress,
      profileId: profileList.id,
      baseline: createdAt,
    },
  )
  const roots = [31923, 9041].map(kind =>
    finalizeEvent(
      {
        kind,
        created_at: createdAt + 20,
        content: "Background root",
        tags: [
          ["d", `background-${kind}`],
          ["title", `Background ${kind}`],
          ["start", "4070908800"],
          ["amount", "100000"],
        ],
      },
      ownerSecret,
    ),
  )
  const wrappers = roots.map(root =>
    finalizeEvent(
      {
        kind: 30222,
        created_at: createdAt + 30,
        content: "",
        tags: [
          ["d", `background-${root.kind}`],
          ["k", String(root.kind)],
          ["e", root.id, originalRelay.replace(/\/$/, ""), DEV_PUBKEY],
          ["h", communityId],
          ["a", communityAddress, relayUrl],
        ],
      },
      ownerSecret,
    ),
  )
  const relay = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, profileList],
    seedEventsByRelay: {[originalRelay]: roots},
  })
  await relay.setup(page)
  try {
    await page.goto(communityPath)
    await waitForUnreadTracking(page)
    await expect(indicator(page)).toHaveCount(0)
    await page.getByRole("link", {name: "Search", exact: true}).click()
    await expect(page).toHaveURL("/people")
    await waitForLiveThreads(page)
    const incoming = thread("Thread for another user", createdAt + 30, ownerSecret)
    await relay.injectEvents([incoming, ...wrappers])
    await expect(indicator(page)).toBeVisible({timeout: 15_000})
    await expect
      .poll(() =>
        page.evaluate(
          async path => (await import(/* @vite-ignore */ path)).snapshot().candidates.length,
          browserFixture,
        ),
      )
      .toBe(3)
    await bell(page).click()
    await expect(dialog(page).getByText("started a thread", {exact: true})).toBeVisible()
    await expect(dialog(page).getByText("created a calendar event", {exact: true})).toBeVisible()
    await expect(dialog(page).getByText("created a goal", {exact: true})).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
})
