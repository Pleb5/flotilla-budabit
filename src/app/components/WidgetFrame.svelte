<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import {get} from "svelte/store"
  import type {
    CommunityWidgetContext,
    CommunityWidgetRuntimeContext,
    LoadedWidgetExtension,
    SmartWidgetEvent,
  } from "@app/extensions/types"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {isSecureEmbeddableUrl, SECURE_EMBED_URL_REQUIREMENT} from "@app/extensions/url-policy"
  import {theme} from "@app/util/theme"

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
  let frameWrapperRef: HTMLDivElement | undefined = $state()
  let lastCommunityContextKey = ""
  let initSent = false
  let lastThemePosted = ""
  let lastThemeBackgroundPosted = ""
  let surfaceObserver: ResizeObserver | undefined
  let themePostFrame: number | undefined
  let bridgeExtension: LoadedWidgetExtension | undefined
  let readyOrigin = ""
  const widgetLineId = $derived(getWidgetLineId(widget))
  const appTheme = $derived($theme === "dark" ? "dark" : "light")
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

  const getCommunityContext = () =>
    context.communityContext && typeof context.communityContext === "object"
      ? (context.communityContext as CommunityWidgetContext)
      : undefined

  const getCommunityRuntimeContext = () =>
    context.communityRuntimeContext && typeof context.communityRuntimeContext === "object"
      ? (context.communityRuntimeContext as CommunityWidgetRuntimeContext)
      : undefined

  const getPublicContext = () => {
    const publicContext = {...context}
    delete publicContext.communityRuntimeContext

    return publicContext
  }

  const getCommunityContextKey = () => {
    const communityContext = getCommunityContext()

    return communityContext
      ? `${communityContext.contextSessionId}:${communityContext.contextVersion}`
      : ""
  }

  const makeCommunityContextChangedPayload = (communityContext: CommunityWidgetContext) => ({
    contextSessionId: communityContext.contextSessionId,
    contextVersion: communityContext.contextVersion,
    communityContext,
  })

  const getAppOrigin = () => (appUrl ? new URL(appUrl).origin : "")

  type RgbaColor = {r: number; g: number; b: number; a: number}

  const parseCssColor = (value: string): RgbaColor | undefined => {
    if (!value || value === "transparent") return undefined

    const match = value.match(/^rgba?\(([^)]+)\)$/)
    if (!match) return undefined

    const parts = match[1].split(",").map(part => part.trim())
    const [r, g, b] = parts.slice(0, 3).map(Number)
    const a = parts[3] === undefined ? 1 : Number(parts[3])

    if (![r, g, b, a].every(Number.isFinite) || a <= 0) return undefined

    return {r, g, b, a: Math.min(1, Math.max(0, a))}
  }

  const blendColor = (top: RgbaColor, bottom: RgbaColor): RgbaColor => {
    const a = top.a + bottom.a * (1 - top.a)
    if (a <= 0) return {r: 0, g: 0, b: 0, a: 0}

    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
      a,
    }
  }

  const formatCssColor = ({r, g, b, a}: RgbaColor) =>
    a >= 0.999
      ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
      : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`

  const getContextualBackgroundColor = () => {
    if (typeof window === "undefined") return ""

    const elements: Element[] = []
    let element: Element | null = frameWrapperRef?.parentElement || iframeRef?.parentElement || null

    while (element) {
      elements.push(element)
      element = element.parentElement
    }

    let color: RgbaColor = appTheme === "dark"
      ? {r: 21, g: 28, b: 35, a: 1}
      : {r: 255, g: 255, b: 255, a: 1}

    for (const ancestor of elements.reverse()) {
      const background = parseCssColor(getComputedStyle(ancestor).backgroundColor)
      if (background) color = blendColor(background, color)
    }

    return formatCssColor(color)
  }

  const getHostBackgroundColor = () => {
    const contextualBackground = getContextualBackgroundColor()
    if (contextualBackground) return contextualBackground

    const bodyBackground = parseCssColor(getComputedStyle(document.body).backgroundColor)
    const rootBackground = parseCssColor(getComputedStyle(document.documentElement).backgroundColor)
    return formatCssColor(bodyBackground || rootBackground || {r: 255, g: 255, b: 255, a: 1})
  }

  const postThemeIfChanged = () => {
    if (!loaded || !bridge || !initSent) return

    const themeBackground = getHostBackgroundColor()
    if (appTheme === lastThemePosted && themeBackground === lastThemeBackgroundPosted) return

    postBridgeEvent("widget:themeChanged", {theme: appTheme, themeBackground})
    lastThemePosted = appTheme
    lastThemeBackgroundPosted = themeBackground
  }

  const scheduleThemePost = () => {
    if (themePostFrame !== undefined) cancelAnimationFrame(themePostFrame)

    themePostFrame = requestAnimationFrame(() => {
      themePostFrame = requestAnimationFrame(() => {
        themePostFrame = undefined
        postThemeIfChanged()
      })
    })
  }

  const isAllowedWidgetOrigin = (origin: string, source?: MessageEventSource | null) => {
    const expectedOrigin = getAppOrigin()

    return Boolean(
      origin === expectedOrigin ||
        (origin === "null" && iframeRef?.contentWindow && source === iframeRef.contentWindow) ||
        (expectedOrigin.includes("blossom.primal.net") && origin.includes("primal.net")),
    )
  }

  const syncBridgeOrigin = (origin: string, source?: MessageEventSource | null) => {
    if (!bridgeExtension || bridgeExtension.origin === origin) return false
    if (!isAllowedWidgetOrigin(origin, source)) return false

    logCommunityWidgetDebug("widget frame updating iframe origin", {
      widgetId: widgetLineId,
      previousOrigin: bridgeExtension.origin,
      origin,
    })
    bridgeExtension.origin = origin
    return true
  }

  const postBridgeEvent = (action: string, payload: unknown) => {
    if (!bridge) return false

    try {
      bridge?.post(action, payload)
      return true
    } catch (error) {
      console.warn("[widget-frame] Failed to post widget event", {
        widgetId: widgetLineId,
        action,
        error,
      })
      return false
    }
  }

  const makeInitPayload = () => {
    const user = getUserContext()
    const communityContext = getCommunityContext()
    const publicContext = getPublicContext()
    const relays =
      communityContext &&
      typeof communityContext === "object" &&
      Array.isArray((communityContext as any).relays)
        ? (communityContext as any).relays
        : undefined

    return {
      extensionId: widgetLineId,
      type: "widget",
      origin: bridgeExtension?.origin || getAppOrigin(),
      appOrigin: window.location.origin,
      theme: appTheme,
      themeBackground: getHostBackgroundColor(),
      hostVersion: "1.0.0",
      pubkey: user.pubkey,
      relays,
      user,
      context: publicContext,
      communityContext,
      slot: publicContext.slot || widget.slot,
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

    const targetOrigin = bridgeExtension?.origin || getAppOrigin()
    const user = getUserContext()

    try {
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
    } catch (error) {
      console.warn("[widget-frame] Failed to post legacy widget context", {
        widgetId: widgetLineId,
        targetOrigin,
        error,
      })
    }
  }

  const sendContext = (originOverride = "") => {
    if (originOverride && bridgeExtension && isAllowedWidgetOrigin(originOverride)) {
      syncBridgeOrigin(originOverride)
    }

    const payload = makeInitPayload()
    bridge?.updateCommunityContext(payload.communityContext, getCommunityRuntimeContext())
    const initPosted = postBridgeEvent("widget:init", payload)
    postBridgeEvent("widget:mounted", {timestamp: Date.now()})
    lastCommunityContextKey = getCommunityContextKey()
    lastThemePosted = payload.theme
    lastThemeBackgroundPosted = payload.themeBackground
    initSent = initPosted
    logCommunityWidgetDebug("widget frame sent context", {
      widgetId: widgetLineId,
      appUrl,
      origin: bridgeExtension?.origin || getAppOrigin(),
      originOverride,
      initPosted,
      hasCommunityContext: Boolean(payload.communityContext),
      communityContextKey: lastCommunityContextKey,
    })
    postLegacyContext()
  }

  const onIframeLoad = () => {
    loaded = true
    initSent = false
    lastCommunityContextKey = ""
    bridge?.detach()

    if (iframeRef?.contentWindow && appUrl) {
      const origin = readyOrigin && isAllowedWidgetOrigin(readyOrigin) ? readyOrigin : getAppOrigin()
      const ext: LoadedWidgetExtension = {
        type: "widget" as const,
        id: widgetLineId,
        widget,
        origin,
        iframe: iframeRef,
        communityContext: getCommunityContext(),
        communityRuntimeContext: getCommunityRuntimeContext(),
      }
      bridgeExtension = ext
      bridge = new ExtensionBridge(ext)
      bridge.attachHandlers(iframeRef.contentWindow)
    }

    setTimeout(() => sendContext(readyOrigin), 100)
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
      const {kind, type, action} = event.data || {}

      if (kind === "app-loaded" || (type === "event" && action === "widget:ready")) {
        if (!isAllowedWidgetOrigin(event.origin, event.source)) return
        readyOrigin = event.origin
        syncBridgeOrigin(event.origin, event.source)

        logCommunityWidgetDebug("widget frame received widget ready", {
          widgetId: widgetLineId,
          origin: event.origin,
          kind,
          type,
          action,
          bridgeReady: Boolean(bridge),
        })
        if (bridge) {
          sendContext(event.origin)
        }
      }
    } catch {
      // Ignore invalid messages.
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)

    if (typeof ResizeObserver !== "undefined" && frameWrapperRef) {
      surfaceObserver = new ResizeObserver(() => scheduleThemePost())
      let element: Element | null = frameWrapperRef
      while (element && element !== document.documentElement) {
        surfaceObserver.observe(element)
        element = element.parentElement
      }
    }
  })

  $effect(() => {
    const key = getCommunityContextKey()
    const communityContext = getCommunityContext()
    if (!loaded || !bridge || !initSent || !key || !communityContext) return
    if (!lastCommunityContextKey) {
      lastCommunityContextKey = key
      bridge.updateCommunityContext(communityContext, getCommunityRuntimeContext())
      bridge.post("community:contextChanged", makeCommunityContextChangedPayload(communityContext))
      return
    }
    if (key === lastCommunityContextKey) return

    lastCommunityContextKey = key
    bridge.updateCommunityContext(communityContext, getCommunityRuntimeContext())
    bridge.post("community:contextChanged", makeCommunityContextChangedPayload(communityContext))
  })

  $effect(() => {
    appTheme
    scheduleThemePost()
  })

  onDestroy(() => {
    window.removeEventListener("message", handleMessage)
    surfaceObserver?.disconnect()
    if (themePostFrame !== undefined) cancelAnimationFrame(themePostFrame)
    bridge?.post("widget:unmounting", {timestamp: Date.now()})
    bridge?.detach()
    bridgeExtension = undefined
  })
</script>

<div
  bind:this={frameWrapperRef}
  class={`relative overflow-hidden bg-transparent ${className}`}
  style={`min-height: ${minHeight}px`}>
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
      style="background: transparent;"
      allowtransparency={true}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
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
