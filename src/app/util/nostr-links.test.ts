import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {entityLink, parseEventReference} from "./nostr-links"

const id = "a".repeat(64)
const pubkey = "b".repeat(64)
const relays = ["wss://relay.example/"]

describe("native Nostr references", () => {
  it("keeps note, nevent and naddr references internal, with relay hints intact", () => {
    for (const value of [
      nip19.noteEncode(id),
      nip19.neventEncode({id, relays}),
      nip19.naddrEncode({kind: 30023, pubkey, identifier: "article", relays}),
    ]) {
      expect(entityLink(`nostr:${value}`)).toBe(`/${value}`)
      expect(entityLink(value)).toBe(`/${value}`)
    }
  })

  it("routes both profile reference formats internally", () => {
    for (const value of [nip19.npubEncode(pubkey), nip19.nprofileEncode({pubkey, relays})]) {
      expect(entityLink(value)).toBe(`/people/${value}`)
      expect(parseEventReference(value)).toBeUndefined()
    }
  })

  it("resolves notes and treats nevent metadata as hints rather than filters", () => {
    expect(parseEventReference(nip19.noteEncode(id))?.filters).toEqual([{ids: [id]}])
    expect(
      parseEventReference(nip19.neventEncode({id, author: pubkey, kind: 12345, relays})),
    ).toEqual({filters: [{ids: [id]}], author: pubkey, kind: 12345, relays})
  })

  it("preserves empty and colon-containing address identifiers", () => {
    for (const identifier of ["", "article:chapter"]) {
      const reference = nip19.naddrEncode({kind: 30023, pubkey, identifier, relays})
      expect(parseEventReference(reference)?.filters).toEqual([
        {kinds: [30023], authors: [pubkey], "#d": [identifier]},
      ])
    }
    expect(
      parseEventReference(nip19.naddrEncode({kind: 10002, pubkey, identifier: ""}))?.filters,
    ).toEqual([{kinds: [10002], authors: [pubkey]}])
  })

  it("handles malformed and unsupported references without throwing or leaving the origin", () => {
    expect(parseEventReference("nevent1broken")).toBeUndefined()
    expect(parseEventReference(nip19.nsecEncode(new Uint8Array(32).fill(1)))).toBeUndefined()
    expect(entityLink("//example.com/path")).toBe("/%2F%2Fexample.com%2Fpath")
  })
})
