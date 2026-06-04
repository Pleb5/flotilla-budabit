import {getGitProvider} from "../api/git-provider.js"
import {parseRepoId} from "../utils/repo-id.js"
import {fileTypeFromBuffer} from "file-type"
import {createPatch} from "diff"
import type {RepoAnnouncement} from "../events/index.js"
import type {PermalinkData} from "./permalink.js"
import {Buffer} from "buffer"
import {
  createInvalidInputError,
  createInvalidRefspecError,
  createTimeoutError,
  type GitErrorContext,
  wrapError,
} from "../errors/index.js"
import {buildAdvertisedBranchCandidates, discoverAdvertisedRefs} from "../utils/advertised-refs.js"
import {buildBranchRefCandidates, normalizeBranchName} from "../utils/branch-refs.js"
import {filterValidCloneUrls, withUrlFallback} from "../utils/clone-url-fallback.js"

// Only set Buffer on window if we're in a browser context (not in a worker)
if (typeof window !== "undefined" && typeof window.Buffer === "undefined") {
  ;(window as any).Buffer = Buffer
}

export const rootDir = "/repos"

// Track the depth we've already fetched for each repo to avoid redundant deepening
const repoDepthCache: Map<string, {depth: number; timestamp: number}> = new Map()
const DEPTH_CACHE_TTL_MS = 60_000 // 60 seconds

/** Clear the repo depth cache - exported for testing */
export function clearRepoDepthCache(): void {
  repoDepthCache.clear()
}

export function getUsableCloneUrls(repoEvent: Pick<RepoAnnouncement, "clone">): string[] {
  const urls: string[] = []

  for (const rawUrl of repoEvent.clone || []) {
    const url = String(rawUrl || "").trim()
    if (!url) continue

    if (url.startsWith("git@")) {
      const httpsUrl = sshToHttps(url)
      if (httpsUrl) urls.push(httpsUrl)
      continue
    }

    if (/^https?:\/\//.test(url)) {
      urls.push(url)
    }
  }

  return Array.from(new Set(filterValidCloneUrls(urls)))
}

/**
 * Detect the default branch name from a repository's HEAD reference
 * @param repoEvent Repository event
 * @returns Promise resolving to the default branch name
 */
