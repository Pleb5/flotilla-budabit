import type {GitProvider} from "../../git/provider.js"
import type {RepoCacheManager, RepoCache} from "./cache.js"
import {resolveBranchName} from "./branches.js"
import {resolveBranchToOid} from "../../git/git.js"
import {getProviderFs, safeRmrf, ensureDir} from "./fs-utils.js"
import {getAuthCallback, setAuthConfig} from "./auth.js"
import {resolveDefaultCorsProxy} from "./git-config.js"
import {
  withUrlFallback,
  filterValidCloneUrls,
  reorderUrlsByPreference,
  updateUrlPreferenceCache,
  type ReadFallbackResult,
} from "../../utils/clone-url-fallback.js"
import {isGraspRepoHttpUrl, resolveCorsProxyForUrl} from "../../utils/grasp-url.js"
import {
  buildAdvertisedBranchCandidates,
  discoverAdvertisedRefs,
} from "../../utils/advertised-refs.js"

// Import toPlain from worker (it's defined in the same directory)
function toPlain<T>(val: T): T {
  try {
    return JSON.parse(JSON.stringify(val))
  } catch {
    return val
  }
}

export interface CloneRemoteRepoOptions {
  url: string
  depth?: number
  dir: string
  token?: string
  onProgress?: (stage: string, pct?: number) => void
}

/**
 * Clear in-memory tracking structures (delegated by git-worker).
 */
export function clearCloneTracking(
  clonedRepos: Set<string>,
  repoDataLevels: Map<string, "refs" | "shallow" | "full">,
) {
  clonedRepos.clear()
  repoDataLevels.clear()
}

type DataLevel = "refs" | "shallow" | "full"

// Deduplication map for ensureFullClone - prevents parallel fetches for the same repo
const pendingFullClones = new Map<string, Promise<any>>()

/**
 * Ensure the origin remote is properly configured with URL and fetch refspec.
 * isomorphic-git's shallow/singleBranch clone may not create the full config,
 * which causes "NoRefspecError: Could not find a fetch refspec for remote origin".
 */
export async function ensureOriginRemoteConfig(
  git: GitProvider,
  dir: string,
  url: string,
): Promise<void> {
  try {
    // First try to add the remote (will fail if it already exists, which is fine)
    try {
      await git.addRemote({dir, remote: "origin", url})
    } catch (err: any) {
      // Ignore "already exists" errors
      if (!err.message?.includes("already exists") && !err.message?.includes("Remote named")) {
        throw err
      }
    }

    // Ensure the fetch refspec is set - this is the critical piece that's often missing
    // Without this, operations that need to resolve remote refs will fail with NoRefspecError
    try {
      await git.setConfig({
        dir,
        path: "remote.origin.fetch",
        value: "+refs/heads/*:refs/remotes/origin/*",
      })
    } catch {
      // Best effort - some providers may not support setConfig
    }

    // Also ensure the URL is set in config (belt and suspenders)
    try {
      await git.setConfig({
        dir,
        path: "remote.origin.url",
        value: url,
      })
    } catch {
      // Best effort
    }
  } catch (err) {
    // Log but don't fail the clone - the remote may still work for basic operations
    console.warn("[ensureOriginRemoteConfig] Could not fully configure origin remote:", err)
  }
}

