<script lang="ts">
  import type { WidgetBridge } from '@flotilla/ext-shared';
  import type { RepoContextNormalized } from '../types';
  import {
    AlertCircle,
    CheckCircle2,
    Copy,
    FileCheck,
    Loader2,
    RefreshCw,
    Shield,
    ShieldAlert,
    ShieldCheck,
  } from '@lucide/svelte';
  import {
    type ReleaseArtifact,
    type ArtifactGroup,
    type ConsensusStatus,
    releaseData$,
    groupArtifacts,
    getConsensusStatus,
    signAndPublishReleases,
    resolveNip51List,
  } from '../releases';
  import {onDestroy} from 'svelte';
  import type {Subscription} from 'rxjs';
  import ReleaseSankey from './ReleaseSankey.svelte';

  interface Props {
    bridge: WidgetBridge;
    repo: RepoContextNormalized;
  }

  let { bridge, repo }: Props = $props();

  // ── State ────────────────────────────────────────────────────────
  let loading = $state(false);
  let error = $state<string | null>(null);
  let artifacts = $state<ReleaseArtifact[]>([]);
  let workerNames = $state(new Map<string, string>());
  let ephemeralToWorker = $state(new Map<string, string>());

  let groupByTags = $state<string[]>(['filename']);
  let groupByInput = $state('filename');

  let nip51Input = $state('');
  let trustedMaintainers = $state<string[]>([]);
  let maintainerInput = $state('');

  let selectedArtifacts = $state(new Set<string>());
  let signing = $state(false);
  let signResult = $state<{ count: number; error?: string } | null>(null);

  let showSankey = $state(false);

  const FALLBACK_RELAYS = ['wss://relay.sharegap.net', 'wss://nos.lol'];

  // ── Derived ──────────────────────────────────────────────────────
  const groups = $derived(groupArtifacts(artifacts, groupByTags));

  const consensusIcon = (status: ConsensusStatus) => {
    switch (status) {
      case 'unanimous': return ShieldCheck;
      case 'majority': return Shield;
      case 'split': return ShieldAlert;
    }
  };

  const consensusColor = (status: ConsensusStatus) => {
    switch (status) {
      case 'unanimous': return 'text-green-400';
      case 'majority': return 'text-yellow-400';
      case 'split': return 'text-red-400';
    }
  };

  const consensusLabel = (status: ConsensusStatus) => {
    switch (status) {
      case 'unanimous': return 'Unanimous';
      case 'majority': return 'Majority';
      case 'split': return 'Split';
    }
  };

  // ── Actions ──────────────────────────────────────────────────────
  let releaseSub: Subscription | null = null;
  let everReceived = false;

  function loadData() {
    if (!bridge || !repo) return;
    if (trustedMaintainers.length === 0) {
      error = 'Add at least one trusted maintainer pubkey or resolve a NIP-51 list.';
      return;
    }

    loading = true;
    error = null;
    artifacts = [];
    signResult = null;
    everReceived = false;

    releaseSub?.unsubscribe();
    releaseSub = releaseData$({repo, trustedMaintainers}).subscribe(state => {
      artifacts = state.artifacts;
      workerNames = state.workerNames;
      ephemeralToWorker = state.ephemeralToWorker;
      // First emit from a fresh subscription is the empty seed; flip out of
      // the loading state on the first event-driven emit, or on any emit
      // that has data.
      if (state.artifacts.length > 0 || everReceived) {
        loading = false;
      }
      everReceived = true;
    });
  }

  onDestroy(() => {
    releaseSub?.unsubscribe();
  });

  async function resolveNip51() {
    if (!bridge || !nip51Input.trim()) return;

    loading = true;
    error = null;

    try {
      const relays = [...repo.repoRelays, ...FALLBACK_RELAYS];
      const pubkeys = await resolveNip51List(bridge, nip51Input.trim(), relays);
      if (pubkeys.length === 0) {
        error = 'NIP-51 list resolved to zero pubkeys.';
      } else {
        trustedMaintainers = [...new Set([...trustedMaintainers, ...pubkeys])];
      }
    } catch (e: any) {
      error = e.message || 'Failed to resolve NIP-51 list.';
    } finally {
      loading = false;
    }
  }

  function addMaintainer() {
    const pk = maintainerInput.trim();
    if (pk.length === 64 && /^[a-f0-9]+$/.test(pk)) {
      trustedMaintainers = [...new Set([...trustedMaintainers, pk])];
      maintainerInput = '';
    }
  }

  function removeMaintainer(pk: string) {
    trustedMaintainers = trustedMaintainers.filter((m) => m !== pk);
  }

  function toggleArtifact(eventId: string) {
    const next = new Set(selectedArtifacts);
    if (next.has(eventId)) {
      next.delete(eventId);
    } else {
      next.add(eventId);
    }
    selectedArtifacts = next;
  }

  function selectAllInGroup(group: ArtifactGroup) {
    const next = new Set(selectedArtifacts);
    if (!group.consensusHash) return;
    const consensusArtifacts = group.hashCounts.get(group.consensusHash) || [];
    for (const a of consensusArtifacts) {
      next.add(a.event.id);
    }
    selectedArtifacts = next;
  }

  async function signSelected() {
    if (!bridge || !repo || selectedArtifacts.size === 0) return;

    signing = true;
    signResult = null;

    try {
      const toSign = artifacts.filter((a) => selectedArtifacts.has(a.event.id));
      const count = await signAndPublishReleases(bridge, repo, toSign);
      signResult = { count };
      selectedArtifacts = new Set();
    } catch (e: any) {
      signResult = { count: 0, error: e.message || 'Signing failed.' };
    } finally {
      signing = false;
    }
  }

  function updateGroupBy() {
    groupByTags = groupByInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // pass
    }
  }

  // Auto-load maintainers from repo context
  $effect(() => {
    if (repo?.maintainers && repo.maintainers.length > 0 && trustedMaintainers.length === 0) {
      trustedMaintainers = [...repo.maintainers];
    }
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <div class="flex items-center gap-2">
      <FileCheck class="h-5 w-5 text-primary" />
      <h2 class="text-xl font-semibold">Release Signing</h2>
    </div>
    <p class="mt-1 text-sm text-muted-foreground">
      Verify artifact consensus and co-sign releases from trusted workflow workers.
    </p>
  </div>

  <!-- Trusted Maintainers -->
  <div class="rounded-lg border border-border bg-card p-4 space-y-3">
    <h3 class="text-sm font-medium">Trusted Maintainers</h3>

    {#if trustedMaintainers.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each trustedMaintainers as pk}
          <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs">
            <span class="font-mono">{pk.slice(0, 8)}…{pk.slice(-8)}</span>
            <button class="ml-1 hover:text-red-400" onclick={() => removeMaintainer(pk)}>×</button>
          </span>
        {/each}
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">No trusted maintainers configured. Add pubkeys or resolve a NIP-51 list.</p>
    {/if}

    <div class="flex gap-2">
      <input
        type="text"
        bind:value={maintainerInput}
        placeholder="Hex pubkey (64 chars)"
        class="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        onkeydown={(e) => e.key === 'Enter' && addMaintainer()}
      />
      <button
        class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
        onclick={addMaintainer}
      >Add</button>
    </div>

    <div class="flex gap-2">
      <input
        type="text"
        bind:value={nip51Input}
        placeholder="NIP-51 list identifier (e.g. maintainers)"
        class="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        onkeydown={(e) => e.key === 'Enter' && resolveNip51()}
      />
      <button
        class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
        onclick={resolveNip51}
        disabled={loading}
      >Resolve NIP-51</button>
    </div>
  </div>

  <!-- Grouping Config + Load -->
  <div class="flex flex-wrap items-end gap-4">
    <div class="flex-1 min-w-[200px]">
      <label class="block text-xs font-medium text-muted-foreground mb-1">Group by tags</label>
      <input
        type="text"
        bind:value={groupByInput}
        placeholder="filename, branch"
        class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        onchange={updateGroupBy}
      />
    </div>

    <button
      class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
      onclick={loadData}
      disabled={loading || trustedMaintainers.length === 0}
    >
      {#if loading}
        <Loader2 class="h-4 w-4 animate-spin" />
      {:else}
        <RefreshCw class="h-4 w-4" />
      {/if}
      Load Artifacts
    </button>

    {#if artifacts.length > 0}
      <button
        class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent"
        onclick={() => (showSankey = !showSankey)}
      >
        {showSankey ? 'Hide' : 'Show'} Trust Flow
      </button>
    {/if}
  </div>

  <!-- Error -->
  {#if error}
    <div class="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <!-- Sign Result -->
  {#if signResult}
    <div class={`flex items-start gap-2 rounded-lg border p-3 text-sm ${signResult.error ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-green-500/30 bg-green-500/10 text-green-400'}`}>
      {#if signResult.error}
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
        <span>Signing failed: {signResult.error}</span>
      {:else}
        <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
        <span>Successfully signed and published {signResult.count} release attestation{signResult.count !== 1 ? 's' : ''}.</span>
      {/if}
    </div>
  {/if}

  <!-- Sankey Visualization -->
  {#if showSankey && artifacts.length > 0}
    <ReleaseSankey {artifacts} {groups} {workerNames} {ephemeralToWorker} />
  {/if}

  <!-- Artifact Groups -->
  {#if groups.length > 0}
    <div class="space-y-4">
      {#each groups as group}
        {@const status = getConsensusStatus(group)}
        {@const Icon = consensusIcon(status)}
        <div class="rounded-lg border border-border bg-card overflow-hidden">
          <div class="flex items-center justify-between border-b border-border bg-card/80 px-4 py-3">
            <div class="flex items-center gap-2">
              <Icon class={`h-4 w-4 ${consensusColor(status)}`} />
              <span class="text-sm font-medium">
                {#each Object.entries(group.labels) as [tag, value]}
                  <span class="text-muted-foreground">{tag}:</span> {value}
                  {' '}
                {/each}
              </span>
              <span class={`rounded-full px-2 py-0.5 text-xs ${consensusColor(status)}`}>
                {consensusLabel(status)} ({group.totalCount} attestation{group.totalCount !== 1 ? 's' : ''})
              </span>
            </div>

            {#if group.consensusHash}
              <button
                class="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                onclick={() => selectAllInGroup(group)}
              >Select consensus</button>
            {/if}
          </div>

          <div class="divide-y divide-border">
            {#each [...group.hashCounts.entries()] as [hash, hashArtifacts]}
              <div class="px-4 py-3">
                <div class="flex items-center gap-2 mb-2">
                  <button
                    class="font-mono text-xs break-all text-left hover:text-primary"
                    onclick={() => copyText(hash)}
                    title="Copy full hash"
                  >
                    <Copy class="inline h-3 w-3 mr-1 opacity-50" />{hash}
                  </button>
                  {#if hash === group.consensusHash && group.isUnanimous}
                    <span class="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">consensus</span>
                  {:else if hash === group.consensusHash}
                    <span class="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">majority</span>
                  {:else}
                    <span class="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">divergent</span>
                  {/if}
                  <span class="text-xs text-muted-foreground">{hashArtifacts.length} attestation{hashArtifacts.length !== 1 ? 's' : ''}</span>
                </div>

                <div class="space-y-1">
                  {#each hashArtifacts as artifact}
                    <label class="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedArtifacts.has(artifact.event.id)}
                        onchange={() => toggleArtifact(artifact.event.id)}
                        class="rounded border-border"
                      />
                      <span class="font-mono text-muted-foreground">{artifact.ephemeralPubkey.slice(0, 8)}…</span>
                      <span>{artifact.filename}</span>
                      {#if artifact.branch}
                        <span class="text-muted-foreground">({artifact.branch})</span>
                      {/if}
                      {#if workerNames.get(artifact.ephemeralPubkey)}
                        <span class="text-primary/70">via {workerNames.get(artifact.ephemeralPubkey)}</span>
                      {/if}
                    </label>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <!-- Sign Button -->
    {#if selectedArtifacts.size > 0}
      <div class="sticky bottom-4 flex justify-end">
        <button
          class="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 disabled:opacity-50"
          onclick={signSelected}
          disabled={signing}
        >
          {#if signing}
            <Loader2 class="h-4 w-4 animate-spin" />
            Signing…
          {:else}
            <ShieldCheck class="h-4 w-4" />
            Sign & Publish {selectedArtifacts.size} Attestation{selectedArtifacts.size !== 1 ? 's' : ''}
          {/if}
        </button>
      </div>
    {/if}
  {:else if !loading && !error && artifacts.length === 0 && trustedMaintainers.length > 0}
    <div class="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      Click "Load Artifacts" to fetch release data from the network.
    </div>
  {/if}
</div>
