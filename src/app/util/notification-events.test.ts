import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {NotificationEventStore} from "./notification-events"

const makeEvent = (
  id: string,
  createdAt: number,
  overrides: Partial<TrustedEvent> = {},
): TrustedEvent =>
  ({
    id,
    kind: 1,
    pubkey: "a".repeat(64),
    created_at: createdAt,
    tags: [],
    content: id,
    sig: "b".repeat(128),
    ...overrides,
  }) as TrustedEvent

describe("NotificationEventStore", () => {
  it("retains only the newest events up to its size bound", () => {
    const store = new NotificationEventStore(2, 1_000)

    store.publish(makeEvent("newest", 90), "wss://one.example", 100)
    store.publish(makeEvent("oldest", 70), "wss://one.example", 100)
    store.publish(makeEvent("middle", 80), "wss://two.example", 100)

    expect(store.size).toBe(2)
    expect(store.repository.getEvent("oldest")).toBeUndefined()
    expect(store.repository.getEvent("middle")?.id).toBe("middle")
    expect(store.repository.getEvent("newest")?.id).toBe("newest")
  })

  it("rejects expired events and prunes events that age out", () => {
    const store = new NotificationEventStore(10, 20)

    expect(store.publish(makeEvent("expired", 79), "wss://one.example", 100)).toBe(false)
    store.publish(makeEvent("current", 90), "wss://one.example", 100)
    store.publish(makeEvent("later", 111), "wss://one.example", 111)

    expect(store.repository.getEvent("expired")).toBeUndefined()
    expect(store.repository.getEvent("current")).toBeUndefined()
    expect(store.repository.getEvent("later")?.id).toBe("later")
  })

  it("bounds relay provenance with its event", () => {
    const store = new NotificationEventStore(1, 1_000)
    const event = makeEvent("event", 100)

    store.publish(event, "wss://one.example", 100)
    store.publish(event, "wss://two.example", 100)
    expect(store.getRelays(event.id)).toEqual(["wss://one.example", "wss://two.example"])

    store.publish(makeEvent("replacement", 101), "wss://three.example", 101)
    expect(store.getRelays(event.id)).toEqual([])
  })

  it("removes superseded replaceable events without corrupting the address index", () => {
    const store = new NotificationEventStore(10, 1_000)
    const tags = [["d", "widget"]]
    const older = makeEvent("older", 100, {kind: 30_001, tags})
    const newer = makeEvent("newer", 110, {kind: 30_001, tags})

    store.publish(older, "wss://one.example", 110)
    store.publish(newer, "wss://two.example", 110)

    expect(store.repository.getEvent(older.id)).toBeUndefined()
    expect(store.repository.getEvent(`30001:${newer.pubkey}:widget`)?.id).toBe(newer.id)
    expect(store.size).toBe(1)
  })
})
