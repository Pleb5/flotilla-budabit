import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const self = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(x => parseInt(x, 16)))
const peerKey = new Uint8Array(32).fill(25)
const peer = getPublicKey(peerKey)
const relayUrl = "wss://dm-replies.example/"
const sign = (key: Uint8Array, kind: number, tags: string[][], content = "") =>
  finalizeEvent({kind, tags, content, created_at: Math.floor(Date.now() / 1000) - 60}, key)
const plaintext =
  "Original private text <img src=https://no-fetch.example/quote> " + "long quote ".repeat(30)
const parent = sign(
  peerKey,
  4444,
  [["p", DEV_PUBKEY]],
  nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(peerKey, DEV_PUBKEY)),
)
const reply = sign(
  self,
  4444,
  [
    ["p", peer],
    ["e", parent.id, "", "reply"],
  ],
  nip44.v2.encrypt(
    "Freedom Builders compatible reply",
    nip44.v2.utils.getConversationKey(self, peer),
  ),
)

for (const width of [1280, 390])
  test.describe(`DM replies at ${width}`, () => {
    test.use({hasTouch: width < 800})
    test(`DM reply selection, cancellation, encrypted send and parent navigation at ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({width, height: 900})
      await seedDevSession(page)
      let accept = width < 800
      const relay = new MockRelay({
        getPublishResponse: () => ({outcome: accept ? "accept" : "reject", retain: accept}),
        seedEvents: [
          parent,
          reply,
          sign(self, 10050, [["relay", relayUrl]]),
          sign(peerKey, 10050, [["relay", relayUrl]]),
        ],
      })
      await relay.setup(page)
      await page
        .context()
        .route(/^https:\/\//, route =>
          route.fulfill({status: 503, body: "Fixture blocks external services"}),
        )
      await page.goto(`/chat/${peer}`)
      const original = page.locator(`[data-event="${parent.id}"]`)
      const child = page.locator(`[data-event="${reply.id}"]`)
      await expect(child).toContainText("Freedom Builders compatible reply", {timeout: 20_000})
      await expect(
        child.getByRole("button", {name: "Go to original message", exact: true}),
      ).toContainText("Original private text")
      await child.getByRole("button", {name: "Go to original message", exact: true}).click()
      await expect(original).toBeInViewport()
      const chooseReply = async () => {
        if (width < 800) await original.locator(".chat-bubble").click()
        else {
          await original.hover()
          await original.getByRole("button", {name: "Open message actions"}).click()
        }
        await page.getByRole("button", {name: "Reply", exact: true}).click()
        await expect(page.getByRole("button", {name: "Reply", exact: true})).toHaveCount(0)
        await expect(page.locator('[role="dialog"]')).toHaveCount(0)
        await expect(page.locator(".chat__compose")).toContainText("Original private text")
      }
      await chooseReply()
      await page.getByRole("button", {name: "Cancel reply", exact: true}).click()
      await expect(page.locator(".chat__compose")).not.toContainText("Original private text")
      await chooseReply()
      const editor = page.locator('.chat-editor [contenteditable="true"]')
      await editor.fill("Synthetic reply body")
      await page.screenshot({path: info.outputPath(`dm-reply-composer-${width}.png`)})
      await editor.press("Control+Enter")
      if (!accept) {
        await expect
          .poll(() => relay.getPublishedEvents().filter(event => event.kind === 4444).length)
          .toBeGreaterThan(0)
        await expect(page.getByRole("button", {name: "Send message", exact: true})).toBeEnabled()
        await expect(editor).toHaveText("Synthetic reply body")
        await expect(page.locator(".chat__compose")).toContainText("Original private text")
        accept = true
        await editor.press("Control+Enter")
      }
      await expect(editor).toBeEmpty()
      await expect(page.getByRole("button", {name: "Cancel reply", exact: true})).toHaveCount(0)
      const sent = relay.getPublishedEvents().filter(event => event.kind === 4444)
      expect(new Set(sent.map(event => event.id)).size).toBe(1)
      expect(sent[0].tags).toEqual([
        ["p", peer],
        ["e", parent.id, "", "reply"],
      ])
      expect(
        nip44.v2.decrypt(sent[0].content, nip44.v2.utils.getConversationKey(peerKey, DEV_PUBKEY)),
      ).toBe("Synthetic reply body")
      expect(JSON.stringify(sent[0])).not.toContain("Original private text")
      await expect(page.locator(`[data-event="${sent[0].id}"]`)).toContainText(
        "Original private text",
      )
      await chooseReply()
      await page.goto(`/chat/${DEV_PUBKEY}`)
      await expect(page.locator(".chat__compose")).toBeVisible()
      await expect(page.locator(".chat__compose")).not.toContainText("Original private text")
      await expect(page.getByRole("button", {name: "Cancel reply", exact: true})).toHaveCount(0)
    })
  })
