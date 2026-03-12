<script lang="ts">
  import {Button, toast} from "@nostr-git/ui"
  import {
    Check,
    Clock,
    X,
    AlertCircle,
    Circle,
    RotateCw,
    ArrowLeft,
    Copy,
    ChevronDown,
    ChevronRight,
    Loader2,
    Code,
    Hash,
    GitCommit,
    ExternalLink,
  } from "@lucide/svelte"
  import {pubkey, signer} from "@welshman/app"
  import Spinner from "@lib/components/Spinner.svelte"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {load, request} from "@welshman/net"

  const repoClass = getContext<Repo>(REPO_KEY)
  if (!repoClass) throw new Error("Repo context not available")

  const {runId} = $page.params
  const JOB_RELAYS = ["wss://relay.sharegap.net", "wss://nos.lol", "wss://relay.primal.net"]

  // Raw event state — the source of truth
  let runEvent = $state<any | null>(null) // Kind 5401 workflow run
  let loomJobEvent = $state<any | null>(null) // Kind 5100 loom job (child)
  let loomStatusEvent = $state<any | null>(null) // Kind 30100 loom status (latest)
  let loomResultEvent = $state<any | null>(null) // Kind 5101 loom result
  let workflowLogEvent = $state<any | null>(null) // Kind 5402 workflow log/result
  let legacyJobEvent = $state<any | null>(null) // Kind 5100 direct (no parent 5401)

  let stdout = $state("")
  let stderr = $state("")
  let loading = $state(true)
  let error = $state<string | null>(null)
  let showRawEvents = $state(false)

  let feedCleanup: (() => void) | undefined

  // Whether this run is a hive-ci Kind 5401 or a legacy Kind 5100
  const isHiveCIRun = $derived(runEvent?.kind === 5401)

  // ── Derived: parsed run info ──────────────────────────────────────────
  const runInfo = $derived.by(() => {
    if (!runEvent) return null
    const tags: string[][] = runEvent.tags || []
    const tagVal = (name: string) => tags.find((t: string[]) => t[0] === name)?.[1]

    if (isHiveCIRun) {
      const workflowPath = tagVal("workflow") || ""
      return {
        name: workflowPath
          ? workflowPath.split("/").pop()?.replace(/\.(yml|yaml)$/, "") || "Workflow"
          : "Workflow",
        workflowPath,
        branch: tagVal("branch") || "",
        trigger: tagVal("trigger") || "manual",
        triggeredBy: tagVal("triggered-by") || runEvent.pubkey,
        publisher: tagVal("publisher") || "",
        repoNaddr: tagVal("a") || "",
        createdAt: runEvent.created_at * 1000,
      }
    } else {
      // Legacy Kind 5100
      const argsTag = tags.find((t: string[]) => t[0] === "args")
      const args = argsTag ? argsTag.slice(1) : []
      let name = "Unknown Workflow"
      if (args.length >= 2 && args[0] === "-c") {
        const match = args[1].match(/act -W (\S+\.(?:yml|yaml))/)
        if (match?.[1]) name = match[1].split("/").pop()?.replace(/\.(yml|yaml)$/, "") || name
      }
      const pTag = tags.find((t: string[]) => t[0] === "p")
      return {
        name,
        workflowPath: "",
        branch: "",
        trigger: "manual",
        triggeredBy: runEvent.pubkey,
        publisher: "",
        repoNaddr: tagVal("a") || "",
        createdAt: runEvent.created_at * 1000,
        worker: pTag?.[1] || "unknown",
        cmd: tagVal("cmd") || "bash",
        args,
        payment: tagVal("payment") || "",
        envVars: tags.filter((t: string[]) => t[0] === "env" && t.length >= 3).map((t: string[]) => `${t[1]}=${t[2]}`),
      }
    }
  })

  // ── Derived: loom job info ────────────────────────────────────────────
  const loomInfo = $derived.by(() => {
    if (!loomJobEvent) return null
    const tags: string[][] = loomJobEvent.tags || []
    const pTag = tags.find((t: string[]) => t[0] === "p")
    const paymentTag = tags.find((t: string[]) => t[0] === "payment")
    return {
      id: loomJobEvent.id,
      worker: pTag?.[1] || "unknown",
      payment: paymentTag?.[1] || "",
    }
  })

  // ── Derived: composite status ─────────────────────────────────────────
  // Priority: Kind 5402 (workflow log) > Kind 5101 (loom result) > Kind 30100 (loom status) > pending
  // Failure if EITHER workflow result OR loom job indicates failure
  const resolvedStatus = $derived.by((): string => {
    // Kind 5402 — hive-ci workflow result (published by ephemeral key)
    if (workflowLogEvent) {
      const statusTag = workflowLogEvent.tags?.find((t: string[]) => t[0] === "status")
      const exitCodeTag = workflowLogEvent.tags?.find((t: string[]) => t[0] === "exit_code")
      const s = statusTag?.[1] || "unknown"
      if (s === "success" && exitCodeTag?.[1] === "0") return "success"
      if (s === "success") return "success"
      if (s === "failed" || s === "failure") return "failure"
      // Even if 5402 says success, if loom result says failure → failure
      if (loomResultEvent) {
        const loomSuccess = loomResultEvent.tags?.find((t: string[]) => t[0] === "success")
        if (loomSuccess?.[1] === "false") return "failure"
      }
      return s
    }

    // Kind 5101 — loom job result
    if (loomResultEvent) {
      const successTag = loomResultEvent.tags?.find((t: string[]) => t[0] === "success")
      const exitCodeTag = loomResultEvent.tags?.find((t: string[]) => t[0] === "exit_code")
      const isSuccess = successTag?.[1] === "true" || exitCodeTag?.[1] === "0"
      return isSuccess ? "success" : "failure"
    }

    // Kind 30100 — loom job status
    if (loomStatusEvent) {
      const statusTag = loomStatusEvent.tags?.find((t: string[]) => t[0] === "status")
      const s = statusTag?.[1] || "pending"
      if (s === "failed") return "failure"
      return s
    }

    return "pending"
  })

  // ── Derived: workflow log details ─────────────────────────────────────
  const workflowLogInfo = $derived.by(() => {
    if (!workflowLogEvent) return null
    const tags: string[][] = workflowLogEvent.tags || []
    const tagVal = (name: string) => tags.find((t: string[]) => t[0] === name)?.[1]
    return {
      status: tagVal("status") || "unknown",
      exitCode: tagVal("exit_code"),
      duration: tagVal("duration"),
      logUrl: tagVal("log_url"),
    }
  })

  // ── Derived: loom result details ──────────────────────────────────────
  const loomResultInfo = $derived.by(() => {
    if (!loomResultEvent) return null
    const tags: string[][] = loomResultEvent.tags || []
    const tagVal = (name: string) => tags.find((t: string[]) => t[0] === name)?.[1]
    return {
      success: tagVal("success"),
      exitCode: tagVal("exit_code"),
      duration: tagVal("duration"),
      stdoutUrl: tagVal("stdout"),
      stderrUrl: tagVal("stderr"),
      change: tagVal("change"),
    }
  })

  // ── Fetch output files ────────────────────────────────────────────────
  const fetchOutputFile = async (url: string, type: "stdout" | "stderr") => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const content = await response.text()
      if (type === "stdout") stdout = content
      else stderr = content
    } catch (err) {
      console.error(`Failed to fetch ${type}:`, err)
    }
  }

  // ── Mount: fetch all events ───────────────────────────────────────────
  onMount(() => {
    if (!runId) {
      error = "Run ID is required"
      loading = false
      return
    }

    // Fetch Kind 5401 and Kind 5100 by ID (one of them will be the anchor)
    // Plus all child/related events
    Promise.all([
      load({relays: JOB_RELAYS, filters: [{kinds: [5401], ids: [runId]}]}),
      load({relays: JOB_RELAYS, filters: [{kinds: [5100], ids: [runId]}]}),
      load({relays: JOB_RELAYS, filters: [{kinds: [5402], "#e": [runId]}]}),
      load({relays: JOB_RELAYS, filters: [{kinds: [5100], "#e": [runId]}]}),
      load({relays: JOB_RELAYS, filters: [{kinds: [5101], "#e": [runId]}]}),
      load({relays: JOB_RELAYS, filters: [{kinds: [30100], "#e": [runId]}]}),
    ]).then(([k5401, k5100ById, k5402, k5100ByRef, k5101, k30100]) => {
      if (k5401.length > 0) {
        runEvent = k5401[0]
      } else if (k5100ById.length > 0) {
        runEvent = k5100ById[0]
        legacyJobEvent = k5100ById[0]
      } else {
        error = `Workflow run ${runId} not found on any relay`
        loading = false
        return
      }
      loading = false

      // Workflow log (Kind 5402)
      if (k5402.length > 0) {
        workflowLogEvent = k5402[0]
        const logUrl = k5402[0].tags?.find((t: string[]) => t[0] === "log_url")?.[1]
        if (logUrl) fetchOutputFile(logUrl, "stdout")
      }

      // Loom job referencing this run (Kind 5100 with e-tag)
      if (k5100ByRef.length > 0) {
        loomJobEvent = k5100ByRef[0]
        // Fetch status/results for the loom job's own ID
        const loomId = loomJobEvent.id
        Promise.all([
          load({relays: JOB_RELAYS, filters: [{kinds: [5101], "#e": [loomId]}]}),
          load({relays: JOB_RELAYS, filters: [{kinds: [30100], "#e": [loomId]}]}),
        ]).then(([loomResults, loomStatuses]) => {
          if (loomResults.length > 0) {
            loomResultEvent = loomResults[0]
            const stdoutUrl = loomResults[0].tags?.find((t: string[]) => t[0] === "stdout")?.[1]
            const stderrUrl = loomResults[0].tags?.find((t: string[]) => t[0] === "stderr")?.[1]
            if (stdoutUrl && !workflowLogEvent) fetchOutputFile(stdoutUrl, "stdout")
            if (stderrUrl) fetchOutputFile(stderrUrl, "stderr")
          }
          if (loomStatuses.length > 0) {
            const sorted = [...loomStatuses].sort((a: any, b: any) => b.created_at - a.created_at)
            loomStatusEvent = sorted[0]
          }
        })
      }

      // Direct results/status referencing the run ID (e.g. legacy or direct)
      if (k5101.length > 0 && !loomResultEvent) {
        loomResultEvent = k5101[0]
        const stdoutUrl = k5101[0].tags?.find((t: string[]) => t[0] === "stdout")?.[1]
        const stderrUrl = k5101[0].tags?.find((t: string[]) => t[0] === "stderr")?.[1]
        if (stdoutUrl && !workflowLogEvent) fetchOutputFile(stdoutUrl, "stdout")
        if (stderrUrl) fetchOutputFile(stderrUrl, "stderr")
      }
      if (k30100.length > 0) {
        const sorted = [...k30100].sort((a: any, b: any) => b.created_at - a.created_at)
        if (!loomStatusEvent) loomStatusEvent = sorted[0]
      }
    })

    // Live subscription
    const abort = new AbortController()
    feedCleanup = () => abort.abort()

    request({
      relays: JOB_RELAYS,
      filters: [
        {kinds: [5402], "#e": [runId]},
        {kinds: [5100], "#e": [runId]},
        {kinds: [5101], "#e": [runId]},
        {kinds: [30100], "#e": [runId]},
      ],
      signal: abort.signal,
      onEvent: (event: any) => {
        if (event.kind === 5402) {
          workflowLogEvent = event
          const logUrl = event.tags?.find((t: string[]) => t[0] === "log_url")?.[1]
          if (logUrl) fetchOutputFile(logUrl, "stdout")
        }
        if (event.kind === 5100 && !loomJobEvent) {
          loomJobEvent = event
          // Subscribe to loom job's own results
          request({
            relays: JOB_RELAYS,
            filters: [
              {kinds: [5101], "#e": [event.id]},
              {kinds: [30100], "#e": [event.id]},
            ],
            signal: abort.signal,
            onEvent: (child: any) => {
              if (child.kind === 5101) loomResultEvent = child
              if (child.kind === 30100) {
                if (!loomStatusEvent || child.created_at > loomStatusEvent.created_at) {
                  loomStatusEvent = child
                }
              }
            },
          })
        }
        if (event.kind === 5101) {
          loomResultEvent = event
          const stdoutUrl = event.tags?.find((t: string[]) => t[0] === "stdout")?.[1]
          const stderrUrl = event.tags?.find((t: string[]) => t[0] === "stderr")?.[1]
          if (stdoutUrl && !workflowLogEvent) fetchOutputFile(stdoutUrl, "stdout")
          if (stderrUrl) fetchOutputFile(stderrUrl, "stderr")
        }
        if (event.kind === 30100) {
          if (!loomStatusEvent || event.created_at > loomStatusEvent.created_at) {
            loomStatusEvent = event
          }
        }
      },
    })
  })

  onDestroy(() => feedCleanup?.())

  // ── Helpers ───────────────────────────────────────────────────────────
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return Check
      case "failure": case "failed": return X
      case "in_progress": case "running": return Loader2
      case "pending": case "queued": return Clock
      default: return Circle
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success": return "text-green-500"
      case "failure": case "failed": return "text-red-500"
      case "in_progress": case "running": return "text-yellow-500"
      case "pending": case "queued": return "text-gray-400"
      default: return "text-gray-500"
    }
  }

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case "success": return "bg-green-500/10 border-green-500/20"
      case "failure": case "failed": return "bg-red-500/10 border-red-500/20"
      case "in_progress": case "running": return "bg-yellow-500/10 border-yellow-500/20"
      case "pending": case "queued": return "bg-gray-400/10 border-gray-400/20"
      default: return "bg-gray-500/10 border-gray-500/20"
    }
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  const goBack = () => {
    goto(`/spaces/${encodeURIComponent($page.params.relay!)}/git/${$page.params.id}/cicd`)
  }
