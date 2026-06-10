import {sha1} from "@noble/hashes/legacy.js"
import {bytesToHex} from "@noble/hashes/utils.js"
import {Inflate} from "fflate"

import {GitNaturalReadError} from "./natural-read-client.js"

export type GitNaturalParsedObjectType = "commit" | "tree" | "blob" | "tag"

export interface GitNaturalParsedObject {
  type: GitNaturalParsedObjectType
  typeCode: number
  size: number
  data: Uint8Array
  offset: number
  hash: string
}

export interface GitNaturalPackfileResult {
  version: number
  count: number
  objects: Map<string, GitNaturalParsedObject>
}

export interface GitNaturalTreeEntry {
  name: string
  path: string
  mode: string
  hash: string
  type: "tree" | "blob" | "commit" | "unknown"
}

export interface GitNaturalCommitPerson {
  name: string
  email: string
  timestamp: number
  timezone: string
}

export interface GitNaturalCommit {
  hash: string
  tree: string
  parents: string[]
  author: GitNaturalCommitPerson
  committer: GitNaturalCommitPerson
  message: string
}

export interface GitNaturalTag {
  hash: string
  object: string
  type: string
  tag?: string
  tagger?: GitNaturalCommitPerson
  message: string
}

const enum PackObjectTypeCode {
  Commit = 1,
  Tree = 2,
  Blob = 3,
  Tag = 4,
  OfsDelta = 6,
  RefDelta = 7,
}

const textDecoder = new TextDecoder("utf-8")
const textEncoder = new TextEncoder()

export function parseGitNaturalPackfile(data: Uint8Array): GitNaturalPackfileResult {
  let offset = 0
  const header = textDecoder.decode(data.subarray(0, 4))
  if (header !== "PACK") {
    throw new GitNaturalReadError("protocol-error", `Invalid packfile header: ${header}`)
  }
  offset += 4

  const version = readUint32(data, offset)
  offset += 4
  if (version !== 2) {
    throw new GitNaturalReadError("protocol-error", `Unsupported packfile version: ${version}`)
  }

  const count = readUint32(data, offset)
  offset += 4

  const objects = new Map<string, GitNaturalParsedObject>()
  const objectsByOffset = new Map<number, {object: GitNaturalParsedObject; endOffset: number}>()

  for (let index = 0; index < count; index += 1) {
    const [object, nextOffset] = parsePackObject(data, offset, objects, objectsByOffset)
    objects.set(object.hash, object)
    objectsByOffset.set(object.offset, {object, endOffset: nextOffset})
    offset = nextOffset
  }

  return {version, count, objects}
}

export function parseGitNaturalTree(data: Uint8Array): GitNaturalTreeEntry[] {
  const entries: GitNaturalTreeEntry[] = []
  let offset = 0

  while (offset < data.length) {
    let modeEnd = offset
    while (modeEnd < data.length && data[modeEnd] !== 0x20) modeEnd += 1
    if (modeEnd >= data.length) {
      throw new GitNaturalReadError("protocol-error", "Invalid tree object: missing mode separator")
    }

    const mode = textDecoder.decode(data.subarray(offset, modeEnd))
    offset = modeEnd + 1

    let nameEnd = offset
    while (nameEnd < data.length && data[nameEnd] !== 0x00) nameEnd += 1
    if (nameEnd >= data.length) {
      throw new GitNaturalReadError("protocol-error", "Invalid tree object: missing path separator")
    }

    const name = textDecoder.decode(data.subarray(offset, nameEnd))
    offset = nameEnd + 1

    if (offset + 20 > data.length) {
      throw new GitNaturalReadError("protocol-error", "Invalid tree object: truncated object hash")
    }
    const hash = bytesToHex(data.subarray(offset, offset + 20))
    offset += 20

    entries.push({
      name,
      path: name,
      mode,
      hash,
      type: inferTreeEntryType(mode),
    })
  }

  return entries
}

export function parseGitNaturalCommit(data: Uint8Array, hash: string): GitNaturalCommit {
  const content = textDecoder.decode(data)
  const separator = content.indexOf("\n\n")
  if (separator < 0) {
    throw new GitNaturalReadError("protocol-error", `Invalid commit ${hash}: missing message separator`)
  }

  const header = content.slice(0, separator)
  const message = content.slice(separator + 2)
  const parents: string[] = []
  let tree = ""
  let author: GitNaturalCommitPerson | undefined
  let committer: GitNaturalCommitPerson | undefined

  for (const line of header.split("\n")) {
    if (line.startsWith("tree ")) tree = line.slice(5)
    else if (line.startsWith("parent ")) parents.push(line.slice(7))
    else if (line.startsWith("author ")) author = parsePerson(line.slice(7))
    else if (line.startsWith("committer ")) committer = parsePerson(line.slice(10))
  }

  if (!tree || !author || !committer) {
    throw new GitNaturalReadError("protocol-error", `Invalid commit ${hash}: missing required headers`)
  }

  return {hash, tree, parents, author, committer, message}
}