export async function detectDefaultBranch(
  repoEvent: RepoAnnouncement,
  repoKey?: string,
): Promise<string> {
  const git = getGitProvider()
  const dir = `${rootDir}/${repoKey || parseRepoId(repoEvent.repoId)}`

  const listBranchNames = async (): Promise<string[]> => {
    const branchNames = new Set<string>()

    try {
      const localBranches = await git.listBranches({dir})
      for (const branch of localBranches || []) {
        if (branch) branchNames.add(String(branch))
      }
    } catch {
      // pass
    }

    try {
      const remoteBranches = await git.listBranches({dir, remote: "origin"})
      for (const branch of remoteBranches || []) {
        const normalized = String(branch || "").replace(/^origin\//, "")
        if (normalized) branchNames.add(normalized)
      }
    } catch {
      // pass
    }

    if (branchNames.size === 0 && typeof git.listRefs === "function") {
      try {
        const refs = await git.listRefs({dir})
        for (const entry of refs || []) {
          const ref = typeof entry === "string" ? entry : entry?.ref
          if (typeof ref === "string" && ref.startsWith("refs/heads/")) {
            branchNames.add(ref.replace("refs/heads/", ""))
          }
        }
      } catch {
        // pass
      }
    }

    return Array.from(branchNames)
  }

  try {
    // First try to get the symbolic ref for HEAD
    const headRef = await git.resolveRef({dir, ref: "HEAD", depth: 2})

    // If HEAD points to a symbolic ref, extract the branch name
    if (headRef && typeof headRef === "string" && headRef.startsWith("refs/heads/")) {
      return headRef.replace("refs/heads/", "")
    }

    const branchNames = await listBranchNames()

    // Look for common default branch names in order of preference
    const commonDefaults = ["main", "master", "develop", "dev"]
    for (const defaultName of commonDefaults) {
      if (branchNames.includes(defaultName)) {
        return defaultName
      }
    }

    // If no common defaults found, use the first branch
    const firstBranch = branchNames[0]
    if (firstBranch) {
      return firstBranch
    }
  } catch (error) {
    console.warn("Failed to detect default branch:", error)
  }

  // Ultimate fallback
  return "main"
}

/**
 * Get the default branch for a repository, with caching
 */
const defaultBranchCache = new Map<string, string>()

export async function getDefaultBranch(
  repoEvent: RepoAnnouncement,
  repoKey?: string,
): Promise<string> {
  const cacheKey = repoKey || parseRepoId(repoEvent.repoId)

  if (defaultBranchCache.has(cacheKey)) {
    return defaultBranchCache.get(cacheKey)!
  }

  const defaultBranch = await detectDefaultBranch(repoEvent, repoKey)
  defaultBranchCache.set(cacheKey, defaultBranch)

  return defaultBranch
}

/**
 * Resolve a branch name to its OID with fallback logic
 * @param git Git provider instance
 * @param dir Repository directory
 * @param preferredBranch Preferred branch name to resolve
 * @param options Optional configuration for error handling
 * @returns Promise resolving to the OID of the resolved branch
 */
export async function resolveBranchToOid(
  git: any,
  dir: string,
  preferredBranch?: string,
  options?: {onBranchNotFound?: (branchName: string, error: any) => void},
): Promise<string> {
  let lastError: unknown = null

  // Try preferred branch and common fallbacks
  const branchesToTry = [preferredBranch, "main", "master", "develop", "dev"]
    .map(branch => normalizeBranchName(branch))
    .filter(Boolean) as string[]

  for (const branchName of branchesToTry) {
    let branchResolved = false
    for (const refCandidate of buildBranchRefCandidates(branchName)) {
      try {
        const oid = await git.resolveRef({dir, ref: refCandidate})
        console.log(
          `Successfully resolved branch '${branchName}' via '${refCandidate}' to OID: ${oid.substring(0, 8)}`,
        )
        return oid
      } catch (branchError: any) {
        console.log(
          `Failed to resolve branch '${branchName}' via '${refCandidate}':`,
          branchError.message || String(branchError),
        )
        lastError = branchError
      }
    }
    // Call the callback once per branch name if none of the ref candidates worked
    if (!branchResolved && options?.onBranchNotFound) {
      options.onBranchNotFound(branchName, lastError)
    }
  }

  // Try to get the latest commit from the log (works even without branch refs)
  try {
    const commits = await git.log({dir, depth: 1})
    if (commits && commits.length > 0 && commits[0].oid) {
      console.log(`[resolveBranchToOid] Found commit from log: ${commits[0].oid.substring(0, 8)}`)
      return commits[0].oid
    }
  } catch (logError) {
    console.log(`[resolveBranchToOid] git.log also failed:`, logError)
  }

  const context: GitErrorContext & {repoDir?: string} = {
    operation: "resolveBranchToOid",
    ref: preferredBranch,
    repoDir: dir,
  }
  if (lastError) {
    throw wrapError(lastError, context)
  }
  throw createInvalidRefspecError(context)
}

export async function fetchPermalink(data: PermalinkData) {
  const dir = `${rootDir}/${data.owner}/${data.repo}`
  try {
    await ensureRepo({host: data.host, owner: data.owner, repo: data.repo, branch: data.branch})
    const git = getGitProvider()
    const commitOid = await git.resolveRef({dir, ref: data.branch})
    const {blob} = await git.readBlob({dir, oid: commitOid, filepath: data.filePath})
    const decoder = new TextDecoder("utf-8")
    let content = decoder.decode(blob)

    if (data.startLine !== undefined) {
      const lines = content.split("\n")
      const end = data.endLine ?? data.startLine
      content = lines.slice(data.startLine - 1, end).join("\n")
    }
    return content
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : err}`
  }
}

export async function isRepoCloned(dir: string): Promise<boolean> {
  const git = getGitProvider()
  try {
    await git.resolveRef({dir, ref: "HEAD"})
    return true
  } catch {
    return false
  }
}

export async function ensureRepo(
  opts: {host: string; owner: string; repo: string; branch: string},
  depth: number = 1,
) {
  const git = getGitProvider()
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`
  const remoteUrl = `https://${opts.host}/${opts.owner}/${opts.repo}.git`
  const baseContext: GitErrorContext & {repoDir: string} = {
    operation: "ensureRepo",
    remote: remoteUrl,
    ref: opts.branch,
    repoDir: dir,
  }
  if (!(await isRepoCloned(dir))) {
    console.log(`Cloning ${remoteUrl} to ${dir} (depth: ${depth})`)

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(createTimeoutError(baseContext)), 60000)
    })

    const clonePromise = git.clone({
      dir,
      url: remoteUrl,
      ref: opts.branch,
      depth: Math.min(depth, 1), // Force shallow clone for large repos
      noCheckout: true,
      noTags: true,
      singleBranch: true,
      // Optimize for speed over completeness
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Only last 30 days
      onProgress: (progress: any) => {
        // Only log major progress milestones to reduce overhead
        if (progress.phase === "Receiving objects" || progress.phase === "Resolving deltas") {
          console.log(
            `${progress.phase}: ${progress.loaded}/${progress.total} (${Math.round((progress.loaded / progress.total) * 100)}%)`,
          )
        }
      },
    })

    // Race between clone and timeout
    try {
      await Promise.race([clonePromise, timeoutPromise])
      console.log(`Successfully cloned https://${opts.host}/${opts.owner}/${opts.repo}.git`)
    } catch (error) {
      console.error(`Clone failed for ${remoteUrl}:`, error)
      // Clean up partial clone on failure
      try {
        await git.deleteRef({dir, ref: "HEAD"})
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw wrapError(error, baseContext)
    }
  } else {
    console.log(`Repository already cloned at ${dir}`)
    git.fetch({dir, ref: opts.branch})
  }
}

