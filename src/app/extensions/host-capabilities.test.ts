import {afterEach, describe, expect, it, vi} from "vitest"
import {
  getHostCapabilitySnapshot,
  getRegisteredBridgeActions,
  registerBridgeHandler,
  removeBridgeHandler,
} from "./host-capabilities"
import type {SmartWidgetEvent} from "./types"

const testAction = "test:catalog"
const makeWidget = (permissions: string[] = []): SmartWidgetEvent =>
  ({
    id: "widget-event",
    kind: 30033,
    content: "Widget",
    pubkey: "a".repeat(64),
    created_at: 1,
    tags: [["d", "widget"]],
    identifier: "widget",
    widgetType: "tool",
    buttons: [],
    permissions,
  }) as SmartWidgetEvent

afterEach(() => {
  removeBridgeHandler(testAction)
  vi.unstubAllGlobals()
})

describe("host capability catalog", () => {
  it("advertises conditional storage only when cross-tab Web Locks are available", () => {
    vi.stubGlobal("navigator", {})
    expect(
      getHostCapabilitySnapshot({widget: makeWidget()}).features["storage.compareAndSet"],
    ).toBe(false)
    vi.stubGlobal("navigator", {locks: {request: () => {}}})
    expect(
      getHostCapabilitySnapshot({widget: makeWidget()}).features["storage.compareAndSet"],
    ).toBe(true)
  })
  it("derives advertised actions from registered bridge handlers", () => {
    registerBridgeHandler(testAction, () => ({status: "ok"}))

    const snapshot = getHostCapabilitySnapshot({widget: makeWidget()})

    expect(snapshot.actions).toEqual(getRegisteredBridgeActions())
    expect(snapshot.actions).toContain(testAction)
    removeBridgeHandler(testAction)
    expect(getHostCapabilitySnapshot({widget: makeWidget()}).actions).not.toContain(testAction)
  })

  it("reports actual surface and media allowances with useful limits", () => {
    const snapshot = getHostCapabilitySnapshot({
      widget: makeWidget(["media:camera", "media:microphone"]),
      resize: true,
      media: true,
      slot: "community-home-after-quicklinks",
    })

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      protocolVersion: 1,
      surface: {kind: "widget", resize: true, slot: "community-home-after-quicklinks"},
      media: {camera: true, microphone: true, displayCapture: false},
      features: {"nostr.subscriptionEose": "per-relay"},
      limits: {
        nostrQueryEventsPerFilter: 500,
        nostrSubscriptionsPerWidget: 10,
        widgetResizeHeight: 2400,
      },
    })
  })
})