export async function smartInitializeRepoUtil(
  git: GitProvider,
  cacheManager: RepoCacheManager,
  opts: {
    repoId: string
    cloneUrls: string[]
    branch?: string
    forceUpdate?: boolean
  },
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    repoDataLevels: Map<string, DataLevel>
    clonedRepos: Set<string>
    isRepoCloned: (git: GitProvider, dir: string) => Promise<boolean>
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
  },
  sendProgress: (phase: string, loaded?: number, total?: number) => void,
) {
  const {repoId, cloneUrls, branch, forceUpdate = false} = opts
  const {rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName} = deps

  try {
    const key = parseRepoId(repoId)
    const dir = `${rootDir}/${key}`
    const cache = await cacheManager.getRepoCache(key)
    if (cache && !forceUpdate) {
      const cacheHasLocalClone = await isRepoCloned(git, dir).catch(() => false)
      if (cacheHasLocalClone) {
        sendProgress("Using cached data")
        repoDataLevels.set(key, cache.dataLevel)
        clonedRepos.add(key)
        return {
          success: true,
          repoId,
          fromCache: true,
          dataLevel: cache.dataLevel,
          branches: cache.branches,
          headCommit: cache.headCommit,
        }
      }
      sendProgress("Cached metadata found, but local clone is missing")
    }

    sendProgress("Checking repository status")
    const isAlreadyCloned = await isRepoCloned(git, dir)

    if (isAlreadyCloned && !forceUpdate) {
      try {
        sendProgress("Syncing with remote")
        const validUrls = filterValidCloneUrls(cloneUrls)
        const orderedUrls = reorderUrlsByPreference(validUrls, key)
        let fetchResult: ReadFallbackResult<{url: string}> | undefined

        if (orderedUrls.length > 0) {
          sendProgress("Fetching latest changes from remote")
          const fetchStart = Date.now()
          const fetchDepth = repoDataLevels.get(key) === "full" ? undefined : 50
          const configuredCorsProxy = resolveDefaultCorsProxy()

          // Try each URL with fallback until one succeeds
          fetchResult = await withUrlFallback(
            orderedUrls,
            async (cloneUrl: string) => {
              const corsProxy = resolveCorsProxyForUrl(cloneUrl, configuredCorsProxy)
              // Try singleBranch: true first (works better with non-GitHub servers like Forgejo)
              const primaryFetchOpts: any = {
                dir,
                url: cloneUrl,
                singleBranch: true,
                depth: fetchDepth,
                corsProxy,
              }
              if (branch) {
                primaryFetchOpts.ref = branch
              }
              try {
                await git.fetch(primaryFetchOpts)
                return {url: cloneUrl}
              } catch (singleBranchError: any) {
                // If single branch fetch fails, try without specifying singleBranch
                console.warn(
                  `[smartInitializeRepo] Single branch fetch failed for ${cloneUrl}, trying default:`,
                  singleBranchError?.message,
                )
                const fallbackFetchOpts: any = {
                  dir,
                  url: cloneUrl,
                  depth: fetchDepth,
                  corsProxy,
                }
                if (branch) {
                  fallbackFetchOpts.ref = branch
                  fallbackFetchOpts.singleBranch = true
                }
                await git.fetch(fallbackFetchOpts)
                return {url: cloneUrl}
              }
            },
            {repoId: key, perUrlTimeoutMs: 15000},
          )

          if (fetchResult.success) {
            const secs = ((Date.now() - fetchStart) / 1000).toFixed(1)
            sendProgress(`Fetch completed (${secs}s) from ${fetchResult.usedUrl}`)

            // Log fallback attempts if any
            if (fetchResult.attempts.length > 1) {
              const failedAttempts = fetchResult.attempts.filter(a => !a.success)
              console.log(
                `[smartInitializeRepo] Fetch succeeded after ${failedAttempts.length} failed attempt(s)`,
              )
            }
          } else {
            // All URLs failed - check if it's a recoverable error
            const lastAttempt = fetchResult.attempts[fetchResult.attempts.length - 1]
            const errorMessage = lastAttempt?.error || "Unknown fetch error"

            if (
              errorMessage.includes("CORS") ||
              errorMessage.includes("NetworkError") ||
              errorMessage.includes("Failed to fetch") ||
              errorMessage.includes("Access-Control") ||
              errorMessage.includes("NoRefspecError") ||
              errorMessage.includes("refspec")
            ) {
              console.warn(
                `[smartInitializeRepo] All fetch attempts failed with CORS/Network/Refspec errors, using local data only`,
              )
              // Log all attempted URLs
              for (const attempt of fetchResult.attempts) {
                console.warn(`  - ${attempt.url}: ${attempt.error}`)
              }
              // Continue with local data, don't throw error
            } else {
              throw new Error(
                `Fetch failed for all ${fetchResult.attempts.length} URL(s): ${errorMessage}`,
              )
            }
          }
        }

        // Try to resolve branch, but handle empty repos gracefully
        let mainBranch: string
        try {
          sendProgress("Resolving repository branch")
          mainBranch = await resolveBranchName(dir, branch)
          sendProgress(`Found branch: ${mainBranch}`)
        } catch (branchError) {
          console.warn(
            `[smartInitializeRepo] Could not resolve branches, repository may be empty:`,
            branchError,
          )
          // For empty repos, we'll return a limited success state
          return toPlain({
            success: true,
            repoId,
            fromCache: false,
            dataLevel: "refs",
            warning: "Repository initialized but no branches found. Repository may be empty.",
            serializable: true,
          })
        }
        const remoteRef = `refs/remotes/origin/${mainBranch}`
        let remoteCommit: string
        try {
          sendProgress("Resolving remote commit")
          remoteCommit = await git.resolveRef({dir, ref: remoteRef})
          sendProgress("Updating local references")
          await git.writeRef({dir, ref: `refs/heads/${mainBranch}`, value: remoteCommit})
          await git.writeRef({
            dir,
            ref: "HEAD",
            value: `ref: refs/heads/${mainBranch}`,
            symbolic: true,
          })
          sendProgress("Local repository synced with remote")
        } catch (e) {
          sendProgress("Using local HEAD commit")
          remoteCommit = await git.resolveRef({dir, ref: "HEAD"})
        }
        // Resolve per-branch commits (merge local + remote branches)
        sendProgress("Listing repository branches")
        const localBranches: string[] = await git.listBranches({dir})
        let remoteBranches: string[] = []
        try {
          remoteBranches = await git.listBranches({dir, remote: "origin"})
        } catch {}
        const allBranchNames = new Set<string>(localBranches)
        for (const rb of remoteBranches) {
          allBranchNames.add(rb.startsWith("origin/") ? rb.slice(7) : rb)
        }
        const branchEntries: Array<{name: string; commit: string}> = []
        for (const name of allBranchNames) {
          try {
            const commit = await git
              .resolveRef({dir, ref: `refs/heads/${name}`})
              .catch(async () => await git.resolveRef({dir, ref: `refs/remotes/origin/${name}`}))
            branchEntries.push({name, commit})
          } catch {
            // Fallback to remoteCommit if resolution fails
            branchEntries.push({name, commit: remoteCommit})
          }
        }

        // Resolve tags (optional)
        let tags: Array<{name: string; commit: string}> | undefined = undefined
        try {
          sendProgress("Resolving tags")
          const tagNames: string[] = await (git as any).listTags?.({dir})
          if (Array.isArray(tagNames) && tagNames.length > 0) {
            tags = []
            for (const t of tagNames) {
              try {
                const commit = await git.resolveRef({dir, ref: `refs/tags/${t}`})
                tags.push({name: t, commit})
              } catch {
                // ignore individual tag resolution errors
              }
            }
          }
        } catch {
          // listing tags is best effort; ignore errors
        }

        const newCache: RepoCache = {
          repoId: key,
          lastUpdated: Date.now(),
          headCommit: remoteCommit,
          dataLevel: (repoDataLevels.get(key) || "shallow") as DataLevel,
          branches: branchEntries,
          cloneUrls,
        }
        if (tags && tags.length) {
          ;(newCache as any).tags = tags
        }
        await cacheManager.setRepoCache(newCache)
        repoDataLevels.set(key, newCache.dataLevel)
        clonedRepos.add(key)
        sendProgress(
          `Updating repository cache with ${branchEntries.length} branches${tags?.length ? ` and ${tags.length} tags` : ""}`,
        )
        sendProgress("Repository ready")
        return {
          success: true,
          repoId,
          fromCache: false,
          dataLevel: newCache.dataLevel,
          branches: newCache.branches,
          headCommit: newCache.headCommit,
          synced: true,
          usedUrl: fetchResult?.usedUrl,
          attemptedUrls: fetchResult?.attempts.map(a => a.url) ?? [],
        }
      } catch (e) {
        // fall through to re-init
      }
    }

    return await initializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls, branch},
      {rootDir, parseRepoId, repoDataLevels, clonedRepos},
      sendProgress,
    )
  } catch (error: any) {
    return {
      success: false,
      repoId: opts.repoId,
      error: error?.message || String(error),
      fromCache: false,
    }
  }
}

