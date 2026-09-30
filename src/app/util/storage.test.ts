import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {repository, tracker} from "@welshman/app"
import {REACTION, type TrustedEvent} from "@welshman/util"
import type {IDBTable} from "@lib/indexeddb"
import {
  eventsAdapter,
  mergePersistedEvents,
  mergePersistedRelayProvenance,
  migratePersistedRelayRecords,
  trackerAdapter,
  type TrackerItem,
} from "./storage"

const pubkey = "1".repeat(64)
const communityIdA = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
const communityIdB = "4d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766"
const makeEvent = ({
  id,
  createdAt,
  content,
  kind = 0,
  tags = [],
}: {
  id: string
  createdAt: number
  content: string
  kind?: number
  tags?: string[][]
}) =>
  ({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: "2".repeat(128),
  }) as TrustedEvent

const makeTable = <T>(initial: T[] = []) =>
  ({
    getAll: vi.fn().mockResolvedValue(initial),
    bulkPut: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IDBTable<T>

describe("storage hydration", () => {
  beforeEach(() => {
    repository.load([])
    tracker.clear()
  })

  afterEach(() => {
    repository.load([])
    tracker.clear()
    vi.useRealTimers()
  })

  it("keeps newer in-memory replaceable events during late hydration", () => {
    const cached = makeEvent({id: "a".repeat(64), createdAt: 10, content: "cached"})
    const live = makeEvent({id: "b".repeat(64), createdAt: 20, content: "live"})
    repository.publish(live)

    mergePersistedEvents([cached])

    expect(repository.getEvent(`0:${pubkey}:`)).toBe(live)
    expect(repository.getEvent(cached.id)).toBeUndefined()
  })

  it("notifies repository subscribers once for a persisted batch", () => {
    const first = makeEvent({id: "3".repeat(64), createdAt: 10, content: "first"})
    const second = makeEvent({id: "4".repeat(64), createdAt: 10, content: "second", kind: 1})
    const listener = vi.fn()
    const unsubscribe = repository.onUpdate({name: "storage-hydration-test"}, listener)

    try {
      mergePersistedEvents([first, second])
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it("preserves compact tombstones when the main event cache opens late", () => {
    const cached = makeEvent({
      id: "5".repeat(64),
      createdAt: 10,
      content: "deleted thread",
      kind: 11,
    })
    repository.restoreDeletions([{target: cached.id, pubkey, created_at: 11}])
    mergePersistedEvents([cached])
    expect(repository.query([{ids: [cached.id]}])).toEqual([])
    expect(repository.isDeleted(cached)).toBe(true)
  })

  it("merges persisted provenance with relays learned after startup", () => {
    tracker.addRelay("event", "wss://live.example")

    mergePersistedRelayProvenance([
      {id: "event", relays: ["wss://cached.example", "wss://live.example"]},
    ])

    expect(Array.from(tracker.getRelays("event")).sort()).toEqual([
      "wss://cached.example/",
      "wss://live.example/",
    ])
  })

  it("migrates mixed persisted provenance into exact inverse canonical indexes", () => {
    const migrated = mergePersistedRelayProvenance([
      {
        id: "event",
        relays: [
          "WSS://RELAY.EXAMPLE",
          "wss://relay.example/",
          "wss://relay.example/Path",
          "invalid",
        ],
      },
    ])

    expect(migrated).toEqual(new Set(["event"]))
    expect(tracker.relaysById).toEqual(
      new Map([["event", new Set(["wss://relay.example/", "wss://relay.example/Path"])]]),
    )
    expect(tracker.idsByRelay).toEqual(
      new Map([
        ["wss://relay.example/", new Set(["event"])],
        ["wss://relay.example/Path", new Set(["event"])],
      ]),
    )
  })

  it("migrates relay-keyed records and prefers an existing canonical row", () => {
    const migrated = migratePersistedRelayRecords([
      {url: "WSS://RELAY.EXAMPLE", name: "legacy"},
      {url: "wss://relay.example/", name: "canonical"},
      {url: "invalid", name: "invalid"},
    ])

    expect(migrated.records).toEqual([{url: "wss://relay.example/", name: "canonical"}])
    expect(migrated.staleKeys).toEqual(["WSS://RELAY.EXAMPLE", "invalid"])
  })

  it("loads persisted provenance as one tracker update", () => {
    const load = vi.spyOn(tracker, "load")

    mergePersistedRelayProvenance([
      {id: "first", relays: ["wss://one.example"]},
      {id: "second", relays: ["wss://two.example"]},
    ])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it("persists provenance after the eligible event becomes observable", async () => {
    vi.useFakeTimers()
    const event = makeEvent({id: "c".repeat(64), createdAt: 30, content: "profile"})
    const eventTable = makeTable<TrustedEvent>()
    const trackerTable = makeTable<TrackerItem>()
    const stopEvents = await eventsAdapter.init(eventTable)
    const stopTracker = await trackerAdapter.init(trackerTable)

    try {
      tracker.addRelay(event.id, "wss://repo.example")
      repository.publish(event)
      await vi.advanceTimersByTimeAsync(3000)

      expect(trackerTable.bulkPut).toHaveBeenCalledWith([
        {id: event.id, relays: ["wss://repo.example/"]},
      ])
    } finally {
      stopTracker()
      stopEvents()
    }
  })

  it("writes canonical migrated provenance and deletes empty records during hydration", async () => {
    const event = makeEvent({id: "9".repeat(64), createdAt: 30, content: "profile"})
    repository.publish(event)
    const table = makeTable<TrackerItem>([
      {id: event.id, relays: ["WSS://REPO.EXAMPLE", "wss://repo.example/", "invalid"]},
      {id: "invalid-only", relays: ["invalid"]},
    ])

    const stop = await trackerAdapter.init(table)

    try {
      expect(table.bulkPut).toHaveBeenCalledWith([{id: event.id, relays: ["wss://repo.example/"]}])
      expect(table.bulkDelete).toHaveBeenCalledWith(["invalid-only"])
      expect(event.id).toBe("9".repeat(64))
    } finally {
      stop()
    }
  })

  it("writes migrated provenance even when the event is not currently loaded", async () => {
    const id = "8".repeat(64)
    const table = makeTable<TrackerItem>([{id, relays: ["WSS://REPO.EXAMPLE"]}])

    const stop = await trackerAdapter.init(table)

    try {
      expect(table.bulkPut).toHaveBeenCalledWith([{id, relays: ["wss://repo.example/"]}])
    } finally {
      stop()
    }
  })

  it("updates persisted provenance when one relay is removed", async () => {
    const event = makeEvent({id: "7".repeat(64), createdAt: 30, content: "profile"})
    const table = makeTable<TrackerItem>()
    repository.publish(event)
    tracker.addRelay(event.id, "wss://one.example")
    tracker.addRelay(event.id, "wss://two.example")
    const stop = await trackerAdapter.init(table)
    vi.mocked(table.bulkPut).mockClear()

    try {
      tracker.removeRelay(event.id, "wss://one.example")
      await vi.waitFor(() =>
        expect(table.bulkPut).toHaveBeenCalledWith([
          {id: event.id, relays: ["wss://two.example/"]},
        ]),
      )
      expect(table.bulkDelete).not.toHaveBeenCalledWith([event.id])
    } finally {
      stop()
    }
  })

  it("deletes persisted provenance when the tracker is cleared", async () => {
    const id = "6".repeat(64)
    tracker.addRelay(id, "wss://one.example")
    const table = makeTable<TrackerItem>()
    const stop = await trackerAdapter.init(table)

    try {
      tracker.clear()
      await vi.waitFor(() => expect(table.bulkDelete).toHaveBeenCalledWith([id]))
    } finally {
      stop()
    }
  })

  it("caches kind 32222 sibling definitions by exact d coordinate, not legacy definitions", async () => {
    vi.useFakeTimers()
    const first = makeEvent({
      id: "d".repeat(64),
      createdAt: 30,
      content: "",
      kind: 32222,
      tags: [["d", communityIdA]],
    })
    const second = makeEvent({
      id: "e".repeat(64),
      createdAt: 31,
      content: "",
      kind: 32222,
      tags: [["d", communityIdB]],
    })
    const legacy = makeEvent({
      id: "f".repeat(64),
      createdAt: 32,
      content: "",
      kind: 10222,
    })
    const eventTable = makeTable<TrustedEvent>()
    const stopEvents = await eventsAdapter.init(eventTable)

    try {
      repository.publish(first)
      repository.publish(second)
      repository.publish(legacy)
      await vi.advanceTimersByTimeAsync(3000)

      expect(
        vi.mocked(eventTable.bulkPut).mock.calls.flatMap(([events]) => Array.from(events)),
      ).toEqual([first, second])
      expect(repository.getEvent(`0:${communityIdA}:`)).toBeUndefined()
      expect(repository.getEvent(`0:${communityIdB}:`)).toBeUndefined()
    } finally {
      stopEvents()
    }
  })

  it("caches community stars only when they target kind 32222", async () => {
    vi.useFakeTimers()
    const current = makeEvent({
      id: "7".repeat(64),
      createdAt: 40,
      content: "+",
      kind: REACTION,
      tags: [["k", "32222"]],
    })
    const legacy = makeEvent({
      id: "8".repeat(64),
      createdAt: 41,
      content: "+",
      kind: REACTION,
      tags: [["k", "10222"]],
    })
    const eventTable = makeTable<TrustedEvent>()
    const stopEvents = await eventsAdapter.init(eventTable)

    try {
      repository.publish(current)
      repository.publish(legacy)
      await vi.advanceTimersByTimeAsync(3000)

      expect(
        vi.mocked(eventTable.bulkPut).mock.calls.flatMap(([events]) => Array.from(events)),
      ).toEqual([current])
    } finally {
      stopEvents()
    }
  })
})
