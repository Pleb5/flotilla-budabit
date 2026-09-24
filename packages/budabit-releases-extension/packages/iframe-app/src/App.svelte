<script lang="ts">
  import { createWidgetBridge, type NostrEvent, type WidgetBridge } from 'budabit-sdk';
  import { onMount } from 'svelte';
  import { watchHostTheme } from './lib/host-theme';
  import {
    record,
    normalizeContext,
    isMaintainer as canPublish,
    type RepoContext,
  } from './lib/context.js';
  import { startReleaseList, type ListState } from './lib/list-controller.js';
  import { coordinate } from './lib/trust.js';
  import ReleaseList from './lib/components/ReleaseList.svelte';
  import ReleaseDetail from './lib/components/ReleaseDetail.svelte';
  import CreateRelease from './lib/components/CreateRelease.svelte';

  // ── Bridge + context ──────────────────────────────────────────────────────
  let bridge = $state<WidgetBridge | null>(null);
  let repoContext = $state<RepoContext | null>(null);
  let contextError = $state('');
  let contextRevision = 0;

  // ── View routing ──────────────────────────────────────────────────────────
  type View = 'list' | 'detail' | 'create';
  let view = $state<View>('list');
  let selectedEvent = $state<NostrEvent | null>(null);
  const emptyList = (): ListState => ({
    apps: [],
    events: [],
    loading: true,
    partial: false,
    error: '',
  });
  let list = $state.raw<ListState>(emptyList());
  let retryDiscovery = $state(0);
  const currentAuthority = () => list;
  const currentEvent = $derived(
    selectedEvent && !list.loading
      ? list.events.find((e) => coordinate(e) === coordinate(selectedEvent!))
      : null
  );

  // Authority belongs to the repository session, not the currently visible view.
  $effect(() => {
    void retryDiscovery;
    if (!bridge || !repoContext) return;
    list = emptyList();
    const session = startReleaseList(bridge, repoContext, (next) => (list = next));
    return () => {
      void session.dispose();
    };
  });

  // ── Derived helpers ───────────────────────────────────────────────────────
  const isMaintainer = $derived(repoContext !== null && canPublish(repoContext));

  // ── Bridge lifecycle ──────────────────────────────────────────────────────

  function receiveContext(input: unknown) {
    contextRevision++;
    contextError = '';
    const next = normalizeContext(input, repoContext?.userPubkey);
    if (JSON.stringify(next) === JSON.stringify(repoContext)) return;
    repoContext = next;
    view = 'list';
    selectedEvent = null;
    list = emptyList();
  }

  onMount(() => {
    const b = createWidgetBridge({
      targetWindow: window.parent,
      targetOrigin: '*',
      timeoutMs: 120000, // interactive signers may need user approval; host bounds queries separately
    });

    bridge = b;
    let disposed = false;

    // Match the host application's theme (light/dark + background)
    const offTheme = watchHostTheme(b);

    // widget:init — sent first by the host; may carry repoContext inline.
    const offInit = b.onEvent('widget:init', (payload) => {
      const value = record(payload);
      if ('repoContext' in value || 'repo' in value) receiveContext(payload);
    });

    // context:repoUpdate — flat RepoContext pushed whenever repo data changes.
    const offRepo = b.onEvent('context:repoUpdate', (ctx) => {
      receiveContext(ctx);
    });

    // Current Budabit repo-tab surface still sends this compatibility envelope.
    const offContextUpdate = b.onEvent('context:update', (ctx) => {
      receiveContext(ctx);
    });

    // Actively fetch context if widget:init arrived before our listeners were
    // ready (the host sends it right after the iframe `load` event, which can
    // fire before this component mounts).
    const fallbackTimer = setTimeout(() => {
      const revision = contextRevision;
      b.request('context:getRepo', {})
        .then((response) => {
          if (disposed || revision !== contextRevision) return;
          const error = record(response).error;
          if (error)
            throw new Error(
              typeof error === 'string' ? error : 'Could not load repository context'
            );
          receiveContext(response);
        })
        .catch((err) => {
          if (!disposed && revision === contextRevision)
            contextError = err instanceof Error ? err.message : String(err);
        });
    }, 500);

    b.signalReady();

    return () => {
      disposed = true;
      clearTimeout(fallbackTimer);
      offTheme();
      offInit();
      offRepo();
      offContextUpdate();
      b.destroy();
      bridge = null;
    };
  });

  // ── Navigation handlers ───────────────────────────────────────────────────
  function handleViewRelease(event: NostrEvent) {
    selectedEvent = event;
    view = 'detail';
  }

  function handleCreateRelease() {
    view = 'create';
  }

  function handleBack() {
    view = 'list';
    selectedEvent = null;
  }

  function handleCreateSuccess() {
    retryDiscovery++;
    view = 'list';
    selectedEvent = null;
  }
