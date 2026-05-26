// Crypto polyfill for worker context where crypto.subtle may be unavailable
// Must be at the very top before any other imports that might use crypto
// In insecure contexts (HTTP), crypto.subtle exists but operations fail
;(function initWorkerCryptoPolyfill() {
  const globalScope: any = typeof self !== "undefined" ? self : globalThis

  // Always install polyfill in insecure contexts (HTTP) where crypto.subtle won't work
  const isInsecure =
    typeof globalScope.isSecureContext !== "undefined" && !globalScope.isSecureContext
  const needsPolyfill = !globalScope.crypto?.subtle?.digest || isInsecure

  if (needsPolyfill) {
    console.warn(
      "[Worker] Installing crypto.subtle polyfill (insecure context or missing crypto.subtle)",
    )

    // SHA-256 implementation
    function sha256(data: Uint8Array): Uint8Array {
      const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
      ])
      const H = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
      ])

      const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n))
      const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z)
      const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z)
      const sigma0 = (x: number) => rotr(2, x) ^ rotr(13, x) ^ rotr(22, x)
      const sigma1 = (x: number) => rotr(6, x) ^ rotr(11, x) ^ rotr(25, x)
      const gamma0 = (x: number) => rotr(7, x) ^ rotr(18, x) ^ (x >>> 3)
      const gamma1 = (x: number) => rotr(17, x) ^ rotr(19, x) ^ (x >>> 10)

      // Padding
      const bitLen = data.length * 8
      const padLen = (data.length % 64 < 56 ? 56 : 120) - (data.length % 64)
      const padded = new Uint8Array(data.length + padLen + 8)
      padded.set(data)
      padded[data.length] = 0x80
      const view = new DataView(padded.buffer)
      view.setUint32(padded.length - 4, bitLen, false)

      // Process blocks
      const h = new Uint32Array(H)
      const w = new Uint32Array(64)
      for (let i = 0; i < padded.length; i += 64) {
        for (let j = 0; j < 16; j++) {
          w[j] = view.getUint32(i + j * 4, false)
        }
        for (let j = 16; j < 64; j++) {
          w[j] = (gamma1(w[j - 2]) + w[j - 7] + gamma0(w[j - 15]) + w[j - 16]) >>> 0
        }
        let [a, b, c, d, e, f, g, hh] = h
        for (let j = 0; j < 64; j++) {
          const t1 = (hh + sigma1(e) + ch(e, f, g) + K[j] + w[j]) >>> 0
          const t2 = (sigma0(a) + maj(a, b, c)) >>> 0
          hh = g
          g = f
          f = e
          e = (d + t1) >>> 0
          d = c
          c = b
          b = a
          a = (t1 + t2) >>> 0
        }
        h[0] = (h[0] + a) >>> 0
        h[1] = (h[1] + b) >>> 0
        h[2] = (h[2] + c) >>> 0
        h[3] = (h[3] + d) >>> 0
        h[4] = (h[4] + e) >>> 0
        h[5] = (h[5] + f) >>> 0
        h[6] = (h[6] + g) >>> 0
        h[7] = (h[7] + hh) >>> 0
      }
      const result = new Uint8Array(32)
      const resultView = new DataView(result.buffer)
      for (let i = 0; i < 8; i++) resultView.setUint32(i * 4, h[i], false)
      return result
    }

    const polyfillSubtle = {
      digest: async (algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
        const algo = algorithm.toLowerCase().replace("-", "")
        if (algo !== "sha256") throw new Error(`Unsupported algorithm: ${algorithm}`)
        const input =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(
                (data as ArrayBufferView).buffer,
                (data as ArrayBufferView).byteOffset,
                (data as ArrayBufferView).byteLength,
              )
        const result = sha256(input)
        // Copy to a new ArrayBuffer to avoid SharedArrayBuffer issues
        const output = new ArrayBuffer(result.length)
        new Uint8Array(output).set(result)
        return output
      },
    }

    if (!globalScope.crypto) globalScope.crypto = {}
    globalScope.crypto.subtle = polyfillSubtle
    console.log("[Worker] crypto.subtle polyfill installed successfully")
  }
})()

import {expose} from "comlink"
import httpWeb from "isomorphic-git/http/web"
import {diffArrays} from "diff"

import type {GitProvider} from "../git/provider.js"
import {createGitProvider} from "../git/factory-browser.js"
import {rootDir} from "../git/git.js"
import {
  getPRPreviewData,
  getCommitsAheadOfTipData,
  getMergeBaseBetween as getMergeBaseBetweenData,
} from "../git/merge-analysis.js"

import {
  wrapError,
  isGitError,
  type GitError,
  type GitErrorContext,
  GitErrorCode,
  GitErrorCategory,
} from "../errors/index.js"

import type {EventIO} from "../types/index.js"
import type {BlossomPushSummary} from "../blossom/index.js"
import {
  getNostrGitProvider,
  initializeNostrGitProvider,
  hasNostrGitProvider,
} from "../api/git-provider.js"

import {parseRepoId} from "../utils/repo-id.js"
import {listAdvertisedServerRefs} from "../utils/advertised-refs.js"
import {
  filterValidCloneUrls,
  reorderUrlsByPreference,
  withUrlFallback,
} from "../utils/clone-url-fallback.js"
import {isGraspRepoHttpUrl} from "../utils/grasp-url.js"

import type {AuthConfig} from "./workers/auth.js"
import {getAuthCallback, getConfiguredAuthHosts, setAuthConfig} from "./workers/auth.js"
import type {GitWorkerConfig} from "./workers/git-config.js"
import {
  applyGitConfigToProvider,
  setGitConfig as setWorkerGitConfig,
  resolveDefaultCorsProxy,
} from "./workers/git-config.js"
import {createNip98HttpClient} from "../git/nip98-http-client.js"

// Import event-based git operations
import {
  listRepoFilesFromEvent,
  getRepoFileContentFromEvent,
  fileExistsAtCommit,
  getFileHistory,
} from "../git/files.js"
import {listBranchesFromEvent} from "../git/branches.js"
import type {RepoAnnouncementEvent} from "../events/index.js"

import {resolveBranchName as resolveRobustBranchUtil} from "./workers/branches.js"
import {buildCommitHistoryRefsToTry} from "./workers/commit-history.js"
import {getProviderFs, isRepoClonedFs} from "./workers/fs-utils.js"

import type {RepoCache} from "./workers/cache.js"
import {RepoCacheManager} from "./workers/cache.js"

import type {CloneRemoteRepoOptions} from "./workers/repos.js"
import {
  clearCloneTracking,
  cloneRemoteRepoUtil,
  ensureFullCloneUtil,
  ensureOriginRemoteConfig,
  ensureShallowCloneUtil,
  initializeRepoUtil,
  smartInitializeRepoUtil,
} from "./workers/repos.js"

import {needsUpdateUtil, syncWithRemoteUtil} from "./workers/sync.js"

import type {AnalyzePRMergeOptions, MergePRAndPushOptions} from "./workers/pr-merge.js"
import {analyzePRMergeUtil, mergePRAndPushUtil} from "./workers/pr-merge.js"

import type {SafePushOptions} from "./workers/push.js"
import {safePushToRemoteUtil} from "./workers/push.js"
import {
  discoverRemoteBackfillUtil,
  executeRemoteBackfillUtil,
  prepareRemoteBackfillUtil,
} from "./workers/remote-backfill.js"

import {
  getGitignoreTemplate,
  getLicenseTemplate,
  createLocalRepo,
  createRemoteRepo,
  forkAndCloneRepo,
  deleteRemoteRepo,
  updateRemoteRepoMetadata,
  updateAndPushFiles,
  type CreateLocalRepoOptions,
  type CreateRemoteRepoOptions,
  type ForkAndCloneOptions,
  type DeleteRemoteRepoOptions,
  type UpdateRemoteRepoMetadataOptions,
  type UpdateAndPushFilesOptions,
} from "./workers/repo-management.js"

type DataLevel = "refs" | "shallow" | "full"

function toPlain<T>(val: T): T {
  try {
    return JSON.parse(JSON.stringify(val))
  } catch {
    return val
  }
}

function buildModifiedFileDiffHunks(
  oldText: string,
  newText: string,
): Array<{
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patches: Array<{line: string; type: "+" | "-" | " "}>
}> {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const chunks = diffArrays(oldLines, newLines)
  const patches: Array<{line: string; type: "+" | "-" | " "}> = []

  for (const chunk of chunks) {
    const lines = chunk.value || []
    if (chunk.added) {
      for (const line of lines) patches.push({line, type: "+"})
    } else if (chunk.removed) {
      for (const line of lines) patches.push({line, type: "-"})
    } else {
      for (const line of lines) patches.push({line, type: " "})
    }
  }

  if (patches.length === 0) return []

  return [
    {
      oldStart: 1,
      oldLines: oldLines.length,
      newStart: 1,
      newLines: newLines.length,
      patches,
    },
  ]
}

/**
 * Format an error into a structured response object.
 * Uses the error taxonomy to provide code, category, and hint.
 */
function formatError(
  error: unknown,
  context?: GitErrorContext,
): {
  error: string
  code: GitErrorCode
  category: GitErrorCategory
  hint?: string
  context?: GitErrorContext
} {
  const gitError = isGitError(error) ? error : wrapError(error, context)
  return {
    error: gitError.message,
    code: gitError.code,
    category: gitError.category,
    hint: gitError.hint,
    context: gitError.context,
  }
}

function getErrorMessageWithDetails(error: unknown): string {
  const value = error as any
  const message = error instanceof Error ? error.message : String(error || "Unknown error")
  const details = [value?.data?.prettyDetails, value?.data?.details]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(item => item.trim())

  for (const detail of details) {
    if (!message.includes(detail)) {
      return `${message}\n${detail}`
    }
  }

  return message
}

function isGithubWorkflowPermissionMessage(message: string): boolean {
  return /workflow_scope_missing|workflow token scope|workflow permission|refusing to allow.*workflow|without.*workflow.*scope|lacks.*workflow.*scope|missing.*workflow.*scope/i.test(
    message,
  )
}

function getGithubWorkflowPushFailureReason(params: {
  provider?: string
  message: string
}): string | null {
  if (params.provider !== "github") return null
  if (isGithubWorkflowPermissionMessage(params.message)) return "workflow_scope_missing"
  return null
}

function buildGithubWorkflowPushFailureMessage(originalMessage: string): string {
  const message =
    "GitHub rejected this push because the token is missing Workflow permission for .github/workflows files. Update the GitHub token permissions and retry."
  return originalMessage && !originalMessage.includes(message)
    ? `${message}\n\nOriginal GitHub error: ${originalMessage}`
    : message
}

function postProgress(payload: {
  type: "clone-progress" | "merge-progress"
  repoId: string
  phase: string
  loaded?: number
  total?: number
  progress?: number
}) {
  try {
    ;(self as any).postMessage(payload)
  } catch {
    // ignore (some hosts may not listen)
  }
}

function makeProgress(repoId: string, type: "clone-progress" | "merge-progress") {
  return (phase: string, loaded?: number, total?: number) => {
    const progress =
      typeof loaded === "number" && typeof total === "number" && total > 0
        ? Math.max(0, Math.min(100, (loaded / total) * 100))
        : undefined
    postProgress({type, repoId, phase, loaded, total, progress})
  }
}

function repoKeyAndDir(repoId: string): {key: string; dir: string} {
  const key = parseRepoId(repoId)
  return {key, dir: `${rootDir}/${key}`}
}

async function isShallowClone(repoDir: string, git: GitProvider): Promise<boolean> {
  const fs: any = getProviderFs(git)
  if (!fs?.promises?.stat) return false
  try {
    await fs.promises.stat(`${repoDir}/.git/shallow`)
    return true
  } catch {
    return false
  }
}

async function hasUncommittedChanges(repoDir: string, git: GitProvider): Promise<boolean> {
  try {
    const matrix: Array<[string, number, number, number]> = await (git as any).statusMatrix({
      dir: repoDir,
    })
    for (const row of matrix) {
      const head = row[1]
      const workdir = row[2]
      const stage = row[3]
      if (workdir !== head || stage !== head) return true
    }
    return false
  } catch {
    return false
  }
}

// --- shared worker state ---
const git: GitProvider = createGitProvider()
applyGitConfigToProvider(git)
const cacheManager: RepoCacheManager = new (RepoCacheManager as any)()
const clonedRepos = new Set<string>()
const repoDataLevels = new Map<string, DataLevel>()
let eventIO: EventIO | null = null
const WORKER_BUILD_ID = new Date().toISOString()

