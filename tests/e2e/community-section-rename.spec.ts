import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const communityId = "a".repeat(64)
const relayUrl = "wss://section-rename.example"
const definition = finalizeEvent(
  {
    kind: 32222,
    created_at: Math.floor(Date.now() / 1000) - 60,
    content: "",
    tags: [
      ["d", communityId],
      ["name", "Section rename regression"],
      ["r", relayUrl],
      ["content", "General"],
      ["k", "7"],
      ["content", "Threads"],
      ["k", "11", "threads"],
      ["content", "Calendar"],
      ["k", "31923"],
    ],
  },
  Uint8Array.from(Buffer.from(DEV_SECRET, "hex")),
)
const adminPath = `/c/${nip19.naddrEncode({
  kind: 32222,
  pubkey: DEV_PUBKEY,
  identifier: communityId,
  relays: [relayUrl],
})}/admin`

const nameHint =
  "Use letters and dashes only, up to 50 characters. Names must be unique (ignoring case)."

async function openSectionEditor(page: Page) {
  await seedDevSession(page)
  const relay = new MockRelay({seedEvents: [definition]})
  await relay.setup(page)
  await page.goto(adminPath)
  const description = page.locator("#community-description")
  await description.fill("Unpublished description to preserve")
  const section = page.locator('[data-section-accordion="1"]')
  await section.getByRole("button", {name: /Threads/}).click()
  await section.evaluate(element => element.scrollIntoView({block: "start", behavior: "instant"}))
  const name = section.getByRole("textbox", {name: "Section name", exact: true})
  const editor = await name.elementHandle()
  const content = page.locator('[data-component="PageContent"]')
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  // Include outroing dialogs so closure assertions wait for the actual unmount.
  const dialog = page.locator('[data-testid="modal-root"] [role="dialog"]')
  return {relay, description, section, name, editor, dialog}
}

