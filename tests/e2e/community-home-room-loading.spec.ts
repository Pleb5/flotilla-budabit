import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {MockRelay} from "./helpers/mock-relay"

const secret = new Uint8Array(32).fill(21)
const owner = getPublicKey(secret)
const communityId = getPublicKey(new Uint8Array(32).fill(22))
const relayUrl = "wss://community-home-room-loading.example"
const sign = (kind: number, created_at: number, tags: string[][], content = "") =>
  finalizeEvent({kind, created_at, tags, content}, secret)
const definition = sign(32222, 1, [
  ["d", communityId],
  ["name", "Room Loading Community"],
  ["r", relayUrl],
  ["content", "Rooms"],
  ["k", "11", "room"],
  ["a", `30000:${owner}:${communityId}-members`],
])
const permissions = sign(30000, 2, [
  ["d", `${communityId}-members`],
  ["p", owner],
])
const rooms = ["Design", "Engineering", "Operations"].map((name, index) =>
  sign(11, 3 + index, [["h", communityId], ["room"], ["title", name]], name),
)
const homePath = `/c/${nip19.naddrEncode({
  kind: 32222,
  pubkey: owner,
  identifier: communityId,
  relays: [relayUrl],
})}`

type RoomFrame = {ms: number; rooms: number; ready: boolean; heading: string | null}
type RoomCheckWindow = typeof window & {__communityHomeRoomFrames: RoomFrame[]}

const homeRoot = (page: Page) => page.locator('[data-perf="community-home"]')
const readRoomFrames = (page: Page) =>
  page.evaluate(async () => {
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    return (window as RoomCheckWindow).__communityHomeRoomFrames
  })
const clearRoomFrames = (page: Page) =>
  page.evaluate(() => {
    ;(window as RoomCheckWindow).__communityHomeRoomFrames = []
  })
