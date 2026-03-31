<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {filterValidCloneUrls, updateUrlPreferenceCache} from "@nostr-git/core"
  import {classifyCloneUrlIssue, type CloneUrlIssueKind, type Repo} from "@nostr-git/ui"
  import {onMount} from "svelte"

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

  interface Props {
    repoClass: Repo
    onClose?: () => void
    onOpenSettings?: () => void
    onRefresh?: () => Promise<void> | void
    onSyncBranchStateFromRemote?: (params: {remoteUrl: string; headBranch?: string}) => Promise<void> | void
  }

  const {repoClass, onClose, onOpenSettings, onRefresh, onSyncBranchStateFromRemote}: Props =
    $props()

  let statuses = $state<RemoteStatus[]>([])
  let checking = $state(false)
  let syncing = $state(false)
  let syncingBranchStateUrl = $state<string | null>(null)
  let actionMessage = $state<string>("")

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

<ModalHeader>
  {#snippet title()}
    Review Remote Status
  {/snippet}
  {#snippet info()}
    Probe remotes, review recent read observations, and choose a recovery path only when it is actually needed.
  {/snippet}
</ModalHeader>

{#if cloneUrls.length === 0}
  <p class="text-sm text-muted-foreground">This repository has no clone URLs configured.</p>
{:else}
  <div class="flex flex-col gap-3">
    <div class="rounded-md border border-border bg-muted/20 p-3 text-xs">
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
        <div class="rounded-md border border-border bg-card p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-xs">
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
                class="btn btn-ghost btn-xs"
                onclick={() => syncBranchStateFromRemote(status)}
                disabled={Boolean(syncingBranchStateUrl)}>
                {syncingBranchStateUrl === status.url ? "Syncing..." : "Sync Branch State"}
              </Button>
            {:else if !status.isPrimary && status.health === "healthy"}
              <Button class="btn btn-ghost btn-xs" onclick={() => useForReads(status.url)}>
                Use For Reads
              </Button>
            {:else if status.health === "auth" || status.recordedIssueKind === "auth"}
              <Button class="btn btn-ghost btn-xs" onclick={() => openAuthSetup(status.url)}>
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
{/if}

<ModalFooter>
  <div class="flex w-full flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <Button class="btn btn-ghost btn-sm" onclick={probeRemotes} disabled={checking}>
        {checking ? "Checking..." : "Re-check remotes"}
      </Button>
      <Button class="btn btn-ghost btn-sm" onclick={clearWarningState}>Clear warning</Button>
    </div>
    <div class="flex items-center gap-2">
      <Button class="btn btn-ghost btn-sm" onclick={openSettings}>
        Edit clone URLs
      </Button>
      <Button class="btn btn-outline btn-sm" onclick={runSyncRetry} disabled={syncing || cloneUrls.length === 0}>
        {syncing ? "Retrying..." : "Retry sync"}
      </Button>
      <Button class="btn btn-primary btn-sm" onclick={close}>Done</Button>
    </div>
  </div>
</ModalFooter>
