import "fake-indexeddb/auto"
import {afterEach, describe, expect, it} from "vitest"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {deriveSecret, hashToCurve} from "@cashu/cashu-ts"
import {mnemonicToSeedSync} from "@scure/bip39"
import {
  legacyCashuWallet as fixture,
  loadLegacyCashuWallet,
} from "../../../tests/helpers/cashu-idb-fixture"

// Public, never-funded fixture. The test deliberately exercises the actual storage adapter.
const mintUrl = fixture.mintUrl
const opened: IndexedDbRepositories[] = []

afterEach(() => {
  for (const repo of opened.splice(0)) repo.db.close()
})

describe("existing Cashu wallet compatibility", () => {
  it("opens the captured wallet and retains spendable cryptographic material and counters", async () => {
    const name = `cashu-v1-fixture-${crypto.randomUUID()}`
    await loadLegacyCashuWallet(name)
    const repo = new IndexedDbRepositories({name})
    opened.push(repo)
    await repo.init()

    const proofs = await repo.proofRepository.getReadyProofs(mintUrl)
    expect(proofs).toHaveLength(2)
    expect(proofs.reduce((sum, proof) => sum + Number(proof.amount), 0)).toBe(6)
    const seed = mnemonicToSeedSync(fixture.mnemonic)
    for (const proof of proofs) {
      expect(proof.secret).toBe(Buffer.from(deriveSecret(seed, proof.id, 0)).toString("hex"))
      const scalar = BigInt([1, 2, 4, 8, 16].indexOf(Number(proof.amount)) + 1)
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
  })
})
