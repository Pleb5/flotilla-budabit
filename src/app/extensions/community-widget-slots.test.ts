import {describe, expect, it} from "vitest"
import {getEnabledCommunitySlotWidgets} from "./community-widget-slots"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "./types"

const makeWidget = (
  identifier: string,
  slotType?: WidgetCommunitySlotType,
  label = identifier,
): SmartWidgetEvent => ({
  id: identifier,
  kind: 30033,
  content: identifier,
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
      "message-widget": makeWidget("message-widget"),
      "global-widget": makeWidget("global-widget"),
      "disabled-widget": makeWidget("disabled-widget"),
    }

    const selected = getEnabledCommunitySlotWidgets({
      curatedWidgets: curated,
      installedWidgets: installed,
      enabledIds: new Set(["message-widget", "global-widget", "missing-installed"]),
      slotType: "chat-message-actions",
    })

    expect(selected.map(widget => widget.identifier)).toEqual(["message-widget"])
    expect(selected[0].slot).toEqual({type: "chat-message-actions", label: "Message tools"})
  })
})
