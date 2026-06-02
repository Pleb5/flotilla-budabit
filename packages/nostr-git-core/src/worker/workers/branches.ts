// Branch resolution helpers extracted from git-worker
import type {GitProvider} from "../../git/provider.js"
import {buildBranchRefCandidates, normalizeBranchName} from "../../utils/branch-refs.js"

const DEFAULT_BRANCH_FALLBACKS = ["main", "master", "develop", "dev"]

const resolveFirstMatchingRef = async (
  git: GitProvider,
  dir: string,
  branch: string,
): Promise<boolean> => {
  for (const ref of buildBranchRefCandidates(branch)) {
    try {
      await git.resolveRef({dir, ref})
      return true
    } catch {
      // try next
    }
  }

  return false
}

export async function resolveBranchName(
  git: GitProvider,
  dir: string,
  requestedBranch?: string,
  options?: {strict?: boolean},
): Promise<string> {
  const requestedShort = normalizeBranchName(requestedBranch)

  // If a specific branch was requested, try it first
  if (requestedShort) {
    if (await resolveFirstMatchingRef(git, dir, requestedShort)) {
      console.log(`[resolveBranchName] Successfully resolved requested branch: ${requestedShort}`)
      return requestedShort
    }

    if (options?.strict) {
      console.log(
        `[resolveBranchName] Requested branch "${requestedShort}" not found locally (strict mode), returning for fetch`,
      )
      return requestedShort
    }

    console.log(
      `[resolveBranchName] Requested branch "${requestedShort}" not found locally, trying fallbacks...`,
    )

    for (const fallbackBranch of DEFAULT_BRANCH_FALLBACKS) {
      if (fallbackBranch === requestedShort) continue
      if (await resolveFirstMatchingRef(git, dir, fallbackBranch)) {
        console.log(
          `[resolveBranchName] Using fallback branch '${fallbackBranch}' instead of requested '${requestedShort}'`,
        )
        return fallbackBranch
      }
    }

    console.log(
      `[resolveBranchName] No fallback branches found, returning requested branch "${requestedShort}" for fetch attempt`,
    )
    return requestedShort
  }

  // No specific branch requested - use fallback logic

  // Try the fallback branches
  for (const branchName of DEFAULT_BRANCH_FALLBACKS) {
    if (await resolveFirstMatchingRef(git, dir, branchName)) {
      return branchName
    }
  }

  // If all specific branches fail, try to list available branches
  let branches: string[]
  try {
    branches = await git.listBranches({dir})
  } catch (error) {
    // If listBranches fails, try remote branches as fallback
    console.warn("Failed to list local branches, trying remote branches:", error)
    try {
      const remoteBranches = await git.listBranches({dir, remote: "origin"})
      if (remoteBranches.length > 0) {
        const branch = normalizeBranchName(remoteBranches[0])
        console.log(
          `[resolveBranchName] Found ${remoteBranches.length} remote branches, using first: ${branch}`,
        )
        return branch
      }
    } catch (remoteError) {
      console.warn("Failed to list remote branches:", remoteError)
    }
    throw error
  }

  if (branches.length > 0) {
    const firstBranch = normalizeBranchName(branches[0])
    console.warn(
      `All specific branch resolution attempts failed, using first available branch: ${firstBranch}`,
    )
    return firstBranch
  }

  // No local branches found - try remote branches
  try {
    const remoteBranches = await git.listBranches({dir, remote: "origin"})
    if (remoteBranches.length > 0) {
      const branch = normalizeBranchName(remoteBranches[0])
      console.log(`[resolveBranchName] No local branches, using remote branch: ${branch}`)
      return branch
    }
  } catch (remoteError) {
    console.warn("[resolveBranchName] Failed to list remote branches:", remoteError)
  }

  // No branches found at all - this is an error condition
  throw new Error(`No branches found in repository at ${dir}`)
}
