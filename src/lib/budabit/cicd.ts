// ── Types ─────────────────────────────────────────────────────────────

export interface ActStep {
  name: string
  status: "success" | "failure" | "pending"
  logs: string[]
}

export interface ActJob {
  name: string
  status: "success" | "failure" | "pending"
  steps: ActStep[]
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
 * Parse act log output into per-job results with step-level status and logs.
 *
 * Log format: `[Workflow Name/Job Name] content`
 * - `⭐ Run <step>` → step start
 * - `  | <line>` → step output
 * - `✅  Success - <step>` → step success
 * - `❌  Failure - <step>` → step failure
 * - `🏁  Job succeeded/failed` → job result
 */
export function parseActLog(log: string): ActJob[] {
  const jobMap = new Map<string, ActJob>()
  const currentStep = new Map<string, ActStep>()

  for (const line of log.split("\n")) {
    const match = line.match(/^\[([^\]\/]+)\/([^\]]+)\]\s(.*)$/)
    if (!match) continue

    const jobName = match[2].trim()
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
      if (step) step.status = "success"
    } else if (content.includes("❌") && content.includes("Failure")) {
      const step = currentStep.get(jobName)
      if (step) step.status = "failure"
      job.status = "failure"
    } else if (content.includes("🏁")) {
      if (job.status !== "failure") {
        job.status = content.includes("succeeded") ? "success" : "failure"
      }
    }
  }

  return Array.from(jobMap.values())
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
