import {afterEach, describe, expect, it, vi} from "vitest"

import {
  GitNaturalObjectCache,
  gitNaturalCacheKeys,
  type GitNaturalInfoRefs,
} from "../../src/git/natural-read-cache.js"
import {
  GitNaturalReadClient,
  GitNaturalReadError,
  createUploadPackWantRequest,
  encodePktLine,
  extractPackfileFromUploadPackResponse,
  parseInfoRefsAdvertisement,
  resolveNaturalReadTransport,
  selectUploadPackCapabilities,
} from "../../src/git/natural-read-client.js"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const GRASP_URL =
  "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git"

const CAPABILITIES = [
  "ofs-delta",
  "no-progress",
  "multi_ack_detailed",
  "side-band-64k",
  "shallow",
  "object-format=sha1",
  "filter",
]

const buildAdvertisement = () =>
  [
    encodePktLine("# service=git-upload-pack\n"),
    "0000",
    encodePktLine(
      `${"1".repeat(40)} HEAD\0multi_ack_detailed side-band-64k shallow object-format=sha1 filter symref=HEAD:refs/heads/main agent=git/2.0\n`,
    ),
    encodePktLine(`${"1".repeat(40)} refs/heads/main\n`),
    encodePktLine(`${"2".repeat(40)} refs/tags/v1.0.0\n`),
    "0000",
  ].join("")

const pktBytes = (payload: string | Uint8Array): Uint8Array => {
  const payloadBytes = typeof payload === "string" ? encoder.encode(payload) : payload
  const header = encoder.encode((payloadBytes.length + 4).toString(16).padStart(4, "0"))
  return concatBytes(header, payloadBytes)
}

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes)
  return copy.buffer
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("GitNaturalObjectCache", () => {
  it("uses object-addressed keys and expires infoRefs by TTL", () => {
    let now = 1_000
    const cache = new GitNaturalObjectCache({infoRefsTtlMs: 50, now: () => now})
    const infoRefs: GitNaturalInfoRefs = {
      refs: {"refs/heads/main": "a".repeat(40)},
      capabilities: ["filter"],
      symrefs: {HEAD: "refs/heads/main"},
    }

    expect(gitNaturalCacheKeys.commit("A".repeat(40))).toBe(`commit:${"a".repeat(40)}`)
    expect(gitNaturalCacheKeys.rawObjectBatch("B".repeat(40), "blob:none")).toBe(
      `raw:${"b".repeat(40)}:blob:none`,
    )
    expect(gitNaturalCacheKeys.historyBatch("C".repeat(40), 30)).toBe(
      `history:${"c".repeat(40)}:30`,
    )

    cache.putInfoRefs("https://example.com/repo.git/", infoRefs)
    expect(cache.getInfoRefs("https://example.com/repo.git")?.capabilities).toEqual(["filter"])

    now = 1_051
    expect(cache.getInfoRefs("https://example.com/repo.git")).toBeUndefined()
    expect(cache.peekInfoRefsStale("https://example.com/repo.git")?.refs).toEqual(infoRefs.refs)

    cache.putCommit({hash: "D".repeat(40), tree: "e".repeat(40)})
    expect(cache.getCommit("d".repeat(40))?.tree).toBe("e".repeat(40))
  })
})

