import {beforeEach, describe, expect, it, vi} from "vitest"
import {pubkey} from "@welshman/app"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import type {CommunityCuratedExtensionsResult} from "./community-curation"
import {
  COMMUNITY_SHARED_CONFIG_KIND,
  COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS,
  clearCommunityWidgetSlotCache,
  getEnabledCommunitySlotWidgetsWithSharedConfig,
  getEnabledCommunitySlotWidgets,
  getEnabledInstalledCommunitySlotWidgets,
  getLastValidatedCommunityCuratedWidgets,
  loadCachedCommunityCuratedWidgets,
  shouldPreserveCuratedWidgetView,
} from "./community-widget-slots"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "./types"
import {getWidgetLineId} from "./widget-identity"

const mocks = vi.hoisted(() => ({
  loadCommunityCuratedWidgets: vi.fn(),
}))

vi.mock("./community-curation", () => ({
  loadCommunityCuratedWidgets: mocks.loadCommunityCuratedWidgets,
}))

const makeWidget = (
  identifier: string,
  slotType?: WidgetCommunitySlotType,
  label = identifier,
  pubkey = "a".repeat(64),
  created_at = 1,
  overrides: Partial<SmartWidgetEvent> = {},
): SmartWidgetEvent => ({
  id: identifier,
  kind: 30033,
  content: identifier,
  pubkey,
  created_at,
  tags: [["d", identifier]],
  identifier,
  widgetType: "basic",
  buttons: [],
  slot: slotType ? {type: slotType, label} : undefined,
  ...overrides,
})

const makeCuratedResult = (
  widgets: SmartWidgetEvent[] = [],
  complete = true,
): CommunityCuratedExtensionsResult => ({
  status: "community",
  complete,
  relayHints: [],
  trustedWidgetAuthorPubkeys: [],
  widgets,
})