const makeResponseGate = () => {
  let release!: () => void
  const response = new Promise<"eose">(resolve => {
    release = () => resolve("eose")
  })
  return {response, release}
}
const expectLoadedRooms = async (page: Page) => {
  const root = homeRoot(page)
  await expect(root).toHaveAttribute("data-perf-rooms", "3")
  for (const name of ["Design", "Engineering", "Operations"]) {
    await expect(root.getByRole("link", {name, exact: true})).toBeVisible()
  }
}

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({page}) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
  // Sample actual animation frames: an eventually-visible assertion alone misses
  // a loading card disappearing and reappearing between successful assertions.
  await page.addInitScript(() => {
    const target = window as RoomCheckWindow
    target.__communityHomeRoomFrames = []
    let previous = ""
    const sample = () => {
      const root = document.querySelector('[data-perf="community-home"]')
      if (root) {
        const state = {
          rooms: Number(root.getAttribute("data-perf-rooms")),
          ready: root.getAttribute("data-perf-core-ready") === "true",
          heading:
            Array.from(root.querySelectorAll("h3"))
              .map(element => element.textContent?.trim() || "")
              .find(text =>
                /^(Loading Rooms|Looking for rooms|Rooms unavailable|No rooms found)/.test(text),
              ) || null,
        }
        const key = JSON.stringify(state)
        if (key !== previous) {
          target.__communityHomeRoomFrames.push({ms: Math.round(performance.now()), ...state})
          previous = key
        }
      } else {
        previous = ""
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
})

test.afterEach(async ({page}, testInfo) => {
  await testInfo.attach("room-frames", {
    body: JSON.stringify(await readRoomFrames(page), null, 2),
    contentType: "application/json",
  })
  expect(pageErrors.get(page)).toEqual([])
})

test("suppresses room placeholders on fast cold loads and warm navigation", async ({page}) => {
  const mock = new MockRelay({seedEvents: [definition, permissions, ...rooms]})
  await mock.setup(page)
  await page.goto(homePath)
  await expectLoadedRooms(page)
  const coldFrames = await readRoomFrames(page)
  expect(coldFrames.some(frame => frame.rooms === 3)).toBe(true)
  expect(coldFrames.filter(frame => frame.heading)).toEqual([])

  await homeRoot(page).getByRole("link", {name: "Threads", exact: true}).click()
  await expect(page).toHaveURL(/\/threads$/)
  await clearRoomFrames(page)
  await page.goBack()
  await expectLoadedRooms(page)
  const warmFrames = await readRoomFrames(page)
  expect(warmFrames.some(frame => frame.rooms === 3)).toBe(true)
  expect(warmFrames.filter(frame => frame.heading)).toEqual([])
  expect(mock.getPublishedEvents()).toEqual([])
})

test("keeps the card hidden when each loading phase is fast but their total exceeds the delay", async ({
  page,
}) => {
  const mock = new MockRelay({
    seedEvents: [definition, permissions, ...rooms],
    responseLatencyByKind: {32222: 200, 30000: 250, 11: 350},
    getSubscriptionOutcome: filters =>
      filters.every(filter => filter.limit === 0) ? "stall" : undefined,
  })
  await mock.setup(page)
  await page.goto(homePath)
  await expectLoadedRooms(page)
  const frames = await readRoomFrames(page)
  const firstPending = frames.find(frame => frame.rooms === 0)!
  const firstRooms = frames.find(frame => frame.rooms === 3)!
  expect(firstRooms.ms - firstPending.ms).toBeGreaterThan(800)
  expect(frames.filter(frame => frame.heading)).toEqual([])
  expect(mock.getPublishedEvents()).toEqual([])
})

test("keeps a shown loading card visible across definition, permission, and room requests", async ({
  page,
}, testInfo) => {
  const definitionGate = makeResponseGate()
  const permissionGate = makeResponseGate()
  const roomGate = makeResponseGate()
  const mock = new MockRelay({
    seedEvents: [definition, permissions],
    getSubscriptionOutcome: filters => {
      // Live-only subscriptions must not replay seeded history ahead of the
      // finite requests whose responses this test controls.
      if (filters.every(filter => filter.limit === 0)) return "stall"
      if (filters.some(filter => filter.kinds?.includes(32222))) return definitionGate.response
      if (filters.some(filter => filter.kinds?.includes(30000))) return permissionGate.response
      if (filters.some(filter => filter.kinds?.includes(11))) return roomGate.response
    },
  })
  await mock.setup(page)
  await page.goto(homePath)
  const root = homeRoot(page)
  await expect(root.getByRole("heading", {name: "Looking for rooms...", exact: true})).toBeVisible()
  definitionGate.release()
  await expect(root.getByRole("heading", {name: "Loading Rooms...", exact: true})).toBeVisible()
  permissionGate.release()
  await expect(root).toHaveAttribute("data-perf-core-ready", "true")
  await expect(root).toHaveAttribute("data-perf-rooms", "0")
  await page.screenshot({path: testInfo.outputPath("permission-handoff.png")})
  await expect(root.getByRole("heading", {name: "Looking for rooms...", exact: true})).toBeVisible()
  await mock.injectEvents(rooms)
  roomGate.release()
  await expectLoadedRooms(page)
  const frames = await readRoomFrames(page)
  const firstLoadingFrame = frames.findIndex(frame => frame.heading !== null)
  expect(firstLoadingFrame).toBeGreaterThanOrEqual(0)
  expect(frames.some(frame => frame.rooms === 3)).toBe(true)
  expect(
    frames.slice(firstLoadingFrame + 1).filter(frame => frame.rooms === 0 && !frame.heading),
    "A shown loading card must not disappear while another loading phase is pending",
  ).toEqual([])
  expect(mock.getPublishedEvents()).toEqual([])
})

test("still renders the empty state when room requests finish without rooms", async ({page}) => {
  const mock = new MockRelay({seedEvents: [definition, permissions]})
  await mock.setup(page)
  await page.goto(homePath)
  const root = homeRoot(page)
  await expect(root).toHaveAttribute("data-perf-core-ready", "true")
  await expect(root.getByRole("heading", {name: "No rooms found", exact: true})).toBeVisible()
  await expect(root).toHaveAttribute("data-perf-rooms", "0")
  await expect(root.getByText("No rooms have been published yet.", {exact: true})).toBeVisible()
  expect(mock.getPublishedEvents()).toEqual([])
})
