<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {filterValidCloneUrls, getGitServiceApiFromUrl, parseRepoUrl, updateUrlPreferenceCache} from "@nostr-git/core"
  import {isGraspRelayUrl, isGraspRepoHttpUrl, parseGraspRepoHttpUrl} from "@nostr-git/core/utils"
  import {
    ACCESS_TOKEN_SETTINGS_PATH,
    classifyCloneUrlIssue,
    syncLocalRepoToTargets,
    type CloneUrlIssueKind,
    type Repo,
  } from "@nostr-git/ui"
  import {nip19} from "nostr-tools"
  import {onMount, tick} from "svelte"

  type RemoteHealth =
    | "healthy"
    | "degraded"
    | "auth"
    | "unreachable"
    | "unknown"
    | "branch-drift"

  type RemoteStatus = {
    url: string
    isPrimary: boolean
    health: RemoteHealth
    message: string
    details?: string
    probeDetails?: string
    headBranch?: string
    missingBranch?: string
    recordedIssueKind?: CloneUrlIssueKind
    updatedAt: number
  }

  type ModalStep = "status" | "backfill"

  type BackfillRefType = "heads" | "tags"

  type BackfillRemoteAction = {
    ref: string
    name: string
    type: BackfillRefType
    action: "create" | "fast-forward"
    currentOid?: string
    effectiveOid: string
    sourceUrls: string[]
  }

  type BackfillRemoteConflict = {
    ref: string
    name: string
    type: BackfillRefType
    currentOid?: string
    effectiveOid?: string
    reason: string
  }

  type BackfillRemotePlan = {
    remoteUrl: string
    reachable: boolean
    headBranch?: string
    error?: string
    selectedByDefault: boolean
    createCount: number
    fastForwardCount: number
    conflictCount: number
    actions: BackfillRemoteAction[]
    conflicts: BackfillRemoteConflict[]
  }

  type BackfillRemoteRefState = {
    remoteUrl: string
    currentOid?: string
    status: "up-to-date" | "create" | "fast-forward" | "conflict"
  }

  type BackfillRefPlan = {
    ref: string
    name: string
    type: BackfillRefType
    effectiveOid?: string
    sourceUrls: string[]
    status: "ready" | "conflict"
    reason?: string
    selectedByDefault: boolean
    createCount: number
    fastForwardCount: number
    conflictCount: number
    remoteStates: BackfillRemoteRefState[]
  }

  type BackfillDiscovery = {
    success: boolean
    remotes: BackfillRemotePlan[]
    refs: BackfillRefPlan[]
    summary: {
      remoteCount: number
      reachableRemoteCount: number
      actionableRefCount: number
      readyRefCount: number
      conflictRefCount: number
      targetCount: number
    }
  }

  type BackfillRemoteAuthState = {
    status:
      | "ready"
      | "checking"
      | "no-token"
      | "read-only"
      | "owner-only"
      | "sign-in"
      | "unverified"
      | "error"
    hardBlock: boolean
    warningOnly: boolean
    label?: string
    message?: string
  }

  type BackfillExecutionTarget = {
    remoteUrl: string
    refs: Array<{
      ref: string
      name: string
      type: BackfillRefType
      effectiveOid: string
      currentOid?: string
      sourceUrls: string[]
    }>
  }

  type BackfillExecutionResult = {
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

  interface Props {
    repoClass: Repo
    onClose?: () => void
    onOpenSettings?: () => void
    onRefresh?: () => Promise<void> | void
    onSyncBranchStateFromRemote?: (params: {remoteUrl: string; headBranch?: string}) => Promise<void> | void
    onPublishEvent?: (event: any) => Promise<unknown>
    onFetchRelayEvents?: (params: {
      relays: string[]
      filters: any[]
      timeoutMs?: number
    }) => Promise<any[]>
  }

  const {
    repoClass,
    onClose,
    onOpenSettings,
    onRefresh,
    onSyncBranchStateFromRemote,
    onPublishEvent,
    onFetchRelayEvents,
  }: Props = $props()

  let statuses = $state<RemoteStatus[]>([])
  let checking = $state(false)
  let syncing = $state(false)
  let syncingBranchStateUrl = $state<string | null>(null)
  let actionMessage = $state<string>("")
  let contentRoot: HTMLDivElement | null = null
  let step = $state<ModalStep>("status")
  let backfillChecking = $state(false)
  let backfilling = $state(false)
  let backfillDiscovery = $state<BackfillDiscovery | null>(null)
  let backfillRemoteAuthStates = $state<Record<string, BackfillRemoteAuthState>>({})
  let selectedBackfillRemotes = $state<Record<string, boolean>>({})
  let selectedBackfillRefs = $state<Record<string, boolean>>({})

  const cloneUrls = $derived.by(() =>
    Array.from(
      new Set(filterValidCloneUrls((repoClass.cloneUrls || []).map(url => String(url || "").trim()))),
    ),
  )
  const primaryUrl = $derived.by(() => String(cloneUrls[0] || ""))
  const expectedBranch = $derived.by(() => {
    const candidates = [repoClass.mainBranch, repoClass.selectedBranch]
      .map(branch => String(branch || "").trim())
      .filter(Boolean)

    return candidates[0] || ""
  })

  const normalizeUrl = (url: string) => {
    const raw = String(url || "").trim()
    if (!raw) return ""
    const stripGit = (value: string) => value.replace(/\.git$/i, "")
    try {
      const parsed = new URL(raw)
      return `${parsed.hostname.toLowerCase()}${stripGit(parsed.pathname.replace(/\/+$/, "").toLowerCase())}`
    } catch {
      return stripGit(raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase())
    }
  }

  const parseHostFromUrl = (url: string): string => {
    const raw = String(url || "").trim()
    if (!raw) return ""

    if (raw.startsWith("git@")) {
      const match = raw.match(/^git@([^:]+):/)
      return match?.[1] || ""
    }

    try {
      return new URL(raw).hostname
    } catch {
      return ""
    }
  }

  const summarizeBranches = (branches: string[]) => {
    if (branches.length === 0) return "none"
    const visible = branches.slice(0, 4)
    const suffix = branches.length > visible.length ? ` +${branches.length - visible.length} more` : ""
    return `${visible.join(", ")}${suffix}`
  }

  const parseRemoteHeads = (refs: Array<any>) => {
    const heads = new Map<string, string>()
    for (const ref of refs || []) {
      if (!ref?.ref || typeof ref.ref !== "string") continue
      if (!ref.ref.startsWith("refs/heads/")) continue
      if (!ref.oid || typeof ref.oid !== "string") continue
      heads.set(ref.ref, ref.oid)
    }

    const headRef = (refs || []).find(ref => ref?.ref === "HEAD")
    const symref = typeof headRef?.symref === "string" ? headRef.symref : headRef?.target
    let headBranch =
      typeof symref === "string" && symref.startsWith("refs/heads/")
        ? symref.replace("refs/heads/", "")
        : undefined

    const branchNames = Array.from(heads.keys())
      .map(ref => ref.replace(/^refs\/heads\//, ""))
      .sort((a, b) => a.localeCompare(b))

    if (!headBranch) {
      if (branchNames.includes("main")) headBranch = "main"
      else if (branchNames.includes("master")) headBranch = "master"
      else headBranch = branchNames[0]
    }

    return {heads, headBranch, branchNames}
  }

  const formatOid = (oid?: string) => (oid ? oid.slice(0, 8) : "unknown")

  const formatRefKind = (type: BackfillRefType) => (type === "heads" ? "branch" : "tag")

  const summarizeRemoteUrls = (urls: string[]) => {
    if (urls.length === 0) return "none"
    const visible = urls.slice(0, 2).map(url => parseHostFromUrl(url) || url)
    const suffix = urls.length > visible.length ? ` +${urls.length - visible.length} more` : ""
    return `${visible.join(", ")}${suffix}`
  }

  const summarizeBackfillActions = (actions: BackfillRemoteAction[]) => {
    if (actions.length === 0) return "none"
    const visible = actions.slice(0, 4).map(action => action.name)
    const suffix = actions.length > visible.length ? ` +${actions.length - visible.length} more` : ""
    return `${visible.join(", ")}${suffix}`
  }

  const normalizeTokenHost = (value: string) => {
    const raw = String(value || "").trim().toLowerCase()
    if (!raw) return ""

    if (raw.startsWith("git@")) {
      const match = raw.match(/^git@([^:]+):/)
      return match?.[1] || ""
    }

    try {
      return new URL(raw).hostname.toLowerCase()
    } catch {
      try {
        return new URL(`https://${raw.replace(/^https?:\/\//i, "")}`).hostname.toLowerCase()
      } catch {
        return raw.replace(/\/+$/, "")
      }
    }
  }

  const getMatchingRemoteTokens = (remoteUrl: string) => {
    const hostname = parseHostFromUrl(remoteUrl).toLowerCase().trim()
    if (!hostname) return []

    return (repoClass.tokens || []).filter(token => {
      const tokenHost = normalizeTokenHost(token.host)
      return Boolean(tokenHost && (tokenHost === hostname || hostname.endsWith(`.${tokenHost}`)))
    })
  }

  const hasMatchingWriteToken = (remoteUrl: string) => {
    return getMatchingRemoteTokens(remoteUrl).length > 0
  }

  const isGraspLikeRemote = (remoteUrl: string) => {
    return isGraspRepoHttpUrl(remoteUrl) || isGraspRelayUrl(remoteUrl)
  }

  const isKnownBackfillVendor = (
    provider: string,
  ): provider is "github" | "gitlab" | "gitea" | "bitbucket" =>
    provider === "github" || provider === "gitlab" || provider === "gitea" || provider === "bitbucket"

  const getKnownBackfillVendorLabel = (provider: "github" | "gitlab" | "gitea" | "bitbucket") => {
    if (provider === "github") return "GitHub"
    if (provider === "gitlab") return "GitLab"
    if (provider === "gitea") return "Gitea"
    return "Bitbucket"
  }

  const getBackfillKnownVendor = (remoteUrl: string) => {
    try {
      const parsed = parseRepoUrl(remoteUrl)
      return isKnownBackfillVendor(parsed.provider) ? parsed.provider : null
    } catch {
      return null
    }
  }

  const toViewerNpub = () => {
    const value = String(repoClass.viewerPubkey || "").trim()
    if (!value) return ""
    if (value.startsWith("npub1")) return value

    try {
      return nip19.npubEncode(value)
    } catch {
      return ""
    }
  }

  const parseGraspOwnerNpub = (remoteUrl: string) => {
    return parseGraspRepoHttpUrl(remoteUrl)?.ownerNpub || ""
  }

  const classifyBackfillRemoteCheckError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || "Unknown error")
    const lowered = message.toLowerCase()

    if (
      lowered.includes("401") ||
      lowered.includes("403") ||
      lowered.includes("404") ||
      lowered.includes("forbidden") ||
      lowered.includes("unauthorized") ||
      lowered.includes("not found") ||
      lowered.includes("bad credentials") ||
      lowered.includes("permission")
    ) {
      return {
        hardBlock: true,
        warningOnly: false,
        status: "read-only" as const,
        label: "read only",
        message,
      }
    }

    return {
      hardBlock: false,
      warningOnly: true,
      status: "unverified" as const,
      label: "unverified",
      message: `Could not verify push access before backfill (${message}). Push may still fail.`,
    }
  }

  const getBackfillRemoteDefaultAuthState = (remoteUrl: string): BackfillRemoteAuthState => {
    if (isGraspLikeRemote(remoteUrl)) {
      if (!repoClass.viewerPubkey) {
        return {
          status: "sign-in",
          hardBlock: true,
          warningOnly: false,
          label: "sign in",
          message: "Sign in with your pubkey before backfilling this GRASP remote.",
        }
      }

      return {
        status: "checking",
        hardBlock: false,
        warningOnly: false,
        label: "checking",
        message: "Checking whether this GRASP remote is owned by your pubkey.",
      }
    }

    const provider = getBackfillKnownVendor(remoteUrl)
    const hostname = parseHostFromUrl(remoteUrl).toLowerCase()
    if (provider && !hasMatchingWriteToken(remoteUrl)) {
      return {
        status: "no-token",
        hardBlock: true,
        warningOnly: false,
        label: "no token",
        message: `${getKnownBackfillVendorLabel(provider)} backfill is disabled until a matching access token is configured for this remote.`,
      }
    }

    if (provider) {
      return {
        status: "checking",
        hardBlock: false,
        warningOnly: false,
        label: "checking",
        message: "Checking push access for this remote...",
      }
    }

    return hasMatchingWriteToken(remoteUrl)
      ? {
          status: "unverified",
          hardBlock: false,
          warningOnly: true,
          label: "unverified",
          message: hostname
            ? `Push access could not be verified for ${hostname} before backfill. Push may still fail.`
            : "Push access could not be verified for this remote before backfill. Push may still fail.",
        }
      : {
          status: "no-token",
          hardBlock: false,
          warningOnly: true,
          label: "no token",
          message: hostname
            ? `No matching access token was found for ${hostname}. Backfill may fail if this remote requires authenticated pushes.`
            : "No matching access token was found for this remote. Backfill may fail if it requires authenticated pushes.",
        }
  }

  const getBackfillRemoteAuthState = (remoteUrl: string): BackfillRemoteAuthState =>
    backfillRemoteAuthStates[remoteUrl] || getBackfillRemoteDefaultAuthState(remoteUrl)

  const checkBackfillKnownVendorWriteAccess = async (remoteUrl: string): Promise<BackfillRemoteAuthState> => {
    const parsed = parseRepoUrl(remoteUrl)
    if (!isKnownBackfillVendor(parsed.provider)) {
      return getBackfillRemoteDefaultAuthState(remoteUrl)
    }

    const providerLabel = getKnownBackfillVendorLabel(parsed.provider)
    const matchingTokens = getMatchingRemoteTokens(remoteUrl)
    if (matchingTokens.length === 0) {
      return {
        status: "no-token",
        hardBlock: true,
        warningOnly: false,
        label: "no token",
        message: `${providerLabel} backfill is disabled until a matching access token is configured for this remote.`,
      }
    }

    const explicitFailures = new Set<string>()
    const unknownFailures = new Set<string>()

    for (const token of matchingTokens) {
      try {
        const api = getGitServiceApiFromUrl(remoteUrl, token.token)
        const [user, repo] = await Promise.all([
          api.getCurrentUser(),
          api.getRepo(parsed.owner, parsed.repo),
        ])
        const currentUser = String((user as any)?.login || (user as any)?.username || "").trim()
        const repoOwner = String(repo.owner?.login || parsed.owner || "").trim()

        if (parsed.provider === "gitlab") {
          const accessLevel = Number(repo.permissions?.accessLevel || 0)
          if (accessLevel >= 30) {
            return {status: "ready", hardBlock: false, warningOnly: false}
          }

          if (accessLevel > 0) {
            explicitFailures.add(
              `Your token can access ${repo.fullName || `${parsed.owner}/${parsed.repo}`}, but its GitLab role (${repo.permissions?.role || "unknown"}) does not allow pushing.`,
            )
            continue
          }
        } else {
          if (repo.permissions?.admin || repo.permissions?.push) {
            return {status: "ready", hardBlock: false, warningOnly: false}
          }

          if (repo.permissions && repo.permissions.push === false && !repo.permissions.admin) {
            const ownerHint =
              currentUser && repoOwner && currentUser.toLowerCase() !== repoOwner.toLowerCase()
                ? ` This clone URL points at ${repoOwner}, not ${currentUser}.`
                : ""
            explicitFailures.add(
              `Your token can read ${repo.fullName || `${parsed.owner}/${parsed.repo}`}, but it does not have push permission.${ownerHint}`,
            )
            continue
          }
        }

        if (currentUser && repoOwner && currentUser.toLowerCase() === repoOwner.toLowerCase()) {
          return {
            status: "unverified",
            hardBlock: false,
            warningOnly: true,
            label: "unverified",
            message: `Ownership matches ${repoOwner}, but ${providerLabel} did not expose explicit push permissions for this repo. Backfill will remain enabled.`,
          }
        }

        unknownFailures.add(
          `Could not confirm push permission for ${repo.fullName || `${parsed.owner}/${parsed.repo}`}. Backfill will remain enabled, but push may still fail.`,
        )
      } catch (error) {
        const classified = classifyBackfillRemoteCheckError(error)
        if (classified.hardBlock) {
          explicitFailures.add(classified.message || `${providerLabel} rejected the push access check.`)
        } else {
          unknownFailures.add(classified.message || `Could not verify push access for ${providerLabel}.`)
        }
      }
    }

    if (explicitFailures.size > 0 && unknownFailures.size === 0) {
      return {
        status: "read-only",
        hardBlock: true,
        warningOnly: false,
        label: "read only",
        message: Array.from(explicitFailures)[0],
      }
    }

    if (unknownFailures.size > 0) {
      return {
        status: "unverified",
        hardBlock: false,
        warningOnly: true,
        label: "unverified",
        message: Array.from(unknownFailures)[0],
      }
    }

    return {
      status: "read-only",
      hardBlock: true,
      warningOnly: false,
      label: "read only",
      message: `Could not verify writable access to ${parsed.owner}/${parsed.repo}.`,
    }
  }

  const checkBackfillRemoteAuthState = async (
    remote: BackfillRemotePlan,
  ): Promise<BackfillRemoteAuthState> => {
    if (!remote.actions.length) {
      return {status: "ready", hardBlock: false, warningOnly: false}
    }

    if (isGraspLikeRemote(remote.remoteUrl)) {
      if (!repoClass.viewerPubkey) {
        return {
          status: "sign-in",
          hardBlock: true,
          warningOnly: false,
          label: "sign in",
          message: "Sign in with your pubkey before backfilling this GRASP remote.",
        }
      }

      const viewerNpub = toViewerNpub()
      const ownerNpub = parseGraspOwnerNpub(remote.remoteUrl)

      if (!viewerNpub || !ownerNpub) {
        return {
          status: "owner-only",
          hardBlock: true,
          warningOnly: false,
          label: "owner only",
          message: "Could not verify the GRASP repo owner from this clone URL, so backfill stays disabled.",
        }
      }

      if (viewerNpub !== ownerNpub) {
        return {
          status: "owner-only",
          hardBlock: true,
          warningOnly: false,
          label: "owner only",
          message: `This GRASP remote belongs to ${ownerNpub}. Only that owner can publish state and push here.`,
        }
      }

      return {status: "ready", hardBlock: false, warningOnly: false}
    }

    try {
      return await checkBackfillKnownVendorWriteAccess(remote.remoteUrl)
    } catch {
      return getBackfillRemoteDefaultAuthState(remote.remoteUrl)
    }
  }

  const preflightBackfillRemoteAuthStates = async (discovery: BackfillDiscovery) => {
    const actionableRemotes = discovery.remotes.filter(remote => remote.actions.length > 0)
    if (actionableRemotes.length === 0) {
      return {}
    }

    const states = await Promise.all(
      actionableRemotes.map(async remote => [remote.remoteUrl, await checkBackfillRemoteAuthState(remote)] as const),
    )

    return Object.fromEntries(states)
  }

  const isBackfillRemoteSelectable = (remote: BackfillRemotePlan) => {
    if (!remote.reachable || remote.actions.length === 0) return false
    return !getBackfillRemoteAuthState(remote.remoteUrl).hardBlock
  }

  const isBackfillRemoteUrlSelectable = (remoteUrl: string) =>
    !getBackfillRemoteAuthState(remoteUrl).hardBlock

  const getRefActionRemoteUrls = (
    ref: BackfillRefPlan,
    action: Extract<BackfillRemoteRefState["status"], "create" | "fast-forward">,
    options: {
      selectedOnly?: boolean
      selectableOnly?: boolean
      blockedOnly?: boolean
    } = {},
  ) =>
    ref.remoteStates
      .filter(state => state.status === action)
      .filter(state => !options.selectedOnly || selectedBackfillRemotes[state.remoteUrl])
      .filter(state => !options.selectableOnly || isBackfillRemoteUrlSelectable(state.remoteUrl))
      .filter(state => !options.blockedOnly || !isBackfillRemoteUrlSelectable(state.remoteUrl))
      .map(state => state.remoteUrl)

  const getRefSelectableActionCounts = (ref: BackfillRefPlan) => {
    const createCount = getRefActionRemoteUrls(ref, "create", {selectableOnly: true}).length
    const fastForwardCount = getRefActionRemoteUrls(ref, "fast-forward", {selectableOnly: true}).length

    return {
      createCount,
      fastForwardCount,
      total: createCount + fastForwardCount,
    }
  }

  const getRefBlockedActionCounts = (ref: BackfillRefPlan) => {
    const createCount = getRefActionRemoteUrls(ref, "create", {blockedOnly: true}).length
    const fastForwardCount = getRefActionRemoteUrls(ref, "fast-forward", {blockedOnly: true}).length

    return {
      createCount,
      fastForwardCount,
      total: createCount + fastForwardCount,
    }
  }

  const hasRefSelectableTargets = (ref: BackfillRefPlan) => getRefSelectableActionCounts(ref).total > 0

  const describeBlockedRefTargets = (
    actionLabel: "create" | "fast-forward",
    remoteUrls: string[],
  ) => {
    const labels = Array.from(
      new Set(
        remoteUrls
          .map(url => getBackfillRemoteAuthState(url).label)
          .filter((label): label is string => Boolean(label)),
      ),
    )
    const reasonSuffix = labels.length === 1 ? ` (${labels[0]})` : ""

    return `${actionLabel} blocked on ${summarizeRemoteUrls(remoteUrls)}${reasonSuffix}`
  }

  const describeRefActionCounts = (ref: BackfillRefPlan) => {
    if (ref.status !== "ready") {
      return ref.reason || ""
    }

    const selectableCounts = getRefSelectableActionCounts(ref)
    const blockedCounts = getRefBlockedActionCounts(ref)

    if (selectableCounts.total === 0 && blockedCounts.total > 0) {
      return "No pushable remotes for this ref"
    }

    const summary = `${selectableCounts.createCount} create, ${selectableCounts.fastForwardCount} fast-forward`
    if (blockedCounts.total > 0) {
      return `${summary}; ${blockedCounts.total} blocked`
    }

    return summary
  }

  const describeRefActionTargets = (ref: BackfillRefPlan) => {
    const selectedCreateUrls = getRefActionRemoteUrls(ref, "create", {
      selectedOnly: true,
      selectableOnly: true,
    })
    const selectedFastForwardUrls = getRefActionRemoteUrls(ref, "fast-forward", {
      selectedOnly: true,
      selectableOnly: true,
    })
    const selectedTargetCount = selectedCreateUrls.length + selectedFastForwardUrls.length
    const useSelectedTargets = selectedBackfillRefs[ref.ref] && selectedTargetCount > 0
    const createUrls = useSelectedTargets
      ? selectedCreateUrls
      : getRefActionRemoteUrls(ref, "create", {selectableOnly: true})
    const fastForwardUrls = useSelectedTargets
      ? selectedFastForwardUrls
      : getRefActionRemoteUrls(ref, "fast-forward", {selectableOnly: true})
    const blockedCreateUrls = getRefActionRemoteUrls(ref, "create", {blockedOnly: true})
    const blockedFastForwardUrls = getRefActionRemoteUrls(ref, "fast-forward", {blockedOnly: true})

    const parts: string[] = []
    if (createUrls.length > 0) {
      parts.push(`create on ${summarizeRemoteUrls(createUrls)}`)
    }
    if (fastForwardUrls.length > 0) {
      parts.push(`fast-forward on ${summarizeRemoteUrls(fastForwardUrls)}`)
    }

    const blockedParts: string[] = []
    if (blockedCreateUrls.length > 0) {
      blockedParts.push(describeBlockedRefTargets("create", blockedCreateUrls))
    }
    if (blockedFastForwardUrls.length > 0) {
      blockedParts.push(describeBlockedRefTargets("fast-forward", blockedFastForwardUrls))
    }

    if (parts.length > 0) {
      const base = `${useSelectedTargets ? "Will" : "Can"} ${parts.join("; ")}`
      return blockedParts.length > 0 ? `${base}. ${blockedParts.join("; ")}` : base
    }

    return blockedParts.join("; ")
  }

  const createEmptyBackfillExecutionResult = (): BackfillExecutionResult => ({
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
  })

  const buildBackfillExecutionResult = (
    results: BackfillExecutionResult["results"],
  ): BackfillExecutionResult => {
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
  }

  const mergeBackfillExecutionResults = (
    batches: Array<BackfillExecutionResult | null | undefined>,
  ): BackfillExecutionResult =>
    buildBackfillExecutionResult(batches.flatMap(batch => batch?.results || []))

  const createFailedBackfillExecutionResult = (
    targets: BackfillExecutionTarget[],
    error: unknown,
  ): BackfillExecutionResult => {
    const message = error instanceof Error ? error.message : String(error || "Backfill failed")

    return buildBackfillExecutionResult(
      targets.map(target => ({
        remoteUrl: target.remoteUrl,
        success: false,
        pushedRefs: [],
        failedRefs: target.refs.map(ref => ({ref: ref.ref, error: message})),
        skippedRefs: [],
        error: message,
      })),
    )
  }

  const parseRepoNameFromRemoteUrl = (remoteUrl: string) => {
    const raw = String(remoteUrl || "").trim()
    if (!raw) return repoClass.name || "repo"

    try {
      const parsed = new URL(raw)
      const segments = parsed.pathname.split("/").filter(Boolean)
      const repoName = segments[segments.length - 1]?.replace(/\.git$/i, "")
      return repoName || repoClass.name || "repo"
    } catch {
      const segments = raw.split("/").filter(Boolean)
      return segments[segments.length - 1]?.replace(/\.git$/i, "") || repoClass.name || "repo"
    }
  }

  const deriveGraspRelayUrl = (remoteUrl: string) => {
    const raw = String(remoteUrl || "").trim()
    if (isGraspRelayUrl(raw)) {
      try {
        const parsed = new URL(raw)
        return `${parsed.protocol}//${parsed.host}`
      } catch {
        return raw.replace(/\/+$/, "")
      }
    }

    const parsed = new URL(raw)
    return `${parsed.protocol === "http:" ? "ws" : "wss"}://${parsed.host}`
  }

  const deriveGraspWebUrl = (remoteUrl: string) => String(remoteUrl || "").replace(/\.git$/i, "")

  async function runBackfillAbortable<T>(
    operation: () => Promise<T>,
    label: string,
    timeoutMs: number,
  ): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) {
      return await operation()
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      return (await Promise.race([
        operation(),
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
        }),
      ])) as T
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  const preflightBackfillTarget = async (
    target: BackfillExecutionTarget,
    hydrationFailures: Map<string, string>,
  ) => {
    const failedRefs: Array<{ref: string; error: string}> = []
    const skippedRefs: Array<{ref: string; reason: string}> = []
    const readyRefs: BackfillExecutionTarget["refs"] = []
    const refs = (await repoClass.workerManager.listServerRefs({
      url: target.remoteUrl,
      symrefs: true,
    })) as Array<any>
    const currentByRef = new Map(
      (Array.isArray(refs) ? refs : [])
        .filter(ref => ref?.ref && ref?.oid)
        .map(ref => [String(ref.ref), String(ref.oid)]),
    )

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
          error: "Remote gained this ref since analysis. Re-run backfill discovery before retrying.",
        })
        continue
      }

      readyRefs.push(ref)
    }

    return {
      readyRefs,
      failedRefs,
      skippedRefs,
    }
  }

  const executeGraspBackfill = async (
    targets: BackfillExecutionTarget[],
  ): Promise<BackfillExecutionResult> => {
    if (targets.length === 0) return createEmptyBackfillExecutionResult()
    if (!repoClass.key) throw new Error("Repository key is missing")
    if (!repoClass.viewerPubkey) throw new Error("Sign in with your pubkey before backfilling GRASP remotes")
    if (!onPublishEvent || !onFetchRelayEvents) {
      throw new Error("GRASP backfill is unavailable because repo event publishing is not configured")
    }

    await repoClass.workerManager.initialize()
    actionMessage = "Preparing staged refs for GRASP backfill..."

    const prepared = await repoClass.workerManager.prepareRemoteBackfill({
      repoId: repoClass.key,
      targets,
    })
    const stageRepoId = prepared?.stageRepoId
    if (!stageRepoId) {
      throw new Error("Could not prepare staged refs for GRASP backfill")
    }

    const hydrationFailures = new Map(
      ((prepared?.hydrationFailures || []) as Array<{ref: string; error: string}>).map(item => [
        item.ref,
        item.error,
      ]),
    )

    const results: BackfillExecutionResult["results"] = []

    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]
        actionMessage = `Checking ${parseHostFromUrl(target.remoteUrl) || target.remoteUrl} before GRASP backfill...`
        const preflight = await preflightBackfillTarget(target, hydrationFailures)

        if (preflight.readyRefs.length === 0) {
          const error =
            preflight.failedRefs.length > 0
              ? preflight.failedRefs.map(ref => `${ref.ref}: ${ref.error}`).join("; ")
              : undefined
          results.push({
            remoteUrl: target.remoteUrl,
            success: preflight.failedRefs.length === 0,
            pushedRefs: [],
            failedRefs: preflight.failedRefs,
            skippedRefs: preflight.skippedRefs,
            error,
          })
          continue
        }

        const remoteLabel = parseHostFromUrl(target.remoteUrl) || target.remoteUrl
        const remoteSyncResults = await syncLocalRepoToTargets({
          workerApi: repoClass.workerManager.apiInstance,
          localRepoId: stageRepoId,
          repoName: parseRepoNameFromRemoteUrl(target.remoteUrl),
          repoDescription: repoClass.description || "",
          defaultBranch: expectedBranch || repoClass.mainBranch || repoClass.selectedBranch || "main",
          refs: preflight.readyRefs.map(ref => ({
            type: ref.type,
            name: ref.name,
            ref: ref.ref,
            commit: ref.effectiveOid,
          })),
          targets: [
            {
              id: `grasp:${target.remoteUrl}`,
              label: remoteLabel,
              provider: "grasp",
              relayUrl: deriveGraspRelayUrl(target.remoteUrl),
              existingRemoteUrl: target.remoteUrl,
              existingWebUrl: deriveGraspWebUrl(target.remoteUrl),
            },
          ],
          userPubkey: repoClass.viewerPubkey,
          relays: repoClass.relays || [],
          maintainers: repoClass.maintainers || [repoClass.viewerPubkey],
          onPublishEvent,
          onFetchRelayEvents,
          updateProgress: message => {
            actionMessage = `Remote ${index + 1}/${targets.length}: ${message}`
          },
          runAbortable: runBackfillAbortable,
          requireNonGraspSuccessBeforeGrasp: false,
          allowApiBranchFastPath: false,
        })

        const remoteSyncResult = remoteSyncResults[0]
        const syncFailedRefs = remoteSyncResult?.failedRefs || []
        const pushedRefs = remoteSyncResult?.pushedRefs || []

        results.push({
          remoteUrl: target.remoteUrl,
          success:
            Boolean(remoteSyncResult?.success) &&
            preflight.failedRefs.length === 0 &&
            syncFailedRefs.length === 0,
          pushedRefs,
          failedRefs: [...preflight.failedRefs, ...syncFailedRefs],
          skippedRefs: preflight.skippedRefs,
          error:
            remoteSyncResult?.error ||
            (preflight.failedRefs.length > 0 && pushedRefs.length === 0
              ? preflight.failedRefs.map(ref => `${ref.ref}: ${ref.error}`).join("; ")
              : undefined),
        })
      }

      return buildBackfillExecutionResult(results)
    } finally {
      try {
        await repoClass.workerManager.deleteRepo({repoId: stageRepoId})
      } catch {
        // pass
      }
    }
  }

  const initializeBackfillSelections = (discovery: BackfillDiscovery) => {
    selectedBackfillRemotes = Object.fromEntries(
      discovery.remotes.map(remote => [remote.remoteUrl, remote.selectedByDefault && isBackfillRemoteSelectable(remote)]),
    )
    selectedBackfillRefs = Object.fromEntries(
      discovery.refs.map(ref => [ref.ref, ref.selectedByDefault && hasRefSelectableTargets(ref)]),
    )
  }

  const toggleBackfillRemote = (remoteUrl: string) => {
    const remote = (backfillDiscovery?.remotes || []).find(entry => entry.remoteUrl === remoteUrl)
    if (!remote || !isBackfillRemoteSelectable(remote)) return

    selectedBackfillRemotes = {
      ...selectedBackfillRemotes,
      [remoteUrl]: !selectedBackfillRemotes[remoteUrl],
    }
  }

  const toggleBackfillRef = (ref: string) => {
    selectedBackfillRefs = {
      ...selectedBackfillRefs,
      [ref]: !selectedBackfillRefs[ref],
    }
  }

  const scrollModalToTop = async () => {
    await tick()
    const scrollParent = contentRoot?.closest(".scroll-container") as HTMLElement | null

    if (scrollParent) {
      scrollParent.scrollTo({top: 0, behavior: "smooth"})
      return
    }

    contentRoot?.scrollIntoView({block: "start", behavior: "smooth"})
  }

  const classifyProbeError = (error: unknown): {health: RemoteHealth; message: string; details: string} => {
    const details = error instanceof Error ? error.message : String(error || "Unknown error")
    const lower = details.toLowerCase()

    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("permission denied") ||
      lower.includes("bad credentials") ||
      lower.includes("authentication required") ||
      lower.includes("no tokens found")
    ) {
      return {
        health: "auth",
        message: "Authentication required",
        details,
      }
    }

    if (lower.includes("404") || lower.includes("not found")) {
      return {
        health: "degraded",
        message: "Repository not available on this remote",
        details,
      }
    }

    if (
      lower.includes("timeout") ||
      lower.includes("failed to fetch") ||
      lower.includes("network") ||
      lower.includes("cors") ||
      lower.includes("enotfound") ||
      lower.includes("econn") ||
      lower.includes("certificate") ||
      lower.includes("tls") ||
      lower.includes("ssl") ||
      lower.includes("abort") ||
      lower.includes("429") ||
      lower.includes("rate limit")
    ) {
      return {
        health: "unreachable",
        message: "Remote unreachable",
        details,
      }
    }

    return {
      health: "unknown",
      message: "Remote check failed",
      details,
    }
  }

  const getRecordedError = (url: string) => {
    const normalized = normalizeUrl(url)
    return (repoClass.cloneUrlErrors || []).find(error => normalizeUrl(error.url) === normalized)
  }

  const checkRemote = async (url: string): Promise<RemoteStatus> => {
    const recordedError = getRecordedError(url)
    try {
      const listRefsPromise = repoClass.workerManager.listServerRefs({
        url,
        prefix: "refs/heads/",
        symrefs: true,
      })
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Remote probe timeout")), 15_000)
      })

      const refs = (await Promise.race([listRefsPromise, timeoutPromise])) as Array<any>
      const {heads, headBranch, branchNames} = parseRemoteHeads(Array.isArray(refs) ? refs : [])
      const branchCount = branchNames.length
      const expectedBranchRef = expectedBranch ? `refs/heads/${expectedBranch}` : ""
      const missingExpectedBranch =
        expectedBranchRef && !heads.has(expectedBranchRef) ? expectedBranch : undefined
      const recordedIssue = recordedError
        ? classifyCloneUrlIssue(recordedError.error, recordedError.status)
        : null

      const hasHeads = branchCount > 0
      const probeDetails = hasHeads
        ? `Git probe reachable (${branchCount} branch${branchCount === 1 ? "" : "es"}); remote HEAD: ${headBranch || "unknown"}; branches: ${summarizeBranches(branchNames)}`
        : "Git probe reached the remote, but no branch heads were returned"

      if (missingExpectedBranch) {
        return {
          url,
          isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
          health: "branch-drift",
          message: `Remote is reachable, but expected branch '${missingExpectedBranch}' is missing here`,
          details: recordedError?.error,
          probeDetails,
          headBranch,
          missingBranch: missingExpectedBranch,
          updatedAt: Date.now(),
        }
      }

      if (recordedError) {
        return {
          url,
          isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
          health: hasHeads ? "healthy" : "degraded",
          message: hasHeads
            ? `Git probe reachable; a recent app read issue was recorded for this remote`
            : "Remote responded without branch heads, and a recent app read issue was recorded",
          details: recordedError.error,
          probeDetails,
          headBranch,
          recordedIssueKind: recordedIssue?.kind,
          updatedAt: Date.now(),
        }
      }

      return {
        url,
        isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
        health: hasHeads ? "healthy" : "degraded",
        message: hasHeads
          ? `Remote reachable (${branchCount} branch${branchCount === 1 ? "" : "es"})`
          : "Remote reachable but no branch heads were returned",
        probeDetails,
        headBranch,
        updatedAt: Date.now(),
      }
    } catch (error) {
      const classified = classifyProbeError(error)
      return {
        url,
        isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
        health: classified.health,
        message: classified.message,
        details: classified.details,
        recordedIssueKind: recordedError
          ? classifyCloneUrlIssue(recordedError.error, recordedError.status).kind
          : undefined,
        updatedAt: Date.now(),
      }
    }
  }

  const probeRemotes = async () => {
    if (checking || cloneUrls.length === 0) return
    checking = true
    actionMessage = ""
    try {
      const next = await Promise.all(cloneUrls.map(checkRemote))
      statuses = next

      if (next.some(status => status.health === "branch-drift")) {
        actionMessage =
          "Some remotes are reachable but missing the repo's expected branch. Sync published branches from a healthy remote to reconcile deletions or default-branch changes."
      } else if (next.some(status => status.recordedIssueKind)) {
        actionMessage =
          "Some remotes passed git probing, but recent app-level reads hit transient or auth-related issues. Review the details, add credentials if needed, or clear the warning once it looks stale."
      } else if (next.some(status => status.health !== "healthy" && status.probeDetails)) {
        actionMessage =
          "Some remotes responded to git probes, but branch data still looks incomplete. Review the details before changing any remote preferences."
      }
    } finally {
      checking = false
    }
  }

  const close = () => {
    onClose?.()
    history.back()
  }

  const useForReads = (url: string) => {
    const failedUrls = statuses.filter(status => status.health !== "healthy").map(status => status.url)
    updateUrlPreferenceCache(repoClass.key, url, failedUrls)
    actionMessage = `Using ${url} as preferred read remote for this session`
    pushToast({message: "Preferred read remote updated"})
  }

  const runSyncRetry = async () => {
    if (syncing || cloneUrls.length === 0) return
    syncing = true
    actionMessage = ""
    try {
      const result = await repoClass.workerManager.smartInitializeRepo({
        repoId: repoClass.key,
        cloneUrls,
        forceUpdate: true,
      })

      if (!result?.success) {
        throw new Error(result?.error || "Sync retry failed")
      }

      await repoClass.reset()
      if (onRefresh) {
        await onRefresh()
      }
      pushToast({message: "Repository sync retried successfully"})
      await probeRemotes()
      actionMessage = "Repository sync retried successfully"
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      actionMessage = `Sync retry failed: ${message}`
      pushToast({message: `Sync retry failed: ${message}`, theme: "error"})
    } finally {
      syncing = false
    }
  }

  const syncBranchStateFromRemote = async (status: RemoteStatus) => {
    if (!onSyncBranchStateFromRemote || syncingBranchStateUrl) return
    syncingBranchStateUrl = status.url
    actionMessage = ""

    try {
      await onSyncBranchStateFromRemote({remoteUrl: status.url, headBranch: status.headBranch})
      repoClass.clearCloneUrlErrors()
      await probeRemotes()
      actionMessage = `Published branch state from ${status.url}. Remotes may take a moment to reconcile deleted branches.`
      pushToast({message: "Published repo branch state from remote", theme: "success"})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      actionMessage = `Failed to sync branch state: ${message}`
      pushToast({message: `Failed to sync branch state: ${message}`, theme: "error"})
    } finally {
      syncingBranchStateUrl = null
    }
  }

  const describeBackfillDiscovery = (discovery: BackfillDiscovery) => {
    if (discovery.summary.targetCount === 0 && discovery.summary.conflictRefCount === 0) {
      return "All reachable remotes already advertise the same branch and tag tips."
    }

    if (discovery.summary.conflictRefCount > 0) {
      return `Found ${discovery.summary.targetCount} target remote${discovery.summary.targetCount === 1 ? "" : "s"} with safe backfill actions, plus ${discovery.summary.conflictRefCount} conflicting ref${discovery.summary.conflictRefCount === 1 ? "" : "s"} that stay manual.`
    }

    return `Found ${discovery.summary.actionableRefCount} ref${discovery.summary.actionableRefCount === 1 ? "" : "s"} to backfill across ${discovery.summary.targetCount} remote${discovery.summary.targetCount === 1 ? "" : "s"}.`
  }

  const runBackfillDiscovery = async () => {
    if (backfillChecking || cloneUrls.length === 0 || !repoClass.key) return
    backfillChecking = true
    actionMessage = ""
    backfillRemoteAuthStates = {}

    try {
      const result = (await repoClass.workerManager.discoverRemoteBackfill({
        repoId: repoClass.key,
        cloneUrls,
      })) as BackfillDiscovery

      actionMessage = "Checking which remotes you can actually backfill..."
      backfillRemoteAuthStates = await preflightBackfillRemoteAuthStates(result)

      backfillDiscovery = result
      initializeBackfillSelections(result)
      step = "backfill"
      actionMessage = describeBackfillDiscovery(result)
      await scrollModalToTop()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      actionMessage = `Backfill analysis failed: ${message}`
      pushToast({message: `Backfill analysis failed: ${message}`, theme: "error"})
    } finally {
      backfillChecking = false
    }
  }

  const canBackfill = $derived.by(() => Boolean(repoClass.editable))

  const backfillBranchRefs = $derived.by(() =>
    (backfillDiscovery?.refs || []).filter(ref => ref.type === "heads"),
  )

  const backfillTagRefs = $derived.by(() =>
    (backfillDiscovery?.refs || []).filter(ref => ref.type === "tags"),
  )

  const backfillNoTokenBlockedRemotes = $derived.by(() =>
    (backfillDiscovery?.remotes || []).filter(remote => {
      if (!remote.actions.length) return false
      return getBackfillRemoteAuthState(remote.remoteUrl).status === "no-token"
    }),
  )

  const backfillSignInBlockedRemotes = $derived.by(() =>
    (backfillDiscovery?.remotes || []).filter(remote => {
      if (!remote.actions.length) return false
      return getBackfillRemoteAuthState(remote.remoteUrl).status === "sign-in"
    }),
  )

  const backfillPermissionBlockedRemotes = $derived.by(() =>
    (backfillDiscovery?.remotes || []).filter(remote => {
      if (!remote.actions.length) return false
      const authState = getBackfillRemoteAuthState(remote.remoteUrl)
      return authState.status === "read-only" || authState.status === "owner-only"
    }),
  )

  const backfillAuthWarningRemotes = $derived.by(() =>
    (backfillDiscovery?.remotes || []).filter(remote => {
      if (!remote.actions.length) return false
      const authState = getBackfillRemoteAuthState(remote.remoteUrl)
      return authState.status === "unverified"
    }),
  )

  const selectedBackfillTargets = $derived.by(() =>
    (backfillDiscovery?.remotes || [])
      .filter(remote => selectedBackfillRemotes[remote.remoteUrl] && isBackfillRemoteSelectable(remote))
      .map(remote => ({
        remoteUrl: remote.remoteUrl,
        refs: remote.actions
          .filter(action => selectedBackfillRefs[action.ref])
          .map(action => ({
            ref: action.ref,
            name: action.name,
            type: action.type,
            effectiveOid: action.effectiveOid,
            currentOid: action.currentOid,
            sourceUrls: action.sourceUrls,
          })),
      }))
      .filter(target => target.refs.length > 0),
  )

  const selectedGraspBackfillTargets = $derived.by(() =>
    selectedBackfillTargets.filter(target => isGraspLikeRemote(target.remoteUrl)),
  )

  const selectedStandardBackfillTargets = $derived.by(() =>
    selectedBackfillTargets.filter(target => !isGraspLikeRemote(target.remoteUrl)),
  )

  const selectedBackfillRemoteCount = $derived.by(() => selectedBackfillTargets.length)

  const selectedBackfillRefCount = $derived.by(
    () => (backfillDiscovery?.refs || []).filter(ref => selectedBackfillRefs[ref.ref]).length,
  )

  const selectedBackfillActionCount = $derived.by(() =>
    selectedBackfillTargets.reduce((sum, target) => sum + target.refs.length, 0),
  )

  const applyBackfill = async () => {
    const selectedTargetsSnapshot = selectedBackfillTargets.map(target => ({
      remoteUrl: target.remoteUrl,
      refs: target.refs.map(ref => ({...ref, sourceUrls: [...ref.sourceUrls]})),
    }))
    const selectedStandardTargetsSnapshot = selectedTargetsSnapshot.filter(
      target => !isGraspLikeRemote(target.remoteUrl),
    )
    const selectedGraspTargetsSnapshot = selectedTargetsSnapshot.filter(target =>
      isGraspLikeRemote(target.remoteUrl),
    )

    if (backfilling || !repoClass.key || selectedTargetsSnapshot.length === 0) return
    backfilling = true
    actionMessage = ""

    try {
      const resultBatches: BackfillExecutionResult[] = []

      if (selectedStandardTargetsSnapshot.length > 0) {
        actionMessage = "Backfilling standard remotes..."
        try {
          const standardResult = (await repoClass.workerManager.executeRemoteBackfill({
            repoId: repoClass.key,
            targets: selectedStandardTargetsSnapshot,
            userPubkey: repoClass.viewerPubkey || undefined,
          })) as BackfillExecutionResult
          resultBatches.push(standardResult)
        } catch (error) {
          resultBatches.push(createFailedBackfillExecutionResult(selectedStandardTargetsSnapshot, error))
        }
      }

      if (selectedGraspTargetsSnapshot.length > 0) {
        try {
          const graspResult = await executeGraspBackfill(selectedGraspTargetsSnapshot)
          resultBatches.push(graspResult)
        } catch (error) {
          resultBatches.push(createFailedBackfillExecutionResult(selectedGraspTargetsSnapshot, error))
        }
      }

      const result = mergeBackfillExecutionResults(resultBatches)

      if (result.results.length === 0 && selectedTargetsSnapshot.length > 0) {
        throw new Error("Backfill did not execute any selected remote targets")
      }

      const summary = result?.summary || {
        successCount: 0,
        failureCount: 0,
        pushedRefCount: 0,
        failedRefCount: 0,
        skippedRefCount: 0,
      }

      if (summary.failureCount === 0 && summary.failedRefCount === 0 && summary.pushedRefCount > 0) {
        actionMessage = `Backfill complete. Pushed ${summary.pushedRefCount} ref${summary.pushedRefCount === 1 ? "" : "s"} to ${summary.successCount} remote${summary.successCount === 1 ? "" : "s"}.`
        pushToast({message: "Remote backfill completed", theme: "success"})
        repoClass.clearCloneUrlErrors()
      } else if (summary.failureCount === 0 && summary.failedRefCount === 0) {
        actionMessage = `Backfill finished without pushing any refs. ${summary.skippedRefCount} ref${summary.skippedRefCount === 1 ? " was" : "s were"} already up to date when execution started.`
        pushToast({message: "Remote backfill found nothing to push", theme: "warning"})
      } else if (summary.pushedRefCount > 0) {
        actionMessage = `Backfill finished with warnings. Pushed ${summary.pushedRefCount} ref${summary.pushedRefCount === 1 ? "" : "s"}, failed ${summary.failedRefCount} and skipped ${summary.skippedRefCount}.`
        pushToast({message: "Remote backfill partially completed", theme: "warning"})
      } else {
        actionMessage = "Backfill did not push any refs. Re-run analysis and review the remote results."
        pushToast({message: "Remote backfill failed", theme: "error"})
      }

      await probeRemotes()
      await onRefresh?.()
      await scrollModalToTop()

      try {
        const refreshed = (await repoClass.workerManager.discoverRemoteBackfill({
          repoId: repoClass.key,
          cloneUrls,
        })) as BackfillDiscovery
        backfillRemoteAuthStates = await preflightBackfillRemoteAuthStates(refreshed)
        backfillDiscovery = refreshed
        initializeBackfillSelections(refreshed)
      } catch {
        // pass
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      actionMessage = `Backfill failed: ${message}`
      pushToast({message: `Backfill failed: ${message}`, theme: "error"})
    } finally {
      backfilling = false
    }
  }

  const backfillStepHint = $derived.by(() => {
    if (!backfillDiscovery) return ""
    return `${selectedBackfillActionCount} selected action${selectedBackfillActionCount === 1 ? "" : "s"} across ${selectedBackfillRemoteCount} remote${selectedBackfillRemoteCount === 1 ? "" : "s"}.`
  })

  const openSettings = () => {
    onOpenSettings?.()
  }

  const clearWarningState = async () => {
    repoClass.clearCloneUrlErrors()
    await probeRemotes()
    actionMessage = "Clone URL warnings cleared"
  }

  const openAuthSetup = (url: string) => {
    const host = parseHostFromUrl(url)
    pushModal(GitAuthAdd, {
      initialHost: host || undefined,
    }, {replaceState: true})
  }

  onMount(() => {
    void probeRemotes()
  })

  const primaryStatus = $derived.by(
    () => statuses.find(status => normalizeUrl(status.url) === normalizeUrl(primaryUrl)) || null,
  )

  const statusTone = (health: RemoteHealth) => {
    if (health === "healthy") return "text-emerald-700 dark:text-emerald-300"
    if (health === "branch-drift") return "text-amber-700 dark:text-amber-300"
    if (health === "degraded") return "text-amber-700 dark:text-amber-300"
    if (health === "auth") return "text-orange-700 dark:text-orange-300"
    if (health === "unreachable") return "text-rose-700 dark:text-rose-300"
    return "text-muted-foreground"
  }

  const healthLabel = (health: RemoteHealth) => {
    if (health === "auth") return "auth"
    if (health === "branch-drift") return "branch drift"
    return health
  }
</script>

<div bind:this={contentRoot} class="contents">
  <ModalHeader>
    {#snippet title()}
      {step === "status" ? "Review Remote Status" : "Remote Backfill"}
    {/snippet}
    {#snippet info()}
      {#if step === "status"}
        Probe remotes, review recent read observations, and launch a manual backfill analysis when the remotes drift.
      {:else}
        Review safe branch and tag backfill actions, select the remotes you want to repair, and leave conflicting refs untouched.
      {/if}
    {/snippet}
  </ModalHeader>

  {#if cloneUrls.length === 0}
    <p class="text-sm text-muted-foreground">This repository has no clone URLs configured.</p>
  {:else}
    {#if step === "status"}
      <div class="min-w-0 flex flex-col gap-3">
      <div class="min-w-0 rounded-md border border-border bg-muted/20 p-3 text-xs">
        <div class="font-semibold">Primary remote</div>
        <div class="mt-1 break-all font-mono">{primaryUrl || "Not set"}</div>
        {#if primaryStatus}
          <div class="mt-2 {statusTone(primaryStatus.health)}">
            {primaryStatus.message}
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-2">
        {#each statuses as status (status.url)}
          <div class="min-w-0 rounded-md border border-border bg-card p-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  {#if status.isPrimary}
                    <span class="rounded border border-border px-1.5 py-0.5">Primary</span>
                  {:else}
                    <span class="rounded border border-border px-1.5 py-0.5">Secondary</span>
                  {/if}
                  <span class="uppercase tracking-wide {statusTone(status.health)}">
                    {healthLabel(status.health)}
                  </span>
                  {#if status.recordedIssueKind}
                    <span class="uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      recent issue
                    </span>
                  {/if}
                </div>
                <div class="mt-1 break-all font-mono text-xs">{status.url}</div>
                <div class="mt-2 text-sm">{status.message}</div>
                {#if status.details}
                  <div class="mt-1 text-xs text-muted-foreground break-all">{status.details}</div>
                {/if}
                {#if status.probeDetails}
                  <div class="mt-1 text-xs text-muted-foreground">{status.probeDetails}</div>
                {/if}
              </div>
              {#if status.health === "branch-drift" && onSyncBranchStateFromRemote}
              <Button
                class="btn btn-ghost btn-xs self-start sm:self-auto"
                onclick={() => syncBranchStateFromRemote(status)}
                disabled={Boolean(syncingBranchStateUrl)}>
                {syncingBranchStateUrl === status.url ? "Syncing..." : "Sync Branch State"}
              </Button>
            {:else if !status.isPrimary && status.health === "healthy"}
              <Button class="btn btn-ghost btn-xs self-start sm:self-auto" onclick={() => useForReads(status.url)}>
                Use For Reads
              </Button>
            {:else if status.health === "auth" || status.recordedIssueKind === "auth"}
              <Button class="btn btn-ghost btn-xs self-start sm:self-auto" onclick={() => openAuthSetup(status.url)}>
                Add credentials
              </Button>
            {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if actionMessage}
        <div class="rounded-md border border-border bg-muted/30 p-3 text-xs">
          {actionMessage}
        </div>
      {/if}
    </div>
  {:else}
    <div class="min-w-0 flex flex-col gap-3">
      {#if backfillDiscovery}
        <div class="rounded-md border border-border bg-muted/20 p-3 text-xs">
          <div class="font-semibold">Backfill summary</div>
          <div class="mt-1 text-muted-foreground">
            Scanned {backfillDiscovery.summary.reachableRemoteCount}/{backfillDiscovery.summary.remoteCount}
            reachable remotes. {backfillDiscovery.summary.actionableRefCount} ref{backfillDiscovery.summary.actionableRefCount === 1 ? "" : "s"}
            need attention.
          </div>
          {#if backfillStepHint}
            <div class="mt-1 text-muted-foreground">{backfillStepHint}</div>
          {/if}
          {#if !canBackfill}
            <div class="mt-2 text-amber-700 dark:text-amber-300">
              You can inspect the plan, but only repository maintainers can push the selected backfill actions.
            </div>
          {/if}
          {#if backfillNoTokenBlockedRemotes.length > 0}
            <div class="mt-2 text-amber-700 dark:text-amber-300">
              Add credentials before backfilling {summarizeRemoteUrls(backfillNoTokenBlockedRemotes.map(remote => remote.remoteUrl))}.
            </div>
          {/if}
          {#if backfillSignInBlockedRemotes.length > 0}
            <div class="mt-2 text-amber-700 dark:text-amber-300">
              Sign in with your pubkey before backfilling {summarizeRemoteUrls(backfillSignInBlockedRemotes.map(remote => remote.remoteUrl))}.
            </div>
          {/if}
          {#if backfillPermissionBlockedRemotes.length > 0}
            <div class="mt-2 text-amber-700 dark:text-amber-300">
              Some configured clone URLs are readable but not pushable for this account: {summarizeRemoteUrls(backfillPermissionBlockedRemotes.map(remote => remote.remoteUrl))}.
            </div>
          {/if}
          {#if backfillAuthWarningRemotes.length > 0}
            <div class="mt-1 text-xs text-muted-foreground">
              Push access could not be verified for {summarizeRemoteUrls(backfillAuthWarningRemotes.map(remote => remote.remoteUrl))}. Those remotes stay selectable, but pushes may still fail.
            </div>
          {/if}
        </div>

        {#if backfillDiscovery.summary.actionableRefCount === 0 && backfillDiscovery.summary.conflictRefCount === 0}
          <div class="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            No safe backfill actions are needed right now.
          </div>
        {/if}

        {#if backfillChecking}
          <div class="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            Refreshing backfill analysis...
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          {#each backfillDiscovery.remotes as remote (remote.remoteUrl)}
            {@const authState = getBackfillRemoteAuthState(remote.remoteUrl)}
            {@const remoteSelectable = isBackfillRemoteSelectable(remote)}
            <div class="min-w-0 rounded-md border border-border bg-card p-3">
              <label class="flex min-w-0 items-start gap-3">
                <input
                  class="checkbox checkbox-sm mt-1"
                  type="checkbox"
                  checked={selectedBackfillRemotes[remote.remoteUrl]}
                  disabled={!remoteSelectable || backfilling}
                  onchange={() => toggleBackfillRemote(remote.remoteUrl)} />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="rounded border border-border px-1.5 py-0.5">
                      {normalizeUrl(remote.remoteUrl) === normalizeUrl(primaryUrl) ? "Primary" : "Secondary"}
                    </span>
                    <span class={remote.reachable ? "uppercase tracking-wide text-emerald-700 dark:text-emerald-300" : "uppercase tracking-wide text-rose-700 dark:text-rose-300"}>
                      {remote.reachable ? "reachable" : "unreachable"}
                    </span>
                    {#if remote.createCount > 0}
                      <span class="uppercase tracking-wide text-sky-700 dark:text-sky-300">
                        {remote.createCount} create
                      </span>
                    {/if}
                    {#if remote.fastForwardCount > 0}
                      <span class="uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        {remote.fastForwardCount} fast-forward
                      </span>
                    {/if}
                    {#if remote.conflictCount > 0}
                      <span class="uppercase tracking-wide text-rose-700 dark:text-rose-300">
                        {remote.conflictCount} conflict
                      </span>
                    {/if}
                    {#if remote.actions.length > 0 && authState.label && authState.status !== "ready"}
                      <span class="uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        {authState.label}
                      </span>
                    {/if}
                  </div>
                  <div class="mt-1 break-all font-mono text-xs">{remote.remoteUrl}</div>
                  {#if remote.headBranch}
                    <div class="mt-1 text-xs text-muted-foreground">HEAD: {remote.headBranch}</div>
                  {/if}
                  {#if remote.error}
                    <div class="mt-1 text-xs text-muted-foreground break-all">{remote.error}</div>
                  {/if}
                  {#if remote.actions.length > 0}
                    <div class="mt-2 text-sm">
                      Needs {summarizeBackfillActions(remote.actions)}
                    </div>
                  {:else if remote.reachable}
                    <div class="mt-2 text-sm text-muted-foreground">No safe backfill actions for this remote.</div>
                  {/if}
                  {#if remote.conflicts.length > 0}
                    <div class="mt-1 text-xs text-muted-foreground">
                      Conflicts: {summarizeBranches(remote.conflicts.map(conflict => conflict.name))}
                    </div>
                  {/if}
                  {#if remote.actions.length > 0 && authState.message}
                    <div class="mt-2 text-xs {authState.hardBlock ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}">
                      {authState.message}
                    </div>
                  {/if}
                </div>
              </label>
              {#if remote.actions.length > 0 && !isGraspLikeRemote(remote.remoteUrl) && (authState.status === "no-token" || authState.status === "read-only")}
                <div class="mt-2 flex flex-wrap gap-2">
                  <Button class="btn btn-ghost btn-xs" onclick={() => openAuthSetup(remote.remoteUrl)}>
                    Add credentials
                  </Button>
                  <a
                    href={ACCESS_TOKEN_SETTINGS_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn btn-ghost btn-xs text-blue-600 hover:text-blue-500"
                  >
                    Token settings
                  </a>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="flex flex-col gap-3 rounded-md border border-border bg-muted/10 p-3">
          <div>
            <div class="font-semibold">Refs to backfill</div>
            <div class="mt-1 text-xs text-muted-foreground">
              Only safe refs with at least one pushable target stay selectable. Conflicts and blocked refs remain visible but disabled.
            </div>
          </div>

          {#if backfillBranchRefs.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</div>
              {#each backfillBranchRefs as ref (ref.ref)}
                {@const refSelectable = hasRefSelectableTargets(ref)}
                <label class="flex min-w-0 items-start gap-3 rounded-md border border-border bg-card p-3">
                  <input
                    class="checkbox checkbox-sm mt-1"
                    type="checkbox"
                    checked={selectedBackfillRefs[ref.ref]}
                    disabled={ref.status !== "ready" || !refSelectable || backfilling}
                    onchange={() => toggleBackfillRef(ref.ref)} />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <span class="rounded border border-border px-1.5 py-0.5">{formatRefKind(ref.type)}</span>
                      {#if ref.status === "ready" && refSelectable}
                        <span class="uppercase tracking-wide text-emerald-700 dark:text-emerald-300">safe</span>
                      {:else if ref.status === "ready"}
                        <span class="uppercase tracking-wide text-amber-700 dark:text-amber-300">blocked</span>
                      {:else}
                        <span class="uppercase tracking-wide text-rose-700 dark:text-rose-300">conflict</span>
                      {/if}
                    </div>
                    <div class="mt-1 break-all font-mono text-xs">{ref.ref}</div>
                    <div class="mt-2 text-sm">
                      {#if ref.status === "ready"}
                        {describeRefActionCounts(ref)}
                      {:else}
                        {ref.reason}
                      {/if}
                    </div>
                    {#if ref.status === "ready"}
                      <div class="mt-1 text-xs text-muted-foreground">
                        {describeRefActionTargets(ref)}
                      </div>
                    {/if}
                    {#if ref.effectiveOid}
                      <div class="mt-1 text-xs text-muted-foreground">
                        Effective tip {formatOid(ref.effectiveOid)} from {summarizeRemoteUrls(ref.sourceUrls)}
                      </div>
                    {/if}
                  </div>
                </label>
              {/each}
            </div>
          {/if}

          {#if backfillTagRefs.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</div>
              {#each backfillTagRefs as ref (ref.ref)}
                {@const refSelectable = hasRefSelectableTargets(ref)}
                <label class="flex min-w-0 items-start gap-3 rounded-md border border-border bg-card p-3">
                  <input
                    class="checkbox checkbox-sm mt-1"
                    type="checkbox"
                    checked={selectedBackfillRefs[ref.ref]}
                    disabled={ref.status !== "ready" || !refSelectable || backfilling}
                    onchange={() => toggleBackfillRef(ref.ref)} />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <span class="rounded border border-border px-1.5 py-0.5">{formatRefKind(ref.type)}</span>
                      {#if ref.status === "ready" && refSelectable}
                        <span class="uppercase tracking-wide text-emerald-700 dark:text-emerald-300">safe</span>
                      {:else if ref.status === "ready"}
                        <span class="uppercase tracking-wide text-amber-700 dark:text-amber-300">blocked</span>
                      {:else}
                        <span class="uppercase tracking-wide text-rose-700 dark:text-rose-300">conflict</span>
                      {/if}
                    </div>
                    <div class="mt-1 break-all font-mono text-xs">{ref.ref}</div>
                    <div class="mt-2 text-sm">
                      {#if ref.status === "ready"}
                        {describeRefActionCounts(ref)}
                      {:else}
                        {ref.reason}
                      {/if}
                    </div>
                    {#if ref.status === "ready"}
                      <div class="mt-1 text-xs text-muted-foreground">
                        {describeRefActionTargets(ref)}
                      </div>
                    {/if}
                    {#if ref.effectiveOid}
                      <div class="mt-1 text-xs text-muted-foreground">
                        Effective tip {formatOid(ref.effectiveOid)} from {summarizeRemoteUrls(ref.sourceUrls)}
                      </div>
                    {/if}
                  </div>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Run the analysis again to load a remote backfill plan.
        </div>
      {/if}

      {#if actionMessage}
        <div class="rounded-md border border-border bg-muted/30 p-3 text-xs">
          {actionMessage}
        </div>
      {/if}
    </div>
    {/if}
  {/if}

  <ModalFooter>
    {#if step === "status"}
      <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={probeRemotes} disabled={checking}>
            {checking ? "Checking..." : "Re-check remotes"}
          </Button>
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={clearWarningState}>Clear warning</Button>
        </div>
        <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={openSettings}>
            Edit clone URLs
          </Button>
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={runBackfillDiscovery} disabled={backfillChecking || cloneUrls.length === 0}>
            {backfillChecking ? "Analyzing..." : "Analyze backfill"}
          </Button>
          <Button class="btn btn-outline btn-sm w-full sm:w-auto" onclick={runSyncRetry} disabled={syncing || cloneUrls.length === 0}>
            {syncing ? "Retrying..." : "Retry sync"}
          </Button>
          <Button class="btn btn-primary btn-sm w-full sm:w-auto" onclick={close}>Done</Button>
        </div>
      </div>
    {:else}
      <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0 text-xs text-muted-foreground">
          {backfillStepHint || "No backfill actions selected."}
        </div>
        <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={() => (step = "status")} disabled={backfillChecking || backfilling}>
            Back
          </Button>
          <Button class="btn btn-ghost btn-sm w-full sm:w-auto" onclick={runBackfillDiscovery} disabled={backfillChecking || backfilling}>
            {backfillChecking ? "Analyzing..." : "Re-run analysis"}
          </Button>
          <Button class="btn btn-outline btn-sm w-full sm:w-auto" onclick={close} disabled={backfillChecking || backfilling}>
            Done
          </Button>
          <Button
            class="btn btn-primary btn-sm w-full sm:w-auto"
            onclick={applyBackfill}
            disabled={backfillChecking || backfilling || !canBackfill || selectedBackfillTargets.length === 0}>
            {backfilling ? "Backfilling..." : "Backfill selected"}
          </Button>
        </div>
      </div>
    {/if}
  </ModalFooter>
</div>
