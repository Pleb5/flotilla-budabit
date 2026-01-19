<script lang="ts">
  import {Card, Button} from "@nostr-git/ui"
  import {onDestroy, getContext} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {extensionSettings} from "@app/extensions/settings"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import type {LoadedWidgetExtension, ExtensionManifest} from "@app/extensions/types"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const extId = $page.params.extId ?? ""
  const naddr = $page.params.id ?? ""

  // Get extension manifest from settings
  const extension = $derived.by(() => {
    const settings = $extensionSettings
    if (!extId) return undefined
    const manifest = settings.installed.nip89[extId] as ExtensionManifest | undefined
    return manifest
  })

  const isEnabled = $derived.by(() => {
    const settings = $extensionSettings
    if (!extId) return false
    return settings.enabled.includes(extId)
  })

  // Get relays for the extension
  const repoRelays = $derived.by(() => {
    const router = Router.get()
    const userRelays = router.FromUser().getUrls()
    return userRelays.length > 0 ? userRelays : []
  })

  // Iframe state
  let iframeEl: HTMLIFrameElement | null = $state(null)
  let bridge: ExtensionBridge | null = $state(null)
  let ready = $state(false)
  let error = $state<string | null>(null)

  function createExtensionInstance(): LoadedWidgetExtension | null {
    if (!extension?.entrypoint) return null
    
    const origin = new URL(extension.entrypoint).origin
    const identifier = `${extension.id}:${repoClass.repoEvent?.pubkey}:${repoClass.name}`

    return {
      type: "widget",
      id: identifier,
      origin,
      widget: {
        id: `ext-${identifier}`,
        kind: 30033,
        content: "",
        pubkey: "",
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        identifier,
        widgetType: "tool",
        imageUrl: "",
        buttons: [],
        permissions: extension.permissions || [],
      },
    }
  }

  function sendContext(): void {
    if (!bridge || !iframeEl?.contentWindow) return

    const ctx = {
      contextId: `repo:${repoClass.repoEvent?.pubkey}:${repoClass.name}`,
      userPubkey: $pubkey,
      relays: repoRelays,
      repo: {
        repoPubkey: repoClass.repoEvent?.pubkey,
        repoName: repoClass.name,
        repoNaddr: naddr,
        repoRelays,
        maintainers: repoClass.maintainers || [],
      },
    }

    bridge.post("context:update", ctx)
  }

  function handleIframeLoad(): void {
    error = null

    if (!repoClass.repoEvent?.pubkey || !repoClass.name) {
      error = "Missing repo context."
      return
    }

    if (!iframeEl?.contentWindow) {
      error = "Extension iframe not available."
      return
    }

    try {
      const ext = createExtensionInstance()
      if (!ext) {
        error = "Extension has no entrypoint configured."
        return
      }
      // Add iframe reference so bridge.post() can send messages
      ;(ext as any).iframe = iframeEl
      const b = new ExtensionBridge(ext)
      b.attachHandlers(iframeEl.contentWindow)
      bridge = b
      ready = true
      sendContext()
    } catch (e) {
      error = `Failed to initialize extension: ${String(e)}`
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

<svelte:head>
  <title>{repoClass.name} - {extension?.name || extId}</title>
</svelte:head>

{#if !extension}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon="AlertCircle" size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">Extension Not Found</h2>
        <p class="text-sm text-muted-foreground">
          The extension "{extId}" is not installed.
        </p>
      </div>
      <Button onclick={() => goto('/settings/extensions')}>
        Go to Extension Settings
      </Button>
    </div>
  </Card>
{:else if !isEnabled}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon={extension.icon} size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">{extension.name} Disabled</h2>
        <p class="text-sm text-muted-foreground">
          Enable the {extension.name} extension to use this feature.
        </p>
      </div>
      <Button onclick={() => goto('/settings/extensions')}>
        Go to Extension Settings
      </Button>
    </div>
  </Card>
{:else if !extension.entrypoint}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon={extension.icon} size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">{extension.name}</h2>
        <p class="text-sm text-muted-foreground">
          This extension does not have an external entrypoint configured.
        </p>
      </div>
    </div>
  </Card>
{:else}
  <div class="extension-panel">
    {#if error}
      <div class="extension-error">
        {error}
      </div>
    {/if}

    <iframe
      bind:this={iframeEl}
      src={extension.entrypoint}
      title={extension.name}
      class="extension-iframe"
      sandbox="allow-scripts allow-same-origin allow-forms"
      onload={handleIframeLoad}
    ></iframe>
  </div>
{/if}

<style>
  .extension-panel {
    width: 100%;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 12px;
    overflow: hidden;
    background: var(--card, #fff);
  }

  .extension-error {
    padding: 12px 14px;
    font-size: 12px;
    color: #991b1b;
    background: rgba(254, 226, 226, 0.8);
    border-bottom: 1px solid rgba(239, 68, 68, 0.25);
    word-break: break-word;
  }

  .extension-iframe {
    width: 100%;
    height: 600px;
    border: none;
    display: block;
  }
</style>
