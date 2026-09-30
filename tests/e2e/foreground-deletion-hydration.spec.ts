import {expect, test, type Page} from "@playwright/test"
import {writeFile} from "node:fs/promises"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay, type NostrFilter} from "./helpers/mock-relay"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {createRepoAnnouncement, signTestEvent} from "./fixtures/events/repo"

const secret = new Uint8Array(32).fill(21)
const owner = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(22))
const fast = "wss://deletion-fast.example/"
const slow = "wss://deletion-slow.example/"
const sign = (kind: number, created_at: number, tags: string[][], content = "") =>
  finalizeEvent({kind, created_at, tags, content}, secret)
const definition = sign(32222, 1, [
  ["d", communityId],
  ["name", "Deletion Community"],
  ["r", fast.slice(0, -1)],
  ["r", slow.slice(0, -1)],
  ["content", "Rooms"],
  ["k", "11", "room"],
  ["content", "Threads"],
  ["k", "11", "threads"],
])
const room = sign(11, 2, [["h", communityId], ["room"], ["title", "Useful room"]], "Useful room")
const thread = sign(
  11,
  3,
  [
    ["h", communityId],
    ["title", "Cached deleted thread"],
  ],
  "Cached deleted thread",
)
// No h or k tags: only the foreground target fallback can discover this delete.
const threadDeletion = sign(5, 4, [["e", thread.id]])
const communityPath = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [fast, slow]})}`
const finiteDelete = (filter: NostrFilter) =>
  filter.kinds?.length === 1 && filter.kinds[0] === 5 && filter.until !== undefined
const gate = () => {
  let release!: () => void
  const response = new Promise<"eose">(resolve => {
    release = () => resolve("eose")
  })
  return {response, release}
}

type Timing = {firstUseful?: number; storage: {name: string; at: number}[]}
type TimingWindow = typeof window & {__deletionTiming: Timing}
const instrument = async (page: Page) => {
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture external services disabled"}),
  )
  await page.addInitScript(() => {
    const state: Timing = {storage: []}
    ;(window as TimingWindow).__deletionTiming = state
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (name, version) => {
      state.storage.push({name, at: performance.now()})
      return version === undefined ? open(name) : open(name, version)
    }
    const sample = () => {
      const root = document.querySelector('[data-perf="community-home"],[data-perf="git-root"]')
      if (
        root &&
        (Number(root.getAttribute("data-perf-rooms")) > 0 ||
          Number(root.getAttribute("data-perf-cards")) > 0)
      ) {
        state.firstUseful ??= performance.now()
      } else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
test.afterEach(async ({page}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const diagnostic = await page.evaluate(async threadId => {
    // Use the exact HMR URL already loaded by this page, preserving singleton identity.
    const moduleUrl = (suffix: string) =>
      performance
        .getEntriesByType("resource")
        .map(entry => entry.name)
        .find(url => new URL(url).pathname.endsWith(suffix))!
    const statePath = moduleUrl("/src/app/core/community-state.ts")
    const {activeCommunityBootstrapStatus, activeCommunityDescriptor} = await import(
      /* @vite-ignore */ statePath
    )
    const current = (store: {subscribe: (fn: (value: unknown) => void) => () => void}) => {
      let value: unknown
      store.subscribe(next => {
        value = next
      })()
      return value
    }
    const app = await import(
      /* @vite-ignore */ moduleUrl("/packages/welshman/packages/app/src/index.ts")
    )
    return {
      bootstrap: current(activeCommunityBootstrapStatus),
      descriptor: current(activeCommunityDescriptor),
      thread: app.repository.getEvent(threadId),
      deleted: app.repository.getEvent(threadId)
        ? app.repository.isDeleted(app.repository.getEvent(threadId))
        : undefined,
      telemetry: (window as unknown as {__mockRelayTelemetry: unknown}).__mockRelayTelemetry,
    }
  }, thread.id)
  const path = testInfo.outputPath("deletion-failure-diagnostics.json")
  await writeFile(path, JSON.stringify(diagnostic, null, 2))
  await testInfo.attach("deletion-failure-diagnostics", {path, contentType: "application/json"})
})
const assertPostContent = async (page: Page, relay: MockRelay) => {
  await expect
    .poll(
      async () =>
        (await relay.getTelemetry()).filter(
          entry => entry.type === "req" && entry.filters?.some(finiteDelete),
        ).length,
    )
    .toBeGreaterThan(0)
  const timing = await page.evaluate(() => (window as TimingWindow).__deletionTiming)
  expect(timing.firstUseful).toBeDefined()
  const requests = (await relay.getTelemetry()).filter(
    entry => entry.type === "req" && entry.filters?.some(finiteDelete),
  )
  expect(requests.every(entry => entry.at >= timing.firstUseful!)).toBe(true)
  expect(
    timing.storage
      .filter(entry => entry.name === "budabit-deletions-v1")
      .every(entry => entry.at >= timing.firstUseful!),
  ).toBe(true)
  return {timing, requests: requests.map(entry => ({at: entry.at, filters: entry.filters}))}
}

test("mobile Home stays usable and cached threads reconcile an old delete from the slower relay", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844})
  await instrument(page)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const deletionGate = gate()
  const mock = new MockRelay({
    respectLimits: true,
    seedEvents: [definition, room],
    seedEventsByRelay: {[slow]: [threadDeletion]},
    getSubscriptionOutcome: (filters, relay) =>
      relay === slow &&
      filters.some(filter => finiteDelete(filter) && filter["#e"]?.includes(thread.id))
        ? deletionGate.response
        : undefined,
  })
  await mock.setup(page)
  await page.goto(communityPath)
  const root = page.locator('[data-perf="community-home"]')
  await expect(root).toHaveAttribute("data-perf-rooms", "1")
  await expect(root.getByRole("link", {name: "Useful room", exact: true})).toBeVisible()
  const cold = await assertPostContent(page, mock)
  await page.screenshot({path: testInfo.outputPath("mobile-home.png")})

  // Simulate a second device's persisted cache; this original is not returned by
  // any content-history query. Only the deletion exists on the slower relay.
  await page.evaluate(async event => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("flotilla-9gl")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite")
      tx.objectStore("events").put(event)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, thread)
  await page.reload()
  await expect(root).toHaveAttribute("data-perf-rooms", "1")
  await root.getByRole("link", {name: "Threads", exact: true}).click()
  await expect(page.getByText("Cached deleted thread", {exact: true}).first()).toBeVisible()
  await expect
    .poll(async () =>
      (await mock.getTelemetry()).some(
        entry =>
          entry.type === "req" &&
          entry.relayUrl === slow &&
          entry.filters?.some(filter => finiteDelete(filter) && filter["#e"]?.includes(thread.id)),
      ),
    )
    .toBe(true)
  deletionGate.release()
  await expect(page.getByText("Cached deleted thread", {exact: true})).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("budabit-deletions-v1")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const count = await new Promise<number>(resolve => {
          const request = db.transaction("deletions").objectStore("deletions").count()
          request.onsuccess = () => resolve(request.result)
        })
        db.close()
        return count
      }),
    )
    .toBeGreaterThan(0)
  await page.goBack()
  await expect(root).toHaveAttribute("data-perf-rooms", "1")
  await testInfo.attach("cold-home-deletion-order", {
    body: JSON.stringify(cold),
    contentType: "application/json",
  })
  await writeFile(testInfo.outputPath("home-order.json"), JSON.stringify(cold, null, 2))
  expect(errors).toEqual([])
  expect(mock.getPublishedEvents()).toEqual([])
})

test("git renders before coordinate reconciliation and keeps newer replacements after reload", async ({
  page,
}, testInfo) => {
  await instrument(page)
  await seedDevSession(page)
  await page.addInitScript(() => {
    localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
    localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
  })
  const repos = ["Deleted repository", "Newer repository"].map((name, i) =>
    signTestEvent(
      createRepoAnnouncement({
        pubkey: DEV_PUBKEY,
        identifier: `deletion-${i}`,
        name,
        relays: [fast],
        created_at: 100 + i * 100,
      }),
    ),
  )
  const deletions = repos.map((repo, i) =>
    signTestEvent({
      kind: 5,
      pubkey: DEV_PUBKEY,
      created_at: 150,
      tags: [
        ["a", `30617:${DEV_PUBKEY}:deletion-${i}`],
        ["e", repo.id],
      ],
      content: "",
    }),
  )
  const deletionGate = gate()
  const mock = new MockRelay({
    respectLimits: true,
    seedEvents: [...repos, ...deletions],
    getSubscriptionOutcome: filters =>
      filters.some(filter => filter.kinds?.includes(5)) ? deletionGate.response : undefined,
  })
  await mock.setup(page)
  await page.goto("/git")
  const cards = page.getByTestId("repo-card-grid").getByTestId("repo-card")
  await expect(cards).toHaveCount(2)
  const cold = await assertPostContent(page, mock)
  deletionGate.release()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByText("Newer repository", {exact: true})).toBeVisible()
  await page.reload()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByText("Newer repository", {exact: true})).toBeVisible()
  await page.screenshot({path: testInfo.outputPath("git-surviving-replacement.png")})
  await testInfo.attach("cold-git-deletion-order", {
    body: JSON.stringify(cold),
    contentType: "application/json",
  })
  await writeFile(testInfo.outputPath("git-order.json"), JSON.stringify(cold, null, 2))
  expect(mock.getPublishedEvents()).toEqual([])
})
