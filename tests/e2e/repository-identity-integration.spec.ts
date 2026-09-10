import {expect, test, type Page} from "@playwright/test"
import {nip19} from "nostr-tools"
import {createPullRequestEvent} from "@nostr-git/core/events"
import {MockRelay} from "./helpers/mock-relay"
import {
  createRepoAnnouncement,
  createRepoState,
  encodeRepoNaddr,
  signTestEvent,
  TEST_PUBKEYS,
} from "./fixtures/events"

const owner = TEST_PUBKEYS.alice
const relay = "wss://repository-identity-review.test/"
const renamedDisplay = "名前 with spaces!"
const makeAnnouncement = (identifier: string, name: string, created_at = 100) =>
  signTestEvent(
    createRepoAnnouncement({identifier, name, pubkey: owner, relays: [relay], created_at}),
  )
const original = makeAnnouncement("stable-id", "My Great Repo")
const renamed = makeAnnouncement("stable-id", renamedDisplay, 101)
const other = makeAnnouncement("other-id", renamedDisplay)
const pullRequest = signTestEvent({
  ...createPullRequestEvent({
    repoAddr: `30617:${owner}:stable-id`,
    subject: "PR emitted with a b target",
    content: "An already-pushed contribution accepted by the runtime validator.",
    tipCommitOid: "1".repeat(40),
    branchName: "contribution",
    targetBranch: "release",
    created_at: 102,
  }),
  pubkey: TEST_PUBKEYS.bob,
})
const path = (identifier: string) => `/git/${encodeRepoNaddr(owner, identifier, [relay])}`

test.beforeEach(async ({page}) => {
  await new MockRelay({seedEvents: [original, other, pullRequest]}).setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: network disabled"}),
  )
  await page.route("**/tests/e2e/fixtures/repository-identity-widget.html", route =>
    route.fulfill({
      path: "tests/e2e/fixtures/repository-identity-widget.html",
      contentType: "text/html",
    }),
  )
})

async function renameInReadCache(page: Page) {
  await page.evaluate(async event => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/repository-route-identity-browser.ts"
    )
    fixture.cacheRepositoryIdentityEvent(event)
  }, renamed)
}

async function openExtension(page: Page, identifier = "stable-id") {
  // Anonymous sessions hide extension tabs, but the route itself supports read-only context.
  await page.evaluate(
    async nextPath => {
      const fixture = await import(
        /* @vite-ignore */ "/tests/e2e/fixtures/repository-route-identity-browser.ts"
      )
      await fixture.navigateRepositoryIdentityRoute(nextPath)
    },
    `${path(identifier)}/extensions/identity-review`,
  )
}

