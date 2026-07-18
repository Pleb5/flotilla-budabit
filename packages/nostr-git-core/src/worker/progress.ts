export type GitOperation = "clone" | "push" | "remote-sync"

export type GitProgressUnit = "objects" | "deltas" | "files" | "refs" | "targets" | "bytes"

/** A structured-clone and JSON-serializable progress message from the Git worker. */
export interface GitOperationProgressEvent {
  type: "git-progress"
  operationId: string
  repoId: string
  operation: GitOperation
  phase: string
  loaded?: number
  total?: number
  unit?: GitProgressUnit
  target?: string
  ref?: string
}

export interface GitProgressUpdate {
  phase: string
  loaded?: number
  total?: number
  unit?: GitProgressUnit
  ref?: string
}

export interface PushToRemoteOptions {
  repoId: string
  remoteUrl: string
  branch?: string
  ref?: string
  refs?: string[]
  token?: string
  provider?: string
  blossomMirror?: boolean
  operationId?: string
}

export function getGitProgressUnit(phase: string): GitProgressUnit | undefined {
  switch (phase) {
    case "Counting objects":
    case "Compressing objects":
    case "Receiving objects":
      return "objects"
    case "Resolving deltas":
      return "deltas"
    case "Updating workdir":
      return "files"
    default:
      return undefined
  }
}
