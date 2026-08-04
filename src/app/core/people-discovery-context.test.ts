import {describe, expect, it} from "vitest"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import {
  resolveCommunityPeopleDiscoveryContext,
  resolveRepoPeopleDiscoveryContext,
} from "./people-discovery-context"

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const community = "c".repeat(64)
const listOwner = "d".repeat(64)

const makeRepoEvent = (communityPubkey = community) =>
  ({
    id: "repo",
    kind: 30617,
    pubkey: owner,
    created_at: 10,
    content: "",
    sig: "",
    tags: [
      ["d", "demo"],
      ["h", communityPubkey],
      ["maintainers", owner, maintainer, maintainer],
    ],
  }) as any

const definitionEvent = {
  id: "definition",
  kind: COMMUNITY_DEFINITION_KIND,
  pubkey: community,
  created_at: 1,
  content: "",
  sig: "",
  tags: [
    ["content", "Repositories"],
    ["k", "30617"],
    ["a", `${PROFILE_LIST_KIND}:${listOwner}:Repositories`],
  ],
} as any

const profileListEvent = {
  id: "list",
  kind: PROFILE_LIST_KIND,
  pubkey: listOwner,
  created_at: 1,
  content: "",
  sig: "",
  tags: [
    ["d", "Repositories"],
    ["p", owner],
  ],
} as any

const definition = parseCommunityDefinition(definitionEvent)!

describe("people discovery contexts", () => {
  it("keeps standalone community context free of repository authority", () => {
    expect(
      resolveCommunityPeopleDiscoveryContext(
        {scope: "community", communityPubkey: community},
        owner,
      ),
    ).toEqual({
      trustContext: {scope: "community", viewerPubkey: owner, communityPubkey: community},
      communityPubkey: community,
      repoOwnerPubkeys: [],
      repoMaintainerPubkeys: [],
    })
  })

  it("combines owner-declared repository authority with an explicit community", () => {
    const result = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent()},
        community: {scope: "community", communityPubkey: community},
      },
      {definitions: [], profileListEvents: [], reportStates: new Map()},
      owner,
    )

    expect(result.repoOwnerPubkeys).toEqual([owner])
    expect(result.repoMaintainerPubkeys).toEqual([maintainer])
    expect(result.trustContext).toMatchObject({
      scope: "repo",
      communityPubkey: community,
      repoAddress: `30617:${owner}:demo`,
    })
  })

  it("uses an announcement community only when the association is endorsed", () => {
    const endorsed = resolveRepoPeopleDiscoveryContext(
      {scope: "repo", authority: {source: "announcement", event: makeRepoEvent()}},
      {
        definitions: [definition],
        profileListEvents: [profileListEvent],
        reportStates: new Map(),
      },
    )
    const unvalidated = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {source: "announcement", event: makeRepoEvent("e".repeat(64))},
      },
      {definitions: [definition], profileListEvents: [], reportStates: new Map()},
    )

    expect(endorsed.communityPubkey).toBe(community)
    expect(unvalidated.communityPubkey).toBe("")
    expect(unvalidated.trustContext.communityPubkey).toBeUndefined()
  })

  it("normalizes draft owner declarations without mixing in community authority", () => {
    const result = resolveRepoPeopleDiscoveryContext(
      {
        scope: "repo",
        authority: {
          source: "draft",
          ownerPubkey: owner,
          maintainerPubkeys: [owner, maintainer, maintainer],
        },
      },
      {definitions: [], profileListEvents: [], reportStates: new Map()},
    )

    expect(result.repoOwnerPubkeys).toEqual([owner])
    expect(result.repoMaintainerPubkeys).toEqual([maintainer])
    expect(result.communityPubkey).toBe("")
  })
})