async function hasCommitObject(dir: string, oid: string): Promise<boolean> {
  if (!oid) return false

  try {
    const commits = await (git as any).log({dir, depth: 1, ref: oid})
    return commits.length > 0
  } catch {
    return false
  }
}

async function fetchRefsUntilOidsAvailable(opts: {
  key: string
  dir: string
  requiredOids: string[]
  cloneUrls?: string[]
}): Promise<boolean> {
  const {key, dir} = opts
  const requiredOids = Array.from(new Set((opts.requiredOids || []).filter(Boolean)))
  if (requiredOids.length === 0) return true

  const urlsToTry: string[] = []
  const addUrls = (urls: string[]) => {
    for (const url of filterValidCloneUrls(urls)) {
      if (!urlsToTry.includes(url)) {
        urlsToTry.push(url)
      }
    }
  }

  addUrls(opts.cloneUrls || [])

  try {
    const remotes = await git.listRemotes({dir})
    const originRemote = remotes.find((r: any) => r.remote === "origin")
    if (originRemote?.url) {
      addUrls([originRemote.url])
    }
  } catch {
    // ignore remote listing issues
  }

  try {
    const cache = await cacheManager.getRepoCache(key)
    addUrls(cache?.cloneUrls || [])
  } catch {
    // ignore cache issues
  }

  const orderedUrls = reorderUrlsByPreference(urlsToTry, key)
  if (orderedUrls.length === 0) {
    return false
  }

  const corsProxy = resolveDefaultCorsProxy()
  const fetchResult = await withUrlFallback(
    orderedUrls,
    async (url: string) => {
      const authCallback = getAuthCallback(url)
      await git.fetch({
        dir,
        url,
        singleBranch: false,
        tags: true,
        corsProxy,
        ...(authCallback && {onAuth: authCallback}),
      })

      const missingOids: string[] = []
      for (const oid of requiredOids) {
        if (!(await hasCommitObject(dir, oid))) {
          missingOids.push(oid)
        }
      }

      if (missingOids.length > 0) {
        throw new Error(`Fetched refs but missing commit(s): ${missingOids.join(", ")}`)
      }

      return true
    },
    {repoId: key, perUrlTimeoutMs: 20000},
  )

  return fetchResult.success
}

