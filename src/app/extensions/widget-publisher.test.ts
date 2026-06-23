import {describe, expect, it} from "vitest"
import {
  buildCommunityWidgetEventTags,
  filterSelectedWidgetCommunityOptions,
  getWidgetAppUrlsFromUpload,
} from "./widget-publisher"

describe("widget publisher helpers", () => {
  it("builds widget tags with primary app URL and ordered fallbacks", () => {
    expect(
      buildCommunityWidgetEventTags({
        identifier: "weather",
        name: "Weather",
        appUrls: [
          "https://example.com/widget.html",
          "https://cdn.example.com/widget.html",
          "https://cdn.example.com/widget.html",
        ],
        slot: "global-menu",
        iconUrl: "https://example.com/icon.png",
        description: "Forecasts",
        version: "1.0.0",
        changelog: "Initial release",
      }),
    ).toEqual([
      ["d", "weather"],
      ["title", "Weather"],
      ["l", "basic"],
      ["slot", "global-menu", "Weather"],
      ["button", "Open", "app", "https://example.com/widget.html"],
      ["app-url", "https://cdn.example.com/widget.html"],
      ["icon", "https://example.com/icon.png"],
      ["description", "Forecasts"],
      ["version", "1.0.0"],
      ["changelog", "Initial release"],
    ])
  })

  it("rejects insecure widget app URLs", () => {
    expect(() =>
      buildCommunityWidgetEventTags({
        identifier: "weather",
        name: "Weather",
        appUrls: ["http://example.com/widget.html"],
      }),
    ).toThrow(/secure/)
  })

  it("extracts secure canonical and immediate mirror upload URLs", () => {
    expect(
      getWidgetAppUrlsFromUpload({
        result: {
          url: "https://example.com/widget.html",
          sha256: "a".repeat(64),
          tags: [],
        },
        mirrors: [
          {server: "https://mirror.example", ok: true, url: "https://mirror.example/widget.html"},
          {server: "https://bad.example", ok: false, url: "http://bad.example/widget.html"},
        ],
      }),
    ).toEqual(["https://example.com/widget.html", "https://mirror.example/widget.html"])
  })

  it("filters selected communities to eligible options", () => {
    expect(
      filterSelectedWidgetCommunityOptions(
        [
          {pubkey: "aaa", label: "Allowed"},
          {pubkey: "bbb", label: "Also allowed"},
        ],
        ["aaa", "ccc"],
      ),
    ).toEqual([{pubkey: "aaa", label: "Allowed"}])
  })
})
