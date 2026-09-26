import {expect, test, type Page} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {CashuTestMint} from "../helpers/cashu-mint"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const fixturePath = "/tests/e2e/fixtures/cashu-receipts-browser.ts"
const partnerKey = new Uint8Array(32).fill(25)
const partner = getPublicKey(partnerKey)
const relayUrl = "wss://cashu-receipts.example/"
const selfKey = Uint8Array.from(DEV_SECRET.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
const sign = (kind: number, content: string, tags: string[][] = []) =>
  finalizeEvent({kind, content, tags, created_at: Math.floor(Date.now() / 1000) - 30}, partnerKey)

const setup = async (page: Page, mint: CashuTestMint, events: ReturnType<typeof sign>[] = []) => {
  await seedDevSession(page)
  const relay = new MockRelay({
    seedEvents: [
      finalizeEvent(
        {
          kind: 10050,
          content: "",
          tags: [["relay", relayUrl]],
          created_at: Math.floor(Date.now() / 1000) - 30,
        },
        selfKey,
      ),
      sign(10050, "", [["relay", relayUrl]]),
      sign(0, JSON.stringify({name: "Cashu Partner"})),
      ...events,
    ],
  })
  await relay.setup(page)
  await page.context().route(/^https:\/\//, async route => {
    const request = route.request()
    if (new URL(request.url()).origin !== mint.url)
      return route.fulfill({status: 503, body: "External service blocked by fixture"})
    const response = await mint.fetch(request.url(), {
      method: request.method(),
      body: request.postData() || undefined,
    })
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      contentType: "application/json",
    })
  })
  return relay
}

for (const viewport of [
  {width: 1280, height: 900},
  {width: 390, height: 844},
]) {
  test(`saved sends survive navigation and reload at ${viewport.width}px`, async ({page}, info) => {
    test.setTimeout(60_000)
    await page.setViewportSize(viewport)
    const mint = new CashuTestMint()
    const relay = await setup(page, mint)
    await page.goto("/settings/wallet")
    await expect(page.getByRole("button", {name: "Create wallet", exact: true})).toBeVisible({
      timeout: 20_000,
    })
    const quotes = await page.evaluate(
      async path => (await import(/* @vite-ignore */ path)).prepareSender(),
      fixturePath,
    )
    for (const quote of quotes) mint.pay(quote)
    await page.evaluate(
      async ({path, quotes}) => (await import(/* @vite-ignore */ path)).fundSender(quotes),
      {path: fixturePath, quotes},
    )

    await page.getByRole("button", {name: "Saved outgoing tokens", exact: true}).click()
    await page.getByLabel("Amount (sats)", {exact: false}).fill("3")
    await page.getByRole("button", {name: "Create Token", exact: true}).click()
    const tokenField = page.getByRole("textbox", {name: "Saved Cashu token"})
    await expect(tokenField).toBeVisible()
    const first = await tokenField.inputValue()
    expect(first.startsWith("cashu")).toBe(true)
    await expect(
      page.getByText("Saved in this wallet. You can reopen it from Send or History."),
    ).toBeVisible()
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await page.getByRole("button", {name: "Copy Token", exact: true}).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first)

    await page.getByRole("button", {name: "Create another token", exact: true}).click()
    await page.getByLabel("Amount (sats)", {exact: false}).fill("4")
    await page.getByRole("button", {name: "Create Token", exact: true}).click()
    await expect(tokenField).toBeVisible()
    const second = await tokenField.inputValue()
    expect(second).not.toBe(first)
    const saved = page.getByRole("region", {name: "Saved outgoing tokens"})
    await expect(saved.getByRole("button", {name: "Open token", exact: true})).toHaveCount(2)
    await page.getByRole("button", {name: "Balance", exact: true}).click()
    await page.getByRole("button", {name: "Saved outgoing tokens", exact: true}).click()
    await expect(saved.getByRole("button", {name: "Open token", exact: true})).toHaveCount(2)

    // Actual route departure and return, followed by a full document reload.
    await page.goto("/settings/performance")
    await page.goBack()
    await page.reload()
    await page.getByRole("button", {name: "Saved outgoing tokens", exact: true}).click()
    await expect(saved.getByRole("button", {name: "Open token", exact: true})).toHaveCount(2)
    const swaps = mint.calls.filter(call => call.path === "/v1/swap").length
    // The local dev server remains reachable; the mint is now unavailable.
    await page.context().route(`${mint.url}/**`, route => route.abort())
    const reopened: string[] = []
    for (let index = 0; index < 2; index++) {
      await saved.getByRole("button", {name: "Open token", exact: true}).nth(index).click()
      await expect(
        saved.getByRole("button", {name: "Open token", exact: true}).first(),
      ).toBeEnabled()
      await expect(tokenField).toBeVisible()
      await expect(
        page.getByRole("heading", {name: "Token saved. Copy and share it:"}),
      ).toBeInViewport()
      reopened.push(await tokenField.inputValue())
    }
    expect([...reopened].sort()).toEqual([first, second].sort())
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(swaps)
    expect(
      await page.evaluate(
        async path => (await import(/* @vite-ignore */ path)).balance(),
        fixturePath,
      ),
    ).toBe(249)
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => {
          throw new Error("Clipboard blocked by fixture")
        },
      })
    })
    await page.getByRole("button", {name: "Copy Token", exact: true}).click()
    await expect(
      page.getByText("Could not copy token. Select and copy the text above."),
    ).toBeVisible()
    await expect(tokenField).toHaveValue(reopened[1])
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("body").evaluate(element => element.clientWidth),
    )
    await page.screenshot({
      path: info.outputPath(`cashu-saved-sends-${viewport.width}.png`),
      fullPage: true,
    })
    expect(relay.getPublishedEvents()).toHaveLength(0)
  })
}

