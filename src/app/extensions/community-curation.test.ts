import {beforeEach, describe, expect, it, vi} from "vitest"
import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"

const mocks = vi.hoisted(() => ({
  loadCommunityEvents: vi.fn(),
}))

vi.mock("@app/core/community-state", async importOriginal => {
  const actual = await importOriginal<typeof import("@app/core/community-state")>()

  return {...actual, loadCommunityEvents: mocks.loadCommunityEvents}
})

import {loadCommunityCuratedWidgets} from "./community-curation"

const communityPubkey = "a".repeat(64)
const managerPubkey = "b".repeat(64)
const memberPubkey = "c".repeat(64)
const outsiderPubkey = "d".repeat(64)
const widgetPubkey = "e".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    ...overrides,
  }) as TrustedEvent

const makeTargetingEvent = ({
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
    tags: buildTargetedPublication({
      id,
      kind: SMART_WIDGET_KIND,
      ref: {
        type: "a",
        value: `${SMART_WIDGET_KIND}:${widgetPubkey}:${identifier}`,
        relay: "wss://widgets.example",
      },
      communities: [{pubkey: communityPubkey, relay: "wss://community.example"}],
    }).tags,
  })

const makeWidgetEvent = (identifier: string, pubkey = widgetPubkey) =>
  makeEvent({
    id: `widget-${identifier}`,
    pubkey,
    kind: SMART_WIDGET_KIND,
    content: identifier,
    tags: [
      ["d", identifier],
      ["l", "basic"],
      ["button", "Open", "app", "https://widgets.example/app"],
    ],
  })

describe("community curated widgets", () => {
  beforeEach(() => {
    mocks.loadCommunityEvents.mockReset()
  })

  it("loads only widgets targeted by valid, undeleted community writers", async () => {
    const definition = makeEvent({
      id: "community-definition",
      pubkey: communityPubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://community.example"],
        ["content", "Apps"],
        ["k", String(SMART_WIDGET_KIND)],
        ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Apps`],
      ],
    })
    const profileList = makeEvent({
      id: "apps-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", "Apps"],
        ["p", memberPubkey],
      ],
    })
    const validTarget = makeTargetingEvent({
      id: "target-valid",
      pubkey: memberPubkey,
      identifier: "valid-widget",
    })
    const unauthorizedTarget = makeTargetingEvent({
      id: "target-unauthorized",
      pubkey: outsiderPubkey,
      identifier: "unauthorized-widget",
    })
    const deletedTarget = makeTargetingEvent({
      id: "target-deleted",
      pubkey: managerPubkey,
      identifier: "deleted-widget",
    })
    const deleteEvent = makeEvent({
      id: "delete-target-deleted",
      pubkey: managerPubkey,
      kind: DELETE,
      tags: [["e", deletedTarget.id]],
    })
    const widgets = [
      makeWidgetEvent("valid-widget"),
      makeWidgetEvent("unauthorized-widget"),
      makeWidgetEvent("deleted-widget"),
    ]
    let calls = 0

    mocks.loadCommunityEvents.mockImplementation(async (_relays: string[], filters: Filter[]) => {
      calls += 1

      if (calls === 1) return [definition]
      if (calls === 2) return [profileList]
      if (calls === 3) return [validTarget, unauthorizedTarget, deletedTarget]
      if (calls === 4) return [deleteEvent]

      const identifiers = new Set(
        filters.flatMap(filter => (filter["#d"] as string[] | undefined) || []),
      )

      return widgets.filter(widget =>
        identifiers.has(widget.tags.find(tag => tag[0] === "d")?.[1] || ""),
      )
    })

    const result = await loadCommunityCuratedWidgets(communityPubkey)

    expect(result).toMatchObject({
      status: "community",
      communityPubkey,
      relayHints: ["wss://community.example/"],
      trustedWidgetAuthorPubkeys: [communityPubkey, managerPubkey],
    })
    expect(result.widgets.map(widget => widget.identifier)).toEqual(["valid-widget"])
    expect(mocks.loadCommunityEvents).toHaveBeenCalledTimes(5)
    expect(mocks.loadCommunityEvents.mock.calls[4][0]).toEqual([
      "wss://community.example/",
      "wss://widgets.example/",
    ])
  })

  it("falls back to widget profile-list owners when profile-list events are unavailable", async () => {
    const definition = makeEvent({
      id: "community-definition",
      pubkey: communityPubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ["r", "wss://community.example"],
        ["content", "Apps"],
        ["k", String(SMART_WIDGET_KIND)],
        ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Apps`],
      ],
    })
    const validTarget = makeTargetingEvent({
      id: "target-valid",
      pubkey: managerPubkey,
      identifier: "valid-widget",
    })
    const widget = makeWidgetEvent("valid-widget")
    let calls = 0

    mocks.loadCommunityEvents.mockImplementation(async (_relays: string[], filters: Filter[]) => {
      calls += 1

      if (calls === 1) return [definition]
      if (calls === 2) return []
      if (calls === 3) return [validTarget]
      if (calls === 4) return []

      const identifiers = new Set(
        filters.flatMap(filter => (filter["#d"] as string[] | undefined) || []),
      )

      return identifiers.has("valid-widget") ? [widget] : []
    })

    const result = await loadCommunityCuratedWidgets(communityPubkey)

    expect(result.widgets.map(item => item.identifier)).toEqual(["valid-widget"])
    expect(result.trustedWidgetAuthorPubkeys).toContain(managerPubkey)
  })
})
