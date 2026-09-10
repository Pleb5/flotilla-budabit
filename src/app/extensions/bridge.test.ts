// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {EVENT_TIME, THREAD, type TrustedEvent} from "@welshman/util"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {buildRepoExtensionContext, getRepoExtensionInstanceId} from "./repo-context"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_THREADS,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
  type CommunityDefinitionSectionInput,
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
  const request = vi.fn()
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
  const loadCommunityEventsWithStatus = vi.fn(
    async (relays: string[], filters: any[], options?: any) => ({
      events: await loadCommunityEvents(relays, filters, options),
      complete: true,
      timedOutRelays: [],
      failedRelays: [],
    }),
  )
  const authenticateCommunityRelays = vi.fn(async () => undefined)
  const getPubkeyOutboxRelays = vi.fn(() => [] as string[])

  return {
    publishThunk: vi.fn(),
    load,
    request,
    loadCommunityEvents,
    loadCommunityEventsWithStatus,
    authenticateCommunityRelays,
    getPubkeyOutboxRelays,
    pushToast: vi.fn(),
    repository: {query: vi.fn((_filters?: any[]) => [] as any[])},
    signer: createStore(null),
    pubkey: createStore(undefined as string | undefined),
    goto: vi.fn(),
    activeRepoClass: createStore(null),
    activeExactCommunityDefinition: createStore(undefined as any),
    activeExactCommunityPointer: createStore(undefined as any),
    activeCommunityPermissionStatus: createStore<{
      communityAddress: string
      key: string
      loading: boolean
      loaded: boolean
      complete?: boolean
      hasCachedEvents: boolean
    }>({
      communityAddress: "",
      key: "",
      loading: false,
      loaded: false,
      complete: false,
      hasCachedEvents: false,
    }),
    activeCommunityProfileListEvents: createStore([] as any[]),
    activeCommunityRelays: createStore([] as string[]),
    activeCommunityReportState: createStore(undefined as any),
  }
})

const testPubkey = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = testPubkey(51)
const communityId = testPubkey(57)
const communityPointer = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId,
  relayHints: ["wss://relay.example.com/"],
})!
const calendarWriterPubkey = testPubkey(52)
const calendarMemberPubkey = testPubkey(53)
const outsiderPubkey = testPubkey(54)
const streamManagerPubkey = testPubkey(55)
const zapStreamProviderPubkey = "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5"

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

const profileListIdentifier = (communityId: string, value: string) =>
  `${communityId}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

const makeDefinition = (
  sections: CommunityDefinitionSectionInput[],
  id = "community-definition",
  communityId: string = communityPointer.communityId,
) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      kind: COMMUNITY_DEFINITION_KIND,
      content: "",
      tags: buildCommunityDefinition({
        communityId,
        name: "Test community",
        relays: ["wss://relay.example.com"],
        sections: sections.map(section => ({
          ...section,
          profileLists: section.profileLists.map(ref => {
            const [kind, owner] = ref.address.split(":")
            return {
              ...ref,
              address: `${kind}:${owner}:${profileListIdentifier(communityId, section.name)}`,
            }
          }),
        })),
      }).tags,
    }),
  )!

const communityDefinition = makeDefinition([
  {
    name: "Events and meetups",
    kinds: [{kind: EVENT_TIME}],
    profileLists: [{address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`}],
  },
])
const communityDefinitionWithRelays = communityDefinition

