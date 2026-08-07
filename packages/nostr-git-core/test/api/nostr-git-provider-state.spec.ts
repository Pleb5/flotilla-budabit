import {describe, it, expect, vi, beforeEach} from "vitest"
import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"

describe("NostrGitProvider state/announcement publishing", () => {
  function makeProvider() {
    const eventIO = {
      publishEvent: vi.fn(),
      fetchEvents: vi.fn(),
    } as any
    return {provider: new NostrGitProvider({eventIO}), eventIO}
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("publishRepoState rejects instead of publishing fabricated local state", async () => {
    const {provider, eventIO} = makeProvider()
    await expect(provider.publishRepoState("/tmp/repo", ["wss://relay.example"])).rejects.toThrow(
      /unsupported without a real repository state source/,
    )
    expect(eventIO.publishEvent).not.toHaveBeenCalled()
  })

  it("publishRepoAnnouncement rejects instead of using fabricated local metadata", async () => {
    const {provider, eventIO} = makeProvider()
    await expect(
      provider.publishRepoAnnouncement("/tmp/repo", ["wss://relay.example"]),
    ).rejects.toThrow(/unsupported without a real repository state source/)
    expect(eventIO.publishEvent).not.toHaveBeenCalled()
  })

  it("rejects empty publication scope before local state or EventIO work", async () => {
    const {provider, eventIO} = makeProvider()
    const localState = vi.spyOn(provider as any, "getRepoStateFromLocal")

    await expect(provider.publishRepoState("/tmp/repo", [])).rejects.toThrow(
      "Repository operation requires at least one explicit relay",
    )

    expect(localState).not.toHaveBeenCalled()
    expect(eventIO.publishEvent).not.toHaveBeenCalled()
  })

  it("rejects provider-managed GRASP pushes before Git work", async () => {
    const push = vi.fn()
    const eventIO = {publishEvent: vi.fn(), fetchEvents: vi.fn()} as any
    const provider = new NostrGitProvider({eventIO, gitProvider: {push} as any})

    await expect(
      provider.push({
        url: "https://relay.example/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      }),
    ).rejects.toThrow("Provider-managed Nostr repository pushes are unsupported")
    expect(push).not.toHaveBeenCalled()
  })
})
