<script lang="ts">
  import {getContext} from "svelte"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {nip19} from "nostr-tools"
  import {load} from "@welshman/net"
  import {pubkey, signer} from "@welshman/app"
  import {getTagValue} from "@welshman/util"
  import {Button, toast} from "@nostr-git/ui"
  import {
    Shield,
    ChevronDown,
    ChevronRight,
    Check,
    AlertTriangle,
    AlertCircle,
    Copy,
    Settings,
    X,
  } from "@lucide/svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, effectiveMaintainersByRepoAddress} from "@lib/budabit/state"
  import {CICD_RELAYS, CICD_PUBLISH_RELAYS} from "@lib/budabit/constants"
  import {
    type ReleaseArtifact,
    type ArtifactGroup,
    validateHash,
    groupArtifacts,
    createSignedReleaseTemplate,
    resolveNip51List,
  } from "@lib/budabit/releases"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  if (!repoClass) throw new Error("Repo context not available")

  const {relay, id} = $page.params

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

  // ── State ──────────────────────────────────────────────────────────
  let filterJson = $state(JSON.stringify({kinds: [1063]}, null, 2))
  let groupByTags = $state<string[]>(["filename"])
  let nip51Input = $state("")
  let workflowRuns = $state<Map<string, any>>(new Map())
  let releaseEvents = $state<any[]>([])
  let loading = $state(false)
  let expandedGroups = $state<Set<string>>(new Set())
  let selectedArtifacts = $state<Set<string>>(new Set())
  let showConfig = $state(false)
  let newTagInput = $state("")
  let publishing = $state(false)

  // ── Maintainers ────────────────────────────────────────────────────
  const trustedNpubs = $derived.by(() => {
    if (!repoNaddr) return new Set<string>()
    const maintainers = $effectiveMaintainersByRepoAddress.get(repoNaddr)
    return maintainers ?? new Set<string>()
  })

  // ── Derived ────────────────────────────────────────────────────────
  const artifacts = $derived.by((): ReleaseArtifact[] => {
    return releaseEvents
      .map(event => {
        const hash = getTagValue("x", event.tags)
        if (!hash || !validateHash(hash)) return null
        const publisherRun = workflowRuns.get(event.pubkey)
        if (!publisherRun) return null

        return {
          event,
          hash,
          filename: getTagValue("filename", event.tags) ?? "unknown",
          triggeredBy: getTagValue("triggered-by", publisherRun.tags) ?? "",
          ephemeralPubkey: event.pubkey,
          workflow: getTagValue("workflow", publisherRun.tags) ?? "",
          branch: getTagValue("branch", publisherRun.tags) ?? "",
          tags: Object.fromEntries(event.tags.map((t: string[]) => [t[0], t[1]])),
        } satisfies ReleaseArtifact
      })
      .filter((a): a is ReleaseArtifact => a !== null)
  })

  const groups = $derived.by(() => groupArtifacts(artifacts, groupByTags))

  // ── State persistence ──────────────────────────────────────────────
  const storageKey = $derived(repoClass ? `releaseFilters:${repoClass.key}` : "")

  onMount(async () => {
    // Restore persisted state
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const data = JSON.parse(raw)
          if (data.filterJson) filterJson = data.filterJson
          if (Array.isArray(data.groupByTags)) groupByTags = data.groupByTags
        }
      } catch {
        // ignore
      }
    }

    // Load workflow runs
    await loadData()
  })

  $effect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({filterJson, groupByTags}))
    } catch {
      // ignore
    }
  })

  // ── Data loading ───────────────────────────────────────────────────
  async function loadData() {
    if (!repoNaddr) return
    loading = true

    try {
      // Phase 1: Load workflow runs (kind 5401) to discover ephemeral pubkeys
      const runs = await load({
        relays: CICD_RELAYS,
        filters: [{kinds: [5401], "#a": [repoNaddr]}],
      })

      // Build two indexes from trusted runs:
      //   publisherMap: ephemeralPubkey → run event  (for author-signed artifacts)
      //   runIdMap:     runEventId      → run event  (for e-tag-linked artifacts)
      const publisherMap = new Map<string, any>()
      const runIdMap = new Map<string, any>()
      for (const run of runs) {
        const triggeredBy = getTagValue("triggered-by", run.tags)
        const publisher = getTagValue("publisher", run.tags)
        if (triggeredBy && trustedNpubs.has(triggeredBy)) {
          if (publisher) publisherMap.set(publisher, run)
          runIdMap.set(run.id, run)
        }
      }
      workflowRuns = publisherMap

      let parsedFilter: any = {kinds: [1063]}
      try {
        parsedFilter = JSON.parse(filterJson)
      } catch {
        // use default
      }

      const publishers = Array.from(publisherMap.keys())
      const runIds = Array.from(runIdMap.keys())

      if (publishers.length === 0 && runIds.length === 0) {
        releaseEvents = []
      } else {
        // Phase 2: fetch via both trust paths in parallel, deduplicate by event id
        const filters = []
        if (publishers.length > 0) {
          filters.push({...parsedFilter, authors: publishers})
        }
        if (runIds.length > 0) {
          // Artifacts that embed an e-tag referencing the trusted run event
          filters.push({...parsedFilter, "#e": runIds})
        }

        const results = await Promise.all(
          filters.map(f => load({relays: CICD_RELAYS, filters: [f]}))
        )

        const seen = new Set<string>()
        const merged: any[] = []
        for (const batch of results) {
          for (const e of batch) {
            if (!seen.has(e.id)) {
              seen.add(e.id)
              merged.push(e)
            }
          }
        }

        // For e-tag-linked events, backfill workflowRuns so provenance renders correctly
        for (const e of merged) {
          if (!publisherMap.has(e.pubkey)) {
            const eTag = e.tags.find((t: string[]) => t[0] === "e")?.[1]
            if (eTag && runIdMap.has(eTag)) {
              publisherMap.set(e.pubkey, runIdMap.get(eTag))
            }
          }
        }
        workflowRuns = publisherMap

        releaseEvents = merged.filter((e: any) => {
          const hash = getTagValue("x", e.tags)
          return hash && validateHash(hash)
        })
      }
    } finally {
      loading = false
    }
  }

  // ── NIP-51 resolution ──────────────────────────────────────────────
  async function addNip51Trusted() {
    if (!nip51Input.trim()) return
    try {
      const extra = await resolveNip51List(nip51Input.trim(), CICD_RELAYS)
      // Reload with expanded trusted set handled via re-fetch
      nip51Input = ""
      toast.success(`Resolved ${extra.length} trusted pubkeys from list`)
      await loadData()
    } catch {
      toast.error("Failed to resolve NIP-51 list")
    }
  }

  // ── UI helpers ─────────────────────────────────────────────────────
  function toggleGroup(key: string) {
    const next = new Set(expandedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedGroups = next
  }

  function toggleArtifact(eventId: string) {
    const next = new Set(selectedArtifacts)
    if (next.has(eventId)) next.delete(eventId)
    else next.add(eventId)
    selectedArtifacts = next
  }

  function selectGroupArtifacts(group: ArtifactGroup) {
    const next = new Set(selectedArtifacts)
    // Select the consensus hash artifacts for this group
    if (group.consensusHash) {
      const best = group.hashCounts.get(group.consensusHash) ?? []
      // Select one per group (the first/most recent)
      if (best.length > 0) {
        next.add(best[0].event.id)
      }
    }
    selectedArtifacts = next
  }

  function addGroupByTag() {
    const tag = newTagInput.trim()
    if (tag && !groupByTags.includes(tag)) {
      groupByTags = [...groupByTags, tag]
    }
    newTagInput = ""
  }

  function removeGroupByTag(tag: string) {
    groupByTags = groupByTags.filter(t => t !== tag)
    if (groupByTags.length === 0) groupByTags = ["filename"]
  }

  function truncateHash(hash: string) {
    return `${hash.slice(0, 8)}…${hash.slice(-8)}`
  }

  function truncatePubkey(pk: string) {
    return `${pk.slice(0, 8)}…`
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied!")
    } catch {
      toast.error("Copy failed")
    }
  }

  function formatTime(ts: number) {
    return new Date(ts * 1000).toLocaleString()
  }

  function getConsensusStatus(group: ArtifactGroup): "unanimous" | "majority" | "split" {
    if (group.isUnanimous) return "unanimous"
    if (!group.consensusHash) return "split"
    const top = group.hashCounts.get(group.consensusHash)?.length ?? 0
    if (top / group.totalCount > 0.5) return "majority"
    return "split"
  }

  // ── Sign & Publish ─────────────────────────────────────────────────
  async function signAndPublish() {
    if (!$signer || !$pubkey) {
      toast.error("Please log in to sign releases")
      return
    }

    const toSign = artifacts.filter(a => selectedArtifacts.has(a.event.id))
    if (toSign.length === 0) return

    publishing = true
    try {
      for (const artifact of toSign) {
        const unsigned = createSignedReleaseTemplate(artifact.event)
        const signed = await $signer.sign(unsigned)
        const {publishThunk} = await import("@welshman/app")
        const thunk = publishThunk({
          relays: CICD_PUBLISH_RELAYS,
          event: signed,
        })
        await thunk.result
      }
      toast.success(`Signed ${toSign.length} release artifact(s)`)
      selectedArtifacts = new Set()
    } catch (e) {
      toast.error(`Failed to sign: ${e}`)
    } finally {
      publishing = false
    }
  }
