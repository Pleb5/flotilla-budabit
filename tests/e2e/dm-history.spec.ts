import {expect, test, type Page} from "@playwright/test"
import {writeFile} from "node:fs/promises"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay, type MockRelayOptions} from "./helpers/mock-relay"

const selfKey = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
const partnerKey = new Uint8Array(32).fill(25)
const partner = getPublicKey(partnerKey)
const relayUrl = "wss://dm-history.example/"
const timestamp = Math.floor(Date.now() / 1000) - 86400 * 90
const sign = (
  key: Uint8Array,
  kind: number,
  tags: string[][],
  content = "",
  created_at = timestamp,
) => finalizeEvent({kind, tags, content, created_at}, key)
const metadata = [
  sign(selfKey, 10050, [["relay", relayUrl]]),
  sign(partnerKey, 10050, [["relay", relayUrl]]),
  sign(partnerKey, 0, [], JSON.stringify({name: "History Partner"})),
]
const encrypted = nip44.v2.encrypt(
  "An outgoing-only historical message",
  nip44.v2.utils.getConversationKey(selfKey, partner),
)
const ciphertextByRecipient = new Map([[partner, encrypted]])
const dm = (index: number, recipient = partner) => {
  let content = ciphertextByRecipient.get(recipient)
  if (!content) {
    content = nip44.v2.encrypt(
      "An outgoing-only historical message",
      nip44.v2.utils.getConversationKey(selfKey, recipient),
    )
    ciphertextByRecipient.set(recipient, content)
  }
  return sign(selfKey, 4444, [["p", recipient]], content, timestamp - index)
}

const setup = async (page: Page, options: MockRelayOptions = {}) => {
  await seedDevSession(page)
  const relay = new MockRelay({
    respectLimits: true,
    ...options,
    seedEvents: [...metadata, ...(options.seedEvents || [])],
  })
  await relay.setup(page)
  await page
    .context()
    .route(/^https:\/\//, route =>
      route.fulfill({status: 503, body: "External service blocked by fixture"}),
    )
  return relay
}

test("cold inbox discovers outgoing-only history and a concrete conversation survives a warm reload", async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const relay = await setup(page, {seedEvents: [dm(1)]})
  await page.goto("/chat")
  const link = page.locator(`a[href="/chat/${partner}"]`).filter({visible: true})
  await expect(link).toContainText("An outgoing-only historical message", {timeout: 20_000})
  await link.click()
  await expect(page.locator(`[data-event="${dm(1).id}"]`)).toContainText(
    "An outgoing-only historical message",
  )
  await expect(page.getByText("End of message history", {exact: true})).toBeVisible()
  await page.reload()
  await expect(page.locator(`[data-event="${dm(1).id}"]`)).toContainText(
    "An outgoing-only historical message",
    {timeout: 15_000},
  )
  await expect(page.getByText("End of message history", {exact: true})).toBeVisible()
  await page.screenshot({path: info.outputPath("dm-history-desktop.png")})
  expect(errors).toEqual([])
  expect(relay.getPublishedEvents()).toHaveLength(0)
})

test("direct conversation handles relay AUTH and a history response slower than three seconds", async ({
  page,
}) => {
  const relay = await setup(page, {
    seedEvents: [dm(1)],
    authRequiredRelays: [relayUrl],
    responseLatencyByKind: {4444: 3500},
  })
  await page.goto(`/chat/${partner}`)
  await expect(page.locator(`[data-event="${dm(1).id}"]`)).toContainText(
    "An outgoing-only historical message",
    {timeout: 20_000},
  )
  await expect(page.getByText("End of message history", {exact: true})).toBeVisible({
    timeout: 15_000,
  })
  const telemetry = await relay.getTelemetry()
  expect(telemetry.some(entry => entry.type === "auth" && entry.relayUrl === relayUrl)).toBe(true)
  const historical = telemetry.filter(
    entry =>
      entry.type === "req" && entry.filters?.some(f => f.kinds?.includes(4444) && f.limit !== 0),
  )
  expect(historical[0].filters![0]).toMatchObject({authors: [partner], "#p": [DEV_PUBKEY]})
})

test("rejected reads remain retryable instead of showing empty or exhausted history", async ({
  page,
}) => {
  let deny = true
  const relay = await setup(page, {
    seedEvents: [dm(1)],
    getSubscriptionOutcome: filters =>
      deny && filters.some(filter => filter.kinds?.includes(4444)) ? "denied" : "eose",
  })
  await page.goto(`/chat/${partner}`)
  await expect(page.getByText("Some message history could not be loaded.")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText("End of message history", {exact: true})).toHaveCount(0)
  deny = false
  await page
    .locator('[data-component="PageContent"]')
    .getByRole("button", {name: "Retry history"})
    .click()
  await expect(page.locator(`[data-event="${dm(1).id}"]`)).toContainText(
    "An outgoing-only historical message",
  )
  await expect(page.getByText("End of message history", {exact: true})).toBeVisible()
  expect(relay.getPublishedEvents()).toHaveLength(0)
})

