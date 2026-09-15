import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({load: vi.fn()}))
vi.mock("@welshman/app", () => ({repository: {}}))
vi.mock("@app/core/community-state", () => ({loadCommunityEventsWithStatus: mocks.load}))
vi.mock("@app/core/profile-resolver", () => ({
  getBudabitProfileRelays: () => ["wss://profiles.example/"],
}))
vi.mock("@app/core/community-relays", () => ({getPubkeyOutboxRelays: () => []}))

import {loadProfileIdentities} from "./profile-identities"

beforeEach(() => mocks.load.mockReset())

describe("profile identity hydration", () => {
  it("deduplicates in-flight lookups and caches successful loads", async () => {
    let complete: (value: unknown) => void = () => undefined
    mocks.load.mockReturnValue(
      new Promise(resolve => {
        complete = resolve
      }),
    )
    const first = loadProfileIdentities("a".repeat(64))
    const second = loadProfileIdentities("a".repeat(64))
    expect(second).toBe(first)
    complete({events: [], complete: true})
    await first
    await loadProfileIdentities("a".repeat(64))
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.load).toHaveBeenCalledWith(
      ["wss://profiles.example/"],
      [{kinds: [10011], authors: ["a".repeat(64)], limit: 1}],
      {timeout: 5000},
    )
  })
  it("does not treat unavailable relays as proof removal and allows retry", async () => {
    mocks.load
      .mockResolvedValueOnce({
        events: [],
        complete: false,
        outcomes: {"wss://profiles.example/": "timeout"},
      })
      .mockResolvedValueOnce({events: [], complete: true})
    await expect(loadProfileIdentities("b".repeat(64))).rejects.toThrow("could not be reached")
    await expect(loadProfileIdentities("b".repeat(64))).resolves.toBeUndefined()
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })
  it("can load from a responding relay even when another relay fails, and refresh on edit", async () => {
    mocks.load.mockResolvedValue({
      events: [],
      complete: false,
      outcomes: {"wss://profiles.example/": "complete", "wss://offline.example/": "timeout"},
    })
    await loadProfileIdentities("c".repeat(64))
    await loadProfileIdentities("c".repeat(64), [], true)
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })
})
