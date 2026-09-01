import {describe, expect, it} from "vitest"
import {
  PR_DELIVERY_RECOVERY_MAX_AGE_MS,
  clearPrDeliveryRecovery,
  getPrDeliveryRecoveryKey,
  loadPrDeliveryRecovery,
  savePrDeliveryRecovery,
  type PrDeliveryRecovery,
} from "./pr-delivery-recovery"

const rootId = "a".repeat(64)
const recovery: PrDeliveryRecovery = {
  savedAt: 100,
  identity: {
    rootId,
    tipOid: "1".repeat(40),
    targetBranch: "main",
    targetOid: "2".repeat(40),
    announcementId: "announcement",
    primaryUrl: "https://primary.example/repo.git",
    mergeOid: "3".repeat(40),
    actor: "4".repeat(64),
  },
  commits: ["1".repeat(40)],
  remotes: [
    {
      remote: "origin",
      url: "https://primary.example/repo.git",
      provider: "github",
      selected: true,
      primary: true,
      status: "unknown",
    },
  ],
  appliedStatusPending: false,
  completed: false,
}

const makeStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe("PR delivery recovery", () => {
  it("round-trips exact delivery evidence and clears it", () => {
    const storage = makeStorage()
    savePrDeliveryRecovery(storage, recovery)
    expect(loadPrDeliveryRecovery(storage, rootId, recovery.identity.actor, 101)).toEqual(recovery)
    clearPrDeliveryRecovery(storage, rootId, recovery.identity.actor)
    expect(storage.getItem(getPrDeliveryRecoveryKey(rootId, recovery.identity.actor))).toBeNull()
  })

  it("discards expired or malformed recovery data", () => {
    const storage = makeStorage()
    savePrDeliveryRecovery(storage, recovery)
    expect(
      loadPrDeliveryRecovery(
        storage,
        rootId,
        recovery.identity.actor,
        recovery.savedAt + PR_DELIVERY_RECOVERY_MAX_AGE_MS + 1,
      ),
    ).toBeNull()

    storage.setItem(
      getPrDeliveryRecoveryKey(rootId, recovery.identity.actor),
      JSON.stringify({...recovery, commits: ["bad"]}),
    )
    expect(loadPrDeliveryRecovery(storage, rootId, recovery.identity.actor, 101)).toBeNull()
  })
})
