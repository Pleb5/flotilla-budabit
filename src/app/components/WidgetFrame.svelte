<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import {get} from "svelte/store"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {isSecureEmbeddableUrl, SECURE_EMBED_URL_REQUIREMENT} from "@app/extensions/url-policy"

  type Props = {
    widget: SmartWidgetEvent
    context?: Record<string, unknown>
    class?: string
    frameClass?: string
    minHeight?: number
  }

  const {
    widget,
    context = {},
    class: className = "",
    frameClass = "absolute inset-0 h-full w-full border-0",
    minHeight = 280,
  }: Props = $props()

  let iframeRef: HTMLIFrameElement | undefined = $state()
  let bridge: ExtensionBridge | undefined = $state()
  let loaded = $state(false)
  let appUrlIndex = $state(0)
  const widgetLineId = $derived(getWidgetLineId(widget))
  const appUrls = $derived(
    (widget.appUrls?.length ? widget.appUrls : widget.appUrl ? [widget.appUrl] : []).filter(url =>
      isSecureEmbeddableUrl(url),
    ),
  )
  const appUrl = $derived(appUrls[appUrlIndex])

  const getUserContext = () => {
    const userPubkey = get(pubkey)
    const profiles = get(profilesByPubkey)
    const profile = userPubkey ? profiles.get(userPubkey) : undefined

    return {
      pubkey: userPubkey || "",
      display_name: profile?.display_name || profile?.name || "",
      name: profile?.name || "",
      picture: profile?.picture || "",
      nip05: profile?.nip05 || "",
      lud16: profile?.lud16 || "",
      lud06: profile?.lud06 || "",
      website: profile?.website || "",
    }
  }

  const makeInitPayload = () => {
    const user = getUserContext()
    const communityContext = context.communityContext
    const relays =
      communityContext &&
      typeof communityContext === "object" &&
      Array.isArray((communityContext as any).relays)
        ? (communityContext as any).relays
        : undefined

    return {
      extensionId: widgetLineId,
      type: "widget",
      origin: appUrl ? new URL(appUrl).origin : "",
      hostVersion: "1.0.0",
      pubkey: user.pubkey,
      relays,
      user,
      context,
      communityContext,
      slot: context.slot || widget.slot,
      widget: {
        identifier: widget.identifier,
        widgetType: widget.widgetType,
        content: widget.content,
        imageUrl: widget.imageUrl,
        iconUrl: widget.iconUrl,
        inputLabel: widget.inputLabel,
        buttons: widget.buttons,
        permissions: widget.permissions,
      },
    }
  }

  const postLegacyContext = () => {
    if (!iframeRef?.contentWindow || !appUrl) return

    const targetOrigin = new URL(appUrl).origin
    const user = getUserContext()

    iframeRef.contentWindow.postMessage(
      {
        kind: "user-metadata",
        data: user,
      },
      targetOrigin,
    )
    iframeRef.contentWindow.postMessage(
      {kind: "budabit-widget-context", data: makeInitPayload()},
      targetOrigin,
    )
  }

  const sendContext = () => {
    bridge?.post("widget:init", makeInitPayload())
    bridge?.post("widget:mounted", {timestamp: Date.now()})
    postLegacyContext()
  }

  const onIframeLoad = () => {
    loaded = true
    bridge?.detach()

    if (iframeRef?.contentWindow && appUrl) {
      const origin = new URL(appUrl).origin
      const ext = {
        type: "widget" as const,
        id: widgetLineId,
        widget,
        origin,
        iframe: iframeRef,
      }
      bridge = new ExtensionBridge(ext)
      bridge.attachHandlers(iframeRef.contentWindow)
    }

    setTimeout(sendContext, 100)
  }

  const onIframeError = () => {
    if (appUrlIndex < appUrls.length - 1) {
      loaded = false
      appUrlIndex += 1
    }
  }

  const handleMessage = (event: MessageEvent) => {
    if (!appUrl) return

    try {
      const widgetOrigin = new URL(appUrl).origin
      if (event.origin !== widgetOrigin) return

      const {kind} = event.data || {}

      if (kind === "app-loaded") sendContext()
    } catch {
      // Ignore invalid messages.
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
  })

  onDestroy(() => {
    window.removeEventListener("message", handleMessage)
    bridge?.post("widget:unmounting", {timestamp: Date.now()})
    bridge?.detach()
  })
</script>

<div class={`relative overflow-hidden ${className}`} style={`min-height: ${minHeight}px`}>
  {#if !loaded}
    <div class="absolute inset-0 z-10 flex items-center justify-center bg-base-200">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {/if}
  {#if appUrl}
    <iframe
      bind:this={iframeRef}
      src={appUrl}
      title={widget.content || widget.identifier}
      class={frameClass}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      onload={onIframeLoad}
      onerror={onIframeError}></iframe>
  {:else if widget.appUrl}
    <div class="flex h-full items-center justify-center p-6 text-center text-sm opacity-70">
      This widget cannot be opened because its app URL is insecure. {SECURE_EMBED_URL_REQUIREMENT}
    </div>
  {:else}
    <div class="flex h-full items-center justify-center p-6 text-center text-sm opacity-70">
      This widget does not have an app URL.
    </div>
  {/if}
</div>
