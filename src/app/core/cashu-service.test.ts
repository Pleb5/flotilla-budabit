import "fake-indexeddb/auto"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {Amount, getDecodedToken, getEncodedToken, hashToCurve} from "@cashu/cashu-ts"
import {initializeCoco, MemoryRepositories} from "@cashu/coco-core"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {legacyCashuWallet} from "../../../tests/helpers/cashu-idb-fixture"
import {makeInvoice} from "../../../tests/helpers/lightning-invoice"
import {CashuStatusCache, clearCashuTokenChecks} from "./cashu-status-cache"
import {TOKEN_MEMORY_LIMIT} from "./cashu-token-status"

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
  loadCashuTokenStatus,
  checkCashuTokenStatus,
  checkRecentCashuTokens,
  pauseCashuTokenChecks,
  cashuTokenStatuses,
  createCashuWallet,
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

  it("keeps a receipt across reloads and token encodings without repeating redemption or mint checks", async () => {
    const mint = await fundedMint(32, 1000)
    const token = await createCashuToken(8, mint.url)
    const credited = await receiveCashuToken(token)
    expect(credited).toBeLessThan(8)
    await reloadCashuWallet()
    const decoded = getDecodedToken(token, [mint.id])
    const copy = getEncodedToken({
      ...decoded,
      memo: "Another copy",
      proofs: [...decoded.proofs].reverse(),
    })
    const before = mint.calls.length
    expect(await loadCashuTokenStatus(`cashu:${copy}`)).toMatchObject({
      received: {amount: credited},
    })
    expect(await receiveCashuToken(copy)).toBe(credited)
    expect(mint.calls).toHaveLength(before)
    expect(get(cashuTokenHistory).filter(entry => entry.direction === "received")).toHaveLength(1)
  })

  it("coalesces concurrent receives into one persisted operation", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    const before = mint.calls.filter(call => call.path === "/v1/swap").length
    expect(
      await Promise.all([receiveCashuToken(token), receiveCashuToken(`cashu:${token}`)]),
    ).toEqual([4, 4])
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(before + 1)
    expect(get(cashuTokenHistory).filter(entry => entry.direction === "received")).toHaveLength(1)
  })

  it("finds durable receipts beyond the recent-history page and clears them when replacing the wallet", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    await receiveCashuToken(token)
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    const [receipt] = await saved.receiveOperationRepository.getByState("finalized")
    for (let index = 0; index < 105; index++) {
      await saved.receiveOperationRepository.create({
        ...receipt,
        id: `synthetic-history-${index}`,
        createdAt: receipt.createdAt + index + 1,
        inputProofs: receipt.inputProofs.map(proof => ({
          ...proof,
          secret: `public-history-${index}`,
        })),
      })
    }
    saved.db.close()
    await clearCashuTokenChecks()
    await reloadCashuWallet()
    expect(get(cashuTokenHistory).some(entry => entry.id.includes(receipt.id))).toBe(false)
    expect(await loadCashuTokenStatus(token)).toMatchObject({received: {amount: 4}})
    await createCashuWallet()
    expect(get(cashuTokenStatuses)).toEqual({})
    expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
  })

  it("checks recent outgoing tokens in one batch, throttles repeated opens, and confirms external redemption", async () => {
    const mint = await fundedMint(32)
    const first = await createCashuToken(4, mint.url)
    const second = await createCashuToken(8, mint.url)
    const before = mint.calls.filter(call => call.path === "/v1/checkstate").length
    await Promise.all([checkRecentCashuTokens(), checkRecentCashuTokens()])
    expect(mint.calls.filter(call => call.path === "/v1/checkstate")).toHaveLength(before + 1)
    expect(await loadCashuTokenStatus(first)).toMatchObject({check: {state: "unspent"}})
    expect(await loadCashuTokenStatus(second)).toMatchObject({check: {state: "unspent"}})
    await checkRecentCashuTokens()
    expect(mint.calls.filter(call => call.path === "/v1/checkstate")).toHaveLength(before + 1)
    const receiver = await initializeCoco({
      repo: new MemoryRepositories(),
      seedGetter: async () => new Uint8Array(64).fill(9),
    })
    try {
      await receiver.mint.addMint(mint.url, {trusted: true})
      await receiver.wallet.receive(first)
    } finally {
      await receiver.dispose()
    }
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 2000)
    await checkCashuTokenStatus(first)
    expect(await loadCashuTokenStatus(first)).toMatchObject({
      check: {state: "spent"},
      outgoing: {state: "spent"},
    })
    expect((await loadCashuTokenStatus(first))?.received).toBeUndefined()
    const after = mint.calls.length
    await checkCashuTokenStatus(first)
    expect(mint.calls).toHaveLength(after)
    expect(get(cashuTotalBalance)).toBe(20)
  })

  it("preserves last-checked information offline and rejects incomplete mint answers", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    await checkCashuTokenStatus(token)
    const known = (await loadCashuTokenStatus(token))!.check
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 2000)
    vi.stubGlobal("fetch", async () => {
      throw new Error("Offline")
    })
    await checkCashuTokenStatus(token)
    expect(await loadCashuTokenStatus(token)).toMatchObject({
      check: known,
      checkError: expect.any(String),
    })
    vi.spyOn(Date, "now").mockReturnValue(now + 4000)
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/v1/checkstate")
        ? new Response(JSON.stringify({states: []}), {
            headers: {"content-type": "application/json"},
          })
        : mint.fetch(input, init),
    )
    await checkCashuTokenStatus(token)
    expect(await loadCashuTokenStatus(token)).toMatchObject({
      check: known,
      outgoing: {state: "created"},
      checkError: expect.any(String),
    })
  })

  it("distinguishes partially redeemed tokens and remembers a fully spent token without claiming receipt", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(3, mint.url)
    const decoded = getDecodedToken(token, [mint.id])
    const proofY = (secret: string) => hashToCurve(new TextEncoder().encode(secret)).toHex(true)
    mint.spent.add(proofY(decoded.proofs[0].secret))
    await checkCashuTokenStatus(token)
    expect(await loadCashuTokenStatus(token)).toMatchObject({
      check: {state: "partial", spent: decoded.proofs[0].amount.toNumber()},
      outgoing: {state: "created"},
    })
    for (const proof of decoded.proofs) mint.spent.add(proofY(proof.secret))
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000)
    await checkCashuTokenStatus(token)
    await reloadCashuWallet()
    const before = mint.calls.length
    expect(await loadCashuTokenStatus(token)).toMatchObject({check: {state: "spent"}})
    expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
    await checkCashuTokenStatus(token)
    expect(mint.calls).toHaveLength(before)
  })

  it("reconciles a lost receive response using the same operation after reload", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    let offline = true
    let dropped = false
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (offline && path === "/v1/restore") throw new Error("Offline")
      const result = await mint.fetch(input, init)
      if (path === "/v1/swap" && !dropped) {
        dropped = true
        throw new Error("Lost swap response")
      }
      return result
    })
    await expect(receiveCashuToken(token)).rejects.toMatchObject({code: "pending"})
    const pending = await loadCashuTokenStatus(token)
    expect(pending?.receiving).toBeDefined()
    await reloadCashuWallet()
    const before = mint.calls.filter(call => call.path === "/v1/swap").length
    offline = false
    expect(await receiveCashuToken(token)).toBe(4)
    expect((await loadCashuTokenStatus(token))?.received?.operationId).toBe(
      pending?.receiving?.operationId,
    )
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(before)
    expect(get(cashuTotalBalance)).toBe(16)
  })

  it("remembers an already-spent rejection without inventing a local receipt or retrying the swap", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    await checkCashuTokenStatus(token)
    for (const proof of getDecodedToken(token, [mint.id]).proofs) {
      mint.spent.add(hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true))
    }
    await expect(receiveCashuToken(token)).rejects.toMatchObject({code: "spent"})
    expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
    const before = mint.calls.filter(call => call.path === "/v1/swap").length
    await expect(receiveCashuToken(token)).rejects.toMatchObject({code: "spent"})
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(before)
    expect(get(cashuTotalBalance)).toBe(12)
  })

  it("keeps a confirmed receive successful when the history display cannot refresh", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    const historyRead = vi
      .spyOn(Object.getPrototypeOf(saved.historyRepository), "getPaginatedHistoryEntries")
      .mockRejectedValue(new Error("Synthetic display read failure"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await receiveCashuToken(token)).toBe(4)
      expect(await loadCashuTokenStatus(token)).toMatchObject({received: {amount: 4}})
    } finally {
      historyRead.mockRestore()
      log.mockRestore()
      saved.db.close()
    }
  })

  it("keeps the preview working set bounded and looks up an evicted receipt by ID", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    await receiveCashuToken(token)
    const receipt = (await loadCashuTokenStatus(token))!.received
    const decoded = getDecodedToken(token, [mint.id])
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    const reads = vi.spyOn(Object.getPrototypeOf(saved.receiveOperationRepository), "getById")
    const scans = vi
      .spyOn(Object.getPrototypeOf(saved.receiveOperationRepository), "getByMintUrl")
      .mockRejectedValue(new Error("Unbounded lookup forbidden"))
    const before = mint.calls.length
    try {
      for (let index = 0; index < TOKEN_MEMORY_LIMIT + 25; index++) {
        await loadCashuTokenStatus(getEncodedToken({...decoded, memo: `Display copy ${index}`}))
      }
      expect(Object.keys(get(cashuTokenStatuses)).length).toBeLessThanOrEqual(TOKEN_MEMORY_LIMIT)
      reads.mockClear()
      expect((await loadCashuTokenStatus(token))?.received).toEqual(receipt)
      expect(reads).toHaveBeenCalledTimes(1)
      expect(scans).not.toHaveBeenCalled()
      expect(mint.calls).toHaveLength(before)
    } finally {
      saved.db.close()
    }
  })

  it("preserves receipts and prevents duplicate receive even if the optional index cannot be written", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    vi.spyOn(CashuStatusCache.prototype, "index").mockRejectedValue(new Error("Synthetic quota"))
    vi.spyOn(CashuStatusCache.prototype, "refs").mockRejectedValue(
      new Error("Synthetic cache failure"),
    )
    expect(await receiveCashuToken(token)).toBe(4)
    await reloadCashuWallet()
    const before = mint.calls.length
    expect((await loadCashuTokenStatus(token))?.received?.amount).toBe(4)
    expect(await receiveCashuToken(token)).toBe(4)
    expect(mint.calls).toHaveLength(before)
  })

  it("skips hidden, offline, and data-saving automatic checks, while explicit checks still work", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    const before = mint.calls.filter(call => call.path === "/v1/checkstate").length
    vi.stubGlobal("document", {hidden: true})
    await checkRecentCashuTokens()
    vi.stubGlobal("document", {hidden: false})
    vi.stubGlobal("navigator", {onLine: false})
    await checkRecentCashuTokens()
    vi.stubGlobal("navigator", {onLine: true, connection: {saveData: true}})
    await checkRecentCashuTokens()
    expect(mint.calls.filter(call => call.path === "/v1/checkstate")).toHaveLength(before)
    await checkCashuTokenStatus(token)
    expect(mint.calls.filter(call => call.path === "/v1/checkstate")).toHaveLength(before + 1)
    // Avoid changing lifecycle globals while resetting the actual wallet.
    vi.unstubAllGlobals()
  })

  it.each(["background", "leave-history"])(
    "pauses an automatic request on %s and resumes without a stale throttle or failure label",
    async reason => {
      const windowEvents = new EventTarget()
      const documentEvents = Object.assign(new EventTarget(), {hidden: false})
      vi.stubGlobal("window", windowEvents)
      vi.stubGlobal("document", documentEvents)
      vi.stubGlobal("navigator", {onLine: true})
      const mint = await fundedMint()
      const token = await createCashuToken(4, mint.url)
      let requestStarted = false
      let aborted = false
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).endsWith("/v1/checkstate")) return mint.fetch(input, init)
        if (init?.signal?.aborted)
          return Promise.reject(new DOMException("Backgrounded", "AbortError"))
        requestStarted = true
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => {
              aborted = true
              reject(new DOMException("Backgrounded", "AbortError"))
            },
            {once: true},
          )
        })
      })
      const checking = checkRecentCashuTokens()
      await vi.waitFor(() => expect(requestStarted).toBe(true))
      if (reason === "background") {
        documentEvents.hidden = true
        documentEvents.dispatchEvent(new Event("visibilitychange"))
      } else pauseCashuTokenChecks()
      await checking
      expect(aborted).toBe(true)
      const paused = await loadCashuTokenStatus(token)
      expect(paused?.checking).toBe(false)
      expect(paused?.checkError).toBeUndefined()
      expect(paused?.check).toBeUndefined()
      documentEvents.hidden = false
      vi.stubGlobal("fetch", mint.fetch)
      documentEvents.dispatchEvent(new Event("visibilitychange"))
      await checkRecentCashuTokens()
      expect((await loadCashuTokenStatus(token))?.check?.state).toBe("unspent")
    },
  )
})
