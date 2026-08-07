import {beforeEach, describe, expect, it, vi} from "vitest"
import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"

describe("NostrGitProvider state publication sequencing", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function makeProvider(config: Record<string, unknown> = {}) {
    const gitProvider = {
      push: vi.fn().mockResolvedValue({server: {ok: true}}),
    } as any
    const eventIO = {
      publishEvent: vi.fn(),
      fetchEvents: vi.fn(),
    } as any
    const provider = new NostrGitProvider({eventIO, gitProvider, ...config})
    return {provider, gitProvider}
  }

  it("preserves an ordinary base Git push when state publication is not requested", async () => {
    const {provider, gitProvider} = makeProvider()

    await expect(provider.push({dir: "/tmp/repo"})).resolves.toEqual({server: {ok: true}})

    expect(gitProvider.push).toHaveBeenCalledOnce()
  })

  it.each([
    ["an explicit rejection", {ok: false, error: "relay refused"}],
    ["no accepted relay", {ok: true, relays: []}],
  ])("fails before Git when state publication returns %s", async (_label, publication) => {
    const {provider, gitProvider} = makeProvider()
    provider.configureGrasp({
      supportsStatePublicationFromLocal: true,
      publishStateFromLocal: vi.fn().mockResolvedValue(publication),
    })

    await expect(
      provider.push({
        publishRepoStateFromLocal: true,
        ownerPubkey: "owner",
        repoId: "repo",
        repoRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow()
    expect(gitProvider.push).not.toHaveBeenCalled()
  })

  it("publishes required state before Git", async () => {
    const {provider, gitProvider} = makeProvider()
    const publishStateFromLocal = vi.fn().mockResolvedValue({
      ok: true,
      relays: ["wss://relay.example"],
    })
    provider.configureGrasp({supportsStatePublicationFromLocal: true, publishStateFromLocal})

    await provider.push({
      publishRepoStateFromLocal: true,
      ownerPubkey: "owner",
      repoId: "repo",
      repoRelays: ["wss://relay.example"],
    })

    expect(publishStateFromLocal.mock.invocationCallOrder[0]).toBeLessThan(
      gitProvider.push.mock.invocationCallOrder[0],
    )
  })

  it("fails before Git when automatic local state publication is explicitly enabled", async () => {
    const {provider, gitProvider} = makeProvider({publishRepoState: true})

    await expect(
      provider.push({dir: "/tmp/repo", repoRelays: ["wss://relay.example"]}),
    ).rejects.toThrow(/unsupported without a real repository state source/)

    expect(gitProvider.push).not.toHaveBeenCalled()
  })

  it("does not silently skip configured automatic publication without a local path", async () => {
    const {provider, gitProvider} = makeProvider({publishRepoState: true})

    await expect(provider.push({})).rejects.toThrow("requires a local repository path")
    expect(gitProvider.push).not.toHaveBeenCalled()
  })

  it("fails before Git when the configured GRASP provider has no real state source", async () => {
    const {provider, gitProvider} = makeProvider()
    const grasp = {
      supportsStatePublicationFromLocal: false,
      publishStateFromLocal: vi.fn(),
    }
    provider.configureGrasp(grasp)

    await expect(
      provider.push({
        publishRepoStateFromLocal: true,
        ownerPubkey: "owner",
        repoId: "repo",
        repoRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow(/unsupported without a real repository state source/)

    expect(gitProvider.push).not.toHaveBeenCalled()
    expect(grasp.publishStateFromLocal).not.toHaveBeenCalled()
  })

  it("propagates an explicitly requested publication failure", async () => {
    const {provider, gitProvider} = makeProvider()
    const grasp = {
      supportsStatePublicationFromLocal: true,
      publishStateFromLocal: vi.fn().mockRejectedValue(new Error("relay rejected state")),
    }
    provider.configureGrasp(grasp)

    await expect(
      provider.push({
        publishRepoStateFromLocal: true,
        ownerPubkey: "owner",
        repoId: "repo",
        repoRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow("relay rejected state")

    expect(gitProvider.push).not.toHaveBeenCalled()
    expect(grasp.publishStateFromLocal).toHaveBeenCalledWith("owner", "repo", {
      relays: ["wss://relay.example"],
    })
  })

  it("requires explicit owner and repository identifiers before Git", async () => {
    const {provider, gitProvider} = makeProvider()
    provider.configureGrasp({
      supportsStatePublicationFromLocal: true,
      publishStateFromLocal: vi.fn(),
    })

    await expect(
      provider.push({
        publishRepoStateFromLocal: true,
        repoId: "repo",
        repoRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow("requires an explicit owner")
    expect(gitProvider.push).not.toHaveBeenCalled()

    await expect(
      provider.push({
        publishRepoStateFromLocal: true,
        ownerPubkey: "owner",
        repoRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow("requires an explicit repository identifier")
    expect(gitProvider.push).not.toHaveBeenCalled()
  })
})
