// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

vi.mock("@nostr-git/ui", () => ({}))

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/extensions/registry", () => ({
  extensionRegistry: {
    load: vi.fn(),
    unloadExtension: vi.fn(),
    register: vi.fn(),
  },
  parseSmartWidget: vi.fn(),
}))

vi.mock("@app/extensions/settings", () => ({
  extensionSettings: {
    update: vi.fn(),
  },
  getInstalledExtensions: vi.fn(() => []),
  getInstalledExtension: vi.fn(),
}))

vi.mock("@lib/budabit/state", () => ({
  DEFAULT_WORKER_PUBKEY: "test-worker",
  activeRepoClass: {
    subscribe: vi.fn(),
  },
}))

describe("commands", () => {
  it("normalizeBlossomUrl converts ws to http", async () => {
    const {normalizeBlossomUrl} = await import("./commands")
    expect(normalizeBlossomUrl("wss://blossom.example.com")).toMatch(/^https?:\/\//)
    expect(normalizeBlossomUrl("ws://localhost:8080")).toMatch(/^https?:\/\//)
  })

  it("normalizeBlossomUrl preserves https URLs", async () => {
    const {normalizeBlossomUrl} = await import("./commands")
    const url = "https://blossom.example.com"
    expect(normalizeBlossomUrl(url)).toContain("https")
  })

  it("makeReport builds report event with tags", async () => {
    const {makeReport} = await import("./commands")
    const event = {
      id: "evt123",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const report = makeReport({
      event,
      reason: "spam",
      content: "Report details",
    })
    expect(report.kind).toBe(1984)
    expect(report.content).toBe("Report details")
    expect(report.tags).toEqual(
      expect.arrayContaining([
        ["p", event.pubkey],
        ["e", event.id, "spam"],
      ]),
    )
  })

  it("makeComment builds comment event with tags", async () => {
    const {makeComment} = await import("./commands")
    const event = {
      id: "evt456",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const comment = makeComment({
      event,
      content: "My reply",
    })
    expect(comment.kind).toBe(1111)
    expect(comment.content).toBe("My reply")
    expect(comment.tags.some((t: string[]) => t[0] === "e" && t[1] === event.id)).toBe(true)
  })

  it("makeReaction builds reaction event", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt789",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      protect: false,
      event,
      content: "+",
    })
    expect(reaction.kind).toBe(7)
    expect(reaction.content).toBe("+")
  })

  it("makeReaction adds PROTECTED tag when protect is true", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      protect: true,
      event,
      content: "❤️",
    })
    expect(reaction.tags).toContainEqual(["-"])
  })

  it("prependParent returns content and tags unchanged when parent is undefined", async () => {
    const {prependParent} = await import("./commands")
    const content = "Hello"
    const tags: string[][] = [["t", "topic"]]
    const result = prependParent(undefined, {content, tags})
    expect(result.content).toBe("Hello")
    expect(result.tags).toEqual([["t", "topic"]])
  })

  it("makeComment includes extra tags when provided", async () => {
    const {makeComment} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const comment = makeComment({
      event,
      content: "Reply",
      tags: [["custom", "value"]],
    })
    expect(comment.tags.some((t: string[]) => t[0] === "custom" && t[1] === "value")).toBe(true)
  })

  it("makeReaction includes custom tags when provided", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "👍",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      protect: false,
      event,
      content: "👍",
      tags: [["custom", "tag"]],
    })
    expect(reaction.tags.some((t: string[]) => t[0] === "custom")).toBe(true)
  })

  it("makeDelete adds PROTECTED tag when protect is true", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const del = makeDelete({protect: true, event})
    expect(del.tags).toContainEqual(["-"])
  })

  it("makeDelete includes group tag when event has h tag", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [["h", "room123"]],
      sig: "",
    } as any
    const del = makeDelete({protect: false, event})
    expect(del.tags).toContainEqual(["h", "room123"])
  })

  it("makeDelete builds delete event with kind and event tags", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt999",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const del = makeDelete({
      protect: false,
      event,
    })
    expect(del.kind).toBe(5)
    expect(del.tags).toEqual(expect.arrayContaining([["k", "1"]]))
    expect(del.tags.some((t: string[]) => t[0] === "e" && t[1] === event.id)).toBe(true)
  })
})
