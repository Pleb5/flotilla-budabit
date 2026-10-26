import {describe, expect, it} from "vitest"
import {get} from "svelte/store"
import {createApplicationVisibility} from "./application-visibility"

const account = "a".repeat(64)
const first = "1".repeat(64)
const second = "2".repeat(64)
const community = `32222:${"b".repeat(64)}:first`
const makeStorage = () => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("personal application visibility", () => {
  it("persists only the exact application and restores without retaining a review decision", () => {
    const storage = makeStorage()
    const preferences = createApplicationVisibility(account, community, storage)
    preferences.setHidden(first, true)
    expect(get(preferences).hiddenIds).toEqual(new Set([first]))
    expect(get(preferences).hiddenIds.has(second)).toBe(false)
    const refreshed = createApplicationVisibility(account, community, storage)
    expect(get(refreshed).hiddenIds).toEqual(new Set([first]))
    refreshed.setHidden(first, false)
    expect(get(refreshed).hiddenIds.size).toBe(0)
  })

  it("isolates accounts and exact community addresses, including same-owner communities", () => {
    const storage = makeStorage()
    createApplicationVisibility(account, community, storage).setHidden(first, true)
    for (const [otherAccount, otherCommunity] of [
      ["c".repeat(64), community],
      [account, community.replace(":first", ":second")],
      ["", community],
    ]) {
      expect(
        get(createApplicationVisibility(otherAccount, otherCommunity, storage)).hiddenIds.size,
      ).toBe(0)
    }
    expect(get(createApplicationVisibility(account, community, storage)).hiddenIds.has(first)).toBe(
      true,
    )
  })

  it("retains changes from another instance when saving", () => {
    const storage = makeStorage()
    const one = createApplicationVisibility(account, community, storage)
    const two = createApplicationVisibility(account, community, storage)
    one.setHidden(first, true)
    two.setHidden(second, true)
    one.setHidden(first, false)
    expect(get(one).hiddenIds).toEqual(new Set([second]))
  })

  it("does not optimistically hide when persistence fails", () => {
    const storage = makeStorage()
    const preferences = createApplicationVisibility(account, community, storage)
    const stop = preferences.subscribe(() => {})
    storage.setItem = () => {
      throw new Error("Quota exceeded")
    }
    expect(() => preferences.setHidden(first, true)).toThrow("Quota exceeded")
    expect(get(preferences).hiddenIds.size).toBe(0)
    stop()
  })

  it("preserves unreadable records instead of silently overwriting them", () => {
    const storage = makeStorage()
    const preferences = createApplicationVisibility(account, community, storage)
    preferences.setHidden(first, true)
    const key = [...storage.values.keys()][0]
    storage.values.set(key, "{broken")
    expect(get(preferences).error).toContain("could not be read")
    expect(() => preferences.setHidden(second, true)).toThrow()
    expect(storage.values.get(key)).toBe("{broken")
  })
})
