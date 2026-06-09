import type {GitProvider} from "../../git/provider.js"
import type {GitMergeResult} from "../../git/provider.js"
import type {PRMergeAnalysisResult} from "../../git/merge-analysis.js"
import {analyzePRMergeability} from "../../git/merge-analysis.js"
import {fetchPrSourceTip} from "../../git/pr-source-fetch.js"
import {withUrlFallback, filterValidCloneUrls} from "../../utils/clone-url-fallback.js"
import {isGraspRepoHttpUrl} from "../../utils/grasp-url.js"

export interface AnalyzePRMergeOptions {
  repoId: string
  prCloneUrls: string[]
  /** Clone URLs from repo (base) - for fetching target branch */
  targetCloneUrls?: string[]
  tipCommitOid: string
  targetBranch?: string
}

export interface MergePRAndPushOptions {
  repoId: string
  cloneUrls: string[]
  /** Clone URLs from repo (base) - for fetching target branch before merge */
  targetCloneUrls?: string[]
  tipCommitOid: string
  targetBranch?: string
  mergeCommitMessage?: string
  fastForward?: boolean
  onProgress?: (step: string, progress: number) => void
  /** Current user's pubkey (hex or npub) - required for GRASP push, not from token store (matches useNewRepo) */
  userPubkey?: string
  /** Pre-created NIP-98 auth headers for GRASP (keyed by URL). Created on main thread before RPC. */
  authHeaders?: Record<string, string>
  /**
   * When true, perform the merge but skip the push phase. Returns the merge commit OID so the
   * caller (main thread) can publish the Nostr state event with the new SHA before pushing.
   * GRASP requires a signed state event (kind 30618) pointing to the new commit to be on the
   * relay before it accepts a git push.
   */
  skipPush?: boolean
}

export interface MergePRAndPushResult {
  success: boolean
  error?: string
  mergeCommitOid?: string
  pushedRemotes?: string[]
  skippedRemotes?: string[]
  warning?: string
  pushErrors?: Array<{remote: string; url: string; error: string; code: string; stack: string}>
}

/** Push to remote via worker's pushToRemote - for GRASP (direct push with authHeaders) */
export type PushToRemoteFn = (opts: {
  repoId: string
  remoteUrl: string
  branch: string
  token?: string
  provider?: string
  authHeaders?: Record<string, string>
}) => Promise<{success?: boolean; error?: string}>

/** Safe push with preflight checks - for GitHub/GitLab/etc (mirrors useNewRepo) */
export type SafePushToRemoteFn = (opts: {
  repoId: string
  remoteUrl: string
  branch: string
  token?: string
  provider?: string
  preflight?: {
    blockIfUncommitted?: boolean
    requireUpToDate?: boolean
    blockIfShallow?: boolean
  }
}) => Promise<{
  success?: boolean
  error?: string
  requiresConfirmation?: boolean
  warning?: string
  reason?: string
}>

/** Infer provider from remote URL (github.com, gitlab.com, relay.ngit.dev, etc.) */
export function inferProviderFromUrl(url: string): string | undefined {
  try {
    if (isGraspRepoHttpUrl(url)) return "grasp"
    const host = new URL(url).hostname.toLowerCase()
    if (host === "github.com" || host.endsWith(".github.com")) return "github"
    if (host === "gitlab.com" || host.endsWith(".gitlab.com") || host.includes("gitlab."))
      return "gitlab"
    return undefined
  } catch {
    return undefined
  }
}

