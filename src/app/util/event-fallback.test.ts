import {describe, expect, it} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {getEventFallback} from "./event-fallback"

const makeEvent = (overrides: Partial<TrustedEvent> = {}) =>
  ({
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 12345,
    content: "",
    tags: [],
    created_at: 1,
    sig: "c".repeat(128),
    ...overrides,
  }) as TrustedEvent

describe("basic event presentation", () => {
  it("uses useful titles and summaries without inventing meaning for unknown kinds", () => {
    expect(
      getEventFallback(
        makeEvent({
          content: "Readable body",
          tags: [
            ["title", "Title"],
            ["summary", "Summary"],
          ],
        }),
      ),
    ).toMatchObject({
      label: "Nostr event",
      title: "Title",
      summary: "Summary",
      body: "Readable body",
      format: "text",
    })
    expect(getEventFallback(makeEvent({kind: 30023})).title).toBe("Article")
  })

  it("pretty prints structured data but preserves invalid JSON and HTML as text", () => {
    expect(getEventFallback(makeEvent({content: '{"hello":true}'}))).toMatchObject({
      format: "json",
      body: '{\n  "hello": true\n}',
    })
    for (const content of ["{broken", '<img src=x onerror="alert(1)">']) {
      expect(getEventFallback(makeEvent({content}))).toMatchObject({format: "text", body: content})
    }
  })

  it("explains encrypted payloads rather than showing ciphertext", () => {
    for (const kind of [4, 13, 1059]) {
      const view = getEventFallback(makeEvent({kind, content: "ciphertext"}))
      expect(view.format).toBe("encrypted")
      expect(view.body).not.toContain("ciphertext")
    }
  })

  it("summarizes reactions and relay lists, and previews metadata-only events", () => {
    expect(getEventFallback(makeEvent({kind: 7, content: "❤"})).body).toBe("Reacted with ❤")
    const view = getEventFallback(
      makeEvent({kind: 10002, tags: [["r", "wss://relay.example/", "read"]]}),
    )
    expect(view.body).toBe("1 relay listed by this author.")
    expect(view.metadata).toEqual([{name: "r", value: "wss://relay.example/ · read"}])
    expect(
      getEventFallback(makeEvent({tags: [["topic", "Useful metadata"]]})).metadata,
    ).toHaveLength(1)
  })

  it("only creates bounded, explicit internal event references", () => {
    const id = "d".repeat(64)
    const address = `30023:${"e".repeat(64)}:chapter:one`
    const view = getEventFallback(
      makeEvent({
        tags: [
          ["e", id, "wss://relay.example/"],
          ["E", id],
          ["q", address],
          ["e", "not-an-id"],
          ["a", "javascript:alert(1)"],
        ],
      }),
    )
    expect(view.related).toHaveLength(2)
    expect(nip19.decode(view.related[0].href.slice(1))).toMatchObject({
      type: "nevent",
      data: {id, relays: ["wss://relay.example/"]},
    })
    expect(nip19.decode(view.related[1].href.slice(1))).toMatchObject({
      type: "naddr",
      data: {identifier: "chapter:one"},
    })
  })
})
