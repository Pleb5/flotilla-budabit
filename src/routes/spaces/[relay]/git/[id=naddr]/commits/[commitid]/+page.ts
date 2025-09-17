import type {PageLoad} from "./$types"
import {getGitWorker} from "@nostr-git/core"
import {pushToast} from "@src/app/toast"

export interface CommitChange {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
  diffHunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patches: Array<{line: string; type: "+" | "-" | " "}>
  }>
}

export interface CommitMeta {
  sha: string
  author: string
  email: string
  date: number
  message: string
  parents: string[]
  // Optional Nostr identifiers if available (reserved for future resolver wiring)
  pubkey?: string
  nip05?: string
  nip39?: string
}

export const load: PageLoad = async ({params, parent}) => {
  const {commitid} = params

  try {
    // Get parent data which includes repoClass
    const parentData = await parent()
    const {repoClass} = parentData

    if (!repoClass || !repoClass.repoId) {
      pushToast({
        message: "Repository not found",
        theme: "error",
        timeout: 5000,
      })
      return
    }

    // Get git worker instance
    const gitWorker = getGitWorker()

    // Initialization is handled by Repo class constructor (#loadCommitsFromRepo)
    // Avoid re-initializing here to prevent duplicate worker operations/logs

    // Get detailed commit information including file changes
    const commitDetails = await gitWorker.api.getCommitDetails({
      repoId: repoClass.canonicalKey,
      commitId: commitid,
    })

    if (!commitDetails.success) {
      pushToast({
        message: commitDetails.error || "Commit not found",
        theme: "error",
        timeout: 5000,
      })
      return
    }

    // Create commit metadata from detailed commit data
    const commitMeta: CommitMeta = {
      sha: commitDetails.meta.sha,
      author: commitDetails.meta.author,
      email: commitDetails.meta.email,
      date: commitDetails.meta.date,
      message: commitDetails.meta.message,
      parents: commitDetails.meta.parents,
      // Placeholders to be populated when resolver is wired
      pubkey: undefined,
      nip05: undefined,
      nip39: undefined,
    }

    // Convert git-worker changes to our CommitChange format
    const changes: CommitChange[] = commitDetails.changes.map((change: any) => ({
      path: change.path,
      status: change.status,
      diffHunks: change.diffHunks,
    }))

    // Debug: log commit details and change summary
    try {
      console.debug("[commit/+page] Loaded commit", {
        repoId: repoClass.canonicalKey,
        commitId: commitid,
        meta: commitMeta,
        changeCount: changes.length,
        firstChange: changes[0],
      })
    } catch (e) {
      console.debug("[commit/+page] Debug log failed (ignored)", e)
    }

    return {
      commitMeta,
      changes,
      repoClass,
      commitid,
    }
  } catch (err) {
    console.error("Error loading commit details:", err)
    pushToast({
      message: "Failed to load commit details",
      theme: "error",
      timeout: 5000,
    })
    return
  }
}
