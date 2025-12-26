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
  } from "@lucide/svelte"
  import {getTagValue} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {isMobile} from "@lib/html"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {pushModal} from "@app/util/modal"
  import JobRequest from "@app/components/JobRequest.svelte"

  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))
  const {runId} = $page.params

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
  const getMockPipelineRun = (id: string): PipelineRun => {
    const baseRun = {
      id,
      runNumber: parseInt(id.replace("run-", "")) || Math.floor(Math.random() * 1000),
      actor: $pubkey || "unknown",
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3000000,
    }

    if (id.includes("deploy")) {
      return {
        ...baseRun,
        name: "Deploy",
        status: "success",
        branch: "main",
        commit: "ghi789",
        commitMessage: "Deploy: Production release",
        event: "workflow_dispatch",
        duration: 180,
        jobs: [
          {
            id: "deploy-job-1",
            name: "deploy",
            status: "success",
            startedAt: Date.now() - 180000,
            completedAt: Date.now(),
            steps: [
              {
                id: "step-1",
                name: "Checkout repository",
                status: "success",
                startedAt: Date.now() - 180000,
                completedAt: Date.now() - 170000,
                number: 1,
                logs: [
                  "[act] Starting step: Checkout repository",
                  "2024-01-15T10:30:00.000Z [INFO]  Using Docker image: node:18-alpine",
                  "2024-01-15T10:30:01.000Z [INFO]  Container started",
                  "2024-01-15T10:30:02.000Z [INFO]  Running: git init",
                  "2024-01-15T10:30:03.000Z [INFO]  Repository initialized",
                  "2024-01-15T10:30:04.000Z [INFO]  Running: git fetch --depth=1 origin main",
                  "2024-01-15T10:30:05.000Z [INFO]  Fetch completed",
                  "2024-01-15T10:30:06.000Z [INFO]  Running: git checkout FETCH_HEAD",
                  "2024-01-15T10:30:07.000Z [INFO]  Checked out commit ghi789",
                ]
              },
              {
                id: "step-2",
                name: "Setup Node.js",
                status: "success",
                startedAt: Date.now() - 170000,
                completedAt: Date.now() - 150000,
                number: 2,
                logs: [
                  "[act] Starting step: Setup Node.js",
                  "2024-01-15T10:31:00.000Z [INFO]  Using Node.js version 18.x",
                  "2024-01-15T10:31:01.000Z [INFO]  npm version: 9.8.1",
                  "2024-01-15T10:31:02.000Z [INFO]  Installing dependencies...",
                  "2024-01-15T10:31:10.000Z [INFO]  Dependencies installed successfully",
                ]
              },
              {
                id: "step-3",
                name: "Build application",
                status: "success",
                startedAt: Date.now() - 150000,
                completedAt: Date.now() - 120000,
                number: 3,
                logs: [
                  "[act] Starting step: Build application",
                  "2024-01-15T10:32:00.000Z [INFO]  Running: npm run build",
                  "2024-01-15T10:32:05.000Z [INFO]  Build started",
                  "2024-01-15T10:32:30.000Z [INFO]  Build completed",
                  "2024-01-15T10:32:31.000Z [INFO]  Build artifacts ready",
                ]
              },
              {
                id: "step-4",
                name: "Deploy to production",
                status: "success",
                startedAt: Date.now() - 120000,
                completedAt: Date.now() - 60000,
                number: 4,
                logs: [
                  "[act] Starting step: Deploy to production",
                  "2024-01-15T10:33:00.000Z [INFO]  Connecting to production server",
                  "2024-01-15T10:33:01.000Z [INFO]  Uploading build artifacts",
                  "2024-01-15T10:33:30.000Z [INFO]  Artifacts uploaded successfully",
                  "2024-01-15T10:33:31.000Z [INFO]  Restarting application server",
                  "2024-01-15T10:33:45.000Z [INFO]  Application restarted",
                  "2024-01-15T10:33:46.000Z [INFO]  Health check passed",
                ]
              }
            ],
            logs: [
              "[act] Starting job: deploy",
              "Total runtime: 3m 0s",
              "Job completed successfully",
            ]
          }
        ]
      }
    } else if (id.includes("ci")) {
      return {
        ...baseRun,
        name: "CI",
        status: "success",
        branch: "main",
        commit: "abc123",
        commitMessage: "Fix: Update dependencies",
        event: "push",
        duration: 120,
        jobs: [
          {
            id: "ci-job-1",
            name: "test",
            status: "success",
            startedAt: Date.now() - 120000,
            completedAt: Date.now(),
            steps: [
              {
                id: "step-1",
                name: "Checkout repository",
                status: "success",
                startedAt: Date.now() - 120000,
                completedAt: Date.now() - 110000,
                number: 1,
                logs: [
                  "[act] Starting step: Checkout repository",
                  "2024-01-15T10:20:00.000Z [INFO]  Using Docker image: node:18-alpine",
                  "2024-01-15T10:20:01.000Z [INFO]  Container started",
                  "2024-01-15T10:20:02.000Z [INFO]  Repository checked out successfully",
                ]
              },
              {
                id: "step-2",
                name: "Install dependencies",
                status: "success",
                startedAt: Date.now() - 110000,
                completedAt: Date.now() - 90000,
                number: 2,
                logs: [
                  "[act] Starting step: Install dependencies",
                  "2024-01-15T10:21:00.000Z [INFO]  Running: npm ci",
                  "2024-01-15T10:21:15.000Z [INFO]  Dependencies installed",
                ]
              },
              {
                id: "step-3",
                name: "Run tests",
                status: "success",
                startedAt: Date.now() - 90000,
                completedAt: Date.now() - 60000,
                number: 3,
                logs: [
                  "[act] Starting step: Run tests",
                  "2024-01-15T10:22:00.000Z [INFO]  Running: npm test",
                  "2024-01-15T10:22:10.000Z [INFO]  Running test suite...",
                  "2024-01-15T10:22:30.000Z [INFO]  ✓ Unit tests (45/45 passed)",
                  "2024-01-15T10:22:45.000Z [INFO]  ✓ Integration tests (12/12 passed)",
                  "2024-01-15T10:22:59.000Z [INFO]  ✓ E2E tests (8/8 passed)",
                  "2024-01-15T10:23:00.000Z [INFO]  All tests passed!",
                ]
              },
              {
                id: "step-4",
                name: "Run linting",
                status: "success",
                startedAt: Date.now() - 60000,
                completedAt: Date.now() - 45000,
                number: 4,
                logs: [
                  "[act] Starting step: Run linting",
                  "2024-01-15T10:23:00.000Z [INFO]  Running: npm run lint",
                  "2024-01-15T10:23:05.000Z [INFO]  Linting source files...",
                  "2024-01-15T10:23:10.000Z [INFO]  No linting errors found",
                ]
              },
              {
                id: "step-5",
                name: "Type checking",
                status: "success",
                startedAt: Date.now() - 45000,
                completedAt: Date.now() - 30000,
                number: 5,
                logs: [
                  "[act] Starting step: Type checking",
                  "2024-01-15T10:23:00.000Z [INFO]  Running: npm run type-check",
                  "2024-01-15T10:23:05.000Z [INFO]  Type checking completed",
                  "2024-01-15T10:23:10.000Z [INFO]  No type errors found",
                ]
              }
            ],
            logs: [
              "[act] Starting job: test",
              "Total runtime: 2m 0s",
              "Job completed successfully",
            ]
          }
        ]
      }
    } else {
      // Build and Test
      return {
        ...baseRun,
        name: "Build and Test",
        status: "failure",
        branch: "develop",
        commit: "def456",
        commitMessage: "Feature: Add new component",
        event: "pull_request",
        duration: 90,
        jobs: [
          {
            id: "build-job-1",
            name: "build",
            status: "success",
            startedAt: Date.now() - 90000,
            completedAt: Date.now() - 60000,
            steps: [
              {
                id: "step-1",
                name: "Checkout repository",
                status: "success",
                startedAt: Date.now() - 90000,
                completedAt: Date.now() - 85000,
                number: 1,
                logs: [
                  "[act] Starting step: Checkout repository",
                  "2024-01-15T10:15:00.000Z [INFO]  Using Docker image: node:18-alpine",
                  "2024-01-15T10:15:01.000Z [INFO]  Container started",
                  "2024-01-15T10:15:02.000Z [INFO]  Repository checked out successfully",
                ]
              },
              {
                id: "step-2",
                name: "Install dependencies",
                status: "success",
                startedAt: Date.now() - 85000,
                completedAt: Date.now() - 70000,
                number: 2,
                logs: [
                  "[act] Starting step: Install dependencies",
                  "2024-01-15T10:16:00.000Z [INFO]  Running: npm ci",
                  "2024-01-15T10:16:10.000Z [INFO]  Dependencies installed",
                ]
              },
              {
                id: "step-3",
                name: "Build project",
                status: "success",
                startedAt: Date.now() - 70000,
                completedAt: Date.now() - 60000,
                number: 3,
                logs: [
                  "[act] Starting step: Build project",
                  "2024-01-15T10:17:00.000Z [INFO]  Running: npm run build",
                  "2024-01-15T10:17:15.000Z [INFO]  Build completed successfully",
                ]
              }
            ],
            logs: [
              "[act] Starting job: build",
              "Total runtime: 30s",
              "Job completed successfully",
            ]
          },
          {
            id: "test-job-1",
            name: "test",
            status: "failure",
            startedAt: Date.now() - 60000,
            completedAt: Date.now() - 30000,
            steps: [
              {
                id: "step-1",
                name: "Checkout repository",
                status: "success",
                startedAt: Date.now() - 60000,
                completedAt: Date.now() - 55000,
                number: 1,
                logs: [
                  "[act] Starting step: Checkout repository",
                  "2024-01-15T10:18:00.000Z [INFO]  Repository checked out successfully",
                ]
              },
              {
                id: "step-2",
                name: "Run unit tests",
                status: "failure",
                startedAt: Date.now() - 55000,
                completedAt: Date.now() - 30000,
                number: 2,
                logs: [
                  "[act] Starting step: Run unit tests",
                  "2024-01-15T10:18:00.000Z [INFO]  Running: npm test",
                  "2024-01-15T10:18:10.000Z [INFO]  Running test suite...",
                  "2024-01-15T10:18:20.000Z [ERROR] ✗ Test failed: NewComponent.test.ts",
                  "2024-01-15T10:18:21.000Z [ERROR]   Expected: true",
                  "2024-01-15T10:18:22.000Z [ERROR]   Received: false",
                  "2024-01-15T10:18:23.000Z [ERROR]   At: NewComponent.test.ts:23:5",
                  "2024-01-15T10:18:24.000Z [INFO]  ✓ Other tests (44/45 passed)",
                  "2024-01-15T10:18:25.000Z [ERROR]  Test suite failed with 1 error",
                ]
              }
            ],
            logs: [
              "[act] Starting job: test",
              "2024-01-15T10:18:30.000Z [ERROR] Job failed: Test suite failed",
              "Total runtime: 30s",
              "Job completed with failure",
            ]
          }
        ]
      }
    }
  }

  let pipelineRun = $state<PipelineRun>(getMockPipelineRun(runId))
  let selectedJob = $state<Job | null>(pipelineRun.jobs[0] || null)
  let selectedStep = $state<Step | null>(null)
  let expandedJobs = $state<Set<string>>(new Set())
  let expandedSteps = $state<Set<string>>(new Set())
  let loading = $state(false)

  $effect(() => {
    // When pipeline run changes, ensure we have a job selected.
    if (!selectedJob && pipelineRun.jobs.length > 0) {
      selectedJob = pipelineRun.jobs[0]
    }
  })

  $effect(() => {
    // When selected job changes, default to its first step and expand it.
    if (!selectedJob) {
      selectedStep = null
      expandedJobs = new Set()
      expandedSteps = new Set()
      return
    }

    if (!expandedJobs.has(selectedJob.id)) {
      expandedJobs = new Set([selectedJob.id])
    }

    const firstStep = selectedJob.steps[0] || null
    if (!selectedStep || selectedStep.id !== firstStep?.id) {
      selectedStep = firstStep
    }
  })

  $effect(() => {
    if (!selectedStep) {
      expandedSteps = new Set()
      return
    }

    if (!expandedSteps.has(selectedStep.id)) {
      expandedSteps = new Set([selectedStep.id])
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

  const toggleJobExpansion = (jobId: string) => {
    const newExpanded = new Set(expandedJobs)
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId)
    } else {
      newExpanded.add(jobId)
    }
    expandedJobs = newExpanded
  }

  const toggleStepExpansion = (stepId: string) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId)
    } else {
      newExpanded.add(stepId)
    }
    expandedSteps = newExpanded
  }

  const selectJob = (job: Job) => {
    selectedJob = job
    selectedStep = job.steps[0] || null
  }

  const selectStep = (step: Step) => {
    selectedStep = step
  }

  const onRerunPipeline = () => {
    // Open JobRequest modal with correct relay URL
    const relayUrl = $page.params.relay
    pushModal(JobRequest, {url: relayUrl})
  }

  const onCopyLogs = () => {
    if (!selectedStep) return
    
    const logs = selectedStep.logs.join('\n')
    navigator.clipboard.writeText(logs).then(() => {
      toast.push({
        message: "Logs copied to clipboard",
        variant: "default",
      })
    })
  }

  const onDownloadLogs = () => {
    if (!selectedStep) return
    
    const logs = selectedStep.logs.join('\n')
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pipeline-${pipelineRun.name}-${selectedStep.name}-logs.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const goBack = () => {
    goto(`/spaces/${encodeURIComponent($page.params.relay)}/git/${$page.params.id}/cicd`)
  }
</script>

<svelte:head>
  <title>{repoClass?.name} - Pipeline Run #{pipelineRun.runNumber}</title>
</svelte:head>

<div class="space-y-4">
  <!-- Header -->
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <Button size="sm" variant="outline" onclick={goBack} class="gap-2">
          <ArrowLeft class="h-4 w-4" />
          Back to Pipelines
        </Button>
        <div>
          <h2 class="text-xl font-semibold flex items-center gap-2">
            {pipelineRun.name}
            <span class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(pipelineRun.status)} ${getStatusColor(pipelineRun.status)}`}>
              {#if pipelineRun.status === "in_progress"}
                <Loader2 class="h-3 w-3 animate-spin" />
              {:else}
                {@const StatusIcon = getStatusIcon(pipelineRun.status)}
                <StatusIcon class="h-3 w-3" />
              {/if}
              {pipelineRun.status.replace("_", " ")}
            </span>
          </h2>
          <p class="text-sm text-muted-foreground">
            Run #{pipelineRun.runNumber} • {formatTimeAgo(pipelineRun.createdAt)}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" onclick={onRerunPipeline} class="gap-2" disabled={loading}>
          {#if loading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            <RotateCw class="h-4 w-4" />
          {/if}
          Re-run jobs
        </Button>
      </div>
    </div>

    <!-- Pipeline Info -->
    <div class="rounded-lg border border-border bg-card p-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Triggered by</p>
          <p class="text-sm font-medium">{pipelineRun.event.replace("_", " ")}</p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Branch</p>
          <p class="text-sm font-medium">{pipelineRun.branch}</p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Commit</p>
          <div class="flex items-center gap-1">
            <GitCommit class="h-3 w-3" />
            <span class="text-sm font-mono">{pipelineRun.commit.slice(0, 7)}</span>
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Duration</p>
          <p class="text-sm font-medium">{formatDuration(pipelineRun.duration)}</p>
        </div>
      </div>
      <div class="mt-3">
        <p class="text-xs text-muted-foreground">Commit message</p>
        <p class="text-sm">{pipelineRun.commitMessage}</p>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Jobs List -->
    <div class="lg:col-span-1">
      <div class="space-y-2">
        <h3 class="text-lg font-semibold">Jobs</h3>
        {#each pipelineRun.jobs as job (job.id)}
          <div
            class="rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
            class:border-primary={selectedJob?.id === job.id}>
            <button
              class="w-full p-4 text-left"
              onclick={() => selectJob(job)}>
              <div class="flex items-start gap-3">
                <div class={`mt-1 flex-shrink-0 ${getStatusColor(job.status)}`}>
                  {#if job.status === "in_progress"}
                    <Loader2 class="h-5 w-5 animate-spin" />
                  {:else}
                    {@const JobStatusIcon = getStatusIcon(job.status)}
                    <JobStatusIcon class="h-5 w-5" />
                  {/if}
                </div>
                <div class="flex-1 min-w-0 space-y-1">
                  <div class="flex items-center gap-2">
                    <h4 class="font-medium">{job.name}</h4>
                    <span
                      class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(job.status)} ${getStatusColor(job.status)}`}>
                      {job.status.replace("_", " ")}
                    </span>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Started {formatTimeAgo(job.startedAt)}
                    {#if job.completedAt}
                      • {formatDuration(Math.floor((job.completedAt - job.startedAt) / 1000))}
                    {/if}
                  </p>
                </div>
              </div>
            </button>
          </div>
        {/each}
      </div>
    </div>

    <!-- Job Details and Logs -->
    <div class="lg:col-span-2">
      {#if selectedJob}
        <div class="space-y-4">
          <!-- Job Steps -->
          <div>
            <h3 class="text-lg font-semibold mb-3">Steps for {selectedJob.name}</h3>
            <div class="space-y-2">
              {#each selectedJob.steps as step (step.id)}
                <div class="rounded-lg border border-border bg-card">
                  <button
                    class="w-full p-4 text-left hover:bg-accent/50 transition-colors"
                    onclick={() => selectStep(step)}>
                    <div class="flex items-center gap-3">
                      <div class={`flex-shrink-0 ${getStatusColor(step.status)}`}>
                        {#if step.status === "in_progress"}
                          <Loader2 class="h-4 w-4 animate-spin" />
                        {:else}
                          {@const StepStatusIcon = getStatusIcon(step.status)}
                          <StepStatusIcon class="h-4 w-4" />
                        {/if}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium">Step {step.number}</span>
                          <span class="text-sm">{step.name}</span>
                          <span
                            class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBgColor(step.status)} ${getStatusColor(step.status)}`}>
                            {step.status.replace("_", " ")}
                          </span>
                        </div>
                        <p class="text-xs text-muted-foreground">
                          {formatTimestamp(step.startedAt)} - 
                          {#if step.completedAt}
                            {formatTimestamp(step.completedAt)}
                          {:else}
                            Running...
                          {/if}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              {/each}
            </div>
          </div>

          <!-- Step Logs -->
          {#if selectedStep}
            <div>
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-lg font-semibold">Logs: {selectedStep.name}</h3>
                <div class="flex items-center gap-2">
                  <Button size="sm" variant="outline" onclick={onCopyLogs} class="gap-2">
                    <Copy class="h-4 w-4" />
                    Copy
                  </Button>
                  <Button size="sm" variant="outline" onclick={onDownloadLogs} class="gap-2">
                    <Download class="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
              <div class="rounded-lg border border-border bg-black/50 p-4 font-mono text-sm text-green-400 max-h-96 overflow-auto">
                {#each selectedStep.logs as log}
                  <div class="mb-1">{log}</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Job Logs -->
          <div>
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-lg font-semibold">Job Logs</h3>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="outline" class="gap-2">
                  <Terminal class="h-4 w-4" />
                  Full Logs
                </Button>
              </div>
            </div>
            <div class="rounded-lg border border-border bg-black/50 p-4 font-mono text-sm text-green-400 max-h-64 overflow-auto">
              {#each selectedJob.logs as log}
                <div class="mb-1">{log}</div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
