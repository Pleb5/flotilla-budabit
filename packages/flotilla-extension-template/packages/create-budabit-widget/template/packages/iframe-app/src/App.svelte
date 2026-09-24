<script lang="ts">
  import {
    WidgetBridge,
    createWidgetBridge,
    createTextNote,
    type UnsignedEvent,
    type WidgetInitPayload,
    type RepoContext,
    type CommunityWidgetContext,
    type CommunityEventDescriptor,
    type CommunityWriteCapability,
    type NostrEvent,
  } from 'budabit-sdk';

  const EVENT_DATE = 31922;
  const EVENT_TIME = 31923;
  const CALENDAR_DESCRIPTORS: CommunityEventDescriptor[] = [
    { kind: EVENT_TIME },
    { kind: EVENT_DATE },
  ];

  // Bridge + host-provided context
  let bridge = $state<WidgetBridge | null>(null);
  let initPayload = $state<WidgetInitPayload | null>(null);
  let repoContext = $state<RepoContext | null>(null);
  let communityContext = $state<CommunityWidgetContext | null>(null);

  // UI state
  let note = $state('');
  let status = $state('Initializing Smart Widget...');
  let lastPublishResult = $state<string | null>(null);
  let lastError = $state<string | null>(null);
  let communityQueryStatus = $state<string | null>(null);
  let communityEvents = $state<NostrEvent[]>([]);
  let communityCapabilities = $state<CommunityWriteCapability[]>([]);
  const canConfigureCalendar = $derived(communityCapabilities.some((capability) => capability.canWrite));
  const calendarSectionNames = $derived(
    Array.from(
      new Set(communityCapabilities.flatMap((capability) => capability.sectionNames))
    )
  );

  const getCommunityContextKey = (ctx: CommunityWidgetContext | null) =>
    ctx ? `${ctx.contextSessionId}:${ctx.contextVersion}` : '';

  const responseMatchesContext = (
    response: { contextSessionId?: string; contextVersion?: number },
    expectedContext: CommunityWidgetContext
  ) =>
    response.contextSessionId === expectedContext.contextSessionId &&
    response.contextVersion === expectedContext.contextVersion;

  async function refreshCommunityCapabilities(ctx = communityContext): Promise<void> {
    if (!bridge || !ctx) return;

    const expectedContext = ctx;
    lastError = null;

    try {
      const res = await bridge.request('community:checkWriteCapabilities', {
        descriptors: CALENDAR_DESCRIPTORS,
      });

      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        lastError = res.error;
        return;
      }

      if (!responseMatchesContext(res, expectedContext)) return;
      communityCapabilities = Array.isArray(res.capabilities) ? res.capabilities : [];
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Initialize bridge and set up handlers
  $effect(() => {
    const b = createWidgetBridge({
      targetWindow: window.parent,
      targetOrigin: '*',
      timeoutMs: 15000,
    });

    bridge = b;
    status = 'Ready. Waiting for host context...';
    lastPublishResult = null;
    lastError = null;

    // Listen for widget:init (new lifecycle event)
    const offInit = b.onEvent('widget:init', (payload) => {
      initPayload = payload as WidgetInitPayload | null;
      communityContext = initPayload?.communityContext ?? null;
      const ver = initPayload?.hostVersion ?? 'unknown';
      status = communityContext
        ? `Connected (host v${ver}) — community context ${getCommunityContextKey(communityContext)}`
        : `Connected (host v${ver})`;
      void refreshCommunityCapabilities(communityContext);
    });

    const offCommunityChanged = b.onEvent('community:contextChanged', (payload) => {
      communityContext = payload.communityContext ?? null;
      communityCapabilities = [];
      status = communityContext
        ? `Community context updated — ${getCommunityContextKey(communityContext)}`
        : 'Community context unavailable';
      void refreshCommunityCapabilities(communityContext);
      if (communityContext && communityEvents.length > 0) {
        void queryCommunityCalendarEvents(communityContext);
      }
    });

    // Listen for repo context updates (for repo-scoped extensions)
    const offRepoUpdate = b.onEvent('context:repoUpdate', (ctx) => {
      repoContext = ctx as RepoContext | null;
      if (repoContext) {
        status = `Connected — repo: ${repoContext.repoName}`;
      }
    });

    // Also listen for deprecated context:update for backward compatibility
    const offContextUpdate = b.onEvent('context:update', (ctx) => {
      // Only use if we haven't received a repoUpdate and this isn't repo context
      if (!repoContext && ctx && !('repoPubkey' in ctx)) {
        status = 'Connected (context received via deprecated event)';
      }
    });

    // Signal to the host that we're ready
    b.signalReady();

    return () => {
      offInit();
      offCommunityChanged();
      offRepoUpdate();
      offContextUpdate();
      b.destroy();
      bridge = null;
    };
  });

  function buildNoteEvent(content: string): UnsignedEvent {
    const tags: string[][] = [];

    if (repoContext?.repoNaddr) {
      tags.push(['a', repoContext.repoNaddr]);
    }

    return createTextNote(content, tags);
  }

  async function publishNote(): Promise<void> {
    if (!bridge) return;

    const content = note.trim();
    if (!content) return;

    lastPublishResult = null;
    lastError = null;
    status = 'Publishing note via host (nostr:publish)...';

    const event = buildNoteEvent(content);

    try {
      const res = await bridge.request('nostr:publish', event);

      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        lastError = res.error;
        status = `Publish failed: ${res.error}`;
        return;
      }

      lastPublishResult = 'ok';
      status = 'Published successfully';
      note = '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      status = `Publish failed: ${msg}`;
    }
  }

  async function showToast(): Promise<void> {
    if (!bridge) return;

    lastError = null;

    const message = repoContext
      ? `Hello from Smart Widget (repo: ${repoContext.repoName})`
      : 'Hello from Smart Widget';

    try {
      const res = await bridge.request('ui:toast', { message, type: 'info' });

      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        lastError = res.error;
        status = `Toast failed: ${res.error}`;
        return;
      }

      status = 'Toast requested';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      status = `Toast failed: ${msg}`;
    }
  }

  async function requestResize(): Promise<void> {
    if (!bridge) return;
    try {
      await bridge.request('ui:resize', { height: 400 });
    } catch {
      // Resize is best-effort
    }
  }

  async function queryCommunityCalendarEvents(ctx = communityContext): Promise<void> {
    if (!bridge || !ctx) return;

    const expectedContext = ctx;
    communityQueryStatus = 'Querying community calendar events by descriptor...';
    communityEvents = [];
    lastError = null;

    try {
      const res = await bridge.request('community:queryEvents', {
        descriptors: CALENDAR_DESCRIPTORS,
        limit: 10,
      });

      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        lastError = res.error;
        communityQueryStatus = `Community query failed: ${res.error}`;
        return;
      }

      if (!responseMatchesContext(res, expectedContext)) return;
      communityEvents = 'events' in res && Array.isArray(res.events) ? res.events : [];
      communityQueryStatus = `Loaded ${communityEvents.length} community event(s)`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      communityQueryStatus = `Community query failed: ${msg}`;
    }
  }
