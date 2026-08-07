import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"
import {createEventIOStub, type EventIOStub} from "../utils/eventio-stub.js"

const owner = "a".repeat(64)

function announcementEvent(repoId: string) {
  return {
    kind: 30617,
    pubkey: owner,
    tags: [
      ["d", repoId],
      ["clone", "https://example.com/owner/repo.git"],
      ["maintainers", "npub1alice"],
      ["relays", "wss://relay.example.com"],
    ],
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  } as any
}

describe("API/NostrGitProvider additional paths", () => {
  it("discoverRepo returns announcement with urls and no state when no state events found", async () => {
    const repoId = "owner/repo"
    const io = createEventIOStub({
      fetchRules: [
        {
          matcher: filters =>
            filters?.some((f: any) => f?.kinds?.includes(30617) && f?.["#d"]?.includes(repoId)),
          events: [announcementEvent(repoId)],
        },
        {
          matcher: filters =>
            filters?.some((f: any) => f?.kinds?.includes(30618) && f?.["#d"]?.includes(repoId)),
          events: [],
        },
      ],
    })

    const provider = new NostrGitProvider({eventIO: io})
    const res = await provider.discoverRepo(repoId, {
      announcementRelays: ["wss://discovery.example.com"],
    })

    expect(res).toBeTruthy()
    expect(res?.repoId).toBe(repoId)
    expect((res?.urls || []).length).toBeGreaterThan(0)
    expect(res?.state).toBeUndefined()
    expect(io.__calls.fetchEvents).toEqual([
      expect.objectContaining({scope: {relays: ["wss://discovery.example.com"]}}),
      expect.objectContaining({
        filters: [expect.objectContaining({authors: [owner]})],
        scope: {relays: ["wss://relay.example.com"]},
      }),
    ])
  })

  it("listProposals propagates transport failures", async () => {
    const io = createEventIOStub()
    // Force fetchEvents to throw
    ;(io as any).fetchEvents = async () => {
      throw new Error("network down")
    }

    const provider = new NostrGitProvider({eventIO: io})
    await expect(
      provider.listProposals("30617:addr", {
        relays: ["wss://repo.example.com"],
      }),
    ).rejects.toThrow("network down")
  })

  it("sendProposal rejects because legacy patch proposals were removed", async () => {
    const io = createEventIOStub()
    const provider = new NostrGitProvider({eventIO: io})
    await expect(provider.sendProposal("30617:addr", ["c1"])).rejects.toThrow(/legacy patch events/)
  })

  it("publishRepoState is unsupported without a real local snapshot", async () => {
    const io = createEventIOStub()
    const provider = new NostrGitProvider({eventIO: io})
    await expect(provider.publishRepoState("/repo", ["wss://repo.example.com"])).rejects.toThrow(
      /unsupported without a real repository state source/,
    )
    expect(io.__calls.publishEvent).toHaveLength(0)
  })

  it("publishRepoAnnouncement is unsupported without real local metadata", async () => {
    const io = createEventIOStub()
    const provider = new NostrGitProvider({eventIO: io})
    await expect(
      provider.publishRepoAnnouncement("/repo", ["wss://repo.example.com"]),
    ).rejects.toThrow(/unsupported without a real repository state source/)
    expect(io.__calls.publishEvent).toHaveLength(0)
  })
})
