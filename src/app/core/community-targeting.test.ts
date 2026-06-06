import {describe, expect, it} from "vitest"
import {EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  parseTargetedPublication,
} from "./community"
import {
  getPublicationTargetingId,
  makeAddressablePublicationRef,
  makeEventPublicationRef,
  makeTargetedPublicationForCommunity,
  removeCommunityTarget,
  shouldTargetPublicationKind,
  upsertCommunityTarget,
  withPublicationTargetingId,
} from "./community-targeting"

const authorPubkey = "a".repeat(64)
const communityPubkey = "b".repeat(64)
const otherCommunityPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: authorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community targeting helpers", () => {
  it("knows which kinds are targeted publications", () => {
    expect(shouldTargetPublicationKind(EVENT_TIME)).toBe(true)
    expect(shouldTargetPublicationKind(31922)).toBe(false)
    expect(shouldTargetPublicationKind(9041)).toBe(true)
    expect(shouldTargetPublicationKind(30617)).toBe(true)
    expect(shouldTargetPublicationKind(1623)).toBe(true)
    expect(shouldTargetPublicationKind(30033)).toBe(true)
    expect(shouldTargetPublicationKind(11)).toBe(false)
  })

  it("adds stable h targeting ids to original publication templates", () => {
    const template = withPublicationTargetingId(
      {
        content: "Event",
        tags: [
          ["h", "old"],
          ["title", "Demo"],
        ],
      },
      "target-id",
    )

    expect(template).toEqual({
      content: "Event",
      tags: [
        ["h", "target-id"],
        ["title", "Demo"],
      ],
      targetingId: "target-id",
    })
    expect(getPublicationTargetingId(template)).toBe("target-id")
  })

  it("builds publication refs", () => {
    expect(
      makeAddressablePublicationRef({
        kind: EVENT_TIME,
        pubkey: authorPubkey,
        identifier: "calendar-1",
        relay: "wss://relay.example.com/",
      }),
    ).toEqual({
      type: "a",
      value: `${EVENT_TIME}:${authorPubkey}:calendar-1`,
      relay: "wss://relay.example.com/",
    })
    expect(makeEventPublicationRef({id: "event-id", relay: "wss://relay.example.com/"})).toEqual({
      type: "e",
      value: "event-id",
      relay: "wss://relay.example.com/",
      pubkey: undefined,
    })
  })

  it("builds targeting events for one community", () => {
    expect(
      makeTargetedPublicationForCommunity({
        targetingId: "target-id",
        originalKind: EVENT_TIME,
        originalRef: {type: "a", value: `${EVENT_TIME}:${authorPubkey}:calendar-1`},
        communityPubkey,
        communityRelay: "wss://community.example.com/",
      }),
    ).toEqual({
      content: "",
      tags: [
        ["d", "target-id"],
        ["a", `${EVENT_TIME}:${authorPubkey}:calendar-1`],
        ["k", String(EVENT_TIME)],
        ["p", communityPubkey],
        ["r", "wss://community.example.com/"],
      ],
    })
  })

  it("upserts and removes community targets", () => {
    const targetingEvent = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-id",
        kind: 9041,
        ref: {type: "e", value: "goal-event-id"},
        communities: [{pubkey: communityPubkey, relay: "wss://old.example.com/"}],
      }).tags,
    })

    const upserted = upsertCommunityTarget(targetingEvent, {
      pubkey: otherCommunityPubkey,
      relay: "wss://new.example.com/",
    })!
    expect(
      parseTargetedPublication(makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: upserted.tags})),
    ).toMatchObject({
      communities: [
        {pubkey: communityPubkey, relay: "wss://old.example.com/"},
        {pubkey: otherCommunityPubkey, relay: "wss://new.example.com/"},
      ],
    })

    const removed = removeCommunityTarget(
      makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: upserted.tags}),
      communityPubkey,
    )!
    expect(
      parseTargetedPublication(makeEvent({kind: TARGETED_PUBLICATION_KIND, tags: removed.tags})),
    ).toMatchObject({
      communities: [{pubkey: otherCommunityPubkey, relay: "wss://new.example.com/"}],
    })
  })
})
