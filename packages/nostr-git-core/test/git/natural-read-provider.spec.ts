import {createHash} from "node:crypto"

import {afterEach, describe, expect, it, vi} from "vitest"
import {zlibSync} from "fflate"

import {GitNaturalReadProvider} from "../../src/git/natural-read-provider.js"

const encoder = new TextEncoder()

const REMOTE_URL = "https://example.com/owner/repo.git"
const CAPABILITIES = [
  "ofs-delta",
  "no-progress",
  "multi_ack_detailed",
  "side-band-64k",
  "shallow",
  "object-format=sha1",
  "filter",
]

afterEach(() => {
  vi.restoreAllMocks()
})

function encodePktLine(payload: string): string {
  if (payload.length === 0) return "0000"
  return (payload.length + 4).toString(16).padStart(4, "0") + payload
}

function computeGitNaturalObjectHash(type: "blob" | "commit" | "tag" | "tree", data: Uint8Array): string {
  return createHash("sha1").update(`${type} ${data.length}\0`).update(data).digest("hex")
}

describe("GitNaturalReadProvider", () => {
  it("is disabled unless the caller opts in", async () => {
    const provider = new GitNaturalReadProvider()

    await expect(provider.listRefs({url: REMOTE_URL})).rejects.toMatchObject({
      code: "feature-disabled",
    })
  })

  it("lists refs and resolves HEAD, branches, peeled tags, and direct commits", async () => {
    const fixture = createGitFixture()
    const fetcher = createFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    const refs = await provider.listRefs({url: REMOTE_URL, symrefs: true})
    const head = refs.refs.find(ref => ref.ref === "HEAD")

    expect(refs.defaultBranch).toBe("main")
    expect(head?.target).toBe("refs/heads/main")
    expect(refs.source.kind).toBe("git-natural")
    expect(refs.source.remoteUrl).toBe(REMOTE_URL)

    await expect(provider.resolveRef({url: REMOTE_URL, ref: "HEAD"})).resolves.toMatchObject({
      resolvedRef: "refs/heads/main",
      commitHash: fixture.tipHash,
    })
    await expect(provider.resolveRef({url: REMOTE_URL, ref: "main"})).resolves.toMatchObject({
      resolvedRef: "refs/heads/main",
      commitHash: fixture.tipHash,
    })
    await expect(provider.resolveRef({url: REMOTE_URL, ref: "refs/heads/main"})).resolves.toMatchObject({
      commitHash: fixture.tipHash,
    })
    await expect(provider.resolveRef({url: REMOTE_URL, ref: "v1.0.0"})).resolves.toMatchObject({
      resolvedRef: "refs/tags/v1.0.0",
      commitHash: fixture.tipHash,
      objectHash: fixture.tagHash,
      peeled: true,
    })
    await expect(provider.resolveRef({url: REMOTE_URL, ref: fixture.tipHash})).resolves.toMatchObject({
      commitHash: fixture.tipHash,
    })
    await expect(provider.resolveRef({url: REMOTE_URL, ref: "missing"})).rejects.toMatchObject({
      code: "ref-not-found",
    })
  })

  it("lists directories with blob:none and fetches file content by object hash", async () => {
    const fixture = createGitFixture()
    const fetcher = createFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    const root = await provider.listDirectory({url: REMOTE_URL, ref: "main"})
    expect(root.commitHash).toBe(fixture.tipHash)
    expect(root.treeHash).toBe(fixture.rootTreeHash)
    expect(root.entries).toEqual([
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        mode: "100644",
        oid: fixture.readmeHash,
      },
      {
        name: "src",
        path: "src",
        type: "directory",
        mode: "40000",
        oid: fixture.srcTreeHash,
      },
    ])
    expect(root.source.capability).toBe("filter=blob:none")

    const src = await provider.listDirectory({url: REMOTE_URL, ref: "main", path: "src"})
    expect(src.entries.map(entry => entry.path)).toEqual(["src/index.ts"])

    const file = await provider.getFileContent({url: REMOTE_URL, ref: "main", path: "README.md"})
    expect(file.objectHash).toBe(fixture.readmeHash)
    expect(file.encoding).toBe("base64")
    expect(file.content).toBe("SGVsbG8gbmF0dXJhbAo=")
    expect(file.size).toBe(fixture.readmeData.length)

    const postBodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(postBodies.some(body => body.includes("filter blob:none\n"))).toBe(true)
    expect(postBodies.some(body => body.includes(`want ${fixture.readmeHash}`))).toBe(true)
  })

  it("dedupes concurrent filtered object fetches", async () => {
    const blobNoneFixture = createGitFixture()
    const blobNoneFetcher = createFixtureFetcher(blobNoneFixture)
    const blobNoneProvider = new GitNaturalReadProvider({enabled: true, fetcher: blobNoneFetcher})

    await Promise.all([
      blobNoneProvider.listDirectory({url: REMOTE_URL, ref: "main"}),
      blobNoneProvider.listDirectory({url: REMOTE_URL, ref: "main"}),
    ])

    const blobNonePostBodies = blobNoneFetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(blobNonePostBodies.filter(body => body.includes("filter blob:none\n"))).toHaveLength(1)

    const treeZeroFixture = createGitFixture()
    const treeZeroFetcher = createFixtureFetcher(treeZeroFixture)
    const treeZeroProvider = new GitNaturalReadProvider({enabled: true, fetcher: treeZeroFetcher})

    await Promise.all([
      treeZeroProvider.listCommits({url: REMOTE_URL, ref: "main", depth: 2}),
      treeZeroProvider.listCommits({url: REMOTE_URL, ref: "main", depth: 2}),
    ])

    const treeZeroPostBodies = treeZeroFetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(treeZeroPostBodies.filter(body => body.includes("filter tree:0\n"))).toHaveLength(1)
  })

  it("keeps concurrent filtered fetches separate across proxy modes", async () => {
    const fixture = createGitFixture()
    const fetcher = createFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({
      enabled: true,
      fetcher,
      corsProxy: "https://proxy.example.test",
    })

    await Promise.all([
      provider.listDirectory({url: REMOTE_URL, ref: "main"}),
      provider.listDirectory({url: REMOTE_URL, ref: "main", corsProxy: null}),
    ])

    const postBodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(postBodies.filter(body => body.includes("filter blob:none\n"))).toHaveLength(2)
  })

  it("lists commit history with tree:0 and returns one commit", async () => {
    const fixture = createGitFixture()
    const fetcher = createFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    const history = await provider.listCommits({url: REMOTE_URL, ref: "main", depth: 2})
    expect(history.commits.map(commit => commit.hash)).toEqual([fixture.tipHash, fixture.parentHash])
    expect(history.commits[0].message).toBe("tip commit\n")
    expect(history.source.capability).toBe("filter=tree:0")

    const commit = await provider.getCommit({url: REMOTE_URL, ref: "main"})
    expect(commit.commit.hash).toBe(fixture.tipHash)
    expect(commit.source.operation).toBe("getCommit")

    const postBodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(postBodies.some(body => body.includes("filter tree:0\n"))).toBe(true)
  })

  it("builds diffs from blob:none tree metadata and fetches only changed blobs", async () => {
    const fixture = createDiffFixture()
    const fetcher = createDiffFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    const diff = await provider.getDiffBetween({
      url: REMOTE_URL,
      baseCommitHash: fixture.baseHash,
      headCommitHash: fixture.headHash,
    })

    expect(diff.baseCommitHash).toBe(fixture.baseHash)
    expect(diff.headCommitHash).toBe(fixture.headHash)
    expect(diff.source.operation).toBe("getDiffBetween")
    expect(diff.source.capability).toBe("filter=blob:none,object-by-hash")
    expect(diff.changes.map(change => [change.path, change.status])).toEqual([
      ["README.md", "modified"],
      ["added.txt", "added"],
      ["delete.txt", "deleted"],
    ])

    const readme = diff.changes.find(change => change.path === "README.md")
    expect(readme?.oldOid).toBe(fixture.oldReadmeHash)
    expect(readme?.newOid).toBe(fixture.newReadmeHash)
    expect(readme?.diffHunks[0]?.patches.map(patch => patch.type)).toContain("-")
    expect(readme?.diffHunks[0]?.patches.map(patch => patch.type)).toContain("+")

    const postBodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => String(init?.body || ""))
    expect(postBodies.filter(body => body.includes("filter blob:none\n"))).toHaveLength(2)
    expect(postBodies.some(body => body.includes(`want ${fixture.oldReadmeHash}`))).toBe(true)
    expect(postBodies.some(body => body.includes(`want ${fixture.newReadmeHash}`))).toBe(true)
    expect(postBodies.some(body => body.includes(`want ${fixture.addedHash}`))).toBe(true)
    expect(postBodies.some(body => body.includes(`want ${fixture.deletedHash}`))).toBe(true)
    expect(postBodies.some(body => body.includes(`want ${fixture.unchangedHash}`))).toBe(false)
  })

  it("returns metadata-only changes for binary diffs", async () => {
    const fixture = createBinaryDiffFixture()
    const fetcher = createDiffFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    const diff = await provider.getDiffBetween({
      url: REMOTE_URL,
      baseCommitHash: fixture.baseHash,
      headCommitHash: fixture.headHash,
    })

    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({
      path: "logo.png",
      status: "modified",
      oldOid: fixture.oldImageHash,
      newOid: fixture.newImageHash,
      binary: true,
      diffHunks: [],
    })
  })

  it("declines filtered operations when the server lacks filter support", async () => {
    const fixture = createGitFixture({capabilities: CAPABILITIES.filter(cap => cap !== "filter")})
    const fetcher = createFixtureFetcher(fixture)
    const provider = new GitNaturalReadProvider({enabled: true, fetcher})

    await expect(provider.listDirectory({url: REMOTE_URL, ref: "main"})).rejects.toMatchObject({
      code: "missing-filter-capability",
      capability: "filter",
    })
    await expect(provider.listCommits({url: REMOTE_URL, ref: "main"})).rejects.toMatchObject({
      code: "missing-filter-capability",
      capability: "filter",
    })
  })
})