export function parseGitNaturalTag(data: Uint8Array, hash: string): GitNaturalTag {
  const content = textDecoder.decode(data)
  const separator = content.indexOf("\n\n")
  const header = separator >= 0 ? content.slice(0, separator) : content
  const message = separator >= 0 ? content.slice(separator + 2) : ""
  let object = ""
  let type = ""
  let tag: string | undefined
  let tagger: GitNaturalCommitPerson | undefined

  for (const line of header.split("\n")) {
    if (line.startsWith("object ")) object = line.slice(7)
    else if (line.startsWith("type ")) type = line.slice(5)
    else if (line.startsWith("tag ")) tag = line.slice(4)
    else if (line.startsWith("tagger ")) tagger = parsePerson(line.slice(7))
  }

  if (!object || !type) {
    throw new GitNaturalReadError("protocol-error", `Invalid tag ${hash}: missing object or type`)
  }

  return {hash, object, type, tag, tagger, message}
}

export function computeGitNaturalObjectHash(
  type: GitNaturalParsedObjectType,
  data: Uint8Array,
): string {
  const header = textEncoder.encode(`${type} ${data.length}\0`)
  const combined = new Uint8Array(header.length + data.length)
  combined.set(header)
  combined.set(data, header.length)
  return bytesToHex(sha1(combined))
}

function parsePackObject(
  data: Uint8Array,
  startOffset: number,
  objects: Map<string, GitNaturalParsedObject>,
  objectsByOffset: Map<number, {object: GitNaturalParsedObject; endOffset: number}>,
): [GitNaturalParsedObject, number] {
  const cached = objectsByOffset.get(startOffset)
  if (cached) return [cached.object, cached.endOffset]

  let offset = startOffset
  const objectOffset = startOffset
  let byte = data[offset++]
  let typeCode = (byte >> 4) & 0x07
  let size = byte & 0x0f
  let shift = 4

  while (byte & 0x80) {
    byte = data[offset++]
    size |= (byte & 0x7f) << shift
    shift += 7
  }

  let objectData: Uint8Array
  if (typeCode === PackObjectTypeCode.OfsDelta) {
    const [baseObject, deltaOffset] = parseOfsDeltaBase(data, offset, objectOffset, objects, objectsByOffset)
    const [delta, nextOffset] = inflateGitObject(data, deltaOffset, size)
    objectData = applyGitDelta(delta, baseObject.data)
    typeCode = baseObject.typeCode
    offset = nextOffset
  } else if (typeCode === PackObjectTypeCode.RefDelta) {
    const baseHash = bytesToHex(data.subarray(offset, offset + 20))
    offset += 20
    const baseObject = objects.get(baseHash)
    if (!baseObject) {
      throw new GitNaturalReadError("object-not-found", `Delta base object not found: ${baseHash}`)
    }
    const [delta, nextOffset] = inflateGitObject(data, offset, size)
    objectData = applyGitDelta(delta, baseObject.data)
    typeCode = baseObject.typeCode
    offset = nextOffset
  } else {
    const [inflated, nextOffset] = inflateGitObject(data, offset, size)
    objectData = inflated
    offset = nextOffset
  }

  const type = objectTypeFromCode(typeCode)
  const object: GitNaturalParsedObject = {
    type,
    typeCode,
    size: objectData.length,
    data: objectData,
    offset: objectOffset,
    hash: computeGitNaturalObjectHash(type, objectData),
  }
  objects.set(object.hash, object)
  objectsByOffset.set(objectOffset, {object, endOffset: offset})
  return [object, offset]
}

function parseOfsDeltaBase(
  data: Uint8Array,
  offset: number,
  currentObjectOffset: number,
  objects: Map<string, GitNaturalParsedObject>,
  objectsByOffset: Map<number, {object: GitNaturalParsedObject; endOffset: number}>,
): [GitNaturalParsedObject, number] {
  let byte = data[offset++]
  let relativeOffset = byte & 0x7f

  while (byte & 0x80) {
    relativeOffset += 1
    relativeOffset <<= 7
    byte = data[offset++]
    relativeOffset += byte & 0x7f
  }

  const baseOffset = currentObjectOffset - relativeOffset
  const [baseObject] = parsePackObject(data, baseOffset, objects, objectsByOffset)
  return [baseObject, offset]
}

function objectTypeFromCode(typeCode: number): GitNaturalParsedObjectType {
  if (typeCode === PackObjectTypeCode.Commit) return "commit"
  if (typeCode === PackObjectTypeCode.Tree) return "tree"
  if (typeCode === PackObjectTypeCode.Blob) return "blob"
  if (typeCode === PackObjectTypeCode.Tag) return "tag"
  throw new GitNaturalReadError("protocol-error", `Unknown pack object type: ${typeCode}`)
}

