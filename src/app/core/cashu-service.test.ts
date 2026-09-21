import "fake-indexeddb/auto"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {Amount, getEncodedToken} from "@cashu/cashu-ts"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {legacyCashuWallet} from "../../../tests/helpers/cashu-idb-fixture"
import {makeInvoice} from "../../../tests/helpers/lightning-invoice"

vi.mock("@lib/util", () => ({
  deleteIndexedDB: (name: string) =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    }),
}))
// Actual manager, crypto and repositories; background polling is disabled so
// each protocol transition is deterministic and explicitly asserted.
vi.mock("@cashu/coco-core", async importOriginal => {
  const actual = await importOriginal<typeof import("@cashu/coco-core")>()
  return {
    ...actual,
    initializeCoco: (config: Parameters<typeof actual.initializeCoco>[0]) =>
      actual.initializeCoco({
        ...config,
        watchers: {
          mintOperationWatcher: {disabled: true},
          proofStateWatcher: {disabled: true},
          meltQuoteWatcher: {disabled: true},
        },
        processors: {
          mintOperationProcessor: {disabled: true},
          meltSettlementProcessor: {disabled: true},
        },
      }),
  }
})

import {
  initializeCashuWallet,
  reloadCashuWallet,
  clearCashuWalletStorage,
  addCashuMint,
  requestMintQuote,
  mintTokensFromQuote,
  getCashuTopUp,
  cashuTopUps,
  cashuTotalBalance,
  cashuTokenHistory,
  cashuWalletError,
  cashuInitialized,
  createCashuToken,
  receiveCashuToken,
  refreshCashuTopUps,
  prepareCashuInvoicePayment,
  executeCashuInvoicePayment,
  cancelCashuInvoicePayment,
  checkCashuInvoicePayment,
  cashuSpendableByMint,
} from "./cashu"

beforeEach(() => {
  localStorage.setItem("budabit_cashu_mnemonic", legacyCashuWallet.mnemonic)
  localStorage.setItem("budabit_cashu_backup_confirmed", "true")
})
afterEach(async () => {
  vi.restoreAllMocks()
  await clearCashuWalletStorage()
  vi.unstubAllGlobals()
})