function createGitFixture(options: {capabilities?: string[]} = {}) {
  const capabilities = options.capabilities ?? CAPABILITIES
  const readmeData = encoder.encode("Hello natural\n")
  const indexData = encoder.encode("export const answer = 42\n")
  const readmeHash = computeGitNaturalObjectHash("blob", readmeData)
  const indexHash = computeGitNaturalObjectHash("blob", indexData)
  const srcTreeData = treeData([{mode: "100644", name: "index.ts", hash: indexHash}])
  const srcTreeHash = computeGitNaturalObjectHash("tree", srcTreeData)
  const rootTreeData = treeData([
    {mode: "100644", name: "README.md", hash: readmeHash},
    {mode: "40000", name: "src", hash: srcTreeHash},
  ])
  const rootTreeHash = computeGitNaturalObjectHash("tree", rootTreeData)
  const parentCommitData = commitData({tree: rootTreeHash, message: "parent commit", timestamp: 1_700_000_000})
  const parentHash = computeGitNaturalObjectHash("commit", parentCommitData)
  const tipCommitData = commitData({
    tree: rootTreeHash,
    parent: parentHash,
    message: "tip commit",
    timestamp: 1_700_000_100,
  })
  const tipHash = computeGitNaturalObjectHash("commit", tipCommitData)
  const tagData = encoder.encode(
    [`object ${tipHash}`, "type commit", "tag v1.0.0", "tagger T <t@example.com> 1700000100 +0000", "", "release", ""].join("\n"),
  )
  const tagHash = computeGitNaturalObjectHash("tag", tagData)

  return {
    capabilities,
    readmeData,
    readmeHash,
    indexHash,
    srcTreeHash,
    rootTreeHash,
    parentHash,
    tipHash,
    tagHash,
    advertisement: buildAdvertisement({tipHash, tagHash, capabilities}),
    blobNonePack: packfile([
      {type: "commit", data: tipCommitData},
      {type: "tree", data: rootTreeData},
      {type: "tree", data: srcTreeData},
    ]),
    historyPack: packfile([
      {type: "commit", data: parentCommitData},
      {type: "commit", data: tipCommitData},
    ]),
    readmePack: packfile([{type: "blob", data: readmeData}]),
  }
}

