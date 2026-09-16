import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {Repository} from "../src/repository"

// Protocol behavior rehomed from the removed private-client suite. Opt-in
// semantics remain independent of event privacy and shared-repository defaults.
const key = new Uint8Array(32).fill(29)
const owner = getPublicKey(key)
const older = finalizeEvent(
  {
    kind: 30000,
    created_at: 99,
    tags: [
      ["d", "grant"],
      ["p", owner],
    ],
    content: "",
  },
  key,
)
const current = finalizeEvent(
  {
    ...older,
    created_at: 100,
    tags: [
      ["d", "grant"],
      ["p", "2".repeat(64)],
    ],
  },
  key,
)
const deletion = finalizeEvent(
  {kind: 5, created_at: 101, tags: [["e", current.id]], content: ""},
  key,
)

describe("optional deletion-aware replaceables", () => {
  it.each([
    [older, current, deletion],
    [deletion, older, current],
    [current, deletion, older],
  ])("deletes the current grant without reviving older bodies (%#)", (...events) => {
    const repo = new Repository({deletionAwareReplaceables: true})
    for (const event of events) repo.publish(event)
    expect(repo.query([{kinds: [30000]}])).toEqual([])
    const fresh = finalizeEvent({...current, created_at: 102}, key)
    repo.publish(fresh)
    expect(repo.query([{kinds: [30000]}])).toEqual([fresh])
  })

  it("ignores another author's deletion and resolves equal-time replacements by lower ID", () => {
    const a = finalizeEvent({...current, content: "a"}, key)
    const b = finalizeEvent({...current, content: "b"}, key)
    const outsiderDeletion = finalizeEvent(
      {
        ...deletion,
        tags: [
          ["e", a.id],
          ["e", b.id],
        ],
      },
      new Uint8Array(32).fill(30),
    )
    for (const events of [
      [a, b, outsiderDeletion],
      [b, a, outsiderDeletion],
    ]) {
      const repo = new Repository({deletionAwareReplaceables: true})
      for (const event of events) repo.publish(event)
      expect(repo.query([{kinds: [30000]}]).map(event => event.id)).toEqual([
        [a.id, b.id].sort()[0],
      ])
    }
  })
})