test("leaving Send during creation retains the completed token", async ({page}) => {
  test.setTimeout(60_000)
  const mint = new CashuTestMint()
  await setup(page, mint)
  await page.goto("/settings/wallet")
  await expect(page.getByRole("button", {name: "Create wallet", exact: true})).toBeVisible({
    timeout: 20_000,
  })
  const quotes = await page.evaluate(
    async path => (await import(/* @vite-ignore */ path)).prepareSender(),
    fixturePath,
  )
  for (const quote of quotes) mint.pay(quote)
  await page.evaluate(
    async ({path, quotes}) => (await import(/* @vite-ignore */ path)).fundSender(quotes),
    {path: fixturePath, quotes},
  )
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let started!: () => void
  const swapping = new Promise<void>(resolve => {
    started = resolve
  })
  await page.route(`${mint.url}/v1/swap`, async route => {
    started()
    await gate
    await route.fallback()
  })
  await page.getByRole("button", {name: "Saved outgoing tokens", exact: true}).click()
  await page.getByLabel("Amount (sats)", {exact: false}).fill("3")
  await page.getByRole("button", {name: "Create Token", exact: true}).click()
  await swapping
  await page.getByRole("button", {name: "Balance", exact: true}).click()
  await page.getByRole("button", {name: "Saved outgoing tokens", exact: true}).click()
  release()
  await page.getByRole("button", {name: "Open token", exact: true}).click()
  await expect(page.getByRole("textbox", {name: "Saved Cashu token"})).toHaveValue(/^cashu/)
  expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(1)
  expect(
    await page.evaluate(
      async path => (await import(/* @vite-ignore */ path)).balance(),
      fixturePath,
    ),
  ).toBe(253)
})

