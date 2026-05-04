import type {GitProvider} from "./provider.js"
import parseDiff from "parse-diff"
import type {Patch} from "../types/index.js"
import {createMergeMetadataEvent, createConflictMetadataEvent} from "../events/index.js"
import {createInvalidInputError, wrapError, type GitErrorContext} from "../errors/index.js"
import {fetchPrSourceTip} from "./pr-source-fetch.js"

export interface SimplifiedPatch {
  id: string
  commits: Array<{oid: string; message: string; author: {name: string; email: string}}>
  baseBranch: string
  raw: {content: string}
}

/**
 * Build a Merge Metadata event (kind 30411) from a merge analysis result.
 * repoAddr: shared-types RepoAddressA ("30617:<pubkey>:<d>")
 * rootId: the root patch event id or thread root this analysis pertains to
 */
export function buildMergeMetadataEventFromAnalysis(params: {
  repoAddr: string
  rootId: string
  targetBranch: string
  baseBranch?: string
  result: MergeAnalysisResult
}): ReturnType<typeof createMergeMetadataEvent> {
  const {repoAddr, rootId, targetBranch, baseBranch, result} = params
  const outcome: "clean" | "ff" | "conflict" = result.fastForward
    ? "ff"
    : result.hasConflicts
      ? "conflict"
      : "clean"
  const content = JSON.stringify({
    analysis: result.analysis,
    canMerge: result.canMerge,
    fastForward: result.fastForward,
    upToDate: result.upToDate,
    mergeBase: result.mergeBase,
    targetCommit: result.targetCommit,
    remoteCommit: result.remoteCommit,
    patchCommits: result.patchCommits,
    conflictFiles: result.conflictFiles,
  })
  return createMergeMetadataEvent({
    repoAddr,
    rootId,
    baseBranch,
    targetBranch,
    result: outcome,
    mergeCommit: result.targetCommit,
    content,
  })
}

/**
 * Build a Conflict Metadata event (kind 30412) from a merge analysis result with conflicts.
 */
export function buildConflictMetadataEventFromAnalysis(params: {
  repoAddr: string
  rootId: string
  result: MergeAnalysisResult
}): ReturnType<typeof createConflictMetadataEvent> | undefined {
  const {repoAddr, rootId, result} = params
  if (!result.hasConflicts || result.conflictFiles.length === 0) return undefined
  const files = result.conflictFiles
  const content = JSON.stringify({details: result.conflictDetails})
  return createConflictMetadataEvent({repoAddr, rootId, files, content})
}

export interface MergeAnalysisResult {
  canMerge: boolean
  hasConflicts: boolean
  conflictFiles: string[]
  conflictDetails: ConflictDetail[]
  upToDate: boolean
  fastForward: boolean
  mergeBase?: string
  targetCommit?: string
  remoteCommit?: string
  patchCommits: string[]
  analysis: "clean" | "conflicts" | "up-to-date" | "diverged" | "error"
  errorMessage?: string
}

export interface ConflictDetail {
  file: string
  type: "content" | "rename" | "delete" | "binary"
  conflictMarkers: ConflictMarker[]
  baseContent?: string
  headContent?: string
  patchContent?: string
}

export interface ConflictMarker {
  start: number
  end: number
  content: string
  type: "both-modified" | "deleted-by-us" | "deleted-by-them" | "added-by-both"
}

// Constants for conflict detection
const CONFLICT_DETECTION_CONSTANTS = {
  MAX_FILES_TO_PREVIEW: 5,
  MAX_FILES_TO_SCAN: 10,
  CONFLICT_MARKERS: {
    START: "<<<<<<<",
    SEPARATOR: "=======",
    END: ">>>>>>>",
  } as const,
} as const

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error || "Unknown error")
}

function isLikelyMergeConflictError(error: unknown): boolean {
  const value = error as any
  if (Array.isArray(value?.data?.filepaths) && value.data.filepaths.length > 0) return true

  const name = String(value?.name || "").toLowerCase()
  const message = getErrorMessage(error).toLowerCase()
  return (
    name.includes("mergeconflict") ||
    name.includes("mergenotsupported") ||
    message.includes("merge conflict") ||
    message.includes("automatic merge failed") ||
    message.includes("conflict markers")
  )
}

/**
 * Resolve the target branch using robust multi-fallback strategy
 */
async function resolveRobustBranchInMergeAnalysis(
  git: GitProvider,
  repoDir: string,
  preferredBranch?: string,
): Promise<string> {
  // Note: Do NOT return 'HEAD' - refs/heads/HEAD does not exist. We must return
  // an actual branch name for use with refs/heads/<branch>. Fall through to
  // named branch resolution (preferredBranch, main, master, etc.).

  const candidates = preferredBranch
    ? [preferredBranch, "main", "master", "develop", "dev"]
    : ["main", "master", "develop", "dev"]

  for (const branch of candidates) {
    try {
      await git.resolveRef({
        dir: repoDir,
        ref: `refs/heads/${branch}`,
      })
      return branch
    } catch {
      // Branch doesn't exist, try next candidate
      continue
    }
  }

  // If no candidates work, try to find any existing branch
  try {
    const branches = await git.listBranches({dir: repoDir})
    if (branches.length > 0) {
      const firstBranch = branches[0]
      console.warn(
        `All specific branch resolution attempts failed in merge analysis, using first available branch: ${firstBranch}`,
      )
      return firstBranch
    }
  } catch (error) {
    console.warn("Failed to list branches in merge analysis:", error)
  }

  // Ultimate fallback
  return preferredBranch || "main"
}

/**
 * Analyze if a patch can be merged cleanly into the target branch
 */
