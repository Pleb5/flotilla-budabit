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
    Filter,
    ChevronRight,
  } from "@lucide/svelte"
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {isMobile} from "@lib/html"
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }
  
  // Get relays reactively
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])

  const {relay, id} = $page.params

  // Mock workflow runs data structure (replace with actual data fetching)
  interface WorkflowRun {
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
  }

  // Navigate to pipeline run details
  const navigateToRun = (run: WorkflowRun) => {
    const runId = `${run.name.toLowerCase().replace(/\s+/g, '-')}-run-${run.runNumber}`
    goto(`/spaces/${encodeURIComponent(relay)}/git/${id}/cicd/${runId}`)
  }

  let workflowRuns = $state<WorkflowRun[]>([
    {
      id: "1",
      name: "CI",
      status: "success",
      branch: "main",
      commit: "abc123",
      commitMessage: "Fix: Update dependencies",
      actor: $pubkey || "",
      event: "push",
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3000000,
      duration: 600,
      runNumber: 42,
    },
    {
      id: "2",
      name: "Build and Test",
      status: "failure",
      branch: "develop",
      commit: "def456",
      commitMessage: "Feature: Add new component",
      actor: $pubkey || "",
      event: "pull_request",
      createdAt: Date.now() - 7200000,
      updatedAt: Date.now() - 6600000,
      duration: 600,
      runNumber: 41,
    },
    {
      id: "3",
      name: "Deploy",
      status: "in_progress",
      branch: "main",
      commit: "ghi789",
      commitMessage: "Deploy: Production release",
      actor: $pubkey || "",
      event: "workflow_dispatch",
      createdAt: Date.now() - 300000,
      updatedAt: Date.now() - 60000,
      runNumber: 40,
    },
  ])

  // Filter and sort options
  let statusFilter = $state<string>("all") // all, success, failure, in_progress, cancelled
  let branchFilter = $state<string>("") // empty string means all branches
  let actorFilter = $state<string>("") // empty string means all actors
  let eventFilter = $state<string>("all") // all, push, pull_request, workflow_dispatch
  let showFilters = $state(false)
  let searchTerm = $state("")
  let loading = $state(false)

  const uniqueBranches = $derived.by(() => {
    const branches = new Set<string>()
    workflowRuns.forEach(run => {
      if (run.branch) branches.add(run.branch)
    })
    return Array.from(branches)
  })

  const uniqueActors = $derived.by(() => {
    const actors = new Set<string>()
    workflowRuns.forEach(run => {
      if (run.actor) actors.add(run.actor)
    })
    return Array.from(actors)
  })

  const filteredRuns = $derived.by(() => {
    return workflowRuns
      .filter(run => {
        // Search filter
        if (searchTerm) {
          const searchLower = searchTerm.toLowerCase()
          const matchesSearch =
            run.name.toLowerCase().includes(searchLower) ||
            run.commitMessage.toLowerCase().includes(searchLower) ||
            run.branch.toLowerCase().includes(searchLower) ||
            run.commit.toLowerCase().includes(searchLower)
          if (!matchesSearch) return false
        }

        // Status filter
        if (statusFilter !== "all" && run.status !== statusFilter) return false

        // Branch filter
        if (branchFilter && run.branch !== branchFilter) return false

        // Actor filter
        if (actorFilter && run.actor !== actorFilter) return false

        // Event filter
        if (eventFilter !== "all" && run.event !== eventFilter) return false

        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return Check
      case "failure":
        return X
      case "in_progress":
        return RotateCw
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

  const resetFilters = () => {
    statusFilter = "all"
    branchFilter = ""
    actorFilter = ""
    eventFilter = "all"
    searchTerm = ""
  }

  const onRunWorkflow = () => {
    toast.push({
      message: "Workflow run triggered",
      variant: "default",
    })
  }

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass ? `cicdFilters:${repoClass.key}` : ""
    } catch (e) {
      storageKey = ""
    }
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
        if (typeof data.branchFilter === "string") branchFilter = data.branchFilter
        if (typeof data.actorFilter === "string") actorFilter = data.actorFilter
        if (typeof data.eventFilter === "string") eventFilter = data.eventFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
      }
    } catch (e) {
      // ignore
    }
  })

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        branchFilter,
        actorFilter,
        eventFilter,
        showFilters,
        searchTerm,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  // Persist on changes
  $effect(() => {
    statusFilter
    branchFilter
    actorFilter
    eventFilter
    showFilters
    searchTerm
    persist()
  })
</script>

<svelte:head>
  <title>{repoClass.name} - CI/CD</title>
</svelte:head>

