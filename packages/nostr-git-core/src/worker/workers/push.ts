import type {GitProvider} from "../../git/provider.js"
import type {RepoCache, RepoCacheManager} from "./cache.js"
import {resolveBranchToOid} from "../../git/git.js"
import type {GitVendor} from "../../git/vendor-providers.js"
import type {BlossomPushSummary} from "../../blossom/index.js"
import {normalizeGraspServiceRelayUrl, parseGraspRepoHttpUrl} from "../../utils/grasp-url.js"
import {toHexPubkey} from "../../utils/nostr-pubkey.js"
import {sanitizeRelays} from "../../utils/sanitize-relays.js"

export interface SafePushOptions {
  repoId: string
  remoteUrl: string
  branch?: string
  token?: string
  provider?: GitVendor
  repoRelays?: string[]
  allowForce?: boolean
  confirmDestructive?: boolean
  preflight?: {
    blockIfUncommitted?: boolean
    requireUpToDate?: boolean
    blockIfShallow?: boolean
  }
}

export function validateExplicitGraspPush(options: {
  remoteUrl: string
  token?: string
  repoRelays?: string[]
}): {pushUrl: string; repoRelays: string[]; targetRelay: string} {
  const pushUrl = String(options.remoteUrl || "").trim()
  const parsed = parseGraspRepoHttpUrl(pushUrl)
  if (!parsed) {
    throw new Error("GRASP provider requires a strict GRASP repository HTTP URL")
  }

  const url = new URL(pushUrl)
  if (url.username || url.password) {
    throw new Error("GRASP repository URL must not contain credentials")
  }
  const canonicalPushUrl = `${parsed.httpBase}/${parsed.ownerNpub}/${encodeURIComponent(parsed.identifier)}.git`
  if (url.toString() !== new URL(canonicalPushUrl).toString()) {
    throw new Error("GRASP repository URL must use its canonical service path")
  }

  const relayInputs = (options.repoRelays || []).map(relay => String(relay || "").trim())
  const repoRelays: string[] = []
  for (const relay of relayInputs) {
    let parsedRelay: URL
    try {
      parsedRelay = new URL(relay)
    } catch {
      throw new Error("GRASP repository relay scope must contain literal WS/WSS URLs")
    }
    if (
      (parsedRelay.protocol !== "ws:" && parsedRelay.protocol !== "wss:") ||
      parsedRelay.username ||
      parsedRelay.password ||
      parsedRelay.search ||
      parsedRelay.hash
    ) {
      throw new Error("GRASP repository relay scope must contain literal WS/WSS URLs")
    }
    const normalized = sanitizeRelays([relay])[0]
    if (!normalized) {
      throw new Error("GRASP repository relay scope contains an invalid relay URL")
    }
    if (!repoRelays.includes(normalized)) repoRelays.push(normalized)
  }
  if (repoRelays.length === 0) {
    throw new Error("GRASP provider requires at least one explicit repository relay")
  }

  const targetRelay = normalizeGraspServiceRelayUrl(parsed.httpBase)
  if (!targetRelay.startsWith("wss://")) {
    throw new Error(
      "GRASP provider requires an HTTPS repository URL with a corresponding WSS relay",
    )
  }
  if (!repoRelays.includes(targetRelay)) {
    throw new Error(`GRASP target relay ${targetRelay} is not in the repository relay scope`)
  }

  let tokenPubkey: string
  try {
    tokenPubkey = toHexPubkey(String(options.token || "").trim())
  } catch {
    throw new Error("GRASP provider requires a valid pubkey token")
  }
  if (tokenPubkey !== toHexPubkey(parsed.ownerNpub)) {
    throw new Error("GRASP pubkey token must match the repository owner")
  }

  return {pushUrl: canonicalPushUrl, repoRelays, targetRelay}
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
      repoRelays?: string[]
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
    repoRelays,
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
  const pf = {
    blockIfUncommitted: true,
    requireUpToDate: true,
    blockIfShallow: false,
    ...(preflight || {}),
  }

  try {
    const validatedGrasp =
      provider === "grasp" ? validateExplicitGraspPush({remoteUrl, token, repoRelays}) : null
    const key = parseRepoId(repoId)
    const dir = `${rootDir}/${key}`

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
      ...(validatedGrasp
        ? {repoRelays: validatedGrasp.repoRelays}
        : repoRelays
          ? {repoRelays}
          : {}),
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