// --- exposed Comlink API ---
const api = {
  // Health check / handshake
  async ping(): Promise<{ok: true; ts: number; apiVersion: string; buildId: string}> {
    return {ok: true, ts: Date.now(), apiVersion: "2026-03-16", buildId: WORKER_BUILD_ID}
  },

  // Configuration
  async setEventIO(io: EventIO): Promise<void> {
    eventIO = io
    // Wire EventIO into the higher-level NostrGitProvider system
    // (EventIO handles signing internally; worker just stores proxy and delegates)
    try {
      await initializeNostrGitProvider({eventIO: io})
      console.log("[Worker] NostrGitProvider initialized successfully")
    } catch (err) {
      console.error("[Worker] Failed to initialize NostrGitProvider:", err)
    }
  },

  async setAuthConfig(cfg: AuthConfig): Promise<void> {
    setAuthConfig(cfg)
  },

  async setGitConfig(cfg: GitWorkerConfig): Promise<void> {
    setWorkerGitConfig(cfg, git)
  },

  getConfiguredAuthHosts(): string[] {
    return getConfiguredAuthHosts()
  },

  // Repo tracking management
  clearCloneTracking(): void {
    clearCloneTracking(clonedRepos, repoDataLevels)
  },

  // Core repo initialization
  async initializeRepo(opts: {repoId: string; cloneUrls: string[]}) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "clone-progress")
    return toPlain(
      await initializeRepoUtil(
        git,
        cacheManager,
        opts,
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
        },
        sendProgress,
      ),
    )
  },

  async smartInitializeRepo(opts: {
    repoId: string
    cloneUrls: string[]
    branch?: string
    forceUpdate?: boolean
  }) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "clone-progress")
    return toPlain(
      await smartInitializeRepoUtil(
        git,
        cacheManager,
        opts,
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, dir: string) => isRepoClonedFs(g, dir),
          resolveBranchName: async (dir: string, requested?: string) =>
            resolveRobustBranchUtil(git, dir, requested),
        },
        sendProgress,
      ),
    )
  },

  async ensureShallowClone(opts: {repoId: string; branch?: string}) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "clone-progress")
    return toPlain(
      await ensureShallowCloneUtil(
        git,
        opts,
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, dir: string) => isRepoClonedFs(g, dir),
          resolveBranchName: async (dir: string, requested?: string) =>
            resolveRobustBranchUtil(git, dir, requested),
        },
        sendProgress,
      ),
    )
  },

  async ensureFullClone(opts: {
    repoId: string
    branch?: string
    depth?: number
    cloneUrls?: string[]
  }) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "clone-progress")
    return toPlain(
      await ensureFullCloneUtil(
        git,
        opts,
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, dir: string) => isRepoClonedFs(g, dir),
          resolveBranchName: async (dir: string, requested?: string) =>
            resolveRobustBranchUtil(git, dir, requested),
          cacheManager,
        },
        sendProgress,
      ),
    )
  },

  async cloneRemoteRepo(options: CloneRemoteRepoOptions): Promise<void> {
    // This util handles cleanup and cache writes internally
    await cloneRemoteRepoUtil(git, cacheManager, options)
  },

  // Legacy clone function - uses smart initialization strategy
  async clone(opts: {repoId: string; cloneUrls: string[]}) {
    try {
      // Use smart initialization
      const initResult = await api.smartInitializeRepo({
        repoId: opts.repoId,
        cloneUrls: opts.cloneUrls,
      })
      if (!initResult.success) {
        return toPlain(initResult)
      }

      // If we got data from cache and it's already shallow/full, we're done
      const dataLevel = (initResult as any).dataLevel
      if (initResult.fromCache && dataLevel && dataLevel !== "refs") {
        return toPlain(initResult)
      }

      // Otherwise, ensure we have at least shallow clone
      const shallowResult = await api.ensureShallowClone({repoId: opts.repoId})
      if (!shallowResult.success) {
        return toPlain(shallowResult)
      }

      return toPlain({
        success: true,
        repoId: opts.repoId,
        dataLevel: (shallowResult as any).dataLevel,
        fromCache: initResult.fromCache,
      })
    } catch (error: any) {
      console.error(`Clone failed for ${opts.repoId}:`, error)
      return toPlain({
        success: false,
        repoId: opts.repoId,
        ...formatError(error, {naddr: opts.repoId, operation: "clone"}),
      })
    }
  },

  // Clone and fork a repository (legacy function for Nostr fork events)
  async cloneAndFork(opts: {
    sourceUrl: string
    targetHost: "github" | "gitlab" | "gitea"
    targetToken: string
    targetUsername: string
    targetRepo: string
  }) {
    const {sourceUrl, targetHost, targetToken, targetUsername, targetRepo} = opts
    const dir = `${rootDir}/${sourceUrl.replace(/[^a-zA-Z0-9]/g, "_")}`

    try {
      const authCallback = getAuthCallback(sourceUrl)
      await (git as any).clone({
        dir,
        url: sourceUrl,
        singleBranch: true,
        depth: 1,
        ...(authCallback && {onAuth: authCallback}),
      })

      // Create remote repo using the provider factory
      const {getGitServiceApi} = await import("../git/provider-factory.js")
      const api = getGitServiceApi(targetHost, targetToken)
      const repoMetadata = await api.createRepo({
        name: targetRepo,
        description: `Fork of ${sourceUrl}`,
        private: false,
        autoInit: false,
      })

      const remoteUrl = repoMetadata.cloneUrl

      // Push to the new remote
      const remotes = await (git as any).listRemotes({dir})
      const originRemote = remotes.find((r: any) => r.remote === "origin")

      if (originRemote?.url) {
        const resolvedBranch = await resolveRobustBranchUtil(git, dir)
        const pushAuthCallback = getAuthCallback(originRemote.url)
        const corsProxy = resolveDefaultCorsProxy()
        await (git as any).push({
          dir,
          url: originRemote.url,
          ref: resolvedBranch,
          force: true,
          ...(corsProxy !== null ? {corsProxy} : {}),
          ...(pushAuthCallback && {onAuth: pushAuthCallback}),
        })
      }

      return toPlain({success: true, remoteUrl})
    } catch (error: any) {
      console.error("cloneAndFork failed:", error)
      return toPlain({
        success: false,
        ...formatError(error, {remote: opts.sourceUrl, operation: "cloneAndFork"}),
      })
    }
  },

  // Check if repo is cloned locally
  async isRepoCloned(opts: {repoId: string}): Promise<boolean> {
    const {dir} = repoKeyAndDir(opts.repoId)
    return await isRepoClonedFs(git, dir)
  },

  // Sync helpers
  async syncWithRemote(opts: {
    repoId: string
    cloneUrls: string[]
    branch?: string
    requireRemoteSync?: boolean
    requireTrackingRef?: boolean
    preferredUrl?: string
  }) {
    return toPlain(
      await syncWithRemoteUtil(git, cacheManager, opts, {
        rootDir,
        parseRepoId,
        resolveBranchName: async (dir: string, requested?: string) =>
          resolveRobustBranchUtil(git, dir, requested),
        isRepoCloned: async (dir: string) => isRepoClonedFs(git, dir),
        toPlain,
        getAuthCallback,
        corsProxy: resolveDefaultCorsProxy(),
      }),
    )
  },

  async needsUpdate(opts: {
    repoId: string
    cloneUrls: string[]
    branch?: string
    now?: number
  }): Promise<boolean> {
    const {repoId, cloneUrls, branch, now} = opts
    const {key} = repoKeyAndDir(repoId)
    let cache: RepoCache | null = null
    try {
      cache = await (cacheManager as any).getRepoCache(key)
    } catch {
      cache = null
    }
    return await needsUpdateUtil(git, key, cloneUrls, cache, now ?? Date.now(), undefined, branch)
  },

  async listServerRefs(opts: {url: string; prefix?: string; symrefs?: boolean}) {
    try {
      const refs = await listAdvertisedServerRefs(git, {
        url: opts.url,
        prefix: opts.prefix,
        symrefs: opts.symrefs ?? true,
        onAuth: getAuthCallback(opts.url),
        corsProxy: resolveDefaultCorsProxy(),
      })
      return toPlain(refs)
    } catch (error: any) {
      const status = error?.status ?? error?.code ?? error?.data?.status
      const message = String(error?.message ?? error ?? "")
      const isNotFound = status === 404 || message.includes("404") || message.includes("Not Found")
      if (!isNotFound) {
        console.error("[listServerRefs] Error:", error)
      }
      throw error
    }
  },

  async discoverRemoteBackfill(opts: {
    repoId: string
    cloneUrls: string[]
    defaultBranch?: string
  }) {
    return toPlain(
      await discoverRemoteBackfillUtil(git, opts, {
        rootDir,
        parseRepoId,
      }),
    )
  },

  async prepareRemoteBackfill(opts: {
    repoId: string
    targets: Array<{
      remoteUrl: string
      refs: Array<{
        ref: string
        name: string
        type: "heads" | "tags"
        effectiveOid: string
        currentOid?: string
        sourceUrls: string[]
      }>
    }>
  }) {
    return toPlain(
      await prepareRemoteBackfillUtil(git, opts, {
        rootDir,
        parseRepoId,
        onProgress: makeProgress(opts.repoId, "clone-progress"),
      }),
    )
  },

  async executeRemoteBackfill(opts: {
    repoId: string
    targets: Array<{
      remoteUrl: string
      refs: Array<{
        ref: string
        name: string
        type: "heads" | "tags"
        effectiveOid: string
        currentOid?: string
        sourceUrls: string[]
      }>
    }>
    userPubkey?: string
  }) {
    return toPlain(
      await executeRemoteBackfillUtil(git, opts, {
        rootDir,
        parseRepoId,
        onProgress: makeProgress(opts.repoId, "clone-progress"),
        pushToRemote: async params => await api.pushToRemote(params),
      }),
    )
  },

  /**
   * List branch names from clone URLs without cloning (uses listServerRefs).
   * Used by NewPRForm when creating PRs from forks to populate source branch dropdown.
   */
  async listBranchesFromUrls(opts: {
    cloneUrls: string[]
  }): Promise<{branches: string[]; error?: string}> {
    const validUrls = filterValidCloneUrls(opts.cloneUrls)
    if (validUrls.length === 0) {
      return toPlain({branches: [], error: "No valid clone URLs provided"})
    }
    const ordered = reorderUrlsByPreference(validUrls, "fork-preview")
    const failures: string[] = []
    for (const url of ordered) {
      try {
        const refs = await listAdvertisedServerRefs(git, {
          url,
          prefix: "refs/heads/",
          symrefs: false,
          onAuth: getAuthCallback(url),
          corsProxy: resolveDefaultCorsProxy(),
        })
        const branches = (refs || [])
          .filter((r: any) => r?.ref?.startsWith("refs/heads/"))
          .map((r: any) => r.ref.replace(/^refs\/heads\//, ""))
          .filter(Boolean)
        return toPlain({branches})
      } catch (err) {
        console.warn("[listBranchesFromUrls] Failed for", url, err)
        failures.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
    }
    return toPlain({
      branches: [],
      error: failures.length
        ? `Failed to load fork branches: ${failures.join("; ")}`
        : "Failed to load fork branches",
    })
  },

  async analyzePRMerge(opts: AnalyzePRMergeOptions) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "merge-progress")
    sendProgress("Fetching PR from clone URL...")
    const result = await analyzePRMergeUtil(git, opts, {
      rootDir,
      parseRepoId,
      resolveBranchName: async (dir: string, requested?: string) =>
        resolveRobustBranchUtil(git, dir, requested),
      getAuthCallback,
      corsProxy: resolveDefaultCorsProxy(),
    })
    sendProgress("Analysis complete")
    return toPlain(result)
  },

  async mergePRAndPush(opts: MergePRAndPushOptions) {
    const {repoId} = opts
    const sendProgress = makeProgress(repoId, "merge-progress")
    const optsWithProgress = {
      ...opts,
      onProgress: (step: string, pct: number) => sendProgress(step),
    }
    const {getTokensForHost} = await import("./workers/auth.js")
    const result = await mergePRAndPushUtil(git, optsWithProgress, {
      rootDir,
      parseRepoId,
      resolveBranchName: async (dir: string, requested?: string) =>
        resolveRobustBranchUtil(git, dir, requested),
      ensureFullClone: async (args: {
        repoId: string
        branch?: string
        depth?: number
        cloneUrls?: string[]
      }) =>
        ensureFullCloneUtil(
          git,
          args,
          {
            rootDir,
            parseRepoId,
            repoDataLevels,
            clonedRepos,
            isRepoCloned: async (g: GitProvider, dir: string) => isRepoClonedFs(g, dir),
            resolveBranchName: async (dir: string, requested?: string) =>
              resolveRobustBranchUtil(git, dir, requested),
            cacheManager,
          },
          makeProgress(args.repoId, "clone-progress"),
        ),
      getAuthCallback,
      getConfiguredAuthHosts,
      pushToRemote: async opts => {
        const r = await api.pushToRemote(opts)
        return r
      },
      safePushToRemote: async args => {
        const r = await api.safePushToRemote({
          ...args,
          provider: args.provider as any,
          preflight: args.preflight,
        })
        return {
          success: r?.success,
          error: r?.error,
          requiresConfirmation: r?.requiresConfirmation,
          warning: r?.warning,
          reason: r?.reason,
        }
      },
      getTokensForRemote: async (url: string) => {
        try {
          const hostname = new URL(url).hostname
          const tokens = await getTokensForHost(hostname)
          return tokens.map(t => ({token: t.token}))
        } catch {
          return []
        }
      },
    })
    sendProgress("Merge complete")
    return toPlain(result)
  },

  async pushToRemote(opts: {
    repoId: string
    remoteUrl: string
    branch?: string
    ref?: string
    refs?: string[]
    token?: string
    provider?: string
    blossomMirror?: boolean
    /** Pre-signed NIP-98 Authorization headers for GRASP authentication (keyed by URL) */
    authHeaders?: Record<string, string>
    /** @deprecated Use authHeaders instead */
    authHeader?: string
  }) {
    const {
      repoId,
      remoteUrl,
      branch,
      ref,
      refs,
      token,
      provider,
      blossomMirror,
      authHeaders,
      authHeader,
    } = opts
    const {key, dir} = repoKeyAndDir(repoId)
    const targetBranch = branch || "main"

    const normalizePushRef = (value: string): string => {
      const trimmed = String(value || "").trim()
      if (!trimmed) return ""
      return trimmed.startsWith("refs/") ? trimmed : `refs/heads/${trimmed}`
    }

    const normalizedRequestedRef = normalizePushRef(ref || "")
    const normalizedRequestedRefs = (refs || []).map(normalizePushRef).filter(Boolean)

    try {
      console.log(`Pushing repository ${repoId} to remote: ${remoteUrl} (provider=${provider})`)

      // Handle GRASP provider with full state publishing
      if (provider === "grasp") {
        if (!token) {
          throw new Error("GRASP provider requires a pubkey token")
        }

        // Build Smart HTTP URL
        const pickSmartHttpUrl = (orig: string): string => {
          const u = new URL(orig)
          let p = u.pathname.startsWith("/git/") ? u.pathname.slice(4) : u.pathname
          if (!p.endsWith(".git")) p = p.endsWith("/") ? `${p.slice(0, -1)}.git` : `${p}.git`
          return `${u.protocol}//${u.host}${p}`
        }

        const pushUrl = pickSmartHttpUrl(remoteUrl)

        // Add remote if needed
        try {
          await (git as any).addRemote({dir, remote: "origin", url: pushUrl})
        } catch (err: any) {
          if (!err.message?.includes("already exists") && !err.message?.includes("Remote named")) {
            throw err
          }
        }

        const explicitRefs = [...normalizedRequestedRefs, normalizedRequestedRef].filter(Boolean)
        const refsToPush = Array.from(
          new Set(explicitRefs.length > 0 ? explicitRefs : [`refs/heads/${targetBranch}`]),
        )

        console.log(`[GRASP] Pushing to ${pushUrl} (refs=${refsToPush.join(", ")})`)

        const isMissingObjectsPushError = (error: any): boolean => {
          const message = [error?.message, error?.data?.prettyDetails]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          return message.includes("missing necessary objects")
        }

        const isEmptyReceivePackParseError = (error: any): boolean => {
          const message = String(error?.message || "").toLowerCase()
          return message.includes('expected "unpack ok"') && message.includes('received ""')
        }

        const isHeadlessRemoteFetchError = (error: unknown): boolean => {
          const message = error instanceof Error ? error.message : String(error || "")
          return /could not find\s+head/i.test(message)
        }

        const normalizeUrlForAuthMatch = (value: string): string => {
          try {
            const parsed = new URL(value)
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`.replace(
              /\/+$/,
              "",
            )
          } catch {
            return String(value || "").replace(/\/+$/, "")
          }
        }

        const providedAuthHeaders = authHeaders
          ? Object.fromEntries(
              Object.entries(authHeaders)
                .filter(([url, header]) => Boolean(url && header))
                .map(([url, header]) => [normalizeUrlForAuthMatch(url), header]),
            )
          : authHeader
            ? {[normalizeUrlForAuthMatch(pushUrl)]: authHeader}
            : null

        const hasProvidedAuthHeaders = Boolean(
          providedAuthHeaders && Object.keys(providedAuthHeaders).length > 0,
        )

        let lastGraspHttpDiagnostics: Array<{
          url: string
          statusCode?: number
          statusMessage?: string
          contentType?: string
          error?: string
        }> = []

        const shouldTraceGraspPushRequest = (url: string): boolean => {
          const value = String(url || "")
          return (
            value.includes("service=git-receive-pack") ||
            value.includes("service=git-upload-pack") ||
            value.includes("/git-receive-pack") ||
            value.includes("/git-upload-pack")
          )
        }

        const appendGraspHttpDiagnostic = (entry: {
          url: string
          statusCode?: number
          statusMessage?: string
          contentType?: string
          error?: string
        }) => {
          lastGraspHttpDiagnostics = [...lastGraspHttpDiagnostics, entry].slice(-8)
        }

        const buildGraspHttpTraceSuffix = (): string => {
          if (lastGraspHttpDiagnostics.length === 0) return ""
          const compact = lastGraspHttpDiagnostics
            .map(item => {
              const status =
                item.statusCode != null
                  ? `${item.statusCode} ${item.statusMessage || ""}`.trim()
                  : "ERR"
              const ct = item.contentType ? ` ct=${item.contentType}` : ""
              const err = item.error ? ` err=${item.error}` : ""
              return `${item.url} -> ${status}${ct}${err}`
            })
            .join(" | ")
          return ` [HTTP trace: ${compact}]`
        }

        const baseGraspHttpClient: any = hasProvidedAuthHeaders
          ? {
              async request(request: any): Promise<any> {
                const reqUrl = normalizeUrlForAuthMatch(String(request?.url || ""))
                const auth = providedAuthHeaders?.[reqUrl]
                if (auth) {
                  request.headers = {
                    ...(request.headers || {}),
                    Authorization: auth,
                  }
                }
                return httpWeb.request(request)
              },
            }
          : eventIO
            ? createNip98HttpClient(httpWeb as any, eventIO)
            : httpWeb

        const graspHttpClient = {
          async request(request: any): Promise<any> {
            const url = String(request?.url || "")
            try {
              const response = await baseGraspHttpClient.request(request)
              if (shouldTraceGraspPushRequest(url)) {
                appendGraspHttpDiagnostic({
                  url,
                  statusCode: response?.statusCode,
                  statusMessage: response?.statusMessage,
                  contentType:
                    response?.headers?.["content-type"] || response?.headers?.["Content-Type"],
                })
              }
              return response
            } catch (requestError: any) {
              if (shouldTraceGraspPushRequest(url)) {
                appendGraspHttpDiagnostic({
                  url,
                  error: requestError?.message || String(requestError || "request failed"),
                })
              }
              throw requestError
            }
          },
        }

        const pushOnce = async (targetRef: string) => {
          let sourceRef = targetRef

          if (targetRef.startsWith("refs/heads/")) {
            const shortName = targetRef.slice("refs/heads/".length)
            try {
              await git.resolveRef({dir, ref: targetRef})
            } catch {
              try {
                const remoteTrackingRef = `refs/remotes/origin/${shortName}`
                const remoteOid = await git.resolveRef({dir, ref: remoteTrackingRef})
                if (remoteOid && typeof (git as any).writeRef === "function") {
                  await git.writeRef({dir, ref: targetRef, value: remoteOid, force: true})
                  console.log(
                    `[GRASP] Materialized local branch ${targetRef} from ${remoteTrackingRef} @ ${remoteOid.slice(0, 8)}`,
                  )
                }
              } catch {
                // pass
              }

              try {
                await git.resolveRef({dir, ref: targetRef})
              } catch {
                sourceRef = shortName
                console.log(
                  `[GRASP] Falling back to short source ref ${shortName} for push target ${targetRef}`,
                )
              }
            }
          }

          await git.push({
            dir,
            url: pushUrl,
            remote: "origin",
            ref: sourceRef,
            remoteRef: targetRef,
            http: graspHttpClient,
            force: false,
            corsProxy: null,
            headers: {
              "User-Agent": "git/isomorphic-git",
            },
          })
        }

        const resolveLocalRefTip = async (targetRef: string): Promise<string | null> => {
          try {
            return await git.resolveRef({dir, ref: targetRef})
          } catch {
            if (targetRef.startsWith("refs/heads/")) {
              const shortName = targetRef.slice("refs/heads/".length)
              try {
                return await git.resolveRef({dir, ref: shortName})
              } catch {
                return null
              }
            }
            try {
              return await git.resolveRef({dir, ref: targetRef})
            } catch {
              return null
            }
          }
        }

        const hasReadableLocalObjectForRef = async (targetRef: string): Promise<boolean> => {
          const oid = await resolveLocalRefTip(targetRef)
          if (!oid) return false

          if (typeof (git as any).readObject !== "function") {
            return true
          }

          try {
            await git.readObject({dir, oid})
            return true
          } catch {
            return false
          }
        }

        const escapeRegex = (value: string): string =>
          String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        const toCorsProxyRequestUrl = (url: string, corsProxy: string): string =>
          `${corsProxy}/${url.replace(/^https?:\/\//i, "")}`

        const parseRefTipFromInfoRefs = (text: string, targetRef: string): string | null => {
          const escapedRef = escapeRegex(targetRef)
          const pattern = new RegExp(`^([0-9a-f]{40,64}) ${escapedRef}(?:\\x00|$)`, "i")

          const lines = String(text || "").split(/\r?\n/)
          for (const rawLine of lines) {
            let line = rawLine.trim()
            if (!line || line === "0000") continue
            if (/^[0-9a-f]{4}/i.test(line)) {
              line = line.slice(4)
            }
            if (!line || line.startsWith("# service=")) continue

            const match = line.match(pattern)
            if (match?.[1]) return match[1]
          }

          return null
        }

        const fetchInfoRefs = async (
          service: "git-upload-pack" | "git-receive-pack",
        ): Promise<string | null> => {
          const probeUrl = `${pushUrl}/info/refs?service=${service}`

          try {
            const response = await fetch(probeUrl, {method: "GET"})
            appendGraspHttpDiagnostic({
              url: probeUrl,
              statusCode: response.status,
              statusMessage: response.statusText,
              contentType: response.headers.get("content-type") || undefined,
            })
            if (!response.ok) return null
            return await response.text()
          } catch (error: any) {
            appendGraspHttpDiagnostic({
              url: probeUrl,
              error: error?.message || String(error || "request failed"),
            })
          }

          const corsProxy = resolveDefaultCorsProxy()
          if (!corsProxy) return null

          try {
            const proxiedUrl = toCorsProxyRequestUrl(probeUrl, corsProxy)
            const response = await fetch(proxiedUrl, {method: "GET"})
            appendGraspHttpDiagnostic({
              url: proxiedUrl,
              statusCode: response.status,
              statusMessage: response.statusText,
              contentType: response.headers.get("content-type") || undefined,
            })
            if (!response.ok) return null
            return await response.text()
          } catch (error: any) {
            appendGraspHttpDiagnostic({
              url: `${corsProxy}/*`,
              error: error?.message || String(error || "proxy request failed"),
            })
            return null
          }
        }

        const getRemoteRefTip = async (targetRef: string): Promise<string | null> => {
          try {
            // Prefer upload-pack for branch tip verification because many servers
            // advertise full refs there while receive-pack can omit them.
            const infoRefsText =
              (await fetchInfoRefs("git-upload-pack")) || (await fetchInfoRefs("git-receive-pack"))
            if (!infoRefsText) return null

            const refTip = parseRefTipFromInfoRefs(infoRefsText, targetRef)
            if (refTip) return refTip

            return null
          } catch (error) {
            console.warn("[GRASP] Failed to read remote ref tip for verification:", error)
            return null
          }
        }

        const isRemoteAlreadyAtLocalTip = async (targetRef: string): Promise<boolean> => {
          const [localTip, remoteTip] = await Promise.all([
            resolveLocalRefTip(targetRef),
            getRemoteRefTip(targetRef),
          ])
          if (!localTip || !remoteTip) return false
          return localTip === remoteTip
        }

        // IMPORTANT: Must set User-Agent starting with "git/" for GRASP servers to accept the request
        console.log("[GRASP] Push params:", {
          dir,
          url: pushUrl,
          refs: refsToPush,
          remote: "origin",
          authMode: hasProvidedAuthHeaders ? "pre-signed" : eventIO ? "eventio" : "none",
        })

        const retryDelaysMs = [1200, 3500, 7000]
        const pushedRefs: string[] = []
        const failedRefs: Array<{ref: string; error: string}> = []
        const warnings: string[] = []

        for (const targetRef of refsToPush) {
          try {
            if (await isRemoteAlreadyAtLocalTip(targetRef)) {
              console.log(`[GRASP] ${targetRef} already matches remote tip; skipping push`)
              pushedRefs.push(targetRef)
              continue
            }

            await pushOnce(targetRef)
          } catch (pushErr: any) {
            let recovered = false

            if (isEmptyReceivePackParseError(pushErr)) {
              for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
                const delay = retryDelaysMs[attempt]
                console.warn(
                  `[GRASP] Empty receive-pack response for ${targetRef}; retrying (${attempt + 1}/${retryDelaysMs.length}) after ${delay}ms${buildGraspHttpTraceSuffix()}`,
                )

                try {
                  await new Promise(resolve => setTimeout(resolve, delay))
                  await pushOnce(targetRef)
                  recovered = true
                  break
                } catch (retryErr: any) {
                  console.warn(
                    `[GRASP] Empty response retry (${attempt + 1}) for ${targetRef} failed${buildGraspHttpTraceSuffix()}:`,
                    retryErr,
                  )

                  if (await isRemoteAlreadyAtLocalTip(targetRef)) {
                    recovered = true
                    warnings.push(
                      `${targetRef}: receive-pack parse error but remote tip matches after retry`,
                    )
                    break
                  }
                }
              }

              // Do not treat 200 receive-pack-result with empty parse as success on its own.
            }

            if (!recovered && isMissingObjectsPushError(pushErr)) {
              console.warn(
                `[GRASP] ${targetRef} failed due to missing objects; attempting repair fetch before retry`,
              )
              try {
                const remotes =
                  typeof (git as any).listRemotes === "function" ? await git.listRemotes({dir}) : []
                const originRemote = (remotes || []).find((r: any) => r?.remote === "origin")
                const corsProxy = resolveDefaultCorsProxy()

                if (originRemote?.url && typeof (git as any).fetch === "function") {
                  // Fetch the specific branch being pushed rather than relying on HEAD.
                  // Nostr relay remotes fail with "Could not find HEAD" when HEAD is missing
                  // or points to a non-existent branch.
                  const specificBranch = targetRef.startsWith("refs/heads/")
                    ? targetRef.slice("refs/heads/".length)
                    : targetRef.startsWith("refs/tags/")
                      ? null
                      : null
                  const specificTag = targetRef.startsWith("refs/tags/")
                    ? targetRef.slice("refs/tags/".length)
                    : null

                  if (specificBranch) {
                    await git.fetch({
                      dir,
                      url: originRemote.url,
                      ref: specificBranch,
                      remoteRef: specificBranch,
                      singleBranch: true,
                      tags: false,
                      depth: undefined,
                      ...(corsProxy !== null ? {corsProxy} : {}),
                    })
                  } else if (specificTag) {
                    await git.fetch({
                      dir,
                      url: originRemote.url,
                      ref: specificTag,
                      remoteRef: `refs/tags/${specificTag}`,
                      singleBranch: true,
                      tags: false,
                      depth: undefined,
                      ...(corsProxy !== null ? {corsProxy} : {}),
                    })
                  } else {
                    // For unknown refs, fall back to generic fetch
                    await git.fetch({
                      dir,
                      remote: "origin",
                      tags: true,
                      ...(corsProxy !== null ? {corsProxy} : {}),
                    })
                  }
                  await pushOnce(targetRef)
                  recovered = true
                }
              } catch (retryErr: any) {
                if (isHeadlessRemoteFetchError(retryErr)) {
                  try {
                    const recoveredFromHeadless = await hasReadableLocalObjectForRef(targetRef)
                    if (recoveredFromHeadless) {
                      console.warn(
                        `[GRASP] Repair fetch for ${targetRef} hit missing HEAD but local object exists; retrying push anyway`,
                      )
                      await pushOnce(targetRef)
                      recovered = true
                      continue
                    }
                  } catch {
                    // pass
                  }
                }
                console.error("[GRASP] Repair fetch + retry push failed:", retryErr)
              }
            }

            if (!recovered) {
              if (lastGraspHttpDiagnostics.length > 0) {
                console.error("[GRASP] Push HTTP diagnostics:", lastGraspHttpDiagnostics)
              }
              throw pushErr
            }
          }

          const [localTip, remoteTip] = await Promise.all([
            resolveLocalRefTip(targetRef),
            getRemoteRefTip(targetRef),
          ])

          if (localTip && remoteTip && localTip === remoteTip) {
            pushedRefs.push(targetRef)
            continue
          }

          if (localTip && remoteTip && localTip !== remoteTip) {
            failedRefs.push({
              ref: targetRef,
              error: `remote tip mismatch (local=${localTip.slice(0, 8)} remote=${remoteTip.slice(0, 8)})`,
            })
            continue
          }

          if (!remoteTip) {
            failedRefs.push({ref: targetRef, error: "remote tip could not be verified"})
            continue
          }

          failedRefs.push({ref: targetRef, error: "could not resolve local tip for verification"})
        }

        if (pushedRefs.length === 0) {
          return toPlain({
            success: false,
            repoId,
            remoteUrl,
            branch: targetBranch,
            error: `Failed to push refs: ${failedRefs.map(item => `${item.ref} (${item.error})`).join("; ")}`,
            details: {pushedRefs, failedRefs, warnings},
          })
        }

        const partialSuccess = failedRefs.length > 0
        return toPlain({
          success: true,
          repoId,
          remoteUrl,
          branch: targetBranch,
          partialSuccess,
          details: {pushedRefs, failedRefs, warnings},
          message: partialSuccess
            ? `Pushed ${pushedRefs.length}/${refsToPush.length} refs`
            : `Pushed ${pushedRefs.length} refs successfully`,
        })
      }

      // Standard providers or NostrGitProvider
      const onAuth =
        token != null
          ? () => ({username: provider === "gitlab" ? "oauth2" : "token", password: token})
          : getAuthCallback(remoteUrl)

      const refsToPush = Array.from(
        new Set(
          [...normalizedRequestedRefs, normalizedRequestedRef].filter(Boolean).length > 0
            ? [...normalizedRequestedRefs, normalizedRequestedRef].filter(Boolean)
            : [normalizePushRef(targetBranch)],
        ),
      )

      const materializeSourceRef = async (targetRef: string): Promise<string> => {
        if (!targetRef.startsWith("refs/heads/")) {
          return targetRef
        }

        const shortName = targetRef.slice("refs/heads/".length)
        try {
          await git.resolveRef({dir, ref: targetRef})
          return targetRef
        } catch {
          try {
            const remoteTrackingRef = `refs/remotes/origin/${shortName}`
            const remoteOid = await git.resolveRef({dir, ref: remoteTrackingRef})
            if (remoteOid && typeof (git as any).writeRef === "function") {
              await git.writeRef({dir, ref: targetRef, value: remoteOid, force: true})
            }
          } catch {
            // pass
          }

          try {
            await git.resolveRef({dir, ref: targetRef})
            return targetRef
          } catch {
            return shortName
          }
        }
      }

      // Only use NostrGitProvider for nostr:// URLs or GRASP-style Smart HTTP paths.
      const isNostrUrl = remoteUrl.startsWith("nostr://") || isGraspRepoHttpUrl(remoteUrl)

      // Check if NostrGitProvider is available before trying to use it
      if (isNostrUrl && hasNostrGitProvider()) {
        const nostrProvider = getNostrGitProvider()
        let blossomSummary: BlossomPushSummary | undefined
        const pushedRefs: string[] = []

        for (const targetRef of refsToPush) {
          const sourceRef = await materializeSourceRef(targetRef)
          const result = await nostrProvider.push({
            dir,
            fs: getProviderFs(git),
            ref: sourceRef,
            remoteRef: targetRef,
            url: remoteUrl,
            onAuth,
            blossomMirror: blossomMirror ?? Boolean(provider === "blossom"),
          })
          if (!blossomSummary && result?.blossomSummary) {
            blossomSummary = result.blossomSummary
          }
          pushedRefs.push(targetRef)
        }

        return toPlain({
          success: true,
          branch: targetBranch,
          remoteUrl,
          blossomSummary,
          details: {pushedRefs, failedRefs: [], warnings: []},
        })
      }

      const corsProxy = resolveDefaultCorsProxy()
      const pushedRefs: string[] = []

      for (const targetRef of refsToPush) {
        const sourceRef = await materializeSourceRef(targetRef)
        await (git as any).push({
          dir,
          url: remoteUrl,
          ref: sourceRef,
          remoteRef: targetRef,
          ...(corsProxy !== null ? {corsProxy} : {}),
          onAuth,
        })
        pushedRefs.push(targetRef)
      }

      return toPlain({
        success: true,
        branch: targetBranch,
        remoteUrl,
        details: {pushedRefs, failedRefs: [], warnings: []},
      })
    } catch (error) {
      console.error(`Error pushing to remote:`, error)
      const originalMessage = getErrorMessageWithDetails(error)
      const requestedRefs = Array.from(
        new Set(
          [...normalizedRequestedRefs, normalizedRequestedRef].filter(Boolean).length > 0
            ? [...normalizedRequestedRefs, normalizedRequestedRef].filter(Boolean)
            : [normalizePushRef(targetBranch)],
        ),
      )
      const workflowFailureReason = getGithubWorkflowPushFailureReason({
        provider,
        message: originalMessage,
      })
      const message = workflowFailureReason
        ? buildGithubWorkflowPushFailureMessage(originalMessage)
        : originalMessage
      const formatted = formatError(error, {naddr: repoId, remote: remoteUrl, operation: "push"})

      return toPlain({
        success: false,
        repoId,
        remoteUrl,
        ...formatted,
        ...(workflowFailureReason ? {reason: workflowFailureReason} : {}),
        error: message,
        details: {
          pushedRefs: [],
          failedRefs: requestedRefs.map(ref => ({ref, error: message})),
          warnings: workflowFailureReason
            ? ["Source contains .github/workflows files; GitHub tokens need Workflow permission."]
            : [],
        },
      })
    }
  },

  // Safe push wrapper (preflight checks + optional confirmation flow)
  async safePushToRemote(opts: SafePushOptions) {
    return toPlain(
      await safePushToRemoteUtil(git, cacheManager, opts, {
        rootDir,
        parseRepoId,
        isRepoCloned: async (dir: string) => isRepoClonedFs(git, dir),
        isShallowClone: async (key: string) => {
          const {dir} = repoKeyAndDir(key)
          return await isShallowClone(dir, git)
        },
        resolveBranchName: async (dir: string, requested?: string) =>
          resolveRobustBranchUtil(git, dir, requested),
        hasUncommittedChanges: async (dir: string) => hasUncommittedChanges(dir, git),
        needsUpdate: async (
          repoId: string,
          cloneUrls: string[],
          cache: RepoCache | null,
          branch?: string,
          localBranchCommit?: string,
          repoDir?: string,
        ) =>
          needsUpdateUtil(
            git,
            repoId,
            cloneUrls,
            cache,
            Date.now(),
            undefined,
            branch,
            localBranchCommit,
            repoDir,
          ),
        pushToRemote: async (args: {
          repoId: string
          remoteUrl: string
          branch?: string
          token?: string
          provider?: any
        }) => {
          try {
            return await api.pushToRemote({
              repoId: args.repoId,
              remoteUrl: args.remoteUrl,
              branch: args.branch,
              token: args.token,
              provider: args.provider,
            })
          } catch (e: any) {
            return {success: false, error: e?.message || String(e)} as any
          }
        },
      }),
    )
  },

  // Convenience repo ops (useful for UIs)
  async listBranches(opts: {repoId: string}): Promise<string[]> {
    const {dir} = repoKeyAndDir(opts.repoId)
    return toPlain(await (git as any).listBranches({dir}))
  },

  async listTags(opts: {repoId: string}): Promise<string[]> {
    const {dir} = repoKeyAndDir(opts.repoId)
    return toPlain(await (git as any).listTags({dir}))
  },

  async resolveRef(opts: {repoId: string; ref: string}): Promise<string> {
    const {dir} = repoKeyAndDir(opts.repoId)
    return await (git as any).resolveRef({dir, ref: opts.ref})
  },

  async listRemotes(opts: {repoId: string}): Promise<Array<{remote: string; url: string}>> {
    const {dir} = repoKeyAndDir(opts.repoId)
    const remotes = await (git as any).listRemotes({dir})
    return toPlain(remotes || [])
  },

  async resolveBranch(opts: {repoId: string; branch?: string}): Promise<string> {
    const {dir} = repoKeyAndDir(opts.repoId)
    return await resolveRobustBranchUtil(git, dir, opts.branch)
  },

  async getCommitHistory(opts: {repoId: string; branch?: string; depth?: number}) {
    try {
      const {key, dir} = repoKeyAndDir(opts.repoId)
      const ref = opts.branch || "main"
      const depth = opts.depth ?? 50

      // Check if the repo is initialized
      const isInClonedSet = clonedRepos.has(key)
      const dataLevel = repoDataLevels.get(key)

      // Also check if the directory actually exists on the filesystem
      const repoExists = await isRepoClonedFs(git, dir)

      console.log(
        `[getCommitHistory] Repo ${key}: inClonedSet=${isInClonedSet}, dataLevel=${dataLevel || "none"}, fsExists=${repoExists}`,
      )

      // If repo doesn't exist at all, return retriable error
      if (!repoExists && !isInClonedSet) {
        return {
          success: false,
          error: "Repository is still being initialized. Please wait and try again.",
          code: "RepoNotReady",
          retriable: true,
        }
      }

      // If repo exists on filesystem but not in our tracking set, add it
      // This can happen if the repo was initialized through a different code path
      if (repoExists && !isInClonedSet) {
        console.log(
          `[getCommitHistory] Repo ${key} exists on filesystem but not in clonedRepos, adding it`,
        )
        clonedRepos.add(key)
        if (!dataLevel) {
          repoDataLevels.set(key, "refs")
        }
      }

      // Prefer the explicitly requested branch before HEAD.
      // A detached or stale HEAD can expose a truncated history for the wrong ref.
      const refsToTry = buildCommitHistoryRefsToTry(ref)

      // Strategy 1: Try to resolve ref to OID first, then use OID with git.log
      // This works better for Nostr repos where refs might not be in standard locations
      for (const tryRef of refsToTry) {
        try {
          // First try to resolve the ref to an OID
          const oid = await (git as any).resolveRef({dir, ref: tryRef})
          if (oid && oid.length === 40) {
            // Use the OID directly with git.log - this is more reliable
            const commits = await (git as any).log({dir, ref: oid, depth})
            if (tryRef !== ref) {
              console.log(
                `[getCommitHistory] Resolved '${tryRef}' to OID ${oid.substring(0, 8)}, got ${commits.length} commits`,
              )
              return {success: true, commits: toPlain(commits), fallbackUsed: tryRef}
            }
            console.log(
              `[getCommitHistory] Resolved '${ref}' to OID ${oid.substring(0, 8)}, got ${commits.length} commits`,
            )
            return {success: true, commits: toPlain(commits)}
          }
        } catch (error: any) {
          // Only log when transitioning between branch groups
          if (tryRef === ref) {
            console.log(`[getCommitHistory] Branch '${ref}' not found, trying fallbacks...`)
          }
          // Continue to next ref
        }
      }

      // Strategy 2: Try git.log directly with ref names (fallback)
      console.log(`[getCommitHistory] resolveRef failed for all refs, trying git.log directly`)
      for (const tryRef of refsToTry) {
        try {
          const commits = await (git as any).log({dir, ref: tryRef, depth})
          if (commits && commits.length > 0) {
            console.log(
              `[getCommitHistory] git.log succeeded with ref '${tryRef}', got ${commits.length} commits`,
            )
            return {
              success: true,
              commits: toPlain(commits),
              fallbackUsed: tryRef !== ref ? tryRef : undefined,
            }
          }
        } catch {
          // Continue to next ref
        }
      }

      // Strategy 3: List branches and try them
      console.log(
        `[getCommitHistory] All standard refs failed, trying to find any available branch`,
      )
      try {
        const branches = await (git as any).listBranches({dir})
        console.log(
          `[getCommitHistory] Found ${branches?.length || 0} local branches: ${branches?.join(", ") || "none"}`,
        )
        if (branches && branches.length > 0) {
          for (const branch of branches) {
            try {
              const oid = await (git as any).resolveRef({dir, ref: `refs/heads/${branch}`})
              if (oid) {
                const commits = await (git as any).log({dir, ref: oid, depth})
                console.log(
                  `[getCommitHistory] Used branch '${branch}' (OID: ${oid.substring(0, 8)}), got ${commits.length} commits`,
                )
                return {success: true, commits: toPlain(commits), fallbackUsed: branch}
              }
            } catch {
              // Try next branch
            }
          }
        }
      } catch (e) {
        console.log(`[getCommitHistory] listBranches failed: ${(e as Error).message}`)
      }

      // Strategy 4: Try remote branches
      try {
        const remoteBranches = await (git as any).listBranches({dir, remote: "origin"})
        console.log(
          `[getCommitHistory] Found ${remoteBranches?.length || 0} remote branches: ${remoteBranches?.join(", ") || "none"}`,
        )
        if (remoteBranches && remoteBranches.length > 0) {
          for (const branch of remoteBranches) {
            try {
              const oid = await (git as any).resolveRef({dir, ref: `refs/remotes/origin/${branch}`})
              if (oid) {
                const commits = await (git as any).log({dir, ref: oid, depth})
                console.log(
                  `[getCommitHistory] Used remote branch 'origin/${branch}' (OID: ${oid.substring(0, 8)}), got ${commits.length} commits`,
                )
                return {success: true, commits: toPlain(commits), fallbackUsed: `origin/${branch}`}
              }
            } catch {
              // Try next branch
            }
          }
        }
      } catch (e) {
        console.log(`[getCommitHistory] listBranches(remote) failed: ${(e as Error).message}`)
      }

      // Nothing worked
      return {
        success: false,
        error: `No branches found in repository. Tried: ${refsToTry.slice(0, 5).join(", ")}...`,
        code: "NoBranchesFound",
      }
    } catch (error: any) {
      console.error("[getCommitHistory] Error:", error)
      return {
        success: false,
        ...formatError(error, {
          naddr: opts.repoId,
          ref: opts.branch,
          operation: "getCommitHistory",
        }),
      }
    }
  },

  // Event-based git operations (handle repo initialization automatically)
  async listRepoFilesFromEvent(opts: {
    repoEvent: RepoAnnouncementEvent
    branch?: string
    path?: string
    repoKey?: string
  }) {
    const result = await listRepoFilesFromEvent(opts)
    return toPlain(result)
  },

  async getRepoFileContentFromEvent(opts: {
    repoEvent: RepoAnnouncementEvent
    branch?: string
    path: string
    commit?: string
    repoKey?: string
  }) {
    return await getRepoFileContentFromEvent(opts)
  },

  async listBranchesFromEvent(opts: {repoEvent: RepoAnnouncementEvent}) {
    const result = await listBranchesFromEvent(opts)
    return toPlain(result)
  },

  async getPRPreview(opts: {
    repoId: string
    sourceBranch: string
    targetBranch: string
    cloneUrls: string[]
    /** When present (fork PR), source branch is fetched from these URLs; cloneUrls = target/upstream */
    sourceCloneUrls?: string[]
  }) {
    const {key, dir} = repoKeyAndDir(opts.repoId)
    const isForkPR = opts.sourceCloneUrls && opts.sourceCloneUrls.length > 0
    const targetUrls = filterValidCloneUrls(opts.cloneUrls)
    let sourceRemote: string | undefined

    try {
      await smartInitializeRepoUtil(
        git,
        cacheManager,
        {repoId: opts.repoId, cloneUrls: targetUrls},
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, d: string) => isRepoClonedFs(g, d),
          resolveBranchName: async (d: string, requested?: string) =>
            resolveRobustBranchUtil(git, d, requested),
        },
        makeProgress(opts.repoId, "clone-progress"),
      )

      // Refresh target (upstream) branch and require freshness for PR preview.
      const orderedUrls = reorderUrlsByPreference(targetUrls, key)
      if (orderedUrls.length === 0) {
        return toPlain({
          success: false,
          error: "No valid target clone URLs available for PR preview",
          commits: [],
          commitOids: [],
          filesChanged: [],
        })
      }

      const corsProxy = resolveDefaultCorsProxy()
      const targetFetchResult = await withUrlFallback(
        orderedUrls,
        async (cloneUrl: string) => {
          await ensureOriginRemoteConfig(git, dir, cloneUrl)
          await git.fetch({
            dir,
            url: cloneUrl,
            ref: opts.targetBranch,
            singleBranch: true,
            depth: 100,
            prune: true,
            tags: false,
            corsProxy: corsProxy ?? undefined,
            onAuth: getAuthCallback(cloneUrl),
          })
          await git.resolveRef({dir, ref: `refs/remotes/origin/${opts.targetBranch}`})
        },
        {repoId: key, perUrlTimeoutMs: 15000},
      )
      if (!targetFetchResult.success) {
        return toPlain({
          success: false,
          error: `Failed to refresh target branch from remote: ${targetFetchResult.attempts?.map(a => a.error).join("; ") ?? "unknown"}`,
          commits: [],
          commitOids: [],
          filesChanged: [],
        })
      }

      if (isForkPR) {
        const sourceUrls = filterValidCloneUrls(opts.sourceCloneUrls!)
        if (sourceUrls.length === 0) {
          return toPlain({
            success: false,
            error: "No valid fork clone URLs provided",
            commits: [],
            commitOids: [],
            filesChanged: [],
          })
        }
        const sourceOrdered = reorderUrlsByPreference(sourceUrls, key)
        const prSourceRemote = `pr-source-${Date.now().toString(36)}`
        const sourceFetchResult = await withUrlFallback(
          sourceOrdered,
          async (url: string) => {
            try {
              await git.deleteRemote({dir, remote: prSourceRemote})
            } catch {
              /* ignore */
            }
            await git.addRemote({dir, remote: prSourceRemote, url})
            try {
              await git.setConfig({
                dir,
                path: `remote.${prSourceRemote}.fetch`,
                value: `+refs/heads/*:refs/remotes/${prSourceRemote}/*`,
              })
            } catch {
              /* ignore */
            }
            try {
              await git.setConfig({
                dir,
                path: `remote.${prSourceRemote}.url`,
                value: url,
              })
            } catch {
              /* ignore */
            }
            await git.fetch({
              dir,
              remote: prSourceRemote,
              ref: opts.sourceBranch,
              singleBranch: true,
              depth: 100,
              prune: true,
              tags: false,
              corsProxy: corsProxy ?? undefined,
              onAuth: getAuthCallback(url),
            })
            await git.resolveRef({
              dir,
              ref: `refs/remotes/${prSourceRemote}/${opts.sourceBranch}`,
            })
          },
          {repoId: key, perUrlTimeoutMs: 15000},
        )
        if (!sourceFetchResult.success) {
          return toPlain({
            success: false,
            error: `Failed to fetch source branch from fork: ${sourceFetchResult.attempts?.map(a => a.error).join("; ") ?? "unknown"}`,
            commits: [],
            commitOids: [],
            filesChanged: [],
          })
        }
        sourceRemote = prSourceRemote
      }

      const result = await getPRPreviewData(git, dir, opts.sourceBranch, opts.targetBranch, {
        ...(sourceRemote && {sourceRemote}),
        preferRemoteRefs: true, // Use remote refs first; local refs/heads may be stale after push
      })

      return toPlain(result)
    } catch (error: any) {
      return toPlain({
        success: false,
        error: error?.message || String(error),
        commits: [],
        commitOids: [],
        filesChanged: [],
      })
    } finally {
      if (sourceRemote) {
        try {
          await git.deleteRemote({dir, remote: sourceRemote})
        } catch {
          /* ignore cleanup */
        }
      }
    }
  },

  /**
   * Find commits ahead of tip OID in the source remote. Source-only - no target.
   * For fork: sourceCloneUrls = fork; cloneUrls = target (for repo init).
   * For same-repo: sourceCloneUrls empty; cloneUrls = repo.
   */
  async getCommitsAheadOfTip(opts: {
    repoId: string
    tipOid: string
    cloneUrls: string[]
    /** When present (fork PR), source is fetched from these; cloneUrls = target for init */
    sourceCloneUrls?: string[]
  }) {
    const {key, dir} = repoKeyAndDir(opts.repoId)
    const isForkPR = opts.sourceCloneUrls && opts.sourceCloneUrls.length > 0
    const targetUrls = filterValidCloneUrls(opts.cloneUrls)
    let sourceRemote: string | undefined

    try {
      await smartInitializeRepoUtil(
        git,
        cacheManager,
        {repoId: opts.repoId, cloneUrls: targetUrls},
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, d: string) => isRepoClonedFs(g, d),
          resolveBranchName: async (d: string, requested?: string) =>
            resolveRobustBranchUtil(git, d, requested),
        },
        makeProgress(opts.repoId, "clone-progress"),
      )

      const corsProxy = resolveDefaultCorsProxy()

      if (isForkPR) {
        const sourceUrls = filterValidCloneUrls(opts.sourceCloneUrls!)
        if (sourceUrls.length === 0) {
          return toPlain({
            success: false,
            error: "No valid fork clone URLs provided",
            commits: [],
            commitOids: [],
          })
        }
        const sourceOrdered = reorderUrlsByPreference(sourceUrls, key)
        const prSourceRemote = `pr-source-${Date.now().toString(36)}`
        const sourceFetchResult = await withUrlFallback(
          sourceOrdered,
          async (url: string) => {
            try {
              await git.deleteRemote({dir, remote: prSourceRemote})
            } catch {
              /* ignore */
            }
            await git.addRemote({dir, remote: prSourceRemote, url})
            try {
              await git.setConfig({
                dir,
                path: `remote.${prSourceRemote}.fetch`,
                value: `+refs/heads/*:refs/remotes/${prSourceRemote}/*`,
              })
            } catch {
              /* ignore */
            }
            try {
              await git.setConfig({
                dir,
                path: `remote.${prSourceRemote}.url`,
                value: url,
              })
            } catch {
              /* ignore */
            }
            await git.fetch({
              dir,
              remote: prSourceRemote,
              singleBranch: false,
              depth: 100,
              prune: true,
              tags: false,
              corsProxy: corsProxy ?? undefined,
              onAuth: getAuthCallback(url),
            })

            const sourceBranches = await git.listBranches({dir, remote: prSourceRemote})
            if (!Array.isArray(sourceBranches) || sourceBranches.length === 0) {
              throw new Error("Fork fetch succeeded but no branches were discovered")
            }
          },
          {repoId: key, perUrlTimeoutMs: 15000},
        )
        if (!sourceFetchResult.success) {
          return toPlain({
            success: false,
            error: `Failed to fetch from fork: ${sourceFetchResult.attempts?.map(a => a.error).join("; ") ?? "unknown"}`,
            commits: [],
            commitOids: [],
          })
        }
        sourceRemote = prSourceRemote
      } else {
        const orderedUrls = reorderUrlsByPreference(targetUrls, key)
        if (orderedUrls.length === 0) {
          return toPlain({
            success: false,
            error: "No valid target clone URLs available",
            commits: [],
            commitOids: [],
          })
        }
        const fetchResult = await withUrlFallback(
          orderedUrls,
          async (cloneUrl: string) => {
            await ensureOriginRemoteConfig(git, dir, cloneUrl)
            await git.fetch({
              dir,
              url: cloneUrl,
              singleBranch: false,
              depth: 100,
              prune: true,
              tags: false,
              corsProxy: corsProxy ?? undefined,
              onAuth: getAuthCallback(cloneUrl),
            })
          },
          {repoId: key, perUrlTimeoutMs: 15000},
        )
        if (!fetchResult.success) {
          return toPlain({
            success: false,
            error: `Failed to refresh repository refs: ${fetchResult.attempts?.map(a => a.error).join("; ") ?? "unknown"}`,
            commits: [],
            commitOids: [],
          })
        }
      }

      const result = await getCommitsAheadOfTipData(
        git,
        dir,
        opts.tipOid,
        sourceRemote ? {sourceRemote} : undefined,
      )

      return toPlain(result)
    } catch (error: any) {
      return toPlain({
        success: false,
        error: error?.message || String(error),
        commits: [],
        commitOids: [],
      })
    } finally {
      if (sourceRemote) {
        try {
          await git.deleteRemote({dir, remote: sourceRemote})
        } catch {
          /* ignore cleanup */
        }
      }
    }
  },

  /**
   * Get merge base between head commit and target branch. Used when preparing PR update.
   */
  async getMergeBaseBetween(opts: {
    repoId: string
    headOid: string
    targetBranch: string
    cloneUrls: string[]
    /** For fork PR, target may be in origin; sourceRemote unused for this call */
    sourceCloneUrls?: string[]
  }) {
    const {key, dir} = repoKeyAndDir(opts.repoId)
    const targetUrls = filterValidCloneUrls(opts.cloneUrls)
    try {
      if (targetUrls.length > 0) {
        const orderedUrls = reorderUrlsByPreference(targetUrls, key)
        const corsProxy = resolveDefaultCorsProxy()
        await withUrlFallback(
          orderedUrls,
          async (cloneUrl: string) => {
            await ensureOriginRemoteConfig(git, dir, cloneUrl)
            await git.fetch({
              dir,
              url: cloneUrl,
              ref: opts.targetBranch,
              singleBranch: true,
              depth: 50,
              corsProxy: corsProxy ?? undefined,
            })
          },
          {repoId: key, perUrlTimeoutMs: 15000},
        )
      }
      const result = await getMergeBaseBetweenData(
        git,
        dir,
        opts.headOid,
        opts.targetBranch,
        undefined,
      )
      return toPlain(result)
    } catch (error: any) {
      return toPlain({
        mergeBase: undefined,
        error: error?.message || String(error),
      })
    }
  },

  async fileExistsAtCommit(opts: {
    repoEvent: RepoAnnouncementEvent
    branch?: string
    path: string
    commit?: string
    repoKey?: string
  }) {
    return await fileExistsAtCommit(opts)
  },

  async getFileHistory(opts: {
    repoEvent: RepoAnnouncementEvent
    path: string
    branch: string
    maxCount?: number
    repoKey?: string
  }) {
    const result = await getFileHistory(opts)
    return toPlain(result)
  },

  async listTreeAtCommit(opts: {
    repoEvent: RepoAnnouncementEvent
    commit: string
    path?: string
    repoKey?: string
  }) {
    // Use listRepoFilesFromEvent with commit parameter
    const result = await listRepoFilesFromEvent({
      repoEvent: opts.repoEvent,
      commit: opts.commit,
      path: opts.path,
      repoKey: opts.repoKey,
    })
    return toPlain(result)
  },

  async getCommitHistoryFromEvent(opts: {
    repoEvent: RepoAnnouncementEvent
    branch: string
    depth?: number
  }) {
    // This is an alias for getCommitHistory that works with events
    // Parse repoId from event and delegate to existing method
    const event = opts.repoEvent as any
    const repoId =
      event.id || `${event.pubkey}:${event.tags?.find((t: any[]) => t[0] === "d")?.[1] || "repo"}`
    return await api.getCommitHistory({
      repoId,
      branch: opts.branch,
      depth: opts.depth,
    })
  },

  // --- Additional methods from legacy worker ---

  // Get the current data level for a repository
  getRepoDataLevel(opts: {repoId: string}): "none" | "refs" | "shallow" | "full" {
    const {key} = repoKeyAndDir(opts.repoId)
    if (!clonedRepos.has(key)) return "none"
    return repoDataLevels.get(key) || "none"
  },

  // Clear clone cache and data level tracking
  async clearCloneCache(): Promise<{success: boolean}> {
    clearCloneTracking(clonedRepos, repoDataLevels)
    try {
      await (cacheManager as any).clearOldCache?.()
    } catch (error) {
      console.warn("Failed to clear persistent cache:", error)
    }
    return {success: true}
  },

  // Delete repository and clear cache
  async deleteRepo(opts: {repoId: string}) {
    const {key, dir} = repoKeyAndDir(opts.repoId)
    clonedRepos.delete(key)
    repoDataLevels.delete(key)

    try {
      await (cacheManager as any).deleteRepoCache?.(key)
    } catch (error) {
      console.warn(`Failed to delete cache for ${opts.repoId}:`, error)
    }

    const fs: any = getProviderFs(git)

    const isNotFoundError = (error: any): boolean => {
      const code = error?.code
      const message = String(error?.message ?? error ?? "")
      return code === "ENOENT" || message.includes("ENOENT") || message.includes("Not Found")
    }

    const removeDirRecursive = async (path: string): Promise<void> => {
      if (fs?.promises?.rm) {
        try {
          await fs.promises.rm(path, {recursive: true, force: true})
        } catch (error: any) {
          if (!isNotFoundError(error)) {
            throw error
          }
        }
        return
      }

      if (fs?.promises?.rmdir) {
        try {
          await fs.promises.rmdir(path, {recursive: true})
          return
        } catch (error: any) {
          if (isNotFoundError(error)) {
            return
          }
          if (error?.code !== "ENOTEMPTY") {
            throw error
          }
        }
      }

      if (!fs?.promises?.readdir || !fs?.promises?.stat || !fs?.promises?.unlink) {
        throw new Error("Filesystem does not support recursive deletion")
      }

      let entries: string[] = []
      try {
        entries = await fs.promises.readdir(path)
      } catch (error: any) {
        if (isNotFoundError(error)) {
          return
        }
        throw error
      }

      for (const entry of entries) {
        const child = `${path}/${entry}`
        let stat: any
        try {
          stat = await fs.promises.stat(child)
        } catch (error: any) {
          if (isNotFoundError(error)) {
            continue
          }
          throw error
        }
        if (stat?.isDirectory?.()) {
          await removeDirRecursive(child)
        } else {
          try {
            await fs.promises.unlink(child)
          } catch (error: any) {
            if (!isNotFoundError(error)) {
              throw error
            }
          }
        }
      }

      if (fs?.promises?.rmdir) {
        try {
          await fs.promises.rmdir(path)
        } catch (error: any) {
          if (!isNotFoundError(error)) {
            throw error
          }
        }
      }
    }

    try {
      await removeDirRecursive(dir)
      return toPlain({success: true, repoId: opts.repoId})
    } catch (error) {
      console.error(`Failed to delete repo directory ${dir}:`, error)
      return toPlain({
        success: false,
        repoId: opts.repoId,
        ...formatError(error, {naddr: opts.repoId, operation: "deleteRepo"}),
      })
    }
  },

  // Get commit count for a repository
  async getCommitCount(opts: {repoId: string; branch?: string}) {
    const {key, dir} = repoKeyAndDir(opts.repoId)
    let targetBranch = opts.branch || "main"

    try {
      targetBranch = await resolveRobustBranchUtil(git, dir, opts.branch)
      const currentLevel = repoDataLevels.get(key)

      if (currentLevel === "full" || currentLevel === "shallow") {
        const commits = await (git as any).log({dir, ref: targetBranch})
        return toPlain({
          success: true,
          count: commits.length,
          repoId: opts.repoId,
          branch: targetBranch,
          fromCache: true,
        })
      }

      return toPlain({
        success: false,
        repoId: opts.repoId,
        branch: targetBranch,
        error: "Repository not fully cloned. Clone the repository first to get commit count.",
      })
    } catch (error) {
      return toPlain({
        success: false,
        repoId: opts.repoId,
        branch: targetBranch,
        ...formatError(error, {naddr: opts.repoId, ref: targetBranch, operation: "getCommitCount"}),
      })
    }
  },

  // Get detailed commit information including file changes
  async getCommitDetails(opts: {
    repoId: string
    commitId: string
    branch?: string
    cloneUrls?: string[]
  }) {
    const {key, dir} = repoKeyAndDir(opts.repoId)

    const isMissingCommitObjectError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error || "")
      const lower = message.toLowerCase()
      const code = (error as any)?.code
      return (
        code === "NotFoundError" ||
        /could not find\s+[0-9a-f]{7,40}/i.test(message) ||
        lower.includes("object not found") ||
        lower.includes("notfounderror")
      )
    }

    const fetchAllRefsForMissingCommit = async (): Promise<boolean> =>
      await fetchRefsUntilOidsAvailable({
        key,
        dir,
        requiredOids: [opts.commitId],
        cloneUrls: opts.cloneUrls,
      })

    try {
      // Optimization: Try to read commit locally first before triggering expensive fetch
      let commits: any[] = []
      try {
        commits = await (git as any).log({dir, depth: 1, ref: opts.commitId})
      } catch (error) {
        // Commit not found locally, need to fetch
        console.log(`[getCommitDetails] Commit ${opts.commitId} not found locally, fetching...`)
      }

      // Only fetch if commit wasn't found locally
      if (commits.length === 0) {
        let restMeta:
          | {
              sha: string
              author: string
              email: string
              date: number
              message: string
              parents: string[]
            }
          | undefined
        let restStats:
          | {
              additions: number
              deletions: number
              total: number
            }
          | undefined

        // Try REST metadata first (fast path), but DO NOT stop here.
        // We still need git objects to compute a real diff.
        try {
          const cache = await cacheManager.getRepoCache(key)
          console.log(`[getCommitDetails] Cache lookup for ${key}:`, {
            hasCache: !!cache,
            cloneUrls: cache?.cloneUrls,
            cloneUrlCount: cache?.cloneUrls?.length || 0,
          })

          if (cache?.cloneUrls?.length) {
            const {filterValidCloneUrls, reorderUrlsByPreference, hasRestApiSupport} =
              await import("../utils/clone-url-fallback.js")
            const {getGitServiceApi} = await import("../git/provider-factory.js")
            const {parseRepoFromUrl} = await import("../git/vendor-provider-factory.js")

            const validUrls = filterValidCloneUrls(cache.cloneUrls)
            const orderedUrls = reorderUrlsByPreference(validUrls, key)

            console.log(`[getCommitDetails] URL analysis:`, {
              original: cache.cloneUrls,
              valid: validUrls,
              ordered: orderedUrls,
            })

            for (const url of orderedUrls.slice(0, 1)) {
              const hasApi = hasRestApiSupport(url)
              console.log(`[getCommitDetails] Checking URL ${url}: hasRestApi=${hasApi}`)

              if (!hasApi) continue

              try {
                console.log(`[getCommitDetails] Trying REST API for ${url}`)
                const parsed = parseRepoFromUrl(url)
                if (!parsed) {
                  console.warn(`[getCommitDetails] Failed to parse repo URL: ${url}`)
                  continue
                }

                const {owner, repo, provider} = parsed
                console.log(
                  `[getCommitDetails] Parsed: owner=${owner}, repo=${repo}, vendor=${provider.vendor}`,
                )

                const api = getGitServiceApi(provider.vendor, "", provider.getApiUrl(""))
                const commitData = await api.getCommit(owner, repo, opts.commitId)

                console.log(
                  `[getCommitDetails] REST API metadata loaded for commit ${opts.commitId}`,
                )

                restMeta = {
                  sha: commitData.sha,
                  author: commitData.author.name,
                  email: commitData.author.email,
                  date: new Date(commitData.author.date).getTime(),
                  message: commitData.message,
                  parents: commitData.parents?.map((p: any) => p.sha) || [],
                }

                if (commitData.stats) {
                  restStats = {
                    additions: Number(commitData.stats.additions || 0),
                    deletions: Number(commitData.stats.deletions || 0),
                    total: Number(commitData.stats.total || 0),
                  }
                }
                break
              } catch (apiError) {
                console.warn(`[getCommitDetails] REST API failed for ${url}:`, apiError)
              }
            }
          } else {
            console.log(`[getCommitDetails] No clone URLs in cache, will attempt clone`)
          }
        } catch (cacheError) {
          console.warn(`[getCommitDetails] Failed to check cache for REST API:`, cacheError)
        }

        let cloneError: unknown
        try {
          await ensureFullCloneUtil(
            git,
            {repoId: opts.repoId, branch: opts.branch, depth: 1000, cloneUrls: opts.cloneUrls},
            {
              rootDir,
              parseRepoId,
              repoDataLevels,
              clonedRepos,
              isRepoCloned: async (g: GitProvider, d: string) => isRepoClonedFs(g, d),
              resolveBranchName: async (d: string, requested?: string) =>
                resolveRobustBranchUtil(git, d, requested),
              cacheManager,
            },
            makeProgress(opts.repoId, "clone-progress"),
          )

          commits = await (git as any).log({dir, depth: 1, ref: opts.commitId})

          if (commits.length === 0) {
            console.warn(
              `[getCommitDetails] Commit ${opts.commitId} still missing after branch fetch, trying full ref fetch...`,
            )
            const recovered = await fetchAllRefsForMissingCommit()
            if (recovered) {
              commits = await (git as any).log({dir, depth: 1, ref: opts.commitId})
            }
          }
        } catch (error) {
          cloneError = error
        }

        if (commits.length === 0 && restMeta) {
          const fallbackWarning =
            cloneError instanceof Error
              ? `Commit metadata loaded from REST API, but git diff could not be loaded: ${cloneError.message}`
              : "Commit metadata loaded from REST API, but git diff could not be loaded."

          return toPlain({
            success: true,
            meta: restMeta,
            changes: [],
            stats: restStats,
            warning: fallbackWarning,
            diffAvailable: false,
            source: "rest-api",
          })
        }

        if (cloneError) {
          throw cloneError
        }
      }
      if (commits.length === 0) {
        throw new Error(`Commit ${opts.commitId} not found`)
      }

      const commit = commits[0]
      const meta = {
        sha: commit.oid,
        author: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.timestamp * 1000,
        message: commit.commit.message,
        parents: commit.commit.parent || [],
      }

      const collectCommitChanges = async () => {
        const changes: Array<{
          path: string
          status: "added" | "modified" | "deleted" | "renamed"
          diffHunks: Array<{
            oldStart: number
            oldLines: number
            newStart: number
            newLines: number
            patches: Array<{line: string; type: "+" | "-" | " "}>
          }>
        }> = []

        // If this is not the initial commit, compare with parent
        if (commit.commit.parent && commit.commit.parent.length > 0) {
          const parentCommit = commit.commit.parent[0]

          // Get the list of changed files
          const changedFiles = await (git as any).walk({
            dir,
            trees: [(git as any).TREE({ref: parentCommit}), (git as any).TREE({ref: commit.oid})],
            map: async function (filepath: string, [A, B]: any[]) {
              // Skip directories
              if (filepath === ".") return
              // Only process file blobs; ignore trees (directories) and other types
              try {
                const at = A ? await A.type() : undefined
                const bt = B ? await B.type() : undefined
                const isABlob = at === "blob"
                const isBBlob = bt === "blob"
                if (!isABlob && !isBBlob) {
                  return
                }
              } catch (e) {
                console.warn(`Type detection failed for ${filepath}:`, e)
                // Continue but log the issue
              }

              const Aoid = await A?.oid()
              const Boid = await B?.oid()

              // Determine file status
              let status: "added" | "modified" | "deleted" | "renamed" = "modified"
              if (Aoid === undefined && Boid !== undefined) {
                status = "added"
              } else if (Aoid !== undefined && Boid === undefined) {
                status = "deleted"
              } else if (Aoid !== Boid) {
                status = "modified"
              } else {
                return // No change
              }

              // Get diff for this file
              let diffHunks: Array<{
                oldStart: number
                oldLines: number
                newStart: number
                newLines: number
                patches: Array<{line: string; type: "+" | "-" | " "}>
              }> = []

              try {
                if (status === "added") {
                  const blob = await B!.content()
                  const lines = new TextDecoder().decode(blob).split("\n")
                  diffHunks = [
                    {
                      oldStart: 0,
                      oldLines: 0,
                      newStart: 1,
                      newLines: lines.length,
                      patches: lines.map((line: string) => ({line, type: "+" as const})),
                    },
                  ]
                } else if (status === "deleted") {
                  const blob = await A!.content()
                  const lines = new TextDecoder().decode(blob).split("\n")
                  diffHunks = [
                    {
                      oldStart: 1,
                      oldLines: lines.length,
                      newStart: 0,
                      newLines: 0,
                      patches: lines.map((line: string) => ({line, type: "-" as const})),
                    },
                  ]
                } else {
                  // For modified files, compute aligned diff with LCS/Myers
                  const oldBlob = await A!.content()
                  const newBlob = await B!.content()
                  const oldText = new TextDecoder().decode(oldBlob)
                  const newText = new TextDecoder().decode(newBlob)
                  diffHunks = buildModifiedFileDiffHunks(oldText, newText)
                }
              } catch (diffError) {
                console.warn(`Failed to generate diff for ${filepath}:`, diffError)
                diffHunks = []
              }

              return {path: filepath, status, diffHunks}
            },
          })

          changes.push(...changedFiles.filter(Boolean))
        } else {
          // Initial commit - show all files as added
          const files = await (git as any).walk({
            dir,
            trees: [(git as any).TREE({ref: opts.commitId})],
            map: async function (filepath: string, [A]: any[]) {
              if (filepath === ".") return
              const oid = await A?.oid()
              if (!oid) return

              try {
                // When reading by OID, don't pass filepath - it's already resolved
                const content = await (git as any).readBlob({dir, oid})
                const lines = new TextDecoder().decode(content.blob).split("\n")
                return {
                  path: filepath,
                  status: "added" as const,
                  diffHunks: [
                    {
                      oldStart: 0,
                      oldLines: 0,
                      newStart: 1,
                      newLines: lines.length,
                      patches: lines.map((line: string) => ({line, type: "+" as const})),
                    },
                  ],
                }
              } catch (error) {
                return {path: filepath, status: "added" as const, diffHunks: []}
              }
            },
          })
          changes.push(...files.filter(Boolean))
        }

        return changes
      }

      let warning: string | undefined
      let changes: Array<{
        path: string
        status: "added" | "modified" | "deleted" | "renamed"
        diffHunks: Array<{
          oldStart: number
          oldLines: number
          newStart: number
          newLines: number
          patches: Array<{line: string; type: "+" | "-" | " "}>
        }>
      }> = []

      try {
        changes = await collectCommitChanges()
      } catch (diffError) {
        if (!isMissingCommitObjectError(diffError)) {
          throw diffError
        }

        console.warn(
          `[getCommitDetails] Missing commit objects for ${opts.commitId}, attempting ancestor refetch...`,
          diffError,
        )

        let recovered = false
        try {
          const remotes = await git.listRemotes({dir})
          const originRemote = remotes.find((r: any) => r.remote === "origin")
          const urlsToTry: string[] = []
          if (originRemote?.url) urlsToTry.push(originRemote.url)

          try {
            const cache = await cacheManager.getRepoCache(key)
            for (const url of filterValidCloneUrls(cache?.cloneUrls || [])) {
              if (!urlsToTry.includes(url)) urlsToTry.push(url)
            }
          } catch {
            // ignore cache errors
          }

          const orderedUrls = reorderUrlsByPreference(filterValidCloneUrls(urlsToTry), key)
          if (orderedUrls.length > 0) {
            const corsProxy = resolveDefaultCorsProxy()
            const fetchResult = await withUrlFallback(
              orderedUrls,
              async (url: string) => {
                const authCallback = getAuthCallback(url)
                await git.fetch({
                  dir,
                  url,
                  singleBranch: false,
                  depth: 1000,
                  tags: false,
                  corsProxy,
                  ...(authCallback && {onAuth: authCallback}),
                })
                return true
              },
              {repoId: key, perUrlTimeoutMs: 20000},
            )
            recovered = fetchResult.success
          }
        } catch (recoverError) {
          console.warn(
            `[getCommitDetails] Ancestor refetch failed for ${opts.commitId}:`,
            recoverError,
          )
        }

        if (recovered) {
          try {
            changes = await collectCommitChanges()
          } catch (retryError) {
            if (!isMissingCommitObjectError(retryError)) {
              throw retryError
            }
            warning =
              "Commit metadata loaded, but diff is unavailable because ancestor objects are missing."
          }
        } else {
          warning =
            "Commit metadata loaded, but diff is unavailable because ancestor objects are missing."
        }
      }

      return toPlain({
        success: true,
        meta,
        changes,
        warning,
        diffAvailable: !warning,
        source: "worker",
      })
    } catch (error) {
      return toPlain({
        success: false,
        ...formatError(error, {
          naddr: opts.repoId,
          ref: opts.commitId,
          operation: "getCommitDetails",
        }),
      })
    }
  },

  /**
   * Get diff between two commits (baseOid -> headOid).
   * Returns changes with diffHunks in the same format as getCommitDetails.
   * Used for PR diff display when base=merge-base and head=PR tip.
   */
  async getDiffBetween(opts: {
    repoId: string
    baseOid: string
    headOid: string
    cloneUrls?: string[]
  }): Promise<{
    success: boolean
    changes?: Array<{
      path: string
      status: "added" | "modified" | "deleted" | "renamed"
      diffHunks: Array<{
        oldStart: number
        oldLines: number
        newStart: number
        newLines: number
        patches: Array<{line: string; type: "+" | "-" | " "}>
      }>
    }>
    error?: string
  }> {
    const {key, dir} = repoKeyAndDir(opts.repoId)

    try {
      await ensureFullCloneUtil(
        git,
        {repoId: opts.repoId, depth: 100, cloneUrls: opts.cloneUrls},
        {
          rootDir,
          parseRepoId,
          repoDataLevels,
          clonedRepos,
          isRepoCloned: async (g: GitProvider, d: string) => isRepoClonedFs(g, d),
          resolveBranchName: async (d: string, requested?: string) =>
            resolveRobustBranchUtil(git, d, requested),
          cacheManager,
        },
        makeProgress(opts.repoId, "clone-progress"),
      )

      const requiredOids = Array.from(new Set([opts.baseOid, opts.headOid].filter(Boolean)))
      const missingOids: string[] = []
      for (const oid of requiredOids) {
        if (!(await hasCommitObject(dir, oid))) {
          missingOids.push(oid)
        }
      }

      if (missingOids.length > 0) {
        const recovered = await fetchRefsUntilOidsAvailable({
          key,
          dir,
          requiredOids,
          cloneUrls: opts.cloneUrls,
        })

        if (!recovered) {
          throw new Error(`Could not find ${missingOids.join(", ")}.`)
        }
      }

      const changes: Array<{
        path: string
        status: "added" | "modified" | "deleted" | "renamed"
        diffHunks: Array<{
          oldStart: number
          oldLines: number
          newStart: number
          newLines: number
          patches: Array<{line: string; type: "+" | "-" | " "}>
        }>
      }> = []

      const changedFiles = await (git as any).walk({
        dir,
        trees: [(git as any).TREE({ref: opts.baseOid}), (git as any).TREE({ref: opts.headOid})],
        map: async function (filepath: string, [A, B]: any[]) {
          if (filepath === ".") return
          try {
            const at = A ? await A.type() : undefined
            const bt = B ? await B.type() : undefined
            const isABlob = at === "blob"
            const isBBlob = bt === "blob"
            if (!isABlob && !isBBlob) return
          } catch {
            return
          }

          const Aoid = await A?.oid()
          const Boid = await B?.oid()

          let status: "added" | "modified" | "deleted" | "renamed" = "modified"
          if (Aoid === undefined && Boid !== undefined) {
            status = "added"
          } else if (Aoid !== undefined && Boid === undefined) {
            status = "deleted"
          } else if (Aoid !== Boid) {
            status = "modified"
          } else {
            return
          }

          let diffHunks: Array<{
            oldStart: number
            oldLines: number
            newStart: number
            newLines: number
            patches: Array<{line: string; type: "+" | "-" | " "}>
          }> = []

          try {
            if (status === "added") {
              const blob = await B!.content()
              const lines = new TextDecoder().decode(blob).split("\n")
              diffHunks = [
                {
                  oldStart: 0,
                  oldLines: 0,
                  newStart: 1,
                  newLines: lines.length,
                  patches: lines.map((line: string) => ({line, type: "+" as const})),
                },
              ]
            } else if (status === "deleted") {
              const blob = await A!.content()
              const lines = new TextDecoder().decode(blob).split("\n")
              diffHunks = [
                {
                  oldStart: 1,
                  oldLines: lines.length,
                  newStart: 0,
                  newLines: 0,
                  patches: lines.map((line: string) => ({line, type: "-" as const})),
                },
              ]
            } else {
              const oldBlob = await A!.content()
              const newBlob = await B!.content()
              const oldText = new TextDecoder().decode(oldBlob)
              const newText = new TextDecoder().decode(newBlob)
              diffHunks = buildModifiedFileDiffHunks(oldText, newText)
            }
          } catch (diffError) {
            console.warn(`Failed to generate diff for ${filepath}:`, diffError)
          }

          return {path: filepath, status, diffHunks}
        },
      })

      changes.push(...changedFiles.filter(Boolean))
      return toPlain({success: true, changes})
    } catch (error) {
      return toPlain({
        success: false,
        ...formatError(error, {
          naddr: opts.repoId,
          ref: opts.headOid,
          operation: "getDiffBetween",
        }),
      })
    }
  },

  // Get working tree status for a repository
  async getStatus(opts: {repoId: string; branch?: string}) {
    const {key, dir} = repoKeyAndDir(opts.repoId)

    try {
      const cloned = await isRepoClonedFs(git, dir)
      if (!cloned) {
        return toPlain({
          success: false,
          repoId: opts.repoId,
          branch: opts.branch || "main",
          files: [],
          counts: {},
          error: "Repository not cloned locally",
        })
      }

      const targetBranch = await resolveRobustBranchUtil(git, dir, opts.branch)

      try {
        await (git as any).checkout({dir, ref: targetBranch})
      } catch {
        // ignore checkout errors
      }

      const matrix = await (git as any).statusMatrix({dir})
      type StatusFile = {
        path: string
        head: number
        workdir: number
        stage: number
        status: string
      }

      const files: StatusFile[] = matrix.map((row: any) => {
        const path = row[0] as string
        const head = row[1] as number
        const workdir = row[2] as number
        const stage = row[3] as number
        let status = "unknown"
        if (head === 0 && workdir === 2 && stage === 0) status = "untracked"
        else if (head === 1 && workdir === 0 && stage === 0) status = "deleted"
        else if (head === 1 && workdir === 2 && stage === 1) status = "modified"
        else if (head === 0 && workdir === 2 && stage === 2) status = "added"
        else if (head !== stage) status = "staged"
        return {path, head, workdir, stage, status}
      })

      const counts: Record<string, number> = {}
      for (const f of files) counts[f.status] = (counts[f.status] || 0) + 1

      return toPlain({
        success: true,
        repoId: opts.repoId,
        branch: targetBranch,
        files,
        counts,
      })
    } catch (error) {
      return toPlain({
        success: false,
        repoId: opts.repoId,
        branch: opts.branch || "main",
        files: [],
        counts: {},
        ...formatError(error, {naddr: opts.repoId, ref: opts.branch, operation: "getStatus"}),
      })
    }
  },

  // Reset local repository to match remote HEAD state
  async resetRepoToRemote(opts: {repoId: string; branch?: string}) {
    const {key, dir} = repoKeyAndDir(opts.repoId)

    try {
      const targetBranch = await resolveRobustBranchUtil(git, dir, opts.branch)
      const remotes = await (git as any).listRemotes({dir})
      const originRemote = remotes.find((r: any) => r.remote === "origin")

      if (!originRemote?.url) {
        throw new Error("No origin remote found - cannot reset to remote state")
      }

      const authCallback = getAuthCallback(originRemote.url)
      await (git as any).fetch({
        dir,
        url: originRemote.url,
        ref: targetBranch,
        singleBranch: true,
        ...(authCallback && {onAuth: authCallback}),
      })

      const remoteRef = `refs/remotes/origin/${targetBranch}`
      const remoteCommit = await (git as any).resolveRef({dir, ref: remoteRef})

      await (git as any).checkout({dir, ref: remoteCommit, force: true})
      await (git as any).writeRef({
        dir,
        ref: `refs/heads/${targetBranch}`,
        value: remoteCommit,
        force: true,
      })
      await (git as any).checkout({dir, ref: targetBranch})

      return toPlain({
        success: true,
        repoId: opts.repoId,
        branch: targetBranch,
        remoteCommit,
        message: "Repository reset to remote state",
      })
    } catch (error) {
      return toPlain({
        success: false,
        repoId: opts.repoId,
        branch: opts.branch,
        ...formatError(error, {
          naddr: opts.repoId,
          ref: opts.branch,
          operation: "resetRepoToRemote",
        }),
      })
    }
  },

  // --- Repository Management Functions ---

  // Get .gitignore template content
  async getGitignoreTemplate(opts: {template: string}) {
    const content = await getGitignoreTemplate(opts.template)
    return toPlain({success: true, content})
  },

  // Get license template content
  async getLicenseTemplate(opts: {template: string; authorName: string}) {
    const content = await getLicenseTemplate(opts.template, opts.authorName)
    return toPlain({success: true, content})
  },

  // Create a new local git repository with initial files
  async createLocalRepo(opts: CreateLocalRepoOptions) {
    const result = await createLocalRepo(git, rootDir, clonedRepos, repoDataLevels, opts)
    return toPlain(result)
  },

  // Create a remote repository on GitHub/GitLab/Gitea/GRASP
  async createRemoteRepo(opts: CreateRemoteRepoOptions) {
    const result = await createRemoteRepo(opts)
    return toPlain(result)
  },

  // Fork and clone a repository
  async forkAndCloneRepo(opts: ForkAndCloneOptions) {
    const progressRepoId = opts.dir || `${opts.owner}/${opts.forkName}`
    const result = await forkAndCloneRepo(git, cacheManager, rootDir, {
      ...opts,
      onProgress: (stage: string, pct?: number) => {
        postProgress({
          type: "clone-progress",
          repoId: progressRepoId,
          phase: stage,
          ...(typeof pct === "number" ? {progress: pct} : {}),
        })
      },
    })
    return toPlain(result)
  },

  // Delete a remote repository
  async deleteRemoteRepo(opts: DeleteRemoteRepoOptions) {
    const result = await deleteRemoteRepo(opts)
    return toPlain(result)
  },

  // Update remote repository metadata
  async updateRemoteRepoMetadata(opts: UpdateRemoteRepoMetadataOptions) {
    const result = await updateRemoteRepoMetadata(opts)
    return toPlain(result)
  },

  // Update and push files to a repository
  async updateAndPushFiles(opts: UpdateAndPushFilesOptions) {
    const result = await updateAndPushFiles(git, opts)
    return toPlain(result)
  },
}

expose(api)
