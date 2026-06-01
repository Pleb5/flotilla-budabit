// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vitest"
import type {SmartWidgetEvent} from "./types"
import {
  defaultExtensionSettings,
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

const makeSettings = (): ExtensionSettings => ({
  ...defaultExtensionSettings,
  enabled: [],
  disabledDefaultIds: [],
  installed: {nip89: {}, widget: {}},
  widgetDisplay: {},
  manifestUrls: {},
})

describe("effective extension settings", () => {
  afterEach(() => {
    setDefaultExtensionWidgets([])
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
})
