import {describe, expect, it} from "vitest"
import {Repository} from "@welshman/net"
import {getAddress, type TrustedEvent} from "@welshman/util"
import {deletionDeletesEvent, getDeletedTargetEventIds} from "./deletion-rules"

const target: TrustedEvent = {
  id: "old",
  pubkey: "a".repeat(64),
  created_at: 10,
  kind: 31923,
  tags: [["d", "calendar"]],
  content: "",
  sig: "",
}
const deleteEvent = (event: TrustedEvent, tag = "a", created_at = 11): TrustedEvent => ({
  ...event,
  id: "delete",
  kind: 5,
  created_at,
  tags: [[tag, tag === "a" ? getAddress(event) : event.id]],
})

describe("shared deletion rules", () => {
  it.each([0, 10002, 30222, 30617, 31923])(
    "uses coordinate cutoffs for replaceable kind %i",
    kind => {
      const old = {...target, kind}
      const deletion = deleteEvent(old)
      const newer = {...old, id: "new", created_at: 12}
      const repo = new Repository()
      repo.publish(old)
      repo.publish(deletion)
      expect(repo.isDeleted(old)).toBe(true)
      expect(deletionDeletesEvent(deletion, old)).toBe(true)
      repo.publish(newer)
      expect(repo.isDeleted(newer)).toBe(false)
      expect(deletionDeletesEvent(deletion, newer)).toBe(false)
      expect(repo.query([{kinds: [kind]}])).toEqual([newer])
      expect(getDeletedTargetEventIds([old, newer], [deletion])).toEqual(new Set([old.id]))
    },
  )

  it("agrees with the default repository on equal timestamps, foreign authors, and ID-only replaceables", () => {
    for (const kind of [11, 31923]) {
      const event = {...target, kind}
      const tag = kind === 11 ? "e" : "a"
      for (const deletion of [
        deleteEvent(event, tag, 10),
        deleteEvent(event, tag, 9),
        {...deleteEvent(event, tag), pubkey: "b".repeat(64)},
        deleteEvent(event, "e"),
      ]) {
        const repo = new Repository()
        repo.publish(event)
        repo.publish(deletion)
        expect(deletionDeletesEvent(deletion, event)).toBe(repo.isDeleted(event))
      }
    }
    expect(deletionDeletesEvent(deleteEvent(target, "e"), target)).toBe(false)
  })

  it("restores compact evidence before or after cached content with routed removals", () => {
    for (const restoreFirst of [false, true]) {
      const repo = new Repository()
      const removed = new Set<string>()
      repo.onRoutedUpdate({name: "calendar"}, {kinds: [target.kind]}, update =>
        update.removed.forEach(id => removed.add(id)),
      )
      const record = {target: getAddress(target), pubkey: target.pubkey, created_at: 11}
      if (restoreFirst) repo.restoreDeletions([record])
      repo.publish(target)
      if (!restoreFirst) repo.restoreDeletions([record])
      expect(repo.query([{kinds: [target.kind]}])).toEqual([])
      if (!restoreFirst) expect(removed.has(target.id)).toBe(true)
      const newer = {...target, id: "new", created_at: 12}
      repo.publish(newer)
      expect(repo.query([{kinds: [target.kind]}])).toEqual([newer])
    }
  })

  it("retracts regular IDs regardless of clock skew and ignores nonreplaceable coordinates", () => {
    const event = {...target, kind: 11}
    const repo = new Repository()
    repo.publish(event)
    const invalidAddressDelete = deleteEvent(event)
    repo.publish(invalidAddressDelete)
    expect(repo.isDeleted(event)).toBe(false)
    expect(deletionDeletesEvent(invalidAddressDelete, event)).toBe(false)
    const skewedDelete = {...deleteEvent(event, "e", 9), id: "skewed"}
    repo.publish(skewedDelete)
    expect(repo.isDeleted(event)).toBe(true)
    expect(deletionDeletesEvent(skewedDelete, event)).toBe(true)
  })
})
