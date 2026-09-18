import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {getPublicKey} from "nostr-tools/pure"
import {pubkey} from "@welshman/app"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {makeCommunityPointer} from "@app/core/community"
import type {CommunityCuratedExtensionsResult} from "./community-curation"
import {
  COMMUNITY_SHARED_CONFIG_KIND,
  COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS,
  clearCommunityWidgetSlotCache,
  getEnabledCommunitySlotWidgetsWithSharedConfig,
  getEnabledCommunitySlotWidgets,
  getEnabledInstalledCommunitySlotWidgets,
  getCommunityWidgetCurationEvidenceKey,
  getLastValidatedCommunityCuratedWidgets,
  loadCachedCommunityCuratedWidgets,
  makeCommunitySharedConfigRecoveryFilter,
  mergeCommunitySlotWidgets,
  shouldRetryCommunitySharedConfigRecovery,
  shouldPreserveCuratedWidgetView,
} from "./community-widget-slots"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "./types"
import {getWidgetLineId} from "./widget-identity"

const mocks = vi.hoisted(() => ({
  loadCommunityCuratedWidgets: vi.fn(),
}))

const communityOwner = getPublicKey(new Uint8Array(32).fill(1))
const communityId = getPublicKey(new Uint8Array(32).fill(2))
const communityAddress = `32222:${communityOwner}:${communityId}`
const community = makeCommunityPointer({ownerPubkey: communityOwner, communityId})!
const unrelatedCommunityAddress = `32222:${communityOwner}:${getPublicKey(new Uint8Array(32).fill(3))}`

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
  community,
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

  it("does not restore an old inline placement over an installed quicklink", () => {
    const curated = makeWidget(
      "community-freelance",
      "community-home-after-quicklinks",
      "Freelance",
      "a".repeat(64),
      10,
    )
    const installed = makeWidget(
      "community-freelance",
      "community-home-quicklinks",
      "Freelance",
      "a".repeat(64),
      20,
    )
    const widgetId = getWidgetLineId(installed)
    const options = {
      curatedWidgets: [curated],
      installedWidgets: {[widgetId]: installed},
      enabledIds: new Set([widgetId]),
    }

    expect(
      getEnabledCommunitySlotWidgets({...options, slotType: "community-home-after-quicklinks"}),
    ).toEqual([])
    expect(
      getEnabledCommunitySlotWidgets({...options, slotType: "community-home-quicklinks"}),
    ).toEqual([installed])
    expect(
      getEnabledCommunitySlotWidgets({
        ...options,
        enabledIds: new Set(),
        slotType: "community-home-quicklinks",
      }),
    ).toEqual([])
  })

  it("can move an older installed inline widget to its newer curated quicklink", () => {
    const installed = makeWidget(
      "community-freelance",
      "community-home-after-quicklinks",
      "Freelance",
      "a".repeat(64),
      10,
    )
    const curated = makeWidget(
      "community-freelance",
      "community-home-quicklinks",
      "Freelance",
      "a".repeat(64),
      20,
    )
    const widgetId = getWidgetLineId(installed)
    const options = {
      curatedWidgets: [curated],
      installedWidgets: {[widgetId]: installed},
      enabledIds: new Set([widgetId]),
    }

    expect(
      getEnabledCommunitySlotWidgets({...options, slotType: "community-home-after-quicklinks"}),
    ).toEqual([])
    expect(
      getEnabledCommunitySlotWidgets({...options, slotType: "community-home-quicklinks"}),
    ).toEqual([{...installed, slot: curated.slot}])
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
    const communityPubkey = communityOwner
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
          `budabit-community-config:${communityAddress}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["a", communityAddress],
        ["namespace", "budabit-calendar-widget"],
        ["key", "featured-calendar-event"],
        ["descriptor", "1"],
      ],
    }

    const selected = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityAddress,
      sharedConfigEvents: [sharedConfigEvent],
      authorizedPubkeys: new Set([communityPubkey]),
      descriptorAuthorities: [{descriptor: {kind: 1}, moderatorPubkeys: [communityPubkey]}],
      installedWidgets: {
        [getWidgetLineId(widget)]: widget,
        [getWidgetLineId(unrelatedWidget)]: unrelatedWidget,
      },
      enabledIds: new Set([getWidgetLineId(widget), getWidgetLineId(unrelatedWidget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected.map(item => item.identifier)).toEqual(["featured-calendar-event"])

    const unauthorized = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityAddress,
      sharedConfigEvents: [{...sharedConfigEvent, pubkey: "e".repeat(64)}],
      authorizedPubkeys: new Set([communityPubkey]),
      installedWidgets: {[getWidgetLineId(widget)]: widget},
      enabledIds: new Set([getWidgetLineId(widget)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(unauthorized).toEqual([])

    const unrelatedCommunity = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityAddress: unrelatedCommunityAddress,
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

  it("treats explicit shared-config declarations as authoritative", () => {
    const communityPubkey = communityOwner
    const widget = makeWidget(
      "featured-calendar-event",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      undefined,
      {
        permissions: ["community:querySharedConfig"],
        tags: [
          ["d", "featured-calendar-event"],
          ["shared-config", "other-namespace", "other-key"],
        ],
      },
    )
    const sharedConfigEvent = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      pubkey: communityPubkey,
      tags: [
        [
          "d",
          `budabit-community-config:${communityAddress}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["a", communityAddress],
        ["namespace", "budabit-calendar-widget"],
        ["key", "featured-calendar-event"],
        ["descriptor", "1"],
      ],
    }

    expect(
      getEnabledCommunitySlotWidgetsWithSharedConfig({
        communityAddress,
        sharedConfigEvents: [sharedConfigEvent],
        authorizedPubkeys: new Set([communityPubkey]),
        descriptorAuthorities: [{descriptor: {kind: 1}, moderatorPubkeys: [communityPubkey]}],
        installedWidgets: {[getWidgetLineId(widget)]: widget},
        enabledIds: new Set([getWidgetLineId(widget)]),
        slotType: "community-home-after-quicklinks",
      }),
    ).toEqual([])
  })

  it("matches explicit shared-config declarations with trimmed case-sensitive scope", () => {
    const communityPubkey = communityOwner
    const sharedConfigEvent = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      pubkey: communityPubkey,
      tags: [
        ["d", `budabit-community-config:${communityAddress}:Calendar:Featured`],
        ["a", communityAddress],
        ["namespace", "Calendar"],
        ["key", "Featured"],
        ["descriptor", "1"],
      ],
    }
    const exact = makeWidget("exact", "community-home-after-quicklinks", undefined, undefined, 1, {
      permissions: ["community:querySharedConfig"],
      tags: [
        ["d", "exact"],
        ["shared-config", " Calendar ", "Featured"],
      ],
    })
    const wrongCase = makeWidget(
      "wrong-case",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      1,
      {
        permissions: ["community:querySharedConfig"],
        tags: [
          ["d", "wrong-case"],
          ["shared-config", "calendar", "featured"],
        ],
      },
    )

    const selected = getEnabledCommunitySlotWidgetsWithSharedConfig({
      communityAddress,
      sharedConfigEvents: [sharedConfigEvent],
      authorizedPubkeys: new Set([communityPubkey]),
      descriptorAuthorities: [{descriptor: {kind: 1}, moderatorPubkeys: [communityPubkey]}],
      installedWidgets: {
        [getWidgetLineId(exact)]: exact,
        [getWidgetLineId(wrongCase)]: wrongCase,
      },
      enabledIds: new Set([getWidgetLineId(exact), getWidgetLineId(wrongCase)]),
      slotType: "community-home-after-quicklinks",
    })

    expect(selected).toEqual([exact])
  })

  it("rejects configs whose author is no longer a current moderator", () => {
    const communityPubkey = communityOwner
    const unrelatedModerator = "d".repeat(64)
    const widget = makeWidget(
      "featured-calendar-event",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      1,
      {permissions: ["community:querySharedConfig"]},
    )
    const event = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      pubkey: unrelatedModerator,
      tags: [
        [
          "d",
          `budabit-community-config:${communityAddress}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["a", communityAddress],
        ["descriptor", "1"],
      ],
    }

    expect(
      getEnabledCommunitySlotWidgetsWithSharedConfig({
        communityAddress,
        sharedConfigEvents: [event],
        authorizedPubkeys: new Set([communityPubkey, unrelatedModerator]),
        descriptorAuthorities: [{descriptor: {kind: 1}, moderatorPubkeys: [communityPubkey]}],
        installedWidgets: {[getWidgetLineId(widget)]: widget},
        enabledIds: new Set([getWidgetLineId(widget)]),
        slotType: "community-home-after-quicklinks",
      }),
    ).toEqual([])
  })

  it("keeps a widget enabled when a current moderator's descriptor tags are historical", () => {
    const moderator = "d".repeat(64)
    const widget = makeWidget(
      "featured-calendar-event",
      "community-home-after-quicklinks",
      undefined,
      undefined,
      1,
      {permissions: ["community:querySharedConfig"]},
    )
    const event = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      pubkey: moderator,
      tags: [
        [
          "d",
          `budabit-community-config:${communityAddress}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["a", communityAddress],
        ["namespace", "budabit-calendar-widget"],
        ["key", "featured-calendar-event"],
        ["descriptor", "1"],
      ],
    }

    expect(
      getEnabledCommunitySlotWidgetsWithSharedConfig({
        communityAddress,
        sharedConfigEvents: [event],
        authorizedPubkeys: new Set([moderator]),
        descriptorAuthorities: [{descriptor: {kind: 2}, moderatorPubkeys: [moderator]}],
        installedWidgets: {[getWidgetLineId(widget)]: widget},
        enabledIds: new Set([getWidgetLineId(widget)]),
        slotType: "community-home-after-quicklinks",
      }),
    ).toEqual([widget])
  })

  it("author-filters recovery and retries empty or incomplete loads", () => {
    expect(makeCommunitySharedConfigRecoveryFilter(["b".repeat(64), "a".repeat(64)])).toEqual({
      kinds: [COMMUNITY_SHARED_CONFIG_KIND],
      authors: ["a".repeat(64), "b".repeat(64)],
      limit: 200,
    })
    expect(shouldRetryCommunitySharedConfigRecovery({events: [], complete: true})).toBe(true)
    expect(shouldRetryCommunitySharedConfigRecovery({events: [{}], complete: false})).toBe(true)
    expect(shouldRetryCommunitySharedConfigRecovery({events: [{}], complete: true})).toBe(false)
  })

  it("merges curated and shared-config-recovered widgets by widget line", () => {
    const curated = makeWidget("curated", "community-home-after-quicklinks")
    const recovered = makeWidget("recovered", "community-home-after-quicklinks")
    const duplicate = {...curated, content: "Recovered duplicate"}

    expect(mergeCommunitySlotWidgets([curated], [duplicate, recovered])).toEqual([
      curated,
      recovered,
    ])
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

  it("keeps a shared curation load alive until every signal consumer cancels", async () => {
    const firstController = new AbortController()
    const secondController = new AbortController()
    let sharedSignal: AbortSignal | undefined
    mocks.loadCommunityCuratedWidgets.mockImplementation((_input, options) => {
      sharedSignal = options?.signal
      return new Promise((_resolve, reject) =>
        sharedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          {once: true},
        ),
      )
    })

    const first = loadCachedCommunityCuratedWidgets("community-a", {
      signal: firstController.signal,
    })
    const second = loadCachedCommunityCuratedWidgets("community-a", {
      signal: secondController.signal,
    })
    expect(second).toBe(first)

    firstController.abort()
    expect(sharedSignal?.aborted).toBe(false)
    secondController.abort()
    expect(sharedSignal?.aborted).toBe(true)
    await expect(first).rejects.toMatchObject({name: "AbortError"})
  })

  it("replaces a shared load after its only consumer cancels", async () => {
    const signals: AbortSignal[] = []
    mocks.loadCommunityCuratedWidgets.mockImplementation((_input, options) => {
      const signal = options?.signal as AbortSignal
      signals.push(signal)
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          {once: true},
        )
        if (signals.length === 2) resolve(makeCuratedResult())
      })
    })

    const controller = new AbortController()
    const obsolete = loadCachedCommunityCuratedWidgets("community-a", {
      signal: controller.signal,
    })
    controller.abort()
    const replacement = loadCachedCommunityCuratedWidgets("community-a", {force: true})

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    await expect(obsolete).rejects.toMatchObject({name: "AbortError"})
    await expect(replacement).resolves.toMatchObject({complete: true})
  })

  it("uses exact branch identity rather than relay hints for curated widget caches", async () => {
    const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    const firstInput = nip19.naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
      relays: ["wss://one.example"],
    })
    const secondInput = nip19.naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
      relays: ["wss://two.example"],
    })
    const widget = makeWidget("community-stream", "community-home-before-quicklinks")
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([widget]))
      .mockResolvedValueOnce(makeCuratedResult([], false))

    await loadCachedCommunityCuratedWidgets(firstInput)
    await loadCachedCommunityCuratedWidgets(secondInput)

    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(1)
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
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenNthCalledWith(
      1,
      "community-a",
      expect.objectContaining({priority: RELAY_REQUEST_PRIORITY.background}),
    )
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenNthCalledWith(
      2,
      "community-a",
      expect.objectContaining({priority: RELAY_REQUEST_PRIORITY.interactive}),
    )

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

  it("reloads immediately when grant evidence is revoked and regranted", async () => {
    const grantedWidget = makeWidget("granted-widget", "global-menu")
    const regrantedWidget = makeWidget("regranted-widget", "global-menu")
    const makeProfileListEvent = (id: string, created_at: number) => ({id, created_at}) as any
    const emptyReportState = {eventReports: [], personReports: []}
    const revokedReportState = {
      eventReports: [],
      personReports: [{event: {id: "writer-revoked"}} as any],
    } as any
    const evidenceKey = (profileListEvents: any[], reportState: any = emptyReportState) =>
      getCommunityWidgetCurationEvidenceKey({
        definitionEventId: "definition",
        profileListEvents,
        reportState,
      })
    const grantedProfileLists = [makeProfileListEvent("grant-v1", 1)]
    const revokedProfileLists = [makeProfileListEvent("revoke", 2)]
    const regrantedProfileLists = [makeProfileListEvent("grant-current", 3)]
    const grantedEvidenceKey = evidenceKey(grantedProfileLists)
    const revokedEvidenceKey = evidenceKey(revokedProfileLists, revokedReportState)
    const regrantedEvidenceKey = evidenceKey(regrantedProfileLists)
    mocks.loadCommunityCuratedWidgets
      .mockResolvedValueOnce(makeCuratedResult([grantedWidget]))
      .mockResolvedValueOnce(makeCuratedResult([]))
      .mockResolvedValueOnce(makeCuratedResult([regrantedWidget]))

    await expect(
      loadCachedCommunityCuratedWidgets("community-a", {
        evidenceKey: grantedEvidenceKey,
        profileListEvents: grantedProfileLists,
        reportState: emptyReportState,
      }),
    ).resolves.toMatchObject({widgets: [grantedWidget]})
    expect(getLastValidatedCommunityCuratedWidgets("community-a", "", grantedEvidenceKey)).toEqual([
      grantedWidget,
    ])
    await expect(
      loadCachedCommunityCuratedWidgets("community-a", {
        evidenceKey: revokedEvidenceKey,
        profileListEvents: revokedProfileLists,
        reportState: revokedReportState,
      }),
    ).resolves.toMatchObject({widgets: []})
    expect(getLastValidatedCommunityCuratedWidgets("community-a", "", revokedEvidenceKey)).toEqual(
      [],
    )
    await expect(
      loadCachedCommunityCuratedWidgets("community-a", {
        evidenceKey: regrantedEvidenceKey,
        profileListEvents: regrantedProfileLists,
        reportState: emptyReportState,
      }),
    ).resolves.toMatchObject({widgets: [regrantedWidget]})

    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenCalledTimes(3)
    expect(mocks.loadCommunityCuratedWidgets).toHaveBeenNthCalledWith(
      2,
      "community-a",
      expect.objectContaining({
        priority: RELAY_REQUEST_PRIORITY.interactive,
        profileListEvents: revokedProfileLists,
        reportState: revokedReportState,
      }),
    )
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