</script>

<svelte:head>
  <title>{repoClass.name} - Releases</title>
</svelte:head>

<div class="space-y-4">
  <!-- Header -->
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Release Signing</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">
          Verify and co-sign release artifacts from CI builds
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onclick={() => (showConfig = !showConfig)}
          class="gap-2">
          <Settings class="h-4 w-4" />
          <span class="max-sm:hidden">Configure</span>
        </Button>
        <Button
          variant="git"
          size="sm"
          onclick={signAndPublish}
          disabled={selectedArtifacts.size === 0 || !$pubkey || publishing}
          class="gap-2">
          <Shield class="h-4 w-4" />
          {publishing ? "Signing…" : `Sign Selected (${selectedArtifacts.size})`}
        </Button>
      </div>
    </div>
  </div>

  <!-- Configuration Panel -->
  {#if showConfig}
    <div class="space-y-4 rounded-lg border border-border bg-card p-4">
      <!-- Event Filter -->
      <div class="space-y-2">
        <label class="text-sm font-medium">Event Filter (Nostr subscription filter JSON)</label>
        <textarea
          bind:value={filterJson}
          rows={4}
          class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          placeholder={`{"kinds": [1063]}`}></textarea>
      </div>

      <!-- Group By Tags -->
      <div class="space-y-2">
        <label class="text-sm font-medium">Group artifacts by tag</label>
        <div class="flex flex-wrap gap-2">
          {#each groupByTags as tag (tag)}
            <span
              class="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-medium">
              {tag}
              {#if groupByTags.length > 1}
                <button
                  onclick={() => removeGroupByTag(tag)}
                  class="ml-1 hover:text-destructive">
                  <X class="h-3 w-3" />
                </button>
              {/if}
            </span>
          {/each}
          <div class="flex items-center gap-1">
            <input
              bind:value={newTagInput}
              type="text"
              placeholder="Add tag…"
              class="rounded-md border border-input bg-background px-2 py-1 text-xs"
              onkeydown={e => e.key === "Enter" && addGroupByTag()} />
            <Button size="sm" variant="outline" onclick={addGroupByTag} class="text-xs">Add</Button>
          </div>
        </div>
      </div>

      <!-- Trusted NPubs (NIP-51) -->
      <div class="space-y-2">
        <label class="text-sm font-medium">Additional Trusted Signers (NIP-51 list address)</label>
        <div class="flex gap-2">
          <input
            bind:value={nip51Input}
            type="text"
            placeholder="naddr1… or d-tag identifier"
            class="grow rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <Button size="sm" variant="outline" onclick={addNip51Trusted}>Resolve</Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Currently trusting {trustedNpubs.size} maintainer(s) from repository announcement.
        </p>
      </div>

      <div class="flex justify-end">
        <Button size="sm" variant="git" onclick={loadData}>Reload Artifacts</Button>
      </div>
    </div>
  {/if}

  <!-- Loading state -->
  {#if loading}
    <div class="flex items-center justify-center py-12 text-muted-foreground">
      <span class="text-sm">Loading release artifacts…</span>
    </div>

  <!-- Empty state -->
  {:else if groups.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Shield class="mb-3 h-8 w-8 opacity-50" />
      <p class="text-sm font-medium">No release artifacts found</p>
      <p class="mt-1 text-xs">
        {#if trustedNpubs.size === 0}
          No trusted maintainers found for this repository.
        {:else}
          No kind 1063 events from trusted CI runs. Check the event filter or run a release workflow.
        {/if}
      </p>
      {#if showConfig}
        <!-- already showing config -->
      {:else}
        <Button size="sm" variant="outline" class="mt-3" onclick={() => (showConfig = true)}>
          Open Configuration
        </Button>
      {/if}
    </div>

  <!-- Artifact groups -->
  {:else}
    <div class="space-y-2">
      {#each groups as group (group.key)}
        {@const status = getConsensusStatus(group)}
        {@const isExpanded = expandedGroups.has(group.key)}

        <div class="rounded-lg border border-border bg-card">
          <!-- Group header -->
          <button
            class="flex w-full items-center gap-3 p-4 text-left"
            onclick={() => toggleGroup(group.key)}>
            <!-- Consensus icon -->
            <div class="flex-shrink-0">
              {#if status === "unanimous"}
                <Check class="h-5 w-5 text-green-500" />
              {:else if status === "majority"}
                <AlertTriangle class="h-5 w-5 text-yellow-500" />
              {:else}
                <AlertCircle class="h-5 w-5 text-red-500" />
              {/if}
            </div>

            <!-- Group label -->
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                {#each Object.entries(group.labels) as [tag, val] (tag)}
                  <span class="font-medium">{val}</span>
                  <span class="text-xs text-muted-foreground">({tag})</span>
                {/each}
              </div>
              <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                {#if status === "unanimous"}
                  <span class="text-green-600">{group.totalCount}/{group.totalCount} builds agree</span>
                {:else if status === "majority"}
                  {@const topCount = group.consensusHash ? (group.hashCounts.get(group.consensusHash)?.length ?? 0) : 0}
                  <span class="text-yellow-600">{topCount}/{group.totalCount} builds agree</span>
                {:else}
                  <span class="text-red-600">No consensus — {group.hashCounts.size} different hashes</span>
                {/if}
                {#if group.consensusHash}
                  <span>·</span>
                  <span class="font-mono">{truncateHash(group.consensusHash)}</span>
                  <button
                    onclick={e => { e.stopPropagation(); copyToClipboard(group.consensusHash!) }}
                    class="hover:text-foreground">
                    <Copy class="h-3 w-3" />
                  </button>
                {/if}
              </div>
            </div>

            <!-- Select button -->
            {#if status !== "split"}
              <button
                class="flex-shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                onclick={e => { e.stopPropagation(); selectGroupArtifacts(group) }}>
                Select
              </button>
            {/if}

            <!-- Expand chevron -->
            <div class="flex-shrink-0 text-muted-foreground">
              {#if isExpanded}
                <ChevronDown class="h-4 w-4" />
              {:else}
                <ChevronRight class="h-4 w-4" />
              {/if}
            </div>
          </button>

          <!-- Expanded: individual artifacts -->
          {#if isExpanded}
            <div class="border-t border-border">
              {#each [...group.hashCounts.entries()] as [hash, arts] (hash)}
                <div class="px-4 py-3">
                  <div class="mb-2 flex items-center gap-2 text-xs">
                    <span class="font-mono text-muted-foreground">{truncateHash(hash)}</span>
                    <button onclick={() => copyToClipboard(hash)} class="hover:text-foreground">
                      <Copy class="h-3 w-3" />
                    </button>
                    <span class="text-muted-foreground">— {arts.length} build(s)</span>
                    {#if hash === group.consensusHash && group.isUnanimous}
                      <span class="rounded-full bg-green-500/10 px-2 py-0.5 text-green-600">unanimous</span>
                    {:else if hash === group.consensusHash}
                      <span class="rounded-full bg-yellow-500/10 px-2 py-0.5 text-yellow-600">majority</span>
                    {:else}
                      <span class="rounded-full bg-red-500/10 px-2 py-0.5 text-red-600">minority</span>
                    {/if}
                  </div>

                  <div class="space-y-2">
                    {#each arts as artifact (artifact.event.id)}
                      <div class="flex items-start gap-3 rounded-md bg-muted/30 p-3 text-xs">
                        <!-- Checkbox -->
                        <input
                          type="checkbox"
                          checked={selectedArtifacts.has(artifact.event.id)}
                          onchange={() => toggleArtifact(artifact.event.id)}
                          class="mt-0.5 flex-shrink-0" />

                        <!-- Artifact details -->
                        <div class="min-w-0 flex-1 space-y-1">
                          <div class="flex flex-wrap gap-3 text-muted-foreground">
                            <span>
                              <span class="font-medium text-foreground">Ephemeral key:</span>
                              <span class="font-mono">{truncatePubkey(artifact.ephemeralPubkey)}</span>
                            </span>
                            {#if artifact.triggeredBy}
                              <span>
                                <span class="font-medium text-foreground">Triggered by:</span>
                                <span class="font-mono">{truncatePubkey(artifact.triggeredBy)}</span>
                              </span>
                            {/if}
                            {#if artifact.workflow}
                              <span>
                                <span class="font-medium text-foreground">Workflow:</span>
                                {artifact.workflow}
                              </span>
                            {/if}
                            {#if artifact.branch}
                              <span>
                                <span class="font-medium text-foreground">Branch:</span>
                                {artifact.branch}
                              </span>
                            {/if}
                            <span>
                              <span class="font-medium text-foreground">At:</span>
                              {formatTime(artifact.event.created_at)}
                            </span>
                          </div>
                          {#if artifact.tags.url}
                            <div class="truncate text-muted-foreground">
                              <span class="font-medium text-foreground">URL:</span>
                              <a
                                href={artifact.tags.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="hover:underline">{artifact.tags.url}</a>
                            </div>
                          {/if}
                          {#if !artifact.triggeredBy}
                            <div class="text-yellow-600">⚠ Unverified origin — no kind 5401 link</div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Summary bar -->
    {#if selectedArtifacts.size > 0}
      <div class="sticky bottom-4 flex items-center justify-between rounded-lg border border-border bg-card p-3 shadow-lg">
        <span class="text-sm">{selectedArtifacts.size} artifact(s) selected</span>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" onclick={() => (selectedArtifacts = new Set())}>
            Clear
          </Button>
          <Button
            size="sm"
            variant="git"
            onclick={signAndPublish}
            disabled={!$pubkey || publishing}
            class="gap-2">
            <Shield class="h-4 w-4" />
            {publishing ? "Signing…" : "Sign & Publish"}
          </Button>
        </div>
      </div>
    {/if}
  {/if}

  {#if !$pubkey && !loading}
    <p class="text-center text-xs text-muted-foreground">
      Log in to sign and publish release attestations.
    </p>
  {/if}
</div>