export async function initializeRepoUtil(
  git: GitProvider,
  cacheManager: RepoCacheManager,
  opts: {repoId: string; cloneUrls: string[]; branch?: string},
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    repoDataLevels: Map<string, DataLevel>
    clonedRepos: Set<string>
  },
  sendProgress: (phase: string, loaded?: number, total?: number) => void,
) {
  const {repoId, cloneUrls, branch} = opts
  const {rootDir, parseRepoId, repoDataLevels, clonedRepos} = deps
  try {
    const key = parseRepoId(repoId)
    const dir = `${rootDir}/${key}`
    sendProgress("Initializing repository")

    // Filter and order URLs by preference (using cached successful URL if available)
    const validUrls = filterValidCloneUrls(cloneUrls)
    const orderedUrls = reorderUrlsByPreference(validUrls, key)

    if (orderedUrls.length === 0) {
      return toPlain({
        success: false,
        repoId,
        error: "No valid clone URLs provided",
        fromCache: false,
        serializable: true,
      })
    }

    // Track which URL succeeded for caching
    let successfulUrl: string | undefined
    const failedUrls: string[] = []

    // Try each URL with fallback
    const cloneResult = await withUrlFallback(
      orderedUrls,
      async (cloneUrl: string) => {
        sendProgress(`Fetching repository metadata from ${new URL(cloneUrl).hostname}`, 0, 1)
        const onProgress = (progress: {phase: string; loaded?: number; total?: number}) =>
          sendProgress(progress.phase, progress.loaded, progress.total)
        const authCallback = getAuthCallback(cloneUrl)
        const configuredCorsProxy = resolveDefaultCorsProxy()
        const corsProxy = resolveCorsProxyForUrl(cloneUrl, configuredCorsProxy)

        let refCandidates: string[] = []
        try {
          const advertised = await discoverAdvertisedRefs(git, {
            url: cloneUrl,
            ...(authCallback ? {onAuth: authCallback} : {}),
            corsProxy,
          })
          refCandidates = buildAdvertisedBranchCandidates({
            headBranch: advertised.headBranch,
            branches: advertised.branches,
          })
        } catch (error) {
          console.warn(`[initializeRepo] Failed to inspect advertised refs for ${cloneUrl}:`, error)
        }

        refCandidates = Array.from(
          new Set([
            ...(branch ? [branch] : []),
            ...refCandidates,
            "main",
            "master",
            "develop",
            "dev",
            "HEAD",
          ]),
        )

        // Detect Nostr relay URLs - they need special handling with deeper clones
        const isNostrRelay = isGraspRepoHttpUrl(cloneUrl)

        // Nostr relays need deeper clones because shallow clones often fail to fetch commit objects
        const cloneDepth = isNostrRelay ? 10 : 1

        if (isNostrRelay) {
          console.log(
            `[initializeRepo] Detected Nostr relay URL, using depth ${cloneDepth} for better compatibility`,
          )
        }

        let lastRefError: Error | null = null
        for (const refCandidate of refCandidates) {
          try {
            // Clone with noCheckout: false to ensure refs are created properly
            // Use singleBranch: true for shallow clones - non-GitHub servers (Forgejo, Gitea)
            // don't properly handle singleBranch: false with shallow depth during pack negotiation
            await git.clone({
              dir,
              url: cloneUrl,
              ref: refCandidate,
              singleBranch: true, // Critical: use single branch for shallow clone compatibility
              depth: cloneDepth,
              corsProxy,
              noCheckout: false, // checkout to create HEAD and local branch ref
              noTags: true,
              onProgress,
              ...(authCallback && {onAuth: authCallback}),
            })
            // Ensure origin remote is properly configured with fetch refspec
            // isomorphic-git's shallow/singleBranch clone may not create the full config
            await ensureOriginRemoteConfig(git, dir, cloneUrl)
            return {url: cloneUrl, ref: refCandidate}
          } catch (e: any) {
            lastRefError = e
            continue
          }
        }
        throw lastRefError || new Error(`Clone failed for ${cloneUrl}`)
      },
      {repoId: key, perUrlTimeoutMs: 30000}, // 30s timeout for initial clone (larger than fetch)
    )

    if (!cloneResult.success) {
      // Check if the last error was CORS-related
      const lastAttempt = cloneResult.attempts[cloneResult.attempts.length - 1]
      const errorMessage = lastAttempt?.error || "Unknown error"
      const corsError =
        errorMessage.includes("CORS") ||
        errorMessage.includes("NetworkError") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("Access-Control") ||
        errorMessage.includes("Cross-Origin")

      if (corsError) {
        // For CORS errors, return a special response instead of throwing
        return toPlain({
          success: false,
          repoId,
          error:
            "Repository initialization failed due to CORS/network restrictions. The remote repository may be accessible but the browser cannot fetch it due to security policies.",
          corsError: true,
          fromCache: false,
          attemptedUrls: cloneResult.attempts.map(a => a.url),
          serializable: true,
        })
      }

      // Log all failed attempts
      console.error(`[initializeRepo] All ${cloneResult.attempts.length} clone URL(s) failed:`)
      for (const attempt of cloneResult.attempts) {
        console.error(`  - ${attempt.url}: ${attempt.error}`)
      }

      throw new Error(
        `All ${cloneResult.attempts.length} clone URLs failed. Last error: ${errorMessage}`,
      )
    }

    successfulUrl = cloneResult.usedUrl
    console.log(`[initializeRepo] Clone succeeded using ${successfulUrl}`)
    if (cloneResult.attempts.length > 1) {
      console.log(
        `[initializeRepo] Fallback used: ${cloneResult.attempts.filter(a => !a.success).length} URL(s) failed before success`,
      )
    }

    // After shallow clone, we need to create local branch refs from remote refs
    // because isomorphic-git's shallow clone with singleBranch doesn't create them
    let headCommit: string | undefined
    let defaultBranch = branch || "main"

    // Try to get the HEAD commit and create local branch ref
    try {
      // First, try to find remote refs that were fetched
      const remoteBranches = await git
        .listBranches({dir, remote: "origin"})
        .catch(() => [] as string[])

      if (remoteBranches.length > 0) {
        // Use the first remote branch (usually the default)
        const remoteBranch = branch && remoteBranches.includes(branch) ? branch : remoteBranches[0]
        defaultBranch = remoteBranch
        const remoteRef = `refs/remotes/origin/${remoteBranch}`
        headCommit = await git.resolveRef({dir, ref: remoteRef})

        // Create the local branch ref (use force: true to handle re-initialization)
        await git.writeRef({
          dir,
          ref: `refs/heads/${defaultBranch}`,
          value: headCommit,
          force: true,
        })
        // Update HEAD to point to the local branch
        await git.writeRef({
          dir,
          ref: "HEAD",
          value: `ref: refs/heads/${defaultBranch}`,
          symbolic: true,
          force: true,
        })
        console.log(
          `[initializeRepo] Created local branch '${defaultBranch}' from remote ref, commit: ${headCommit?.substring(0, 8)}`,
        )
      } else {
        // No remote branches - try multiple fallback strategies
        // This handles cases where the clone fetched objects but didn't create refs
        console.log(`[initializeRepo] No remote branches found, trying fallback strategies...`)

        // Strategy 1: Try FETCH_HEAD which isomorphic-git creates during fetch
        try {
          headCommit = await git.resolveRef({dir, ref: "FETCH_HEAD"})
          await git.writeRef({
            dir,
            ref: `refs/heads/${defaultBranch}`,
            value: headCommit,
            force: true,
          })
          await git.writeRef({
            dir,
            ref: "HEAD",
            value: `ref: refs/heads/${defaultBranch}`,
            symbolic: true,
            force: true,
          })
          console.log(
            `[initializeRepo] Created local branch '${defaultBranch}' from FETCH_HEAD, commit: ${headCommit?.substring(0, 8)}`,
          )
        } catch (fetchHeadErr) {
          console.log(
            `[initializeRepo] FETCH_HEAD not available: ${(fetchHeadErr as Error).message}`,
          )

          // Strategy 2: Try to resolve HEAD directly (might be a detached HEAD with commit OID)
          try {
            const headRef = await git.resolveRef({dir, ref: "HEAD", depth: 1})
            if (headRef && headRef.length === 40) {
              headCommit = headRef
              await git.writeRef({
                dir,
                ref: `refs/heads/${defaultBranch}`,
                value: headCommit,
                force: true,
              })
              await git.writeRef({
                dir,
                ref: "HEAD",
                value: `ref: refs/heads/${defaultBranch}`,
                symbolic: true,
                force: true,
              })
              console.log(
                `[initializeRepo] Created local branch '${defaultBranch}' from HEAD OID, commit: ${headCommit?.substring(0, 8)}`,
              )
            }
          } catch (headErr) {
            console.log(`[initializeRepo] HEAD resolution failed: ${(headErr as Error).message}`)

            // Strategy 3: Try git.log to find any commits in the object store
            try {
              const commits = await git.log({dir, depth: 1})
              if (commits && commits.length > 0 && commits[0].oid) {
                headCommit = commits[0].oid
                await git.writeRef({
                  dir,
                  ref: `refs/heads/${defaultBranch}`,
                  value: headCommit,
                  force: true,
                })
                await git.writeRef({
                  dir,
                  ref: "HEAD",
                  value: `ref: refs/heads/${defaultBranch}`,
                  symbolic: true,
                  force: true,
                })
                console.log(
                  `[initializeRepo] Created local branch '${defaultBranch}' from git.log, commit: ${headCommit?.substring(0, 8)}`,
                )
              }
            } catch (logErr) {
              console.log(`[initializeRepo] git.log failed: ${(logErr as Error).message}`)
              console.warn(
                `[initializeRepo] Could not find any refs or commits, repository may be empty`,
              )
              headCommit = undefined
            }
          }
        }
      }
    } catch (refError) {
      console.warn(`[initializeRepo] Error setting up refs:`, refError)
    }

    const branches = await git.listBranches({dir}).catch(() => [] as string[])

    // If we still don't have headCommit, try one more time with the newly created refs
    if (!headCommit && branches.length > 0) {
      try {
        headCommit = await git.resolveRef({dir, ref: `refs/heads/${branches[0]}`})
      } catch {
        // ignore
      }
    }

    // Final fallback - if no commit found, return partial success
    if (!headCommit) {
      console.warn(`[initializeRepo] Repository cloned but no commits found`)
      return toPlain({
        success: true,
        repoId,
        dataLevel: "refs" as const,
        branches: [],
        headCommit: undefined,
        fromCache: false,
        warning: "Repository cloned but no commits found. Repository may be empty.",
        usedUrl: successfulUrl,
        attemptedUrls: cloneResult.attempts.map(a => a.url),
      })
    }
    repoDataLevels.set(key, "refs")
    clonedRepos.add(key)
    const cache: RepoCache = {
      repoId: key,
      lastUpdated: Date.now(),
      headCommit,
      dataLevel: "refs",
      branches: headCommit ? branches.map((name: string) => ({name, commit: headCommit})) : [],
      cloneUrls,
    }
    await cacheManager.setRepoCache(cache)
    sendProgress("Repository initialized")
    return {
      success: true,
      repoId,
      dataLevel: "refs" as const,
      branches: cache.branches,
      headCommit,
      fromCache: false,
      usedUrl: successfulUrl,
      attemptedUrls: cloneResult.attempts.map(a => a.url),
    }
  } catch (error: any) {
    return {success: false, repoId, error: error?.message || String(error), fromCache: false}
  }
}