function createDiffFixture() {
  const oldReadmeData = encoder.encode("Hello old\n")
  const newReadmeData = encoder.encode("Hello new\n")
  const addedData = encoder.encode("Added file\n")
  const deletedData = encoder.encode("Deleted file\n")
  const unchangedData = encoder.encode("export const answer = 42\n")
  const oldReadmeHash = computeGitNaturalObjectHash("blob", oldReadmeData)
  const newReadmeHash = computeGitNaturalObjectHash("blob", newReadmeData)
  const addedHash = computeGitNaturalObjectHash("blob", addedData)
  const deletedHash = computeGitNaturalObjectHash("blob", deletedData)
  const unchangedHash = computeGitNaturalObjectHash("blob", unchangedData)
  const srcTreeData = treeData([{mode: "100644", name: "index.ts", hash: unchangedHash}])
  const srcTreeHash = computeGitNaturalObjectHash("tree", srcTreeData)
  const baseRootTreeData = treeData([
    {mode: "100644", name: "README.md", hash: oldReadmeHash},
    {mode: "100644", name: "delete.txt", hash: deletedHash},
    {mode: "40000", name: "src", hash: srcTreeHash},
  ])
  const baseRootTreeHash = computeGitNaturalObjectHash("tree", baseRootTreeData)
  const headRootTreeData = treeData([
    {mode: "100644", name: "README.md", hash: newReadmeHash},
    {mode: "100644", name: "added.txt", hash: addedHash},
    {mode: "40000", name: "src", hash: srcTreeHash},
  ])
  const headRootTreeHash = computeGitNaturalObjectHash("tree", headRootTreeData)
  const baseCommitData = commitData({tree: baseRootTreeHash, message: "base commit", timestamp: 1_700_000_000})
  const baseHash = computeGitNaturalObjectHash("commit", baseCommitData)
  const headCommitData = commitData({
    tree: headRootTreeHash,
    parent: baseHash,
    message: "head commit",
    timestamp: 1_700_000_100,
  })
  const headHash = computeGitNaturalObjectHash("commit", headCommitData)
  const tagData = encoder.encode(
    [`object ${headHash}`, "type commit", "tag v1.0.0", "tagger T <t@example.com> 1700000100 +0000", "", "release", ""].join("\n"),
  )
  const tagHash = computeGitNaturalObjectHash("tag", tagData)

  return {
    oldReadmeHash,
    newReadmeHash,
    addedHash,
    deletedHash,
    unchangedHash,
    baseHash,
    headHash,
    advertisement: buildAdvertisement({tipHash: headHash, tagHash, capabilities: CAPABILITIES}),
    blobNonePacks: new Map([
      [
        baseHash,
        packfile([
          {type: "commit", data: baseCommitData},
          {type: "tree", data: baseRootTreeData},
          {type: "tree", data: srcTreeData},
        ]),
      ],
      [
        headHash,
        packfile([
          {type: "commit", data: headCommitData},
          {type: "tree", data: headRootTreeData},
          {type: "tree", data: srcTreeData},
        ]),
      ],
    ]),
    blobPacks: new Map([
      [oldReadmeHash, packfile([{type: "blob", data: oldReadmeData}])],
      [newReadmeHash, packfile([{type: "blob", data: newReadmeData}])],
      [addedHash, packfile([{type: "blob", data: addedData}])],
      [deletedHash, packfile([{type: "blob", data: deletedData}])],
      [unchangedHash, packfile([{type: "blob", data: unchangedData}])],
    ]),
  }
}

