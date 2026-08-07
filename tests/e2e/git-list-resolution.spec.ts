import {expect, test} from "@playwright/test"

import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createIssue,
  createPullRequest,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

test("keeps the issue list loading until cold-start activity arrives", async ({page}) => {
  const relayUrl = "wss://git-issue-list-resolution.test"
  const identifier = "issue-list-resolution-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "Issue list resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const issue = signTestEvent(
    createIssue({
      repoAddress,
      subject: "Cold-start issue",
      content: "Delivered after the issue list initially rendered.",
      pubkey: TEST_PUBKEYS.charlie,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  let activitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        activitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/issues`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText(/Loading issues/)).toBeVisible()
  await expect(page.getByText("No issues found.", {exact: true})).toHaveCount(0)

  await mockRelay.injectEvents([issue])

  await expect(page.getByText("Cold-start issue", {exact: true})).toBeVisible({timeout: 10_000})
})

test("keeps the PR list loading until cold-start activity arrives", async ({page}) => {
  const relayUrl = "wss://git-pr-list-resolution.test"
  const identifier = "pr-list-resolution-fixture"
  const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
  const announcement = signTestEvent(
    createRepoAnnouncement({
      identifier,
      name: "PR list resolution fixture",
      relays: [relayUrl],
      pubkey: TEST_PUBKEYS.alice,
      created_at: BASE_TIMESTAMP,
    }),
  )
  const pullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Cold-start pull request",
      content: "Delivered after the PR list initially rendered.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.bob,
      created_at: BASE_TIMESTAMP + 1,
    }),
  )
  let activitySubscriptions = 0
  const mockRelay = new MockRelay({
    seedEvents: [announcement],
    onSubscribe: (_subscriptionId, filters) => {
      if (filters.some(filter => filter["#a"]?.includes(repoAddress))) {
        activitySubscriptions += 1
      }
    },
  })

  await page.addInitScript(() => localStorage.clear())
  await mockRelay.setup(page)
  const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
  await page.goto(`/git/${naddr}/prs`)

  await expect.poll(() => activitySubscriptions).toBeGreaterThan(0)
  await expect(page.getByText(/Loading PRs/)).toBeVisible()
  await expect(page.getByText("No PRs found.", {exact: true})).toHaveCount(0)

  await mockRelay.injectEvents([pullRequest])

  await expect(page.getByText("Cold-start pull request", {exact: true})).toBeVisible({
    timeout: 10_000,
  })
})
