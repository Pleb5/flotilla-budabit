import type {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import type {Keyset} from "@cashu/coco-core"

type Identity = Pick<Keyset, "mintUrl" | "id">
const legacyIndex = (id: string) =>
  /^00[0-9a-f]{14}$/i.test(id) ? BigInt(`0x${id}`) % 2147483647n : null

export const assertNoLegacyKeysetCollision = (known: Identity[], candidate: Identity): void => {
  const index = legacyIndex(candidate.id)
  if (index === null) return
  for (const existing of known) {
    if (existing.mintUrl === candidate.mintUrl && existing.id === candidate.id) continue
    if (legacyIndex(existing.id) === index) {
      throw new Error(
        "Legacy Cashu keyset derivation collision. This mint/keyset cannot safely share this wallet seed.",
      )
    }
  }
}

// Admission is wallet-wide, including inactive and untrusted cached keysets.
// A single read/write transaction also serializes admission across browser tabs.
export const enforceCashuKeysetPolicy = (repo: IndexedDbRepositories): void => {
  const keysets = repo.keysetRepository
  const add = keysets.addKeyset.bind(keysets)
  const update = keysets.updateKeyset.bind(keysets)
  const guarded = async (keyset: Identity, save: () => Promise<void>) => {
    if (!/^(00|01)[0-9a-f]+$/i.test(keyset.id))
      throw new Error("Unsupported Cashu keyset; BLS is not enabled")
    await repo.db.transaction("rw", "coco_cashu_keysets", async () => {
      assertNoLegacyKeysetCollision(await repo.db.table("coco_cashu_keysets").toArray(), keyset)
      await save()
    })
  }
  keysets.addKeyset = keyset => guarded(keyset, () => add(keyset))
  keysets.updateKeyset = keyset => guarded(keyset, () => update(keyset))
}
