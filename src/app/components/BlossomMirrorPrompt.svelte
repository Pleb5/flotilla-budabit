<script lang="ts">
  import {goto} from "$app/navigation"
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {
    blossomDashboardState,
    getBlossomMirrorTargetGroupLabel,
    type BlossomMirrorJob,
    type BlossomMirrorTargetGroup,
    type BlossomUploadRecord,
  } from "@app/core/blossom"
  import {startBlossomMirrorJobs} from "@app/core/commands"
  import {clearModals} from "@app/util/modal"

  type Props = {
    uploadId?: string
    uploadIds?: string[]
  }

  const {uploadId, uploadIds = []}: Props = $props()

  type MirrorFileJob = {
    id: string
    name: string
    job: BlossomMirrorJob
  }

  type MirrorTargetSummary = {
    key: string
    targetGroup: BlossomMirrorTargetGroup
    targetLabel?: string
    targetUrl: string
    jobs: BlossomMirrorJob[]
    files: MirrorFileJob[]
    fileCount: number
    serverSideCount: number
    browserAssistCount: number
    status: BlossomMirrorJob["status"]
  }

  type MirrorTargetGroupSummary = {
    group: BlossomMirrorTargetGroup
    label: string
    targets: MirrorTargetSummary[]
  }

  const groupOrder: BlossomMirrorTargetGroup[] = [
    "current-community",
    "personal",
    "member-community",
    "last-resort",
    "manual",
  ]

  let starting = $state(false)
  let launched = $state(false)

  const promptUploadIds = $derived(
    Array.from(new Set([uploadId, ...uploadIds].filter((id): id is string => Boolean(id)))),
  )
  const records = $derived(
    $blossomDashboardState.uploads.filter(upload => promptUploadIds.includes(upload.id)),
  )
  const files = $derived(
    records.map((record, index) => ({
      id: record.id,
      name: getRecordFileName(record, index),
      url: record.canonical.url,
    })),
  )
  const mirrorTargetGroups = $derived.by((): MirrorTargetGroupSummary[] => {
    const summaries = new Map<
      string,
      Omit<MirrorTargetSummary, "fileCount" | "status"> & {
        fileIds: Set<string>
      }
    >()

    records.forEach((record, index) => {
      const fileName = getRecordFileName(record, index)

      for (const job of record.mirrorJobs) {
        const key = `${job.targetGroup}:${job.targetUrl}`
        const summary = summaries.get(key) || {
          key,
          targetGroup: job.targetGroup,
          targetLabel: job.targetLabel,
          targetUrl: job.targetUrl,
          jobs: [],
          files: [],
          fileIds: new Set<string>(),
          serverSideCount: 0,
          browserAssistCount: 0,
        }

        summary.jobs.push(job)
        summary.files.push({id: record.id, name: fileName, job})
        summary.fileIds.add(record.id)
        if (job.method === "server-mirror") summary.serverSideCount += 1
        if (job.method === "browser-upload") summary.browserAssistCount += 1
        summaries.set(key, summary)
      }
    })

    const targets = Array.from(summaries.values()).map(summary => ({
      ...summary,
      fileCount: summary.fileIds.size,
      status: getAggregateStatus(summary.jobs),
    }))
    const grouped = new Map<BlossomMirrorTargetGroup, MirrorTargetSummary[]>()

    for (const target of targets) {
      grouped.set(target.targetGroup, [...(grouped.get(target.targetGroup) || []), target])
    }

    return groupOrder.flatMap(group => {
      const groupTargets = grouped.get(group) || []

      return groupTargets.length > 0
        ? [
            {
              group,
              label: getBlossomMirrorTargetGroupLabel(group),
              targets: groupTargets,
            },
          ]
        : []
    })
  })
  const serverSideCount = $derived(
    records.flatMap(record => record.mirrorJobs).filter(
      job => job.method === "server-mirror" && job.status !== "succeeded",
    ).length,
  )
  const browserAssistCount = $derived(
    records.flatMap(record => record.mirrorJobs).filter(
      job => job.method === "browser-upload" && job.status !== "succeeded",
    ).length,
  )

  function getStatusClass(status: BlossomMirrorJob["status"]) {
    if (status === "succeeded") return "badge-success"
    if (status === "failed") return "badge-error"
    if (status === "running") return "badge-info"
    if (status === "skipped") return "badge-warning"

    return "badge-ghost"
  }

  function getTargetStatusClass(target: MirrorTargetSummary) {
    const statuses = target.jobs.map(job => job.status)

    if (statuses.some(status => status === "running")) return "badge-info"
    if (statuses.every(status => status === "succeeded")) return "badge-success"
    if (statuses.every(status => status === "failed")) return "badge-error"
    if (statuses.some(status => status === "failed")) return "badge-warning"
    if (statuses.some(status => status === "skipped")) return "badge-warning"

    return "badge-ghost"
  }

  function getAggregateStatus(jobs: BlossomMirrorJob[]): BlossomMirrorJob["status"] {
    if (jobs.some(job => job.status === "running")) return "running"
    if (jobs.every(job => job.status === "succeeded")) return "succeeded"
    if (jobs.some(job => job.status === "failed")) return "failed"
    if (jobs.some(job => job.status === "paused")) return "paused"
    if (jobs.some(job => job.status === "queued")) return "queued"
    if (jobs.some(job => job.status === "skipped")) return "skipped"

    return "queued"
  }

  function getRecordFileName(record: BlossomUploadRecord, index: number) {
    if (record.original?.name) return record.original.name

    try {
      const pathName = new URL(record.canonical.url).pathname
      const fileName = decodeURIComponent(pathName.split("/").filter(Boolean).at(-1) || "")

      if (fileName) return fileName
    } catch {
      // Fall through to the stable local label.
    }

    return `File ${index + 1}`
  }

  function getTargetMethodLabel(target: MirrorTargetSummary) {
    if (target.serverSideCount > 0 && target.browserAssistCount > 0) {
      return `${target.serverSideCount} server-side mirrors; ${target.browserAssistCount} require browser assist`
    }

    return target.browserAssistCount > 0
      ? "Upload-only mirror requires browser download"
      : "Server-side mirror available or likely available"
  }

  function getFileCountLabel(count: number) {
    return `${count} ${count === 1 ? "file" : "files"}`
  }

  function getStatusSummary(jobs: BlossomMirrorJob[]) {
    const labels: string[] = []

    for (const status of ["running", "succeeded", "failed", "skipped", "paused", "queued"] as const) {
      const count = jobs.filter(job => job.status === status).length

      if (count > 0) labels.push(`${count} ${status}`)
    }

    return labels.join(" · ")
  }

  function getShortError(error?: string) {
    if (!error) return ""

    return error.length > 120 ? `${error.slice(0, 117)}...` : error
  }

  async function startMirroring(browserAssist = false) {
    starting = true

    try {
      let started = false

      for (const record of records) {
        started = (await startBlossomMirrorJobs({uploadId: record.id, browserAssist})) || started
      }

      if (started) launched = true
    } finally {
      starting = false
    }
  }

  const openDashboard = () => {
    clearModals()
    void goto("/settings/blossom")
  }

  const mirrorWithoutDownload = () => startMirroring(false)

  const mirrorWithBrowserAssist = async () => {
    const ok = confirm(
      "Browser-assisted mirroring downloads the canonical files in this browser and uploads the exact bytes to upload-only targets. Continue?",
    )

    if (!ok) return

    await startMirroring(true)
  }
