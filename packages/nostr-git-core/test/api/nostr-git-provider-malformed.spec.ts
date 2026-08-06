import {describe, it, expect} from "vitest"
import "fake-indexeddb/auto"

import {NostrGitProvider} from "../../src/api/providers/nostr-git-provider.js"
import {createEventIOStub} from "../utils/eventio-stub.js"

function malformedAnnouncement(repoId: string) {
  // Missing clone/maintainers/relays tags entirely
  return {
    kind: 30617,
    tags: [["d", repoId]],
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  } as any
}

describe("API/NostrGitProvider malformed announcement handling", () => {
  it("does not establish repository scope from a relayless announcement", async () => {
    const repoId = "owner/repo-missing-tags"
    const io = createEventIOStub({
      fetchRules: [
        {
          matcher: filters =>
            filters?.some((f: any) => f?.kinds?.includes(30617) && f?.["#d"]?.includes(repoId)),
          events: [malformedAnnouncement(repoId)],
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

    expect(res).toBeNull()
    expect(io.__calls.fetchEvents).toHaveLength(1)
    expect(io.__calls.fetchEvents[0].scope.relays).toEqual(["wss://discovery.example.com"])
  })
})
