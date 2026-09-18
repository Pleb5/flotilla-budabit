import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {EVENT_DATE, EVENT_TIME, THREAD, ZAP_GOAL, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  buildCommunityFiniteFollowUpFilters,
  buildCommunityFiniteFollowUpRelayPlans,
  buildCommunityHistoricalDiscoveryFilters,
  buildCommunityLiveFilters,
  getCommunityLiveOwnershipKey,
} from "./community-live"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = key(101)
const communityId = key(104)
const listPubkey = key(102)
const authorPubkey = key(103)
const community = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId,
})!
const goalEventId = "1".repeat(64)
const otherGoalEventId = "2".repeat(64)

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

const authorityDefinition = parseCommunityDefinition(
  makeEvent({
    kind: 32222,
    tags: buildCommunityDefinition({
      communityId: community.communityId,
      name: "Community",
      relays: ["wss://relay.budabit.club"],
      sections: [
        {
          name: "General",
          kinds: [{kind: 1111}],
          profileLists: [
            {address: `${PROFILE_LIST_KIND}:${listPubkey}:${community.communityId}-general`},
          ],
        },
        {
          name: "Projects",
          kinds: [{kind: 30617}],
          profileLists: [
            {address: `${PROFILE_LIST_KIND}:${listPubkey}:${community.communityId}-projects`},
          ],
        },
        {
          name: "Calendar",
          kinds: [{kind: EVENT_TIME}],
          profileLists: [
            {address: `${PROFILE_LIST_KIND}:${listPubkey}:${community.communityId}-calendar`},
          ],
        },
      ],
    }).tags,
  }),
)!

const targetingEvent = makeEvent({
  id: "targeting-event",
  kind: TARGETED_PUBLICATION_KIND,
  tags: buildTargetedPublication({
    id: "calendar-target",
    kind: EVENT_TIME,
    source: {type: "a", value: `${EVENT_TIME}:${authorPubkey}:calendar-event`},
    communities: [community],
  }).tags,
})

const implicitTargetingEvent = makeEvent({
  id: "implicit-targeting-event",
  pubkey: authorPubkey,
  kind: TARGETED_PUBLICATION_KIND,
  tags: buildTargetedPublication({
    id: "implicit-goal-target",
    kind: ZAP_GOAL,
    communities: [community],
  }).tags,
})

const goalTargetingEvent = makeEvent({
  id: "goal-targeting-event",
  kind: TARGETED_PUBLICATION_KIND,
  tags: buildTargetedPublication({
    id: "goal-target",
    kind: ZAP_GOAL,
    source: {
      type: "e",
      value: goalEventId,
      relay: "wss://goal-hint.example.com/",
    },
    communities: [community],
  }).tags,
})

