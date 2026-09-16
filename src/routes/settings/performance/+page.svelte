<script lang="ts">
  import {onMount} from "svelte"
  import Button from "@lib/components/Button.svelte"
  import {DIAGNOSTICS_ENABLED, PERFORMANCE_DIAGNOSTICS_ENABLED} from "@app/core/feature-flags"
  import {
    DEBUG_DIAGNOSTIC_CATEGORIES,
    DEBUG_DIAGNOSTIC_PRESET_IDS,
    DEBUG_DIAGNOSTIC_PRESETS,
    clearDebugDiagnostics,
    debugDiagnosticsActive,
    debugDiagnosticsRevision,
    debugDiagnosticsSettings,
    ensureAppUpdateDebugDiagnosticsCapture,
    getDebugDiagnosticsOverview,
    getDebugDiagnosticsSnapshot,
    prepareDebugDiagnosticsArtifact,
    refreshDebugDiagnosticsSettings,
    setDebugDiagnosticCategoryEnabled,
    setDebugDiagnosticsPreset,
    startDebugDiagnosticsCapture,
    stopDebugDiagnosticsCapture,
    type DebugDiagnosticCategory,
    type DebugDiagnosticPreset,
  } from "@app/core/debug-diagnostics"
  import {
    publishDebugDiagnosticsArtifact,
    type DebugDiagnosticsPublishStage,
  } from "@app/core/debug-diagnostics-publish"
  import {
    activePerformanceDiagnosticsRun,
    armPerformanceDiagnosticsCapture,
    armedPerformanceDiagnosticsCapture,
    clearPerformanceDiagnostics,
    disarmPerformanceDiagnosticsCapture,
    getPerformanceDiagnosticsOverview,
    getPerformanceDiagnosticsSnapshot,
    performanceDiagnosticsRevision,
    preparePerformanceDiagnosticsArtifact,
    refreshArmedPerformanceDiagnosticsCapture,
  } from "@app/core/performance-diagnostics"
  import {
    publishPerformanceDiagnosticsArtifact,
    type PerformanceDiagnosticsPublishStage,
  } from "@app/core/performance-diagnostics-publish"

  let target = $state("/git")
  let error = $state("")
  let preparing = $state(false)
  let publishStage = $state<PerformanceDiagnosticsPublishStage | "idle" | "failed">("idle")
  let preparedArtifact = $state<Awaited<ReturnType<typeof preparePerformanceDiagnosticsArtifact>>>()
  let debugError = $state("")
  let debugPreparing = $state(false)
  let debugStopping = $state(false)
  let debugPublishStage = $state<DebugDiagnosticsPublishStage | "idle" | "failed">("idle")
  let preparedDebugArtifact = $state<Awaited<ReturnType<typeof prepareDebugDiagnosticsArtifact>>>()
  const overview = $derived.by(() => {
    void $performanceDiagnosticsRevision
    return getPerformanceDiagnosticsOverview()
  })
  const latest = $derived(overview.latest)
  const debugOverview = $derived.by(() => {
    void $debugDiagnosticsRevision
    return getDebugDiagnosticsOverview()
  })
  const debugCategoryCopy: Record<DebugDiagnosticCategory, {label: string; description: string}> = {
    "relay-normalization": {
      label: "Relay URL normalization",
      description: "Canonicalization outcomes, invalid inputs, and equivalent URL mismatches.",
    },
    "relay-scheduler": {
      label: "Relay scheduler and requests",
      description: "Bounded queue, subscription, owner, saturation, and timing snapshots.",
    },
    "publication-lifecycle": {
      label: "Publication lifecycle",
      description:
        "Destinations, acknowledgements, failures, timeouts, retries, and linked stages.",
    },
    "app-update": {
      label: "App update activation",
      description:
        "Enable to start recording service-worker discovery, version checks, activation requests, state changes, controller changes, and reload verification across a deploy.",
    },
  }

  onMount(() => {
    if (DIAGNOSTICS_ENABLED) refreshDebugDiagnosticsSettings()
    const armed = refreshArmedPerformanceDiagnosticsCapture()
    if (armed) target = armed.route
  })

  const normalizeTarget = () => {
    const value = target.trim()
    if (!value) throw new Error("Enter /git or an exact /c/... Community Home path")
    const pathname = value.startsWith("http") ? new URL(value).pathname : value
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
    if (normalized !== "/git" && !/^\/c\/[^/]+$/.test(normalized)) {
      throw new Error("Target must be /git or an exact /c/... Community Home path")
    }
    return normalized
  }

  const arm = () => {
    error = ""
    try {
      target = normalizeTarget()
      armPerformanceDiagnosticsCapture({
        route: target,
        preset: target === "/git" ? "git-root" : "community-home",
      })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const disarm = () => {
    disarmPerformanceDiagnosticsCapture()
    error = ""
  }

  const openTarget = () => {
    arm()
    if ($armedPerformanceDiagnosticsCapture) window.location.assign(target)
  }

  const clear = () => {
    preparedArtifact = undefined
    publishStage = "idle"
    error = ""
    clearPerformanceDiagnostics()
  }

  const download = async () => {
    preparing = true
    error = ""
    try {
      if (!latest || latest.status === "running") {
        throw new Error("Complete a capture before downloading")
      }
      const current = getPerformanceDiagnosticsSnapshot()
      const artifact = await preparePerformanceDiagnosticsArtifact(current, {runId: latest.id})
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(artifact.bytes).buffer], {type: artifact.contentType}),
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = artifact.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      preparing = false
    }
  }

  const publish = async () => {
    preparing = true
    error = ""
    publishStage = "preparing"
    try {
      const current = getPerformanceDiagnosticsSnapshot()
      const currentLatest = current.runs.at(-1)
      if (!currentLatest || currentLatest.status === "running") {
        throw new Error("Complete a capture before publishing")
      }
      preparedArtifact ||= await preparePerformanceDiagnosticsArtifact(current, {
        runId: currentLatest.id,
      })
      await publishPerformanceDiagnosticsArtifact({
        artifact: preparedArtifact,
        runId: currentLatest.id,
        routes: Array.from(new Set(current.runs.map(run => run.route))),
        onStage: stage => (publishStage = stage),
      })
    } catch (cause) {
      publishStage = "failed"
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      preparing = false
    }
  }

  const toggleDebugCategory = (category: DebugDiagnosticCategory, enabled: boolean) => {
    setDebugDiagnosticCategoryEnabled(category, enabled)
    if (category === "app-update" && enabled) ensureAppUpdateDebugDiagnosticsCapture()
  }

  const selectDebugPreset = (preset: DebugDiagnosticPreset) => {
    setDebugDiagnosticsPreset(preset)
  }

  const requireCompletedDebugSnapshot = () => {
    const snapshot = getDebugDiagnosticsSnapshot()
    if (snapshot.capture.active) throw new Error("Stop recording before preparing an artifact")
    if (!snapshot.capture.id || snapshot.records.length === 0) {
      throw new Error("Record debug information before preparing an artifact")
    }
    return snapshot
  }

  const downloadDebug = async () => {
    debugPreparing = true
    debugError = ""
    try {
      const snapshot = requireCompletedDebugSnapshot()
      const artifact = await prepareDebugDiagnosticsArtifact(snapshot, {
        runId: snapshot.capture.id,
      })
      preparedDebugArtifact = artifact
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(artifact.bytes).buffer], {type: artifact.contentType}),
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = artifact.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      debugError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      debugPreparing = false
    }
  }

  const publishDebug = async () => {
    debugPreparing = true
    debugError = ""
    debugPublishStage = "preparing"
    try {
      const snapshot = requireCompletedDebugSnapshot()
      const artifact = await prepareDebugDiagnosticsArtifact(snapshot, {
        runId: snapshot.capture.id,
      })
      preparedDebugArtifact = artifact
      await publishDebugDiagnosticsArtifact({
        artifact,
        runId: snapshot.capture.id,
        categories: snapshot.capture.enabledCategories,
        recordCount: snapshot.records.length,
        observationCount: Object.values(snapshot.capture.observationCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        onStage: stage => (debugPublishStage = stage),
      })
    } catch (cause) {
      debugPublishStage = "failed"
      debugError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      debugPreparing = false
    }
  }

  const clearDebug = () => {
    clearDebugDiagnostics()
    preparedDebugArtifact = undefined
    debugPublishStage = "idle"
    debugError = ""
  }

  const stopDebug = async () => {
    debugStopping = true
    debugError = ""
    try {
      await stopDebugDiagnosticsCapture()
    } catch (cause) {
      debugError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      debugStopping = false
    }
  }
</script>

<svelte:head><title>Diagnostics</title></svelte:head>

<div class="content column mx-auto max-w-3xl gap-6 py-8" data-perf="diagnostics-settings">
  <header class="column gap-2">
    <p class="font-mono text-xs uppercase tracking-widest opacity-60">Settings / Diagnostics</p>
    <h1 class="text-3xl font-bold">Diagnostics</h1>
    <p class="max-w-2xl opacity-75">
      Capture bounded performance measurements and opt-in debug evidence for later analysis.
    </p>
  </header>

  {#if !PERFORMANCE_DIAGNOSTICS_ENABLED}
    <section class="card2 border border-warning p-5">
      This build does not include performance diagnostics. Build with
      <code>VITE_PERFORMANCE_DIAGNOSTICS=1</code>.
    </section>
  {:else}
    <div class="column gap-2">
      <h2 class="text-2xl font-semibold">Performance measurements</h2>
      <p class="text-sm opacity-70">
        Arm one exact route before loading it. Capture starts during client bootstrap and stops when
        the route settles, or fails after 60 seconds.
      </p>
    </div>
    <section class="card2 column gap-4 border border-base-300 p-5" aria-label="Arm capture">
      <div>
        <h2 class="text-lg font-semibold">Next cold-start capture</h2>
        <p class="text-sm opacity-70">
          Use <code>/git</code>, a full test-site URL, or an exact <code>/c/naddr...</code> path.
        </p>
      </div>
      <label class="form-control gap-2">
        <span class="text-sm font-medium">Target route</span>
        <input
          class="input input-bordered w-full font-mono"
          bind:value={target}
          placeholder="/c/naddr1..." />
      </label>
      <div class="flex flex-wrap gap-2">
        <Button class="btn btn-primary btn-sm" onclick={arm}>Arm next launch</Button>
        <Button class="btn btn-secondary btn-sm" onclick={openTarget}>Arm and open now</Button>
        <Button
          class="btn btn-ghost btn-sm"
          disabled={!$armedPerformanceDiagnosticsCapture}
          onclick={disarm}>
          Disarm
        </Button>
      </div>
      {#if $armedPerformanceDiagnosticsCapture}
        <p class="rounded bg-base-200 p-3 font-mono text-xs" data-perf="armed-route">
          Armed: {$armedPerformanceDiagnosticsCapture.route}
        </p>
      {/if}
      <p class="text-xs opacity-60">
        For cold assets, arm the route, then clear the browser HTTP cache without clearing local
        storage before reopening the target. “Open now” measures a warm browser session.
      </p>
    </section>

    <section
      class="card2 column gap-4 border border-base-300 p-5"
      aria-label="Captured diagnostics">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Captured diagnostics</h2>
          <p class="text-sm opacity-70">
            Runs remain in this tab until cleared or the app is closed.
          </p>
        </div>
        {#if $activePerformanceDiagnosticsRun}
          <span class="badge badge-warning font-mono">recording</span>
        {/if}
      </div>

      {#if latest}
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="opacity-60">Route</dt>
            <dd class="break-all font-mono text-xs">{latest.route}</dd>
          </div>
          <div>
            <dt class="opacity-60">Status</dt>
            <dd>{latest.status}</dd>
          </div>
          <div>
            <dt class="opacity-60">Duration</dt>
            <dd>{latest.durationMs === undefined ? "-" : `${Math.round(latest.durationMs)} ms`}</dd>
          </div>
          <div>
            <dt class="opacity-60">Milestones</dt>
            <dd>{latest.milestones.length}</dd>
          </div>
        </dl>
        <details class="rounded bg-base-200 p-3">
          <summary class="cursor-pointer text-sm font-medium">Latest milestones</summary>
          <ol class="mt-3 space-y-1 font-mono text-xs">
            {#each latest.milestones as milestone}
              <li>{Math.round(milestone.elapsedMs)} ms · {milestone.name}</li>
            {/each}
          </ol>
        </details>
      {:else}
        <p class="rounded bg-base-200 p-4 text-sm opacity-70">
          No capture is available in this tab.
        </p>
      {/if}

      <div class="flex flex-wrap gap-2">
        <Button
          class="btn btn-neutral btn-sm"
          disabled={!latest || latest.status === "running" || preparing}
          onclick={download}>
          {preparing ? "Preparing..." : "Download"}
        </Button>
        <Button class="btn btn-secondary btn-sm" disabled={!latest || preparing} onclick={publish}>
          {publishStage === "failed" ? "Retry publish" : "Upload & publish"}
        </Button>
        <Button class="btn btn-ghost btn-sm" disabled={overview.runCount === 0} onclick={clear}>
          Clear
        </Button>
      </div>
      {#if publishStage !== "idle"}<p class="text-xs">Publication: {publishStage}</p>{/if}
      {#if error}<p class="text-sm text-error">{error}</p>{/if}
    </section>
  {/if}

  <div class="border-t border-base-300 pt-6">
    <h2 class="text-2xl font-semibold">Debug info</h2>
    <p class="mt-1 text-sm opacity-70">
      Record selected diagnostic classes in memory. All classes are off by default and records are
      bounded and sanitized.
    </p>
  </div>

  {#if !DIAGNOSTICS_ENABLED}
    <section class="card2 border border-warning p-5">
      This build does not include debug diagnostics. Build with
      <code>VITE_DIAGNOSTICS=1</code>.
    </section>
  {:else}
    <section class="card2 column gap-4 border border-base-300 p-5" aria-label="Debug info settings">
      <label class="form-control gap-2 rounded bg-base-200 p-3">
        <span class="font-medium">Capture capacity</span>
        <select
          class="select select-bordered w-full sm:max-w-xs"
          disabled={$debugDiagnosticsActive}
          value={$debugDiagnosticsSettings.preset}
          onchange={event => selectDebugPreset(event.currentTarget.value as DebugDiagnosticPreset)}>
          {#each DEBUG_DIAGNOSTIC_PRESET_IDS as preset}
            <option value={preset}>{DEBUG_DIAGNOSTIC_PRESETS[preset].label}</option>
          {/each}
        </select>
        <span class="text-sm opacity-65">
          Up to {DEBUG_DIAGNOSTIC_PRESETS[
            $debugDiagnosticsSettings.preset
          ].maxRecords.toLocaleString()} records total and {DEBUG_DIAGNOSTIC_PRESETS[
            $debugDiagnosticsSettings.preset
          ].maxRecordsPerCategory.toLocaleString()} stored record envelopes per category. Aggregate records
          can represent many observations. Choosing a smaller preset drops the oldest records immediately.
        </span>
      </label>

      <div class="column gap-3">
        {#each DEBUG_DIAGNOSTIC_CATEGORIES as category}
          <label
            class="flex cursor-pointer items-start justify-between gap-4 rounded bg-base-200 p-3">
            <span>
              <span class="block font-medium">{debugCategoryCopy[category].label}</span>
              <span class="block text-sm opacity-65"
                >{debugCategoryCopy[category].description}</span>
            </span>
            <input
              type="checkbox"
              class="toggle toggle-primary mt-1"
              disabled={$debugDiagnosticsActive || debugStopping}
              checked={$debugDiagnosticsSettings.categories[category]}
              onchange={event => toggleDebugCategory(category, event.currentTarget.checked)} />
          </label>
        {/each}
      </div>

      <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
        <div>
          <dt class="opacity-60">Status</dt>
          <dd>{debugStopping ? "Finishing" : $debugDiagnosticsActive ? "Recording" : "Stopped"}</dd>
        </div>
        <div>
          <dt class="opacity-60">Stored records</dt>
          <dd>{debugOverview.recordCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="opacity-60">Normalization</dt>
          <dd>{debugOverview.observationCounts["relay-normalization"].toLocaleString()} calls</dd>
          <dd class="text-xs opacity-60">
            {debugOverview.counts["relay-normalization"].toLocaleString()} batches
          </dd>
        </div>
        <div>
          <dt class="opacity-60">Scheduler</dt>
          <dd>{debugOverview.observationCounts["relay-scheduler"].toLocaleString()} signals</dd>
          <dd class="text-xs opacity-60">
            {debugOverview.counts["relay-scheduler"].toLocaleString()} records
          </dd>
        </div>
        <div>
          <dt class="opacity-60">Publications</dt>
          <dd>
            {debugOverview.observationCounts["publication-lifecycle"].toLocaleString()} events
          </dd>
          <dd class="text-xs opacity-60">
            {debugOverview.counts["publication-lifecycle"].toLocaleString()} records
          </dd>
        </div>
        <div>
          <dt class="opacity-60">App updates</dt>
          <dd>{debugOverview.observationCounts["app-update"].toLocaleString()} events</dd>
          <dd class="text-xs opacity-60">
            {debugOverview.counts["app-update"].toLocaleString()} records
          </dd>
        </div>
      </dl>

      <div class="flex flex-wrap gap-2">
        <Button
          class="btn btn-primary btn-sm"
          disabled={$debugDiagnosticsActive || debugStopping}
          onclick={() => startDebugDiagnosticsCapture()}>
          Start recording
        </Button>
        <Button
          class="btn btn-secondary btn-sm"
          disabled={!$debugDiagnosticsActive || debugStopping}
          onclick={stopDebug}>
          {debugStopping ? "Finishing..." : "Stop"}
        </Button>
        <Button
          class="btn btn-neutral btn-sm"
          disabled={$debugDiagnosticsActive ||
            debugStopping ||
            debugOverview.recordCount === 0 ||
            debugPreparing}
          onclick={downloadDebug}>
          {debugPreparing ? "Preparing..." : "Download"}
        </Button>
        <Button
          class="btn btn-secondary btn-sm"
          disabled={$debugDiagnosticsActive ||
            debugStopping ||
            debugOverview.recordCount === 0 ||
            debugPreparing}
          onclick={publishDebug}>
          {debugPublishStage === "failed" ? "Retry publish" : "Upload & publish"}
        </Button>
        <Button
          class="btn btn-ghost btn-sm"
          disabled={$debugDiagnosticsActive || debugStopping || debugOverview.recordCount === 0}
          onclick={clearDebug}>
          Clear
        </Button>
      </div>
      {#if preparedDebugArtifact}
        <p class="font-mono text-xs opacity-65">
          Artifact: {preparedDebugArtifact.bytes.length} bytes · {preparedDebugArtifact.encoding} ·
          {preparedDebugArtifact.sha256.slice(0, 12)}…
        </p>
      {/if}
      {#if debugPublishStage !== "idle"}
        <p class="text-xs">Publication: {debugPublishStage}</p>
      {/if}
      {#if debugError}<p class="text-sm text-error">{debugError}</p>{/if}
      <p class="text-xs opacity-60">
        Captures remain in this tab until cleared or the app is closed. Sensitive fields and relay
        query values are removed before records are retained. App update captures survive the
        activation reload in this tab so they can be stopped and uploaded afterward.
      </p>
    </section>
  {/if}
</div>
