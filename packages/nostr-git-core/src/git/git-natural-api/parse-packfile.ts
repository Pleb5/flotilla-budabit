import {sha1} from "@noble/hashes/legacy.js"
import {bytesToHex} from "@noble/hashes/utils.js"
import pako from "pako"

export interface ObjectGetterByHash {
  get(hash: string): ParsedObject | undefined
}

export enum ObjectType {
  COMMIT = 1,
  TREE = 2,
  BLOB = 3,
  TAG = 4,
  OFS_DELTA = 6,
  REF_DELTA = 7,
}

export type ParsedObject = {
  type: number
  size: number
  data: Uint8Array
  offset: number
  hash: string
}

export type PackfileResult = {
  version: number
  count: number
  objects: Map<string, ParsedObject>
}

const PACK_HEADER_SIZE = 12
const PACK_CHECKSUM_SIZE = 20

export function parsePackfile(data: Uint8Array): PackfileResult {
  if (data.length < 4 || new TextDecoder("ascii").decode(data.subarray(0, 4)) !== "PACK") {
    throw new Error("invalid packfile header")
  }
  if (data.length < PACK_HEADER_SIZE + PACK_CHECKSUM_SIZE) {
    throw new Error(`truncated packfile: received ${data.length} bytes`)
  }

  const version = readUint32(data, 4)
  if (version !== 2) throw new Error(`unsupported packfile version: ${version}`)
  const count = readUint32(data, 8)
  const objects = new Map<string, ParsedObject>()
  const objectsByOffset = new Map<number, ParsedObject>()
  let position = PACK_HEADER_SIZE

  for (let index = 0; index < count; index++) {
    const [object, nextPosition] = parseObject(data, position, objects, objectsByOffset)
    if (nextPosition <= position) {
      throw new Error(`pack parser did not advance at object ${index + 1}`)
    }
    objects.set(object.hash, object)
    objectsByOffset.set(object.offset, object)
    position = nextPosition
  }

  const expectedTrailerPosition = data.length - PACK_CHECKSUM_SIZE
  if (position !== expectedTrailerPosition) {
    throw new Error(
      `packfile object data ended at byte ${position}, expected checksum at byte ${expectedTrailerPosition}`,
    )
  }

  const expectedChecksum = data.subarray(expectedTrailerPosition)
  const actualChecksum = sha1(data.subarray(0, expectedTrailerPosition))
  if (!equalBytes(actualChecksum, expectedChecksum)) {
    throw new Error("packfile SHA-1 checksum mismatch")
  }

  return {objects, version, count}
}

function parseObject(
  data: Uint8Array,
  startPosition: number,
  objects: ObjectGetterByHash,
  objectsByOffset: Map<number, ParsedObject>,
): [ParsedObject, number] {
  let position = startPosition
  const first = readByte(data, position++)
  let type = (first >> 4) & 0x07
  let encodedSize = first & 0x0f
  let shift = 4
  let byte = first

  while (byte & 0x80) {
    byte = readByte(data, position++)
    encodedSize += (byte & 0x7f) * 2 ** shift
    shift += 7
    if (shift > 53) throw new Error(`object size is too large at byte ${startPosition}`)
  }

  let objectData: Uint8Array
  if (type === ObjectType.OFS_DELTA) {
    const result = parseOfsDelta(
      data,
      position,
      encodedSize,
      startPosition,
      objectsByOffset,
    )
    objectData = result.data
    position = result.position
    type = result.type
  } else if (type === ObjectType.REF_DELTA) {
    const result = parseRefDelta(data, position, encodedSize, objects)
    objectData = result.data
    position = result.position
    type = result.type
  } else if (isBaseObjectType(type)) {
    ;[objectData, position] = decompressObject(data, position, encodedSize)
  } else {
    throw new Error(`unknown object type ${type} at byte ${startPosition}`)
  }

  return [
    {
      type,
      size: objectData.length,
      data: objectData,
      offset: startPosition,
      hash: computeObjectHash(type, objectData),
    },
    position,
  ]
}

function parseOfsDelta(
  data: Uint8Array,
  position: number,
  deltaSize: number,
  currentOffset: number,
  objectsByOffset: Map<number, ParsedObject>,
): {data: Uint8Array; position: number; type: number} {
  let byte = readByte(data, position++)
  let distance = byte & 0x7f
  while (byte & 0x80) {
    byte = readByte(data, position++)
    distance = (distance + 1) * 128 + (byte & 0x7f)
  }

  const baseOffset = currentOffset - distance
  const baseObject = objectsByOffset.get(baseOffset)
  if (!baseObject) throw new Error(`OFS-delta base object not found at byte ${baseOffset}`)

  const [delta, nextPosition] = decompressObject(data, position, deltaSize)
  return {
    data: applyDelta(delta, baseObject.data),
    position: nextPosition,
    type: baseObject.type,
  }
}

