// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import type {ExtensionManifest, SmartWidgetEvent} from "./types"
import {
  applyRemoteExtensionSettings,
  defaultExtensionSettings,
  extensionSettings,
  type ExtensionSettings,
  getEffectiveExtensionSettings,
  getEffectiveEnabledExtensionIds,
  setDefaultExtensionWidgets,
} from "./settings"

vi.mock("@app/core/git-commands", () => ({
  postExtensionSettings: vi.fn(),
}))

vi.mock("@app/core/git-requests", () => ({
  EXTENSION_SETTINGS_DTAG: "extensions",
}))

const makeWidget = (identifier: string, created_at = 1): SmartWidgetEvent => ({
  id: `${identifier}-event`,
  kind: 30033,
  content: identifier,
  pubkey: "a".repeat(64),
  created_at,
  tags: [
    ["d", identifier],
    ["l", "basic"],
  ],
  identifier,
  widgetType: "basic",
  buttons: [],
})

const makeManifest = (id: string): ExtensionManifest => ({
  id,
  name: id,
  entrypoint: `https://example.com/${id}/`,
})

const makeSettings = (): ExtensionSettings => ({
  ...defaultExtensionSettings,
  enabled: [],
  disabledDefaultIds: [],
  installed: {nip89: {}, widget: {}},
  widgetDisplay: {},
  manifestUrls: {},
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
    const settings = makeSettings()
    const effective = getEffectiveExtensionSettings(settings, [widget])

    expect(settings.installed.widget[widget.identifier]).toBeUndefined()
    expect(effective.installed.widget[widget.identifier]).toBe(widget)
    expect(effective.enabled).toContain(widget.identifier)
  })

  it("lets disabled defaults override explicit enabled ids", () => {
    const widget = makeWidget("default-widget")
    const settings = {
      ...makeSettings(),
      enabled: [widget.identifier],
      disabledDefaultIds: [widget.identifier],
    }

    expect(getEffectiveEnabledExtensionIds(settings, [widget])).not.toContain(widget.identifier)
  })

  it("applies remote settings as the replacement user-installed snapshot", () => {
    const localWidget = makeWidget("local-widget")
    const remoteWidget = makeWidget("remote-widget")

    extensionSettings.set({
      ...makeSettings(),
      enabled: [localWidget.identifier],
      installed: {nip89: {}, widget: {[localWidget.identifier]: localWidget}},
    })

    applyRemoteExtensionSettings({
      ...makeSettings(),
      enabled: [remoteWidget.identifier],
      installed: {nip89: {}, widget: {[remoteWidget.identifier]: remoteWidget}},
    })

    const settings = get(extensionSettings)

    expect(settings.installed.widget[localWidget.identifier]).toBeUndefined()
    expect(settings.installed.widget[remoteWidget.identifier]).toBe(remoteWidget)
    expect(settings.enabled).toEqual([remoteWidget.identifier])
  })

  it("treats ids missing from the latest remote snapshot as removed", () => {
    const manifest = makeManifest("old-extension")

    extensionSettings.set({
      ...makeSettings(),
      enabled: [manifest.id],
      installed: {nip89: {[manifest.id]: manifest}, widget: {}},
      manifestUrls: {[manifest.id]: "https://example.com/old-extension/manifest.json"},
      widgetDisplay: {[manifest.id]: {location: "menu-route"}},
    })

    applyRemoteExtensionSettings(makeSettings())

    const settings = get(extensionSettings)

    expect(settings.installed.nip89[manifest.id]).toBeUndefined()
    expect(settings.enabled).toEqual([])
    expect(settings.manifestUrls).toEqual({})
  })

  it("filters remote enabled ids and manifest URLs to installed user extensions", () => {
    const manifest = makeManifest("remote-extension")
    const manifestUrl = "https://example.com/remote-extension/manifest.json"

    applyRemoteExtensionSettings({
      ...makeSettings(),
      enabled: [manifest.id, "missing-extension"],
      installed: {nip89: {[manifest.id]: manifest}, widget: {}},
      manifestUrls: {
        [manifest.id]: manifestUrl,
        "missing-extension": "https://example.com/missing/manifest.json",
      },
    })

    const settings = get(extensionSettings)

    expect(settings.enabled).toEqual([manifest.id])
    expect(settings.manifestUrls).toEqual({[manifest.id]: manifestUrl})
  })

  it("filters and normalizes widget install sources to installed widgets", () => {
    const widget = makeWidget("weather")

    applyRemoteExtensionSettings({
      ...makeSettings(),
      installed: {nip89: {}, widget: {[widget.identifier]: widget}},
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
      [widget.identifier]: {
        naddr: "naddr1example",
        relays: ["wss://relay.example/"],
      },
    })
  })

  it("keeps default extension disabled state separate from installed metadata", () => {
    const widget = makeWidget("default-widget")
    setDefaultExtensionWidgets([widget])

    applyRemoteExtensionSettings({
      ...makeSettings(),
      disabledDefaultIds: [widget.identifier],
    })

    const settings = get(extensionSettings)
    const effective = getEffectiveExtensionSettings(settings, [widget])

    expect(settings.installed.widget[widget.identifier]).toBeUndefined()
    expect(settings.disabledDefaultIds).toEqual([widget.identifier])
    expect(effective.installed.widget[widget.identifier]).toBe(widget)
    expect(effective.enabled).not.toContain(widget.identifier)
  })
})
