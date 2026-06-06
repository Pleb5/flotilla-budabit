import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  parseCommunityDefinition,
} from "./community"
import {
  COMMUNITY_REPORT_KIND,
  getEffectiveCommunityReportState,
  makeCommunityPersonReport,
} from "./community-reports"
import {
  buildRepoCommunityContexts,
  getPrimaryRepoCommunityContext,
  isEndorsedRepoCommunityContext,
} from "./repo-community-context"

const repoOwnerPubkey = "1".repeat(64)
const communityPubkey = "2".repeat(64)
const moderatorPubkey = "3".repeat(64)
const granteePubkey = "4".repeat(64)
const outsiderPubkey = "5".repeat(64)
const otherCommunityPubkey = "6".repeat(64)
const repoAddress = `${GIT_REPO_ANNOUNCEMENT}:${repoOwnerPubkey}:demo`

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: repoOwnerPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = (pubkey = communityPubkey, sectionName = "Code-curator") =>
  parseCommunityDefinition(
    makeEvent({
      id: `definition-${pubkey}`,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://relay.example.com"],
        ["content", sectionName],
        ["k", String(GIT_REPO_ANNOUNCEMENT)],
        ["a", `${PROFILE_LIST_KIND}:${moderatorPubkey}:${sectionName}`],
      ],
    }),
  )!

const makeProfileList = ({members = [granteePubkey], sectionName = "Code-curator"} = {}) =>
  makeEvent({
    id: "repo-profile-list",
    pubkey: moderatorPubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", sectionName], ...members.map(member => ["p", member])],
  })

const makeRepo = (overrides: Partial<TrustedEvent> = {}) =>
  makeEvent({
    id: "repo-event",
    pubkey: repoOwnerPubkey,
    kind: GIT_REPO_ANNOUNCEMENT,
    tags: [["d", "demo"]],
    ...overrides,
  })

const makeAssociation = ({
  pubkey,
  community = communityPubkey,
  createdAt = 10,
}: {
  pubkey: string
  community?: string
  createdAt?: number
}) =>
  makeEvent({
    id: `association-${pubkey}-${community}`,
    pubkey,
    created_at: createdAt,
    kind: TARGETED_PUBLICATION_KIND,
    tags: buildTargetedPublication({
      id: `target-${community}`,
      kind: GIT_REPO_ANNOUNCEMENT,
      ref: {type: "a", value: repoAddress},
      communities: [{pubkey: community, relay: "wss://community.example.com/"}],
    }).tags,
  })

describe("repo community context", () => {
  it("strongly validates repo associations from community admins and repo moderators", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const adminAssociation = makeAssociation({pubkey: communityPubkey})
    const moderatorAssociation = makeAssociation({pubkey: moderatorPubkey})

    const adminContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [adminAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })
    const moderatorContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [moderatorAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
    })

    expect(adminContext).toMatchObject({validation: "strong", communityPubkey})
    expect(moderatorContext).toMatchObject({validation: "strong", communityPubkey})
    expect(adminContext?.evidence.map(item => item.label)).toContain("Associated by repo authority")
  })

  it("strongly validates repo authority from custom sections that support repositories", () => {
    const definition = makeDefinition(communityPubkey, "Code")
    const repoEvent = makeRepo()
    const moderatorAssociation = makeAssociation({pubkey: moderatorPubkey})

    const context = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [moderatorAssociation],
      definitions: [definition],
      profileListEvents: [makeProfileList({sectionName: "Code"})],
    })

    expect(context).toMatchObject({validation: "strong", communityPubkey})
    expect(context?.evidence.map(item => item.label)).toContain("Associated by repo authority")
  })

  it("validates repo-section grantee associations but leaves outsider associations weak", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const profileListEvents = [makeProfileList()]
    const granteeContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: granteePubkey})],
      definitions: [definition],
      profileListEvents,
    })
    const outsiderContext = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: outsiderPubkey})],
      definitions: [definition],
      profileListEvents,
    })

    expect(granteeContext).toMatchObject({validation: "valid", communityPubkey})
    expect(granteeContext?.evidence.map(item => item.label)).toEqual([
      "Community repo",
      "Associated by repo grant",
    ])
    expect(isEndorsedRepoCommunityContext(granteeContext)).toBe(true)
    expect(outsiderContext).toMatchObject({validation: "weak", communityPubkey})
    expect(isEndorsedRepoCommunityContext(outsiderContext)).toBe(false)
  })

  it("suppresses associations when the associator or repo owner is banned in that community", () => {
    const definition = makeDefinition()
    const repoEvent = makeRepo()
    const banAssociator = makeEvent({
      id: "ban-associator",
      pubkey: communityPubkey,
      kind: COMMUNITY_REPORT_KIND,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: granteePubkey}).tags,
    })
    const banOwner = makeEvent({
      id: "ban-owner",
      pubkey: communityPubkey,
      kind: COMMUNITY_REPORT_KIND,
      tags: makeCommunityPersonReport({communityPubkey, pubkey: repoOwnerPubkey}).tags,
    })
    const reportState = getEffectiveCommunityReportState({
      definition,
      reportEvents: [banAssociator, banOwner],
    })

    const context = getPrimaryRepoCommunityContext({
      repoEvent,
      repoAddress,
      associationEvents: [makeAssociation({pubkey: granteePubkey})],
      definitions: [definition],
      profileListEvents: [makeProfileList()],
      reportStates: new Map([[communityPubkey, reportState]]),
    })

    expect(context).toMatchObject({validation: "invalid", suppressed: true})
    expect(context?.suppressionReason).toBe("community_ban")
    expect(context?.evidence.map(item => item.label)).toEqual(["Community repo", "Banned here"])
    expect(isEndorsedRepoCommunityContext(context)).toBe(false)
  })

  it("sorts the active community context before unrelated community associations", () => {
    const definition = makeDefinition()
    const otherDefinition = makeDefinition(otherCommunityPubkey)
    const repoEvent = makeRepo()
    const contexts = buildRepoCommunityContexts({
      repoEvent,
      repoAddress,
      associationEvents: [
        makeAssociation({pubkey: communityPubkey, community: communityPubkey, createdAt: 10}),
        makeAssociation({
          pubkey: otherCommunityPubkey,
          community: otherCommunityPubkey,
          createdAt: 20,
        }),
      ],
      definitions: [definition, otherDefinition],
      profileListEvents: [makeProfileList()],
      activeCommunityPubkey: communityPubkey,
    })

    expect(contexts.map(context => context.communityPubkey)).toEqual([
      communityPubkey,
      otherCommunityPubkey,
    ])
  })
})
