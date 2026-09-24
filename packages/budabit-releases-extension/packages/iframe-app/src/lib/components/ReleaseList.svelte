<script lang="ts">
  import type { NostrEvent } from 'budabit-sdk';
  import { formatDate, parseReleaseListItem, platformLabel, tagValues } from '../releases.js';
  import type { ListState } from '../list-controller.js';
  let {
    list,
    onRetry,
    isMaintainer,
    onViewRelease,
    onCreateRelease,
  }: {
    list: ListState;
    onRetry: () => void;
    isMaintainer: boolean;
    onViewRelease: (event: NostrEvent) => void;
    onCreateRelease: () => void;
  } = $props();
  let version = $state(''),
    platform = $state('all'),
    days = $state('all'),
    page = $state(1);
  const platforms = $derived([...new Set(list.events.flatMap((e) => tagValues(e, 'f')))].sort());
  const filtered = $derived(
    list.events.filter((e) => {
      const item = parseReleaseListItem(e);
      return (
        item.version.toLowerCase().includes(version.trim().toLowerCase()) &&
        (platform === 'all' || tagValues(e, 'f').includes(platform)) &&
        (days === 'all' || e.created_at >= Date.now() / 1000 - Number(days) * 86400)
      );
    })
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
  const current = $derived(Math.min(page, pages));
</script>

<div class="release-list">
  <header>
    <h2>Releases</h2>
    {#if isMaintainer}<button disabled={list.loading || list.partial} onclick={onCreateRelease}
        >New Release</button
      >{/if}
  </header>
  <p>
    Only verified signatures from current repository maintainers, linked to an exact application
    coordinate, are shown. Legacy releases without that link are excluded.
  </p>
  {#if list.partial || list.error}
    <div role="alert" class="notice">
      {list.error || 'Relay results are incomplete. This is not the full release history.'}
      Publication is disabled until discovery completes.
      <button onclick={onRetry}>Retry discovery</button>
    </div>
  {/if}
  {#if list.loading}<p role="status">Loading releases…</p>{/if}
  {#if list.events.length}
    <div class="filters">
      <input
        type="search"
        aria-label="Filter version"
        placeholder="Filter version…"
        bind:value={version}
        oninput={() => (page = 1)}
      />
      <select aria-label="Filter platform" bind:value={platform} onchange={() => (page = 1)}
        ><option value="all">All platforms</option>{#each platforms as p}<option value={p}
            >{platformLabel([p])}</option
          >{/each}</select
      >
      <select aria-label="Filter date" bind:value={days} onchange={() => (page = 1)}
        ><option value="all">Any time</option><option value="30">Last 30 days</option><option
          value="90">Last 90 days</option
        ><option value="365">Last year</option></select
      >
    </div>
    <ul>
      {#each filtered.slice((current - 1) * 20, current * 20) as event (event.id)}
        {@const item = parseReleaseListItem(event)}
        <li>
          <button class="release-card" onclick={() => onViewRelease(event)}>
            <strong>{item.version}</strong>
            <span>{item.channel} · {formatDate(item.createdAt)} · {item.assetCount} assets</span>
            <span>{item.appId}</span><span title={item.pubkey}
              >Publisher: {item.pubkey.slice(0, 16)}…</span
            >
            <span>{event.content.split('\n')[0]}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if !filtered.length}<p>No matching releases.</p>{/if}
    {#if pages > 1}<nav aria-label="Release pages">
        <button disabled={current === 1} onclick={() => (page = current - 1)}>Previous</button> Page {current}
        of {pages}
        <button disabled={current === pages} onclick={() => (page = current + 1)}>Next</button>
      </nav>{/if}
  {:else if !list.loading && !list.partial}<p>
      No authorized releases found for this repository.
    </p>{/if}
</div>

<style>
  .release-list {
    padding: 1.25rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 1.1rem;
  }
  p,
  span {
    color: var(--ext-text-secondary);
    font-size: 0.85rem;
  }
  button,
  input,
  select {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--ext-border);
    border-radius: 6px;
    background: var(--ext-surface);
    color: var(--ext-text);
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    margin: 0.5rem 0;
  }
  .release-card {
    display: block;
    width: 100%;
    text-align: left;
    padding: 1rem;
  }
  .release-card:hover {
    border-color: var(--ext-accent);
  }
  .release-card span {
    display: block;
    margin-top: 0.2rem;
    overflow-wrap: anywhere;
  }
  strong {
    color: var(--ext-accent);
  }
  .notice {
    padding: 0.75rem;
    background: var(--ext-warning-bg);
    color: var(--ext-warning-text);
    border-radius: 6px;
  }
  nav {
    text-align: center;
  }
</style>