export async function mergePRAndPushUtil(
  git: GitProvider,
  opts: MergePRAndPushOptions,
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
    ensureFullClone: (args: {
      repoId: string
      branch?: string
      depth?: number
      cloneUrls?: string[]
    }) => Promise<any>
    getAuthCallback: (url: string) => any
    getConfiguredAuthHosts?: () => string[]
    /** Direct push (for GRASP with authHeaders) - mirrors useNewRepo */
    pushToRemote: PushToRemoteFn
    /** Safe push with preflight (for GitHub/GitLab/etc) - mirrors useNewRepo */
    safePushToRemote: SafePushToRemoteFn
    /** Get tokens for remote URL (for multi-token retry) */
    getTokensForRemote: (url: string) => Promise<Array<{token: string}>>
  },
): Promise<MergePRAndPushResult> {
  const {
    repoId,
    cloneUrls,
    targetCloneUrls,
    tipCommitOid,
    targetBranch,
    mergeCommitMessage,
    fastForward = true,
    onProgress = () => {},
    userPubkey,
    skipPush = false,
  } = opts

  const {
    rootDir,
    parseRepoId,
    resolveBranchName,
    ensureFullClone,
    getAuthCallback,
    pushToRemote,
    safePushToRemote,
    getTokensForRemote,
  } = deps
  let usedTempRef = false
  let prTipRef: string | null = null
  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`

  try {
    onProgress("Resolving target branch...", 5)
    const effectiveTargetBranch = await resolveBranchName(dir, targetBranch || "main")
    const validTargetCloneUrls = filterValidCloneUrls(targetCloneUrls || [])

    onProgress("Ensuring repository is ready...", 10)
    await ensureFullClone({
      repoId,
      branch: effectiveTargetBranch,
      ...(validTargetCloneUrls.length > 0 ? {cloneUrls: validTargetCloneUrls} : {}),
    })

    const validUrls = filterValidCloneUrls(cloneUrls)
    if (validUrls.length === 0) {
      return {
        success: false,
        error: "No valid clone URLs in PR",
      }
    }

    const fetchResult = await withUrlFallback(
      validUrls,
      async (url: string) => {
        const prRemote = `pr-source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
        try {
          await git.addRemote({dir, remote: prRemote, url})
          onProgress("Fetching PR tip...", 20)
          const onAuth = getAuthCallback(url)

          const sourceFetch = await fetchPrSourceTip(git, {
            dir,
            remote: prRemote,
            url,
            tipCommitOid,
            depth: 100,
            ...(onAuth ? {onAuth} : {}),
          })

          console.log(`[mergePRAndPush] PR source ready via ${sourceFetch.strategy} from ${url}`)

          return {tipOid: sourceFetch.tipOid}
        } finally {
          try {
            await git.deleteRemote({dir, remote: prRemote})
          } catch {
            /* ignore */
          }
        }
      },
      {perUrlTimeoutMs: 20000},
    )

    if (!fetchResult.success || !fetchResult.result) {
      const errMsg = fetchResult.attempts?.length
        ? fetchResult.attempts.map(a => `${a.url}: ${a.error || "failed"}`).join("; ")
        : "Failed to fetch PR from any clone URL"
      return {success: false, error: errMsg}
    }

    const {tipOid} = fetchResult.result
    usedTempRef = true
    prTipRef = `refs/pr-tip-merge-${Date.now()}`
    await git.writeRef({dir, ref: prTipRef, value: tipOid, force: true})
    console.log(`[mergePRAndPush] Created temp ref ${prTipRef} -> ${tipOid.substring(0, 8)}`)

    onProgress("Checking out target branch...", 40)
    await git.checkout({dir, ref: effectiveTargetBranch})

    const preMergeTargetOid = await git.resolveRef({dir, ref: effectiveTargetBranch})

    // Log merge state for debugging
    const prTipOid = usedTempRef ? tipOid : await git.resolveRef({dir, ref: prTipRef!})
    console.log(
      `[mergePRAndPush] About to merge: target=${preMergeTargetOid.substring(0, 8)} (${effectiveTargetBranch}) + PR=${prTipOid.substring(0, 8)} (${prTipRef})`,
    )

    onProgress("Merging PR...", 50)

    // Validate that our references are still valid before attempting merge
    try {
      // Ensure target branch ref exists
      await git.resolveRef({dir, ref: `refs/heads/${effectiveTargetBranch}`})

      // Ensure PR tip ref exists (either fetched or temp)
      if (usedTempRef && prTipRef) {
        const currentTipOid = await git.resolveRef({dir, ref: prTipRef})
        if (currentTipOid !== tipOid) {
          console.warn(
            `[mergePRAndPush] Temp ref ${prTipRef} changed: ${currentTipOid} != ${tipOid}`,
          )
          await git.writeRef({dir, ref: prTipRef, value: tipOid, force: true})
        }
      } else if (prTipRef) {
        // Verify fetched ref still exists
        await git.resolveRef({dir, ref: prTipRef})
      }
    } catch (error) {
      // Critical ref missing, try to recreate temp ref if needed
      if (usedTempRef && prTipRef) {
        console.warn(
          `[mergePRAndPush] Recreating missing temp ref ${prTipRef} -> ${tipOid.substring(0, 8)}`,
        )
        await git.writeRef({dir, ref: prTipRef, value: tipOid, force: true})
      } else {
        return {
          success: false,
          error: `Reference validation failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // If analysis shows clean but we still get conflicts, log detailed state for debugging
    let mergeResult: GitMergeResult
    try {
      mergeResult = (await git.merge({
        dir,
        ours: effectiveTargetBranch,
        theirs: prTipRef,
        fastForward: fastForward === true, // Explicitly require true for fast-forward
        abortOnConflict: true,
        message: mergeCommitMessage || `Merge PR (${tipCommitOid.slice(0, 8)})`,
        author: {name: "Repository Maintainer", email: "maintainer@nostr-git.local"},
      } as any)) as GitMergeResult
    } catch (mergeError: any) {
      // Log detailed state for debugging when merge fails
      console.error("[mergePRAndPush] Merge failed:", {
        targetBranch: effectiveTargetBranch,
        prTipRef,
        tipCommitOid,
        mergeError: mergeError.message,
        conflictFiles: mergeError?.data?.filepaths || [],
      })

      // Extract conflict files from merge error if available
      const conflictFiles = mergeError?.data?.filepaths || []
      if (conflictFiles.length > 0) {
        const conflictList = conflictFiles.slice(0, 5).join(", ")
        const moreFiles = conflictFiles.length > 5 ? `... and ${conflictFiles.length - 5} more` : ""
        return {
          success: false,
          error: `Merge conflicts in: ${conflictList}${moreFiles}. Analysis showed clean but actual merge failed.`,
        }
      }

      return {
        success: false,
        error: `Merge failed: ${mergeError.message || "Unknown merge error"}`,
      }
    }

    const mergeCommitOid = mergeResult?.oid
    if (!mergeCommitOid) {
      return {
        success: false,
        error: "Merge completed but no commit OID returned",
      }
    }

    // isomorphic-git.merge updates refs/objects but does not materialize the new
    // tree into the workdir. Keep the worker clone clean before deferred pushes.
    await git.checkout({dir, ref: effectiveTargetBranch, force: true})

    // Merge-only mode: return the new commit SHA so the caller can publish the
    // Nostr state event (kind 30618) before doing the push. GRASP requires this.
    if (skipPush) {
      onProgress("Merge complete (push deferred)", 60)
      return {
        success: true,
        mergeCommitOid,
        pushedRemotes: [],
        skippedRemotes: [],
        warning: "Push deferred — caller must publish state event then push separately",
      }
    }

    onProgress("Pushing to remotes...", 70)

    const remotes = await git.listRemotes({dir})
    const pushedRemotes: string[] = []
    const skippedRemotes: string[] = []
    const pushErrors: Array<{
      remote: string
      url: string
      error: string
      code: string
      stack: string
    }> = []

    if (remotes.length === 0) {
      return {
        success: true,
        mergeCommitOid,
        pushedRemotes: [],
        skippedRemotes: [],
        warning: "No remotes configured - changes only applied locally",
      }
    }

    for (const remote of remotes) {
      try {
        if (!remote.url) {
          pushErrors.push({
            remote: remote.remote,
            url: "N/A",
            error: `Remote ${remote.remote} has no URL configured`,
            code: "NO_URL",
            stack: "",
          })
          skippedRemotes.push(remote.remote)
          continue
        }

        const provider = inferProviderFromUrl(remote.url)
        const pushUrl = remote.url

        // GRASP: direct push with NIP-98 auth headers (mirrors useNewRepo)
        if (provider === "grasp") {
          if (!userPubkey) {
            throw new Error("GRASP push requires userPubkey (current user's pubkey)")
          }

          // Use pre-created auth headers (from main thread) for GRASP NIP-98
          // Git push requires auth headers for TWO URLs: info/refs and git-receive-pack
          const authHeaders = opts.authHeaders

          const pushRes = await pushToRemote({
            repoId,
            remoteUrl: pushUrl,
            branch: effectiveTargetBranch,
            token: userPubkey,
            provider,
            authHeaders: authHeaders ?? undefined,
          })
          if (!pushRes?.success) {
            throw new Error(pushRes?.error || "Push to GRASP remote failed")
          }
          pushedRemotes.push(remote.remote)
          continue
        }

        // Non-GRASP: use safePushToRemote with preflight (mirrors useNewRepo)
        const tokens = await getTokensForRemote(remote.url)
        if (tokens.length === 0) {
          throw new Error(`No authentication token found for ${provider || "remote"} push`)
        }

        let lastError: Error | null = null
        for (const {token} of tokens) {
          try {
            const result = await safePushToRemote({
              repoId,
              remoteUrl: pushUrl,
              branch: effectiveTargetBranch,
              token: token || undefined,
              provider: provider as any,
              preflight: {
                blockIfUncommitted: false,
                requireUpToDate: true,
                blockIfShallow: false,
              },
            })
            if (result?.success) {
              pushedRemotes.push(remote.remote)
              lastError = null
              break
            }
            if (result?.requiresConfirmation) {
              throw new Error(result.warning || "Force push requires confirmation.")
            }
            if (result?.reason === "workflow_scope_missing") {
              throw new Error(
                "GitHub rejected this push because the token is missing Workflow permission for .github/workflows files. Update the GitHub token permissions and retry.",
              )
            }
            lastError = new Error(result?.error || "Safe push failed")
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
          }
        }
        if (lastError) throw lastError
      } catch (pushError: any) {
        const rawMsg =
          pushError instanceof Error ? pushError.message || "" : String(pushError || "")
        const code = (pushError?.code || pushError?.name || "UNKNOWN") as string
        pushErrors.push({
          remote: remote.remote,
          url: remote.url || "N/A",
          error: rawMsg,
          code,
          stack: pushError?.stack || "",
        })
        skippedRemotes.push(remote.remote)
      }
    }

    onProgress("Merge complete", 100)

    // If all pushes failed: reset local state to pre-merge and return failure
    if (remotes.length > 0 && pushedRemotes.length === 0) {
      try {
        await git.writeRef({
          dir,
          ref: `refs/heads/${effectiveTargetBranch}`,
          value: preMergeTargetOid,
          force: true,
        })
        await git.checkout({dir, ref: effectiveTargetBranch, force: true})
      } catch (resetErr) {
        console.warn("[mergePRAndPush] Failed to reset local state after push failure:", resetErr)
      }
      const firstError = pushErrors[0]
      const errorMsg = firstError
        ? `Push to ${firstError.remote} failed: ${firstError.error}`
        : "Push to all remotes failed"
      return {
        success: false,
        error: errorMsg,
        pushedRemotes,
        skippedRemotes,
        pushErrors: pushErrors.length ? pushErrors : undefined,
      }
    }

    return {
      success: true,
      mergeCommitOid,
      pushedRemotes,
      skippedRemotes,
      pushErrors: pushErrors.length ? pushErrors : undefined,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error),
    }
  } finally {
    if (usedTempRef && prTipRef) {
      try {
        await git.deleteRef({dir, ref: prTipRef})
      } catch {
        /* ignore */
      }
    }
  }
}

export async function analyzePRMergeUtil(
  git: GitProvider,
  opts: AnalyzePRMergeOptions,
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
    getAuthCallback?: (url: string) => any
    corsProxy?: string | null
  },
): Promise<PRMergeAnalysisResult> {
  const {repoId, prCloneUrls, targetCloneUrls, tipCommitOid, targetBranch} = opts
  const {rootDir, parseRepoId, resolveBranchName} = deps

  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`

  // Pass target branch directly; analyzePRMergeability will fetch it if not present
  const effectiveTargetBranch = targetBranch || "main"

  const result = await analyzePRMergeability(git, dir, {
    cloneUrls: prCloneUrls,
    targetCloneUrls,
    tipCommitOid,
    targetBranch: effectiveTargetBranch,
    strictTargetFresh: true,
    getAuthCallback: deps.getAuthCallback,
    corsProxy: deps.corsProxy,
  })

  return result
}
