import {createHash} from "node:crypto"
import {deflateSync} from "node:zlib"

import {indexedDB as fakeIndexedDB} from "fake-indexeddb"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
  GitNaturalObjectCache,
  gitNaturalCacheKeys,
  type GitNaturalAsyncObjectStore,
  type GitNaturalInfoRefs,
} from "../../src/git/natural-read-cache.js"
import {GitNaturalIndexedObjectStore} from "../../src/git/natural-read-indexed-cache.js"
import {GitNaturalObservedObjectBridge} from "../../src/git/natural-read-observed-cache.js"
import {
  GitNaturalApiAdapter,
  selectGitNaturalApiCapabilities,
} from "../../src/git/natural-read-api-adapter.js"
import {GitNaturalReadProvider} from "../../src/git/natural-read-provider.js"
import {GitNaturalReadError, resolveNaturalReadTransport} from "../../src/git/natural-read-transport.js"
import type {GitNaturalCommit} from "../../src/git/natural-read-types.js"

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

const encodePktLine = (payload: string): string => {
  if (payload.length === 0) return "0000"
  return (payload.length + 4).toString(16).padStart(4, "0") + payload
}

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

const uint32 = (value: number): Uint8Array =>
  Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])

const hexBytes = (hash: string): Uint8Array =>
  Uint8Array.from(hash.match(/../g)?.map(byte => Number.parseInt(byte, 16)) ?? [])

const packObjectHeader = (type: number, size: number): Uint8Array => {
  const bytes: number[] = []
  let remaining = size >>> 4
  let first = (type << 4) | (size & 0x0f)
  if (remaining > 0) first |= 0x80
  bytes.push(first)
  while (remaining > 0) {
    let next = remaining & 0x7f
    remaining >>>= 7
    if (remaining > 0) next |= 0x80
    bytes.push(next)
  }
  return Uint8Array.from(bytes)
}

const gitObjectHash = (type: string, data: Uint8Array): string =>
  createHash("sha1").update(`${type} ${data.length}\0`).update(data).digest("hex")

const buildBlobPack = (content: string): {hash: string; data: Uint8Array; packfile: Uint8Array} => {
  const data = encoder.encode(content)
  const packfile = concatBytes(
    encoder.encode("PACK"),
    uint32(2),
    uint32(1),
    packObjectHeader(3, data.length),
    new Uint8Array(deflateSync(data)),
  )
  return {hash: gitObjectHash("blob", data), data, packfile}
}

const buildTreeData = (entries: Array<{mode: string; name: string; hash: string}>): Uint8Array =>
  concatBytes(...entries.map(entry => concatBytes(encoder.encode(`${entry.mode} ${entry.name}\0`), hexBytes(entry.hash))))

const sideBandPacket = (channel: number, payload: string | Uint8Array): Uint8Array => {
  const payloadBytes = typeof payload === "string" ? encoder.encode(payload) : payload
  return pktBytes(concatBytes(Uint8Array.of(channel), payloadBytes))
}

const uploadPackResponseFetch = (response: Uint8Array) =>
  vi.fn(async () => ({
    status: 200,
    text: async () => decoder.decode(response),
    bytes: async () => response,
  }))

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes)
  return copy.buffer
}

const hashForIndex = (index: number): string => (index + 1).toString(16).padStart(2, "0").repeat(20)

const makeCommitChain = (count: number): GitNaturalCommit[] =>
  Array.from({length: count}, (_, index) => ({
    hash: hashForIndex(index),
    tree: "f".repeat(40),
    parents: index + 1 < count ? [hashForIndex(index + 1)] : [],
    author: {name: "Ada", email: "ada@example.com", timestamp: 1_000 - index, timezone: "+0000"},
    committer: {name: "Ada", email: "ada@example.com", timestamp: 1_000 - index, timezone: "+0000"},
    message: `Commit ${index}\n`,
  }))

