import {expect, test} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"

test.beforeEach(async ({page}) => {
  await new MockRelay().setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: external services unavailable"}),
  )
  await page.goto("/git")
  await expect(page.getByRole("button", {name: "New Repo", exact: true})).toBeVisible()
})

async function mountSettings(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/repository-identity.svelte.ts"
    )
    ;(window as any).__repoIdentityFixture = fixture.mountRepositoryIdentityFixture()
  })
  await expect(page.getByLabel("Repository identifier (d)")).toHaveValue("Legacy.Case")
}

test("display rename preserves d, upstreams and unknown metadata without publishing state", async ({
  page,
}) => {
  await mountSettings(page)
  const original = await page.evaluate(() => (window as any).__repoIdentityFixture.evidence())
  const identifier = page.getByLabel("Repository identifier (d)")
  await expect(identifier).toHaveAttribute("readonly", "")
  await page.getByLabel("Display name *", {exact: true}).fill("名前 with spaces!")
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Settings Saved", exact: true})).toBeVisible()
  const saved = await page.evaluate(() => (window as any).__repoIdentityFixture.evidence())
  expect(saved.published.map((event: any) => event.kind)).toEqual([30617])
  expect(saved.announcement.tags.filter((tag: string[]) => tag[0] !== "name")).toEqual(
    original.announcement.tags.filter((tag: string[]) => tag[0] !== "name"),
  )
  expect(saved.state).toEqual(original.state)
  expect(saved.announcement.content).toBe(original.announcement.content)
  await page.getByRole("button", {name: "Remove upstream 2", exact: true}).click()
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__repoIdentityFixture.evidence().published.length),
    )
    .toBe(2)
  expect(
    await page.evaluate(() =>
      (window as any).__repoIdentityFixture
        .evidence()
        .announcement.tags.filter((tag: string[]) => tag[0] === "u"),
    ),
  ).toEqual([original.announcement.tags.find((tag: string[]) => tag[0] === "u")])
  await page.setViewportSize({width: 390, height: 844})
  expect(
    await page
      .locator("[data-repository-identity-fixture]")
      .evaluate(el => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
})

test("stale forms and account changes cannot overwrite settings", async ({page}) => {
  await mountSettings(page)
  await page.getByLabel("Display name *", {exact: true}).fill("Draft")
  await page.evaluate(() => (window as any).__repoIdentityFixture.changeAnnouncement())
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect(page.getByRole("alert")).toContainText("changed while you were editing")
  expect(
    await page.evaluate(() => (window as any).__repoIdentityFixture.evidence().published),
  ).toEqual([])
  await page.getByRole("button", {name: "Reset", exact: true}).click()
  await page.getByLabel("Display name *", {exact: true}).fill("Another draft")
  await page.evaluate(() => (window as any).__repoIdentityFixture.switchActorDuringDelivery())
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect(page.getByRole("alert")).toContainText("owner account")
  expect(
    await page.evaluate(() => (window as any).__repoIdentityFixture.evidence().published),
  ).toEqual([])
})

