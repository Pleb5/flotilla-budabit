<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import {get} from "svelte/store"
  import type {
    CommunityWidgetContext,
    CommunityWidgetRuntimeContext,
    LoadedWidgetExtension,
    SmartWidgetEvent,
    WidgetResizeRequest,
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
  let loadWatchdogTimer: ReturnType<typeof setTimeout> | undefined
  let bridgeExtension: LoadedWidgetExtension | undefined
  let readyOrigin = ""
  let loadFailed = $state(false)
  let loadAttempt = $state(0)
  let autoRetryCount = 0
  let lastLifecycleRetryAt = 0
  let lastAppUrl = ""
  let requestedHeight: number | undefined = $state()
  const maxRequestedHeight = 2400
  const iframeLoadTimeoutMs = 15_000
  const maxAutomaticRetries = 2
  const lifecycleRetryDebounceMs = 5_000
  const widgetLineId = $derived(getWidgetLineId(widget))
  const appTheme = $derived($theme === "dark" ? "dark" : "light")
  const appUrls = $derived(
    (widget.appUrls?.length ? widget.appUrls : widget.appUrl ? [widget.appUrl] : []).filter(url =>
      isSecureEmbeddableUrl(url),
    ),
  )
  const appUrl = $derived(appUrls[appUrlIndex])
  const frameAllow = $derived.by(() => {
    const permissions = new Set(widget.permissions || [])
    const allow = new Set(["autoplay", "clipboard-write", "fullscreen"])

    if (permissions.has("media:camera")) allow.add("camera")
    if (permissions.has("media:microphone")) allow.add("microphone")
    if (permissions.has("media:display-capture")) allow.add("display-capture")

    return Array.from(allow).join("; ")
  })
  const frameSrc = $derived.by(() => {
    if (!appUrl) return ""
    if (loadAttempt <= 0) return appUrl

    const url = new URL(appUrl)
    url.searchParams.set("_budabitWidgetRetry", String(loadAttempt))
    return url.toString()
  })

  const clearLoadWatchdog = () => {
    if (!loadWatchdogTimer) return

    clearTimeout(loadWatchdogTimer)
    loadWatchdogTimer = undefined
  }

  const detachBridge = () => {
    bridge?.detach()
    bridge = undefined
    bridgeExtension = undefined
  }

  const resetFrameStateForLoad = () => {
    loaded = false
    loadFailed = false
    requestedHeight = undefined
    initSent = false
    lastCommunityContextKey = ""
    readyOrigin = ""
    detachBridge()
  }

  const retryIframeLoad = (manual = false) => {
    if (!appUrl) return

    if (manual) {
      autoRetryCount = 0
    } else if (autoRetryCount >= maxAutomaticRetries) {
      loadFailed = true
      clearLoadWatchdog()
      return
    } else {
      autoRetryCount += 1
    }

    logCommunityWidgetDebug("widget frame retrying iframe load", {
      widgetId: widgetLineId,
      appUrl,
      loadAttempt: loadAttempt + 1,
      autoRetryCount,
      manual,
    })
    resetFrameStateForLoad()
    loadAttempt += 1
  }

  const recoverWidgetFrame = () => {
    if (!appUrl) return
    if (loaded && bridge && initSent) return

    if (loaded && bridge && !initSent) {
      sendContext(readyOrigin)
      return
    }

    const now = Date.now()
    if (now - lastLifecycleRetryAt < lifecycleRetryDebounceMs) return
    lastLifecycleRetryAt = now
    retryIframeLoad(loadFailed)
  }

  const recoverVisibleWidgetFrame = () => {
    if (document.visibilityState === "visible") recoverWidgetFrame()
  }

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

  const frameHeight = $derived.by(() => {
    if (requestedHeight === undefined) return undefined

    return Math.min(maxRequestedHeight, Math.max(minHeight, 1, Math.ceil(requestedHeight)))
  })

  const frameWrapperStyle = $derived.by(() => {
    const styles = [`min-height: ${minHeight}px`]
    if (frameHeight !== undefined) styles.push(`height: ${frameHeight}px`)

    return styles.join("; ")
  })

  const handleResizeRequest = ({height}: WidgetResizeRequest) => {
    if (height !== undefined) requestedHeight = height
  }

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
      hasCommunityRuntimeContext: Boolean(getCommunityRuntimeContext()),
      communityContextKey: lastCommunityContextKey,
    })
    postLegacyContext()
  }

  const onIframeLoad = () => {
    clearLoadWatchdog()
    loaded = true
    loadFailed = false
    autoRetryCount = 0
    requestedHeight = undefined
    initSent = false
    lastCommunityContextKey = ""
    detachBridge()

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
        onResizeRequest: handleResizeRequest,
      }
      bridgeExtension = ext
      bridge = new ExtensionBridge(ext)
      bridge.attachHandlers(iframeRef.contentWindow)
    }

    setTimeout(() => sendContext(readyOrigin), 100)
  }

  const onIframeError = () => {
    clearLoadWatchdog()
    if (appUrlIndex < appUrls.length - 1) {
      loaded = false
      loadFailed = false
      appUrlIndex += 1
      return
    }

    retryIframeLoad()
  }

  const onIframeLoadStalled = () => {
    if (loaded) return

    logCommunityWidgetDebug("widget frame iframe load stalled", {
      widgetId: widgetLineId,
      appUrl,
      frameSrc,
      autoRetryCount,
    })
    retryIframeLoad()
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

  $effect(() => {
    const src = frameSrc
    if (!src || loaded) {
      clearLoadWatchdog()
      return
    }

    clearLoadWatchdog()
    loadWatchdogTimer = setTimeout(onIframeLoadStalled, iframeLoadTimeoutMs)

    return clearLoadWatchdog
  })

  $effect(() => {
    const currentAppUrl = appUrl || ""
    if (currentAppUrl === lastAppUrl) return

    lastAppUrl = currentAppUrl
    autoRetryCount = 0
    loadAttempt = 0
    loadFailed = false
    if (currentAppUrl) resetFrameStateForLoad()
  })

  onMount(() => {
    window.addEventListener("message", handleMessage)
    window.addEventListener("pageshow", recoverWidgetFrame)
    window.addEventListener("focus", recoverWidgetFrame)
    window.addEventListener("online", recoverWidgetFrame)
    document.addEventListener("visibilitychange", recoverVisibleWidgetFrame)

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
    window.removeEventListener("pageshow", recoverWidgetFrame)
    window.removeEventListener("focus", recoverWidgetFrame)
    window.removeEventListener("online", recoverWidgetFrame)
    document.removeEventListener("visibilitychange", recoverVisibleWidgetFrame)
    surfaceObserver?.disconnect()
    clearLoadWatchdog()
    if (themePostFrame !== undefined) cancelAnimationFrame(themePostFrame)
    bridge?.post("widget:unmounting", {timestamp: Date.now()})
    detachBridge()
  })
</script>

<div
  bind:this={frameWrapperRef}
  class={`relative overflow-hidden bg-transparent ${className}`}
  style={frameWrapperStyle}>
  {#if !loaded}
    <div class="absolute inset-0 z-10 flex items-center justify-center bg-base-200">
      {#if loadFailed}
        <div class="flex max-w-sm flex-col items-center gap-3 p-4 text-center text-sm">
          <p class="opacity-75">This widget is taking too long to load.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick={() => retryIframeLoad(true)}>
            Retry widget
          </button>
        </div>
      {:else}
        <span class="loading loading-spinner loading-lg"></span>
      {/if}
    </div>
  {/if}
  {#if appUrl}
    <iframe
      bind:this={iframeRef}
      src={frameSrc}
      title={widget.content || widget.identifier}
      class={frameClass}
      style="background: transparent;"
      allow={frameAllow}
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