type DiffFixtureLike = Pick<
  ReturnType<typeof createDiffFixture>,
  "advertisement" | "baseHash" | "blobNonePacks" | "blobPacks" | "headHash"
>

function createBinaryDiffFixture() {
  const oldImageData = new Uint8Array([0, 1, 2, 3])
  const newImageData = new Uint8Array([0, 1, 2, 4])
  const oldImageHash = computeGitNaturalObjectHash("blob", oldImageData)
  const newImageHash = computeGitNaturalObjectHash("blob", newImageData)
  const baseRootTreeData = treeData([{mode: "100644", name: "logo.png", hash: oldImageHash}])
  const headRootTreeData = treeData([{mode: "100644", name: "logo.png", hash: newImageHash}])
  const baseRootTreeHash = computeGitNaturalObjectHash("tree", baseRootTreeData)
  const headRootTreeHash = computeGitNaturalObjectHash("tree", headRootTreeData)
  const baseCommitData = commitData({tree: baseRootTreeHash, message: "base commit", timestamp: 1_700_000_000})
  const baseHash = computeGitNaturalObjectHash("commit", baseCommitData)
  const headCommitData = commitData({
    tree: headRootTreeHash,
    parent: baseHash,
    message: "head commit",
    timestamp: 1_700_000_100,
  })
  const headHash = computeGitNaturalObjectHash("commit", headCommitData)
  const tagData = encoder.encode(
    [`object ${headHash}`, "type commit", "tag v1.0.0", "tagger T <t@example.com> 1700000100 +0000", "", "release", ""].join("\n"),
  )
  const tagHash = computeGitNaturalObjectHash("tag", tagData)

  return {
    oldImageHash,
    newImageHash,
    baseHash,
    headHash,
    advertisement: buildAdvertisement({tipHash: headHash, tagHash, capabilities: CAPABILITIES}),
    blobNonePacks: new Map([
      [
        baseHash,
        packfile([
          {type: "commit", data: baseCommitData},
          {type: "tree", data: baseRootTreeData},
        ]),
      ],
      [
        headHash,
        packfile([
          {type: "commit", data: headCommitData},
          {type: "tree", data: headRootTreeData},
        ]),
      ],
    ]),
    blobPacks: new Map([
      [oldImageHash, packfile([{type: "blob", data: oldImageData}])],
      [newImageHash, packfile([{type: "blob", data: newImageData}])],
    ]),
  }
}

