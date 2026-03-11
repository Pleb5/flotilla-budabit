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
import {
  createOpenStatus,
  createPullRequest,
  createPullRequestUpdate,
  signTestEvent,
  TEST_COMMITS,
  TEST_PUBKEYS,
} from "../fixtures/events"

const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

useCleanState(test)

test.describe("Patch/PR Deletion", () => {
  test("publishes deletion for pull request root and authored related events", async ({page}) => {
    const seeder = new TestSeeder()
    const repoResult = seeder.seedRepo({
      name: "patch-delete-repo",
      description: "Repository for patch/PR deletion tests",
    })

    const prTitle = "Delete me PR"
    const prEvent = signTestEvent(
      createPullRequest({
        content: "This pull request should be deleted.",
        repoAddress: repoResult.address,
        subject: prTitle,
        tipCommitOid: TEST_COMMITS.feature,
        pubkey: TEST_PUBKEYS.devUser,
      }),
    )

    const prUpdate = signTestEvent(
      createPullRequestUpdate({
        repoAddress: repoResult.address,
        prEventId: prEvent.id,
        tipCommitOid: TEST_COMMITS.third,
        pubkey: TEST_PUBKEYS.devUser,
      }),
    )

    const prStatus = signTestEvent(
      createOpenStatus(prEvent.id, {
        content: "PR opened",
        repoAddress: repoResult.address,
        pubkey: TEST_PUBKEYS.devUser,
      }),
    )

    seeder.addEvents([prEvent as NostrEvent, prUpdate as NostrEvent, prStatus as NostrEvent])

    await seeder.setup(page)
    await loginAndAssertIdentity(page)

    const repo = seeder.getRepos()[0]
    const repoIdentifier = repo.tags.find(t => t[0] === "d")?.[1] || ""
    const naddr = encodeRepoNaddr(repo.pubkey, repoIdentifier)

    const repoDetail = new RepoDetailPage(page, ENCODED_RELAY, naddr)
    await repoDetail.goto()
    await repoDetail.goToPatches()
    await page.waitForTimeout(1000)

    await expect(page.getByText(prTitle, {exact: false}).first()).toBeVisible({timeout: 10000})

    const menuButton = page.locator("div[role='group'] button").last()
    await expect(menuButton).toBeVisible({timeout: 5000})
    await menuButton.click()

    const deleteButton = page
      .locator("button")
      .filter({hasText: /delete pull request|delete patch/i})
      .first()
    await expect(deleteButton).toBeVisible({timeout: 5000})
    await deleteButton.click()

    const modalRoot = page.getByTestId("modal-root")
    await expect(
      modalRoot.getByRole("heading", {name: /delete (pull request|patch)/i}),
    ).toBeVisible({
      timeout: 5000,
    })

    await modalRoot.locator("form").evaluate(form => {
      ;(form as HTMLFormElement).requestSubmit()
    })

    const mockRelay = seeder.getMockRelay()

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === prEvent.id),
      1,
      15000,
    )

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === prUpdate.id),
      1,
      15000,
    )

    await mockRelay.waitForEvents(
      event => event.kind === 5 && getTags(event, "e").some(tag => tag[1] === prStatus.id),
      1,
      15000,
    )
  })
})
