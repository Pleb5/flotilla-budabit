<script lang="ts">
  import {Card, Button} from "@nostr-git/ui"
  import {getContext} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {extensionSettings} from "@app/extensions/settings"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import type {LoadedWidgetExtension, ExtensionManifest, SmartWidgetEvent, RepoContext} from "@app/extensions/types"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const extId = $page.params.extId ?? ""
  const naddr = $page.params.id ?? ""

  // Get extension manifest or widget from settings
  const extension = $derived.by(() => {
    const settings = $extensionSettings
    if (!extId) return undefined
    // Check NIP-89 extensions first
    const manifest = settings.installed.nip89[extId] as ExtensionManifest | undefined
    if (manifest) return manifest
    // Check Smart Widget extensions
    const widget = settings.installed.widget?.[extId] as SmartWidgetEvent | undefined
    return widget
  })

  // Helper to determine if extension is a widget
  const isWidget = $derived(extension && 'widgetType' in extension)

  // Normalize properties between NIP-89 manifests and Smart Widgets
  const extEntrypoint = $derived.by(() => {
    if (!extension) return undefined
    if ('entrypoint' in extension) return extension.entrypoint
    if ('appUrl' in extension) return extension.appUrl
    return undefined
  })

  const extName = $derived.by(() => {
    if (!extension) return extId
    if ('name' in extension) return extension.name
    if ('content' in extension && extension.content) return extension.content
    if ('identifier' in extension) return extension.identifier
    return extId
  })

  const extIcon = $derived.by(() => {
    if (!extension) return undefined
    if ('icon' in extension) return extension.icon
    if ('iconUrl' in extension) return extension.iconUrl
    return undefined
  })

  const extPermissions = $derived.by(() => {
    if (!extension) return []
    return extension.permissions || []
  })

  const isEnabled = $derived.by(() => {
    const settings = $extensionSettings
    if (!extId) return false
    return settings.enabled.includes(extId)
  })

  // Get relays for the extension - use repo's relays, fallback to user relays
  // Spread into new array to avoid reactive proxy serialization issues with postMessage
  const repoRelays = $derived.by(() => {
    // First try repo's declared relays
    if (repoClass.relays && repoClass.relays.length > 0) {
      return [...repoClass.relays]
    }
    // Fallback to user relays
    const router = Router.get()
    const userRelays = router.FromUser().getUrls()
    if (userRelays.length > 0) return [...userRelays]
    // Last resort: default git relays
    return ["wss://relay.sharegap.net/", "wss://nos.lol/"]
  })

  // Iframe state
  let iframeEl: HTMLIFrameElement | null = $state(null)
  let bridge: ExtensionBridge | null = $state(null)
  let extInstance: LoadedWidgetExtension | null = $state(null)
  let ready = $state(false)
  let loading = $state(true)
  let error = $state<string | null>(null)

  function buildRepoContext(): RepoContext | undefined {
    if (!repoClass.repoEvent?.pubkey || !repoClass.name) return undefined
    return {
      pubkey: repoClass.repoEvent.pubkey,
      name: repoClass.name,
      naddr: naddr,
      relays: [...repoRelays],
    }
  }

  function createExtensionInstance(): LoadedWidgetExtension | null {
    if (!extEntrypoint) return null
    
    const origin = new URL(extEntrypoint).origin
    const identifier = `${extId}:${repoClass.repoEvent?.pubkey}:${repoClass.name}`

    return {
      type: "widget",
      id: identifier,
      origin,
      repoContext: buildRepoContext(),
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
        permissions: extPermissions,
      },
    }
  }

  function sendContext(): void {
    if (!bridge || !iframeEl?.contentWindow) return

    // Spread arrays to avoid reactive proxy serialization issues with postMessage
    const maintainers = repoClass.maintainers ? [...repoClass.maintainers] : []
    const relays = [...repoRelays]

    const ctx = {
      contextId: `repo:${repoClass.repoEvent?.pubkey}:${repoClass.name}`,
      userPubkey: $pubkey,
      relays,
      repo: {
        repoPubkey: repoClass.repoEvent?.pubkey,
        repoName: repoClass.name,
        repoNaddr: naddr,
        repoRelays: relays,
        maintainers,
      },
    }

    bridge.post("context:update", ctx)
  }

  function handleIframeLoad(): void {
    error = null
    loading = false

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
      extInstance = ext
      bridge = b
      ready = true
      // Context will be sent reactively when repo data is available
    } catch (e) {
      error = `Failed to initialize extension: ${String(e)}`
    }
  }

  // Send context updates when ready and repo data is available
  $effect(() => {
    if (!ready || !bridge) return
    // Wait for repo context to be available
    if (!repoClass.repoEvent?.pubkey || !repoClass.name) return

    // Keep repoContext on the extension object in sync so context:getRepo handler works
    if (extInstance) {
      extInstance.repoContext = buildRepoContext()
    }

    sendContext()
  })

  // Cleanup bridge on destroy
  $effect(() => {
    return () => {
      bridge?.detach()
      bridge = null
    }
  })
</script>

<svelte:head>
  <title>{repoClass.name} - {extName}</title>
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
      <ExtensionIcon icon={extIcon} size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">{extName} Disabled</h2>
        <p class="text-sm text-muted-foreground">
          Enable the {extName} extension to use this feature.
        </p>
      </div>
      <Button onclick={() => goto('/settings/extensions')}>
        Go to Extension Settings
      </Button>
    </div>
  </Card>
{:else if !extEntrypoint}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon={extIcon} size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">{extName}</h2>
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

    {#if loading}
      <div class="extension-loading">
        <Spinner loading={true}>Loading {extName}...</Spinner>
      </div>
    {/if}

    <iframe
      bind:this={iframeEl}
      src={extEntrypoint}
      title={extName}
      class="extension-iframe"
      class:loading={loading}
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
    position: relative;
    min-height: 600px;
  }

  .extension-error {
    padding: 12px 14px;
    font-size: 12px;
    color: #991b1b;
    background: rgba(254, 226, 226, 0.8);
    border-bottom: 1px solid rgba(239, 68, 68, 0.25);
    word-break: break-word;
  }

  .extension-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(4px);
    z-index: 10;
  }

  @media (prefers-color-scheme: dark) {
    .extension-loading {
      background: rgba(0, 0, 0, 0.85);
    }
  }

  .extension-iframe {
    width: 100%;
    height: 600px;
    border: none;
    display: block;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }

  .extension-iframe:not(.loading) {
    opacity: 1;
  }
</style>