const calendarProfileList = makeEvent({
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", profileListIdentifier(communityPointer.communityId, "Events and meetups")],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const partialCommunityDefinition = makeDefinition(
  [
    {
      name: "Calendar",
      kinds: [{kind: EVENT_TIME}],
      profileLists: [{address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Calendar`}],
    },
    {
      name: "Calls",
      kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM}],
      profileLists: [{address: `${PROFILE_LIST_KIND}:${outsiderPubkey}:Calls`}],
    },
    {
      name: "Streams",
      kinds: [{kind: 30311}],
      profileLists: [{address: `${PROFILE_LIST_KIND}:${streamManagerPubkey}:Streams`}],
    },
  ],
  "partial-community-definition",
)

const partialCalendarProfileList = makeEvent({
  id: "partial-calendar-profile-list",
  kind: PROFILE_LIST_KIND,
  pubkey: calendarWriterPubkey,
  tags: [
    ["d", profileListIdentifier(communityPointer.communityId, "Calendar")],
    ["p", calendarWriterPubkey],
    ["p", calendarMemberPubkey],
  ],
})

const makePartialRuntimeContext = (userPubkey: string, authorityEvidenceSettled: boolean) => ({
  community: communityPointer,
  definition: partialCommunityDefinition,
  profileListEvents: [partialCalendarProfileList],
  ...(authorityEvidenceSettled ? {authorityEvidenceSettled: true} : {}),
  relays: ["wss://relay.example.com/"],
  relayHints: ["wss://relay.example.com/"],
  communityContext: {
    version: 2 as const,
    contextSessionId: "partial-community-context",
    contextVersion: 1,
    communityId: communityPointer.communityId,
    ownerPubkey: communityPointer.ownerPubkey,
    definitionAddress: communityPointer.address,
    naddr: communityPointer.naddr,
    relays: ["wss://relay.example.com/"],
    relayHints: ["wss://relay.example.com/"],
    blossomServers: [],
    sections: [],
    viewer: {pubkey: userPubkey, isOwner: userPubkey === communityPubkey, isBanned: false},
  },
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
    community: communityPointer,
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
const calendarEventRef = `${EVENT_TIME}:${calendarWriterPubkey}:event-1`

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
  repository: mocks.repository,
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
  activeExactCommunityDefinition: mocks.activeExactCommunityDefinition,
  activeExactCommunityPointer: mocks.activeExactCommunityPointer,
  activeCommunityPermissionStatus: mocks.activeCommunityPermissionStatus,
  activeCommunityProfileListEvents: mocks.activeCommunityProfileListEvents,
  activeExactCommunityRelays: mocks.activeCommunityRelays,
  activeCommunityReportState: mocks.activeCommunityReportState,
  authenticateCommunityRelays: mocks.authenticateCommunityRelays,
  getCommunityBootstrapRelays: vi.fn((relays: string[] = []) => relays),
  getCommunityPermissionStatusKeyPrefix: vi.fn(() => "expected:"),
  getCommunityPermissionReadiness: vi.fn(
    ({status, communityAddress}: {status: any; communityAddress: string}) => {
      if (status.communityAddress !== communityAddress || !status.key.startsWith("expected:")) {
        return "loading"
      }
      if (status.hasCachedEvents) return "ready"
      if (status.loading && !status.loaded) return "loading"
      return status.complete ? "ready" : "unavailable"
    },
  ),
  getPubkeyOutboxRelays: mocks.getPubkeyOutboxRelays,
  loadCommunityEvents: mocks.loadCommunityEvents,
  loadCommunityEventsWithStatus: mocks.loadCommunityEventsWithStatus,
}))

vi.mock("@welshman/net", () => ({
  PublishStatus: {Success: "success"},
  load: mocks.load,
  request: mocks.request,
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
  mocks.request.mockImplementation((options: any) => {
    options.onStart?.(options.relays[0])
    return new Promise(resolve => {
      options.signal?.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  mocks.repository.query.mockReturnValue([])
  mocks.getPubkeyOutboxRelays.mockReturnValue([])
  mocks.goto.mockResolvedValue(undefined)
  mocks.pubkey.set(undefined)
  mocks.activeRepoClass.set(null)
  mocks.activeExactCommunityDefinition.set(undefined)
  mocks.activeExactCommunityPointer.set(communityPointer)
  mocks.activeCommunityPermissionStatus.set({
    communityAddress: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  })
  mocks.activeCommunityProfileListEvents.set([])
  mocks.activeCommunityRelays.set([])
  mocks.activeCommunityReportState.set(undefined)
})

afterEach(() => {
  vi.useRealTimers()
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

  it("authenticates active community relays before publishing to them", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const communityRelay = "wss://community.example.com/"
    const publicRelay = "wss://public.example.com/"
    mocks.activeExactCommunityPointer.set({...communityPointer, relayHints: [communityRelay]})
    mocks.activeCommunityRelays.set([communityRelay])
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {
        [communityRelay]: {status: "success"},
        [publicRelay]: {status: "success"},
      },
    })

    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    const response = await sendBridgeRequest(bridge, extension, "nostr:publish", {
      event: {kind: 30311, created_at: 1, content: "", tags: []},
      relays: [communityRelay, publicRelay],
    })

    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith([communityRelay], {
      priorityRelays: [communityRelay],
    })
    expect(mocks.authenticateCommunityRelays.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishThunk.mock.invocationCallOrder[0],
    )
    expect(response.result.successCount).toBe(2)
  })

  it("redacts relay queries from publication logs and responses", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const relay = "wss://relay.example.com/GRASP?token=AbC%2F123"
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {[relay]: {status: "success"}},
      event: {id: "event-id"},
    })
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)

    const response = await sendBridgeRequest(bridge, extension, "nostr:publish", {
      event: {kind: 30311, created_at: 1, content: "", tags: []},
      relays: [relay],
    })

    expect(response.result.relays).toEqual(["wss://relay.example.com/GRASP"])
    expect(JSON.stringify(log.mock.calls)).not.toContain("AbC%2F123")
  })

  it("rejects community-scoped events from generic nostr publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {
          kind: 30311,
          created_at: 1,
          content: "",
          tags: [["h", communityId]],
        },
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({
      error: "Community-scoped events must use a dedicated community publish capability",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {kind: 30222, created_at: 1, content: "", tags: [["d", "target"]]},
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({
      error: "Community-scoped events must use a dedicated community publish capability",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("verifies externally signed events before publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const relay = "wss://relay.example.com/"
    const signedEvent = finalizeEvent(
      {kind: 30311, created_at: 1, content: "", tags: []},
      new Uint8Array(32).fill(1),
    )
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {[relay]: {status: "success"}},
      event: signedEvent,
    })

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: signedEvent,
        relays: [relay],
      }),
    ).resolves.toMatchObject({status: "ok", result: {eventId: signedEvent.id, successCount: 1}})

    mocks.publishThunk.mockClear()
    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {...signedEvent, content: "tampered"},
        relays: [relay],
      }),
    ).resolves.toEqual({error: "Externally signed event failed cryptographic verification"})
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("returns failure when generic publishing is not accepted by any relay", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({widget: {permissions: ["nostr:publish"]}})
    const bridge = new ExtensionBridge(extension as any)
    mocks.publishThunk.mockReturnValue({complete: Promise.resolve(), results: {}})

    await expect(
      sendBridgeRequest(bridge, extension, "nostr:publish", {
        event: {kind: 30311, created_at: 1, content: "", tags: []},
        relays: ["wss://relay.example.com/"],
      }),
    ).resolves.toEqual({error: "Event was not accepted by any relay"})
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
        payload: {
          error: 'Extension not permitted to perform "storage:get"',
          code: "CAPABILITY_NOT_AUTHORIZED",
        },
      },
      extension.origin,
    )
  })

  it("standardizes unsupported and unauthorized capability errors", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const unauthorizedExtension = makeExtension()
    const unauthorizedBridge = new ExtensionBridge(unauthorizedExtension as any)

    await expect(
      sendBridgeRequest(unauthorizedBridge, unauthorizedExtension, "nostr:future", {}),
    ).resolves.toEqual({
      error: 'Extension not permitted to perform "nostr:future"',
      code: "CAPABILITY_NOT_AUTHORIZED",
    })

    const unsupportedExtension = makeExtension({widget: {permissions: ["nostr:future"]}})
    const unsupportedBridge = new ExtensionBridge(unsupportedExtension as any)
    await expect(
      sendBridgeRequest(unsupportedBridge, unsupportedExtension, "nostr:future", {}),
    ).resolves.toEqual({
      error: 'Host does not support "nostr:future"',
      code: "UNSUPPORTED_CAPABILITY",
    })
  })

  it("gates repository file access and rejects paths that can escape provider endpoints", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const listRepoFiles = vi.fn(async () => ({
      files: [{path: "src/app.ts", type: "file"}],
    }))
    const getFileContent = vi.fn(async () => ({content: "export {}"}))
    mocks.activeRepoClass.set({
      selectedBranch: "dev",
      mainBranch: "main",
      branches: [{name: "dev", commitId: "abc"}],
      listRepoFiles,
      getFileContent,
    } as any)

    const unauthorizedExtension = makeExtension()
    const unauthorizedBridge = new ExtensionBridge(unauthorizedExtension as any)
    await expect(
      sendBridgeRequest(unauthorizedBridge, unauthorizedExtension, "repo:getFile", {
        path: "src/app.ts",
      }),
    ).resolves.toEqual({
      error: 'Extension not permitted to perform "repo:getFile"',
      code: "CAPABILITY_NOT_AUTHORIZED",
    })

    const extension = makeExtension({
      widget: {permissions: ["repo:listFiles", "repo:getFile"]},
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "repo:listFiles", {path: "/src/"}),
    ).resolves.toMatchObject({
      status: "ok",
      files: [{path: "src/app.ts", type: "file"}],
      resolvedBranch: "dev",
    })
    expect(listRepoFiles).toHaveBeenCalledWith({path: "src", branch: "dev"})

    for (const path of ["../private", "src/../../private", "%2e%2e/private", "src\\private"]) {
      await expect(sendBridgeRequest(bridge, extension, "repo:getFile", {path})).resolves.toEqual({
        error: "Invalid repository path",
      })
    }
    expect(getFileContent).not.toHaveBeenCalled()

    await expect(
      sendBridgeRequest(bridge, extension, "repo:getFile", {path: "/src/app.ts/"}),
    ).resolves.toEqual({
      status: "ok",
      path: "src/app.ts",
      content: "export {}",
      resolvedBranch: "dev",
    })
    expect(getFileContent).toHaveBeenCalledWith({path: "src/app.ts", branch: "dev"})
  })

  it("returns host subscription IDs, forwards matched events, and cleans up on detach", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({
      widget: {permissions: ["nostr:subscribe", "nostr:unsubscribe"]},
    })
    const bridge = new ExtensionBridge(extension as any)

    const response = await sendBridgeRequest(bridge, extension, "nostr:subscribe", {
      subscriptionId: "client-selected-id",
      relays: ["wss://relay.example"],
      filter: {kinds: [30301], "#d": ["board"], limit: 20},
    })

    expect(response).toMatchObject({status: "ok", subscriptionId: expect.stringMatching(/^sub-/)})
    expect(response.subscriptionId).not.toBe("client-selected-id")
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example/"],
        lifetime: "live",
        priority: -100,
        owner: "extension:test-extension",
      }),
    )

    const options = mocks.request.mock.calls[0][0]
    options.onEvent(makeEvent({kind: 30301, tags: [["d", "board"]]}), "wss://relay.example/")
    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "event",
        action: "nostr:subscription:event",
        payload: {
          subscriptionId: response.subscriptionId,
          event: expect.objectContaining({kind: 30301}),
        },
      },
      extension.origin,
    )

    bridge.detach()
    expect(options.signal.aborted).toBe(true)
  })

  it("forwards subscription EOSE separately for each relay", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension({
      widget: {permissions: ["nostr:subscribe", "nostr:unsubscribe"]},
    })
    const bridge = new ExtensionBridge(extension as any)

    const response = await sendBridgeRequest(bridge, extension, "nostr:subscribe", {
      relays: ["wss://one.example", "wss://two.example"],
      filter: {kinds: [30301], "#d": ["board"], limit: 20},
    })
    const firstRelayBackfill = mocks.request.mock.calls[0][0]
    const secondRelayBackfill = mocks.request.mock.calls[2][0]

    firstRelayBackfill.onEose("wss://one.example/")
    secondRelayBackfill.onEose("wss://two.example/")

    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "event",
        action: "nostr:eose",
        payload: {subscriptionId: response.subscriptionId, relay: "wss://one.example/"},
      },
      extension.origin,
    )
    expect(extension.iframeWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "event",
        action: "nostr:eose",
        payload: {subscriptionId: response.subscriptionId, relay: "wss://two.example/"},
      },
      extension.origin,
    )
    bridge.detach()
  })

  it("navigates the host app through ui:navigate", async () => {
    vi.useFakeTimers()
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeExtension()
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {
        path: "/c/npub1example/calendar/event-1",
      }),
    ).resolves.toEqual({status: "ok"})
    expect(mocks.goto).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(mocks.goto).toHaveBeenCalledWith("/c/npub1example/calendar/event-1")

    await expect(
      sendBridgeRequest(bridge, extension, "ui:navigate", {path: "https://example.com/"}),
    ).resolves.toEqual({error: "Invalid navigation path"})
    vi.useRealTimers()
  })

  it("forwards ui:resize requests to the widget resize callback", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const onResizeRequest = vi.fn()
    const extension = makeExtension({onResizeRequest})
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "ui:resize", {height: 640, width: 320}),
    ).resolves.toEqual({status: "ok"})
    expect(onResizeRequest).toHaveBeenCalledWith({height: 640, width: 320})
  })

  it("rejects invalid ui:resize dimensions", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const onResizeRequest = vi.fn()
    const extension = makeExtension({onResizeRequest})
    const bridge = new ExtensionBridge(extension as any)

    await expect(sendBridgeRequest(bridge, extension, "ui:resize", {height: -1})).resolves.toEqual({
      error: "Invalid resize height: expected positive finite number",
    })
    await expect(sendBridgeRequest(bridge, extension, "ui:resize", {})).resolves.toEqual({
      error: "Invalid resize payload: expected positive finite height or width",
    })
    expect(onResizeRequest).not.toHaveBeenCalled()
  })

  it("writes storage values to encoded extension keys and reports decoded keys", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "ext:with/slash"})
    const bridge = new ExtensionBridge(extension as any)
    const storageKey = "theme:color"
    const expectedKey = "budabit:extension:ext%3Awith%2Fslash:global:theme%3Acolor"

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

  it("enforces the storage value limit using UTF-8 bytes", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension()
    const bridge = new ExtensionBridge(extension as any)
    const multibyteValue = "é".repeat(600_000)

    await expect(
      sendBridgeRequest(bridge, extension, "storage:set", {
        key: "large-value",
        data: multibyteValue,
      }),
    ).resolves.toEqual({error: "Value exceeds maximum size of 1048576 bytes"})
    expect(localStorage.getItem("budabit:extension:test-extension:global:large-value")).toBeNull()
  })

  it("encodes repo-scoped storage with the repo address component", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "a".repeat(64), name: "repo:name"}
    const extension = makeStorageExtension({id: "repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)
    const expectedRepoAddress = `30617:${repoContext.pubkey}:${repoContext.name}`
    const expectedKey = `budabit:extension:repo-ext:repo:${encodeURIComponent(expectedRepoAddress)}:build%3Astate`

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

  it.each([false, true])(
    "keeps repo-tab storage across renames and isolates equal display names (repoScoped=%s)",
    async repoScoped => {
      const {ExtensionBridge} = await import("./bridge")
      const owner = "a".repeat(64)
      const makeRepoTab = (identifier: string, displayName: string) => {
        const repoContext = buildRepoExtensionContext(
          {
            repoEvent: {pubkey: owner, tags: [["d", identifier]]},
            identifier,
            name: displayName,
          },
          "naddr",
          ["wss://repo.example/"],
        )!
        const extension = makeStorageExtension({
          id: getRepoExtensionInstanceId("builds", repoContext),
          repoContext,
        })
        return {extension, bridge: new ExtensionBridge(extension as any)}
      }
      const initial = makeRepoTab("stable-id", "My Great Repo")
      await expect(
        sendBridgeRequest(initial.bridge, initial.extension, "storage:set", {
          key: "cursor",
          data: {page: 3},
          repoScoped,
        }),
      ).resolves.toEqual({status: "ok"})
      const renamed = makeRepoTab("stable-id", "名前 with spaces!")
      expect(renamed.extension.id).toBe(initial.extension.id)
      await expect(
        sendBridgeRequest(renamed.bridge, renamed.extension, "storage:get", {
          key: "cursor",
          repoScoped,
        }),
      ).resolves.toEqual({status: "ok", data: {page: 3}})
      await expect(
        sendBridgeRequest(renamed.bridge, renamed.extension, "context:getRepo", {}),
      ).resolves.toMatchObject({
        status: "ok",
        repoContext: {
          name: "stable-id",
          displayName: "名前 with spaces!",
          address: `30617:${owner}:stable-id`,
        },
      })
      const other = makeRepoTab("different-id", "名前 with spaces!")
      await expect(
        sendBridgeRequest(other.bridge, other.extension, "storage:get", {
          key: "cursor",
          repoScoped,
        }),
      ).resolves.toEqual({status: "ok", data: null})
    },
  )

  it("migrates shipped global storage namespaces and removes every copy", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "legacy-ext"})
    const bridge = new ExtensionBridge(extension as any)
    const v2Key = "budabit:ext:v2:legacy-ext:global:v2%3Akey"
    const flotillaKey = "flotilla:ext:legacy-ext:flotilla:key"
    localStorage.setItem(v2Key, JSON.stringify({source: "v2"}))
    localStorage.setItem(flotillaKey, JSON.stringify({source: "flotilla"}))

    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: ["flotilla:key", "v2:key"],
    })
    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "v2:key"}),
    ).resolves.toEqual({status: "ok", data: {source: "v2"}})
    expect(localStorage.getItem(v2Key)).toBeNull()
    expect(localStorage.getItem("budabit:extension:legacy-ext:global:v2%3Akey")).not.toBeNull()

    await sendBridgeRequest(bridge, extension, "storage:remove", {key: "flotilla:key"})
    await sendBridgeRequest(bridge, extension, "storage:remove", {key: "v2:key"})
    expect(localStorage.length).toBe(0)
  })

  it("migrates shipped repo storage only within the exact repository scope", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const repoContext = {pubkey: "a".repeat(64), name: "repo:name"}
    const extension = makeStorageExtension({id: "legacy-repo-ext", repoContext})
    const bridge = new ExtensionBridge(extension as any)
    const repoAddress = `30617:${repoContext.pubkey}:${repoContext.name}`
    const v2Key = `budabit:ext:v2:legacy-repo-ext:repo:${encodeURIComponent(repoAddress)}:build%3Astate`
    const flotillaKey = `flotilla:ext:legacy-repo-ext:repo:${repoContext.pubkey}:${repoContext.name}:cache`
    localStorage.setItem(v2Key, JSON.stringify({source: "v2"}))
    localStorage.setItem(flotillaKey, JSON.stringify({source: "flotilla"}))

    await expect(sendBridgeRequest(bridge, extension, "storage:keys", {})).resolves.toEqual({
      status: "ok",
      keys: [],
    })
    await expect(
      sendBridgeRequest(bridge, extension, "storage:keys", {repoScoped: true}),
    ).resolves.toEqual({status: "ok", keys: ["build:state", "cache"]})
    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {
        key: "cache",
        repoScoped: true,
      }),
    ).resolves.toEqual({status: "ok", data: {source: "flotilla"}})
    expect(localStorage.getItem(flotillaKey)).toBeNull()
  })

  it("prefers current storage and clears lower-precedence legacy copies on write", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeStorageExtension({id: "precedence-ext"})
    const bridge = new ExtensionBridge(extension as any)
    localStorage.setItem("budabit:extension:precedence-ext:global:prefs", JSON.stringify("current"))
    localStorage.setItem("budabit:ext:v2:precedence-ext:global:prefs", JSON.stringify("v2"))
    localStorage.setItem("flotilla:ext:precedence-ext:prefs", JSON.stringify("flotilla"))

    await expect(
      sendBridgeRequest(bridge, extension, "storage:get", {key: "prefs"}),
    ).resolves.toEqual({status: "ok", data: "current"})
    await sendBridgeRequest(bridge, extension, "storage:set", {key: "prefs", data: "updated"})
    expect(getLocalStorageKeys()).toEqual(["budabit:extension:precedence-ext:global:prefs"])
  })

  it("stores same-d widgets from different publishers under separate keys", async () => {
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
      `budabit:extension:30033%3A${"a".repeat(64)}%3Aweather:global:prefs`,
      `budabit:extension:30033%3A${"b".repeat(64)}%3Aweather:global:prefs`,
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
    mocks.activeExactCommunityDefinition.set(communityDefinition)
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
        community: communityPointer,
        definition: communityDefinition,
        profileListEvents: [calendarProfileList],
        relays: ["wss://preview.example.com/"],
        relayHints: ["wss://preview.example.com/"],
        communityContext: {
          version: 2,
          contextSessionId: "preview-community-context",
          contextVersion: 3,
          communityId: communityPointer.communityId,
          ownerPubkey: communityPointer.ownerPubkey,
          definitionAddress: communityPointer.address,
          naddr: communityPointer.naddr,
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
  })

  it("deduplicates background refreshes for cached shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "cached-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached"}),
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])
    mocks.loadCommunityEventsWithStatus.mockReturnValueOnce(new Promise(() => undefined))

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)
    const payload = {
      namespace: "budabit-calendar-widget",
      key: "featured-calendar-event",
      descriptors: [{kind: EVENT_TIME}],
    }

    await sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload)
    await sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload)

    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("retries an incomplete empty shared-config refresh", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "cached-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: "{}",
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])
    mocks.loadCommunityEventsWithStatus
      .mockResolvedValueOnce({
        events: [],
        complete: false,
        timedOutRelays: [],
        failedRelays: [],
      })
      .mockResolvedValueOnce({
        events: [],
        complete: false,
        timedOutRelays: [],
        failedRelays: [],
      })
    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)
    const payload = {
      namespace: "budabit-calendar-widget",
      key: "featured-calendar-event",
      descriptors: [{kind: EVENT_TIME}],
    }

    await sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload)
    await vi.waitFor(() => expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1))
    await sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload)

    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(2)
  })

  it("makes a newer background-refreshed shared config visible", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const identifier = `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`
    const cachedConfig = makeEvent({
      id: "cached-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached"}),
      tags: [
        ["d", identifier],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    const refreshedConfig = makeEvent({
      id: "refreshed-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 200,
      content: JSON.stringify({header: "Refreshed"}),
      tags: [
        ["d", identifier],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])
    mocks.loadCommunityEventsWithStatus.mockResolvedValueOnce({
      events: [refreshedConfig],
      complete: true,
      timedOutRelays: [],
      failedRelays: [],
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)
    const payload = {
      namespace: "budabit-calendar-widget",
      key: "featured-calendar-event",
      descriptors: [{kind: EVENT_TIME}],
    }

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload),
    ).resolves.toMatchObject({event: {id: "cached-config"}, config: {header: "Cached"}})
    await vi.waitFor(() => expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    await expect(
      sendBridgeRequest(bridge, extension, "community:querySharedConfig", payload),
    ).resolves.toMatchObject({event: {id: "refreshed-config"}, config: {header: "Refreshed"}})
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("keeps background refresh freshness scoped by shared-config address", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation((filters: any[] = []) => {
      const identifier = filters.find(filter => filter.kinds?.includes(30078))?.["#d"]?.[0]
      return identifier
        ? [
            makeEvent({
              id: identifier,
              kind: 30078,
              pubkey: calendarWriterPubkey,
              created_at: 100,
              content: "{}",
              tags: [
                ["d", identifier],
                ["descriptor", String(EVENT_TIME)],
              ],
            }),
          ]
        : []
    })
    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:querySharedConfig"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    for (const key of ["first", "second"]) {
      await sendBridgeRequest(bridge, extension, "community:querySharedConfig", {
        namespace: "budabit-calendar-widget",
        key,
        descriptors: [{kind: EVENT_TIME}],
      })
    }

    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(2)
  })

  it("resolves a fresh extension runtime context for every community request", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const revokedCalendarProfileList = makeEvent({
      id: "calendar-profile-list-revoked",
      created_at: 2,
      kind: PROFILE_LIST_KIND,
      pubkey: calendarWriterPubkey,
      tags: [
        ["d", profileListIdentifier(communityPointer.communityId, "Events and meetups")],
        ["p", calendarWriterPubkey],
      ],
    })
    const makeRuntimeContext = (profileListEvents: TrustedEvent[], contextVersion: number) => ({
      community: communityPointer,
      definition: communityDefinition,
      profileListEvents,
      relays: ["wss://preview.example.com/"],
      relayHints: ["wss://preview.example.com/"],
      communityContext: {
        version: 2 as const,
        contextSessionId: "live-community-context",
        contextVersion,
        communityId: communityPointer.communityId,
        ownerPubkey: communityPointer.ownerPubkey,
        definitionAddress: communityPointer.address,
        naddr: communityPointer.naddr,
        relays: ["wss://preview.example.com/"],
        relayHints: ["wss://preview.example.com/"],
        blossomServers: [],
        sections: [],
        viewer: {pubkey: calendarMemberPubkey, isOwner: false, isBanned: false},
      },
    })
    let runtimeContext: ReturnType<typeof makeRuntimeContext> | undefined = makeRuntimeContext(
      [calendarProfileList],
      1,
    )
    const runtimeContextProvider = vi.fn(() => runtimeContext)

    // These stale fallbacks must not win over the provider or its fail-closed result.
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://stale.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityRuntimeContext: makeRuntimeContext([calendarProfileList], 0),
      communityRuntimeContextProvider: runtimeContextProvider,
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 1,
      capabilities: [expect.objectContaining({canWrite: true})],
    })

    runtimeContext = makeRuntimeContext([revokedCalendarProfileList], 2)
    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      contextVersion: 2,
      capabilities: [expect.objectContaining({canWrite: false})],
    })

    runtimeContext = undefined
    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community runtime context is not available",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(runtimeContextProvider).toHaveBeenCalledTimes(3)
  })

  it("recognizes descriptor writers without treating them as section moderators", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
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

  it("treats a settled missing profile list as pending member-only authority", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)
    mocks.activeCommunityPermissionStatus.set({
      communityAddress: communityDefinition.pointer.address,
      key: "expected:settled",
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: false,
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
        expect.objectContaining({
          writableSectionNames: ["Events and meetups"],
          moderatorSectionNames: [],
          canWrite: true,
          canModerate: false,
        }),
      ],
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalled()
  })

  it("uses settled partial runtime evidence without granting missing-list authority", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const sharedConfigIdentifier = `budabit-community-config:${communityPointer.address}:budabit-call-widget:featured-call`
    const missingManagerConfig = makeEvent({
      id: "missing-manager-config",
      kind: 30078,
      pubkey: outsiderPubkey,
      created_at: 100,
      content: JSON.stringify({title: "Unauthorized call"}),
      tags: [["d", sharedConfigIdentifier]],
    })
    const missingManagerStream = makeEvent({
      id: "missing-manager-stream",
      kind: 30311,
      pubkey: streamManagerPubkey,
      created_at: 100,
      tags: [
        ["d", "missing-manager-stream"],
        ["h", communityId],
      ],
    })
    mocks.repository.query.mockImplementation(((filters: any[]) => {
      if (filters?.some(filter => filter.kinds?.includes(30078))) return [missingManagerConfig]
      if (filters?.some(filter => filter.kinds?.includes(30311))) return [missingManagerStream]
      return []
    }) as any)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: [
          "community:checkWriteCapabilities",
          "community:querySharedConfig",
          "community:queryLiveStreams",
          "community:publishSharedConfig",
        ],
      },
      communityRuntimeContext: makePartialRuntimeContext(outsiderPubkey, true),
    })
    const bridge = new ExtensionBridge(extension as any)
    const callDescriptor = {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM}

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [callDescriptor],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        expect.objectContaining({
          moderatorSectionNames: [],
          canModerate: false,
        }),
      ],
    })

    const sharedConfigResult = await sendBridgeRequest(
      bridge,
      extension,
      "community:querySharedConfig",
      {
        namespace: "budabit-call-widget",
        key: "featured-call",
        descriptors: [callDescriptor],
      },
    )
    expect(sharedConfigResult).toMatchObject({status: "ok"})
    expect(sharedConfigResult).not.toHaveProperty("event")
    expect(sharedConfigResult).not.toHaveProperty("config")

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: 30311}],
      }),
    ).resolves.toMatchObject({status: "ok", events: []})

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-call-widget",
        key: "featured-call",
        descriptors: [callDescriptor],
        config: {title: "Unauthorized call"},
      }),
    ).resolves.toMatchObject({
      error: "Current user is not a moderator for the requested community descriptors",
      code: "FORBIDDEN",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()

    const profileListHydration = mocks.loadCommunityEvents.mock.calls.find(
      call => call[1]?.[0]?.kinds?.[0] === PROFILE_LIST_KIND,
    )
    expect(profileListHydration?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authors: [calendarWriterPubkey],
          "#d": [profileListIdentifier(communityPointer.communityId, "Calendar")],
        }),
        expect.objectContaining({
          authors: [outsiderPubkey],
          "#d": [profileListIdentifier(communityPointer.communityId, "Calls")],
        }),
        expect.objectContaining({
          authors: [streamManagerPubkey],
          "#d": [profileListIdentifier(communityPointer.communityId, "Streams")],
        }),
      ]),
    )
  })

  it("keeps owner and active-list manager capabilities with settled partial evidence", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const makeCapabilityExtension = (userPubkey: string) =>
      makeWidgetStorageExtension({
        widget: {
          ...makeWidgetStorageExtension().widget,
          permissions: ["community:checkWriteCapabilities"],
        },
        communityRuntimeContext: makePartialRuntimeContext(userPubkey, true),
      })

    const managerExtension = makeCapabilityExtension(calendarWriterPubkey)
    const managerBridge = new ExtensionBridge(managerExtension as any)
    await expect(
      sendBridgeRequest(managerBridge, managerExtension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [expect.objectContaining({canWrite: true, canModerate: true})],
    })

    const ownerExtension = makeCapabilityExtension(communityPubkey)
    const ownerBridge = new ExtensionBridge(ownerExtension as any)
    await expect(
      sendBridgeRequest(ownerBridge, ownerExtension, "community:checkWriteCapabilities", {
        descriptors: [
          {kind: EVENT_TIME},
          {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM},
          {kind: 30311},
        ],
      }),
    ).resolves.toMatchObject({
      status: "ok",
      capabilities: [
        expect.objectContaining({canWrite: true, canModerate: true}),
        expect.objectContaining({canWrite: true, canModerate: true}),
        expect.objectContaining({canWrite: true, canModerate: true}),
      ],
    })
  })

  it("keeps an unsettled partial runtime fail closed", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityRuntimeContext: makePartialRuntimeContext(calendarWriterPubkey, false),
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:checkWriteCapabilities", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toEqual({
      error: "Community context is unavailable",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalled()
  })

  it("hydrates profile-list events before resolving descriptor capabilities", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
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
          "#d": [profileListIdentifier(communityPointer.communityId, "Events and meetups")],
        }),
      ]),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("returns the latest moderator-authored shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarMemberPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 30078) return
      for (let index = 0; index < 200; index += 1) {
        onEvent?.(
          makeEvent({
            id: `invalid-config-${index}`,
            kind: 30078,
            pubkey: outsiderPubkey,
            created_at: 100 + index,
            content: JSON.stringify({header: "Invalid", eventRefs: ["invalid"]}),
            tags: [
              ["d", filters[0]["#d"][0]],
              ["descriptor", String(EVENT_TIME)],
            ],
          }),
        )
      }
      onEvent?.(
        makeEvent({
          id: "valid-config",
          kind: 30078,
          pubkey: calendarWriterPubkey,
          created_at: 90,
          content: JSON.stringify({header: "Featured", eventRefs: [calendarEventRef]}),
          tags: [
            ["d", filters[0]["#d"][0]],
            ["descriptor", String(EVENT_TIME)],
          ],
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
      config: {header: "Featured", eventRefs: [calendarEventRef]},
    })
    const relayFilter = mocks.loadCommunityEventsWithStatus.mock.calls[0][1][0]
    expect(relayFilter).toMatchObject({
      authors: expect.arrayContaining([communityPubkey, calendarWriterPubkey]),
    })
    expect(relayFilter.authors).not.toContain(outsiderPubkey)
  })

  it("returns cached shared config before relay loads", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "cached-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached", eventRefs: [calendarEventRef]}),
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["descriptor", String(EVENT_TIME)],
      ],
    })

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])
    mocks.pubkey.set(calendarMemberPubkey)

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
      event: {id: "cached-config"},
      config: {header: "Cached", eventRefs: [calendarEventRef]},
    })
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      [
        expect.objectContaining({
          kinds: [30078],
          authors: expect.arrayContaining([calendarWriterPubkey]),
        }),
      ],
      expect.objectContaining({timeout: 5_000, authenticate: true}),
    )
    expect(mocks.repository.query).toHaveBeenCalledWith([
      expect.objectContaining({
        kinds: [30078],
        authors: expect.arrayContaining([calendarWriterPubkey]),
      }),
    ])
  })

  it("fails closed for cached shared config while its required profile list is missing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedConfig = makeEvent({
      id: "pending-ref-config",
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      content: JSON.stringify({header: "Cached", eventRefs: [calendarEventRef]}),
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
      ],
    })

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockReturnValue([cachedConfig])

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
    ).resolves.toEqual({
      error: "Community context is unavailable",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalled()
  })

  it("returns not-ready for shared config while cached permission evidence is refreshing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.activeCommunityPermissionStatus.set({
      communityAddress: communityDefinition.pointer.address,
      key: "permission-load",
      loading: true,
      loaded: false,
      hasCachedEvents: true,
    })
    mocks.pubkey.set(calendarMemberPubkey)

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
    ).resolves.toEqual({
      error: "Community context is still loading",
      code: "COMMUNITY_CONTEXT_NOT_READY",
    })
    expect(mocks.loadCommunityEvents).not.toHaveBeenCalled()
  })

  it("only lets descriptor moderators publish shared config without a revision precondition", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinitionWithRelays)
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
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({
      error: "Current user is not a moderator for the requested community descriptors",
    })

    mocks.pubkey.set(calendarWriterPubkey)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {"wss://relay.example.com/": {status: "success"}},
      event: {id: "published-config"},
    })

    await expect(
      sendBridgeRequest(bridge, extension, "community:publishSharedConfig", {
        namespace: "budabit-calendar-widget",
        key: "featured-calendar-event",
        descriptors: [{kind: EVENT_TIME}],
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.any(Object),
    )
    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.com/"],
        event: expect.objectContaining({kind: 30078}),
      }),
    )
    const publishedTags = mocks.publishThunk.mock.calls.at(-1)?.[0].event.tags
    expect(publishedTags).toEqual(
      expect.arrayContaining([
        ["a", communityPointer.address],
        ["descriptor", String(EVENT_TIME)],
      ]),
    )
    expect(publishedTags).not.toContainEqual(["p", communityPubkey])
  })

  it("publishes shared config when the expected revision is current", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const currentRevision = "a".repeat(64)
    const currentConfig = makeEvent({
      id: currentRevision,
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinitionWithRelays)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://hint.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === 30078) onEvent?.(currentConfig)
    })
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {"wss://relay.example.com/": {status: "success"}},
      event: {id: "published-config"},
    })

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
        config: {header: "Updated"},
        expectedRevision: currentRevision,
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.publishThunk).toHaveBeenCalledTimes(1)
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.any(Array),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("rejects stale shared config revisions without publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const currentConfig = makeEvent({
      id: "b".repeat(64),
      kind: 30078,
      pubkey: calendarWriterPubkey,
      created_at: 100,
      tags: [
        [
          "d",
          `budabit-community-config:${communityPointer.address}:budabit-calendar-widget:featured-calendar-event`,
        ],
        ["descriptor", String(EVENT_TIME)],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinitionWithRelays)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === 30078) onEvent?.(currentConfig)
    })

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
        config: {header: "Stale update"},
        expectedRevision: "c".repeat(64),
      }),
    ).resolves.toEqual({
      error: "Shared community config changed before publishing",
      code: "CONFIG_REVISION_CONFLICT",
    })
    expect(mocks.publishThunk).not.toHaveBeenCalled()
  })

  it("lets a moderator of any requested descriptor publish shared config", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const mixedDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: EVENT_TIME}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
      {
        name: "Threads",
        kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${outsiderPubkey}:Threads`}],
      },
    ])
    const threadProfileList = makeEvent({
      id: "thread-profile-list",
      kind: PROFILE_LIST_KIND,
      pubkey: outsiderPubkey,
      tags: [
        ["d", profileListIdentifier(communityPointer.communityId, "Threads")],
        ["p", outsiderPubkey],
      ],
    })
    mocks.activeExactCommunityDefinition.set(mixedDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList, threadProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {"wss://relay.example.com/": {status: "success"}},
      event: {id: "published-config"},
    })

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
        descriptors: [{kind: EVENT_TIME}, {kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS}],
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          tags: expect.arrayContaining([
            ["descriptor", String(EVENT_TIME)],
            ["descriptor", String(THREAD), COMMUNITY_SUBTYPE_THREADS],
          ]),
        }),
      }),
    )
  })

  it("uses exact definition relays instead of runtime relay hints for publishing", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://hint.example.com/"])
    mocks.pubkey.set(calendarWriterPubkey)
    mocks.publishThunk.mockReturnValue({
      complete: Promise.resolve(),
      results: {"wss://relay.example.com/": {status: "success"}},
      event: {id: "published-config"},
    })

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
        config: {header: "Featured", eventRefs: [calendarEventRef]},
      }),
    ).resolves.toMatchObject({status: "ok", eventId: "published-config"})
    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.any(Object),
    )
    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://relay.example.com/"]}),
    )
  })

  it("uses widget relay hints when community definition relays are empty", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set([])
    mocks.pubkey.set(calendarWriterPubkey)

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:checkWriteCapabilities"],
      },
      communityContext: {
        version: 2,
        contextSessionId: "community-context-test",
        contextVersion: 0,
        communityId: communityPointer.communityId,
        ownerPubkey: communityPointer.ownerPubkey,
        definitionAddress: communityPointer.address,
        naddr: communityPointer.naddr,
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
    mocks.activeExactCommunityDefinition.set(communityDefinition)
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
    mocks.activeExactCommunityDefinition.set(communityDefinition)
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
            "#h": [communityId],
            "#k": [String(EVENT_TIME)],
          }),
        ],
      }),
    )
    expect(loadCalls).toContainEqual(
      expect.objectContaining({
        filters: expect.arrayContaining([
          {
            kinds: [EVENT_TIME],
            authors: [calendarWriterPubkey],
            "#d": ["event-1"],
            limit: 100,
          },
        ]),
      }),
    )
  })

  it("returns cached community events when relay event queries are empty", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) => {
      const firstKind = filters?.[0]?.kinds?.[0]

      if (firstKind === TARGETED_PUBLICATION_KIND) return [calendarTargetingEvent]
      if (firstKind === EVENT_TIME) return [calendarEvent]

      return []
    }) as any)

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
    })
  })

  it("reports timeout when outsider targeting-wrapper pages saturate the cursor budget", async () => {
    const {ExtensionBridge} = await import("./bridge")
    let targetingPage = 0

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== TARGETED_PUBLICATION_KIND) return

      const pageCreatedAt = 1000 - targetingPage * 100
      targetingPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `outsider-target-${targetingPage}-${index}`,
          pubkey: outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: TARGETED_PUBLICATION_KIND,
          tags: makeTargetedPublicationForCommunity({
            targetingId: `outsider-target-${targetingPage}-${index}`,
            originalKind: EVENT_TIME,
            originalRef: makeAddressablePublicationRef({
              kind: EVENT_TIME,
              pubkey: outsiderPubkey,
              identifier: `outsider-event-${targetingPage}-${index}`,
            }),
            community: communityPointer,
          }).tags,
        }),
      ).forEach(onEvent)
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
    ).resolves.toEqual({
      error: "Community relay query is still loading",
      code: "COMMUNITY_QUERY_TIMEOUT",
    })

    const targetingLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(targetingLoads).toHaveLength(3)
    expect(targetingLoads[0][1][0]).toEqual({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#h": [communityId],
      "#k": [String(EVENT_TIME)],
      limit: 100,
    })
    expect(targetingLoads[1][1][0]).toHaveProperty("until")
    const cachedTargetingCall = (mocks.repository.query.mock.calls as any[][]).find(
      ([filters]) => filters?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(cachedTargetingCall?.[0]?.[0]).toMatchObject({
      authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
      limit: 100,
    })
  })

  it("reports timeout when a saturated direct-event scan admits fewer than the limit", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    let directPage = 0

    mocks.activeExactCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return

      const pageCreatedAt = 1000 - directPage * 100
      directPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `outsider-direct-${directPage}-${index}`,
          pubkey: directPage === 1 && index === 0 ? calendarMemberPubkey : outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: 1,
          tags: [["h", communityId]],
        }),
      ).forEach(onEvent)
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
        descriptors: [{kind: 1}],
        limit: 5,
      }),
    ).resolves.toEqual({
      error: "Community relay query is still loading",
      code: "COMMUNITY_QUERY_TIMEOUT",
    })

    const directLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === 1,
    )
    expect(directLoads).toHaveLength(3)
    expect(directLoads[0][1]).toEqual([{kinds: [1], "#h": [communityId], limit: 100}])
    expect(directLoads[1][1][0]).toHaveProperty("until")
  })

  it("returns enough authorized events from an incomplete saturated scan", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    let directPage = 0

    mocks.activeExactCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return

      const pageCreatedAt = 1000 - directPage * 100
      directPage += 1
      Array.from({length: 100}, (_, index) =>
        makeEvent({
          id: `enough-direct-${directPage}-${index}`,
          pubkey: directPage === 1 && index < 5 ? calendarMemberPubkey : outsiderPubkey,
          created_at: pageCreatedAt - index,
          kind: 1,
          tags: [["h", communityId]],
        }),
      ).forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryEvents"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    const result = await sendBridgeRequest(bridge, extension, "community:queryEvents", {
      descriptors: [{kind: 1}],
      limit: 5,
    })

    expect(result).toMatchObject({status: "ok"})
    expect(result.events).toHaveLength(5)
    expect(result.events.map((event: TrustedEvent) => event.id)).toEqual(
      Array.from({length: 5}, (_, index) => `enough-direct-1-${index}`),
    )
    expect(result).toMatchObject({hasMore: true})
    expect(result).not.toHaveProperty("nextUntil")
    const directLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === 1,
    )
    expect(directLoads).toHaveLength(3)
  })

  it("sorts community query pages by timestamp then id without an unsafe tie cursor", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    const events = ["f", "1", "8"].map(id =>
      makeEvent({
        id: id.repeat(64),
        pubkey: calendarMemberPubkey,
        created_at: 100,
        kind: 1,
        tags: [["h", communityId]],
      }),
    )
    mocks.activeExactCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === 1) events.forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {...makeWidgetStorageExtension().widget, permissions: ["community:queryEvents"]},
    })
    const bridge = new ExtensionBridge(extension as any)
    const result = await sendBridgeRequest(bridge, extension, "community:queryEvents", {
      descriptors: [{kind: 1}],
      limit: 2,
    })

    expect(result.events.map((event: TrustedEvent) => event.id)).toEqual([
      "1".repeat(64),
      "8".repeat(64),
    ])
    expect(result).toMatchObject({status: "ok", hasMore: true})
    expect(result).not.toHaveProperty("nextUntil")
  })

  it("returns nextUntil only when a complete page can move below its timestamp boundary", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    const events = [30, 20, 10].map(created_at =>
      makeEvent({
        id: String(created_at).padStart(64, "0"),
        pubkey: calendarMemberPubkey,
        created_at,
        kind: 1,
        tags: [["h", communityId]],
      }),
    )
    mocks.activeExactCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] === 1) events.forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {...makeWidgetStorageExtension().widget, permissions: ["community:queryEvents"]},
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors: [{kind: 1}],
        limit: 2,
      }),
    ).resolves.toMatchObject({status: "ok", hasMore: true, nextUntil: 19})
  })

  it("continues wrapper discovery to an authorized later page", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const outsiderPage = Array.from({length: 100}, (_, index) =>
      makeEvent({
        id: `later-outsider-target-${index}`,
        pubkey: outsiderPubkey,
        created_at: 300 - index,
        kind: TARGETED_PUBLICATION_KIND,
        tags: makeTargetedPublicationForCommunity({
          targetingId: `later-outsider-target-${index}`,
          originalKind: EVENT_TIME,
          originalRef: makeAddressablePublicationRef({
            kind: EVENT_TIME,
            pubkey: outsiderPubkey,
            identifier: `later-outsider-event-${index}`,
          }),
          community: communityPointer,
        }).tags,
      }),
    )

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstFilter = filters?.[0] || {}
      if (firstFilter.kinds?.[0] === TARGETED_PUBLICATION_KIND) {
        const events = firstFilter.until === undefined ? outsiderPage : [calendarTargetingEvent]
        events.forEach(onEvent)
      } else if (firstFilter.kinds?.[0] === EVENT_TIME) {
        onEvent(calendarEvent)
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
        limit: 1,
      }),
    ).resolves.toMatchObject({status: "ok", events: [calendarEvent]})

    const targetingLoads = mocks.loadCommunityEvents.mock.calls.filter(
      call => call[1]?.[0]?.kinds?.[0] === TARGETED_PUBLICATION_KIND,
    )
    expect(targetingLoads).toHaveLength(2)
    expect(targetingLoads[1][1][0]).toMatchObject({until: 200, limit: 100})
  })

  it("returns explicit external originals only from authorized targeting wrappers", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const authorizedTargeting = makeEvent({
      id: "external-target",
      pubkey: calendarWriterPubkey,
      kind: TARGETED_PUBLICATION_KIND,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "external-target",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: outsiderPubkey,
          identifier: "external-event",
          relay: "wss://external.example.com/",
        }),
        community: communityPointer,
      }).tags,
    })
    const unauthorizedTargeting = makeEvent({
      id: "unauthorized-target",
      pubkey: outsiderPubkey,
      kind: TARGETED_PUBLICATION_KIND,
      tags: makeTargetedPublicationForCommunity({
        targetingId: "unauthorized-target",
        originalKind: EVENT_TIME,
        originalRef: makeAddressablePublicationRef({
          kind: EVENT_TIME,
          pubkey: outsiderPubkey,
          identifier: "unauthorized-event",
        }),
        community: communityPointer,
      }).tags,
    })
    const externalEvent = makeEvent({
      id: "external-event-id",
      pubkey: outsiderPubkey,
      kind: EVENT_TIME,
      tags: [["d", "external-event"]],
    })
    const unauthorizedEvent = makeEvent({
      id: "unauthorized-event-id",
      pubkey: outsiderPubkey,
      kind: EVENT_TIME,
      tags: [["d", "unauthorized-event"]],
    })

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) => {
      if (filters?.[0]?.kinds?.[0] === EVENT_TIME) return [unauthorizedEvent]
      return []
    }) as any)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const firstKind = filters?.[0]?.kinds?.[0]
      if (firstKind === TARGETED_PUBLICATION_KIND) {
        onEvent?.(authorizedTargeting)
        onEvent?.(unauthorizedTargeting)
      } else if (firstKind === EVENT_TIME) {
        onEvent?.(externalEvent)
        onEvent?.(unauthorizedEvent)
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
    ).resolves.toMatchObject({status: "ok", events: [externalEvent]})
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://external.example.com/"],
      expect.arrayContaining([
        {
          kinds: [EVENT_TIME],
          authors: [outsiderPubkey],
          "#d": ["external-event"],
          limit: 100,
        },
      ]),
      expect.objectContaining({authenticate: false}),
    )
    expect(mocks.authenticateCommunityRelays).toHaveBeenCalledWith(
      ["wss://relay.example.com/", "wss://external.example.com/"],
      {priorityRelays: communityPointer.relayHints},
    )
    expect(mocks.loadCommunityEvents.mock.calls.flatMap(call => call[1])).not.toContainEqual(
      expect.objectContaining({"#d": ["unauthorized-event"]}),
    )
  })

  it("uses structural relay filters and locally rejects unauthorized direct descriptor events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const directDefinition = makeDefinition([
      {
        name: "Events and meetups",
        kinds: [{kind: 1}],
        profileLists: [
          {address: `${PROFILE_LIST_KIND}:${calendarWriterPubkey}:Events and meetups`},
        ],
      },
    ])
    const authorizedEvent = makeEvent({
      id: "authorized-direct",
      pubkey: calendarMemberPubkey,
      kind: 1,
      tags: [["h", communityId]],
    })
    const unauthorizedEvent = makeEvent({
      id: "unauthorized-direct",
      pubkey: outsiderPubkey,
      kind: 1,
      tags: [["h", communityId]],
    })

    mocks.activeExactCommunityDefinition.set(directDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.[0] === 1 ? [unauthorizedEvent] : []) as any)
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.[0]?.kinds?.[0] !== 1) return
      onEvent?.(unauthorizedEvent)
      onEvent?.(authorizedEvent)
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
        descriptors: [{kind: 1}],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [authorizedEvent]})
    expect(mocks.repository.query).toHaveBeenCalledWith([
      {
        kinds: [1],
        "#h": [communityId],
        authors: [communityPubkey, calendarWriterPubkey, calendarMemberPubkey],
        limit: 5,
      },
    ])
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      [{kinds: [1], "#h": [communityId], limit: 100}],
      expect.objectContaining({authenticate: false}),
    )
  })

  it("does not cross-authorize disjoint room and thread writers in broad or exact queries", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const profileListOwner = calendarWriterPubkey
    const roomWriter = calendarMemberPubkey
    const threadWriter = outsiderPubkey
    const mixedDefinition = makeDefinition([
      {
        name: "Rooms",
        kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${profileListOwner}:Rooms`}],
      },
      {
        name: "Threads",
        kinds: [{kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS}],
        profileLists: [{address: `${PROFILE_LIST_KIND}:${profileListOwner}:Threads`}],
      },
    ])
    const roomWriters = makeEvent({
      id: "room-writers",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", profileListIdentifier(communityPointer.communityId, "Rooms")],
        ["p", roomWriter],
      ],
    })
    const threadWriters = makeEvent({
      id: "thread-writers",
      kind: PROFILE_LIST_KIND,
      pubkey: profileListOwner,
      tags: [
        ["d", profileListIdentifier(communityPointer.communityId, "Threads")],
        ["p", threadWriter],
      ],
    })
    const roomByRoomWriter = makeEvent({
      id: "1".repeat(64),
      created_at: 40,
      kind: THREAD,
      pubkey: roomWriter,
      tags: [["d", "room-allowed"], ["h", communityId], ["room"]],
    })
    const threadByThreadWriter = makeEvent({
      id: "2".repeat(64),
      created_at: 30,
      kind: THREAD,
      pubkey: threadWriter,
      tags: [
        ["d", "thread-allowed"],
        ["h", communityId],
      ],
    })
    const roomByThreadWriter = makeEvent({
      id: "3".repeat(64),
      created_at: 60,
      kind: THREAD,
      pubkey: threadWriter,
      tags: [["d", "room-cross-authorized"], ["h", communityId], ["room"]],
    })
    const threadByRoomWriter = makeEvent({
      id: "4".repeat(64),
      created_at: 50,
      kind: THREAD,
      pubkey: roomWriter,
      tags: [
        ["d", "thread-cross-authorized"],
        ["h", communityId],
      ],
    })
    const allEvents = [
      roomByThreadWriter,
      threadByRoomWriter,
      roomByRoomWriter,
      threadByThreadWriter,
    ]
    const descriptors = [
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_ROOM},
      {kind: THREAD, subtype: COMMUNITY_SUBTYPE_THREADS},
    ]

    mocks.activeExactCommunityDefinition.set(mixedDefinition)
    mocks.activeCommunityProfileListEvents.set([roomWriters, threadWriters])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (filters?.some((filter: any) => filter.kinds?.includes(THREAD))) {
        allEvents.forEach(onEvent)
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
        descriptors,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [roomByRoomWriter, threadByThreadWriter],
    })

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryEvents", {
        descriptors,
        refs: allEvents.map(event => `${event.kind}:${event.pubkey}:${event.tags[0][1]}`),
        limit: 10,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [roomByRoomWriter, threadByThreadWriter],
    })
  })

  it("returns descriptor calendar events from authorized writers without targeting events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const filter = filters?.[0] || {}

      if (
        filter.kinds?.[0] === EVENT_TIME &&
        filter.authors?.includes(calendarWriterPubkey) &&
        !filter["#d"]
      ) {
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
    })
  })

  it("finds an old-published upcoming event behind a full page of completed events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const completed = Array.from({length: 500}, (_, index) =>
      makeEvent({
        id: `completed-${index}`,
        pubkey: calendarWriterPubkey,
        created_at: 2000 - index,
        kind: EVENT_TIME,
        tags: [
          ["d", `completed-${index}`],
          ["start", "800"],
          ["end", "900"],
        ],
      }),
    )
    const upcoming = makeEvent({
      id: "old-published-upcoming",
      pubkey: calendarWriterPubkey,
      created_at: 100,
      kind: EVENT_TIME,
      tags: [
        ["d", "old-published-upcoming"],
        ["start", "1500"],
        ["end", "2000"],
      ],
    })
    const publications = [...completed, upcoming]

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      const filter = filters?.[0] || {}
      if (filter.kinds?.[0] !== EVENT_TIME || filter["#d"]) return

      publications
        .filter(event => filter.until === undefined || event.created_at <= filter.until)
        .slice(0, filter.limit)
        .forEach(onEvent)
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
        limit: 500,
        calendarStart: 1000,
        calendarDate: "2026-08-30",
      }),
    ).resolves.toMatchObject({status: "ok", events: [upcoming], hasMore: true})
  })

  it("returns exact referenced community events from writer outboxes without targeting events", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.getPubkeyOutboxRelays.mockReturnValue(["wss://writer-outbox.example.com/"])
    mocks.load.mockImplementation(async ({relays, filters, onEvent}: any) => {
      const filter = filters?.[0] || {}

      if (
        relays.includes("wss://writer-outbox.example.com/") &&
        filter.kinds?.[0] === EVENT_TIME &&
        filter.authors?.[0] === calendarWriterPubkey &&
        filter["#d"]?.[0] === "event-1"
      ) {
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
        refs: [calendarEventRef],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [calendarEvent],
    })
    expect(mocks.getPubkeyOutboxRelays).toHaveBeenCalledWith([calendarWriterPubkey])
    expect(mocks.loadCommunityEvents).toHaveBeenCalledTimes(1)
    expect(mocks.loadCommunityEvents.mock.calls[0][2]).toMatchObject({
      settle: "all",
    })
  })

  it("returns fully cached exact refs without waiting for relay refresh", async () => {
    const {ExtensionBridge} = await import("./bridge")
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.includes(EVENT_TIME) ? [calendarEvent] : []) as any)
    mocks.loadCommunityEventsWithStatus.mockReturnValueOnce(new Promise(() => undefined))

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
        refs: [calendarEventRef],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [calendarEvent]})
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("queries direct and trusted-provider live streams hosted by descriptor moderators", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const streamCommunityId = testPubkey(56)
    const streamCommunityDefinition = makeDefinition(
      communityDefinition.sections,
      "stream-community-definition",
      streamCommunityId,
    )
    const directOld = makeEvent({
      id: "direct-old",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 10,
      tags: [
        ["d", "direct-stream"],
        ["h", streamCommunityId],
      ],
    })
    const directLive = makeEvent({
      id: "direct-live",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 20,
      tags: [
        ["d", "direct-stream"],
        ["h", streamCommunityId],
        ["status", "live"],
      ],
    })
    const delegatedLive = makeEvent({
      id: "delegated-live",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 30,
      tags: [
        ["d", "delegated-stream"],
        ["t", `budabit-community:${streamCommunityId}`],
        ["p", calendarWriterPubkey, "", "host"],
        ["status", "live"],
      ],
    })
    const writerOnlyStream = makeEvent({
      id: "writer-only",
      kind: 30311,
      pubkey: calendarMemberPubkey,
      created_at: 40,
      tags: [
        ["d", "writer-stream"],
        ["h", streamCommunityId],
      ],
    })
    const invalidDelegation = makeEvent({
      id: "invalid-delegation",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 40,
      tags: [
        ["d", "invalid-provider-stream"],
        ["t", `budabit-community:${streamCommunityId}`],
        ["p", calendarMemberPubkey, "", "host"],
      ],
    })

    mocks.activeExactCommunityDefinition.set(streamCommunityDefinition)
    mocks.activeCommunityProfileListEvents.set([
      {
        ...calendarProfileList,
        tags: calendarProfileList.tags.map(tag =>
          tag[0] === "d"
            ? ["d", profileListIdentifier(streamCommunityId, "Events and meetups")]
            : tag,
        ),
      },
    ])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      ;[directOld, directLive, delegatedLive, writerOnlyStream, invalidDelegation].forEach(onEvent)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      events: [{id: "delegated-live"}, {id: "direct-live"}],
      relays: ["wss://relay.example.com/"],
      descriptors: [{kind: EVENT_TIME}],
      contextSessionId: expect.any(String),
      contextVersion: 0,
    })
    expect(mocks.loadCommunityEvents).toHaveBeenCalledWith(
      ["wss://relay.example.com/"],
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [30311],
          authors: expect.arrayContaining([calendarWriterPubkey]),
        }),
        expect.objectContaining({
          kinds: [30311],
          authors: expect.arrayContaining([zapStreamProviderPubkey]),
        }),
      ]),
      expect.objectContaining({authenticate: true}),
    )
  })

  it("returns authorized cached live streams without waiting for relay refresh", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const cachedStream = makeEvent({
      id: "cached-live",
      kind: 30311,
      pubkey: calendarWriterPubkey,
      created_at: 20,
      tags: [
        ["d", "cached-stream"],
        ["h", communityId],
        ["status", "live"],
      ],
    })
    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.repository.query.mockImplementation(((filters: any[]) =>
      filters?.[0]?.kinds?.includes(30311) ? [cachedStream] : []) as any)
    mocks.loadCommunityEventsWithStatus.mockReturnValueOnce(new Promise(() => undefined))

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
        limit: 5,
      }),
    ).resolves.toMatchObject({status: "ok", events: [cachedStream]})
    expect(mocks.loadCommunityEventsWithStatus).toHaveBeenCalledTimes(1)
  })

  it("uses the lower event id when live-stream replacements share a timestamp", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const lowerId = "1".repeat(64)
    const higherId = "f".repeat(64)
    const makeReplacement = (id: string) =>
      makeEvent({
        id,
        kind: 30311,
        pubkey: calendarWriterPubkey,
        created_at: 20,
        tags: [
          ["d", "tie-stream"],
          ["h", communityId],
          ["title", id === lowerId ? "Preferred" : "Discarded"],
        ],
      })

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      onEvent?.(makeReplacement(higherId))
      onEvent?.(makeReplacement(lowerId))
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({events: [{id: lowerId}]})
  })

  it("does not resurrect an older delegated stream after the provider changes its host", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const validOld = makeEvent({
      id: "valid-old-provider-stream",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 10,
      tags: [
        ["d", "reassigned-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarWriterPubkey, "", "host"],
      ],
    })
    const invalidNew = makeEvent({
      id: "invalid-new-provider-stream",
      kind: 30311,
      pubkey: zapStreamProviderPubkey,
      created_at: 20,
      tags: [
        ["d", "reassigned-stream"],
        ["t", `budabit-community:${communityPubkey}`],
        ["p", calendarMemberPubkey, "", "host"],
      ],
    })

    mocks.activeExactCommunityDefinition.set(communityDefinition)
    mocks.activeCommunityProfileListEvents.set([calendarProfileList])
    mocks.activeCommunityRelays.set(["wss://relay.example.com/"])
    mocks.load.mockImplementation(async ({filters, onEvent}: any) => {
      if (!filters?.some((filter: any) => filter.kinds?.includes(30311))) return
      onEvent?.(validOld)
      onEvent?.(invalidNew)
    })

    const extension = makeWidgetStorageExtension({
      widget: {
        ...makeWidgetStorageExtension().widget,
        permissions: ["community:queryLiveStreams"],
      },
    })
    const bridge = new ExtensionBridge(extension as any)

    await expect(
      sendBridgeRequest(bridge, extension, "community:queryLiveStreams", {
        descriptors: [{kind: EVENT_TIME}],
      }),
    ).resolves.toMatchObject({events: []})
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

  it("does not log or return relay query credentials", async () => {
    const {ExtensionBridge} = await import("./bridge")
    const relay = "wss://relay.example.com/GRASP?token=AbC%2F123"
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    mocks.load.mockResolvedValue([])
    const extension = makeExtension({widget: {permissions: ["nostr:query"]}})
    const bridge = new ExtensionBridge(extension as any)

    await sendBridgeRequest(bridge, extension, "nostr:query", {
      relays: [relay],
      filter: {kinds: [30301], "#d": ["widget-1"], limit: 1},
    })

    expect(JSON.stringify(log.mock.calls)).not.toContain("AbC%2F123")
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({relays: [relay]}))
  })
})