</script>

<div class="container">
  <header>
    <h1>BudaBit Smart Widget Template (Tool)</h1>
    <p class="status" class:ready={!!initPayload}>{status}</p>
  </header>

  {#if initPayload}
    <section class="context">
      <h2>Host Context</h2>
      <dl>
        {#if initPayload.pubkey}
          <dt>User Pubkey:</dt>
          <dd class="pubkey">{String(initPayload.pubkey)}</dd>
        {/if}

        {#if initPayload.hostVersion}
          <dt>Host Version:</dt>
          <dd>{initPayload.hostVersion}</dd>
        {/if}

        {#if Array.isArray(initPayload.relays) && initPayload.relays.length > 0}
          <dt>Relays:</dt>
          <dd>{initPayload.relays.join(', ')}</dd>
        {/if}
      </dl>

      {#if repoContext}
        <h3>Repo Context</h3>
        <dl>
          <dt>Repo:</dt>
          <dd>{repoContext.repoName}</dd>
          <dt>Owner:</dt>
          <dd class="pubkey">{repoContext.repoPubkey?.slice(0, 16) ?? 'unknown'}...</dd>
          <dt>Relays:</dt>
          <dd>{repoContext.repoRelays.join(', ')}</dd>
        </dl>
      {/if}

      {#if communityContext}
        <h3>Community Context</h3>
        <dl>
          <dt>Community ID:</dt>
          <dd class="pubkey">{communityContext.communityId}</dd>
          <dt>Definition:</dt>
          <dd class="pubkey">{communityContext.naddr}</dd>
          <dt>Relays:</dt>
          <dd>{communityContext.relays.join(', ') || 'none'}</dd>
          <dt>Context version:</dt>
          <dd>{getCommunityContextKey(communityContext)}</dd>
          <dt>Calendar sections:</dt>
          <dd>{calendarSectionNames.join(', ') || 'not configured'}</dd>
          <dt>Calendar config access:</dt>
          <dd>{canConfigureCalendar ? 'yes' : 'no'}</dd>
        </dl>
        <p class="hint">
          Use descriptor capabilities for configuration gates. Do not hide already configured
          community content from readers just because they cannot write that descriptor.
        </p>
      {/if}

      <details class="context-raw">
        <summary>Raw init payload</summary>
        <pre>{JSON.stringify(initPayload, null, 2)}</pre>
      </details>
    </section>
  {:else}
    <section class="waiting">
      <h2>Waiting for host context</h2>
      <p>
        This Smart Widget works without context, but receives it via
        <code>widget:init</code> and optionally <code>context:repoUpdate</code>.
      </p>
    </section>
  {/if}

  <section class="actions">
    <h2>Actions</h2>

    <div class="action-group">
      <h3>Publish a note (nostr:publish)</h3>
      <div class="input-group">
        <input
          type="text"
          bind:value={note}
          placeholder="Type a note to publish..."
          onkeydown={(e) => e.key === 'Enter' && publishNote()}
        />
        <button onclick={publishNote} disabled={!bridge || !note.trim()}>
          Publish
        </button>
      </div>

      {#if lastPublishResult}
        <p class="result">Last publish result: {lastPublishResult}</p>
      {/if}
    </div>

    <div class="action-group">
      <h3>UI Actions</h3>
      <div class="button-group">
        <button onclick={showToast} disabled={!bridge}>
          Show Toast (ui:toast)
        </button>
        <button onclick={requestResize} disabled={!bridge}>
          Resize to 400px (ui:resize)
        </button>
      </div>
    </div>

    <div class="action-group">
      <h3>Community Descriptor Query</h3>
      <p class="hint">
        This asks the host for events by Nostr event descriptors. The host maps descriptors to
        active community sections and authorized writers before querying relays.
      </p>
      <button onclick={() => queryCommunityCalendarEvents()} disabled={!bridge || !communityContext}>
        Query Calendar Events
      </button>
      {#if communityQueryStatus}
        <p class="result">{communityQueryStatus}</p>
      {/if}
      {#if communityEvents.length > 0}
        <ul class="event-list">
          {#each communityEvents as event (event.id)}
            <li>{event.kind}: {event.id}</li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if lastError}
      <div class="error">
        <strong>Error:</strong> {lastError}
      </div>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
      sans-serif;
    background: #f5f5f5;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  header {
    text-align: center;
    margin-bottom: 2rem;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    color: #333;
  }

  .status {
    padding: 0.5rem 1rem;
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 4px;
    color: #856404;
    font-size: 0.9rem;
  }

  .status.ready {
    background: #d4edda;
    border-color: #28a745;
    color: #155724;
  }

  section {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  h2 {
    margin: 0 0 1rem 0;
    color: #333;
    font-size: 1.25rem;
  }

  h3 {
    margin: 0 0 0.75rem 0;
    color: #666;
    font-size: 1rem;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
    margin: 0;
  }

  dt {
    font-weight: 600;
    color: #666;
  }

  dd {
    margin: 0;
    color: #333;
  }

  .pubkey {
    font-family: monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .context-raw {
    margin-top: 1rem;
  }

  .context-raw pre {
    margin: 0.75rem 0 0 0;
    padding: 0.75rem;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid #eee;
    overflow: auto;
    font-size: 0.85rem;
  }

  .action-group {
    margin-bottom: 1.5rem;
  }

  .action-group:last-child {
    margin-bottom: 0;
  }

  .input-group {
    display: flex;
    gap: 0.5rem;
  }

  input[type='text'] {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 1rem;
  }

  .button-group {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.5rem 1rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  button:hover:not(:disabled) {
    background: #0056b3;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .result {
    margin: 0.75rem 0 0 0;
    color: #333;
    font-size: 0.95rem;
  }

  .hint {
    margin: 0.75rem 0;
    color: #666;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .event-list {
    margin: 0.75rem 0 0 0;
    padding-left: 1.25rem;
    color: #333;
    font-size: 0.9rem;
  }

  .error {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid #dc3545;
    background: #f8d7da;
    border-radius: 6px;
    color: #721c24;
  }

  .waiting {
    text-align: center;
  }

  .waiting p {
    margin: 0.5rem 0;
    color: #666;
  }
</style>