export async function ensureRepoFromEvent(
  opts: {repoEvent: RepoAnnouncement; branch?: string; repoKey?: string},
  depth: number = 1,
) {
  const git = getGitProvider()
  const repoKey = opts.repoKey || parseRepoId(opts.repoEvent.repoId)
  const dir = `${rootDir}/${repoKey}`
  const cloneUrls = getUsableCloneUrls(opts.repoEvent)

  if (cloneUrls.length === 0) {
    throw createInvalidInputError("No supported clone URL found in repo announcement", {
      operation: "ensureRepoFromEvent",
      naddr: opts.repoEvent.repoId,
      repoKey: opts.repoKey,
      repoDir: dir,
    })
  }

  // Use the first URL for context; clone/fetch operations try the full list below.
  let cloneUrl = cloneUrls[0]

  const isCloned = await isRepoCloned(dir)

  // Determine the branch to use
  let targetBranch = opts.branch
  const baseContext: GitErrorContext & {repoDir: string; repoKey?: string} = {
    operation: "ensureRepoFromEvent",
    remote: cloneUrl,
    naddr: opts.repoEvent.repoId,
    repoKey: opts.repoKey,
    repoDir: dir,
  }

  if (!targetBranch && isCloned) {
    // If repo exists, detect the actual default branch
    try {
      targetBranch = await detectDefaultBranch(opts.repoEvent, opts.repoKey)
    } catch (error) {
      console.warn(
        "Failed to detect default branch, will use robust resolution after clone:",
        error,
      )
      targetBranch = "main" // Temporary, will be resolved robustly after clone
    }
  }

  const resolveCloneBranch = async (url: string): Promise<string> => {
    if (targetBranch) return targetBranch

    try {
      const advertised = await discoverAdvertisedRefs(git, {url})
      return (
        buildAdvertisedBranchCandidates({
          headBranch: advertised.headBranch,
          branches: advertised.branches,
        })[0] || "main"
      )
    } catch (error) {
      console.warn("Failed to inspect remote refs before clone, falling back to main:", error)
      return "main"
    }
  }

  if (targetBranch) {
    baseContext.ref = targetBranch
  }

  if (!isCloned) {
    const cloneResult = await withUrlFallback(
      cloneUrls,
      async (url: string) => {
        const refForClone = await resolveCloneBranch(url)
        const cloneContext = {...baseContext, remote: url, ref: refForClone}

        console.log(`Cloning ${url} to ${dir} (depth: ${depth})`)

        // Create a timeout promise to prevent infinite stalling
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(createTimeoutError(cloneContext)), 60000)
        })

        // Clone the best-known branch explicitly.
        // This avoids remote HEAD lookups for headless servers while keeping checkout deferred.
        // Use noCheckout: true to avoid "commit not available locally" errors during shallow clones
        // We'll manually set up refs afterward
        // Use singleBranch: true for shallow clones - non-GitHub servers (Forgejo, Gitea)
        // don't properly handle singleBranch: false with shallow depth during pack negotiation
        const clonePromise = git.clone({
          dir,
          url,
          ref: refForClone,
          singleBranch: true, // Critical: use single branch for shallow clone compatibility
          depth,
          noCheckout: true, // Avoid checkout errors when commit not in shallow fetch
          noTags: true,
          // Optimize for speed over completeness
          since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Only last 30 days
          onProgress: (progress: any) => {
            // Only log major progress milestones to reduce overhead
            if (progress.phase === "Receiving objects" || progress.phase === "Resolving deltas") {
              console.log(
                `${progress.phase}: ${progress.loaded}/${progress.total} (${Math.round((progress.loaded / progress.total) * 100)}%)`,
              )
            }
          },
          onMessage: (message: any) => console.log("Git message:", message),
        })

        try {
          await Promise.race([clonePromise, timeoutPromise])
          return {url, branch: refForClone}
        } catch (error) {
          console.error(`Clone failed for ${url}:`, error)
          // Clean up partial clone on failure
          try {
            await git.deleteRef({dir, ref: "HEAD"})
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
          throw error
        }
      },
      {repoId: repoKey, perUrlTimeoutMs: 0},
    )

    if (!cloneResult.success) {
      const lastAttempt = cloneResult.attempts[cloneResult.attempts.length - 1]
      const error = new Error(
        `Clone failed for all ${cloneResult.attempts.length} URL(s): ${lastAttempt?.error || "Unknown error"}`,
      )
      throw wrapError(error, {
        ...baseContext,
        remote: lastAttempt?.url || cloneUrl,
      })
    }

    cloneUrl = cloneResult.usedUrl || cloneUrl
    targetBranch = cloneResult.result?.branch || targetBranch
    baseContext.remote = cloneUrl
    if (targetBranch) {
      baseContext.ref = targetBranch
    }

    try {
      console.log(`Successfully cloned ${cloneUrl}`)

      // After successful clone, detect the actual default branch
      let actualDefault = targetBranch || "main"
      try {
        actualDefault = await detectDefaultBranch(opts.repoEvent, opts.repoKey)
        defaultBranchCache.set(opts.repoKey || parseRepoId(opts.repoEvent.repoId), actualDefault)
        console.log(`Detected default branch: ${actualDefault}`)
      } catch (error) {
        console.warn("Failed to detect default branch after clone:", error)
      }

      // CRITICAL: isomorphic-git's clone from ngit relays (relay.ngit.dev, gitnostr.com)
      // sometimes doesn't create local branch refs even though commits were fetched.
      // This is because shallow clones with singleBranch may not create refs properly.
      // We need to explicitly create local branches from whatever refs we can find.
      try {
        const branches = await git.listBranches({dir})
        if (branches.length === 0) {
          console.log("[ensureRepoFromEvent] No local branches after clone, creating from refs")

          let createdBranch = false
          const branchName = actualDefault || "main"

          // Strategy 1: Try to find remote tracking refs and create local branches from them
          try {
            const remoteBranches = await git.listBranches({dir, remote: "origin"})
            if (remoteBranches.length > 0) {
              const remoteBranch = remoteBranches[0]
              const remoteRef = `refs/remotes/origin/${remoteBranch}`
              const oid = await git.resolveRef({dir, ref: remoteRef})
              await git.writeRef({dir, ref: `refs/heads/${remoteBranch}`, value: oid, force: true})
              await git.writeRef({
                dir,
                ref: "HEAD",
                value: `ref: refs/heads/${remoteBranch}`,
                symbolic: true,
                force: true,
              })
              console.log(
                `[ensureRepoFromEvent] Created branch '${remoteBranch}' from remote tracking ref, oid: ${oid.substring(0, 8)}`,
              )
              createdBranch = true
            } else {
              console.log("[ensureRepoFromEvent] listBranches returned empty array for remote origin")
            }
          } catch (remoteRefErr: any) {
            console.log(
              `[ensureRepoFromEvent] No remote tracking refs found: ${remoteRefErr.message}`,
            )
          }

          // Strategy 2: Try to read HEAD directly (might be a commit OID after shallow clone)
          if (!createdBranch) {
            try {
              const headOid = await git.resolveRef({dir, ref: "HEAD", depth: 1})
              if (headOid && headOid.length === 40) {
                await git.writeRef({
                  dir,
                  ref: `refs/heads/${branchName}`,
                  value: headOid,
                  force: true,
                })
                await git.writeRef({
                  dir,
                  ref: "HEAD",
                  value: `ref: refs/heads/${branchName}`,
                  symbolic: true,
                  force: true,
                })
                console.log(
                  `[ensureRepoFromEvent] Created branch '${branchName}' from HEAD OID: ${headOid.substring(0, 8)}`,
                )
                createdBranch = true
              }
            } catch (headErr: any) {
              console.log(`[ensureRepoFromEvent] HEAD resolution failed: ${headErr.message}`)
            }
          }

          // Strategy 3: Try FETCH_HEAD (isomorphic-git creates this during fetch/clone)
          if (!createdBranch) {
            try {
              const fetchHead = await git.resolveRef({dir, ref: "FETCH_HEAD"})
              if (fetchHead) {
                await git.writeRef({
                  dir,
                  ref: `refs/heads/${branchName}`,
                  value: fetchHead,
                  force: true,
                })
                await git.writeRef({
                  dir,
                  ref: "HEAD",
                  value: `ref: refs/heads/${branchName}`,
                  symbolic: true,
                  force: true,
                })
                console.log(
                  `[ensureRepoFromEvent] Created branch '${branchName}' from FETCH_HEAD: ${fetchHead.substring(0, 8)}`,
                )
                createdBranch = true
              }
            } catch (fetchHeadErr: any) {
              console.log(
                `[ensureRepoFromEvent] FETCH_HEAD resolution failed: ${fetchHeadErr.message}`,
              )
            }
          }

          // Strategy 4: Try git.log to find commits in the object store
          if (!createdBranch) {
            try {
              const commits = await git.log({dir, depth: 1})
              if (commits && commits.length > 0 && commits[0].oid) {
                await git.writeRef({
                  dir,
                  ref: `refs/heads/${branchName}`,
                  value: commits[0].oid,
                  force: true,
                })
                await git.writeRef({
                  dir,
                  ref: "HEAD",
                  value: `ref: refs/heads/${branchName}`,
                  symbolic: true,
                  force: true,
                })
                console.log(
                  `[ensureRepoFromEvent] Created branch '${branchName}' from git.log: ${commits[0].oid.substring(0, 8)}`,
                )
                createdBranch = true
              }
            } catch (logErr: any) {
              console.log(`[ensureRepoFromEvent] git.log failed: ${logErr.message}`)
            }
          }

          // Strategy 5: Last resort - try fetching from alternative URLs
          if (!createdBranch) {
            console.log("[ensureRepoFromEvent] Trying alternative URLs as last resort")
            const branchesToTry = [actualDefault, "main", "master"].filter(Boolean)

            for (const url of cloneUrls) {
              if (createdBranch) break

              for (const branch of branchesToTry) {
                try {
                  console.log(`[ensureRepoFromEvent] Fetching ${branch} from ${url}`)
                  const fetchResult = await git.fetch({
                    dir,
                    url,
                    ref: branch,
                    depth,
                    singleBranch: true,
                  })

                  if (fetchResult?.fetchHead) {
                    console.log(
                      `[ensureRepoFromEvent] Fetch succeeded from ${url}, fetchHead: ${fetchResult.fetchHead}`,
                    )
                    await git.writeRef({
                      dir,
                      ref: `refs/heads/${branch}`,
                      value: fetchResult.fetchHead,
                      force: true,
                    })
                    await git.writeRef({
                      dir,
                      ref: "HEAD",
                      value: `ref: refs/heads/${branch}`,
                      symbolic: true,
                      force: true,
                    })
                    console.log(`[ensureRepoFromEvent] Created branch '${branch}' from fetchHead`)
                    createdBranch = true
                    break
                  }
                } catch (fetchErr: any) {
                  console.log(
                    `[ensureRepoFromEvent] Fetch failed for ${branch} from ${url}: ${fetchErr.message}`,
                  )
                }
              }
            }
          }

          if (!createdBranch) {
            console.warn("[ensureRepoFromEvent] Could not create local branch from any source")
          }
        }
      } catch (refError) {
        console.warn("[ensureRepoFromEvent] Error checking/creating refs after clone:", refError)
      }
    } catch (error) {
      console.error(`Clone failed for ${cloneUrl}:`, error)
      // Clean up partial clone on failure
      try {
        await git.deleteRef({dir, ref: "HEAD"})
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw wrapError(error, baseContext)
    }
  } else if (depth > 1) {
    // Repository exists but might be shallow - try to deepen it if we need more history
    // Check if we've already fetched sufficient depth recently
    const cacheKey = dir
    const cached = repoDepthCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < DEPTH_CACHE_TTL_MS && cached.depth >= depth) {
      console.log(
        `Repository at ${dir} already has depth ${cached.depth} (requested: ${depth}), skipping fetch`,
      )
      return
    }

    try {
      console.log(`Repository exists at ${dir}, attempting to fetch more history (depth: ${depth})`)

      // Use robust branch resolution instead of hardcoded fallback
      const resolvedBranch = await resolveBranchToOid(git, dir, targetBranch)

      const fetchResult = await withUrlFallback(
        cloneUrls,
        async (url: string) => {
          await git.fetch({
            dir,
            url,
            ref: resolvedBranch,
            depth,
            singleBranch: true,
          })
          return {url}
        },
        {repoId: repoKey, perUrlTimeoutMs: 15000},
      )

      if (fetchResult.success) {
        console.log(
          `Successfully deepened repository using ${fetchResult.usedUrl} for resolved branch '${resolvedBranch}' to depth ${depth}`,
        )

        // Update the depth cache
        repoDepthCache.set(cacheKey, {depth, timestamp: now})
      } else {
        const lastAttempt = fetchResult.attempts[fetchResult.attempts.length - 1]
        const fetchError = new Error(lastAttempt?.error || "Fetch failed for all clone URLs")
        console.log(
          `Failed to fetch resolved branch '${resolvedBranch}':`,
          fetchError.message || String(fetchError),
        )
        throw wrapError(fetchError, {
          ...baseContext,
          operation: "ensureRepoFromEvent/deepen",
          remote: lastAttempt?.url || cloneUrl,
          ref: resolvedBranch,
        })
      }
    } catch (error) {
      console.warn(`Failed to deepen repository, continuing with existing clone:`, error)
      // Continue with existing clone even if deepening fails
    }
  }
}

