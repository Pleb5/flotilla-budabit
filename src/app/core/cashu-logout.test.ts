// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  deleteIndexedDB: vi.fn().mockResolvedValue(undefined),
  storageRemove: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@lib/util", () => ({
  deleteIndexedDB: mocks.deleteIndexedDB,
}))

vi.mock("@app/core/cashu-storage", () => ({
  storageGet: vi.fn().mockResolvedValue(null),
  storageRemove: mocks.storageRemove,
  storageSet: vi.fn().mockResolvedValue(undefined),
}))

import {clearCashuWalletStorage} from "./cashu"

describe("Cashu logout cleanup", () => {
  beforeEach(() => {
    mocks.deleteIndexedDB.mockReset().mockResolvedValue(undefined)
    mocks.storageRemove.mockReset().mockResolvedValue(undefined)
    sessionStorage.clear()
  })

  it("clears wallet keys and deletes the wallet database", async () => {
    sessionStorage.setItem("budabit/unlocked-cashu-mnemonic", "secret words")

    await clearCashuWalletStorage()

    expect(sessionStorage.getItem("budabit/unlocked-cashu-mnemonic")).toBeNull()
    expect(mocks.storageRemove.mock.calls.map(([key]) => key)).toEqual([
      "budabit_cashu_mnemonic",
      "budabit_cashu_mnemonic_encrypted",
      "budabit_cashu_backup_confirmed",
      "budabit_cashu_autopay_whitelist",
    ])
    expect(mocks.deleteIndexedDB).toHaveBeenCalledWith("budabit-coco-wallet")
  })
})
