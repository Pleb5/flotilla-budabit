import {describe, expect, it} from "vitest"
import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {
  REPO_STAR_CONTENT,
  makeRecentRepoStarDeleteFilter,
  makeRepoStarDeleteFilter,
  makeRepoStarReaction,
  makeRepoStarReactionFilter,
  parseRepoStarReaction,
  repoStarToBookmarkAddress,
  selectActiveRepoStars,
} from "@app/util/repo-stars"

const repoOwner = "a".repeat(64)
const userPubkey = "b".repeat(64)
const otherUserPubkey = "c".repeat(64)
const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${repoOwner}:nostr-git`

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: userPubkey,
    created_at: 1,
    kind: REACTION,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const repoEvent = {
  id: "repo-event-id",
  pubkey: repoOwner,
  created_at: 1,
  kind: GIT_REPO_ANNOUNCEMENT,
  tags: [["d", "nostr-git"]],
  content: "",
  sig: "sig",
} as RepoAnnouncementEvent

const makeStar = (id: string, created_at = 1) =>
  makeEvent({
    id,
    created_at,
    content: REPO_STAR_CONTENT,
    tags: [
      ["a", repoAddress, "wss://relay.example.com/"],
      ["e", repoEvent.id, "wss://relay.example.com/"],
      ["p", repoOwner],
      ["k", String(GIT_REPO_ANNOUNCEMENT)],
    ],
  })

describe("repo stars", () => {
  it("builds positive kind 7 reactions for repository announcements", () => {
    const reaction = makeRepoStarReaction({
      event: repoEvent,
      relayHints: ["wss://relay.example.com"],
    })

    expect(reaction.kind).toBe(REACTION)
    expect(reaction.content).toBe(REPO_STAR_CONTENT)
    expect(reaction.tags).toEqual(
      expect.arrayContaining([
        ["a", repoAddress, "wss://relay.example.com/"],
        ["e", repoEvent.id, "wss://relay.example.com/"],
        ["p", repoOwner],
        ["k", String(GIT_REPO_ANNOUNCEMENT)],
      ]),
    )
  })

  it("parses active repo star reactions", () => {
    const star = makeStar("star-1")

    expect(parseRepoStarReaction(star)).toMatchObject({
      address: repoAddress,
      author: repoOwner,
      identifier: "nostr-git",
      relayHint: "wss://relay.example.com/",
      relayHints: ["wss://relay.example.com/"],
      reaction: star,
    })
  })

  it("filters deleted star reactions out", () => {
    const star = makeStar("star-1")
    const deleteEvent = makeEvent({
      id: "delete-1",
      kind: DELETE,
      content: "",
      tags: [["e", star.id]],
    })

    expect(
      selectActiveRepoStars({
        reactions: [star],
        deleteEvents: [deleteEvent],
        author: userPubkey,
      }),
    ).toEqual([])
  })

  it("ignores deletes from other users", () => {
    const star = makeStar("star-1")
    const deleteEvent = makeEvent({
      id: "delete-1",
      pubkey: otherUserPubkey,
      kind: DELETE,
      content: "",
      tags: [["e", star.id]],
    })

    expect(
      selectActiveRepoStars({
        reactions: [star],
        deleteEvents: [deleteEvent],
        author: userPubkey,
      }),
    ).toHaveLength(1)
  })

  it("dedupes repo stars by latest reaction for an address", () => {
    const older = makeStar("older", 1)
    const newer = makeStar("newer", 2)

    expect(selectActiveRepoStars({reactions: [older, newer], author: userPubkey})).toEqual([
      expect.objectContaining({reaction: newer}),
    ])
  })

  it("keeps community-targeted repo stars out of personal stars", () => {
    const personal = makeStar("personal", 1)
    const communityTargeted = makeEvent({
      ...makeStar("community", 2),
      tags: [["h", "target-id"], ...makeStar("community", 2).tags],
    })

    expect(selectActiveRepoStars({reactions: [personal, communityTargeted], author: userPubkey})).toEqual([
      expect.objectContaining({reaction: personal}),
    ])
  })

  it("builds filters for loading repo star reactions and deletes", () => {
    const star = makeStar("star-1")

    expect(makeRepoStarReactionFilter(userPubkey)).toMatchObject({
      kinds: [REACTION],
      authors: [userPubkey],
      "#k": [String(GIT_REPO_ANNOUNCEMENT)],
    })
    expect(makeRepoStarDeleteFilter(userPubkey, [star])).toMatchObject({
      kinds: [DELETE],
      authors: [userPubkey],
      "#e": [star.id],
    })
    expect(makeRecentRepoStarDeleteFilter(userPubkey)).toMatchObject({
      kinds: [DELETE],
      authors: [userPubkey],
      "#k": [String(REACTION)],
    })
  })

  it("converts active stars to bookmark-shaped addresses for compatibility", () => {
    const star = parseRepoStarReaction(makeStar("star-1"))!

    expect(repoStarToBookmarkAddress(star)).toEqual({
      address: repoAddress,
      author: repoOwner,
      identifier: "nostr-git",
      relayHint: "wss://relay.example.com/",
    })
  })
})
