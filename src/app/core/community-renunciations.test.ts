import {describe, expect, it, vi} from "vitest"
import {NAMED_PEOPLE} from "@welshman/util"

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example", "bad-relay"],
}))

import {
  RENOUNCED_COMMUNITIES_DTAG,
  addRenouncedCommunityToList,
  getRenouncedCommunityPubkeysFromList,
  getRenunciationPublishRelays,
  makeRenouncedCommunitiesList,
  removeRenouncedCommunityFromList,
} from "@app/core/community-renunciations"

const communityPubkey = "a".repeat(64)
const otherCommunityPubkey = "b".repeat(64)

describe("community renunciations", () => {
  it("creates a private named people list for renounced communities", () => {
    const list = makeRenouncedCommunitiesList({
      kind: NAMED_PEOPLE,
      publicTags: [
        ["d", "old"],
        ["title", "Renounced"],
      ],
      privateTags: [["p", communityPubkey]],
    })

    expect(list.kind).toBe(NAMED_PEOPLE)
    expect(list.publicTags).toEqual([
      ["d", RENOUNCED_COMMUNITIES_DTAG],
      ["title", "Renounced"],
    ])
    expect(getRenouncedCommunityPubkeysFromList(list)).toEqual([communityPubkey])
  })

  it("only reads encrypted private p tags as renounced communities", () => {
    const list = makeRenouncedCommunitiesList({
      kind: NAMED_PEOPLE,
      publicTags: [["p", otherCommunityPubkey]],
      privateTags: [
        ["p", communityPubkey],
        ["p", "bad"],
        ["e", otherCommunityPubkey],
      ],
    })

    expect(getRenouncedCommunityPubkeysFromList(list)).toEqual([communityPubkey])
  })

  it("adds and removes renounced communities through private list content", async () => {
    const added = await addRenouncedCommunityToList(undefined, communityPubkey).reconcile(
      async value => `encrypted:${value}`,
    )

    expect(added).toMatchObject({
      kind: NAMED_PEOPLE,
      tags: [["d", RENOUNCED_COMMUNITIES_DTAG]],
      content: `encrypted:${JSON.stringify([["p", communityPubkey]])}`,
    })

    const removed = await removeRenouncedCommunityFromList(
      makeRenouncedCommunitiesList({
        kind: NAMED_PEOPLE,
        privateTags: [
          ["p", communityPubkey],
          ["p", otherCommunityPubkey],
        ],
      }),
      communityPubkey,
    ).reconcile(async value => `encrypted:${value}`)

    expect(removed).toMatchObject({
      kind: NAMED_PEOPLE,
      tags: [["d", RENOUNCED_COMMUNITIES_DTAG]],
      content: `encrypted:${JSON.stringify([["p", otherCommunityPubkey]])}`,
    })
  })

  it("falls back to indexer relays when the user has no outbox relays", () => {
    expect(getRenunciationPublishRelays([])).toEqual(["wss://indexer.example/"])
  })

  it("prefers normalized user outbox relays for renunciation publishes", () => {
    expect(
      getRenunciationPublishRelays(["bad-relay", "wss://outbox.example", "wss://outbox.example/"]),
    ).toEqual(["wss://outbox.example/"])
  })
})
