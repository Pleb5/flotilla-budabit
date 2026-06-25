import {beforeEach, describe, expect, it, vi} from "vitest"
import {TARGETED_PUBLICATION_KIND, buildTargetedPublication} from "@app/core/community"
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
  getWidgetTargetPublishRelays,
  publishWidgetTargetingEvent,
} from "./widget-targeting"

const widgetPubkey = "a".repeat(64)
const communityPubkey = "b".repeat(64)
const secondCommunityPubkey = "c".repeat(64)

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
            pubkey: communityPubkey,
            relays: ["wss://community.example"],
            relayHints: ["wss://hint.example"],
          },
          {pubkey: secondCommunityPubkey, relays: ["wss://second.example"]},
        ],
        communityPubkeys: [secondCommunityPubkey, communityPubkey],
      }),
    ).toEqual(["wss://base.example/", "wss://second.example/", "wss://community.example/"])
  })

  it("keeps relay hints available for reads without using them for publishing", () => {
    const option = {
      pubkey: communityPubkey,
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
        communityPubkeys: [communityPubkey],
      }),
    ).toEqual(["wss://community.example/"])
  })

  it("rejects target communities without declared relays even when base relays exist", () => {
    expect(() =>
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [
          {
            pubkey: communityPubkey,
            label: "No Relay Community",
            relayHints: ["wss://hint.example"],
          },
        ],
        communityPubkeys: [communityPubkey],
      }),
    ).toThrow("Target communities must declare relays before publishing widgets: No Relay Community")
  })

  it("rejects unavailable target communities instead of publishing only to base relays", () => {
    expect(() =>
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [],
        communityPubkeys: [communityPubkey],
      }),
    ).toThrow("Target communities are not available for widget publishing")
  })

  it("extracts original and community relay hints from targeting events", () => {
    const event = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-weather",
        kind: SMART_WIDGET_KIND,
        ref: {
          type: "a",
          value: `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`,
          relay: "wss://widgets.example",
        },
        communities: [{pubkey: communityPubkey, relay: "wss://community.example"}],
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
        {pubkey: communityPubkey, relays: ["wss://community.example"]},
        {pubkey: secondCommunityPubkey, relays: ["wss://second.example"]},
      ],
      communityPubkeys: [communityPubkey, secondCommunityPubkey],
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
    expect(event).toMatchObject({kind: TARGETED_PUBLICATION_KIND, created_at: 123})
    expect(event.tags).toEqual([
      ["d", "target-weather"],
      ["a", `${SMART_WIDGET_KIND}:${widgetPubkey}:weather`, "wss://widgets.example/"],
      ["k", String(SMART_WIDGET_KIND)],
      ["p", communityPubkey],
      ["r", "wss://community.example/"],
      ["p", secondCommunityPubkey],
      ["r", "wss://second.example/"],
    ])
  })
})
