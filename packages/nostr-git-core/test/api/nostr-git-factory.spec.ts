import {describe, expect, it, vi} from "vitest"
import {
  createNostrGitProvider,
  createNostrGitProviderFromEnv,
  createNostrGitProviderFromGitConfig,
  selectProvider,
} from "../../src/api/providers/nostr-git-factory.js"

const eventIO = {
  fetchEvents: vi.fn(),
  publishEvent: vi.fn(),
} as any

describe("disabled direct NostrGitProvider factory", () => {
  it("blocks direct construction", () => {
    expect(() => createNostrGitProvider({eventIO})).toThrow(/Direct NostrGitProvider is disabled/i)
  })

  it("blocks environment and git-config construction", async () => {
    await expect(createNostrGitProviderFromEnv({eventIO})).rejects.toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    await expect(createNostrGitProviderFromGitConfig({eventIO})).rejects.toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
  })

  it("blocks Nostr URLs while leaving GRASP Smart HTTP on the traditional provider", () => {
    expect(() => selectProvider("NOSTR://repository")).toThrow(
      /Direct NostrGitProvider is disabled/i,
    )
    expect(
      selectProvider(
        "https://relay.example.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      ),
    ).toBe("traditional")
  })
})