test("a newly built b-target PR appears in the list and resolves its detail history", async ({
  page,
}) => {
  expect(pullRequest.tags).toContainEqual(["b", "release"])
  await page.goto(`${path("stable-id")}/prs`)
  await page.getByText("PR emitted with a b target", {exact: true}).click()
  await expect(
    page.getByRole("heading", {name: "PR emitted with a b target", exact: true}),
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/prs/${pullRequest.id}$`))
  await expect(page.getByText(pullRequest.content, {exact: true})).toBeVisible()
})

test("the actual overview keeps its exact Nostr clone URL through a display rename", async ({
  page,
}) => {
  await page.goto(path("stable-id"))
  await expect(page.locator("summary").filter({hasText: "Clone"})).toBeVisible()
  await page.locator("summary").filter({hasText: "Clone"}).click()
  const clone = page.locator("code").filter({hasText: /^nostr:\/\//})
  const expected = `nostr://${nip19.npubEncode(owner)}/stable-id`
  await expect(clone).toHaveText(expected)
  await renameInReadCache(page)
  await expect(page).toHaveTitle(renamedDisplay)
  await expect(clone).toHaveText(expected)
  expect(page.url()).toContain(path("stable-id"))
})

test("the real fork route delivers a different destination through state publication", async ({
  page,
}) => {
  await page.goto(path("stable-id"))
  await expect(page.locator("summary").filter({hasText: "Clone"})).toBeVisible()
  await page.evaluate(async owner => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/fork-publication-browser.ts"
    )
    fixture.setForkFixtureAccount(owner)
  }, TEST_PUBKEYS.bob)
  await page.getByRole("button", {name: "Fork", exact: true}).click()
  await expect(page.locator("#fork-name")).toHaveValue("my-great-repo")
  const identifier = "my-great-repo"
  const events = [
    signTestEvent(
      createRepoAnnouncement({
        identifier,
        name: "My Great Repo",
        pubkey: TEST_PUBKEYS.bob,
        relays: [relay],
      }),
    ),
    signTestEvent(
      createRepoState({
        identifier,
        pubkey: TEST_PUBKEYS.bob,
        head: "main",
        refs: [{type: "heads", name: "main", commit: "1".repeat(40)}],
      }),
    ),
  ]
  const results = await page.evaluate(async events => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/fork-publication-browser.ts"
    )
    return fixture.submitForkMetadataFixture(events)
  }, events)
  expect(results).toEqual(
    [30617, 30618].map(kind => ({
      kind,
      pubkey: TEST_PUBKEYS.bob,
      identifier,
      ackedRelays: [relay],
    })),
  )
})

test("the actual extension route preserves addresses and storage through rename and remount", async ({
  page,
}) => {
  await page.goto(path("stable-id"))
  await expect(page.locator("summary").filter({hasText: "Clone"})).toBeVisible()
  await page.evaluate(async () => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/repository-route-identity-browser.ts"
    )
    fixture.installRepositoryIdentityWidget()
  })
  await openExtension(page)
  const probe = () => page.frameLocator('iframe[title="Identity review"]')
  await expect(probe().locator("#context")).toContainText('"repoName": "stable-id"')
  const request = (action: string, payload: Record<string, unknown> = {}) =>
    probe()
      .locator("body")
      .evaluate((_el, args) => (window as any).identityProbe.request(args.action, args.payload), {
        action,
        payload,
      })
  await expect(request("context:getRepo")).resolves.toMatchObject({
    repoContext: {
      name: "stable-id",
      displayName: "My Great Repo",
      address: `30617:${owner}:stable-id`,
    },
  })
  await expect(
    request("storage:set", {key: "identity-review-cursor", data: {page: 3}, repoScoped: true}),
  ).resolves.toEqual({status: "ok"})
  await renameInReadCache(page)
  await expect(probe().locator("#context")).toContainText(`"repoDisplayName": "${renamedDisplay}"`)
  await expect(probe().locator("#context")).toContainText(`"contextId": "repo:${owner}:stable-id"`)
  await expect(request("context:getRepo")).resolves.toMatchObject({
    repoContext: {
      name: "stable-id",
      displayName: renamedDisplay,
      address: `30617:${owner}:stable-id`,
    },
  })
  // Recreate the route/bridge; this catches display-dependent extension instance IDs.
  await page
    .locator(`a[href="${path("stable-id")}"]`)
    .first()
    .click()
  await openExtension(page)
  await expect(probe().locator("#context")).toContainText('"repoName": "stable-id"')
  await expect(
    request("storage:get", {key: "identity-review-cursor", repoScoped: true}),
  ).resolves.toEqual({status: "ok", data: {page: 3}})

  await openExtension(page, "other-id")
  await expect(probe().locator("#context")).toContainText('"repoName": "other-id"')
  await expect(request("context:getRepo")).resolves.toMatchObject({
    repoContext: {
      name: "other-id",
      displayName: renamedDisplay,
      address: `30617:${owner}:other-id`,
    },
  })
  await expect(
    request("storage:get", {key: "identity-review-cursor", repoScoped: true}),
  ).resolves.toEqual({status: "ok", data: null})
})
