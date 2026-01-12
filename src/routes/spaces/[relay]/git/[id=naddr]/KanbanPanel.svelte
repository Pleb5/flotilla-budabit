<script lang="ts">
  import {onDestroy} from "svelte"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import type {LoadedWidgetExtension} from "@app/extensions/types"

  interface Props {
    repoPubkey: string
    repoName: string
    repoNaddr?: string
    repoRelays: string[]
    maintainers?: string[]
    userPubkey?: string
    widgetAppUrl?: string
  }

  let {
    repoPubkey,
    repoName,
    repoNaddr,
    repoRelays,
    maintainers = [],
    userPubkey,
    widgetAppUrl = "http://localhost:5177",
  }: Props = $props()

  let iframeEl: HTMLIFrameElement | null = $state(null)
  let bridge: ExtensionBridge | null = $state(null)
  let ready = $state(false)
  let error = $state<string | null>(null)

  function createMockExtension(): LoadedWidgetExtension {
    const origin = new URL(widgetAppUrl).origin
    const identifier = `budabit-kanban:${repoPubkey}:${repoName}`

    return {
      type: "widget",
      id: identifier,
      origin,
      widget: {
        id: `mock-${identifier}`,
        kind: 30033,
        content: "",
        pubkey: "",
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        identifier,
        widgetType: "tool",
        imageUrl: "",
        buttons: [],
        permissions: ["nostr:publish", "nostr:query", "ui:toast"],
      },
    }
  }

  function sendContext(): void {
    if (!bridge || !iframeEl?.contentWindow) return

    const ctx = {
      contextId: `repo:${repoPubkey}:${repoName}`,
      userPubkey,
      relays: repoRelays,
      repo: {
        repoPubkey,
        repoName,
        repoNaddr,
        repoRelays,
        maintainers,
      },
    }

    bridge.post("context:update", ctx)
  }

  function handleIframeLoad(): void {
    error = null

    if (!repoPubkey || !repoName) {
      error = "Missing repo context (repoPubkey/repoName)."
      return
    }

    if (!iframeEl?.contentWindow) {
      error = "Kanban iframe not available."
      return
    }

    try {
      const ext = createMockExtension()
      // Add iframe reference so bridge.post() can send messages
      ;(ext as any).iframe = iframeEl
      const b = new ExtensionBridge(ext)
      b.attachHandlers(iframeEl.contentWindow)
      bridge = b
      ready = true
      sendContext()
    } catch (e) {
      error = `Failed to initialize kanban bridge: ${String(e)}`
    }
  }

  $effect(() => {
    if (!ready || !bridge) return
    sendContext()
  })

  onDestroy(() => {
    bridge?.detach()
    bridge = null
  })
</script>

<div class="kanban-panel">
  {#if error}
    <div class="kanban-error">
      {error}
    </div>
  {/if}

  <iframe
    bind:this={iframeEl}
    src={widgetAppUrl}
    title="Repo Kanban"
    class="kanban-iframe"
    sandbox="allow-scripts allow-same-origin allow-forms"
    onload={handleIframeLoad}
  ></iframe>
</div>

<style>
  .kanban-panel {
    width: 100%;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 12px;
    overflow: hidden;
    background: var(--card, #fff);
  }

  .kanban-error {
    padding: 12px 14px;
    font-size: 12px;
    color: #991b1b;
    background: rgba(254, 226, 226, 0.8);
    border-bottom: 1px solid rgba(239, 68, 68, 0.25);
    word-break: break-word;
  }

  .kanban-iframe {
    width: 100%;
    height: 600px;
    border: none;
    display: block;
  }
</style>