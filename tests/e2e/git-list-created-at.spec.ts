import {expect, test} from "@playwright/test"
import {
  TEST_PUBKEYS,
  createIssue,
  createPullRequest,
  createRepoAnnouncement,
  encodeRepoNaddr,
  getRepoAddress,
  signTestEvent,
} from "./fixtures/events"
import {MockRelay} from "./helpers/mock-relay"

const relayUrl = "wss://git-list-created-at.test"
const today = new Date("2026-09-12T12:00:00Z")
const now = today.getTime() / 1000
const day = 86_400

for (const mode of ["issues", "prs"] as const) {
  test(`${mode} sort by displayed creation date in both directions`, async ({page}) => {
    const pageErrors: string[] = []
    page.on("pageerror", error => pageErrors.push(error.message))
    await page.clock.setFixedTime(today)
    const identifier = `created-at-${mode}`
    const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, identifier)
    const announcement = signTestEvent(
      createRepoAnnouncement({
        identifier,
        name: "Creation date sorting fixture",
        relays: [relayUrl],
        pubkey: TEST_PUBKEYS.alice,
        created_at: now - 500 * day,
      }),
    )
    // Issues imported newest-first have reversed synthetic Nostr timestamps.
    // PR validation currently rejects import tags, so PRs cover native sorting.
    const items = [
      {
        title: "Recent item",
        daysAgo: 70,
        created_at: now - 2,
        originalDate: String(now - 70 * day),
      },
      {
        title: "Old item",
        daysAgo: 442,
        created_at: now - 1,
        originalDate: String(now - 442 * day),
      },
      {title: "Native item", daysAgo: 200, created_at: now - 200 * day},
      {
        title: "Fallback item",
        daysAgo: 86,
        created_at: now - 86 * day,
        originalDate: "invalid",
      },
    ]
    const events = items.map((item, index) => {
      const options = {
        repoAddress,
        subject: item.title,
        content: "Creation date sorting regression fixture.",
        pubkey: TEST_PUBKEYS.charlie,
        created_at: mode === "issues" ? item.created_at : now - item.daysAgo * day,
      }
      const event =
        mode === "issues"
          ? createIssue(options)
          : createPullRequest({...options, tipCommitOid: String(index + 1).repeat(40)})
      if (mode === "issues" && item.originalDate !== undefined) {
        event.tags.push(["imported", ""], ["original_date", item.originalDate])
      }
      return signTestEvent(event)
    })
    const relay = new MockRelay({seedEvents: [announcement, ...events]})
    await relay.setup(page)
    const naddr = encodeRepoNaddr(TEST_PUBKEYS.alice, identifier, [relayUrl])
    await page.goto(`/git/${naddr}/${mode}`)

    const rows = page.locator(mode === "issues" ? "[data-issue-id]" : "[data-pr-id]")
    const titles = rows.getByRole("heading", {level: 3})
    const newestFirst = ["Recent item", "Fallback item", "Native item", "Old item"]
    await expect(rows).toHaveCount(items.length, {timeout: 10_000})
    for (const item of items) {
      await expect(
        rows.filter({has: page.getByRole("heading", {name: item.title, exact: true})}),
      ).toContainText(`Opened ${item.daysAgo} days ago`)
    }
    await expect(titles).toHaveText(newestFirst)

    await page.getByRole("button", {name: "More filters"}).click()
    await page.getByRole("button", {name: "Oldest", exact: true}).click()
    await expect(titles).toHaveText([...newestFirst].reverse())

    await page.getByRole("button", {name: "Newest", exact: true}).click()
    await expect(titles).toHaveText(newestFirst)

    // Cached roots must use the same creation date after a warm reload, too.
    await page.reload()
    await expect(titles).toHaveText(newestFirst, {timeout: 10_000})
    expect(pageErrors).toEqual([])
    expect(relay.getPublishedEvents()).toEqual([])
  })
}
