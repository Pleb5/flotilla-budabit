import {expect, test, type Page} from "@playwright/test"
import {MockRelay} from "./helpers/mock-relay"
import {TEST_PUBKEYS, type RepoAnnouncementOptions} from "./fixtures/events"
import {
  createOverviewMetadataAnnouncement,
  overviewMetadata,
  overviewMetadataPath,
} from "./fixtures/repo-overview-metadata"

async function setupOverview(
  page: Page,
  pubkey?: string,
  changes: Partial<RepoAnnouncementOptions> = {},
) {
  await page.addInitScript(actor => {
    if (actor) {
      // View-only test identity: no signer or private key is installed in the app.
      localStorage.setItem("pubkey", JSON.stringify(actor))
      localStorage.setItem("sessions", JSON.stringify({[actor]: {method: "pubkey", pubkey: actor}}))
    }
    // Capture this page's copy requests without using the system clipboard.
    const copied: string[] = []
    ;(window as any).__copiedRepoMetadata = copied
    const execCommand = document.execCommand.bind(document)
    document.execCommand = (command, ...args) => {
      if (command !== "copy") return execCommand(command, ...args)
      const input = document.activeElement
      if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing metadata copy input")
      copied.push(input.value)
      return true
    }
  }, pubkey)
  const relay = new MockRelay({seedEvents: [createOverviewMetadataAnnouncement(changes)]})
  await relay.setup(page)
  await page.route("https://**", route =>
    route.fulfill({status: 503, body: "Fixture: external services unavailable"}),
  )
  return relay
}

