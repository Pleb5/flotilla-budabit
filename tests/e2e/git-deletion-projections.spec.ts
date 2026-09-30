import {expect, test, type Page} from "@playwright/test"
import {writeFile} from "node:fs/promises"
import {MockRelay} from "./helpers/mock-relay"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {createRepoAnnouncement, signTestEvent, TEST_PUBKEYS} from "./fixtures/events/repo"
import {
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityPointer,
} from "../../src/app/core/community-protocol"

const relay = "wss://deletion-projection.test/"
const communityRelay = "wss://deletion-community.test/"
const repo = signTestEvent(
  createRepoAnnouncement({
    identifier: "review-deletion",
    name: "Review deletion repository",
    pubkey: DEV_PUBKEY,
    relays: [relay],
    created_at: 100,
  }),
)
const address = `30617:${repo.pubkey}:review-deletion`
const star = signTestEvent({
  kind: 7,
  pubkey: DEV_PUBKEY,
  created_at: 120,
  tags: [
    ["a", address, relay],
    ["e", repo.id],
    ["k", "30617"],
  ],
  content: "+",
})
const deletion = signTestEvent({
  kind: 5,
  pubkey: repo.pubkey,
  created_at: 150,
  tags: [["a", address]],
  content: "",
})
const community = makeCommunityPointer({
  ownerPubkey: DEV_PUBKEY,
  communityId: TEST_PUBKEYS.charlie,
  relayHints: [communityRelay],
})!
const writerIdentifier = `${community.communityId}-star-writers`
const definition = signTestEvent({
  ...buildCommunityDefinition({
    communityId: community.communityId,
    name: "Deletion community",
    relays: [communityRelay],
    sections: [
      {
        name: "Stars",
        kinds: [{kind: 7}],
        profileLists: [{address: `30000:${DEV_PUBKEY}:${writerIdentifier}`, relay: communityRelay}],
      },
    ],
  }),
  pubkey: DEV_PUBKEY,
  created_at: 100,
})
const writers = signTestEvent({
  kind: 30000,
  pubkey: DEV_PUBKEY,
  created_at: 100,
  tags: [
    ["d", writerIdentifier],
    ["p", DEV_PUBKEY],
    ["p", TEST_PUBKEYS.bob],
  ],
  content: "",
})
const communityStar = signTestEvent({...star, pubkey: TEST_PUBKEYS.bob})
const wrapper = signTestEvent({
  ...buildTargetedPublication({
    id: "review-star",
    kind: 7,
    communities: [community],
    source: {type: "e", value: communityStar.id, relay},
  }),
  pubkey: DEV_PUBKEY,
  created_at: 130,
})

const repositoryDeleted = (page: Page) =>
  page.evaluate(async eventId => {
    const url = performance
      .getEntriesByType("resource")
      .map(entry => entry.name)
      .find(url => new URL(url).pathname.endsWith("/packages/welshman/packages/app/src/index.ts"))!
    if (!url) return false
    const {repository} = await import(/* @vite-ignore */ url)
    return Boolean(
      repository.getEvent(eventId) && repository.isDeleted(repository.getEvent(eventId)),
    )
  }, repo.id)

test.afterEach(async ({page}, info) => {
  if (info.status === info.expectedStatus) return
  const telemetry = await page.evaluate(
    () => (window as unknown as {__mockRelayTelemetry?: unknown}).__mockRelayTelemetry,
  )
  await writeFile(info.outputPath("failure-telemetry.json"), JSON.stringify(telemetry, null, 2))
})

for (const mode of ["personal-starred", "community-starred", "search"] as const) {
  test(`${mode} removes hydrated deletions, restores compact evidence, and permits a newer revision`, async ({
    page,
  }, info) => {
    await page.route("https://**", route =>
      route.fulfill({status: 503, body: "Fixture external services unavailable"}),
    )
    await seedDevSession(page)
    await page.addInitScript(mode => {
      localStorage.setItem(
        "git:selected-mode",
        JSON.stringify(mode === "community-starred" ? "community" : "personal"),
      )
      localStorage.setItem(
        "git:selected-tab",
        JSON.stringify(mode === "search" ? "my-repos" : "bookmarks"),
      )
    }, mode)
    let release!: () => void
    let compactOnly = false
    const gate = new Promise<"eose">(resolve => {
      release = () => resolve("eose")
    })
    const mock = new MockRelay({
      respectLimits: true,
      seedEvents: mode === "community-starred" ? [definition, writers] : [repo, star],
      seedEventsByRelay:
        mode === "community-starred"
          ? {[communityRelay]: [wrapper], [relay]: [communityStar, repo, deletion]}
          : {[relay]: [deletion]},
      getSubscriptionOutcome: (filters, sourceRelay) =>
        (compactOnly || sourceRelay === relay) && filters.some(filter => filter.kinds?.includes(5))
          ? compactOnly
            ? "denied"
            : gate
          : undefined,
    })
    await mock.setup(page)
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(mode === "community-starred" ? `/git?community=${community.naddr}` : "/git")
    const cards = page.getByTestId("repo-card")
    await expect(cards).toHaveCount(1)
    if (mode === "search") {
      await page.getByPlaceholder("Repo, owner, npub, or naddr").fill("review deletion")
      await expect(page.getByText("Search complete.", {exact: true})).toBeVisible()
    }
    // Explicit source-only evidence: a generic request on another relay cannot pass.
    await expect
      .poll(async () =>
        (await mock.getTelemetry()).some(
          entry =>
            entry.type === "req" &&
            entry.relayUrl === relay &&
            entry.filters?.some(
              filter =>
                filter.kinds?.includes(5) &&
                filter["#a"]?.includes(address) &&
                filter.until !== undefined,
            ),
        ),
      )
      .toBe(true)
    release()
    await expect.poll(() => repositoryDeleted(page)).toBe(true)
    await expect(cards).toHaveCount(0)
    await page.screenshot({path: info.outputPath("deleted-card-absent.png"), animations: "disabled"})
    const targetRequests = (await mock.getTelemetry()).filter(
      entry =>
        entry.type === "req" &&
        entry.filters?.some(filter => filter.kinds?.includes(5) && filter["#a"]?.includes(address)),
    )
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

    compactOnly = true
    await page.reload()
    if (mode === "search")
      await page.getByPlaceholder("Repo, owner, npub, or naddr").fill("review deletion")
    await expect.poll(() => repositoryDeleted(page)).toBe(true)
    if (mode === "search")
      await expect(page.getByText("Search complete.", {exact: true})).toBeVisible()
    await expect(cards).toHaveCount(0)
    const newer = signTestEvent({...repo, created_at: 200})
    await page.evaluate(async event => {
      const url = performance
        .getEntriesByType("resource")
        .map(entry => entry.name)
        .find(url =>
          new URL(url).pathname.endsWith("/packages/welshman/packages/app/src/index.ts"),
        )!
      const {repository} = await import(/* @vite-ignore */ url)
      if (repository.query([{kinds: [5]}]).length)
        throw new Error("Restart must use only compact evidence")
      repository.publish(event)
    }, newer)
    await expect(cards).toHaveCount(1)
    await expect(cards.getByText("Review deletion repository", {exact: true})).toBeVisible()
    await page.screenshot({path: info.outputPath("newer-revision-survives.png"), animations: "disabled"})
    expect(errors).toEqual([])
    expect(mock.getPublishedEvents()).toEqual([])
    await writeFile(
      info.outputPath("deletion-projection-telemetry.json"),
      JSON.stringify({mode, targetRequests, errors}, null, 2),
    )
  })
}
