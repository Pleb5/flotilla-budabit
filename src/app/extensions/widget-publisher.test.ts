import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {makeCommunityPointer} from "@app/core/community"
import {
  buildCommunityWidgetEventTags,
  filterSelectedWidgetCommunityOptions,
  getWidgetAppUrlsFromUpload,
} from "./widget-publisher"

const supportedCommunitySlots = [
  "community-home-before-quicklinks",
  "community-home-after-quicklinks",
  "community-home-quicklinks",
  "chat-message-actions",
  "global-menu",
] as const

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

  it("builds only viable community slot tags", () => {
    for (const slot of supportedCommunitySlots) {
      expect(
        buildCommunityWidgetEventTags({
          identifier: slot,
          name: slot,
          appUrls: ["https://example.com/widget.html"],
          slot,
        }),
      ).toContainEqual(["slot", slot, slot])
    }
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

  it("filters exact same-ID community branches independently", () => {
    const communityId = getPublicKey(new Uint8Array(32).fill(3))
    const first = makeCommunityPointer({
      ownerPubkey: getPublicKey(new Uint8Array(32).fill(2)),
      communityId,
    })!
    const second = makeCommunityPointer({
      ownerPubkey: getPublicKey(new Uint8Array(32).fill(4)),
      communityId,
    })!

    expect(
      filterSelectedWidgetCommunityOptions(
        [
          {community: first, label: "First branch"},
          {community: second, label: "Second branch"},
        ],
        [second.address],
      ),
    ).toEqual([{community: second, label: "Second branch"}])
  })
})
