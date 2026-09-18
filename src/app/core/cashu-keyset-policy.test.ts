import "fake-indexeddb/auto"
import {describe, expect, it} from "vitest"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {assertNoLegacyKeysetCollision, enforceCashuKeysetPolicy} from "./cashu-keyset-policy"

describe("wallet-wide legacy derivation policy", () => {
  it("rejects distinct IDs with the same NUT-13 residue and repeated IDs at another mint", () => {
    const known = [{mintUrl: "https://one.invalid", id: "0000000000000001"}]
    expect(() =>
      assertNoLegacyKeysetCollision(known, {
        mintUrl: "https://two.invalid",
        id: "0000000080000000",
      }),
    ).toThrow("collision")
    expect(() =>
      assertNoLegacyKeysetCollision(known, {...known[0], mintUrl: "https://two.invalid"}),
    ).toThrow("collision")
    expect(() => assertNoLegacyKeysetCollision(known, known[0])).not.toThrow()
    expect(() =>
      assertNoLegacyKeysetCollision(known, {
        mintUrl: "https://two.invalid",
        id: `01${"01".repeat(31)}`,
      }),
    ).not.toThrow()
  })

  it("serializes concurrent admission and preserves previously stored keys on rejection", async () => {
    const repo = new IndexedDbRepositories({name: `cashu-keyset-policy-${crypto.randomUUID()}`})
    await repo.init()
    enforceCashuKeysetPolicy(repo)
    try {
      const shared = {unit: "sat", keypairs: {}, active: true, feePpk: 0}
      const result = await Promise.allSettled([
        repo.keysetRepository.addKeyset({
          ...shared,
          mintUrl: "https://one.invalid",
          id: "0000000000000001",
        }),
        repo.keysetRepository.addKeyset({
          ...shared,
          mintUrl: "https://two.invalid",
          id: "0000000080000000",
        }),
      ])
      expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1)
      expect(result.filter(r => r.status === "rejected")).toHaveLength(1)
      expect(await repo.db.table("coco_cashu_keysets").count()).toBe(1)
      await expect(
        repo.keysetRepository.addKeyset({
          ...shared,
          mintUrl: "https://three.invalid",
          id: `02${"ab".repeat(32)}`,
        }),
      ).rejects.toThrow("BLS")
    } finally {
      repo.db.close()
    }
  })
})
