// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {get} from "svelte/store"
import {repository} from "@welshman/app"
import {getWidgetLineId} from "@app/extensions/widget-identity"
import {
  blossomDashboardState,
  blossomSettings,
  defaultBlossomDashboardState,
  defaultBlossomSettings,
  type BlossomServerTarget,
} from "./blossom"
import {COMMUNITY_DEFINITION_KIND, parseCommunityDefinition} from "./community"
import {clearActiveCommunity, setActiveCommunityDefinition} from "./community-state"

const utilMocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}))

const netMocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

const registryMocks = vi.hoisted(() => ({
  unloadExtension: vi.fn(),
  registerWidget: vi.fn(),
  loadWidget: vi.fn(),
  parseSmartWidget: vi.fn(),
}))

const settingsMocks = vi.hoisted(() => ({
  value: {
    enabled: [] as string[],
    disabledDefaultIds: [] as string[],
    installed: {widget: {}} as any,
    widgetInstallSources: {} as Record<string, any>,
  },
  update: vi.fn(),
  getInstalledExtensions: vi.fn(() => ({widget: {}})),
  isDefaultExtension: vi.fn(() => false),
  isExtensionEnabled: vi.fn(() => false),
  syncExtensionSettingsNow: vi.fn().mockResolvedValue(true),
}))

vi.mock("@nostr-git/ui", () => ({}))

vi.mock("@welshman/util", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/util")>()

  return {
    ...actual,
    uploadBlob: utilMocks.uploadBlob,
  }
})

vi.mock("@welshman/net", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/net")>()

  return {
    ...actual,
    request: netMocks.request,
  }
})

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn().mockResolvedValue(undefined)},
  db: {clear: vi.fn().mockResolvedValue(undefined)},
}))

vi.mock("@lib/util", () => ({
  deleteIndexedDB: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@app/extensions/registry", () => ({
  extensionRegistry: {
    unloadExtension: registryMocks.unloadExtension,
    registerWidget: registryMocks.registerWidget,
    loadWidget: registryMocks.loadWidget,
  },
  parseSmartWidget: registryMocks.parseSmartWidget,
}))

vi.mock("@app/extensions/settings", () => ({
  extensionSettings: {
    update: settingsMocks.update,
    subscribe: (run: (value: any) => void) => {
      run(settingsMocks.value)
      return () => {}
    },
  },
  disableDefaultExtension: vi.fn(),
  enableDefaultExtension: vi.fn(),
  getInstalledExtensions: settingsMocks.getInstalledExtensions,
  isDefaultExtension: settingsMocks.isDefaultExtension,
  isExtensionEnabled: settingsMocks.isExtensionEnabled,
  normalizeWidgetInstallSource: (source: any) => source,
  syncExtensionSettingsNow: settingsMocks.syncExtensionSettingsNow,
}))

vi.mock("@app/core/git-state", () => ({
  activeRepoClass: {
    subscribe: (fn: (value: undefined) => void) => {
      fn(undefined)
      return () => {}
    },
    set: vi.fn(),
  },
}))

const makeUploadTestFile = () => {
  const bytes = new TextEncoder().encode("hello")
  const file = new File([bytes], "hello.webp", {type: "image/webp"})

  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer.slice(0),
  })

  return file
}

const waitForBackgroundJobs = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

const makeBlossomTarget = (url: string, priority: number): BlossomServerTarget => ({
  url,
  priority,
  source: "manual",
  group: "manual",
  label: priority === 1 ? "Primary Blossom server" : "Mirror candidate",
})

const communityPubkey = "f".repeat(64)
const makeCommunityDefinition = (id: string, blossomServers: string[] = []) =>
  parseCommunityDefinition({
    id,
    pubkey: communityPubkey,
    created_at: 1,
    kind: COMMUNITY_DEFINITION_KIND,
    tags: [
      ["r", "wss://relay.example.com"],
      ...blossomServers.map(server => ["blossom", server]),
      ["content", "General"],
      ["k", "9", "room-message"],
    ],
    content: "",
    sig: "sig",
  } as any)!

