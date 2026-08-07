import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_PUBKEYS,
  createIssue,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-detail-resolution.test"
const identifier = "detail-resolution-fixture"
const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)

test("keeps a missing issue loading while repository activity can still deliver it", async ({
  page,
}) => {
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Detail resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Issue delivered after initial EOSE",
      content: "The issue arrived through the repository activity subscription.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  let exactIssueLookups = 0
  let repoActivitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter.ids?.includes(issue.id))) exactIssueLookups += 1
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        repoActivitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues/${issue.id}`)

  await expect.poll(() => exactIssueLookups).toBeGreaterThan(0)
  await expect.poll(() => repoActivitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText("Loading issue...", {exact: true})).toBeVisible()
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)

  await mockRelay.injectEvents([issue])

  await expect(
    page.getByRole("heading", {name: "Issue delivered after initial EOSE", exact: true}),
  ).toBeVisible({timeout: 10_000})
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)
})

test("reports unavailable repository relays for issue and pull request details", async ({page}) => {
  const relaylessIdentifier = `${identifier}-relayless`
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier: relaylessIdentifier,
      name: "Relayless detail fixture",
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const mockRelay = new MockRelay({seedEvents: [announcement]})
  const missingId = "ab".repeat(32)

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, relaylessIdentifier, [relayUrl])

  await page.goto(`/git/${naddr}/issues/${missingId}`)
  await expect(page.getByText("Repository Relays Unavailable", {exact: true})).toBeVisible()
  await expect(page.getByText("No issue found.", {exact: true})).toHaveCount(0)

  await page.goto(`/git/${naddr}/prs/${missingId}`)
  await expect(page.getByText("Repository Relays Unavailable", {exact: true})).toBeVisible()
  await expect(page.getByText("Pull request not found.", {exact: true})).toHaveCount(0)
})
