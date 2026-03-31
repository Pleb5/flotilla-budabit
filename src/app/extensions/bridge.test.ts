// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  publishThunk: vi.fn(),
  load: vi.fn(),
  pushToast: vi.fn(),
}))

vi.mock("@welshman/app", () => ({
  publishThunk: mocks.publishThunk,
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

  return {
    id: "test-extension",
    origin: "https://widget.example.com",
    type: "nip89",
    iframe: {contentWindow: iframeWindow},
    manifest: {permissions: [], name: "Test", entrypoint: "https://widget.example.com/app.js"},
    widget: {permissions: []},
    repoContext: null,
    ...overrides,
    iframeWindow,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  localStorage.clear()
  mocks.publishThunk.mockReturnValue({complete: Promise.resolve(), results: {}})
  mocks.load.mockResolvedValue(undefined)
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

  it("validates nostr query payloads and deduplicates returned events", async () => {
    const {ExtensionBridge} = await import("./bridge")

    mocks.load.mockImplementation(async ({onEvent}: any) => {
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-1"})
      onEvent?.({id: "evt-2"})
    })

    const extension = makeExtension({
      manifest: {
        permissions: ["nostr:query"],
        name: "Query Test",
        entrypoint: "https://widget.example.com/app.js",
      },
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
