<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {
    blossomDashboardState,
    groupBlossomMirrorJobs,
    type BlossomMirrorJob,
  } from "@app/core/blossom"
  import {startBlossomMirrorJobs} from "@app/core/commands"
  import {clearModals} from "@app/util/modal"

  type Props = {
    uploadId: string
  }

  const {uploadId}: Props = $props()

  let starting = $state(false)

  const record = $derived($blossomDashboardState.uploads.find(upload => upload.id === uploadId))
  const groups = $derived(record ? groupBlossomMirrorJobs(record.mirrorJobs) : [])
  const serverSideCount = $derived(
    record?.mirrorJobs.filter(job => job.method === "server-mirror" && job.status !== "succeeded")
      .length || 0,
  )
  const browserAssistCount = $derived(
    record?.mirrorJobs.filter(job => job.method === "browser-upload" && job.status !== "succeeded")
      .length || 0,
  )

  const getStatusClass = (status: BlossomMirrorJob["status"]) => {
    if (status === "succeeded") return "badge-success"
    if (status === "failed") return "badge-error"
    if (status === "running") return "badge-info"
    if (status === "skipped") return "badge-warning"

    return "badge-ghost"
  }

  const getMethodLabel = (job: BlossomMirrorJob) =>
    job.method === "server-mirror"
      ? "Server-side mirror available or likely available"
      : "Upload-only mirror requires browser download"

  const mirrorWithoutDownload = async () => {
    starting = true

    try {
      await startBlossomMirrorJobs({uploadId})
    } finally {
      starting = false
    }
  }

  const mirrorWithBrowserAssist = async () => {
    const ok = confirm(
      "Browser-assisted mirroring downloads the canonical media in this browser and uploads the exact bytes to upload-only targets. Continue?",
    )

    if (!ok) return

    starting = true

    try {
      await startBlossomMirrorJobs({uploadId, browserAssist: true})
    } finally {
      starting = false
    }
  }
</script>

<ModalHeader>
  {#snippet title()}
    <div>Mirror Blossom Upload</div>
  {/snippet}
  {#snippet info()}
    <div>
      Mirroring copies the canonical Blossom file to other servers after publishing. Server-side
      mirrors do not download media into your browser.
    </div>
  {/snippet}
</ModalHeader>

{#if record}
  <div class="column gap-4">
    <div class="rounded-box bg-base-200 p-3 text-xs">
      <div class="font-semibold">Canonical file</div>
      <div class="break-all opacity-70">{record.canonical.url}</div>
    </div>

    {#if groups.length > 0}
      {#each groups as group}
        <section class="column gap-2 rounded-box border border-base-300 p-3">
          <h2 class="font-semibold">{group.label}</h2>
          {#each group.jobs as job}
            <div class="rounded-box bg-base-200 p-3 text-sm">
              <div class="flex items-center justify-between gap-2">
                <div class="font-medium">{job.targetLabel || job.targetUrl}</div>
                <span class={`badge ${getStatusClass(job.status)}`}>{job.status}</span>
              </div>
              <div class="mt-1 text-xs opacity-70">{getMethodLabel(job)}</div>
              <div class="break-all text-xs opacity-60">{job.targetUrl}</div>
              {#if job.lastError}
                <div class="mt-2 rounded bg-error/10 p-2 text-xs text-error">{job.lastError}</div>
              {/if}
            </div>
          {/each}
        </section>
      {/each}
    {:else}
      <p class="text-sm opacity-70">No mirror targets were available for this upload.</p>
    {/if}
  </div>

  <ModalFooter>
    <Button class="btn btn-ghost" onclick={clearModals}>Close</Button>
    <div class="row-2">
      {#if browserAssistCount > 0}
        <Button class="btn btn-warning" disabled={starting} onclick={mirrorWithBrowserAssist}>
          Browser-assisted mirror
        </Button>
      {/if}
      <Button
        class="btn btn-primary"
        disabled={starting || serverSideCount === 0}
        onclick={mirrorWithoutDownload}>
        {starting ? "Starting..." : "Mirror without download"}
      </Button>
    </div>
  </ModalFooter>
{:else}
  <p class="text-sm opacity-70">This upload is no longer in the local Blossom dashboard.</p>
  <ModalFooter>
    <Button class="btn btn-primary" onclick={clearModals}>Close</Button>
  </ModalFooter>
{/if}