export async function ensureShallowCloneUtil(
  git: GitProvider,
  opts: {repoId: string; branch?: string},
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    repoDataLevels: Map<string, DataLevel>
    clonedRepos: Set<string>
    isRepoCloned: (git: GitProvider, dir: string) => Promise<boolean>
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
  },
  sendProgress: (phase: string, loaded?: number, total?: number) => void,
) {
  const {repoId, branch} = opts
  const {rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName} = deps
  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`
  let targetBranch: string = branch || "main"
  try {
    targetBranch = await resolveBranchName(dir, branch)
    const currentLevel = repoDataLevels.get(key)
    if (currentLevel === "shallow" || currentLevel === "full") {
      sendProgress("Using existing shallow clone")
      return {success: true, repoId, branch, dataLevel: currentLevel, fromCache: true}
    }
    if (!clonedRepos.has(key)) {
      if (!(await isRepoCloned(git, dir))) {
        return {
          success: false,
          repoId,
          error: "Repository not initialized. Call initializeRepo first.",
        }
      }
    }
    sendProgress("Fetching branch content", 0, 1)
    const remotes = await git.listRemotes({dir})
    const originRemote = remotes.find((r: any) => r.remote === "origin")
    if (!originRemote?.url) throw new Error("Origin remote not found or has no URL configured")
    const authCallback = getAuthCallback(originRemote.url)
    const corsProxy = resolveCorsProxyForUrl(originRemote.url, resolveDefaultCorsProxy())
    await git.fetch({
      dir,
      url: originRemote.url,
      ref: targetBranch,
      depth: 1,
      singleBranch: true,
      corsProxy,
      onProgress: (p: any) => sendProgress(p.phase, p.loaded, p.total),
      ...(authCallback && {onAuth: authCallback}),
    })
    await git.checkout({dir, ref: targetBranch})
    repoDataLevels.set(key, "shallow")
    return {
      success: true,
      repoId,
      branch: targetBranch,
      dataLevel: "shallow" as const,
      fromCache: false,
    }
  } catch (error: any) {
    return {success: false, repoId, branch: targetBranch, error: error?.message || String(error)}
  }
}

export async function ensureFullCloneUtil(
  git: GitProvider,
  opts: {repoId: string; branch?: string; depth?: number; cloneUrls?: string[]},
  deps: {
    rootDir: string
    parseRepoId: (id: string) => string
    repoDataLevels: Map<string, DataLevel>
    clonedRepos: Set<string>
    isRepoCloned: (git: GitProvider, dir: string) => Promise<boolean>
    resolveBranchName: (dir: string, requested?: string) => Promise<string>
    cacheManager?: RepoCacheManager
  },
  sendProgress: (phase: string, loaded?: number, total?: number) => void,
) {
  const {repoId, branch, depth = 50, cloneUrls: providedCloneUrls} = opts
  const {rootDir, parseRepoId, repoDataLevels, clonedRepos, isRepoCloned, resolveBranchName} = deps
  const key = parseRepoId(repoId)
  const dir = `${rootDir}/${key}`
  const currentLevel = repoDataLevels.get(key)
  const configuredCorsProxy = resolveDefaultCorsProxy()

  const resolveExistingBranchCommit = async (targetBranch: string): Promise<string | null> => {
    const refsToCheck = [
      targetBranch,
      `refs/heads/${targetBranch}`,
      `origin/${targetBranch}`,
      `refs/remotes/origin/${targetBranch}`,
    ]

    for (const ref of refsToCheck) {
      try {
        const oid = await git.resolveRef({dir, ref})
        if (oid) return oid
      } catch {
        // pass
      }
    }

    return null
  }

  // Deduplication: if there's already a pending full clone for this repo, wait for it
  const dedupeKey = `${key}:${branch || "default"}`
  const pendingClone = pendingFullClones.get(dedupeKey)
  if (pendingClone) {
    console.log(`[ensureFullClone] Waiting for existing clone operation for ${dedupeKey}`)
    return pendingClone
  }

  const targetBranch = await resolveBranchName(dir, branch)

  // Check if we already have commits for this specific branch
  // Even at 'full' level, we may need to fetch a different branch
  if (currentLevel === "full") {
    // Try to verify the branch exists locally by attempting to resolve it to an OID
    try {
      // Try direct branch name, then remote tracking branch
      const branchesToCheck = [
        targetBranch,
        `origin/${targetBranch}`,
        `refs/remotes/origin/${targetBranch}`,
      ]
      let branchExists = false

      for (const ref of branchesToCheck) {
        try {
          await git.resolveRef({dir, ref})
          branchExists = true
          break
        } catch {
          // Branch not found, continue trying
        }
      }

      if (branchExists) {
        return {success: true, repoId, cached: true, level: currentLevel}
      }
      // Branch not found - need to fetch it
      console.log(
        `[ensureFullClone] Repo at 'full' level but branch '${targetBranch}' not found, fetching...`,
      )
    } catch (error) {
      console.log(
        `[ensureFullClone] Could not verify branch '${targetBranch}', will fetch...`,
        error,
      )
    }
  }

  if (!clonedRepos.has(key)) {
    if (!(await isRepoCloned(git, dir)))
      return {
        success: false,
        repoId,
        error: "Repository not initialized. Call initializeRepo first.",
      }
  }

  // Create the fetch operation as a promise and store it for deduplication
  const fetchPromise = (async () => {
    sendProgress(`Fetching commit history (depth: ${depth})...`)
    try {
      // Build list of URLs to try: declared cloneUrls first, then origin/cache as
      // fallbacks. Origin may point at a previous fallback remote.
      const urlsToTry: string[] = []

      // 1. Add provided clone URLs in declared order.
      if (providedCloneUrls?.length) {
        for (const url of filterValidCloneUrls(providedCloneUrls)) {
          if (!urlsToTry.includes(url)) {
            urlsToTry.push(url)
          }
        }
      }

      // 2. Get origin URL from git config as an extra fallback.
      const remotes = await git.listRemotes({dir})
      const originRemote = remotes.find((r: any) => r.remote === "origin")
      if (originRemote?.url) {
        if (!urlsToTry.includes(originRemote.url)) {
          urlsToTry.push(originRemote.url)
        }
      }

      // 3. Try to get clone URLs from cache if we have a cache manager.
      if (deps.cacheManager) {
        try {
          const cache = await deps.cacheManager.getRepoCache(key)
          if (cache?.cloneUrls?.length) {
            for (const url of filterValidCloneUrls(cache.cloneUrls)) {
              if (!urlsToTry.includes(url)) {
                urlsToTry.push(url)
              }
            }
          }
        } catch {
          // Ignore cache errors
        }
      }

      if (urlsToTry.length === 0) {
        throw new Error(
          "No clone URLs available. Origin remote not found and no clone URLs provided.",
        )
      }

      // Reorder URLs by preference (cached successful URL first)
      const orderedUrls = reorderUrlsByPreference(urlsToTry, key)

      console.log(
        `[ensureFullClone] URLs to try (corsProxy=${configuredCorsProxy ?? "none"}):`,
        orderedUrls.join(", "),
      )

      // Use withUrlFallback with per-URL timeout for responsive fallback
      const fetchResult = await withUrlFallback(
        orderedUrls,
        async (cloneUrl: string) => {
          const corsProxy = resolveCorsProxyForUrl(cloneUrl, configuredCorsProxy)
          // Detect Nostr relay URLs - they may need special handling
          const isNostrRelay = isGraspRepoHttpUrl(cloneUrl)

          // For Nostr relays, ensure we fetch enough depth to get the commit objects
          const effectiveDepth = isNostrRelay ? Math.max(depth, 50) : Math.min(depth, 100)

          if (isNostrRelay) {
            console.log(`[ensureFullClone] Detected Nostr relay URL, using depth ${effectiveDepth}`)
          }

          const authCallback = getAuthCallback(cloneUrl)
          await git.fetch({
            dir,
            url: cloneUrl,
            ref: targetBranch,
            depth: effectiveDepth,
            singleBranch: true,
            tags: false,
            corsProxy,
            onProgress: (p: any) => sendProgress(`Full clone: ${p.phase}`, p.loaded, p.total),
            ...(authCallback && {onAuth: authCallback}),
          })
          return {url: cloneUrl}
        },
        {
          repoId: key,
          perUrlTimeoutMs: 15000, // 15 second timeout per URL - if slow, try next
        },
      )

      if (fetchResult.success) {
        // Log if we used a fallback URL
        if (fetchResult.attempts.length > 1) {
          const failedAttempts = fetchResult.attempts.filter(a => !a.success)
          console.log(
            `[ensureFullClone] Fetch succeeded after ${failedAttempts.length} failed attempt(s), used: ${fetchResult.usedUrl}`,
          )
        }

        repoDataLevels.set(key, "full")
        return {
          success: true,
          repoId,
          cached: false,
          level: "full" as const,
          usedUrl: fetchResult.usedUrl,
        }
      } else {
        // All URLs failed
        const lastAttempt = fetchResult.attempts[fetchResult.attempts.length - 1]
        const errorMessage = lastAttempt?.error || "All fetch attempts failed"

        // Log all failed attempts for debugging
        console.warn(`[ensureFullClone] All ${fetchResult.attempts.length} URL(s) failed:`)
        for (const attempt of fetchResult.attempts) {
          console.warn(`  - ${attempt.url}: ${attempt.error} (${attempt.durationMs}ms)`)
        }

        const existingCommit = await resolveExistingBranchCommit(targetBranch)
        if (existingCommit) {
          console.warn(
            `[ensureFullClone] Using existing local data for '${targetBranch}' after fetch failure: ${errorMessage}`,
          )
          return {
            success: true,
            repoId,
            cached: true,
            level: currentLevel || "refs",
            localOnly: true,
            warning: errorMessage,
          }
        }

        return {success: false, repoId, error: errorMessage}
      }
    } catch (error: any) {
      return {success: false, repoId, error: error?.message || String(error)}
    } finally {
      // Clean up the pending clone entry
      pendingFullClones.delete(dedupeKey)
    }
  })()

  // Store the promise for deduplication
  pendingFullClones.set(dedupeKey, fetchPromise)
  console.log(`[ensureFullClone] Starting fetch for ${dedupeKey}`)

  return fetchPromise
}

/**
 * Extracted clone implementation. Accepts dependencies to avoid tight coupling.
 * Behavior mirrors the previous in-file implementation.
 */
export async function cloneRemoteRepoUtil(
  git: GitProvider,
  cacheManager: RepoCacheManager,
  options: CloneRemoteRepoOptions,
): Promise<void> {
  const {url, depth, dir, token, onProgress} = options

  try {
    onProgress?.("Validating repository URL...", 0)

    let repoUrl: URL
    try {
      repoUrl = new URL(url)
    } catch {
      throw new Error(`Invalid repository URL: ${url}`)
    }

    // Ensure the parent directory exists before cloning
    // isomorphic-git requires the parent directory to exist
    try {
      const fs = getProviderFs(git)
      if (fs?.promises) {
        // Get parent directory (everything except the last component)
        const pathParts = dir.split("/").filter(Boolean)
        if (pathParts.length > 1) {
          const parentDir = "/" + pathParts.slice(0, -1).join("/")
          await ensureDir(fs, parentDir)
        } else {
          // If dir is at root level, ensure root exists
          await ensureDir(fs, "/")
        }
      }
    } catch (dirError) {
      // Log but don't fail - some FS implementations handle this automatically
      console.warn("[cloneRemoteRepoUtil] Could not ensure parent directory exists:", dirError)
    }

    if (token) {
      const hostname = repoUrl.hostname
      setAuthConfig({tokens: [{host: hostname, token}]})
    }

    const isGraspHttpRemote = isGraspRepoHttpUrl(url)
    const configuredCorsProxy = resolveDefaultCorsProxy()

    interface CloneTransport {
      name: "direct" | "proxy"
      corsProxy: string | null
    }

    const cloneTransports: CloneTransport[] = isGraspHttpRemote
      ? [
          {name: "direct", corsProxy: null},
          ...(configuredCorsProxy
            ? [{name: "proxy" as const, corsProxy: configuredCorsProxy}]
            : []),
        ]
      : [{name: configuredCorsProxy ? "proxy" : "direct", corsProxy: configuredCorsProxy ?? null}]

    const describeTransport = (transport: CloneTransport): string =>
      transport.name === "direct" ? "direct connection" : "configured CORS proxy"

    const isLikelyCorsOrNetworkError = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message : String(error || "")
      const lower = message.toLowerCase()
      return (
        lower.includes("cors") ||
        lower.includes("access-control") ||
        lower.includes("cross-origin") ||
        lower.includes("network") ||
        lower.includes("failed to fetch") ||
        lower.includes("timeout") ||
        lower.includes("econn") ||
        lower.includes("enotfound") ||
        lower.includes("unreachable") ||
        lower.includes("abort")
      )
    }

    // Add timeout to prevent hanging on slow/unresponsive servers
    const listRefsWithTimeout = async (transport: CloneTransport, timeoutMs: number = 30000) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timeout: listServerRefs took longer than ${timeoutMs / 1000}s`)),
          timeoutMs,
        )
      })
      return Promise.race([
        git.listServerRefs({
          url,
          corsProxy: transport.corsProxy,
          onAuth: getAuthCallback(url),
        }),
        timeoutPromise,
      ])
    }

    onProgress?.("Discovering remote references...", 10)

    let refs: Array<any> | null = null
    let selectedTransport = cloneTransports[0]
    let discoveryError: unknown = null

    for (let i = 0; i < cloneTransports.length; i++) {
      const transport = cloneTransports[i]
      try {
        if (isGraspHttpRemote) {
          onProgress?.(`Discovering remote references (${describeTransport(transport)})...`, 10)
        }
        const fetchedRefs = await listRefsWithTimeout(transport, 30000)
        if (!fetchedRefs || fetchedRefs.length === 0) {
          throw new Error("Repository not found or no refs available")
        }
        refs = fetchedRefs
        selectedTransport = transport
        if (i > 0) {
          console.warn(
            `[cloneRemoteRepoUtil] Discovered refs via fallback transport (${transport.name}) for ${url}`,
          )
        }
        break
      } catch (error) {
        discoveryError = error
        const hasNextTransport = i < cloneTransports.length - 1
        if (hasNextTransport && isLikelyCorsOrNetworkError(error)) {
          console.warn(
            `[cloneRemoteRepoUtil] Ref discovery failed via ${transport.name}, trying next transport:`,
            error,
          )
          continue
        }
        throw error
      }
    }

    if (!refs || refs.length === 0) {
      if (discoveryError) throw discoveryError
      throw new Error("Repository not found or no refs available")
    }

    const cloneTransportsToTry: CloneTransport[] = isGraspHttpRemote
      ? cloneTransports
      : [selectedTransport, ...cloneTransports.filter(transport => transport !== selectedTransport)]

    onProgress?.("Cloning repository...", 20)

    let cloneError: unknown = null
    for (let i = 0; i < cloneTransportsToTry.length; i++) {
      const transport = cloneTransportsToTry[i]

      const cloneOptions: any = {
        dir,
        url,
        corsProxy: transport.corsProxy,
        onAuth: getAuthCallback(url),
        singleBranch: false,
        noCheckout: false,
        onProgress: (progress: any) => {
          if (progress.phase === "Receiving objects") {
            const pct = 20 + (progress.loaded / progress.total) * 60
            onProgress?.(`Downloading objects (${progress.loaded}/${progress.total})...`, pct)
          } else if (progress.phase === "Resolving deltas") {
            const pct = 80 + (progress.loaded / progress.total) * 15
            onProgress?.(`Resolving deltas (${progress.loaded}/${progress.total})...`, pct)
          }
        },
      }
      if (depth && depth > 0) cloneOptions.depth = depth

      // Add timeout to prevent clone from hanging indefinitely (90 seconds per URL attempt)
      const cloneWithTimeout = async (timeoutMs: number = 90000) => {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(new Error(`Timeout: clone operation took longer than ${timeoutMs / 1000}s`)),
            timeoutMs,
          )
        })
        return Promise.race([git.clone(cloneOptions), timeoutPromise])
      }

      try {
        if (isGraspHttpRemote) {
          onProgress?.(`Cloning repository (${describeTransport(transport)})...`, 20)
        }
        await cloneWithTimeout(90000)
        if (i > 0) {
          console.warn(
            `[cloneRemoteRepoUtil] Clone succeeded via fallback transport (${transport.name}) for ${url}`,
          )
        }
        cloneError = null
        break
      } catch (error) {
        cloneError = error
        const hasNextTransport = i < cloneTransportsToTry.length - 1
        if (hasNextTransport && isLikelyCorsOrNetworkError(error)) {
          console.warn(
            `[cloneRemoteRepoUtil] Clone failed via ${transport.name}, trying next transport:`,
            error,
          )
          try {
            const fs: any = getProviderFs(git)
            await safeRmrf(fs, dir)
          } catch {
            // best effort cleanup before retrying
          }
          continue
        }
        throw error
      }
    }

    if (cloneError) throw cloneError

    // Ensure origin remote is properly configured with fetch refspec
    // isomorphic-git's clone may not create the full config in all cases
    await ensureOriginRemoteConfig(git, dir, url)

    onProgress?.("Setting up local branches...", 95)

    const defaultBranch = await resolveBranchName(git, dir)
    await git.checkout({dir, ref: defaultBranch})

    const headCommit = await git.resolveRef({dir, ref: "HEAD"})
    const branches = await git.listBranches({dir})

    const cache: RepoCache = {
      repoId: dir,
      lastUpdated: Date.now(),
      headCommit,
      dataLevel: depth ? "shallow" : "full",
      branches: branches.map((name: string) => ({name, commit: ""})),
      cloneUrls: [url],
    }

    await cacheManager.init()
    await cacheManager.setRepoCache(cache)

    onProgress?.("Clone completed successfully!", 100)
  } catch (error) {
    // Clean up on failure using provider fs, but ignore errors
    try {
      const fs: any = getProviderFs(git)
      await safeRmrf(fs, dir)
    } catch {}

    throw new Error(`Clone failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
