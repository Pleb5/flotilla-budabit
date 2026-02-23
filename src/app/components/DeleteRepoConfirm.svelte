<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {preventDefault} from "@lib/html"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import {chunk} from "@welshman/lib"
  import {load} from "@welshman/net"
  import {repository, pubkey, publishThunk} from "@welshman/app"
  import {
    Address,
    DELETE,
    getAddress,
    makeEvent,
    isReplaceable,
    type TrustedEvent,
  } from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import {clearModals} from "@app/util/modal"
  import {goto} from "$app/navigation"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    GIT_PATCH,
    GIT_STACK,
    GIT_MERGE_METADATA,
    GIT_CONFLICT_METADATA,
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_STATUS_OPEN,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    parseRepoAnnouncementEvent,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import {detectVendorFromUrl, getGitServiceApiFromUrl, type GitVendor} from "@nostr-git/core/git"
  import {tokens as tokensStore, tryTokensForHost, getTokensForHost, type Token} from "@nostr-git/ui"
  import {getRepoAnnouncementRelays} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"

  type Props = {
    repoClass: Repo
    repoEvent: RepoAnnouncementEvent
    repoName: string
    repoRelays: string[]
    backPath: string
    onClose?: () => void
  }

  const {repoClass, repoEvent, repoName, repoRelays, backPath, onClose}: Props = $props()

  type RemoteTarget = {
    id: string
    vendor: GitVendor
    host: string
    owner: string
    repo: string
    url: string
    label: string
    repoPath: string
    supported: boolean
    hasToken: boolean
  }

  type RemoteDeleteResult = {
    id: string
    label: string
    repoPath: string
    status: "deleted" | "failed" | "skipped"
    detail?: string
  }

  type AccessStatus =
    | "checking"
    | "ready"
    | "read-only"
    | "no-token"
    | "manual"
    | "unknown"

  type AccessCheck = {
    status: AccessStatus
    detail?: string
    role?: string
  }

  type ScopeInfo = {
    scopes: string[] | null
    detail?: string
  }

  type DeleteSummary = {
    deleteRequests: number
    deletedEvents: number
    tombstonesSent: number
    relays: string[]
    kinds: Array<{label: string; count: number}>
    remotes: RemoteDeleteResult[]
    localDeleted: boolean
    localError?: string
  }

  const vendorLabels: Record<GitVendor, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    gitea: "Gitea",
    bitbucket: "Bitbucket",
    grasp: "GRASP",
    generic: "Generic",
  }

  const kindLabels = new Map<number, string>([
    [GIT_REPO_ANNOUNCEMENT, "Repo announcements"],
    [GIT_REPO_STATE, "Repo state"],
    [GIT_PATCH, "Patches"],
    [GIT_STACK, "Stacks"],
    [GIT_MERGE_METADATA, "Merge metadata"],
    [GIT_CONFLICT_METADATA, "Conflict metadata"],
    [GIT_ISSUE, "Issues"],
    [GIT_PULL_REQUEST, "Pull requests"],
    [GIT_PULL_REQUEST_UPDATE, "Pull request updates"],
    [GIT_STATUS_OPEN, "Status (open)"],
    [GIT_STATUS_APPLIED, "Status (applied)"],
    [GIT_STATUS_CLOSED, "Status (closed)"],
    [GIT_STATUS_DRAFT, "Status (draft)"],
  ])

  let confirmText = $state("")
  let tokens = $state<Token[]>([])
  let cloneUrls = $state<string[]>([])
  let selectedRemoteIds = $state<string[]>([])
  let selectionInitialized = $state(false)
  let tokensLoaded = $state(false)
  let isDeleting = $state(false)
  let progress = $state<{completed: number; total: number; label: string} | null>(null)
  let summary = $state<DeleteSummary | null>(null)
  let accessChecks = $state<Record<string, AccessCheck>>({})
  let preflightRunId = 0

  const canDelete = $derived(!!$pubkey && repoEvent?.pubkey === $pubkey)
  const confirmOk = $derived(repoName.trim().length > 0 && confirmText.trim() === repoName)
  const preflightPending = $derived.by(() => {
    if (!remoteTargets.length) return false
    if (!tokensLoaded) return true
    for (const target of remoteTargets) {
      const access = accessChecks[target.id]
      if (!access || access.status === "checking") return true
    }
    return false
  })

  const deleteDisabled = $derived(!confirmOk || !canDelete || isDeleting || preflightPending)

  const back = () => history.back()

  const parseCloneUrl = (value: string) => {
    const toUrl = (raw: string): URL | null => {
      try {
        return new URL(raw)
      } catch {
        if (raw.startsWith("git@")) {
          const normalized = raw.replace(/^git@([^:]+):(.+)$/, "ssh://$1/$2")
          try {
            return new URL(normalized)
          } catch {
            return null
          }
        }
        if (!raw.includes("://")) {
          try {
            return new URL(`https://${raw}`)
          } catch {
            return null
          }
        }
        return null
      }
    }

    const url = toUrl(value)
    if (!url) return null
    const pathname = url.pathname.replace(/^\/+/, "")
    if (!pathname) return null
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const repoRaw = parts.pop() || ""
    const vendor = detectVendorFromUrl(value)
    const owner =
      vendor === "gitlab" || vendor === "gitea" ? parts.join("/") : parts.pop() || ""
    const repo = repoRaw.replace(/\.git$/, "")
    if (!owner || !repo) return null
    return {
      vendor,
      host: url.hostname.toLowerCase(),
      owner,
      repo,
      url: value,
    }
  }

  const buildRemoteTargets = (urls: string[], tokenList: Token[]) => {
    const map = new Map<string, RemoteTarget>()
    for (const url of urls) {
      const parsed = parseCloneUrl(url)
      if (!parsed) {
        const id = `unknown:${url}`
        if (!map.has(id)) {
          map.set(id, {
            id,
            vendor: "generic",
            host: "",
            owner: "",
            repo: "",
            url,
            label: "Unknown remote",
            repoPath: url,
            supported: false,
            hasToken: false,
          })
        }
        continue
      }
      const supported = !["generic", "grasp"].includes(parsed.vendor)
      const matchingTokens = getTokensForHost(tokenList, parsed.host)
      const hasToken = matchingTokens.length > 0
      const vendorLabel = vendorLabels[parsed.vendor] || "Remote"
      const repoPath = `${parsed.owner}/${parsed.repo}`
      const id = `${parsed.vendor}:${parsed.host}:${repoPath}`
      if (map.has(id)) continue
      map.set(id, {
        id,
        vendor: parsed.vendor,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
        url: parsed.url,
        label: `${vendorLabel} (${parsed.host})`,
        repoPath,
        supported,
        hasToken,
      })
    }
    return Array.from(map.values())
  }

  const remoteTargets = $derived.by(() => buildRemoteTargets(cloneUrls, tokens))

  const accessLabel = (access: AccessCheck) => {
    switch (access.status) {
      case "ready":
        return "Admin access"
      case "read-only":
        return "Read-only"
      case "no-token":
        return "No token"
      case "manual":
        return "Manual only"
      case "unknown":
        return "Unknown access"
      case "checking":
      default:
        return "Checking..."
    }
  }

  const accessTone = (access: AccessCheck) => {
    switch (access.status) {
      case "ready":
        return "text-green-400"
      case "read-only":
      case "no-token":
        return "text-red-400"
      case "unknown":
      case "manual":
        return "text-yellow-400"
      case "checking":
      default:
        return "text-gray-400"
    }
  }

  const canSelectAccess = (access: AccessCheck) =>
    access.status === "ready" || access.status === "unknown"

  const getAccessForTarget = (target: RemoteTarget): AccessCheck => {
    const access = accessChecks[target.id]
    if (access) return access
    if (!tokensLoaded) return {status: "checking"}
    if (!target.supported) {
      return {
        status: "manual",
        detail: target.vendor === "grasp" ? "Manual deletion only (GRASP)" : "Remote deletion unsupported",
      }
    }
    if (!target.hasToken) return {status: "no-token", detail: "No token for this host"}
    return {status: "checking"}
  }

  const isAccessDeniedMessage = (message: string) => {
    const text = message.toLowerCase()
    return (
      text.includes("403") ||
      text.includes("401") ||
      text.includes("404") ||
      text.includes("forbidden") ||
      text.includes("unauthorized") ||
      text.includes("not found")
    )
  }

  const describeGitLabAccess = (accessLevel?: number) => {
    if (!accessLevel) return undefined
    if (accessLevel >= 50) return "Owner"
    if (accessLevel >= 40) return "Maintainer"
    if (accessLevel >= 30) return "Developer"
    if (accessLevel >= 20) return "Reporter"
    if (accessLevel >= 10) return "Guest"
    return undefined
  }

  const getGithubApiBase = (host: string) => {
    if (!host || host === "github.com") return "https://api.github.com"
    return `https://${host}/api/v3`
  }

  const fetchGithubScopes = async (token: string, host: string): Promise<ScopeInfo> => {
    try {
      const base = getGithubApiBase(host)
      const response = await fetch(`${base}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      })

      const scopesHeader = response.headers.get("x-oauth-scopes")
      if (!scopesHeader) {
        return {scopes: null, detail: "Token scopes not available"}
      }
      const scopes = scopesHeader
        .split(",")
        .map(scope => scope.trim())
        .filter(Boolean)
      return {scopes}
    } catch (error) {
      return {
        scopes: null,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const evaluateRepoAccess = (
    repo: any,
    vendor: GitVendor,
    currentUser?: string,
    scopeInfo?: ScopeInfo | null,
  ): AccessCheck => {
    const permissions = repo?.permissions || {}
    const ownerLogin = repo?.owner?.login?.toLowerCase?.() || ""
    const userLogin = currentUser?.toLowerCase?.() || ""
    const isOwner = ownerLogin && userLogin && ownerLogin === userLogin

    if (vendor === "github") {
      const hasAdmin = permissions.admin === true
      if (!hasAdmin && !isOwner) {
        return {status: "read-only", detail: "Admin access not granted"}
      }

      if (scopeInfo?.scopes) {
        const hasDeleteScope = scopeInfo.scopes.includes("delete_repo")
        if (!hasDeleteScope) {
          return {status: "read-only", detail: "Token missing delete_repo scope"}
        }
        return {status: "ready", detail: "Admin access + delete_repo scope"}
      }

      return {
        status: "unknown",
        detail: "Admin access detected; token scopes unavailable",
      }
    }

    if (permissions.admin === true) {
      return {status: "ready", detail: "Admin access confirmed", role: permissions.role}
    }

    if (vendor === "gitlab" && typeof permissions.accessLevel === "number") {
      const role = describeGitLabAccess(permissions.accessLevel) || permissions.role
      if (permissions.accessLevel >= 50) {
        return {status: "ready", detail: `${role || "Owner"} access`, role}
      }
      return {
        status: "read-only",
        detail: `${role || "Access"} (admin required)`
      }
    }

    if (permissions.admin === false) {
      return {status: "read-only", detail: "Admin access not granted"}
    }

    if (isOwner) {
      return {status: "ready", detail: "Owner access confirmed"}
    }

    return {status: "unknown", detail: "Admin access could not be verified"}
  }

  const checkRemoteAccess = async (target: RemoteTarget): Promise<AccessCheck> => {
    const tokensForHost = getTokensForHost(tokens, target.host)
    if (!tokensForHost.length) {
      return {status: "no-token", detail: "No token for this host"}
    }

    let readOnlyDetail = ""
    const errors: string[] = []

    for (const entry of tokensForHost) {
      try {
        const api = getGitServiceApiFromUrl(target.url, entry.token)
        const repo = await api.getRepo(target.owner, target.repo)
        const scopeInfo =
          target.vendor === "github" ? await fetchGithubScopes(entry.token, target.host) : null
        let access = evaluateRepoAccess(repo, target.vendor, undefined, scopeInfo)

        if (access.status === "unknown" || access.status === "read-only") {
          try {
            const user = await api.getCurrentUser()
            access = evaluateRepoAccess(repo, target.vendor, user?.login, scopeInfo)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            errors.push(message)
          }
        }

        if (access.status === "ready") {
          return access
        }

        if (access.status === "read-only") {
          readOnlyDetail = access.detail || "Admin access not granted"
          continue
        }

        if (access.status === "unknown") {
          return access
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isAccessDeniedMessage(message)) {
          readOnlyDetail = "No access or repository not found"
          continue
        }
        errors.push(message)
      }
    }

    if (readOnlyDetail) {
      return {status: "read-only", detail: readOnlyDetail}
    }

    if (errors.length) {
      return {status: "unknown", detail: errors[0]}
    }

    return {status: "unknown", detail: "Access could not be verified"}
  }

  const runPreflight = async () => {
    const runId = ++preflightRunId
    const targets = remoteTargets
    const initial: Record<string, AccessCheck> = {}

    for (const target of targets) {
      if (!target.supported) {
        initial[target.id] = {
          status: "manual",
          detail: target.vendor === "grasp" ? "Manual deletion only (GRASP)" : "Remote deletion unsupported",
        }
      } else if (!target.hasToken) {
        initial[target.id] = {status: "no-token", detail: "No token for this host"}
      } else {
        initial[target.id] = {status: "checking"}
      }
    }

    accessChecks = initial

    const toCheck = targets.filter(
      target => target.supported && target.hasToken
    )

    await Promise.all(
      toCheck.map(async target => {
        const result = await checkRemoteAccess(target)
        if (runId !== preflightRunId) return
        accessChecks = {...accessChecks, [target.id]: result}
      })
    )

    if (runId !== preflightRunId) return

    if (!selectionInitialized) {
      selectedRemoteIds = targets
        .filter(target => accessChecks[target.id]?.status === "ready")
        .map(target => target.id)
      selectionInitialized = true
    }

    selectedRemoteIds = selectedRemoteIds.filter(id =>
      canSelectAccess(accessChecks[id] || {status: "unknown"}),
    )
  }

  $effect(() => {
    if (!tokensLoaded || isDeleting) return
    selectionInitialized = false
    if (!remoteTargets.length) {
      accessChecks = {}
      return
    }
    void runPreflight()
  })

  onMount(async () => {
    try {
      const loadedTokens = await tokensStore.waitForInitialization()
      tokens = loadedTokens
    } catch {
      tokens = []
    } finally {
      tokensLoaded = true
    }
  })

  onDestroy(() => {
    onClose?.()
  })

  $effect(() => {
    try {
      const parsed = parseRepoAnnouncementEvent(repoEvent)
      const parsedClone = parsed.clone || []
      cloneUrls = parsedClone.length > 0 ? parsedClone : repoClass.clone || []
    } catch {
      cloneUrls = repoClass.clone || []
    }
  })

  const publishDeleteEvent = async (event: any, relays: string[]) => {
    const thunk = publishThunk({event, relays})
    if (thunk?.complete) {
      await thunk.complete
    }
    return thunk
  }

  const buildDeleteTags = (events: TrustedEvent[]) => {
    const tags: string[][] = []
    for (const event of events) {
      tags.push(["e", event.id])
      if (isReplaceable(event)) {
        tags.push(["a", getAddress(event)])
      }
    }
    return tags
  }

  const deleteRepo = async () => {
    if (!canDelete) {
      pushToast({theme: "error", message: "Only the repository owner can delete it."})
      return
    }
    if (!confirmOk) {
      pushToast({theme: "error", message: "Please type the repository name to confirm."})
      return
    }

    isDeleting = true
    progress = null
    summary = null

    try {
      const repoAddress = Address.fromEvent(repoEvent).toString()
      const relays = getRepoAnnouncementRelays(repoRelays)

      const filters = [
        {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey!], "#d": [repoName]},
        {kinds: [GIT_REPO_STATE], authors: [$pubkey!], "#d": [repoName]},
        {
          kinds: [
            GIT_PATCH,
            GIT_STACK,
            GIT_MERGE_METADATA,
            GIT_CONFLICT_METADATA,
            GIT_ISSUE,
            GIT_PULL_REQUEST,
            GIT_PULL_REQUEST_UPDATE,
            GIT_STATUS_OPEN,
            GIT_STATUS_APPLIED,
            GIT_STATUS_CLOSED,
            GIT_STATUS_DRAFT,
          ],
          authors: [$pubkey!],
          "#a": [repoAddress],
        },
      ] as any[]

      if (relays.length > 0) {
        await load({relays, filters}).catch(() => {})
      }

      const events = repository.query(filters, {shouldSort: false}) as TrustedEvent[]
      const byId = new Map<string, TrustedEvent>()
      for (const event of events) {
        if (event.pubkey !== $pubkey) continue
        byId.set(event.id, event)
      }

      const eventsToDelete = Array.from(byId.values())
      const deleteChunks = chunk(300, eventsToDelete)
      const totalSteps = deleteChunks.length + 2
      let completed = 0

      progress = {completed, total: totalSteps, label: "Sending delete requests..."}

      let deleteRequests = 0
      for (const group of deleteChunks) {
        const tags = buildDeleteTags(group)
        if (tags.length > 0) {
          await publishDeleteEvent(makeEvent(DELETE, {tags}), relays)
          deleteRequests += 1
        }
        completed += 1
        progress = {completed, total: totalSteps, label: "Sending delete requests..."}
      }

      progress = {completed, total: totalSteps, label: "Publishing tombstones..."}

      const tombstoneTags = [["d", repoName], ["name", repoName], ["deleted", "true"]]
      await publishDeleteEvent(
        makeEvent(GIT_REPO_ANNOUNCEMENT, {tags: tombstoneTags, content: ""}),
        relays,
      )
      completed += 1
      progress = {completed, total: totalSteps, label: "Publishing tombstones..."}

      await publishDeleteEvent(
        makeEvent(GIT_REPO_STATE, {tags: [["d", repoName], ["deleted", "true"]], content: ""}),
        relays,
      )
      completed += 1

      progress = {completed, total: totalSteps, label: "Deleting remote repositories..."}

      const remoteResults: RemoteDeleteResult[] = []
      const selected = new Set(selectedRemoteIds)
      for (const target of remoteTargets) {
        const access = getAccessForTarget(target)
        if (!selected.has(target.id)) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: "Not selected",
          })
          continue
        }
        if (!canSelectAccess(access)) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: access.detail || "Access not available",
          })
          continue
        }
        if (!target.supported) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: access.detail || "Manual deletion only",
          })
          continue
        }
        try {
          await tryTokensForHost(tokens, target.host, async token => {
            const workerManager: any = repoClass.workerManager as any
            const result = await workerManager.deleteRemoteRepo({
              remoteUrl: target.url,
              token,
            })
            if (!result?.success) {
              throw new Error(result?.error || "Remote deletion failed")
            }
            return result
          })
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "deleted",
          })
        } catch (error) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }

      progress = {completed, total: totalSteps, label: "Cleaning up local cache..."}

      let localDeleted = false
      let localError: string | undefined
      try {
        if (repoClass.key) {
          const localResult = await repoClass.workerManager.deleteRepo({repoId: repoClass.key})
          localDeleted = !!localResult?.success
          if (!localDeleted && localResult?.error) {
            localError = localResult.error
          }
        } else {
          localError = "Missing repository id for local cleanup"
        }
      } catch (error) {
        localError = error instanceof Error ? error.message : String(error)
      }

      try {
        repoClass.commitManager?.reset()
        repoClass.branchManager?.reset()
        repoClass.invalidateBranchCache()
        await repoClass.fileManager?.clearCache()
        await repoClass.patchManager?.clearCache()
        await repoClass.mergeAnalysisCacheManager?.clear()
        if (repoClass.cacheManager) {
          await repoClass.cacheManager.clear("file_content")
          await repoClass.cacheManager.clear("file_listing")
          await repoClass.cacheManager.clear("file_exists")
          await repoClass.cacheManager.clear("file_history")
        }
      } catch {}

      const kindCounts = new Map<number, number>()
      for (const event of eventsToDelete) {
        kindCounts.set(event.kind, (kindCounts.get(event.kind) || 0) + 1)
      }

      const kinds = Array.from(kindCounts.entries())
        .map(([kind, count]) => ({label: kindLabels.get(kind) || `Kind ${kind}`, count}))
        .sort((a, b) => b.count - a.count)

      summary = {
        deleteRequests,
        deletedEvents: eventsToDelete.length,
        tombstonesSent: 2,
        relays,
        kinds,
        remotes: remoteResults,
        localDeleted,
        localError,
      }
    } catch (error) {
      pushToast({
        theme: "error",
        message: `Failed to delete repository: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      isDeleting = false
    }
  }

  const finish = async () => {
    clearModals()
    await goto(backPath || "/git")
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(deleteRepo)}>
  <ModalHeader>
    {#snippet title()}
      Delete repository
    {/snippet}
    {#snippet info()}
      This action cannot be undone
    {/snippet}
  </ModalHeader>

  {#if summary}
    <div class="space-y-3 text-sm">
      <div>
        <div class="font-medium">Nostr deletions</div>
        <div class="text-gray-400">
          {summary.deletedEvents} events targeted, {summary.deleteRequests} delete requests sent
        </div>
        <div class="text-gray-400">Tombstones published: {summary.tombstonesSent}</div>
        <div class="text-gray-400">Relays: {summary.relays.join(", ") || "none"}</div>
        {#if summary.kinds.length > 0}
          <div class="mt-2 grid gap-1">
            {#each summary.kinds as item}
              <div class="flex items-center justify-between">
                <span>{item.label}</span>
                <span class="text-gray-400">{item.count}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div>
        <div class="font-medium">Remote hosts</div>
        {#if summary.remotes.length === 0}
          <div class="text-gray-400">No remote deletions requested</div>
        {:else}
          <div class="mt-2 grid gap-1">
            {#each summary.remotes as remote}
              <div class="flex items-center justify-between">
                <span>{remote.label} · {remote.repoPath}</span>
                {#if remote.status === "deleted"}
                  <span class="text-green-400">Deleted</span>
                {:else if remote.status === "failed"}
                  <span class="text-red-400">Failed</span>
                {:else}
                  <span class="text-gray-400">Skipped</span>
                {/if}
              </div>
              {#if remote.detail}
                <div class="text-xs text-gray-400">{remote.detail}</div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <div>
        <div class="font-medium">Local cache</div>
        {#if summary.localDeleted}
          <div class="text-green-400">Local clone deleted</div>
        {:else}
          <div class="text-red-400">Local clone not deleted</div>
          {#if summary.localError}
            <div class="text-xs text-gray-400">{summary.localError}</div>
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <p class="text-sm text-gray-300">
      This will delete the repository announcement, state, and related NIP-34 events that you
      created. It will not delete comments or other second-order events.
    </p>

    <div class="space-y-3">
      <div>
        <div class="font-medium text-sm">Remote hosts to delete code from</div>
        {#if remoteTargets.length === 0}
          <div class="text-sm text-gray-400">
            No clone URLs found. Only Nostr events will be deleted.
          </div>
        {:else}
          <div class="text-xs text-gray-400">
            Admin/owner access is required to delete a remote repository. Access checks run before
            you can confirm deletion.
          </div>
          <div class="mt-2 grid gap-2">
            {#each remoteTargets as target}
              {@const access = getAccessForTarget(target)}
              <label class="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  value={target.id}
                  bind:group={selectedRemoteIds}
                  disabled={isDeleting || !canSelectAccess(access)}
                  class="mt-1"
                />
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <span>{target.label}</span>
                    <span class={accessTone(access)}>{accessLabel(access)}</span>
                  </div>
                  <div class="text-xs text-gray-400">{target.repoPath}</div>
                  {#if access.detail}
                    <div class="text-xs text-gray-400">{access.detail}</div>
                  {/if}
                </div>
              </label>
            {/each}
          </div>
          {#if preflightPending}
            <div class="text-xs text-gray-400 mt-2">Checking remote access…</div>
          {:else}
            <div class="text-xs text-gray-400 mt-2">
              Hosts marked Read-only, No token, or Manual will be skipped. Unknown access can still
              be selected but may fail.
            </div>
          {/if}
        {/if}
      </div>

      <div>
        <div class="font-medium text-sm">Confirm deletion</div>
        <p class="text-xs text-gray-400">
          Type the repository name <strong>{repoName}</strong> to confirm.
        </p>
        <label class="input input-bordered flex w-full items-center gap-2 mt-2">
          <input bind:value={confirmText} class="grow" type="text" disabled={isDeleting} />
        </label>
        <p class="text-xs text-gray-400 mt-2">
          Note: not all relays honor deletion requests.
        </p>
      </div>

      {#if progress}
        <div class="space-y-2">
          <div class="text-sm text-gray-300">{progress.label}</div>
          <progress
            class="progress progress-primary w-full"
            value={(progress.completed / Math.max(progress.total, 1)) * 100}
            max="100"
          ></progress>
        </div>
      {/if}
    </div>
  {/if}

  <ModalFooter>
    {#if summary}
      <Button class="btn btn-primary" onclick={finish}>
        Done
        <Icon icon={AltArrowRight} />
      </Button>
    {:else}
      <Button class="btn btn-link" onclick={back} disabled={isDeleting}>
        <Icon icon={AltArrowLeft} />
        Go back
      </Button>
      <Button type="submit" class="btn btn-error" disabled={deleteDisabled}>
        <Spinner loading={isDeleting}>Delete repository</Spinner>
        <Icon icon={AltArrowRight} />
      </Button>
    {/if}
  </ModalFooter>
</form>