export async function analyzePatchMergeability(
  git: GitProvider,
  repoDir: string,
  patch: Patch | SimplifiedPatch,
  targetBranch?: string,
): Promise<MergeAnalysisResult> {
  // Declare variables outside try block to ensure they're in scope for catch block
  let remoteCommit: string | undefined
  let targetCommit: string | undefined
  let patchCommits: string[] = []

  const contextBase: GitErrorContext = {
    operation: "analyzePatchMergeability",
    repoDir,
    ref: targetBranch,
  }

  try {
    // Use robust multi-fallback branch resolution
    const resolvedBranch = await resolveRobustBranchInMergeAnalysis(git, repoDir, targetBranch)
    contextBase.ref = resolvedBranch

    // Get remote URL for fetch operation
    const remotes = await git.listRemotes({dir: repoDir})
    const originRemote = remotes.find((r: any) => r.remote === "origin")

    let remoteDivergence = false

    if (originRemote && originRemote.url) {
      try {
        // Fetch with more depth to detect divergence
        await git.fetch({
          dir: repoDir,
          url: originRemote.url,
          ref: resolvedBranch,
          singleBranch: true,
          depth: 50, // Get more history to detect divergence
        })

        // Get remote branch HEAD
        try {
          remoteCommit = await git.resolveRef({
            dir: repoDir,
            ref: `refs/remotes/origin/${resolvedBranch}`,
          })
        } catch (remoteRefError) {
          console.warn(`Could not resolve remote ref origin/${resolvedBranch}:`, remoteRefError)
        }
      } catch (fetchError) {
        console.warn("Failed to fetch remote in merge analysis:", fetchError)
      }
    } else {
      console.warn("Origin remote not found, skipping fetch in merge analysis")
    }

    // Get current HEAD of local target branch
    targetCommit = await git.resolveRef({
      dir: repoDir,
      ref: `refs/heads/${resolvedBranch}`,
    })

    // Check for remote divergence if we have both commits
    if (remoteCommit && targetCommit !== remoteCommit) {
      try {
        // Check if local is behind remote (remote has commits local doesn't)
        const isAncestor = await git.isDescendent({
          dir: repoDir,
          oid: targetCommit,
          ancestor: remoteCommit,
        })

        if (!isAncestor) {
          // Local is not a descendant of remote - branches have diverged
          remoteDivergence = true
          console.warn(`Local branch ${resolvedBranch} has diverged from remote`)
        }
      } catch (divergenceError) {
        console.warn("Could not check branch divergence:", divergenceError)
        // Assume divergence to be safe
        remoteDivergence = true
      }
    }

    // Parse patch to get commit information
    patchCommits = patch.commits.map(c => c.oid)

    // Validate patch content early
    const rawContent: unknown = (patch as any)?.raw?.content
    if (typeof rawContent !== "string" || rawContent.length === 0) {
      return {
        canMerge: false,
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: false,
        fastForward: false,
        targetCommit,
        remoteCommit,
        patchCommits,
        analysis: "error",
        errorMessage: "invalid patch content error",
      }
    }

    if (patchCommits.length === 0) {
      return {
        canMerge: false,
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: false,
        fastForward: false,
        targetCommit,
        remoteCommit,
        patchCommits: [],
        analysis: "error",
        errorMessage: "No commits found in patch",
      }
    }

    // Check if patch is already applied (commits exist in target branch)
    const isUpToDate = await checkIfPatchApplied(git, repoDir, patchCommits, resolvedBranch)
    if (isUpToDate) {
      return {
        canMerge: true,
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: true,
        fastForward: false,
        targetCommit,
        remoteCommit,
        patchCommits,
        analysis: "up-to-date",
      }
    }

    // Find merge base between patch and target
    if (!targetCommit) {
      throw createInvalidInputError("Failed to resolve target commit", contextBase)
    }
    const mergeBase = await findMergeBase(git, repoDir, patchCommits[0], targetCommit)

    // Check if it's a fast-forward merge (target is ancestor of patch)
    let isFastForward = false
    try {
      const descendant = await git.isDescendent({
        dir: repoDir,
        oid: patchCommits[patchCommits.length - 1],
        ancestor: targetCommit,
      })
      isFastForward = descendant || mergeBase === targetCommit
    } catch {
      isFastForward = mergeBase === targetCommit
    }

    if (isFastForward) {
      return {
        canMerge: true,
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: false,
        fastForward: true,
        mergeBase,
        targetCommit,
        remoteCommit,
        patchCommits,
        analysis: "clean",
      }
    }

    // Check for remote divergence first - this affects merge strategy
    if (remoteDivergence) {
      return {
        canMerge: false, // Cannot merge cleanly due to divergence
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: false,
        fastForward: false,
        mergeBase,
        targetCommit,
        remoteCommit,
        patchCommits,
        analysis: "diverged",
        errorMessage: "Local branch has diverged from remote. Force push or rebase required.",
      }
    }

    // Perform a dry-run merge to detect conflicts
    const conflictAnalysis = await performDryRunMerge(
      git,
      repoDir,
      patch as SimplifiedPatch,
      resolvedBranch,
    )

    return {
      canMerge: !conflictAnalysis.hasConflicts,
      hasConflicts: conflictAnalysis.hasConflicts,
      conflictFiles: conflictAnalysis.conflictFiles,
      conflictDetails: conflictAnalysis.conflictDetails,
      upToDate: false,
      fastForward: false,
      mergeBase,
      targetCommit,
      remoteCommit,
      patchCommits,
      analysis: conflictAnalysis.hasConflicts ? "conflicts" : "clean",
    }
  } catch (error) {
    const wrapped = wrapError(error, contextBase)
    return {
      canMerge: false,
      hasConflicts: false,
      conflictFiles: [],
      conflictDetails: [],
      upToDate: false,
      fastForward: false,
      targetCommit,
      remoteCommit,
      patchCommits,
      analysis: "error",
      errorMessage: wrapped.message,
    }
  }
}

/**
 * Check if patch commits are already applied to the target branch
 * Uses multiple strategies to detect already-merged patches
 */
async function checkIfPatchApplied(
  git: GitProvider,
  repoDir: string,
  patchCommits: string[],
  targetBranch: string,
): Promise<boolean> {
  try {
    // Strategy 1: Check if any patch commit exists in branch history
    // Use a larger depth to catch older merges
    const log = await git.log({
      dir: repoDir,
      ref: targetBranch,
      depth: 500, // Check more commits for thorough detection
    })

    const targetCommits = log.map((commit: any) => commit.oid)

    // Check if any patch commits exist in target branch
    const hasAnyPatchCommit = patchCommits.some(patchCommit => targetCommits.includes(patchCommit))

    if (hasAnyPatchCommit) {
      console.log(
        `Patch already merged: found commits ${patchCommits.filter(c => targetCommits.includes(c))} in branch ${targetBranch}`,
      )
      return true
    }

    // Strategy 2: Check if patch content matches recent commits
    // This catches cases where patch was applied but with different commit IDs
    // (e.g., rebased, cherry-picked, or manually applied)
    if (patchCommits.length > 0) {
      try {
        // Get the first patch commit to check its content
        const patchCommit = await git.readCommit({
          dir: repoDir,
          oid: patchCommits[0],
        })

        // Look for commits with same author and message in recent history
        const recentCommits = log.slice(0, 50) // Check last 50 commits
        const matchingCommit = recentCommits.find(
          (commit: any) =>
            commit.commit.author.email === patchCommit.commit.author.email &&
            commit.commit.message.trim() === patchCommit.commit.message.trim(),
        )

        if (matchingCommit) {
          console.log(
            `Patch content already merged: found matching commit ${matchingCommit.oid} with same author/message`,
          )
          return true
        }
      } catch (commitError) {
        // Patch commit might not exist in this repo (expected for external patches), continue with other checks
        console.debug(
          "Could not read patch commit for content comparison (expected for external patches):",
          commitError,
        )
      }
    }

    return false
  } catch (error) {
    console.warn("Error checking if patch is applied:", error)
    return false
  }
}

/**
 * Check if PR is already applied to the target branch.
 * PR applied = tip commit is in target. Partial commits (some but not tip) = NOT applied.
 */
async function checkIfPRApplied(
  git: GitProvider,
  repoDir: string,
  targetBranch: string,
  tipOid: string,
): Promise<boolean> {
  try {
    const targetCommit = await git.resolveRef({
      dir: repoDir,
      ref: `refs/heads/${targetBranch}`,
    })
    const targetContainsTip = await git.isDescendent({
      dir: repoDir,
      oid: targetCommit,
      ancestor: tipOid,
    })
    if (targetContainsTip) {
      console.log(
        `PR already merged: target branch ${targetBranch} contains tip ${tipOid.substring(0, 8)}`,
      )
      return true
    }

    const log = await git.log({dir: repoDir, ref: targetBranch, depth: 500})
    const targetCommits = log.map((commit: any) => commit.oid)
    if (targetCommits.includes(tipOid)) {
      console.log(
        `PR already merged: tip ${tipOid.substring(0, 8)} found in branch ${targetBranch}`,
      )
      return true
    }

    return false
  } catch (error) {
    console.warn("Error checking if PR is applied:", error)
    return false
  }
}

/**
 * Find the merge base between two commits.
 * Normalizes result: isomorphic-git may return string or array of strings.
 */
