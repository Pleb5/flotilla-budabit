import {expect, test} from "@playwright/test"
import {nip19} from "nostr-tools"
import {
  TEST_PUBKEYS,
  createRepoAnnouncement,
  encodeRepoNaddr,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-account-search-loading.test"

const deferredEose = () => {
  let release!: () => void
  const promise = new Promise<"eose">(resolve => {
    release = () => resolve("eose")
  })
  return {promise, release}
}

for (const mode of ["npub", "naddr"] as const) {
  test(`${mode} search stays pending through outbox and repository lookup`, async ({
    page,
  }, testInfo) => {
    const identifier = "delayed-account-search"
    const name = "Delayed account search repository"
    const announcement = signTestEvent(
      createRepoAnnouncement({
        identifier,
        name,
        pubkey: TEST_PUBKEYS.alice,
        relays: [relayUrl],
      }),
    )
    const outbox = deferredEose()
    const repos = deferredEose()
    const emptyAccount = deferredEose()
    const requested = new Set<string>()
    const mockRelay = new MockRelay({
      seedEvents: [announcement],
      getSubscriptionOutcome: filters => {
        for (const filter of filters) {
          if (filter.authors?.includes(TEST_PUBKEYS.alice)) {
            if (filter.kinds?.includes(10002)) {
              requested.add("outbox")
              return outbox.promise
            }
            if (filter.kinds?.includes(30617)) {
              requested.add("repos")
              return repos.promise
            }
          }
          if (filter.authors?.includes(TEST_PUBKEYS.bob) && filter.kinds?.includes(30617)) {
            requested.add("empty")
            return emptyAccount.promise
          }
        }
      },
    })

    await page.addInitScript(() => {
      localStorage.clear()
      localStorage.setItem("git:selected-mode", JSON.stringify("personal"))
      localStorage.setItem("git:selected-tab", JSON.stringify("my-repos"))
    })
    await mockRelay.setup(page)
    await page.goto("/git")

    const search = page.getByPlaceholder("Repo, owner, npub, or naddr")
    const loading = page.getByRole("status").filter({hasText: "Searching repositories..."})
    const empty = page.getByText(/Repository not found|No repositories (?:found|loaded)/)
    const cards = page.getByTestId("repo-card")
    const query = (pubkey: string) =>
      mode === "npub" ? nip19.npubEncode(pubkey) : encodeRepoNaddr(pubkey, identifier, [relayUrl])

    await search.fill(query(TEST_PUBKEYS.alice))
    await expect(loading).toBeVisible()
    await expect(empty).toHaveCount(0)
    await expect.poll(() => requested.has("outbox")).toBe(true)
    expect(requested.has("repos")).toBe(false)

    outbox.release()
    await expect.poll(() => requested.has("repos")).toBe(true)
    await expect(loading).toBeVisible()
    await expect(empty).toHaveCount(0)
    await expect(cards).toHaveCount(0)
    await testInfo.attach("pending-account-search", {
      body: await page.screenshot({path: testInfo.outputPath("pending-account-search.png")}),
      contentType: "image/png",
    })

    repos.release()
    await expect(cards).toHaveCount(1)
    await expect(cards).toContainText(name)
    await expect(loading).toHaveCount(0)
    await expect(empty).toHaveCount(0)

    // A new account cannot inherit the previous account's settled/empty state.
    await search.fill(`nostr:${query(TEST_PUBKEYS.bob)}`)
    await expect(loading).toBeVisible()
    await expect(cards).toHaveCount(0)
    await expect.poll(() => requested.has("empty")).toBe(true)
    await expect(empty).toHaveCount(0)
    emptyAccount.release()
    await expect(loading).toHaveCount(0)
    await expect(empty).toBeVisible()

    // Cached results remain visible during a refresh rather than being replaced by a spinner.
    await search.fill(query(TEST_PUBKEYS.alice))
    await expect(cards).toHaveCount(1)
    await expect(cards).toContainText(name)
    await expect(empty).toHaveCount(0)

    await search.fill("npub1invalid")
    await expect(page.getByText("Invalid npub.", {exact: true})).toBeVisible()
    await expect(loading).toHaveCount(0)
    await expect(cards).toHaveCount(0)
    expect(mockRelay.getPublishedEvents()).toEqual([])
  })
}

test("npub search settles when repository relays stop responding", async ({page}) => {
  let repoRequested = false
  const mockRelay = new MockRelay({
    getSubscriptionOutcome: filters => {
      if (
        filters.some(
          filter => filter.kinds?.includes(30617) && filter.authors?.includes(TEST_PUBKEYS.alice),
        )
      ) {
        repoRequested = true
        return "stall"
      }
    },
  })
  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  await page.goto("/git")
  await page
    .getByPlaceholder("Repo, owner, npub, or naddr")
    .fill(nip19.npubEncode(TEST_PUBKEYS.alice))

  const status = page.getByRole("status")
  await expect.poll(() => repoRequested).toBe(true)
  await expect(status).toHaveText("Searching repositories...")
  await expect(status).toHaveText("No repositories loaded for this account.", {timeout: 12_000})
  await expect(page.getByTestId("repo-card")).toHaveCount(0)
  expect(mockRelay.getPublishedEvents()).toEqual([])
})
