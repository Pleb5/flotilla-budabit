import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"
import {createEventIOStub, type EventIOStub} from "../utils/eventio-stub.js"

describe("API/NostrGitProvider error paths", () => {
  it("discoverRepo returns null when no announcement events found", async () => {
    const io = createEventIOStub({
      fetchRules: [
        {
          matcher: filters =>
            Array.isArray(filters) &&
            filters.some(f => Array.isArray(f?.kinds) && f.kinds.includes(30617)),
          events: [],
        },
      ],
    })

    const provider = new NostrGitProvider({eventIO: io})
    const res = await provider.discoverRepo("owner/repo", {
      announcementRelays: ["wss://discovery.example.com"],
    })
    expect(res).toBeNull()
  })

  it("publishRepoState propagates publish failure", async () => {
    const io = createEventIOStub()
    ;(io as EventIOStub).__setPublishResult({ok: false, error: "relay refused"})

    const provider = new NostrGitProvider({eventIO: io})
    await expect(provider.publishRepoState("/repo", ["wss://repo.example.com"])).rejects.toThrow(
      /Failed to publish repository state/i,
    )
  })

  it("publishRepoAnnouncement propagates publish failure", async () => {
    const io = createEventIOStub()
    ;(io as EventIOStub).__setPublishResult({ok: false, error: "auth failed"})

    const provider = new NostrGitProvider({eventIO: io})
    await expect(
      provider.publishRepoAnnouncement("/repo", ["wss://repo.example.com"]),
    ).rejects.toThrow(/Failed to publish repository announcement/i)
  })

  it("rejects empty announcement discovery scope before EventIO fetch", async () => {
    const io = createEventIOStub()
    const provider = new NostrGitProvider({eventIO: io})

    await expect(provider.discoverRepo("owner/repo", {announcementRelays: []})).rejects.toThrow(
      "Repository operation requires at least one explicit relay",
    )
    expect(io.__calls.fetchEvents).toHaveLength(0)
  })
})
