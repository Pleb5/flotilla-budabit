import "fake-indexeddb/auto"
import {afterEach, describe, expect, it, vi} from "vitest"
import {initializeCoco, type Manager} from "@cashu/coco-core"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {mnemonicToSeedSync} from "@scure/bip39"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {
  legacyCashuWallet,
  loadLegacyCashuWallet,
  loadCashuDatabaseFixture,
} from "../../../tests/helpers/cashu-idb-fixture"
import {Amount, getEncodedToken} from "@cashu/cashu-ts"

const open: {repo: IndexedDbRepositories; manager: Manager}[] = []
afterEach(async () => {
  for (const {repo, manager} of open.splice(0)) {
    await manager.dispose()
    repo.db.close()
  }
  vi.unstubAllGlobals()
})

const wallet = async (mint: CashuTestMint, name = `cashu-protocol-${crypto.randomUUID()}`) => {
  vi.stubGlobal("fetch", mint.fetch)
  const repo = new IndexedDbRepositories({name})
  await repo.init()
  const manager = await initializeCoco({
    repo,
    seedGetter: async () => mnemonicToSeedSync(legacyCashuWallet.mnemonic),
    watchers: {
      mintOperationWatcher: {disabled: true},
      proofStateWatcher: {disabled: true},
      meltQuoteWatcher: {disabled: true},
    },
    processors: {
      mintOperationProcessor: {disabled: true},
      meltSettlementProcessor: {disabled: true},
    },
  })
  open.push({repo, manager})
  await manager.mint.addMint(mint.url, {trusted: true})
  return {repo, manager}
}

