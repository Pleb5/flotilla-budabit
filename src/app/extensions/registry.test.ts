// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vitest"
import {extensionRegistry, parseSmartWidget} from "./registry"
import type {ExtensionManifest} from "./types"

const manifest: ExtensionManifest = {
  id: "test-no-entrypoint",
  name: "No Entrypoint Test",
  entrypoint: "",
}

const makeWidgetEvent = (slotTag?: string[]) => ({
  id: "test-widget",
  kind: 30033,
  content: "Test Widget",
  pubkey: "pubkey",
  created_at: 1,
  tags: [
    ["d", "test-widget"],
    ["l", "basic"],
    ...(slotTag ? [slotTag] : []),
  ],
})

afterEach(() => {
  extensionRegistry.unregister(manifest.id)
  extensionRegistry.unregister("test-insecure-entrypoint")
})

describe("extension registry no-entrypoint runtime", () => {
  it("does not emit a redundant store update when loading an already-registered extension", async () => {
    extensionRegistry.register(manifest)

    const before = extensionRegistry.get(manifest.id)
    let emissions = 0
    const unsubscribe = extensionRegistry.asStore().subscribe(() => {
      emissions += 1
    })

    // Ignore initial synchronous subscription emission.
    emissions = 0

    const loaded = await extensionRegistry.loadIframeExtension(manifest)

    unsubscribe()

    expect(loaded).toBe(before)
    expect(emissions).toBe(0)
  })

  it("rejects insecure remote extension entrypoints", () => {
    const insecureManifest: ExtensionManifest = {
      id: "test-insecure-entrypoint",
      name: "Insecure Entrypoint Test",
      entrypoint: "http://example.com/widget.html",
    }

    expect(() => extensionRegistry.register(insecureManifest)).toThrow(/must use a secure URL/)
  })

  it("rejects insecure remote smart widget app URLs", () => {
    expect(() =>
      parseSmartWidget({
        id: "test-insecure-widget",
        kind: 30033,
        content: "Insecure widget",
        pubkey: "pubkey",
        created_at: 1,
        tags: [
          ["d", "test-insecure-widget"],
          ["l", "action"],
          ["image", "https://example.com/icon.png"],
          ["button", "Open", "app", "http://example.com/widget.html"],
        ],
      }),
    ).toThrow(/must use a secure URL/)
  })

  it("parses supported community smart widget slots", () => {
    const cases = [
      ["community-home-before-quicklinks", "Home: before"],
      ["community-home-after-quicklinks", "Home: after"],
      ["chat-message-actions", "Message action"],
      ["global-menu", "Community launcher"],
    ]

    for (const [slotType, label] of cases) {
      const widget = parseSmartWidget(makeWidgetEvent(["slot", slotType, label]))

      expect(widget.slot).toEqual({type: slotType, label})
    }
  })

  it("parses repo-tab smart widget slots", () => {
    const widget = parseSmartWidget(makeWidgetEvent(["slot", "repo-tab", "Pipelines", "pipelines"]))

    expect(widget.slot).toEqual({type: "repo-tab", label: "Pipelines", path: "pipelines"})
  })

  it("falls back to widget content for supported community slot labels", () => {
    const widget = parseSmartWidget(makeWidgetEvent(["slot", "chat-message-actions"]))

    expect(widget.slot).toEqual({
      type: "chat-message-actions",
      label: "Test Widget",
    })
  })

  it("ignores unsupported legacy colon smart widget slots", () => {
    expect(parseSmartWidget(makeWidgetEvent(["slot", "chat:message:actions"])).slot).toBeUndefined()
    expect(parseSmartWidget(makeWidgetEvent(["slot", "global:menu"])).slot).toBeUndefined()
    expect(parseSmartWidget(makeWidgetEvent(["slot", "room:panel"])).slot).toBeUndefined()
  })
})