for (const viewer of [
  {name: "guest", pubkey: undefined, width: 1280, height: 900},
  {name: "maintainer", pubkey: TEST_PUBKEYS.maintainer, width: 390, height: 844},
  {name: "other reader", pubkey: TEST_PUBKEYS.bob, width: 1280, height: 900},
]) {
  test(`${viewer.name} can read and copy repository metadata without settings access`, async ({
    page,
  }) => {
    const pageErrors: Error[] = []
    page.on("pageerror", error => pageErrors.push(error))
    await page.setViewportSize({width: viewer.width, height: viewer.height})
    const relay = await setupOverview(page, viewer.pubkey)
    await page.goto(overviewMetadataPath)

    const about = page.getByRole("region", {name: "About", exact: true})
    await expect(about.locator("strong")).toHaveText("read-only overview")
    await expect(about).toContainText("End of full description.")
    await expect(about.getByRole("link", {name: "contribution guide"})).toHaveAttribute(
      "href",
      "https://example.test/contributing",
    )
    await expect(
      about.getByRole("list", {name: "Repository topics"}).getByRole("listitem"),
    ).toHaveText(["nostr", "svelte", overviewMetadata.hashtags.at(-1)!])

    const technical = page.getByTestId("repo-technical-details")
    await expect(technical).not.toHaveAttribute("open", "")
    await expect(technical.getByTestId("repo-identifier")).not.toBeVisible()
    // Native details must also work without a pointer.
    await technical.locator("summary").focus()
    await page.keyboard.press("Enter")
    await expect(technical).toHaveAttribute("open", "")
    await expect(technical.getByTestId("repo-identifier")).toHaveText(overviewMetadata.identifier)
    await expect(technical.getByTestId("repo-earliest-unique-commit")).toHaveText(
      overviewMetadata.earliestUniqueCommit,
    )
    await expect(
      technical.locator("input, textarea, select, [contenteditable='true']"),
    ).toHaveCount(0)
    await technical.getByRole("button", {name: "Copy repository identifier", exact: true}).click()
    await technical.getByRole("button", {name: "Copy earliest unique commit", exact: true}).click()
    expect(await page.evaluate(() => (window as any).__copiedRepoMetadata)).toEqual([
      overviewMetadata.identifier,
      overviewMetadata.earliestUniqueCommit,
    ])
    expect(await about.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    // Wait for the disclosure chevron's rotation to finish before measuring overflow.
    await expect.poll(() => technical.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await expect(page.locator(`[data-repo-tabs] a[href$="/settings"]`)).toHaveCount(0)
    await page.goto(`${overviewMetadataPath}/settings`)
    await expect(
      page.getByText("Only the repository owner can edit repository settings.", {exact: true}),
    ).toBeVisible()
    await expect(page.getByRole("button", {name: "Save Changes", exact: true})).toHaveCount(0)
    expect(relay.getPublishedEvents()).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test("missing optional metadata stays empty instead of inventing values", async ({page}) => {
  const relay = await setupOverview(page, undefined, {
    description: " ",
    hashtags: [],
    earliestUniqueCommit: undefined,
  })
  await page.goto(overviewMetadataPath)
  const technical = page.getByTestId("repo-technical-details")
  await technical.locator("summary").click()
  await expect(technical.getByTestId("repo-identifier")).toHaveText(overviewMetadata.identifier)
  await expect(page.getByRole("region", {name: "About", exact: true})).toHaveCount(0)
  await expect(technical.getByText("Not set", {exact: true})).toBeVisible()
  await expect(technical.getByRole("button", {name: "Copy earliest unique commit"})).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("topics remain visible without a description", async ({page}) => {
  await setupOverview(page, undefined, {description: "", hashtags: ["nostr"]})
  await page.goto(overviewMetadataPath)
  const about = page.getByRole("region", {name: "About", exact: true})
  await expect(
    about.getByRole("list", {name: "Repository topics"}).getByRole("listitem"),
  ).toHaveText(["nostr"])
  await expect(page.getByTestId("repo-description")).toHaveCount(0)
})

test("repository descriptions use the sanitized Markdown renderer", async ({page}) => {
  await setupOverview(page, undefined, {
    description:
      "Safe **description**.<script>window.__unsafeRepoDescription = true</script>" +
      '<a href="javascript:alert(1)">unsafe link</a>',
  })
  await page.goto(overviewMetadataPath)
  const description = page.getByTestId("repo-description")
  await expect(description.locator("strong")).toHaveText("description")
  await expect(description.locator('script, [href^="javascript:"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__unsafeRepoDescription)).toBeUndefined()
})

test("metadata refreshes after a display rename without changing the repository identifier", async ({
  page,
}) => {
  const relay = await setupOverview(page)
  await page.goto(overviewMetadataPath)
  const technical = page.getByTestId("repo-technical-details")
  await technical.locator("summary").click()
  await expect(technical.getByTestId("repo-earliest-unique-commit")).toHaveText(
    overviewMetadata.earliestUniqueCommit,
  )

  const replacement = createOverviewMetadataAnnouncement({
    name: "A renamed repository",
    description: "Updated **description** for readers.",
    hashtags: ["updated"],
    earliestUniqueCommit: "abcdef1234567890abcdef1234567890abcdef12",
    created_at: overviewMetadata.created_at + 1,
  })
  await page.evaluate(async event => {
    const fixture = await import(
      /* @vite-ignore */ "/tests/e2e/fixtures/repository-route-identity-browser.ts"
    )
    fixture.cacheRepositoryIdentityEvent(event)
  }, replacement)

  await expect(page).toHaveTitle("A renamed repository")
  await expect(page.getByTestId("repo-description")).toHaveText("Updated description for readers.")
  await expect(
    page.getByRole("list", {name: "Repository topics"}).getByRole("listitem"),
  ).toHaveText(["updated"])
  await expect(technical.getByTestId("repo-earliest-unique-commit")).toHaveText(
    "abcdef1234567890abcdef1234567890abcdef12",
  )
  await expect(technical.getByTestId("repo-identifier")).toHaveText(overviewMetadata.identifier)
  await expect(page).toHaveURL(overviewMetadataPath)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("the owner still has the settings editor alongside the public metadata", async ({page}) => {
  const relay = await setupOverview(page, TEST_PUBKEYS.alice)
  await page.goto(overviewMetadataPath)
  await expect(page.getByRole("region", {name: "About", exact: true})).toBeVisible()
  await page.locator(`[data-repo-tabs] a[href$="/settings"]`).click()
  await expect(page.getByLabel("Repository identifier (d)")).toHaveValue(
    overviewMetadata.identifier,
  )
  await expect(page.getByLabel("Repository identifier (d)")).toHaveAttribute("readonly", "")
  await expect(page.getByLabel("Display name *", {exact: true})).toBeEditable()
  expect(relay.getPublishedEvents()).toEqual([])
})
