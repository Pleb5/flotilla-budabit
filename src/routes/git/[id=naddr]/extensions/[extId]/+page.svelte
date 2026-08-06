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
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@app/core/git-state"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import type {LoadedWidgetExtension, SmartWidgetEvent, RepoContext} from "@app/extensions/types"
  import {isSecureEmbeddableUrl, SECURE_EMBED_URL_REQUIREMENT} from "@app/extensions/url-policy"
  import {theme} from "@app/util/theme"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  if (!repoClass || !repoRelaysStore) {
    throw new Error("Repo context not available")
  }

  const extRouteSegment = $page.params.extId ?? ""
  const naddr = $page.params.id ?? ""
  const normalizeRepoTabRouteSegment = (value: string) => value.trim().replace(/^\/+|\/+$/g, "")

  // Get repo-tab widget from settings
  const resolvedExtension = $derived.by(() => {
    const settings = $effectiveExtensionSettings
    if (!extRouteSegment) return undefined

    const widget = settings.installed.widget?.[extRouteSegment] as SmartWidgetEvent | undefined
    if (widget) return {id: extRouteSegment, extension: widget}

    const routeSegment = normalizeRepoTabRouteSegment(extRouteSegment)

    for (const [widgetId, installedWidget] of Object.entries(settings.installed.widget || {})) {
      if (installedWidget.slot?.type !== "repo-tab") continue
      if (normalizeRepoTabRouteSegment(installedWidget.slot.path) === routeSegment) {
        return {id: widgetId, extension: installedWidget as SmartWidgetEvent}
      }
    }

    return undefined
  })
  const resolvedExtId = $derived(resolvedExtension?.id || extRouteSegment)
  const extension = $derived(resolvedExtension?.extension)

  const extEntrypoint = $derived(extension?.appUrl)
  const secureExtEntrypoint = $derived(
    extEntrypoint && isSecureEmbeddableUrl(extEntrypoint) ? extEntrypoint : undefined,
  )

  const extName = $derived.by(() => {
    if (!extension) return extRouteSegment
    return extension.content || extension.identifier || extRouteSegment
  })

  const extIcon = $derived(extension?.iconUrl)

  const extPermissions = $derived(extension?.permissions || [])

  const isEnabled = $derived.by(() => {
    const settings = $effectiveExtensionSettings
    if (!resolvedExtId) return false
    return settings.enabled.includes(resolvedExtId)
  })

  // Spread into a plain array to avoid reactive proxy serialization through postMessage.
  const repoRelays = $derived([...$repoRelaysStore])
  const hasRepoRelayAuthority = $derived(repoRelays.length > 0)

  // Iframe state
  let iframeEl: HTMLIFrameElement | null = $state(null)
  let bridge: ExtensionBridge | null = $state(null)
  let extInstance: LoadedWidgetExtension | null = $state(null)
  let ready = $state(false)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let retryCount = $state(0)
  let iframeSrc = $state<string | undefined>(undefined)

  // Initialize iframe src when the widget app URL is available.
  $effect(() => {
    if (!hasRepoRelayAuthority) {
      iframeSrc = undefined
    } else if (secureExtEntrypoint && !iframeSrc) {
      iframeSrc = secureExtEntrypoint
    }
  })

  function buildRepoContext(): RepoContext | undefined {
    if (!repoClass.repoEvent?.pubkey || !repoClass.name || !hasRepoRelayAuthority) return undefined
    return {
      pubkey: repoClass.repoEvent.pubkey,
      name: repoClass.name,
      naddr: naddr,
      relays: [...repoRelays],
      maintainers: repoClass.maintainers ? [...repoClass.maintainers] : [],
    }
  }

  function createExtensionInstance(): LoadedWidgetExtension | null {
    if (!secureExtEntrypoint || !hasRepoRelayAuthority) return null

    const origin = new URL(secureExtEntrypoint).origin
    const identifier = `${resolvedExtId}:${repoClass.repoEvent?.pubkey}:${repoClass.name}`

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

  const appTheme = $derived($theme === "dark" ? "dark" : "light")

  function getHostBackgroundColor(): string {
    const visible = (value: string) =>
      value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)" ? value : ""

    // Walk up from the iframe's container so the extension matches the surface
    // it actually sits on (e.g. the extension panel card), not the page body.
    let element: Element | null = iframeEl?.parentElement || document.body
    while (element) {
      const background = visible(getComputedStyle(element).backgroundColor)
      if (background) return background
      element = element.parentElement
    }

    return (
      visible(getComputedStyle(document.documentElement).backgroundColor) ||
      (appTheme === "dark" ? "rgb(21, 28, 35)" : "rgb(255, 255, 255)")
    )
  }

  function sendTheme(): void {
    if (!bridge) return

    bridge.post("widget:themeChanged", {
      theme: appTheme,
      themeBackground: getHostBackgroundColor(),
    })
  }

  function sendContext(): void {
    if (!bridge || !iframeEl?.contentWindow || !hasRepoRelayAuthority) return

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
        error = "Extension has no app URL configured."
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
    if (!hasRepoRelayAuthority) return
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
    if (!repoClass.repoEvent?.pubkey || !repoClass.name || !hasRepoRelayAuthority) return

    // Keep repoContext on the extension object in sync so context:getRepo handler works
    if (extInstance) {
      extInstance.repoContext = buildRepoContext()
    }

    sendContext()
  })

  // Send the host theme once the bridge is ready and whenever it changes
  $effect(() => {
    void appTheme
    if (!ready || !bridge) return

    sendTheme()
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
          The extension "{extRouteSegment}" is not installed.
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
          This extension does not have an external app URL configured.
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
{:else if !hasRepoRelayAuthority}
  <Card class="p-6">
    <div class="flex flex-col items-center gap-4 text-center">
      <ExtensionIcon icon="AlertCircle" size={48} class="text-muted-foreground" />
      <div>
        <h2 class="text-lg font-semibold">Repository Relays Unavailable</h2>
        <p class="text-sm text-muted-foreground">
          This extension is disabled until a valid repository announcement declares at least one
          relay.
        </p>
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
