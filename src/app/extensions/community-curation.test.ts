import {beforeEach, describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {DELETE, matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {repository} from "@welshman/app"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  buildTargetedPublication,
  makeCommunityPointer,
} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

const mocks = vi.hoisted(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  })

  return {loadBoundedCommunityHistory: vi.fn(), loadCommunityEventsWithStatus: vi.fn()}
})

vi.mock("@app/core/community-state", async importOriginal => {
  const actual = await importOriginal<typeof import("@app/core/community-state")>()

  return {...actual, loadCommunityEventsWithStatus: mocks.loadCommunityEventsWithStatus}
})

vi.mock("@app/core/requests", () => ({
  loadBoundedCommunityHistory: mocks.loadBoundedCommunityHistory,
}))

import {loadCommunityCuratedWidgets} from "./community-curation"
import {
  clearCommunityWidgetRecommendationContexts,
  getCommunityWidgetRecommendationContexts,
  makeCommunityWidgetPreviewContextOptions,
  makeCommunityWidgetRuntimeContext,
} from "./recommendation-context"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = key(121)
const managerPubkey = key(122)
const memberPubkey = key(123)
const outsiderPubkey = key(124)
const widgetPubkey = key(125)
const community = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: communityPubkey,
  relayHints: ["wss://community.example"],
})!

const loadResult = (events: TrustedEvent[], complete = true) => ({
  events,
  complete,
  timedOutRelays: complete ? [] : ["wss://community.example/"],
  failedRelays: [],
})

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
      source: {
        type: "a",
        value: `${SMART_WIDGET_KIND}:${widgetPubkey}:${identifier}`,
        relay: "wss://widgets.example",
      },
      communities: [community],
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

const appsListIdentifier = `${community.communityId}-apps`

const makeDefinition = () =>
  makeEvent({
    id: "community-definition",
    pubkey: communityPubkey,
    kind: COMMUNITY_DEFINITION_KIND,
    content: "",
    tags: buildCommunityDefinition({
      communityId: community.communityId,
      name: "Test community",
      relays: ["wss://community.example"],
      sections: [
        {
          name: "Apps",
          kinds: [{kind: SMART_WIDGET_KIND}],
          profileLists: [{address: `${PROFILE_LIST_KIND}:${managerPubkey}:${appsListIdentifier}`}],
        },
      ],
    }).tags,
  })

