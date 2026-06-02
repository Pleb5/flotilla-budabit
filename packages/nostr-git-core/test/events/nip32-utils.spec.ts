import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {
  isLabelEvent,
  getLabelNamespaces,
  getLabelValues,
  createLabelEvent,
  createRoleLabelEvent,
  parseRoleLabelEvent,
  parseLabelEvent,
} from "../../src/events/nip32/nip32-utils.js"
import {GIT_LABEL, type LabelEvent} from "../../src/events/nip32/nip32.js"

function makeLabelEvent(
  tags: string[][],
  content = "",
  created_at = Math.floor(Date.now() / 1000),
): LabelEvent {
  return {
    kind: GIT_LABEL,
    content,
    created_at,
    tags,
    pubkey: "pub",
    id: "id",
    sig: "sig",
  } as any
}

describe("NIP-32 utils", () => {
  it("isLabelEvent identifies kind correctly", () => {
    expect(isLabelEvent({kind: GIT_LABEL} as any)).toBe(true)
    expect(isLabelEvent({kind: 1} as any)).toBe(false)
  })

  it("getLabelNamespaces and getLabelValues parse namespaces and labels", () => {
    const evt = makeLabelEvent([
      ["L", "org.nostr.git.role"],
      ["l", "maintainer", "org.nostr.git.role"],
      ["l", "triager"],
      ["p", "alice"],
    ])
    const ns = getLabelNamespaces(evt)
    expect(ns).toEqual(["org.nostr.git.role"])
    const labels = getLabelValues(evt)
    expect(labels).toEqual([
      {
        namespace: "org.nostr.git.role",
        value: "maintainer",
        mark: "org.nostr.git.role",
        op: "add",
      },
      {namespace: undefined, value: "triager", mark: undefined, op: "add"},
    ])
  })

  it("createLabelEvent encodes delete marker in 4th l slot", () => {
    const evt = createLabelEvent({
      namespaces: ["#t"],
      labels: [{namespace: "#t", value: "bug", op: "del"}],
      e: ["root"],
    })

    expect(evt.tags).toEqual(
      expect.arrayContaining([
        ["L", "#t"],
        ["l", "bug", "#t", "del"],
        ["e", "root"],
      ]),
    )
  })

  it("createRoleLabelEvent builds with defaults and parseRoleLabelEvent roundtrips role/ns/people", () => {
    const created = createRoleLabelEvent({
      rootId: "root",
      role: "maintainer",
      pubkeys: ["alice", "bob"],
    })
    expect(isLabelEvent(created)).toBe(true)
    const parsed = parseRoleLabelEvent(created)
    expect(parsed.role).toBe("maintainer")
    expect(parsed.namespace).toBe("org.nostr.git.role")
    expect(parsed.people).toEqual(["alice", "bob"])
    expect(parsed.rootId).toBe("root")
  })

  it("parseRoleLabelEvent respects provided namespace and repoAddr", () => {
    const created = createRoleLabelEvent({
      rootId: "r",
      role: "triager",
      pubkeys: ["z"],
      repoAddr: "30617:pub:d",
      namespace: "x.y",
    })
    const parsed = parseRoleLabelEvent(created)
    expect(parsed.namespace).toBe("x.y")
    expect(parsed.repoAddr).toBe("30617:pub:d")
  })

  it("parseLabelEvent collects targets across tags", () => {
    const evt = makeLabelEvent([
      ["L", "ns"],
      ["l", "tag", "ns"],
      ["e", "e1"],
      ["a", "a1"],
      ["p", "p1"],
      ["r", "r1"],
      ["t", "t1"],
    ])
    const out = parseLabelEvent(evt)
    expect(out.targets).toEqual({e: ["e1"], a: ["a1"], p: ["p1"], r: ["r1"], t: ["t1"]})
    expect(out.labels.length).toBe(1)
  })
})
