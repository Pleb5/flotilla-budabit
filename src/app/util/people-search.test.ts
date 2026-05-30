import {describe, expect, it} from "vitest"
import {PROFILE_LIST_KIND} from "@app/core/community"
import {buildPeopleSearchResults, getCommunityPeoplePubkeys} from "./people-search"

describe("people-search", () => {
  it("orders community matches ahead of direct follows", () => {
    const communityMember = "a".repeat(64)
    const directFollow = "b".repeat(64)
    const profiles = new Map([
      [communityMember, {name: "Alice Builder"}],
      [directFollow, {name: "Alice Social"}],
    ])

    const results = buildPeopleSearchResults({
      query: "alice",
      communityPubkeys: [communityMember],
      directFollowPubkeys: [directFollow],
      knownPubkeys: [communityMember, directFollow],
      communityAssessments: new Map([
        [
          communityMember,
          {
            category: "community_member",
            score: 4,
            evidence: [{type: "community_member", label: "Community member"}],
            displayLabels: ["Community member"],
            suppressed: false,
          },
        ],
      ]),
      getProfile: pubkey => profiles.get(pubkey),
    })

    expect(results.map(result => result.pubkey)).toEqual([communityMember, directFollow])
    expect(results[0]).toMatchObject({bucket: "community", label: "Community member"})
    expect(results[1]).toMatchObject({bucket: "direct_follow", label: "You follow"})
  })

  it("returns exact identity matches without a profile", () => {
    const pubkey = "c".repeat(64)

    expect(buildPeopleSearchResults({query: pubkey})).toEqual([
      expect.objectContaining({pubkey, bucket: "identity", label: "Exact match"}),
    ])
  })

  it("does not label unvalidated community candidates as members", () => {
    const candidate = "d".repeat(64)

    const results = buildPeopleSearchResults({
      query: "alice",
      communityPubkeys: [candidate],
      profileMatches: [candidate],
      getProfile: pubkey => (pubkey === candidate ? {name: "Alice Maybe"} : null),
    })

    expect(results).toEqual([
      expect.objectContaining({pubkey: candidate, bucket: "known_profile", label: "Known profile"}),
    ])
  })

  it("collects people from community profile lists", () => {
    const listOwner = "e".repeat(64)
    const member = "f".repeat(64)
    const unrelated = "0".repeat(64)

    const pubkeys = getCommunityPeoplePubkeys({
      profileListEvents: [
        {
          id: "profile-list",
          kind: PROFILE_LIST_KIND,
          pubkey: listOwner,
          tags: [["p", member]],
        } as any,
        {
          id: "not-profile-list",
          kind: 1,
          pubkey: unrelated,
          tags: [["p", unrelated]],
        } as any,
      ],
    })

    expect(pubkeys).toEqual([listOwner, member])
  })
})