function makeFakeNaturalAdapter(
  commits: GitNaturalCommit[],
  opts: {
    throwOnce?: (params: {commitHash: string; maxCommits: number}) => Error | undefined
  } = {},
) {
  const byHash = new Map(commits.map((commit, index) => [commit.hash, {commit, index}]))
  const fetchTreeZeroObjects = vi.fn(async (params: {url: string; commitHash: string; maxCommits?: number}) => {
    const error = opts.throwOnce?.({
      commitHash: params.commitHash,
      maxCommits: params.maxCommits ?? 1,
    })
    if (error) throw error

    const start = byHash.get(params.commitHash)?.index ?? commits.length
    const selected = commits.slice(start, start + (params.maxCommits ?? 1))
    const objects = new Map(
      selected.map(commit => {
        const data = encoder.encode(JSON.stringify(commit))
        return [
          commit.hash,
          {
            type: 1,
            size: data.length,
            data,
            offset: 0,
            hash: commit.hash,
          },
        ]
      }),
    )

    return {
      remoteUrl: params.url,
      effectiveUrl: params.url,
      usesProxy: false,
      pack: {version: 2, count: objects.size, objects},
      elapsedMs: 1,
    }
  })

  const adapter = {
    fetchInfoRefs: vi.fn(async (params: {url: string}) => ({
      infoRefs: {
        refs: {HEAD: commits[0].hash, "refs/heads/main": commits[0].hash},
        capabilities: CAPABILITIES,
        symrefs: {HEAD: "refs/heads/main"},
        headRef: "refs/heads/main",
        headCommit: commits[0].hash,
      },
      remoteUrl: params.url,
      effectiveUrl: params.url,
      usesProxy: false,
      elapsedMs: 1,
    })),
    fetchTreeZeroObjects,
    parseCommit: vi.fn((data: Uint8Array) => JSON.parse(decoder.decode(data)) as GitNaturalCommit),
  } as unknown as GitNaturalApiAdapter

  return {adapter, fetchTreeZeroObjects}
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

  it("persists immutable objects through IndexedDB without persisting infoRefs", async () => {
    const dbName = testDbName("natural-cache")
    const commitHash = "a".repeat(40)
    const treeHash = "b".repeat(40)
    const blobHash = "c".repeat(40)
    const blobData = Uint8Array.from([0, 1, 2, 255])
    const commit = {hash: commitHash, tree: treeHash, parents: [], data: encoder.encode("commit data")}
    const tree = {
      hash: treeHash,
      data: encoder.encode("tree data"),
      entries: [{name: "file.bin", mode: "100644", hash: blobHash, type: "blob" as const}],
    }

    const store = new GitNaturalIndexedObjectStore({
      dbName,
      indexedDB: fakeIndexedDB as unknown as IDBFactory,
      cleanupEveryWrites: 1,
    })
    const cache = new GitNaturalObjectCache({asyncStore: store})
    cache.putInfoRefs("https://example.com/repo.git", {
      refs: {HEAD: commitHash},
      capabilities: ["filter"],
      symrefs: {},
      headCommit: commitHash,
    })
    cache.putCommit(commit)
    cache.putTree(tree)
    cache.putBlob({hash: blobHash, data: blobData})
    cache.putRawObjectBatch({
      commitHash,
      filter: "blob:none",
      objects: new Map([[blobHash, {hash: blobHash, type: "blob", data: blobData}]]),
      fetchedAt: 1,
    })
    cache.putHistoryBatch({startCommitHash: commitHash, limit: 1, commits: [commit], fetchedAt: 2})
    await cache.flushPersistence()
    cache.close()

    const nextStore = new GitNaturalIndexedObjectStore({
      dbName,
      indexedDB: fakeIndexedDB as unknown as IDBFactory,
    })
    const nextCache = new GitNaturalObjectCache({asyncStore: nextStore})

    expect(await nextCache.getCommitAsync(commitHash)).toMatchObject({hash: commitHash, tree: treeHash})
    expect(await nextCache.getTreeAsync(treeHash)).toMatchObject({hash: treeHash})
    expect(Array.from((await nextCache.getBlobAsync(blobHash))?.data ?? [])).toEqual([0, 1, 2, 255])
    const raw = await nextCache.getRawObjectBatchAsync(commitHash, "blob:none")
    expect(Array.from(raw?.objects.get(blobHash)?.data ?? [])).toEqual([0, 1, 2, 255])
    expect((await nextCache.getHistoryBatchAsync(commitHash, 1))?.commits[0]?.hash).toBe(commitHash)
    expect(nextCache.getInfoRefs("https://example.com/repo.git")).toBeUndefined()

    nextCache.close()
    await deleteTestDb(dbName)
  })

  it("falls back to memory-only behavior when the async store throws", async () => {
    const throwingStore = new Proxy(
      {},
      {
        get: () => async () => {
          throw new Error("indexeddb unavailable")
        },
      },
    ) as GitNaturalAsyncObjectStore
    const cache = new GitNaturalObjectCache({asyncStore: throwingStore})
    const blobHash = "d".repeat(40)

    expect(await cache.getBlobAsync(blobHash)).toBeUndefined()
    cache.putBlob({hash: blobHash, data: Uint8Array.from([1, 2, 3])})
    await cache.flushPersistence()
    expect(Array.from(cache.getBlob(blobHash)?.data ?? [])).toEqual([1, 2, 3])
  })

  it("bridges observed clone-backed blobs into the natural persistent cache", async () => {
    const dbName = testDbName("natural-observed-cache")
    const blobHash = "e".repeat(40)
    const observedCache = new GitNaturalObjectCache({
      asyncStore: new GitNaturalIndexedObjectStore({
        dbName,
        indexedDB: fakeIndexedDB as unknown as IDBFactory,
      }),
    })
    const bridge = new GitNaturalObservedObjectBridge(observedCache)

    expect(bridge.cacheBlob(blobHash.toUpperCase(), Uint8Array.from([9, 8, 7]))).toBe(true)
    expect(bridge.cacheBlob("not-a-hash", Uint8Array.from([1]))).toBe(false)
    await bridge.flushPersistence()
    bridge.close()

    const naturalCache = new GitNaturalObjectCache({
      asyncStore: new GitNaturalIndexedObjectStore({
        dbName,
        indexedDB: fakeIndexedDB as unknown as IDBFactory,
      }),
    })
    expect(Array.from((await naturalCache.getBlobAsync(blobHash))?.data ?? [])).toEqual([9, 8, 7])

    naturalCache.close()
    await deleteTestDb(dbName)
  })
})

