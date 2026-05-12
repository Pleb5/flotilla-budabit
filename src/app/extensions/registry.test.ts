// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vitest"
import {extensionRegistry, parseSmartWidget} from "./registry"
import type {ExtensionManifest} from "./types"

const manifest: ExtensionManifest = {
  id: "test-no-entrypoint",
  name: "No Entrypoint Test",
  entrypoint: "",
}

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
})
