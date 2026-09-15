import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay, type NostrEvent} from "./helpers/mock-relay"

const secret = Uint8Array.from(Buffer.from(DEV_SECRET, "hex"))
const route = `/people/${nip19.npubEncode(DEV_PUBKEY)}`
const proof = "abc123def456"
const proofText = `Verifying that I control the following Nostr public key: ${nip19.npubEncode(DEV_PUBKEY)}`
const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(({page}) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on("pageerror", error => errors.push(error.message))
})
test.afterEach(({page}) => expect(browserErrors.get(page)).toEqual([]))
const makeEvent = (kind: number, tags: string[][], content = "", created_at = 1) =>
  finalizeEvent({kind, tags, content, created_at}, secret)
const profile = (tags: string[][] = [], extra = {}) =>
  makeEvent(
    0,
    tags,
    JSON.stringify({
      name: "Profile Fixture",
      about: "Profile identity regression fixture",
      nip05: "alice@profile.example",
      website: "https://profile.example",
      banner: "https://profile.example/banner.svg",
      ...extra,
    }),
  )
const githubGist = (id = proof) => ({
  id,
  public: true,
  owner: {login: "alice"},
  files: {"nostr.txt": {content: proofText}},
})

async function setup(page: Page, events: NostrEvent[], onPublish?: (event: NostrEvent) => void) {
  await seedDevSession(page)
  await page.addInitScript(() => localStorage.setItem("theme", JSON.stringify("dark")))
  const relay = new MockRelay({
    seedEvents: events,
    responseLatencyByKind: {0: 250, 10011: 700},
    getPublishResponse: () => ({outcome: "accept", retain: true}),
    onPublish,
  })
  await relay.setup(page)
  await page.route("https://profile.example/**", async request => {
    if (request.request().url().includes("nostr.json"))
      await request.fulfill({json: {names: {alice: DEV_PUBKEY}}})
    else
      await request.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="900" height="300" fill="#264b57"/><circle cx="700" cy="100" r="75" fill="#d6ae30"/></svg>',
      })
  })
  await page.route("https://api.github.com/gists/*", async request =>
    request.fulfill({json: githubGist(request.request().url().split("/").at(-1))}),
  )
  await page.goto(route)
  return relay
}

async function openEditor(page: Page) {
  await page.getByRole("button", {name: "Edit profile", exact: true}).click()
  const form = page.getByRole("form", {name: "Edit profile", exact: true})
  await expect(form.getByRole("textbox", {name: "Name", exact: true})).toBeVisible({timeout: 15000})
  return form
}

test("loads delayed modern proofs and preserves them across edit, save and reopen", async ({
  page,
}) => {
  const publications: NostrEvent[] = []
  await setup(
    page,
    [
      profile([
        ["i", "github:outdated", "111"],
        ["custom", "keep"],
      ]),
      makeEvent(10011, [
        ["i", "github:Alice", proof],
        ["i", "twitter:alice", "789"],
      ]),
    ],
    event => publications.push(event),
  )
  const form = await openEditor(page)
  await expect(form.getByRole("textbox", {name: "Name", exact: true})).toHaveValue(
    "Profile Fixture",
  )
  await expect(form.getByRole("textbox", {name: "GitHub username"})).toHaveValue("alice")
  await expect(form.getByRole("textbox", {name: "GitHub proof", exact: true})).toHaveValue(proof)
  await expect(
    form.getByText("GitHub account and Nostr public key verified.", {exact: true}),
  ).toBeVisible()
  await form.getByRole("textbox", {name: "Name", exact: true}).fill("Updated Fixture")
  await form.getByRole("textbox", {name: "Website", exact: true}).fill("profile.example/updated")
  expect(
    await form.evaluate((form: HTMLFormElement) =>
      Array.from(form.querySelectorAll("input"))
        .filter(input => !input.validity.valid)
        .map(input => ({label: input.getAttribute("aria-label"), error: input.validationMessage})),
    ),
  ).toEqual([])
  expect(
    await form
      .getByRole("button", {name: "Save Changes"})
      .evaluate((button: HTMLButtonElement) => Boolean(button.form)),
  ).toBe(true)
  await form.getByRole("button", {name: "Save Changes"}).click()
  await expect(page.getByRole("heading", {name: "Updated Fixture", exact: true})).toBeVisible({
    timeout: 15000,
  })
  const links = page.getByTestId("profile-identity-links")
  await expect(links.getByRole("link", {name: "alice", exact: true})).toHaveAttribute(
    "href",
    "https://github.com/alice",
  )
  await expect(links.getByRole("link", {name: "https://profile.example/updated"})).toBeVisible()
  await expect(
    links.getByRole("img", {name: "NIP-05 address verified for this Nostr public key."}),
  ).toBeVisible()
  await expect(page.getByRole("img", {name: "Profile banner", exact: true})).toBeVisible()
  const published = publications.find(event => event.kind === 0)!
  expect(published.tags).toContainEqual(["custom", "keep"])
  expect(published.tags).toContainEqual(["i", "github:alice", proof])
  expect(JSON.parse(published.content)).toMatchObject({
    name: "Updated Fixture",
    website: "https://profile.example/updated",
    banner: "https://profile.example/banner.svg",
  })
  expect(publications.some(event => event.kind === 10011)).toBe(false)
  const reopened = await openEditor(page)
  await expect(reopened.getByRole("textbox", {name: "GitHub proof", exact: true})).toHaveValue(
    proof,
  )
})

