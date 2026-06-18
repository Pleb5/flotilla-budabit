import {describe, expect, it} from "vitest"
import {selectDefaultCommunityWidgets} from "./builtin-filter"
import type {SmartWidgetEvent} from "./types"

const makeWidget = (identifier: string, pubkey?: string): SmartWidgetEvent => ({
  id: identifier,
  kind: 30033,
  content: identifier,
  pubkey,
  tags: [["d", identifier]],
  identifier,
  widgetType: "basic",
  buttons: [],
})

describe("selectDefaultCommunityWidgets", () => {
  it("keeps only widgets authored by the default community owner", () => {
    const owner = "a".repeat(64)
    const moderator = "b".repeat(64)

    expect(
      selectDefaultCommunityWidgets(
        [makeWidget("owner-widget", owner), makeWidget("moderator-widget", moderator)],
        owner,
      ).map(widget => widget.identifier),
    ).toEqual(["owner-widget"])
  })
})
