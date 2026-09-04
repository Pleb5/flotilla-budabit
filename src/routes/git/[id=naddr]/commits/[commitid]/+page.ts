import type {PageLoad} from "./$types"

export interface CommitChange {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
  binary?: boolean
  diffHunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patches: Array<{line: string; type: "+" | "-" | " "}>
  }>
}

// Repository-scoped client state owns remote ordering. Preloading through the
// worker would bypass that active read cursor and can start an unauthorized clone.
export const load: PageLoad = ({params}) => ({commitid: params.commitid})
