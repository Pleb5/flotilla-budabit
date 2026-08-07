import {get} from "svelte/store"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Repository, Tracker} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  deriveEventsByIdByUrl,
  getter,
  synced,
  localStorageProvider,
  throttled,
  withGetter,
} from "../src/index"

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    clear: () => {
      store = {}
    },
  }
})()

vi.stubGlobal("localStorage", localStorageMock)

describe("Store utilities", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("synced", () => {
    it("should sync with localStorage", async () => {
      const store = synced({
        key: "testKey",
        storage: localStorageProvider,
        defaultValue: "default",
      })

      // Wait for async initialization using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      expect(get(store)).toBe("default")

      store.set("new value")

      // Wait for async save using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      expect(localStorage.getItem("testKey")).toBe(JSON.stringify("new value"))
    })

    it("should load existing value from localStorage", async () => {
      localStorage.setItem("testKey", JSON.stringify("existing"))
      const store = synced({
        key: "testKey",
        storage: localStorageProvider,
        defaultValue: "default",
      })

      // Wait for async initialization using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      expect(get(store)).toBe("existing")
    })
  })

  describe("getter", () => {
    it("should return current store value", async () => {
      const store = synced({
        key: "test",
        storage: localStorageProvider,
        defaultValue: "initial",
      })

      // Wait for async initialization using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      const getValue = getter(store)

      expect(getValue()).toBe("initial")
      store.set("updated")
      expect(getValue()).toBe("updated")
    })
  })

  describe("withGetter", () => {
    it("should add getter to writable store", async () => {
      const store = withGetter(
        synced({
          key: "test",
          storage: localStorageProvider,
          defaultValue: "initial",
        }),
      )

      // Wait for async initialization using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      expect(store.get()).toBe("initial")
      store.set("updated")
      expect(store.get()).toBe("updated")
    })
  })

  describe("throttled", () => {
    it("should throttle updates", async () => {
      const mockFn = vi.fn()
      const store = synced({
        key: "test",
        storage: localStorageProvider,
        defaultValue: 0,
      })

      // Wait for async initialization using vi.runAllTimersAsync
      await vi.runAllTimersAsync()

      const throttledStore = throttled(100, store)

      throttledStore.subscribe(mockFn)

      store.set(1)
      store.set(2)
      store.set(3)

      expect(mockFn).toHaveBeenCalledTimes(1) // Initial call

      vi.advanceTimersByTime(100)
      expect(mockFn).toHaveBeenCalledTimes(2)
      expect(mockFn).toHaveBeenLastCalledWith(3)
    })
  })

  describe("deriveEventsByIdByUrl", () => {
    it("reacts when relay provenance arrives after the repository event", () => {
      const repository = new Repository()
      const tracker = new Tracker()
      const relay = "wss://relay.example.com/"
      const reaction = {
        id: "reaction",
        pubkey: "a".repeat(64),
        kind: 7,
        created_at: 1,
        content: "+",
        tags: [["e", "comment"]],
        sig: "",
      } as TrustedEvent
      const store = deriveEventsByIdByUrl({
        repository,
        tracker,
        filters: [{kinds: [7], "#e": ["comment"]}],
      })
      let current = new Map<string, Map<string, TrustedEvent>>()
      const updates: Array<Map<string, Map<string, TrustedEvent>>> = []
      const unsubscribe = store.subscribe(value => {
        current = value
        updates.push(value)
      })

      repository.publish(reaction)
      expect(current.get(relay)).toBeUndefined()
      const updatesBeforeTracking = updates.length

      tracker.track(reaction.id, relay)

      expect(current.get(relay)?.get(reaction.id)).toBe(reaction)
      expect(updates).toHaveLength(updatesBeforeTracking + 1)
      unsubscribe()
    })
  })
})