describe("community widget slots", () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.loadCommunityCuratedWidgets.mockReset()
    clearCommunityWidgetSlotCache()
    pubkey.set(undefined)
  })

  it("selects installed and enabled widgets for a community slot", () => {
    const curated = [
      makeWidget("message-widget", "chat-message-actions", "Message tools"),
      makeWidget("global-widget", "global-menu"),
      makeWidget("disabled-widget", "chat-message-actions"),
      makeWidget("missing-installed", "chat-message-actions"),
    ]
    const installed = {
      [getWidgetLineId(curated[0])]: makeWidget("message-widget"),
      [getWidgetLineId(curated[1])]: makeWidget("global-widget"),
      [getWidgetLineId(curated[2])]: makeWidget("disabled-widget"),
    }

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: curated,
      installedWidgets: installed,
      enabledIds: new Set([
        getWidgetLineId(curated[0]),
        getWidgetLineId(curated[1]),
        getWidgetLineId(curated[3]),
      ]),
      slotType: "chat-message-actions",
    })

    expect(selected.map(widget => widget.identifier)).toEqual(["message-widget"])
    expect(selected[0].slot).toEqual({type: "chat-message-actions", label: "Message tools"})
  })

  it("keeps same-d widgets from different publishers separate", () => {
    const first = makeWidget("weather", "global-menu", "Weather A", "a".repeat(64))
    const second = makeWidget("weather", "global-menu", "Weather B", "b".repeat(64))
    const firstId = getWidgetLineId(first)
    const secondId = getWidgetLineId(second)

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: [first, second],
      installedWidgets: {
        [firstId]: {...first, content: "Installed A"},
        [secondId]: {...second, content: "Installed B"},
      },
      enabledIds: new Set([secondId]),
      slotType: "global-menu",
    })

    expect(selected.map(widget => widget.content)).toEqual(["Installed B"])
    expect(selected[0].slot).toEqual({type: "global-menu", label: "Weather B"})
  })

  it("matches legacy installed and enabled widget identifiers to curated line ids", () => {
    const curated = makeWidget("featured-calendar-event", "community-home-after-quicklinks")
    const installed = {...curated, content: "Installed calendar widget"}

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: [curated],
      installedWidgets: {
        [curated.identifier]: installed,
      },
      enabledIds: new Set([curated.identifier]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected.map(widget => widget.content)).toEqual(["Installed calendar widget"])
    expect(selected[0].slot).toEqual({
      type: "community-home-after-quicklinks",
      label: "featured-calendar-event",
    })
  })

  it("uses newer installed metadata over stale curated metadata", () => {
    const curated = {
      ...makeWidget(
        "featured-calendar-event",
        "community-home-after-quicklinks",
        "Featured event",
        "a".repeat(64),
        10,
      ),
      version: "0.1.4",
    }
    const installed = {
      ...makeWidget("featured-calendar-event", undefined, "Featured event", "a".repeat(64), 20),
      version: "0.1.5",
    }
    const widgetId = getWidgetLineId(curated)

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: [curated],
      installedWidgets: {[widgetId]: installed},
      enabledIds: new Set([widgetId]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected[0].version).toBe("0.1.5")
    expect(selected[0].slot).toEqual({
      type: "community-home-after-quicklinks",
      label: "Featured event",
    })
  })

  it("does not use ambiguous legacy identifiers for different publishers", () => {
    const first = makeWidget(
      "weather",
      "community-home-after-quicklinks",
      "Weather A",
      "a".repeat(64),
    )
    const second = makeWidget(
      "weather",
      "community-home-after-quicklinks",
      "Weather B",
      "b".repeat(64),
    )

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: [first, second],
      installedWidgets: {
        "weather-a": first,
        "weather-b": second,
      },
      enabledIds: new Set(["weather"]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected).toEqual([])
  })

  it("does not select an installed widget without community curation", () => {
    const widget = makeWidget("featured-calendar-event", "community-home-after-quicklinks")
    const widgetId = getWidgetLineId(widget)

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: [],
      installedWidgets: {[widgetId]: widget},
      enabledIds: new Set([widgetId]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected).toEqual([])
  })

  it("selects enabled installed community slot widget candidates", () => {
    const slotWidget = makeWidget("featured-calendar-event", "community-home-after-quicklinks")
    const otherSlotWidget = makeWidget("header-widget", "community-home-before-quicklinks")
    const disabledSlotWidget = makeWidget("disabled-widget", "community-home-after-quicklinks")

    const selected = getEnabledInstalledCommunitySlotWidgets({
      installedWidgets: {
        [getWidgetLineId(slotWidget)]: slotWidget,
        [getWidgetLineId(otherSlotWidget)]: otherSlotWidget,
        [getWidgetLineId(disabledSlotWidget)]: disabledSlotWidget,
      },
      enabledIds: new Set([getWidgetLineId(slotWidget), getWidgetLineId(otherSlotWidget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected.map(widget => widget.identifier)).toEqual(["featured-calendar-event"])
  })

  it("keeps a validated widget view through incomplete same-community refreshes", () => {
    const widget = makeWidget("community-stream", "community-home-before-quicklinks")

    expect(shouldPreserveCuratedWidgetView([widget], [], true, false)).toBe(true)
    expect(shouldPreserveCuratedWidgetView([widget], [], false, false)).toBe(false)
    expect(shouldPreserveCuratedWidgetView([widget], [widget], true, false)).toBe(false)
    expect(shouldPreserveCuratedWidgetView([widget], [], true, true)).toBe(false)
  })

  it("selects enabled installed slot widgets with cached shared config", () => {
    const communityPubkey = "c".repeat(64)
    const widget = makeWidget(
      "featured-calendar-event",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      undefined,
      {permissions: ["community:querySharedConfig"]},
    )
    const unrelatedWidget = makeWidget(
      "weather",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      undefined,
      {permissions: ["community:querySharedConfig"]},
    )
    const sharedConfigEvent = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      pubkey: communityPubkey,
      tags: [
        [
          "d",
          `budabit-community-config:${communityPubkey}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["p", communityPubkey],
        ["namespace", "budabit-calendar-widget"],
        ["key", "featured-calendar-event"],
      ],
    }

    const selected = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityPubkey,
      sharedConfigEvents: [sharedConfigEvent],
      authorizedPubkeys: new Set([communityPubkey]),
      installedWidgets: {
        [getWidgetLineId(widget)]: widget,
        [getWidgetLineId(unrelatedWidget)]: unrelatedWidget,
      },
      enabledIds: new Set([getWidgetLineId(widget), getWidgetLineId(unrelatedWidget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected.map(item => item.identifier)).toEqual(["featured-calendar-event"])

    const unauthorized = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityPubkey,
      sharedConfigEvents: [{...sharedConfigEvent, pubkey: "e".repeat(64)}],
      authorizedPubkeys: new Set([communityPubkey]),
      installedWidgets: {[getWidgetLineId(widget)]: widget},
      enabledIds: new Set([getWidgetLineId(widget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(unauthorized).toEqual([])

    const unrelatedCommunity = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityPubkey: "d".repeat(64),
      sharedConfigEvents: [sharedConfigEvent],
      authorizedPubkeys: new Set([communityPubkey]),
      installedWidgets: {
        [getWidgetLineId(widget)]: widget,
        [getWidgetLineId(unrelatedWidget)]: unrelatedWidget,
      },
      enabledIds: new Set([getWidgetLineId(widget), getWidgetLineId(unrelatedWidget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(unrelatedCommunity).toEqual([])
  })

  it("reuses cached curated widget loads while they are fresh", async () => {
    const widget = makeWidget("featured-calendar-event", "community-home-after-quicklinks")
    mocks.loadCommunityCuratedWidgets.mockResolvedValueOnce(makeCuratedResult([widget]))

    const first = loadCachedCommunityCuratedWidgets("community-a")
    const second = loadCachedCommunityCuratedWidgets(" community-a ")

    expect(second).toBe(first)
    await expect(first).resolves.toMatchObject({widgets: [widget]})
    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [widget],
    })
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(1)
  })

  it("reloads when relay hints change while preserving the validated snapshot", async () => {
    const pubkey = "d".repeat(64)
    const firstInput = `ncommunity://${pubkey}?relay=${encodeURIComponent("wss://one.example/")}`
    const secondInput = `ncommunity://${pubkey}?relay=${encodeURIComponent("wss://two.example/")}`
    const widget = makeWidget("community-stream", "community-home-before-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([widget]))
      .mockResolvedValueOnce(makeCuratedResult([], false))

    await loadCachedCommunityCuratedWidgets(firstInput)
    await loadCachedCommunityCuratedWidgets(secondInput)

    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(2)
    expect(getLastValidatedCommunityCuratedWidgets(secondInput)).toEqual([widget])
  })

  it("retains the last validated widget snapshot across slot remounts", async () => {
    const widget = makeWidget("community-stream", "community-home-before-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([widget]))
      .mockResolvedValueOnce(makeCuratedResult([], false))

    await loadCachedCommunityCuratedWidgets("community-a")
    expect(getLastValidatedCommunityCuratedWidgets("community-a")).toEqual([widget])

    await loadCachedCommunityCuratedWidgets("community-a", {force: true})
    expect(getLastValidatedCommunityCuratedWidgets("community-a")).toEqual([widget])
  })

  it("keeps validated widget snapshots isolated by community", async () => {
    const firstCommunity = "a".repeat(64)
    const secondCommunity = "b".repeat(64)
    const widget = makeWidget("community-stream", "community-home-before-quicklinks")
    mocks.loadCommunityCuratedWidgets.mockResolvedValueOnce(makeCuratedResult([widget]))

    await loadCachedCommunityCuratedWidgets(firstCommunity)

    expect(getLastValidatedCommunityCuratedWidgets(firstCommunity)).toEqual([widget])
    expect(getLastValidatedCommunityCuratedWidgets(secondCommunity)).toEqual([])
  })

  it("deduplicates a forced refresh while a load is pending", async () => {
    let resolveLoad: (result: CommunityCuratedExtensionsResult) => void = () => {}
    const pendingResult = new Promise<CommunityCuratedExtensionsResult>(resolve => {
      resolveLoad = resolve
    })
    mocks.loadCommunityCuratedWidgets.mockReturnValueOnce(pendingResult)

    const first = loadCachedCommunityCuratedWidgets("community-a")
    const forced = loadCachedCommunityCuratedWidgets("community-a", {force: true})

    expect(forced).toBe(first)
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(1)
    resolveLoad(makeCuratedResult())
    await first
  })

  it("upgrades a pending background load for an interactive caller", async () => {
    let resolveBackground: (result: CommunityCuratedExtensionsResult) => void = () => {}
    let resolveInteractive: (result: CommunityCuratedExtensionsResult) => void = () => {}
    const backgroundResult = new Promise<CommunityCuratedExtensionsResult>(resolve => {
      resolveBackground = resolve
    })
    const interactiveResult = new Promise<CommunityCuratedExtensionsResult>(resolve => {
      resolveInteractive = resolve
    })
    mocks.loadCommunityCuratedWidgets
      .mockReturnValueOnce(backgroundResult)
      .mockReturnValueOnce(interactiveResult)

    const background = loadCachedCommunityCuratedWidgets("community-a", {
      priority: RELAY_REQUEST_PRIORITY.background,
    })
    const interactive = loadCachedCommunityCuratedWidgets("community-a", {
      priority: RELAY_REQUEST_PRIORITY.interactive,
    })
    const duplicateInteractive = loadCachedCommunityCuratedWidgets("community-a", {
      priority: RELAY_REQUEST_PRIORITY.interactive,
    })

    expect(interactive).not.toBe(background)
    expect(duplicateInteractive).toBe(interactive)
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenNthCalledWith(1, "community-a", {
      priority: RELAY_REQUEST_PRIORITY.background,
    })
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenNthCalledWith(2, "community-a", {
      priority: RELAY_REQUEST_PRIORITY.interactive,
    })

    resolveBackground(makeCuratedResult())
    resolveInteractive(makeCuratedResult())
    await Promise.all([background, interactive])
  })

  it("isolates curated widget caches and snapshots by viewer", async () => {
    const firstWidget = makeWidget("first-viewer")
    const secondWidget = makeWidget("second-viewer")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([firstWidget]))
      .mockResolvedValueOnce(makeCuratedResult([secondWidget]))

    pubkey.set("1".repeat(64))
    await loadCachedCommunityCuratedWidgets("community-a")
    expect(getLastValidatedCommunityCuratedWidgets("community-a")).toEqual([firstWidget])

    pubkey.set("2".repeat(64))
    expect(getLastValidatedCommunityCuratedWidgets("community-a")).toEqual([])
    await loadCachedCommunityCuratedWidgets("community-a")
    expect(getLastValidatedCommunityCuratedWidgets("community-a")).toEqual([secondWidget])
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(2)
  })

  it("does not negative-cache incomplete empty results", async () => {
    const widget = makeWidget("recovered-widget", "community-home-after-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([], false))
      .mockResolvedValueOnce(makeCuratedResult([widget]))

    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [],
      complete: false,
    })
    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [widget],
    })
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(2)
  })

  it("force refresh bypasses fresh curated widget cache entries", async () => {
    const firstWidget = makeWidget("first-widget", "community-home-after-quicklinks")
    const secondWidget = makeWidget("second-widget", "community-home-after-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([firstWidget]))
      .mockResolvedValueOnce(makeCuratedResult([secondWidget]))

    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [firstWidget],
    })
    await expect(
      loadCachedCommunityCuratedWidgets("community-a", {force: true}),
    ).resolves.toMatchObject({widgets: [secondWidget]})

    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(2)
  })

  it("expires empty curated widget cache entries quickly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const widget = makeWidget("recovered-widget", "community-home-after-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult())
      .mockResolvedValueOnce(makeCuratedResult([widget]))

    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [],
    })

    vi.setSystemTime(COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS - 1)
    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [],
    })
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(1)

    vi.setSystemTime(COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS + 1)
    await expect(loadCachedCommunityCuratedWidgets("community-a")).resolves.toMatchObject({
      widgets: [widget],
    })
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(2)
  })
})
