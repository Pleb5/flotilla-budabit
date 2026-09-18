import {beforeEach, describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  makeCommunityPointer,
  parseTargetedPublication,
} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import type {TrustedEvent} from "@welshman/util"

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  publishThunk: vi.fn(({event, relays}) => ({event, relays, complete: Promise.resolve()})),
}))

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  repository: {publish: mocks.publish},
}))

import {
  getWidgetAddress,
  getWidgetCommunityOptionRelayHints,
  getWidgetTargetEventRelayHints,
  getWidgetTargetCleanupPlan,
  getWidgetTargetPublishRelays,
  publishWidgetTargetingEvent,
} from "./widget-targeting"

const widgetPubkey = "a".repeat(64)
const firstCommunity = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(2)),
  communityId: getPublicKey(new Uint8Array(32).fill(3)),
  relayHints: ["wss://community.example"],
})!
const secondCommunity = makeCommunityPointer({
  ownerPubkey: getPublicKey(new Uint8Array(32).fill(4)),
  communityId: firstCommunity.communityId,
  relayHints: ["wss://second.example"],
})!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: widgetPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    ...overrides,
  }) as TrustedEvent

describe("widget targeting", () => {
  beforeEach(() => {
    mocks.publish.mockClear()
    mocks.publishThunk.mockClear()
  })

  it("builds widget addresses from author and identifier", () => {
    expect(getWidgetAddress({pubkey: widgetPubkey, identifier: "weather"})).toBe(
      `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`,
    )
    expect(getWidgetAddress({pubkey: "", identifier: "weather"})).toBe("")
  })

  it("publishes to base relays plus selected declared community relays", () => {
    expect(
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [
          {
            community: firstCommunity,
            relays: ["wss://community.example"],
            relayHints: ["wss://hint.example"],
          },
          {community: secondCommunity, relays: ["wss://second.example"]},
        ],
        communityAddresses: [secondCommunity.address, firstCommunity.address],
      }),
    ).toEqual(["wss://base.example/", "wss://second.example/", "wss://community.example/"])
  })

  it("keeps relay hints available for reads without using them for publishing", () => {
    const option = {
      community: firstCommunity,
      relays: ["wss://community.example"],
      relayHints: ["wss://hint.example"],
    }

    expect(getWidgetCommunityOptionRelayHints(option)).toEqual([
      "wss://hint.example/",
      "wss://community.example/",
    ])
    expect(
      getWidgetTargetPublishRelays({
        communityOptions: [option],
        communityAddresses: [firstCommunity.address],
      }),
    ).toEqual(["wss://community.example/"])
  })

  it("rejects target communities without declared relays even when base relays exist", () => {
    expect(() =>
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [
          {
            community: firstCommunity,
            label: "No Relay Community",
            relayHints: ["wss://hint.example"],
          },
        ],
        communityAddresses: [firstCommunity.address],
      }),
    ).toThrow(
      "Target communities must declare relays before publishing widgets: No Relay Community",
    )
  })

  it("rejects unavailable target communities instead of publishing only to base relays", () => {
    expect(() =>
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [],
        communityAddresses: [firstCommunity.address],
      }),
    ).toThrow("Target communities are not available for widget publishing")
  })

  it("extracts original and community relay hints from targeting events", () => {
    const event = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      content: "",
      tags: buildTargetedPublication({
        id: "target-weather",
        kind: SMART_WIDGET_KIND,
        source: {
          type: "a",
          value: `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`,
          relay: "wss://widgets.example",
        },
        communities: [firstCommunity],
      }).tags,
    })

    expect(getWidgetTargetEventRelayHints(event)).toEqual([
      "wss://widgets.example/",
      "wss://community.example/",
    ])
  })

  it("publishes a multi-community targeted publication for widgets", () => {
    const thunk = publishWidgetTargetingEvent({
      widget: {pubkey: widgetPubkey, identifier: "weather"},
      baseRelays: ["wss://base.example"],
      communityOptions: [
        {community: firstCommunity, relays: ["wss://community.example"]},
        {community: secondCommunity, relays: ["wss://second.example"]},
      ],
      communityAddresses: [firstCommunity.address, secondCommunity.address],
      originalRelay: "wss://widgets.example",
      targetingId: "target-weather",
      createdAt: 123,
    })

    expect(thunk).toBeTruthy()
    expect(mocks.publishThunk).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledOnce()

    const {event, relays} = mocks.publishThunk.mock.calls[0][0]

    expect(relays).toEqual([
      "wss://base.example/",
      "wss://community.example/",
      "wss://second.example/",
    ])
    expect(event).toMatchObject({kind: TARGETED_PUBLICATION_KIND, content: "", created_at: 123})
    expect(event.tags).toEqual([
      ["d", "target-weather"],
      ["a", `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`, "wss://widgets.example"],
      ["k", String(SMART_WIDGET_KIND)],
      ["h", firstCommunity.communityId],
      ["a", firstCommunity.address, "wss://community.example"],
      ["h", secondCommunity.communityId],
      ["a", secondCommunity.address, "wss://second.example"],
    ])
    const publishedEvent = event as TrustedEvent
    expect(
      parseTargetedPublication(publishedEvent)!.communities.map(community => community.address),
    ).toEqual([firstCommunity.address, secondCommunity.address])
    expect(publishedEvent.tags.some(tag => tag[0] === "p")).toBe(false)
  })

  it("preflights cleanup per old association, ignoring source and community hints", () => {
    const targets = [[firstCommunity], [secondCommunity], [firstCommunity, secondCommunity]].map(
      (communities, index) =>
        makeEvent({
          ...buildTargetedPublication({
            id: `old-${index}`,
            kind: SMART_WIDGET_KIND,
            source: {
              type: "a",
              value: `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`,
              relay: "wss://widget-host.example",
            },
            communities,
          }),
          kind: TARGETED_PUBLICATION_KIND,
        }),
    )
    const options = [
      {
        community: firstCommunity,
        relays: ["wss://current-first.example"],
        relayHints: ["wss://indexer.example"],
      },
      {community: secondCommunity, relays: ["wss://current-second.example"]},
    ]
    expect(getWidgetTargetCleanupPlan(targets, options).map(item => item.relays)).toEqual([
      ["wss://current-first.example/"],
      ["wss://current-second.example/"],
      ["wss://current-first.example/", "wss://current-second.example/"],
    ])
    expect(() => getWidgetTargetCleanupPlan(targets, options.slice(0, 1))).toThrow("not available")
    expect(() =>
      getWidgetTargetCleanupPlan(targets, [options[0], {...options[1], relays: []}]),
    ).toThrow("must declare relays")
  })
})