describe("commands", () => {
  beforeEach(() => {
    utilMocks.uploadBlob.mockReset()
    netMocks.request.mockReset()
    netMocks.request.mockResolvedValue(undefined)
    registryMocks.unloadExtension.mockReset()
    registryMocks.registerWidget.mockReset()
    registryMocks.loadWidget.mockReset()
    registryMocks.parseSmartWidget.mockReset()
    registryMocks.parseSmartWidget.mockImplementation((event: any) => ({
      id: event.id,
      kind: 30033,
      content: event.content || "",
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags || [],
      identifier: event.tags?.find((tag: string[]) => tag[0] === "d")?.[1] || event.id,
      widgetType: event.tags?.find((tag: string[]) => tag[0] === "l")?.[1] || "basic",
      buttons: [],
      appUrl: event.tags?.find((tag: string[]) => tag[0] === "button" && tag[2] === "app")?.[3],
      permissions: event.tags
        ?.filter((tag: string[]) => tag[0] === "permission")
        .map((tag: string[]) => tag[1]),
      version: event.tags?.find((tag: string[]) => tag[0] === "version")?.[1],
    }))
    settingsMocks.value = {
      enabled: [],
      disabledDefaultIds: [],
      installed: {widget: {}},
      widgetInstallSources: {},
    }
    settingsMocks.update.mockReset()
    settingsMocks.getInstalledExtensions.mockReset()
    settingsMocks.getInstalledExtensions.mockReturnValue({widget: {}})
    settingsMocks.isDefaultExtension.mockReset()
    settingsMocks.isDefaultExtension.mockReturnValue(false)
    settingsMocks.isExtensionEnabled.mockReset()
    settingsMocks.isExtensionEnabled.mockReturnValue(false)
    settingsMocks.syncExtensionSettingsNow.mockReset()
    settingsMocks.syncExtensionSettingsNow.mockResolvedValue(true)
    localStorage.clear()
    blossomSettings.set(defaultBlossomSettings)
    blossomDashboardState.set(defaultBlossomDashboardState)
  })

  afterEach(() => {
    clearActiveCommunity()
    repository.removeEvent("definition-with-blossom")
    repository.removeEvent("definition-without-blossom")
    repository.removeEvent("30033:" + "a".repeat(64) + ":weather")
    repository.removeEvent("publisher-a-weather")
    repository.removeEvent("publisher-b-weather")
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("logout clears local Git token caches", async () => {
    localStorage.setItem("budabit:git-auth:v1:pk999", "cached")

    const {logout} = await import("./commands")

    await logout()

    expect(localStorage.getItem("budabit:git-auth:v1:pk999")).toBeNull()
  })

  it("normalizeBlossomUrl converts ws to http", async () => {
    const {normalizeBlossomUrl} = await import("./commands")
    expect(normalizeBlossomUrl("wss://blossom.example.com")).toMatch(/^https?:\/\//)
    expect(normalizeBlossomUrl("ws://localhost:8080")).toMatch(/^https?:\/\//)
  })

  it("normalizeBlossomUrl preserves https URLs", async () => {
    const {normalizeBlossomUrl} = await import("./commands")
    const url = "https://blossom.example.com"
    expect(normalizeBlossomUrl(url)).toContain("https")
  })

  it("getBlossomUploadTargets prefers an explicit primary server", async () => {
    const {getBlossomUploadTargets, normalizeBlossomUrl} = await import("./commands")
    const primary = "https://primary.example.com"

    expect(getBlossomUploadTargets({url: primary}).primary).toBe(normalizeBlossomUrl(primary))
  })

  it("getBlossomUploadTargets deduplicates mirror servers and excludes the primary", async () => {
    const {getBlossomUploadTargets, normalizeBlossomUrl} = await import("./commands")
    const primary = "https://primary.example.com"
    const mirror = "https://mirror.example.com"

    expect(
      getBlossomUploadTargets({
        url: primary,
        mirrorUrls: [primary, `${mirror}/`, mirror],
      }).mirrors,
    ).toEqual([normalizeBlossomUrl(mirror)])
  })

  it("uploadFile queues successful mirrors after the primary upload", async () => {
    const {startBlossomMirrorJobs, uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      const hash = headers["X-SHA-256"]

      return new Response(JSON.stringify({url: `${mirror}/${hash}.webp`, sha256: hash}))
    })

    utilMocks.uploadBlob.mockImplementation(
      async (server: string) => new Response(JSON.stringify({uploaded: 1, url: `${server}blob`})),
    )
    vi.stubGlobal("fetch", fetchMock)

    const {error, mirrors, result, uploadId} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(mirrors).toBeUndefined()
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(1)
    expect(utilMocks.uploadBlob.mock.calls[0][0]).toBe(primary)

    const headers = utilMocks.uploadBlob.mock.calls[0][2].headers
    expect(headers["X-SHA-256"]).toMatch(/^[a-f0-9]{64}$/)
    expect(headers["Content-Type"]).toBe("image/webp")
    expect(headers["Content-Length"]).toBeUndefined()

    await waitForBackgroundJobs()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      targetUrl: mirror,
      method: "server-mirror",
      status: "paused",
    })

    expect(await startBlossomMirrorJobs({uploadId: uploadId!})).toBe(true)
    await waitForBackgroundJobs()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      targetUrl: mirror,
      method: "server-mirror",
      status: "succeeded",
    })
  })

  it("uploadFile records background mirror failures without failing the upload", async () => {
    const {startBlossomMirrorJobs, uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("mirror unavailable", {status: 503}),
    )

    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})),
    )
    vi.stubGlobal("fetch", fetchMock)

    const {error, mirrors, result, uploadId} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(mirrors).toBeUndefined()

    await waitForBackgroundJobs()
    expect(fetchMock).not.toHaveBeenCalled()

    expect(await startBlossomMirrorJobs({uploadId: uploadId!})).toBe(true)
    await waitForBackgroundJobs()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      targetUrl: mirror,
      status: "failed",
      lastError: "mirror unavailable",
    })
  })

  it("uploadFile records mirror hash mismatches", async () => {
    const {startBlossomMirrorJobs, uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({url: `${mirror}/${"c".repeat(64)}.webp`, sha256: "c".repeat(64)}),
        ),
    )

    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})),
    )
    vi.stubGlobal("fetch", fetchMock)

    const {error, result, uploadId} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)

    await waitForBackgroundJobs()
    expect(await startBlossomMirrorJobs({uploadId: uploadId!})).toBe(true)
    await waitForBackgroundJobs()

    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      status: "failed",
      lastError: "Mirror returned a different hash than the canonical file.",
    })
  })

  it("uploadFile can run browser-assisted background mirroring with consent", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob
      .mockResolvedValueOnce(new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})))
      .mockResolvedValueOnce(new Response(JSON.stringify({uploaded: 1, url: `${mirror}blob`})))

    const {error, result} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
      blossomCapabilities: {
        [mirror]: {
          url: mirror,
          checkedAt: 1,
          upload: "supported",
          media: "unsupported",
          mirror: "unsupported",
        },
      },
      blossomSettings: {
        ...defaultBlossomSettings,
        browserMirrorConsent: "allow",
        mirrorMode: "always-selected",
        autoMirrorTargetGroups: ["manual"],
      },
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)

    await waitForBackgroundJobs()

    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(2)
    expect(utilMocks.uploadBlob.mock.calls[1][0]).toBe(mirror)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      method: "browser-upload",
      status: "succeeded",
    })
  })

  it("starts ask-mode browser-assisted mirrors after confirmation", async () => {
    const {startBlossomMirrorJobs, uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()
    const bytes = new Uint8Array(await file.arrayBuffer())

    utilMocks.uploadBlob
      .mockResolvedValueOnce(new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})))
      .mockResolvedValueOnce(new Response(JSON.stringify({uploaded: 1, url: `${mirror}blob`})))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, {headers: {"Content-Type": file.type}})),
    )

    const {error, result, uploadId} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
      blossomCapabilities: {
        [mirror]: {
          url: mirror,
          checkedAt: 1,
          upload: "supported",
          media: "unsupported",
          mirror: "unsupported",
        },
      },
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      method: "browser-upload",
      status: "paused",
    })

    expect(await startBlossomMirrorJobs({uploadId: uploadId!, browserAssist: true})).toBe(true)
    await waitForBackgroundJobs()

    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(2)
    expect(utilMocks.uploadBlob.mock.calls[1][0]).toBe(mirror)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      status: "succeeded",
    })
  })

  it("does not browser-mirror downloaded canonical bytes with the wrong hash", async () => {
    const {startBlossomMirrorJobs, uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob.mockResolvedValueOnce(
      new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("tampered")),
    )

    const {error, result, uploadId} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(mirror, 2)],
      blossomCapabilities: {
        [mirror]: {
          url: mirror,
          checkedAt: 1,
          upload: "supported",
          media: "unsupported",
          mirror: "unsupported",
        },
      },
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(await startBlossomMirrorJobs({uploadId: uploadId!, browserAssist: true})).toBe(false)

    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(1)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs[0]).toMatchObject({
      status: "failed",
      lastError: "Downloaded canonical file does not match the expected Blossom hash.",
    })
  })

  it("uploadFile keeps default uploads single-target without mirrors", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const {DEFAULT_BLOSSOM_SERVERS} = await import("@app/core/state")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: "https://default.example.com/blob"})),
    )

    const {error, mirrors, result} = await uploadFile(file)

    expect(error).toBeUndefined()
    expect(result?.url).toBe("https://default.example.com/blob.webp")
    expect(mirrors).toBeUndefined()
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(1)
    expect(utilMocks.uploadBlob.mock.calls[0][0]).toBe(
      normalizeBlossomUrl(DEFAULT_BLOSSOM_SERVERS[0]),
    )
  })

  it("uploadFile reconstructs canonical URLs when upload response URL is unusable", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const server = normalizeBlossomUrl("https://primary.example.com")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: "not-a-url"})),
    )

    const {error, result} = await uploadFile(file, {url: server})

    expect(error).toBeUndefined()
    expect(result?.url.startsWith(`${server}/`)).toBe(true)
    expect(result?.url.endsWith(".webp")).toBe(true)
    expect(result?.url).toMatch(/[a-f0-9]{64}\.webp$/)
  })

  it("uploadFile retries once with the Blossom server expected content type", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const server = normalizeBlossomUrl("https://primary.example.com")
    const bytes = new TextEncoder().encode('{"kind":30023}')
    const file = new File([bytes], "NIP-B7.md", {type: "text/markdown"})

    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer.slice(0),
    })

    utilMocks.uploadBlob.mockImplementation(async (server: string, _blob: Blob, options: any) => {
      const headers = options.headers as Record<string, string>

      if (headers["Content-Type"] === "text/markdown") {
        return new Response(
          "Content-Type header does not match the file content, expected application/json",
          {status: 400},
        )
      }

      return new Response(
        JSON.stringify({uploaded: 1, url: `${server}/blob`, type: headers["Content-Type"]}),
      )
    })

    const {error, result} = await uploadFile(file, {url: server})

    expect(error).toBeUndefined()
    expect(result?.type).toBe("application/json")
    expect(result?.url).toBe(`${server}/blob.json`)
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(2)
    expect(utilMocks.uploadBlob.mock.calls[0][2].headers["Content-Type"]).toBe("text/markdown")
    expect(utilMocks.uploadBlob.mock.calls[1][2].headers["Content-Type"]).toBe("application/json")
    expect(get(blossomDashboardState).uploads[0].original).toMatchObject({
      name: "NIP-B7.md",
      type: "text/markdown",
    })
  })

  it("uploadFile tries the next target after a file-type policy rejection", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const backup = normalizeBlossomUrl("https://backup.example.com")
    const bytes = new TextEncoder().encode('{"kind":30023}')
    const file = new File([bytes], "NIP-B7.md", {type: "text/markdown"})

    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer.slice(0),
    })

    utilMocks.uploadBlob.mockImplementation(async (server: string, _blob: Blob, options: any) => {
      const headers = options.headers as Record<string, string>
      const contentType = headers["Content-Type"]

      if (server === primary && contentType === "text/markdown") {
        return new Response(
          "Content-Type header does not match the file content, expected application/json",
          {status: 400},
        )
      }

      if (server === primary) {
        return new Response("File type not allowed, unsupported.", {status: 415})
      }

      return new Response(JSON.stringify({uploaded: 1, url: `${server}/blob`, type: contentType}))
    })

    const {error, result} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [backup],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(backup, 2)],
    })

    expect(error).toBeUndefined()
    expect(result?.type).toBe("text/markdown")
    expect(result?.url).toBe(`${backup}/blob.markdown`)
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(3)
    expect(utilMocks.uploadBlob.mock.calls.map(call => call[0])).toEqual([primary, primary, backup])
    expect(utilMocks.uploadBlob.mock.calls[2][2].headers["Content-Type"]).toBe("text/markdown")
    expect(get(blossomDashboardState).uploads[0].canonical.url).toBe(`${backup}/blob.markdown`)
    expect(get(blossomDashboardState).uploads[0].mirrorJobs).toHaveLength(0)
  })

  it("uploadFile returns a clear error when every target rejects the file type", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const backup = normalizeBlossomUrl("https://backup.example.com")
    const bytes = new TextEncoder().encode("# hello")
    const file = new File([bytes], "NIP-B7.md", {type: "text/markdown"})

    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer.slice(0),
    })

    utilMocks.uploadBlob.mockImplementation(
      async () => new Response("File type not allowed, unsupported.", {status: 415}),
    )

    const {error, result} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [backup],
      blossomTargets: [makeBlossomTarget(primary, 1), makeBlossomTarget(backup, 2)],
    })

    expect(result).toBeUndefined()
    expect(error).toBe(
      "No Blossom upload target accepted this file type. Last rejection: File type not allowed, unsupported.",
    )
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(2)
    expect(get(blossomDashboardState).uploads).toHaveLength(0)
  })

  it("uploadFile derives current community Blossom servers from upload context", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const relay = "wss://relay.example.com"
    const communityBlossom = normalizeBlossomUrl("https://community-blossom.example")
    const file = makeUploadTestFile()

    setActiveCommunityDefinition(
      makeCommunityDefinition("definition-with-blossom", [communityBlossom]),
    )
    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: `${communityBlossom}/blob`})),
    )

    const {error, result} = await uploadFile(file, {
      url: relay,
      blossomContext: {type: "community", communityPubkey},
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${communityBlossom}/blob.webp`)
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(1)
    expect(utilMocks.uploadBlob.mock.calls[0][0]).toBe(communityBlossom)
    expect(utilMocks.uploadBlob.mock.calls[0][0]).not.toBe(normalizeBlossomUrl(relay))
  })

  it("uploadFile ignores relay urls when community context has no Blossom servers", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const relay = "wss://relay.example.com"
    const relayAsHttp = normalizeBlossomUrl(relay)
    const file = makeUploadTestFile()

    setActiveCommunityDefinition(makeCommunityDefinition("definition-without-blossom"))
    utilMocks.uploadBlob.mockResolvedValue(
      new Response(JSON.stringify({uploaded: 1, url: "https://fallback.example/blob"})),
    )

    await uploadFile(file, {
      url: relay,
      blossomContext: {type: "community", communityPubkey},
    })

    expect(utilMocks.uploadBlob.mock.calls.some(call => call[0] === relayAsHttp)).toBe(false)
  })

  it("uploadFile uses media when the canonical server supports it", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const server = normalizeBlossomUrl("https://media.example.com")
    const file = makeUploadTestFile()
    const hash = "b".repeat(64)
    const stages: string[] = []
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({url: `${server}/${hash}`, sha256: hash, type: "image/webp"})),
    )

    blossomDashboardState.set({
      ...defaultBlossomDashboardState,
      capabilities: {
        [server]: {
          url: server,
          checkedAt: 1,
          upload: "supported",
          media: "supported",
          mirror: "unsupported",
        },
      },
    })
    vi.stubGlobal("fetch", fetchMock)

    const {error, result} = await uploadFile(file, {
      url: server,
      onStage: stage => stages.push(stage),
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${server}/${hash}.webp`)
    expect(stages).toEqual(["preparing", "checking-servers", "optimizing", "ready"])
    expect(utilMocks.uploadBlob).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${server.replace(/\/+$/, "")}/media`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT")
  })

  it("uploadFile rejects encrypted uploads in public contexts", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const file = makeUploadTestFile()
    const stages: string[] = []

    const {error} = await uploadFile(file, {
      url: normalizeBlossomUrl("https://primary.example.com"),
      encrypt: true,
      onStage: stage => stages.push(stage),
    })

    expect(error).toBe("Encrypted Blossom uploads are disabled for public contexts.")
    expect(stages).toEqual(["preparing", "checking-servers", "failed"])
    expect(utilMocks.uploadBlob).not.toHaveBeenCalled()
  })

  it("makeReport builds report event with tags", async () => {
    const {makeReport} = await import("./commands")
    const event = {
      id: "evt123",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const report = makeReport({
      event,
      reason: "spam",
      content: "Report details",
    })
    expect(report.kind).toBe(1984)
    expect(report.content).toBe("Report details")
    expect(report.tags).toEqual(
      expect.arrayContaining([
        ["p", event.pubkey],
        ["e", event.id, "spam"],
      ]),
    )
  })

  it("makeComment builds comment event with tags", async () => {
    const {makeComment} = await import("./commands")
    const event = {
      id: "evt456",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const comment = makeComment({
      event,
      content: "My reply",
    })
    expect(comment.kind).toBe(1111)
    expect(comment.content).toBe("My reply")
    expect(comment.tags.some((t: string[]) => t[0] === "e" && t[1] === event.id)).toBe(true)
  })

  it("makeReaction builds reaction event", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt789",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 1000,
      content: "",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      event,
      content: "+",
    })
    expect(reaction.kind).toBe(7)
    expect(reaction.content).toBe("+")
  })

  it("makeReaction drops standalone dash tags", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      event,
      content: "❤️",
      tags: [["-"], ["custom", "value"]],
    })
    expect(reaction.tags).not.toContainEqual(["-"])
    expect(reaction.tags).toContainEqual(["custom", "value"])
  })

  it("prependParent returns content and tags unchanged when parent is undefined", async () => {
    const {prependParent} = await import("./commands")
    const content = "Hello"
    const tags: string[][] = [["t", "topic"]]
    const result = prependParent(undefined, {content, tags})
    expect(result.content).toBe("Hello")
    expect(result.tags).toEqual([["t", "topic"]])
  })

  it("checkForWidgetUpdate returns a newer installed widget event", async () => {
    const {checkForWidgetUpdate} = await import("./commands")
    const pubkey = "a".repeat(64)
    const installed = {
      id: "weather-1",
      kind: 30033,
      content: "Weather",
      pubkey,
      created_at: 1,
      tags: [["d", "weather"]],
      identifier: "weather",
      widgetType: "tool",
      buttons: [],
      appUrl: "https://example.com/v1.html",
      permissions: ["ui:toast"],
    } as any
    const widgetId = getWidgetLineId(installed)
    const latest = {
      ...installed,
      id: "weather-2",
      created_at: 2,
      tags: [
        ["d", "weather"],
        ["version", "1.0.1"],
        ["button", "Open", "app", "https://example.com/v2.html"],
      ],
    }

    settingsMocks.value.widgetInstallSources = {
      [widgetId]: {relays: ["wss://widgets.example/"]},
    }
    settingsMocks.getInstalledExtensions.mockReturnValue({
      widget: {[widgetId]: installed},
    })
    repository.publish(latest as any)

    const update = await checkForWidgetUpdate(widgetId)

    expect(netMocks.request).toHaveBeenCalledWith({
      relays: expect.arrayContaining(["wss://widgets.example/"]),
      filters: [{kinds: [30033], authors: [pubkey], "#d": ["weather"], limit: 1}],
      autoClose: true,
      signal: expect.any(AbortSignal),
    })
    expect(update?.latest.id).toBe("weather-2")
    expect(update?.diff.appUrlChanged).toBe(true)
    expect(update?.diff.version?.to).toBe("1.0.1")
  })

  it("checkForWidgetUpdate uses events returned by the relay request", async () => {
    const {checkForWidgetUpdate} = await import("./commands")
    const pubkey = "a".repeat(64)
    const installed = {
      id: "request-only-1",
      kind: 30033,
      content: "Request Only",
      pubkey,
      created_at: 1,
      tags: [["d", "request-only"]],
      identifier: "request-only",
      widgetType: "tool",
      buttons: [],
      appUrl: "https://example.com/v1.html",
    } as any
    const widgetId = getWidgetLineId(installed)
    const latest = {
      ...installed,
      id: "request-only-3",
      created_at: 3,
      tags: [
        ["d", "request-only"],
        ["version", "1.0.3"],
        ["button", "Open", "app", "https://example.com/v3.html"],
      ],
    }

    settingsMocks.value.widgetInstallSources = {
      [widgetId]: {relays: ["wss://widgets.example/"]},
    }
    settingsMocks.getInstalledExtensions.mockReturnValue({
      widget: {[widgetId]: installed},
    })
    netMocks.request.mockResolvedValueOnce([latest])

    const update = await checkForWidgetUpdate(widgetId)

    expect(update?.latest.id).toBe("request-only-3")
    expect(update?.diff.version?.to).toBe("1.0.3")
    expect(update?.diff.appUrlChanged).toBe(true)
  })

  it("checkForWidgetUpdate times out hanging relay requests", async () => {
    vi.useFakeTimers()
    const {checkForWidgetUpdate} = await import("./commands")
    const pubkey = "a".repeat(64)
    const installed = {
      id: "calendar-timeout-1",
      kind: 30033,
      content: "Calendar",
      pubkey,
      created_at: 1,
      tags: [["d", "calendar-timeout"]],
      identifier: "calendar-timeout",
      widgetType: "tool",
      buttons: [],
      appUrl: "https://example.com/v1.html",
    } as any
    const widgetId = getWidgetLineId(installed)

    settingsMocks.value.widgetInstallSources = {
      [widgetId]: {relays: ["wss://widgets.example/"]},
    }
    settingsMocks.getInstalledExtensions.mockReturnValue({
      widget: {[widgetId]: installed},
    })
    netMocks.request.mockImplementationOnce(() => new Promise(() => {}))

    const updatePromise = checkForWidgetUpdate(widgetId)
    await vi.advanceTimersByTimeAsync(8_000)

    await expect(updatePromise).resolves.toBeNull()
    expect(netMocks.request.mock.calls[0][0].signal.aborted).toBe(true)
  })

  it("installWidgetFromEvent stores widgets and install sources by widget line id", async () => {
    const {installWidgetFromEvent} = await import("./commands")
    const pubkey = "a".repeat(64)
    const event = {
      id: "weather-1",
      kind: 30033,
      content: "Weather",
      pubkey,
      created_at: 1,
      tags: [
        ["d", "weather"],
        ["l", "tool"],
        ["version", "1.0.5"],
        ["button", "Open", "app", "https://example.com/weather-1.0.5.html"],
        ["permission", "ui:toast"],
      ],
    } as any
    const widgetId = `30033:${pubkey}:weather`

    const widget = installWidgetFromEvent(event, {relays: ["wss://widgets.example/"]})
    const next = settingsMocks.update.mock.calls[0][0](settingsMocks.value)

    expect(getWidgetLineId(widget)).toBe(widgetId)
    expect(next.installed.widget[widgetId]).toMatchObject({
      identifier: "weather",
      pubkey,
      version: "1.0.5",
      appUrl: "https://example.com/weather-1.0.5.html",
      permissions: ["ui:toast"],
    })
    expect(next.installed.widget.weather).toBeUndefined()
    expect(next.widgetInstallSources[widgetId]).toEqual({relays: ["wss://widgets.example/"]})
    expect(settingsMocks.syncExtensionSettingsNow).toHaveBeenCalledTimes(1)
  })

  it("discoverSmartWidgets keeps same-d widgets from different publishers", async () => {
    const {discoverSmartWidgets} = await import("./commands")
    const first = {
      id: "publisher-a-weather",
      kind: 30033,
      content: "Weather A",
      pubkey: "a".repeat(64),
      created_at: 1,
      tags: [
        ["d", "weather"],
        ["l", "basic"],
      ],
    } as any
    const second = {
      ...first,
      id: "publisher-b-weather",
      content: "Weather B",
      pubkey: "b".repeat(64),
      created_at: 2,
    }

    repository.publish(first)
    repository.publish(second)

    const widgets = await discoverSmartWidgets()

    expect(
      widgets
        .filter(widget => widget.identifier === "weather")
        .map(widget => widget.pubkey)
        .sort(),
    ).toEqual(["a".repeat(64), "b".repeat(64)])
  })

  it("refreshWidget replaces stored widget metadata and reloads enabled widgets", async () => {
    const {refreshWidget} = await import("./commands")
    const pubkey = "a".repeat(64)
    const oldWidget = {
      identifier: "weather",
      pubkey,
      kind: 30033,
      tags: [],
      widgetType: "tool",
    } as any
    const newWidget = {...oldWidget, id: "weather-2", created_at: 2}
    const widgetId = getWidgetLineId(oldWidget)

    settingsMocks.isExtensionEnabled.mockReturnValue(true)

    await refreshWidget(widgetId, newWidget)

    expect(registryMocks.unloadExtension).toHaveBeenCalledWith(widgetId)
    expect(settingsMocks.update).toHaveBeenCalledOnce()
    const next = settingsMocks.update.mock.calls[0][0]({
      installed: {widget: {[widgetId]: oldWidget}, legacy: undefined},
      widgetInstallSources: {[widgetId]: {relays: ["wss://widgets.example/"]}},
    })

    expect(next.installed.widget[widgetId]).toBe(newWidget)
    expect(next.widgetInstallSources[widgetId]).toEqual({relays: ["wss://widgets.example/"]})
    expect(settingsMocks.syncExtensionSettingsNow).toHaveBeenCalledTimes(1)
    expect(registryMocks.loadWidget).toHaveBeenCalledWith(newWidget)
  })

  it("refreshWidget swaps to the newer event without changing install source hints", async () => {
    const {refreshWidget} = await import("./commands")
    const oldWidget = {
      id: "weather-1",
      identifier: "weather",
      pubkey: "a".repeat(64),
      kind: 30033,
      tags: [["d", "weather"]],
      widgetType: "tool",
      version: "1.0.0",
      appUrl: "https://example.com/v1.html",
    } as any
    const newWidget = {
      ...oldWidget,
      id: "weather-2",
      created_at: 2,
      version: "1.1.0",
      changelog: "Use Blossom mirror fallback.",
      appUrl: "https://example.com/v2.html",
      appUrls: ["https://example.com/v2.html", "https://mirror.example.com/v2.html"],
    }
    const widgetId = getWidgetLineId(oldWidget)

    settingsMocks.isExtensionEnabled.mockReturnValue(false)

    await refreshWidget(widgetId, newWidget)

    const next = settingsMocks.update.mock.calls[0][0]({
      installed: {widget: {[widgetId]: oldWidget}, legacy: undefined},
      widgetInstallSources: {
        [widgetId]: {naddr: "naddr1weather", relays: ["wss://widgets.example/"]},
      },
    })

    expect(next.installed.widget[widgetId]).toMatchObject({
      id: "weather-2",
      version: "1.1.0",
      changelog: "Use Blossom mirror fallback.",
      appUrls: ["https://example.com/v2.html", "https://mirror.example.com/v2.html"],
    })
    expect(next.widgetInstallSources[widgetId]).toEqual({
      naddr: "naddr1weather",
      relays: ["wss://widgets.example/"],
    })
    expect(settingsMocks.syncExtensionSettingsNow).toHaveBeenCalledTimes(1)
    expect(registryMocks.loadWidget).not.toHaveBeenCalled()
  })

  it("refreshWidget merges update relay hints into install source hints", async () => {
    const {refreshWidget} = await import("./commands")
    const oldWidget = {
      id: "weather-1",
      identifier: "weather",
      pubkey: "a".repeat(64),
      kind: 30033,
      tags: [["d", "weather"]],
      widgetType: "tool",
      version: "1.0.0",
      appUrl: "https://example.com/v1.html",
    } as any
    const newWidget = {
      ...oldWidget,
      id: "weather-3",
      created_at: 3,
      version: "1.0.3",
      appUrl: "https://example.com/v3.html",
    }
    const widgetId = getWidgetLineId(oldWidget)

    await refreshWidget(widgetId, newWidget, {relays: ["wss://relay.damus.io/"]})

    const next = settingsMocks.update.mock.calls[0][0]({
      installed: {widget: {[widgetId]: oldWidget}, legacy: undefined},
      widgetInstallSources: {
        [widgetId]: {naddr: "naddr1weather", relays: ["wss://widgets.example/"]},
      },
    })

    expect(next.installed.widget[widgetId]).toBe(newWidget)
    expect(next.widgetInstallSources[widgetId]).toEqual({
      naddr: "naddr1weather",
      relays: ["wss://widgets.example/", "wss://relay.damus.io/"],
    })
  })

  it("refreshWidget does not preload community-home widgets into the hidden runtime", async () => {
    const {refreshWidget} = await import("./commands")
    const oldWidget = {
      id: "calendar-1",
      identifier: "calendar",
      pubkey: "a".repeat(64),
      kind: 30033,
      tags: [["d", "calendar"]],
      widgetType: "tool",
      slot: {type: "community-home-after-quicklinks", label: "Featured event"},
    } as any
    const newWidget = {...oldWidget, id: "calendar-2", created_at: 2}
    const widgetId = getWidgetLineId(oldWidget)

    settingsMocks.isExtensionEnabled.mockReturnValue(true)

    await refreshWidget(widgetId, newWidget)

    expect(registryMocks.unloadExtension).toHaveBeenCalledWith(widgetId)
    expect(registryMocks.loadWidget).not.toHaveBeenCalled()
  })

  it("prependParent uses explicit event relays for quoted git comments", async () => {
    const {prependParent} = await import("./commands")
    const parent = {
      id: "c".repeat(64),
      pubkey: "a".repeat(64),
      kind: 1111,
      created_at: 0,
      content: "Inline comment",
      tags: [
        ["q", "30617:maintainer:repo", "wss://repo.relay"],
        ["E", "e".repeat(64), "wss://root.relay", "b".repeat(64)],
        ["f", "src/file.ts"],
        ["line", "42"],
      ],
      sig: "b".repeat(128),
    } as any

    const result = prependParent(
      parent,
      {content: "Looks good", tags: []},
      {
        relays: ["wss://actual.relay", "wss://fallback.relay"],
      },
    )
    const uri = result.content.split("\n", 1)[0].replace(/^nostr:/, "")
    const decoded = nip19.decode(uri)

    expect(decoded.type).toBe("nevent")
    expect((decoded.data as any).relays).toEqual(["wss://actual.relay/", "wss://fallback.relay/"])
    expect(result.tags).toContainEqual(["q", parent.id, "wss://actual.relay/", parent.pubkey])
    expect(result.tags).toContainEqual(["q", parent.id, "wss://fallback.relay/", parent.pubkey])
    expect((decoded.data as any).relays).not.toContain("wss://repo.relay/")
    expect((decoded.data as any).relays).not.toContain("wss://root.relay/")
  })

  it("makeComment includes extra tags when provided", async () => {
    const {makeComment} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const comment = makeComment({
      event,
      content: "Reply",
      tags: [["custom", "value"]],
    })
    expect(comment.tags.some((t: string[]) => t[0] === "custom" && t[1] === "value")).toBe(true)
  })

  it("makeReaction includes custom tags when provided", async () => {
    const {makeReaction} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "👍",
      tags: [],
      sig: "",
    } as any
    const reaction = makeReaction({
      event,
      content: "👍",
      tags: [["custom", "tag"]],
    })
    expect(reaction.tags.some((t: string[]) => t[0] === "custom")).toBe(true)
  })

  it("makeDelete drops standalone dash tags", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const del = makeDelete({event, tags: [["-"]]})
    expect(del.tags).not.toContainEqual(["-"])
  })

  it("makeDelete includes group tag when event has h tag", async () => {
    const {makeDelete} = await import("./commands")
    const groupTag = new Proxy(["h", "room123"], {})
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [groupTag],
      sig: "",
    } as any
    const del = makeDelete({event})
    expect(del.tags).toContainEqual(["h", "room123"])
    expect(del.tags.find((tag: string[]) => tag[0] === "h")).not.toBe(groupTag)
    expect(() => structuredClone(del)).not.toThrow()
  })

  it("makeDelete builds delete event with kind and event tags", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt999",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [],
      sig: "",
    } as any
    const del = makeDelete({
      event,
    })
    expect(del.kind).toBe(5)
    expect(del.tags).toEqual(expect.arrayContaining([["k", "1"]]))
    expect(del.tags.some((t: string[]) => t[0] === "e" && t[1] === event.id)).toBe(true)
  })
})
