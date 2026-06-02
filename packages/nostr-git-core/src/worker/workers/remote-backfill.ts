import type {GitProvider} from "../../git/provider.js"
import {listAdvertisedServerRefs} from "../../utils/advertised-refs.js"
import {filterValidCloneUrls} from "../../utils/clone-url-fallback.js"
import {isGraspRepoHttpUrl, resolveCorsProxyForUrl} from "../../utils/grasp-url.js"

import {getAuthCallback} from "./auth.js"
import {resolveDefaultCorsProxy} from "./git-config.js"
import {ensureDir, getProviderFs, safeRmrf} from "./fs-utils.js"
import {ensureOriginRemoteConfig} from "./repos.js"

const LIST_REFS_TIMEOUT_MS = 20_000

export type RemoteBackfillRefType = "heads" | "tags"

export type RemoteBackfillRemoteSnapshot = {
  remoteUrl: string
  reachable: boolean
  headBranch?: string
  refs: Array<{
    ref: string
    name: string
    type: RemoteBackfillRefType
    oid: string
  }>
  error?: string
}

export type RemoteBackfillRemoteRefState = {
  remoteUrl: string
  currentOid?: string
  status: "up-to-date" | "create" | "fast-forward" | "conflict"
}

export type RemoteBackfillRemoteAction = {
  ref: string
  name: string
  type: RemoteBackfillRefType
  action: "create" | "fast-forward"
  currentOid?: string
  effectiveOid: string
  sourceUrls: string[]
}

export type RemoteBackfillRemoteConflict = {
  ref: string
  name: string
  type: RemoteBackfillRefType
  currentOid?: string
  effectiveOid?: string
  reason: string
}

export type RemoteBackfillRefPlan = {
  ref: string
  name: string
  type: RemoteBackfillRefType
  effectiveOid?: string
  sourceUrls: string[]
  status: "ready" | "conflict"
  reason?: string
  selectedByDefault: boolean
  createCount: number
  fastForwardCount: number
  conflictCount: number
  remoteStates: RemoteBackfillRemoteRefState[]
}

export type RemoteBackfillRemotePlan = {
  remoteUrl: string
  reachable: boolean
  headBranch?: string
  error?: string
  selectedByDefault: boolean
  createCount: number
  fastForwardCount: number
  conflictCount: number
  actions: RemoteBackfillRemoteAction[]
  conflicts: RemoteBackfillRemoteConflict[]
}

export type RemoteBackfillDiscoveryResult = {
  success: boolean
  remotes: RemoteBackfillRemotePlan[]
  refs: RemoteBackfillRefPlan[]
  summary: {
    remoteCount: number
    reachableRemoteCount: number
    actionableRefCount: number
    readyRefCount: number
    conflictRefCount: number
    targetCount: number
  }
}

export type RemoteBackfillTargetRefSelection = {
  ref: string
  name: string
  type: RemoteBackfillRefType
  effectiveOid: string
  currentOid?: string
  sourceUrls: string[]
}

export type RemoteBackfillTargetSelection = {
  remoteUrl: string
  refs: RemoteBackfillTargetRefSelection[]
}

export type RemoteBackfillExecuteResult = {
  success: boolean
  results: Array<{
    remoteUrl: string
    success: boolean
    pushedRefs: string[]
    failedRefs: Array<{ref: string; error: string}>
    skippedRefs: Array<{ref: string; reason: string}>
    error?: string
  }>
  summary: {
    targetCount: number
    successCount: number
    failureCount: number
    pushedRefCount: number
    failedRefCount: number
    skippedRefCount: number
  }
}

export type RemoteBackfillPrepareResult = {
  success: boolean
  stageRepoId?: string
  hydratedRefCount: number
  hydrationFailures: Array<{ref: string; error: string}>
}

type RemoteBackfillDiscoveryDeps = {
  rootDir: string
  parseRepoId: (id: string) => string
  onProgress?: (phase: string, loaded?: number, total?: number) => void
}

type RemoteBackfillExecuteDeps = RemoteBackfillDiscoveryDeps & {
  pushToRemote: (params: {
    repoId: string
    remoteUrl: string
    refs: string[]
    provider?: string
    token?: string
  }) => Promise<any>
}

type InternalRefEntry = {
  ref: string
  name: string
  type: RemoteBackfillRefType
  byRemote: Map<string, string>
  variants: Map<string, string[]>
}

type StageRepoContext = {
  repoId: string
  key: string
  dir: string
}

function sortRefs<T extends {type: RemoteBackfillRefType; name: string}>(refs: T[]): T[] {
  return [...refs].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "heads" ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })
}

