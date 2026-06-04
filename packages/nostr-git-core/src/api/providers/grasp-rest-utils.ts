/**
 * Utility functions for GRASP REST API
 * Based on @fiatjaf/git-natural-api
 */

/**
 * Git object types from packfile format
 */
export enum GitObjectType {
  Commit = 1,
  Tree = 2,
  Blob = 3,
  Tag = 4,
  OfsDelta = 6,
  RefDelta = 7,
}

export interface ParsedObject {
  type: GitObjectType
  size: number
  data: Uint8Array
  offset: number
  hash: string
}

export interface PackfileResult {
  objects: Map<string, ParsedObject>
}

/**
 * Parse Git packfile data
 */
export function parsePackfile(data: Uint8Array): PackfileResult {
  const objects = new Map<string, ParsedObject>()
  
  // Verify packfile signature
  const signature = String.fromCharCode(...data.subarray(0, 4))
  if (signature !== 'PACK') {
    throw new Error('Invalid packfile signature')
  }

  // Read version (should be 2)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]
  if (version !== 2) {
    throw new Error(`Unsupported packfile version: ${version}`)
  }

  // Read object count
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]
  
  let offset = 12
  
  for (let i = 0; i < objectCount; i++) {
    const obj = parsePackfileObject(data, offset)
    offset = obj.offset
    
    // Calculate hash for the object
    const hash = calculateObjectHash(obj.type, obj.data)
    obj.hash = hash
    objects.set(hash, obj)
  }

  return { objects }
}

/**
 * Parse a single object from packfile
 */
function parsePackfileObject(data: Uint8Array, offset: number): ParsedObject {
  // Read object type and size
  let byte = data[offset++]
  const type = (byte >> 4) & 0x07
  let size = byte & 0x0f
  let shift = 4

  while (byte & 0x80) {
    byte = data[offset++]
    size |= (byte & 0x7f) << shift
    shift += 7
  }

  // Handle different object types
  let objectData: Uint8Array

  if (type === GitObjectType.OfsDelta || type === GitObjectType.RefDelta) {
    throw new Error('Delta objects not yet supported')
  }

  // Decompress zlib data
  objectData = inflateZlib(data, offset, size)
  offset += findZlibEnd(data, offset)

  return {
    type,
    size,
    data: objectData,
    offset,
    hash: '',
  }
}

/**
 * Simple zlib inflation (placeholder - would need proper implementation)
 */
function inflateZlib(data: Uint8Array, offset: number, expectedSize: number): Uint8Array {
  // This is a simplified placeholder
  // In production, you'd use a proper zlib library like pako
  throw new Error('Zlib decompression not yet implemented - use pako library')
}

/**
 * Find the end of zlib compressed data
 */
function findZlibEnd(data: Uint8Array, offset: number): number {
  // Simplified - would need proper implementation
  throw new Error('Zlib end detection not yet implemented')
}

/**
 * Calculate SHA-1 hash for Git object
 */
function calculateObjectHash(type: GitObjectType, data: Uint8Array): string {
  // Git object format: "{type} {size}\0{content}"
  const typeStr = getObjectTypeString(type)
  const header = `${typeStr} ${data.length}\0`
  
  // Would need SHA-1 implementation here
  throw new Error('SHA-1 hashing not yet implemented - use crypto library')
}

/**
 * Get string representation of object type
 */
function getObjectTypeString(type: GitObjectType): string {
  switch (type) {
    case GitObjectType.Commit:
      return 'commit'
    case GitObjectType.Tree:
      return 'tree'
    case GitObjectType.Blob:
      return 'blob'
    case GitObjectType.Tag:
      return 'tag'
    default:
      throw new Error(`Unknown object type: ${type}`)
  }
}

/**
 * Create a want request for git-upload-pack
 */
export function createWantRequest(
  wantCommit: string,
  capabilities: string[] = [],
  haveCommits: string[] = []
): string {
  const lines: string[] = []
  
  // First want line includes capabilities
  const capsString = capabilities.length > 0 ? ' ' + capabilities.join(' ') : ''
  lines.push(pktLine(`want ${wantCommit}${capsString}\n`))
  
  // Additional have lines if doing incremental fetch
  for (const have of haveCommits) {
    lines.push(pktLine(`have ${have}\n`))
  }
  
  // Flush packet
  lines.push('0000')
  
  // Done packet
  lines.push(pktLine('done\n'))
  
  return lines.join('')
}

/**
 * Format a Git pkt-line
 */
function pktLine(data: string): string {
  const len = data.length + 4
  return len.toString(16).padStart(4, '0') + data
}

/**
 * Parse commit object data
 */
export interface CommitData {
  hash: string
  tree: string
  parents: string[]
  author: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  committer: {
    name: string
    email: string
    timestamp: number
    timezone: string
  }
  message: string
}

export function parseCommit(data: Uint8Array, hash: string): CommitData {
  const decoder = new TextDecoder('utf-8')
  const content = decoder.decode(data)

  const headerEndIndex = content.indexOf('\n\n')
  if (headerEndIndex === -1) {
    throw new Error(`Invalid commit format for ${hash}: no message separator found`)
  }

  const header = content.slice(0, headerEndIndex)
  const message = content.slice(headerEndIndex + 2)

  const lines = header.split('\n')
  const result: Partial<CommitData> = {
    hash,
    parents: [],
    message,
  }

  for (const line of lines) {
    if (line.startsWith('tree ')) {
      result.tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      result.parents = result.parents || []
      result.parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      result.author = parsePerson(line.slice(7))
    } else if (line.startsWith('committer ')) {
      result.committer = parsePerson(line.slice(10))
    }
  }

  if (!result.tree || !result.author || !result.committer) {
    throw new Error(`Invalid commit format for ${hash}`)
  }

  return result as CommitData
}

/**
 * Parse author/committer line
 */
function parsePerson(line: string): {
  name: string
  email: string
  timestamp: number
  timezone: string
} {
  const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid person format: ${line}`)
  }

  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4],
  }
}

/**
 * Tree entry
 */
export interface TreeEntry {
  path: string
  mode: string
  isDir: boolean
  hash: string
}

/**
 * Parse tree object data
 */
export function parseTree(data: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  let offset = 0

  while (offset < data.length) {
    // Read mode (ASCII digits followed by space)
    let modeEnd = offset
    while (data[modeEnd] !== 0x20) modeEnd++
    const mode = String.fromCharCode(...data.subarray(offset, modeEnd))
    offset = modeEnd + 1

    // Read name (null-terminated)
    let nameEnd = offset
    while (data[nameEnd] !== 0x00) nameEnd++
    const path = new TextDecoder().decode(data.subarray(offset, nameEnd))
    offset = nameEnd + 1

    // Read hash (20 bytes)
    const hashBytes = data.subarray(offset, offset + 20)
    const hash = Array.from(hashBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    offset += 20

    // Determine if directory (mode starts with 04)
    const isDir = mode.startsWith('04')

    entries.push({ path, mode, isDir, hash })
  }

  return entries
}
