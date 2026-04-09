import {describe, expect, it} from "vitest"

import {GIT_REPO_ANNOUNCEMENT, type RepoAnnouncementEvent} from "@nostr-git/core/events"

import {
  buildRepoDiscoveryCandidatePubkeys,
  buildRepoDiscoveryBuckets,
  coerceRepoDiscoveryPrioritySettings,
  dedupeRepoDiscoveryBuckets,
  getDefaultRepoDiscoveryPrioritySettings,
  mergeLoadedRepoSearchItems,
  repoMatchesSearchQuery,
  toLoadedRepoSearchItem,
} from "./repo-discovery-search"

const makeRepoEvent = ({
  pubkey,
  identifier,
  name = identifier,
  description = "",
  created_at = 1,
}: {
  pubkey: string
  identifier: string
  name?: string
  description?: string
  created_at?: number
}): RepoAnnouncementEvent =>
  ({
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey,
    id: `${pubkey}-${identifier}-${created_at}`,
    created_at,
    content: "",
    sig: "sig",
    tags: [
      ["d", identifier],
      ["name", name],
      ["description", description],
    ],
  }) as RepoAnnouncementEvent

describe("repo discovery search helpers", () => {
  it("matches repo owner profile names alongside repo metadata", () => {
    const event = makeRepoEvent({
      pubkey: "f".repeat(64),
      identifier: "alpha-repo",
      name: "alpha-repo",
      description: "A cool repo",
    })
    const item = toLoadedRepoSearchItem(event, "wss://relay.example")

    expect(item).not.toBeNull()
    expect(
      repoMatchesSearchQuery({
        repo: item!,
        query: "alice",
        profile: {display_name: "Alice Maintainer", name: "alice"},
      }),
    ).toBe(true)
    expect(repoMatchesSearchQuery({repo: item!, query: "cool repo"})).toBe(true)
    expect(repoMatchesSearchQuery({repo: item!, query: "backend"})).toBe(false)
  })

  it("keeps local repo matches ahead of discovered duplicates", () => {
    const local = toLoadedRepoSearchItem(
      makeRepoEvent({pubkey: "a".repeat(64), identifier: "repo"}),
      "wss://local",
    )
    const remote = toLoadedRepoSearchItem(
      makeRepoEvent({pubkey: "a".repeat(64), identifier: "repo", created_at: 2}),
      "wss://remote",
    )
    const discovered = toLoadedRepoSearchItem(
      makeRepoEvent({pubkey: "b".repeat(64), identifier: "other"}),
      "wss://remote",
    )

    const merged = mergeLoadedRepoSearchItems([local!], [remote!, discovered!])

    expect(merged.map(item => item.relayHint)).toEqual(["wss://local", "wss://remote"])
    expect(merged.map(item => item.address)).toEqual([local!.address, discovered!.address])
  })

  it("prioritizes bookmarked owners ahead of lower trust matches", () => {
    const candidates = buildRepoDiscoveryCandidatePubkeys({
      settings: getDefaultRepoDiscoveryPrioritySettings(),
      viewerPubkey: "viewer",
      bookmarkedOwners: ["bookmarked-owner"],
      followPubkeys: ["followed-owner"],
      knownOwners: ["known-owner"],
      profileMatches: ["profile-match"],
      trustScores: new Map([
        ["bookmarked-owner", 1],
        ["higher-trust-owner", 50],
      ]),
    })

    expect(candidates.indexOf("profile-match")).toBeLessThan(candidates.indexOf("bookmarked-owner"))
    expect(candidates.indexOf("bookmarked-owner")).toBeLessThan(
      candidates.indexOf("followed-owner"),
    )
    expect(candidates.indexOf("followed-owner")).toBeLessThan(
      candidates.indexOf("higher-trust-owner"),
    )
  })

  it("respects custom priority order and disabled buckets", () => {
    const settings = coerceRepoDiscoveryPrioritySettings([
      {key: "direct_follows", enabled: true},
      {key: "viewer", enabled: false},
      {key: "trust_network", enabled: true},
      {key: "profile_matches", enabled: false},
      {key: "bookmarked_owners", enabled: false},
      {key: "known_repo_owners", enabled: true},
    ])

    const buckets = dedupeRepoDiscoveryBuckets(
      buildRepoDiscoveryBuckets({
        settings,
        viewerPubkey: "viewer",
        bookmarkedOwners: ["bookmarked-owner"],
        followPubkeys: ["followed-owner"],
        knownOwners: ["known-owner"],
        profileMatches: ["profile-match"],
        trustScores: new Map([["trusted-owner", 4]]),
      }),
    )

    expect(buckets.map(bucket => bucket.key)).toEqual([
      "direct_follows",
      "trust_network",
      "known_repo_owners",
    ])
    expect(buckets.flatMap(bucket => bucket.pubkeys)).toEqual([
      "followed-owner",
      "trusted-owner",
      "known-owner",
    ])
  })
})
