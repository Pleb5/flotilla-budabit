import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  useCleanState,
  encodeRepoNaddr,
  getTags,
  loginAndAssertIdentity,
  type NostrEvent,
} from "../helpers"
import {RepoDetailPage} from "../pages"
import {createLabel, LABEL_NAMESPACES, signTestEvent, TEST_PUBKEYS} from "../fixtures/events"

const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

useCleanState(test)

test.describe("Issue Deletion", () => {
  test("publishes deletion for issue and author labels", async ({page}) => {
    const seeder = new TestSeeder()
    const repoResult = seeder.seedRepo({
      name: "issue-delete-repo",
      description: "Repository for issue deletion tests",
    })

    const issueTitle = "Delete me issue"
    const issueResult = seeder.seedIssue({
      repoAddress: repoResult.address,
      title: issueTitle,
      content: "This issue should be deleted.",
      status: "open",
      pubkey: TEST_PUBKEYS.devUser,
    })

    const labelA = signTestEvent(
      createLabel({
        labels: [{namespace: LABEL_NAMESPACES.TYPE, value: "bug"}],
        targets: {events: [issueResult.eventId]},
        pubkey: TEST_PUBKEYS.devUser,
      }),
    )

    const labelB = signTestEvent(
      createLabel({
        labels: [{namespace: LABEL_NAMESPACES.PRIORITY, value: "high"}],
        targets: {events: [issueResult.eventId]},
        pubkey: TEST_PUBKEYS.devUser,
      }),
    )

    seeder.addEvents([labelA as NostrEvent, labelB as NostrEvent])

    await seeder.setup(page)
    await loginAndAssertIdentity(page)

    const repos = seeder.getRepos()
    const repo = repos[0]
    const repoIdentifier = repo.tags.find(t => t[0] === "d")?.[1] || ""
    const naddr = encodeRepoNaddr(repo.pubkey, repoIdentifier)

    const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
    await repoDetail.goto()
    await repoDetail.goToIssues()
    await page.waitForTimeout(1000)

    const issueLink = page.getByRole("link", {name: issueTitle}).first()
    await expect(issueLink).toBeVisible({timeout: 10000})
    await issueLink.click()
    await page.waitForTimeout(1000)

    const issueHeader = page.getByRole("heading", {name: issueTitle}).first()
    await expect(issueHeader).toBeVisible({timeout: 10000})

    const actionsGroup = issueHeader.locator("..").locator("div[role='group']").first()
    const menuButton = actionsGroup.locator("button").last()
    await menuButton.click()

    const deleteButton = page
      .locator("button")
      .filter({hasText: /delete issue/i})
      .first()
    await expect(deleteButton).toBeVisible({timeout: 5000})
    await deleteButton.click()

    const modalRoot = page.getByTestId("modal-root")
    await expect(modalRoot.getByRole("heading", {name: /delete issue/i})).toBeVisible({
      timeout: 5000,
    })

    const confirmButton = modalRoot.getByRole("button", {name: /confirm/i})
    await expect(confirmButton).toBeVisible({timeout: 5000})
    await modalRoot.locator("form").evaluate(form => {
      ;(form as HTMLFormElement).requestSubmit()
    })
    await expect(modalRoot.getByRole("heading", {name: /delete issue/i})).toHaveCount(0)

    const mockRelay = seeder.getMockRelay()

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === issueResult.eventId),
      1,
      15000,
    )

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === labelA.id),
      1,
      15000,
    )

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === labelB.id),
      1,
      15000,
    )
  })
})
