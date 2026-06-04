import {describe, it, expect} from "vitest"
import {
  extractSelfLabels,
  extractLabelEvents,
  mergeEffectiveLabels,
  GIT_LABEL,
  type NostrEvent,
} from "../../src/events/nip32/nip32.js"

describe("NIP-32: labels (extract + merge)", () => {
  it("extractSelfLabels resolves namespace via L and l mark", () => {
    const evt: any = {
      kind: 1618,
      tags: [
        ["L", "priority"],
        ["l", "high", "priority"],
        ["l", "needs-review"],
        ["l", "ignored-ns", "unknown"],
      ],
    } satisfies Partial<NostrEvent>

    const self = extractSelfLabels(evt)
    expect(self).toEqual([
      {L: "priority", l: "high", targetKind: 1618},
      {L: undefined, l: "needs-review", targetKind: 1618},
      {L: undefined, l: "ignored-ns", targetKind: 1618},
    ])
  })

  it("extractLabelEvents extracts external label events and label targets (e/a/p/r/t)", () => {
    const eId = "event-id-1"
    const aAddr = "30617:pubkey:repo"
    const pPk = "pubkey-1"
    const rEuc = "euc-1"
    const tHash = "bug"

    const labelEvt: any = {
      kind: GIT_LABEL,
      tags: [
        ["L", "priority"],
        ["l", "high", "priority"],
        ["e", eId],
        ["a", aAddr],
        ["p", pPk],
        ["r", rEuc],
        ["t", tHash],
      ],
    } satisfies Partial<NostrEvent>

    const out = extractLabelEvents([labelEvt])
    expect(out.length).toBe(1)

    expect(out[0].namespace).toBe("priority")
    expect(out[0].value).toBe("high")
    expect(out[0].op).toBe("add")
    expect(out[0].targets.e).toEqual([eId])
    expect(out[0].targets.a).toEqual([aAddr])
    expect(out[0].targets.p).toEqual([pPk])
    expect(out[0].targets.r).toEqual([rEuc])
    expect(out[0].targets.t).toEqual([tHash])
  })

  it('extractLabelEvents falls back namespace to "ugc" when mark not in namespaces', () => {
    const labelEvt: any = {
      kind: GIT_LABEL,
      tags: [
        ["L", "priority"],
        ["l", "medium", "unknown-mark"],
      ],
    } satisfies Partial<NostrEvent>

    const out = extractLabelEvents([labelEvt])
    expect(out.length).toBe(1)
    expect(out[0].namespace).toBe("ugc")
    expect(out[0].value).toBe("medium")
  })

  it("extractLabelEvents parses deletion marker from 4th l tag element", () => {
    const labelEvt: any = {
      kind: GIT_LABEL,
      tags: [
        ["L", "#t"],
        ["l", "bug", "#t", "del"],
      ],
    } satisfies Partial<NostrEvent>

    const out = extractLabelEvents([labelEvt])
    expect(out.length).toBe(1)
    expect(out[0].namespace).toBe("#t")
    expect(out[0].value).toBe("bug")
    expect(out[0].op).toBe("del")
  })

  it("mergeEffectiveLabels merges self + external + legacy t into byNamespace + flat + legacyT", () => {
    const input = {
      self: [
        {L: "priority", l: "high", targetKind: 1618},
        {L: undefined, l: "needs-review", targetKind: 1618},
      ],
      external: [
        {
          namespace: "ugc",
          value: "community",
          targets: {e: ["e1"], a: ["a1"], p: ["p1"], r: ["r1"], t: ["bug"]},
        },
      ],
      t: ["bug", "feature"],
    }

    const merged = mergeEffectiveLabels(input)

    expect(merged.byNamespace.priority instanceof Set).toBe(true)
    expect(Array.from(merged.byNamespace.priority)).toContain("high")

    expect(merged.byNamespace.ugc instanceof Set).toBe(true)
    expect(Array.from(merged.byNamespace.ugc)).toEqual(
      expect.arrayContaining(["needs-review", "community"]),
    )

    expect(merged.byNamespace["#t"] instanceof Set).toBe(true)
    expect(Array.from(merged.byNamespace["#t"])).toEqual(expect.arrayContaining(["bug", "feature"]))

    // flat contains `${namespace}/${value}`
    expect(Array.from(merged.flat)).toEqual(
      expect.arrayContaining([
        "priority/high",
        "ugc/needs-review",
        "ugc/community",
        "#t/bug",
        "#t/feature",
      ]),
    )

    // legacyT preserved
    expect(Array.from(merged.legacyT)).toEqual(expect.arrayContaining(["bug", "feature"]))
  })

  it("mergeEffectiveLabels applies adds/deletes sorted by created_at then id", () => {
    const merged = mergeEffectiveLabels({
      self: [],
      t: ["bug"],
      external: [
        {
          namespace: "#t",
          value: "bug",
          op: "del",
          created_at: 10,
          id: "b",
          targets: {e: ["root"]},
        },
        {
          namespace: "#t",
          value: "bug",
          op: "add",
          created_at: 10,
          id: "a",
          targets: {e: ["root"]},
        },
      ],
    })

    expect(Array.from(merged.byNamespace["#t"] || [])).toEqual([])
    expect(Array.from(merged.legacyT)).toEqual([])
  })
})
