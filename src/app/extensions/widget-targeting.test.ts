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

  it("publishes to base relays plus selected community relay hints", () => {
    expect(
      getWidgetTargetPublishRelays({
        baseRelays: ["wss://base.example"],
        communityOptions: [
          {pubkey: communityPubkey, relay: "wss://community.example"},
          {pubkey: secondCommunityPubkey, relays: ["wss://second.example"]},
        ],
        communityPubkeys: [secondCommunityPubkey, communityPubkey],
      }),
    ).toEqual(["wss://base.example/", "wss://second.example/", "wss://community.example/"])
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
        {pubkey: communityPubkey, relay: "wss://community.example"},
        {pubkey: secondCommunityPubkey, relay: "wss://second.example"},
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
