<script lang="ts">
  import {Button, toast} from "@nostr-git/ui"
  import {
    CalendarDays,
    Check,
    Clock,
    Eye,
    GitBranch,
    GitCommit,
    Play,
    SearchX,
    X,
    AlertCircle,
    Circle,
    RotateCw,
    Filter,
    ChevronRight,
    ChevronDown,
  } from "@lucide/svelte"
  import {getTagValue} from "@welshman/util"
  import {nip19} from "nostr-tools"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import {CICD_RELAYS} from "@lib/budabit/constants"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import type {LayoutProps} from "../$types.js"
  import {makeFeed} from "@app/core/requests"
  import {load} from "@welshman/net"

  let {data}: LayoutProps = $props()

  // Get repoClass and repoRelays from context
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Workflow dropdown state
  let showWorkflowDropdown = $state(false)

  // Keyboard handler for Escape key
  $effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showWorkflowDropdown) {
        showWorkflowDropdown = false
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  // Fetch actual GitHub workflows from repo
  let githubWorkflows = $state<{name: string; path: string}[]>([])
  let loadingWorkflows = $state(true)

  async function fetchWorkflows() {
    try {
      loadingWorkflows = true

      const filesResult = await repoClass.listRepoFiles({path: ".github/workflows"})

      // FileListingResult has a files property
      const filesList = filesResult?.files || []

      // Filter for YAML files (only files, not directories)
      const workflowFiles = filesList.filter(
        f => f.type === "file" && f.path && (f.path.endsWith(".yml") || f.path.endsWith(".yaml")),
      )

      // Parse workflow files to get their names
      const workflows = await Promise.all(
        workflowFiles.map(async file => {
          try {
            if (!file.path) return null

            const contentResult = await repoClass.getFileContent({path: file.path})
            const content = contentResult?.content || ""

            // Extract filename from path for fallback
            const fileName = file.path.split("/").pop() || ""

            // Parse YAML to extract workflow name (simplified - just use filename if no name found)
            const nameMatch = content.match(/^name:\s*['"]?(.+?)['"]?$/m)
            const workflowName = nameMatch
              ? nameMatch[1].trim()
              : fileName.replace(/\.(yml|yaml)$/, "").replace(/[-_]/g, " ")

            return {
              name: workflowName,
              path: file.path,
            }
          } catch (e) {
            console.error(`Failed to parse workflow file ${file.path}:`, e)
            return null
          }
        }),
      )

      githubWorkflows = workflows.filter((w): w is {name: string; path: string} => w !== null)
    } catch (e) {
      console.error("Failed to fetch workflows:", e)
      githubWorkflows = []
    } finally {
      loadingWorkflows = false
    }
  }

  // Fetch workflows when component mounts
  $effect(() => {
    if (repoClass) {
      fetchWorkflows()
    }
  })

  // Click outside handler for dropdown
  let dropdownContainer: HTMLDivElement | undefined
  $effect(() => {
    if (!dropdownContainer || !showWorkflowDropdown) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownContainer && !dropdownContainer.contains(e.target as Node)) {
        showWorkflowDropdown = false
      }
    }

    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  })
  // Get relays reactively
  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))

  const {relay, id} = $page.params

  // Decode naddr bech32 → kind:pubkey:d-tag coordinate for Nostr #a tag filtering
  const repoNaddr = $derived.by(() => {
    if (!id) return id
    try {
      const decoded = nip19.decode(id)
      if (decoded.type === "naddr") {
        const {kind, pubkey: pk, identifier} = decoded.data
        return `${kind}:${pk}:${identifier}`
      }
    } catch {
      // pass
    }
    return id
  })

  interface WorkflowRun {
    id: string
    name: string
    status: "success" | "failure" | "failed" | "in_progress" | "cancelled" | "pending" | "skipped"
    branch: string
    commit: string
    commitMessage: string
    actor: string
    event: string
    createdAt: number
    updatedAt: number
    duration?: number
    _originalEvent?: any
  }

  // Parse Kind 5401 workflow run event into WorkflowRun format
  const parseWorkflowRunEvent = (event: any): WorkflowRun => {
    const tags: string[][] = event.tags || []
    const tagVal = (name: string) => tags.find(t => t[0] === name)?.[1]

    const workflowPath = tagVal("workflow") || ""
    const workflowName = workflowPath
      ? workflowPath.split("/").pop()?.replace(/\.(yml|yaml)$/, "") || "Workflow"
      : "Workflow"

    const branch = tagVal("branch") || "main"
    const trigger = tagVal("trigger") || "manual"
    const triggeredBy = tagVal("triggered-by") || event.pubkey

    return {
      id: event.id,
      name: workflowName,
      status: "pending" as WorkflowRun["status"],
      branch,
      commit: event.id.substring(0, 7),
      commitMessage: `Workflow run: ${workflowName}`,
      actor: triggeredBy,
      event: trigger,
      createdAt: event.created_at * 1000,
      updatedAt: event.created_at * 1000,
      duration: undefined,
      _originalEvent: event,
    }
  }

  // Navigate to pipeline run details
  const navigateToRun = (run: WorkflowRun) => {
    goto(`/spaces/${encodeURIComponent(relay!)}/git/${id}/cicd/${run.id}`)
  }

  let loadingStatus = $state(false)
  let element: HTMLElement | undefined = $state()
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)

  // Filter for workflow run events (Kind 5401)
  const runFilter = $derived.by(() => {
    if (!repoNaddr) return null
    return {
      kinds: [5401],
      "#a": [repoNaddr],
    }
  })

  // Initialize feed asynchronously - don't block render
  onMount(() => {
    if (!feedInitialized && runFilter) {
      const timeout = setTimeout(() => {
        const tryStart = () => {
          if (element && !feedInitialized && runFilter) {
            feedInitialized = true
            const jobRelays = CICD_RELAYS

            const feed = makeFeed({
              element,
              relays: jobRelays,
              feedFilters: [runFilter],
              subscriptionFilters: [runFilter],
              initialEvents: [],
            })

            feed.events.subscribe((events: any[]) => {
              if (events.length === 0) return
              const seen = new Set(runEvents.map((e: any) => e.id))
              const newEvents = events.filter((e: any) => !seen.has(e.id))
              if (newEvents.length > 0) {
                runEvents = [...runEvents, ...newEvents].sort((a: any, b: any) => b.created_at - a.created_at)
              }
            })

            load({
              relays: jobRelays,
              filters: [runFilter],
            }).then(loaded => {
              if (loaded.length > 0) {
                const seen = new Set(runEvents.map((e: any) => e.id))
                const newRuns = loaded.filter((e: any) => !seen.has(e.id))
                if (newRuns.length > 0) {
                  runEvents = [...runEvents, ...newRuns].sort((a: any, b: any) => b.created_at - a.created_at)
                }
              }
            })

            feedCleanup = feed.cleanup
          } else if (!element) {
            requestAnimationFrame(tryStart)
          }
        }
        tryStart()
      }, 100)

      return () => {
        clearTimeout(timeout)
      }
    }
  })

  // Fetch status/result events for workflow runs (Kind 5401)
  let fetchedStatusForRunIds = new Set<string>()

  $effect(() => {
    const ids = runEvents.map((e: any) => e.id).filter((id: string) => !fetchedStatusForRunIds.has(id))
    if (ids.length === 0) return

    ids.forEach((id: string) => fetchedStatusForRunIds.add(id))

    const jobRelays = ["wss://relay.sharegap.net", "wss://nos.lol", "wss://relay.primal.net"]

    // Fetch Kind 5402 (workflow log), Kind 5100 (loom job via #e), Kind 30100 (status), Kind 5101 (result)
    Promise.all([
      load({relays: jobRelays, filters: [{kinds: [5402], "#e": ids}]}),
      load({relays: jobRelays, filters: [{kinds: [5100], "#e": ids}]}),
      load({relays: jobRelays, filters: [{kinds: [30100], "#e": ids}]}),
      load({relays: jobRelays, filters: [{kinds: [5101], "#e": ids}]}),
    ]).then(([loadedLogs, loadedJobs, loadedStatus, loadedResults]) => {
      if (loadedLogs.length > 0) {
        const seen = new Set(workflowLogEvents.map((e: any) => e.id))
        const newEvents = loadedLogs.filter((e: any) => !seen.has(e.id))
        if (newEvents.length > 0) {
          workflowLogEvents = [...workflowLogEvents, ...newEvents]
        }
      }
      // For loom jobs referencing runs, also fetch their status/results by job ID
      if (loadedJobs.length > 0) {
        const loomJobIds = loadedJobs.map((e: any) => e.id)
        // Map loom job IDs back to run IDs
        for (const job of loadedJobs) {
          const eTag = job.tags.find((t: string[]) => t[0] === "e")
          if (eTag) loomJobToRunId.set(job.id, eTag[1])
        }
        Promise.all([
          load({relays: jobRelays, filters: [{kinds: [30100], "#e": loomJobIds}]}),
          load({relays: jobRelays, filters: [{kinds: [5101], "#e": loomJobIds}]}),
        ]).then(([jobStatusEvts, jobResultEvts]) => {
          if (jobStatusEvts.length > 0) {
            const seen = new Set(statusEvents.map((e: any) => e.id))
            const newEvents = jobStatusEvts.filter((e: any) => !seen.has(e.id))
            if (newEvents.length > 0) statusEvents = [...statusEvents, ...newEvents]
          }
          if (jobResultEvts.length > 0) {
            const seen = new Set(jobResultEvents.map((e: any) => e.id))
            const newEvents = jobResultEvts.filter((e: any) => !seen.has(e.id))
            if (newEvents.length > 0) jobResultEvents = [...jobResultEvents, ...newEvents]
          }
        })
      }
      if (loadedStatus.length > 0) {
        const seen = new Set(statusEvents.map((e: any) => e.id))
        const newEvents = loadedStatus.filter((e: any) => !seen.has(e.id))
        if (newEvents.length > 0) statusEvents = [...statusEvents, ...newEvents]
      }
      if (loadedResults.length > 0) {
        const seen = new Set(jobResultEvents.map((e: any) => e.id))
        const newEvents = loadedResults.filter((e: any) => !seen.has(e.id))
        if (newEvents.length > 0) jobResultEvents = [...jobResultEvents, ...newEvents]
      }
    })
  })

  // Cleanup on destroy
  onDestroy(() => {
    feedCleanup?.()
  })

  let runEvents = $state<any[]>([])  // Kind 5401 workflow run events
  let workflowLogEvents = $state<any[]>([])  // Kind 5402 workflow log events
  let statusEvents = $state<any[]>([])  // Kind 30100 status events
  let jobResultEvents = $state<any[]>([])  // Kind 5101 job result events
  let loomJobToRunId = new Map<string, string>()  // Maps loom job ID → workflow run ID

  const allWorkflowRuns = $derived.by(() => {
    return runEvents.map(parseWorkflowRunEvent).sort((a, b) => b.createdAt - a.createdAt)
  })

  // Resolve status for each run using priority: Kind 5402 > Kind 5101 > Kind 30100 > pending
  const workflowRunsWithStatus = $derived.by(() => {
    return allWorkflowRuns.map(run => {
      const runId = run._originalEvent?.id
      if (!runId) return run

      // Find loom result (Kind 5101) referencing this run or its loom job
      const matchingResult = jobResultEvents.find(e => {
        const eTag = e.tags.find((t: string[]) => t[0] === "e")
        if (!eTag) return false
        return eTag[1] === runId || loomJobToRunId.get(eTag[1]) === runId
      })
      const loomSuccess = matchingResult?.tags.find((t: string[]) => t[0] === "success")
      const loomExitCode = matchingResult?.tags.find((t: string[]) => t[0] === "exit_code")
      const loomIsSuccess = loomSuccess?.[1] === "true" || loomExitCode?.[1] === "0"

      // Priority 1: Kind 5402 (workflow log)
      const matchingLog = workflowLogEvents.find(e => {
        const eTag = e.tags.find((t: string[]) => t[0] === "e")
        return eTag && eTag[1] === runId
      })

      if (matchingLog) {
        const statusTag = matchingLog.tags.find((t: string[]) => t[0] === "status")
        const durationTag = matchingLog.tags.find((t: string[]) => t[0] === "duration")
        const s = statusTag?.[1] || "unknown"
        if (s === "failed" || s === "failure") {
          return {...run, status: "failure" as WorkflowRun["status"], duration: durationTag?.[1] ? parseInt(durationTag[1]) : undefined}
        }
        // Even if 5402 says success, if loom result says failure → failure
        if (matchingResult && !loomIsSuccess) {
          return {...run, status: "failure" as WorkflowRun["status"], duration: durationTag?.[1] ? parseInt(durationTag[1]) : undefined}
        }
        if (s === "success") {
          return {...run, status: "success" as WorkflowRun["status"], duration: durationTag?.[1] ? parseInt(durationTag[1]) : undefined}
        }
        return {...run, status: s as WorkflowRun["status"], duration: durationTag?.[1] ? parseInt(durationTag[1]) : undefined}
      }

      // Priority 2: Kind 5101 (loom result)
      if (matchingResult) {
        return {
          ...run,
          status: (loomIsSuccess ? "success" : "failure") as WorkflowRun["status"],
        }
      }

      // Priority 3: Kind 30100 (loom status)
      const matchingStatusEvents = statusEvents.filter(e => {
        const eTag = e.tags.find((t: string[]) => t[0] === "e")
        if (!eTag) return false
        return eTag[1] === runId || loomJobToRunId.get(eTag[1]) === runId
      })

      if (matchingStatusEvents.length > 0) {
        matchingStatusEvents.sort((a: any, b: any) => b.created_at - a.created_at)
        const statusTag = matchingStatusEvents[0].tags.find((t: string[]) => t[0] === "status")
        const s = statusTag?.[1] || "pending"
        return {
          ...run,
          status: (s === "failed" ? "failure" : s) as WorkflowRun["status"],
        }
      }

      return run
    })
  })

  // Filter and sort options
  let statusFilter = $state<string>("all") // all, success, failure, in_progress, cancelled
  let branchFilter = $state<string>("") // empty string means all branches
  let actorFilter = $state<string>("") // empty string means all actors
  let eventFilter = $state<string>("all") // all, push, pull_request, workflow_dispatch
  let showFilters = $state(false)
  let searchTerm = $state("")

  const uniqueBranches = $derived.by(() => {
    const branches = new Set<string>()
    workflowRunsWithStatus.forEach(run => {
      if (run.branch) branches.add(run.branch)
    })
    return Array.from(branches)
  })

  const uniqueActors = $derived.by(() => {
    const actors = new Set<string>()
    workflowRunsWithStatus.forEach(run => {
      if (run.actor) actors.add(run.actor)
    })
    return Array.from(actors)
  })

  const filteredRuns = $derived.by(() => {
    const result = workflowRunsWithStatus
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

    return result
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return Check
      case "failure":
      case "failed":
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
      case "failed":
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
    showWorkflowDropdown = !showWorkflowDropdown
  }

  const onSelectWorkflow = (workflow: {name: string; path: string}) => {
    showWorkflowDropdown = false
    const params = new URLSearchParams({workflow: workflow.name, path: workflow.path})
    goto(`/spaces/${relay}/git/${id}/cicd/new?${params}`)
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

<div class="space-y-4" bind:this={element}>
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
        <div bind:this={dropdownContainer} class="relative">
          <Button
            class="z-10 relative gap-2"
            variant="git"
            size="sm"
            onclick={onRunWorkflow}
            disabled={loadingWorkflows}>
            {#if loadingWorkflows}
              <RotateCw class="h-4 w-4 animate-spin" />
            {:else}
              <Play class="h-4 w-4" />
            {/if}
            <span>{loadingWorkflows ? "Loading..." : "Run workflow"}</span>
            <ChevronDown class="h-4 w-4" />
          </Button>
          {#if showWorkflowDropdown}
            <div
              class="z-20 absolute right-0 top-full mt-2 min-w-[200px] rounded-lg border border-border bg-card shadow-lg">
              {#if loadingWorkflows}
                <div class="flex items-center justify-center p-4">
                  <RotateCw class="h-4 w-4 animate-spin" />
                </div>
              {:else if githubWorkflows.length === 0}
                <div class="p-3 text-sm text-muted-foreground">No workflows found</div>
              {:else}
                <div class="p-1">
                  {#each githubWorkflows as workflow (workflow.path)}
                    <button
                      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                      onclick={() => onSelectWorkflow(workflow)}>
                      <Play class="h-4 w-4" />
                      <span>{workflow.name}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
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
      class="space-y-4 rounded-lg border border-border bg-card p-4">
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
  {#if filteredRuns.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      <p class="text-sm">No workflow runs found</p>
      {#if searchTerm || statusFilter !== "all" || branchFilter || actorFilter || eventFilter !== "all"}
        <Button size="sm" variant="link" onclick={resetFilters} class="mt-2">Clear filters</Button>
      {/if}
    </div>
  {:else}
    <div class="space-y-2">
      {#each filteredRuns as run (run.id)}
        {@const StatusIcon = getStatusIcon(run.status)}
        <div
          in:slideAndFade={{duration: 200}}
          class="group rounded-lg border border-border bg-card transition-colors hover:bg-accent/50">
          <button class="w-full p-4 text-left" onclick={() => navigateToRun(run)}>
            <div class="flex items-start gap-4">
              <!-- Status Icon -->
              <div class={`mt-1 flex-shrink-0 ${getStatusColor(run.status)}`}>
                {#if run.status === "in_progress"}
                  <RotateCw class="h-5 w-5 animate-spin" />
                {:else}
                  <StatusIcon class="h-5 w-5" />
                {/if}
              </div>

              <!-- Main Content -->
              <div class="min-w-0 flex-1 space-y-2">
                <!-- Workflow Name and Status -->
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-base font-semibold">{run.name}</h3>
                  <span
                    class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(run.status)} ${getStatusColor(run.status)}`}>
                    {run.status.replace("_", " ")}
                  </span>
                </div>

                <!-- Commit Message -->
                <p class="truncate text-sm text-muted-foreground">{run.commitMessage}</p>

                <!-- Metadata -->
                <div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <div class="flex items-center gap-1">
                    <GitCommit class="h-3 w-3" />
                    <span class="font-mono">{run.commit.slice(0, 7)}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <GitBranch class="h-3 w-3" />
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
              <div
                class="flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
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