export function sshToHttps(sshUrl: string): string | null {
  // Match git@host:user/repo(.git)
  const match = sshUrl.match(/^git@([^:]+):(.+?)(\.git)?$/)
  if (match) {
    const [, host, path] = match
    return `https://${host}/${path}.git`
  }
  return null
}

/**
 * Attempts to guess a file's MIME type from its bytes (accurate),
 * then falls back to extension-based detection
 *
 * @param data - The file data as Uint8Array (optional, but recommended).
 * @param extension - The file extension, e.g. "png" or ".png" (optional).
 * @returns e.g. "image/png", "text/markdown", or "application/octet-stream"
 */
export async function determineMimeType(data?: Uint8Array, extension?: string): Promise<string> {
  if (data) {
    const ftResult = await fileTypeFromBuffer(data)
    if (ftResult?.mime) return ftResult.mime
  }
  if (extension) {
    const ext = extension.replace(/^\./, "").toLowerCase()
    const map: Record<string, string> = {
      // text/code
      md: "text/markdown",
      markdown: "text/markdown",
      txt: "text/plain",
      html: "text/html",
      css: "text/css",
      js: "application/javascript",
      mjs: "application/javascript",
      cjs: "application/javascript",
      ts: "application/typescript",
      tsx: "application/typescript",
      jsx: "text/jsx",
      json: "application/json",
      yaml: "application/x-yaml",
      yml: "application/x-yaml",
      svelte: "text/svelte",
      vue: "text/vue",
      // images
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      bmp: "image/bmp",
      // fonts
      ttf: "font/ttf",
      otf: "font/otf",
      woff: "font/woff",
      woff2: "font/woff2",
      // archives
      zip: "application/zip",
      gz: "application/gzip",
      tar: "application/x-tar",
      tgz: "application/gzip",
      // docs
      pdf: "application/pdf",
    }
    const extBasedMime = map[ext]
    if (extBasedMime) return extBasedMime
  }
  return "application/octet-stream"
}

