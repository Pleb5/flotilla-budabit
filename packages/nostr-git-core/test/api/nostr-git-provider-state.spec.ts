import {describe, it, expect, vi, beforeEach} from "vitest"
import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"

describe("NostrGitProvider state/announcement publishing", () => {
  const okPublish = {ok: true, relays: ["wss://relay.example"]}
  const badPublish = {ok: false, error: "denied"}

  function makeProviderWithEventIO(publishResult: any) {
    const eventIO = {
      publishEvent: vi.fn().mockResolvedValue(publishResult),
      fetchEvents: vi.fn(),
    } as any
    return {provider: new NostrGitProvider({eventIO}), eventIO}
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("publishRepoState succeeds and returns relay indicator", async () => {
    const {provider, eventIO} = makeProviderWithEventIO(okPublish)
    const res = await provider.publishRepoState("/tmp/repo", [
      " WSS://RELAY.EXAMPLE/ ",
      "wss://relay.example",
    ])
    expect(eventIO.publishEvent).toHaveBeenCalledWith(expect.anything(), {
      relays: ["wss://relay.example"],
    })
    expect(res).toBe("wss://relay.example")
  })

  it("publishRepoState throws on failed publish", async () => {
    const {provider} = makeProviderWithEventIO(badPublish)
    await expect(provider.publishRepoState("/tmp/repo", ["wss://relay.example"])).rejects.toThrow(
      /Failed to publish repository state: denied/,
    )
  })

  it("publishRepoAnnouncement succeeds and returns relay indicator", async () => {
    const {provider, eventIO} = makeProviderWithEventIO(okPublish)
    const res = await provider.publishRepoAnnouncement("/tmp/repo", ["wss://relay.example"])
    expect(eventIO.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30617,
        tags: expect.arrayContaining([["relays", "wss://relay.example"]]),
      }),
      {relays: ["wss://relay.example"]},
    )
    expect(res).toBe("wss://relay.example")
  })

  it("publishRepoAnnouncement throws on failed publish", async () => {
    const {provider} = makeProviderWithEventIO(badPublish)
    await expect(
      provider.publishRepoAnnouncement("/tmp/repo", ["wss://relay.example"]),
    ).rejects.toThrow(/Failed to publish repository announcement: denied/)
  })

  it("rejects empty publication scope before local state or EventIO work", async () => {
    const {provider, eventIO} = makeProviderWithEventIO(okPublish)
    const localState = vi.spyOn(provider as any, "getRepoStateFromLocal")

    await expect(provider.publishRepoState("/tmp/repo", [])).rejects.toThrow(
      "Repository operation requires at least one explicit relay",
    )

    expect(localState).not.toHaveBeenCalled()
    expect(eventIO.publishEvent).not.toHaveBeenCalled()
  })
})
