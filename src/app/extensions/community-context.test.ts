import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  parseCommunityDefinition,
} from "@app/core/community"
import {
  makeAddressablePublicationRef,
  makeTargetedPublicationForCommunity,
} from "@app/core/community-targeting"
import {
  makeCommunityDescriptorQueryPlan,
  makeCommunityWidgetContext,
  resolveCommunityEventDescriptors,
} from "./community-context"

const communityPubkey = "a".repeat(64)
const calendarWriterPubkey = "b".repeat(64)
const outsiderPubkey = "c".repeat(64)

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
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "Events and meetups"],
      ["k", String(EVENT_TIME)],
      ["k", String(EVENT_DATE)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
    ],
  }),
)!

const calendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", "Events and meetups"],
    ["p", calendarWriterPubkey],
  ],
})

const makeCalendarTargetingEvent = ({
  id,
  pubkey,
  identifier,
}: {
  id: string
  pubkey: string
  identifier: string
}) =>
  makeEvent({
    id,
    pubkey,
    kind: TARGETED_PUBLICATION_KIND,
    tags: makeTargetedPublicationForCommunity({
      targetingId: id,
      originalKind: EVENT_TIME,
      originalRef: makeAddressablePublicationRef({
        kind: EVENT_TIME,
        pubkey,
        identifier,
        relay: "wss://relay.example.com/",
      }),
      communityPubkey,
      communityRelay: "wss://relay.example.com/",
    }).tags,
  })

describe("community widget context", () => {
  it("exposes community context without extension-facing write target taxonomy", () => {
    const context = makeCommunityWidgetContext({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarWriterPubkey,
      relays: ["wss://relay.example.com/"],
      relayHints: ["wss://relay.example.com/"],
    })

    expect(context.sections).toContainEqual({
      name: "Events and meetups",
      kinds: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    })
    expect(context.contextSessionId).toMatch(/^community-context-/)
    expect(context.contextVersion).toBe(0)
    expect(context).not.toHaveProperty("writeTargets")
  })

  it("resolves descriptor write capabilities from active sections without defaults", () => {
    const resolved = resolveCommunityEventDescriptors({
      definition,
      profileListEvents: [calendarProfileList],
      userPubkey: calendarWriterPubkey,
      descriptors: [{kind: EVENT_TIME}, {kind: EVENT_DATE}],
    })

    expect(resolved.map(info => info.capability)).toEqual([
      {
        descriptor: {kind: EVENT_TIME},
        sectionNames: ["Events and meetups"],
        writableSectionNames: ["Events and meetups"],
        canWrite: true,
      },
      {
        descriptor: {kind: EVENT_DATE},
        sectionNames: ["Events and meetups"],
        writableSectionNames: ["Events and meetups"],
        canWrite: true,
      },
    ])
  })

  it("errors when no active section supports a descriptor", () => {
    expect(() =>
      resolveCommunityEventDescriptors({
        definition,
        profileListEvents: [calendarProfileList],
        userPubkey: calendarWriterPubkey,
        descriptors: [{kind: 1}],
      }),
    ).toThrow("No active community section supports event descriptor 1")
  })

  it("builds calendar queries from descriptors and authorized writers", () => {
    const authorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-1",
      pubkey: calendarWriterPubkey,
      identifier: "event-1",
    })
    const unauthorizedTargetingEvent = makeCalendarTargetingEvent({
      id: "target-2",
      pubkey: outsiderPubkey,
      identifier: "event-2",
    })
    const plan = makeCommunityDescriptorQueryPlan({
      definition,
      profileListEvents: [calendarProfileList],
      descriptors: [{kind: EVENT_TIME}],
      targetingEvents: [authorizedTargetingEvent, unauthorizedTargetingEvent],
      limit: 5,
    })

    expect(plan.descriptors).toEqual([{kind: EVENT_TIME}])
    expect(plan.targetKinds).toEqual([EVENT_TIME])
    expect(plan.targetingFilter).toMatchObject({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#p": [communityPubkey],
      "#k": [String(EVENT_TIME)],
    })
    expect(plan.originalFilters).toEqual([
      {kinds: [EVENT_TIME], authors: [calendarWriterPubkey], "#d": ["event-1"], limit: 5},
    ])
  })
})
