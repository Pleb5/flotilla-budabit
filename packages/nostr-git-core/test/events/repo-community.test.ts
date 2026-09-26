import {describe, expect, it} from "vitest"
import {
  createRepoAnnouncementEvent,
  parseRepoAnnouncementEvent,
  parseRepoCommunityBinding,
  withRepoCommunityBinding,
  editRepoAnnouncementEvent,
} from "../../src/events/index.js"

const author = "a".repeat(64)
const community = "b".repeat(64)
const communityAddress = `32222:${author}:${community}`

describe("repo community binding", () => {
  it("writes and parses direct repo community metadata", () => {
    const event = createRepoAnnouncementEvent({
      repoId: "demo",
      name: "Demo",
      community: {
        address: communityAddress,
        communityId: community,
        relay: "wss://relay.example.com/",
      },
    }) as any
    event.id = "event-id"
    event.pubkey = author

    expect(event.tags).toContainEqual(["h", community, "wss://relay.example.com/"])
    expect(event.tags.some((tag: string[]) => tag[0] === "a")).toBe(false)
    expect(parseRepoAnnouncementEvent(event).community).toEqual({
      communityId: community,
      relay: "wss://relay.example.com/",
    })
  })

  it("reads the existing BudaBit h-only association without inventing an owner", () => {
    const communityId = "0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8"
    expect(
      parseRepoCommunityBinding([
        ["d", "flotilla-budabit"],
        ["h", communityId, "wss://relay.budabit.club"],
      ]),
    ).toEqual({communityId, relay: "wss://relay.budabit.club/"})
  })

  it("still reads a matching exact branch hint in older announcements", () => {
    expect(
      parseRepoCommunityBinding([
        ["h", community],
        ["a", communityAddress],
      ]),
    ).toEqual({
      communityId: community,
      address: communityAddress,
    })
  })

  it.each(
    [
      [],
      [["a", communityAddress]],
      [["h", "malformed"]],
      [
        ["h", community],
        ["h", community],
      ],
      [
        ["h", community],
        ["h", author],
      ],
    ].map(tags => ({tags})),
  )("does not bind missing, invalid or repeated h tags: $tags", ({tags}) => {
    expect(parseRepoCommunityBinding(tags)).toBeUndefined()
  })

  it("keeps the stable association when exact branch hints conflict", () => {
    expect(
      parseRepoCommunityBinding([
        ["h", community],
        ["a", communityAddress],
        ["a", `32222:${community}:${community}`],
      ]),
    ).toEqual({communityId: community})
  })

  it("ignores non-pubkey h values", () => {
    expect(
      parseRepoCommunityBinding([
        ["h", "targeting-id-not-a-pubkey"],
        ["a", communityAddress],
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
      {address: `32222:${community}:${author}`, communityId: author},
    )

    expect(updated.tags).toEqual([
      ["d", "demo"],
      ["h", author],
    ])
  })

  it("writes h-only bindings and removes legacy community a tags when changing association", () => {
    const source = {
      ...createRepoAnnouncementEvent({repoId: "demo", community: {communityId: community}}),
      pubkey: author,
      tags: [
        ["d", "demo"],
        ["h", community],
        ["a", communityAddress],
        ["a", "other-reference"],
      ],
    } as any
    const replacement = {address: `32222:${community}:${author}`, communityId: author}
    for (const updated of [
      withRepoCommunityBinding(source, replacement),
      editRepoAnnouncementEvent(source, {community: replacement}),
    ]) {
      expect(updated.tags).toEqual([
        ["d", "demo"],
        ["a", "other-reference"],
        ["h", author],
      ])
    }
  })

  it("preserves the existing h-only association during unrelated edits and removes it explicitly", () => {
    const source = createRepoAnnouncementEvent({
      repoId: "demo",
      community: {communityId: community},
    })
    const renamed = editRepoAnnouncementEvent(source, {name: "New name"})
    expect(parseRepoCommunityBinding(renamed)).toEqual({communityId: community})
    expect(renamed.tags.some(tag => tag[0] === "a")).toBe(false)
    expect(
      parseRepoCommunityBinding(editRepoAnnouncementEvent(source, {community: undefined})),
    ).toBeUndefined()
  })

  it("removes community binding on demand", () => {
    const updated = withRepoCommunityBinding({
      tags: [
        ["d", "demo"],
        ["h", community],
        ["a", communityAddress],
      ],
    })

    expect(updated.tags).toEqual([["d", "demo"]])
  })
})