describe("supported Cashu mint protocol", () => {
  it("reconciles and issues a quote-only v1 locked invoice using its retained key", async () => {
    const mint = new CashuTestMint({amounts: [1, 2, 4, 8, 16], url: legacyCashuWallet.mintUrl})
    const name = `legacy-quote-only-${crypto.randomUUID()}`
    const quoteOnly = structuredClone(legacyCashuWallet)
    quoteOnly.stores.find(store => store.name === "coco_cashu_mint_operations")!.rows = []
    await loadCashuDatabaseFixture(name, quoteOnly)
    const {repo, manager} = await wallet(mint, name)
    // initializeCoco reconciles legacy quotes before exposing the manager.
    expect(
      await manager.ops.mint.listByQuote({mintUrl: mint.url, quoteId: "mint-unpaid"}),
    ).toHaveLength(1)
    const quote = await manager.quotes.mint.get({mintUrl: mint.url, quoteId: "mint-unpaid"})
    mint.quotes.set("mint-unpaid", {
      quote: "mint-unpaid",
      amount: 4,
      unit: "sat",
      request: quote!.request,
      pubkey: quote!.pubkey,
      expiry: 4102444800,
      state: "PAID",
    })
    await manager.quotes.mint.refresh(quote!)
    const [operation] = await manager.ops.mint.listByQuote(quote!)
    expect((await manager.ops.mint.execute(operation)).state).toBe("finalized")
    expect(
      (await repo.proofRepository.getReadyProofs(mint.url))
        .filter(p => p.createdByOperationId === operation.id)
        .reduce((total, p) => total + p.amount.toNumber(), 0),
    ).toBe(4)
  })

  it("continues a v1 pending mint with its saved quote key and output secrets", async () => {
    const mint = new CashuTestMint({amounts: [1, 2, 4, 8, 16], url: legacyCashuWallet.mintUrl})
    const name = `legacy-issuance-${crypto.randomUUID()}`
    await loadLegacyCashuWallet(name)
    const {repo, manager} = await wallet(mint, name)
    const quote = await manager.quotes.mint.get({mintUrl: mint.url, quoteId: "mint-unpaid"})
    expect(quote).toBeTruthy()
    mint.quotes.set("mint-unpaid", {
      quote: "mint-unpaid",
      amount: 4,
      unit: "sat",
      request: quote!.request,
      pubkey: quote!.pubkey,
      expiry: 4102444800,
      state: "PAID",
    })
    await manager.quotes.mint.refresh(quote!)
    const before = await repo.counterRepository.getCounter(mint.url, mint.id)
    const result = await manager.ops.mint.execute("mint-pending")
    expect(result.state).toBe("finalized")
    expect(result.error).toBeUndefined()
    expect(await repo.counterRepository.getCounter(mint.url, mint.id)).toEqual(before)
    expect(
      (await repo.proofRepository.getReadyProofs(mint.url))
        .filter(p => p.createdByOperationId === "mint-pending")
        .reduce((total, p) => total + p.amount.toNumber(), 0),
    ).toBe(4)
  })

  it.each([0, 1] as const)(
    "spends a migrated %s keyset proof through a verified swap",
    async version => {
      const mint = new CashuTestMint({
        version,
        amounts: [1, 2, 4, 8, 16],
        url: legacyCashuWallet.mintUrl,
      })
      const name = `legacy-spend-${crypto.randomUUID()}`
      await loadLegacyCashuWallet(name)
      const repo = new IndexedDbRepositories({name})
      await repo.init()
      const proof = (await repo.proofRepository.getReadyProofs(mint.url)).find(
        p => p.id === mint.id,
      )!
      expect(proof).toBeTruthy()
      repo.db.close()
      const {manager} = await wallet(mint)
      const token = getEncodedToken({mint: mint.url, unit: "sat", proofs: [proof]})
      const prepared = await manager.ops.receive.prepare({token})
      await manager.ops.receive.execute(prepared)
      expect((await manager.wallet.balances.total()).total.equals(proof.amount)).toBe(true)
      expect(mint.calls.some(call => call.path === "/v1/swap")).toBe(true)
    },
  )

  it("recovers issuance after a crash using the original outputs, without minting twice", async () => {
    const mint = new CashuTestMint()
    const first = await wallet(mint)
    const quote = await first.manager.quotes.mint.create({
      mintUrl: mint.url,
      method: "bolt11",
      amount: 4,
      locked: true,
    })
    const operation = await first.manager.ops.mint.prepare({quote, amount: 4})
    const counter = await first.repo.counterRepository.getCounter(mint.url, mint.id)
    await first.repo.mintOperationRepository.update({...operation, state: "executing"})
    mint.issueBeforeCrash(
      quote.quoteId,
      operation.outputData.keep.map(o => ({
        ...o.blindedMessage,
        amount: String(o.blindedMessage.amount),
      })),
    )
    await first.manager.dispose()
    first.repo.db.close()
    const resumed = await wallet(mint, first.repo.db.name)
    await resumed.manager.ops.mint.recovery.run()
    expect((await resumed.manager.ops.mint.get(operation.id))?.state).toBe("finalized")
    expect((await resumed.manager.wallet.balances.total()).total.toNumber()).toBe(4)
    expect(await resumed.repo.counterRepository.getCounter(mint.url, mint.id)).toEqual(counter)
    expect(mint.mintAttempts).toBe(0)
    expect(mint.calls.some(c => c.path === "/v1/restore")).toBe(true)
  })

  it.each(["PENDING", "UNPAID", "PAID"] as const)(
    "reconciles a migrated %s melt during manager startup",
    async state => {
      const mint = new CashuTestMint({amounts: [1, 2, 4, 8, 16], url: legacyCashuWallet.mintUrl})
      mint.meltState = state
      const name = `legacy-melt-${crypto.randomUUID()}`
      await loadLegacyCashuWallet(name)
      const {repo, manager} = await wallet(mint, name)
      const operation = await manager.ops.melt.get("melt-pending")
      expect(operation?.state).toBe(
        state === "PENDING" ? "pending" : state === "PAID" ? "finalized" : "rolled_back",
      )
      const reserved = await repo.proofRepository.getProofsByOperationId(mint.url, "melt-pending")
      if (state === "PENDING")
        expect(reserved.some(p => p.usedByOperationId === "melt-pending")).toBe(true)
      if (state === "UNPAID")
        expect(
          (await manager.wallet.balances.total()).total.greaterThanOrEqual(Amount.from(14)),
        ).toBe(true)
    },
  )

  it.each(["current", "legacy"] as const)(
    "issues valid proofs with %s quote signatures",
    async signatureMode => {
      const mint = new CashuTestMint({signatureMode})
      const {repo, manager} = await wallet(mint)
      const quote = await manager.quotes.mint.create({
        mintUrl: mint.url,
        method: "bolt11",
        amount: 4,
        locked: true,
      })
      const operation = await manager.ops.mint.prepare({quote, amount: 4})
      expect(await repo.keyRingRepository.getAllPersistedKeyPairs()).toHaveLength(1)
      mint.pay(quote.quoteId)
      await manager.quotes.mint.refresh(quote)
      expect((await manager.ops.mint.execute(operation)).state).toBe("finalized")
      expect((await manager.wallet.balances.total()).total.toNumber()).toBe(4)
      expect(mint.mintAttempts).toBe(signatureMode === "legacy" ? 2 : 1)
    },
  )

  it("retains v2 keyset expiry metadata when constructing a wallet from persisted keys", async () => {
    const mint = new CashuTestMint({expiry: 4102444800})
    const {manager} = await wallet(mint)
    const quote = await manager.quotes.mint.create({
      mintUrl: mint.url,
      method: "bolt11",
      amount: 4,
      locked: true,
    })
    expect((await manager.ops.mint.prepare({quote, amount: 4})).state).toBe("pending")
  })

  it("restores spendable proofs from the same seed into a fresh database", async () => {
    const mint = new CashuTestMint()
    const first = await wallet(mint)
    const quote = await first.manager.quotes.mint.create({
      mintUrl: mint.url,
      method: "bolt11",
      amount: 4,
      locked: true,
    })
    const operation = await first.manager.ops.mint.prepare({quote, amount: 4})
    mint.pay(quote.quoteId)
    await first.manager.quotes.mint.refresh(quote)
    await first.manager.ops.mint.execute(operation)
    const restored = await wallet(mint)
    await restored.manager.wallet.restore(mint.url, {units: ["sat"]})
    expect((await restored.manager.wallet.balances.total()).total.toNumber()).toBe(4)
  })
})
