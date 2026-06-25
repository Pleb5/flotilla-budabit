import {describe, expect, it} from "vitest"
import {getEnabledCommunitySlotWidgets} from "./community-widget-slots"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "./types"
import {getWidgetLineId} from "./widget-identity"

const makeWidget = (
  identifier: string,
  slotType?: WidgetCommunitySlotType,
  label = identifier,
  pubkey = "a".repeat(64),
  created_at = 1,
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
})

describe("community widget slots", () => {
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
      ...makeWidget("featured-calendar-event", "community-home-after-quicklinks", "Featured event", "a".repeat(64), 10),
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
    const first = makeWidget("weather", "community-home-after-quicklinks", "Weather A", "a".repeat(64))
    const second = makeWidget("weather", "community-home-after-quicklinks", "Weather B", "b".repeat(64))

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
})