async function findMergeBase(
  git: GitProvider,
  repoDir: string,
  commit1: string,
  commit2: string,
): Promise<string | undefined> {
  try {
    const result = await git.findMergeBase({
      dir: repoDir,
      oids: [commit1, commit2],
    })
    if (typeof result === "string") return result
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === "string")
      return result[0]
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Perform a dry-run merge to detect conflicts
 */
async function performDryRunMerge(
  git: GitProvider,
  repoDir: string,
  patch: SimplifiedPatch,
  targetBranch: string,
): Promise<{
  hasConflicts: boolean
  conflictFiles: string[]
  conflictDetails: ConflictDetail[]
}> {
  try {
    // Analyze the diff to predict potential conflicts
    const conflictAnalysis = await analyzeDiffForConflicts(git, repoDir, patch, targetBranch)

    return conflictAnalysis
  } catch (error) {
    console.error("Error performing dry-run merge:", error)
    return {
      hasConflicts: false,
      conflictFiles: [],
      conflictDetails: [],
    }
  }
}

/**
 * Analyze patch diff against current state to predict conflicts
 */
async function analyzeDiffForConflicts(
  git: GitProvider,
  repoDir: string,
  patch: SimplifiedPatch,
  targetBranch: string,
): Promise<{
  hasConflicts: boolean
  conflictFiles: string[]
  conflictDetails: ConflictDetail[]
}> {
  const conflictDetails: ConflictDetail[] = []
  const conflictFiles: string[] = []

  try {
    // Parse the patch diff (normalize literal \n sequences to real newlines)
    const patchContent = "raw" in patch ? patch.raw.content : (patch as any).raw.content
    const normalizedContent =
      typeof patchContent === "string" ? patchContent.replace(/\\n/g, "\n") : ""
    const parsedDiff = parseDiff(normalizedContent)

    const decodeBlob = (res: any): string => {
      try {
        const b = (res && (res.blob ?? res)) as any
        if (typeof b === "string") return b
        if (b && typeof b.byteLength === "number") return new TextDecoder("utf-8").decode(b)
        return String(res ?? "")
      } catch {
        return ""
      }
    }

    for (const file of parsedDiff) {
      if (!file.to || file.to === "/dev/null") continue

      const filePath = file.to

      try {
        // Get current file content from target branch
        const currentContentBlob = await git.readBlob({
          dir: repoDir,
          oid: await git.resolveRef({
            dir: repoDir,
            ref: `refs/heads/${targetBranch}`,
          }),
          filepath: filePath,
        })
        const currentContent = decodeBlob(currentContentBlob)

        // Check if file has been modified since patch base
        const hasLocalChanges = await checkFileModifiedSinceBase(
          git,
          repoDir,
          filePath,
          patch.baseBranch || targetBranch,
          targetBranch,
        )

        if (hasLocalChanges) {
          // Potential conflict - file modified in both patch and target
          const conflictMarkers = await detectConflictMarkers(file, currentContent)

          if (conflictMarkers.length > 0) {
            conflictFiles.push(filePath)
            conflictDetails.push({
              file: filePath,
              type: "content",
              conflictMarkers,
              headContent: currentContent,
            })
          } else {
            // If diff parser did not provide chunks/hunks, be conservative and
            // flag this as a conflict because both sides changed this file.
            const hasChunks = Array.isArray((file as any).chunks) && (file as any).chunks.length > 0
            const hasHunks = Array.isArray((file as any).hunks) && (file as any).hunks.length > 0
            if (!hasChunks && !hasHunks) {
              conflictFiles.push(filePath)
              conflictDetails.push({
                file: filePath,
                type: "content",
                conflictMarkers: [
                  {start: 1, end: -1, content: "Both sides modified file", type: "both-modified"},
                ],
                headContent: currentContent,
              })
            }
          }
        }
      } catch (error) {
        // File might not exist in current branch - check if it's a new file conflict
        if ((file as any).type === "add" || ((file as any).to && !(file as any).from)) {
          try {
            // Check if file was added in target branch too
            await git.readBlob({
              dir: repoDir,
              oid: await git.resolveRef({
                dir: repoDir,
                ref: `refs/heads/${targetBranch}`,
              }),
              filepath: filePath,
            })

            // File exists in both - potential conflict
            conflictFiles.push(filePath)
            conflictDetails.push({
              file: filePath,
              type: "content",
              conflictMarkers: [
                {
                  start: 1,
                  end: -1,
                  content: "File added in both branches",
                  type: "added-by-both",
                },
              ],
            })
          } catch {
            // File doesn't exist in target - no conflict
          }
        }
      }
    }

    return {
      hasConflicts: conflictFiles.length > 0,
      conflictFiles,
      conflictDetails,
    }
  } catch (error) {
    console.error("Error analyzing diff for conflicts:", error)
    return {
      hasConflicts: false,
      conflictFiles: [],
      conflictDetails: [],
    }
  }
}

/**
 * Check if a file has been modified since the base branch
 */
async function checkFileModifiedSinceBase(
  git: GitProvider,
  repoDir: string,
  filePath: string,
  baseBranch: string,
  targetBranch: string,
): Promise<boolean> {
  try {
    const decodeBlob = (res: any): string => {
      try {
        const b = (res && (res.blob ?? res)) as any
        if (typeof b === "string") return b
        if (b && typeof b.byteLength === "number") return new TextDecoder("utf-8").decode(b)
        return String(res ?? "")
      } catch {
        return ""
      }
    }

    // Get file content from base branch
    const baseBlob = await git.readBlob({
      dir: repoDir,
      oid: await git.resolveRef({
        dir: repoDir,
        ref: `refs/heads/${baseBranch}`,
      }),
      filepath: filePath,
    })
    const baseContent = decodeBlob(baseBlob)

    // Get file content from target branch
    const targetBlob = await git.readBlob({
      dir: repoDir,
      oid: await git.resolveRef({
        dir: repoDir,
        ref: `refs/heads/${targetBranch}`,
      }),
      filepath: filePath,
    })
    const targetContent = decodeBlob(targetBlob)

    return baseContent !== targetContent
  } catch {
    // If we can't read from either branch, assume it's modified
    return true
  }
}

/**
 * Detect potential conflict markers in diff hunks
 */
async function detectConflictMarkers(file: any, currentContent: string): Promise<ConflictMarker[]> {
  const markers: ConflictMarker[] = []

  const chunks = (file as any).chunks || (file as any).hunks
  if (!Array.isArray(chunks) || chunks.length === 0) return markers

  for (const chunk of chunks) {
    const changes = (chunk as any).changes || []
    const modifiedLines = changes
      .filter((change: any) => change.type === "del" || change.type === "add")
      .map((change: any) => change.ln || change.ln2)
      .filter(Boolean)

    if (modifiedLines.length > 0) {
      markers.push({
        start: Math.min(...modifiedLines),
        end: Math.max(...modifiedLines),
        content: (chunk as any).content || "",
        type: "both-modified",
      })
    }
  }

  return markers
}

/**
 * Extended result for PR merge analysis (includes files changed and clone URL used).
 *
 * Unlike patch analysis, PR analysis fetches commits from remote URLs and performs
 * a real git merge for conflict detection. This interface adds PR-specific fields
 * for UI display and debugging.
 */
export interface PRMergeAnalysisResult extends MergeAnalysisResult {
  /** Files changed between merge-base and tip commit (for PR diff display) */
  filesChanged?: string[] // TODO: remove this
  /** Target clone URL used to refresh the base branch before analysis */
  usedTargetCloneUrl?: string
  /** Clone URL that succeeded when using fallback (helps debug fetch failures) */
  usedCloneUrl?: string
  /** Commit metadata for display (oid, message, author) */
  prCommits?: Array<{oid: string; message: string; author?: {name?: string; email?: string}}>
}

/**
 * Analyze if a PR can be merged into the target branch.
 *
 * Flow:
 * 1. Filter and validate clone URLs from the PR
 * 2. Try each URL (with fallback) until fetch succeeds
 * 3. Add temporary remote, fetch PR branch, resolve tip commit
 * 4. Check if PR is already merged (up-to-date)
 * 5. Find merge base, determine fast-forward vs merge
 * 6. For non-FF: perform actual git merge (dry-run) to detect conflicts
 * 7. Collect files changed and commit log for result
 * 8. Remove temporary remote
 */
export async function analyzePRMergeability(
  git: GitProvider,
  repoDir: string,
  opts: {
    /** Clone URLs from PR/update event - used to fetch source branch */
    cloneUrls: string[]
    /** Clone URLs from repo (base) - used to fetch target branch when not present */
    targetCloneUrls?: string[]
    tipCommitOid: string
    targetBranch: string
    strictTargetFresh?: boolean
    corsProxy?: string | null
    getAuthCallback?: (url: string) => any
  },
): Promise<PRMergeAnalysisResult> {
  const {
    cloneUrls,
    targetCloneUrls,
    tipCommitOid,
    targetBranch,
    strictTargetFresh = false,
    corsProxy,
    getAuthCallback,
  } = opts
  const {withUrlFallback, filterValidCloneUrls} = await import("../utils/clone-url-fallback.js")

  console.log(
    `[analyzePRMergeability] Starting PR merge analysis: tip=${tipCommitOid.substring(0, 8)}, target=${targetBranch}, cloneUrls=${cloneUrls.length}`,
  )

  const returnObj: PRMergeAnalysisResult = {
    canMerge: false,
    hasConflicts: false,
    conflictFiles: [],
    conflictDetails: [],
    upToDate: false,
    fastForward: false,
    patchCommits: [tipCommitOid],
    analysis: "error",
    errorMessage: "Placeholder error message",
  }

  const effectiveTargetBranch = targetBranch || "main"

  const validUrls = filterValidCloneUrls(cloneUrls)
  if (validUrls.length === 0) {
    console.warn(
      `[analyzePRMergeability] No valid clone URLs after filtering (input: ${cloneUrls.length} URLs)`,
    )
    return {
      ...returnObj,
      analysis: "error",
      errorMessage: "No valid clone URLs in PR",
    }
  }
  console.log(`[analyzePRMergeability] ${validUrls.length} valid clone URL(s) to try`)

  const errResult = (msg: string): PRMergeAnalysisResult => ({
    ...returnObj,
    analysis: "error",
    errorMessage: msg,
  })

  let usedTargetCloneUrl: string | undefined

  const validTargetUrls = filterValidCloneUrls(targetCloneUrls || [])
  if (strictTargetFresh && validTargetUrls.length === 0) {
    return errResult(
      `No valid target clone URLs available to refresh target branch "${effectiveTargetBranch}"`,
    )
  }

  if (validTargetUrls.length > 0) {
    const targetRemote = `pr-target-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    const targetFetchResult = await withUrlFallback(
      validTargetUrls,
      async (targetUrl: string) => {
        try {
          try {
            await git.deleteRemote({dir: repoDir, remote: targetRemote})
          } catch {
            /* ignore */
          }
          await git.addRemote({dir: repoDir, remote: targetRemote, url: targetUrl})
          try {
            await git.setConfig({
              dir: repoDir,
              path: `remote.${targetRemote}.fetch`,
              value: `+refs/heads/*:refs/remotes/${targetRemote}/*`,
            })
          } catch {
            /* ignore */
          }

          const fetchOptions: any = {
            dir: repoDir,
            remote: targetRemote,
            url: targetUrl,
            ref: effectiveTargetBranch,
            singleBranch: true,
            depth: 100,
            prune: true,
            tags: false,
          }
          if (corsProxy !== undefined) {
            fetchOptions.corsProxy = corsProxy
          }
          if (getAuthCallback) {
            fetchOptions.onAuth = getAuthCallback(targetUrl)
          }

          await git.fetch(fetchOptions)
          const remoteRef = `refs/remotes/${targetRemote}/${effectiveTargetBranch}`
          const remoteOid = await git.resolveRef({dir: repoDir, ref: remoteRef})
          await git.writeRef({
            dir: repoDir,
            ref: `refs/heads/${effectiveTargetBranch}`,
            value: remoteOid,
            force: true,
          })

          return {oid: remoteOid}
        } finally {
          try {
            await git.deleteRemote({dir: repoDir, remote: targetRemote})
          } catch {
            /* ignore */
          }
        }
      },
      {perUrlTimeoutMs: 20000},
    )

    if (!targetFetchResult.success) {
      const attempts = targetFetchResult.attempts?.length
        ? targetFetchResult.attempts.map(a => `${a.url}: ${a.error || "failed"}`).join("; ")
        : "unknown target fetch error"
      return errResult(
        `Failed to refresh target branch "${effectiveTargetBranch}" from remote: ${attempts}`,
      )
    }

    usedTargetCloneUrl = targetFetchResult.usedUrl
  }

  let resolvedBranch: string
  try {
    resolvedBranch = await resolveRobustBranchInMergeAnalysis(git, repoDir, effectiveTargetBranch)
  } catch (error) {
    return errResult(error instanceof Error ? error.message : String(error))
  }

  if (effectiveTargetBranch && resolvedBranch !== effectiveTargetBranch) {
    return errResult(
      `Target branch '${effectiveTargetBranch}' not found after sync (resolved '${resolvedBranch}' instead)`,
    )
  }

  let targetCommit: string
  try {
    targetCommit = await git.resolveRef({
      dir: repoDir,
      ref: `refs/heads/${resolvedBranch}`,
    })
  } catch (error) {
    return errResult(
      `Target branch '${effectiveTargetBranch}' could not be resolved locally after sync: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  console.log(
    `[analyzePRMergeability] Target branch ${resolvedBranch} @ ${targetCommit?.substring(0, 8)}`,
  )

  // Use unique remote name per invocation to avoid race when multiple analyses run concurrently
  const prRemote = `pr-source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  const result = await withUrlFallback(
    validUrls,
    async (url: string) => {
      try {
        await git.addRemote({dir: repoDir, remote: prRemote, url})
        const onAuth = getAuthCallback ? getAuthCallback(url) : undefined
        const sourceFetch = await fetchPrSourceTip(git, {
          dir: repoDir,
          remote: prRemote,
          url,
          tipCommitOid,
          depth: 100,
          ...(corsProxy !== undefined ? {corsProxy} : {}),
          ...(onAuth ? {onAuth} : {}),
        })
        console.log(
          `[analyzePRMergeability] PR source ready via ${sourceFetch.strategy} from ${url}`,
        )

        const tipOid = sourceFetch.tipOid

        const prTipRef = tipOid
        const prTipOid = tipOid
        const patchCommits = [tipOid]

        // Check if PR is already in target (tip must be present; partial commits = not merged)
        const isUpToDate = await checkIfPRApplied(git, repoDir, resolvedBranch, prTipOid)
        if (isUpToDate) {
          console.log(
            `[analyzePRMergeability] PR already up-to-date (commits present in ${resolvedBranch})`,
          )
          return {
            canMerge: true,
            hasConflicts: false,
            conflictFiles: [],
            conflictDetails: [],
            upToDate: true,
            fastForward: false,
            targetCommit,
            remoteCommit: undefined,
            patchCommits,
            analysis: "up-to-date",
            filesChanged: [],
            usedTargetCloneUrl,
            usedCloneUrl: url,
            prCommits: await getCommitMetadataForOids(git, repoDir, patchCommits),
          } as PRMergeAnalysisResult
        }

        // Use prTipOid (not prTipRef) - findMergeBase requires OIDs
        const mergeBase = await findMergeBase(git, repoDir, prTipOid, targetCommit)
        const mergeBaseShort = typeof mergeBase === "string" ? mergeBase.substring(0, 8) : "none"
        console.log(`[analyzePRMergeability] Merge base: ${mergeBaseShort}`)

        // Fast-forward: target is ancestor of PR tip (no merge commit needed)
        let isFastForward = false
        try {
          const descendant = await git.isDescendent({
            dir: repoDir,
            oid: prTipOid,
            ancestor: targetCommit,
          })
          isFastForward = descendant || mergeBase === targetCommit
        } catch {
          isFastForward = mergeBase === targetCommit
        }

        if (isFastForward) {
          console.log(`[analyzePRMergeability] Fast-forward merge possible`)
          const baseForDiff = mergeBase ?? targetCommit
          const filesChanged = baseForDiff
            ? await getChangedFilesBetween(git, repoDir, baseForDiff, prTipRef)
            : []
          const prCommits = await getPRCommitsOnly(
            git,
            repoDir,
            prTipRef,
            mergeBase ?? targetCommit,
            50,
          )
          const effectivePrCommits =
            prCommits.length > 0
              ? prCommits
              : await getCommitMetadataForOids(git, repoDir, [prTipRef])
          const patchCommitOids = effectivePrCommits.map(commit => commit.oid)
          return {
            canMerge: true,
            hasConflicts: false,
            conflictFiles: [],
            conflictDetails: [],
            upToDate: false,
            fastForward: true,
            mergeBase,
            targetCommit,
            remoteCommit: undefined,
            patchCommits: patchCommitOids.length > 0 ? patchCommitOids : patchCommits,
            analysis: "clean",
            filesChanged,
            usedTargetCloneUrl,
            usedCloneUrl: url,
            prCommits: effectivePrCommits,
          } as PRMergeAnalysisResult
        }

        // Non-FF: perform real git merge to detect conflicts
        // Pass prTipRef (not tipOid) so merge uses a ref that exists; tipOid may not resolve
        const mergeResult = await performPRDryRunMerge(git, repoDir, prTipRef, resolvedBranch)
        console.log(
          `[analyzePRMergeability] Dry-run merge: conflicts=${mergeResult.hasConflicts}, files=${mergeResult.conflictFiles.length}`,
        )

        const baseForDiff = mergeBase ?? targetCommit
        const filesChanged = baseForDiff
          ? await getChangedFilesBetween(git, repoDir, baseForDiff, prTipRef)
          : []
        const prCommits = await getPRCommitsOnly(
          git,
          repoDir,
          prTipRef,
          mergeBase ?? targetCommit,
          50,
        )
        const effectivePrCommits =
          prCommits.length > 0
            ? prCommits
            : await getCommitMetadataForOids(git, repoDir, [prTipRef])
        const patchCommitOids = effectivePrCommits.map(commit => commit.oid)
        console.log(
          `[analyzePRMergeability] Success via ${url}: analysis=${mergeResult.hasConflicts ? "conflicts" : "clean"}, filesChanged=${filesChanged.length}`,
        )

        return {
          canMerge: !mergeResult.hasConflicts,
          hasConflicts: mergeResult.hasConflicts,
          conflictFiles: mergeResult.conflictFiles,
          conflictDetails: mergeResult.conflictDetails,
          upToDate: false,
          fastForward: false,
          mergeBase,
          targetCommit,
          remoteCommit: undefined,
          patchCommits: patchCommitOids.length > 0 ? patchCommitOids : patchCommits,
          analysis: mergeResult.hasConflicts ? "conflicts" : "clean",
          filesChanged,
          usedTargetCloneUrl,
          usedCloneUrl: url,
          prCommits: effectivePrCommits,
        } as PRMergeAnalysisResult
      } finally {
        try {
          await git.deleteRemote({dir: repoDir, remote: prRemote})
        } catch {
          /* ignore */
        }
      }
    },
    {perUrlTimeoutMs: 20000},
  )

  if (!result.success || !result.result) {
    const errMsg = result.attempts?.length
      ? result.attempts.map(a => `${a.url}: ${a.error || "failed"}`).join("; ")
      : "Failed to fetch PR from any clone URL"
    console.warn(`[analyzePRMergeability] All clone URLs failed: ${errMsg}`)
    return errResult(errMsg)
  }

  return result.result
}

/**
 * Get list of files that differ between two commits (fromOid -> toOid).
 * Uses git walk to compare tree blobs; only returns leaf files (not directories).
 * Used for PR diff display (files changed in the PR).
 */
async function getChangedFilesBetween(
  git: GitProvider,
  repoDir: string,
  fromOid: string,
  toOid: string,
): Promise<string[]> {
  try {
    if (!git.TREE) {
      console.warn("[getChangedFilesBetween] GitProvider has no TREE, returning []")
      return []
    }
    // Must call git.TREE() so `this` is bound; extracted TREE() loses context (e.g. CachedGitProvider.inner)
    const results = await git.walk({
      dir: repoDir,
      trees: [git.TREE({ref: fromOid}), git.TREE({ref: toOid})],
      map: async (filepath: string, [A, B]: [any, any]) => {
        if (filepath === ".") return
        const Atype = await A?.type?.()
        const Btype = await B?.type?.()
        if (Atype === "tree" || Btype === "tree") return // Skip directories
        const Aoid = await A?.oid?.()
        const Boid = await B?.oid?.()
        if (Aoid === Boid) return // Same content, not changed
        return filepath
      },
    })
    const files = (results || []).filter(Boolean)
    return files
  } catch (err) {
    console.warn("[getChangedFilesBetween] Failed:", err)
    return []
  }
}

/**
 * Get commit log from ref (up to depth commits).
 * Returns flattened metadata (oid, message, author) for UI display.
 */
async function getCommitLog(
  git: GitProvider,
  repoDir: string,
  ref: string,
  depth: number,
): Promise<Array<{oid: string; message: string; author?: {name?: string; email?: string}}>> {
  try {
    const log = await git.log({dir: repoDir, ref, depth})
    return log.map((c: any) => ({
      oid: c.oid,
      message: c.commit?.message || "",
      author: c.commit?.author,
    }))
  } catch (err) {
    console.warn(`[getCommitLog] Failed for ref=${ref}:`, err)
    return []
  }
}

/**
 * Get only commits that are in the PR branch (from mergeBase to PR tip), not in target.
 * Stops when we reach mergeBase or the given stopRef.
 */
async function getPRCommitsOnly(
  git: GitProvider,
  repoDir: string,
  prTipRef: string,
  stopAtOidOrRef: string,
  maxDepth: number,
): Promise<Array<{oid: string; message: string; author?: {name?: string; email?: string}}>> {
  try {
    const log = await git.log({dir: repoDir, ref: prTipRef, depth: maxDepth})
    const result: Array<{oid: string; message: string; author?: {name?: string; email?: string}}> =
      []
    for (const c of log) {
      if (c.oid === stopAtOidOrRef) break // Reached merge base, stop (don't include it)
      result.push({
        oid: c.oid,
        message: c.commit?.message || "",
        author: c.commit?.author,
      })
    }
    return result
  } catch (err) {
    console.warn(`[getPRCommitsOnly] Failed for ref=${prTipRef}:`, err)
    return []
  }
}

/**
 * Resolve commit metadata for explicit commit OIDs.
 * Keeps input order and skips entries that cannot be read.
 */
async function getCommitMetadataForOids(
  git: GitProvider,
  repoDir: string,
  oids: string[],
): Promise<Array<{oid: string; message: string; author?: {name?: string; email?: string}}>> {
  const result: Array<{oid: string; message: string; author?: {name?: string; email?: string}}> = []
  for (const oid of oids) {
    if (!oid) continue
    try {
      const commit = await git.readCommit({dir: repoDir, oid})
      result.push({
        oid,
        message: commit.commit?.message || "",
        author: commit.commit?.author,
      })
    } catch {
      // Ignore missing commits and continue with those available.
    }
  }
  return result
}

/**
 * Parse conflict markers (<<<<<<<, =======, >>>>>>>) from a file's content.
 * Returns ConflictMarker[] with start/end line numbers and type.
 */
function parseConflictMarkers(content: string): ConflictMarker[] {
  const markers: ConflictMarker[] = []
  const lines = content.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith("<<<<<<<")) {
      const start = i + 1
      let sepIdx = -1
      let endIdx = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("=======")) {
          sepIdx = j
          break
        }
      }
      for (let j = (sepIdx >= 0 ? sepIdx : i) + 1; j < lines.length; j++) {
        if (lines[j].startsWith(">>>>>>>")) {
          endIdx = j
          break
        }
      }
      const end = endIdx >= 0 ? endIdx + 1 : lines.length
      markers.push({
        start,
        end,
        content: lines.slice(i, end).join("\n"),
        type: "both-modified",
      })
      i = end
    } else {
      i++
    }
  }
  return markers
}

