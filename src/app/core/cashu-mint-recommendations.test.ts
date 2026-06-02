import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  normalizeRelays,
  parseCommunityDefinition,
} from "./community"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  CASHU_MINT_LIST_KIND,
  buildCashuMintRecommendations,
  getCashuMintRecommendationAuthors,
  normalizeCashuMintUrl,
} from "./cashu-mint-recommendations"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || "e".repeat(64),
    pubkey: overrides.pubkey || "a".repeat(64),
    created_at: overrides.created_at || 1,
    kind: overrides.kind || 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  }) as TrustedEvent

const makeDefinition = ({
  communityPubkey,
  mintUrl,
  listAddresses = [],
}: {
  communityPubkey: string
  mintUrl?: string
  listAddresses?: string[]
}) =>
  parseCommunityDefinition(
    makeEvent({
      id: communityPubkey.slice(0, 8),
      pubkey: communityPubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://relay.example.com"],
        ...(mintUrl ? [["mint", mintUrl, "cashu"]] : []),
        ["content", "Repositories"],
        ["k", "30617"],
        ...listAddresses.map(address => ["a", address]),
      ],
    }),
  )!

const makeProfileList = ({
  pubkey,
  identifier = "Repositories",
  members = [],
}: {
  pubkey: string
  identifier?: string
  members?: Array<string | [string, string]>
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${identifier}`,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [
      ["d", identifier],
      ...members.map(member => (Array.isArray(member) ? ["p", member[0], member[1]] : ["p", member])),
    ],
  })

const makeCommunityRef = (
  definition: ReturnType<typeof makeDefinition>,
  roles: ActiveUserCommunityRef["roles"] = ["member"],
): ActiveUserCommunityRef =>
  ({
    communityPubkey: definition.pubkey,
    definition,
    relayHints: definition.relays,
    roles,
    writableSections: ["Repositories"],
  }) as ActiveUserCommunityRef

const makeMintList = ({
  pubkey,
  mints,
  created_at = 1,
}: {
  pubkey: string
  mints: string[]
  created_at?: number
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${created_at}`,
    pubkey,
    kind: CASHU_MINT_LIST_KIND,
    created_at,
    tags: mints.map(mint => ["mint", mint, "sat"]),
  })

describe("cashu mint recommendations", () => {
  it("normalizes mint URLs for dedupe", () => {
    expect(normalizeCashuMintUrl("https://MINT.example.com/path/?x=1#frag")).toBe(
      "https://mint.example.com/path",
    )
  })

  it("scores community mints above personal 10019 and direct follows", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const listOwner = "3".repeat(64)
    const recommender = "4".repeat(64)
    const followed = "5".repeat(64)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://community.example.com/",
      listAddresses: [listAddress],
    })
    const profileList = makeProfileList({pubkey: listOwner, members: [viewer, recommender]})
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [profileList],
      follows: [followed],
      mintListEvents: [
        makeMintList({pubkey: viewer, mints: ["https://own.example.com"]}),
        makeMintList({pubkey: recommender, mints: ["https://member.example.com"]}),
        makeMintList({pubkey: followed, mints: ["https://follow.example.com"]}),
      ],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual([
      "https://community.example.com",
      "https://own.example.com",
      "https://member.example.com",
      "https://follow.example.com",
    ])
    expect(recommendations[0].counts.communities).toBe(1)
    expect(recommendations[1].counts.ownNutzap).toBe(1)
    expect(recommendations[2].counts.members).toBe(1)
    expect(recommendations[3].counts.follows).toBe(1)
  })

  it("attaches relay hints for recommendation evidence profiles", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const listOwner = "3".repeat(64)
    const recommender = "4".repeat(64)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://community.example.com/",
      listAddresses: [listAddress],
    })
    const profileList = makeProfileList({
      pubkey: listOwner,
      members: [viewer, [recommender, "wss://member-profile.example.com"]],
    })

    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [profileList],
      mintListEvents: [makeMintList({pubkey: recommender, mints: ["https://member.example.com"]})],
    })
    const communityEvidence = recommendations
      .find(item => item.mintUrl === "https://community.example.com")
      ?.evidence.find(evidence => evidence.kind === "community")
    const memberEvidence = recommendations
      .find(item => item.mintUrl === "https://member.example.com")
      ?.evidence.find(evidence => evidence.kind === "member")

    expect(communityEvidence?.relayHints).toEqual(normalizeRelays(["wss://relay.example.com"]))
    expect(memberEvidence?.communityRelayHints).toEqual(normalizeRelays(["wss://relay.example.com"]))
    expect(memberEvidence?.relayHints).toEqual(
      expect.arrayContaining(
        normalizeRelays(["wss://relay.example.com", "wss://member-profile.example.com"]),
      ),
    )
  })

  it("orders direct 10222 community mints before community-owned 10019 mints", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const listOwner = "3".repeat(64)
    const listAddress = `${PROFILE_LIST_KIND}:${listOwner}:Repositories`
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://zzz-community.example.com/",
      listAddresses: [listAddress],
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [makeProfileList({pubkey: listOwner, members: [viewer]})],
      mintListEvents: [makeMintList({pubkey: community, mints: ["https://aaa-10019.example.com"]})],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual([
      "https://zzz-community.example.com",
      "https://aaa-10019.example.com",
    ])
    expect(recommendations[0].evidence.some(evidence => evidence.source === "10222")).toBe(true)
    expect(recommendations[1].evidence.every(evidence => evidence.source === "10019")).toBe(true)
  })

  it("dedupes mints and excludes already trusted mints", () => {
    const viewer = "1".repeat(64)
    const community = viewer
    const definition = makeDefinition({
      communityPubkey: community,
      mintUrl: "https://trusted.example.com/",
    })
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      trustedMints: ["https://trusted.example.com"],
      communityRefs: [makeCommunityRef(definition, ["admin"])],
      mintListEvents: [
        makeMintList({
          pubkey: viewer,
          mints: ["https://trusted.example.com", "https://new.example.com/"],
        }),
      ],
    })

    expect(recommendations.map(item => item.mintUrl)).toEqual(["https://new.example.com"])
  })

  it("does not count muted direct follows as follow evidence", () => {
    const viewer = "1".repeat(64)
    const followed = "2".repeat(64)
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      follows: [followed],
      mutes: [followed],
      mintListEvents: [makeMintList({pubkey: followed, mints: ["https://muted.example.com"]})],
    })

    expect(recommendations).toEqual([])
  })

  it("prioritizes community and moderator authors before member authors", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const member = "4".repeat(64)
    const definition = makeDefinition({
      communityPubkey: community,
      listAddresses: [`${PROFILE_LIST_KIND}:${moderator}:Repositories`],
    })
    const authors = getCashuMintRecommendationAuthors({
      viewerPubkey: viewer,
      follows: ["5".repeat(64)],
      communityRefs: [makeCommunityRef(definition)],
      profileListEvents: [makeProfileList({pubkey: moderator, members: [viewer, member]})],
    })

    expect(authors.slice(0, 5)).toEqual([viewer, community, moderator, "5".repeat(64), member])
  })
})
