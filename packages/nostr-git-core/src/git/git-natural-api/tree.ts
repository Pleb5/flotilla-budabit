import type {ObjectGetterByHash, ParsedObject} from "./parse-packfile.js"

export type TreeEntry = {
  path: string
  mode: string
  isDir: boolean
  hash: string
}

export type Tree = {
  directories: Array<{
    name: string
    hash: string
    mode: string
    content: null | Tree
  }>
  files: Array<{
    name: string
    hash: string
    mode: string
    content: null | Uint8Array
  }>
}

export function loadTree(obj: ParsedObject, objects: ObjectGetterByHash, depth?: number): Tree {
  const directories: Tree["directories"] = []
  const files: Tree["files"] = []

  for (const entry of parseTree(obj.data)) {
    const child = objects.get(entry.hash)
    if (entry.isDir) {
      directories.push({
        name: entry.path,
        hash: entry.hash,
        mode: entry.mode,
        content:
          child && (depth === undefined || depth > 0)
            ? loadTree(child, objects, depth === undefined ? undefined : depth - 1)
            : null,
      })
    } else {
      files.push({
        name: entry.path,
        hash: entry.hash,
        mode: entry.mode,
        content: child?.data ?? null,
      })
    }
  }

  return {directories, files}
}

export function parseTree(treeData: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  const decoder = new TextDecoder("utf-8")
  let offset = 0

  while (offset < treeData.length) {
    const modeEnd = treeData.indexOf(0x20, offset)
    if (modeEnd === -1) throw new Error(`invalid tree entry mode at byte ${offset}`)
    const mode = decoder.decode(treeData.subarray(offset, modeEnd))
    offset = modeEnd + 1

    const filenameEnd = treeData.indexOf(0, offset)
    if (filenameEnd === -1) throw new Error(`invalid tree entry path at byte ${offset}`)
    const path = decoder.decode(treeData.subarray(offset, filenameEnd))
    offset = filenameEnd + 1

    if (treeData.length - offset < 20) {
      throw new Error(`truncated tree object ID for '${path}'`)
    }
    const hash = Array.from(treeData.subarray(offset, offset + 20), byte =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
    offset += 20

    entries.push({
      mode,
      path,
      hash,
      isDir: mode === "40000" || mode === "040000",
    })
  }

  return entries
}
