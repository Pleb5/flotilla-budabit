<script lang="ts">
  import {BLOSSOM_SERVERS, getListTags, getTagValues, makeEvent, tagger} from "@welshman/util"
  import {Router} from "@welshman/router"
  import {publishThunk, userBlossomServerList} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import InputList from "@lib/components/InputList.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import {
    activeCommunityBlossomServers,
    activeCommunityDefinition,
    activeMemberCommunityBlossomRefs,
  } from "@app/core/community-state"
  import {startBlossomMirrorJobs, uploadFile} from "@app/core/commands"
  import {
    blossomDashboardState,
    blossomSettings,
    buildBlossomServerGroups,
    clearBlossomCapabilityCache,
    clearBlossomUploadRecords,
    defaultBlossomSettings,
    flattenBlossomServerGroups,
    getBlossomMirrorTargetGroupLabel,
    groupBlossomMirrorJobs,
    removeBlossomUploadRecord,
    updateBlossomSettings,
    type BlossomBrowserMirrorConsent,
    type BlossomMirrorMode,
    type BlossomMirrorTargetGroup,
    type BlossomOptimizationMode,
    type BlossomServerTarget,
    type BlossomUploadStage,
  } from "@app/core/blossom"
  import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"
  import {DEFAULT_BLOSSOM_SERVERS} from "@app/core/state"
  import {clip, pushToast} from "@app/util/toast"

  type Tab = "dashboard" | "upload" | "servers" | "optimization" | "mirroring" | "advanced"

  const tabs: Array<{id: Tab; label: string}> = [
    {id: "dashboard", label: "Dashboard"},
    {id: "upload", label: "Upload"},
    {id: "servers", label: "Servers"},
    {id: "optimization", label: "Optimization"},
    {id: "mirroring", label: "Mirroring"},
    {id: "advanced", label: "Advanced"},
  ]
  const optimizationOptions: Array<{value: BlossomOptimizationMode; label: string; copy: string}> =
    [
      {
        value: "auto",
        label: "Auto",
        copy: "Use server-side media optimization when safe, otherwise fall back automatically.",
      },
      {
        value: "server",
        label: "Server optimize",
        copy: "Prefer Blossom /media optimization and fall back only when no safe optimizer is available.",
      },
      {
        value: "client",
        label: "Client compress",
        copy: "Compress compatible images in your browser before normal /upload.",
      },
      {value: "original", label: "Original", copy: "Upload the selected file bytes unchanged."},
    ]
  const mirrorModeOptions: Array<{value: BlossomMirrorMode; label: string; copy: string}> = [
    {value: "ask", label: "Ask after upload", copy: "Show a 20-second prompt after uploads."},
    {
      value: "server-side-only",
      label: "Server-side mirroring only",
      copy: "Never download canonical media into the browser for mirroring.",
    },
    {
      value: "always-selected",
      label: "Always mirror selected defaults",
      copy: "Automatically queue mirrors for selected target groups.",
    },
    {value: "never", label: "Never ask", copy: "Keep manual dashboard actions available."},
  ]
  const browserConsentOptions: Array<{
    value: BlossomBrowserMirrorConsent
    label: string
    copy: string
  }> = [
    {value: "ask", label: "Ask first", copy: "Warn before downloading canonical media."},
    {value: "allow", label: "Allow", copy: "Allow browser-assisted exact-byte mirrors."},
    {value: "deny", label: "Deny", copy: "Use server-side mirrors only."},
  ]
  const autoMirrorGroups: BlossomMirrorTargetGroup[] = [
    "current-community",
    "personal",
    "member-community",
    "last-resort",
  ]

  let activeTab = $state<Tab>("dashboard")
  let personalServers = $state(getTagValues("server", getListTags($userBlossomServerList)))
  let selectedUploadFile = $state<File | undefined>()
  let genericUploadStage = $state<BlossomUploadStage>("idle")
  let genericUploadError = $state("")
  let genericUploadResult = $state<{url: string; sha256?: string; uploadId?: string} | undefined>()

  const serverGroups = $derived(
    buildBlossomServerGroups({
      currentCommunity: {
        servers: $activeCommunityBlossomServers,
        communityPubkey: $activeCommunityDefinition?.pubkey,
        communityName: $activeCommunityDefinition?.pubkey
          ? `Community ${$activeCommunityDefinition.pubkey.slice(0, 8)}`
          : undefined,
      },
      personalServers,
      memberCommunities: $activeMemberCommunityBlossomRefs,
      lastResortServers: DEFAULT_BLOSSOM_SERVERS,
    }),
  )
  const groupedTargets = $derived([
    {label: "Current community servers", targets: serverGroups.currentCommunity},
    {label: "Your personal servers", targets: serverGroups.personal},
    {label: "Communities you are part of", targets: serverGroups.memberCommunities},
    {label: "Last-resort servers", targets: serverGroups.lastResort},
  ])
  const allTargets = $derived(flattenBlossomServerGroups(serverGroups))

  const formatBytes = (size?: number) => {
    if (!size) return "Unknown size"
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`

    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  const getCapabilityText = (target: BlossomServerTarget) => {
    const capability = $blossomDashboardState.capabilities[target.url]
    if (!capability) return "Not probed yet"

    return `upload: ${capability.upload}, mirror: ${capability.mirror}, media: ${capability.media}`
  }

  const savePersonalServers = () => {
    publishThunk({
      event: makeEvent(BLOSSOM_SERVERS, {tags: personalServers.map(tagger("server"))}),
      relays: Router.get().FromUser().getUrls(),
    })
    pushToast({message: "Personal Blossom servers saved."})
  }

  const resetPersonalServers = () => {
    personalServers = getTagValues("server", getListTags($userBlossomServerList))
  }

  const setOptimizationMode = (mode: BlossomOptimizationMode) =>
    updateBlossomSettings({optimizationMode: mode})

  const setMirrorMode = (mode: BlossomMirrorMode) => updateBlossomSettings({mirrorMode: mode})

  const setBrowserConsent = (consent: BlossomBrowserMirrorConsent) =>
    updateBlossomSettings({browserMirrorConsent: consent})

  const toggleAutoMirrorGroup = (group: BlossomMirrorTargetGroup, checked: boolean) => {
    const current = $blossomSettings.autoMirrorTargetGroups
    updateBlossomSettings({
      autoMirrorTargetGroups: checked
        ? Array.from(new Set([...current, group]))
        : current.filter(value => value !== group),
    })
  }

  const continueMirrors = async (uploadId: string) => {
    const started = await startBlossomMirrorJobs({uploadId})

    pushToast({
      message: started ? "Server-side mirroring started." : "No server-side mirror jobs to start.",
      theme: started ? "success" : "info",
    })
  }

  const uploadGenericFile = async () => {
    if (!selectedUploadFile) return

    genericUploadError = ""
    genericUploadResult = undefined

    const {error, result, uploadId} = await uploadFile(selectedUploadFile, {
      blossomContext: {type: "generic", label: "Dashboard"},
      blossomTargets: allTargets,
      onStage: stage => (genericUploadStage = stage),
    })

    if (error || !result?.url) {
      genericUploadError = error || "Upload failed."
      genericUploadStage = "failed"
      return
    }

    genericUploadResult = {url: result.url, sha256: result.sha256, uploadId}
    promptBlossomMirrorUpload(uploadId)
  }
</script>

<div class="content column gap-4">
  <div class="card2 bg-alt column gap-4 shadow-md">
    <div>
      <h1 class="text-2xl font-semibold">Blossom</h1>
      <p class="text-sm opacity-70">
        Manage Budabit uploads, personal Blossom servers, optimization, and mirroring policy.
      </p>
    </div>

    <div class="tabs-boxed tabs w-fit max-w-full overflow-x-auto">
      {#each tabs as tab}
        <button
          type="button"
          class="tab"
          class:tab-active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}>
          {tab.label}
        </button>
      {/each}
    </div>

    {#if activeTab === "dashboard"}
      <section class="column gap-3">
        <div>
          <h2 class="text-lg font-semibold">Recent uploads</h2>
          <p class="text-sm opacity-70">
            Local dashboard records for uploads Budabit performed on this device.
          </p>
        </div>
        {#if $blossomDashboardState.uploads.length === 0}
          <div class="rounded-box bg-base-200 p-4 text-sm opacity-70">No Blossom uploads yet.</div>
        {:else}
          {#each $blossomDashboardState.uploads as upload (upload.id)}
            <article class="column gap-3 rounded-box border border-base-300 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="font-semibold">
                    {upload.context.label || upload.context.type} upload
                  </div>
                  <div class="text-xs opacity-70">
                    {new Date(upload.createdAt).toLocaleString()} · {formatBytes(
                      upload.canonical.size,
                    )} ·
                    {upload.canonical.type || "unknown type"}
                  </div>
                </div>
                <span class="badge badge-ghost">{upload.optimizationMode} optimization</span>
              </div>
              <div class="rounded-box bg-base-200 p-3 text-xs">
                <div class="break-all">{upload.canonical.url}</div>
                <div class="mt-1 break-all opacity-60">sha256: {upload.canonical.sha256}</div>
              </div>
              {#each groupBlossomMirrorJobs(upload.mirrorJobs) as group}
                <div class="rounded-box bg-base-200 p-3 text-xs">
                  <div class="font-semibold">{group.label}</div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    {#each group.jobs as job}
                      <span class="badge badge-outline" title={job.lastError || job.targetUrl}>
                        {job.method === "server-mirror" ? "server" : "browser"}: {job.status}
                      </span>
                    {/each}
                  </div>
                </div>
              {/each}
              <div class="flex flex-wrap gap-2">
                <Button class="btn btn-primary btn-sm" onclick={() => continueMirrors(upload.id)}>
                  Continue/retry mirroring
                </Button>
                <Button class="btn btn-sm" onclick={() => clip(upload.canonical.url)}
                  >Copy URL</Button>
                <a class="btn btn-sm" href={upload.canonical.url} download>Download</a>
                <Button
                  class="btn btn-error btn-sm"
                  onclick={() => removeBlossomUploadRecord(upload.id)}>
                  Remove local record
                </Button>
              </div>
            </article>
          {/each}
        {/if}
      </section>
    {:else if activeTab === "upload"}
      <section class="column gap-4">
        <div>
          <h2 class="text-lg font-semibold">Upload a file</h2>
          <p class="text-sm opacity-70">
            Upload media or files to Blossom for sharing. This does not create or publish a Nostr
            post.
          </p>
        </div>
        <Field>
          {#snippet label()}<p>File</p>{/snippet}
          {#snippet input()}
            <input
              type="file"
              class="file-input file-input-bordered w-full"
              onchange={event => (selectedUploadFile = event.currentTarget.files?.[0])} />
          {/snippet}
          {#snippet info()}
            The same Blossom upload planner, optimization settings, and mirror prompt are used here.
          {/snippet}
        </Field>
        {#if selectedUploadFile}
          <div class="rounded-box bg-base-200 p-3 text-sm">
            <div class="font-medium">{selectedUploadFile.name}</div>
            <div class="text-xs opacity-70">
              {formatBytes(selectedUploadFile.size)} · {selectedUploadFile.type || "unknown type"}
            </div>
          </div>
        {/if}
        <BlossomUploadStatus stage={genericUploadStage} />
        {#if genericUploadError}
          <div class="rounded-box bg-error/10 p-3 text-sm text-error">{genericUploadError}</div>
        {/if}
        {#if genericUploadResult}
          <div class="column gap-2 rounded-box border border-success/30 bg-success/10 p-3 text-sm">
            <div class="font-semibold text-success">Upload ready</div>
            <div class="break-all">{genericUploadResult.url}</div>
            {#if genericUploadResult.sha256}
              <div class="break-all text-xs opacity-70">sha256: {genericUploadResult.sha256}</div>
            {/if}
            <div class="row-2">
              <Button class="btn btn-sm" onclick={() => clip(genericUploadResult!.url)}
                >Copy URL</Button>
              <a class="btn btn-sm" href={genericUploadResult.url} download>Download</a>
            </div>
          </div>
        {/if}
        <div class="row-2">
          <Button
            class="btn btn-primary"
            disabled={!selectedUploadFile}
            onclick={uploadGenericFile}>
            Upload to Blossom
          </Button>
          <Button class="btn btn-neutral" onclick={() => (activeTab = "dashboard")}>
            View dashboard
          </Button>
        </div>
      </section>
    {:else if activeTab === "servers"}
      <section class="column gap-4">
        <Field>
          {#snippet label()}<p>Personal servers</p>{/snippet}
          {#snippet input()}
            <InputList bind:value={personalServers}>
              {#snippet addLabel()}Add Server{/snippet}
            </InputList>
          {/snippet}
          {#snippet info()}
            These are your `kind:10063` Blossom servers. Budabit also reads them from Content
            Settings, so this is the same personal list in its new Blossom home.
          {/snippet}
        </Field>
        <div class="row-2">
          <Button class="btn btn-neutral" onclick={resetPersonalServers}
            >Discard server edits</Button>
          <Button class="btn btn-primary" onclick={savePersonalServers}
            >Save personal servers</Button>
        </div>

        {#each groupedTargets as group}
          <div class="column gap-2 rounded-box border border-base-300 p-3">
            <h2 class="font-semibold">{group.label}</h2>
            {#if group.targets.length === 0}
              <p class="text-sm opacity-60">No servers in this group.</p>
            {:else}
              {#each group.targets as target}
                <div class="rounded-box bg-base-200 p-3 text-sm">
                  <div class="break-all font-medium">{target.url}</div>
                  <div class="text-xs opacity-70">{target.label} · {getCapabilityText(target)}</div>
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </section>
    {:else if activeTab === "optimization"}
      <section class="column gap-3">
        <h2 class="text-lg font-semibold">Optimization</h2>
        <p class="text-sm opacity-70">
          Optimization affects only the first upload. Mirror targets always receive exact final
          bytes.
        </p>
        {#each optimizationOptions as option}
          <label class="rounded-box border border-base-300 p-3">
            <div class="flex items-center gap-3">
              <input
                type="radio"
                class="radio-primary radio"
                checked={$blossomSettings.optimizationMode === option.value}
                onchange={() => setOptimizationMode(option.value)} />
              <div>
                <div class="font-semibold">{option.label}</div>
                <div class="text-sm opacity-70">{option.copy}</div>
              </div>
            </div>
          </label>
        {/each}
      </section>
    {:else if activeTab === "mirroring"}
      <section class="column gap-4">
        <Field>
          {#snippet label()}<p>Prompt behavior</p>{/snippet}
          {#snippet input()}
            <select
              class="select select-bordered w-full"
              value={$blossomSettings.mirrorMode}
              onchange={event => setMirrorMode(event.currentTarget.value as BlossomMirrorMode)}>
              {#each mirrorModeOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {/snippet}
          {#snippet info()}
            {mirrorModeOptions.find(option => option.value === $blossomSettings.mirrorMode)?.copy}
          {/snippet}
        </Field>
        <Field>
          {#snippet label()}<p>Browser-assisted mirroring</p>{/snippet}
          {#snippet input()}
            <select
              class="select select-bordered w-full"
              value={$blossomSettings.browserMirrorConsent}
              onchange={event =>
                setBrowserConsent(event.currentTarget.value as BlossomBrowserMirrorConsent)}>
              {#each browserConsentOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {/snippet}
          {#snippet info()}
            Browser-assisted mirroring downloads canonical media in this browser before uploading
            exact bytes to upload-only servers.
          {/snippet}
        </Field>
        <FieldInline>
          {#snippet label()}<p>Prefer server-side mirroring</p>{/snippet}
          {#snippet input()}
            <input
              type="checkbox"
              class="toggle toggle-primary"
              checked={$blossomSettings.preferServerSideMirroring}
              onchange={event =>
                updateBlossomSettings({preferServerSideMirroring: event.currentTarget.checked})} />
          {/snippet}
          {#snippet info()}
            Try Blossom `/mirror` first so your browser does not need to download and re-upload
            media.
          {/snippet}
        </FieldInline>
        <div class="column gap-2">
          <h3 class="font-semibold">Auto-mirror target groups</h3>
          <p class="text-sm opacity-70">Used when the mirror mode automatically queues defaults.</p>
          {#each autoMirrorGroups as group}
            <label class="flex items-center gap-3 rounded-box bg-base-200 p-3">
              <input
                type="checkbox"
                class="checkbox-primary checkbox"
                checked={$blossomSettings.autoMirrorTargetGroups.includes(group)}
                onchange={event => toggleAutoMirrorGroup(group, event.currentTarget.checked)} />
              <span>{getBlossomMirrorTargetGroupLabel(group)}</span>
            </label>
          {/each}
        </div>
      </section>
    {:else if activeTab === "advanced"}
      <section class="column gap-4">
        <h2 class="text-lg font-semibold">Advanced</h2>
        <p class="text-sm opacity-70">
          These actions affect local Budabit Blossom state only. They do not delete media from
          Blossom servers.
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <Button class="btn btn-neutral" onclick={clearBlossomCapabilityCache}>
            Clear capability cache
          </Button>
          <Button class="btn btn-neutral" onclick={clearBlossomUploadRecords}>
            Clear upload history
          </Button>
          <Button
            class="btn btn-neutral"
            onclick={() =>
              clip(JSON.stringify({settings: $blossomSettings, targets: allTargets}, null, 2))}>
            Copy diagnostics
          </Button>
          <Button
            class="btn btn-error"
            onclick={() => updateBlossomSettings(defaultBlossomSettings)}>
            Reset Blossom settings
          </Button>
        </div>
      </section>
    {/if}
  </div>
</div>
