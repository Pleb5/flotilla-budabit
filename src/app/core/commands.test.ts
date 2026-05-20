// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import {
  blossomDashboardState,
  blossomSettings,
  defaultBlossomDashboardState,
  defaultBlossomSettings,
} from "./blossom"

const utilMocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}))

vi.mock("@nostr-git/ui", () => ({}))

vi.mock("@welshman/util", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/util")>()

  return {
    ...actual,
    uploadBlob: utilMocks.uploadBlob,
  }
})

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/extensions/registry", () => ({
  extensionRegistry: {
    load: vi.fn(),
    unloadExtension: vi.fn(),
    register: vi.fn(),
  },
  parseSmartWidget: vi.fn(),
}))

vi.mock("@app/extensions/settings", () => ({
  extensionSettings: {
    update: vi.fn(),
  },
  getInstalledExtensions: vi.fn(() => []),
  getInstalledExtension: vi.fn(),
}))

vi.mock("@app/core/git-state", () => ({
  activeRepoClass: {
    subscribe: vi.fn(),
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

describe("commands", () => {
  beforeEach(() => {
    utilMocks.uploadBlob.mockReset()
    localStorage.clear()
    blossomSettings.set(defaultBlossomSettings)
    blossomDashboardState.set(defaultBlossomDashboardState)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it("uploadFile mirrors successful uploads after the primary upload", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob.mockImplementation(
      async (server: string) => new Response(JSON.stringify({uploaded: 1, url: `${server}blob`})),
    )

    const {error, mirrors, result} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(mirrors).toEqual([{server: mirror, ok: true, status: 200, url: `${mirror}blob`}])
    expect(utilMocks.uploadBlob).toHaveBeenCalledTimes(2)
    expect(utilMocks.uploadBlob.mock.calls[0][0]).toBe(primary)
    expect(utilMocks.uploadBlob.mock.calls[1][0]).toBe(mirror)

    const headers = utilMocks.uploadBlob.mock.calls[0][2].headers
    expect(headers["X-SHA-256"]).toMatch(/^[a-f0-9]{64}$/)
    expect(headers["Content-Type"]).toBe("image/webp")
    expect(headers["Content-Length"]).toBeUndefined()
  })

  it("uploadFile does not fail when a mirror upload fails", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const primary = normalizeBlossomUrl("https://primary.example.com")
    const mirror = normalizeBlossomUrl("https://mirror.example.com")
    const file = makeUploadTestFile()

    utilMocks.uploadBlob
      .mockResolvedValueOnce(new Response(JSON.stringify({uploaded: 1, url: `${primary}blob`})))
      .mockRejectedValueOnce(new Error("mirror unavailable"))

    const {error, mirrors, result} = await uploadFile(file, {
      url: primary,
      mirrorUrls: [mirror],
    })

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${primary}blob.webp`)
    expect(mirrors).toEqual([{server: mirror, ok: false, error: "Error: mirror unavailable"}])
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

  it("uploadFile uses media when the canonical server supports it", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const server = normalizeBlossomUrl("https://media.example.com")
    const file = makeUploadTestFile()
    const hash = "b".repeat(64)
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

    const {error, result} = await uploadFile(file, {url: server})

    expect(error).toBeUndefined()
    expect(result?.url).toBe(`${server}/${hash}.webp`)
    expect(utilMocks.uploadBlob).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${server.replace(/\/+$/, "")}/media`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT")
  })

  it("uploadFile rejects encrypted uploads in public contexts", async () => {
    const {uploadFile, normalizeBlossomUrl} = await import("./commands")
    const file = makeUploadTestFile()

    const {error} = await uploadFile(file, {
      url: normalizeBlossomUrl("https://primary.example.com"),
      encrypt: true,
    })

    expect(error).toBe("Encrypted Blossom uploads are disabled for public contexts.")
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
      protect: false,
      event,
      content: "+",
    })
    expect(reaction.kind).toBe(7)
    expect(reaction.content).toBe("+")
  })

  it("makeReaction never adds protected tags", async () => {
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
      protect: true,
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
      protect: false,
      event,
      content: "👍",
      tags: [["custom", "tag"]],
    })
    expect(reaction.tags.some((t: string[]) => t[0] === "custom")).toBe(true)
  })

  it("makeDelete never adds protected tags", async () => {
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
    const del = makeDelete({protect: true, event, tags: [["-"]]})
    expect(del.tags).not.toContainEqual(["-"])
  })

  it("makeDelete includes group tag when event has h tag", async () => {
    const {makeDelete} = await import("./commands")
    const event = {
      id: "evt",
      pubkey: "a".repeat(64),
      kind: 1,
      created_at: 0,
      content: "",
      tags: [["h", "room123"]],
      sig: "",
    } as any
    const del = makeDelete({protect: false, event})
    expect(del.tags).toContainEqual(["h", "room123"])
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
      protect: false,
      event,
    })
    expect(del.kind).toBe(5)
    expect(del.tags).toEqual(expect.arrayContaining([["k", "1"]]))
    expect(del.tags.some((t: string[]) => t[0] === "e" && t[1] === event.id)).toBe(true)
  })
})