describe("community curated widgets", () => {
  beforeEach(() => {
    mocks.loadCommunityEventsWithStatus.mockReset()
    mocks.loadBoundedCommunityHistory.mockReset()
    mocks.loadBoundedCommunityHistory.mockImplementation(
      async ({relays, relayFilters, localFilters}: any) => {
        const result = await mocks.loadCommunityEventsWithStatus(relays, relayFilters)

        return {
          events: result.events.filter((event: TrustedEvent) => matchFilters(localFilters, event)),
          complete: result.complete,
          timedOut: result.timedOutRelays.length > 0,
          saturated: false,
        }
      },
    )
    clearCommunityWidgetRecommendationContexts()
  })

  it("uses interactive priority by default and forwards an explicit priority", async () => {
    const definition = makeEvent({
      id: "community-definition",
      pubkey: communityPubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [],
    })
    mocks.loadCommunityEventsWithStatus.mockResolvedValue(loadResult([definition]))

    await loadCommunityCuratedWidgets(community.naddr)

    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({priority: RELAY_REQUEST_PRIORITY.interactive}),
    )

    mocks.loadCommunityEventsWithStatus.mockClear()
    await loadCommunityCuratedWidgets(community.naddr, {
      priority: RELAY_REQUEST_PRIORITY.background,
    })

    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({priority: RELAY_REQUEST_PRIORITY.background}),
    )
  })

  it("loads only widgets targeted by valid, undeleted community writers", async () => {
    const definition = makeDefinition()
    const profileList = makeEvent({
      id: "apps-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", appsListIdentifier],
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
      tags: [["a", `30222:${managerPubkey}:${deletedTarget.tags.find(tag => tag[0] === "d")![1]}`]],
    })
    const widgets = [
      makeWidgetEvent("valid-widget"),
      makeWidgetEvent("unauthorized-widget"),
      makeWidgetEvent("deleted-widget"),
    ]
    let calls = 0

    mocks.loadCommunityEventsWithStatus.mockImplementation(
      async (_relays: string[], _filters: Filter[]) => {
        calls += 1

        if (calls === 1) return loadResult([definition])
        if (calls === 2) return loadResult([profileList])
        if (calls === 3) return loadResult([validTarget, unauthorizedTarget, deletedTarget])
        if (calls === 4) return loadResult([deleteEvent])

        return loadResult(widgets)
      },
    )

    const result = await loadCommunityCuratedWidgets(community.naddr)

    expect(result).toMatchObject({
      status: "community",
      community: {address: community.address, naddr: community.naddr},
      relayHints: ["wss://community.example/"],
      trustedWidgetAuthorPubkeys: [communityPubkey, managerPubkey],
    })
    expect(result.widgets.map(widget => widget.identifier)).toEqual(["valid-widget"])
    const contexts = getCommunityWidgetRecommendationContexts(
      `${SMART_WIDGET_KIND}:${widgetPubkey}:valid-widget`,
    )
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      community: {address: community.address},
      relays: ["wss://community.example/"],
      relayHints: ["wss://community.example/", "wss://widgets.example/"],
      trustedWidgetAuthorPubkeys: [communityPubkey, managerPubkey],
      targetingEventIds: ["target-valid"],
      targetingRelayHints: ["wss://widgets.example/"],
    })
    expect(contexts[0].definition.ownerPubkey).toBe(communityPubkey)
    expect(contexts[0].profileListEvents).toEqual([profileList])
    expect(contexts[0].widgetTargetAuthorPubkeys).toContain(memberPubkey)
    expect(
      makeCommunityWidgetRuntimeContext(contexts[0], {userPubkey: memberPubkey}),
    ).toMatchObject({
      relays: ["wss://community.example/"],
      communityContext: {
        version: 2,
        definitionAddress: community.address,
        naddr: community.naddr,
        relayHints: ["wss://community.example/", "wss://widgets.example/"],
        viewer: {pubkey: memberPubkey},
      },
    })
    expect(
      makeCommunityWidgetPreviewContextOptions({
        widgetLineId: `${SMART_WIDGET_KIND}:${widgetPubkey}:valid-widget`,
        userPubkey: memberPubkey,
        getLabel: context => `Community ${context.community.ownerPubkey.slice(0, 4)}`,
      }),
    ).toMatchObject([
      {
        id: community.address,
        community: {address: community.address},
        label: `Community ${communityPubkey.slice(0, 4)}`,
        runtimeContext: {
          relays: ["wss://community.example/"],
          communityContext: {
            version: 2,
            definitionAddress: community.address,
            naddr: community.naddr,
            viewer: {pubkey: memberPubkey},
          },
        },
      },
    ])
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(5)
    expect(mocks.loadCommunityEventsWithStatus.mock.calls[4][0]).toEqual([
      "wss://community.example/",
      "wss://widgets.example/",
    ])
    expect(mocks.loadCommunityEventsWithStatus.mock.calls[4][1]).toEqual([
      {
        kinds: [SMART_WIDGET_KIND],
        authors: [widgetPubkey],
        "#d": ["valid-widget"],
        limit: 1,
      },
    ])
  })

  it("parses and publishes authorized widget candidates in bounded slices", async () => {
    const definition = makeDefinition()
    const profileList = makeEvent({
      id: "batched-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", appsListIdentifier],
        ["p", memberPubkey],
      ],
    })
    const targets = Array.from({length: 10}, (_, index) =>
      makeTargetingEvent({
        id: `batched-target-${index}`,
        pubkey: memberPubkey,
        identifier: `batched-widget-${index}`,
      }),
    )
    const widgets = Array.from({length: 10}, (_, index) =>
      makeWidgetEvent(`batched-widget-${index}`),
    )
    let calls = 0
    mocks.loadCommunityEventsWithStatus.mockImplementation(async () => {
      calls += 1
      if (calls === 1) return loadResult([definition])
      if (calls === 2) return loadResult([profileList])
      if (calls === 3) return loadResult(targets)
      if (calls === 4) return loadResult([])
      return loadResult(widgets)
    })
    const yieldTask = vi.fn(async () => undefined)
    const progressive: string[][] = []

    const result = await loadCommunityCuratedWidgets(community.naddr, {
      batchSize: 3,
      yieldTask,
      onWidgets: candidates => progressive.push(candidates.map(widget => widget.identifier)),
    })

    expect(result.widgets).toHaveLength(10)
    expect(yieldTask.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(progressive.map(items => items.length)).toEqual([3, 6, 9, 10])
  })

  it("cancels obsolete curation before targeting and widget projection", async () => {
    const controller = new AbortController()
    mocks.loadCommunityEventsWithStatus.mockResolvedValue(loadResult([makeDefinition()]))
    const onWidgets = vi.fn()

    await expect(
      loadCommunityCuratedWidgets(community.naddr, {
        signal: controller.signal,
        onWidgets,
        yieldTask: async () => controller.abort(),
      }),
    ).rejects.toMatchObject({name: "AbortError"})
    expect(mocks.loadBoundedCommunityHistory).not.toHaveBeenCalled()
    expect(onWidgets).not.toHaveBeenCalled()
  })

  it("keeps pending widget-list owners as writers without trusting them as moderators", async () => {
    const definition = makeDefinition()
    const validTarget = makeTargetingEvent({
      id: "target-valid",
      pubkey: managerPubkey,
      identifier: "valid-widget",
    })
    const widget = makeWidgetEvent("valid-widget")
    let calls = 0

    mocks.loadCommunityEventsWithStatus.mockImplementation(
      async (_relays: string[], filters: Filter[]) => {
        calls += 1

        if (calls === 1) return loadResult([definition])
        if (calls === 2) return loadResult([])
        if (calls === 3) return loadResult([validTarget])
        if (calls === 4) return loadResult([])

        const identifiers = new Set(
          filters.flatMap(filter => (filter["#d"] as string[] | undefined) || []),
        )

        return loadResult(identifiers.has("valid-widget") ? [widget] : [])
      },
    )

    const result = await loadCommunityCuratedWidgets(community.naddr)

    expect(result.widgets.map(item => item.identifier)).toEqual(["valid-widget"])
    expect(result.trustedWidgetAuthorPubkeys).not.toContain(managerPubkey)
    expect(result.trustedWidgetAuthorPubkeys).toContain(communityPubkey)
  })

  it("rejects a broad implicit widget result signed by someone other than the wrapper", async () => {
    const definition = makeDefinition()
    const profileList = makeEvent({
      id: "apps-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", appsListIdentifier],
        ["p", memberPubkey],
      ],
    })
    const targeting = makeEvent({
      id: "implicit-target",
      pubkey: memberPubkey,
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "implicit-widget-id",
        kind: SMART_WIDGET_KIND,
        communities: [community],
      }).tags,
    })
    const wrongSignerWidget = makeWidgetEvent("implicit-widget", widgetPubkey)
    wrongSignerWidget.tags.push(["h", "implicit-widget-id"])
    let calls = 0

    mocks.loadCommunityEventsWithStatus.mockImplementation(async () => {
      calls += 1
      if (calls === 1) return loadResult([definition])
      if (calls === 2) return loadResult([profileList])
      if (calls === 3) return loadResult([targeting])
      if (calls === 4) return loadResult([])

      return loadResult([wrongSignerWidget])
    })

    const result = await loadCommunityCuratedWidgets(community.naddr)

    expect(result.widgets).toEqual([])
    expect(mocks.loadCommunityEventsWithStatus.mock.calls[4][1]).toEqual([
      {
        kinds: [SMART_WIDGET_KIND],
        authors: [memberPubkey],
        "#h": ["implicit-widget-id"],
        limit: 1,
      },
    ])
  })

  it("returns incomplete targets for a background slot retry", async () => {
    const definition = makeDefinition()
    const profileList = makeEvent({
      id: "apps-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", appsListIdentifier],
        ["p", memberPubkey],
      ],
    })
    let targetingLoads = 0

    mocks.loadCommunityEventsWithStatus.mockImplementation(
      async (_relays: string[], filters: Filter[]) => {
        if (filters.some(filter => filter.kinds?.includes(COMMUNITY_DEFINITION_KIND))) {
          return loadResult([definition])
        }
        if (filters.some(filter => filter.kinds?.includes(PROFILE_LIST_KIND))) {
          return loadResult([profileList])
        }
        if (filters.some(filter => filter.kinds?.includes(TARGETED_PUBLICATION_KIND))) {
          targetingLoads += 1

          return loadResult([], false)
        }
        if (filters.some(filter => filter.kinds?.includes(DELETE))) return loadResult([])

        return loadResult([])
      },
    )

    const result = await loadCommunityCuratedWidgets(community.naddr)

    expect(targetingLoads).toBe(1)
    expect(result.complete).toBe(false)
    expect(result.widgets).toEqual([])
  })

  it("does not let a cached outsider wrapper complete the admitted wrapper load", async () => {
    const definition = makeDefinition()
    const profileList = makeEvent({
      id: "apps-profile-list",
      pubkey: managerPubkey,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", appsListIdentifier],
        ["p", memberPubkey],
      ],
    })
    const cachedOutsider = makeTargetingEvent({
      id: "cached-outsider-target",
      pubkey: outsiderPubkey,
      identifier: "outsider-widget",
    })
    let targetingLoads = 0
    repository.publish(cachedOutsider)

    try {
      mocks.loadCommunityEventsWithStatus.mockImplementation(
        async (_relays: string[], filters: Filter[]) => {
          if (filters.some(filter => filter.kinds?.includes(COMMUNITY_DEFINITION_KIND))) {
            return loadResult([definition])
          }
          if (filters.some(filter => filter.kinds?.includes(PROFILE_LIST_KIND))) {
            return loadResult([profileList])
          }
          if (filters.some(filter => filter.kinds?.includes(TARGETED_PUBLICATION_KIND))) {
            targetingLoads += 1
            return loadResult([], false)
          }

          return loadResult([])
        },
      )

      const result = await loadCommunityCuratedWidgets(community.naddr)

      expect(targetingLoads).toBe(1)
      expect(result.complete).toBe(false)
      expect(result.widgets).toEqual([])
    } finally {
      repository.removeEvent(cachedOutsider.id)
    }
  })
})
