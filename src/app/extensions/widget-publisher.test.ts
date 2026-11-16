import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {makeCommunityPointer} from "@app/core/community"
import {
  buildCommunityWidgetEventTags,
  filterSelectedWidgetCommunityOptions,
  getWidgetAppUrlsFromUpload,
  publishBlossomWidget,
} from "./widget-publisher"

const supportedCommunitySlots = [
  "community-home-before-quicklinks",
  "community-home-after-quicklinks",
  "community-home-quicklinks",
  "chat-message-actions",
  "global-menu",
] as const

describe("widget publisher helpers", () => {
  it("explicitly publishes uploaded bytes with hash/server-bound authorization", async () => {
    const hash = "a".repeat(64)
    const sign = vi.fn(async template => ({
      ...template,
      id: "auth",
      sig: "sig",
      pubkey: "publisher",
    }))
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha256: hash,
            url: `https://blossom.example/widgets/${hash}.html`,
          }),
        ),
    )
    expect(
      await publishBlossomWidget(
        {url: `https://blossom.example/${hash}.html`, sha256: hash},
        sign,
        fetcher,
      ),
    ).toBe(`https://blossom.example/widgets/${hash}.html`)
    expect(sign.mock.calls[0][0]).toMatchObject({
      kind: 24242,
      tags: expect.arrayContaining([
        ["t", "publish-widget"],
        ["server", "blossom.example"],
        ["x", hash],
      ]),
    })
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`https://blossom.example/widgets/${hash}`),
      expect.objectContaining({
        method: "PUT",
        credentials: "omit",
        redirect: "error",
        headers: {Authorization: expect.stringMatching(/^Nostr /)},
      }),
    )
    fetcher.mockImplementationOnce(async () => new Response("denied", {status: 403}))
    await expect(
      publishBlossomWidget(
        {url: `https://blossom.example/${hash}.html`, sha256: hash},
        sign,
        fetcher,
      ),
    ).rejects.toThrow(/403/)
    fetcher.mockImplementationOnce(
      async () => new Response(JSON.stringify({sha256: hash, url: "https://other.example/widget"})),
    )
    await expect(
      publishBlossomWidget(
        {url: `https://blossom.example/${hash}.html`, sha256: hash},
        sign,
        fetcher,
      ),
    ).rejects.toThrow(/unexpected/)
    sign.mockClear()
    await expect(
      publishBlossomWidget(
        {url: "https://blossom.example/not-a-blob.html", sha256: hash},
        sign,
        fetcher,
      ),
    ).rejects.toThrow(/content-addressed/)
    expect(sign).not.toHaveBeenCalled()
  })
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