test("an old message link keeps the mounted conversation window bounded", async ({page}) => {
  const messages = Array.from({length: 250}, (_, index) => dm(index))
  await setup(page, {seedEvents: messages})
  await page.goto(`/chat/${partner}#event-${messages[220].id}`)
  await expect(page.locator(`[data-event="${messages[220].id}"]`)).toBeVisible({timeout: 15_000})
  await expect(page.getByRole("button", {name: "Back to latest messages"})).toBeVisible()
  expect(await page.locator("[data-event]").count()).toBeLessThanOrEqual(20)
  await page.getByRole("button", {name: "Back to latest messages"}).click()
  await expect(page.locator(`[data-event="${messages[0].id}"]`)).toBeVisible()
  expect(await page.locator("[data-event]").count()).toBeLessThanOrEqual(20)
})

test("mobile scans a large inbox incrementally with bounded rows and no partner relay-list fanout", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await page.setViewportSize({width: 390, height: 844})
  const devtools = await page.context().newCDPSession(page)
  await devtools.send("Emulation.setCPUThrottlingRate", {rate: 4})
  await page.addInitScript(() => {
    const tasks: Array<{startTime: number; duration: number}> = []
    ;(window as unknown as {__dmHistoryLongTasks: typeof tasks}).__dmHistoryLongTasks = tasks
    new PerformanceObserver(list => {
      for (const entry of list.getEntries())
        tasks.push({startTime: entry.startTime, duration: entry.duration})
    }).observe({type: "longtask", buffered: true})
  })
  const partners = Array.from({length: 60}, (_, index) =>
    getPublicKey(new Uint8Array(32).fill(index + 30)),
  )
  const events = [
    ...Array.from({length: 1000}, (_, index) => dm(index)),
    ...partners.map((person, index) => dm(2000 + index, person)),
  ]
  const relay = await setup(page, {seedEvents: events})
  const startedAt = Date.now()
  await page.goto("/chat")
  await expect(page.locator(`a[href="/chat/${partner}"]`).filter({visible: true})).toContainText(
    "An outgoing-only historical message",
    {timeout: 30_000},
  )
  const firstUsableMs = Date.now() - startedAt
  const search = page.getByPlaceholder("Search conversations or people...")
  await search.fill("history")
  await expect(search).toHaveValue("history")
  await search.fill("")
  await expect(page.getByRole("button", {name: "Show more conversations (31)"})).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('[data-dm-history-status="loading"]')).toHaveCount(0)
  const links = page.locator('a[href^="/chat/"]')
  expect(await links.count()).toBeLessThan(20)
  const telemetry = await relay.getTelemetry()
  const dmRequests = telemetry.filter(
    entry => entry.type === "req" && entry.filters?.some(f => f.kinds?.includes(4444)),
  )
  expect(dmRequests.length).toBeLessThan(25)
  expect(dmRequests.some(entry => entry.filters?.some(f => f.until! < timestamp - 500))).toBe(true)
  const personInboxLookups = telemetry.filter(
    entry =>
      entry.type === "req" &&
      entry.filters?.some(
        f => f.kinds?.includes(10050) && f.authors?.some(author => partners.includes(author)),
      ),
  )
  expect(personInboxLookups).toHaveLength(0)
  const tasks = await page.evaluate(
    () =>
      (
        window as unknown as {
          __dmHistoryLongTasks: Array<{startTime: number; duration: number}>
        }
      ).__dmHistoryLongTasks,
  )
  const historyTasks = tasks.filter(task => task.startTime >= dmRequests[0].at)
  const metrics = {
    cpuSlowdown: 4,
    messages: events.length,
    conversations: 61,
    firstUsableMs,
    dmRequests: dmRequests.length,
    mountedRows: await links.count(),
    historyLongTasks: historyTasks.length,
    maxHistoryLongTaskMs: Math.max(0, ...historyTasks.map(task => task.duration)),
  }
  const metricsPath = info.outputPath("dm-mobile-performance.json")
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2))
  await info.attach("dm-mobile-performance", {path: metricsPath, contentType: "application/json"})
  await page.screenshot({path: info.outputPath("dm-history-mobile.png")})
  expect(relay.getPublishedEvents()).toHaveLength(0)
})