/**
 * Read file from working tree and parse conflict markers.
 * readFile: fs.promises.readFile or similar (path, encoding) => Promise<content>
 */
async function parseConflictMarkersFromPath(
  readFile: (path: string, ...args: any[]) => Promise<string | Buffer>,
  repoDir: string,
  filepath: string,
): Promise<ConflictMarker[]> {
  try {
    const fullPath = `${repoDir}/${filepath}`.replace(/\/+/g, "/")
    const data = await readFile(fullPath, "utf8").catch(() => readFile(fullPath))
    const content = typeof data === "string" ? data : ((data as Buffer)?.toString?.("utf8") ?? "")
    console.log(
      `[parseConflictMarkersFromPath] Parsing conflict markers from ${filepath}:`,
      content,
    )
    return parseConflictMarkers(content)
  } catch {
    return []
  }
}

/**
 * Detect conflicts from MergeConflictError data
 */
async function detectConflictsFromError(err: any): Promise<string[]> {
  console.log(`[performPRDryRunMerge] Detecting conflicts from error: ${JSON.stringify(err)}`)
  const errFilepaths: string[] | undefined = err?.data?.filepaths
  if (Array.isArray(errFilepaths) && errFilepaths.length > 0) {
    const preview =
      errFilepaths.length > CONFLICT_DETECTION_CONSTANTS.MAX_FILES_TO_PREVIEW
        ? `${errFilepaths.slice(0, CONFLICT_DETECTION_CONSTANTS.MAX_FILES_TO_PREVIEW).join(", ")}... (+${errFilepaths.length - CONFLICT_DETECTION_CONSTANTS.MAX_FILES_TO_PREVIEW} more)`
        : errFilepaths.join(", ")
    console.log(
      `[performPRDryRunMerge] MergeConflictError in ${errFilepaths.length} files: ${preview}`,
    )
    return errFilepaths
  }
  return []
}

