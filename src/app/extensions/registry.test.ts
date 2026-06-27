// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vitest"
import {extensionRegistry, parseSmartWidget} from "./registry"
import {getWidgetLineId} from "./widget-identity"

const makeWidgetEvent = (slotTag?: string[]) => ({
  id: "test-widget",
  kind: 30033,
  content: "Test Widget",
  pubkey: "pubkey",
  created_at: 1,
  tags: [["d", "test-widget"], ["l", "basic"], ...(slotTag ? [slotTag] : [])],
})

afterEach(() => {
  extensionRegistry.unregister(`30033:${"a".repeat(64)}:shared-widget`)
  extensionRegistry.unregister(`30033:${"b".repeat(64)}:shared-widget`)
})

describe("extension registry", () => {
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

  it("parses optional smart widget release metadata", () => {
    const widget = parseSmartWidget({
      ...makeWidgetEvent(),
      tags: [...makeWidgetEvent().tags, ["version", "1.2.3"], ["changelog", "Bug fixes"]],
    })

    expect(widget.version).toBe("1.2.3")
    expect(widget.changelog).toBe("Bug fixes")
  })

  it("parses ordered secure smart widget app URL fallbacks", () => {
    const widget = parseSmartWidget({
      ...makeWidgetEvent(),
      tags: [
        ["d", "test-widget"],
        ["l", "tool"],
        ["image", "https://example.com/icon.png"],
        ["button", "Open", "app", "https://example.com/widget.html"],
        ["app-url", "https://cdn.example.com/widget.html"],
        ["app-url", "https://cdn.example.com/widget.html"],
        ["app-url", "https://mirror.example.com/widget.html"],
      ],
    })

    expect(widget.appUrl).toBe("https://example.com/widget.html")
    expect(widget.appUrls).toEqual([
      "https://example.com/widget.html",
      "https://cdn.example.com/widget.html",
      "https://mirror.example.com/widget.html",
    ])
  })

  it("rejects insecure smart widget app URL fallbacks", () => {
    expect(() =>
      parseSmartWidget({
        ...makeWidgetEvent(),
        tags: [
          ["d", "test-widget"],
          ["l", "tool"],
          ["image", "https://example.com/icon.png"],
          ["button", "Open", "app", "https://example.com/widget.html"],
          ["app-url", "http://example.com/widget.html"],
        ],
      }),
    ).toThrow(/must use a secure URL/)
  })

  it("ignores unsupported legacy colon smart widget slots", () => {
    expect(parseSmartWidget(makeWidgetEvent(["slot", "chat:message:actions"])).slot).toBeUndefined()
    expect(parseSmartWidget(makeWidgetEvent(["slot", "global:menu"])).slot).toBeUndefined()
    expect(parseSmartWidget(makeWidgetEvent(["slot", "room:panel"])).slot).toBeUndefined()
  })

  it("registers same-d widgets from different publishers as separate widget lines", () => {
    const first = parseSmartWidget({
      ...makeWidgetEvent(),
      id: "first-shared-widget",
      pubkey: "a".repeat(64),
      tags: [["d", "shared-widget"], ["l", "basic"]],
    })
    const second = parseSmartWidget({
      ...makeWidgetEvent(),
      id: "second-shared-widget",
      pubkey: "b".repeat(64),
      tags: [["d", "shared-widget"], ["l", "basic"]],
    })

    const firstExt = extensionRegistry.registerWidget(first)
    const secondExt = extensionRegistry.registerWidget(second)

    expect(firstExt.id).toBe(getWidgetLineId(first))
    expect(secondExt.id).toBe(getWidgetLineId(second))
    expect(extensionRegistry.get(firstExt.id)).toBe(firstExt)
    expect(extensionRegistry.get(secondExt.id)).toBe(secondExt)
    expect(firstExt.id).not.toBe(secondExt.id)
  })
})
