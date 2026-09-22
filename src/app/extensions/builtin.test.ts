// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import * as nip19 from "nostr-tools/nip19"
import {selectDefaultCommunityWidgets} from "./builtin-filter"
import type {SmartWidgetEvent} from "./types"

const mocks = vi.hoisted(() => ({
  communityInput: "",
  curated: vi.fn(),
  load: vi.fn(),
  query: vi.fn(),
  publish: vi.fn(),
}))
vi.mock("@app/core/community-state", () => ({
  get DEFAULT_COMMUNITY_INPUT() {
    return mocks.communityInput
  },
  loadCommunityEventsWithStatus: mocks.load,
}))
vi.mock("@app/extensions/community-widget-slots", () => ({
  loadCachedCommunityCuratedWidgets: mocks.curated,
}))
vi.mock("@app/core/relay-policy", () => ({RELAY_REQUEST_PRIORITY: {background: -100}}))
vi.mock("@app/core/state", () => ({SMART_WIDGET_RELAYS: ["wss://widgets.example"]}))
vi.mock("@welshman/app", async () => {
  const {readable} = await import("svelte/store")
  return {
    repository: {query: mocks.query},
    signer: readable(undefined),
    pubkey: readable(undefined),
  }
})
vi.mock("@app/core/git-commands", () => ({postExtensionSettings: mocks.publish}))
vi.mock("@app/core/git-requests", () => ({EXTENSION_SETTINGS_DTAG: "extensions"}))

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

