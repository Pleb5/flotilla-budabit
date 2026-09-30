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
    await page.screenshot({
      path: info.outputPath("deleted-card-absent.png"),
      animations: "disabled",
    })
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
    await page.screenshot({
      path: info.outputPath("newer-revision-survives.png"),
      animations: "disabled",
    })
    expect(errors).toEqual([])
    expect(mock.getPublishedEvents()).toEqual([])
    await writeFile(
      info.outputPath("deletion-projection-telemetry.json"),
      JSON.stringify({mode, targetRequests, errors}, null, 2),
    )
  })
}

test("discovery-only cards persist deletions through stale replay and accept a newer isolated result", async ({
  page,
}, info) => {
  const source = "wss://discovery-only-source.test/"
  const original = signTestEvent(
    createRepoAnnouncement({
      identifier: "poolonly",
      name: "Poolonly discovery repository",
      pubkey: TEST_PUBKEYS.bob,
      relays: [source],
      created_at: 100,
    }),
  )
  const address = `30617:${original.pubkey}:poolonly`
  const newer = signTestEvent({...original, created_at: 200})
  const follows = signTestEvent({
    kind: 3,
    pubkey: DEV_PUBKEY,
    created_at: 100,
    tags: [["p", original.pubkey]],
    content: "",
  })
  const outbox = signTestEvent({
    kind: 10002,
    pubkey: original.pubkey,
    created_at: 100,
    tags: [["r", source]],
    content: "",
  })
  const deletion = signTestEvent({
    kind: 5,
    pubkey: original.pubkey,
    created_at: 150,
    tags: [["a", address]],
    content: "",
  })
  let releaseDeletion!: () => void
  let releaseNewer!: () => void
  let compactOnly = false
  let discoverNewer = false
  let newerRequested = false
  const deletionGate = new Promise<"eose">(resolve => {
    releaseDeletion = () => resolve("eose")
  })
  const newerGate = new Promise<"eose">(resolve => {
    releaseNewer = () => resolve("eose")
  })
  const mock = new MockRelay({
    respectLimits: true,
    seedEvents: [follows, outbox],
    seedEventsByRelay: {[source]: [original, deletion]},
    getSubscriptionOutcome: (filters, relay) => {
      if (filters.some(filter => filter.kinds?.includes(5))) {
        if (compactOnly) return "denied"
        if (relay === source) return deletionGate
      }
      if (
        discoverNewer &&
        relay === source &&
        filters.some(
          filter => filter.kinds?.includes(30617) && filter.authors?.includes(original.pubkey),
        )
      ) {
        newerRequested = true
        return newerGate
      }
    },
  })
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture external services unavailable"}),
  )
  await seedDevSession(page)
  await page.addInitScript(() => {
    localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
    localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
  })
  await mock.setup(page)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const repoState = (event = original) =>
    page.evaluate(async event => {
      const url = performance
        .getEntriesByType("resource")
        .map(entry => entry.name)
        .find(url =>
          new URL(url).pathname.endsWith("/packages/welshman/packages/app/src/index.ts"),
        )!
      const {repository} = await import(/* @vite-ignore */ url)
      return {
        bodyLoaded: Boolean(repository.getEvent(event.id)),
        deleted: repository.isDeleted(event),
        rawDeletions: repository.query([{kinds: [5]}]).length,
      }
    }, event)
  const search = async () => {
    await expect(page.getByPlaceholder("Repo, owner, npub, or naddr")).toBeVisible()
    await page.evaluate(
      async events => {
        const url = performance
          .getEntriesByType("resource")
          .map(entry => entry.name)
          .find(url =>
            new URL(url).pathname.endsWith("/packages/welshman/packages/app/src/index.ts"),
          )!
        const {repository} = await import(/* @vite-ignore */ url)
        // Deterministic discovery prerequisites, without importing the target body.
        for (const event of events) repository.publish(event)
      },
      [follows, outbox],
    )
    await page.getByPlaceholder("Repo, owner, npub, or naddr").fill("poolonly")
    await expect(page.getByText("Search complete.", {exact: true})).toBeVisible()
  }
  const readTombstone = () =>
    page.evaluate(async key => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("budabit-deletions-v1")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const record = await new Promise<{target: string; created_at: number} | undefined>(
        resolve => {
          const request = db.transaction("deletions").objectStore("deletions").get(key)
          request.onsuccess = () => resolve(request.result)
        },
      )
      db.close()
      return record
    }, `${address}:${original.pubkey}`)
  await page.goto("/git")
  await search()
  const cards = page.getByTestId("repo-card")
  await expect(cards).toHaveCount(1)
  expect((await repoState()).bodyLoaded).toBe(false)
  await expect
    .poll(async () =>
      (await mock.getTelemetry()).some(
        entry =>
          entry.type === "req" &&
          entry.relayUrl === source &&
          entry.filters?.some(
            filter =>
              filter.kinds?.includes(5) &&
              filter["#a"]?.includes(address) &&
              filter.until !== undefined,
          ),
      ),
    )
    .toBe(true)
  releaseDeletion()
  await expect.poll(async () => (await repoState()).deleted).toBe(true)
  await expect(cards).toHaveCount(0)
  await expect.poll(readTombstone).toMatchObject({target: address, created_at: 150})
  const deletedState = await repoState()
  expect(deletedState.bodyLoaded).toBe(false)
  const targetRequests = (await mock.getTelemetry()).filter(
    entry =>
      entry.type === "req" &&
      entry.relayUrl === source &&
      entry.filters?.some(filter => filter["#a"]?.includes(address)),
  )

  compactOnly = true
  await page.reload()
  await search()
  await expect.poll(async () => (await repoState()).deleted).toBe(true)
  await expect(cards).toHaveCount(0)
  const restartedState = await repoState()
  expect(restartedState).toEqual({bodyLoaded: false, deleted: true, rawDeletions: 0})
  await page.screenshot({
    path: info.outputPath("discovery-only-deleted-after-restart.png"),
    animations: "disabled",
  })

  // A fresh isolated read returns the newer revision alongside stale replay.
  discoverNewer = true
  await page.getByPlaceholder("Repo, owner, npub, or naddr").fill("poolonly discovery")
  await expect.poll(() => newerRequested).toBe(true)
  await mock.injectEvents([newer])
  releaseNewer()
  await expect(page.getByText("Search complete.", {exact: true})).toBeVisible()
  await expect(cards).toHaveCount(1)
  await expect(cards.getByText("Poolonly discovery repository", {exact: true})).toBeVisible()
  const newerState = await repoState(newer)
  expect(newerState).toEqual({bodyLoaded: false, deleted: false, rawDeletions: 0})
  expect((await repoState()).deleted).toBe(true)
  await page.screenshot({
    path: info.outputPath("discovery-only-newer-revision.png"),
    animations: "disabled",
  })
  expect(errors).toEqual([])
  expect(mock.getPublishedEvents()).toEqual([])
  await writeFile(
    info.outputPath("discovery-only-proof.json"),
    JSON.stringify(
      {
        deletedState,
        restartedState,
        newerState,
        record: await readTombstone(),
        errors,
        targetRequests,
      },
      null,
      2,
    ),
  )
})