for (const viewport of [
  {width: 1280, height: 900},
  {width: 390, height: 844},
]) {
  test(`inline rename and publication review preserve the draft and scroll at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const {relay, description, section, name, editor, dialog} = await openSectionEditor(page)
    await name.fill("Discussions")
    await expect(section.locator("[data-section-rename]")).toContainText("Threads → Discussions")
    const nameY = await name.evaluate(element => element.getBoundingClientRect().top)
    await name.press("Enter")
    await section.getByText(nameHint, {exact: true}).click()
    await expect(dialog).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe("")
    expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
    await expect(description).toHaveValue("Unpublished description to preserve")
    expect(
      Math.abs((await name.evaluate(element => element.getBoundingClientRect().top)) - nameY),
    ).toBeLessThan(2)
    // Each field must fit the card, including the intrinsic-width select on mobile.
    expect(
      await section.evaluate(element => {
        const card = element.getBoundingClientRect()
        return [...element.querySelectorAll("input, select")].every(control => {
          const rect = control.getBoundingClientRect()
          return rect.left >= card.left && rect.right <= card.right
        })
      }),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath("inline-rename.png"),
      animations: "disabled",
    })
    if (viewport.width < 640) {
      await section.locator("[data-section-kind-row]").scrollIntoViewIfNeeded()
      await page.screenshot({
        path: test.info().outputPath("mobile-kind-fields.png"),
        animations: "disabled",
      })
    }

    const update = page.getByRole("button", {name: "Update", exact: true})
    await update.click()
    const reviewY = await name.evaluate(element => element.getBoundingClientRect().top)
    await expect(dialog.getByText("Threads renamed to Discussions", {exact: true})).toBeVisible()
    expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
    await expect(dialog.getByRole("button", {name: "Cancel", exact: true})).toBeFocused()
    await page.screenshot({
      path: test.info().outputPath("publication-review.png"),
      animations: "disabled",
    })
    // Focus wraps within the review instead of reaching the underlying editor.
    await dialog.getByRole("button", {name: "Publish without migration", exact: true}).focus()
    await page.keyboard.press("Tab")
    await expect(
      dialog.getByRole("button", {name: "Publish and migrate permissions"}),
    ).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(
      dialog.getByRole("button", {name: "Publish without migration", exact: true}),
    ).toBeFocused()
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
    await expect(dialog).toHaveCount(0)
    await expect(update).toBeFocused()
    expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
    expect(
      Math.abs((await name.evaluate(element => element.getBoundingClientRect().top)) - reviewY),
    ).toBeLessThan(2)
    await expect(name).toHaveValue("Discussions")
    await expect(description).toHaveValue("Unpublished description to preserve")
    expect(relay.getPublishedEvents()).toEqual([])
  })
}

test("Undo rename only restores that name and returns focus", async ({page}) => {
  const {relay, description, section, name, editor, dialog} = await openSectionEditor(page)
  await name.fill("Discussions")
  const nameY = await name.evaluate(element => element.getBoundingClientRect().top)
  await section.getByRole("button", {name: "Undo rename", exact: true}).click()
  await expect(section.locator("[data-section-rename]")).toHaveCount(0)
  expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
  await expect(name).toHaveValue("Threads")
  await expect(name).toBeFocused()
  await expect(description).toHaveValue("Unpublished description to preserve")
  expect(
    Math.abs((await name.evaluate(element => element.getBoundingClientRect().top)) - nameY),
  ).toBeLessThan(2)
  await expect(dialog).toHaveCount(0)
  expect(relay.getPublishedEvents()).toEqual([])
})

test("duplicate and invalid names get inline errors rather than migration prompts", async ({
  page,
}) => {
  const {relay, section, name, dialog} = await openSectionEditor(page)
  await name.fill("general")
  await section.getByText(nameHint, {exact: true}).click()
  await expect(name).toHaveAttribute("aria-invalid", "true")
  await expect(section.getByRole("alert")).toHaveText("Section names must be unique.")
  await expect(section.locator("[data-section-rename]")).not.toContainText("Permissions change")
  await page.getByRole("button", {name: "Update", exact: true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(name).toBeFocused()
  await name.fill("Bad Name")
  await expect(name).toHaveAttribute("aria-invalid", "true")
  await name.fill("threads")
  await expect(name).toHaveAttribute("aria-invalid", "false")
  await expect(section.locator("[data-section-rename]")).toContainText("capitalization only")
  await name.fill("Discussion-Threads")
  await expect(name).toHaveAttribute("aria-invalid", "false")
  await expect(section.locator("[data-section-rename]")).toContainText(
    "Permissions change only when you publish",
  )
  expect(relay.getPublishedEvents()).toEqual([])
})

for (const dismissal of ["back", "close", "escape"] as const) {
  test(`dismissing the publication review with ${dismissal} preserves the draft`, async ({
    page,
  }) => {
    const {relay, description, name, editor, dialog} = await openSectionEditor(page)
    await name.fill("Discussions")
    await page.getByRole("button", {name: "Update", exact: true}).click()
    await expect(dialog).toBeVisible()
    const nameY = await name.evaluate(element => element.getBoundingClientRect().top)
    if (dismissal === "back") await page.goBack()
    else if (dismissal === "escape") await page.keyboard.press("Escape")
    else
      await page
        .getByRole("button", {name: "Close dialog", exact: true})
        .click({position: {x: 10, y: 10}})
    await expect(dialog).toHaveCount(0)
    expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
    await expect(name).toHaveValue("Discussions")
    await expect(description).toHaveValue("Unpublished description to preserve")
    expect(
      Math.abs((await name.evaluate(element => element.getBoundingClientRect().top)) - nameY),
    ).toBeLessThan(2)
    expect(relay.getPublishedEvents()).toEqual([])
  })
}

test("remaining change warnings keep the draft on Enter and reset only explicitly", async ({
  page,
}) => {
  const {relay, section, description, dialog} = await openSectionEditor(page)
  const kind = section.getByRole("combobox", {name: "Known kind", exact: true})
  await kind.focus()
  await kind.selectOption("11:room")
  await expect(dialog.getByRole("button", {name: "Keep change", exact: true})).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(kind).toHaveValue("11:room")
  await expect(kind).toBeFocused()
  await kind.selectOption("11:threads")
  await kind.selectOption("31922:")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", {name: "Reset kind change", exact: true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(kind).toHaveValue("11:threads")
  await expect(description).toHaveValue("Unpublished description to preserve")
  expect(relay.getPublishedEvents()).toEqual([])
})

async function injectNewDefinition(relay: MockRelay) {
  const replacement = finalizeEvent(
    {
      kind: definition.kind,
      created_at: definition.created_at + 30,
      content: "",
      tags: definition.tags.map(tag => (tag[0] === "name" ? ["name", "Updated elsewhere"] : tag)),
    },
    Uint8Array.from(Buffer.from(DEV_SECRET, "hex")),
  )
  // Wait for the mounted community's ongoing definition subscription.
  await expect
    .poll(async () => {
      const telemetry = await relay.getTelemetry()
      return telemetry.some(
        (entry, index) =>
          entry.type === "req" &&
          entry.filters?.some(filter => filter.kinds?.includes(32222)) &&
          !telemetry
            .slice(index + 1)
            .some(
              later =>
                later.type === "close" &&
                later.relayUrl === entry.relayUrl &&
                (!later.subId || later.subId === entry.subId),
            ),
      )
    })
    .toBe(true)
  await relay.injectEvents([replacement])
}

test("new definitions preserve dirty drafts until latest settings are explicitly loaded", async ({
  page,
}) => {
  const {relay, description, name, editor, dialog} = await openSectionEditor(page)
  await name.fill("Discussions")
  await injectNewDefinition(relay)
  const notice = page.getByRole("region", {name: "Newer community settings"})
  await expect(notice).toBeVisible()
  await expect(notice).toContainText("Community name changed.")
  expect(await editor!.evaluate(element => element.isConnected)).toBe(true)
  await expect(name).toHaveValue("Discussions")
  await expect(description).toHaveValue("Unpublished description to preserve")
  await expect(page.getByRole("button", {name: "Update", exact: true})).toBeDisabled()
  const loadLatest = notice.getByRole("button", {name: "Load latest settings", exact: true})
  await loadLatest.click()
  await expect(dialog.getByRole("button", {name: "Cancel", exact: true})).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
  await expect(name).toHaveValue("Discussions")
  await loadLatest.click()
  await dialog.getByRole("button", {name: "Discard draft and load latest", exact: true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(notice).toHaveCount(0)
  await expect(page.locator("#community-name")).toHaveValue("Updated elsewhere")
  await expect(description).toHaveValue("")
  await page.locator('[data-section-accordion="1"] button[aria-expanded]').click()
  await expect(name).toHaveValue("Threads")
  expect(relay.getPublishedEvents()).toEqual([])
})

test("an update arriving during publication review cannot publish a stale draft", async ({
  page,
}) => {
  const {relay, name, dialog} = await openSectionEditor(page)
  await name.fill("Discussions")
  await page.getByRole("button", {name: "Update", exact: true}).click()
  await expect(dialog).toBeVisible()
  await injectNewDefinition(relay)
  await expect(page.getByRole("region", {name: "Newer community settings"})).toBeAttached()
  await dialog.getByRole("button", {name: "Publish and migrate permissions", exact: true}).click()
  await expect(dialog).toContainText(
    "Newer community settings are available. Your draft is preserved.",
  )
  await dialog.getByRole("button", {name: "Cancel", exact: true}).click()
  await expect(name).toHaveValue("Discussions")
  expect(relay.getPublishedEvents()).toEqual([])
})

test("a pristine draft can load newer settings without a discard confirmation", async ({page}) => {
  const {relay, description, dialog} = await openSectionEditor(page)
  await description.fill("")
  await injectNewDefinition(relay)
  const notice = page.getByRole("region", {name: "Newer community settings"})
  await expect(notice).toBeVisible()
  await notice.getByRole("button", {name: "Load latest settings", exact: true}).click()
  await expect(notice).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expect(page.locator("#community-name")).toHaveValue("Updated elsewhere")
  expect(relay.getPublishedEvents()).toEqual([])
  await expect(page.getByRole("button", {name: "Update", exact: true})).toBeEnabled()
})