function parseRefDelta(
  data: Uint8Array,
  position: number,
  deltaSize: number,
  objects: ObjectGetterByHash,
): {data: Uint8Array; position: number; type: number} {
  if (data.length - position < 20) throw new Error(`truncated REF-delta base at byte ${position}`)
  const baseHash = bytesToHex(data.subarray(position, position + 20))
  position += 20
  const baseObject = objects.get(baseHash)
  if (!baseObject) throw new Error(`REF-delta base object not found: ${baseHash}`)

  const [delta, nextPosition] = decompressObject(data, position, deltaSize)
  return {
    data: applyDelta(delta, baseObject.data),
    position: nextPosition,
    type: baseObject.type,
  }
}

function decompressObject(
  data: Uint8Array,
  position: number,
  expectedSize: number,
): [Uint8Array, number] {
  const input = data.subarray(position)
  const inflater = new pako.Inflate()
  inflater.push(input, false)

  if (inflater.err) {
    throw new Error(`zlib decompression failed at byte ${position}: ${inflater.msg || inflater.err}`)
  }
  if (!inflater.result) {
    throw new Error(`truncated zlib stream at byte ${position}`)
  }

  const result =
    typeof inflater.result === "string"
      ? new TextEncoder().encode(inflater.result)
      : new Uint8Array(inflater.result)
  if (result.length !== expectedSize) {
    throw new Error(
      `inflated object size mismatch at byte ${position}: expected ${expectedSize}, received ${result.length}`,
    )
  }

  const stream = (inflater as pako.Inflate & {strm: {avail_in: number}}).strm
  const consumed = input.length - stream.avail_in
  if (consumed <= 0) throw new Error(`zlib stream consumed no input at byte ${position}`)
  return [result, position + consumed]
}

function applyDelta(delta: Uint8Array, base: Uint8Array): Uint8Array {
  let position = 0
  const [baseSize, baseSizeBytes] = readVariableInt(delta, position)
  position += baseSizeBytes
  if (baseSize !== base.length) {
    throw new Error(`delta base size mismatch: expected ${baseSize}, received ${base.length}`)
  }

  const [resultSize, resultSizeBytes] = readVariableInt(delta, position)
  position += resultSizeBytes
  const result = new Uint8Array(resultSize)
  let resultOffset = 0

  while (position < delta.length) {
    const command = readByte(delta, position++)
    if (command & 0x80) {
      let offset = 0
      let copySize = 0
      if (command & 0x01) offset += readByte(delta, position++)
      if (command & 0x02) offset += readByte(delta, position++) * 2 ** 8
      if (command & 0x04) offset += readByte(delta, position++) * 2 ** 16
      if (command & 0x08) offset += readByte(delta, position++) * 2 ** 24
      if (command & 0x10) copySize += readByte(delta, position++)
      if (command & 0x20) copySize += readByte(delta, position++) * 2 ** 8
      if (command & 0x40) copySize += readByte(delta, position++) * 2 ** 16
      if (copySize === 0) copySize = 0x10000
      if (offset + copySize > base.length || resultOffset + copySize > result.length) {
        throw new Error("delta copy command exceeds object bounds")
      }
      result.set(base.subarray(offset, offset + copySize), resultOffset)
      resultOffset += copySize
    } else if (command > 0) {
      if (position + command > delta.length || resultOffset + command > result.length) {
        throw new Error("delta insert command exceeds object bounds")
      }
      result.set(delta.subarray(position, position + command), resultOffset)
      position += command
      resultOffset += command
    } else {
      throw new Error("invalid delta command")
    }
  }

  if (resultOffset !== result.length) {
    throw new Error(`delta result size mismatch: expected ${result.length}, wrote ${resultOffset}`)
  }
  return result
}

function readVariableInt(data: Uint8Array, startPosition: number): [number, number] {
  let value = 0
  let shift = 0
  let position = startPosition
  let byte: number
  do {
    byte = readByte(data, position++)
    value += (byte & 0x7f) * 2 ** shift
    shift += 7
    if (shift > 53) throw new Error(`variable integer is too large at byte ${startPosition}`)
  } while (byte & 0x80)
  return [value, position - startPosition]
}

function computeObjectHash(type: number, data: Uint8Array): string {
  const typeName = objectTypeName(type)
  const header = new TextEncoder().encode(`${typeName} ${data.length}\0`)
  const input = new Uint8Array(header.length + data.length)
  input.set(header)
  input.set(data, header.length)
  return bytesToHex(sha1(input))
}

function objectTypeName(type: number): string {
  if (type === ObjectType.COMMIT) return "commit"
  if (type === ObjectType.TREE) return "tree"
  if (type === ObjectType.BLOB) return "blob"
  if (type === ObjectType.TAG) return "tag"
  throw new Error(`cannot hash unknown object type ${type}`)
}

function isBaseObjectType(type: number): boolean {
  return (
    type === ObjectType.COMMIT ||
    type === ObjectType.TREE ||
    type === ObjectType.BLOB ||
    type === ObjectType.TAG
  )
}

function readUint32(data: Uint8Array, position: number): number {
  if (data.length - position < 4) throw new Error(`truncated uint32 at byte ${position}`)
  return new DataView(data.buffer, data.byteOffset + position, 4).getUint32(0)
}

function readByte(data: Uint8Array, position: number): number {
  if (position >= data.length) throw new Error(`unexpected end of data at byte ${position}`)
  return data[position]
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}
