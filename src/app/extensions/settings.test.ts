// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import type {SmartWidgetEvent} from "./types"
import {
  applyRemoteExtensionSettings,
  defaultExtensionSettings,
  enableDefaultExtension,
  extensionSettings,
  type ExtensionSettings,
  getEffectiveExtensionSettings,
  getEffectiveEnabledExtensionIds,
  setDefaultExtensionWidgets,
} from "./settings"
import {getWidgetLineId} from "./widget-identity"

vi.mock("@app/core/git-commands", () => ({
  postExtensionSettings: vi.fn(),
}))

vi.mock("@app/core/git-requests", () => ({
  EXTENSION_SETTINGS_DTAG: "extensions",
}))

const makeWidget = (
  identifier: string,
  created_at = 1,
  widgetPubkey = "a".repeat(64),
): SmartWidgetEvent => ({
  id: `${identifier}-event`,
  kind: 30033,
  content: identifier,
  pubkey: widgetPubkey,
  created_at,
  tags: [
    ["d", identifier],
    ["l", "basic"],
  ],
  identifier,
  widgetType: "basic",
  buttons: [],
})

const makeSettings = (): ExtensionSettings => ({
  ...defaultExtensionSettings,
  enabled: [],
  disabledDefaultIds: [],
  installed: {widget: {}},
  widgetInstallSources: {},
})

