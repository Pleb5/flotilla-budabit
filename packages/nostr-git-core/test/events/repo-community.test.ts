import {describe, expect, it} from "vitest"
import {
  createRepoAnnouncementEvent,
  parseRepoAnnouncementEvent,
  parseRepoCommunityBinding,
  withRepoCommunityBinding,
} from "../../src/events/index.js"

const author = "a".repeat(64)
const community = "b".repeat(64)

describe("repo community binding", () => {
  it("writes and parses direct repo community metadata", () => {
    const event = createRepoAnnouncementEvent({
      repoId: "demo",
      name: "Demo",
      community: {pubkey: community, relay: "wss://relay.example.com/"},
    }) as any
    event.id = "event-id"
    event.pubkey = author

    expect(event.tags).toContainEqual(["h", community, "wss://relay.example.com"])
    expect(parseRepoAnnouncementEvent(event).community).toEqual({
      pubkey: community,
      relay: "wss://relay.example.com",
    })
  })

  it("ignores non-pubkey h values", () => {
    expect(
      parseRepoCommunityBinding([
        ["h", "targeting-id-not-a-pubkey"],
        ["name", "Demo"],
      ]),
    ).toBeUndefined()
  })

  it("replaces existing h tags with repo community metadata", () => {
    const updated = withRepoCommunityBinding(
      {
        tags: [
          ["d", "demo"],
          ["h", "targeting-id-not-a-pubkey"],
          ["h", community],
        ],
      },
      {pubkey: author},
    )

    expect(updated.tags).toEqual([
      ["d", "demo"],
      ["h", author],
    ])
  })

  it("removes community binding on demand", () => {
    const updated = withRepoCommunityBinding({tags: [["d", "demo"], ["h", community]]})

    expect(updated.tags).toEqual([["d", "demo"]])
  })
})