function testDbName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function deleteTestDb(dbName: string): Promise<void> {
  await new Promise<void>(resolve => {
    const request = fakeIndexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

describe("natural read transport", () => {
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
})

describe("natural read API adapter", () => {
  it("fetches and caches infoRefs through the library primitive", async () => {
    const advertisement = buildAdvertisement()
    const fetcher = vi.fn(async () => ({
      status: 200,
      text: async () => advertisement,
      bytes: async () => encoder.encode(advertisement),
    }))
    vi.stubGlobal("fetch", fetcher)
    const cache = new GitNaturalObjectCache()
    const adapter = new GitNaturalApiAdapter({cache})

    const first = await adapter.fetchInfoRefs({url: "https://example.com/repo.git"})
    const second = await adapter.fetchInfoRefs({url: "https://example.com/repo.git"})

    expect(first.infoRefs.headRef).toBe("refs/heads/main")
    expect(second.infoRefs.headCommit).toBe("1".repeat(40))
    expect(selectGitNaturalApiCapabilities(first.infoRefs.capabilities, {requireFilter: true})).toEqual([
      "multi_ack_detailed",
      "side-band-64k",
      "filter",
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith("https://example.com/repo.git/info/refs?service=git-upload-pack")
  })

  it("parses library packfiles that include shallow, unshallow, and side-band progress packets", async () => {
    const blob = buildBlobPack("hello from git-natural-api\n")
    const response = concatBytes(
      pktBytes(`shallow ${"a".repeat(40)}\n`),
      pktBytes("NAK\n"),
      pktBytes(`unshallow ${"b".repeat(40)}\n`),
      sideBandPacket(2, "counting objects: 1\n"),
      sideBandPacket(1, blob.packfile.subarray(0, 9)),
      sideBandPacket(1, blob.packfile.subarray(9)),
      encoder.encode("0000"),
    )
    const fetcher = uploadPackResponseFetch(response)
    vi.stubGlobal("fetch", fetcher)
    const adapter = new GitNaturalApiAdapter()

    const result = await adapter.fetchObjectByHash({
      url: "https://example.com/repo.git",
      objectHash: blob.hash,
      serverCapabilities: CAPABILITIES,
    })

    expect(decoder.decode(result.object.data)).toBe("hello from git-natural-api\n")
    expect(result.pack.count).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://example.com/repo.git/git-upload-pack")
    expect(init.method).toBe("POST")
    expect(String(init.body)).toContain(`want ${blob.hash}`)
    expect(fetcher.mock.calls.some(([calledUrl]) => String(calledUrl).includes("/info/refs"))).toBe(false)
  })

  it("builds blob:none and tree:0 requests from supplied cached capabilities", async () => {
    const blob = buildBlobPack("filtered response\n")
    const response = concatBytes(pktBytes("NAK\n"), sideBandPacket(1, blob.packfile), encoder.encode("0000"))
    const fetcher = uploadPackResponseFetch(response)
    vi.stubGlobal("fetch", fetcher)
    const adapter = new GitNaturalApiAdapter()

    await adapter.fetchBlobNoneObjects({
      url: "https://example.com/repo.git",
      commitHash: "c".repeat(40),
      serverCapabilities: CAPABILITIES,
    })
    await adapter.fetchTreeZeroObjects({
      url: "https://example.com/repo.git",
      commitHash: "d".repeat(40),
      serverCapabilities: CAPABILITIES,
      maxCommits: 12,
    })

    const firstBody = String((fetcher.mock.calls[0] as [string, RequestInit])[1].body)
    const secondBody = String((fetcher.mock.calls[1] as [string, RequestInit])[1].body)
    expect(firstBody).toContain("filter blob:none\n")
    expect(firstBody).toContain("deepen 1\n")
    expect(secondBody).toContain("filter tree:0\n")
    expect(secondBody).toContain("deepen 12\n")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("reports missing and invalid library pack responses as protocol errors", async () => {
    const adapter = new GitNaturalApiAdapter()

    vi.stubGlobal("fetch", uploadPackResponseFetch(concatBytes(pktBytes("NAK\n"), encoder.encode("0000"))))
    await expect(
      adapter.fetchBlobNoneObjects({
        url: "https://example.com/repo.git",
        commitHash: "e".repeat(40),
        serverCapabilities: CAPABILITIES,
      }),
    ).rejects.toMatchObject({code: "protocol-error"})

    vi.stubGlobal(
      "fetch",
      uploadPackResponseFetch(concatBytes(pktBytes("NAK\n"), sideBandPacket(1, "NOPE"), encoder.encode("0000"))),
    )
    await expect(
      adapter.fetchBlobNoneObjects({
        url: "https://example.com/repo.git",
        commitHash: "f".repeat(40),
        serverCapabilities: CAPABILITIES,
      }),
    ).rejects.toMatchObject({
      code: "protocol-error",
      filter: "blob:none",
      depth: 1,
      parserFailureClass: "pack-parser",
      message: expect.stringContaining("invalid packfile header"),
    })

    vi.stubGlobal(
      "fetch",
      uploadPackResponseFetch(concatBytes(pktBytes("NAK\n"), sideBandPacket(1, "NOPE"), encoder.encode("0000"))),
    )
    await expect(
      adapter.fetchTreeZeroObjects({
        url: "https://user:secret@example.com/repo.git",
        commitHash: "a".repeat(40),
        serverCapabilities: CAPABILITIES,
        maxCommits: 12,
      }),
    ).rejects.toMatchObject({
      code: "protocol-error",
      filter: "tree:0",
      depth: 12,
      parserFailureClass: "pack-parser",
      message: expect.stringContaining("remote=https://redacted@example.com/repo.git"),
    })
  })

  it("exposes library tree loading and commit parsing", () => {
    const adapter = new GitNaturalApiAdapter()
    const blobData = encoder.encode("readme\n")
    const blobHash = gitObjectHash("blob", blobData)
    const treeData = buildTreeData([{mode: "100644", name: "README.md", hash: blobHash}])
    const treeHash = gitObjectHash("tree", treeData)
    const treeObject = {type: 2, size: treeData.length, data: treeData, offset: 0, hash: treeHash}
    const blobObject = {type: 3, size: blobData.length, data: blobData, offset: 0, hash: blobHash}
    const tree = adapter.loadTree(treeObject, new Map([[treeHash, treeObject], [blobHash, blobObject]]), 1)

    expect(tree.files[0]).toMatchObject({name: "README.md", hash: blobHash})
    expect(decoder.decode(tree.files[0]?.content ?? new Uint8Array())).toBe("readme\n")

    const commit = adapter.parseCommit(
      encoder.encode(
        `tree ${treeHash}\nparent ${"a".repeat(40)}\nauthor Ada <ada@example.com> 1 +0000\ncommitter Ada <ada@example.com> 2 +0000\n\nInitial commit\n`,
      ),
      "b".repeat(40),
    )
    expect(commit.tree).toBe(treeHash)
    expect(commit.parents).toEqual(["a".repeat(40)])
    expect(commit.message).toBe("Initial commit\n")
  })
})

describe("GitNaturalReadProvider commit history batching", () => {
  it("fetches commit history in bounded tree:0 batches", async () => {
    const commits = makeCommitChain(20)
    const cache = new GitNaturalObjectCache({asyncStore: false})
    const {adapter, fetchTreeZeroObjects} = makeFakeNaturalAdapter(commits)
    const provider = new GitNaturalReadProvider({enabled: true, cache, adapter})

    const result = await provider.listCommits({
      url: "https://example.com/repo.git",
      ref: "main",
      depth: 20,
    })

    expect(result.commits.map(commit => commit.hash)).toEqual(commits.map(commit => commit.hash))
    expect(fetchTreeZeroObjects).toHaveBeenCalledTimes(2)
    expect(fetchTreeZeroObjects.mock.calls.map(([params]) => params.maxCommits)).toEqual([15, 5])
    expect(fetchTreeZeroObjects.mock.calls.map(([params]) => params.commitHash)).toEqual([
      commits[0].hash,
      commits[15].hash,
    ])
    expect((await cache.getHistoryBatchAsync<GitNaturalCommit>(commits[0].hash, 15))?.commits).toHaveLength(15)
    expect((await cache.getHistoryBatchAsync<GitNaturalCommit>(commits[15].hash, 5))?.commits).toHaveLength(5)
    expect((await cache.getHistoryBatchAsync<GitNaturalCommit>(commits[0].hash, 20))?.commits).toHaveLength(20)
  })

  it("retries smaller tree:0 batches on wrapped BigBatch parser errors", async () => {
    const commits = makeCommitChain(10)
    const cache = new GitNaturalObjectCache({asyncStore: false})
    let threwBigBatch = false
    const {adapter, fetchTreeZeroObjects} = makeFakeNaturalAdapter(commits, {
      throwOnce: ({maxCommits}) => {
        if (threwBigBatch || maxCommits !== 10) return undefined
        threwBigBatch = true
        return new GitNaturalReadError(
          "protocol-error",
          "Git natural API upload-pack failed: we tried to decompress too much data at the same time",
          {cause: new Error("we tried to decompress too much data at the same time")},
        )
      },
    })
    const provider = new GitNaturalReadProvider({enabled: true, cache, adapter})

    const result = await provider.listCommits({
      url: "https://example.com/repo.git",
      ref: "main",
      depth: 10,
    })

    expect(result.commits.map(commit => commit.hash)).toEqual(commits.map(commit => commit.hash))
    expect(fetchTreeZeroObjects.mock.calls.map(([params]) => params.maxCommits)).toEqual([10, 5, 5])
    expect(fetchTreeZeroObjects.mock.calls.map(([params]) => params.commitHash)).toEqual([
      commits[0].hash,
      commits[0].hash,
      commits[5].hash,
    ])
    expect((await cache.getHistoryBatchAsync<GitNaturalCommit>(commits[0].hash, 10))?.commits).toHaveLength(10)
  })
})
