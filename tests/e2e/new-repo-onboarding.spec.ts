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
async function open(page: Page, token = true) {
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
  await expect(page.getByRole("status").filter({hasText: "Public repository found"})).toContainText(
    `fixture/${name}`,
  )
}
async function next(page: Page) {
  await page.getByRole("button", {name: "Next", exact: true}).click()
}
async function chooseDestination(page: Page) {
  await next(page)
  await page.getByRole("checkbox", {name: "Codeberg / Forgejo codeberg.org", exact: true}).check()
  await expect(page.getByText("Destination account: fixture-target", {exact: true})).toBeVisible()
  await next(page)
}

test("source inspection works without a destination token but importing requires a destination", async ({
  page,
}) => {
  await open(page, false)
  await inspect(page)
  await next(page)
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await expect(page.getByRole("radio", {name: "Announce only", exact: true})).toHaveCount(0)
  await expect(page.getByRole("checkbox", {name: /Codeberg/})).toBeDisabled()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.relayReads).toBe(0)
  expect(evidence.events).toEqual([])
  expect(evidence.mutations).toEqual([])
})

test("anonymous source and mandatory copy preserve edits and announce the verified destination", async ({
  page,
}) => {
  await open(page)
  await inspect(page)
  expect(
    await page.evaluate(
      async fixture => (await import(/* @vite-ignore */ fixture)).evidence.relayReads,
      fixture,
    ),
  ).toBe(0)
  await next(page)
  await expect(page.getByRole("radio", {name: "Announce only", exact: true})).toHaveCount(0)
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await page.getByRole("checkbox", {name: "Codeberg / Forgejo codeberg.org", exact: true}).check()
  await next(page)
  await page.getByLabel("Display name *", {exact: true}).fill("Edited display")
  await page.getByLabel("Repository identifier *", {exact: true}).fill("edited-identifier")
  await page.getByLabel("Description (optional)").fill("Edited description")
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", {name: "Previous", exact: true}).click()
  await page.getByRole("button", {name: "Check again", exact: true}).click()
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
  await expect(
    page.getByText("https://codeberg.org/fixture-target/edited-identifier.git", {exact: true}),
  ).toBeVisible()
  await page.getByRole("button", {name: "Import and announce", exact: true}).click()
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
  expect(evidence.result.stateEvent.kind).toBe(30618)
  expect(evidence.result.announcementEvent.tags).toContainEqual([
    "clone",
    "https://codeberg.org/fixture-target/edited-identifier.git",
  ])
  expect(evidence.result.announcementEvent.tags).toContainEqual(["d", "edited-identifier"])
  expect(evidence.requests.filter((url: string) => url.endsWith("/repos/fixture/public"))).toEqual(
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
  await page.getByRole("button", {name: "Import and announce", exact: true}).click()
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

test("invalid, private/missing, stale, empty and oversized sources fail with actionable errors", async ({
  page,
}) => {
  await open(page)
  const url = page.getByLabel("Repository URL", {exact: true})
  await url.fill("https://bitbucket.org/owner/repo")
  await expect(page.getByRole("alert")).toContainText(/not supported|disabled|retired/i)
  await url.fill("https://codeberg.org/fixture/private")
  await expect(page.getByRole("alert")).toContainText(/public|private|not found/i)
  await url.fill("https://codeberg.org/fixture/slow")
  await expect
    .poll(() =>
      page.evaluate(
        async fixture =>
          (await import(/* @vite-ignore */ fixture)).evidence.requests.some((url: string) =>
            url.endsWith("/fixture/slow"),
          ),
        fixture,
      ),
    )
    .toBe(true)
  await url.fill("https://codeberg.org/fixture/empty")
  await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).finishSlowInspection(),
    fixture,
  )
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await expect(page.getByRole("alert")).toContainText("no Git history to copy")
  await url.fill("https://github.com/fixture/large")
  await expect(page.getByRole("alert")).toContainText("50 MiB")
  await expect(page.getByRole("alert")).toContainText("local Git client")
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
})

test("automatic source check debounces input, flags duplicates, resets consent and prevents d-tag reuse", async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844})
  await open(page)
  await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).addExistingAnnouncement(),
    fixture,
  )
  const url = page.getByLabel("Repository URL", {exact: true})
  await url.fill("https://codeberg.org/fixture/private")
  await url.fill("https://codeberg.org/fixture/public.git/")
  await expect(page.getByText("Public repository available", {exact: true})).toBeVisible()
  await expect(page.getByLabel("Repository server software")).toHaveCount(0)
  await expect(page.getByRole("checkbox", {name: "Import anyway", exact: true})).toHaveCount(0)
  await chooseDestination(page)
  await expect(
    page.getByText("You already announced this source repository.", {exact: true}),
  ).toBeVisible()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  const consent = page.getByRole("checkbox", {name: "Import anyway", exact: true})
  await consent.focus()
  await page.keyboard.press("Space")
  await expect(page.getByRole("alert").filter({hasText: 'identifier "public"'})).toBeVisible()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await page.getByLabel("Repository identifier *", {exact: true}).fill("public-second-announcement")
  await expect(page.getByText("✓ Nostr repository identifier available")).toBeVisible()
  await page.evaluate(async fixture => {
    ;(await import(/* @vite-ignore */ fixture)).preflight.occupied = true
  }, fixture)
  await page.getByLabel("Repository identifier *", {exact: true}).fill("occupied-copy")
  await expect(page.getByText("✗ Taken", {exact: true})).toBeVisible()
  await expect(consent).toBeChecked()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await page.evaluate(async fixture => {
    ;(await import(/* @vite-ignore */ fixture)).preflight.occupied = false
  }, fixture)
  await page.getByLabel("Repository identifier *", {exact: true}).fill("public-second-announcement")
  await page.getByRole("button", {name: "Previous", exact: true}).click()
  await page.getByRole("button", {name: "Previous", exact: true}).click()
  await page.getByRole("button", {name: "Check again", exact: true}).click()
  await expect(page.getByText("Public repository available", {exact: true})).toBeVisible()
  await next(page)
  await next(page)
  await expect(consent).not.toBeChecked()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await consent.check()
  await expect(page.getByLabel("Repository identifier *", {exact: true})).toHaveValue(
    "public-second-announcement",
  )
  await next(page)
  await page.getByRole("button", {name: "Import and announce", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Repository Created Successfully!"})).toBeVisible()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.mutations).toContain("create-destination")
  expect(evidence.requests.filter((url: string) => url.endsWith("/repos/fixture/public"))).toEqual(
    Array(3).fill("GET https://codeberg.org/api/v1/repos/fixture/public"),
  )
  expect(evidence.events[0].tags).toContainEqual(["d", "public-second-announcement"])
})

