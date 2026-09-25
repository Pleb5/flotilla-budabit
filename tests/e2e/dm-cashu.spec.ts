import {expect, test, type Page} from "@playwright/test"
import {Amount, getEncodedToken} from "@cashu/cashu-ts"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const selfKey = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
const partnerKey = new Uint8Array(32).fill(25)
const partner = getPublicKey(partnerKey)
const relayUrl = "wss://dm-cashu.example/"
// Synthetic, unspendable proofs; no mint or payment requests are needed for previews.
const token = getEncodedToken({
  mint: "https://mint.example",
  unit: "sat",
  proofs: [
    {
      id: "009a1f293253e41e",
      amount: Amount.from(210),
      secret: "public-dm-layout-fixture",
      C: `02${"a".repeat(64)}`,
    },
  ],
})
const sign = (key: Uint8Array, kind: number, tags: string[][], content = "") =>
  finalizeEvent({kind, tags, content, created_at: Math.floor(Date.now() / 1000) - 60}, key)
const message = (key: Uint8Array, recipient: string, content: string) =>
  sign(
    key,
    4444,
    [["p", recipient]],
    nip44.v2.encrypt(content, nip44.v2.utils.getConversationKey(key, recipient)),
  )

const setup = async (page: Page) => {
  await seedDevSession(page)
  const incoming = message(partnerKey, DEV_PUBKEY, token)
  const outgoing = message(selfKey, partner, `cashu:${token}`)
  const relay = new MockRelay({
    seedEvents: [
      sign(selfKey, 10050, [["relay", relayUrl]]),
      sign(partnerKey, 10050, [["relay", relayUrl]]),
      sign(partnerKey, 0, [], JSON.stringify({name: "Cashu Partner"})),
      incoming,
      outgoing,
    ],
  })
  await relay.setup(page)
  await page
    .context()
    .route(/^https:\/\//, route =>
      route.fulfill({status: 503, body: "External service blocked by fixture"}),
    )
  return {relay, incoming, outgoing}
}

for (const width of [1280, 390, 320]) {
  test(`Cashu DM cards fit incoming and outgoing bubbles at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 900})
    await page.emulateMedia({colorScheme: width < 1280 ? "dark" : "light"})
    const {relay, incoming, outgoing} = await setup(page)
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`/chat/${partner}`)

    for (const event of [incoming, outgoing]) {
      const card = page.locator(`[data-event="${event.id}"] [data-payment-card="cashu"]`)
      await expect(card).toBeVisible({timeout: 20_000})
      await expect(card).toContainText("210")
      await expect(card).toContainText("mint.example")
      const layout = await card.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const bubble = element.closest(".chat-bubble")!.getBoundingClientRect()
        const buttons = [...element.querySelectorAll("button")]
        return {
          width: bounds.width,
          overflow: element.scrollWidth - element.clientWidth,
          insideBubble: bounds.left >= bubble.left && bounds.right <= bubble.right,
          insideViewport: bounds.left >= 0 && bounds.right <= window.innerWidth,
          buttonsFit: buttons.every(button => {
            const rect = button.getBoundingClientRect()
            return (
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              button.scrollWidth <= button.clientWidth + 1 &&
              button.scrollHeight <= button.clientHeight + 1
            )
          }),
        }
      })
      expect(layout.width).toBeGreaterThanOrEqual(200)
      expect(layout.overflow).toBeLessThanOrEqual(1)
      expect(layout.insideBubble).toBe(true)
      expect(layout.insideViewport).toBe(true)
      expect(layout.buttonsFit).toBe(true)
    }
    await page.screenshot({path: info.outputPath(`dm-cashu-${width}.png`)})
    expect(errors).toEqual([])
    expect(relay.getPublishedEvents()).toHaveLength(0)
  })
}

test("DM composer keeps Cashu chips inline and sends the original token", async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.emulateMedia({colorScheme: "dark"})
  const {relay} = await setup(page)
  await page.goto(`/chat/${partner}`)
  const editor = page.locator('.chat-editor [contenteditable="true"]')
  await expect(editor).toBeVisible({timeout: 20_000})
  await editor.focus()
  const text = `Here is your cashu:${token}, enjoy!`
  await editor.evaluate((element, value) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", value)
    element.dispatchEvent(
      new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true}),
    )
  }, text)
  const chip = editor.locator("[data-cashu-token]")
  await expect(chip).toHaveText("Cashu · 210 sats")
  await expect(editor).toHaveText("Here is your Cashu · 210 sats, enjoy!")
  await editor.press("Control+z")
  await expect(editor).toBeEmpty()
  await editor.press("Control+Shift+z")
  await expect(chip).toHaveText("Cashu · 210 sats")
  await editor.press("Control+a")
  const copied = await editor.evaluate(element => {
    const clipboardData = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent("copy", {clipboardData, bubbles: true, cancelable: true}),
    )
    return clipboardData.getData("text/plain")
  })
  expect(copied).toBe(text)
  await editor.press("ArrowRight")
  await editor.pressSequentially(" Thanks.")
  const bounds = await chip.boundingBox()
  expect(bounds!.width).toBeLessThan(200)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({path: info.outputPath("dm-cashu-composer-mobile.png")})
  // Every websocket is intercepted by MockRelay; this sends only a synthetic fixture DM.
  await editor.press("Control+Enter")
  await expect
    .poll(() => relay.getPublishedEvents().filter(event => event.kind === 4444).length)
    .toBeGreaterThan(0)
  const sent = relay.getPublishedEvents().find(event => event.kind === 4444)!
  expect(nip44.v2.decrypt(sent.content, nip44.v2.utils.getConversationKey(selfKey, partner))).toBe(
    `${text} Thanks.`,
  )
  await expect(editor).toBeEmpty()
  await expect(page.locator(`[data-event="${sent.id}"] [data-payment-card="cashu"]`)).toBeVisible()
})
