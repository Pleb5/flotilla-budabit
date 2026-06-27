// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  parseCommunityDefinition,
} from "@app/core/community"
import {
  makeAddressablePublicationRef,
  makeTargetedPublicationForCommunity,
} from "@app/core/community-targeting"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial

    return {
      get: vi.fn(() => value),
      set: vi.fn((next: T) => {
        value = next
      }),
      subscribe: vi.fn((run: (value: T) => void) => {
        run(value)
        return () => {}
      }),
    }
  }

  const load = vi.fn()
  const loadCommunityEvents = vi.fn(async (relays: string[], filters: any[], options?: any) => {
    const events: any[] = []
    await load({
      relays,
      filters,
      options,
      onEvent: (event: any) => events.push(event),
    })

    return events
  })

  return {
    publishThunk: vi.fn(),
    load,
    loadCommunityEvents,
    pushToast: vi.fn(),
      signer: createStore(null),
      pubkey: createStore(undefined as string | undefined),
      goto: vi.fn(),
      activeRepoClass: createStore(null),
    activeCommunityDefinition: createStore(undefined as any),
    activeCommunityProfileListEvents: createStore([] as any[]),
    activeCommunityRelayHints: createStore([] as string[]),
    activeCommunityRelays: createStore([] as string[]),
    activeCommunityReportState: createStore(undefined as any),
  }
})

const communityPubkey = "a".repeat(64)
const calendarWriterPubkey = "b".repeat(64)
const calendarMemberPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const communityDefinition = parseCommunityDefinition(
  makeEvent({
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: communityPubkey,
    tags: [
      ["content", "Events and meetups"],
      ["k", String(EVENT_TIME)],
      ["a", `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`],
    ],
  }),
)!

const calendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", "Events and meetups"],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const calendarTargetingEvent = makeEvent({
  id: "target-1",
  pubkey: calendarWriterPubkey,
  kind: TARGETED_PUBLICATION_KIND,
  tags: makeTargetedPublicationForCommunity({
    targetingId: "target-1",
    originalKind: EVENT_TIME,
    originalRef: makeAddressablePublicationRef({
      kind: EVENT_TIME,
      pubkey: calendarWriterPubkey,
      identifier: "event-1",
      relay: "wss://relay.example.com/",
    }),
    communityPubkey,
    communityRelay: "wss://relay.example.com/",
  }).tags,
})

const calendarEvent = makeEvent({
  id: "calendar-event-1",
  pubkey: calendarWriterPubkey,
  kind: EVENT_TIME,
  tags: [
    ["d", "event-1"],
    ["title", "Community meetup"],
  ],
})

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  signer: mocks.signer,
  pubkey: mocks.pubkey,
}))

vi.mock("$app/navigation", () => ({
  goto: mocks.goto,
}))

vi.mock("@app/core/git-state", () => ({
  activeRepoClass: mocks.activeRepoClass,
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityDefinition: mocks.activeCommunityDefinition,
  activeCommunityProfileListEvents: mocks.activeCommunityProfileListEvents,
  activeCommunityRelayHints: mocks.activeCommunityRelayHints,
  activeCommunityRelays: mocks.activeCommunityRelays,
  activeCommunityReportState: mocks.activeCommunityReportState,
  loadCommunityEvents: mocks.loadCommunityEvents,
}))

vi.mock("@welshman/net", () => ({
  PublishStatus: {Success: "success"},
  load: mocks.load,
}))

vi.mock("@app/util/toast", () => ({
  pushToast: mocks.pushToast,
}))

type FakeWindow = {
  postMessage: ReturnType<typeof vi.fn>
}

const makeSourceWindow = (): FakeWindow => ({
  postMessage: vi.fn(),
})

const makeExtension = (overrides: Record<string, any> = {}) => {
  const iframeWindow = makeSourceWindow()
  const widget = {
    id: "test-widget-event",
    kind: 30033,
    content: "Test",
    pubkey: "a".repeat(64),
    tags: [["d", "test-widget"]],
    identifier: "test-widget",
    widgetType: "tool",
    buttons: [],
    permissions: [],
    ...(overrides.widget || {}),
  }

  return {
    id: "test-extension",
    origin: "https://widget.example.com",
    type: "widget",
    iframe: {contentWindow: iframeWindow},
    repoContext: null,
    ...overrides,
    widget,
    iframeWindow,
  }
}

