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
    Settings,
    X,
  } from "@lucide/svelte"
  import ReleaseSankey from "@lib/budabit/components/ReleaseSankey.svelte"
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
  let selectedArtifacts = $state<Set<string>>(new Set())
  let showConfig = $state(false)
  let newTagInput = $state("")
  let publishing = $state(false)
  let workerNames = $state<Map<string, string>>(new Map()) // ephemeralPubkey → worker ad name
  let ephemeralToWorker = $state<Map<string, string>>(new Map()) // ephemeralPubkey → actual worker pubkey

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

        // Phase 3: Resolve worker names via Kind 5100 → Kind 10100
        // 5100 job requests have e-tag → run id and p-tag → worker pubkey
        // 5401 run events have publisher tag → ephemeral key
        // So: 5100.e → 5401 → publisher gives us ephemeralKey → workerPubkey
        if (runIds.length > 0) {
          const jobEvents = await load({
            relays: CICD_RELAYS,
            filters: [{kinds: [5100], "#e": runIds}],
          })

          // Map ephemeral pubkey → actual worker pubkey
          const ew = new Map<string, string>()
          for (const job of jobEvents) {
            const eTag = job.tags.find((t: string[]) => t[0] === "e")?.[1]
            const pTag = job.tags.find((t: string[]) => t[0] === "p")?.[1]
            if (eTag && pTag && runIdMap.has(eTag)) {
              const run = runIdMap.get(eTag)
              const publisher = getTagValue("publisher", run.tags)
              if (publisher) ew.set(publisher, pTag)
            }
          }
          ephemeralToWorker = ew

          // Fetch Kind 10100 worker advertisements for discovered worker pubkeys
          const workerPubkeys = [...new Set(ew.values())]
          if (workerPubkeys.length > 0) {
            const ads = await load({
              relays: CICD_RELAYS,
              filters: [{kinds: [10100], authors: workerPubkeys}],
            })

            const adByPubkey = new Map<string, any>()
            for (const ad of ads) {
              const existing = adByPubkey.get(ad.pubkey)
              if (!existing || ad.created_at > existing.created_at) {
                adByPubkey.set(ad.pubkey, ad)
              }
            }

            const names = new Map<string, string>()
            for (const [ephKey, workerPk] of ew) {
              const ad = adByPubkey.get(workerPk)
              if (ad) {
                try {
                  const content = JSON.parse(ad.content || "{}")
                  if (content.name) names.set(ephKey, content.name)
                } catch {
                  // ignore
                }
              }
            }
            workerNames = names
          }
        }
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

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied!")
    } catch {
      toast.error("Copy failed")
    }
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
    <div class="space-y-4">
      {#each groups as group (group.key)}
        <ReleaseSankey
          {group}
          {workflowRuns}
          {workerNames}
          {ephemeralToWorker}
          {selectedArtifacts}
          onToggleArtifact={toggleArtifact}
          onSelectGroup={selectGroupArtifacts}
          {truncateHash}
          {copyToClipboard} />
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
