// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
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
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("personal application visibility", () => {
  let frame: HTMLIFrameElement
  beforeEach(() => {
    // The global test setup installs a Map fake. Use a fresh DOM window's real
    // Storage implementation for deterministic cross-tab interleavings/events.
    frame = document.createElement("iframe")
    document.body.appendChild(frame)
    vi.stubGlobal("localStorage", frame.contentWindow!.localStorage)
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    frame.remove()
  })
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

  it.each(["hide/hide", "restore/hide"])(
    "preserves interleaved %s intents in actual localStorage",
    mode => {
      const otherTab = createApplicationVisibility(account, community, localStorage)
      if (mode === "restore/hide") otherTab.setHidden(first, true)
      let interleave = true
      const storage = {
        get length() {
          return localStorage.length
        },
        key: (index: number) => localStorage.key(index),
        getItem: (key: string) => localStorage.getItem(key),
        setItem: (key: string, value: string) => {
          // The outer tab has already read. The other tab commits before the
          // outer write, reproducing the lost-update/resurrected-entry ordering.
          if (interleave) {
            interleave = false
            otherTab.setHidden(first, mode === "hide/hide")
          }
          localStorage.setItem(key, value)
        },
      }
      createApplicationVisibility(account, community, storage).setHidden(second, true)
      const reloaded = get(createApplicationVisibility(account, community, localStorage))
      expect(reloaded.hiddenIds).toEqual(new Set(mode === "hide/hide" ? [first, second] : [second]))
    },
  )

  it("overrides legacy entries per application without rewriting or losing legacy data", () => {
    const key = `budabit/hidden-applications:v1:${account}:${encodeURIComponent(community)}`
    const legacy = JSON.stringify({version: 1, hidden: [first]})
    localStorage.setItem(key, legacy)
    const one = createApplicationVisibility(account, community)
    const two = createApplicationVisibility(account, community)
    one.setHidden(first, false)
    two.setHidden(second, true)
    expect(get(createApplicationVisibility(account, community)).hiddenIds).toEqual(
      new Set([second]),
    )
    expect(localStorage.getItem(key)).toBe(legacy)
    localStorage.setItem(key, JSON.stringify({version: 99, hidden: []}))
    expect(get(one).error).toContain("could not be read")
    expect(() => one.setHidden(first, true)).toThrow()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({version: 99, hidden: []})
  })

  it("refreshes scoped application removals and storage clears and disposes listeners", () => {
    const store = createApplicationVisibility(account, community)
    const snapshots: Set<string>[] = []
    const unsubscribe = store.subscribe(value => snapshots.push(value.hiddenIds))
    store.setHidden(first, true)
    const key = localStorage.key(0)!
    localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent("storage", {key, storageArea: localStorage}))
    expect(snapshots.at(-1)?.size).toBe(0)
    store.setHidden(second, true)
    localStorage.clear()
    window.dispatchEvent(new StorageEvent("storage", {key: null, storageArea: localStorage}))
    expect(snapshots.at(-1)?.size).toBe(0)
    const count = snapshots.length
    unsubscribe()
    window.dispatchEvent(new StorageEvent("storage", {key, storageArea: localStorage}))
    expect(snapshots).toHaveLength(count)
  })

  it("ignores other-account storage events and never reads their record contents", () => {
    const other = createApplicationVisibility("c".repeat(64), community)
    other.setHidden(first, true)
    const otherKey = localStorage.key(0)!
    localStorage.setItem(otherKey, "{unreadable unrelated account")
    const reads: string[] = []
    const storage = {
      get length() {
        return localStorage.length
      },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => {
        reads.push(key)
        return localStorage.getItem(key)
      },
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
    }
    const store = createApplicationVisibility(account, community, storage)
    const stop = store.subscribe(() => {})
    expect(reads).not.toContain(otherKey)
    const count = reads.length
    window.dispatchEvent(new StorageEvent("storage", {key: otherKey, storageArea: localStorage}))
    expect(reads).toHaveLength(count)
    expect(get(store).error).toBeUndefined()
    stop()
  })
})
