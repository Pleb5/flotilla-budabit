import {describe, expect, it} from "vitest"
import type {SmartWidgetEvent} from "./types"
import {
  buildWidgetUpdate,
  getLatestWidgetUpdateCandidate,
  getWidgetChangelog,
  getWidgetUpdateDiff,
  getWidgetUpdateFilter,
  getWidgetUpdateRelays,
  getWidgetVersion,
} from "./widget-updates"

const widgetPubkey = "a".repeat(64)
const otherPubkey = "b".repeat(64)

const makeWidget = (overrides: Partial<SmartWidgetEvent> = {}): SmartWidgetEvent => ({
  id: overrides.id || "weather-1",
  kind: 30033,
  content: "Weather",
  pubkey: widgetPubkey,
  created_at: 1,
  tags: [
    ["d", "weather"],
    ["l", "tool"],
  ],
  identifier: "weather",
  widgetType: "tool",
  buttons: [{index: 1, label: "Open", type: "app", url: "https://example.com/v1.html"}],
  appUrl: "https://example.com/v1.html",
  permissions: ["ui:toast"],
  ...overrides,
})

describe("widget update helpers", () => {
  it("selects the newest newer candidate from the same widget line", () => {
    const installed = makeWidget({created_at: 10})
    const latest = makeWidget({id: "weather-20", created_at: 20})
    const old = makeWidget({id: "weather-5", created_at: 5})
    const wrongAuthor = makeWidget({id: "other-author", pubkey: otherPubkey, created_at: 30})
    const wrongIdentifier = makeWidget({id: "other-id", identifier: "other", created_at: 40})

    expect(
      getLatestWidgetUpdateCandidate(installed, [old, wrongAuthor, latest, wrongIdentifier]),
    ).toBe(latest)
  })

  it("returns no candidate when the installed widget is already latest", () => {
    const installed = makeWidget({created_at: 10})
    const stale = makeWidget({id: "weather-9", created_at: 9})

    expect(getLatestWidgetUpdateCandidate(installed, [stale])).toBeUndefined()
  })

  it("builds a concise update diff", () => {
    const installed = makeWidget({
      version: "1.0.0",
      permissions: ["ui:toast", "storage:get"],
      slot: {type: "global-menu", label: "Weather"},
    })
    const latest = makeWidget({
      id: "weather-20",
      created_at: 20,
      appUrl: "https://example.com/v2.html",
      version: "1.1.0",
      changelog: "Use immutable Blossom artifact.",
      permissions: ["ui:toast", "nostr:query"],
      slot: {type: "chat-message-actions", label: "Weather"},
    })

    expect(getWidgetUpdateDiff(installed, latest)).toEqual({
      version: {from: "1.0.0", to: "1.1.0"},
      changelog: "Use immutable Blossom artifact.",
      appUrlChanged: true,
      permissionsAdded: ["nostr:query"],
      permissionsRemoved: ["storage:get"],
      slotChanged: true,
      widgetTypeChanged: false,
    })
  })

  it("detects ordered app URL fallback changes", () => {
    const installed = makeWidget({
      appUrls: ["https://example.com/v1.html", "https://cdn.example.com/v1.html"],
    })
    const latest = makeWidget({
      id: "weather-20",
      created_at: 20,
      appUrls: ["https://example.com/v1.html", "https://mirror.example.com/v1.html"],
    })

    expect(getWidgetUpdateDiff(installed, latest).appUrlChanged).toBe(true)
  })

  it("does not report a version change when a newer event keeps the same version", () => {
    const installed = makeWidget({version: "0.1.0", appUrl: "https://example.com/local.html"})
    const latest = makeWidget({
      id: "weather-20",
      created_at: 20,
      version: "0.1.0",
      appUrl: "https://example.com/blossom.html",
    })

    const diff = getWidgetUpdateDiff(installed, latest)

    expect(diff.version).toBeUndefined()
    expect(diff.appUrlChanged).toBe(true)
  })

  it("reads version and changelog tags when parsed fields are missing", () => {
    const widget = makeWidget({
      tags: [
        ["version", "2.0.0"],
        ["changelog", "Release notes"],
      ],
    })

    expect(getWidgetVersion(widget)).toBe("2.0.0")
    expect(getWidgetChangelog(widget)).toBe("Release notes")
  })

  it("builds update filters only for addressable installed widgets", () => {
    expect(getWidgetUpdateFilter(makeWidget())).toEqual({
      kinds: [30033],
      authors: [widgetPubkey],
      "#d": ["weather"],
      limit: 1,
    })
    expect(getWidgetUpdateFilter(makeWidget({pubkey: ""}))).toBeUndefined()
  })

  it("normalizes source and fallback relays", () => {
    expect(
      getWidgetUpdateRelays({
        source: {relays: ["wss://source.example", "wss://source.example/"]},
        fallbackRelays: ["wss://fallback.example"],
      }),
    ).toEqual(["wss://source.example/", "wss://fallback.example/"])
  })

  it("builds update records with diffs", () => {
    const installed = makeWidget({created_at: 1})
    const latest = makeWidget({id: "weather-2", created_at: 2, version: "1.0.1"})
    const update = buildWidgetUpdate({
      installed,
      candidates: [latest],
      relays: ["wss://relay.example/"],
    })

    expect(update?.latest).toBe(latest)
    expect(update?.diff.version?.to).toBe("1.0.1")
    expect(update?.relays).toEqual(["wss://relay.example/"])
  })
})