test("cold receipts pause at the budget and wallet diagnostics capture the explicit continuation", async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  const mint = new CashuTestMint()
  await setup(page, mint)
  // Exercise the diagnostics-enabled test-build branch without changing the
  // developer's server configuration. Relays and mint remain isolated fixtures.
  await page.route("**/src/app/core/feature-flags.ts", async route => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      /export const DIAGNOSTICS_ENABLED = [^;]+;/,
      "export const DIAGNOSTICS_ENABLED = true;",
    )
    await route.fulfill({response, body})
  })
  await page.goto("/settings/performance")
  await page.getByRole("checkbox", {name: /Cashu wallet/}).check()
  await page.getByRole("button", {name: "Start recording", exact: true}).click()
  const quotes = await page.evaluate(
    async path => (await import(/* @vite-ignore */ path)).prepareSender(),
    fixturePath,
  )
  for (const quote of quotes) mint.pay(quote)
  const token = await page.evaluate(
    async ({path, quotes}) => (await import(/* @vite-ignore */ path)).fundAndSend(quotes),
    {path: fixturePath, quotes},
  )
  await page.evaluate(
    async ({path, token}) => (await import(/* @vite-ignore */ path)).receiveAndLoseIndex(token),
    {path: fixturePath, token},
  )
  const before = mint.calls.filter(call => call.path === "/v1/swap").length
  await page.evaluate(
    async ({path, token}) => (await import(/* @vite-ignore */ path)).openReceive(token),
    {path: fixturePath, token},
  )
  const more = page.getByRole("button", {name: "Continue checking", exact: true})
  await expect(more).toBeVisible()
  await expect(
    page.getByText(
      "More wallet history to check for a saved receipt. No new redemption has been started.",
    ),
  ).toBeVisible()
  await page.screenshot({path: info.outputPath("cashu-receipt-budget.png")})
  for (let attempt = 0; attempt < 30; attempt++) {
    await more.click()
    await expect(page.getByText("Received · 210 sats", {exact: true}).or(more)).toBeVisible()
    if (!(await more.isVisible())) break
  }
  await expect(page.getByText("Received · 210 sats", {exact: true})).toBeVisible()
  expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(before)
  const records = await page.evaluate(
    async path => (await import(/* @vite-ignore */ path)).walletDiagnostics(),
    fixturePath,
  )
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({type: "send:finish"}),
      expect.objectContaining({type: "receive:finish"}),
      expect.objectContaining({
        type: "reconcile:finish",
        detail: expect.objectContaining({outcome: "budget-exhausted"}),
      }),
      expect.objectContaining({
        type: "reconcile:finish",
        detail: expect.objectContaining({outcome: "hit"}),
      }),
    ]),
  )
  expect(JSON.stringify(records)).not.toContain(token)
  expect(JSON.stringify(records)).not.toContain(mint.url)
})