/**
 * Detect conflicts by performing fallback merge and analyzing status matrix
 */
async function detectConflictsFromStatusMatrix(
  git: GitProvider,
  repoDir: string,
  targetBranch: string,
  tempBranch: string,
  prTipRef: string,
  tipOid: string,
): Promise<string[]> {
  await git.checkout({dir: repoDir, ref: targetBranch})
  try {
    await git.deleteBranch({dir: repoDir, ref: tempBranch})
  } catch {
    /* ignore */
  }
  await git.branch({dir: repoDir, ref: tempBranch, checkout: true})

  const fallbackConflictFiles: string[] = []

  try {
    await git.merge({
      dir: repoDir,
      ours: tempBranch,
      theirs: prTipRef,
      fastForward: false,
      abortOnConflict: false, // Allow merge to continue with conflict markers
      message: `Analysis fallback merge test (${tipOid.substring(0, 8)})`,
      author: {name: "Repository Maintainer", email: "maintainer@nostr-git.local"},
    } as any)
  } catch (mergeError) {
    const fromError = await detectConflictsFromError(mergeError)
    fallbackConflictFiles.push(...fromError)

    if (fromError.length === 0 && !isLikelyMergeConflictError(mergeError)) {
      throw mergeError
    }

    console.warn(
      "[performPRDryRunMerge] Fallback merge reported conflicts; scanning status matrix:",
      mergeError,
    )
  }

  // Check status matrix for conflicted files
  const status = await git.statusMatrix({dir: repoDir})
  const conflictFiles: string[] = []
  const seen = new Set<string>()

  for (const row of status) {
    const [filepath, head, workdir, stage] = row
    if (filepath && !seen.has(filepath)) {
      // Multiple stage entries for same file or unmerged files = conflict
      if (stage === 1 || (head === 1 && workdir === 2 && stage === 0)) {
        seen.add(filepath)
        conflictFiles.push(filepath as string)
      }
    }
  }

  // Additional check: scan for conflict markers in modified files
  const additionalConflicts = await detectConflictsFromMarkers(git, repoDir, status, conflictFiles)
  const allConflicts = [
    ...new Set([...fallbackConflictFiles, ...conflictFiles, ...additionalConflicts]),
  ]

  console.log(
    `[performPRDryRunMerge] Status matrix + marker detection: ${allConflicts.length} conflicted files`,
  )
  return allConflicts
}

