import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  publishCount: 0,
  publishThunk: vi.fn(({event}: {event: Record<string, unknown>}) => {
    mocks.publishCount += 1
    return {
      event: {
        ...event,
        id: String(mocks.publishCount).padStart(64, "0"),
        pubkey: "2".repeat(64),
        sig: "3".repeat(128),
      },
    }
  }),
  repositoryPublish: vi.fn(),
}))

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  repository: {publish: mocks.repositoryPublish},
}))

vi.mock("@welshman/util", () => ({
  makeEvent: (kind: number, event: Record<string, unknown>) => ({kind, ...event}),
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => /^wss?:\/\//.test(url),
}))

vi.mock("@welshman/lib", () => ({randomId: () => "target-id"}))
vi.mock("@nostr-git/core/types", () => ({GIT_PERMALINK: 1623}))
vi.mock("@app/core/community", () => ({TARGETED_PUBLICATION_KIND: 30222}))
vi.mock("@app/core/community-targeting", () => ({
  makeEventPublicationRef: (value: unknown) => value,
  makeTargetedPublicationForCommunity: () => ({tags: []}),
  withPublicationTargetingId: (event: {tags: string[][]}, id: string) => ({
    ...event,
    tags: [...event.tags, ["h", id]],
  }),
}))

const permalink = {
  id: "",
  pubkey: "",
  sig: "",
  kind: 1623 as const,
  created_at: 0,
  content: "code",
  tags: [],
}

describe("permalink publishing", () => {
  beforeEach(() => {
    mocks.publishCount = 0
    mocks.publishThunk.mockClear()
    mocks.repositoryPublish.mockClear()
  })

  it("returns the relays used for a community-only permalink publication", async () => {
    const {publishPermalinkToDestinations} = await import("./permalink-publishing")

    const published = publishPermalinkToDestinations({
      permalink,
      relays: ["wss://repo.example.com"],
      communityOptions: [
        {
          pubkey: "4".repeat(64),
          label: "Community",
          relays: ["wss://community.example.com"],
        },
      ],
      selection: {personal: false, communityPubkeys: ["4".repeat(64)]},
      createdAt: 10,
    })

    expect(published?.event).toMatchObject({kind: 1623, tags: [["h", "target-id"]]})
    expect(published?.relays).toEqual(["wss://community.example.com/", "wss://repo.example.com/"])
  })
})
