import "fake-indexeddb/auto"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {legacyCashuWallet} from "../../../tests/helpers/cashu-idb-fixture"

vi.mock("@lib/util", () => ({
  deleteIndexedDB: (name: string) =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    }),
}))
// Intentionally retain the production Coco watchers/processors. Disabling them
// missed the ALREADY_ISSUED terminal-error path in the original regression.
import {
  initializeCashuWallet,
  reloadCashuWallet,
  clearCashuWalletStorage,
  addCashuMint,
  requestMintQuote,
  mintTokensFromQuote,
  getCashuTopUp,
  refreshCashuTopUps,
  cashuTopUps,
  cashuTotalBalance,
  cashuTokenHistory,
  prepareCashuTopUp,
} from "./cashu"

let repo: IndexedDbRepositories
let mint: CashuTestMint
beforeEach(async () => {
  localStorage.setItem("budabit_cashu_mnemonic", legacyCashuWallet.mnemonic)
  localStorage.setItem("budabit_cashu_backup_confirmed", "true")
  mint = new CashuTestMint()
  vi.stubGlobal("fetch", mint.fetch)
  await initializeCashuWallet()
  await addCashuMint(mint.url)
  repo = new IndexedDbRepositories({name: "budabit-coco-wallet"})
  await repo.init()
})
afterEach(async () => {
  vi.restoreAllMocks()
  repo.db.close()
  await clearCashuWalletStorage()
  vi.unstubAllGlobals()
})

describe("durable top-up failures with production background processing", () => {
  it("keeps unrecovered issued outputs discoverable after reload and retries the original outputs", async () => {
    const quote = await requestMintQuote(mint.url, 4)
    const operation = await repo.mintOperationRepository.getById(quote.operationId!)
    if (!operation || operation.state === "init") throw new Error("Expected saved outputs")
    const counter = await repo.counterRepository.getCounter(mint.url, mint.id)
    mint.quotes.get(quote.quote)!.state = "ISSUED"
    await expect(mintTokensFromQuote(mint.url, quote.quote, 4)).rejects.toThrow()
    await reloadCashuWallet()
    expect(get(cashuTotalBalance)).toBe(0)
    expect(get(cashuTopUps)).toEqual([
      expect.objectContaining({quote: quote.quote, state: "recovery_required"}),
    ])
    expect(get(cashuTokenHistory)).toEqual([
      expect.objectContaining({state: "recovery_required", error: expect.any(String)}),
    ])
    // The mint later makes the ORIGINAL signatures available to NUT-09.
    mint.issueBeforeCrash(
      quote.quote,
      operation.outputData.keep.map(output => ({
        ...output.blindedMessage,
        amount: String(output.blindedMessage.amount),
      })),
    )
    const creates = vi.spyOn(repo.mintOperationRepository.constructor.prototype, "create")
    await Promise.all([
      mintTokensFromQuote(mint.url, quote.quote, 4),
      mintTokensFromQuote(mint.url, quote.quote, 4),
    ])
    expect(creates).not.toHaveBeenCalled()
    expect((await getCashuTopUp(mint.url, quote.quote)).state).toBe("complete")
    expect(get(cashuTotalBalance)).toBe(4)
    expect(get(cashuTokenHistory)).toEqual([
      expect.objectContaining({state: "finalized", error: undefined}),
    ])
    expect(get(cashuTopUps)).toEqual([])
    expect(await repo.counterRepository.getCounter(mint.url, mint.id)).toEqual(counter)
    expect((await repo.mintOperationRepository.getById(operation.id))!.state).toBe("finalized")
    await reloadCashuWallet()
    expect(get(cashuTotalBalance)).toBe(4)
    expect(get(cashuTopUps)).toEqual([])
  })

  it("never exposes a payable invoice if its output persistence fails, including after reload", async () => {
    const prototype = Object.getPrototypeOf(repo.mintOperationRepository)
    const update = prototype.update
    vi.spyOn(prototype, "update").mockImplementation(async function (
      this: typeof repo.mintOperationRepository,
      operation: any,
    ) {
      if (operation.state === "pending") throw new Error("Injected output persistence failure")
      return update.call(this, operation)
    })
    await expect(requestMintQuote(mint.url, 4)).rejects.toThrow("output persistence")
    await refreshCashuTopUps()
    expect(get(cashuTopUps)).toEqual([
      expect.objectContaining({state: "needs_preparation", request: ""}),
    ])
    await reloadCashuWallet()
    expect(get(cashuTopUps)).toEqual([
      expect.objectContaining({state: "needs_preparation", request: ""}),
    ])
    expect((await getCashuTopUp(mint.url, "q-1")).request).toBe("")
    await expect(prepareCashuTopUp(mint.url, "q-1")).rejects.toThrow("output persistence")
    expect((await getCashuTopUp(mint.url, "q-1")).request).toBe("")
    vi.restoreAllMocks()
    const [first, second] = await Promise.all([
      prepareCashuTopUp(mint.url, "q-1"),
      prepareCashuTopUp(mint.url, "q-1"),
    ])
    expect(first).toMatchObject({
      state: "unpaid",
      request: "lnbc-synthetic-unpayable",
      operationId: expect.any(String),
    })
    expect(second.operationId).toBe(first.operationId)
    const operation = await repo.mintOperationRepository.getById(first.operationId!)
    expect(operation).toMatchObject({state: "pending", outputData: {keep: expect.any(Array)}})
    expect(await repo.mintOperationRepository.getByMintUrl(mint.url)).toHaveLength(1)
    await reloadCashuWallet()
    expect(get(cashuTopUps)[0]).toMatchObject({state: "unpaid", operationId: first.operationId})
    mint.pay("q-1")
    await mintTokensFromQuote(mint.url, "q-1", 4)
    expect(get(cashuTotalBalance)).toBe(4)
  })
})
