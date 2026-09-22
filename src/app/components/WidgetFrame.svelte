<script lang="ts">
  import {onDestroy, onMount, untrack} from "svelte"
  import {get, type Readable} from "svelte/store"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import type {
    CommunityWidgetContext,
    CommunityWidgetRuntimeContext,
    LoadedWidgetExtension,
    SmartWidgetEvent,
    WidgetResizeRequest,
    WidgetVisibilityRequest,
    WidgetFrameState,
  } from "@app/extensions/types"
  import {ExtensionBridge} from "@app/extensions/bridge"
  import {
    MAX_WIDGET_RESIZE_HEIGHT,
    getHostCapabilitySnapshot,
  } from "@app/extensions/host-capabilities"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {
    getWidgetVisibilityContextKey,
    hasWidgetControlledVisibility,
    validateWidgetVisibilityRequest,
  } from "@app/extensions/widget-visibility"
  import {
    isAllowedExtensionOrigin,
    isSecureEmbeddableUrl,
    SECURE_EMBED_URL_REQUIREMENT,
  } from "@app/extensions/url-policy"
  import {theme} from "@app/util/theme"

  type Props = {
    widget: SmartWidgetEvent
    context?: Record<string, unknown>
    class?: string
    frameClass?: string
    minHeight?: number
    resizeMinHeight?: number
    onResizeRequest?: (request: WidgetResizeRequest) => void
    onLoad?: () => void
    autoHeight?: boolean
    onState?: (state: WidgetFrameState) => void
    communityRuntimeContextProvider?: () => CommunityWidgetRuntimeContext | undefined
    communityRuntimeContextStore?: Readable<CommunityWidgetRuntimeContext | undefined>
  }

  const {
    widget,
    context = {},
    class: className = "",
    frameClass = "absolute inset-0 h-full w-full border-0",
    minHeight = 280,
    resizeMinHeight = minHeight,
    onResizeRequest,
    onLoad,
    autoHeight = false,
    onState,
    communityRuntimeContextProvider,
    communityRuntimeContextStore,
  }: Props = $props()

  let iframeRef: HTMLIFrameElement | undefined = $state()
  let bridge: ExtensionBridge | undefined = $state()
  let loaded = $state(false)
  let appUrlIndex = $state(0)
  let frameWrapperRef: HTMLDivElement | undefined = $state()
  let lastCommunityContextKey = ""
  let lastUserContextKey = ""
  let initSent = $state(false)
  let lastThemePosted = ""
  let lastThemeBackgroundPosted = ""
  let surfaceObserver: ResizeObserver | undefined
  let themePostFrame: number | undefined
  let loadWatchdogTimer: ReturnType<typeof setTimeout> | undefined
  let contextPostTimer: ReturnType<typeof setTimeout> | undefined
  let bridgeExtension: LoadedWidgetExtension | undefined
  let readyOrigin = ""
  let loadFailed = $state(false)
  let loadAttempt = $state(0)
  let autoRetryCount = 0
  let lastLifecycleRetryAt = 0
  let lastAppUrl = ""
  let requestedHeight: number | undefined = $state()
  let visibilityDecision = $state<WidgetVisibilityRequest | undefined>()
  let visibilityDecisionKey = $state("")
  let presentationTimedOut = $state(false)
  const deferredVisibility = $derived(autoHeight && hasWidgetControlledVisibility(widget))
  const visibilityContextKey = $derived.by(() =>
    getWidgetVisibilityContextKey(getCommunityContext()),
  )
  const visibility = $derived(
    deferredVisibility
      ? visibilityDecisionKey === visibilityContextKey && visibilityContextKey
        ? visibilityDecision?.visibility || "pending"
        : "pending"
      : "visible",
  )
  const surfaceVisible = $derived(visibility === "visible")
  const presentationReady = $derived(
    loaded && initSent && (!autoHeight || requestedHeight !== undefined),
  )
  const presentationFailed = $derived.by(() => loadFailed || presentationTimedOut || !appUrl)
  const widgetTitle = $derived(
    widget.slot?.label || widget.content || widget.identifier || "Widget",
  )
  const maxRequestedHeight = MAX_WIDGET_RESIZE_HEIGHT
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

    if (permissions.has("media:camera")) allow.add("camera *")
    if (permissions.has("media:microphone")) allow.add("microphone *")
    if (permissions.has("media:display-capture")) allow.add("display-capture *")

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

  const clearContextPostTimer = () => {
    if (!contextPostTimer) return

    clearTimeout(contextPostTimer)
    contextPostTimer = undefined
  }

  const detachBridge = () => {
    bridge?.detach()
    bridge = undefined
    bridgeExtension = undefined
  }

  const resetFrameStateForLoad = () => {
    clearContextPostTimer()
    loaded = false
    loadFailed = false
    requestedHeight = undefined
    initSent = false
    lastCommunityContextKey = ""
    readyOrigin = ""
    visibilityDecision = undefined
    visibilityDecisionKey = ""
    presentationTimedOut = false
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
    const userPubkey = $pubkey
    const profiles = $profilesByPubkey
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

  const liveCommunityRuntimeContext = $derived(
    communityRuntimeContextStore
      ? $communityRuntimeContextStore
      : communityRuntimeContextProvider?.(),
  )
  const hasLiveCommunityContext = $derived(
    Boolean(communityRuntimeContextStore || communityRuntimeContextProvider),
  )
  const getCommunityContext = () =>
    hasLiveCommunityContext
      ? liveCommunityRuntimeContext?.communityContext
      : context.communityContext && typeof context.communityContext === "object"
        ? (context.communityContext as CommunityWidgetContext)
        : undefined

  const getCommunityRuntimeContext = () => {
    if (hasLiveCommunityContext)
      return liveCommunityRuntimeContext?.authorityEvidenceSettled === false
        ? undefined
        : liveCommunityRuntimeContext

    return context.communityRuntimeContext && typeof context.communityRuntimeContext === "object"
      ? (context.communityRuntimeContext as CommunityWidgetRuntimeContext)
      : undefined
  }

  const getPublicContext = () => {
    const publicContext = {...context}
    delete publicContext.communityRuntimeContext
    if (hasLiveCommunityContext) publicContext.communityContext = getCommunityContext()

    return publicContext
  }

  const getCommunityContextKey = () => {
    const communityContext = getCommunityContext()

    return communityContext
      ? `${communityContext.contextSessionId}:${communityContext.contextVersion}`
      : ""
  }

  const makeCommunityContextChangedPayload = (communityContext?: CommunityWidgetContext) => ({
    contextSessionId: communityContext?.contextSessionId,
    contextVersion: communityContext?.contextVersion,
    communityContext,
  })

  const getAppOrigin = () => (appUrl ? new URL(appUrl).origin : "")

  const frameHeight = $derived.by(() => {
    if (requestedHeight === undefined) return undefined

    return Math.min(maxRequestedHeight, Math.max(resizeMinHeight, 1, Math.ceil(requestedHeight)))
  })

  const frameWrapperStyle = $derived.by(() => {
    if (!surfaceVisible) return "height: 0; min-height: 0"
    if (autoHeight && (!presentationReady || presentationFailed)) {
      return `min-height: ${Math.max(minHeight, 220)}px`
    }
    const minimumHeight = requestedHeight === undefined ? minHeight : resizeMinHeight
    const styles = [`min-height: ${minimumHeight}px`]
    if (frameHeight !== undefined) styles.push(`height: ${frameHeight}px`)

    return styles.join("; ")
  })

  const handleResizeRequest = (request: WidgetResizeRequest) => {
    if (request.height !== undefined) requestedHeight = request.height
    if (presentationReady) presentationTimedOut = false
    onResizeRequest?.(request)
  }

  const handleVisibilityRequest = (request: WidgetVisibilityRequest) => {
    // Check against the current reactive context too, not just the bridge's
    // most recently posted context (which can lag by an effect).
    validateWidgetVisibilityRequest(request, getCommunityContext())
    if (request.visibility === "visible" && visibility !== "visible") requestedHeight = undefined
    visibilityDecision = request
    visibilityDecisionKey = getWidgetVisibilityContextKey(getCommunityContext())
    presentationTimedOut = false
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

    let color: RgbaColor =
      appTheme === "dark" ? {r: 21, g: 28, b: 35, a: 1} : {r: 255, g: 255, b: 255, a: 1}

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

  const isAllowedWidgetOrigin = (origin: string, source?: MessageEvent["source"]) => {
    const expectedOrigin = getAppOrigin()

    return Boolean(
      isAllowedExtensionOrigin(expectedOrigin, origin) ||
      (origin === "null" && iframeRef?.contentWindow && source === iframeRef.contentWindow),
    )
  }

  const syncBridgeOrigin = (origin: string, source?: MessageEvent["source"]) => {
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
      capabilities: getHostCapabilitySnapshot({
        widget,
        resize: true,
        media: true,
        visibility: deferredVisibility,
        slot:
          publicContext.slot && typeof publicContext.slot === "object"
            ? String((publicContext.slot as any).type || "")
            : widget.slot?.type,
      }),
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
    if (initPosted && !initSent) postBridgeEvent("widget:mounted", {timestamp: Date.now()})
    lastCommunityContextKey = getCommunityContextKey()
    lastUserContextKey = JSON.stringify(payload.user)
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
    clearContextPostTimer()
    visibilityDecision = undefined
    visibilityDecisionKey = ""
    presentationTimedOut = false
    loaded = true
    onLoad?.()
    loadFailed = false
    autoRetryCount = 0
    requestedHeight = undefined
    initSent = false
    lastCommunityContextKey = ""
    detachBridge()

    if (iframeRef?.contentWindow && appUrl) {
      const origin =
        readyOrigin && isAllowedWidgetOrigin(readyOrigin) ? readyOrigin : getAppOrigin()
      const ext: LoadedWidgetExtension = {
        type: "widget" as const,
        id: widgetLineId,
        widget,
        origin,
        iframe: iframeRef,
        communityContext: getCommunityContext(),
        communityRuntimeContext: getCommunityRuntimeContext(),
        communityRuntimeContextProvider: communityRuntimeContextStore
          ? () => {
              // A pending authority snapshot still supplies public identity/version
              // to preserve drafts, but cannot authorize any bridge operation.
              const runtime = get(communityRuntimeContextStore)
              return runtime?.authorityEvidenceSettled === false ? undefined : runtime
            }
          : communityRuntimeContextProvider,
        onResizeRequest: handleResizeRequest,
        ...(deferredVisibility ? {onVisibilityRequest: handleVisibilityRequest} : {}),
      }
      bridgeExtension = ext
      bridge = new ExtensionBridge(ext)
      bridge.attachHandlers(iframeRef.contentWindow)
    }

    if (readyOrigin) {
      sendContext(readyOrigin)
    } else {
      contextPostTimer = setTimeout(() => {
        contextPostTimer = undefined
        if (!initSent) sendContext()
      }, 100)
    }
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
        if (event.source !== iframeRef?.contentWindow) return
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
        if (bridge && (!initSent || (type === "event" && action === "widget:ready"))) {
          clearContextPostTimer()
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

  $effect(() => {
    void visibilityContextKey
    presentationTimedOut = false
    if (!loaded || !initSent || visibility === "hidden") return
    if (presentationReady && visibility === "visible") return
    const timer = setTimeout(() => (presentationTimedOut = true), iframeLoadTimeoutMs)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    onState?.({
      visibility,
      loaded,
      terminal:
        presentationFailed || visibility === "hidden" || (surfaceVisible && presentationReady),
      failed: presentationFailed,
    })
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
    if (!loaded || !bridge || !initSent) return
    if (key === lastCommunityContextKey) return

    lastCommunityContextKey = key
    bridge.updateCommunityContext(communityContext, getCommunityRuntimeContext())
    bridge.post("community:contextChanged", makeCommunityContextChangedPayload(communityContext))
  })

  $effect(() => {
    const userKey = JSON.stringify(getUserContext())
    if (!loaded || !bridge || !initSent || userKey === lastUserContextKey) return
    // Reuse widget:init for late profile hydration and account switches. A matching
    // community context lets widgets update identity without restarting their runtime.
    untrack(() => sendContext(readyOrigin))
  })

  $effect(() => {
    void appTheme
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
    clearContextPostTimer()
    if (themePostFrame !== undefined) cancelAnimationFrame(themePostFrame)
    bridge?.post("widget:unmounting", {timestamp: Date.now()})
    detachBridge()
  })
</script>

<div
  bind:this={frameWrapperRef}
  class={`relative overflow-hidden bg-transparent ${className}`}
  data-widget-visibility={visibility}
  data-widget-state={presentationFailed ? "error" : presentationReady ? "ready" : "loading"}
  aria-busy={surfaceVisible && !presentationReady && !presentationFailed}
  style={frameWrapperStyle}>
  {#if surfaceVisible && (!presentationReady || presentationFailed)}
    <div class="z-10 absolute inset-0 flex items-center justify-center bg-base-200">
      {#if presentationFailed}
        <div class="flex max-w-sm flex-col items-center gap-3 p-4 text-center text-sm">
          <p role="status" class="opacity-75">
            {appUrl
              ? `${widgetTitle} is taking too long to load.`
              : widget.appUrl
                ? `This widget cannot be opened. ${SECURE_EMBED_URL_REQUIREMENT}`
                : "This widget does not have an app URL."}
          </p>
          {#if appUrl}
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onclick={() => retryIframeLoad(true)}>
              Retry widget
            </button>
          {/if}
        </div>
      {:else if autoHeight}
        <div
          class="w-full max-w-lg space-y-4 p-6 motion-safe:animate-pulse"
          role="status"
          aria-label={`Loading ${widgetTitle}`}>
          <span class="sr-only">Loading {widgetTitle}…</span>
          <div aria-hidden="true" class="h-5 w-2/5 rounded bg-base-content/25"></div>
          <div aria-hidden="true" class="h-4 w-full rounded bg-base-content/20"></div>
          <div aria-hidden="true" class="h-4 w-4/5 rounded bg-base-content/20"></div>
          <div aria-hidden="true" class="h-10 w-32 rounded-box bg-base-content/25"></div>
        </div>
      {:else}
        <div role="status" class="flex flex-col items-center gap-3">
          <span aria-hidden="true" class="loading loading-spinner loading-lg"></span>
          <span class="text-sm opacity-75">Loading {widgetTitle}…</span>
        </div>
      {/if}
    </div>
  {/if}
  {#if appUrl}
    <iframe
      bind:this={iframeRef}
      src={frameSrc}
      title={widget.content || widget.identifier}
      class={frameClass}
      style={`background: transparent; ${!surfaceVisible ? `height: ${Math.max(minHeight, 220)}px; visibility: hidden;` : ""}`}
      inert={!surfaceVisible || !presentationReady || presentationFailed}
      aria-hidden={!surfaceVisible || !presentationReady || presentationFailed}
      allow={frameAllow}
      allowtransparency={true}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
      onload={onIframeLoad}
      onerror={onIframeError}></iframe>
  {/if}
</div>
