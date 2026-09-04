import {describe, it, expect, vi, beforeEach} from "vitest"

// NOTE: This suite uses resetModules + doMock to avoid cross-test singleton leakage
// from module-level state inside src/api/git-provider.ts.

describe("api/git-provider", () => {
  const graspRepoUrl =
    "https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git"

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function loadModule() {
    return await import("../../src/api/git-provider.js")
  }

  it("creates a default MultiVendorGitProvider and returns it from getGitProvider()", async () => {
    const baseProvider = {__kind: "base"}

    vi.doMock("../../src/git/factory.js", () => ({
      createGitProvider: () => baseProvider,
    }))

    vi.doMock("../../src/git/multi-vendor-git-provider.js", () => {
      class MultiVendorGitProvider {
        baseProvider: any
        setTokens = vi.fn()
        constructor(opts?: {baseProvider?: any}) {
          this.baseProvider = opts?.baseProvider
        }
      }
      return {MultiVendorGitProvider}
    })

    // Not used in this test, but git-provider imports it.
    vi.doMock("../../src/api/providers/nostr-git-factory.js", () => ({
      createNostrGitProviderFromEnv: vi.fn(async () => ({})),
    }))
    vi.doMock("../../src/api/providers/nostr-git-provider.js", () => ({
      NostrGitProvider: class {},
    }))

    const mod = await loadModule()

    const provider = mod.getGitProvider()
    expect(provider).toBeTruthy()
    // Ensure getMultiVendorGitProvider works for the default provider
    expect(() => mod.getMultiVendorGitProvider()).not.toThrow()
  })

  it("setGitProvider updates the active provider; getMultiVendorGitProvider throws if not multi-vendor", async () => {
    vi.doMock("../../src/git/factory.js", () => ({
      createGitProvider: () => ({__kind: "base"}),
    }))

    vi.doMock("../../src/git/multi-vendor-git-provider.js", () => {
      class MultiVendorGitProvider {
        setTokens = vi.fn()
      }
      return {MultiVendorGitProvider}
    })

    vi.doMock("../../src/api/providers/nostr-git-factory.js", () => ({
      createNostrGitProviderFromEnv: vi.fn(async () => ({})),
    }))
    vi.doMock("../../src/api/providers/nostr-git-provider.js", () => ({
      NostrGitProvider: class {},
    }))

    const mod = await loadModule()

    // Replace with a non-multi-vendor provider
    const custom = {__kind: "custom"} as any
    mod.setGitProvider(custom)

    expect(mod.getGitProvider()).toBe(custom)
    expect(() => mod.getMultiVendorGitProvider()).toThrow(/not a MultiVendorGitProvider/i)
  })

  it("setGitTokens delegates to MultiVendorGitProvider.setTokens()", async () => {
    const setTokensSpy = vi.fn()

    vi.doMock("../../src/git/factory.js", () => ({
      createGitProvider: () => ({__kind: "base"}),
    }))

    vi.doMock("../../src/git/multi-vendor-git-provider.js", () => {
      class MultiVendorGitProvider {
        setTokens = setTokensSpy
      }
      return {MultiVendorGitProvider}
    })

    vi.doMock("../../src/api/providers/nostr-git-factory.js", () => ({
      createNostrGitProviderFromEnv: vi.fn(async () => ({})),
    }))
    vi.doMock("../../src/api/providers/nostr-git-provider.js", () => ({
      NostrGitProvider: class {},
    }))

    const mod = await loadModule()

    const tokens = [{host: "example.com", token: "t"}]
    mod.setGitTokens(tokens)
    expect(setTokensSpy).toHaveBeenCalledTimes(1)
    expect(setTokensSpy).toHaveBeenCalledWith(tokens)
  })

  it("blocks direct NostrGitProvider lifecycle while retaining ordinary and GRASP Git routing", async () => {
    const createFromEnv = vi.fn(async () => ({}))
    vi.doMock("../../src/git/factory.js", () => ({
      createGitProvider: () => ({__kind: "base"}),
    }))

    vi.doMock("../../src/git/multi-vendor-git-provider.js", () => {
      class MultiVendorGitProvider {
        setTokens = vi.fn()
      }
      return {MultiVendorGitProvider}
    })

    vi.doMock("../../src/api/providers/nostr-git-factory.js", () => ({
      createNostrGitProviderFromEnv: createFromEnv,
    }))

    vi.doMock("../../src/api/providers/nostr-git-provider.js", () => ({
      NostrGitProvider: class {},
    }))

    const mod = await loadModule()

    expect(mod.hasNostrGitProvider()).toBe(false)
    expect(() => mod.getNostrGitProvider()).toThrow(/Direct NostrGitProvider is disabled/i)

    const io = {signEvent: async (e: any) => e} as any
    await expect(mod.initializeNostrGitProvider({eventIO: io})).rejects.toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    expect(createFromEnv).not.toHaveBeenCalled()
    expect(() => mod.getProviderForUrl("nostr://whatever")).toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    expect(() => mod.getProviderForUrl("NOSTR://whatever")).toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    expect(mod.getProviderForUrl("https://example.com/x/y")).toBe(mod.getGitProvider())
    expect(mod.getProviderForUrl(graspRepoUrl)).toBe(mod.getGitProvider())
  })

  it("getProviderForUrl rejects Nostr URLs before provider initialization", async () => {
    vi.doMock("../../src/git/factory.js", () => ({
      createGitProvider: () => ({__kind: "base"}),
    }))

    vi.doMock("../../src/git/multi-vendor-git-provider.js", () => {
      class MultiVendorGitProvider {
        setTokens = vi.fn()
      }
      return {MultiVendorGitProvider}
    })

    vi.doMock("../../src/api/providers/nostr-git-factory.js", () => ({
      createNostrGitProviderFromEnv: vi.fn(async () => ({})),
    }))
    vi.doMock("../../src/api/providers/nostr-git-provider.js", () => ({
      NostrGitProvider: class {},
    }))

    const mod = await loadModule()

    expect(() => mod.getProviderForUrl("nostr://repo")).toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    expect(mod.getProviderForUrl(graspRepoUrl)).toBe(mod.getGitProvider())
  })
})
