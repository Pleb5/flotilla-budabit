import type {GitProvider} from "../../git/provider.js"
import type {RepoCache, RepoCacheManager} from "./cache.js"
import {resolveBranchToOid} from "../../git/git.js"
import type {GitVendor} from "../../git/vendor-providers.js"
import type {BlossomPushSummary} from "../../blossom/index.js"

export interface SafePushOptions {
  repoId: string
  remoteUrl: string
  branch?: string
  token?: string
  provider?: GitVendor
  allowForce?: boolean
  confirmDestructive?: boolean
  preflight?: {
    blockIfUncommitted?: boolean
    requireUpToDate?: boolean
    blockIfShallow?: boolean
  }
}

export async function safePushToRemoteUtil(
  git: GitProvider,
  cacheManager: RepoCacheManager,
  options: SafePushOptions,
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    isRepoCloned: (dir: string) => Promise<boolean>
    isShallowClone: (key: string) => Promise<boolean>
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
    hasUncommittedChanges: (dir: string) => Promise<boolean>
    needsUpdate: (
      repoId: string,
      cloneUrls: string[],
      cache: RepoCache | null,
      branch?: string,
      localBranchCommit?: string,
      repoDir?: string,
    ) => Promise<boolean>
    pushToRemote: (args: {
      repoId: string
      remoteUrl: string
      branch?: string
      token?: string
      provider?: GitVendor
    }) => Promise<{success?: boolean; blossomSummary?: BlossomPushSummary}>
  },
): Promise<{
  success: boolean
  pushed?: boolean
  requiresConfirmation?: boolean
  reason?: string
  warning?: string
  error?: string
  blossomSummary?: BlossomPushSummary
}> {
  const {
    repoId,
    remoteUrl,
    branch,
    token,
    provider,
    allowForce = false,
    confirmDestructive = false,
    preflight,
  } = options
  const {
    rootDir,
    parseRepoId,
    isRepoCloned,
    isShallowClone,
    resolveBranchName,
    hasUncommittedChanges,
    needsUpdate,
    pushToRemote,
  } = deps
  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`

  const pf = {
    blockIfUncommitted: true,
    requireUpToDate: true,
    blockIfShallow: false,
    ...(preflight || {}),
  }

  try {
    const cloned = await isRepoCloned(dir)
    if (!cloned)
      return {success: false, error: "Repository not cloned locally; clone before pushing."}

    const targetBranch = await resolveBranchName(dir, branch)

    if (pf.blockIfUncommitted) {
      const dirty = await hasUncommittedChanges(dir)
      if (dirty)
        return {
          success: false,
          reason: "uncommitted_changes",
          error: "Working tree has uncommitted changes. Commit or stash before push.",
        }
    }

    if (pf.blockIfShallow) {
      const shallow = await isShallowClone(key)
      if (shallow)
        return {
          success: false,
          reason: "shallow_clone",
          error: "Repository is a shallow/refs-only clone. Upgrade to full clone before pushing.",
        }
    }

    if (pf.requireUpToDate) {
      const cache = await cacheManager.getRepoCache(key)
      if (provider !== "grasp") {
        const localBranchCommit = await git
          .resolveRef({dir, ref: `refs/heads/${targetBranch}`})
          .catch(() => undefined)
        const remoteChanged = await needsUpdate(
          key,
          [remoteUrl],
          cache,
          targetBranch,
          localBranchCommit,
          dir,
        )
        if (remoteChanged)
          return {
            success: false,
            reason: "remote_ahead",
            error:
              "Push was blocked during preflight because the selected remote branch changed. Refresh the selected remote and retry.",
          }
      }
    }

    if (allowForce && !confirmDestructive) {
      return {
        success: false,
        requiresConfirmation: true,
        reason: "force_push_requires_confirmation",
        warning: "Force push is potentially destructive. Confirmation required.",
      }
    }

    const pushRes = await pushToRemote({
      repoId,
      remoteUrl,
      branch: targetBranch,
      token,
      provider,
    })
    const ok = (pushRes as any)?.success
    if (ok === undefined) {
      return {success: false, error: "Push operation returned invalid response (no success field)"}
    }
    if (ok === false) {
      const errorMessage = (pushRes as any)?.error || "Push failed"
      const hasWorkflowScopeIssue =
        /workflow_scope_missing|workflow token scope|workflow permission|refusing to allow.*workflow|without.*workflow.*scope|lacks.*workflow.*scope|missing.*workflow.*scope/i.test(
          errorMessage,
        )
      const reason =
        (pushRes as any)?.reason ||
        (pushRes as any)?.code ||
        (hasWorkflowScopeIssue ? "workflow_scope_missing" : "push_failed")
      return {success: false, error: errorMessage, reason}
    }
    const result: {
      success: boolean
      pushed?: boolean
      blossomSummary?: BlossomPushSummary
    } = {success: !!ok, pushed: ok}
    if ((pushRes as any)?.blossomSummary) {
      result.blossomSummary = (pushRes as any).blossomSummary
    }
    return result
  } catch (error: any) {
    return {success: false, error: error?.message || String(error)}
  }
}