</script>

<div class="app">
  {#if !bridge}
    <div class="initializing">Initializing…</div>
  {:else if !repoContext}
    <div class="no-context">
      <p>Waiting for repository context…</p>
      <p class="hint">Open this widget inside a Budabit repository tab.</p>
      {#if contextError}<pre class="debug-log" role="alert">{contextError}</pre>{/if}
    </div>
  {:else if view === 'detail' && selectedEvent}
    {#if currentEvent}
      {#if currentEvent.id !== selectedEvent.id}<p role="status">
          This release was replaced. Showing the current revision.
        </p>{/if}
      {#if list.partial}<p role="alert">
          Relay discovery is incomplete; current authority may be stale.
        </p>{/if}
      {#key currentEvent.id}
        <ReleaseDetail
          {bridge}
          repo={repoContext}
          releaseEvent={currentEvent}
          {currentAuthority}
          onBack={handleBack}
        />
      {/key}
    {:else}
      <button onclick={handleBack}>← Releases</button>
      <p role="alert">
        This release is no longer authorized or its current revision is unavailable. Downloads have
        been removed.
      </p>
    {/if}
  {:else if view === 'create' && isMaintainer}
    <CreateRelease
      {bridge}
      repo={repoContext}
      existingApps={list.apps}
      onSuccess={handleCreateSuccess}
      onCancel={handleBack}
    />
  {:else}
    <ReleaseList
      {list}
      onRetry={() => retryDiscovery++}
      {isMaintainer}
      onViewRelease={handleViewRelease}
      onCreateRelease={handleCreateRelease}
    />
  {/if}
</div>

<style>
  /* Theme tokens — lib/host-theme.ts sets `data-theme` on <html> from the
     host's widget:init / widget:themeChanged events. */
  :global(:root) {
    color-scheme: light;
    --ext-bg: #ffffff;
    --ext-surface: #ffffff;
    --ext-surface-2: #f8f9fa;
    --ext-border: #e8e8e8;
    --ext-border-strong: #d0d7de;
    --ext-text: #111111;
    --ext-text-secondary: #555555;
    --ext-text-muted: #666666;
    --ext-text-faint: #999999;
    --ext-accent: #1a73e8;
    --ext-accent-hover: #1558c0;
    --ext-accent-text: #ffffff;
    --ext-accent-soft: #e8f0fe;
    --ext-accent-soft-2: #f0f6ff;
    --ext-accent-soft-border: #cce0ff;
    --ext-accent-muted: #9fc3f8;
    --ext-danger-bg: #fce4e4;
    --ext-danger-border: #f5c6cb;
    --ext-danger-text: #c62828;
    --ext-warning-bg: #fff3cd;
    --ext-warning-text: #856404;
    --ext-success-bg: #e6f4ea;
    --ext-success-text: #1e7e34;
    --ext-code-bg: #1e1e1e;
    --ext-code-text: #d4d4d4;
  }

  :global([data-theme='dark']) {
    color-scheme: dark;
    --ext-bg: #151c23;
    --ext-surface: #1e2831;
    --ext-surface-2: #232e39;
    --ext-border: #33404c;
    --ext-border-strong: #40505e;
    --ext-text: #e6ebf0;
    --ext-text-secondary: #c3ccd5;
    --ext-text-muted: #98a6b3;
    --ext-text-faint: #78889a;
    --ext-accent: #4a9eff;
    --ext-accent-hover: #74b6ff;
    --ext-accent-text: #ffffff;
    --ext-accent-soft: #1c3250;
    --ext-accent-soft-2: #1a2c44;
    --ext-accent-soft-border: #2c4a74;
    --ext-accent-muted: #3f6ea8;
    --ext-danger-bg: #3b1d21;
    --ext-danger-border: #7a3a42;
    --ext-danger-text: #f1a7ad;
    --ext-warning-bg: #3f3520;
    --ext-warning-text: #e8c869;
    --ext-success-bg: #14321f;
    --ext-success-text: #7fd6a0;
    --ext-code-bg: #10161c;
    --ext-code-text: #c9d4de;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: var(--host-background, var(--ext-bg));
    font-size: 14px;
    color: var(--ext-text);
  }

  .app {
    min-height: 100vh;
  }

  .initializing,
  .no-context {
    padding: 2rem;
    text-align: center;
    color: var(--ext-text-muted);
    font-size: 0.9rem;
  }

  .no-context p {
    margin: 0 0 0.5rem;
  }

  .hint {
    color: var(--ext-text-faint);
    font-size: 0.8rem;
  }

  .debug-log {
    margin: 1rem auto;
    max-width: 600px;
    text-align: left;
    font-family: monospace;
    font-size: 0.7rem;
    line-height: 1.5;
    background: var(--ext-code-bg);
    color: var(--ext-code-text);
    padding: 0.75rem 1rem;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