function createDiffFixtureFetcher(fixture: DiffFixtureLike) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => fixture.advertisement,
        arrayBuffer: async () => arrayBuffer(encoder.encode(fixture.advertisement)),
      }
    }

    const body = String(init?.body || "")
    let pack: Uint8Array | undefined
    if (body.includes("filter blob:none")) {
      pack = body.includes(fixture.baseHash)
        ? fixture.blobNonePacks.get(fixture.baseHash)
        : fixture.blobNonePacks.get(fixture.headHash)
    } else {
      for (const [hash, blobPack] of fixture.blobPacks) {
        if (body.includes(hash)) {
          pack = blobPack
          break
        }
      }
    }

    const response = uploadPackResponse(pack ?? packfile([]))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer(response),
    }
  })
}

function createFixtureFetcher(fixture: ReturnType<typeof createGitFixture>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => fixture.advertisement,
        arrayBuffer: async () => arrayBuffer(encoder.encode(fixture.advertisement)),
      }
    }

    const body = String(init?.body || "")
    const pack = body.includes("filter blob:none")
      ? fixture.blobNonePack
      : body.includes("filter tree:0")
        ? fixture.historyPack
        : fixture.readmePack
    const response = uploadPackResponse(pack)
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer(response),
    }
  })
}

function buildAdvertisement(params: {
  tipHash: string
  tagHash: string
  capabilities: string[]
}): string {
  const capabilities = [...params.capabilities, "symref=HEAD:refs/heads/main", "agent=git/2.0"].join(" ")
  return [
    encodePktLine("# service=git-upload-pack\n"),
    "0000",
    encodePktLine(`${params.tipHash} HEAD\0${capabilities}\n`),
    encodePktLine(`${params.tipHash} refs/heads/main\n`),
    encodePktLine(`${params.tagHash} refs/tags/v1.0.0\n`),
    encodePktLine(`${params.tipHash} refs/tags/v1.0.0^{}\n`),
    "0000",
  ].join("")
}

function commitData(params: {
  tree: string
  parent?: string
  message: string
  timestamp: number
}): Uint8Array {
  return encoder.encode(
    [
      `tree ${params.tree}`,
      params.parent ? `parent ${params.parent}` : undefined,
      `author A <a@example.com> ${params.timestamp} +0000`,
      `committer C <c@example.com> ${params.timestamp} +0000`,
      "",
      params.message,
      "",
    ]
      .filter(line => line !== undefined)
      .join("\n"),
  )
}

function treeData(entries: Array<{mode: string; name: string; hash: string}>): Uint8Array {
  return concatBytes(
    ...entries.flatMap(entry => [
      encoder.encode(`${entry.mode} ${entry.name}`),
      new Uint8Array([0]),
      hexToBytes(entry.hash),
    ]),
  )
}

function packfile(objects: Array<{type: "commit" | "tree" | "blob" | "tag"; data: Uint8Array}>): Uint8Array {
  return concatBytes(
    encoder.encode("PACK"),
    uint32(2),
    uint32(objects.length),
    ...objects.map(object => packObject(object.type, object.data)),
    new Uint8Array(20),
  )
}

function packObject(type: "commit" | "tree" | "blob" | "tag", data: Uint8Array): Uint8Array {
  return concatBytes(packObjectHeader(typeCode(type), data.length), zlibSync(data))
}

function packObjectHeader(type: number, objectSize: number): Uint8Array {
  let size = objectSize
  const bytes: number[] = []
  let first = (type << 4) | (size & 0x0f)
  size >>>= 4
  if (size > 0) first |= 0x80
  bytes.push(first)
  while (size > 0) {
    let byte = size & 0x7f
    size >>>= 7
    if (size > 0) byte |= 0x80
    bytes.push(byte)
  }
  return new Uint8Array(bytes)
}

function typeCode(type: "commit" | "tree" | "blob" | "tag"): number {
  if (type === "commit") return 1
  if (type === "tree") return 2
  if (type === "blob") return 3
  return 4
}

function uploadPackResponse(pack: Uint8Array): Uint8Array {
  return concatBytes(pktBytes("NAK\n"), pktBytes(concatBytes(new Uint8Array([1]), pack)), encoder.encode("0000"))
}

function pktBytes(payload: string | Uint8Array): Uint8Array {
  const payloadBytes = typeof payload === "string" ? encoder.encode(payload) : payload
  const length = encoder.encode((payloadBytes.length + 4).toString(16).padStart(4, "0"))
  return concatBytes(length, payloadBytes)
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes)
  return copy.buffer
}
