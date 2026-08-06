import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, THREAD, ZAP_GOAL, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  parseCommunityDefinition,
} from "./community"
import {
  buildCommunityFiniteFollowUpFilters,
  buildCommunityFiniteFollowUpRelayPlans,
  buildCommunityHistoricalDiscoveryFilters,
  buildCommunityLiveFilters,
} from "./community-live"

const communityPubkey = "a".repeat(64)
const listPubkey = "b".repeat(64)
const authorPubkey = "c".repeat(64)

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

const definition = parseCommunityDefinition(
  makeEvent({
    id: "definition",
    kind: COMMUNITY_DEFINITION_KIND,
    tags: [
      ["r", "wss://relay.budabit.club/"],
      ["content", "General"],
      ["k", "1111"],
      ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`],
      ["content", "Projects"],
      ["k", "30617"],
      ["a", `${PROFILE_LIST_KIND}:${listPubkey}:Projects`],
      ["content", "Calendar"],
      ["k", String(EVENT_TIME)],
      ["a", `${PROFILE_LIST_KIND}:${listPubkey}:Calendar`],
    ],
  }),
)!

const targetingEvent = makeEvent({
  id: "targeting-event",
  kind: TARGETED_PUBLICATION_KIND,
  tags: buildTargetedPublication({
    id: "calendar-target",
    kind: EVENT_TIME,
    ref: {type: "a", value: `${EVENT_TIME}:${authorPubkey}:calendar-event`},
    communities: [{pubkey: communityPubkey}],
  }).tags,
})

const goalTargetingEvent = makeEvent({
  id: "goal-targeting-event",
  kind: TARGETED_PUBLICATION_KIND,
  tags: buildTargetedPublication({
    id: "goal-target",
    kind: ZAP_GOAL,
    ref: {
      type: "e",
      value: "goal-event-id",
      relay: "wss://goal-hint.example.com/",
    },
    communities: [{pubkey: communityPubkey}],
  }).tags,
})

describe("community live filters", () => {
  it("discovers historical roots and calendar/goal targeting wrappers", () => {
    const filters = buildCommunityHistoricalDiscoveryFilters(communityPubkey)

    expect(filters).toEqual([
      {kinds: [THREAD], "#h": [communityPubkey]},
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#p": [communityPubkey],
        "#k": [String(EVENT_DATE), String(EVENT_TIME), String(ZAP_GOAL)],
      },
    ])
  })

  it("keeps the permanent subscription small and stable", () => {
    const filters = buildCommunityLiveFilters({
      definition,
      admissionFormAddresses: ["30168:moderator:admission"],
    })
    const profileFilters = filters.filter(filter => filter.kinds?.includes(PROFILE_LIST_KIND))

    expect(filters.length).toBeLessThanOrEqual(8)
    expect(filters.every(filter => filter.limit === 0)).toBe(true)
    expect(profileFilters).toHaveLength(2)
    expect(
      profileFilters.some(
        filter =>
          filter.authors?.includes(listPubkey) &&
          ["Calendar", "General", "Projects"].every(identifier =>
            filter["#d"]?.includes(identifier),
          ),
      ),
    ).toBe(true)
    expect(filters.some(filter => filter.ids?.includes("calendar-event"))).toBe(false)
  })

  it("moves exact originals and growing response ids to finite filters", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      definition,
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
    })
    expect(filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(true)
    expect(filters.every(filter => filter.limit !== 0)).toBe(true)
  })

  it("sends external relays only the exact originals they host", () => {
    const otherTargetingEvent = makeEvent({
      id: "other-targeting-event",
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "other-goal-target",
        kind: ZAP_GOAL,
        ref: {
          type: "e",
          value: "other-goal-event-id",
          relay: "wss://other-goal-hint.example.com/",
        },
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const plans = buildCommunityFiniteFollowUpRelayPlans({
      definition,
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
    expect(externalPlan?.filters).toEqual([{kinds: [ZAP_GOAL], ids: ["goal-event-id"]}])
    expect(otherExternalPlan?.filters).toEqual([{kinds: [ZAP_GOAL], ids: ["other-goal-event-id"]}])
    expect(communityPlan?.filters).toContainEqual({kinds: [ZAP_GOAL], ids: ["goal-event-id"]})
    expect(communityPlan?.filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(true)
    expect(externalPlan?.filters.some(filter => filter["#e"]?.includes("response-id"))).toBe(false)
  })

  it("chunks growing response ids into bounded finite filters", () => {
    const filters = buildCommunityFiniteFollowUpFilters({
      definition,
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