const storagePermissions = ["storage:get", "storage:set", "storage:keys", "storage:remove"]

const makeStorageExtension = (overrides: Record<string, any> = {}) =>
  makeExtension({
    widget: {permissions: storagePermissions},
    ...overrides,
  })

const makeWidgetStorageExtension = (overrides: Record<string, any> = {}) =>
  makeExtension({
    type: "widget",
    widget: {
      id: "weather-event",
      kind: 30033,
      content: "Weather",
      pubkey: "a".repeat(64),
      tags: [["d", "weather"]],
      identifier: "weather",
      widgetType: "tool",
      buttons: [],
      permissions: storagePermissions,
    },
    ...overrides,
  })

const sendBridgeRequest = async (
  bridge: any,
  extension: any,
  action: string,
  payload: Record<string, any>,
) => {
  const source = makeSourceWindow()
  await bridge.handleMessage({
    data: {id: `${action}-request`, type: "request", action, payload},
    source,
    origin: extension.origin,
  } as any)

  return source.postMessage.mock.calls.at(-1)?.[0].payload
}

const getLocalStorageKeys = () =>
  Array.from({length: localStorage.length}, (_, index) => localStorage.key(index)).filter(Boolean)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  mocks.publishThunk.mockReturnValue({complete: Promise.resolve(), results: {}})
  mocks.load.mockResolvedValue(undefined)
  mocks.goto.mockResolvedValue(undefined)
  mocks.pubkey.set(undefined)
  mocks.activeRepoClass.set(null)
  mocks.activeCommunityDefinition.set(undefined)
  mocks.activeCommunityProfileListEvents.set([])
  mocks.activeCommunityRelayHints.set([])
  mocks.activeCommunityRelays.set([])
  mocks.activeCommunityReportState.set(undefined)
})

afterEach(() => {
  localStorage.clear()
})