describe("community live filters", () => {
  it("keys same-owner sibling ownership by exact address", () => {
    const sibling = makeCommunityPointer({
      ownerPubkey: community.ownerPubkey,
      communityId: key(105),
    })!

    expect(getCommunityLiveOwnershipKey(community.address, "wss://relay.example.com")).not.toBe(
      getCommunityLiveOwnershipKey(sibling.address, "wss://relay.example.com"),
    )
    expect(getCommunityLiveOwnershipKey(community.address, "wss://relay.example.com")).toBe(
      `${community.address}\nwss://relay.example.com/`,
    )
  })

  it("discovers historical roots and calendar/goal targeting wrappers", () => {
    const filters = buildCommunityHistoricalDiscoveryFilters(community)

    expect(filters).toEqual([
      {kinds: [THREAD], "#h": [communityId]},
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": [communityId],
        "#k": [String(EVENT_DATE), String(EVENT_TIME), String(ZAP_GOAL)],
      },
    ])
  })

  it("keeps the permanent subscription small and stable", () => {
    const filters = buildCommunityLiveFilters({
      authorityDefinition,
      admissionFormAddresses: ["30168:moderator:admission"],
    })
    const profileFilters = filters.filter(filter => filter.kinds?.includes(PROFILE_LIST_KIND))

    expect(filters.length).toBeLessThanOrEqual(10)
    expect(filters.every(filter => filter.limit === 0)).toBe(true)
    expect(
      filters.some(
        filter =>
          filter.kinds?.includes(8) &&
          filter.kinds?.includes(30009) &&
          filter["#h"]?.includes(communityId),
      ),
    ).toBe(true)
    expect(profileFilters).toHaveLength(2)
    expect(
      profileFilters.some(
        filter =>
          !filter.authors &&
          [
            `${community.communityId}-calendar`,
            `${community.communityId}-general`,
            `${community.communityId}-projects`,
          ].every(identifier => filter["#d"]?.includes(identifier)),
      ),
    ).toBe(true)
    expect(filters.some(filter => filter.ids?.includes("calendar-event"))).toBe(false)
    expect(filters).toContainEqual({
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [community.ownerPubkey],
      "#d": [community.communityId],
      limit: 0,
    })
    expect(filters).toContainEqual({kinds: expect.any(Array), "#h": [communityId], limit: 0})
  })

  it("moves exact originals and growing response ids to finite filters", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      authorityDefinition,
      targetingEvents: [targetingEvent],
      admissionResponseIds: ["response-id"],
      reportEvents: [],
      moderatorRequests: [],
      moderatorRequestReactionEvents: [],
    })

    expect(filters).toContainEqual({
      kinds: [EVENT_TIME],
      authors: [authorPubkey],
      "#d": ["calendar-event"],
      limit: 1,
    })
    expect(filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(true)
    expect(filters.every(filter => filter.limit !== 0)).toBe(true)
  })

  it("keeps report review discovery on the exact branch", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      authorityDefinition,
      targetingEvents: [],
      admissionResponseIds: [],
      reportEvents: [makeEvent({id: "report-id"})],
      moderatorRequests: [],
      moderatorRequestReactionEvents: [],
    })

    expect(filters).toContainEqual({
      kinds: [1985],
      "#h": [communityId],
      "#a": [community.address],
      "#e": ["report-id"],
      "#L": ["budabit:community-report"],
      limit: 500,
    })
  })

  it("binds implicit finite originals to the authorized wrapper signer", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      authorityDefinition,
      targetingEvents: [implicitTargetingEvent],
      admissionResponseIds: [],
      reportEvents: [],
      moderatorRequests: [],
      moderatorRequestReactionEvents: [],
    })

    expect(filters).toContainEqual({
      kinds: [ZAP_GOAL],
      authors: [authorPubkey],
      "#h": ["implicit-goal-target"],
      limit: 1,
    })
  })

  it("sends external relays only the exact originals they host", () => {
    const otherTargetingEvent = makeEvent({
      id: "other-targeting-event",
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "other-goal-target",
        kind: ZAP_GOAL,
        source: {
          type: "e",
          value: otherGoalEventId,
          relay: "wss://other-goal-hint.example.com/",
        },
        communities: [community],
      }).tags,
    })
    const plans = buildCommunityFiniteFollowUpRelayPlans({
      authorityDefinition,
      relays: ["wss://relay.budabit.club/"],
      targetingEvents: [goalTargetingEvent, otherTargetingEvent],
      admissionResponseIds: ["response-id"],
      reportEvents: [],
      moderatorRequests: [],
      moderatorRequestReactionEvents: [],
    })
    const communityPlan = plans.find(plan => plan.relay === "wss://relay.budabit.club/")
    const externalPlan = plans.find(plan => plan.relay === "wss://goal-hint.example.com/")
    const otherExternalPlan = plans.find(
      plan => plan.relay === "wss://other-goal-hint.example.com/",
    )

    expect(plans.map(plan => plan.relay)).toEqual([
      "wss://goal-hint.example.com/",
      "wss://other-goal-hint.example.com/",
      "wss://relay.budabit.club/",
    ])
    expect(externalPlan?.filters).toEqual([{kinds: [ZAP_GOAL], ids: [goalEventId], limit: 1}])
    expect(otherExternalPlan?.filters).toEqual([
      {kinds: [ZAP_GOAL], ids: [otherGoalEventId], limit: 1},
    ])
    expect(communityPlan?.filters).toContainEqual({
      kinds: [ZAP_GOAL],
      ids: [goalEventId],
      limit: 1,
    })
    expect(communityPlan?.filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(true)
    expect(externalPlan?.filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(false)
  })

  it("chunks growing response ids into bounded finite filters", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      authorityDefinition,
      targetingEvents: [],
      admissionResponseIds: Array.from({length: 201}, (_, index) => `response-${index}`),
      reportEvents: [],
      moderatorRequests: [],
      moderatorRequestReactionEvents: [],
    })
    const responseFilters = filters.filter(filter => filter["#e"]?.[0]?.startsWith("response-"))

    expect(responseFilters.map(filter => filter["#e"]?.length)).toEqual([100, 100, 1])
  })
})