describe("effective extension settings", () => {
  afterEach(() => {
    setDefaultExtensionWidgets([])
    extensionSettings.set(makeSettings())
    localStorage.clear()
  })

  it("shows default widgets as installed and enabled without persisting them", () => {
    const widget = makeWidget("default-widget")
    const widgetId = getWidgetLineId(widget)
    const settings = makeSettings()
    const effective = getEffectiveExtensionSettings(settings, [widget])

    expect(settings.installed.widget[widgetId]).toBeUndefined()
    expect(effective.installed.widget[widgetId]).toBe(widget)
    expect(effective.enabled).toContain(widgetId)
  })

  it("renders a newer installed widget over a stale default widget immediately", () => {
    const staleDefault = {
      ...makeWidget("default-widget", 10),
      version: "0.1.4",
      appUrl: "https://example.com/default-0.1.4.html",
    }
    const updatedInstalled = {
      ...makeWidget("default-widget", 20),
      version: "0.1.5",
      appUrl: "https://example.com/installed-0.1.5.html",
    }
    const widgetId = getWidgetLineId(updatedInstalled)
    const settings = {
      ...makeSettings(),
      installed: {widget: {[widgetId]: updatedInstalled}},
    }
    const effective = getEffectiveExtensionSettings(settings, [staleDefault])

    expect(effective.installed.widget[widgetId]).toBe(updatedInstalled)
    expect(effective.installed.widget[widgetId].version).toBe("0.1.5")
    expect(effective.installed.widget[widgetId].appUrl).toBe(
      "https://example.com/installed-0.1.5.html",
    )
  })

  it("keeps the synced installed widget snapshot over newer default discovery", () => {
    const discoveredDefault = {
      ...makeWidget("default-widget", 30),
      version: "0.2.0",
      appUrl: "https://example.com/default-0.2.0.html",
    }
    const syncedInstalled = {
      ...makeWidget("default-widget", 20),
      version: "0.1.5",
      appUrl: "https://example.com/installed-0.1.5.html",
    }
    const widgetId = getWidgetLineId(syncedInstalled)
    const settings = {
      ...makeSettings(),
      installed: {widget: {[widgetId]: syncedInstalled}},
    }
    const effective = getEffectiveExtensionSettings(settings, [discoveredDefault])

    expect(effective.installed.widget[widgetId]).toBe(syncedInstalled)
    expect(effective.installed.widget[widgetId].version).toBe("0.1.5")
    expect(effective.installed.widget[widgetId].appUrl).toBe(
      "https://example.com/installed-0.1.5.html",
    )
  })

  it("persists a newer enabled default widget snapshot when discovery updates", () => {
    const installed = {
      ...makeWidget("default-widget", 10),
      version: "0.1.7",
      appUrl: "https://example.com/default-0.1.7.html",
    }
    const discovered = {
      ...makeWidget("default-widget", 20),
      version: "0.2.0",
      appUrl: "https://example.com/default-0.2.0.html",
    }
    const widgetId = getWidgetLineId(installed)

    extensionSettings.set({
      ...makeSettings(),
      installed: {widget: {[widgetId]: installed}},
    })

    setDefaultExtensionWidgets([discovered])

    const settings = get(extensionSettings)

    expect(settings.installed.widget[widgetId]).toMatchObject({
      id: discovered.id,
      version: "0.2.0",
      appUrl: "https://example.com/default-0.2.0.html",
    })
  })

  it("keeps newer default snapshots when applying stale remote settings", () => {
    const remoteInstalled = {
      ...makeWidget("default-widget", 10),
      version: "0.1.7",
      appUrl: "https://example.com/default-0.1.7.html",
    }
    const discovered = {
      ...makeWidget("default-widget", 20),
      version: "0.2.0",
      appUrl: "https://example.com/default-0.2.0.html",
    }
    const widgetId = getWidgetLineId(discovered)

    setDefaultExtensionWidgets([discovered])
    applyRemoteExtensionSettings({
      ...makeSettings(),
      installed: {widget: {[widgetId]: remoteInstalled}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget[widgetId]).toMatchObject({
      id: discovered.id,
      version: "0.2.0",
      appUrl: "https://example.com/default-0.2.0.html",
    })
  })

  it("keeps a newer local widget snapshot over a stale remote snapshot", () => {
    const local = {
      ...makeWidget("calendar", 20),
      version: "0.2.0",
      appUrl: "https://example.com/calendar-0.2.0.html",
    }
    const staleRemote = {
      ...makeWidget("calendar", 30),
      version: "0.1.7",
      appUrl: "https://example.com/calendar-0.1.7.html",
    }
    const widgetId = getWidgetLineId(local)

    extensionSettings.set({
      ...makeSettings(),
      installed: {widget: {[widgetId]: local}},
    })
    applyRemoteExtensionSettings({
      ...makeSettings(),
      installed: {widget: {[widgetId]: staleRemote}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget[widgetId]).toMatchObject({
      id: local.id,
      version: "0.2.0",
      appUrl: "https://example.com/calendar-0.2.0.html",
    })
  })

  it("lets disabled defaults override explicit enabled ids", () => {
    const widget = makeWidget("default-widget")
    const widgetId = getWidgetLineId(widget)
    const settings = {
      ...makeSettings(),
      enabled: [widgetId],
      disabledDefaultIds: [widget.identifier],
    }

    expect(getEffectiveEnabledExtensionIds(settings, [widget])).not.toContain(widgetId)
  })

  it("applies remote settings as the replacement user-installed snapshot", () => {
    const localWidget = makeWidget("local-widget")
    const remoteWidget = makeWidget("remote-widget")
    const localWidgetId = getWidgetLineId(localWidget)
    const remoteWidgetId = getWidgetLineId(remoteWidget)

    extensionSettings.set({
      ...makeSettings(),
      enabled: [localWidgetId],
      installed: {widget: {[localWidgetId]: localWidget}},
    })

    applyRemoteExtensionSettings({
      ...makeSettings(),
      enabled: [remoteWidget.identifier],
      installed: {widget: {[remoteWidget.identifier]: remoteWidget}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget[localWidgetId]).toBeUndefined()
    expect(settings.installed.widget[remoteWidgetId]).toBe(remoteWidget)
    expect(settings.enabled).toEqual([remoteWidgetId])
  })

  it("filters and normalizes widget install sources to installed widgets", () => {
    const widget = makeWidget("weather")
    const widgetId = getWidgetLineId(widget)

    applyRemoteExtensionSettings({
      ...makeSettings(),
      installed: {widget: {[widget.identifier]: widget}},
      widgetInstallSources: {
        [widget.identifier]: {
          naddr: " naddr1example ",
          relays: ["wss://relay.example", "wss://relay.example/", "not-a-relay"],
        },
        missing: {relays: ["wss://missing.example"]},
      },
    })

    const settings = get(extensionSettings)

    expect(settings.widgetInstallSources).toEqual({
      [widgetId]: {
        naddr: "naddr1example",
        relays: ["wss://relay.example/"],
      },
    })
  })

  it("migrates bare widget settings to canonical widget line ids", () => {
    const widget = makeWidget("weather")
    const widgetId = getWidgetLineId(widget)

    applyRemoteExtensionSettings({
      ...makeSettings(),
      enabled: [widget.identifier],
      installed: {widget: {[widget.identifier]: widget}},
      widgetInstallSources: {[widget.identifier]: {relays: ["wss://relay.example"]}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget).toEqual({[widgetId]: widget})
    expect(settings.enabled).toEqual([widgetId])
    expect(settings.widgetInstallSources).toEqual({
      [widgetId]: {relays: ["wss://relay.example/"]},
    })
  })

  it("keeps same-d widgets from different publishers under separate ids", () => {
    const first = makeWidget("weather", 1, "a".repeat(64))
    const second = makeWidget("weather", 1, "b".repeat(64))
    const firstId = getWidgetLineId(first)
    const secondId = getWidgetLineId(second)

    applyRemoteExtensionSettings({
      ...makeSettings(),
      enabled: [firstId, secondId],
      installed: {widget: {[firstId]: first, [secondId]: second}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget[firstId]).toBe(first)
    expect(settings.installed.widget[secondId]).toBe(second)
    expect(settings.enabled.sort()).toEqual([firstId, secondId].sort())
  })

  it("keeps default extension disabled state separate from installed metadata", () => {
    const widget = makeWidget("default-widget")
    const widgetId = getWidgetLineId(widget)
    setDefaultExtensionWidgets([widget])

    applyRemoteExtensionSettings({
      ...makeSettings(),
      disabledDefaultIds: [widget.identifier],
    })

    const settings = get(extensionSettings)
    const effective = getEffectiveExtensionSettings(settings, [widget])

    expect(settings.installed.widget[widgetId]).toBeUndefined()
    expect(settings.disabledDefaultIds).toEqual([widgetId])
    expect(effective.installed.widget[widgetId]).toBe(widget)
    expect(effective.enabled).not.toContain(widgetId)
  })

  it("persists the default widget snapshot when enabling a default extension", () => {
    const widget = {
      ...makeWidget("default-widget", 20),
      version: "0.1.5",
      appUrl: "https://example.com/default-0.1.5.html",
      appUrls: ["https://example.com/default-0.1.5.html", "https://cdn.example.com/default.html"],
      permissions: ["ui:toast"],
    }
    const widgetId = getWidgetLineId(widget)

    setDefaultExtensionWidgets([widget])
    extensionSettings.set({
      ...makeSettings(),
      disabledDefaultIds: [widgetId],
    })

    enableDefaultExtension(widgetId)

    const settings = get(extensionSettings)

    expect(settings.disabledDefaultIds).toEqual([])
    expect(settings.installed.widget[widgetId]).toMatchObject({
      id: widget.id,
      version: "0.1.5",
      appUrl: "https://example.com/default-0.1.5.html",
      appUrls: ["https://example.com/default-0.1.5.html", "https://cdn.example.com/default.html"],
      permissions: ["ui:toast"],
    })
  })
})
