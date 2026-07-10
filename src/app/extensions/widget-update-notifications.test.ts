// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"
import type {TrustedEvent} from "@welshman/util"
import type {ExtensionSettings} from "./settings"
import type {SmartWidgetEvent} from "./types"
import {
  buildInstalledWidgetUpdateTargets,
  buildInstalledWidgetUpdates,
} from "./widget-update-notifications"
import {getWidgetLineId} from "./widget-identity"

vi.mock("@welshman/net", () => ({
  load: vi.fn(() => Promise.resolve([])),
  request: vi.fn(() => Promise.resolve([])),
}))

vi.mock("@welshman/app", () => ({
  pubkey: readable(undefined),
  repository: {},
  signer: readable(undefined),
}))

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: ["wss://indexer.example/"],
  SMART_WIDGET_RELAYS: ["wss://widgets.example/"],
}))

vi.mock("@app/core/git-commands", () => ({
  postExtensionSettings: vi.fn(),
}))

vi.mock("@app/core/git-requests", () => ({
  EXTENSION_SETTINGS_DTAG: "extensions",
}))

const widgetPubkey = "a".repeat(64)
const defaultPubkey = "b".repeat(64)

const makeWidget = (overrides: Partial<SmartWidgetEvent> = {}): SmartWidgetEvent => ({
  id: overrides.id || "weather-1",
  kind: 30033,
  content: "Weather",
  pubkey: widgetPubkey,
  created_at: 1,
  tags: [
    ["d", "weather"],
    ["l", "tool"],
    ["image", "https://example.com/weather.png"],
    ["button", "Open", "app", "https://example.com/v1.html"],
  ],
  identifier: "weather",
  widgetType: "tool",
  buttons: [{index: 1, label: "Open", type: "app", url: "https://example.com/v1.html"}],
  appUrl: "https://example.com/v1.html",
  permissions: ["ui:toast"],
  ...overrides,
})

const makeSettings = (widgets: Record<string, SmartWidgetEvent>): ExtensionSettings => ({
  enabled: Object.keys(widgets),
  disabledDefaultIds: [],
  installed: {widget: widgets},
  widgetInstallSources: {},
})

describe("widget update notifications", () => {
  it("builds update targets for installed non-default widgets", () => {
    const installed = makeWidget()
    const defaultWidget = makeWidget({
      id: "default-1",
      pubkey: defaultPubkey,
      identifier: "default-widget",
      tags: [["d", "default-widget"]],
    })
    const installedId = getWidgetLineId(installed)
    const defaultId = getWidgetLineId(defaultWidget)
    const settings = makeSettings({[installedId]: installed, [defaultId]: defaultWidget})
    settings.widgetInstallSources = {[installedId]: {relays: ["wss://source.example"]}}

    expect(
      buildInstalledWidgetUpdateTargets({
        settings,
        defaultWidgets: [defaultWidget],
        fallbackRelays: ["wss://fallback.example"],
      }),
    ).toEqual([
      expect.objectContaining({
        id: installedId,
        installed,
        filter: {kinds: [30033], authors: [widgetPubkey], "#d": ["weather"], limit: 1},
        relays: ["wss://source.example/", "wss://fallback.example/"],
      }),
    ])
  })

  it("builds update records from newer widget events", () => {
    const installed = makeWidget({created_at: 1, version: "1.0.0"})
    const installedId = getWidgetLineId(installed)
    const targets = buildInstalledWidgetUpdateTargets({
      settings: makeSettings({[installedId]: installed}),
      fallbackRelays: ["wss://fallback.example"],
    })
    const latest = {
      ...installed,
      id: "weather-2",
      created_at: 2,
      tags: [
        ["d", "weather"],
        ["l", "tool"],
        ["image", "https://example.com/weather.png"],
        ["version", "1.1.0"],
        ["changelog", "Better forecast data."],
        ["button", "Open", "app", "https://example.com/v2.html"],
      ],
      content: "Weather",
    } as TrustedEvent

    expect(buildInstalledWidgetUpdates({targets, events: [latest]})).toEqual([
      expect.objectContaining({
        id: installedId,
        latest: expect.objectContaining({id: "weather-2", version: "1.1.0"}),
        diff: expect.objectContaining({
          version: {from: "1.0.0", to: "1.1.0"},
          changelog: "Better forecast data.",
          appUrlChanged: true,
        }),
      }),
    ])
  })
})
