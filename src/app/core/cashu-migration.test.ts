import "fake-indexeddb/auto"
import {afterEach, describe, expect, it, vi} from "vitest"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {deriveSecretAndBlindingFactor, hashToCurve} from "@cashu/cashu-ts"
import {mnemonicToSeedSync} from "@scure/bip39"
import {
  legacyCashuWallet as fixture,
  loadLegacyCashuWallet,
} from "../../../tests/helpers/cashu-idb-fixture"
import {
  cashuSnapshotDatabaseName,
  prepareCashuStorageUpgrade,
  readCashuDatabaseSnapshot,
} from "./cashu-storage-migration"

// Public, never-funded fixture. The test deliberately exercises the actual storage adapter.
const mintUrl = fixture.mintUrl
const opened: IndexedDbRepositories[] = []

afterEach(() => {
  for (const repo of opened.splice(0)) repo.db.close()
  vi.restoreAllMocks()
})

describe("existing Cashu wallet compatibility", () => {
  it("opens the captured wallet and retains spendable cryptographic material and counters", async () => {
    const name = `cashu-v1-fixture-${crypto.randomUUID()}`
    await loadLegacyCashuWallet(name)
    await prepareCashuStorageUpgrade(name)
    const repo = new IndexedDbRepositories({name})
    opened.push(repo)
    await repo.init()

    const proofs = await repo.proofRepository.getReadyProofs(mintUrl)
    expect(proofs).toHaveLength(2)
    expect(proofs.reduce((sum, proof) => sum + proof.amount.toNumber(), 0)).toBe(6)
    const seed = mnemonicToSeedSync(fixture.mnemonic)
    for (const proof of proofs) {
      expect(proof.secret).toBe(
        Buffer.from(deriveSecretAndBlindingFactor(seed, proof.id, 0).secret).toString("hex"),
      )
      const scalar = BigInt([1, 2, 4, 8, 16].indexOf(proof.amount.toNumber()) + 1)
      expect(proof.C).toBe(
        hashToCurve(new TextEncoder().encode(proof.secret)).multiply(scalar).toHex(true),
      )
    }
    expect((await repo.counterRepository.getCounter(mintUrl, fixture.ids[0]))?.counter).toBe(1)
    expect((await repo.counterRepository.getCounter(mintUrl, fixture.ids[1]))?.counter).toBe(8)
    expect(await repo.proofRepository.getInflightProofs([mintUrl])).toHaveLength(2)
    expect((await repo.sendOperationRepository.getById("send-pending"))?.state).toBe("pending")
    expect((await repo.mintOperationRepository.getById("mint-pending"))?.state).toBe("pending")
    expect((await repo.meltOperationRepository.getById("melt-pending"))?.state).toBe("pending")
    expect((await repo.receiveOperationRepository.getById("receive-executing"))?.state).toBe(
      "executing",
    )
    const keypairs = await repo.keyRingRepository.getAllPersistedKeyPairs()
    expect(keypairs).toHaveLength(1)
    expect(keypairs[0].secretKey[31]).toBe(7)
    expect(keypairs[0].derivationIndex).toBe(3)
    expect(await repo.db.table("coco_cashu_history").count()).toBe(2)
    const mint = await repo.mintQuoteRepository.getMintQuoteById({mintUrl, quoteId: "mint-unpaid"})
    expect(mint).toMatchObject({
      method: "bolt11",
      request: "lnbc-fixture-unpaid",
      state: "UNPAID",
      pubkey: keypairs[0].publicKeyHex,
    })
    const melt = await repo.meltQuoteRepository.getMeltQuoteById({mintUrl, quoteId: "melt-pending"})
    expect(melt).toMatchObject({method: "bolt11", request: "lnbc-fixture-melt", state: "PENDING"})
    expect(melt?.amount.toNumber()).toBe(7)
    expect(repo.db.tables.some(table => table.name.endsWith("_staging"))).toBe(false)

    // Retain the exact blinding factors and output secrets needed after a lost response.
    for (const [table, field] of [
      ["coco_cashu_mint_operations", "outputDataJson"],
      ["coco_cashu_melt_operations", "changeOutputDataJson"],
      ["coco_cashu_receive_operations", "outputDataJson"],
    ]) {
      const original = fixture.stores.find(s => s.name === table)!.rows[0] as Record<
        string,
        unknown
      >
      const current = (await repo.db.table(table).toArray())[0]
      expect(JSON.parse(current[field])).toEqual(JSON.parse(original[field] as string))
    }

    repo.db.close()
    const backup = await readCashuDatabaseSnapshot(cashuSnapshotDatabaseName(name))
    const saved = backup!.stores[0].rows[0] as {version: number; stores: unknown[]}
    expect(saved.version).toBe(170)
    expect(saved.stores).toEqual(
      fixture.stores.map(s => expect.objectContaining({name: s.name, rows: s.rows})),
    )
    await prepareCashuStorageUpgrade(name)
    expect((await readCashuDatabaseSnapshot(cashuSnapshotDatabaseName(name)))!.stores).toEqual(
      backup!.stores,
    )
    const reopened = new IndexedDbRepositories({name})
    opened.push(reopened)
    await reopened.init()
    expect(await reopened.proofRepository.getReadyProofs(mintUrl)).toHaveLength(2)
  })

  it("rolls back the complete schema transition on failure, then retries without losing source rows", async () => {
    const name = `cashu-upgrade-failure-${crypto.randomUUID()}`
    await loadLegacyCashuWallet(name)
    const before = await readCashuDatabaseSnapshot(name)
    await prepareCashuStorageUpgrade(name)
    const failed = new IndexedDbRepositories({name})
    opened.push(failed)
    failed.db
      .version(33)
      .stores({})
      .upgrade(() => {
        throw new Error("Injected migration failure")
      })
    await failed.init()
    await expect(failed.db.open()).rejects.toThrow("Injected migration failure")
    failed.db.close()
    const after = await readCashuDatabaseSnapshot(name)
    expect(after?.version).toBe(170)
    expect(after?.stores).toEqual(before?.stores)
    const retry = new IndexedDbRepositories({name})
    opened.push(retry)
    await prepareCashuStorageUpgrade(name)
    await retry.init()
    expect(await retry.proofRepository.getReadyProofs(mintUrl)).toHaveLength(2)
  })

  it("leaves fresh wallets alone and fails closed if a legacy snapshot cannot be saved", async () => {
    const fresh = `cashu-fresh-${crypto.randomUUID()}`
    await prepareCashuStorageUpgrade(fresh)
    expect(await readCashuDatabaseSnapshot(fresh)).toBeNull()
    expect(await readCashuDatabaseSnapshot(cashuSnapshotDatabaseName(fresh))).toBeNull()
    const name = `cashu-snapshot-failure-${crypto.randomUUID()}`
    await loadLegacyCashuWallet(name)
    const open = indexedDB.open.bind(indexedDB)
    vi.spyOn(indexedDB, "open").mockImplementation((database, version) => {
      if (database === cashuSnapshotDatabaseName(name)) throw new Error("Storage unavailable")
      return open(database, version)
    })
    await expect(prepareCashuStorageUpgrade(name)).rejects.toThrow("Storage unavailable")
    expect((await readCashuDatabaseSnapshot(name))?.version).toBe(170)
  })
})
