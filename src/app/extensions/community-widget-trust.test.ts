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
    const ownerPubkey = "a".repeat(64)
    const moderatorPubkey = "b".repeat(64)
    const curatorPubkey = "c".repeat(64)
    const widgets = [
      makeWidget("owner", ownerPubkey),
      makeWidget("moderator", moderatorPubkey),
      makeWidget("manual", curatorPubkey),
    ]

    expect(
      getTrustedCommunityWidgets(widgets, [ownerPubkey, moderatorPubkey]).map(
        widget => widget.identifier,
      ),
    ).toEqual(["owner", "moderator"])
    expect(
      getManualCommunityWidgets(widgets, [ownerPubkey, moderatorPubkey]).map(
        widget => widget.identifier,
      ),
    ).toEqual(["manual"])
  })
})
