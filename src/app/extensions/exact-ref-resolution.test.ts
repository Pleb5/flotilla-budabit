import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {exactRefDeletionFilters, resolveExactRefs} from "./exact-ref-resolution"

const key = new Uint8Array(32).fill(52)
const author = getPublicKey(key)
const ref = `31923:${author}:featured`
const event = (created_at = 100) =>
  finalizeEvent(
    {
      kind: 31923,
      created_at,
      tags: [
        ["d", "featured"],
        ["start", "1"],
      ],
      content: "Past selected event",
    },
    key,
  )
const deletion = (created_at = 200, signer = key, tags = [["a", ref]]) =>
  finalizeEvent({kind: 5, created_at, tags, content: ""}, signer)

describe("exact reference terminal evidence", () => {
  it("preserves an explicitly selected future calendar event", () => {
    const future = finalizeEvent(
      {
        kind: 31923,
        created_at: 100,
        tags: [
          ["d", "featured"],
          ["start", "2000000000"],
        ],
        content: "Future event",
      },
      key,
    )
    expect(resolveExactRefs([ref], [future], [], true).events).toEqual([future])
  })
  it("honors a signed author deletion despite an unavailable relay", () => {
    expect(resolveExactRefs([ref], [], [deletion()], false, 300)).toEqual({
      events: [],
      resolutions: [{ref, status: "deleted"}],
    })
  })
  it("removes older events but permits a genuinely newer replacement", () => {
    const newer = event(201)
    expect(resolveExactRefs([ref], [event(), newer], [deletion()], false, 300)).toEqual({
      events: [newer],
      resolutions: [{ref, status: "found"}],
    })
  })
  it("rejects outsider, future, malformed and invalid-signature tombstones", () => {
    for (const invalid of [
      deletion(200, new Uint8Array(32).fill(53)),
      deletion(301),
      {...deletion(), sig: "0".repeat(128)},
      null,
    ]) {
      expect(resolveExactRefs([ref], [], [invalid], false, 300).resolutions[0].status).toBe(
        "unavailable",
      )
    }
  })
  it("distinguishes complete absence from a transient failure", () => {
    expect(resolveExactRefs([ref], [], [], true).resolutions[0].status).toBe("missing")
    expect(resolveExactRefs([ref], [], [], false).resolutions[0].status).toBe("unavailable")
  })
  it("requires original author evidence for an ID deletion", () => {
    const original = event()
    const tombstone = deletion(200, key, [["e", original.id]])
    expect(resolveExactRefs([original.id], [], [tombstone], false).resolutions[0].status).toBe(
      "unavailable",
    )
    expect(
      resolveExactRefs([original.id], [original], [tombstone], false).resolutions[0].status,
    ).toBe("deleted")
  })
  it("keeps explicit past pins and scopes address filters to the allowed author/kind", () => {
    const past = event()
    expect(resolveExactRefs([ref], [past], [], true).events).toEqual([past])
    expect(
      exactRefDeletionFilters([{kinds: [31923], authors: [author], "#d": ["featured"]}]),
    ).toEqual([{kinds: [5], authors: [author], "#a": [ref], limit: 100}])
  })
})
