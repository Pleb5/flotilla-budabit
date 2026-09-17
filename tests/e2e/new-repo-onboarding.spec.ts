import {expect, test, type Page} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

const fixture = "/tests/e2e/fixtures/new-repo-onboarding-browser.ts"
const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({page}) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.stack || error.message || "Unknown page error"))
})
test.afterEach(async ({page}) => {
  expect(pageErrors.get(page)).toEqual([])
})
async function open(page: Page, token = false) {
  const relay = new MockRelay()
  await relay.setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: external services blocked"}),
  )
  await page.goto("/git")
  await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()
  await page.evaluate(
    async ({fixture, token}) =>
      (await import(/* @vite-ignore */ fixture)).openOnboardingFixture(token),
    {fixture, token},
  )
  await page.getByRole("radio", {name: "Import an existing Repo", exact: true}).check()
}
async function inspect(page: Page, name = "public") {
  await page
    .getByLabel("Repository URL", {exact: true})
    .fill(`https://codeberg.org/fixture/${name}.git/`)
  await page.getByRole("button", {name: "Inspect repository", exact: true}).click()
  await expect(page.getByRole("status").filter({hasText: "Public repository found"})).toContainText(
    `fixture/${name}`,
  )
}
async function next(page: Page) {
  await page.getByRole("button", {name: "Next", exact: true}).click()
}

test("anonymous announcement preserves edits, has no author/init requirements and no Git mutations", async ({
  page,
}) => {
  await open(page)
  await inspect(page)
  await next(page)
  await expect(page.getByRole("radio", {name: "Announce only", exact: true})).toBeChecked()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await next(page)
  await page.getByLabel("Display name *", {exact: true}).fill("Edited display")
  await page.getByLabel("Repository identifier *", {exact: true}).fill("edited-identifier")
  await page.getByLabel("Description (optional)").fill("Edited description")
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", {name: "Previous", exact: true}).click()
  await page.getByRole("button", {name: "Inspect repository", exact: true}).click()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeEnabled()
  await next(page)
  await next(page)
  await expect(page.getByLabel("Display name *", {exact: true})).toHaveValue("Edited display")
  await expect(page.getByLabel("Repository identifier *", {exact: true})).toHaveValue(
    "edited-identifier",
  )
  await expect(page.getByLabel("Description (optional)")).toHaveValue("Edited description")
  await expect(page.getByRole("checkbox", {name: /Add a README file/})).toHaveCount(0)
  await next(page)
  await expect(page.getByLabel("Author Name *", {exact: true})).toHaveCount(0)
  await page.getByRole("button", {name: "Announce Repository", exact: true}).click()
  await expect(
    page.getByRole("heading", {name: "Repository Announced Successfully!"}),
  ).toBeVisible()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.mutations).toEqual([])
  expect(evidence.events.map((event: any) => event.kind)).toEqual([30617])
  expect(evidence.result.stateEvent).toBeUndefined()
  expect(evidence.result.announcementEvent.tags).toContainEqual(["d", "edited-identifier"])
  expect(evidence.requests.filter((url: string) => url.includes("codeberg.org"))).toEqual(
    Array(3).fill("GET https://codeberg.org/api/v1/repos/fixture/public"),
  )
})

test("copy targets require valid GRASP servers even with another target; nested input and keyboard work at narrow width", async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844})
  await open(page, true)
  await inspect(page)
  await next(page)
  await page.getByRole("radio", {name: "Copy to target remotes", exact: true}).check()
  const grasp = page.getByRole("checkbox", {name: "GRASP Uses your Nostr signer", exact: true})
  await page.getByRole("checkbox", {name: "Codeberg / Forgejo codeberg.org", exact: true}).check()
  await grasp.check()
  await expect(
    page.getByText("Select at least one valid GRASP server below to continue."),
  ).toBeVisible()
  await expect(page.getByText(/^Ready:/)).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await page.getByLabel("Custom GRASP server").fill("wss://grasp.fixture.test")
  await page.getByLabel("Custom GRASP server").press("Enter")
  await expect(grasp).toBeChecked()
  await expect(page.getByText("1 server selected", {exact: true})).toBeVisible()
  await grasp.focus()
  await page.keyboard.press("Space")
  await expect(grasp).not.toBeChecked()
  expect(
    await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await next(page)
  await page.getByLabel("Repository identifier *", {exact: true}).fill("copied")
  await expect(page.getByText("Available on checked destinations.", {exact: true})).toBeVisible()
  await next(page)
  await page.getByRole("button", {name: "Copy and Announce Repository", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Repository Created Successfully!"})).toBeVisible()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.mutations).toEqual([
    "clone",
    "create-destination",
    "push:refs/heads/trunk",
    "push:refs/tags/v1",
    "cleanup",
  ])
  expect(evidence.result.announcementEvent.tags).toContainEqual([
    "clone",
    "https://codeberg.org/fixture-target/copied.git",
  ])
  expect(
    evidence.result.announcementEvent.tags.some((tag: string[]) => tag[0] === "upstream"),
  ).toBe(false)
})

test("invalid, private/missing and stale sources fail safely; empty source remains announcement-only", async ({
  page,
}) => {
  await open(page)
  const url = page.getByLabel("Repository URL", {exact: true})
  const inspectButton = page.getByRole("button", {name: "Inspect repository", exact: true})
  await url.fill("https://bitbucket.org/owner/repo")
  await inspectButton.click()
  await expect(page.getByRole("alert")).toContainText(/not supported|disabled|retired/i)
  await url.fill("https://codeberg.org/fixture/private")
  await inspectButton.click()
  await expect(page.getByRole("alert")).toContainText(/public|private|not found/i)
  await url.fill("https://codeberg.org/fixture/slow")
  await inspectButton.click()
  await url.fill("https://codeberg.org/fixture/empty")
  await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).finishSlowInspection(),
    fixture,
  )
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await inspect(page, "empty")
  await next(page)
  await expect(
    page.getByRole("radio", {name: "Copy to target remotes", exact: true}),
  ).toBeDisabled()
  await expect(page.getByRole("radio", {name: "Announce only", exact: true})).toBeChecked()
})

test("brand new repository retains initialization and explicit author controls", async ({page}) => {
  await open(page, true)
  await page.getByRole("radio", {name: "Brand new Repo", exact: true}).check()
  await next(page)
  await page.getByRole("checkbox", {name: "Codeberg / Forgejo codeberg.org", exact: true}).check()
  await next(page)
  await expect(page.getByRole("checkbox", {name: /Add a README file/})).toBeVisible()
  await expect(page.getByLabel("Default branch name", {exact: true})).toBeVisible()
  await page.getByLabel("Display name *", {exact: true}).fill("Brand new fixture")
  await expect(page.getByText("Available on checked destinations.", {exact: true})).toBeVisible()
  await next(page)
  await expect(page.getByLabel("Author Name *", {exact: true})).toBeVisible()
  await expect(page.getByLabel("Author Email *", {exact: true})).toBeVisible()
  await expect(page.getByLabel("Clone URL 1", {exact: true})).toHaveValue(
    "https://codeberg.org/fixture-target/brand-new-fixture.git",
  )
  await expect(page.getByRole("button", {name: "Create Repository", exact: true})).toBeDisabled()
  // No actual new repository creation: initialization stays covered by the existing hook suites.
})