</script>

<svelte:head>
  <title>{repoClass?.name} - Workflow Run</title>
</svelte:head>

<div class="space-y-4">
  {#if loading}
    <div class="flex items-center justify-center py-12">
      <Spinner {loading} />
    </div>
  {:else if error || !runEvent || !runInfo}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <AlertCircle class="mb-2 h-8 w-8" />
      <p class="text-sm">{error || "Workflow not found"}</p>
      <Button size="sm" variant="outline" onclick={goBack} class="mt-4">
        <ArrowLeft class="mr-2 h-4 w-4" />
        Back to Pipelines
      </Button>
    </div>
  {:else}
    <!-- Header -->
    <div class="sticky -top-8 my-4 max-w-full space-y-2 backdrop-blur">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <Button size="sm" variant="outline" onclick={goBack} class="gap-2">
            <ArrowLeft class="h-4 w-4" />
            Back
          </Button>
          <div>
            <h2 class="flex items-center gap-2 text-xl font-semibold">
              {runInfo.name}
              <span
                class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(resolvedStatus)} ${getStatusColor(resolvedStatus)}`}>
                {#if resolvedStatus === "in_progress" || resolvedStatus === "running"}
                  <Loader2 class="h-3 w-3 animate-spin" />
                {:else}
                  {@const StatusIcon = getStatusIcon(resolvedStatus)}
                  <StatusIcon class="h-3 w-3" />
                {/if}
                {resolvedStatus.replace("_", " ")}
              </span>
            </h2>
            <p class="text-sm text-muted-foreground">
              Submitted {formatTimeAgo(runInfo.createdAt)}
              {#if runInfo.branch}
                <span class="ml-1">on <span class="font-medium">{runInfo.branch}</span></span>
              {/if}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onclick={() => {
            navigator.clipboard.writeText(runEvent.id)
            toast.push({message: "Run ID copied", variant: "default"})
          }}
          class="gap-2">
          <Copy class="h-4 w-4" />
          Copy ID
        </Button>
      </div>
    </div>

    <!-- Workflow Run Details -->
    <div class="rounded-lg border border-border bg-card p-4">
      <h3 class="mb-3 text-lg font-semibold">Workflow Run</h3>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Run ID</p>
          <span class="font-mono text-sm">{runEvent.id.slice(0, 16)}...</span>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Kind</p>
          <span class="text-sm">{isHiveCIRun ? "5401 (Hive CI Run)" : "5100 (Loom Job)"}</span>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Triggered by</p>
          <span class="font-mono text-sm">{runInfo.triggeredBy.slice(0, 16)}...</span>
        </div>
        {#if runInfo.workflowPath}
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Workflow</p>
            <code class="rounded bg-muted px-2 py-1 text-sm">{runInfo.workflowPath}</code>
          </div>
        {/if}
        {#if runInfo.branch}
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Branch</p>
            <span class="font-medium text-sm">{runInfo.branch}</span>
          </div>
        {/if}
        {#if runInfo.trigger}
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Trigger</p>
            <span class="text-sm">{runInfo.trigger}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Status Summary -->
    <div class="rounded-lg border border-border bg-card p-4">
      <h3 class="mb-3 text-lg font-semibold">Status</h3>
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground">Overall status</span>
          <span
            class={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${getStatusBgColor(resolvedStatus)} ${getStatusColor(resolvedStatus)}`}>
            {#if resolvedStatus === "in_progress" || resolvedStatus === "running"}
              <Loader2 class="h-4 w-4 animate-spin" />
            {:else}
              {@const StatusIcon = getStatusIcon(resolvedStatus)}
              <StatusIcon class="h-4 w-4" />
            {/if}
            {resolvedStatus.replace("_", " ")}
          </span>
        </div>

        <!-- Show which sources contributed -->
        <div class="space-y-1 text-xs text-muted-foreground">
          {#if workflowLogInfo}
            <div class="flex justify-between">
              <span>Workflow result (5402):</span>
              <span class="font-mono">{workflowLogInfo.status}{workflowLogInfo.exitCode ? ` (exit ${workflowLogInfo.exitCode})` : ""}</span>
            </div>
          {/if}
          {#if loomResultInfo}
            <div class="flex justify-between">
              <span>Loom result (5101):</span>
              <span class="font-mono">{loomResultInfo.success === "true" ? "success" : "failure"}{loomResultInfo.exitCode ? ` (exit ${loomResultInfo.exitCode})` : ""}</span>
            </div>
          {/if}
          {#if loomStatusEvent}
            {@const statusTag = loomStatusEvent.tags?.find((t: string[]) => t[0] === "status")}
            <div class="flex justify-between">
              <span>Loom status (30100):</span>
              <span class="font-mono">{statusTag?.[1] || "unknown"}</span>
            </div>
          {/if}
          {#if !workflowLogInfo && !loomResultInfo && !loomStatusEvent}
            <p>No status updates received yet.</p>
          {/if}
        </div>
      </div>
    </div>

    <!-- Workflow Result (Kind 5402) -->
    {#if workflowLogInfo}
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Workflow Result</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {#if workflowLogInfo.exitCode}
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Exit Code</p>
              <span class="font-mono text-sm">{workflowLogInfo.exitCode}</span>
            </div>
          {/if}
          {#if workflowLogInfo.duration}
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Duration</p>
              <span class="text-sm">{workflowLogInfo.duration}s</span>
            </div>
          {/if}
          {#if workflowLogInfo.logUrl}
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Log URL</p>
              <a href={workflowLogInfo.logUrl} target="_blank" rel="noopener" class="flex items-center gap-1 text-sm text-blue-500 hover:underline">
                <ExternalLink class="h-3 w-3" />
                View log
              </a>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Loom Job (child event) -->
    {#if loomInfo}
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Loom Job</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Job ID</p>
            <span class="font-mono text-sm">{loomInfo.id.slice(0, 16)}...</span>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Worker</p>
            <span class="font-mono text-sm">{loomInfo.worker.slice(0, 16)}...</span>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Payment</p>
            <span class="text-sm">{loomInfo.payment ? "Attached" : "N/A"}</span>
          </div>
        </div>

        <!-- Loom result details -->
        {#if loomResultInfo}
          <div class="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
            {#if loomResultInfo.success !== undefined}
              <div class="space-y-1">
                <p class="text-xs text-muted-foreground">Success</p>
                <span class="text-sm font-medium">{loomResultInfo.success}</span>
              </div>
            {/if}
            {#if loomResultInfo.exitCode}
              <div class="space-y-1">
                <p class="text-xs text-muted-foreground">Exit Code</p>
                <span class="font-mono text-sm">{loomResultInfo.exitCode}</span>
              </div>
            {/if}
            {#if loomResultInfo.duration}
              <div class="space-y-1">
                <p class="text-xs text-muted-foreground">Duration</p>
                <span class="text-sm">{loomResultInfo.duration}s</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Legacy command details (for Kind 5100 direct) -->
    {#if !isHiveCIRun && runInfo.cmd}
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Command Details</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Command</p>
            <code class="rounded bg-muted px-2 py-1 text-sm">{runInfo.cmd}</code>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Worker</p>
            <span class="font-mono text-sm">{runInfo.worker?.slice(0, 16)}...</span>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Payment</p>
            <span class="text-sm">{runInfo.payment || "N/A"}</span>
          </div>
        </div>
        {#if runInfo.envVars?.length > 0}
          <div class="mt-4">
            <p class="mb-2 text-xs text-muted-foreground">Environment Variables</p>
            <div class="space-y-1">
              {#each runInfo.envVars as envVar}
                <code class="block rounded bg-muted px-2 py-1 text-xs">{envVar}</code>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Output -->
    {#if stdout || stderr}
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Output</h3>
        <div class="space-y-4">
          {#if stdout}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium">Standard Output</h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => {
                    navigator.clipboard.writeText(stdout)
                    toast.push({message: "Copied", variant: "default"})
                  }}
                  class="gap-1 text-xs">
                  <Copy class="h-3 w-3" />
                  Copy
                </Button>
              </div>
              <pre class="max-h-96 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs">{stdout}</pre>
            </div>
          {/if}
          {#if stderr}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium text-red-500">Standard Error</h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => {
                    navigator.clipboard.writeText(stderr)
                    toast.push({message: "Copied", variant: "default"})
                  }}
                  class="gap-1 text-xs">
                  <Copy class="h-3 w-3" />
                  Copy
                </Button>
              </div>
              <pre class="max-h-96 overflow-auto rounded-lg border border-red-500/20 bg-red-500/5 p-4 font-mono text-xs text-red-900">{stderr}</pre>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Raw Events (collapsible debug section) -->
    <div class="rounded-lg border border-border bg-card overflow-hidden">
      <button
        class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/50 transition-colors"
        onclick={() => showRawEvents = !showRawEvents}>
        <span class="text-sm font-semibold">Raw Events</span>
        {#if showRawEvents}
          <ChevronDown class="h-4 w-4 text-muted-foreground" />
        {:else}
          <ChevronRight class="h-4 w-4 text-muted-foreground" />
        {/if}
      </button>

      {#if showRawEvents}
        <div class="space-y-3 px-4 pb-4">
          <!-- Kind 5401 / run event -->
          {#if runEvent}
            <div class="overflow-hidden rounded-lg border border-purple-200 dark:border-purple-800">
              <div class="border-b border-purple-200 bg-purple-50 px-3 py-2 dark:border-purple-800 dark:bg-purple-950/40">
                <h4 class="text-xs font-semibold text-purple-900 dark:text-purple-300">
                  {isHiveCIRun ? "Workflow Run Event" : "Job Request Event"}
                </h4>
                <p class="mt-0.5 text-xs text-purple-600 dark:text-purple-400">Kind: {runEvent.kind} | ID: {runEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-purple-50/50 p-3 font-mono text-xs dark:bg-purple-950/20">{JSON.stringify(runEvent, null, 2)}</pre>
            </div>
          {/if}

          <!-- Kind 5100 loom job -->
          {#if loomJobEvent}
            <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/40">
                <h4 class="text-xs font-semibold">Loom Job Request Event</h4>
                <p class="mt-0.5 text-xs text-muted-foreground">Kind: {loomJobEvent.kind} | ID: {loomJobEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-gray-50/50 p-3 font-mono text-xs dark:bg-gray-800/20">{JSON.stringify(loomJobEvent, null, 2)}</pre>
            </div>
          {/if}

          <!-- Kind 30100 loom status -->
          {#if loomStatusEvent}
            <div class="overflow-hidden rounded-lg border border-blue-200 dark:border-blue-800">
              <div class="border-b border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/40">
                <h4 class="text-xs font-semibold text-blue-900 dark:text-blue-300">Loom Job Status Event</h4>
                <p class="mt-0.5 text-xs text-blue-600 dark:text-blue-400">Kind: {loomStatusEvent.kind} | ID: {loomStatusEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-blue-50/50 p-3 font-mono text-xs dark:bg-blue-950/20">{JSON.stringify(loomStatusEvent, null, 2)}</pre>
            </div>
          {/if}

          <!-- Kind 5101 loom result -->
          {#if loomResultEvent}
            <div class="overflow-hidden rounded-lg border border-green-200 dark:border-green-800">
              <div class="border-b border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-950/40">
                <h4 class="text-xs font-semibold text-green-900 dark:text-green-300">Loom Job Result Event</h4>
                <p class="mt-0.5 text-xs text-green-600 dark:text-green-400">Kind: {loomResultEvent.kind} | ID: {loomResultEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-green-50/50 p-3 font-mono text-xs dark:bg-green-950/20">{JSON.stringify(loomResultEvent, null, 2)}</pre>
            </div>
          {/if}

          <!-- Kind 5402 workflow log -->
          {#if workflowLogEvent}
            <div class="overflow-hidden rounded-lg border border-indigo-200 dark:border-indigo-800">
              <div class="border-b border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                <h4 class="text-xs font-semibold text-indigo-900 dark:text-indigo-300">Workflow Log Event</h4>
                <p class="mt-0.5 text-xs text-indigo-600 dark:text-indigo-400">Kind: {workflowLogEvent.kind} | ID: {workflowLogEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-indigo-50/50 p-3 font-mono text-xs dark:bg-indigo-950/20">{JSON.stringify(workflowLogEvent, null, 2)}</pre>
            </div>
          {/if}

          {#if !runEvent && !loomJobEvent && !loomStatusEvent && !loomResultEvent && !workflowLogEvent}
            <p class="py-4 text-center text-sm text-muted-foreground">No events available yet</p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
