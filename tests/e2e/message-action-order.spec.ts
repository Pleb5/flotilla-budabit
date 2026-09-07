import {expect, test, type Page} from "@playwright/test"
import {decode} from "nostr-tools/nip19"
import {BASE_TIMESTAMP, TEST_PUBKEYS, signTestEvent} from "./fixtures/events"
import {seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const relays = ["wss://message-actions.test"]
const ownMessage = signTestEvent({
  kind: 9,
  pubkey: TEST_PUBKEYS.devUser,
  created_at: BASE_TIMESTAMP,
  content: "Author message for action order checks.",
  tags: [["h", "3".repeat(64)]],
})
const otherMessage = signTestEvent({
  ...ownMessage,
  pubkey: TEST_PUBKEYS.charlie,
  content: "Another member's message for moderation order checks.",
})

const mountMessages = async (page: Page) => {
  const relay = new MockRelay({seedEvents: [ownMessage, otherMessage]})
  await relay.setup(page)
  await page.goto("/git")
  await expect(page.getByRole("button", {name: "Community Curated", exact: true})).toBeVisible()
  await page.evaluate(
    async props => {
      const fixturePath = "/tests/e2e/fixtures/message-actions-browser.ts"
      const {mountMessageActionsFixture} = await import(/* @vite-ignore */ fixturePath)
      ;(window as any).__unmountMessageActionsFixture = mountMessageActionsFixture(props)
    },
    {ownMessage, otherMessage, relays},
  )
  return relay
}

for (const viewport of [
  {name: "desktop", width: 1280, height: 900},
  {name: "mobile", width: 390, height: 844},
]) {
  test(`orders message and comment actions without changing permissions (${viewport.name})`, async ({
    page,
  }) => {
    const errors: Error[] = []
    page.on("pageerror", error => errors.push(error))
    await page.setViewportSize(viewport)
    await seedDevSession(page)
    const relay = await mountMessages(page)

    const fixture = page.getByTestId("message-action-fixture")
    const modal = page.getByTestId("modal-root")
    for (const component of ["channel", "room", "comment"]) {
      for (const variant of ["author", "other", "read-only"]) {
        const section = fixture.getByTestId(`${component}-${variant}`)
        await section.scrollIntoViewIfNeeded()
        await section.hover()
        const reply = section.getByRole("button", {name: /^Reply to/})
        if (variant === "read-only" || (component === "room" && viewport.name === "mobile")) {
          await expect(reply).toHaveCount(0)
        } else {
          await expect(reply).toBeVisible()
          expect(
            await reply.evaluate(
              element => element.parentElement?.querySelector("button") === element,
            ),
          ).toBe(true)
          const beforeReply = page.url()
          await reply.click()
          await expect(fixture.getByTestId("selected-action")).toHaveText(
            `Reply ${component}-${variant}`,
          )
          await expect(modal).toBeEmpty()
          await expect(page).toHaveURL(beforeReply)
          expect(new URL(page.url()).pathname).toBe("/git")
        }

        const open = section.getByRole("button", {name: /^Open (message|comment) actions$/})
        const openMenu = async () => {
          // Room hover actions need to be revealed again after leaving a popover/modal.
          if (component === "room" && viewport.name === "desktop") {
            await section.locator("[data-event]").hover()
          }
          await open.click()
        }
        await openMenu()
        const menu =
          viewport.name === "mobile" && component !== "comment"
            ? modal.getByRole("group", {name: "Message actions"})
            : page.locator(".tippy-content:visible ul.menu")
        const expected =
          variant === "read-only"
            ? [
                ...(component !== "comment" ? ["Share Message"] : []),
                "Message Info",
                ...(component === "comment" ? ["Delete comment"] : []),
              ]
            : [
                "Send Reply",
                ...(component !== "comment" ? ["Share Message"] : []),
                "Send Zap",
                "Send Reaction",
                "Message Info",
                ...(variant === "author"
                  ? [`Edit ${component === "comment" ? "comment" : "Message"}`]
                  : []),
                ...(variant === "other"
                  ? ["Moderate Event", "Ban Person"]
                  : [`Delete ${component === "comment" ? "comment" : "Message"}`]),
              ]
        await expect(menu.getByRole("button")).toHaveText(expected)
        const bounds = (await menu.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
        for (const button of await menu.locator("button.text-error").all()) {
          expect(
            await button.evaluate(element => {
              const buttons = [
                ...element.closest("ul.menu, [role='group']")!.querySelectorAll("button"),
              ]
              return (
                buttons.findIndex(button => button === element) >
                buttons.findIndex(button => button.textContent?.trim() === "Message Info")
              )
            }),
          ).toBe(true)
        }

        if (variant === "read-only") {
          await menu.getByRole("button", {name: "Message Info", exact: true}).click()
          await expect(modal.getByText("Event Details", {exact: true})).toBeVisible()
          await expect(modal.locator("code")).toContainText(ownMessage.id)
          await modal.getByRole("button", {name: "Got it", exact: true}).click()
        } else {
          await menu.getByRole("button", {name: "Send Reply", exact: true}).click()
          await expect(fixture.getByTestId("selected-action")).toHaveText(
            `Reply ${component}-${variant}`,
          )
          await expect(modal).toBeEmpty()
          await expect(menu).not.toBeVisible()
          await openMenu()
          await menu.getByRole("button", {name: "Send Reaction", exact: true}).click()
          await expect(modal.locator("emoji-picker")).toBeVisible()
          // Open the picker only; do not select/publish a reaction.
          await modal
            .getByRole("button", {name: "Close dialog", exact: true})
            .click({position: {x: 1, y: 1}})
          await expect(modal).toBeEmpty()
          if (variant === "author") {
            await openMenu()
            await menu.getByRole("button", {name: /^Edit /}).click()
            await expect(fixture.getByTestId("selected-action")).toHaveText(
              `Edit ${component}-${variant}`,
            )
            await expect(modal).toBeEmpty()
          }
        }
      }
    }
    await page.evaluate(() => (window as any).__unmountMessageActionsFixture())
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })

  test(`shares room messages below Reply, including read-only messages (${viewport.name})`, async ({
    page,
  }) => {
    const errors: Error[] = []
    page.on("pageerror", error => errors.push(error))
    await page.setViewportSize(viewport)
    // Guest session and captured copy requests: never touch the system clipboard or publish.
    await page.addInitScript(() => {
      const copied: string[] = []
      ;(window as any).__sharedRoomMessages = copied
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copied.push(text)
          },
        },
      })
      const execCommand = document.execCommand.bind(document)
      document.execCommand = (command, ...args) => {
        if (command !== "copy") return execCommand(command, ...args)
        const input = document.activeElement
        if (!(input instanceof HTMLTextAreaElement)) throw new Error("Missing share input")
        copied.push(input.value)
        return true
      }
    })
    const relay = await mountMessages(page)
    const fixture = page.getByTestId("message-action-fixture")
    const modal = page.getByTestId("modal-root")
    let copies = 0

    for (const component of ["room", "channel"]) {
      for (const variant of ["author", "other", "read-only"]) {
        const section = fixture.getByTestId(`${component}-${variant}`)
        const message = variant === "other" ? otherMessage : ownMessage
        for (const activation of ["mouse", "Enter", "Space"]) {
          await section.scrollIntoViewIfNeeded()
          if (component === "room" && viewport.name === "desktop") {
            await section.locator("[data-event]").hover()
          }
          const beforePath = new URL(page.url()).pathname
          const beforeAction = await fixture.getByTestId("selected-action").textContent()
          await section.getByRole("button", {name: "Open message actions", exact: true}).click()
          const menu =
            viewport.name === "mobile"
              ? modal.getByRole("group", {name: "Message actions"})
              : page.locator(".tippy-content:visible ul.menu")
          const share = menu.getByRole("button", {name: "Share Message", exact: true})
          await expect(share).toBeVisible()
          const labels = await menu.getByRole("button").allTextContents()
          expect(
            labels.map(label => label.trim()).slice(0, variant === "read-only" ? 1 : 2),
          ).toEqual(variant === "read-only" ? ["Share Message"] : ["Send Reply", "Share Message"])
          if (activation === "mouse") {
            await share.click()
          } else {
            await share.focus()
            await page.keyboard.press(activation)
          }
          copies++
          const confirmation = page
            .getByRole("alert")
            .filter({hasText: "Nostr Event Link Copied"})
            .last()
          await expect(confirmation).toBeVisible()
          await expect
            .poll(() => page.evaluate(() => (window as any).__sharedRoomMessages.length))
            .toBe(copies)
          expect(
            decode(await page.evaluate(() => (window as any).__sharedRoomMessages.at(-1))),
          ).toEqual({
            type: "nevent",
            data: {
              id: message.id,
              kind: message.kind,
              author: message.pubkey,
              relays: relays.map(relay => `${relay}/`),
            },
          })
          await expect(menu).not.toBeVisible()
          await expect(modal).toBeEmpty()
          expect(new URL(page.url()).pathname).toBe(beforePath)
          await expect(fixture.getByTestId("selected-action")).toHaveText(beforeAction || "")
          // Dismiss each confirmation before moving to the next card: stacked toasts can
          // cover its hover-only menu trigger, unlike a single normal share interaction.
          await confirmation
            .getByRole("button", {name: "Dismiss notification", exact: true})
            .click()
          await expect(confirmation).not.toBeVisible()
        }
      }
    }
    await page.evaluate(() => (window as any).__unmountMessageActionsFixture())
    expect(relay.getPublishedEvents()).toEqual([])
    expect(errors).toEqual([])
  })
}