</script>

<ModalHeader>
  {#snippet title()}
    <div>{records.length > 1 ? "Mirror Blossom Uploads" : "Mirror Blossom Upload"}</div>
  {/snippet}
  {#snippet info()}
    <div>
      Mirroring copies the canonical Blossom files to other servers after publishing. Server-side
      mirrors do not download media into your browser. Failed files are skipped; other files
      continue mirroring.
    </div>
  {/snippet}
</ModalHeader>

{#if records.length > 0}
  <div class="column gap-4">
    <section class="column gap-2 rounded-box border border-base-300 p-3">
      <h2 class="font-semibold">Files</h2>
      {#each files as file (file.id)}
        <div class="rounded-box bg-base-200 p-3 text-sm">
          <div class="font-medium">{file.name}</div>
          <div class="break-all text-xs opacity-60">{file.url}</div>
        </div>
      {/each}
    </section>

    {#if mirrorTargetGroups.length > 0}
      <section class="column gap-3 rounded-box border border-base-300 p-3">
        <h2 class="font-semibold">Mirror targets</h2>
        {#each mirrorTargetGroups as group (group.group)}
          <section class="column gap-2">
            <h3 class="text-sm font-semibold opacity-80">{group.label}</h3>
            {#each group.targets as target (target.key)}
              <div class="rounded-box bg-base-200 p-3 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <div class="font-medium">{target.targetLabel || target.targetUrl}</div>
                  <span class={`badge ${getTargetStatusClass(target)}`}>{getStatusSummary(target.jobs)}</span>
                </div>
                <div class="mt-1 text-xs opacity-70">{getTargetMethodLabel(target)}</div>
                <div class="text-xs opacity-70">
                  {getFileCountLabel(target.fileCount)} for this target
                </div>
                <div class="break-all text-xs opacity-60">{target.targetUrl}</div>
                <div class="mt-2 divide-y divide-base-300 overflow-hidden rounded-box border border-base-300">
                  {#each target.files as file (file.id)}
                    <div class="grid gap-2 bg-base-100 p-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div class="min-w-0">
                        <div class="truncate font-medium">{file.name}</div>
                        {#if file.job.resultUrl}
                          <div class="truncate opacity-60" title={file.job.resultUrl}>{file.job.resultUrl}</div>
                        {:else if file.job.lastError}
                          <div class="text-error" title={file.job.lastError}>{getShortError(file.job.lastError)}</div>
                        {:else}
                          <div class="opacity-60">Waiting for mirror result.</div>
                        {/if}
                      </div>
                      <span class={`badge badge-sm ${getStatusClass(file.job.status)}`}>
                        {file.job.status}
                      </span>
                    </div>
                  {/each}
                </div>
                {#if target.jobs.some(job => job.status === "failed")}
                  <p class="mt-2 text-xs opacity-70">
                    Failed files were skipped for this target; other files can still finish.
                  </p>
                {/if}
                {#if target.jobs.some(job => job.status === "running")}
                  <p class="mt-2 text-xs opacity-70">
                    Mirroring is still running. This modal updates as jobs report progress.
                  </p>
                {/if}
              </div>
            {/each}
          </section>
        {/each}
      </section>
    {:else}
      <p class="text-sm opacity-70">No mirror targets were available for these uploads.</p>
    {/if}
  </div>

  {#if launched}
    <div class="mt-4 rounded-box border border-info/40 bg-info/10 p-3 text-sm text-base-content">
      Mirroring is running in the background. You can close this modal and manage uploads later from
      the Blossom dashboard.
    </div>
  {/if}

  <ModalFooter>
    <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button class="btn btn-ghost w-full sm:w-auto" onclick={clearModals}>Close</Button>
      <div class="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
        <Button class="btn btn-neutral w-full sm:w-auto" onclick={openDashboard}>
          Open Blossom dashboard
        </Button>
        {#if browserAssistCount > 0}
          <Button
            class="btn btn-warning w-full sm:w-auto"
            disabled={starting}
            onclick={mirrorWithBrowserAssist}>
            Browser-assisted mirror
          </Button>
        {/if}
        <Button
          class="btn btn-primary w-full sm:w-auto"
          disabled={starting || serverSideCount === 0}
          onclick={mirrorWithoutDownload}>
          {starting ? "Starting..." : "Mirror without download"}
        </Button>
      </div>
    </div>
  </ModalFooter>
{:else}
  <p class="text-sm opacity-70">These uploads are no longer in the local Blossom dashboard.</p>
  <ModalFooter>
    <Button class="btn btn-primary" onclick={clearModals}>Close</Button>
  </ModalFooter>
{/if}
