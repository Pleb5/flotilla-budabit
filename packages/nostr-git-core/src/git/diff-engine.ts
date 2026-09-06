import {diffArrays} from "diff"

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patches: Array<{line: string; type: "+" | "-" | " "}>
}

export interface GitDiffStats {
  additions: number
  deletions: number
  total: number
}

export interface GitDiffTreeEntry {
  path: string
  mode: string
  oid: string
  type: "blob" | "submodule"
}

export interface GitDiffChange {
  path: string
  oldPath?: string
  status: "added" | "modified" | "deleted" | "renamed"
  oldOid?: string
  newOid?: string
  oldMode?: string
  newMode?: string
  binary?: boolean
  submodule?: boolean
  diffHunks: GitDiffHunk[]
  stats: GitDiffStats
}

export interface GitDiffChangeDescriptor {
  path: string
  oldPath?: string
  status: GitDiffChange["status"]
  base?: GitDiffTreeEntry
  head?: GitDiffTreeEntry
  knownBinary: boolean
}

const utf8Decoder = new TextDecoder("utf-8")
export const GIT_DIFF_CONTEXT_LINES = 3

/**
 * Compare two flattened Git trees. Exact-content moves are paired as renames;
 * changed-content rename similarity remains the transport's responsibility.
 */
export function describeGitTreeChanges(
  baseEntries: Map<string, GitDiffTreeEntry>,
  headEntries: Map<string, GitDiffTreeEntry>,
): GitDiffChangeDescriptor[] {
  const deleted: GitDiffChangeDescriptor[] = []
  const added: GitDiffChangeDescriptor[] = []
  const changed: GitDiffChangeDescriptor[] = []
  const paths = Array.from(new Set([...baseEntries.keys(), ...headEntries.keys()])).sort()

  for (const path of paths) {
    const base = baseEntries.get(path)
    const head = headEntries.get(path)
    if (
      base &&
      head &&
      base.oid === head.oid &&
      base.mode === head.mode &&
      base.type === head.type
    ) {
      continue
    }

    const descriptor: GitDiffChangeDescriptor = {
      path,
      status: !base ? "added" : !head ? "deleted" : "modified",
      base,
      head,
      knownBinary: isKnownBinaryEntry(path, base, head),
    }
    if (!base) added.push(descriptor)
    else if (!head) deleted.push(descriptor)
    else changed.push(descriptor)
  }

  // Git detects an unchanged blob/submodule moved to a new path as a rename.
  // Pair deterministically when duplicate content exists at several paths.
  const additionsByIdentity = new Map<string, GitDiffChangeDescriptor[]>()
  for (const descriptor of added) {
    const identity = entryIdentity(descriptor.head)
    if (!identity) continue
    const candidates = additionsByIdentity.get(identity) || []
    candidates.push(descriptor)
    additionsByIdentity.set(identity, candidates)
  }

  const renamed: GitDiffChangeDescriptor[] = []
  const pairedAdditions = new Set<GitDiffChangeDescriptor>()
  const pairedDeletions = new Set<GitDiffChangeDescriptor>()
  for (const descriptor of deleted) {
    const identity = entryIdentity(descriptor.base)
    const addition = identity
      ? additionsByIdentity.get(identity)?.find(candidate => !pairedAdditions.has(candidate))
      : undefined
    if (!addition) continue
    pairedAdditions.add(addition)
    pairedDeletions.add(descriptor)
    renamed.push({
      path: addition.path,
      oldPath: descriptor.path,
      status: "renamed",
      base: descriptor.base,
      head: addition.head,
      knownBinary: descriptor.knownBinary || addition.knownBinary,
    })
  }

  return [
    ...changed,
    ...deleted.filter(descriptor => !pairedDeletions.has(descriptor)),
    ...added.filter(descriptor => !pairedAdditions.has(descriptor)),
    ...renamed,
  ].sort(
    (left, right) =>
      compareGitPaths(left.path, right.path) ||
      compareGitPaths(left.oldPath || "", right.oldPath || ""),
  )
}

export function requiredGitDiffBlobOids(descriptors: GitDiffChangeDescriptor[]): string[] {
  const hashes = new Set<string>()
  for (const descriptor of descriptors) {
    if (descriptor.knownBinary) continue
    const {base, head} = descriptor
    if (base?.type === "blob" && base.oid !== head?.oid) hashes.add(base.oid.toLowerCase())
    if (head?.type === "blob" && head.oid !== base?.oid) hashes.add(head.oid.toLowerCase())
  }
  return Array.from(hashes)
}

