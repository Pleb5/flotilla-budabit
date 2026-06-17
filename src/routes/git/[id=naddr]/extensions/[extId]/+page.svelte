<style>
  .extension-panel {
    width: 100%;
    height: calc(100vh - 4rem);
    min-height: 600px;
    border: 1px solid hsl(var(--ng-border, 214 30% 84%));
    border-radius: 12px;
    overflow: hidden;
    background: hsl(var(--ng-card, 0 0% 100%));
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .extension-error {
    padding: 12px 14px;
    font-size: 12px;
    color: hsl(var(--ng-destructive, 0 72% 50%));
    background: hsl(var(--ng-destructive, 0 72% 50%) / 0.12);
    border-bottom: 1px solid hsl(var(--ng-destructive, 0 72% 50%) / 0.25);
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
    background: hsl(var(--ng-card, 0 0% 100%) / 0.95);
    backdrop-filter: blur(4px);
    z-index: 10;
  }

  .extension-iframe {
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    border: none;
    display: block;
    opacity: 0;
    transition: opacity 0.3s ease-in;
  }

  .extension-iframe:not(.loading) {
    opacity: 1;
  }
</style>

<script lang="ts">
  import {Card, Button} from "@nostr-git/ui"
  import {getContext} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {REPO_KEY} from "@app/core/git-state"
  import type {Repo} from "@nostr-git/ui"
  import type {
    LoadedWidgetExtension,
    ExtensionManifest,
    SmartWidgetEvent,
    RepoContext,
  } from "@app/extensions/types"
  import {isSecureEmbeddableUrl, SECURE_EMBED_URL_REQUIREMENT} from "@app/extensions/url-policy"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Derive extId from URL pathname — same reactive source as layout's activeTab.
  // $page.params may be mutated in-place for same-route navigation (Svelte 5
  // would see no ref change), but $page.url.pathname is always a new string.
  const extId = $derived.by(() => {
    const pathname = $page.url.pathname
    const parts = pathname.split("/").filter(Boolean)
    const idx = parts.indexOf("extensions")
    return idx >= 0 ? (parts[idx + 1] ?? "") : ""
  })
  const naddr = $derived.by(() => $page.params.id ?? "")

  // Get extension manifest or widget from settings
  const extension = $derived.by(() => {
    const settings = $effectiveExtensionSettings
    if (!extId) return undefined
    // Check NIP-89 extensions first
    const manifest = settings.installed.nip89[extId] as ExtensionManifest | undefined
    if (manifest) return manifest
    // Check Smart Widget extensions
    const widget = settings.installed.widget?.[extId] as SmartWidgetEvent | undefined
    return widget
  })

  // Helper to determine if extension is a widget
  const isWidget = $derived(extension && "widgetType" in extension)

  // Normalize properties between NIP-89 manifests and Smart Widgets
  const extEntrypoint = $derived.by(() => {
    if (!extension) return undefined
    if ("entrypoint" in extension) return extension.entrypoint
    if ("appUrl" in extension) return extension.appUrl
    return undefined
  })
  const secureExtEntrypoint = $derived(
    extEntrypoint && isSecureEmbeddableUrl(extEntrypoint) ? extEntrypoint : undefined,
  )

  const extName = $derived.by(() => {
    if (!extension) return extId
    if ("name" in extension) return extension.name
    if ("content" in extension && extension.content) return extension.content
    if ("identifier" in extension) return extension.identifier
    return extId
  })

  const extIcon = $derived.by(() => {
    if (!extension) return undefined
    if ("icon" in extension) return extension.icon
    if ("iconUrl" in extension) return extension.iconUrl
    return undefined
  })

  const extPermissions = $derived.by(() => {
    if (!extension) return []
    return extension.permissions || []
  })

  const isEnabled = $derived.by(() => {
    const settings = $effectiveExtensionSettings
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
  let retryCount = $state(0)
  let iframeSrc = $state<string | undefined>(undefined)

  // Effect 1: track extId as a reactive dep (derived from $page.url.pathname —
  // the same reactive source the layout uses for tab highlighting).
  // The cleanup function runs before the effect re-runs on every navigation,
  // so bridge and iframe state are always torn down cleanly between extensions.
  $effect(() => {
    void extId // register extId as a reactive dependency
    return () => {
      bridge?.detach()
      bridge = null
      extInstance = null
      ready = false
      loading = true
      error = null
      retryCount = 0
      iframeSrc = undefined
    }
  })

  // Effect 2: set iframeSrc whenever a secure entrypoint is available and not yet loaded.
  // Reading iframeSrc here makes it a dep — so when Effect 1's cleanup resets iframeSrc
  // to undefined, this effect re-runs and reloads even if secureExtEntrypoint didn't change
  // (e.g., two extensions with the same URL).
  $effect(() => {
    if (secureExtEntrypoint && !iframeSrc) {
      iframeSrc = secureExtEntrypoint
    }
  })

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
    if (!secureExtEntrypoint) return null

    const origin = new URL(secureExtEntrypoint).origin
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
    const userPubkey = $pubkey ?? ""

    // Flat RepoContext shape expected by budabit-sdk extensions
    const repoCtx = {
      repoPubkey: repoClass.repoEvent?.pubkey ?? "",
      repoName: repoClass.name ?? "",
      repoNaddr: naddr,
      repoRelays: relays,
      maintainers,
    }

    // widget:init — delivers user pubkey and host version on first connect.
    // Send before context:repoUpdate so extensions can read pubkey synchronously.
    bridge.post("widget:init", {
      pubkey: userPubkey,
      hostVersion: "1.0.0",
      relays,
    })

    // context:repoUpdate — flat RepoContext for budabit-sdk bridge.onEvent('context:repoUpdate')
    bridge.post("context:repoUpdate", repoCtx)

    // context:update — legacy event for backwards-compatible extensions
    bridge.post("context:update", {
      contextId: `repo:${repoClass.repoEvent?.pubkey}:${repoClass.name}`,
      userPubkey,
      relays,
      repo: repoCtx,
    })
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
      retryCount = 0
      // Context will be sent reactively when repo data is available
    } catch (e) {
      error = `Failed to initialize extension: ${String(e)}`
      loading = false
    }
  }

  function handleIframeError(): void {
    loading = false
    error = `Failed to load ${extName}. The extension server may be temporarily unavailable.`
  }

  function retryLoad(): void {
    error = null
    loading = true
    retryCount++
    // Force iframe reload by updating src with cache buster
    if (secureExtEntrypoint) {
      const url = new URL(secureExtEntrypoint)
      url.searchParams.set("_retry", retryCount.toString())
      url.searchParams.set("_t", Date.now().toString())
      iframeSrc = url.toString()
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
      <Button onclick={() => goto("/settings/extensions")}>Go to Extension Settings</Button>
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
      <Button onclick={() => goto("/settings/extensions")}>Go to Extension Settings</Button>
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
{:else if !secureExtEntrypoint}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon="AlertCircle" size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">Insecure Extension URL Blocked</h2>
        <p class="text-sm text-muted-foreground">{SECURE_EMBED_URL_REQUIREMENT}</p>
      </div>
    </div>
  </Card>
{:else}
  <div class="extension-panel">
    {#if error}
      <div class="extension-error">
        <div class="flex items-center justify-between gap-4">
          <span class="flex-1">{error}</span>
          <Button size="sm" onclick={retryLoad}>Retry</Button>
        </div>
      </div>
    {/if}

    {#if loading}
      <div class="extension-loading">
        <Spinner loading={true}>Loading {extName}...</Spinner>
      </div>
    {/if}

    <iframe
      bind:this={iframeEl}
      src={iframeSrc}
      title={extName}
      class="extension-iframe"
      class:loading
      sandbox="allow-scripts allow-same-origin allow-forms"
      onload={handleIframeLoad}
      onerror={handleIframeError}></iframe>
  </div>
{/if}