/**
 * Detect conflicts by scanning for conflict markers in file content
 */
async function detectConflictsFromMarkers(
  git: GitProvider,
  repoDir: string,
  status: any[],
  existingConflicts: string[],
): Promise<string[]> {
  if (existingConflicts.length > 0) {
    return [] // Skip if we already found conflicts through other means
  }

  const fs = (git as any)?.fs
  const readFile = fs?.promises?.readFile ?? fs?.readFile

  if (typeof readFile !== "function") {
    return []
  }

  const modifiedFiles = status
    .filter(([, head, workdir]: any[]) => head === 1 && workdir === 2)
    .map(([filepath]: any[]) => filepath as string)
    .slice(0, CONFLICT_DETECTION_CONSTANTS.MAX_FILES_TO_SCAN)

  const conflictFiles: string[] = []
  const seen = new Set<string>()

  for (const filepath of modifiedFiles) {
    try {
      const fullPath = `${repoDir}/${filepath}`.replace(/\/+/g, "/")
      const data = await readFile(fullPath, "utf8").catch(() => readFile(fullPath))
      const content = typeof data === "string" ? data : ((data as Buffer)?.toString?.("utf8") ?? "")

      const {START, SEPARATOR, END} = CONFLICT_DETECTION_CONSTANTS.CONFLICT_MARKERS
      if (content.includes(START) && content.includes(SEPARATOR) && content.includes(END)) {
        console.log(`[performPRDryRunMerge] Found conflict markers in ${filepath}`)
        if (!seen.has(filepath)) {
          conflictFiles.push(filepath)
          seen.add(filepath)
        }
      }
    } catch {
      // Ignore file read errors
    }
  }

  return conflictFiles
}

/**
 * Parse conflict markers from all conflicted files
 */
async function parseConflictMarkersFromFiles(
  git: GitProvider,
  repoDir: string,
  conflictFiles: string[],
): Promise<ConflictDetail[]> {
  const fs = (git as any)?.fs
  const readFile = fs?.promises?.readFile ?? fs?.readFile

  if (typeof readFile !== "function") {
    console.warn(`[performPRDryRunMerge] File system not available, cannot parse conflict markers`)
    return createEmptyConflictDetails(conflictFiles)
  }

  console.log(
    `[performPRDryRunMerge] File system available, parsing conflict markers from ${conflictFiles.length} files`,
  )
  const conflictDetails: ConflictDetail[] = []

  for (const filepath of conflictFiles) {
    try {
      const markers = await parseConflictMarkersFromPath(readFile, repoDir, filepath)
      console.log(
        `[performPRDryRunMerge] Parsed ${markers.length} conflict markers from ${filepath}`,
      )
      conflictDetails.push({
        file: filepath,
        type: "content" as const,
        conflictMarkers: markers,
      })
    } catch (error) {
      console.warn(
        `[performPRDryRunMerge] Failed to parse conflict markers from ${filepath}:`,
        error,
      )
      conflictDetails.push({
        file: filepath,
        type: "content" as const,
        conflictMarkers: [],
      })
    }
  }

  return conflictDetails
}

