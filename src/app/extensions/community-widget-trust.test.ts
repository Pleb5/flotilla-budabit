import {describe, expect, it} from "vitest"
import {getManualCommunityWidgets, getTrustedCommunityWidgets} from "./community-widget-trust"
import type {SmartWidgetEvent} from "./types"

const makeWidget = (identifier: string, pubkey: string): SmartWidgetEvent => ({
  id: identifier,
  kind: 30033,
  content: identifier,
  pubkey,
  tags: [["d", identifier]],
  identifier,
  widgetType: "basic",
  buttons: [],
})

describe("community widget trust", () => {
  it("splits trusted author widgets from manual curated widgets", () => {
    const trustedPubkey = "a".repeat(64)
    const curatorPubkey = "b".repeat(64)
    const widgets = [makeWidget("trusted", trustedPubkey), makeWidget("manual", curatorPubkey)]

    expect(
      getTrustedCommunityWidgets(widgets, [trustedPubkey]).map(widget => widget.identifier),
    ).toEqual(["trusted"])
    expect(
      getManualCommunityWidgets(widgets, [trustedPubkey]).map(widget => widget.identifier),
    ).toEqual(["manual"])
  })
})