function parseHeadBranch(
  refs: Array<{ref?: string; symref?: string; target?: string}>,
): string | undefined {
  const headEntry = refs.find(ref => ref?.ref === "HEAD")
  const target = typeof headEntry?.symref === "string" ? headEntry.symref : headEntry?.target
  if (typeof target === "string" && target.startsWith("refs/heads/")) {
    return target.slice("refs/heads/".length)
  }

  return undefined
}

function parseRemoteSnapshot(params: {
  remoteUrl: string
  refs: Array<{ref?: string; oid?: string; symref?: string; target?: string}>
}): RemoteBackfillRemoteSnapshot {
  const entries = sortRefs(
    (params.refs || [])
      .filter(ref => {
        if (!ref?.ref || typeof ref.ref !== "string") return false
        if (!ref?.oid || typeof ref.oid !== "string") return false
        if (!(ref.ref.startsWith("refs/heads/") || ref.ref.startsWith("refs/tags/"))) return false
        if (ref.ref.startsWith("refs/tags/") && ref.ref.endsWith("^{}")) return false
        return true
      })
      .map(ref => ({
        ref: ref.ref!,
        name: ref.ref!.replace(/^refs\/(heads|tags)\//, ""),
        type: ref.ref!.startsWith("refs/tags/") ? ("tags" as const) : ("heads" as const),
        oid: ref.oid!,
      })),
  )

  return {
    remoteUrl: params.remoteUrl,
    reachable: true,
    headBranch: parseHeadBranch(params.refs || []),
    refs: entries,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return await promise
  }

  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

async function loadRemoteSnapshot(
  git: GitProvider,
  remoteUrl: string,
): Promise<RemoteBackfillRemoteSnapshot> {
  try {
    const authCallback = getAuthCallback(remoteUrl)
    const refs = (await withTimeout(
      listAdvertisedServerRefs(git, {
        url: remoteUrl,
        symrefs: true,
        ...(authCallback ? {onAuth: authCallback} : {}),
        corsProxy: resolveDefaultCorsProxy(),
      }),
      LIST_REFS_TIMEOUT_MS,
      `listServerRefs(${remoteUrl})`,
    )) as Array<{ref?: string; oid?: string; symref?: string; target?: string}>

    return parseRemoteSnapshot({remoteUrl, refs: Array.isArray(refs) ? refs : []})
  } catch (error) {
    return {
      remoteUrl,
      reachable: false,
      refs: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function getSelectedTargets(
  targets: RemoteBackfillTargetSelection[],
): RemoteBackfillTargetSelection[] {
  return (targets || []).filter(target => target.refs && target.refs.length > 0)
}

function collectUniqueSelectedRefs(
  targets: RemoteBackfillTargetSelection[],
): Map<string, RemoteBackfillTargetRefSelection> {
  const uniqueRefs = new Map<string, RemoteBackfillTargetRefSelection>()

  for (const target of targets) {
    for (const ref of target.refs) {
      if (!uniqueRefs.has(ref.ref)) {
        uniqueRefs.set(ref.ref, ref)
      }
    }
  }

  return uniqueRefs
}

async function hydrateStageRepoForRefs(
  git: GitProvider,
  stage: StageRepoContext,
  refs: Map<string, RemoteBackfillTargetRefSelection>,
  onProgress?: (phase: string, loaded?: number, total?: number) => void,
): Promise<{
  hydrationFailures: Map<string, string>
  hydratedRefs: string[]
}> {
  const hydrationFailures = new Map<string, string>()
  const hydratedRefs: string[] = []
  const refList = Array.from(refs.values())

  for (let index = 0; index < refList.length; index++) {
    const ref = refList[index]
    onProgress?.(
      `Backfill: hydrating ${formatBackfillRefForProgress(ref)} (${index + 1}/${refList.length})`,
      index,
      refList.length,
    )
    let hydrated = false
    let lastError = "Could not load selected ref objects into the local staging repo"

    for (const sourceUrl of ref.sourceUrls) {
      hydrated = await ensureStageObjectForRef({
        git,
        dir: stage.dir,
        remoteUrl: sourceUrl,
        ref: ref.ref,
        type: ref.type,
        oid: ref.effectiveOid,
      })

      if (hydrated) {
        await materializeStageRef({
          git,
          dir: stage.dir,
          ref: ref.ref,
          oid: ref.effectiveOid,
        })
        hydratedRefs.push(ref.ref)
        onProgress?.(
          `Backfill: hydrated ${formatBackfillRefForProgress(ref)} (${index + 1}/${refList.length})`,
          index + 1,
          refList.length,
        )
        break
      }

      lastError = `Could not fetch ${ref.ref} from ${sourceUrl}`
    }

    if (!hydrated) {
      hydrationFailures.set(ref.ref, lastError)
      onProgress?.(
        `Backfill: failed to hydrate ${formatBackfillRefForProgress(ref)} (${index + 1}/${refList.length})`,
        index + 1,
        refList.length,
      )
    }
  }

  return {
    hydrationFailures,
    hydratedRefs,
  }
}

function collectRefEntries(snapshots: RemoteBackfillRemoteSnapshot[]): InternalRefEntry[] {
  const entries = new Map<string, InternalRefEntry>()

  for (const snapshot of snapshots) {
    if (!snapshot.reachable) continue

    for (const ref of snapshot.refs) {
      const existing = entries.get(ref.ref) || {
        ref: ref.ref,
        name: ref.name,
        type: ref.type,
        byRemote: new Map<string, string>(),
        variants: new Map<string, string[]>(),
      }

      existing.byRemote.set(snapshot.remoteUrl, ref.oid)
      const nextSources = existing.variants.get(ref.oid) || []
      if (!nextSources.includes(snapshot.remoteUrl)) {
        existing.variants.set(ref.oid, [...nextSources, snapshot.remoteUrl])
      }
      entries.set(ref.ref, existing)
    }
  }

  return sortRefs(Array.from(entries.values()).map(entry => ({...entry}))) as InternalRefEntry[]
}

export async function buildRemoteBackfillPlanFromSnapshots(
  snapshots: RemoteBackfillRemoteSnapshot[],
  deps: {
    isDescendent?: (oid: string, ancestor: string) => Promise<boolean>
    defaultBranch?: string
  } = {},
): Promise<Omit<RemoteBackfillDiscoveryResult, "success">> {
  const refEntries = collectRefEntries(snapshots)
  const defaultBranchNames = collectDefaultBranchNames(snapshots, deps.defaultBranch)
  const ancestryCache = new Map<string, boolean>()
  let ancestryErrored = false

  const checkDescendent = async (oid: string, ancestor: string) => {
    if (oid === ancestor) return true
    const key = `${oid}=>${ancestor}`
    if (ancestryCache.has(key)) {
      return ancestryCache.get(key)!
    }

    if (!deps.isDescendent) {
      ancestryCache.set(key, false)
      return false
    }

    try {
      const result = await deps.isDescendent(oid, ancestor)
      ancestryCache.set(key, Boolean(result))
      return Boolean(result)
    } catch {
      ancestryErrored = true
      ancestryCache.set(key, false)
      return false
    }
  }

  const refPlans: RemoteBackfillRefPlan[] = []

  for (const entry of refEntries) {
    const uniqueOids = Array.from(entry.variants.keys())
    const remoteStates: RemoteBackfillRemoteRefState[] = []
    let effectiveOid: string | undefined
    let sourceUrls: string[] = []
    let status: RemoteBackfillRefPlan["status"] = "ready"
    let reason: string | undefined

    if (uniqueOids.length === 1) {
      effectiveOid = uniqueOids[0]
      sourceUrls = entry.variants.get(effectiveOid) || []
    } else if (entry.type === "tags") {
      status = "conflict"
      reason = "Multiple remotes advertise different tag objects for this tag"
    } else {
      const winners: string[] = []

      for (const candidateOid of uniqueOids) {
        let dominates = true
        for (const otherOid of uniqueOids) {
          if (candidateOid === otherOid) continue
          if (!(await checkDescendent(candidateOid, otherOid))) {
            dominates = false
            break
          }
        }

        if (dominates) {
          winners.push(candidateOid)
        }
      }

      if (winners.length === 1) {
        effectiveOid = winners[0]
        sourceUrls = entry.variants.get(effectiveOid) || []
      } else {
        status = "conflict"
        reason = ancestryErrored
          ? "Could not verify ancestry between advertised branch tips"
          : "Multiple remotes advertise conflicting branch tips"
      }
    }

    for (const snapshot of snapshots) {
      if (!snapshot.reachable) continue
      const currentOid = entry.byRemote.get(snapshot.remoteUrl)

      if (!effectiveOid || status === "conflict") {
        remoteStates.push({
          remoteUrl: snapshot.remoteUrl,
          currentOid,
          status: currentOid ? "conflict" : "conflict",
        })
        continue
      }

      if (!currentOid) {
        remoteStates.push({remoteUrl: snapshot.remoteUrl, status: "create"})
        continue
      }

      if (currentOid === effectiveOid) {
        remoteStates.push({remoteUrl: snapshot.remoteUrl, currentOid, status: "up-to-date"})
        continue
      }

      if (entry.type === "heads" && (await checkDescendent(effectiveOid, currentOid))) {
        remoteStates.push({
          remoteUrl: snapshot.remoteUrl,
          currentOid,
          status: "fast-forward",
        })
        continue
      }

      status = "conflict"
      reason = reason || "Branch tip cannot be updated safely without a forced push"
      remoteStates.push({remoteUrl: snapshot.remoteUrl, currentOid, status: "conflict"})
    }

    const createCount = remoteStates.filter(state => state.status === "create").length
    const fastForwardCount = remoteStates.filter(state => state.status === "fast-forward").length
    const conflictCount = remoteStates.filter(state => state.status === "conflict").length

    if (createCount === 0 && fastForwardCount === 0 && conflictCount === 0) {
      continue
    }

    refPlans.push({
      ref: entry.ref,
      name: entry.name,
      type: entry.type,
      effectiveOid,
      sourceUrls,
      status,
      reason,
      selectedByDefault:
        status === "ready" &&
        createCount + fastForwardCount > 0 &&
        isBackfillRefSelectedByDefault(entry, defaultBranchNames),
      createCount,
      fastForwardCount,
      conflictCount,
      remoteStates,
    })
  }

  const remotePlans: RemoteBackfillRemotePlan[] = snapshots.map(snapshot => {
    if (!snapshot.reachable) {
      return {
        remoteUrl: snapshot.remoteUrl,
        reachable: false,
        headBranch: snapshot.headBranch,
        error: snapshot.error,
        selectedByDefault: false,
        createCount: 0,
        fastForwardCount: 0,
        conflictCount: 0,
        actions: [],
        conflicts: [],
      }
    }

    const actions: RemoteBackfillRemoteAction[] = []
    const conflicts: RemoteBackfillRemoteConflict[] = []

    for (const refPlan of refPlans) {
      const state = refPlan.remoteStates.find(entry => entry.remoteUrl === snapshot.remoteUrl)
      if (!state) continue

      if (state.status === "create" || state.status === "fast-forward") {
        if (!refPlan.effectiveOid) continue
        actions.push({
          ref: refPlan.ref,
          name: refPlan.name,
          type: refPlan.type,
          action: state.status,
          currentOid: state.currentOid,
          effectiveOid: refPlan.effectiveOid,
          sourceUrls: refPlan.sourceUrls,
        })
      } else if (state.status === "conflict") {
        conflicts.push({
          ref: refPlan.ref,
          name: refPlan.name,
          type: refPlan.type,
          currentOid: state.currentOid,
          effectiveOid: refPlan.effectiveOid,
          reason: refPlan.reason || "Ref cannot be updated safely",
        })
      }
    }

    return {
      remoteUrl: snapshot.remoteUrl,
      reachable: true,
      headBranch: snapshot.headBranch,
      selectedByDefault: actions.some(action =>
        isBackfillRefSelectedByDefault(action, defaultBranchNames),
      ),
      createCount: actions.filter(action => action.action === "create").length,
      fastForwardCount: actions.filter(action => action.action === "fast-forward").length,
      conflictCount: conflicts.length,
      actions,
      conflicts,
    }
  })

  return {
    remotes: remotePlans,
    refs: refPlans,
    summary: {
      remoteCount: snapshots.length,
      reachableRemoteCount: snapshots.filter(snapshot => snapshot.reachable).length,
      actionableRefCount: refPlans.length,
      readyRefCount: refPlans.filter(ref => ref.status === "ready").length,
      conflictRefCount: refPlans.filter(ref => ref.status === "conflict").length,
      targetCount: remotePlans.filter(remote => remote.actions.length > 0).length,
    },
  }
}

function normalizeBranchName(value: string | undefined): string {
  return String(value || "")
    .trim()
    .replace(/^refs\/heads\//, "")
}

function collectDefaultBranchNames(
  snapshots: RemoteBackfillRemoteSnapshot[],
  preferredDefaultBranch?: string,
): Set<string> {
  const names = new Set<string>()
  const preferred = normalizeBranchName(preferredDefaultBranch)
  if (preferred) names.add(preferred)

  for (const snapshot of snapshots) {
    if (!snapshot.reachable) continue
    const headBranch = normalizeBranchName(snapshot.headBranch)
    if (headBranch) names.add(headBranch)
  }

  if (names.size === 0) {
    names.add("main")
    names.add("master")
  }

  return names
}

function isBackfillRefSelectedByDefault(
  ref: {type: RemoteBackfillRefType; name: string},
  defaultBranchNames: Set<string>,
): boolean {
  if (ref.type === "tags") return false
  return defaultBranchNames.has(normalizeBranchName(ref.name))
}

function formatBackfillRefForProgress(ref: {type: RemoteBackfillRefType; name: string}): string {
  return `${ref.type === "heads" ? "branch" : "tag"} ${ref.name}`
}

function describeBackfillRemote(remoteUrl: string): string {
  try {
    return new URL(remoteUrl).hostname
  } catch {
    return remoteUrl
  }
}

function summarizeProgressError(error: string | undefined): string {
  const trimmed = String(error || "Remote push failed")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed
}

function createStageRepoContext(
  parseRepoId: (id: string) => string,
  repoId: string,
): StageRepoContext {
  const key = parseRepoId(repoId)
  const [owner, name] = key.split("/", 2)
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const stageRepoId = `${owner}:${name || "repo"}--remote-backfill-${suffix}`
  const stageKey = parseRepoId(stageRepoId)

  return {
    repoId: stageRepoId,
    key: stageKey,
    dir: "",
  }
}

async function initStageRepo(
  git: GitProvider,
  params: {
    rootDir: string
    parseRepoId: (id: string) => string
    repoId: string
    seedRemoteUrl?: string
  },
): Promise<StageRepoContext> {
  const stage = createStageRepoContext(params.parseRepoId, params.repoId)
  const dir = `${params.rootDir}/${stage.key}`
  const fs = getProviderFs(git)

  if (fs) {
    const parentDir = dir.slice(0, dir.lastIndexOf("/")) || params.rootDir
    await ensureDir(fs, params.rootDir)
    if (parentDir && parentDir !== params.rootDir) {
      await ensureDir(fs, parentDir)
    }
    await safeRmrf(fs, dir)
  }

  await git.init({dir, defaultBranch: "main"})

  if (params.seedRemoteUrl) {
    await ensureOriginRemoteConfig(git, dir, params.seedRemoteUrl)
  }

  return {...stage, dir}
}

async function hasReadableObject(git: GitProvider, dir: string, oid: string): Promise<boolean> {
  if (!oid) return false

  try {
    await git.readObject({dir, oid})
    return true
  } catch {
    return false
  }
}

async function fetchBranchObject(params: {
  git: GitProvider
  dir: string
  remoteUrl: string
  ref: string
  oid: string
}): Promise<boolean> {
  const {git, dir, remoteUrl, ref, oid} = params
  const branchName = ref.replace(/^refs\/heads\//, "")
  const authCallback = getAuthCallback(remoteUrl)
  const corsProxy = resolveCorsProxyForUrl(remoteUrl, resolveDefaultCorsProxy())

  for (const remoteRef of [branchName, `refs/heads/${branchName}`]) {
    try {
      await git.fetch({
        dir,
        url: remoteUrl,
        ref: branchName,
        remoteRef,
        singleBranch: true,
        tags: false,
        depth: undefined,
        ...(authCallback ? {onAuth: authCallback} : {}),
        ...(corsProxy !== undefined ? {corsProxy} : {}),
      })

      if (await hasReadableObject(git, dir, oid)) {
        return true
      }
    } catch {
      // pass
    }
  }

  try {
    await git.fetch({
      dir,
      url: remoteUrl,
      ref: branchName,
      singleBranch: true,
      tags: false,
      depth: undefined,
      ...(authCallback ? {onAuth: authCallback} : {}),
      ...(corsProxy !== undefined ? {corsProxy} : {}),
    })
  } catch {
    // pass
  }

  return await hasReadableObject(git, dir, oid)
}

async function fetchTagObject(params: {
  git: GitProvider
  dir: string
  remoteUrl: string
  ref: string
  oid: string
}): Promise<boolean> {
  const {git, dir, remoteUrl, ref, oid} = params
  const tagName = ref.replace(/^refs\/tags\//, "")
  const authCallback = getAuthCallback(remoteUrl)
  const corsProxy = resolveCorsProxyForUrl(remoteUrl, resolveDefaultCorsProxy())

  try {
    await git.fetch({
      dir,
      url: remoteUrl,
      ref: tagName,
      remoteRef: `refs/tags/${tagName}`,
      singleBranch: true,
      tags: false,
      depth: undefined,
      ...(authCallback ? {onAuth: authCallback} : {}),
      ...(corsProxy !== undefined ? {corsProxy} : {}),
    })
  } catch {
    // pass
  }

  if (await hasReadableObject(git, dir, oid)) {
    return true
  }

  try {
    await git.fetch({
      dir,
      url: remoteUrl,
      tags: true,
      depth: undefined,
      ...(authCallback ? {onAuth: authCallback} : {}),
      ...(corsProxy !== undefined ? {corsProxy} : {}),
    })
  } catch {
    // pass
  }

  return await hasReadableObject(git, dir, oid)
}

async function ensureStageObjectForRef(params: {
  git: GitProvider
  dir: string
  remoteUrl: string
  ref: string
  type: RemoteBackfillRefType
  oid: string
}): Promise<boolean> {
  if (await hasReadableObject(params.git, params.dir, params.oid)) {
    return true
  }

  if (params.type === "tags") {
    return await fetchTagObject(params)
  }

  return await fetchBranchObject(params)
}

async function materializeStageRef(params: {
  git: GitProvider
  dir: string
  ref: string
  oid: string
}): Promise<void> {
  await params.git.writeRef({
    dir: params.dir,
    ref: params.ref,
    value: params.oid,
    force: true,
  })
}

async function cleanupStageRepo(git: GitProvider, stage: StageRepoContext): Promise<void> {
  const fs = getProviderFs(git)
  if (!fs) return
  await safeRmrf(fs, stage.dir)
}

export async function discoverRemoteBackfillUtil(
  git: GitProvider,
  opts: {repoId: string; cloneUrls: string[]; defaultBranch?: string},
  deps: RemoteBackfillDiscoveryDeps,
): Promise<RemoteBackfillDiscoveryResult> {
  const cloneUrls = filterValidCloneUrls(opts.cloneUrls)
  if (cloneUrls.length === 0) {
    return {
      success: true,
      remotes: [],
      refs: [],
      summary: {
        remoteCount: 0,
        reachableRemoteCount: 0,
        actionableRefCount: 0,
        readyRefCount: 0,
        conflictRefCount: 0,
        targetCount: 0,
      },
    }
  }

  const snapshots = await Promise.all(cloneUrls.map(url => loadRemoteSnapshot(git, url)))
  const refEntries = collectRefEntries(snapshots)
  const ambiguousBranchEntries = refEntries.filter(
    entry => entry.type === "heads" && entry.variants.size > 1,
  )

  let stage: StageRepoContext | null = null

  try {
    if (ambiguousBranchEntries.length > 0) {
      const seedRemoteUrl = snapshots.find(snapshot => snapshot.reachable)?.remoteUrl
      stage = await initStageRepo(git, {
        rootDir: deps.rootDir,
        parseRepoId: deps.parseRepoId,
        repoId: opts.repoId,
        seedRemoteUrl,
      })

      for (const entry of ambiguousBranchEntries) {
        for (const [oid, sourceUrls] of entry.variants.entries()) {
          let hydrated = false
          for (const sourceUrl of sourceUrls) {
            hydrated = await ensureStageObjectForRef({
              git,
              dir: stage.dir,
              remoteUrl: sourceUrl,
              ref: entry.ref,
              type: entry.type,
              oid,
            })
            if (hydrated) break
          }
        }
      }
    }

    const plan = await buildRemoteBackfillPlanFromSnapshots(snapshots, {
      defaultBranch: opts.defaultBranch,
      isDescendent: stage
        ? async (oid, ancestor) => await git.isDescendent({dir: stage!.dir, oid, ancestor})
        : undefined,
    })

    return {
      success: true,
      ...plan,
    }
  } finally {
    if (stage) {
      await cleanupStageRepo(git, stage)
    }
  }
}

export async function prepareRemoteBackfillUtil(
  git: GitProvider,
  opts: {repoId: string; targets: RemoteBackfillTargetSelection[]},
  deps: RemoteBackfillDiscoveryDeps,
): Promise<RemoteBackfillPrepareResult> {
  const selectedTargets = getSelectedTargets(opts.targets)
  if (selectedTargets.length === 0) {
    return {
      success: true,
      hydratedRefCount: 0,
      hydrationFailures: [],
    }
  }

  const uniqueRefs = collectUniqueSelectedRefs(selectedTargets)
  const seedRemoteUrl =
    Array.from(uniqueRefs.values())
      .flatMap(ref => ref.sourceUrls)
      .find(Boolean) || selectedTargets[0]?.remoteUrl

  let stage: StageRepoContext | null = null

  try {
    stage = await initStageRepo(git, {
      rootDir: deps.rootDir,
      parseRepoId: deps.parseRepoId,
      repoId: opts.repoId,
      seedRemoteUrl,
    })

    deps.onProgress?.("Backfill: preparing staged refs", 0, Math.max(1, uniqueRefs.size))
    const {hydrationFailures, hydratedRefs} = await hydrateStageRepoForRefs(
      git,
      stage,
      uniqueRefs,
      deps.onProgress,
    )

    return {
      success: true,
      stageRepoId: stage.repoId,
      hydratedRefCount: hydratedRefs.length,
      hydrationFailures: Array.from(hydrationFailures.entries()).map(([ref, error]) => ({
        ref,
        error,
      })),
    }
  } catch (error) {
    if (stage) {
      await cleanupStageRepo(git, stage)
    }
    throw error
  }
}

export async function executeRemoteBackfillUtil(
  git: GitProvider,
  opts: {repoId: string; targets: RemoteBackfillTargetSelection[]; userPubkey?: string},
  deps: RemoteBackfillExecuteDeps,
): Promise<RemoteBackfillExecuteResult> {
  const selectedTargets = getSelectedTargets(opts.targets)
  if (selectedTargets.length === 0) {
    return {
      success: true,
      results: [],
      summary: {
        targetCount: 0,
        successCount: 0,
        failureCount: 0,
        pushedRefCount: 0,
        failedRefCount: 0,
        skippedRefCount: 0,
      },
    }
  }

  const uniqueRefs = collectUniqueSelectedRefs(selectedTargets)

  const seedRemoteUrl =
    Array.from(uniqueRefs.values())
      .flatMap(ref => ref.sourceUrls)
      .find(Boolean) || selectedTargets[0]?.remoteUrl
  const stage = await initStageRepo(git, {
    rootDir: deps.rootDir,
    parseRepoId: deps.parseRepoId,
    repoId: opts.repoId,
    seedRemoteUrl,
  })

  const hydrationFailures = new Map<string, string>()

  try {
    deps.onProgress?.("Backfill: preparing staged refs", 0, Math.max(1, uniqueRefs.size))
    const preparedStage = await hydrateStageRepoForRefs(git, stage, uniqueRefs, deps.onProgress)
    for (const [ref, error] of preparedStage.hydrationFailures.entries()) {
      hydrationFailures.set(ref, error)
    }

    const results: RemoteBackfillExecuteResult["results"] = []

    for (const target of selectedTargets) {
      const targetLabel = describeBackfillRemote(target.remoteUrl)
      deps.onProgress?.(`Backfill: checking ${targetLabel} before push`)
      const snapshot = await loadRemoteSnapshot(git, target.remoteUrl)
      const failedRefs: Array<{ref: string; error: string}> = []
      const skippedRefs: Array<{ref: string; reason: string}> = []
      let refsToPush: string[] = []

      if (!snapshot.reachable) {
        results.push({
          remoteUrl: target.remoteUrl,
          success: false,
          pushedRefs: [],
          failedRefs: target.refs.map(ref => ({
            ref: ref.ref,
            error: snapshot.error || "Remote did not respond to preflight checks",
          })),
          skippedRefs: [],
          error: snapshot.error || "Remote did not respond to preflight checks",
        })
        continue
      }

      const currentByRef = new Map(snapshot.refs.map(ref => [ref.ref, ref.oid]))

      for (const ref of target.refs) {
        const hydrationFailure = hydrationFailures.get(ref.ref)
        if (hydrationFailure) {
          failedRefs.push({ref: ref.ref, error: hydrationFailure})
          continue
        }

        const currentOid = currentByRef.get(ref.ref)
        if (currentOid === ref.effectiveOid) {
          skippedRefs.push({ref: ref.ref, reason: "Remote already advertises the selected tip"})
          continue
        }

        if (ref.currentOid) {
          if (currentOid !== ref.currentOid) {
            failedRefs.push({
              ref: ref.ref,
              error: "Remote changed since analysis. Re-run backfill discovery before retrying.",
            })
            continue
          }
        } else if (currentOid) {
          failedRefs.push({
            ref: ref.ref,
            error:
              "Remote gained this ref since analysis. Re-run backfill discovery before retrying.",
          })
          continue
        }

        refsToPush.push(ref.ref)
      }

      refsToPush = Array.from(new Set(refsToPush))

      if (refsToPush.length === 0) {
        results.push({
          remoteUrl: target.remoteUrl,
          success: failedRefs.length === 0,
          pushedRefs: [],
          failedRefs,
          skippedRefs,
          error:
            failedRefs.length > 0
              ? failedRefs.map(ref => `${ref.ref}: ${ref.error}`).join("; ")
              : undefined,
        })
        continue
      }

      const isGraspRemote = isGraspRepoHttpUrl(target.remoteUrl)
      const pushedRefs: string[] = []
      const pushFailures: Array<{ref: string; error: string}> = []

      const collectPushResult = (
        pushResult: any,
        attemptedRefs: string[],
      ): {pushedRefs: string[]; failedRefs: Array<{ref: string; error: string}>; success: boolean} => {
        const resultPushedRefs =
          pushResult?.details?.pushedRefs && Array.isArray(pushResult.details.pushedRefs)
            ? pushResult.details.pushedRefs
            : pushResult?.success
              ? attemptedRefs
              : []

        pushedRefs.push(...resultPushedRefs)

        const resultFailedRefs: Array<{ref: string; error: string}> =
          pushResult?.details?.failedRefs && Array.isArray(pushResult.details.failedRefs)
            ? pushResult.details.failedRefs.map((entry: {ref: string; error: string}) => ({
                ref: entry.ref,
                error: entry.error,
              }))
            : pushResult?.success
              ? []
              : attemptedRefs.map(ref => ({
                  ref,
                  error: pushResult?.error || "Remote push failed",
                }))

        pushFailures.push(...resultFailedRefs)

        return {
          pushedRefs: resultPushedRefs,
          failedRefs: resultFailedRefs,
          success:
            Boolean(pushResult?.success) &&
            resultPushedRefs.length > 0 &&
            resultFailedRefs.length === 0,
        }
      }

      if (isGraspRemote) {
        deps.onProgress?.(`Backfill: pushing ${refsToPush.length} refs to ${targetLabel}`, 0, 1)
        const pushResult = await deps.pushToRemote({
          repoId: stage.repoId,
          remoteUrl: target.remoteUrl,
          refs: refsToPush,
          provider: "grasp",
          token: opts.userPubkey,
        })
        const collected = collectPushResult(pushResult, refsToPush)
        deps.onProgress?.(
          collected.failedRefs.length > 0
            ? `Backfill: finished ${targetLabel} with ${collected.failedRefs.length} failed ref${collected.failedRefs.length === 1 ? "" : "s"}`
            : `Backfill: finished pushing refs to ${targetLabel}`,
          1,
          1,
        )
      } else {
        for (let refIndex = 0; refIndex < refsToPush.length; refIndex++) {
          const refToPush = refsToPush[refIndex]
          const selectedRef = target.refs.find(ref => ref.ref === refToPush)
          const label = selectedRef
            ? formatBackfillRefForProgress(selectedRef)
            : refToPush.replace(/^refs\/(heads|tags)\//, "")
          deps.onProgress?.(
            `Backfill: pushing ${label} to ${targetLabel} (${refIndex + 1}/${refsToPush.length})`,
            refIndex,
            refsToPush.length,
          )
          try {
            const pushResult = await deps.pushToRemote({
              repoId: stage.repoId,
              remoteUrl: target.remoteUrl,
              refs: [refToPush],
            })
            const collected = collectPushResult(pushResult, [refToPush])
            if (collected.success && collected.pushedRefs.includes(refToPush)) {
              deps.onProgress?.(
                `Backfill: pushed ${label} to ${targetLabel} (${refIndex + 1}/${refsToPush.length})`,
                refIndex + 1,
                refsToPush.length,
              )
            } else {
              const failure = collected.failedRefs.find(item => item.ref === refToPush)
              deps.onProgress?.(
                `Backfill: failed ${label} on ${targetLabel}: ${summarizeProgressError(failure?.error)} (${refIndex + 1}/${refsToPush.length})`,
                refIndex + 1,
                refsToPush.length,
              )
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error || "Remote push failed")
            pushFailures.push({
              ref: refToPush,
              error: message,
            })
            deps.onProgress?.(
              `Backfill: failed ${label} on ${targetLabel}: ${summarizeProgressError(message)} (${refIndex + 1}/${refsToPush.length})`,
              refIndex + 1,
              refsToPush.length,
            )
          }
        }
      }

      results.push({
        remoteUrl: target.remoteUrl,
        success: pushedRefs.length > 0 && failedRefs.length === 0 && pushFailures.length === 0,
        pushedRefs: Array.from(new Set(pushedRefs)),
        failedRefs: [...failedRefs, ...pushFailures],
        skippedRefs,
        error:
          pushFailures.length > 0 && pushedRefs.length === 0
            ? pushFailures.map(ref => `${ref.ref}: ${ref.error}`).join("; ")
            : undefined,
      })
    }

    const successCount = results.filter(result => result.success).length
    const failureCount = results.length - successCount
    const pushedRefCount = results.reduce((sum, result) => sum + result.pushedRefs.length, 0)
    const failedRefCount = results.reduce((sum, result) => sum + result.failedRefs.length, 0)
    const skippedRefCount = results.reduce((sum, result) => sum + result.skippedRefs.length, 0)

    return {
      success: failureCount === 0 && failedRefCount === 0,
      results,
      summary: {
        targetCount: results.length,
        successCount,
        failureCount,
        pushedRefCount,
        failedRefCount,
        skippedRefCount,
      },
    }
  } finally {
    await cleanupStageRepo(git, stage)
  }
}
