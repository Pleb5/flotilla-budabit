import {describe, expect, it} from "vitest"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  buildCommunityDefinition,
  findCommunitySection,
  makeCommunitySetupSection,
  parseCommunityDefinition,
} from "./community"
import {
  MODERATOR_REQUEST_REACTION_KIND,
  getModeratorPromotionRequestStates,
  getModeratorPromotionRequests,
  makeModeratorGrantRevokeDefinitionUpdate,
  makeModeratorProfileListRequest,
  makeModeratorPromotionDefinitionUpdate,
  makeModeratorRequestReaction,
  makeModeratorRequestReactionDelete,
} from "./community-moderator-requests"

const communityPubkey = "a".repeat(64)
const requesterPubkey = "b".repeat(64)
const existingModeratorPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = () => {
  const setup = makeCommunitySetupSection({
    communityPubkey,
    profileListPubkey: existingModeratorPubkey,
    relays: ["wss://relay.example.com"],
    name: "General",
  })
  const template = buildCommunityDefinition({
    relays: ["wss://relay.example.com"],
    sections: [setup],
    description: "A community",
    blossomServers: ["https://blossom.example.com"],
    mints: [{url: "https://mint.example.com", type: "cashu"}],
    tos: {ref: "tos-document", relay: "wss://relay.example.com"},
    location: "Online",
    geohash: "u4pruydqqvj",
  })

  return parseCommunityDefinition(
    makeEvent({kind: COMMUNITY_DEFINITION_KIND, pubkey: communityPubkey, tags: template.tags}),
  )!
}

const makeRequest = ({created_at = 1}: {created_at?: number} = {}) => {
  const profileList = makeModeratorProfileListRequest({
    communityPubkey,
    requesterPubkey,
    sectionName: "General",
    relays: ["wss://relay.example.com"],
  })

  return {
    profileList: makeEvent({
      id: `profile-list-${created_at}`,
      pubkey: requesterPubkey,
      created_at,
      kind: profileList.kind,
      tags: profileList.tags,
    }),
  }
}

