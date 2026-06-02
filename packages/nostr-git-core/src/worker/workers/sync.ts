import type {GitProvider} from "../../git/provider.js"
import type {RepoCache, RepoCacheManager} from "./cache.js"
import {resolveBranchToOid} from "../../git/git.js"
import {listAdvertisedServerRefs} from "../../utils/advertised-refs.js"
import {
  withUrlFallback,
  filterValidCloneUrls,
  reorderUrlsByPreference,
} from "../../utils/clone-url-fallback.js"

export async function needsUpdateUtil(
  git: GitProvider,
  repoId: string,
  cloneUrls: string[],
  cache: RepoCache | null,
  now: number = Date.now(),
  onAuth?: (
    url: string,
    auth: {username?: string; password?: string},
  ) => {username: string; password: string} | Promise<{username: string; password: string}> | void,
  branch?: string,
  localBranchCommit?: string,
  repoDir?: string,
): Promise<boolean> {
  const requestedBranch = String(branch || "")
    .trim()
    .replace(/^refs\/heads\//, "")

  const getRequestedRemoteRef = (
    refs: Array<{ref?: string; oid?: string}>,
  ): {ref?: string; oid?: string} | undefined => {
    if (requestedBranch) {
      return refs.find((r: any) => r.ref === `refs/heads/${requestedBranch}`)
    }

    return refs.find((r: any) => r.ref === "refs/heads/main" || r.ref === "refs/heads/master")
  }

  const getCachedCommitForBranch = (): string | undefined => {
    if (!cache) return undefined
    if (!requestedBranch) return cache.headCommit

    return cache.branches?.find(entry => entry.name === requestedBranch)?.commit || cache.headCommit
  }

  // Filter and order URLs by preference
  const validUrls = filterValidCloneUrls(cloneUrls)
  const orderedUrls = reorderUrlsByPreference(validUrls, repoId)

  if (orderedUrls.length === 0) {
    return cache ? now - cache.lastUpdated > 60 * 60 * 1000 : false
  }

  // Debug logging intentionally omitted in util to keep test output clean
  if (!cache) {
    // Try each URL with fallback until one succeeds
    const result = await withUrlFallback(
      orderedUrls,
      async (cloneUrl: string) => {
        const refs = await listAdvertisedServerRefs(git, {
          url: cloneUrl,
          prefix: "refs/heads/",
          symrefs: true,
          onAuth,
        })
        // If there are no branch heads yet, treat as empty remote and allow initial push
        const heads = (refs || []).filter((r: any) => r?.ref?.startsWith("refs/heads/"))
        const remoteBranch = getRequestedRemoteRef(refs || [])
        return {hasHeads: heads && heads.length > 0, branchExists: !!remoteBranch}
      },
      {repoId},
    )

    if (result.success && result.result) {
      if (requestedBranch) {
        return result.result.branchExists
      }

      return result.result.hasHeads
    }

    // All URLs failed (e.g., CORS) - be permissive for initial push
    return false
  }

  const maxCacheAge = 60 * 60 * 1000 // 1 hour
  if (now - cache.lastUpdated > maxCacheAge) return true

  // Try each URL with fallback to check if update is needed
  const result = await withUrlFallback(
    orderedUrls,
    async (cloneUrl: string) => {
      const refs = await listAdvertisedServerRefs(git, {
        url: cloneUrl,
        prefix: "refs/heads/",
        symrefs: true,
        onAuth,
      })
      const remoteBranch = getRequestedRemoteRef(refs || [])
      if (!remoteBranch) {
        if (requestedBranch) {
          return {needsUpdate: false}
        }

        return {needsUpdate: refs && refs.length > 0}
      }

      const localCommit = localBranchCommit || getCachedCommitForBranch()
      if (!localCommit) {
        return {needsUpdate: true}
      }

      if (remoteBranch.oid === localCommit) {
        return {needsUpdate: false}
      }

      if (repoDir) {
        try {
          const localContainsRemote = await git.isDescendent({
            dir: repoDir,
            oid: localCommit,
            ancestor: remoteBranch.oid,
          })
          if (localContainsRemote) {
            return {needsUpdate: false}
          }

          return {needsUpdate: true}
        } catch {
          // Fall back to strict mismatch behavior if ancestry cannot be determined.
        }
      }

      return {needsUpdate: true}
    },
    {repoId},
  )

  if (result.success && result.result) {
    return result.result.needsUpdate
  }

  // All URLs failed - fall back to cache age check
  return now - cache.lastUpdated > maxCacheAge
}

export async function syncWithRemoteUtil(
  git: GitProvider,
  cacheManager: RepoCacheManager,
  opts: {
    repoId: string
    cloneUrls: string[]
    branch?: string
    requireRemoteSync?: boolean
    requireTrackingRef?: boolean
    preferredUrl?: string
  },
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
    isRepoCloned: (dir: string) => Promise<boolean>
    toPlain: <T>(v: T) => T
    getAuthCallback?: (url: string) => any
    corsProxy?: string | null
  },
) {
  const {
    repoId,
    cloneUrls,
    branch,
    requireRemoteSync = false,
    requireTrackingRef = false,
    preferredUrl,
  } = opts
  const {
    rootDir,
    parseRepoId,
    resolveBranchName,
    isRepoCloned,
    toPlain,
    getAuthCallback,
    corsProxy,
  } = deps
  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`

  const startTime = Date.now()
  console.log(`[syncWithRemote] Starting sync for ${repoId}, branch: ${branch || "default"}`)

  try {
    // 1. Verify repo exists locally
    const cloned = await isRepoCloned(dir)
    if (!cloned) {
      const error = "Repository not cloned locally. Clone first before syncing."
      console.error(`[syncWithRemote] ${error}`)
      throw new Error(error)
    }

    // 2. Get remote URLs. Declared cloneUrls remain the remote policy; local
    // origin can point at a previous fallback and must only be an extra fallback.
    const remotes = await git.listRemotes({dir})
    const originRemote = remotes.find((r: any) => r.remote === "origin")
    const preferredSyncUrl = filterValidCloneUrls([preferredUrl || ""])[0]

    const urlsToTry: string[] = []
    if (preferredSyncUrl) {
      urlsToTry.push(preferredSyncUrl)
    }
    const validCloneUrls = filterValidCloneUrls(cloneUrls)
    for (const url of validCloneUrls) {
      if (!urlsToTry.includes(url)) {
        urlsToTry.push(url)
      }
    }
    if (originRemote?.url && !urlsToTry.includes(originRemote.url)) {
      urlsToTry.push(originRemote.url)
    }

    const orderedUrls = reorderUrlsByPreference(urlsToTry, key)

    if (orderedUrls.length === 0) {
      throw new Error("No remote URL available for sync")
    }
    console.log(`[syncWithRemote] URLs to try: ${orderedUrls.join(", ")}`)

    const isCorsOrNetworkError = (message: string) => {
      const msg = String(message || "").toLowerCase()
      return (
        msg.includes("cors") ||
        msg.includes("networkerror") ||
        msg.includes("failed to fetch") ||
        msg.includes("access-control") ||
        msg.includes("timeout") ||
        msg.includes("econn") ||
        msg.includes("enotfound")
      )
    }

    const summarizeAttempts = (attempts: Array<{url: string; error?: string}>) =>
      attempts.map(a => `${a.url}: ${a.error || "failed"}`).join("; ")

    const handleAllNetworkFailures = (
      fetchResult: {attempts: Array<{url: string; error?: string}>},
      activeBranch: string,
    ) => {
      const attemptsSummary = summarizeAttempts(fetchResult.attempts)
      if (requireRemoteSync) {
        return toPlain({
          success: false,
          repoId,
          branch: activeBranch,
          error: `Could not sync target branch from any remote due to network/CORS restrictions. ${attemptsSummary}`,
          duration: Date.now() - startTime,
          synced: false,
          serializable: true,
        })
      }

      console.warn(
        `[syncWithRemote] All ${fetchResult.attempts.length} URLs failed with CORS/Network errors, using local data only`,
      )
      return toPlain({
        success: true,
        repoId,
        branch: activeBranch,
        headCommit: null,
        localCommit: null,
        needsUpdate: false,
        synced: false,
        duration: Date.now() - startTime,
        warning: `Could not fetch from any remote (${fetchResult.attempts.length} tried) due to CORS/network restrictions. Using local data only.`,
        errorDetails: attemptsSummary,
        serializable: true,
      })
    }

    const fetchBranchWithFallback = async (activeBranch: string) =>
      withUrlFallback(
        orderedUrls,
        async (remoteUrl: string) => {
          const fetchOpts: any = {
            dir,
            url: remoteUrl,
            ref: activeBranch,
            singleBranch: true,
            depth: 1,
            prune: true,
            tags: false,
          }
          if (corsProxy !== undefined) {
            fetchOpts.corsProxy = corsProxy
          }
          if (getAuthCallback) {
            fetchOpts.onAuth = getAuthCallback(remoteUrl)
          }
          const fetchInfo = await git.fetch(fetchOpts)
          return {url: remoteUrl, fetchHead: fetchInfo?.fetchHead || null}
        },
        {repoId: key, perUrlTimeoutMs: 15000},
      )

    // 3. Try to fetch the requested branch from remote with URL fallback
    let targetBranch = branch
    let fetchSuccess = false
    let usedUrl: string | undefined
    let fetchedHeadCommit: string | null = null

    if (targetBranch) {
      console.log(`[syncWithRemote] Attempting to fetch requested branch: ${targetBranch}`)

      const fetchResult = await fetchBranchWithFallback(targetBranch as string)

      if (fetchResult.success) {
        console.log(
          `[syncWithRemote] Successfully fetched requested branch from ${fetchResult.usedUrl}`,
        )
        fetchSuccess = true
        usedUrl = fetchResult.usedUrl
        fetchedHeadCommit = fetchResult.result?.fetchHead || null

        if (fetchResult.attempts.length > 1) {
          console.log(
            `[syncWithRemote] Fetch succeeded after ${fetchResult.attempts.filter(a => !a.success).length} failed attempt(s)`,
          )
        }
      } else {
        // Check if all errors were CORS/network related
        const allCorsErrors = fetchResult.attempts.every(a => isCorsOrNetworkError(a.error || ""))

        if (allCorsErrors) {
          return handleAllNetworkFailures(fetchResult as any, targetBranch as string)
        }

        // If fetch failed for other reasons (branch not found on remote), fall back to robust resolution
        console.warn(
          `[syncWithRemote] Failed to fetch requested branch '${targetBranch}' from all ${fetchResult.attempts.length} URLs`,
        )

        if (requireRemoteSync || requireTrackingRef) {
          return toPlain({
            success: false,
            repoId,
            branch: targetBranch,
            error: `Requested branch '${targetBranch}' could not be fetched from any remote. ${summarizeAttempts(fetchResult.attempts)}`,
            duration: Date.now() - startTime,
            synced: false,
            serializable: true,
          })
        }
      }
    }

    // 4. If requested branch fetch failed or no branch specified, use robust branch resolution
    if (!fetchSuccess) {
      targetBranch = await resolveBranchName(dir, branch)
      console.log(`[syncWithRemote] Resolved fallback branch: ${targetBranch}`)

      console.log(`[syncWithRemote] Fetching fallback branch from remote with URL fallback...`)

      const fetchResult = await fetchBranchWithFallback(targetBranch as string)

      if (fetchResult.success) {
        console.log(
          `[syncWithRemote] Fetch completed for fallback branch from ${fetchResult.usedUrl}`,
        )
        usedUrl = fetchResult.usedUrl
        fetchedHeadCommit = fetchResult.result?.fetchHead || null
      } else {
        // Check if all errors were CORS/network related
        const allCorsErrors = fetchResult.attempts.every(a => isCorsOrNetworkError(a.error || ""))

        if (allCorsErrors) {
          return handleAllNetworkFailures(fetchResult as any, targetBranch as string)
        }

        // Throw the last error
        const lastAttempt = fetchResult.attempts[fetchResult.attempts.length - 1]
        throw new Error(lastAttempt?.error || "All fetch attempts failed")
      }
    }

    // 5. Ensure the branch is checked out locally so it's available for file operations
    try {
      // Check if local branch exists
      const localBranches = await git.listBranches({dir})
      if (!localBranches.includes(targetBranch)) {
        // Create local branch from remote tracking branch
        console.log(`[syncWithRemote] Creating local branch '${targetBranch}' from remote`)
        try {
          const remoteRef = `refs/remotes/origin/${targetBranch}`
          const remoteCommit = await git.resolveRef({dir, ref: remoteRef})
          await git.branch({dir, ref: targetBranch, checkout: false, object: remoteCommit})
          console.log(`[syncWithRemote] Local branch '${targetBranch}' created`)
        } catch (branchError) {
          console.warn(`[syncWithRemote] Could not create local branch:`, branchError)
        }
      }

      // Checkout the branch
      console.log(`[syncWithRemote] Checking out branch: ${targetBranch}`)
      await git.checkout({dir, ref: targetBranch})
      console.log(`[syncWithRemote] Branch checked out successfully`)
    } catch (checkoutError) {
      console.warn(`[syncWithRemote] Checkout warning (continuing anyway):`, checkoutError)
      // Don't fail the entire sync if checkout has issues
    }

    // 6. Resolve remote HEAD
    const trackingRef = `refs/remotes/origin/${targetBranch}`
    let remoteCommit: string | null = null
    let trackingRefResolved = false
    try {
      remoteCommit = await git.resolveRef({dir, ref: trackingRef})
      trackingRefResolved = true
    } catch (trackingError) {
      console.warn(`[syncWithRemote] Tracking ref ${trackingRef} not found:`, trackingError)
      if (requireTrackingRef) {
        throw new Error(
          `Missing tracking ref ${trackingRef} after fetch. Cannot prove remote sync for branch ${targetBranch}.`,
        )
      }
      if (fetchedHeadCommit) {
        remoteCommit = fetchedHeadCommit
      } else if (requireRemoteSync) {
        throw new Error(
          `Remote fetch completed but no remote commit could be resolved for ${targetBranch}.`,
        )
      } else {
        console.warn(`[syncWithRemote] Falling back to HEAD because remote ref is missing`)
        remoteCommit = await git.resolveRef({dir, ref: "HEAD"})
      }
    }

    if (!remoteCommit) {
      throw new Error(`Unable to resolve remote commit for branch ${targetBranch}`)
    }
    console.log(`[syncWithRemote] Remote HEAD: ${remoteCommit}`)

    // 7. Get local HEAD for comparison
    const localCommit = await git.resolveRef({dir, ref: "HEAD"}).catch(() => null)
    const needsUpdate = localCommit !== remoteCommit
    console.log(`[syncWithRemote] Local HEAD: ${localCommit}, needs update: ${needsUpdate}`)

    // 8. Update cache with comprehensive data
    const branchNames = await git.listBranches({dir})
    const branchEntries: Array<{name: string; commit: string}> = []
    for (const name of branchNames) {
      try {
        const commit = await git
          .resolveRef({dir, ref: `refs/heads/${name}`})
          .catch(async () => await git.resolveRef({dir, ref: `refs/remotes/origin/${name}`}))
        branchEntries.push({name, commit})
      } catch {
        // Skip branches we cannot resolve
      }
    }

    // Preserve existing dataLevel if present, otherwise set to 'shallow'
    const existing = await cacheManager.getRepoCache(key).catch(() => null)
    const dataLevel = (existing?.dataLevel || "shallow") as "refs" | "shallow" | "full"

    const newCache = {
      repoId: key,
      lastUpdated: Date.now(),
      headCommit: remoteCommit,
      dataLevel,
      branches: branchEntries,
      cloneUrls,
    }

    await cacheManager.setRepoCache(newCache)
    console.log(`[syncWithRemote] Cache updated`)

    const duration = Date.now() - startTime
    console.log(`[syncWithRemote] Sync completed successfully in ${duration}ms`)

    return toPlain({
      success: true,
      repoId,
      branch: targetBranch,
      headCommit: remoteCommit,
      localCommit,
      needsUpdate,
      synced: true,
      trackingRef,
      trackingRefResolved,
      usedUrl,
      duration,
      serializable: true,
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`[syncWithRemote] Sync failed after ${duration}ms:`, error)
    console.error(`[syncWithRemote] Error details:`, {
      message: error?.message,
      stack: error?.stack,
      repoId,
      branch,
    })

    return toPlain({
      success: false,
      repoId,
      branch,
      error: error?.message || String(error),
      duration,
    })
  }
}