describe("ExtensionBridge", () => {
  it("posts events to the extension origin and uses '*' only for sandboxed iframes", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    bridge.post("ui:toast", {message: "hello"})

    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {type: "event", action: "ui:toast", payload: {message: "hello"}},
      "https://widget.example.com",
    )

    const sandboxed = makeExtension({origin: "null"})
    const sandboxedBridge = new ExtensionBridge(sandboxed as any)
    sandboxedBridge.post("ui:toast", {message: "hello"})

    expect(sandboxed.iframeWindow.postMessage).toHaveBeenCalledWith(
      {type: "event", action: "ui:toast", payload: {message: "hello"}},
      "*",
    )
  })

  it("rejects privileged actions when the extension does not have permission", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    const source = makeSourceWindow()

    await bridge.handleMessage({
      data: {id: "req-1", type: "request", action: "storage:get", payload: {key: "secret"}},
      source,
      origin: extension.origin,
    } as any)

    expect(source.postMessage).toHaveBeenCalledWith(
      {
        id: "req-1",
        type: "response",
        action: "storage:get",
        payload: {error: 'Extension not permitted to perform "storage:get"'},
      },
      extension.origin,
    )
  })

  it("navigates the host app through ui:navigate", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {
        path: "/c/npub1example/calendar/event-1",
      }),
    ).resolves.toEqual({status: "ok"})
    expect(mocks.goto).toHaveBeenCalledWith("/c/npub1example/calendar/event-1")

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {path: "https://example.com/"}),
    ).resolves.toEqual({error: "Invalid navigation path"})
  })

  it("writes storage values to encoded v2 keys and reports decoded keys", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "ext:with/slash"})
    const bridge = new ExtensionBridge(extension as any)
    const storageKey = "theme:color"
    const expectedKey = "budabit:ext:v2:ext%3Awith%2Fslash:global:theme%3Acolor"

    await expect(
      sendBridgeRequest(bridge, extension, "storage:set", {
        key: storageKey,
        data: {mode: "dark"},
      }),
    ).resolves.toEqual({status: "ok"})

    expect(localStorage.getItem(expectedKey)).toBe(JSON.stringify({mode: "dark"}))
    expect(localStorage.getItem("flotilla:ext:ext:with/slash:theme:color")).toBeNull()

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: storageKey}),
    ).resolves.toEqual({status: "ok", data: {mode: "dark"}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: [storageKey],
    })

    await expect(
      sendBridgeRequest(bridge, extension, "storage:remove", {key: storageKey}),
    ).resolves.toEqual({status: "ok"})
    expect(localStorage.getItem(expectedKey)).toBeNull()
  })

  it("falls back to legacy storage keys without duplicating storage:keys results", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "legacy-ext"})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem("flotilla:ext:legacy-ext:settings", JSON.stringify({legacy: true}))
    localStorage.setItem("flotilla:ext:legacy-ext:other", JSON.stringify({old: true}))
    localStorage.setItem("budabit:ext:v2:legacy-ext:global:settings", JSON.stringify({v2: true}))

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "settings"}),
    ).resolves.toEqual({status: "ok", data: {v2: true}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: ["settings", "other"],
    })
  })

  it("encodes repo-scoped storage with the repo address component", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "a".repeat(64), name: "repo:name"}
    const extension = makeStorageExtension({id: "repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)
    const expectedRepoAddress = `30617:${repoContext.pubkey}:${repoContext.name}`
    const expectedKey = `budabit:ext:v2:repo-ext:repo:${encodeURIComponent(expectedRepoAddress)}:build%3Astate`

    await expect(
      sendBridgeRequest(bridge, extension, "storage:set", {
        key: "build:state",
        repoScoped: true,
        data: {status: "green"},
      }),
    ).resolves.toEqual({status: "ok"})

    expect(localStorage.getItem(expectedKey)).toBe(JSON.stringify({status: "green"}))
    expect(getLocalStorageKeys().some(key => key?.includes(`repo:${repoContext.pubkey}:`))).toBe(
      false,
    )

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {
        key: "build:state",
        repoScoped: true,
      }),
    ).resolves.toEqual({status: "ok", data: {status: "green"}})
  })

  it("reads legacy repo-scoped storage when no v2 value exists", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "b".repeat(64), name: "repo"}
    const extension = makeStorageExtension({id: "repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem(
      `flotilla:ext:repo-ext:repo:${repoContext.pubkey}:${repoContext.name}:settings`,
      JSON.stringify({legacyRepo: true}),
    )

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "settings", repoScoped: true}),
    ).resolves.toEqual({status: "ok", data: {legacyRepo: true}})
  })

  it("falls back to bare widget identifier legacy storage for canonical widget ids", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeWidgetStorageExtension({id: `30033:${"a".repeat(64)}:weather`})
    const bridge = new ExtensionBridge(extension as any)

    localStorage.setItem("flotilla:ext:weather:prefs", JSON.stringify({legacyWidget: true}))

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {legacyWidget: true}})
    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: ["prefs"],
    })
  })

  it("stores same-d widgets from different publishers under separate v2 keys", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const first = makeWidgetStorageExtension({id: `30033:${"a".repeat(64)}:weather`})
    const second = makeWidgetStorageExtension({
      id: `30033:${"b".repeat(64)}:weather`,
      widget: {
        ...makeWidgetStorageExtension().widget,
        pubkey: "b".repeat(64),
        permissions: storagePermissions,
      },
    })
    const firstBridge = new ExtensionBridge(first as any)
    const secondBridge = new ExtensionBridge(second as any)

    await sendBridgeRequest(firstBridge, first, "storage:set", {key: "prefs", data: {unit: "c"}})
    await sendBridgeRequest(secondBridge, second, "storage:set", {key: "prefs", data: {unit: "f"}})

    await expect(
      sendBridgeRequest(firstBridge, first, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {unit: "c"}})
    await expect(
      sendBridgeRequest(secondBridge, second, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: {unit: "f"}})

    expect(getLocalStorageKeys().sort()).toEqual([
      `budabit:ext:v2:30033%3A${"a".repeat(64)}%3Aweather:global:prefs`,
      `budabit:ext:v2:30033%3A${"b".repeat(64)}%3Aweather:global:prefs`,
    ])
  })

  it("ignores messages from the wrong origin or source window", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const targetWindow = makeSourceWindow()
    const bridge = new ExtensionBridge(makeExtension() as any)
    bridge.attachHandlers(targetWindow as any)

    const wrongOriginSource = makeSourceWindow()
    await bridge.handleMessage({
      data: {id: "req-1", type: "request", action: "ui:toast", payload: {message: "hello"}},
      source: wrongOriginSource,
      origin: "https://evil.example.com",
    } as any)

    const wrongSource = makeSourceWindow()
    await bridge.handleMessage({
      data: {id: "req-2", type: "request", action: "ui:toast", payload: {message: "hello"}},
      source: wrongSource,
      origin: "https://widget.example.com",
    } as any)

    expect(mocks.pushToast).not.toHaveBeenCalled()
    expect(wrongOriginSource.postMessage).not.toHaveBeenCalled()
    expect(wrongSource.postMessage).not.toHaveBeenCalled()

    bridge.detach()
  })

  it("routes matching responses back to the pending request promise", async () => {
    const {ExtensionBridge} = await import("./bridge")

    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)
    const requestPromise = bridge.request("ui:toast", {message: "hello"})

    const [message, origin] = extension.iframeWindow.postMessage.mock.calls[0]
    expect(origin).toBe(extension.origin)

    await bridge.handleMessage({
      data: {
        id: message.id,
        type: "response",
        action: "ui:toast",
        payload: {status: "ok"},
      },
      source: extension.iframe.contentWindow,
      origin: extension.origin,
    } as any)

    await expect(requestPromise).resolves.toEqual({status: "ok"})
  })

  it("checks descriptor write capabilities through active section mappings", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextSessionId: expect.any(String),
      contextVersion: 0,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          sectionNames: ["Events and meetups"],
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: ["Events and meetups"],
          canWrite: true,
          canModerate: true,
        },
      ],
    })
  })

  it("checks descriptor write capabilities through extension runtime context", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityRuntimeContext: {
        definition: communityDefinition,
        profileListEvents: [calendarProfileList],
        relays: ["wss://preview.example.com/"],
        relayHints: ["wss://preview.example.com/"],
        communityContext: {
          version: 1,
          contextSessionId: "preview-community-context",
          contextVersion: 3,
          pubkey: communityPubkey,
          ncommunity: "",
          relays: ["wss://preview.example.com/"],
          relayHints: ["wss://preview.example.com/"],
          blossomServers: [],
          sections: [],
          viewer: {pubkey: calendarMemberPubkey, isOwner: false, isBanned: false},
        },
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextSessionId: "preview-community-context",
      contextVersion: 3,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://preview.example.com/"],
      expect.any(Array),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("recognizes descriptor writers without treating them as section moderators", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
  })

  it("hydrates profile-list events before resolving descriptor capabilities", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === PROFILE_LIST_KIND) onEvent?.(calendarProfileList)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        {
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        },
      ],
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [PROFILE_LIST_KIND],
          authors: [calendarWriterPubkey],
          "#d": ["Events and meetups"],
        }),
      ]),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("returns the latest moderator-authored shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 30078) return
      onEvent?.(
        makeEvent({
          id: "invalid-config",
          kind: 30078,
          pubkey: "d".repeat(64),
          created_at: 100,
          content: JSON.stringify({header: "Invalid", eventRef: "invalid"}),
          tags: [["d", filters[0]["#d"][0]]],
        }),
      )
      onEvent?.(
        makeEvent({
          id: "valid-config",
          kind: 30078,
          pubkey: calendarWriterPubkey,
          created_at: 90,
          content: JSON.stringify({header: "Featured", eventRef: "31923:event"}),
          tags: [["d", filters[0]["#d"][0]]],
        }),
      )
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      event: {id: "valid-config"},
      config: {header: "Featured", eventRef: "31923:event"},
    })
  })

  it("only lets descriptor moderators publish shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:publishSharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRef: "31923:event"},
      }),
    ).resolves.toMatchObject({error: "Current user is not a moderator for the requested community descriptors"})

    mocks.pubkey.set(calendarWriterPubkey)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {},
      event: {id: "published-config"},
    })

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRef: "31923:event"},
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.com/"],
        event: expect.objectContaining({kind: 30078}),
      }),
    )
  })

  it("uses widget relay hints when community definition relays are empty", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelayHints.set(["wss://hint.example.com/"])
    mocks.activeCommunityRelays.set([])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityContext: {
        version: 1,
        contextSessionId: "community-context-test",
        contextVersion: 0,
        pubkey: communityPubkey,
        ncommunity: "",
        relays: ["wss://hint.example.com/"],
        relayHints: ["wss://hint.example.com/"],
        blossomServers: [],
        sections: [],
        viewer: {pubkey: calendarWriterPubkey, isOwner: false, isBanned: false},
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 0,
      capabilities: [
        {
          descriptor: {kind: EVENT_TIME},
          canWrite: true,
        },
      ],
    })
  })

  it("returns descriptor errors instead of falling back to default sections", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: 1}],
      }),
    ).resolves.toEqual({error: "No active community section supports event descriptor 1"})
  })

  it("queries community events through descriptor section mappings", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstKind = filters?.[0]?.kinds?.[0]

      if (firstKind === TARGETED_PUBLICATION_KIND) {
        onEvent?.(calendarTargetingEvent)
      } else if (firstKind === EVENT_TIME) {
        onEvent?.(calendarEvent)
      }
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
      relays: ["wss://relay.example.com/"],
      descriptors: [{kind: EVENT_TIME}],
      contextSessionId: expect.any(String),
      contextVersion: 0,
    })
    const loadCalls = mocks.load.mock.calls.map(([args]) => args)
    expect(loadCalls).toContainEqual(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            kinds: [TARGETED_PUBLICATION_KIND],
            "#p": [communityPubkey],
            "#k": [String(EVENT_TIME)],
          }),
        ],
      }),
    )
    expect(loadCalls).toContainEqual(
      expect.objectContaining({
        filters: [
          {
            kinds: [EVENT_TIME],
            authors: [calendarWriterPubkey],
            "#d": ["event-1"],
            limit: 5,
          },
        ],
      }),
    )
  })

  it("validates nostr query payloads and deduplicates returned events", async () => {
    const {ExtensionBridge} = await import("./bridge")

    mocks.load.mockImplementation(async ({onEvent}: any) => {
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-2"})
    })

    const extension = makeExtension({
      widget: {permissions: ["nostr:query"]},
    })
    const bridge = new ExtensionBridge(extension as any)
    const source = makeSourceWindow()

    await bridge.handleMessage({
      data: {
        id: "query-ok",
        type: "request",
        action: "nostr:query",
        payload: {
          relays: ["wss://relay.example.com", "wss://relay.example.com"],
          filter: {kinds: [30301], "#d": ["widget-1"], limit: 10},
        },
      },
      source,
      origin: extension.origin,
    } as any)

    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.com/"],
      }),
    )
    expect(source.postMessage).toHaveBeenLastCalledWith(
      {
        id: "query-ok",
        type: "response",
        action: "nostr:query",
        payload: {status: "ok", events: [{id: "evt-1"}, {id: "evt-2"}]},
      },
      extension.origin,
    )

    await bridge.handleMessage({
      data: {
        id: "query-bad",
        type: "request",
        action: "nostr:query",
        payload: {
          relays: ["https://not-a-websocket.example.com"],
          filter: {kinds: [1], limit: 501},
        },
      },
      source,
      origin: extension.origin,
    } as any)

    expect(source.postMessage).toHaveBeenLastCalledWith(
      {
        id: "query-bad",
        type: "response",
        action: "nostr:query",
        payload: {error: "No valid relays provided"},
      },
      extension.origin,
    )
  })
})
