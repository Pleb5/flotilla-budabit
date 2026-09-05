import {createHash} from "node:crypto"
import {deflateSync} from "node:zlib"

import {describe, expect, it, vi} from "vitest"

import {
  MissingRef,
  ObjectType,
  fetchPackfile,
  getInfoRefs,
  parsePackfile,
} from "../../src/git/git-natural-api/index.js"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe("owned git-natural pack parser", () => {
  it("uses exact zlib boundaries for adjacent compressible and incompressible objects", () => {
    const compressible = encoder.encode("a".repeat(128_000))
    const incompressible = Uint8Array.from({length: 32_000}, (_, index) => (index * 73 + 41) & 0xff)
    const pack = buildPack([
      baseObject(ObjectType.BLOB, compressible),
      baseObject(ObjectType.BLOB, incompressible),
      baseObject(ObjectType.TAG, encoder.encode("object deadbeef\ntype commit\ntag v1\n\nrelease\n")),
    ])

    const result = parsePackfile(pack)

    expect(result.count).toBe(3)
    expect(result.objects.get(gitObjectHash("blob", compressible))?.data).toEqual(compressible)
    expect(result.objects.get(gitObjectHash("blob", incompressible))?.data).toEqual(incompressible)
    expect(Array.from(result.objects.values(), object => object.type)).toEqual([
      ObjectType.BLOB,
      ObjectType.BLOB,
      ObjectType.TAG,
    ])
  })

  it("resolves OFS and REF deltas without losing the base object type", () => {
    const base = encoder.encode("hello world\n")
    const expected = encoder.encode("hello budabit\n")
    const delta = concatBytes(
      encodeVariableInt(base.length),
      encodeVariableInt(expected.length),
      Uint8Array.of(0x90, 6, 8),
      encoder.encode("budabit\n"),
    )
    const baseEntry = baseObject(ObjectType.BLOB, base)
    const baseHash = gitObjectHash("blob", base)

    const ofsBody = concatBytes(
      encoder.encode("PACK"),
      uint32(2),
      uint32(2),
      baseEntry,
      packObjectHeader(ObjectType.OFS_DELTA, delta.length),
      encodeOfsDistance(12 + baseEntry.length - 12),
      new Uint8Array(deflateSync(delta)),
    )
    const refBody = concatBytes(
      encoder.encode("PACK"),
      uint32(2),
      uint32(2),
      baseEntry,
      packObjectHeader(ObjectType.REF_DELTA, delta.length),
      hexBytes(baseHash),
      new Uint8Array(deflateSync(delta)),
    )

    for (const body of [ofsBody, refBody]) {
      const result = parsePackfile(withChecksum(body))
      const resolved = result.objects.get(gitObjectHash("blob", expected))
      expect(resolved?.type).toBe(ObjectType.BLOB)
      expect(resolved?.size).toBe(expected.length)
      expect(resolved?.data).toEqual(expected)
    }
  })

  it("rejects mismatched pack checksums", () => {
    const pack = buildPack([baseObject(ObjectType.BLOB, encoder.encode("content\n"))])
    pack[pack.length - 1] ^= 0xff
    expect(() => parsePackfile(pack)).toThrow("packfile SHA-1 checksum mismatch")
  })
})