/**
 * Create empty conflict details for files where markers couldn't be parsed
 */
function createEmptyConflictDetails(conflictFiles: string[]): ConflictDetail[] {
  console.log(
    `[performPRDryRunMerge] Creating empty conflict details for ${conflictFiles.length} files (no markers parsed)`,
  )
  return conflictFiles.map(f => ({
    file: f,
    type: "content" as const,
    conflictMarkers: [] as ConflictMarker[],
  }))
}

/**
 * Handle merge conflicts through multiple detection strategies
 */
async function handleMergeConflicts(
  err: any,
  git: GitProvider,
  repoDir: string,
  targetBranch: string,
  tempBranch: string,
  prTipRef: string,
  tipOid: string,
): Promise<{conflictFiles: string[]; conflictDetails: ConflictDetail[]}> {
  let conflictFiles: string[] = []

  try {
    // Strategy 1: Try to get conflicts from error data
    conflictFiles = await detectConflictsFromError(err)

    // Strategy 2: Fallback to status matrix analysis if no conflicts found in error
    if (conflictFiles.length === 0) {
      conflictFiles = await detectConflictsFromStatusMatrix(
        git,
        repoDir,
        targetBranch,
        tempBranch,
        prTipRef,
        tipOid,
      )
    }
  } catch (detectionError) {
    console.error("[performPRDryRunMerge] All conflict detection methods failed:", detectionError)
    throw new Error(
      `Unable to determine merge conflicts: ${getErrorMessage(err)}; fallback detection failed: ${getErrorMessage(detectionError)}`,
    )
  }

  // Early return for clean merges
  if (conflictFiles.length === 0) {
    return {conflictFiles: [], conflictDetails: []}
  }

  // Parse conflict markers from conflicted files
  console.log(
    `[performPRDryRunMerge] Processing ${conflictFiles.length} conflict files for marker parsing`,
  )
  let conflictDetails = await parseConflictMarkersFromFiles(git, repoDir, conflictFiles)

  // Ensure we have conflict details for all files
  if (conflictDetails.length === 0 && conflictFiles.length > 0) {
    conflictDetails = createEmptyConflictDetails(conflictFiles)
  }

  const totalMarkers = conflictDetails.reduce((sum, d) => sum + d.conflictMarkers.length, 0)
  console.log(
    `[performPRDryRunMerge] Final conflict processing: ${conflictFiles.length} files, ${conflictDetails.length} details, ${totalMarkers} total markers`,
  )

  return {conflictFiles, conflictDetails}
}

/**
 * Perform a dry-run merge of PR tip into target branch to detect conflicts.
 *
 * Strategy: Create temp branch from target, write PR tip to a ref, then run
 * git.merge(ours=tempBranch, theirs=prTipRef). If merge succeeds -> no conflicts.
 * If it throws -> read statusMatrix for conflicted files and return them.
 *
 * Cleanup: Always restore original branch and remove temp branch/ref.
 */
async function performPRDryRunMerge(
  git: GitProvider,
  repoDir: string,
  prTipSource: string,
  targetBranch: string,
): Promise<{
  hasConflicts: boolean
  conflictFiles: string[]
  conflictDetails: ConflictDetail[]
}> {
  const tempBranch = `pr-merge-temp-${Date.now()}`
  const prTipRef = `refs/pr-tip-analysis-${Date.now()}` // Use unique name for analysis
  let tipOid: string = prTipSource // Declare outside try-catch for fallback access

  try {
    // Ensure we're working with the latest state - checkout target branch first
    await git.checkout({dir: repoDir, ref: targetBranch})

    // Get the current target branch HEAD to ensure we're using the latest commit
    const targetOid = await git.resolveRef({dir: repoDir, ref: `refs/heads/${targetBranch}`})

    // Create temp branch from the current target HEAD (not the ref, to avoid stale references)
    await git.branch({dir: repoDir, ref: tempBranch, start: targetOid, checkout: true})

    // Resolve PR tip ref consistently - handle both OID and ref cases
    if (prTipSource.startsWith("refs/")) {
      tipOid = await git.resolveRef({dir: repoDir, ref: prTipSource})
    } else if (prTipSource.length === 40 && /^[a-f0-9]{40}$/i.test(prTipSource)) {
      // Already an OID
      tipOid = prTipSource
    } else {
      // Try to resolve as a ref first, fallback to treating as OID
      try {
        tipOid = await git.resolveRef({dir: repoDir, ref: prTipSource})
      } catch {
        tipOid = prTipSource
      }
    }

    await git.writeRef({dir: repoDir, ref: prTipRef, value: tipOid, force: true})

    // Log the commit IDs being merged for debugging
    console.log(
      `[performPRDryRunMerge] Merging: target=${targetOid.substring(0, 8)} (${targetBranch}) + PR=${tipOid.substring(0, 8)}`,
    )

    // Attempt merge: ours=target (temp), theirs=PR tip
    // Use same merge parameters as actual merge for consistency
    await git.merge({
      dir: repoDir,
      ours: tempBranch,
      theirs: prTipRef,
      fastForward: false, // Analysis always tests non-FF merge to detect conflicts
      abortOnConflict: true,
      message: `Analysis merge test (${tipOid.substring(0, 8)})`,
      author: {name: "Repository Maintainer", email: "maintainer@nostr-git.local"},
    } as any)

    console.log(
      `[performPRDryRunMerge] Merge succeeded with abortOnConflict=true - no conflicts detected`,
    )
    return {hasConflicts: false, conflictFiles: [], conflictDetails: []}
  } catch (err: any) {
    if (!isLikelyMergeConflictError(err)) {
      throw err
    }

    const conflictResult = await handleMergeConflicts(
      err,
      git,
      repoDir,
      targetBranch,
      tempBranch,
      prTipRef,
      tipOid,
    )

    return {
      hasConflicts: conflictResult.conflictFiles.length > 0,
      ...conflictResult,
    }
  } finally {
    // Restore repo state regardless of merge outcome
    try {
      await git.checkout({dir: repoDir, ref: targetBranch})
      await git.deleteBranch({dir: repoDir, ref: tempBranch})
      await git.deleteRef({dir: repoDir, ref: prTipRef})
    } catch (cleanupErr) {
      console.warn("[performPRDryRunMerge] Cleanup failed (checkout/branch/ref):", cleanupErr)
    }
  }
}

/**
 * Preview data for creating a PR: commits and files changed between source and target branches.
 * Used by the Create PR modal to display commits and changes before creating the PR.
 */
export interface PRPreviewData {
  success: boolean
  error?: string
  mergeBase?: string
  tipCommit?: string
  commits: Array<{oid: string; message: string; author?: {name?: string; email?: string}}>
  commitOids: string[]
  filesChanged: string[]
}

/**
 * Options for cross-repo (fork) PR preview.
 * When sourceRemote is set, the source branch is resolved from that remote (e.g. refs/remotes/source/main).
 * When preferRemoteRefs is true, try refs/remotes/origin/* before refs/heads/* (avoids stale local refs after push).
 */
