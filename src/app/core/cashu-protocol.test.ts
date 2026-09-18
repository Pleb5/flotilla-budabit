import "fake-indexeddb/auto"
import {afterEach, describe, expect, it, vi} from "vitest"
import {initializeCoco, type Manager} from "@cashu/coco-core"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {mnemonicToSeedSync} from "@scure/bip39"
import {CashuTestMint} from "../../../tests/helpers/cashu-mint"
import {legacyCashuWallet} from "../../../tests/helpers/cashu-idb-fixture"

const open: {repo: IndexedDbRepositories; manager: Manager}[] = []
afterEach(async () => {
  for (const {repo, manager} of open.splice(0)) {
    await manager.dispose()
    repo.db.close()
  }
  vi.unstubAllGlobals()
})

const wallet = async (mint: CashuTestMint) => {
  vi.stubGlobal("fetch", mint.fetch)
  const repo = new IndexedDbRepositories({name: `cashu-protocol-${crypto.randomUUID()}`})
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
})