describe("Cashu app service", () => {
  const fundedMint = async (amount = 16, feePpk = 0) => {
    const mint = new CashuTestMint({feePpk})
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    await addCashuMint(mint.url)
    const topUp = await requestMintQuote(mint.url, amount)
    mint.pay(topUp.quote)
    await mintTokensFromQuote(mint.url, topUp.quote, amount)
    return mint
  }

  it("quotes without paying, releases cancelled reservations, then pays and recovers change", async () => {
    const mint = await fundedMint()
    const invoice = makeInvoice()
    const first = await prepareCashuInvoicePayment(mint.url, invoice)
    expect(first).toMatchObject({amount: 7, feeReserve: 1, mintFees: 0, maxTotal: 8})
    expect(mint.meltAttempts).toBe(0)
    expect(get(cashuSpendableByMint).get(mint.url)).toBeLessThan(16)
    await cancelCashuInvoicePayment(first.operationId)
    expect(get(cashuSpendableByMint).get(mint.url)).toBe(16)
    const payment = await prepareCashuInvoicePayment(mint.url, invoice)
    mint.meltState = "PAID"
    expect(await executeCashuInvoicePayment(payment)).toMatchObject({state: "paid"})
    expect(get(cashuTotalBalance)).toBe(9)
    expect(mint.meltAttempts).toBe(1)
    expect(await executeCashuInvoicePayment(payment)).toMatchObject({state: "paid"})
    expect(mint.meltAttempts).toBe(1)
  })

  it("keeps a lost melt response pending and reconciles after reload without paying twice", async () => {
    const mint = await fundedMint(8)
    const payment = await prepareCashuInvoicePayment(mint.url, makeInvoice())
    mint.meltState = "PAID"
    mint.dropNextMeltResponse = true
    const result = await executeCashuInvoicePayment(payment)
    expect(["pending", "paid"]).toContain(result.state)
    await reloadCashuWallet()
    expect(await checkCashuInvoicePayment(payment.operationId)).toMatchObject({state: "paid"})
    expect(get(cashuTotalBalance)).toBe(1)
    expect(mint.meltAttempts).toBe(1)
  })

  it("rejects mismatched/expired quotes and insufficient balance before submitting a melt", async () => {
    const mint = await fundedMint(4)
    await expect(prepareCashuInvoicePayment(mint.url, makeInvoice())).rejects.toThrow()
    const payment = await prepareCashuInvoicePayment(mint.url, makeInvoice({amountMsats: 2000}))
    await expect(executeCashuInvoicePayment({...payment, invoice: makeInvoice()})).rejects.toThrow(
      "does not match",
    )
    expect(await executeCashuInvoicePayment({...payment, expiresAt: 0})).toMatchObject({
      state: "failed",
    })
    expect(mint.meltAttempts).toBe(0)
    expect(get(cashuSpendableByMint).get(mint.url)).toBe(4)
  })

  it.each([16, 64])(
    "accounts for mint input fees and change from a %i-sat balance",
    async amount => {
      const mint = await fundedMint(amount, 1000)
      const payment = await prepareCashuInvoicePayment(mint.url, makeInvoice())
      expect(payment.mintFees).toBeGreaterThan(0)
      expect(payment.maxTotal).toBe(payment.amount + payment.feeReserve + payment.mintFees)
      mint.meltState = "PAID"
      expect(await executeCashuInvoicePayment(payment)).toMatchObject({state: "paid"})
      expect(get(cashuTotalBalance)).toBe(amount - payment.amount - payment.mintFees)
    },
  )

  it("keeps an abandoned prepared quote discoverable and releasable after reload", async () => {
    const mint = await fundedMint()
    const payment = await prepareCashuInvoicePayment(mint.url, makeInvoice())
    await reloadCashuWallet()
    expect(get(cashuTokenHistory)).toContainEqual(
      expect.objectContaining({paymentOperationId: payment.operationId, state: "prepared"}),
    )
    await cancelCashuInvoicePayment(payment.operationId)
    expect(get(cashuSpendableByMint).get(mint.url)).toBe(16)
    expect(mint.meltAttempts).toBe(0)
  })

  it("passes amountless amounts in msats to the mint and handles pending then failed payments", async () => {
    const mint = await fundedMint()
    const payment = await prepareCashuInvoicePayment(mint.url, makeInvoice({amountMsats: 0}), 7)
    expect(mint.calls.find(call => call.path === "/v1/melt/quote/bolt11")?.body.options).toEqual({
      amountless: {amount_msat: 7000},
    })
    expect(await executeCashuInvoicePayment(payment)).toMatchObject({state: "pending"})
    mint.meltState = "UNPAID"
    expect(await checkCashuInvoicePayment(payment.operationId)).toMatchObject({state: "failed"})
    expect(get(cashuTotalBalance)).toBe(16)
    expect(mint.meltAttempts).toBe(1)
  })

  it("persists an invoice before returning it and resumes it exactly once after reload", async () => {
    const mint = new CashuTestMint()
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    await addCashuMint(mint.url)
    const quote = await requestMintQuote(mint.url, 4)
    expect(quote.operationId).toBeTruthy()
    expect(get(cashuTopUps)).toHaveLength(1)
    await reloadCashuWallet()
    expect(get(cashuTopUps)[0]).toMatchObject({quote: quote.quote, operationId: quote.operationId})
    mint.pay(quote.quote)
    await Promise.all([
      mintTokensFromQuote(mint.url, quote.quote, 4),
      mintTokensFromQuote(mint.url, quote.quote, 4),
    ])
    expect(get(cashuTotalBalance)).toBe(4)
    expect((await getCashuTopUp(mint.url, quote.quote)).state).toBe("complete")
    expect(get(cashuTokenHistory).filter(h => h.direction === "minted")).toHaveLength(1)
    expect(mint.mintAttempts).toBe(1)
    await expect(mintTokensFromQuote(mint.url, quote.quote, 5)).rejects.toThrow("amount")
    const token = await createCashuToken(2, mint.url)
    expect(get(cashuTotalBalance)).toBe(2)
    expect(await receiveCashuToken(token)).toBe(2)
    expect(get(cashuTotalBalance)).toBe(4)
  })

  it("surfaces initialization failure and can retry without replacing the wallet seed", async () => {
    vi.spyOn(IndexedDbRepositories.prototype, "init").mockRejectedValueOnce(
      new Error("Injected storage failure"),
    )
    await initializeCashuWallet()
    expect(get(cashuInitialized)).toBe(false)
    expect(get(cashuWalletError)).toBe("Injected storage failure")
    await reloadCashuWallet()
    expect(get(cashuInitialized)).toBe(true)
    expect(get(cashuWalletError)).toBe("")
    expect(localStorage.getItem("budabit_cashu_mnemonic")).toBe(legacyCashuWallet.mnemonic)
  })

  it("does not report remote issuance as success when proofs cannot be recovered", async () => {
    const mint = new CashuTestMint()
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    await addCashuMint(mint.url)
    const quote = await requestMintQuote(mint.url, 4)
    mint.quotes.get(quote.quote)!.state = "ISSUED"
    await expect(mintTokensFromQuote(mint.url, quote.quote, 4)).rejects.toThrow()
    expect((await getCashuTopUp(mint.url, quote.quote)).state).not.toBe("complete")
    expect(get(cashuTotalBalance)).toBe(0)
  })

  it("keeps locally expired invoices available to reconcile payment received while offline", async () => {
    const mint = new CashuTestMint()
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    await addCashuMint(mint.url)
    const quote = await requestMintQuote(mint.url, 4)
    vi.spyOn(Date, "now").mockReturnValue((quote.expiry! + 1) * 1000)
    await refreshCashuTopUps()
    expect(get(cashuTopUps)[0]).toMatchObject({quote: quote.quote, state: "expired"})
    mint.pay(quote.quote)
    await mintTokensFromQuote(mint.url, quote.quote, 4)
    expect((await getCashuTopUp(mint.url, quote.quote)).state).toBe("complete")
    expect(get(cashuTotalBalance)).toBe(4)
  })

  it("waits for obsolete initialization before clearing and never exposes its manager", async () => {
    let unblock!: () => void
    const gate = new Promise<void>(resolve => {
      unblock = resolve
    })
    const original = IndexedDbRepositories.prototype.init
    const initializing = vi
      .spyOn(IndexedDbRepositories.prototype, "init")
      .mockImplementationOnce(async function (this: IndexedDbRepositories) {
        await gate
        await original.call(this)
      })
    const start = initializeCashuWallet()
    await vi.waitFor(() => expect(initializing).toHaveBeenCalled())
    const clearing = clearCashuWalletStorage()
    unblock()
    await Promise.all([start, clearing])
    expect(get(cashuInitialized)).toBe(false)
    expect(get(cashuTopUps)).toEqual([])
    expect(localStorage.getItem("budabit_cashu_mnemonic")).toBeNull()
  })

  it("rejects unsafe sat amounts and foreign units before value-moving requests", async () => {
    const mint = new CashuTestMint()
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    for (const amount of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(createCashuToken(amount, mint.url)).rejects.toThrow("positive safe integer")
      await expect(requestMintQuote(mint.url, amount)).rejects.toThrow("positive safe integer")
    }
    const token = getEncodedToken({
      mint: mint.url,
      unit: "usd",
      proofs: [
        {
          id: "009a1f293253e41e",
          amount: Amount.from(2),
          secret: "public",
          C: `02${"a".repeat(64)}`,
        },
      ],
    })
    await expect(receiveCashuToken(token)).rejects.toThrow("sat-denominated")
    expect(mint.calls).toEqual([])
  })

  it("rejects BLS token inputs without attempting a swap", async () => {
    const mint = new CashuTestMint()
    vi.stubGlobal("fetch", mint.fetch)
    await initializeCashuWallet()
    await addCashuMint(mint.url)
    const token =
      "cashuA" +
      Buffer.from(
        JSON.stringify({
          unit: "sat",
          token: [
            {
              mint: mint.url,
              proofs: [
                {
                  id: `02${"ab".repeat(32)}`,
                  amount: 1,
                  secret: "synthetic",
                  C: `02${"ab".repeat(32)}`,
                },
              ],
            },
          ],
        }),
      ).toString("base64url")
    await expect(receiveCashuToken(token)).rejects.toThrow()
    expect(
      mint.calls.filter(c => ["/v1/swap", "/v1/mint/bolt11", "/v1/melt/bolt11"].includes(c.path)),
    ).toEqual([])
  })
})
