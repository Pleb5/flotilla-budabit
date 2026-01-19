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
    ChevronDown,
    Plus,
  } from "@lucide/svelte"
  import {getTagValue} from "@welshman/util"
  import {pubkey, signer} from "@welshman/app"
  import {SimplePool} from "nostr-tools"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy} from "svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import type {LayoutProps} from "../$types.js"
  import {makeFeed} from "@app/core/requests"

  let {data}: LayoutProps = $props()

  // Get repoClass and repoRelays from context
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Workflow dropdown and modal state
  let showWorkflowDropdown = $state(false)
  let showWorkflowModal = $state(false)
  let selectedWorkflow = $state<{name: string; path: string} | null>(null)
  let selectedBranch = $state("master")
  let envVars = $state<{key: string; value: string}[]>([{key: "", value: ""}])
  let maxDuration = $state(600)
  let cashuToken = $state("cashuTEST")
  let worker = $state("fa84c22dc47c67d9307b6966c992725f70dfcd8a0e5530fd7e3568121f6e1673")

  // Keyboard handler for Escape key
  $effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showWorkflowModal) {
          showWorkflowModal = false
        } else if (showWorkflowDropdown) {
          showWorkflowDropdown = false
        }
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
      console.log("Raw filesResult:", filesResult)

      // FileListingResult has a files property
      const filesList = filesResult?.files || []
      console.log("Parsed filesList:", filesList)

      // Filter for YAML files (only files, not directories)
      const workflowFiles = filesList.filter(
        f => f.type === "file" && f.path && (f.path.endsWith(".yml") || f.path.endsWith(".yaml")),
      )
      console.log("Filtered workflowFiles:", workflowFiles)

      // Parse workflow files to get their names
      const workflows = await Promise.all(
        workflowFiles.map(async file => {
          try {
            if (!file.path) return null

            console.log("Fetching content for:", file.path)
            const contentResult = await repoClass.getFileContent({path: file.path})
            const content = contentResult?.content || ""
            console.log("Extracted content for", file.path, ":", content.substring(0, 100))

            // Extract filename from path for fallback
            const fileName = file.path.split("/").pop() || ""

            // Parse YAML to extract workflow name (simplified - just use filename if no name found)
            const nameMatch = content.match(/^name:\s*['"]?(.+?)['"]?$/m)
            const workflowName = nameMatch
              ? nameMatch[1].trim()
              : fileName.replace(/\.(yml|yaml)$/, "").replace(/[-_]/g, " ")

            console.log("Parsed workflow name:", workflowName, "from file:", fileName)

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
      console.log("Final githubWorkflows:", githubWorkflows)
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

  // Get the naddr for filtering
  const repoNaddr = $derived(id)

  // Mock workflow runs data structure
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

  // Parse job event into WorkflowRun format
  const parseJobEvent = (event: any): WorkflowRun => {
    const argsTag = event.tags.find((t: string[]) => t[0] === "args")
    const args = argsTag ? argsTag.slice(1) : []

    const workerTag = event.tags.find((t: string[]) => t[0] === "worker")
    const worker = workerTag ? workerTag[1] : "unknown"

    const cmdTag = event.tags.find((t: string[]) => t[0] === "cmd")
    const cmd = cmdTag ? cmdTag[1] : "bash"

    const paymentTag = event.tags.find((t: string[]) => t[0] === "payment")
    const payment = paymentTag ? paymentTag[1] : ""

    const aTag = event.tags.find((t: string[]) => t[0] === "a")
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

    // For listing page, we use default values since we don't have status events
    return {
      id: event.id,
      name: workflowName,
      status: "pending" as WorkflowRun["status"],
      branch: "main",
      commit: event.id.substring(0, 7),
      commitMessage: `Workflow run: ${workflowName}`,
      actor: worker,
      event: "workflow_dispatch",
      createdAt: event.created_at * 1000,
      updatedAt: event.created_at * 1000,
      duration: undefined,
      runNumber: 0,
      _originalEvent: event, // Store original event for direct comparison
    }
  }

  // Navigate to pipeline run details
  const navigateToRun = (run: WorkflowRun) => {
    goto(`/spaces/${encodeURIComponent(relay)}/git/${id}/cicd/${run.id}`)
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
      createdAt: Date.now() - 1209600000 - 300000,
      updatedAt: Date.now() - 1209600000 - 300000 + 600000,
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
      createdAt: Date.now() - 1209600000 - 3600000,
      updatedAt: Date.now() - 1209600000 - 3600000 + 600000,
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
      createdAt: Date.now() - 1209600000 - 7200000,
      updatedAt: Date.now() - 1209600000 - 7200000 + 600000,
      duration: 600,
      runNumber: 40,
    },
    {
      id: "4",
      name: "Lint and Format",
      status: "success",
      branch: "feature/new-ui",
      commit: "jkl012",
      commitMessage: "Refactor: Update UI components",
      actor: $pubkey || "",
      event: "push",
      createdAt: Date.now() - 1209600000 - 14400000,
      updatedAt: Date.now() - 1209600000 - 14400000 + 600000,
      duration: 600,
      runNumber: 39,
    },
  ])

  // Set loading to false immediately if we have data - don't wait for makeFeed
  let loadingJobs = $state(false)
  let loadingStatus = $state(false)
  let element: HTMLElement | undefined = $state()
  let feedInitialized = $state(false)
  let statusFeedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  let statusFeedCleanup: (() => void) | undefined = $state(undefined)

  // Create filter for job events (kind 5100) from Damus relay
  const jobFilter = $derived.by(() => {
    const filter = {
      kinds: [5100],
      "#a": [repoNaddr],
    }
    console.log("jobFilter derived:", JSON.stringify(filter, null, 2))
    console.log("repoNaddr:", repoNaddr)
    return filter
  })

  // Initialize feed asynchronously - don't block render
  onMount(() => {
    console.log("=== CICD onMount called ===")
    console.log("feedInitialized:", feedInitialized)
    console.log("jobFilter:", JSON.stringify(jobFilter, null, 2))

    if (!feedInitialized) {
      // Defer makeFeed to avoid blocking initial render
      const timeout = setTimeout(() => {
        console.log("=== Starting makeFeed initialization ===")
        const tryStart = () => {
          console.log("tryStart - element:", !!element, "feedInitialized:", feedInitialized)
          if (element && !feedInitialized) {
            console.log("=== Creating makeFeed ===")
            feedInitialized = true
            const damusRelay = "wss://relay.damus.io"
            console.log("Using relay:", damusRelay)
            console.log("Filter:", JSON.stringify(jobFilter, null, 2))

            const feed = makeFeed({
              element,
              relays: [damusRelay],
              feedFilters: [jobFilter],
              subscriptionFilters: [jobFilter],
              initialEvents: [],
              onEvent: event => {
                console.log("=== onEvent called ===")
                console.log("Event:", event)
                // Add new job events
                const existingIndex = jobEvents.findIndex(e => e.id === event.id)
                if (existingIndex >= 0) {
                  // Update existing event
                  console.log("Updating existing event:", event.id)
                  jobEvents[existingIndex] = event
                } else {
                  // Add new event
                  console.log("Adding new event:", event.id)
                  jobEvents = [...jobEvents, event]
                }
                console.log("jobEvents count:", jobEvents.length)
              },
              onExhausted: () => {
                console.log("=== Feed exhausted ===")
                console.log("Job events received:", jobEvents.length)

                // After job events are loaded, query for status events (kind 30100)
                if (!statusFeedInitialized && jobEvents.length > 0) {
                  console.log("=== Setting up status feed ===")
                  statusFeedInitialized = true
                  loadingStatus = true

                  // Query for status events that reference our workflow runs via "e" tag
                  const statusFilter = {
                    kinds: [30100],
                    "#e": jobEvents.map(e => e.id),
                  }

                  console.log("Status filter:", JSON.stringify(statusFilter, null, 2))
                  console.log(
                    "Job events for status query:",
                    jobEvents.map(e => e.id),
                  )

                  const statusFeed = makeFeed({
                    element,
                    relays: [damusRelay],
                    feedFilters: [statusFilter],
                    subscriptionFilters: [statusFilter],
                    initialEvents: [],
                    onEvent: event => {
                      console.log("=== Status event received ===")
                      console.log("Status event:", event)
                      console.log("Status event tags:", event.tags)
                      console.log("Status event kind:", event.kind)
                      console.log("Status event id:", event.id)
                      console.log("Status event created_at:", event.created_at)

                      // Check for 'e' tag to see which workflow this status is for
                      const eTag = event.tags.find((t: string[]) => t[0] === "e")
                      if (eTag) {
                        console.log("Status event references workflow ID:", eTag[1])
                      }

                      // Check for 'status' tag
                      const statusTag = event.tags.find((t: string[]) => t[0] === "status")
                      if (statusTag) {
                        console.log("Status value:", statusTag[1])
                      }

                      // Add new status event
                      const existingIndex = statusEvents.findIndex(e => e.id === event.id)
                      if (existingIndex >= 0) {
                        // Update existing event
                        console.log("Updating existing status event:", event.id)
                        statusEvents[existingIndex] = event
                      } else {
                        // Add new event
                        console.log("Adding new status event:", event.id)
                        statusEvents = [...statusEvents, event]
                      }
                      console.log("Total statusEvents count:", statusEvents.length)
                      console.log("--- End of status event handler ---")
                    },
                    onExhausted: () => {
                      console.log("=== Status feed exhausted ===")
                      loadingStatus = false
                    },
                  })
                  statusFeedCleanup = statusFeed.cleanup.cleanup
                  console.log("=== Status feed created ===")
                }
              },
            })
            feedCleanup = feed.cleanup
            console.log("=== makeFeed created ===")
          } else if (!element) {
            console.log("Element not ready, retrying...")
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

  // CRITICAL: Cleanup on destroy to prevent memory leaks and blocking navigation
  onDestroy(() => {
    console.log("=== CICD onDestroy called ===")
    // Cleanup makeFeed (aborts network requests, stops scroll observers, unsubscribes)
    feedCleanup?.()
    statusFeedCleanup?.()
  })

  // Get events from makeFeed
  let jobEvents = $state<any[]>([])
  let statusEvents = $state<any[]>([])

  // Debug: Watch jobEvents changes
  $effect(() => {
    console.log("jobEvents changed, count:", jobEvents.length)
    if (jobEvents.length > 0) {
      console.log("jobEvents:", jobEvents)
    }
  })

  // Combine test data and real job events
  const allWorkflowRuns = $derived.by(() => {
    const parsedJobRuns = jobEvents.map(parseJobEvent)
    return [...workflowRuns, ...parsedJobRuns].sort((a, b) => b.createdAt - a.createdAt)
  })

  // Match status events to workflow runs and update status
  const workflowRunsWithStatus = $derived.by(() => {
    console.log("=== workflowRunsWithStatus derived ===")
    console.log("allWorkflowRuns:", allWorkflowRuns)
    console.log("statusEvents:", statusEvents)

    return allWorkflowRuns.map(run => {
      console.log("Processing workflow run:", run.id, "-", run.name)

      // Find all matching status events for this workflow run (most recent first)
      const matchingStatusEvents = statusEvents.filter(statusEvent => {
        // Status event should have an "e" tag pointing to the workflow event ID
        const eTag = statusEvent.tags.find((t: string[]) => t[0] === "e")

        // Log comparison details for debugging
        if (eTag) {
          const eTagValue = eTag[1] as string
          const runIdValue = run.id as string

          console.log("  - Comparing status event eTag value:")
          console.log("    Value:", JSON.stringify(eTagValue))
          console.log("    Length:", eTagValue.length)
          console.log(
            "    Chars:",
            Array.from(eTagValue)
              .map(c => `${c} (${c.charCodeAt(0)})`)
              .join(" "),
          )
          console.log("    Bytes:", new TextEncoder().encode(eTagValue))
          console.log("")

          console.log("  - With workflow run id:")
          console.log("    Value:", JSON.stringify(runIdValue))
          console.log("    Length:", runIdValue.length)
          console.log(
            "    Chars:",
            Array.from(runIdValue)
              .map(c => `${c} (${c.charCodeAt(0)})`)
              .join(" "),
          )
          console.log("    Bytes:", new TextEncoder().encode(runIdValue))
          console.log("")

          console.log("  - Comparison:")
          console.log("    Strict equality:", eTagValue === runIdValue)
          console.log("    Trimmed equality:", eTagValue.trim() === runIdValue.trim())
          console.log("    Trimmed lengths:", eTagValue.trim().length, runIdValue.trim().length)
        }

        const matches = eTag && eTag[1] === run._originalEvent?.id
        return matches
      })

      if (matchingStatusEvents.length > 0) {
        // Sort by created_at descending to get most recent status first
        matchingStatusEvents.sort((a, b) => b.created_at - a.created_at)
        const mostRecentStatusEvent = matchingStatusEvents[0]

        console.log(`  ✓ Found ${matchingStatusEvents.length} matching status events for:`, run.id)
        console.log(
          "  - Most recent status event:",
          mostRecentStatusEvent.id,
          mostRecentStatusEvent.created_at,
        )
        console.log(
          "  - All status events:",
          matchingStatusEvents.map(e => ({
            id: e.id,
            status: e.tags.find(t => t[0] === "status")?.[1],
            created_at: e.created_at,
          })),
        )

        // Extract status from most recent status event
        const statusTag = mostRecentStatusEvent.tags.find((t: string[]) => t[0] === "status")
        const status = statusTag ? statusTag[1] : "pending"
        console.log("  - Extracted status:", status)

        return {
          ...run,
          status: status as WorkflowRun["status"],
        }
      } else {
        console.log("  ✗ No matching status events found for run:", run.id)
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
    selectedWorkflow = workflow
    showWorkflowDropdown = false
    showWorkflowModal = true
  }

  const onAddEnvVar = () => {
    envVars = [...envVars, {key: "", value: ""}]
  }

  const onRemoveEnvVar = (index: number) => {
    envVars = envVars.filter((_, i) => i !== index)
  }

  const onSubmitWorkflow = async () => {
    // Convert env vars array to key=value format
    const envVarsString = envVars
      .filter(e => e.key && e.value)
      .map(e => `${e.key}=${e.value}`)
      .join(" ")

    // Build bash command with env vars and workflow (only add space if envVarsString is not empty)
    const bashCommand = envVarsString
      ? `${envVarsString} act -W ${selectedWorkflow?.path}`
      : `act -W ${selectedWorkflow?.path}`

    // Create Nostr event
    const unsignedEvent = {
      kind: 5100,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [["p", worker], ["bash", bashCommand], ["args"], ["payment", cashuToken]],
      pubkey: $pubkey,
    }

    try {
      // Sign and publish event
      const signedEvent = await $signer.sign(unsignedEvent)
      console.log("Signed event:", signedEvent)

      const pool = new SimplePool()
      await pool.publish(repoRelays, signedEvent)

      console.log("Published event to relays:", repoRelays)

      const jobStatusUrl = `https://loom.treegaze.com/job/${signedEvent.id}`
      toast.push({
        message: `Workflow submitted successfully - Check job status: ${jobStatusUrl}`,
        variant: "default",
      })

      showWorkflowModal = false
      // Reset form
      envVars = [{key: "", value: ""}]
      maxDuration = 600
      cashuToken = "cashuTEST"
      selectedWorkflow = null
      selectedBranch = "master"
      worker = "fa84c22dc47c67d9307b6966c992725f70dfcd8a0e5530fd7e3568121f6e1673"
    } catch (e) {
      console.error("Failed to submit workflow:", e)
      toast.push({
        message: "Failed to submit workflow",
        variant: "error",
      })
    }
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
    {#if loadingJobs}
      <div class="flex items-center justify-center py-4">
        <Spinner loading={loadingJobs}>Loading more workflow runs...</Spinner>
      </div>
    {/if}

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
                  <span class="text-xs text-muted-foreground">#{run.runNumber}</span>
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
    <!-- Workflow Submission Modal -->
    {#if showWorkflowModal}
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onclick={() => (showWorkflowModal = false)}>
        <div
          class="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg"
          onclick={e => e.stopPropagation()}>
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-lg font-semibold">Run {selectedWorkflow?.name}</h3>
            <Button variant="ghost" size="sm" onclick={() => (showWorkflowModal = false)}>
              <X class="h-4 w-4" />
            </Button>
          </div>

          <div class="space-y-4">
            <!-- Branch Selection -->
            <div class="space-y-2">
              <label for="branch-select" class="text-sm font-medium">Branch</label>
              <select
                id="branch-select"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                bind:value={selectedBranch}>
                <option value="master">master</option>
              </select>
              <p class="text-xs text-muted-foreground">Select the branch to run the workflow on</p>
            </div>

            <!-- Environment Variables -->
            <div class="space-y-2">
              <div class="text-sm font-medium">Environment Variables</div>
              <Button variant="outline" size="sm" class="gap-1" onclick={onAddEnvVar}>
                <Plus class="h-3 w-3" />
                Add
              </Button>
              <div class="space-y-2">
                {#each envVars as envVar, index (index)}
                  <div class="flex gap-2">
                    <input
                      type="text"
                      class="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                      placeholder="KEY"
                      bind:value={envVar.key} />
                    <input
                      type="text"
                      class="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                      placeholder="value"
                      bind:value={envVar.value} />
                    {#if envVars.length > 1}
                      <Button
                        variant="ghost"
                        size="sm"
                        class="shrink-0 text-muted-foreground hover:text-destructive"
                        onclick={() => onRemoveEnvVar(index)}>
                        <X class="h-4 w-4" />
                      </Button>
                    {/if}
                  </div>
                {/each}
              </div>
              <p class="text-xs text-muted-foreground">
                Add environment variables as key-value pairs
              </p>
            </div>

            <!-- Max Duration -->
            <div class="space-y-2">
              <label for="max-duration" class="text-sm font-medium">Max Duration (seconds)</label>
              <input
                id="max-duration"
                type="number"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="600"
                min="1"
                bind:value={maxDuration} />
              <p class="text-xs text-muted-foreground">
                Maximum time the workflow is allowed to run before being terminated
              </p>
            </div>

            <!-- Cashu Token -->
            <div class="space-y-2">
              <label for="cashu-token" class="text-sm font-medium">Cashu Token</label>
              <input
                id="cashu-token"
                type="text"
                class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="cashuTEST"
                bind:value={cashuToken} />
              <p class="text-xs text-muted-foreground">Cashu token for payment or authentication</p>
            </div>

            <!-- Worker -->
            <div class="space-y-2">
              <label for="worker" class="text-sm font-medium">Worker ID</label>
              <input
                id="worker"
                type="text"
                class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="Worker public key"
                bind:value={worker} />
              <p class="text-xs text-muted-foreground">
                Public key of the worker to execute the workflow
              </p>
            </div>

            <!-- Submit Button -->
            <div class="flex justify-end gap-2 pt-4">
              <Button variant="outline" onclick={() => (showWorkflowModal = false)}>Cancel</Button>
              <Button variant="git" onclick={onSubmitWorkflow}>
                <Play class="h-4 w-4" />
                Submit Workflow
              </Button>
            </div>
          </div>
        </div>
      </div>
    {/if}

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
