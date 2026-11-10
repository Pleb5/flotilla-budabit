import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay, type MockRelayOptions} from "./helpers/mock-relay"
import type {Page} from "@playwright/test"

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

const setupRevisionFixture = async (page: Page, options: MockRelayOptions = {}) => {
  await seedDevSession(page)
  const relay = new MockRelay({
    ...options,
    seedEvents: [
      parent,
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
  await expect(original).toContainText("Original private text", {timeout: 20_000})
  await original.hover()
  await original.getByRole("button", {name: "Open message actions"}).click()
  await page.getByRole("button", {name: "Reply", exact: true}).click()
  return relay
}

for (const retry of [false, true])
  test(`late ${retry ? "retry" : "initial"} ACK preserves a newer editor revision`, async ({
    page,
  }) => {
    let accept = !retry
    const relay = await setupRevisionFixture(page, {
      getPublishResponse: () => ({
        outcome: accept ? "accept" : "reject",
        latency: accept ? 1500 : 0,
        retain: accept,
      }),
    })
    const editor = page.locator('.chat-editor [contenteditable="true"]')
    const send = page.getByRole("button", {name: "Send message", exact: true})
    await editor.fill("Submitted draft A")
    await send.click()
    if (retry) {
      await expect.poll(() => relay.getPublishedEventsByKind(4444).length).toBe(1)
      await expect(send).toBeEnabled()
      accept = true
      await editor.press("Control+Enter")
    }
    await expect.poll(() => relay.getPublishedEventsByKind(4444).length).toBe(retry ? 2 : 1)
    await editor.fill("New draft B")
    await expect(send).toBeEnabled()
    await expect(editor).toHaveText("New draft B")
    await expect(page.locator(".chat__compose")).toContainText("Original private text")
    const published = relay.getPublishedEventsByKind(4444)
    expect(new Set(published.map(e => e.id)).size).toBe(1)
    expect(
      nip44.v2.decrypt(
        published[0].content,
        nip44.v2.utils.getConversationKey(peerKey, DEV_PUBKEY),
      ),
    ).toBe("Submitted draft A")
  })

test("retry keeps signed event and destinations after both signed inbox lists change", async ({
  page,
}) => {
  let accept = false
  const deliveries: {id: string; sig: string; relay: string}[] = []
  const relay = await setupRevisionFixture(page, {
    getPublishResponse: () => ({outcome: accept ? "accept" : "reject", retain: accept}),
    onPublish: (event, relay) => {
      if (event.kind === 4444) deliveries.push({id: event.id, sig: event.sig, relay})
    },
  })
  const editor = page.locator('.chat-editor [contenteditable="true"]')
  const send = page.getByRole("button", {name: "Send message", exact: true})
  await editor.fill("Same pending reply")
  await send.click()
  await expect.poll(() => deliveries.length).toBe(1)
  await expect(send).toBeEnabled()
  const changedAt = Math.floor(Date.now() / 1000)
  const updated = [self, peerKey].map((key, i) =>
    finalizeEvent(
      {
        kind: 10050,
        tags: [["relay", `wss://changed-inbox-${i}.example/`]],
        content: "",
        created_at: changedAt,
      },
      key,
    ),
  )
  await page.evaluate(async events => {
    const path = "/tests/e2e/helpers/dm-reply-runtime.ts"
    const runtime = await import(path)
    runtime.replaceInboxLists(events)
  }, updated)
  await expect
    .poll(() =>
      page.evaluate(
        async keys => {
          const path = "/tests/e2e/helpers/dm-reply-runtime.ts"
          return (await import(path)).inboxes(keys)
        },
        [DEV_PUBKEY, peer],
      ),
    )
    .toEqual([["wss://changed-inbox-0.example/"], ["wss://changed-inbox-1.example/"]])
  accept = true
  await editor.press("Control+Enter")
  await expect(editor).toBeEmpty()
  expect(deliveries).toHaveLength(2)
  expect(deliveries[1]).toEqual(deliveries[0])
  expect(deliveries[0].relay).toBe(relayUrl)
})

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
