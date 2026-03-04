// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vitest"
import {extensionRegistry} from "./registry"
import type {ExtensionManifest} from "./types"

const manifest: ExtensionManifest = {
  id: "test-no-entrypoint",
  name: "No Entrypoint Test",
  entrypoint: "",
}

afterEach(() => {
  extensionRegistry.unregister(manifest.id)
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
})