<div class="space-y-4">
  <!-- Header -->
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Actions</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">
          Automate, customize, and execute your software development workflows
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button class="gap-2" variant="git" size="sm" onclick={onRunWorkflow}>
          <Play class="h-4 w-4" />
          <span>Run workflow</span>
        </Button>
      </div>
    </div>

    <!-- Search and Filter Bar -->
    <div class="flex items-center gap-2">
      <div class="row-2 input grow overflow-x-hidden">
        <Icon icon={Magnifer} />
        <input
          class="w-full"
          bind:value={searchTerm}
          type="text"
          placeholder="Search workflow runs..." />
      </div>
      <Button size="sm" class="gap-2" onclick={() => (showFilters = !showFilters)}>
        <Filter class="h-4 w-4" />
        {showFilters ? "Hide" : "Filter"}
      </Button>
    </div>
  </div>

  <!-- Filters Panel -->
  {#if showFilters}
    <div
      in:slideAndFade={{duration: 200}}
      class="rounded-lg border border-border bg-card p-4 space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <!-- Status Filter -->
        <div class="space-y-2">
          <label for="status-filter" class="text-sm font-medium">Status</label>
          <select
            id="status-filter"
            bind:value={statusFilter}
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="in_progress">In Progress</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <!-- Branch Filter -->
        <div class="space-y-2">
          <label for="branch-filter" class="text-sm font-medium">Branch</label>
          <select
            id="branch-filter"
            bind:value={branchFilter}
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">All branches</option>
            {#each uniqueBranches as branch}
              <option value={branch}>{branch}</option>
            {/each}
          </select>
        </div>

        <!-- Event Filter -->
        <div class="space-y-2">
          <label for="event-filter" class="text-sm font-medium">Event</label>
          <select
            id="event-filter"
            bind:value={eventFilter}
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="all">All events</option>
            <option value="push">Push</option>
            <option value="pull_request">Pull Request</option>
            <option value="workflow_dispatch">Manual</option>
          </select>
        </div>

        <!-- Actor Filter -->
        <div class="space-y-2">
          <label for="actor-filter" class="text-sm font-medium">Actor</label>
          <select
            id="actor-filter"
            bind:value={actorFilter}
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">All actors</option>
            {#each uniqueActors as actor}
              <option value={actor}>{actor.slice(0, 8)}...</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex justify-end">
        <Button size="sm" variant="outline" onclick={resetFilters}>Reset filters</Button>
      </div>
    </div>
  {/if}

  <!-- Workflow Runs List -->
  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading workflow runs...
        {:else}
          End of workflow runs
        {/if}
      </Spinner>
    </div>
  {:else if filteredRuns.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      <p class="text-sm">No workflow runs found</p>
      {#if searchTerm || statusFilter !== "all" || branchFilter || actorFilter || eventFilter !== "all"}
        <Button size="sm" variant="link" onclick={resetFilters} class="mt-2">
          Clear filters
        </Button>
      {/if}
    </div>
  {:else}
    <div class="space-y-2">
      {#each filteredRuns as run (run.id)}
        {@const StatusIcon = getStatusIcon(run.status)}
        <div
          in:slideAndFade={{duration: 200}}
          class="group rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors">
          <button
            class="w-full p-4 text-left"
            onclick={() => navigateToRun(run)}>
            <div class="flex items-start gap-4">
              <!-- Status Icon -->
              <div class={`mt-1 flex-shrink-0 ${getStatusColor(run.status)}`}>
                {#if run.status === "in_progress"}
                  <RotateCw class="h-5 w-5 animate-spin" />
                {:else}
                  {@const StatusIcon = getStatusIcon(run.status)}
                  <StatusIcon class="h-5 w-5" />
                {/if}
              </div>

              <!-- Main Content -->
              <div class="flex-1 min-w-0 space-y-2">
                <!-- Workflow Name and Status -->
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-semibold text-base">{run.name}</h3>
                  <span
                    class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(run.status)} ${getStatusColor(run.status)}`}>
                    {run.status.replace("_", " ")}
                  </span>
                  <span class="text-xs text-muted-foreground">#{run.runNumber}</span>
                </div>

                <!-- Commit Message -->
                <p class="text-sm text-muted-foreground truncate">{run.commitMessage}</p>

                <!-- Metadata -->
                <div class="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <div class="flex items-center gap-1">
                    <GitCommit class="h-3 w-3" />
                    <span class="font-mono">{run.commit.slice(0, 7)}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span>on</span>
                    <span class="font-medium">{run.branch}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span>•</span>
                    <span>{run.event.replace("_", " ")}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <Clock class="h-3 w-3" />
                    <span>{formatTimeAgo(run.createdAt)}</span>
                  </div>
                  {#if run.duration}
                    <div class="flex items-center gap-1">
                      <span>•</span>
                      <span>{formatDuration(run.duration)}</span>
                    </div>
                  {/if}
                </div>
              </div>

              <!-- Chevron -->
              <div class="flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
                <ChevronRight class="h-5 w-5" />
              </div>
            </div>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Summary Stats -->
  {#if filteredRuns.length > 0}
    <div class="mt-6 rounded-lg border border-border bg-card p-4">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Total Runs</p>
          <p class="text-2xl font-bold">{filteredRuns.length}</p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Success Rate</p>
          <p class="text-2xl font-bold text-green-500">
            {Math.round(
              (filteredRuns.filter(r => r.status === "success").length / filteredRuns.length) * 100,
            )}%
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Failed</p>
          <p class="text-2xl font-bold text-red-500">
            {filteredRuns.filter(r => r.status === "failure").length}
          </p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">In Progress</p>
          <p class="text-2xl font-bold text-yellow-500">
            {filteredRuns.filter(r => r.status === "in_progress").length}
          </p>
        </div>
      </div>
    </div>
  {/if}
</div>
