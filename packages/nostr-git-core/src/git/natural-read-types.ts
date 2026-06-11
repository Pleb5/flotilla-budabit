export type GitNaturalParsedObjectType = "commit" | "tree" | "blob" | "tag"

export interface GitNaturalParsedObject {
  type: GitNaturalParsedObjectType
  typeCode: number
  size: number
  data: Uint8Array
  offset: number
  hash: string
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