export interface GetPRPreviewOptions {
  sourceRemote?: string
  preferRemoteRefs?: boolean
}

/**
 * Get PR preview data: commits and files changed between source branch and target branch.
 * Both branches must exist in the repo (local or remote). Use after smartInitializeRepo.
 * For fork PRs, pass sourceRemote so source branch is resolved from refs/remotes/{sourceRemote}/{sourceBranch}.
 */
export async function getPRPreviewData(
  git: GitProvider,
  repoDir: string,
  sourceBranch: string,
  targetBranch: string,
  opts?: GetPRPreviewOptions,
): Promise<PRPreviewData> {
  const empty: PRPreviewData = {success: false, commits: [], commitOids: [], filesChanged: []}
  const {sourceRemote, preferRemoteRefs} = opts ?? {}

  const resolveBranchRef = async (branch: string, forSource: boolean): Promise<string | null> => {
    const refs =
      forSource && sourceRemote
        ? [`refs/remotes/${sourceRemote}/${branch}`, `${sourceRemote}/${branch}`]
        : preferRemoteRefs
          ? [`refs/remotes/origin/${branch}`, `origin/${branch}`, `refs/heads/${branch}`, branch]
          : [`refs/heads/${branch}`, branch, `refs/remotes/origin/${branch}`, `origin/${branch}`]
    for (const ref of refs) {
      try {
        const oid = await git.resolveRef({dir: repoDir, ref})
        if (oid && oid.length === 40) return oid
      } catch {
        continue
      }
    }
    return null
  }

  try {
    const sourceOid = await resolveBranchRef(sourceBranch, true)
    const targetOid = await resolveBranchRef(targetBranch, false)

    if (!sourceOid) {
      if (sourceRemote) {
        return {
          ...empty,
          error: `Source branch "${sourceBranch}" not found on fork remote. Refresh fork refs and try again.`,
        }
      }
      return {...empty, error: `Source branch "${sourceBranch}" not found`}
    }
    if (!targetOid) {
      return {...empty, error: `Target branch "${targetBranch}" not found`}
    }
    if (sourceOid === targetOid) {
      return {
        ...empty,
        error: "No commits to merge. The source branch is up to date with the target.",
      }
    }

    const mergeBase = await findMergeBase(git, repoDir, sourceOid, targetOid)
    const stopAt = mergeBase ?? targetOid

    const commits = await getPRCommitsOnly(git, repoDir, sourceOid, stopAt, 100)
    const commitOids = commits.map(c => c.oid)
    const tipCommit = commitOids[0] ?? sourceOid

    const filesChanged =
      stopAt && tipCommit ? await getChangedFilesBetween(git, repoDir, stopAt, tipCommit) : []

    return {
      success: true,
      mergeBase: mergeBase ?? undefined,
      tipCommit,
      commits,
      commitOids,
      filesChanged,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {...empty, error: `Failed to get PR preview: ${msg}`}
  }
}

/**
 * Result of finding commits ahead of a tip OID in a source remote.
 */
export interface CommitsAheadOfTipResult {
  success: boolean
  error?: string
  commits: Array<{oid: string; message: string; author?: {name?: string; email?: string}}>
  commitOids: string[]
}

/**
 * Options for getCommitsAheadOfTipData. When sourceRemote is set, branches are resolved from that remote.
 */
export interface GetCommitsAheadOfTipOptions {
  sourceRemote?: string
}

/**
 * Find commits that are ahead of a tip OID in the source remote.
 * Fetches from source, lists branches containing the tip, returns commits on top.
 * No target branch or merge base - purely source-oriented.
 * Use after fetching from source (refs/heads/*).
 */
export async function getCommitsAheadOfTipData(
  git: GitProvider,
  repoDir: string,
  tipOid: string,
  opts?: GetCommitsAheadOfTipOptions,
): Promise<CommitsAheadOfTipResult> {
  const empty: CommitsAheadOfTipResult = {success: false, commits: [], commitOids: []}
  const {sourceRemote} = opts ?? {}

  const remoteName = sourceRemote || "origin"
  let branches: string[]
  try {
    branches = await git.listBranches({dir: repoDir, remote: remoteName})
  } catch (err) {
    return {
      ...empty,
      error: `Failed to list branches from ${remoteName}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const candidates: {branch: string; oid: string; commitCount: number}[] = []

  for (const branch of branches) {
    const ref = sourceRemote
      ? `refs/remotes/${sourceRemote}/${branch}`
      : `refs/remotes/origin/${branch}`
    let branchOid: string
    try {
      branchOid = await git.resolveRef({dir: repoDir, ref})
      if (!branchOid || branchOid.length !== 40) continue
    } catch {
      continue
    }

    if (branchOid === tipOid) continue

    let branchContainsTip = false
    try {
      branchContainsTip = await git.isDescendent({
        dir: repoDir,
        oid: branchOid,
        ancestor: tipOid,
      })
    } catch {
      continue
    }

    if (!branchContainsTip) continue

    const commits = await getPRCommitsOnly(git, repoDir, branchOid, tipOid, 100)
    candidates.push({branch, oid: branchOid, commitCount: commits.length})
  }

  if (candidates.length === 0) {
    return {
      ...empty,
      error:
        "No remote branch found that contains the PR tip. Push your commits and try again, or enter the source branch manually.",
    }
  }

  const best = candidates.reduce((a, b) => (a.commitCount >= b.commitCount ? a : b))

  if (best.commitCount === 0) {
    return {
      ...empty,
      error: "No new commits on top of the PR tip. The branch is up to date.",
    }
  }

  const commits = await getPRCommitsOnly(git, repoDir, best.oid, tipOid, 100)
  const commitOids = commits.map(c => c.oid)

  return {
    success: true,
    commits,
    commitOids,
  }
}

/**
 * Find the merge base between a head commit and the target branch.
 * Ensures the repo has the target branch, then computes merge base.
 */
export async function getMergeBaseBetween(
  git: GitProvider,
  repoDir: string,
  headOid: string,
  targetBranch: string,
  opts?: {sourceRemote?: string},
): Promise<{mergeBase?: string; error?: string}> {
  const targetRefs = [
    `refs/heads/${targetBranch}`,
    targetBranch,
    `refs/remotes/origin/${targetBranch}`,
    `origin/${targetBranch}`,
  ]
  if (opts?.sourceRemote) {
    targetRefs.unshift(
      `refs/remotes/${opts.sourceRemote}/${targetBranch}`,
      `${opts.sourceRemote}/${targetBranch}`,
    )
  }

  let targetOid: string | null = null
  for (const ref of targetRefs) {
    try {
      const oid = await git.resolveRef({dir: repoDir, ref})
      if (oid && oid.length === 40) {
        targetOid = oid
        break
      }
    } catch {
      continue
    }
  }

  if (!targetOid) {
    return {error: `Target branch "${targetBranch}" not found`}
  }

  try {
    const mergeBase = await findMergeBase(git, repoDir, headOid, targetOid)
    return {mergeBase: mergeBase ?? undefined}
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Get a human-readable status message for the merge analysis
 */
export function getMergeStatusMessage(result: MergeAnalysisResult): string {
  switch (result.analysis) {
    case "clean":
      return result.fastForward
        ? "This patch can be fast-forward merged without conflicts."
        : "This patch can be merged cleanly without conflicts."
    case "conflicts":
      return `This patch has merge conflicts in ${result.conflictFiles.length} file(s) that need to be resolved.`
    case "up-to-date":
      return "This patch has already been applied to the target branch."
    case "diverged":
      return "The target branch has diverged. Manual intervention may be required."
    case "error":
      return `Unable to analyze merge: ${result.errorMessage || "Unknown error"}`
    default:
      return "Merge analysis pending..."
  }
}