describe("natural read infoRefs", () => {
  it("parses refs, capabilities, and HEAD symrefs", () => {
    const infoRefs = parseInfoRefsAdvertisement(buildAdvertisement())

    expect(infoRefs.refs.HEAD).toBe("1".repeat(40))
    expect(infoRefs.refs["refs/heads/main"]).toBe("1".repeat(40))
    expect(infoRefs.refs["refs/tags/v1.0.0"]).toBe("2".repeat(40))
    expect(infoRefs.capabilities).toContain("filter")
    expect(infoRefs.symrefs.HEAD).toBe("refs/heads/main")
    expect(infoRefs.headRef).toBe("refs/heads/main")
    expect(infoRefs.headCommit).toBe("1".repeat(40))
  })

  it("dedupes concurrent infoRefs fetches and reuses TTL cache", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => buildAdvertisement(),
      arrayBuffer: async () => arrayBuffer(encoder.encode(buildAdvertisement())),
    }))
    const client = new GitNaturalReadClient({fetcher})

    const first = client.fetchInfoRefs({url: "https://example.com/repo.git"})
    const second = client.fetchInfoRefs({url: "https://example.com/repo.git"})
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.infoRefs.headRef).toBe("refs/heads/main")
    expect(secondResult.infoRefs.headRef).toBe("refs/heads/main")
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/repo.git/info/refs?service=git-upload-pack",
      expect.objectContaining({method: "GET"}),
    )

    await client.fetchInfoRefs({url: "https://example.com/repo.git"})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("keeps GRASP natural reads direct while proxying generic remotes when configured", () => {
    expect(resolveNaturalReadTransport(GRASP_URL, "https://cors.example")).toEqual({
      remoteUrl: GRASP_URL,
      effectiveUrl: GRASP_URL,
      usesProxy: false,
    })

    expect(
      resolveNaturalReadTransport("https://github.com/Pleb5/flotilla-budabit.git", "https://cors.example"),
    ).toEqual({
      remoteUrl: "https://github.com/Pleb5/flotilla-budabit.git",
      effectiveUrl: "https://cors.example/github.com/Pleb5/flotilla-budabit.git",
      usesProxy: true,
      corsProxy: "https://cors.example",
    })
  })

  it("classifies hosted auth, rate-limit, CORS, protocol, and capability failures distinctly", async () => {
    const responseBuffer = arrayBuffer(encoder.encode(""))
    const response = (status: number) => ({
      ok: false,
      status,
      arrayBuffer: async () => responseBuffer,
    })

    const authClient = new GitNaturalReadClient({fetcher: vi.fn(async () => response(403))})
    await expect(authClient.fetchInfoRefs({url: "https://github.com/example/repo.git"})).rejects.toMatchObject({
      code: "auth-required",
      status: 403,
    })

    const rateLimitClient = new GitNaturalReadClient({fetcher: vi.fn(async () => response(429))})
    await expect(rateLimitClient.fetchInfoRefs({url: "https://github.com/example/repo.git"})).rejects.toMatchObject({
      code: "http-error",
      status: 429,
    })

    const corsClient = new GitNaturalReadClient({
      fetcher: vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    })
    await expect(
      corsClient.fetchInfoRefs({
        url: "https://github.com/example/repo.git",
        corsProxy: "https://cors.example",
      }),
    ).rejects.toMatchObject({code: "cors-proxy-failure"})

    const protocolClient = new GitNaturalReadClient({
      fetcher: vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "",
        arrayBuffer: async () => responseBuffer,
      })),
    })
    await expect(protocolClient.fetchInfoRefs({url: "https://github.com/example/repo.git"})).rejects.toMatchObject({
      code: "protocol-error",
    })

    try {
      selectUploadPackCapabilities(CAPABILITIES.filter(capability => capability !== "filter"), {
        requireFilter: true,
      })
      throw new Error("Expected missing filter capability")
    } catch (error) {
      expect(error).toMatchObject({code: "missing-filter-capability"})
    }
  })
})

describe("natural read upload-pack primitives", () => {
  it("builds want requests and reports missing filter support", () => {
    const selected = selectUploadPackCapabilities(CAPABILITIES, {requireFilter: true})
    expect(selected).toEqual([
      "ofs-delta",
      "no-progress",
      "multi_ack_detailed",
      "side-band-64k",
      "filter",
    ])

    const want = createUploadPackWantRequest({
      commitHash: "a".repeat(40),
      capabilities: selected,
      deepen: 1,
      filter: "blob:none",
    })

    expect(want).toContain(`want ${"a".repeat(40)} `)
    expect(want).toContain("deepen 1\n")
    expect(want).toContain("filter blob:none\n")
    expect(want.endsWith(encodePktLine("done\n"))).toBe(true)

    expect(() =>
      selectUploadPackCapabilities(CAPABILITIES.filter(capability => capability !== "filter"), {
        requireFilter: true,
      }),
    ).toThrowError(GitNaturalReadError)
  })

  it("extracts side-band pack data", () => {
    const response = concatBytes(
      pktBytes("NAK\n"),
      pktBytes(concatBytes(new Uint8Array([1]), encoder.encode("PACKDATA"))),
      encoder.encode("0000"),
    )

    expect(decoder.decode(extractPackfileFromUploadPackResponse(response))).toBe("PACKDATA")
  })

  it("fetches blob:none and tree:0 packfiles without parsing them yet", async () => {
    const response = concatBytes(
      pktBytes("NAK\n"),
      pktBytes(concatBytes(new Uint8Array([1]), encoder.encode("PACK"))),
      encoder.encode("0000"),
    )
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer(response),
    }))
    const client = new GitNaturalReadClient({fetcher})

    const blobNone = await client.fetchBlobNonePackfile({
      url: "https://example.com/repo.git",
      commitHash: "a".repeat(40),
      serverCapabilities: CAPABILITIES,
    })
    const treeZero = await client.fetchTreeZeroPackfile({
      url: "https://example.com/repo.git",
      commitHash: "b".repeat(40),
      serverCapabilities: CAPABILITIES,
      maxCommits: 15,
    })

    expect(decoder.decode(blobNone.packfile)).toBe("PACK")
    expect(decoder.decode(treeZero.packfile)).toBe("PACK")
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://example.com/repo.git/git-upload-pack",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("filter blob:none\n"),
      }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://example.com/repo.git/git-upload-pack",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("filter tree:0\n"),
      }),
    )
  })
})