test("two wallets retain receipts, reconcile redemption, and explain statuses on tap", async ({
  page: sender,
  browser,
}, info) => {
  test.setTimeout(60_000)
  const mint = new CashuTestMint()
  const senderRelay = await setup(sender, mint)
  await sender.goto("/settings/wallet")
  await expect(sender.getByRole("button", {name: "Create wallet", exact: true})).toBeVisible({
    timeout: 20_000,
  })
  const quotes = await sender.evaluate(
    async path => (await import(/* @vite-ignore */ path)).prepareSender(),
    fixturePath,
  )
  for (const quote of quotes) mint.pay(quote)
  const token = await sender.evaluate(
    async ({path, quotes}) => (await import(/* @vite-ignore */ path)).fundAndSend(quotes),
    {path: fixturePath, quotes},
  )
  await expect(sender.getByText("Token created", {exact: true})).toBeVisible()

  const receiver = await browser.newPage({
    viewport: {width: 390, height: 844},
    colorScheme: "dark",
    hasTouch: true,
    isMobile: true,
  })
  try {
    const encrypted = nip44.v2.encrypt(
      token,
      nip44.v2.utils.getConversationKey(partnerKey, DEV_PUBKEY),
    )
    const event = sign(4444, encrypted, [["p", DEV_PUBKEY]])
    const receiverRelay = await setup(receiver, mint, [event])
    await receiver.goto(`/chat/${partner}`)
    const card = receiver.locator(`[data-event="${event.id}"] [data-payment-card="cashu"]`)
    await expect(card).toBeVisible({timeout: 20_000})
    await card.getByRole("button", {name: "Receive in Cashu"}).click()
    await receiver.getByRole("button", {name: "Create new wallet"}).click()
    await receiver.getByRole("button", {name: "Create new wallet", exact: true}).click()
    await receiver.getByPlaceholder("https://mint.example.com").fill(mint.url)
    await receiver.getByRole("button", {name: "+ Add", exact: true}).click()
    await receiver.getByRole("button", {name: "Continue to backup"}).click()
    const download = receiver.waitForEvent("download")
    await receiver.getByRole("button", {name: "Download backup file"}).click()
    await download
    await receiver.getByRole("button", {name: "Finish setup", exact: true}).click()
    await expect(receiver.getByText("Received · 210 sats", {exact: true})).toBeVisible()
    await receiver.getByRole("button", {name: "Close", exact: true}).click()
    await expect(card.getByRole("button", {name: "View receipt", exact: true})).toBeVisible()
    await expect(card.getByRole("button", {name: "Copy Cashu token"})).toHaveCount(0)
    await receiver.reload()
    await expect(card.getByRole("button", {name: "View receipt", exact: true})).toBeVisible({
      timeout: 15_000,
    })
    const swapsBefore = mint.calls.filter(call => call.path === "/v1/swap").length
    await card.getByRole("button", {name: "View receipt", exact: true}).click()
    await expect(receiver.getByText("Already received · 210 sats", {exact: true})).toBeVisible()
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(swapsBefore)
    await receiver.getByRole("button", {name: "In this wallet", exact: true}).click()
    const receiptHelp = receiver.getByRole("dialog", {name: "In this wallet", exact: true})
    await expect(receiptHelp).toBeVisible()
    await expect
      .poll(() =>
        receiptHelp.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(bounds.x + 10, bounds.y + 10))
        }),
      )
      .toBe(true)
    await receiver.keyboard.press("Escape")
    await expect(receiptHelp).toHaveCount(0)
    await expect(receiver.getByText("Already received · 210 sats", {exact: true})).toBeVisible()
    await receiver.getByRole("button", {name: "Close", exact: true}).click()
    await expect(receiver.locator('[data-testid="modal-root"] > *')).toHaveCount(0)
    const explanation = receiver.getByRole("dialog", {name: "Received", exact: true})
    await expect(explanation).toHaveCount(0)
    await card.getByRole("button", {name: "Received", exact: true}).tap()
    await expect(explanation).toContainText("You don't need to redeem it again.")
    await expect
      .poll(() => explanation.evaluate(element => getComputedStyle(element.parentElement!).opacity))
      .toBe("1")
    const bounds = await explanation.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await receiver.screenshot({path: info.outputPath("cashu-received-mobile.png")})
    await receiver.getByRole("button", {name: "Close explanation"}).click()
    await expect(explanation).toHaveCount(0)

    const back = await receiver.evaluate(
      async path => (await import(/* @vite-ignore */ path)).sendBack(),
      fixturePath,
    )
    await sender.evaluate(
      async ({path, token}) => (await import(/* @vite-ignore */ path)).openReceive(token),
      {path: fixturePath, token: back},
    )
    await expect(sender.getByText("Received · 20 sats", {exact: true})).toBeVisible()
    await sender.getByRole("button", {name: "Close", exact: true}).click()
    await expect(sender.locator('[data-testid="modal-root"] > *')).toHaveCount(0)
    await sender.getByRole("button", {name: "Check status", exact: true}).click()
    await expect(sender.getByRole("button", {name: "Redeemed", exact: true})).toBeVisible()
    await sender.getByRole("button", {name: "Redeemed", exact: true}).click()
    await expect(sender.getByRole("dialog", {name: "Redeemed"})).toContainText(
      "This doesn't tell us who redeemed it.",
    )
    await expect
      .poll(() =>
        sender
          .getByRole("dialog", {name: "Redeemed"})
          .evaluate(element => getComputedStyle(element.parentElement!).opacity),
      )
      .toBe("1")
    await sender.screenshot({path: info.outputPath("cashu-history-status.png")})
    await sender.keyboard.press("Escape")
    await expect(sender.getByRole("dialog", {name: "Redeemed"})).toHaveCount(0)
    expect(
      await sender.evaluate(
        async path => (await import(/* @vite-ignore */ path)).balance(),
        fixturePath,
      ),
    ).toBe(66)
    expect(
      await receiver.evaluate(
        async path => (await import(/* @vite-ignore */ path)).balance(),
        fixturePath,
      ),
    ).toBe(190)
    expect(senderRelay.getPublishedEvents()).toHaveLength(0)
    expect(receiverRelay.getPublishedEvents()).toHaveLength(0)
  } finally {
    await receiver.close()
  }
})