/**
 * Produce a Git-style diff (unified patch) for the commit or diff link
 * described in PermalinkData.
 *
 * @param data - PermalinkData from parsePermalink - a parsed GitHub diff URL
 * @returns The entire patch as a string (unified diff) or the error message.
 */
export async function produceGitDiffFromPermalink(data: PermalinkData): Promise<string> {
  const git = getGitProvider()
  const dir = `${rootDir}/${data.owner}/${data.repo}`
  try {
    await ensureRepo(data)
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : err}`
  }

  const newOid = data.branch
  if (!newOid)
    throw createInvalidInputError("No commit SHA found in permalink data", {
      operation: "produceGitDiffFromPermalink",
      repoDir: dir,
      ref: data.branch,
    })
  const {commit} = await git.readCommit({dir, oid: newOid})
  const parentOid = commit.parent[0]

  if (!parentOid) {
    return await generateMultiFilePatch(dir, "4b825dc642cb6eb9a060e54bf8d69288fbee4904", newOid)
  }

  const changes = await getFileChanges(dir, parentOid, newOid)

  if (data.diffFileHash && changes.length) {
    const match = await findDiffMatch(changes, data.diffFileHash)
    if (match) {
      return await createFilePatch(dir, parentOid, newOid, match.filepath, match.type)
    }
  }

  return await generateMultiFilePatch(dir, parentOid, newOid, changes)
}

async function findDiffMatch(
  changes: {filepath: string; type: "add" | "remove" | "modify"}[],
  diffFileHash: string,
) {
  for (const c of changes) {
    if ((await githubPermalinkDiffId(c.filepath)) === diffFileHash) return c
  }
  return null
}

async function generateMultiFilePatch(
  dir: string,
  oldOid: string,
  newOid: string,
  changes?: {filepath: string; type: "add" | "remove" | "modify"}[],
) {
  if (!changes) changes = await getFileChanges(dir, oldOid, newOid)
  const patches: string[] = []
  for (const ch of changes!) {
    const patch = await createFilePatch(dir, oldOid, newOid, ch.filepath, ch.type)
    if (patch.trim()) patches.push(patch)
  }
  return patches.join("")
}

/**
 * Return an array describing how files changed between two commits.
 */
async function getFileChanges(
  dir: string,
  oldOid: string,
  newOid: string,
): Promise<
  Array<{filepath: string; type: "add" | "remove" | "modify"; Aoid?: string; Boid?: string}>
> {
  const git = getGitProvider()
  const results = await git.walk({
    dir,
    trees: [git.TREE({ref: oldOid}), git.TREE({ref: newOid})],
    map: async (filepath: string, [A, B]: [any, any]) => {
      if (filepath === ".") return
      const Atype = await A?.type()
      const Btype = await B?.type()
      if (Atype === "tree" || Btype === "tree") return
      const Aoid = await A?.oid()
      const Boid = await B?.oid()
      if (Aoid === Boid) return
      let type: "add" | "remove" | "modify" = "modify"
      if (Aoid === undefined) type = "add"
      if (Boid === undefined) type = "remove"
      return {filepath, type, Aoid, Boid}
    },
  })
  return results.filter(Boolean)
}

/**
 * Generate a patch for a single file by reading old/new contents
 */
async function createFilePatch(
  dir: string,
  oldOid: string,
  newOid: string,
  filepath: string,
  changeType: "add" | "remove" | "modify",
) {
  const git = getGitProvider()

  const decoder = new TextDecoder("utf-8")

  const readTextAt = async (oid: string): Promise<string> => {
    try {
      const res = await git.readBlob({dir, oid, filepath})
      const blob: any = (res as any)?.blob
      if (!blob) return ""
      if (typeof blob === "string") return blob
      return decoder.decode(blob as Uint8Array)
    } catch {
      return ""
    }
  }

  const oldText = oldOid ? await readTextAt(oldOid) : ""
  const newText = newOid ? await readTextAt(newOid) : ""

  const oldLabel = oldOid ? oldOid.slice(0, 7) : ""
  const newLabel = newOid ? newOid.slice(0, 7) : ""

  // changeType is currently unused but kept for future improvements (e.g., mode headers)
  void changeType

  return createPatch(filepath, oldText, newText, oldLabel, newLabel)
}

/**
 * GitHub diff anchors for blob permalinks use SHA-256 of the file path
 */
export async function githubPermalinkDiffId(filePath: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(filePath)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
  return hex
}

/**
 * Attempt to find which file changed in parentOid..newOid matches
 * the "diff-<sha256(path)>" anchor from GitHub blob permalink.
 */
export async function mapDiffHashToFile(
  dir: string,
  oldOid: string,
  newOid: string,
  diffFileHash: string,
): Promise<{filepath: string; type: "add" | "remove" | "modify"} | null> {
  const changes = await getFileChanges(dir, oldOid, newOid)
  if (!changes.length) return null

  if (changes.length === 1) {
    return changes[0]
  }

  for (const c of changes) {
    const hash = await githubPermalinkDiffId(c.filepath)
    if (hash === diffFileHash) {
      return c
    }
  }
  return null
}