export function renderGitDiffChanges(
  descriptors: GitDiffChangeDescriptor[],
  blobs: Map<string, Uint8Array>,
): GitDiffChange[] {
  return descriptors.map(descriptor => renderGitDiffChange(descriptor, blobs))
}

export function renderGitDiffChange(
  descriptor: GitDiffChangeDescriptor,
  blobs: Map<string, Uint8Array>,
): GitDiffChange {
  const {path, oldPath, status, base, head, knownBinary} = descriptor
  const metadata = {
    path,
    ...(oldPath ? {oldPath} : {}),
    status,
    ...(base ? {oldOid: base.oid, oldMode: base.mode} : {}),
    ...(head ? {newOid: head.oid, newMode: head.mode} : {}),
  }
  const submodule = base?.type === "submodule" || head?.type === "submodule"
  if (submodule) {
    const oldText = base ? `Subproject commit ${base.oid}\n` : ""
    const newText = head ? `Subproject commit ${head.oid}\n` : ""
    const diffHunks = !base
      ? buildAddedFileDiffHunks(newText)
      : !head
        ? buildDeletedFileDiffHunks(oldText)
        : base.oid === head.oid
          ? []
          : buildModifiedFileDiffHunks(oldText, newText)
    return withGitDiffStats({...metadata, submodule: true, diffHunks})
  }
  if (knownBinary) return withGitDiffStats({...metadata, binary: true, diffHunks: []})

  // Mode-only changes and exact renames have no content hunk.
  if (base?.oid === head?.oid) return withGitDiffStats({...metadata, diffHunks: []})

  if (!base && head) {
    const data = getDiffBlob(blobs, head.oid, path)
    return isBinaryFile(path, data)
      ? withGitDiffStats({...metadata, binary: true, diffHunks: []})
      : withGitDiffStats({
          ...metadata,
          diffHunks: buildAddedFileDiffHunks(utf8Decoder.decode(data)),
        })
  }
  if (base && !head) {
    const data = getDiffBlob(blobs, base.oid, oldPath || path)
    return isBinaryFile(oldPath || path, data)
      ? withGitDiffStats({...metadata, binary: true, diffHunks: []})
      : withGitDiffStats({
          ...metadata,
          diffHunks: buildDeletedFileDiffHunks(utf8Decoder.decode(data)),
        })
  }
  if (!base || !head) throw new Error(`Invalid diff descriptor for ${path}`)

  const oldData = getDiffBlob(blobs, base.oid, oldPath || path)
  const newData = getDiffBlob(blobs, head.oid, path)
  if (isBinaryFile(oldPath || path, oldData) || isBinaryFile(path, newData)) {
    return withGitDiffStats({...metadata, binary: true, diffHunks: []})
  }
  return withGitDiffStats({
    ...metadata,
    diffHunks: buildModifiedFileDiffHunks(utf8Decoder.decode(oldData), utf8Decoder.decode(newData)),
  })
}

export function buildAddedFileDiffHunks(text: string): GitDiffHunk[] {
  const lines = splitGitLines(text).map(line => line.text)
  if (lines.length === 0) return []
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      patches: lines.map(line => ({line, type: "+" as const})),
    },
  ]
}

export function buildDeletedFileDiffHunks(text: string): GitDiffHunk[] {
  const lines = splitGitLines(text).map(line => line.text)
  if (lines.length === 0) return []
  return [
    {
      oldStart: 1,
      oldLines: lines.length,
      newStart: 0,
      newLines: 0,
      patches: lines.map(line => ({line, type: "-" as const})),
    },
  ]
}

export function buildModifiedFileDiffHunks(
  oldText: string,
  newText: string,
  contextLines = GIT_DIFF_CONTEXT_LINES,
): GitDiffHunk[] {
  const oldLines = splitGitLines(oldText)
  const newLines = splitGitLines(newText)
  const chunks = diffArrays(
    oldLines.map(line => line.token),
    newLines.map(line => line.token),
  )
  const patches: GitDiffHunk["patches"] = []

  for (const chunk of chunks) {
    for (const token of chunk.value || []) {
      patches.push({
        line: displayGitLineToken(token),
        type: chunk.added ? "+" : chunk.removed ? "-" : " ",
      })
    }
  }

  if (patches.length === 0 || patches.every(patch => patch.type === " ")) return []
  return compactGitDiffPatches(patches, Math.max(0, Math.floor(contextLines)))
}

