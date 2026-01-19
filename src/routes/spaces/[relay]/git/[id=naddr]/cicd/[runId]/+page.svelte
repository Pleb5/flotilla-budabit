<script lang="ts">
  import {Button, toast} from "@nostr-git/ui"
  import {
    CalendarDays,
    Check,
    Clock,
    Eye,
    GitCommit,
    Play,
    SearchX,
    X,
    AlertCircle,
    Circle,
    RotateCw,
    ArrowLeft,
    Terminal,
    Copy,
    Download,
    ChevronDown,
    ChevronRight,
    Loader2,
    Code,
    Hash,
  } from "@lucide/svelte"
  import {getTagValue} from "@welshman/util"
  import {pubkey, signer} from "@welshman/app"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {pushModal} from "@app/util/modal"
  import JobRequest from "@app/components/JobRequest.svelte"
  import type {LayoutProps} from "../../$types.js"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {getEventsForUrl} from "@app/core/state"
  import {makeFeed} from "@app/core/requests"

  let {data}: LayoutProps = $props()

  // Get repo data from context
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Get relays reactively
  // const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))
  const repoRelays = ["wss://relay.damus.io"]

  const {runId} = $page.params

  // Workflow event data from Nostr kind 5100
  interface WorkflowEvent {
    id: string
    kind: number
    content: string
    created_at: number
    pubkey: string
    tags: string[][]
    sig?: string
  }

  // Status event data from Nostr kind 30100
  interface StatusEvent {
    id: string
    workflowId: string
    status: string
    content: string
    created_at: number
    pubkey: string
  }

  // Cleanup functions for feeds
  let workflowFeedCleanup: (() => void) | undefined = undefined
  let statusFeedCleanup: (() => void) | undefined = undefined

  // Mock pipeline run data
  interface Job {
    id: string
    name: string
    status: "success" | "failure" | "in_progress" | "cancelled" | "pending" | "skipped"
    conclusion?: string
    startedAt: number
    completedAt?: number
    steps: Step[]
    logs: string[]
  }

  interface Step {
    id: string
    name: string
    status: "success" | "failure" | "in_progress" | "cancelled" | "pending" | "skipped"
    conclusion?: string
    startedAt: number
    completedAt?: number
    number: number
    logs: string[]
  }

  interface PipelineRun {
    id: string
    name: string
    status: "success" | "failure" | "in_progress" | "cancelled" | "pending" | "skipped"
    conclusion?: string
    branch: string
    commit: string
    commitMessage: string
    actor: string
    event: string
    createdAt: number
    updatedAt: number
    duration?: number
    runNumber: number
    jobs: Job[]
  }

  // Mock act runner output data based on pipeline type
  // Mock pipeline run data interface kept for type reference only
  interface PipelineRun {
    id: string
    name: string
    status: "success" | "failure" | "in_progress" | "cancelled" | "pending" | "skipped"
    conclusion?: string
    branch: string
    commit: string
    commitMessage: string
    actor: string
    event: string
    createdAt: number
    updatedAt: number
    duration?: number
    runNumber: number
    jobs: Job[]
  }

  // State for fetching and displaying event data
  let workflowEvent = $state<WorkflowEvent | null>(null)
  let statusEvent = $state<StatusEvent | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)

  // Parse workflow event data
  const parseWorkflowEvent = (event: WorkflowEvent) => {
    const argsTag = event.tags.find(t => t[0] === "args")
    const args = argsTag ? argsTag.slice(1) : []
    const workerTag = event.tags.find(t => t[0] === "worker")
    const worker = workerTag ? workerTag[1] : "unknown"
    const cmdTag = event.tags.find(t => t[0] === "cmd")
    const cmd = cmdTag ? cmdTag[1] : "bash"
    const paymentTag = event.tags.find(t => t[0] === "payment")
    const payment = paymentTag ? paymentTag[1] : ""
    const aTag = event.tags.find(t => t[0] === "a")
    const repoNaddr = aTag ? aTag[1] : ""

    // Extract workflow name from args
    let workflowName = "Unknown Workflow"
    const workflowPathIndex = args.indexOf("-W") !== -1 ? args.indexOf("-W") + 1 : -1
    if (workflowPathIndex >= 0 && args[workflowPathIndex]) {
      const path = args[workflowPathIndex]
      workflowName =
        path
          .split("/")
          .pop()
          ?.replace(/\.(yml|yaml)$/, "") || "Unknown Workflow"
    }

    // Extract env vars from args
    const envVars: string[] = []
    const actIndex = args.indexOf("act")
    if (actIndex > 0) {
      for (let i = 0; i < actIndex; i++) {
        if (args[i].includes("=")) {
          envVars.push(args[i])
        }
      }
    }

    return {
      id: event.id,
      name: workflowName,
      status: statusEvent?.status || "pending",
      cmd,
      args,
      worker,
      payment,
      repoNaddr,
      envVars,
      content: event.content,
      createdAt: event.created_at * 1000,
      updatedAt: statusEvent ? statusEvent.created_at * 1000 : event.created_at * 1000,
      pubkey: event.pubkey,
      tags: event.tags,
      conclusion: statusEvent?.content,
    }
  }

  // Fetch workflow event on mount
  onMount(() => {
    if (repoRelays.length === 0) {
      error = "No relays available"
      loading = false
      return
    }

    console.log("Fetching workflow event:", runId)
    console.log("Relays:", repoRelays)
    console.log("Run ID from params:", runId)

    // Fetch workflow event using makeFeed
    const workflowFilter = {kinds: [5100], ids: [runId]}
    console.log("Workflow filter:", JSON.stringify(workflowFilter, null, 2))

    const workflowFeedResult = makeFeed({
      element: document.body,
      relays: repoRelays,
      feedFilters: [workflowFilter],
      subscriptionFilters: [workflowFilter],
      initialEvents: [],
      onEvent: event => {
        console.log("✅ Received workflow event:", event.id, event.kind)
        workflowEvent = event as WorkflowEvent
        loading = false
      },
      onExhausted: () => {
        console.log(`🎉 Workflow feed exhausted`)
        console.log("   Workflow event found:", !!workflowEvent)
        console.log("   Workflow event ID:", workflowEvent?.id)
        loading = false
        if (!workflowEvent) {
          error = `Workflow event ${runId} not found on any relay`
        }
      },
    })
    workflowFeedCleanup = workflowFeedResult.cleanup

    // Fetch status events using makeFeed
    console.log("=== Setting up status feed ===")
    const statusFilter = {kinds: [30100], "#e": [runId]}
    console.log("Status filter:", JSON.stringify(statusFilter, null, 2))
    console.log("Looking for workflow ID:", runId)

    const statusFeedResult = makeFeed({
      element: document.body,
      relays: repoRelays,
      feedFilters: [statusFilter],
      subscriptionFilters: [statusFilter],
      initialEvents: [],
      onEvent: event => {
        console.log("📊 Received status event:", event.id, event.kind)
        console.log("   Full event:", JSON.stringify(event, null, 2))

        // Find the status tag directly
        const statusTag = event.tags?.find((t: string[]) => t[0] === "status")
        const status = statusTag ? statusTag[1] : "unknown"
        console.log("   Status from tag:", status)

        statusEvent = {
          id: event.id,
          workflowId: runId,
          status,
          content: event.content,
          created_at: event.created_at,
          pubkey: event.pubkey,
        }
        console.log("   ✅ Status event updated:", statusEvent)
      },
      onExhausted: () => {
        console.log(`🎉 Status feed exhausted`)
        console.log("   Final status event:", statusEvent)
      },
    })
    statusFeedCleanup = statusFeedResult.cleanup
  })

  // Cleanup on unmount
  onDestroy(() => {
    if (workflowFeedCleanup) {
      workflowFeedCleanup()
    }
    if (statusFeedCleanup) {
      statusFeedCleanup()
    }
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return Check
      case "failure":
        return X
      case "in_progress":
        return Loader2
      case "cancelled":
        return Circle
      case "pending":
        return Clock
      case "skipped":
        return AlertCircle
      default:
        return Circle
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-500"
      case "failure":
        return "text-red-500"
      case "in_progress":
        return "text-yellow-500"
      case "cancelled":
        return "text-gray-500"
      case "pending":
        return "text-gray-400"
      case "skipped":
        return "text-gray-400"
      default:
        return "text-gray-500"
    }
  }

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-500/10 border-green-500/20"
      case "failure":
        return "bg-red-500/10 border-red-500/20"
      case "in_progress":
        return "bg-yellow-500/10 border-yellow-500/20"
      case "cancelled":
        return "bg-gray-500/10 border-gray-500/20"
      case "pending":
        return "bg-gray-400/10 border-gray-400/20"
      case "skipped":
        return "bg-gray-400/10 border-gray-400/20"
      default:
        return "bg-gray-500/10 border-gray-500/20"
    }
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "—"
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const onRerunPipeline = () => {
    // Open JobRequest modal with correct relay URL
    const relayUrl = $page.params.relay
    pushModal(JobRequest, {url: relayUrl})
  }

  const goBack = () => {
    goto(`/spaces/${encodeURIComponent($page.params.relay)}/git/${$page.params.id}/cicd`)
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
  {:else if error || !workflowEvent}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <AlertCircle class="mb-2 h-8 w-8" />
      <p class="text-sm">{error || "Workflow not found"}</p>
      <Button size="sm" variant="outline" onclick={goBack} class="mt-4">
        <ArrowLeft class="mr-2 h-4 w-4" />
        Back to Pipelines
      </Button>
    </div>
  {:else}
    {@const parsedWorkflow = parseWorkflowEvent(workflowEvent)}
    <!-- Header -->
    <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <Button size="sm" variant="outline" onclick={goBack} class="gap-2">
            <ArrowLeft class="h-4 w-4" />
            Back to Pipelines
          </Button>
          <div>
            <h2 class="flex items-center gap-2 text-xl font-semibold">
              {parsedWorkflow.name}
              <span
                class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(parsedWorkflow.status)} ${getStatusColor(parsedWorkflow.status)}`}>
                {#if parsedWorkflow.status === "in_progress"}
                  <Loader2 class="h-3 w-3 animate-spin" />
                {:else}
                  {@const StatusIcon = getStatusIcon(parsedWorkflow.status)}
                  <StatusIcon class="h-3 w-3" />
                {/if}
                {parsedWorkflow.status.replace("_", " ")}
              </span>
            </h2>
            <p class="text-sm text-muted-foreground">
              Submitted {formatTimeAgo(parsedWorkflow.createdAt)}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onclick={() => {
              navigator.clipboard.writeText(parsedWorkflow.id)
              toast.push({message: "Event ID copied", variant: "default"})
            }}
            class="gap-2">
            <Copy class="h-4 w-4" />
            Event ID
          </Button>
          <Button
            size="sm"
            variant="outline"
            onclick={onRerunPipeline}
            class="gap-2"
            disabled={loading}>
            {#if loading}
              <Loader2 class="h-4 w-4 animate-spin" />
            {:else}
              <RotateCw class="h-4 w-4" />
            {/if}
            Re-run jobs
          </Button>
        </div>
      </div>

      <!-- Workflow Event Information -->
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Workflow Details</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Event ID</p>
            <div class="flex items-center gap-2">
              <Hash class="h-3 w-3" />
              <span class="font-mono text-sm">{parsedWorkflow.id}</span>
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Kind</p>
            <div class="flex items-center gap-2">
              <Code class="h-3 w-3" />
              <span class="text-sm">5100</span>
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Submitted by</p>
            <div class="flex items-center gap-2">
              <GitCommit class="h-3 w-3" />
              <span class="font-mono text-sm">{parsedWorkflow.pubkey.slice(0, 16)}...</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Command Information -->
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Command Details</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Command</p>
            <code class="rounded bg-muted px-2 py-1 text-sm">{parsedWorkflow.cmd}</code>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Worker</p>
            <div class="flex items-center gap-2">
              <GitCommit class="h-3 w-3" />
              <span class="font-mono text-sm">{parsedWorkflow.worker.slice(0, 16)}...</span>
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Payment</p>
            <span class="text-sm">{parsedWorkflow.payment || "N/A"}</span>
          </div>
        </div>

        {#if parsedWorkflow.args.length > 0}
          <div class="mt-4">
            <p class="mb-2 text-xs text-muted-foreground">Arguments</p>
            <div class="flex flex-wrap gap-2">
              {#each parsedWorkflow.args as arg}
                <code class="rounded bg-muted px-2 py-1 text-xs">{arg}</code>
              {/each}
            </div>
          </div>
        {/if}

        {#if parsedWorkflow.envVars.length > 0}
          <div class="mt-4">
            <p class="mb-2 text-xs text-muted-foreground">Environment Variables</p>
            <div class="space-y-1">
              {#each parsedWorkflow.envVars as envVar}
                <code class="block rounded bg-muted px-2 py-1 text-xs">{envVar}</code>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Status Information -->
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Job Status</h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-sm">Current Status:</span>
            <span
              class={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${getStatusBgColor(parsedWorkflow.status)} ${getStatusColor(parsedWorkflow.status)}`}>
              {#if parsedWorkflow.status === "in_progress"}
                <Loader2 class="h-4 w-4 animate-spin" />
              {:else}
                {@const StatusIcon = getStatusIcon(parsedWorkflow.status)}
                <StatusIcon class="h-4 w-4" />
              {/if}
              {parsedWorkflow.status.replace("_", " ")}
            </span>
          </div>

          {#if parsedWorkflow.conclusion}
            <div>
              <p class="mb-2 text-xs text-muted-foreground">Status Message</p>
              <p class="rounded bg-muted p-3 text-sm">{parsedWorkflow.conclusion}</p>
            </div>
          {/if}

          {#if statusEvent}
            <div class="space-y-2">
              <p class="text-xs text-muted-foreground">Status Event Details</p>
              <div class="grid grid-cols-1 gap-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Status Event ID:</span>
                  <span class="font-mono">{statusEvent.id.slice(0, 16)}...</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Updated:</span>
                  <span>{formatTimeAgo(statusEvent.created_at * 1000)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Reported by:</span>
                  <span class="font-mono">{statusEvent.pubkey.slice(0, 16)}...</span>
                </div>
              </div>
            </div>
          {:else}
            <p class="text-sm text-muted-foreground">
              No status updates received yet. The job is pending or in progress.
            </p>
          {/if}
        </div>
      </div>

      <!-- Raw Event Data -->
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">Raw Event Data</h3>
        <div class="space-y-2">
          <div class="grid grid-cols-1 gap-2 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Content:</span>
              <span class="max-w-lg truncate text-right"
                >{parsedWorkflow.content || "(empty)"}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Tags Count:</span>
              <span>{parsedWorkflow.tags.length}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Repo Naddr:</span>
              <span class="max-w-lg truncate text-right font-mono"
                >{parsedWorkflow.repoNaddr || "N/A"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
