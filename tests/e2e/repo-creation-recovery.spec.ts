import {expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"
import {signTestEvent, TEST_PUBKEYS} from "./fixtures/events"

const owner = TEST_PUBKEYS.alice
const relay = "wss://recovery-fixture.test/"
const identifier = "legacy:stable-id"
const current = signTestEvent({
  kind: 30617,
  pubkey: owner,
  created_at: 101,
  content: "Current owner content",
  tags: [
    ["d", identifier],
    ["name", "Current owner name"],
    ["description", "Owner-approved description"],
    ["u", "https://current-upstream.test/repo.git"],
    ["x-fixture", "preserve", "unchanged"],
    ["clone", "https://current-host.test/repo.git"],
    ["relays", relay],
  ],
})

for (const failState of [false, true]) {
  test(`real /git recovery reviews current metadata and resumes without Git mutation (interrupted state: ${failState})`, async ({
    page,
  }) => {
    const mock = new MockRelay({seedEvents: [current]})
    await mock.setup(page)
    await page.route("https://**", route =>
      route.fulfill({status: 503, body: "Fixture: external services blocked"}),
    )
    await page.goto("/git")
    await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()
    await page.evaluate(async failState => {
      const path = "/tests/e2e/fixtures/repo-creation-recovery-browser.ts"
      const fixture = await import(/* @vite-ignore */ path)
      fixture.installRecoveryFixture(failState)
    }, failState)
    const recovery = page.getByRole("region", {name: "Pending repository operations"})
    await expect(
      recovery.locator("summary", {hasText: "Review current owner metadata"}),
    ).toBeVisible()
    expect(mock.getPublishedEvents().filter(event => [30617, 30618].includes(event.kind))).toEqual(
      [],
    )
    await recovery.getByText("Review current owner metadata", {exact: true}).click()
    await expect(recovery.getByText("Current owner name", {exact: true})).toBeVisible()
    await expect(recovery.getByText("Owner only", {exact: true})).toBeVisible()
    await recovery.getByRole("button", {name: "Use current metadata and finish hosting"}).click()
    if (failState) {
      await expect(recovery.getByRole("status")).toContainText("Fixture state signer interrupted")
      const before = await page.evaluate(async () => {
        const path = "/tests/e2e/fixtures/repo-creation-recovery-browser.ts"
        return (await import(/* @vite-ignore */ path)).recoveryEvidence()
      })
      expect(before.records[0].publishedEvents).toHaveLength(1)
      expect(before.records[0].phase).toBe("metadata-preparing")
      await recovery.getByRole("button", {name: "Retry recovery", exact: true}).click()
    }
    await expect(recovery).toHaveCount(0)
    const events = mock.getPublishedEvents().filter(event => [30617, 30618].includes(event.kind))
    expect(events.map(event => event.kind)).toEqual(
      failState ? [30617, 30617, 30618] : [30617, 30618],
    )
    const announcement = events[0]
    expect(announcement.content).toBe(current.content)
    for (const tag of current.tags.filter(tag => tag[0] !== "clone"))
      expect(announcement.tags).toContainEqual(tag)
    expect(announcement.tags).toContainEqual([
      "clone",
      "https://current-host.test/repo.git",
      "https://github.com/fixture/recovery.git",
    ])
    expect(announcement.tags.some(tag => tag[0] === "maintainers")).toBe(false)
    for (const event of events) {
      expect(event.pubkey).toBe(owner)
      expect(event.tags).toContainEqual(["d", identifier])
    }
    if (failState) expect(events[0]).toEqual(events[1])
    const after = await page.evaluate(async () => {
      const path = "/tests/e2e/fixtures/repo-creation-recovery-browser.ts"
      return (await import(/* @vite-ignore */ path)).recoveryEvidence()
    })
    expect(after).toEqual({records: [], signedCount: 2})
  })
}