describe("community moderator promotion requests", () => {
  it("parses requester-owned profile-list request events", () => {
    const requestEvent = makeRequest()
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [requestEvent.profileList],
      communityPubkey,
    })

    expect(request).toMatchObject({
      requesterPubkey,
      communityPubkey,
      sectionName: "General",
    })
    expect(request.profileListRef).toMatchObject({
      pubkey: requesterPubkey,
      relay: "wss://relay.example.com/",
    })
  })

  it("uses the latest replaceable request events by address", () => {
    const older = makeRequest({created_at: 1})
    const newer = makeRequest({created_at: 2})
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [newer.profileList, older.profileList],
      communityPubkey,
    })

    expect(request.profileList.event.id).toBe("profile-list-2")
  })

  it("derives pending, rejected, and deleted-reaction states", () => {
    const definition = makeDefinition()
    const requestEvent = makeRequest()
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [requestEvent.profileList],
      communityPubkey,
    })
    const listReactionTemplate = makeModeratorRequestReaction({
      request,
      target: request.profileList,
      content: "-",
    })
    const listReaction = makeEvent({
      id: "reject-list",
      kind: MODERATOR_REQUEST_REACTION_KIND,
      pubkey: communityPubkey,
      content: "-",
      tags: listReactionTemplate.tags,
    })
    const deleteListReaction = makeEvent({
      id: "delete-reject-list",
      kind: DELETE,
      pubkey: communityPubkey,
      tags: makeModeratorRequestReactionDelete({reactionId: listReaction.id}).tags,
    })

    expect(getModeratorPromotionRequestStates({definition, requests: [request]})[0].status).toBe(
      "pending",
    )
    expect(
      getModeratorPromotionRequestStates({definition, requests: [request]})[0].statusEvent?.id,
    ).toBe("profile-list-1")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [listReaction],
      })[0].status,
    ).toBe("rejected")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [listReaction],
      })[0].statusEvent?.id,
    ).toBe("reject-list")
    expect(
      getModeratorPromotionRequestStates({
        definition,
        requests: [request],
        reactionEvents: [listReaction],
        deleteEvents: [deleteListReaction],
      })[0].status,
    ).toBe("pending")
  })

  it("appends accepted request refs to the community definition without overwriting refs", () => {
    const definition = makeDefinition()
    const requestEvent = makeRequest()
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [requestEvent.profileList],
      communityPubkey,
    })
    const template = makeModeratorPromotionDefinitionUpdate({definition, request})
    const updated = parseCommunityDefinition(
      makeEvent({kind: COMMUNITY_DEFINITION_KIND, pubkey: communityPubkey, tags: template.tags}),
    )!
    const section = findCommunitySection(updated, "General")!

    expect(updated.description).toBe("A community")
    expect(updated.blossomServers).toEqual(["https://blossom.example.com"])
    expect(updated.mints).toEqual([{url: "https://mint.example.com", type: "cashu"}])
    expect(updated.tos).toEqual({ref: "tos-document", relay: "wss://relay.example.com/"})
    expect(updated.location).toBe("Online")
    expect(updated.geohash).toBe("u4pruydqqvj")
    expect(section.profileLists.map(ref => ref.pubkey)).toEqual([
      existingModeratorPubkey,
      requesterPubkey,
    ])
    expect(section.badges).toEqual([])
    expect(
      getModeratorPromotionRequestStates({definition: updated, requests: [request]})[0].status,
    ).toBe("accepted")
    expect(
      getModeratorPromotionRequestStates({definition: updated, requests: [request]})[0].statusEvent
        ?.id,
    ).toBe("event-id")

    const secondTemplate = makeModeratorPromotionDefinitionUpdate({definition: updated, request})
    const secondUpdate = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: secondTemplate.tags,
      }),
    )!
    const secondSection = findCommunitySection(secondUpdate, "General")!

    expect(secondSection.profileLists.map(ref => ref.address)).toEqual(
      section.profileLists.map(ref => ref.address),
    )
    expect(secondSection.badges).toEqual([])
  })

  it("derives accepted request states from active grants when request events are incomplete", () => {
    const definition = makeDefinition()
    const requestEvent = makeRequest()
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [requestEvent.profileList],
      communityPubkey,
    })
    const acceptedTemplate = makeModeratorPromotionDefinitionUpdate({definition, request})
    const accepted = parseCommunityDefinition(
      makeEvent({
        id: "accepted-definition",
        created_at: 10,
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: acceptedTemplate.tags,
      }),
    )!
    const incompleteRequests = getModeratorPromotionRequests({
      profileListEvents: [],
      communityPubkey,
    })

    const incompleteStates = getModeratorPromotionRequestStates({
      definition: accepted,
      requests: incompleteRequests,
      includeGranted: true,
    })
    const derivedState = incompleteStates.find(
      state => state.requesterPubkey === requesterPubkey && state.sectionName === "General",
    )
    const completeStates = getModeratorPromotionRequestStates({
      definition: accepted,
      requests: [request],
      includeGranted: true,
    }).filter(state => state.requesterPubkey === requesterPubkey && state.sectionName === "General")

    expect(incompleteRequests).toEqual([])
    expect(derivedState).toMatchObject({
      status: "accepted",
      derivedFromGrant: true,
      profileListRef: {address: request.profileListRef.address},
    })
    expect(derivedState?.statusEvent?.id).toBe("accepted-definition")
    expect(completeStates).toHaveLength(1)
    expect(completeStates[0].derivedFromGrant).toBeUndefined()
  })

  it("revokes moderator refs from one section without touching other refs", () => {
    const general = makeCommunitySetupSection({
      communityPubkey,
      profileListPubkey: existingModeratorPubkey,
      relays: ["wss://relay.example.com"],
      name: "General",
    })
    const rooms = makeCommunitySetupSection({
      communityPubkey,
      profileListPubkey: requesterPubkey,
      relays: ["wss://relay.example.com"],
      name: "Rooms",
    })
    const definition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: buildCommunityDefinition({
          relays: ["wss://relay.example.com"],
          sections: [general, rooms],
          description: "A community",
          blossomServers: ["https://blossom.example.com"],
          mints: [{url: "https://mint.example.com", type: "cashu"}],
          tos: {ref: "tos-document", relay: "wss://relay.example.com"},
          location: "Online",
          geohash: "u4pruydqqvj",
        }).tags,
      }),
    )!
    const requestEvent = makeRequest()
    const [request] = getModeratorPromotionRequests({
      profileListEvents: [requestEvent.profileList],
      communityPubkey,
    })
    const acceptedTemplate = makeModeratorPromotionDefinitionUpdate({definition, request})
    const accepted = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: acceptedTemplate.tags,
      }),
    )!
    const revokeTemplate = makeModeratorGrantRevokeDefinitionUpdate({
      definition: accepted,
      sectionName: "General",
      moderatorPubkey: requesterPubkey,
    })
    const revoked = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: revokeTemplate.tags,
      }),
    )!
    const revokedGeneral = findCommunitySection(revoked, "General")!
    const revokedRooms = findCommunitySection(revoked, "Rooms")!

    expect(revoked.description).toBe("A community")
    expect(revoked.blossomServers).toEqual(["https://blossom.example.com"])
    expect(revoked.mints).toEqual([{url: "https://mint.example.com", type: "cashu"}])
    expect(revoked.tos).toEqual({ref: "tos-document", relay: "wss://relay.example.com/"})
    expect(revoked.location).toBe("Online")
    expect(revoked.geohash).toBe("u4pruydqqvj")
    expect(revokedGeneral.profileLists.map(ref => ref.pubkey)).toEqual([existingModeratorPubkey])
    expect(revokedGeneral.badges).toEqual([])
    expect(revokedRooms.profileLists.map(ref => ref.pubkey)).toEqual([requesterPubkey])
    expect(revokedRooms.badges).toEqual([])
  })
})
