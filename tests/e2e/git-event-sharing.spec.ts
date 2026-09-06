import {expect, test, type Page} from "@playwright/test"
import {decode} from "nostr-tools/nip19"
import {
  BASE_TIMESTAMP,
  TEST_COMMITS,
  TEST_PUBKEYS,
  createIssue,
  createPullRequest,
  createPullRequestUpdate,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {seedDevSession} from "./helpers/dev-session"
import {MockRelay, type NostrEvent} from "./helpers/mock-relay"

const repoRelays = ["wss://git-share-primary.test", "wss://git-share-secondary.test"]
const identifier = "event-sharing-fixture"
const repoAddress = getRepoAddress(TEST_PUBKEYS.devUser, identifier)
// Discovering the repo on a different relay must not leak that relay into event shares.
const naddr = encodeRepoNaddr(TEST_PUBKEYS.devUser, identifier, ["wss://git-share-discovery.test"])
const repoPath = `/git/${naddr}`
const announcement = signTestEvent(
  createRepoAnnouncement({
    identifier,
    name: "Event sharing fixture",
    relays: [...repoRelays, `${repoRelays[0]}/`],
    pubkey: TEST_PUBKEYS.devUser,
    created_at: BASE_TIMESTAMP,
  }),
)
const issue = signTestEvent(
  createIssue({
    repoAddress,
    subject: "Share this issue without leaving the list",
    content: "Issue sharing regression fixture.",
    labels: ["sharing", "regression"],
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 1,
  }),
)
const pullRequest = signTestEvent(
  createPullRequest({
    repoAddress,
    subject: "Share this pull request without leaving the list",
    content: "Pull request sharing regression fixture.",
    tipCommitOid: TEST_COMMITS.second,
    labels: ["sharing", "regression"],
    branchName: "share-actions",
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 2,
  }),
)
const update = signTestEvent(
  createPullRequestUpdate({
    repoAddress,
    prEventId: pullRequest.id,
    tipCommitOid: TEST_COMMITS.third,
    pubkey: TEST_PUBKEYS.charlie,
    created_at: BASE_TIMESTAMP + 3,
  }),
)

const setupSharing = async (page: Page, extraEvents: NostrEvent[] = []) => {
  await page.addInitScript(() => {
    localStorage.clear()
    // Capture only this test's copy requests, without reading/writing the system clipboard.
    const copied: string[] = []
    ;(window as any).__sharedEventPointers = copied
    const execCommand = document.execCommand.bind(document)
    document.execCommand = (command, ...args) => {
      if (command !== "copy") return execCommand(command, ...args)
      const input = document.activeElement
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing share copy input")
      copied.push(input.value)
      return true
    }
  })
  const relay = new MockRelay({
    seedEvents: [announcement, issue, pullRequest, update, ...extraEvents],
  })
  await relay.setup(page)
  return relay
}

const expectSharedEvent = async (page: Page, event: NostrEvent, count: number) => {
  await expect
    .poll(() => page.evaluate(() => (window as any).__sharedEventPointers.length))
    .toBe(count)
  const pointer = await page.evaluate(() => (window as any).__sharedEventPointers.at(-1))
  expect(decode(pointer)).toEqual({
    type: "nevent",
    data: {
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
      relays: repoRelays.map(relay => `${relay}/`),
    },
  })
}

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`shares issue and PR cards and details as a guest (${viewport.name})`, async ({page}) => {
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    await page.setViewportSize(viewport)
    const relay = await setupSharing(page)

    for (const item of [
      {section: "issues", noun: "issue", event: issue},
      {section: "prs", noun: "pull request", event: pullRequest},
    ]) {
      const listPath = `${repoPath}/${item.section}`
      await page.goto(listPath)
      const card = page.locator(
        `[data-${item.section === "issues" ? "issue" : "pr"}-id="${item.event.id}"]`,
      )
      const shareButton = card.getByRole("button", {name: `Share ${item.noun}`, exact: true})
      await expect(shareButton).toBeVisible()
      const shareBounds = (await shareButton.boundingBox())!
      expect(shareBounds.x).toBeGreaterThanOrEqual(0)
      expect(shareBounds.x + shareBounds.width).toBeLessThanOrEqual(viewport.width)

      await shareButton.click()
      await expectSharedEvent(page, item.event, 1)
      await expect(page).toHaveURL(listPath)

      await shareButton.focus()
      await page.keyboard.press("Enter")
      await expectSharedEvent(page, item.event, 2)
      await page.keyboard.press("Space")
      await expectSharedEvent(page, item.event, 3)
      await expect(page).toHaveURL(listPath)

      await card.getByRole("heading").click()
      await expect(page).toHaveURL(`${listPath}/${item.event.id}`)
      const actions = page.getByRole("button", {name: `Open ${item.noun} actions`, exact: true})
      await expect(actions).toBeVisible()
      await expect(
        page.getByRole("button", {name: "Add reaction", exact: true}).first(),
      ).toBeVisible()
      await actions.click()
      await expect(
        page.getByRole("button", {name: `${item.noun} Details`, exact: true}),
      ).toBeVisible()
      await expect(
        page.getByRole("button", {name: `Delete ${item.noun}`, exact: true}),
      ).toHaveCount(0)
      await expect(page.getByRole("button", {name: "Report Content", exact: true})).toBeVisible()
      await page.getByRole("button", {name: "Share", exact: true}).click()
      await expectSharedEvent(page, item.event, 4)
      await expect(page).toHaveURL(`${listPath}/${item.event.id}`)

      await actions.click()
      await page.getByRole("button", {name: `${item.noun} Details`, exact: true}).click()
      const details = page.getByTestId("modal-root")
      await expect(details.getByText("Event Details", {exact: true})).toBeVisible()
      await expect(details.locator("code")).toContainText(item.event.id)
      await details.getByRole("button", {name: "Got it", exact: true}).click()
      await expect(actions).toBeVisible()
    }

    expect(relay.getPublishedEvents()).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test("a non-author repo owner can share the PR root from an update deep link", async ({page}) => {
  const relay = await setupSharing(page)
  await seedDevSession(page)
  await page.goto(`${repoPath}/prs/${update.id}`)

  await page.getByRole("button", {name: "Open pull request actions", exact: true}).click()
  await expect(page.getByRole("button", {name: "Hide spam", exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Delete pull request", exact: true})).toHaveCount(0)
  await page.getByRole("button", {name: "Share", exact: true}).click()
  await expectSharedEvent(page, pullRequest, 1)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("the PR author retains deletion alongside the full action pill", async ({page}) => {
  const ownPullRequest = signTestEvent(
    createPullRequest({
      repoAddress,
      subject: "Author action permissions",
      content: "The author can still access the deletion confirmation.",
      tipCommitOid: TEST_COMMITS.second,
      pubkey: TEST_PUBKEYS.devUser,
      created_at: BASE_TIMESTAMP + 4,
    }),
  )
  const relay = await setupSharing(page, [ownPullRequest])
  await seedDevSession(page)
  await page.goto(`${repoPath}/prs/${ownPullRequest.id}`)

  await expect(page.getByRole("button", {name: "Add reaction", exact: true}).first()).toBeVisible()
  await page.getByRole("button", {name: "Open pull request actions", exact: true}).click()
  await expect(page.getByRole("button", {name: "Delete pull request", exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Hide spam", exact: true})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Report Content", exact: true})).toHaveCount(0)
  await page.getByRole("button", {name: "Share", exact: true}).click()
  await expectSharedEvent(page, ownPullRequest, 1)
  expect(relay.getPublishedEvents()).toEqual([])
})