export function gitDiffHunkStats(hunks: readonly GitDiffHunk[]): GitDiffStats {
  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const patch of hunk.patches) {
      if (patch.type === "+") additions += 1
      else if (patch.type === "-") deletions += 1
    }
  }
  return {additions, deletions, total: additions + deletions}
}

export function summarizeGitDiffChanges(changes: readonly GitDiffChange[]): GitDiffStats {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    additions += change.stats.additions
    deletions += change.stats.deletions
  }
  return {additions, deletions, total: additions + deletions}
}

function withGitDiffStats(change: Omit<GitDiffChange, "stats">): GitDiffChange {
  return {...change, stats: gitDiffHunkStats(change.diffHunks)}
}

function compactGitDiffPatches(
  patches: GitDiffHunk["patches"],
  contextLines: number,
): GitDiffHunk[] {
  const ranges: Array<{start: number; end: number}> = []
  for (let index = 0; index < patches.length; index += 1) {
    if (patches[index].type === " ") continue
    const range = {
      start: Math.max(0, index - contextLines),
      end: Math.min(patches.length - 1, index + contextLines),
    }
    const previous = ranges[ranges.length - 1]
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      ranges.push(range)
    }
  }

  const hunks: GitDiffHunk[] = []
  let patchIndex = 0
  let oldCursor = 1
  let newCursor = 1
  const advance = (patch: GitDiffHunk["patches"][number]) => {
    if (patch.type !== "+") oldCursor += 1
    if (patch.type !== "-") newCursor += 1
  }

  for (const range of ranges) {
    while (patchIndex < range.start) advance(patches[patchIndex++])
    const rawOldStart = oldCursor
    const rawNewStart = newCursor
    let oldLines = 0
    let newLines = 0
    const hunkPatches = patches.slice(range.start, range.end + 1)
    for (const patch of hunkPatches) {
      if (patch.type !== "+") oldLines += 1
      if (patch.type !== "-") newLines += 1
      advance(patch)
      patchIndex += 1
    }
    hunks.push({
      oldStart: oldLines === 0 ? Math.max(0, rawOldStart - 1) : rawOldStart,
      oldLines,
      newStart: newLines === 0 ? Math.max(0, rawNewStart - 1) : rawNewStart,
      newLines,
      patches: hunkPatches,
    })
  }
  return hunks
}

export function isBinaryFile(path: string, data: Uint8Array): boolean {
  if (isBinaryByExtension(path)) return true
  const limit = Math.min(data.length, 8192)
  for (let index = 0; index < limit; index += 1) {
    if (data[index] === 0) return true
  }
  return false
}

export function isBinaryByExtension(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? ""
  return BINARY_DIFF_EXTENSIONS.has(extension)
}

function isKnownBinaryEntry(
  path: string,
  base?: GitDiffTreeEntry,
  head?: GitDiffTreeEntry,
): boolean {
  return (base?.type === "blob" || head?.type === "blob") && isBinaryByExtension(path)
}

function entryIdentity(entry?: GitDiffTreeEntry): string | undefined {
  return entry ? `${entry.type}:${entry.oid.toLowerCase()}` : undefined
}

function getDiffBlob(blobs: Map<string, Uint8Array>, oid: string, path: string): Uint8Array {
  const blob = blobs.get(oid.toLowerCase()) ?? blobs.get(oid)
  if (!blob) throw new Error(`Git blob ${oid} required for ${path} is unavailable`)
  return blob
}

interface GitLine {
  text: string
  token: string
}

function splitGitLines(text: string): GitLine[] {
  if (!text) return []
  const lines: GitLine[] = []
  let offset = 0
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset)
    if (newline < 0) {
      const value = text.slice(offset)
      lines.push({text: value, token: `${value}\0`})
      break
    }
    const value = text.slice(offset, newline)
    lines.push({text: value, token: `${value}\n`})
    offset = newline + 1
  }
  return lines
}

function displayGitLineToken(token: string): string {
  return token.endsWith("\n") || token.endsWith("\0") ? token.slice(0, -1) : token
}

function compareGitPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

const BINARY_DIFF_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "bz2",
  "db",
  "dll",
  "dylib",
  "eot",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "png",
  "rar",
  "so",
  "sqlite",
  "sqlite3",
  "tar",
  "tiff",
  "ttf",
  "wasm",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xz",
  "zip",
])