describe("default extension startup", () => {
  const owner = "a".repeat(64)
  const externalAuthor = "b".repeat(64)
  const explicit = {...makeWidget("explicit", externalAuthor), created_at: 20}
  const address = nip19.naddrEncode({kind: 30033, pubkey: externalAuthor, identifier: "explicit"})
  const communityResult = (widgets: SmartWidgetEvent[]) => ({
    status: "community",
    community: {ownerPubkey: owner},
    widgets,
  })

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubEnv("VITE_DEFAULT_WIDGETS", address)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.communityInput = "default-community"
    mocks.query.mockReset().mockReturnValue([])
    mocks.load.mockReset().mockResolvedValue({events: [explicit], complete: true})
    mocks.curated.mockReset().mockResolvedValue(communityResult([]))
    mocks.publish.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("enables a cached configured widget before relay discovery and after a failed reload", async () => {
    mocks.communityInput = ""
    let settings = await import("./settings")
    await settings.extensionSettings.ready
    settings.setDefaultExtensionWidgets([explicit])
    const id = `30033:${externalAuthor}:explicit`
    expect(settings.getEffectiveEnabledExtensionIds()).toContain(id)

    // A new app instance has only the persisted widget snapshot. No network
    // rediscovery should be required to recognize a configured default.
    vi.resetModules()
    settings = await import("./settings")
    await settings.extensionSettings.ready
    expect(settings.isDefaultExtension(id)).toBe(true)
    expect(get(settings.defaultExtensionWidgets).map(widget => widget.identifier)).toEqual([
      "explicit",
    ])
    expect(settings.getEffectiveEnabledExtensionIds()).toContain(id)
    expect(mocks.load).not.toHaveBeenCalled()

    mocks.load.mockRejectedValue(new Error("offline"))
    const {installBuiltinExtensions} = await import("./builtin")
    await installBuiltinExtensions()
    expect(settings.getEffectiveEnabledExtensionIds()).toContain(id)
    expect(settings.isDefaultExtension(id)).toBe(true)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("recognizes configured defaults from remote settings without enabling an explicit opt-out", async () => {
    const settings = await import("./settings")
    await settings.extensionSettings.ready
    const id = `30033:${externalAuthor}:explicit`
    const remote = {
      ...settings.defaultExtensionSettings,
      installed: {widget: {[id]: explicit}},
      enabled: [],
      disabledDefaultIds: [],
    }

    settings.applyRemoteExtensionSettings(remote)
    expect(settings.getEffectiveEnabledExtensionIds()).toContain(id)
    expect(get(settings.defaultExtensionWidgets).map(widget => widget.identifier)).toEqual([
      "explicit",
    ])

    settings.applyRemoteExtensionSettings({...remote, disabledDefaultIds: [id]})
    expect(settings.getEffectiveEnabledExtensionIds()).not.toContain(id)
    expect(settings.isDefaultExtension(id)).toBe(true)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("preserves a configured widget's disable preference across reload and can re-enable it offline", async () => {
    let settings = await import("./settings")
    await settings.extensionSettings.ready
    const id = `30033:${externalAuthor}:explicit`
    settings.setDefaultExtensionWidgets([explicit])
    settings.disableDefaultExtension(id)

    vi.resetModules()
    settings = await import("./settings")
    await settings.extensionSettings.ready
    expect(settings.isDefaultExtension(id)).toBe(true)
    expect(settings.getEffectiveEnabledExtensionIds()).not.toContain(id)

    settings.enableDefaultExtension(id)
    expect(settings.getEffectiveEnabledExtensionIds()).toContain(id)
    expect(get(settings.extensionSettings).disabledDefaultIds).toEqual([])
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("loads explicit defaults without a community and preserves saved disable preferences", async () => {
    mocks.communityInput = ""
    const settings = await import("./settings")
    const id = `30033:${externalAuthor}:explicit`
    settings.extensionSettings.set({
      ...settings.defaultExtensionSettings,
      enabled: [id],
      disabledDefaultIds: [id],
    })
    const {installBuiltinExtensions} = await import("./builtin")
    const pending = installBuiltinExtensions()
    expect(installBuiltinExtensions()).toBe(pending)
    await pending

    expect(get(settings.defaultExtensionWidgets).map(widget => widget.identifier)).toEqual([
      "explicit",
    ])
    expect(settings.getEffectiveExtensionSettings().installed.widget[id]).toMatchObject(explicit)
    expect(settings.getEffectiveEnabledExtensionIds()).not.toContain(id)
    expect(get(settings.extensionSettings).disabledDefaultIds).toEqual([id])
    expect(mocks.curated).not.toHaveBeenCalled()
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("merges owner and explicit defaults by address while retaining the owner filter", async () => {
    const shared = {...explicit, pubkey: owner}
    vi.stubEnv(
      "VITE_DEFAULT_WIDGETS",
      `${address},${nip19.naddrEncode({kind: 30033, pubkey: owner, identifier: "explicit"})}`,
    )
    mocks.curated.mockResolvedValue(
      communityResult([
        {...shared, created_at: 10},
        makeWidget("owner-only", owner),
        makeWidget("moderator-only", externalAuthor),
      ]),
    )
    mocks.load.mockImplementation(async (_relays, filters) => ({
      events: filters[0].authors[0] === owner ? [shared] : [explicit],
    }))
    const {installBuiltinExtensions} = await import("./builtin")
    const settings = await import("./settings")
    await installBuiltinExtensions()

    const widgets = get(settings.defaultExtensionWidgets)
    expect(widgets).toHaveLength(3)
    expect(
      widgets.find(widget => widget.pubkey === owner && widget.identifier === "explicit")
        ?.created_at,
    ).toBe(20)
    expect(widgets.some(widget => widget.identifier === "moderator-only")).toBe(false)
    expect(settings.getEffectiveEnabledExtensionIds()).toHaveLength(3)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("exposes explicit defaults while community loading is pending and preserves them after failure", async () => {
    let failCommunity!: (reason: Error) => void
    const community = new Promise<never>((_resolve, reject) => {
      failCommunity = reject
    })
    mocks.curated.mockReturnValue(community)
    const {installBuiltinExtensions} = await import("./builtin")
    const settings = await import("./settings")
    const pending = installBuiltinExtensions()

    await vi.waitFor(() => expect(get(settings.defaultExtensionWidgets)).toHaveLength(1))
    failCommunity(new Error("community unavailable"))
    await pending

    expect(get(settings.defaultExtensionWidgets).map(widget => widget.identifier)).toEqual([
      "explicit",
    ])
  })

  it.each(["", "invalid", address])(
    "retains community defaults with an empty or failing explicit list (%s)",
    async input => {
      vi.stubEnv("VITE_DEFAULT_WIDGETS", input)
      mocks.load.mockRejectedValue(new Error("widget relay unavailable"))
      mocks.curated.mockResolvedValue(communityResult([makeWidget("owner-only", owner)]))
      const {installBuiltinExtensions} = await import("./builtin")
      const settings = await import("./settings")
      await installBuiltinExtensions()

      expect(get(settings.defaultExtensionWidgets).map(widget => widget.identifier)).toEqual([
        "owner-only",
      ])
    },
  )
})