describe("owned git-natural Smart HTTP transport", () => {
  it("parses byte-framed advertisements and passes the caller signal", async () => {
    const signal = new AbortController().signal
    const advertisement = concatBytes(
      pktLine("# service=git-upload-pack\n"),
      flushPacket(),
      pktLine(
        `${"1".repeat(40)} HEAD\0multi_ack_detailed side-band-64k shallow object-format=sha1 filter symref=HEAD:refs/heads/main\n`,
      ),
      pktLine(`${"1".repeat(40)} refs/heads/main\n`),
      flushPacket(),
    )
    const fetcher = vi.fn(async () => response(advertisement))

    const result = await getInfoRefs("https://example.com/repo.git", {fetcher, signal})

    expect(result.symrefs.HEAD).toBe("refs/heads/main")
    expect(result.refs["refs/heads/main"]).toBe("1".repeat(40))
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/repo.git/info/refs?service=git-upload-pack",
      {method: "GET", signal: expect.any(AbortSignal)},
    )
    const transportSignal = fetcher.mock.calls[0]?.[1]?.signal
    expect(transportSignal).not.toBe(signal)
    expect(transportSignal?.aborted).toBe(false)
  })

  it("assembles large side-band data with ACK and progress packets", async () => {
    const content = Uint8Array.from({length: 96_000}, (_, index) => index & 0xff)
    const pack = buildPack([baseObject(ObjectType.BLOB, content)])
    const responseBytes = concatBytes(
      pktLine(`ACK ${"a".repeat(40)} ready\n`),
      pktLine("NAK\n"),
      sideBandPacket(2, encoder.encode("counting objects\n")),
      ...chunk(pack, 16_000).map(bytes => sideBandPacket(1, bytes)),
      flushPacket(),
    )
    const fetcher = vi.fn(async () => response(responseBytes))

    const result = await fetchPackfile("https://example.com/repo.git", "want request", {fetcher})

    expect(result.objects.get(gitObjectHash("blob", content))?.data).toEqual(content)
  })

  it("surfaces side-band fatal errors and missing refs", async () => {
    await expect(
      fetchPackfile("https://example.com/repo.git", "want", {
        fetcher: async () => response(concatBytes(sideBandPacket(3, encoder.encode("fatal\n")), flushPacket())),
      }),
    ).rejects.toThrow("side-band error: fatal")

    await expect(
      fetchPackfile("https://example.com/repo.git", "want", {
        fetcher: async () => response(concatBytes(pktLine("ERR upload-pack: not our ref\n"), flushPacket())),
      }),
    ).rejects.toBeInstanceOf(MissingRef)
  })

  it("rejects truncated pkt-lines", async () => {
    await expect(
      fetchPackfile("https://example.com/repo.git", "want", {
        fetcher: async () => response(encoder.encode("0010short")),
      }),
    ).rejects.toThrow("truncated pkt-line payload")
  })
})

function buildPack(objects: Uint8Array[]): Uint8Array {
  return withChecksum(
    concatBytes(encoder.encode("PACK"), uint32(2), uint32(objects.length), ...objects),
  )
}

function baseObject(type: ObjectType, data: Uint8Array): Uint8Array {
  return concatBytes(packObjectHeader(type, data.length), new Uint8Array(deflateSync(data)))
}

function packObjectHeader(type: ObjectType, size: number): Uint8Array {
  const bytes: number[] = []
  let remaining = Math.floor(size / 16)
  let byte = (type << 4) | (size & 0x0f)
  if (remaining > 0) byte |= 0x80
  bytes.push(byte)
  while (remaining > 0) {
    byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    bytes.push(byte)
  }
  return Uint8Array.from(bytes)
}

function encodeOfsDistance(distance: number): Uint8Array {
  const bytes = [distance & 0x7f]
  while ((distance = Math.floor(distance / 128)) > 0) {
    distance -= 1
    bytes.unshift(0x80 | (distance & 0x7f))
  }
  return Uint8Array.from(bytes)
}

function encodeVariableInt(value: number): Uint8Array {
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value = Math.floor(value / 128)
    if (value > 0) byte |= 0x80
    bytes.push(byte)
  } while (value > 0)
  return Uint8Array.from(bytes)
}

function gitObjectHash(type: string, data: Uint8Array): string {
  return createHash("sha1").update(`${type} ${data.length}\0`).update(data).digest("hex")
}

function withChecksum(body: Uint8Array): Uint8Array {
  return concatBytes(body, new Uint8Array(createHash("sha1").update(body).digest()))
}

function pktLine(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload
  return concatBytes(encoder.encode((bytes.length + 4).toString(16).padStart(4, "0")), bytes)
}

function flushPacket(): Uint8Array {
  return encoder.encode("0000")
}

function sideBandPacket(channel: number, payload: Uint8Array): Uint8Array {
  return pktLine(concatBytes(Uint8Array.of(channel), payload))
}

function response(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    text: async () => decoder.decode(bytes),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  }
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map(value => Number.parseInt(value, 16)) ?? [])
}

function chunk(data: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, offset + size))
  }
  return chunks
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, bytes) => sum + bytes.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const bytes of chunks) {
    result.set(bytes, offset)
    offset += bytes.length
  }
  return result
}
