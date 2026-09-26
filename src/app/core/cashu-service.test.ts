import "fake-indexeddb/auto"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {Amount, getDecodedToken, getEncodedToken, hashToCurve} from "@cashu/cashu-ts"
import {initializeCoco, MemoryRepositories} from "@cashu/coco-core"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {legacyCashuWallet} from "../../../tests/helpers/cashu-idb-fixture"
import {makeInvoice} from "../../../tests/helpers/lightning-invoice"
import {CashuStatusCache, clearCashuTokenChecks, CASHU_STATUS_DB} from "./cashu-status-cache"
import {CashuReceiptLookupIncomplete, RECEIPT_LOOKUP_ROWS} from "./cashu-operation-lookup"
import {TOKEN_MEMORY_LIMIT} from "./cashu-token-status"
import {SAVED_SEND_PAGE_SIZE, type SavedSendCursor} from "./cashu-saved-sends"

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
  refreshCashuHistory,
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
  listSavedCashuSends,
  getSavedCashuSend,
  resumeCashuSend,
  cancelPreparedCashuSend,
  retryInterruptedCashuSends,
  CashuSendUnconfirmedError,
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

  it("reopens every saved token offline after reload, independent of the disposable status cache", async () => {
    const mint = await fundedMint()
    const first = await createCashuToken(3, mint.url)
    const second = await createCashuToken(4, mint.url)
    await clearCashuTokenChecks()
    await reloadCashuWallet()
    const before = mint.calls.length
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")))
    const page = await listSavedCashuSends()
    expect(page.entries.map(entry => entry.token).sort()).toEqual([first, second].sort())
    for (const entry of page.entries) {
      expect((await getSavedCashuSend(entry.id)).token).toBe(entry.token)
      // Resuming an already-created operation returns the same token, without spending again.
      expect(await resumeCashuSend(entry.id)).toBe(entry.token)
    }
    expect(mint.calls).toHaveLength(before)
    expect(fetch).not.toHaveBeenCalled()
    expect(get(cashuTotalBalance)).toBe(9)
  })

  it("finds old saved sends in bounded pages without scanning terminal history or skipping removed rows", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(3, mint.url)
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    try {
      const table = saved.db.table("coco_cashu_send_operations")
      const original = await table.toCollection().first()
      await table.delete(original.id)
      const ids = Array.from(
        {length: 2 * SAVED_SEND_PAGE_SIZE + 3},
        (_, i) => `saved-${String(i).padStart(3, "0")}`,
      )
      await table.bulkAdd([
        {...original, id: "interrupted", state: "executing"},
        {...original, id: "prepared", state: "prepared"},
        {...original, id: "returning", state: "rolling_back"},
        ...ids.map(id => ({...original, id})),
        ...Array.from({length: 1205}, (_, i) => ({
          ...original,
          id: `terminal-${i}`,
          state: "finalized",
          createdAt: original.createdAt + i + 1,
        })),
      ])
      await refreshCashuHistory()
      expect(get(cashuTokenHistory).every(entry => entry.state === "finalized")).toBe(true)
      const reads = vi.spyOn(Object.getPrototypeOf(saved.sendOperationRepository), "getById")
      const scan = vi.spyOn(Object.getPrototypeOf(saved.sendOperationRepository), "getPending")
      let cursor: SavedSendCursor | undefined
      const found: string[] = []
      const before = mint.calls.length
      do {
        reads.mockClear()
        const page = await listSavedCashuSends(cursor)
        expect(reads.mock.calls.length).toBeLessThanOrEqual(SAVED_SEND_PAGE_SIZE)
        expect(page.entries).toHaveLength(
          Math.min(SAVED_SEND_PAGE_SIZE, ids.length + 3 - found.length),
        )
        for (const entry of page.entries) {
          found.push(entry.id)
          if (entry.state === "pending") expect(entry.token).toBe(token)
        }
        // Removing a previous-page row must not shift the continuation.
        if (!cursor) await table.delete(page.entries[0].id)
        cursor = page.next
      } while (cursor)
      expect(found.sort()).toEqual([...ids, "interrupted", "prepared", "returning"].sort())
      expect(new Set(found).size).toBe(found.length)
      expect(scan).not.toHaveBeenCalled()
      expect(mint.calls).toHaveLength(before)
    } finally {
      saved.db.close()
    }
  })

  it("returns the durable token when a history refresh fails after creation", async () => {
    const mint = await fundedMint()
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    const historyRead = vi
      .spyOn(Object.getPrototypeOf(saved.historyRepository), "getPaginatedHistoryEntries")
      .mockRejectedValue(new Error("Synthetic display read failure"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const token = await createCashuToken(3, mint.url)
      expect((await listSavedCashuSends()).entries).toMatchObject([{state: "pending", token}])
      expect(get(cashuTotalBalance)).toBe(13)
    } finally {
      historyRead.mockRestore()
      log.mockRestore()
      saved.db.close()
    }
  })

  it("reconciles an error after token persistence without creating a second send", async () => {
    const mint = await fundedMint()
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    const proto = Object.getPrototypeOf(saved.sendOperationRepository)
    const update = proto.update
    const write = vi.spyOn(proto, "update").mockImplementation(async function (
      this: typeof saved.sendOperationRepository,
      ...args: unknown[]
    ) {
      await update.apply(this, args)
      if ((args[0] as {state: string}).state === "pending")
        throw new Error("Synthetic post-commit failure")
    })
    try {
      const token = await createCashuToken(3, mint.url)
      expect((await listSavedCashuSends()).entries).toMatchObject([{state: "pending", token}])
      expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(1)
      expect(get(cashuTotalBalance)).toBe(13)
    } finally {
      write.mockRestore()
      saved.db.close()
    }
  })

  it.each(["resume", "cancel"])(
    "can %s a preparation interrupted before execution after reload",
    async action => {
      const mint = await fundedMint()
      const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
      await saved.init()
      const proto = Object.getPrototypeOf(saved.sendOperationRepository)
      const getById = proto.getById
      let interrupted = false
      const read = vi.spyOn(proto, "getById").mockImplementation(async function (
        this: typeof saved.sendOperationRepository,
        ...args: unknown[]
      ) {
        const operation = await getById.apply(this, args)
        if (operation?.state === "prepared" && !interrupted) {
          interrupted = true
          throw new Error("Synthetic interruption before execution")
        }
        return operation
      })
      try {
        await expect(createCashuToken(3, mint.url)).rejects.toBeInstanceOf(
          CashuSendUnconfirmedError,
        )
        read.mockRestore()
        await reloadCashuWallet()
        const [prepared] = (await listSavedCashuSends()).entries
        expect(prepared.state).toBe("prepared")
        expect(prepared.token).toBeUndefined()
        expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(0)
        if (action === "resume") {
          const [first, second] = await Promise.all([
            resumeCashuSend(prepared.id),
            resumeCashuSend(prepared.id),
          ])
          expect(first).toBe(second)
          expect((await getSavedCashuSend(prepared.id)).token).toBe(first)
          expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(1)
          expect(get(cashuTotalBalance)).toBe(13)
        } else {
          await cancelPreparedCashuSend(prepared.id)
          expect((await listSavedCashuSends()).entries).toEqual([])
          expect(get(cashuSpendableByMint).get(mint.url)).toBe(16)
        }
      } finally {
        read.mockRestore()
        saved.db.close()
      }
    },
  )

  it("retains an unconfirmed send and explicitly recovers it after a lost mint response", async () => {
    const mint = await fundedMint()
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (/\/v1\/(restore|checkstate)$/.test(String(input))) throw new Error("Offline recovery")
      const result = await mint.fetch(input, init)
      if (String(input).endsWith("/v1/swap")) throw new Error("Lost swap response")
      return result
    })
    await expect(createCashuToken(3, mint.url)).rejects.toBeInstanceOf(CashuSendUnconfirmedError)
    const [saved] = (await listSavedCashuSends()).entries
    expect(saved.state).toBe("executing")
    expect(saved.token).toBeUndefined()
    vi.stubGlobal("fetch", mint.fetch)
    await retryInterruptedCashuSends()
    expect((await listSavedCashuSends()).entries).toEqual([])
    expect((await getSavedCashuSend(saved.id)).state).toBe("rolled_back")
    expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(1)
    expect(get(cashuTotalBalance)).toBe(16)
  })

  it.each([
    {amount: 3, resend: false},
    {amount: 16, resend: false},
    {amount: 3, resend: true},
    {amount: 16, resend: true},
  ])(
    "preserves funds after token/recovery commit failures ($amount sats, resend=$resend)",
    async ({amount, resend}) => {
      const mint = await fundedMint()
      const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
      await saved.init()
      const proto = Object.getPrototypeOf(saved.sendOperationRepository)
      const update = proto.update
      const write = vi.spyOn(proto, "update").mockImplementation(async function (
        this: typeof saved.sendOperationRepository,
        ...args: unknown[]
      ) {
        if (["pending", "rolled_back"].includes((args[0] as {state: string}).state))
          throw new Error("Synthetic token commit failure")
        return update.apply(this, args)
      })
      try {
        await expect(createCashuToken(amount, mint.url)).rejects.toThrow()
        expect(await saved.sendOperationRepository.getByState("executing")).toHaveLength(1)
        write.mockRestore()
        expect(get(cashuTotalBalance)).toBe(16)
        // Recovery may restore proofs before its own terminal-state write fails.
        // A later recovery must not release those proofs from a newer send.
        if (resend) await createCashuToken(16, mint.url)
        await reloadCashuWallet()
        const sends = await saved.sendOperationRepository.getByState("pending")
        const savedAmount = sends
          .filter(entry => "token" in entry && entry.token)
          .reduce((sum, entry) => sum + entry.amount.toNumber(), 0)
        expect(get(cashuTotalBalance) + savedAmount).toBe(16)
        expect(get(cashuTotalBalance)).toBe(resend ? 0 : 16)
        expect(mint.calls.filter(call => call.path === "/v1/swap")).toHaveLength(
          amount === 16 ? 0 : 1,
        )
      } finally {
        write.mockRestore()
        saved.db.close()
      }
    },
  )

  it("does no historical status work at startup or preview, and budgets explicit cold receipt reconciliation", async () => {
    const mint = await fundedMint()
    const token = await createCashuToken(4, mint.url)
    await receiveCashuToken(token)
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    try {
      const receives = saved.db.table("coco_cashu_receive_operations")
      const sends = saved.db.table("coco_cashu_send_operations")
      const receipt = await receives.toCollection().first()
      const send = await sends.toCollection().first()
      await receives.delete(receipt.id)
      await receives.bulkAdd([
        {...receipt, id: "zz-target-receipt"},
        ...Array.from({length: 1205}, (_, i) => ({
          ...receipt,
          id: `history-${String(i).padStart(5, "0")}`,
          inputProofsJson: JSON.stringify(
            JSON.parse(receipt.inputProofsJson).map((p: object) => ({
              ...p,
              secret: `public-fixture-${i}`,
            })),
          ),
        })),
      ])
      await sends.bulkAdd(
        Array.from({length: 1205}, (_, i) => ({...send, id: `pending-fixture-${i}`})),
      )
      await clearCashuTokenChecks()
      const open = vi.spyOn(indexedDB, "open")
      const receiveReads = vi.spyOn(
        Object.getPrototypeOf(saved.receiveOperationRepository),
        "getById",
      )
      const sendReads = vi.spyOn(Object.getPrototypeOf(saved.sendOperationRepository), "getById")
      const sendStates = vi.spyOn(
        Object.getPrototypeOf(saved.sendOperationRepository),
        "getByState",
      )
      const mintStates = vi.spyOn(
        Object.getPrototypeOf(saved.mintOperationRepository),
        "getByState",
      )
      const history = vi.spyOn(
        Object.getPrototypeOf(saved.historyRepository),
        "getPaginatedHistoryEntries",
      )
      const before = mint.calls.length
      await reloadCashuWallet()
      expect(open.mock.calls.some(([name]) => name === CASHU_STATUS_DB)).toBe(false)
      expect(sendStates.mock.calls.some(([state]) => state === "pending")).toBe(false)
      expect(mintStates.mock.calls.some(([state]) => state === "finalized")).toBe(false)
      expect(history).not.toHaveBeenCalled()
      expect(receiveReads).not.toHaveBeenCalled()
      expect(sendReads).not.toHaveBeenCalled()
      expect(mint.calls).toHaveLength(before)

      expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
      expect(receiveReads).not.toHaveBeenCalled()
      expect(sendReads).not.toHaveBeenCalled()
      // A direct history-row ID also must not trigger a receive fallback scan.
      expect(
        (await loadCashuTokenStatus(token, {sendOperationId: send.id}))?.outgoing,
      ).toBeDefined()
      expect(receiveReads).not.toHaveBeenCalled()
      expect(sendReads).toHaveBeenCalledTimes(1)

      const cancelled = new AbortController()
      cancelled.abort()
      await expect(receiveCashuToken(token, cancelled.signal)).rejects.toMatchObject({
        name: "AbortError",
      })
      expect(receiveReads).not.toHaveBeenCalled()
      expect(mint.calls).toHaveLength(before)

      await expect(receiveCashuToken(token)).rejects.toBeInstanceOf(CashuReceiptLookupIncomplete)
      expect(receiveReads.mock.calls.length).toBeGreaterThan(0)
      expect(receiveReads.mock.calls.length).toBeLessThanOrEqual(RECEIPT_LOOKUP_ROWS)
      expect(mint.calls).toHaveLength(before)
      let received: number | undefined
      for (let attempt = 0; attempt < 30 && received === undefined; attempt++) {
        receiveReads.mockClear()
        try {
          received = await receiveCashuToken(token)
        } catch (error) {
          expect(error).toBeInstanceOf(CashuReceiptLookupIncomplete)
        }
        // Allow the final point lookup used to display the found receipt.
        expect(receiveReads.mock.calls.length).toBeLessThanOrEqual(RECEIPT_LOOKUP_ROWS + 1)
      }
      expect(received).toBe(4)
      expect(mint.calls).toHaveLength(before)
      expect((await loadCashuTokenStatus(token))?.received?.operationId).toBe("zz-target-receipt")
    } finally {
      saved.db.close()
    }
  })

  it("still recovers an interrupted send after a lost swap response at startup", async () => {
    const mint = await fundedMint()
    let lost = false
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (/\/v1\/(restore|checkstate)$/.test(String(input)))
        throw new Error("Synthetic offline recovery")
      const result = await mint.fetch(input, init)
      if (String(input).endsWith("/v1/swap") && !lost) {
        lost = true
        throw new Error("Synthetic lost response")
      }
      return result
    })
    await expect(createCashuToken(3, mint.url)).rejects.toThrow()
    const saved = new IndexedDbRepositories({name: "budabit-coco-wallet"})
    await saved.init()
    try {
      expect(await saved.sendOperationRepository.getByState("executing")).toHaveLength(1)
    } finally {
      saved.db.close()
    }
    const before = mint.calls.filter(c => c.path === "/v1/swap").length
    vi.stubGlobal("fetch", mint.fetch)
    await reloadCashuWallet()
    await refreshCashuHistory()
    expect(get(cashuTokenHistory)).toContainEqual(
      expect.objectContaining({direction: "sent", state: "rolled_back"}),
    )
    expect(mint.calls.filter(c => c.path === "/v1/swap")).toHaveLength(before)
    expect(get(cashuTotalBalance)).toBe(16)
  })

  it("promotes forward indexing for explicit lookups without waiting for queued previews", async () => {
    const mint = await fundedMint()
    const warm = await createCashuToken(2, mint.url)
    await loadCashuTokenStatus(warm, {explicit: true})
    // Simulate an indefinitely busy foreground. Optional background tasks never
    // get admitted; explicit point lookups and their forward writes must finish.
    const postTask = vi.fn(
      (_work: unknown, {signal}: {signal: AbortSignal}) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            {once: true},
          )
        }),
    )
    vi.stubGlobal("scheduler", {postTask})
    const token = await createCashuToken(2, mint.url)
    const controller = new AbortController()
    const preview = loadCashuTokenStatus(token, {signal: controller.signal})!
    const cancelled = expect(preview).rejects.toMatchObject({name: "AbortError"})
    expect((await loadCashuTokenStatus(token, {explicit: true}))?.outgoing?.state).toBe("created")
    controller.abort()
    await cancelled
    expect(postTask).toHaveBeenCalled()
  })

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
    await refreshCashuHistory()
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
    await refreshCashuTopUps()
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
    await refreshCashuHistory()
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
    await refreshCashuHistory()
    expect(get(cashuTokenHistory).some(entry => entry.id.includes(receipt.id))).toBe(false)
    expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
    const before = mint.calls.length
    expect(await receiveCashuToken(token)).toBe(4)
    expect(mint.calls).toHaveLength(before)
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
    expect((await loadCashuTokenStatus(token))?.received).toBeUndefined()
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
      const paused = await loadCashuTokenStatus(token, {explicit: true})
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
