<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {filterValidCloneUrls, updateUrlPreferenceCache} from "@nostr-git/core"
  import type {Repo} from "@nostr-git/ui"
  import {onMount} from "svelte"

  type RemoteHealth = "healthy" | "degraded" | "auth" | "unreachable" | "unknown"

  type RemoteStatus = {
    url: string
    isPrimary: boolean
    health: RemoteHealth
    message: string
    details?: string
    probeDetails?: string
    updatedAt: number
  }

  interface Props {
    repoClass: Repo
    onClose?: () => void
    onOpenSettings?: () => void
    onRefresh?: () => Promise<void> | void
  }

  const {repoClass, onClose, onOpenSettings, onRefresh}: Props = $props()

  let statuses = $state<RemoteStatus[]>([])
  let checking = $state(false)
  let syncing = $state(false)
  let actionMessage = $state<string>("")

  const cloneUrls = $derived.by(() =>
    Array.from(
      new Set(filterValidCloneUrls((repoClass.cloneUrls || []).map(url => String(url || "").trim()))),
    ),
  )
  const primaryUrl = $derived.by(() => String(cloneUrls[0] || ""))

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

  const classifyError = (error: unknown): {health: RemoteHealth; message: string; details: string} => {
    const details = error instanceof Error ? error.message : String(error || "Unknown error")
    const lower = details.toLowerCase()

    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("permission") ||
      lower.includes("token")
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
      lower.includes("tls")
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
      const branchCount = Array.isArray(refs)
        ? refs.filter(ref => String(ref?.ref || "").startsWith("refs/heads/")).length
        : 0

      const hasHeads = branchCount > 0
      const probeDetails = hasHeads
        ? `Git probe reachable (${branchCount} branch${branchCount === 1 ? "" : "es"})`
        : "Git probe reached the remote, but no branch heads were returned"

      if (recordedError) {
        const classified = classifyError(recordedError.error)
        return {
          url,
          isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
          health: classified.health,
          message: hasHeads
            ? `Git probe succeeded, but a recent app read failed for this remote`
            : "Remote responded, but recent app reads reported problems",
          details: recordedError.error,
          probeDetails,
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
        updatedAt: Date.now(),
      }
    } catch (error) {
      const classified = classifyError(recordedError?.error || error)
      return {
        url,
        isPrimary: normalizeUrl(url) === normalizeUrl(primaryUrl),
        health: classified.health,
        message: classified.message,
        details: recordedError?.error || classified.details,
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

      if (next.some(status => status.health !== "healthy" && status.probeDetails)) {
        actionMessage =
          "Some remotes respond to git probes but still have recent app-level errors recorded. Clear the warning if you confirm it is stale."
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
    if (health === "degraded") return "text-amber-700 dark:text-amber-300"
    if (health === "auth") return "text-orange-700 dark:text-orange-300"
    if (health === "unreachable") return "text-rose-700 dark:text-rose-300"
    return "text-muted-foreground"
  }

  const healthLabel = (health: RemoteHealth) => {
    if (health === "auth") return "auth"
    return health
  }
</script>

<ModalHeader>
  {#snippet title()}
    Resolve Remote Issues
  {/snippet}
  {#snippet info()}
    Keep primary clone URL as the source of truth, but recover safely when mirrors fail.
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
            {#if !status.isPrimary && status.health === "healthy"}
              <Button class="btn btn-ghost btn-xs" onclick={() => useForReads(status.url)}>
                Use For Reads
              </Button>
            {:else if status.health === "auth"}
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