test("incomplete inventory needs consent or retry; new duplicate at final preflight returns for consent", async ({
  page,
}) => {
  await open(page)
  await page.evaluate(async fixture => {
    ;(await import(/* @vite-ignore */ fixture)).preflight.inventoryUnavailable = true
  }, fixture)
  await inspect(page)
  await chooseDestination(page)
  await expect(page.getByText("Some relays could not be checked.", {exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  await page.evaluate(async fixture => {
    ;(await import(/* @vite-ignore */ fixture)).preflight.inventoryUnavailable = false
  }, fixture)
  await page.getByRole("button", {name: "Retry relay checks", exact: true}).click()
  await expect(page.getByText("Some relays could not be checked.", {exact: true})).toHaveCount(0)
  await next(page)
  await page.evaluate(
    async fixture =>
      (await import(/* @vite-ignore */ fixture)).addExistingAnnouncement("another-identifier"),
    fixture,
  )
  await page.getByRole("button", {name: "Import and announce", exact: true}).click()
  await expect(page.getByRole("checkbox", {name: "Import anyway", exact: true})).toBeVisible()
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.mutations).toEqual([])
  expect(evidence.events).toEqual([])
})

for (const failure of ["inventoryUnavailable", "coordinateUnavailable"] as const) {
  test(`${failure} lists relay coverage and requires Import anyway before copying and announcing`, async ({
    page,
  }) => {
    await open(page)
    await page.evaluate(
      async ({fixture, failure}) => {
        ;(await import(/* @vite-ignore */ fixture)).preflight[failure] = true
      },
      {fixture, failure},
    )
    await inspect(page)
    await chooseDestination(page)
    await expect(page.getByText("Some relays could not be checked.", {exact: true})).toBeVisible()
    await expect(page.getByText("Relays checked successfully: 1", {exact: true})).toBeVisible()
    await expect(page.getByText("✓ wss://metadata.fixture.test/", {exact: true})).toBeVisible()
    await expect(page.getByText(/Fixture relay timed out/)).toBeVisible()
    await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
    await page.getByRole("checkbox", {name: "Import anyway", exact: true}).check()
    await next(page)
    await page.getByRole("button", {name: "Import and announce", exact: true}).click()
    await expect(
      page.getByRole("heading", {name: "Repository Created Successfully!"}),
    ).toBeVisible()
    const evidence = await page.evaluate(
      async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
      fixture,
    )
    expect(evidence.mutations).toContain("create-destination")
    expect(evidence.result.stateEvent.kind).toBe(30618)
  })
}

test("final preflight rejects an identifier taken after the details check", async ({page}) => {
  await open(page)
  await inspect(page)
  await chooseDestination(page)
  await expect(page.getByText("✓ Nostr repository identifier available")).toBeVisible()
  await next(page)
  await page.evaluate(
    async fixture =>
      (await import(/* @vite-ignore */ fixture)).addExistingAnnouncement(
        "public",
        "https://codeberg.org/fixture/another-repo.git",
      ),
    fixture,
  )
  await page.getByRole("button", {name: "Import and announce", exact: true}).click()
  await expect(page.getByLabel("Repository identifier *", {exact: true})).toHaveValue("public")
  await expect(page.getByRole("alert").first()).toContainText('identifier "public"')
  await expect(page.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  const evidence = await page.evaluate(
    async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
    fixture,
  )
  expect(evidence.mutations).toEqual([])
  expect(evidence.events).toEqual([])
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

for (const failure of ["occupied", "actorChanged"] as const) {
  test(`final ${failure} preflight failure is visible and returns to editable settings`, async ({
    page,
  }) => {
    await open(page, true)
    await inspect(page)
    await chooseDestination(page)
    await page.getByLabel("Repository identifier *", {exact: true}).fill("preflight-retry")
    await expect(page.getByText("Available on checked destinations.", {exact: true})).toBeVisible()
    await next(page)
    await page.evaluate(
      async ({fixture, failure}) => {
        ;(await import(/* @vite-ignore */ fixture)).preflight[failure] = true
      },
      {fixture, failure},
    )
    await page.getByRole("button", {name: "Import and announce", exact: true}).click()
    await expect(page.getByRole("alert")).toContainText(
      failure === "occupied" ? "Destination availability changed" : "active account changed",
    )
    await expect(page.getByRole("button", {name: "Previous", exact: true})).toBeVisible()
    await expect(page.getByText("Ready to Create Repository", {exact: true})).toHaveCount(0)
    const evidence = await page.evaluate(
      async fixture => (await import(/* @vite-ignore */ fixture)).evidence,
      fixture,
    )
    expect(evidence.mutations).toEqual([])
    expect(evidence.events).toEqual([])
    if (failure === "occupied") {
      await expect(page.getByLabel("Repository identifier *", {exact: true})).toHaveValue(
        "preflight-retry",
      )
      await page.evaluate(async fixture => {
        ;(await import(/* @vite-ignore */ fixture)).preflight.occupied = false
      }, fixture)
      await page.getByLabel("Repository identifier *", {exact: true}).fill("preflight-corrected")
      await expect(
        page.getByText("Available on checked destinations.", {exact: true}),
      ).toBeVisible()
      await next(page)
      await page.getByRole("button", {name: "Import and announce", exact: true}).click()
      await expect(
        page.getByRole("heading", {name: "Repository Created Successfully!"}),
      ).toBeVisible()
    }
  })
}