function inferTreeEntryType(mode: string): GitNaturalTreeEntry["type"] {
  if (mode === "40000" || mode === "040000") return "tree"
  if (mode === "160000") return "commit"
  if (mode === "100644" || mode === "100755" || mode === "120000") return "blob"
  return "unknown"
}

function parsePerson(line: string): GitNaturalCommitPerson {
  const mailOpen = line.indexOf("<")
  if (mailOpen < 0) return {name: line.trim(), email: "", timestamp: Number.NaN, timezone: ""}
  const mailClose = line.lastIndexOf(">")
  const name = line.slice(0, mailOpen).trimEnd()
  const email = mailClose > mailOpen ? line.slice(mailOpen + 1, mailClose) : ""
  const tail = mailClose >= 0 ? line.slice(mailClose + 1).trimStart() : ""
  const match = tail.match(/^(\d+)\s+([+-]\d+)$/)
  return {
    name,
    email,
    timestamp: match ? Number.parseInt(match[1], 10) : Number.NaN,
    timezone: match ? match[2] : "",
  }
}

function inflateGitObject(
  data: Uint8Array,
  currentOffset: number,
  inflatedSize: number,
): [Uint8Array, number] {
  try {
    return inflateWithBatches(data, currentOffset, inflatedSize, [0.25, 0.2, 0.15, 0.1])
  } catch (error) {
    if (error instanceof OvershotInflateError) {
      return inflateWithBatches(data, currentOffset, inflatedSize, error.goodBatch ? [error.goodBatch] : [])
    }
    throw error
  }
}

class OvershotInflateError extends Error {
  constructor(readonly goodBatch: number) {
    super("Git object decompression overshot the object boundary")
    this.name = "OvershotInflateError"
  }
}

function inflateWithBatches(
  data: Uint8Array,
  currentOffset: number,
  inflatedSize: number,
  batches: number[],
): [Uint8Array, number] {
  let inflatedSoFar = 0
  let done = false
  const inflated = new Uint8Array(inflatedSize)
  const inflate = new Inflate(chunk => {
    if (chunk.length === 0) return
    inflated.set(chunk, inflatedSoFar)
    inflatedSoFar += chunk.length
    if (inflatedSoFar === inflatedSize) done = true
  })

  let offset = currentOffset + zlibPrefixLength(data.subarray(currentOffset))
  for (let index = 0; index < batches.length; index += 1) {
    const batchSize = Math.round(inflatedSize * batches[index])
    inflate.push(data.subarray(offset, offset + batchSize))
    offset += batchSize
    if (done) {
      const goodBatch = batches.slice(0, index).reduce((total, batch) => total + batch, 0)
      throw new OvershotInflateError(goodBatch)
    }
  }

  while (!done && offset < data.length) {
    inflate.push(data.subarray(offset, offset + 4))
    offset += 4
  }

  for (let attempts = 0; attempts < 24; attempts += 1) {
    if (adler32(inflated) === readUint32(data, offset - 4)) return [inflated, offset]
    offset += 1
  }

  throw new GitNaturalReadError("protocol-error", "Git object checksum never validated")
}

function applyGitDelta(delta: Uint8Array, base: Uint8Array): Uint8Array {
  let offset = 0
  const [, baseSizeBytes] = readVariableInt(delta, offset)
  offset += baseSizeBytes
  const [resultSize, resultSizeBytes] = readVariableInt(delta, offset)
  offset += resultSizeBytes
  const result = new Uint8Array(resultSize)
  let resultOffset = 0

  while (offset < delta.length) {
    const command = delta[offset++]
    if (command & 0x80) {
      let copyOffset = 0
      let copySize = 0
      if (command & 0x01) copyOffset = delta[offset++]
      if (command & 0x02) copyOffset |= delta[offset++] << 8
      if (command & 0x04) copyOffset |= delta[offset++] << 16
      if (command & 0x08) copyOffset |= delta[offset++] << 24
      if (command & 0x10) copySize = delta[offset++]
      if (command & 0x20) copySize |= delta[offset++] << 8
      if (command & 0x40) copySize |= delta[offset++] << 16
      if (copySize === 0) copySize = 0x10000
      result.set(base.subarray(copyOffset, copyOffset + copySize), resultOffset)
      resultOffset += copySize
    } else if (command > 0) {
      result.set(delta.subarray(offset, offset + command), resultOffset)
      offset += command
      resultOffset += command
    } else {
      throw new GitNaturalReadError("protocol-error", "Invalid git delta command")
    }
  }

  return result
}

function readVariableInt(data: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let bytesRead = 0
  let byte = 0
  do {
    byte = data[offset++]
    bytesRead += 1
    value |= (byte & 0x7f) << shift
    shift += 7
  } while (byte & 0x80)
  return [value, bytesRead]
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>>
    0
  )
}

function zlibPrefixLength(data: Uint8Array): number {
  return ((data[1] >> 3) & 4) + 2
}

function adler32(data: Uint8Array): number {
  const mod = 65521
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % mod
    b = (b + a) % mod
  }
  return (((b << 16) | a) >>> 0)
}