test("saves changed GitHub proof in both event formats and preserves other identities", async ({
  page,
}) => {
  const publications: NostrEvent[] = []
  await setup(
    page,
    [
      profile([
        ["i", "github:alice", proof],
        ["i", "twitter:alice", "789"],
      ]),
    ],
    event => publications.push(event),
  )
  const form = await openEditor(page)
  await expect(form.getByRole("textbox", {name: "GitHub proof", exact: true})).toHaveValue(proof)
  await form
    .getByRole("textbox", {name: "GitHub proof", exact: true})
    .fill("https://gist.github.com/alice/def456")
  await form.getByRole("button", {name: "Save Changes"}).click()
  await expect(page.getByText("Your profile has been updated!", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  for (const kind of [0, 10011]) {
    const published = publications.find(event => event.kind === kind)!
    expect(published.tags).toContainEqual(["i", "github:alice", "def456"])
    expect(published.tags).toContainEqual(["i", "twitter:alice", "789"])
  }
  const reopened = await openEditor(page)
  await expect(reopened.getByRole("textbox", {name: "GitHub proof", exact: true})).toHaveValue(
    "def456",
  )
  await reopened.getByRole("button", {name: "Remove GitHub link"}).click()
  await reopened.getByRole("button", {name: "Save Changes"}).click()
  await expect(reopened).toHaveCount(0, {timeout: 15000})
  await expect(
    page.getByTestId("profile-identity-links").getByRole("link", {name: "alice", exact: true}),
  ).toHaveCount(0)
  expect(publications.filter(event => event.kind === 10011).at(-1)!.tags).toEqual([
    ["i", "twitter:alice", "789"],
  ])
})

test("rejects changed NIP-05 key mismatches and leaves unsaved profile unchanged", async ({
  page,
}) => {
  const publications: NostrEvent[] = []
  await setup(page, [profile()], event => publications.push(event))
  const form = await openEditor(page)
  await form.getByRole("textbox", {name: "NIP-05 address"}).fill("mallory@profile.example")
  await expect(
    form.getByText("This NIP-05 address does not point to this Nostr public key.", {exact: true}),
  ).toBeVisible()
  await form.getByRole("button", {name: "Save Changes"}).click()
  await expect(form.getByRole("alert")).toContainText("does not point")
  expect(publications.filter(event => event.kind === 0)).toHaveLength(0)
  await form.getByRole("button", {name: "Discard Changes"}).click()
  await expect(page.getByTestId("profile-identity-links")).toContainText("alice@profile.example")
})

test("onboarding requires a non-whitespace name and includes the shared profile fields", async ({
  page,
}) => {
  const relay = new MockRelay()
  await relay.setup(page)
  await page.goto("/explore")
  await page.getByRole("button", {name: "Log in", exact: true}).click()
  await page.getByRole("button", {name: "Create a new account", exact: true}).click()
  await page.getByRole("button", {name: "Generate a key", exact: true}).click()
  const form = page.getByRole("form", {name: "Create profile"})
  const name = form.getByRole("textbox", {name: "Name", exact: true})
  await expect(name).toHaveAttribute("required", "")
  await form.getByRole("button", {name: "Create Account", exact: true}).click()
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true)
  await name.fill("   ")
  await form.getByRole("button", {name: "Create Account", exact: true}).click()
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(
    true,
  )
  for (const label of ["Website", "NIP-05 address", "Banner image URL", "Profile image URL"])
    await expect(form.getByRole("textbox", {name: label, exact: true})).toBeVisible()
  await expect(form.locator('input[type="file"][aria-label="Upload banner image"]')).toHaveCount(1)
  await name.fill("New Fixture")
  await form.getByRole("button", {name: "Create Account", exact: true}).click()
  await expect(page.getByRole("heading", {name: "Your Keys are Ready!"})).toBeVisible()
  expect(relay.getPublishedEvents()).toHaveLength(0)
})

test("auto-verification remains busy, recovers from API errors and reuses an existing Gist", async ({
  page,
}) => {
  const publications: NostrEvent[] = []
  await setup(page, [profile()], event => publications.push(event))
  const form = await openEditor(page)
  let fail = true
  let posts = 0
  let releaseRequest: () => void = () => undefined
  const pending = new Promise<void>(resolve => {
    releaseRequest = resolve
  })
  await page.route("https://api.github.com/**", async request => {
    const url = new URL(request.request().url())
    if (request.request().method() === "POST") posts++
    if (url.pathname === "/user") {
      await pending
      await request.fulfill(fail ? {status: 401, json: {}} : {json: {login: "alice"}})
    } else if (url.pathname === "/gists") await request.fulfill({json: [githubGist()]})
    else await request.fulfill({json: githubGist()})
  })
  await page.evaluate(async () => {
    const url = "/tests/e2e/fixtures/profile-identity-browser.ts"
    const fixture = await import(/* @vite-ignore */ url)
    fixture.addFixtureGithubToken()
  })
  const auto = form.getByRole("button", {name: "Auto-Verify GitHub Identity", exact: true})
  await auto.click()
  await expect(
    form.getByRole("button", {name: "Creating GitHub proof…", exact: true}),
  ).toBeDisabled()
  await expect(form.getByRole("button", {name: "Save Changes"})).toBeDisabled()
  releaseRequest()
  await expect(form.getByRole("alert")).toContainText("token expired or invalid")
  await expect(auto).toBeEnabled()
  fail = false
  await auto.click()
  await expect(form.getByRole("textbox", {name: "GitHub username"})).toHaveValue("alice")
  await expect(form.getByRole("textbox", {name: "GitHub proof", exact: true})).toHaveValue(proof)
  expect(posts).toBe(0)
  expect(publications.filter(event => [0, 10011].includes(event.kind))).toHaveLength(0)
  await form.getByRole("button", {name: "Save Changes"}).click()
  await expect(page.getByText("Your profile has been updated!", {exact: true})).toBeVisible({
    timeout: 15000,
  })
  expect(publications.find(event => event.kind === 10011)?.tags).toContainEqual([
    "i",
    "github:alice",
    proof,
  ])
})

test("profile modal shows banner and links, copies NIP-05, and updates verification after metadata changes", async ({
  page,
}) => {
  await setup(page, [profile([["i", "github:alice", proof]])])
  await page.evaluate(async key => {
    const url = "/tests/e2e/fixtures/profile-identity-browser.ts"
    const fixture = await import(/* @vite-ignore */ url)
    fixture.openFixtureProfileModal(key)
  }, DEV_PUBKEY)
  const modal = page.getByRole("dialog")
  const links = modal.getByTestId("profile-identity-links")
  await expect(modal.getByRole("img", {name: "Profile banner", exact: true})).toBeVisible()
  await expect(links.getByRole("link", {name: "alice", exact: true})).toHaveAttribute(
    "href",
    "https://github.com/alice",
  )
  await expect(
    links.getByRole("link", {name: "https://profile.example", exact: true}),
  ).toHaveAttribute("href", "https://profile.example/")
  await expect(
    links.getByRole("img", {name: "NIP-05 address verified for this Nostr public key."}),
  ).toBeVisible()
  await page.evaluate(() => {
    document.execCommand = command => {
      if (command === "copy")
        (window as unknown as {profileCopied: string}).profileCopied = (
          document.activeElement as HTMLTextAreaElement
        ).value
      return true
    }
  })
  await links.getByRole("button", {name: "Copy NIP-05 address"}).click()
  expect(
    await page.evaluate(() => (window as unknown as {profileCopied: string}).profileCopied),
  ).toBe("alice@profile.example")
  const details = links.getByRole("button", {name: /NIP-05 verification details/})
  await details.click()
  await expect(page.getByRole("tooltip")).toHaveText(
    "NIP-05 address verified for this Nostr public key.",
  )
  await page.evaluate(
    async event => {
      const url = "/tests/e2e/fixtures/profile-identity-browser.ts"
      const fixture = await import(/* @vite-ignore */ url)
      fixture.admitFixtureProfileEvent(event)
    },
    makeEvent(
      0,
      [],
      JSON.stringify({name: "Profile Fixture", nip05: "mallory@profile.example"}),
      2,
    ),
  )
  await expect(
    links.getByRole("img", {name: "This NIP-05 address does not point to this Nostr public key."}),
  ).toBeVisible()
  await expect(
    links.getByRole("img", {name: "NIP-05 address verified for this Nostr public key."}),
  ).toHaveCount(0)
  await expect(page.getByRole("tooltip")).toHaveText(
    "This NIP-05 address does not point to this Nostr public key.",
  )
  await details.press("Escape")
  await expect(page.getByRole("tooltip")).not.toBeVisible()
  await expect(modal).toBeVisible()
  await modal.getByRole("button", {name: "Edit profile", exact: true}).click()
  await expect(
    page
      .getByRole("form", {name: "Edit profile", exact: true})
      .getByRole("textbox", {name: "NIP-05 address"}),
  ).toHaveValue("mallory@profile.example")
})

test("NIP-05 tooltips support hover, click, keyboard focus and the editor status icon", async ({
  page,
}) => {
  await setup(page, [profile()])
  const details = page
    .getByTestId("profile-identity-links")
    .getByRole("button", {name: /NIP-05 verification details/})
  await expect(
    details.getByRole("img", {name: "NIP-05 address verified for this Nostr public key."}),
  ).toBeVisible()
  await details.hover()
  await expect(page.getByRole("tooltip")).toHaveText(
    "NIP-05 address verified for this Nostr public key.",
  )
  await page.mouse.move(0, 0)
  await expect(page.getByRole("tooltip")).not.toBeVisible()
  await details.focus()
  await expect(page.getByRole("tooltip")).toBeVisible()
  await expect(details).toHaveAttribute("aria-describedby", /tippy-/)
  await details.press("Escape")
  await expect(page.getByRole("tooltip")).not.toBeVisible()
  await details.click()
  await page.mouse.move(0, 0)
  await expect(page.getByRole("tooltip")).toBeVisible()
  await details.click()
  await expect(page.getByRole("tooltip")).not.toBeVisible()
  const form = await openEditor(page)
  const status = form.getByRole("button", {name: "NIP-05 verification details", exact: true})
  await status.hover()
  await expect(page.getByRole("tooltip")).toHaveText(
    "NIP-05 address verified for this Nostr public key.",
  )
  await status.press("Escape")
  await expect(form).toBeVisible()
})

test.describe("NIP-05 touch tooltip", () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})
  test("opens on tap and dismisses on an outside tap without copying the address", async ({
    page,
  }) => {
    await setup(page, [profile()])
    await page.evaluate(() => {
      document.execCommand = () => {
        throw new Error("The details button must not copy the address")
      }
    })
    const details = page
      .getByTestId("profile-identity-links")
      .getByRole("button", {name: /NIP-05 verification details/})
    await details.tap()
    await expect(page.getByRole("tooltip")).toHaveText(
      "NIP-05 address verified for this Nostr public key.",
    )
    await page.getByRole("heading", {name: "Profile Fixture", exact: true}).tap()
    await expect(page.getByRole("tooltip")).not.toBeVisible()
    await expect(details).toBeVisible()
  })
})
