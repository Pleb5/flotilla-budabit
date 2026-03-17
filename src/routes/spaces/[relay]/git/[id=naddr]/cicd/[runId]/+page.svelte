<script lang="ts">
  import {Button, toast} from "@nostr-git/ui"
  import {
    Check,
    Clock,
    X,
    AlertCircle,
    Circle,
    ArrowLeft,
    RotateCw,
    Copy,
    ChevronDown,
    ChevronRight,
    Loader2,
    ExternalLink,
    GitBranch,
  } from "@lucide/svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {SimplePool} from "nostr-tools"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import {CICD_RELAYS} from "@lib/budabit/constants"
  import {parseActLog, getJobGroups} from "@lib/budabit/cicd"
  import type {WorkflowJob} from "@lib/budabit/cicd"
  import WorkflowJobs from "@lib/budabit/components/WorkflowJobs.svelte"
  import ConsoleOutput from "@lib/budabit/components/ConsoleOutput.svelte"
  import type {Repo} from "@nostr-git/ui"
  import {makeLoader, request} from "@welshman/net"
  import yaml from "js-yaml"

  // Use a longer timeout than the default 3s — cold WebSocket connections need time
  const load = makeLoader({delay: 200, timeout: 15000, threshold: 0.5})

  const repoClass = getContext<Repo>(REPO_KEY)
  if (!repoClass) throw new Error("Repo context not available")

  const {runId} = $page.params
  const JOB_RELAYS = CICD_RELAYS

  // Raw event state — the source of truth
  let runEvent = $state<any | null>(null) // Kind 5401 workflow run
  let loomJobEvent = $state<any | null>(null) // Kind 5100 loom job (child)
  let loomStatusEvent = $state<any | null>(null) // Kind 30100 loom status (latest)
  let loomResultEvent = $state<any | null>(null) // Kind 5101 loom result
  let workflowLogEvent = $state<any | null>(null) // Kind 5402 workflow log/result

  // Workflow act log (from Kind 5402 log_url) — used for parsing and WorkflowLogs card
  let actLogContent = $state("")
  // Loom job stdout/stderr (from Kind 5101) — shown in "stdout (loom)"/"stderr (loom)" consoles
  let loomStdout = $state("")
  let loomStderr = $state("")
  let loomStdoutUrl = $state<string | null>(null)
  let loomStderrUrl = $state<string | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let showRawEvents = $state(false)

  // ── Live duration counter ─────────────────────────────────────────
  let liveDurationSeconds = $state(0)
  let durationInterval: ReturnType<typeof setInterval> | null = null

  $effect(() => {
    const isRunning = resolvedStatus === "pending" || resolvedStatus === "in_progress" || resolvedStatus === "running" || resolvedStatus === "queued"
    if (isRunning && runInfo?.createdAt) {
      liveDurationSeconds = Math.floor((Date.now() - runInfo.createdAt) / 1000)
      if (!durationInterval) {
        durationInterval = setInterval(() => {
          liveDurationSeconds = Math.floor((Date.now() - runInfo!.createdAt) / 1000)
        }, 1000)
      }
    } else {
      if (durationInterval) {
        clearInterval(durationInterval)
        durationInterval = null
      }
    }
  })

  // Worker advertisement (Kind 10100)
  let workerAdEvent = $state<any | null>(null)

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
    const job = loomJobEvent || (!isHiveCIRun ? runEvent : null)
    if (!job) return null
    const tags: string[][] = job.tags || []
    const pTag = tags.find((t: string[]) => t[0] === "p")
    const paymentTag = tags.find((t: string[]) => t[0] === "payment")
    return {
      id: job.id,
      workerPubkey: pTag?.[1] || "",
      paymentToken: paymentTag?.[1] || "",
    }
  })

  // ── Derived: worker name from Kind 10100 ──────────────────────────────
  const workerName = $derived.by(() => {
    if (!workerAdEvent) return null
    try {
      const content = JSON.parse(workerAdEvent.content || "{}")
      return content.name || null
    } catch {
      return null
    }
  })

  // ── Derived: composite status ─────────────────────────────────────────
  const resolvedStatus = $derived.by((): string => {
    // Kind 5402 — hive-ci workflow result
    if (workflowLogEvent) {
      const statusTag = workflowLogEvent.tags?.find((t: string[]) => t[0] === "status")
      const s = statusTag?.[1] || "unknown"
      if (s === "failed" || s === "failure") return "failure"
      // Even if 5402 says success, if loom result says failure → failure
      if (loomResultEvent) {
        const loomSuccess = loomResultEvent.tags?.find((t: string[]) => t[0] === "success")
        if (loomSuccess?.[1] === "false") return "failure"
      }
      if (s === "success") return "success"
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

  // True when no worker has responded at all (5100 is our own job request, not worker acceptance)
  const waitingForWorker = $derived(
    !workflowLogEvent && !loomResultEvent && !loomStatusEvent
  )

  // ── Derived: status label (with "workflow result missing" note) ─────
  const statusLabel = $derived.by((): string => {
    if (resolvedStatus === "failure" && !workflowLogEvent && loomResultEvent) {
      return "Error (workflow result missing)"
    }
    if (waitingForWorker) return "Pending"
    return resolvedStatus.replace("_", " ")
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
      changeToken: tagVal("change"),
    }
  })

  // ── Derived: payment info ─────────────────────────────────────────────
  // Prepaid = sum of proofs in the payment token
  // Change = sum of proofs in the change token (from loom result)
  // Actual cost = prepaid - change
  let prepaidAmount = $state<number | null>(null)
  let changeAmount = $state<number | null>(null)

  // Parse cashu token amount (sum of proofs)
  async function parseTokenAmount(token: string): Promise<number> {
    const {getDecodedToken} = await import("@cashu/cashu-ts")
    const decoded = getDecodedToken(token)
    let total = 0
    for (const proof of decoded.proofs) {
      total += proof.amount
    }
    return total
  }

  // Watch payment token from loom job
  $effect(() => {
    const token = loomInfo?.paymentToken
    if (token) {
      parseTokenAmount(token).then(amount => {
        prepaidAmount = amount
      }).catch(err => {
        console.error("[cicd] Failed to parse payment token:", err)
      })
    }
  })

  // Watch change token from loom result
  $effect(() => {
    const token = loomResultInfo?.changeToken
    if (token) {
      parseTokenAmount(token).then(amount => {
        changeAmount = amount
      }).catch(err => {
        console.error("[cicd] Failed to parse change token:", err)
      })
    }
  })

  const actualCost = $derived(
    prepaidAmount !== null
      ? prepaidAmount - (changeAmount ?? 0)
      : null
  )

  // ── Fetch output files ────────────────────────────────────────────────
  const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  }

  // Fetch act log (Kind 5402 log_url) for WorkflowLogs parsing
  let fetchedActLogUrl = $state<string | null>(null)
  $effect(() => {
    const url = workflowLogInfo?.logUrl || null
    if (url && url !== fetchedActLogUrl) {
      fetchedActLogUrl = url
      fetchText(url).then(c => actLogContent = c).catch(err => console.error("[cicd] Failed to fetch act log:", err))
    }
  })

  // Fetch loom job stdout/stderr (Kind 5101)
  let fetchedLoomStdoutUrl = $state<string | null>(null)
  let fetchedLoomStderrUrl = $state<string | null>(null)
  $effect(() => {
    const url = loomResultInfo?.stdoutUrl || null
    if (url && url !== fetchedLoomStdoutUrl) {
      fetchedLoomStdoutUrl = url
      loomStdoutUrl = url
      fetchText(url).then(c => loomStdout = c).catch(err => console.error("[cicd] Failed to fetch loom stdout:", err))
    }
  })
  $effect(() => {
    const url = loomResultInfo?.stderrUrl || null
    if (url && url !== fetchedLoomStderrUrl) {
      fetchedLoomStderrUrl = url
      loomStderrUrl = url
      fetchText(url).then(c => loomStderr = c).catch(err => console.error("[cicd] Failed to fetch loom stderr:", err))
    }
  })

  // ── Fetch worker advertisement (Kind 10100) ───────────────────────────
  async function fetchWorkerAd(workerPubkey: string) {
    try {
      const pool = new SimplePool()
      const events = await pool.querySync(JOB_RELAYS, {kinds: [10100], authors: [workerPubkey]})
      pool.close(JOB_RELAYS)
      if (events.length > 0) {
        events.sort((a, b) => b.created_at - a.created_at)
        workerAdEvent = events[0]
      }
    } catch (err) {
      console.error("[cicd] Failed to fetch worker ad:", err)
    }
  }

  // ── Mount: fetch all events ───────────────────────────────────────────
  onMount(() => {
    if (!runId) {
      error = "Run ID is required"
      loading = false
      return
    }

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
      } else {
        // Not found yet — relay may still be indexing the event.
        // Keep loading and let the live subscription deliver it.
        // A timeout below will surface the error if it never arrives.
        return
      }
      loading = false

      // Workflow log (Kind 5402)
      if (k5402.length > 0) {
        workflowLogEvent = k5402[0]
      }

      // Loom job referencing this run (Kind 5100 with e-tag)
      if (k5100ByRef.length > 0) {
        loomJobEvent = k5100ByRef[0]
        const loomId = loomJobEvent.id
        // Fetch worker ad
        const pTag = loomJobEvent.tags?.find((t: string[]) => t[0] === "p")
        if (pTag?.[1]) fetchWorkerAd(pTag[1])

        Promise.all([
          load({relays: JOB_RELAYS, filters: [{kinds: [5101], "#e": [loomId]}]}),
          load({relays: JOB_RELAYS, filters: [{kinds: [30100], "#e": [loomId]}]}),
        ]).then(([loomResults, loomStatuses]) => {
          if (loomResults.length > 0) {
            loomResultEvent = loomResults[0]
          }
          if (loomStatuses.length > 0) {
            const sorted = [...loomStatuses].sort((a: any, b: any) => b.created_at - a.created_at)
            loomStatusEvent = sorted[0]
          }
        })

        // Live subscription for loom child events — status/result reference loomId, not runId
        request({
          relays: JOB_RELAYS,
          filters: [
            {kinds: [5101], "#e": [loomId]},
            {kinds: [30100], "#e": [loomId]},
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
      } else if (!runEvent || runEvent.kind !== 5401) {
        // Legacy: run IS the loom job; fetch worker ad from p tag
        const pTag = runEvent?.tags?.find((t: string[]) => t[0] === "p")
        if (pTag?.[1]) fetchWorkerAd(pTag[1])
      }

      // Direct results/status referencing the run ID
      if (k5101.length > 0 && !loomResultEvent) {
        loomResultEvent = k5101[0]
      }
      if (k30100.length > 0) {
        const sorted = [...k30100].sort((a: any, b: any) => b.created_at - a.created_at)
        if (!loomStatusEvent) loomStatusEvent = sorted[0]
      }
    })

    // If the event still hasn't arrived after 30 s, surface an error
    const notFoundTimer = setTimeout(() => {
      if (!runEvent) {
        error = `Workflow run ${runId} not found on any relay`
        loading = false
      }
    }, 30000)

    // Live subscription
    const abort = new AbortController()
    feedCleanup = () => {
      abort.abort()
      clearTimeout(notFoundTimer)
    }

    request({
      relays: JOB_RELAYS,
      filters: [
        {kinds: [5401], ids: [runId]},
        {kinds: [5402], "#e": [runId]},
        {kinds: [5100], "#e": [runId]},
        {kinds: [5101], "#e": [runId]},
        {kinds: [30100], "#e": [runId]},
      ],
      signal: abort.signal,
      onEvent: (event: any) => {
        if (event.kind === 5401 && !runEvent) {
          runEvent = event
          error = null
          loading = false
          clearTimeout(notFoundTimer)
        }
        if (event.kind === 5402) {
          workflowLogEvent = event
        }
        if (event.kind === 5100 && !loomJobEvent) {
          loomJobEvent = event
          const pTag = event.tags?.find((t: string[]) => t[0] === "p")
          if (pTag?.[1]) fetchWorkerAd(pTag[1])
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
        }
        if (event.kind === 30100) {
          if (!loomStatusEvent || event.created_at > loomStatusEvent.created_at) {
            loomStatusEvent = event
          }
        }
      },
    })
  })

  onDestroy(() => {
    feedCleanup?.()
    if (durationInterval) clearInterval(durationInterval)
  })

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

  const goRerun = () => {
    if (!runInfo) return
    const params = new URLSearchParams()
    if (runInfo.name) params.set("workflow", runInfo.name)
    if (runInfo.workflowPath) params.set("path", runInfo.workflowPath)
    const qs = params.toString()
    goto(`/spaces/${encodeURIComponent($page.params.relay!)}/git/${$page.params.id}/cicd/new${qs ? `?${qs}` : ""}`)
  }

  // ── Act log parsing ────────────────────────────────────────────────
  const parsedActJobs = $derived(actLogContent ? parseActLog(actLogContent) : [])
  const actJobByName = $derived(new Map(parsedActJobs.map(j => [j.name.toLowerCase(), j])))

  // ── Workflow YAML stages ───────────────────────────────────────────
  let workflowJobs = $state<WorkflowJob[]>([])
  let workflowYamlName = $state<string | null>(null)
  let loadingWorkflowYaml = $state(false)
  let workflowYamlError = $state<string | null>(null)

  const jobGroups = $derived(getJobGroups(workflowJobs))

  // Fetch and parse the workflow YAML when runInfo becomes available
  $effect(() => {
    if (!runInfo?.workflowPath || !runInfo?.branch) {
      console.log("[cicd] Skipping workflow YAML fetch — workflowPath:", runInfo?.workflowPath, "branch:", runInfo?.branch)
      return
    }
    if (loadingWorkflowYaml || workflowJobs.length > 0 || workflowYamlError) return

    console.log("[cicd] Fetching workflow YAML:", runInfo.workflowPath, "branch:", runInfo.branch)
    loadingWorkflowYaml = true

    const parseWithActionsParser = async (content: string) => {
      const {parseWorkflow, NoOperationTraceWriter, convertWorkflowTemplate} = await import("@actions/workflow-parser")
      const {ErrorPolicy} = await import("@actions/workflow-parser/model/convert")
      const file = {name: runInfo!.workflowPath, content}
      const trace = new NoOperationTraceWriter()
      const result = parseWorkflow(file, trace)

      if (!result.value) {
        throw new Error("Failed to parse workflow file")
      }

      const template = await convertWorkflowTemplate(result.context, result.value, undefined, {
        errorPolicy: ErrorPolicy.TryConversion,
      })

      workflowYamlName = null
      workflowJobs = template.jobs.map((job: any) => {
        const jobId = job.id?.value ?? job.id?.toString?.() ?? "unknown"
        const jobName = job.name?.toDisplayString?.() ?? job.name?.toString?.() ?? jobId

        if (job.type === "job") {
          return {
            id: jobId,
            name: jobName,
            runsOn: job["runs-on"]?.toDisplayString?.() ?? "",
            needs: (job.needs || []).map((n: any) => n.value ?? n.toString()),
            steps: (job.steps || []).map((step: any) => {
              if ("uses" in step && step.uses) {
                return {
                  name: step.name?.toDisplayString?.() ?? step.uses.value ?? "Step",
                  uses: step.uses.value ?? step.uses.toString(),
                }
              } else {
                const runVal = step.run?.value ?? step.run?.toString?.() ?? ""
                return {
                  name: step.name?.toDisplayString?.() ?? runVal.split("\n")[0]?.slice(0, 60) ?? "Step",
                  run: runVal,
                }
              }
            }),
          }
        } else {
          // Reusable workflow job
          return {
            id: jobId,
            name: jobName,
            runsOn: "",
            needs: (job.needs || []).map((n: any) => n.value ?? n.toString()),
            steps: [{name: `Uses ${job.ref?.value ?? "reusable workflow"}`, uses: job.ref?.value}],
          }
        }
      })
    }

    const parseWithYamlFallback = (content: string) => {
      const {load: yamlLoad} = yaml
      const parsed = yamlLoad(content) as any
      if (!parsed?.jobs) {
        workflowYamlError = "No jobs found in workflow"
        return
      }
      workflowYamlName = parsed.name || null
      workflowJobs = Object.entries(parsed.jobs).map(([jobId, job]: [string, any]) => ({
        id: jobId,
        name: job.name || jobId,
        runsOn: typeof job["runs-on"] === "string" ? job["runs-on"] : JSON.stringify(job["runs-on"] || ""),
        needs: Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [],
        steps: (job.steps || []).map((step: any) => ({
          name: step.name || step.uses || step.run?.split("\n")[0]?.slice(0, 60) || "Step",
          uses: step.uses,
          run: step.run,
        })),
      }))
    }

    repoClass
      .getFileContent({path: runInfo.workflowPath, branch: runInfo.branch})
      .then(async (result: any) => {
        console.log("[cicd] getFileContent result:", result ? `${result.content?.length} bytes` : "null")
        const content = result?.content || ""
        if (!content) {
          workflowYamlError = "Empty workflow file"
          return
        }
        try {
          await parseWithActionsParser(content)
          console.log("[cicd] Parsed workflow with @actions/workflow-parser:", workflowJobs.length, "jobs")
        } catch (e: any) {
          console.warn("[cicd] @actions/workflow-parser failed, falling back to js-yaml:", e.message)
          try {
            parseWithYamlFallback(content)
            console.log("[cicd] Parsed workflow with js-yaml fallback:", workflowJobs.length, "jobs")
          } catch (e2: any) {
            workflowYamlError = `Failed to parse YAML: ${e2.message}`
          }
        }
      })
      .catch((e: any) => {
        console.error("[cicd] getFileContent failed:", e)
        workflowYamlError = `Failed to load workflow file: ${e.message}`
      })
      .finally(() => {
        loadingWorkflowYaml = false
      })
  })
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
                {statusLabel}
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
          onclick={goRerun}
          class="gap-2">
          <RotateCw class="h-4 w-4" />
          Re-run
        </Button>
      </div>
    </div>

    <!-- Workflow Run card (outer) with Loom Job nested inside -->
    <div class="rounded-lg border border-border bg-card p-4">
      <div class="mb-3 flex items-center gap-2">
        {#if resolvedStatus === "in_progress" || resolvedStatus === "running"}
          <Loader2 class={`h-5 w-5 animate-spin ${getStatusColor(resolvedStatus)}`} />
        {:else}
          {@const StatusIcon = getStatusIcon(resolvedStatus)}
          <StatusIcon class={`h-5 w-5 ${getStatusColor(resolvedStatus)}`} />
        {/if}
        <h3 class="text-lg font-semibold">Workflow Run</h3>
        <span class={`text-sm ${getStatusColor(resolvedStatus)}`}>{statusLabel}</span>
        {#if runInfo.branch}
          <span class="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-500">
            <GitBranch class="h-3 w-3" />
            {runInfo.branch}
          </span>
        {/if}
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Run ID</p>
          <span class="inline-flex items-center gap-1 font-mono text-sm">
            {runEvent.id.slice(0, 16)}...
            <button
              onclick={() => {
                navigator.clipboard.writeText(runEvent.id)
                toast.push({message: "Run ID copied", variant: "default"})
              }}
              class="text-muted-foreground hover:text-foreground">
              <Copy class="h-3 w-3" />
            </button>
          </span>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Triggered by</p>
          <ProfileLink pubkey={runInfo.triggeredBy} />
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
        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">Duration</p>
          {#if workflowLogInfo?.duration}
            <span class="text-sm">{workflowLogInfo.duration}s</span>
          {:else}
            <span class="font-mono text-sm text-muted-foreground">{liveDurationSeconds}s</span>
          {/if}
        </div>
        {#if workflowLogInfo?.exitCode}
          <div class="space-y-1">
            <p class="text-xs text-muted-foreground">Exit Code</p>
            <span class="font-mono text-sm">{workflowLogInfo.exitCode}</span>
          </div>
        {/if}
      </div>

      <!-- Waiting for worker banner -->
      {#if waitingForWorker}
        <div class="mt-4 flex items-start gap-3 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-4">
          <Loader2 class="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-yellow-500" />
          <div>
            <p class="font-medium text-yellow-600">
              Waiting for {workerName || (loomInfo?.workerPubkey ? loomInfo.workerPubkey.slice(0, 12) + "…" : "the assigned worker")} to respond
            </p>
            <p class="mt-1 text-sm text-muted-foreground">
              The job request has been sent. Check that the worker is online and subscribed to the correct relays.
            </p>
          </div>
        </div>
      {/if}

      <!-- Nested: Loom Job -->
      {#if loomInfo}
        <div class="mt-4 rounded-md border border-border bg-muted/30 p-4">
          <h4 class="mb-2 text-sm font-semibold text-muted-foreground">Loom Job</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Job ID</p>
              <span class="inline-flex items-center gap-1 font-mono text-sm">
                {loomInfo.id.slice(0, 16)}...
                <button
                  onclick={() => {
                    navigator.clipboard.writeText(loomInfo.id)
                    toast.push({message: "Job ID copied", variant: "default"})
                  }}
                  class="text-muted-foreground hover:text-foreground">
                  <Copy class="h-3 w-3" />
                </button>
              </span>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Worker</p>
              {#if loomInfo.workerPubkey}
                <a
                  href="https://loom.treegaze.com/worker/{loomInfo.workerPubkey}"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline">
                  {workerName || loomInfo.workerPubkey.slice(0, 12) + "..."}
                  <ExternalLink class="h-3 w-3" />
                </a>
              {:else}
                <span class="text-sm text-muted-foreground">Unknown</span>
              {/if}
            </div>
            {#if loomResultInfo}
              {#if loomResultInfo.success !== undefined}
                <div class="space-y-1">
                  <p class="text-xs text-muted-foreground">Result</p>
                  <span class="text-sm font-medium {loomResultInfo.success === 'true' ? 'text-green-500' : 'text-red-500'}">
                    {loomResultInfo.success === "true" ? "Success" : "Failed"}
                  </span>
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
            {/if}
          </div>
        </div>
      {/if}

      <!-- Legacy command details (for Kind 5100 direct, no nested loom) -->
      {#if !isHiveCIRun && !loomJobEvent && runInfo.cmd}
        <div class="mt-4 border-t border-border pt-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Command</p>
              <code class="rounded bg-muted px-2 py-1 text-sm">{runInfo.cmd}</code>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted-foreground">Worker</p>
              {#if runInfo.worker && runInfo.worker !== "unknown"}
                <a
                  href="https://loom.treegaze.com/worker/{runInfo.worker}"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline">
                  {workerName || runInfo.worker.slice(0, 12) + "..."}
                  <ExternalLink class="h-3 w-3" />
                </a>
              {:else}
                <span class="text-sm text-muted-foreground">Unknown</span>
              {/if}
            </div>
          </div>
          {#if runInfo.envVars?.length > 0}
            <div class="mt-3">
              <p class="mb-1 text-xs text-muted-foreground">Environment Variables</p>
              <div class="space-y-1">
                {#each runInfo.envVars as envVar}
                  <code class="block rounded bg-muted px-2 py-1 text-xs">{envVar}</code>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Jobs card (YAML structure, colored by act log results) -->
    <WorkflowJobs
      {workflowJobs}
      {jobGroups}
      loading={loadingWorkflowYaml}
      error={workflowYamlError}
      {actJobByName} />

    

    <!-- Payment Overview -->
    {#if prepaidAmount !== null}
      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="mb-3 text-lg font-semibold">{resolvedStatus === "pending" || resolvedStatus === "in_progress" || resolvedStatus === "running" || resolvedStatus === "queued" ? "Cost Estimate" : "Payment Receipt"}</h3>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-muted-foreground">Prepayment:</span>
            <span class="font-mono text-red-500">-{prepaidAmount.toLocaleString()} sats</span>
          </div>
          {#if changeAmount !== null}
            <div class="flex justify-between">
              <span class="text-muted-foreground">Change returned:</span>
              <span class="font-mono {changeAmount > 0 ? 'text-green-500' : 'text-muted-foreground'}">+{changeAmount.toLocaleString()} sats</span>
            </div>
          {:else if resolvedStatus === "pending" || resolvedStatus === "in_progress" || resolvedStatus === "running" || resolvedStatus === "queued"}
            <div class="flex justify-between">
              <span class="text-muted-foreground">Est. change:</span>
              <span class="font-mono text-green-500">pending</span>
            </div>
          {:else}
            <div class="flex justify-between">
              <span class="text-muted-foreground">Change returned:</span>
              <span class="font-mono text-muted-foreground">0 sats</span>
            </div>
          {/if}
          {#if actualCost !== null}
            <div class="flex justify-between border-t border-border pt-2 font-semibold">
              <span>Total cost:</span>
              <span class="font-mono">{actualCost.toLocaleString()} sats</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Workflow Logs (raw act log) -->
    {#if actLogContent || workflowLogInfo?.logUrl}
      <ConsoleOutput
        title="Workflow Logs"
        content={actLogContent}
        url={workflowLogInfo?.logUrl} />
    {/if}

    <ConsoleOutput title="stdout (loom)" content={loomStdout} url={loomStdoutUrl} />
    <ConsoleOutput title="stderr (loom)" content={loomStderr} url={loomStderrUrl} variant="error" />

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

          {#if loomJobEvent}
            <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <div class="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/40">
                <h4 class="text-xs font-semibold">Loom Job Request Event</h4>
                <p class="mt-0.5 text-xs text-muted-foreground">Kind: {loomJobEvent.kind} | ID: {loomJobEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-gray-50/50 p-3 font-mono text-xs dark:bg-gray-800/20">{JSON.stringify(loomJobEvent, null, 2)}</pre>
            </div>
          {/if}

          {#if loomStatusEvent}
            <div class="overflow-hidden rounded-lg border border-blue-200 dark:border-blue-800">
              <div class="border-b border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/40">
                <h4 class="text-xs font-semibold text-blue-900 dark:text-blue-300">Loom Job Status Event</h4>
                <p class="mt-0.5 text-xs text-blue-600 dark:text-blue-400">Kind: {loomStatusEvent.kind} | ID: {loomStatusEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-blue-50/50 p-3 font-mono text-xs dark:bg-blue-950/20">{JSON.stringify(loomStatusEvent, null, 2)}</pre>
            </div>
          {/if}

          {#if loomResultEvent}
            <div class="overflow-hidden rounded-lg border border-green-200 dark:border-green-800">
              <div class="border-b border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-950/40">
                <h4 class="text-xs font-semibold text-green-900 dark:text-green-300">Loom Job Result Event</h4>
                <p class="mt-0.5 text-xs text-green-600 dark:text-green-400">Kind: {loomResultEvent.kind} | ID: {loomResultEvent.id}</p>
              </div>
              <pre class="overflow-x-auto bg-green-50/50 p-3 font-mono text-xs dark:bg-green-950/20">{JSON.stringify(loomResultEvent, null, 2)}</pre>
            </div>
          {/if}

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
