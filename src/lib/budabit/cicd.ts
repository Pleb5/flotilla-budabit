// ── Types ─────────────────────────────────────────────────────────────

export interface ActStep {
  name: string
  status: "success" | "failure" | "pending"
  logs: string[]
  durationMs?: number
}

export interface ActJob {
  name: string
  status: "success" | "failure" | "pending"
  steps: ActStep[]
  durationMs?: number
}

export interface WorkflowStep {
  name: string
  uses?: string
  run?: string
}

export interface WorkflowJob {
  id: string
  name: string
  runsOn: string
  needs: string[]
  steps: WorkflowStep[]
}

export interface JobGroup {
  jobs: WorkflowJob[]
}

// ── Parsing ──────────────────────────────────────────────────────────

/**
 * Normalize act job name: strip the trailing `-N` runner index and whitespace padding.
 * e.g. "Build .ipk (aarch64_cortex-a53)-1            " → "Build .ipk (aarch64_cortex-a53)"
 */
function normalizeJobName(raw: string): string {
  return raw.trim().replace(/-\d+$/, "")
}

/**
 * Parse act duration string like "[59.711076117s]", "[1m0.816079886s]", "[9.871364ms]".
 * Returns duration in milliseconds, or undefined if unparseable.
 */
function parseActDuration(text: string): number | undefined {
  const match = text.match(/\[(?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\]/)
  if (!match) return undefined
  const minutes = match[1] ? parseInt(match[1]) : 0
  const value = parseFloat(match[2])
  const unit = match[3]
  if (unit === "ms") return Math.round(minutes * 60000 + value)
  return Math.round((minutes * 60 + value) * 1000)
}

/**
 * Parse act log output into per-job results with step-level status and logs.
 *
 * Log format: `[Workflow Name/Job Name] content`
 * - `⭐ Run <step>` → step start
 * - `  | <line>` → step output
 * - `✅  Success - <step> [duration]` → step success
 * - `❌  Failure - <step> [duration]` → step failure
 * - `🏁  Job succeeded/failed` → job result
 */
export function parseActLog(log: string): ActJob[] {
  const jobMap = new Map<string, ActJob>()
  const currentStep = new Map<string, ActStep>()

  for (const line of log.split("\n")) {
    const match = line.match(/^\[([^\]\/]+)\/([^\]]+)\]\s(.*)$/)
    if (!match) continue

    const jobName = normalizeJobName(match[2])
    const content = match[3]

    if (!jobMap.has(jobName)) {
      jobMap.set(jobName, {name: jobName, status: "pending", steps: []})
    }
    const job = jobMap.get(jobName)!

    if (content.includes("⭐ Run ")) {
      const stepName = content.slice(content.indexOf("⭐ Run ") + "⭐ Run ".length).trim()
      const step: ActStep = {name: stepName, status: "pending", logs: []}
      job.steps.push(step)
      currentStep.set(jobName, step)
    } else if (/^\s+\| /.test(content)) {
      currentStep.get(jobName)?.logs.push(content.replace(/^\s+\| /, ""))
    } else if (content.includes("✅") && content.includes("Success")) {
      const step = currentStep.get(jobName)
      if (step) {
        step.status = "success"
        step.durationMs = parseActDuration(content)
      }
    } else if (content.includes("❌") && content.includes("Failure")) {
      const step = currentStep.get(jobName)
      if (step) {
        step.status = "failure"
        step.durationMs = parseActDuration(content)
      }
      job.status = "failure"
    } else if (content.includes("🏁")) {
      if (content.includes("succeeded")) {
        if (job.status !== "failure") job.status = "success"
      } else {
        job.status = "failure"
      }
    }
  }

  // Compute job durations from step durations
  for (const job of jobMap.values()) {
    const total = job.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
    if (total > 0) job.durationMs = total
  }

  return Array.from(jobMap.values())
}

/**
 * Group matrix-expanded act jobs by base name.
 * "Build .ipk (aarch64_cortex-a53)" and "Build .ipk (x86_64)" → group "Build .ipk"
 * Non-matrix jobs stay as single-variant groups.
 */
export interface MatrixGroup {
  baseName: string
  variants: {label: string; actJob: ActJob}[]
}

export function groupMatrixJobs(jobs: ActJob[]): MatrixGroup[] {
  const groupMap = new Map<string, {label: string; actJob: ActJob}[]>()
  const groupOrder: string[] = []

  for (const job of jobs) {
    const match = job.name.match(/^(.+?)\s*\(([^)]+)\)$/)
    const baseName = match ? match[1].trim() : job.name
    const variantLabel = match ? match[2] : ""

    if (!groupMap.has(baseName)) {
      groupMap.set(baseName, [])
      groupOrder.push(baseName)
    }
    groupMap.get(baseName)!.push({label: variantLabel, actJob: job})
  }

  return groupOrder.map(name => ({
    baseName: name,
    variants: groupMap.get(name)!,
  }))
}

/**
 * Group workflow jobs by dependency level for horizontal flow display.
 * Level 0 = no needs, Level N = all needs are in earlier levels.
 */
export function getJobGroups(jobs: WorkflowJob[]): JobGroup[] {
  if (jobs.length === 0) return []

  const assigned = new Set<string>()
  const groups: JobGroup[] = []

  while (assigned.size < jobs.length) {
    const group: WorkflowJob[] = []
    for (const job of jobs) {
      if (assigned.has(job.id)) continue
      if (job.needs.every(n => assigned.has(n))) group.push(job)
    }
    if (group.length === 0) {
      groups.push({jobs: jobs.filter(j => !assigned.has(j.id))})
      break
    }
    group.forEach(j => assigned.add(j.id))
    groups.push({jobs: group})
  }

  return groups
}