test("a failed HEAD delivery retries the exact announcement and retains ref ancestry", async ({
  page,
}) => {
  await mountSettings(page)
  await page.getByLabel("Default branch *", {exact: true}).selectOption("next")
  await page.evaluate(() => (window as any).__repoIdentityFixture.failNextState())
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect(page.getByRole("alert")).toContainText("state delivery failed")
  await page.getByRole("button", {name: "Try again", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Settings Saved", exact: true})).toBeVisible()
  const evidence = await page.evaluate(() => (window as any).__repoIdentityFixture.evidence())
  expect(evidence.published.map((event: any) => event.kind)).toEqual([30617, 30617, 30618])
  expect(evidence.published[0].id).toBe(evidence.published[1].id)
  expect(evidence.state.tags).toContainEqual(["refs/heads/next", "2".repeat(40), "1".repeat(40)])
  expect(evidence.state.tags).toContainEqual(["HEAD", "ref: refs/heads/next"])
})

test("creation suggests a slug, respects manual identifiers, and treats failed availability as unknown", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/repository-identity.svelte.ts"
    )
    ;(window as any).__repoIdentityFixture = fixture.mountRepositoryIdentityFixture("creation")
  })
  const wizard = page.locator('[data-repository-identity-fixture="creation"]')
  await wizard.getByPlaceholder("wss://relay...").fill("wss://grasp.identity.test")
  await wizard.getByPlaceholder("wss://relay...").press("Enter")
  await wizard.getByRole("button", {name: "Next", exact: true}).click()
  await wizard.getByLabel("Display name *", {exact: true}).fill("My Great Repo!")
  await expect(wizard.getByLabel("Repository identifier *", {exact: true})).toHaveValue(
    "my-great-repo",
  )
  await wizard.getByLabel("Repository identifier *", {exact: true}).fill("chosen-id")
  await wizard.getByLabel("Display name *", {exact: true}).fill("名前 with spaces!")
  await expect(wizard.getByLabel("Repository identifier *", {exact: true})).toHaveValue("chosen-id")
  await expect(wizard.getByLabel("Repository coordinate")).toHaveText(
    `30617:${"a".repeat(64)}:chosen-id`,
  )
  await expect(wizard.getByText("⚠ Could not verify", {exact: true})).toBeVisible()
  await expect(wizard.getByRole("button", {name: "Next", exact: true})).toBeDisabled()
  expect(
    await page.evaluate(() => (window as any).__repoIdentityFixture.evidence().published),
  ).toEqual([])
})

test("an echoed announcement survives a lost publish result and retries without changing identity", async ({
  page,
}) => {
  await mountSettings(page)
  await page.getByLabel("Display name *", {exact: true}).fill("Retried name")
  await page.evaluate(() => (window as any).__repoIdentityFixture.loseNextAnnouncementResult())
  await page.getByRole("button", {name: "Save Changes", exact: true}).click()
  await expect(page.getByRole("alert")).toContainText("result lost")
  await page.getByRole("button", {name: "Try again", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Settings Saved", exact: true})).toBeVisible()
  const evidence = await page.evaluate(() => (window as any).__repoIdentityFixture.evidence())
  expect(evidence.published.map((event: any) => event.kind)).toEqual([30617, 30617])
  expect(evidence.published[0].id).toBe(evidence.published[1].id)
})

for (const sameCoordinate of [false, true]) {
  test(`fork naming distinguishes an independent fork from hosting (same coordinate: ${sameCoordinate})`, async ({
    page,
  }) => {
    await page.evaluate(async same => {
      const fixture = await import(/* @vite-ignore */ "/tests/e2e/fixtures/fork-dialog-browser.ts")
      fixture.openForkDialogFixture(same)
    }, sameCoordinate)
    const dialog = page.getByRole("dialog", {
      name: sameCoordinate ? "Add Repository Remote" : "Fork Repository",
      exact: true,
    })
    const name = dialog.getByLabel("Display name *", {exact: true})
    const identifier = dialog.getByLabel("Repository identifier *", {exact: true})
    await expect(identifier).toHaveValue("scroll-regression")
    if (sameCoordinate) {
      await expect(name).toHaveAttribute("readonly", "")
      await expect(
        dialog.getByText(
          "Adding hosting preserves the display name, upstreams, maintainers and other repository metadata.",
          {exact: false},
        ),
      ).toBeVisible()
      await expect(dialog.getByText("Inherited maintainer defaults", {exact: false})).toHaveCount(0)
    } else {
      await name.fill("My Great Fork!")
      await expect(identifier).toHaveValue("my-great-fork")
      await identifier.fill("fixed-fork-id")
      await name.fill("名前 with spaces")
      await expect(identifier).toHaveValue("fixed-fork-id")
      await expect(dialog.getByText("Inherited maintainer defaults", {exact: false})).toBeVisible()
    }
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
    await expect(dialog).toHaveCount(0)
  })
}
